# Documentation Metadata Standards

This document outlines the standard metadata that should be included in all Markdown-based documentation files within the Anansi project. Implementing this metadata ensures consistency, clarity, and discoverability for both internal teams and external users.

## 1. Purpose of Metadata

Metadata provides essential context about each documentation file, enabling:
*   **Audience Targeting:** Clearly identifying who the document is for.
*   **Edition Specificity:** Indicating which product editions (OSS, Self-Host, Cloud, Enterprise) the content applies to.
*   **Content Freshness:** Tracking when the document was last verified and against which code revision.
*   **Accountability:** Identifying the owner responsible for the content's accuracy.
*   **Related Resources:** Linking to internal runbooks or other relevant materials.
*   **Automated Processing:** Future documentation tooling can use this metadata for filtering, display, and validation.

## 2. Metadata Format (YAML Front Matter)

All documentation Markdown files should start with a YAML front matter block, enclosed by triple-dashed lines (`---`).

```yaml
---
title: Your Document Title
description: A concise summary of the document's content.
audience: [developer, operator, evaluator, contributor, admin, security] # Choose one or more from the list below
edition: [oss, self-host, cloud, enterprise] # Choose one or more from the list below
last_verified: YYYY-MM-DD # Date of last verification
verified_commit: "short-sha" # Short commit SHA when last verified
owner: "Team Name" # E.g., "API Team", "Developer Experience Lead"
related_runbook: "path/to/internal/runbook.md" # Optional: path relative to repo root
---
```

## 3. Metadata Fields Explained

*   **`title` (Required):** The primary title of the document. This will often be rendered as the main heading on the page.
*   **`description` (Required):** A brief, one-sentence summary of what the document covers. This is used for search results, tooltips, and overview pages.
*   **`audience` (Required):** A list of one or more target audiences for this document. Use lowercase.
    *   `developer`: For engineers building on or extending Anansi.
    *   `operator`: For individuals managing Anansi deployments (e.g., self-host, cloud ops).
    *   `evaluator`: For those assessing Anansi's capabilities, architecture, or product fit.
    *   `contributor`: For individuals contributing to the Anansi codebase or documentation.
    *   `admin`: For users managing an Anansi organization or workspace.
    *   `security`: For security professionals reviewing Anansi's security posture.
*   **`edition` (Required):** A list of one or more Anansi product editions to which this document applies. Use lowercase.
    *   `oss`: Community Open Source.
    *   `self-host`: Supported self-hosted deployments.
    *   `cloud`: Managed cloud service.
    *   `enterprise`: Enterprise-grade deployments.
*   **`last_verified` (Required):** The date (YYYY-MM-DD) when the content was last reviewed and confirmed to be accurate. This should be updated during the review cadence.
*   **`verified_commit` (Required):** The short Git commit SHA (e.g., `94c039f`) of the repository state against which the document was last verified.
*   **`owner` (Required):** The team or lead responsible for the content, as defined in the [Documentation Ownership and Review Cadence Proposal](DOCUMENTATION_OWNERSHIP_AND_REVIEW_PROPOSAL.md).
*   **`related_runbook` (Optional):** A relative path from the repository root to an internal runbook or related document that provides additional context for owners or support personnel. This field is primarily for internal use.

## 4. Example

Here's an example of how metadata would look for `docs/developer/quickstart.md`:

```yaml
---
title: Developer Quickstart
description: Get Anansi running locally in minutes with Docker Compose.
audience: [developer, contributor]
edition: [oss, self-host, cloud, enterprise]
last_verified: 2026-07-28
verified_commit: "abc123d"
owner: "Developer Experience Lead"
related_runbook: "docs/enterprise/troubleshooting.md"
---

# Developer Quickstart

Welcome to the Anansi developer quickstart guide...
```

By adhering to these metadata standards, we can significantly improve the quality, discoverability, and maintainability of our documentation.