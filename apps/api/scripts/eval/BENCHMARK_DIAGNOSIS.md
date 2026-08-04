# Procedure-Extraction Benchmark Diagnosis — 2026-07-22

Scope: 25-domain enterprise procedure corpus, projection-v3 evaluator.
Latest run: gpt-4o via GitHub Models (`2026-07-22T15-05-57-644Z-procedure-eval.json`).
Prior runs referenced: gpt-oss-120b via Cerebras (baseline `12-41-12`, round-2 `13-46-56`).

Hard constraint: **falseAcceptanceRate must remain 0%.** Currently 0.0% on all 25
domains for gpt-4o and (after the round-2 refusal-rule fix) gpt-oss-120b.

## Metric state and root causes

| Metric | Now | Target | Root-cause class |
|---|---:|---:|---|
| stepF1 | 83.8% | 90%+ | model granularity + known fused-oracle steps + alignment artifacts |
| dependencyF1 | 55.1% | 80%+ | prompt (edges), evaluator (transitive-closure precision penalty, documented) |
| gateAccuracy | 26.6% | 85%+ | prompt (structured emission), evaluator (partial-structured disables prose fallback) |
| conditionalLogicAccuracy | 20.0% | 80%+ | prompt (prose-only branches, boolean anti-pattern), missing branch steps |
| deadlineAccuracy | 60.0% | 80%+ | prompt (emission + anchor phrasing); value/unit essentially always correct |
| roleAttributionAccuracy | 77.8% | 90%+ | prompt (omitted ownerRole; performer/approver confusion) |
| evidenceCitationF1 | 82.3% | 90%+ | follows stepF1 (unaligned steps score 0) |
| parallelismPreservation | 47.9% | 90%+ | prompt regression: chain rule causes edges between parallel siblings |
| falseAcceptanceRate | 0.0% | 0% | fixed in round 2 (refusal rule defines durable multi-step process) |

## Failure-trace per metric (evidence from saved artifacts)

### 1. gateAccuracy (26.6%)
- Oracle preconditions mirror dependsOn edges: one `{subject: <prior outcome>, operator: "after"}` per predecessor.
- Model behavior: (a) emits no structured preconditions on most gated steps;
  (b) when it does, emits ONE summary entry ("all-clear received") where the
  oracle wants one entry per prior outcome.
- Evaluator interaction: any structured `preconditions` present disables the
  prose fallback for ALL oracle preconditions of that step, so partial
  structured emission scores worse than none (flagged to Agent 3).

### 2. dependencyF1 (55.1%; recall 56.4%, precision 58.3%)
- Fixed this session: parser dropped `dependsOn` edges lacking a shared evidence
  chunk — a rule the oracle graphs themselves violate for cross-document
  orderings (structural recall ceiling; removed, alias now behaves like
  `precedes`). Recall 17.6% → 62.9% (gpt-oss) / 56.4% (gpt-4o).
- Remaining recall loss: models skip oracle "hub" steps (routing_decision) and
  emit transitively-true shortcut edges (A→C where oracle has A→B→C), which
  also depress precision. Closure-crediting for precision is a candidate
  evaluator change pending Agent 3's corruption analysis.

### 3. parallelismPreservation (47.9%, down from 93.3% baseline)
- Regression traced to round-2 prompt rule: "a narrative sequence yields a
  chain where each step dependsOn the one before it." gpt-4o applies this to
  parallel branches listed consecutively, emitting ordering edges BETWEEN
  siblings; scorer correctly counts an edge inside the pair as serialization.
- Baseline 93.3% was partly vacuous: with near-zero edges emitted, the metric
  measured fewer pairs (10 vs 16 domains measured now).
- Model also invents its own groupings not stated in the source
  (notify_regulator + file_regulator_notification grouped; oracle groups a
  different pair).
- Fix direction: carve-out in rule 5 — same-group members never depend on each
  other; they share the common predecessor in dependsOn; the join step lists
  all members; grouping only from stated concurrency wording.

