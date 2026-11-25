using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

namespace ScaleManager;

public sealed class DigitalClient(HttpClient http, IConfiguration configuration, IWebHostEnvironment environment)
{
    bool TryEndpoint(out Uri? endpoint)
    {
        endpoint = null;
        if (!Uri.TryCreate(configuration["Digital:BaseUrl"], UriKind.Absolute, out var origin) ||
            (origin.Scheme != "https" && !(environment.IsDevelopment() && origin.IsLoopback && origin.Scheme == "http")) ||
            origin.UserInfo.Length != 0 || string.IsNullOrWhiteSpace(configuration["Digital:Token"])) return false;
        endpoint = new Uri(origin, "/api/integration/submissions");
        return true;
    }

    public bool Configured => TryEndpoint(out _);

    public async Task<IResult> Sync(ManagerDb db, ClaimsPrincipal actor, CancellationToken ct)
    {
        if (!TryEndpoint(out var endpoint)) return Api.Error("notConfigured");
        var submissions = new List<Submission>();
        try
        {
            var after = 0;
            for (var page = 0; page < 100; page++)
            {
                var batch = await Fetch(new UriBuilder(endpoint!) { Query = $"after={after}&limit=100" }.Uri, ct);
                if (batch.Length == 0) break;
                if (batch.Length > 100 || batch.Any(x => x.Id <= after) || batch.Select(x => x.Id).Distinct().Count() != batch.Length)
                    throw new InvalidDataException();
                submissions.AddRange(batch);
                after = batch.Max(x => x.Id);
                if (batch.Length < 100) break;
                if (page == 99) throw new InvalidDataException();
            }
        }
        catch (Exception error) when (!ct.IsCancellationRequested &&
            error is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException or InvalidDataException)
        {
            db.SyncRuns.Add(new SyncRun { Status = "failed" });
            await db.SaveChangesAsync(ct);
            return Api.Error("syncFailed", 502);
        }

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var known = (await db.Leads.Where(x => x.ExternalId != null).Select(x => x.ExternalId).ToListAsync(ct)).ToHashSet();
        var imported = 0;
        foreach (var entry in submissions)
        {
            var externalId = $"scale-digital:{entry.Id}";
            if (!known.Add(externalId)) continue;
            var lead = new Lead { Company = entry.Company, Contact = entry.Name, Email = entry.Email,
                Message = entry.Message, Source = entry.Kind == "contact" ? "DigitalContact" : "DigitalConsultation",
                ExternalId = externalId, Created = entry.CreatedUtc };
            db.Leads.Add(lead);
            await db.SaveChangesAsync(ct);
            Api.Log(db, "leads", lead.Id, lead.Company, "imported", actor);
            imported++;
        }
        db.SyncRuns.Add(new SyncRun { Status = "success", Imported = imported });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(new { imported });
    }

    async Task<Submission[]> Fetch(Uri endpoint, CancellationToken ct)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", configuration["Digital:Token"]);
                using var response = await http.SendAsync(request, ct);
                if (attempt < 2 && ((int)response.StatusCode >= 500 || response.StatusCode == HttpStatusCode.TooManyRequests))
                {
                    await Task.Delay(250 * (attempt + 1), ct);
                    continue;
                }
                response.EnsureSuccessStatusCode();
                var data = await response.Content.ReadFromJsonAsync<Submission[]>(ct) ?? throw new InvalidDataException();
                if (data.Any(x => string.IsNullOrWhiteSpace(x.Company) || x.Company.Length > 160 ||
                    x.Name is null || x.Email is null || x.Message is null || x.Kind is not ("contact" or "consultation") ||
                    x.CreatedUtc == default)) throw new InvalidDataException();
                return data;
            }
            catch (HttpRequestException error) when (attempt < 2 && error.StatusCode is null)
            {
                await Task.Delay(250 * (attempt + 1), ct);
            }
        }
    }

    record Submission(int Id, string Kind, string Name, string Email, string Company, string Message, DateTime CreatedUtc);
}

