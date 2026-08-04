// Deterministic statistics helpers for the model benchmark.
//
// The statistical unit is the evaluation DOMAIN, not a repeated temperature=0
// run. At temperature 0 repeated runs are near-identical, so their spread badly
// understates real uncertainty; the uncertainty that matters for "is model A
// better than model B" is how much a score varies across the KINDS of procedures
// we test. These helpers therefore summarise across domains with Student's t
// (small n) and compare two models with a PAIRED t-test on per-domain deltas,
// which controls for domain difficulty.

// Two-sided 95% Student-t critical values (0.975 quantile) by degrees of freedom.
// df 1..30 tabulated; beyond that the normal approximation (1.96) is used.
const T_CRITICAL_95: Record<number, number> = {
  1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306,
  9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145, 15: 2.131,
  16: 2.12, 17: 2.11, 18: 2.101, 19: 2.093, 20: 2.086, 21: 2.08, 22: 2.074,
  23: 2.069, 24: 2.064, 25: 2.06, 26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
};

export function tCritical95(df: number): number {
  if (df <= 0) return NaN;
  return T_CRITICAL_95[df] ?? 1.96;
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
}

// Sample (n-1) standard deviation; 0 for fewer than two observations.
export function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

export interface Summary {
  mean: number;
  sd: number;
  se: number;
  n: number;
  df: number;
  ciLow: number;
  ciHigh: number;
}

// Mean with a two-sided 95% confidence interval over the sample (t-distribution).
export function summarize(values: number[]): Summary {
  const n = values.length;
  const m = mean(values);
  const sd = sampleStd(values);
  const se = n > 0 ? sd / Math.sqrt(n) : 0;
  const df = Math.max(n - 1, 0);
  // se===0 (single observation or zero variance) => degenerate zero-width interval,
  // avoiding NaN from the undefined df=0 critical value.
  const half = se > 0 ? tCritical95(df) * se : 0;
  return { mean: m, sd, se, n, df, ciLow: m - half, ciHigh: m + half };
}

export interface PairedComparison {
  meanDiff: number;
  se: number;
  t: number;
  df: number;
  p: number;
  ciLow: number;
  ciHigh: number;
  significant: boolean;
  n: number;
}

// Paired two-sided t-test on per-domain differences a[i] - b[i]. Requires equal,
// aligned samples (same domains for both models).
export function pairedComparison(a: number[], b: number[]): PairedComparison {
  if (a.length !== b.length) throw new Error('Paired comparison requires equal-length, domain-aligned samples.');
  const diffs = a.map((value, index) => value - b[index]);
  const n = diffs.length;
  const m = mean(diffs);
  const sd = sampleStd(diffs);
  const se = n > 0 ? sd / Math.sqrt(n) : 0;
  const df = Math.max(n - 1, 0);
  const t = se > 0 ? m / se : 0;
  const p = se > 0 ? studentTTwoSidedP(Math.abs(t), df) : m === 0 ? 1 : 0;
  const half = se > 0 ? tCritical95(df) * se : 0;
  return { meanDiff: m, se, t, df, p, ciLow: m - half, ciHigh: m + half, significant: se > 0 && p < 0.05, n };
}

// P(|T| > t) for T ~ Student-t(df), via the regularized incomplete beta function.
// Numerical Recipes: for T ~ t_df, the two-sided tail is I_{df/(df+t^2)}(df/2, 1/2).
export function studentTTwoSidedP(t: number, df: number): number {
  if (!(df > 0)) return NaN;
  if (t === 0) return 1;
  return betai(df / 2, 0.5, df / (df + t * t));
}

function gammaln(x: number): number {
  const cof = [76.18009172947146, -86.50532032941678, 24.01409824083091, -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.5066282746310007 * ser) / x);
}

// Regularized incomplete beta I_x(a,b).
function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
