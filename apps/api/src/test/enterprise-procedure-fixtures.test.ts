import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateProcedureOracle, type ProcedureOracle, type ProcedureSource } from '../lib/ai/procedure-eval.js';

const fixtureRoot = fileURLToPath(new URL('../../scripts/eval/fixtures/enterprise_procedures/', import.meta.url));
const json = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;
type FixtureManifest = { schemaVersion: number; domains: Array<{ id: string; split: 'calibration' | 'holdout'; archetypes: string[] }> };

describe('enterprise procedure fixtures', () => {
  const domains = readdirSync(fixtureRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
  it('contains the five approved high-signal seed domains', () => {
    const sorted = domains.sort();
    for (const seed of ['capex_over_1m', 'deal_desk_nonstandard_terms', 'ediscovery_legal_hold', 'emergency_termination', 'product_recall']) {
      expect(sorted).toContain(seed);
    }
  });
  const oracleFor = (domain: string) => {
    const material = json<{ docs: Array<{ last_edited?: string; blocks: Array<{ id: string; text: string }> }>; messages: Array<{ id: string; text: string; ts?: string }> }>(`${fixtureRoot}${domain}/source_material.json`);
    const sources: ProcedureSource[] = [
      ...material.docs.flatMap(doc => doc.blocks.map(block => ({ id: block.id, text: block.text, source: 'document' as const, recordedAt: doc.last_edited }))),
      ...material.messages.map(message => ({ id: message.id, text: message.text, source: 'slack' as const, recordedAt: message.ts })),
    ];
    return { oracle: json<ProcedureOracle>(`${fixtureRoot}${domain}/oracle_procedure.json`), sources };
  };

  it('has a versioned manifest with unique, typed split metadata', () => {
    const manifest = json<FixtureManifest>(`${fixtureRoot}fixture_manifest.json`);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.domains.map(domain => domain.id).sort()).toEqual([...domains].sort());
    expect(new Set(manifest.domains.map(domain => domain.id)).size).toBe(domains.length);
    expect(manifest.domains.every(domain => ['calibration', 'holdout'].includes(domain.split))).toBe(true);
    expect(manifest.domains.every(domain => domain.archetypes.length > 0 && domain.archetypes.every(archetype => archetype.length > 0))).toBe(true);
  });

  for (const domain of domains) it(`${domain} has verbatim evidence, graph labels, and anti-targets`, () => {
    const { oracle, sources } = oracleFor(domain);
    expect(validateProcedureOracle(oracle, sources)).toEqual([]);
    expect(oracle.refusalTraps.length).toBeGreaterThan(0);
    expect(oracle.procedure.steps.some(step => step.dependsOn?.length)).toBe(true);
    expect(oracle.procedure.steps.some(step => step.conditions?.length)).toBe(true);
    expect(oracle.divergences.length).toBeGreaterThan(0);
  });

  // Every published projection metric must have real targets somewhere in the
  // corpus; otherwise the metric would only ever report N/A or (previously) a
  // vacuous 1.0. These guard the enrichment.
  const oracles = domains.map(oracleFor).map(entry => entry.oracle);
  const parallelPairsIn = (o: ProcedureOracle) => {
    const groups = new Map<string, number>();
    for (const step of o.procedure.steps) if (step.parallel?.semantics === 'unordered') groups.set(step.parallel.group, (groups.get(step.parallel.group) ?? 0) + 1);
    return [...groups.values()].some(size => size >= 2);
  };
  it('corpus exercises a genuine 2+ step parallel group', () => {
    expect(oracles.some(parallelPairsIn)).toBe(true);
  });
  it('corpus exercises real precondition gates', () => {
    expect(oracles.some(o => o.procedure.steps.some(step => step.preconditions?.length))).toBe(true);
  });
  it('corpus exercises real deadlines', () => {
    expect(oracles.some(o => o.procedure.steps.some(step => step.deadline))).toBe(true);
  });
});
