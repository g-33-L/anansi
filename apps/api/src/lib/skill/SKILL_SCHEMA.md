# What Is a Skill?

A **Skill** is a structured, executable version of an enterprise policy or procedure.
Instead of a PDF or wiki page, a skill is a machine-readable checklist that an AI agent can
follow step-by-step — complete with ownership, timing rules, branching logic, and citations
back to the original source documents.

Anansi extracts skills automatically from your existing policy documents and publishes them
through a lightweight review workflow before they reach your agents.

---

## Top-Level Fields

### Identity

| Field | What It Means |
|---|---|
| `id` | A permanent unique identifier for this skill. It stays the same across every version — use it to reference the skill in integrations. |
| `version` | Which revision of this skill you are looking at (e.g. `1.0.0`). Small fixes bump the last number; added steps bump the middle; restructured procedures bump the first. |
| `status` | Where the skill is in its lifecycle: **draft** (just extracted), **review** (awaiting human sign-off), **published** (live and served to agents), or **archived** (retired). |

### Classification

| Field | What It Means |
|---|---|
| `domain` | A short code for the business area this skill covers (e.g. `emergency_termination`, `vendor_onboarding`). Used internally for routing and reporting. |
| `title` | The human-readable name shown in the UI (e.g. "Emergency Employee Termination"). |
| `description` | One or two sentences explaining what situation this skill handles and what it produces. |

### Procedure

| Field | What It Means |
|---|---|
| `steps` | The ordered list of actions that make up this procedure. See **Step Fields** below. |
| `graph` | Optional: cross-step relationships — entry gates that block multiple steps, and parallel groups where two or more steps may run at the same time. |

### Provenance

| Field | What It Means |
|---|---|
| `sourceDocumentIds` | The IDs of the policy documents this skill was extracted from. If a source document is updated, Anansi uses this list to know which skills need to be re-extracted. |
| `extractedAt` | The date and time Anansi first read the source documents and produced this skill. |

### Governance

| Field | What It Means |
|---|---|
| `publishedAt` | When a reviewer approved this version for production use. Empty until the skill passes review. |
| `reviewedBy` | The ID of the person who approved this skill. Empty until review is complete. |
| `confidenceScore` | A number from 0 to 1 indicating how confident Anansi is that the extraction is complete and accurate. Low-scoring skills are flagged for priority review. |

---

## Step Fields

Each entry in `steps` represents a single action in the procedure.

| Field | What It Means |
|---|---|
| `id` | A stable identifier for this step (e.g. `notify_hr`). The same ID is used in every version so you can compare two versions of a skill side-by-side. |
| `description` | One sentence describing the action. |
| `evidence` | The IDs of the source document chunks that prove this step exists. Every step must be supported by the source — Anansi never invents steps. |
| `precedes` | The IDs of steps that come after this one. Together, the `precedes` links on all steps define the procedure's flow graph. |
| `ownerRole` | The role responsible for this step, copied verbatim from the policy (e.g. "HR Business Partner", "IT Security"). |
| `preconditions` | Conditions that must be true before this step can begin (e.g. "board approval received", "employee badge deactivated"). These are entry gates, not branches. |
| `conditions` | Explicit if/unless branches: if a certain condition holds, follow these steps; otherwise, follow those steps. |
| `deadline` | How long this step must be completed in after a named event (e.g. "within 4 hours of termination notice"). |
| `parallel` | If present, this step may run at the same time as other steps in the same named group. |
| `temporalConstraints` | An optional expiry date after which the step's wording should be verified against updated policy. |

---

## Versioning and Diffing

Every time a skill is updated, a new version is created rather than overwriting the old one.
The version history table (`SkillVersion`) stores a lightweight summary of each version —
title, status, timestamps, and an optional plain-English description of what changed —
without duplicating the full step list.

Because each step carries a stable `id`, a diff between `v1.0.0` and `v1.1.0` can tell you
exactly which steps were added, removed, or changed — not just that something changed.

---

## Lifecycle

```
Extracted by worker
        │
        ▼
    [draft]  ──── auto-flagged for review if confidenceScore < threshold
        │
        ▼
    [review]  ──── human reviewer reads, edits if needed, approves
        │
        ▼
  [published]  ──── served to agents; immutable until next update cycle
        │
        ▼
  [archived]  ──── retired; not served; kept for audit trail
```
