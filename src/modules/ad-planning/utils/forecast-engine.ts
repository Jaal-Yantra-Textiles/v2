/**
 * Forecast Engine
 *
 * Provides budget forecasting and performance prediction utilities.
 */

type HistoricalDataPoint = {
  date: Date;
  spend: number;
  conversions: number;
  revenue: number;
  impressions?: number;
  clicks?: number;
};

type ForecastResult = {
  date: string;
  predicted_spend: number;
  predicted_conversions: number;
  predicted_revenue: number;
  predicted_roas: number;
  confidence_lower: number;
  confidence_upper: number;
};

/**
 * Simple moving average calculation
 */
export function calculateMovingAverage(values: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < window - 1) {
      result.push(values[i]);
    } else {
      const sum = values.slice(i - window + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / window);
    }
  }
  return result;
}

/**
 * Calculate trend using linear regression
 */
export function calculateTrend(values: number[]): { slope: number; intercept: number; r2: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] || 0, r2: 0 };

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
    sumY2 += values[i] * values[i];
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R-squared
  const meanY = sumY / n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * i;
    ssRes += Math.pow(values[i] - predicted, 2);
    ssTot += Math.pow(values[i] - meanY, 2);
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r2 };
}

/**
 * Calculate seasonality index (day of week)
 */
export function calculateSeasonality(
  data: HistoricalDataPoint[]
): Record<number, number> {
  const dayTotals: Record<number, { sum: number; count: number }> = {};

  for (const point of data) {
    const day = point.date.getDay();
    if (!dayTotals[day]) {
      dayTotals[day] = { sum: 0, count: 0 };
    }
    dayTotals[day].sum += point.conversions;
    dayTotals[day].count++;
  }

  // Calculate average
  let overallAverage = 0;
  let totalCount = 0;
  for (const day in dayTotals) {
    overallAverage += dayTotals[day].sum;
    totalCount += dayTotals[day].count;
  }
  overallAverage = totalCount > 0 ? overallAverage / totalCount : 1;

  // Calculate seasonality index for each day
  const seasonality: Record<number, number> = {};
  for (let day = 0; day < 7; day++) {
    if (dayTotals[day] && dayTotals[day].count > 0) {
      const dayAverage = dayTotals[day].sum / dayTotals[day].count;
      seasonality[day] = overallAverage > 0 ? dayAverage / overallAverage : 1;
    } else {
      seasonality[day] = 1;
    }
  }

  return seasonality;
}

/**
 * Generate budget forecast for future periods
 */
export function generateForecast(
  historicalData: HistoricalDataPoint[],
  forecastDays: number,
  dailyBudget: number
): ForecastResult[] {
  if (historicalData.length < 7) {
    // Not enough data for reliable forecast
    return generateSimpleForecast(forecastDays, dailyBudget);
  }

  // Sort by date
  const sorted = [...historicalData].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );

  // Extract metrics
  const conversions = sorted.map((d) => d.conversions);
  const revenue = sorted.map((d) => d.revenue);
  const spend = sorted.map((d) => d.spend);

  // Calculate trends
  const conversionTrend = calculateTrend(conversions);
  const revenueTrend = calculateTrend(revenue);

  // Calculate seasonality
  const seasonality = calculateSeasonality(sorted);

  // Calculate average conversion rate and ROAS
  const totalSpend = spend.reduce((a, b) => a + b, 0);
  const totalConversions = conversions.reduce((a, b) => a + b, 0);
  const totalRevenue = revenue.reduce((a, b) => a + b, 0);

  const avgConversionRate = totalSpend > 0 ? totalConversions / totalSpend : 0;
  const avgROAS = totalSpend > 0 ? totalRevenue / totalSpend : 0;

  // Generate forecast
  const forecasts: ForecastResult[] = [];
  const startDate = new Date();
  const n = sorted.length;

  for (let i = 0; i < forecastDays; i++) {
    const forecastDate = new Date(startDate);
    forecastDate.setDate(forecastDate.getDate() + i);
    const dayOfWeek = forecastDate.getDay();

    // Base prediction from trend
    const trendIndex = n + i;
    let predictedConversions =
      conversionTrend.intercept + conversionTrend.slope * trendIndex;
    let predictedRevenue =
      revenueTrend.intercept + revenueTrend.slope * trendIndex;

    // Apply seasonality
    const seasonalFactor = seasonality[dayOfWeek] || 1;
    predictedConversions *= seasonalFactor;
    predictedRevenue *= seasonalFactor;

    // Ensure non-negative
    predictedConversions = Math.max(0, predictedConversions);
    predictedRevenue = Math.max(0, predictedRevenue);

    // Calculate confidence interval (wider for further dates)
    const uncertainty = 0.1 + 0.02 * i;
    const confidenceLower = predictedRevenue * (1 - uncertainty);
    const confidenceUpper = predictedRevenue * (1 + uncertainty);

    forecasts.push({
      date: forecastDate.toISOString().split("T")[0],
      predicted_spend: dailyBudget,
      predicted_conversions: Math.round(predictedConversions * 100) / 100,
      predicted_revenue: Math.round(predictedRevenue * 100) / 100,
      predicted_roas:
        dailyBudget > 0
          ? Math.round((predictedRevenue / dailyBudget) * 100) / 100
          : 0,
      confidence_lower: Math.round(confidenceLower * 100) / 100,
      confidence_upper: Math.round(confidenceUpper * 100) / 100,
    });
  }

  return forecasts;
}

