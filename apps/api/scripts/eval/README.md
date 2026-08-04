# Synthesis quality eval (launch blocker B3)

## Enterprise procedure projection benchmark

`pnpm --filter @anansi/api eval:procedures` evaluates the current skill extractor
without changing its contract. Fixtures live in `fixtures/enterprise_procedures` and
use a typed oracle for graph dependencies, gates/branches, roles, normalized
deadlines, explicit parallelism, verbatim evidence quotes, refusal traps, and
documented-vs-observed divergence. The extractor can now emit optional typed roles,
gates, branches, deadlines, and parallel groups alongside step text, evidence IDs,
and `precedes`. Those fields are measured directly; legacy prose-only output uses a
projection fallback, with `structured*` coverage reporting how much was direct.

The procedure runner reads `fixtures/enterprise_procedures/fixture_manifest.json` and
records the selected calibration/holdout split, model/provider, retry configuration,
fixture hash, and dirty-worktree state. Each gitignored result also retains the parsed
procedure and refusal-trap outputs locally, so a score can be replayed and audited
without sending the fixture back to the provider. Use `EVAL_PROCEDURE_SPLIT=calibration`
or `EVAL_PROCEDURE_SPLIT=holdout` to run one declared split once holdout fixtures are
populated; never tune a model against the holdout set.

For rate-limited providers, `EVAL_PROCEDURE_DOMAINS=capex_over_1m` (or a
comma-separated list) runs and persists a narrow slice without changing the scorer.

Scores the **production** user-synthesis pipeline — real prompt
(`src/lib/ai/synthesis-prompt.ts`), real parser, real temporal merge, real
LLM provider chain — against a golden fixture set. No DB or Redis needed.

```bash
# Against the production provider (this is the launch gate):
CEREBRAS_API_KEY=csk-... pnpm --filter @anansi/api eval:synthesis

# Subset / different floor:
pnpm --filter @anansi/api eval:synthesis -- --only=temporal --floor=0.9
```

## Gate semantics

- A **case** passes when ≥80% of its assertions hold, the LLM output parsed,
  and **zero** `forbidden` strings appear (forbidden failures always fail the
  case — they cover prompt injection and secret leakage).
- The **suite** passes when ≥85% of cases pass (`--floor` to override).
- Exit code 1 on failure — wire this next to the cold-install smoke test in
  the release checklist. **Re-run after ANY change to the
  prompt text, the synthesis model, or the provider chain.**

## Categories covered

`static` extraction/merge · `dynamic` current-work bucketing · `temporal`
open/close + date anchoring + history preservation · `entities` +
multi-valued relationships · `conflict` reversals · `injection` fence
breakout + system-prompt leak · `safety` secret redaction · `robustness`
noise burial, multi-chunk aggregation, smalltalk carry-forward.

## Adding cases

Append to `fixtures/golden.json`. Matching: each expectation is a keyword
group (array of strings); a group matches when **one** output fact contains
**all** keywords, case-insensitive substring, `|` for alternatives. Keep
groups generous with alternatives — the eval measures substance, not phrasing.
Target ~50 cases before GA (currently 16); grow it with every real-world
extraction miss you encounter in beta.

`last-run.json` (gitignored) holds the full report of the most recent run.
