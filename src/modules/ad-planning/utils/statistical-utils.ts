/**
 * Statistical Utilities for A/B Testing
 *
 * Provides statistical significance calculations for experiments.
 */

/**
 * Calculate z-score for proportion comparison
 */
export function calculateZScore(
  conversionA: number,
  sampleA: number,
  conversionB: number,
  sampleB: number
): number {
  const pA = conversionA / sampleA;
  const pB = conversionB / sampleB;
  const pPooled = (conversionA + conversionB) / (sampleA + sampleB);
  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / sampleA + 1 / sampleB));

  if (se === 0) return 0;
  return (pA - pB) / se;
}

/**
 * Calculate p-value from z-score (two-tailed)
 */
export function calculatePValue(zScore: number): number {
  // Standard normal CDF approximation
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = zScore < 0 ? -1 : 1;
  const z = Math.abs(zScore) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * z);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);

  // Two-tailed p-value
  return 2 * (1 - 0.5 * (1.0 + sign * y));
}

/**
 * Determine statistical significance level
 */
export function getSignificanceLevel(pValue: number): {
  level: "high" | "medium" | "low" | "none";
  confident: boolean;
  description: string;
} {
  if (pValue <= 0.01) {
    return {
      level: "high",
      confident: true,
      description: "99% confident - Highly significant result",
    };
  }
  if (pValue <= 0.05) {
    return {
      level: "medium",
      confident: true,
      description: "95% confident - Statistically significant",
    };
  }
  if (pValue <= 0.1) {
    return {
      level: "low",
      confident: false,
      description: "90% confident - Marginally significant",
    };
  }
  return {
    level: "none",
    confident: false,
    description: "Not statistically significant yet",
  };
}

/**
 * Calculate confidence interval for conversion rate
 */
export function calculateConfidenceInterval(
  conversions: number,
  samples: number,
  confidenceLevel: number = 0.95
): { lower: number; upper: number; rate: number } {
  if (samples === 0) return { lower: 0, upper: 0, rate: 0 };

  const rate = conversions / samples;

  // Z-scores for common confidence levels
  const zScores: Record<number, number> = {
    0.9: 1.645,
    0.95: 1.96,
    0.99: 2.576,
  };
  const z = zScores[confidenceLevel] || 1.96;

  // Wilson score interval (more accurate for small samples)
  const denominator = 1 + z * z / samples;
  const center = (rate + z * z / (2 * samples)) / denominator;
  const margin = (z / denominator) * Math.sqrt(rate * (1 - rate) / samples + z * z / (4 * samples * samples));

  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
    rate,
  };
}

/**
 * Calculate relative lift between variants
 */
export function calculateLift(
  controlRate: number,
  treatmentRate: number
): { lift: number; liftPercent: number; direction: "positive" | "negative" | "neutral" } {
  if (controlRate === 0) {
    return {
      lift: treatmentRate > 0 ? Infinity : 0,
      liftPercent: treatmentRate > 0 ? 100 : 0,
      direction: treatmentRate > 0 ? "positive" : "neutral",
    };
  }

  const lift = (treatmentRate - controlRate) / controlRate;
  const liftPercent = Math.round(lift * 10000) / 100;

  return {
    lift,
    liftPercent,
    direction: lift > 0.01 ? "positive" : lift < -0.01 ? "negative" : "neutral",
  };
}

/**
 * Calculate required sample size for desired statistical power
 */
export function calculateRequiredSampleSize(
  baselineRate: number,
  minimumDetectableEffect: number,
  alpha: number = 0.05,
  power: number = 0.8
): number {
  // Z-scores
  const zAlpha = alpha === 0.05 ? 1.96 : alpha === 0.01 ? 2.576 : 1.645;
  const zBeta = power === 0.8 ? 0.84 : power === 0.9 ? 1.28 : 0.52;

  const p1 = baselineRate;
  const p2 = baselineRate * (1 + minimumDetectableEffect);
  const pPooled = (p1 + p2) / 2;

  const numerator = 2 * pPooled * (1 - pPooled) * Math.pow(zAlpha + zBeta, 2);
  const denominator = Math.pow(p1 - p2, 2);

  return Math.ceil(numerator / denominator);
}

/**
 * Calculate experiment results with all metrics
 */
export function calculateExperimentResults(
  controlConversions: number,
  controlSamples: number,
  treatmentConversions: number,
  treatmentSamples: number
): {
  control: {
    conversions: number;
    samples: number;
    rate: number;
    confidenceInterval: { lower: number; upper: number };
  };
  treatment: {
    conversions: number;
    samples: number;
    rate: number;
    confidenceInterval: { lower: number; upper: number };
  };
  zScore: number;
  pValue: number;
  significance: {
    level: "high" | "medium" | "low" | "none";
    confident: boolean;
    description: string;
  };
  lift: {
    lift: number;
    liftPercent: number;
    direction: "positive" | "negative" | "neutral";
  };
  winner: "control" | "treatment" | "inconclusive";
} {
  const controlCI = calculateConfidenceInterval(controlConversions, controlSamples);
  const treatmentCI = calculateConfidenceInterval(treatmentConversions, treatmentSamples);

  const zScore = calculateZScore(
    controlConversions,
    controlSamples,
    treatmentConversions,
    treatmentSamples
  );
  const pValue = calculatePValue(zScore);
  const significance = getSignificanceLevel(pValue);
  const lift = calculateLift(controlCI.rate, treatmentCI.rate);

  let winner: "control" | "treatment" | "inconclusive" = "inconclusive";
  if (significance.confident) {
    winner = treatmentCI.rate > controlCI.rate ? "treatment" : "control";
  }

  return {
    control: {
      conversions: controlConversions,
      samples: controlSamples,
      rate: controlCI.rate,
      confidenceInterval: { lower: controlCI.lower, upper: controlCI.upper },
    },
    treatment: {
      conversions: treatmentConversions,
      samples: treatmentSamples,
      rate: treatmentCI.rate,
      confidenceInterval: { lower: treatmentCI.lower, upper: treatmentCI.upper },
    },
    zScore: Math.round(zScore * 1000) / 1000,
    pValue: Math.round(pValue * 10000) / 10000,
    significance,
    lift,
    winner,
  };
}