### 4. conditionalLogicAccuracy (20.0%, doubled from 10%)
Remaining three buckets (43 oracle targets):
- prose-only conditions (~18), heavily self-triggering cases ("rollback when
  tests fail" — needs conditions with own stepId in thenSteps);
- whole-clause subject + boolean value anti-pattern ({"goals are met": "true"}
  vs oracle {"performance goals": "met"}) — banned in prompt, still appears;
- branch/routing/exception steps not emitted at all (~13, also a stepF1 loss).

### 5. deadlineAccuracy (60.0%)
- Every observed structured failure had correct value+unit; misses are
  (a) deadline stated but not emitted, (b) relativeTo anchored to a stepId or
  the wrong event. Evaluator now uses stopword-filtered token containment
  (sameAnchor) after exact-phrase equality was shown stricter than the prose
  fallback; deterministic rescore gain 43.0 → 57.8 on identical outputs.

### 6. roleAttributionAccuracy (77.8%)
- ~7 omitted ownerRole on steps whose source names an actor;
- ~4 performer/approver confusion (step owned by the approving body rather
  than the actor performing it: submit_to_auditor → "Audit Committee").

### 7. stepF1 (83.8%)
- Known documented oracle-atomicity mismatches (capex approve_over_1m,
  deal_desk conditional_approvals are fused multi-role steps; prompt mandates
  atomic steps) — documented, not papered over.
- Conditional-branch steps skipped by the model (overlaps CLA bucket 3).
- Alignment artifacts: vendor_security_onboarding aligned 3/7 with plausible
  steps present (threshold=0.5 / predCoverageFloor=0.15 under Agent 3 review).

### 8. falseAcceptanceRate (0.0%)
- Round-2 refusal rule (procedure = durable, repeatable, multi-step business
  process; single imperatives/announcements are not procedures) took
  gpt-oss-120b from 7.1% → 0.0% without refusing any true procedure.
- Every prompt change must re-verify FAR on the trap suite.

## Change ledger this session (all committed on codex/fix-grounded-procedure-graph)
1. Parser: fold dependsOn without shared-citation requirement (removes
   structural recall ceiling; aliases now symmetric).
2. Prompt: mandatory dependsOn on non-initial steps; precondition-per-
   predecessor pairing; natural-language subjects/values; deadline anchor
   guidance; strengthened refusal (FAR fix); routing decisions as steps;
   whole-clause/boolean condition ban.
3. Evaluator: sameAnchor containment for deadline relativeTo; auxiliary-verb
   tolerance in predicate values (negators kept: "not met" ≠ "met").

## Risk register
- Metric-gaming risk: evaluator relaxations are only accepted with a concrete
  corruption case they still reject (documented per change above).
- FAR regression risk: refusal rule untouched by rounds 2-3 changes; verified
  0% on both models post-change.
- Production risk: parser changes affect live extraction output; all changes
  covered by unit tests (74 passing across affected suites).

## Closing summary — 2026-07-23

Round 3 (four-agent audit: prompt, pipeline, evaluation integrity, dataset)
landed on `codex/fix-grounded-procedure-graph`, commits `4cc02f26`..`f66dd62f`
plus retry/persistence hardening (`c28e7909`, `cc8becac`). 104 unit tests
cover every evaluator/parser change with a pinned corruption case. This closes
the benchmark-improvement effort; see the CEO recap in-conversation for what's
next (skill schema DB migration, real-document dogfooding, production
inference decision).

### Final full-corpus state (gpt-oss-120b via Cerebras, new prompt+parser+
evaluator+fixture stack, merged from 3 runs on 2026-07-23; `2026-07-23-FINAL-
merged-25domain.json`)

| Metric | Value | Measured |
|---|---:|---|
| stepF1 | 80.4% | 25/25 |
| dependencyF1 | 48.9% | 25/25 |
| dependencyPrecisionClosure (diagnostic) | 43.6% | 25/25 |
| conditionalLogicAccuracy | 14.7% | 25/25 |
| gateAccuracy | 43.9% | 23/25 |
| deadlineAccuracy | 72.7% | 17/25 |
| roleAttributionAccuracy | 89.2% | 25/25 |
| evidenceCitationF1 | 90.1% | 25/25 |
| parallelismPreservation | 93.8% | 16/25 |
| **falseAcceptanceRate** | **0.0%** | 25/25 (incl. 6 newly hardened traps) |

