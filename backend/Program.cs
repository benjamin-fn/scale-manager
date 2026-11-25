using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using ScaleManager;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDbContext<ManagerDb>(options => options.UseSqlite(
    builder.Configuration.GetConnectionString("Manager") ?? "Data Source=manager.db;Foreign Keys=True"));
builder.Services.AddIdentity<Employee, IdentityRole>().AddEntityFrameworkStores<ManagerDb>();
builder.Services.ConfigureApplicationCookie(options =>
{
    options.Cookie.Name = "scale.session";
    options.Cookie.HttpOnly = true;
    options.ExpireTimeSpan = TimeSpan.FromHours(8);
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
    options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = 401; return Task.CompletedTask; };
    options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = 403; return Task.CompletedTask; };
});
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-CSRF-Token";
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
});
builder.Services.AddAuthorizationBuilder()
    .AddPolicy("Manage", policy => policy.RequireRole("Admin", "Manager"))
    .AddPolicy("Admin", policy => policy.RequireRole("Admin"));
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = 429;
    options.AddFixedWindowLimiter("signin", limiter => { limiter.PermitLimit = 30; limiter.Window = TimeSpan.FromMinutes(1); });
});
builder.Services.AddOpenApi();
builder.Services.AddProblemDetails();
builder.Services.AddHttpClient<DigitalClient>(client => client.Timeout = TimeSpan.FromSeconds(12))
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
var app = builder.Build();
app.UseExceptionHandler();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.XContentTypeOptions = "nosniff";
        if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
        {
            try { await context.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(context); }
            catch (AntiforgeryValidationException) { await Results.BadRequest(new { code = "csrf" }).ExecuteAsync(context); return; }
        }
    }
    await next(context);
});
if (app.Environment.IsDevelopment()) app.MapOpenApi();
app.MapManagerApi();
await using (var scope = app.Services.CreateAsyncScope())
{
    var services = scope.ServiceProvider;
    var db = services.GetRequiredService<ManagerDb>();
    await db.Database.MigrateAsync();
    await Demo.Initialize(services, app.Environment.IsDevelopment());
}
await app.RunAsync();

public partial class Program;

