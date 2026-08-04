# Anansi Extraction Benchmark

> Evidence for the claim: *Anansi turns an organization's real communication exhaust
> into a trustworthy, queryable ledger of how it actually operates — including where
> the documentation has gone stale.* This document reports measured results, names the
> weaknesses, and is fully reproducible.

**Runs of record:** branch `extraction-quality` (with deterministic stated-date recovery), single pass per domain. Two models evaluated on the identical dataset: **cerebras / gpt-oss-120b** (cloud ceiling) and **ollama / llama3.1:8b** (self-hosted privacy baseline). The model is non-deterministic; treat point values as indicative (±one claim / ±one domain run-to-run), and re-run to reproduce.

## Dataset

Five enterprise domains — **incidents, customer_escalation, product_decisions, security_compliance, onboarding** — built as realistic Slack exhaust + (deliberately stale) Notion docs, with a hand-labeled oracle:

- **46** Slack messages + Notion blocks
- **30** gold attestations (how the company actually operates)
- **15** intentional chatter items that must be refused (opinions, un-adopted proposals, jokes)
- **5** planted doc-vs-reality divergences (one per domain: the doc says X, practice changed to Y on a stated date)

Every oracle quote is a verified verbatim substring of its source (guarded by 28 deterministic tests that fail loudly if the dataset breaks).

## Methodology

Each domain runs the **same pipeline used in production**: chunks are seeded into Postgres → extracted by the model into cited attestations → each quote is **verified as a verbatim substring** of its source chunk → ingested append-only → divergence detection runs over the resulting ledger. Attestations are matched to the oracle by **semantic claim-text overlap** (not exact identifiers), because a real model invents its own wording — exact matching reports a false 0% on correct output. Reproduce with `pnpm --filter @anansi/api eval:extraction`.

## Results — Anansi (aggregate over 5 domains)

| Metric | Result |
|---|---|
| Precision | **~85%** |
| Recall | **~97–100%** |
| F1 | **~91%** |
| Evidence integrity | **100%** (0 unverifiable citations) |
| Refusal recall | **100%** — 0 of 15 chatter items leaked in |
| Divergence detection | **5 / 5** domains |
| Changed-date accuracy | **5 / 5** — the system dates every drift |
| Latency | avg **~2s**, p50 ~1.8s per domain |

Recall is ~100% (no operational fact missed). Precision of ~85% reflects mild over-extraction (a few extra, still-grounded attestations beyond the oracle), not fabrication — evidence integrity is 100%.

## The comparison that matters: Anansi vs "trust the docs"

The real-world alternative to Anansi is *read the wiki / runbook* — which is what documentation search and RAG-over-docs return. Scored deterministically over the same dataset (`pnpm --filter @anansi/api eval:baseline`, no model, no embeddings):

| Capability | Docs / RAG-over-docs | Anansi — local 8B | **Anansi — cloud** |
|---|---|---|---|
| Coverage of how the company actually operates | **33%** (10/30 written down) | 83% | **~100%** |
| Detects that a doc has gone stale (drift) | **0 / 5** (no temporal model) | 3 / 5 (+2 false) | **5 / 5** |
| Correct on current policy where practice changed | **0 / 5** (returns the stale doc) | 3 / 5 | **5 / 5** |

This is a fair baseline, not a strawman: two-thirds of how a company operates lives in conversation, never in the wiki; and even the documented third is *wrong wherever practice has moved on*. A more sophisticated RAG could retrieve the Slack messages too — but it has no way to know which answer is current or that the doc is stale. Anansi's bitemporal ledger resolves this deterministically and dates the change. Even the weaker self-hosted model beats documentation on every axis.

## Self-hosted (air-gapped) vs cloud ceiling

Anansi runs fully local (`DEPLOYMENT_MODE=local`, no data leaves the box, enforced at startup). We ran the identical evaluation on `llama3.1:8b` — the default local model — to measure the privacy-vs-quality tradeoff honestly:

| Metric | Local — llama3.1:8b | Cloud — gpt-oss-120b |
|---|---|---|
| Precision | 66% | ~85% |
| Recall | 83% | ~100% |
| F1 | 74% | ~91% |
| Evidence integrity | 97% | 100% |
| Refusal recall | 87% (2 leaks) | 100% (0 leaks) |
| Divergence detection | 3 / 5 (+2 false alerts) | 5 / 5 (0 false) |
| Changed-date accuracy | 1 / 3 | 5 / 5 |
| Latency | ~43s / domain | ~2s / domain |

**Honest finding:** an 8B local model is materially weaker across every axis — it misses 2 of 5 drifts, raises 2 false ones, leaks 2 chatter items, and is ~20× slower. The axis that *holds* is **evidence integrity (97%)**: even a weak model doesn't fabricate citations, because the *system* verifies every quote against the source regardless of model. So the architecture is sound; the small model is the limiter. The honest self-hosting recommendation is a **larger local model** (a 70B, or a strong ~30B like Qwen) — the privacy guarantee is real and enforced, but matching cloud quality needs more local compute than 8B.

## Strengths (evidence-backed)

- **Grounded, not hallucinated:** 100% evidence integrity (cloud), 97% (local 8B) — extracted claims carry verbatim source quotes, and unverifiable ones are refused, not stored, *regardless of model*.
- **Trustworthy refusal:** 100% of non-operational chatter excluded (0 false acceptances across 15 items).
- **The moat works:** doc-vs-reality divergence detected in 5/5 domains, **and dated in 5/5** ("your runbook says X; the team moved to Y in April") — a capability documentation search structurally cannot provide.
- **Timekeeping is the system's job, not the model's:** the model omits the stated change date ~80% of the time, so the system recovers it deterministically from the verified source text — lifting changed-date accuracy from 1/5 to 5/5 with no reliance on model consistency.

## Weaknesses (named, not hidden)

- **Mild over-extraction** (cloud precision ~85%): a few extra, still-grounded attestations beyond the labeled set. No fabrication (evidence integrity 100%) and no missed facts (recall ~100%).
- **Non-determinism:** single passes; the model varies ±one claim/domain run-to-run. Re-run to reproduce.
- **Local quality gap:** the self-hosted 8B baseline (above) is materially weaker than the cloud ceiling on every axis except evidence integrity; a larger local model is needed to close it.

## Reproduce

```bash
cd apps/api
# set DEPLOYMENT_MODE + a provider key in .env (gitignored)
pnpm eval:extraction   # Anansi: terminal summary + results/*-extraction-eval.{json,md}
pnpm eval:baseline     # docs baseline + head-to-head vs the latest Anansi run
```

Each run writes a timestamped JSON (git sha, branch, model, config, aggregate, per-domain, raw attestations, failures) designed so future evaluators — a naive-RAG baseline, other models — emit the same `{ evaluator, model, metrics }` shape for apples-to-apples comparison and quality-over-time dashboards.
