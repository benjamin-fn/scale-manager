using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using ScaleManager;

public class ApiTests : IClassFixture<ManagerFactory>
{
    readonly HttpClient client;
    public ApiTests(ManagerFactory factory) => client = factory.CreateClient(new() { AllowAutoRedirect = false });

    [Fact]
    public async Task AuthenticationChecksCsrfAndEmployeePermissions()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/customers")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/login",
            new { email = "employee@scale.example", password = "ScaleDemo!2026" })).StatusCode);
        await Login("employee");
        Assert.Equal(HttpStatusCode.Forbidden, (await Write(HttpMethod.Post, "/api/customers", new { company = "Forbidden" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/reports?type=customers")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/leads")).StatusCode);
        var tasks = await client.GetFromJsonAsync<JsonElement>("/api/tasks");
        var task = tasks.EnumerateArray().First();
        var id = task.GetProperty("id").GetInt32();
        var result = await Write(HttpMethod.Put, $"/api/tasks/{id}", new { name = "tampered", status = "Done" });
        var changed = await result.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Done", changed.GetProperty("status").GetString());
        Assert.Equal(task.GetProperty("name").GetString(), changed.GetProperty("name").GetString());
    }

    [Fact]
    public async Task ManagerCreatesEditsAndArchivesCustomerWithHistory()
    {
        await Login("manager");
        var added = await Write(HttpMethod.Post, "/api/customers", new { company = "Example Design" });
        var id = (await added.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.OK, (await Write(HttpMethod.Put, $"/api/customers/{id}", new { company = "Example Studio" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Write(HttpMethod.Post, $"/api/customers/{id}/archive")).StatusCode);
        var detail = await client.GetFromJsonAsync<JsonElement>($"/api/customers/{id}");
        Assert.True(detail.GetProperty("record").GetProperty("archived").GetBoolean());
        Assert.Equal("Example Studio", detail.GetProperty("record").GetProperty("company").GetString());
        Assert.Equal(3, detail.GetProperty("activity").GetArrayLength());
    }

    [Fact]
    public async Task ValidatesCampaignDatesAndRecordsOverspend()
    {
        await Login("manager");
        var first = (await client.GetFromJsonAsync<JsonElement>("/api/customers")).EnumerateArray()
            .First(x => !x.GetProperty("archived").GetBoolean()).GetProperty("id").GetInt32();
        object Campaign(string end, string status, decimal budget = 100) =>
            new { name = "Campaign integration test", customerId = first, start = "2026-01-01", end, status, budget };
        Assert.Equal(HttpStatusCode.BadRequest, (await Write(HttpMethod.Post, "/api/campaigns", Campaign("2025-12-31", "Planned"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Write(HttpMethod.Post, "/api/campaigns", Campaign("2026-12-01", "Planned", -100))).StatusCode);
        var created = await Write(HttpMethod.Post, "/api/campaigns", Campaign("2026-12-01", "Planned"));
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.BadRequest, (await Write(HttpMethod.Put, $"/api/campaigns/{id}", Campaign("2026-12-01", "Completed"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Write(HttpMethod.Put, $"/api/campaigns/{id}", Campaign("2026-12-01", "Active"))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Write(HttpMethod.Post, $"/api/campaigns/{id}/performance",
            new { date = "2026-01-04", impressions = 100, clicks = 5, conversions = 1, spend = 130, revenue = 390 })).StatusCode);
        var overview = await client.GetFromJsonAsync<JsonElement>($"/api/overview?campaignId={id}");
        Assert.Equal(130m, overview.GetProperty("totals").GetProperty("spend").GetDecimal());
        Assert.Equal(3m, overview.GetProperty("totals").GetProperty("roas").GetDecimal());
    }

    [Fact]
    public async Task IdenticalSubmissionsImportOnceAndConvertOnce()
    {
        await Login("admin");
        var first = await Write(HttpMethod.Post, "/api/integration/sync");
        Assert.Equal(1, (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("imported").GetInt32());
        var second = await Write(HttpMethod.Post, "/api/integration/sync");
        Assert.Equal(0, (await second.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("imported").GetInt32());
        var entries = await client.GetFromJsonAsync<JsonElement>("/api/leads");
        var lead = entries.EnumerateArray().Single(x => x.GetProperty("externalId").GetString() == "scale-digital:123");
        var id = lead.GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.BadRequest, (await Write(HttpMethod.Post, $"/api/leads/{id}/convert")).StatusCode);
        var update = JsonSerializer.Deserialize<Dictionary<string, object>>(lead.GetRawText())!;
        update["status"] = "Won";
        Assert.Equal(HttpStatusCode.OK, (await Write(HttpMethod.Put, $"/api/leads/{id}", update)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Write(HttpMethod.Post, $"/api/leads/{id}/convert")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Write(HttpMethod.Post, $"/api/leads/{id}/convert")).StatusCode);
        var detail = await client.GetFromJsonAsync<JsonElement>($"/api/leads/{id}");
        Assert.Contains(detail.GetProperty("activity").EnumerateArray(), x => x.GetProperty("action").GetString() == "converted");
    }

    async Task Login(string role) => Assert.Equal(HttpStatusCode.NoContent, (await Write(HttpMethod.Post, "/api/login",
        new { email = role + "@scale.example", password = "ScaleDemo!2026" })).StatusCode);

    async Task<HttpResponseMessage> Write(HttpMethod method, string path, object? data = null)
    {
        var token = (await client.GetFromJsonAsync<JsonElement>("/api/csrf")).GetProperty("token").GetString();
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Add("X-CSRF-Token", token);
        if (data is not null) request.Content = JsonContent.Create(data);
        return await client.SendAsync(request);
    }
}

public class ManagerFactory : WebApplicationFactory<Program>
{
    readonly string directory = Directory.CreateTempSubdirectory("scale-manager-tests-").FullName;
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("ConnectionStrings:Manager", $"Data Source={Path.Combine(directory, "test.db")}");
        builder.UseSetting("Digital:BaseUrl", "https://digital.example");
        builder.UseSetting("Digital:Token", "test-fixture-token");
        builder.ConfigureServices(services => services.AddHttpClient<DigitalClient>()
            .ConfigurePrimaryHttpMessageHandler(() => new Submissions()));
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing)
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }

    sealed class Submissions : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            Assert.Equal("/api/integration/submissions?after=0&limit=100", request.RequestUri?.PathAndQuery);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(
                """[{"id":123,"kind":"consultation","name":"Alex Example","email":"alex@agency.example","company":"Example Agency","message":"Seeking a paid search consultation.","createdUtc":"2026-01-01T08:12:00Z"}]""",
                Encoding.UTF8, "application/json") });
        }
    }
}
