---
title: API Specification (OpenAPI)
description: A note on the current status and future plans for a machine-readable API specification.
audience: [developer, contributor, operator]
edition: [oss, self-host, cloud, enterprise]
last_verified: 2026-08-01
verified_commit: "94c039fc"
owner: "API Team"
related_runbook: ""
---

# API Specification (OpenAPI)

**Status:** Planned

## Current State and Gap

Anansi's `/v1` API is currently documented in a human-readable format in the [API Reference](/docs/api/reference.md). However, there is no machine-readable API specification, such as one following the OpenAPI (formerly Swagger) standard.

This is a recognized gap in our documentation and developer experience.

## Benefits of an OpenAPI Specification

A machine-readable API specification serves as a contract for the API and enables a variety of powerful tools and workflows, including:

*   **Interactive API Documentation:** Tools like Swagger UI or Redoc can generate interactive API documentation where developers can explore endpoints and make live API calls directly from the browser.
*   **Automated Client Generation:** SDKs for various languages (including TypeScript and Python) can be auto-generated to ensure they are always in sync with the API, reducing manual effort and preventing drift.
*   **Contract Testing:** The specification can be used in CI/CD pipelines to automatically validate that the API implementation adheres to its contract, preventing accidental breaking changes.
*   **Mock Servers:** Mock API servers can be generated from the specification for frontend development and testing without needing a running backend.
*   **Postman/Insomnia Collections:** Easy import into API exploration tools.

## Proposed Path Forward

We recommend adopting the **OpenAPI 3.0** standard for describing the Anansi `/v1` API.

The Hono framework, used in `apps/api`, supports OpenAPI specification generation. Libraries such as `hono-openapi` can be used to generate the specification directly from the Hono route definitions, ensuring it is always up-to-date with the code.

**Proposed Action:**

1.  **Integrate `hono-openapi` (or a similar library) into `apps/api`:** Update the Hono route definitions in `apps/api/src/routes/v1.ts` to include OpenAPI metadata (descriptions, schemas, responses).
2.  **Generate `openapi.json`:** Configure the build process to generate a static `openapi.json` file.
3.  **Serve the Specification:** Make the generated `openapi.json` file accessible, for instance at a public URL like `/openapi.json`.
4.  **Adopt as Single Source of Truth:** Use the `openapi.json` file as the single source of truth for API documentation. The human-readable `reference.md` should be generated from this specification to ensure consistency.

By adopting this approach, we can significantly improve the quality, accuracy, and developer experience of the Anansi API. This is a key goal for future documentation and API lifecycle improvements.