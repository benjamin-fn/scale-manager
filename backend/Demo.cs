using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace ScaleManager;

public static class Demo
{
    public static async Task Initialize(IServiceProvider services, bool development)
    {
        var roles = services.GetRequiredService<RoleManager<IdentityRole>>();
        foreach (var role in new[] { "Admin", "Manager", "Employee" })
            if (!await roles.RoleExistsAsync(role)) Check(await roles.CreateAsync(new IdentityRole(role)));
        var users = services.GetRequiredService<UserManager<Employee>>();
        if (!development)
        {
            var config = services.GetRequiredService<IConfiguration>();
            var email = config["Bootstrap:Email"];
            var password = config["Bootstrap:Password"];
            if (!string.IsNullOrWhiteSpace(email) && !string.IsNullOrWhiteSpace(password) && !await users.Users.AnyAsync())
            {
                var admin = new Employee { Email = email, UserName = email, Name = "Administrator" };
                Check(await users.CreateAsync(admin, password));
                Check(await users.AddToRoleAsync(admin, "Admin"));
            }
            return;
        }
        var owners = new List<Employee>();
        foreach (var (role, name) in new[] { ("Admin", "Elin Berg"), ("Manager", "Noah Lind"), ("Employee", "Maja Holm") })
        {
            var email = role.ToLowerInvariant() + "@scale.example";
            var user = await users.FindByEmailAsync(email);
            if (user is null)
            {
                user = new Employee { Email = email, UserName = email, Name = name };
                Check(await users.CreateAsync(user, "ScaleDemo!2026"));
            }
            if (!await users.IsInRoleAsync(user, role)) Check(await users.AddToRoleAsync(user, role));
            owners.Add(user);
        }

        var db = services.GetRequiredService<ManagerDb>();
        await using var transaction = await db.Database.BeginTransactionAsync();
        if (await db.Customers.AnyAsync()) return;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        string[] names = ["Northline Studio", "Forma Living", "Boreal Coffee", "Kvarts Energi", "Vinga Outdoor", "Luma Health",
            "Nordform", "Slate Mobility", "Skärgård Hotell", "Juniper Works", "Fjord Atelier", "Växtrum", "Axel & Co", "Klint Audio", "Tundra Sport"];
        string[] industries = ["Design", "Retail", "Hospitality", "Energy", "Outdoor", "Health"];
        var customers = names.Select((name, i) => new Customer
        {
            Company = name, Contact = new[] { "Alice Dahl", "Hugo Ek", "Sara Vik", "Linus Lund" }[i % 4],
            Email = $"hello@client{i + 1}.example", Industry = industries[i % industries.Length],
            Organization = $"DEMO-{i + 1:000}", Start = today.AddDays(-210 + i * 8), AssignedId = owners[i % 3].Id,
            Archived = i == names.Length - 1
        }).ToArray();
        db.Customers.AddRange(customers);
        string[] campaignNames = ["Brand Search", "Always On", "Lead Generation", "Nordic Launch", "Seasonal Growth", "Traffic & Awareness",
            "Organic Visibility", "Product Launch", "Retargeting", "Spring Collection", "Lead Nurture", "Community Growth", "Conversion Sprint"];
        var campaigns = Enumerable.Range(0, 22).Select(i => new Campaign
        {
            Name = $"{customers[i % 14].Company} · {campaignNames[i % campaignNames.Length]}",
            Customer = customers[i % 14], AssignedId = owners[(i + 1) % 3].Id, Channel = Rules.Channels[i % 7],
            Start = today.AddDays(-165 + i), End = today.AddDays(i % 6 == 0 ? -3 : 25 + i),
            Budget = 16000 + i * 2800, Status = i % 6 == 0 ? "Completed" : i % 7 == 0 ? "Planned" : i % 5 == 0 ? "Paused" : "Active"
        }).ToArray();
        db.Campaigns.AddRange(campaigns);
        var random = new Random(38);
        for (var i = 0; i < campaigns.Length; i++)
        {
            var campaign = campaigns[i];
            db.Budgets.Add(new BudgetRecord { Campaign = campaign, Planned = campaign.Budget });
            if (campaign.Status == "Planned") continue;
            for (var month = 0; month < 6; month++)
            {
                var date = today.AddMonths(-month).AddDays(-3);
                if (date < campaign.Start || date > campaign.End) continue;
                var spend = random.Next(2600, 5100) + (6 - month) * 470;
                var clicks = random.Next(440, 2300);
                db.Performance.Add(new Performance { Campaign = campaign, Date = date, Spend = spend,
                    Revenue = decimal.Round(spend * (2.4m + (decimal)random.NextDouble() * 2.3m), 2),
                    Impressions = clicks * random.Next(19, 37), Clicks = clicks, Conversions = clicks / random.Next(18, 42) });
            }
        }
        string[] prospects = ["Aster", "Björk", "Cinder", "Dune", "Evergreen", "Flint", "Granite", "Havn", "Ivory",
            "Jade", "Kaskad", "Linden", "Morrow", "Norr", "Ochre", "Pine", "Quartz", "Rime", "Sund", "Tide", "Umbra", "Vale", "Wren", "Yarrow", "Zenith", "Äng"];
        db.Leads.AddRange(prospects.Select((name, i) => new Lead
        {
            Company = name + new[] { " Studio", " Collective", " Nordic", " Labs" }[i % 4], Contact = customers[i % 14].Contact,
            Email = $"contact@prospect{i + 1}.example", Industry = industries[i % 6], Budget = 12500 + i * 1800,
            Status = Rules.LeadStages[(i * i + i / 4) % 6], Created = DateTime.UtcNow.AddDays(-i * 2),
            Source = i % 2 == 0 ? "Referral" : "Manual", AssignedId = owners[(i + 1) % 3].Id
        }));
        string[] actions = ["Review search terms", "Approve campaign copy", "Prepare monthly report", "Audit landing page",
            "Update ad creative", "Send budget summary", "Review tracking", "Confirm client brief"];
        db.Tasks.AddRange(Enumerable.Range(0, 18).Select(i => new WorkItem
        {
            Name = actions[i % actions.Length], Customer = customers[i % 14], Campaign = campaigns[i % 14],
            AssignedId = owners[i % 3].Id, Priority = new[] { "High", "Normal", "Urgent", "Low" }[i % 4],
            Due = today.AddDays(i - 2), Status = i % 5 == 4 ? "Done" : i % 3 == 1 ? "Doing" : "Todo"
        }));
        await db.SaveChangesAsync();
        db.Activities.AddRange(campaigns.Take(6).Select((x, i) => new Activity
        {
            Kind = "campaigns", RecordId = x.Id, Subject = x.Name, Actor = owners[i % 3].Email!,
            Action = i % 2 == 0 ? "created" : "performanceAdded", Date = DateTime.UtcNow.AddHours(-3 * i)
        }));
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
    }

    static void Check(IdentityResult result)
    {
        if (!result.Succeeded) throw new InvalidOperationException("Identity initialization failed.");
    }
}

