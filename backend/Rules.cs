namespace ScaleManager;

public static class Rules
{
    public static readonly string[] LeadStages = ["New", "Contacted", "Meeting", "Proposal", "Won", "Lost"];
    public static readonly string[] CampaignStages = ["Planned", "Active", "Paused", "Completed", "Cancelled"];
    public static readonly string[] Channels = ["Google Ads", "Meta Ads", "Instagram", "LinkedIn", "SEO", "Email", "TikTok"];
    public static bool Money(decimal value) => value >= 0 && value <= 1000000000m && decimal.Round(value, 2) == value;
    public static bool LeadTransition(string before, string after) =>
        LeadStages.Contains(after) && (before == after || before != "Won" && (before != "Lost" || after == "New"));
    public static bool CampaignTransition(string before, string after) =>
        CampaignStages.Contains(after) && (before == after || before is not ("Completed" or "Cancelled") &&
            (before == "Planned" ? after is "Active" or "Cancelled" : after != "Planned"));
    public static decimal Divide(decimal numerator, decimal denominator) => denominator == 0 ? 0 : numerator / denominator;
    public static decimal Display(decimal sek, bool english) => english ? sek / 10 : sek;
    public static object Totals(IEnumerable<Performance> records)
    {
        var data = records.ToArray();
        long impressions = data.Sum(x => (long)x.Impressions), clicks = data.Sum(x => (long)x.Clicks), conversions = data.Sum(x => (long)x.Conversions);
        decimal spend = data.Sum(x => x.Spend), revenue = data.Sum(x => x.Revenue);
        return new { impressions, clicks, conversions, spend, revenue, ctr = Divide(clicks * 100m, impressions),
            cpc = Divide(spend, clicks), cpm = Divide(spend * 1000, impressions), cpa = Divide(spend, conversions),
            conversionRate = Divide(conversions * 100m, clicks), roas = Divide(revenue, spend) };
    }
}