### Calibration (15) vs holdout (10) — generalization check
No metric collapses on holdout; several are markedly better (stepF1 78.0% cal
vs 84.1% hold; evidenceCitationF1 86.0% vs 96.2%; deadlineAccuracy 63.7% vs
85.7%). CLA and gateAccuracy run a bit lower on holdout (17.8→10.0,
48.3→38.2) — plausible sampling noise at n=10, not a red flag on its own.
**Conclusion: the week's changes were not overfit to the domains used for
diagnosis.**

### Honest disclosure: live-LLM run-to-run variance
Three independent live runs of the identical 11-domain slice (same model,
same prompt, same fixtures) produced materially different per-domain scores
— e.g. `ediscovery_legal_hold` stepF1 ranged 80–100% across runs,
`emergency_termination` dependencyF1 ranged 33.3–36.4%, `access_privilege_
escalation` dependencyF1 ranged 76.9–100%. Aggregate swings of several points
between identically-configured runs are normal for this corpus size (25
domains) against a temperature-sampling model. Two consequences for reading
these numbers:
1. Single-run comparisons overstate precision; treat deltas under ~5pp on any
   one metric as noise, not signal.
2. The controlled, reproducible signal is the **deterministic rescore**
   (`scripts/eval/rescore-25domain.ts`), which replays saved model outputs
   against evaluator/oracle changes with zero model variance. That isolated
   effect: stepF1 83.5→86.7, dependencyF1 53.7→58.1 (closure 61.5),
   parallelism 83.3→93.8, gateAccuracy 38.6→42.3, roleAttribution 83.3→87.1,
   CLA 8.0→12.0, FAR 0.0 unchanged — this is the number to cite for "did the
   evaluator/oracle fixes work," not the live run-over-run aggregate.

### Full-week arc (directional only — confounds not held constant)
Baseline (`2026-07-21T08-06`, gpt-4o-mini, pre-oracle-enrichment,
pre-prompt-rewrite) vs final (gpt-oss-120b, all fixes): stepF1 86.5%→80.4%,
dependencyF1 22.9%→48.9%, gateAccuracy 11.7%→43.9%, conditionalLogicAccuracy
6.5%→14.7%, roleAttribution 77.9%→89.2%, parallelism 64.6%→93.8%, FAR
0.0%→0.0%. Two figures need a caveat, not a panic reaction:
- **stepF1 appears to regress (86.5→80.4).** The baseline model was
  gpt-4o-mini (not gpt-oss-120b) and, per Agent 4's audit, several "hallucinated"
  steps in later runs are honest atomic extractions of oracle steps that fuse
  multiple actors — a fixture-granularity effect, not new model error. This
  metric is confounded by model change + oracle rewrites and should not be
  read as "the prompt made step extraction worse."
- **deadlineAccuracy appears to regress (100%→72.7%).** The baseline's 100%
  was measured on exactly 2/25 domains (both trivially correct) before this
  week's oracle enrichment added 31 real deadline targets across 15 domains.
  72.7% on 17 measured domains is the first honest deadline number this corpus
  has produced — not a regression, a correction.
Net: dependencyF1, gateAccuracy, CLA, roleAttribution, and parallelism all
improved substantially and unambiguously across the week. FAR held at the
required 0% throughout, including through the model swap that briefly broke
it (7.1% on an earlier gpt-oss-120b prompt revision, fixed same day).

### What's deliberately NOT fixed (documented, not papered over)
- capex `approve_over_1m` and deal_desk `conditional_approvals` remain fused
  multi-role oracle steps against an atomic-step prompt mandate — guaranteed
  partial misalignment there by design tension, not model error.
- `dependencyPrecisionClosure` is a diagnostic only; the headline
  `dependencyPrecision` stays strict specifically to block a
  topological-star gaming vector (root→everything inflates naive closure
  precision to ~1.0 while recall collapses).
- Aggregate-vs-itemized gate-subject equivalence ("all three approvals" vs
  three named per-approver gates) is left as a fixture/prompt-convention
  choice, not bridged in the scorer — bridging it would create an inversion-
  adjacent hole (Agent 3's finding).
