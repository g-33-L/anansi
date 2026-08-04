# ADR-0009: Supply Chain and Build Integrity

**Date:** 2026-08-03
**Status:** Accepted
**Phase:** 10.1

## Context

CI already runs a high-severity `pnpm audit`. Phase 10 needs traceable, protected release artifacts and a defensible policy for advisories that don't apply, without turning every transitive CVE into a hard release blocker.

## Decision

- **Audit is one signal with a documented exception process.** `pnpm audit --audit-level high` stays a required gate. Non-applicable advisories are excepted in `pnpm-workspace.yaml → auditConfig.ignoreGhsas`, each with an inline rationale comment and a revisit trigger. First exception: `GHSA-qwww-vcr4-c8h2` (react-router RSC-mode CSRF) — apps are client-side Vite SPAs, not RSC, and `react-router-dom@7` has no patched line (fix is `react-router@8.3.0`); revisit on the react-router v8 migration.
- **Vulnerable transitive deps are pinned to their in-line fixed version via `overrides`**, not blindly jumped to a new major. Lesson learned: overriding `brace-expansion` to the ESM-only `5.0.8` silently broke `@vitest/coverage-v8`'s CJS `.default` import (crashing coverage in CI); the correct fix pins the ReDoS patch to `1.1.12` / `2.0.2` within each major line. Prefer the smallest compatible patched version.
- **SBOM + provenance on every CI run** (non-blocking initially): a CycloneDX SBOM (`anchore/sbom-action`) and a `provenance.json` (commit, ref, run id/attempt, actor, timestamp) are uploaded as artifacts, so a build can be traced to source + dependency digest. Promote to a required gate once stable.
- **Pin CI actions by reviewed major tag** today (`@v4`), moving to digest pinning under the same review policy as the registry/attestation story lands (10.1 step 3).

## Consequences

- A red audit is actionable: fix, override to a patched in-line version, or add a rationale'd exception. No silent ignores.
- Overrides that change a dependency's module system (CJS↔ESM) are now understood as a break risk for bundled consumers; test the coverage/build path after any override change.
- Full artifact signing/attestation and container scanning remain **deferred** to when the managed registry is chosen (10.1) — this ADR covers the in-repo foundation only.
