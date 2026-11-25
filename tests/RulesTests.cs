using System.Text.Json;
using ScaleManager;

public class RulesTests
{
    [Fact]
    public void UsesAggregateTotalsAndHandlesZeros()
    {
        var result = JsonSerializer.SerializeToElement(Rules.Totals([
            new Performance { Impressions = 100, Clicks = 20, Conversions = 5, Spend = 40, Revenue = 80 },
            new Performance { Impressions = 900, Clicks = 80, Conversions = 15, Spend = 60, Revenue = 420 }
        ]));
        foreach (var (name, value) in new (string, decimal)[] { ("ctr", 10), ("cpc", 1), ("cpm", 100),
            ("cpa", 5), ("conversionRate", 20), ("roas", 5) })
            Assert.Equal(value, result.GetProperty(name).GetDecimal());
        Assert.Equal(0, Rules.Divide(4, 0));
    }

    [Fact]
    public void ValidatesMoneyAndTransitions()
    {
        Assert.False(Rules.Money(-1));
        Assert.False(Rules.Money(10.001m));
        Assert.True(Rules.Money(10.01m));
        Assert.Equal(10.001m, Rules.Display(100.01m, true));
        Assert.True(Rules.CampaignTransition("Active", "Paused"));
        Assert.False(Rules.CampaignTransition("Completed", "Active"));
        Assert.False(Rules.LeadTransition("Won", "New"));
        Assert.Equal("\"' =1+2\"", Api.CsvCell(" =1+2"));
    }
}