/**
 * Simple forecast when not enough historical data
 */
function generateSimpleForecast(
  forecastDays: number,
  dailyBudget: number
): ForecastResult[] {
  const forecasts: ForecastResult[] = [];
  const startDate = new Date();

  // Assume industry average ROAS of 3:1
  const assumedROAS = 3;
  const predictedRevenue = dailyBudget * assumedROAS;
  const predictedConversions = dailyBudget * 0.01; // 1% conversion assumption

  for (let i = 0; i < forecastDays; i++) {
    const forecastDate = new Date(startDate);
    forecastDate.setDate(forecastDate.getDate() + i);

    forecasts.push({
      date: forecastDate.toISOString().split("T")[0],
      predicted_spend: dailyBudget,
      predicted_conversions: predictedConversions,
      predicted_revenue: predictedRevenue,
      predicted_roas: assumedROAS,
      confidence_lower: predictedRevenue * 0.5,
      confidence_upper: predictedRevenue * 1.5,
    });
  }

  return forecasts;
}

/**
 * Calculate forecast accuracy against actual data
 */
export function calculateForecastAccuracy(
  forecasts: Array<{ date: string; predicted_revenue: number }>,
  actuals: Array<{ date: string; actual_revenue: number }>
): {
  mape: number; // Mean Absolute Percentage Error
  accuracy: number;
  comparisons: Array<{
    date: string;
    predicted: number;
    actual: number;
    error: number;
    errorPercent: number;
  }>;
} {
  const actualMap = new Map(actuals.map((a) => [a.date, a.actual_revenue]));

  const comparisons: Array<{
    date: string;
    predicted: number;
    actual: number;
    error: number;
    errorPercent: number;
  }> = [];

  let totalPercentError = 0;
  let count = 0;

  for (const forecast of forecasts) {
    const actual = actualMap.get(forecast.date);
    if (actual !== undefined && actual > 0) {
      const error = Math.abs(forecast.predicted_revenue - actual);
      const errorPercent = (error / actual) * 100;

      comparisons.push({
        date: forecast.date,
        predicted: forecast.predicted_revenue,
        actual,
        error: Math.round(error * 100) / 100,
        errorPercent: Math.round(errorPercent * 100) / 100,
      });

      totalPercentError += errorPercent;
      count++;
    }
  }

  const mape = count > 0 ? totalPercentError / count : 0;
  const accuracy = Math.max(0, 100 - mape);

  return {
    mape: Math.round(mape * 100) / 100,
    accuracy: Math.round(accuracy * 100) / 100,
    comparisons,
  };
}

/**
 * Recommend optimal daily budget based on historical performance
 */
export function recommendBudget(
  historicalData: HistoricalDataPoint[],
  targetROAS: number,
  maxBudget: number
): {
  recommended_budget: number;
  expected_roas: number;
  expected_conversions: number;
  expected_revenue: number;
  confidence: "high" | "medium" | "low";
} {
  if (historicalData.length < 14) {
    return {
      recommended_budget: maxBudget * 0.5,
      expected_roas: targetROAS,
      expected_conversions: 0,
      expected_revenue: 0,
      confidence: "low",
    };
  }

  // Calculate current performance
  const totalSpend = historicalData.reduce((sum, d) => sum + d.spend, 0);
  const totalRevenue = historicalData.reduce((sum, d) => sum + d.revenue, 0);
  const totalConversions = historicalData.reduce((sum, d) => sum + d.conversions, 0);

  const currentROAS = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const avgDailySpend = totalSpend / historicalData.length;
  const revenuePerDollar = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const conversionsPerDollar = totalSpend > 0 ? totalConversions / totalSpend : 0;

  // Estimate optimal budget
  let recommendedBudget = avgDailySpend;

  if (currentROAS >= targetROAS) {
    // Performing well, suggest increasing
    recommendedBudget = Math.min(avgDailySpend * 1.2, maxBudget);
  } else if (currentROAS >= targetROAS * 0.8) {
    // Close to target, maintain
    recommendedBudget = avgDailySpend;
  } else {
    // Underperforming, suggest decreasing
    recommendedBudget = avgDailySpend * 0.8;
  }

  return {
    recommended_budget: Math.round(recommendedBudget * 100) / 100,
    expected_roas: Math.round(currentROAS * 100) / 100,
    expected_conversions: Math.round(recommendedBudget * conversionsPerDollar * 100) / 100,
    expected_revenue: Math.round(recommendedBudget * revenuePerDollar * 100) / 100,
    confidence: historicalData.length >= 30 ? "high" : historicalData.length >= 14 ? "medium" : "low",
  };
}
