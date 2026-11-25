using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace ScaleManager;

public static class Api
{
    public static void MapManagerApi(this WebApplication app)
    {
        var api = app.MapGroup("/api");
        api.MapGet("/csrf", (HttpContext context, IAntiforgery tokens) => new { token = tokens.GetAndStoreTokens(context).RequestToken });
        api.MapPost("/login", async (Login input, SignInManager<Employee> auth) =>
            (await auth.PasswordSignInAsync(input.Email, input.Password, false, true)).Succeeded
                ? Results.NoContent() : Error("login", 401)).RequireRateLimiting("signin");

        var session = api.MapGroup("").RequireAuthorization();
        session.MapGet("/me", async (ClaimsPrincipal principal, UserManager<Employee> users, IWebHostEnvironment environment) =>
        {
            var user = await users.GetUserAsync(principal);
            return user is null ? Results.Unauthorized() : Results.Ok(new { user.Id, user.Name, user.Email,
                role = (await users.GetRolesAsync(user)).Single(), demo = environment.IsDevelopment() });
        });
        session.MapPost("/logout", async (SignInManager<Employee> auth) => { await auth.SignOutAsync(); return Results.NoContent(); });
        session.MapGet("/employees", (ManagerDb db, CancellationToken ct) => db.Users.OrderBy(x => x.Name)
            .Select(x => new { x.Id, x.Name }).ToListAsync(ct));
        session.MapGet("/users", async (UserManager<Employee> users, CancellationToken ct) =>
        {
            var list = new List<object>();
            foreach (var user in await users.Users.OrderBy(x => x.Name).ToListAsync(ct))
                list.Add(new { user.Id, user.Name, user.Email, role = (await users.GetRolesAsync(user)).Single() });
            return list;
        }).RequireAuthorization("Admin");
        session.MapPost("/users", async (NewUser input, UserManager<Employee> users) =>
        {
            if (string.IsNullOrWhiteSpace(input.Name) || !new EmailAddressAttribute().IsValid(input.Email)
                || input.Role is not ("Admin" or "Manager" or "Employee")) return Error("invalid");
            var user = new Employee { Name = input.Name, UserName = input.Email, Email = input.Email };
            if (!(await users.CreateAsync(user, input.Password)).Succeeded) return Error("invalidUser");
            if (!(await users.AddToRoleAsync(user, input.Role)).Succeeded)
            {
                await users.DeleteAsync(user);
                return Error("invalidUser");
            }
            return Results.NoContent();
        }).RequireAuthorization("Admin");

        Register<Customer>(session, "/customers");
        Register<Lead>(session, "/leads");
        Register<Campaign>(session, "/campaigns");
        Register<WorkItem>(session, "/tasks");
        session.MapPost("/customers/{id:int}/archive", async (int id, ManagerDb db, ClaimsPrincipal actor, CancellationToken ct) =>
        {
            var customer = await db.Customers.FindAsync([id], ct);
            if (customer is null) return Results.NotFound();
            if (!customer.Archived)
            {
                customer.Archived = true;
                Log(db, "customers", id, customer.Company, "archived", actor);
                await db.SaveChangesAsync(ct);
            }
            return Results.NoContent();
        }).RequireAuthorization("Manage");
        session.MapPost("/leads/{id:int}/convert", Convert).RequireAuthorization("Manage");
        session.MapPost("/campaigns/{id:int}/performance", AddPerformance);
        session.MapGet("/overview", Overview);
        session.MapGet("/reports", Report).RequireAuthorization("Manage");
        session.MapGet("/integration", async (ManagerDb db, DigitalClient client, CancellationToken ct) =>
            new { configured = client.Configured, runs = await db.SyncRuns.OrderByDescending(x => x.Id).Take(10).ToListAsync(ct) })
            .RequireAuthorization("Admin");
        session.MapPost("/integration/sync", (DigitalClient client, ManagerDb db, ClaimsPrincipal user, CancellationToken ct) =>
            client.Sync(db, user, ct)).RequireAuthorization("Admin");
    }

