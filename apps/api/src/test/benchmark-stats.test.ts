import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const statsUrl = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/eval/benchmark-stats.ts')).href;
const load = () => import(statsUrl);

describe('benchmark statistics', () => {
  it('studentTTwoSidedP matches known critical values (~0.05 at the 95% t-critical)', async () => {
    const { studentTTwoSidedP } = await load();
    // At the two-sided 0.975 critical value, the tail probability is ~0.05.
    expect(studentTTwoSidedP(2.776, 4)).toBeCloseTo(0.05, 2);
    expect(studentTTwoSidedP(2.306, 8)).toBeCloseTo(0.05, 2);
    expect(studentTTwoSidedP(0, 5)).toBe(1);
    expect(studentTTwoSidedP(100, 5)).toBeLessThan(1e-6);
  });

  it('summarize reports a t-based 95% confidence interval around the mean', async () => {
    const { summarize } = await load();
    const s = summarize([0.6, 0.7, 0.5, 0.8]); // mean 0.65, sd ~0.129, se ~0.0645, t(3)=3.182
    expect(s.mean).toBeCloseTo(0.65, 6);
    expect(s.n).toBe(4);
    expect(s.df).toBe(3);
    expect(s.ciHigh - s.mean).toBeCloseTo(3.182 * s.se, 3);
    expect(s.ciLow).toBeLessThan(s.mean);
    expect(s.ciHigh).toBeGreaterThan(s.mean);
  });

  it('summarize is degenerate (zero-width CI) for a single observation', async () => {
    const { summarize } = await load();
    const s = summarize([0.5]);
    expect(s.mean).toBe(0.5);
    expect(s.sd).toBe(0);
    expect(s.ciLow).toBe(0.5);
    expect(s.ciHigh).toBe(0.5);
  });

  it('pairedComparison flags a consistent per-domain gap as significant', async () => {
    const { pairedComparison } = await load();
    // Model A beats B by ~0.1 on every domain -> low variance -> significant.
    const test = pairedComparison([0.7, 0.8, 0.6, 0.75], [0.6, 0.7, 0.5, 0.65]);
    expect(test.n).toBe(4);
    expect(test.df).toBe(3);
    expect(test.meanDiff).toBeCloseTo(0.1, 6);
    expect(test.p).toBeLessThan(0.05);
    expect(test.significant).toBe(true);
    expect(test.ciLow).toBeGreaterThan(0);
  });

  it('pairedComparison does not flag a noisy, near-zero difference', async () => {
    const { pairedComparison } = await load();
    const test = pairedComparison([0.7, 0.4, 0.9, 0.5], [0.5, 0.6, 0.6, 0.7]);
    expect(test.p).toBeGreaterThan(0.05);
    expect(test.significant).toBe(false);
  });

  it('pairedComparison rejects misaligned samples', async () => {
    const { pairedComparison } = await load();
    expect(() => pairedComparison([0.5, 0.6], [0.5])).toThrow(/equal-length/);
  });
});
