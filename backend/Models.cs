using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace ScaleManager;

public class Employee : IdentityUser
{
    public string Name { get; set; } = "";
}

public abstract class Record
{
    public int Id { get; set; }
}
public abstract class AssignedRecord : Record
{
    public string? AssignedId { get; set; }
    [JsonIgnore] public Employee? Assigned { get; set; }
}

public class Customer : AssignedRecord
{
    [Required, MaxLength(160)] public string Company { get; set; } = "";
    public string Organization { get; set; } = "";
    public string Contact { get; set; } = "";
    [EmailAddress] public string? Email { get; set; }
    public string Phone { get; set; } = "";
    public string Industry { get; set; } = "";
    public string Address { get; set; } = "";
    public string Notes { get; set; } = "";
    public DateOnly Start { get; set; } = DateOnly.FromDateTime(DateTime.UtcNow);
    public bool Archived { get; set; }
}
public class Lead : AssignedRecord
{
    [Required, MaxLength(160)] public string Company { get; set; } = "";
    public string Contact { get; set; } = "";
    [EmailAddress] public string? Email { get; set; }
    public string Phone { get; set; } = "";
    public string Industry { get; set; } = "";
    public decimal Budget { get; set; }
    public string Goal { get; set; } = "";
    public string Message { get; set; } = "";
    public string Notes { get; set; } = "";
    public string Source { get; set; } = "Manual";
    public string Status { get; set; } = "New";
    public DateTime Created { get; set; } = DateTime.UtcNow;
    public string? ExternalId { get; set; }
    public int? CustomerId { get; set; }
    [JsonIgnore] public Customer? Customer { get; set; }
}
public class Campaign : AssignedRecord
{
    [Required, MaxLength(160)] public string Name { get; set; } = "";
    public int CustomerId { get; set; }
    [JsonIgnore] public Customer? Customer { get; set; }
    public string Channel { get; set; } = "Google Ads";
    public string Goal { get; set; } = "";
    public DateOnly Start { get; set; }
    public DateOnly End { get; set; }
    public decimal Budget { get; set; }
    public string Status { get; set; } = "Planned";
}
public class Performance : Record
{
    public int CampaignId { get; set; }
    [JsonIgnore] public Campaign? Campaign { get; set; }
    public DateOnly Date { get; set; }
    public int Impressions { get; set; }
    public int Clicks { get; set; }
    public int Conversions { get; set; }
    public decimal Spend { get; set; }
    public decimal Revenue { get; set; }
}
public class WorkItem : AssignedRecord
{
    [Required, MaxLength(160)] public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public int? CustomerId { get; set; }
    [JsonIgnore] public Customer? Customer { get; set; }
    public int? CampaignId { get; set; }
    [JsonIgnore] public Campaign? Campaign { get; set; }
    public string Priority { get; set; } = "Normal";
    public DateOnly Due { get; set; }
    public string Status { get; set; } = "Todo";
}
public class Activity : Record
{
    public string Kind { get; set; } = "";
    public int RecordId { get; set; }
    public string Subject { get; set; } = "";
    public string Action { get; set; } = "";
    public string Actor { get; set; } = "";
    public DateTime Date { get; set; } = DateTime.UtcNow;
}
public class SyncRun : Record
{
    public DateTime Date { get; set; } = DateTime.UtcNow;
    public string Status { get; set; } = "";
    public int Imported { get; set; }
}
public class BudgetRecord : Record
{
    public int CampaignId { get; set; }
    [JsonIgnore] public Campaign? Campaign { get; set; }
    public DateTime Date { get; set; } = DateTime.UtcNow;
    public decimal Planned { get; set; }
}

public class ManagerDb(DbContextOptions<ManagerDb> options) : IdentityDbContext<Employee>(options)
{
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Lead> Leads => Set<Lead>();
    public DbSet<Campaign> Campaigns => Set<Campaign>();
    public DbSet<Performance> Performance => Set<Performance>();
    public DbSet<WorkItem> Tasks => Set<WorkItem>();
    public DbSet<Activity> Activities => Set<Activity>();
    public DbSet<SyncRun> SyncRuns => Set<SyncRun>();
    public DbSet<BudgetRecord> Budgets => Set<BudgetRecord>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        base.OnModelCreating(model);
        model.Entity<Lead>().HasIndex(x => x.ExternalId).IsUnique();
        model.Entity<Lead>().HasIndex(x => x.CustomerId).IsUnique();
        model.Entity<Performance>().HasIndex(x => new { x.CampaignId, x.Date });
        model.Entity<Activity>().HasIndex(x => new { x.Kind, x.RecordId });
        model.Entity<WorkItem>().HasIndex(x => new { x.AssignedId, x.Due });
    }
}