    static void Register<T>(RouteGroupBuilder api, string route) where T : AssignedRecord
    {
        var kind = route[1..];
        var list = api.MapGet(route, (ManagerDb db, ClaimsPrincipal actor, CancellationToken ct) =>
            Visible<T>(db, actor).OrderByDescending(x => x.Id).ToListAsync(ct));
        if (typeof(T) == typeof(Lead)) list.RequireAuthorization("Manage");
        api.MapGet(route + "/{id:int}", async (int id, ManagerDb db, ClaimsPrincipal actor, CancellationToken ct) =>
        {
            if (typeof(T) == typeof(Lead) && !Manages(actor)) return Results.Forbid();
            var record = await Visible<T>(db, actor).SingleOrDefaultAsync(x => x.Id == id, ct);
            if (record is null) return Results.NotFound();
            var activity = await db.Activities.Where(x => x.Kind == kind && x.RecordId == id)
                .OrderByDescending(x => x.Id).ToListAsync(ct);
            return Results.Ok(new { record, activity });
        });
        api.MapPost(route, (T input, ManagerDb db, ClaimsPrincipal actor, CancellationToken ct) =>
            Save(kind, null, input, db, actor, ct)).RequireAuthorization("Manage");
        api.MapPut(route + "/{id:int}", (int id, T input, ManagerDb db, ClaimsPrincipal actor, CancellationToken ct) =>
            Save(kind, id, input, db, actor, ct));
    }

    static async Task<IResult> Save<T>(string kind, int? id, T input, ManagerDb db, ClaimsPrincipal actor, CancellationToken ct)
        where T : AssignedRecord
    {
        if (!Manages(actor) && typeof(T) != typeof(WorkItem)) return Results.Forbid();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var previous = id is null ? null : await Visible<T>(db, actor).SingleOrDefaultAsync(x => x.Id == id, ct);
        if (id is not null && previous is null) return Results.NotFound();
        if (!Manages(actor) && previous is WorkItem assigned && input is WorkItem update)
        {
            if (update.Status is not ("Todo" or "Doing" or "Done")) return Error("status");
            assigned.Status = update.Status;
            Log(db, kind, assigned.Id, assigned.Name, "updated", actor);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return Results.Ok(assigned);
        }
        input.Assigned = null;
        input.Id = id ?? 0;
        if (input.AssignedId == "") input.AssignedId = null;
        if (!Validator.TryValidateObject(input, new ValidationContext(input), null, true)) return Error("invalid");
        if (input.AssignedId is not null && !await db.Users.AnyAsync(x => x.Id == input.AssignedId, ct)) return Error("assignment");
        string subject;
        switch (input)
        {
            case Customer customer:
                customer.Archived = previous is Customer oldCustomer && oldCustomer.Archived;
                if (customer.Archived) return Error("archived");
                subject = customer.Company;
                break;
            case Lead lead:
                var oldLead = previous as Lead;
                lead.Customer = null;
                lead.CustomerId = oldLead?.CustomerId;
                lead.ExternalId = oldLead?.ExternalId;
                lead.Created = oldLead?.Created ?? DateTime.UtcNow;
                if (!Rules.Money(lead.Budget)) return Error("money");
                if (!Rules.LeadTransition(oldLead?.Status ?? "New", lead.Status)) return Error("status");
                subject = lead.Company;
                break;
            case Campaign campaign:
                campaign.Customer = null;
                var oldCampaign = previous as Campaign;
                if (campaign.Start == default || campaign.End < campaign.Start) return Error("dates");
                if (oldCampaign is not null && (oldCampaign.Start != campaign.Start || oldCampaign.End != campaign.End) &&
                    await db.Performance.AnyAsync(x => x.CampaignId == campaign.Id &&
                        (x.Date < campaign.Start || x.Date > campaign.End), ct)) return Error("dates");
                if (!Rules.Money(campaign.Budget)) return Error("money");
                if (!Rules.Channels.Contains(campaign.Channel)) return Error("invalid");
                if (!Rules.CampaignStages.Contains(campaign.Status) ||
                    oldCampaign is not null && !Rules.CampaignTransition(oldCampaign.Status, campaign.Status)) return Error("status");
                var existingCustomerId = oldCampaign?.CustomerId;
                if (!await db.Customers.AnyAsync(x => x.Id == campaign.CustomerId &&
                    (!x.Archived || x.Id == existingCustomerId), ct)) return Error("customer");
                subject = campaign.Name;
                break;
            case WorkItem task:
                task.Customer = null;
                task.Campaign = null;
                if (task.Due == default || task.Priority is not ("Low" or "Normal" or "High" or "Urgent")
                    || task.Status is not ("Todo" or "Doing" or "Done")) return Error("invalid");
                if (task.CustomerId is int customerId && !await db.Customers.AnyAsync(x => x.Id == customerId, ct)) return Error("customer");
                if (task.CampaignId is int campaignId && !await db.Campaigns.AnyAsync(x => x.Id == campaignId &&
                    (task.CustomerId == null || x.CustomerId == task.CustomerId), ct)) return Error("campaign");
                subject = task.Name;
                break;
            default: return Error("invalid");
        }
        if (previous is null) db.Set<T>().Add(input);
        else db.Entry(previous).CurrentValues.SetValues(input);
        await db.SaveChangesAsync(ct);
        if (input is Campaign saved && (previous is null ||
            !await db.Budgets.AnyAsync(x => x.CampaignId == saved.Id, ct) ||
            await db.Budgets.Where(x => x.CampaignId == saved.Id).OrderByDescending(x => x.Id).Select(x => x.Planned).FirstAsync(ct) != saved.Budget))
            db.Budgets.Add(new BudgetRecord { CampaignId = saved.Id, Planned = saved.Budget });
        Log(db, kind, input.Id, subject, previous is null ? "created" : "updated", actor);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(input);
    }

    static async Task<IResult> Convert(int id, ManagerDb db, ClaimsPrincipal actor, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var lead = await db.Leads.FindAsync([id], ct);
        if (lead is null) return Results.NotFound();
        if (lead.CustomerId is not null) return Error("converted", 409);
        if (lead.Status != "Won") return Error("status");
        var customer = new Customer { Company = lead.Company, Contact = lead.Contact, Email = lead.Email,
            Phone = lead.Phone, Industry = lead.Industry, AssignedId = lead.AssignedId, Notes = lead.Notes };
        lead.Customer = customer;
        await db.SaveChangesAsync(ct);
        Log(db, "leads", id, lead.Company, "converted", actor);
        Log(db, "customers", customer.Id, customer.Company, "converted", actor);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(new { customer.Id });
    }

    static async Task<IResult> AddPerformance(int id, Performance input, ManagerDb db, ClaimsPrincipal actor, CancellationToken ct)
    {
        var campaign = await Visible<Campaign>(db, actor).SingleOrDefaultAsync(x => x.Id == id, ct);
        if (campaign is null) return Results.NotFound();
        if (input.Date < campaign.Start || input.Date > campaign.End) return Error("dates");
        if (input.Impressions < 0 || input.Clicks < 0 || input.Conversions < 0 || input.Clicks > input.Impressions) return Error("metrics");
        if (!Rules.Money(input.Spend) || !Rules.Money(input.Revenue)) return Error("money");
        input.Id = 0;
        input.Campaign = null;
        input.CampaignId = id;
        db.Performance.Add(input);
        Log(db, "campaigns", id, campaign.Name, "performanceAdded", actor);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    static async Task<IResult> Overview(DateOnly? from, DateOnly? to, int? campaignId, ManagerDb db, ClaimsPrincipal actor, CancellationToken ct)
    {
        if (from > to) return Error("dates");
        var customers = await Visible<Customer>(db, actor).ToListAsync(ct);
        var campaigns = await Visible<Campaign>(db, actor).Where(x => (campaignId == null || x.Id == campaignId)
            && (from == null || x.End >= from) && (to == null || x.Start <= to)).ToListAsync(ct);
        var ids = campaigns.Select(x => x.Id).ToArray();
        var performance = await db.Performance.Where(x => ids.Contains(x.CampaignId) && (from == null || x.Date >= from)
            && (to == null || x.Date <= to)).ToListAsync(ct);
        var tasks = await Visible<WorkItem>(db, actor).Where(x => x.Status != "Done").OrderBy(x => x.Due).ToListAsync(ct);
        var leads = Manages(actor) ? await db.Leads.OrderByDescending(x => x.Created).ToListAsync(ct) : [];
        leads = leads.Where(x => (from == null || DateOnly.FromDateTime(x.Created) >= from)
            && (to == null || DateOnly.FromDateTime(x.Created) <= to)).ToList();
        var activity = Manages(actor) ? await db.Activities.OrderByDescending(x => x.Id).Take(8).ToListAsync(ct) : [];
        return Results.Ok(new
        {
            customers = customers.Count(x => !x.Archived), newLeads = leads.Count(x => x.Status == "New"),
            campaigns = campaigns.Count(x => x.Status == "Active"), budget = campaigns.Sum(x => x.Budget),
            openTasks = tasks.Count, totals = Rules.Totals(performance), activity, deadlines = tasks.Take(6),
            leads = leads.Take(5).Select(x => new { x.Id, x.Company, x.Status }),
            timeline = performance.GroupBy(x => x.Date.ToString("yyyy-MM")).OrderBy(x => x.Key)
                .Select(x => new { month = x.Key, spend = x.Sum(y => y.Spend), revenue = x.Sum(y => y.Revenue), conversions = x.Sum(y => y.Conversions) }),
            stages = leads.GroupBy(x => x.Status).Select(x => new { name = x.Key, count = x.Count() }),
            statuses = campaigns.GroupBy(x => x.Status).Select(x => new { name = x.Key, count = x.Count() }),
            channels = campaigns.GroupBy(x => x.Channel).Select(x => new { name = x.Key, count = x.Count() }),
            budgets = campaigns.Select(x => new { x.Id, x.Name, x.CustomerId, x.Channel, x.Budget,
                spend = performance.Where(p => p.CampaignId == x.Id).Sum(p => p.Spend),
                metrics = Rules.Totals(performance.Where(p => p.CampaignId == x.Id)) })
        });
    }

    static async Task<IResult> Report(string type, string? search, string? lang, DateOnly? from, DateOnly? to,
        ManagerDb db, CancellationToken ct)
    {
        var en = lang == "en";
        if (from > to) return Error("dates");
        var culture = CultureInfo.GetCultureInfo(en ? "en-US" : "sv-SE");
        string Money(decimal value) => Rules.Display(value, en).ToString("C", culture);
        bool Matches(string name) => string.IsNullOrWhiteSpace(search) || name.Contains(search, StringComparison.OrdinalIgnoreCase);
        bool InRange(DateOnly date) => (from is null || date >= from) && (to is null || date <= to);
        var rows = new List<string[]>();
        if (type == "customers")
        {
            rows.Add(en ? ["Customer", "Contact", "Email"] : ["Kund", "Kontakt", "E-post"]);
            rows.AddRange((await db.Customers.ToListAsync(ct)).Where(x => Matches(x.Company) && InRange(x.Start))
                .Select(x => new[] { x.Company, x.Contact, x.Email ?? "" }));
        }
        else if (type == "leads")
        {
            rows.Add(en ? ["Inquiry", "Won", "Budget"] : ["Förfrågan", "Vunnen", "Budget"]);
            rows.AddRange((await db.Leads.ToListAsync(ct)).Where(x => Matches(x.Company) && InRange(DateOnly.FromDateTime(x.Created)))
                .Select(x => new[] { x.Company, x.Status == "Won" ? "1" : "0", Money(x.Budget) }));
        }
        else if (type == "tasks")
        {
            rows.Add(en ? ["Employee", "Open tasks"] : ["Medarbetare", "Öppna uppgifter"]);
            var tasks = await db.Tasks.Where(x => x.Status != "Done").Include(x => x.Assigned).ToListAsync(ct);
            rows.AddRange(tasks.Where(x => InRange(x.Due)).GroupBy(x => x.Assigned?.Name ?? "")
                .Where(x => Matches(x.Key)).Select(x => new[] { x.Key, x.Count().ToString(culture) }));
        }
        else if (type is "campaigns" or "budgets" or "spend")
        {
            rows.Add(type == "spend" ? en ? ["Campaign", "Spend"] : ["Kampanj", "Annonskostnad"]
                : type == "budgets" ? en ? ["Campaign", "Budget", "Spend", "Utilization"] : ["Kampanj", "Budget", "Annonskostnad", "Budgetutnyttjande"]
                : en ? ["Campaign", "Spend", "Revenue", "ROAS"] : ["Kampanj", "Annonskostnad", "Intäkt", "ROAS"]);
            var performance = await db.Performance.Where(x => (from == null || x.Date >= from) && (to == null || x.Date <= to)).ToListAsync(ct);
            var campaigns = await db.Campaigns.Where(x => (from == null || x.End >= from) && (to == null || x.Start <= to)).ToListAsync(ct);
            foreach (var campaign in campaigns.Where(x => Matches(x.Name)))
            {
                var data = performance.Where(x => x.CampaignId == campaign.Id).ToArray();
                var spend = data.Sum(x => x.Spend);
                var revenue = data.Sum(x => x.Revenue);
                rows.Add(type == "spend" ? [campaign.Name, Money(spend)] : type == "budgets"
                    ? [campaign.Name, Money(campaign.Budget), Money(spend), Rules.Divide(spend, campaign.Budget).ToString("P1", culture)]
                    : [campaign.Name, Money(spend), Money(revenue), Rules.Divide(revenue, spend).ToString("N2", culture)]);
            }
        }
        else return Error("invalid");
        var csv = string.Join("\r\n", rows.Select(row => string.Join(",", row.Select(CsvCell))));
        return Results.File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv)).ToArray(), "text/csv; charset=utf-8", $"scale-{type}.csv");
    }

    public static string CsvCell(string value)
    {
        var trimmed = value.TrimStart();
        if ((trimmed.Length > 0 && "=+-@＝＋－＠".Contains(trimmed[0])) || value.StartsWith('\t') || value.StartsWith('\r') || value.StartsWith('\n')) value = "'" + value;
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }

    static IQueryable<T> Visible<T>(ManagerDb db, ClaimsPrincipal actor) where T : AssignedRecord
    {
        var query = db.Set<T>().AsQueryable();
        if (Manages(actor)) return query;
        var id = actor.FindFirstValue(ClaimTypes.NameIdentifier);
        if (typeof(T) == typeof(Campaign))
            return (IQueryable<T>)db.Campaigns.Where(x => x.AssignedId == id || x.Customer!.AssignedId == id);
        if (typeof(T) == typeof(Customer))
            return (IQueryable<T>)db.Customers.Where(x => x.AssignedId == id || db.Campaigns.Any(c => c.CustomerId == x.Id && c.AssignedId == id));
        return query.Where(x => x.AssignedId == id);
    }

    static bool Manages(ClaimsPrincipal user) => user.IsInRole("Admin") || user.IsInRole("Manager");
    public static IResult Error(string code, int status = 400) => Results.Json(new { code }, statusCode: status);
    public static void Log(ManagerDb db, string kind, int id, string subject, string action, ClaimsPrincipal actor) =>
        db.Activities.Add(new Activity { Kind = kind, RecordId = id, Subject = subject, Action = action, Actor = actor.Identity?.Name ?? "" });
    record Login(string Email, string Password);
    record NewUser(string Name, string Email, string Password, string Role);
}

