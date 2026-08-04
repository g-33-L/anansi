---
title: Versioning, Changelog, and Deprecation Policy
description: An overview of how Anansi versions its software and documentation, manages changelogs, and handles deprecations.
audience: [developer, operator, evaluator, admin, security]
edition: [oss, self-host, cloud, enterprise]
last_verified: 2026-08-01
verified_commit: "94c039fc"
owner: "Product Team"
related_runbook: ""
---

# Versioning, Changelog, and Deprecation Policy

This document outlines Anansi's policies for versioning, managing changes, and handling deprecations. Our goal is to provide a predictable and stable experience for our users and contributors.

## Versioning Strategy

Anansi uses semantic versioning (`MAJOR.MINOR.PATCH`).

*   **`MAJOR`** version changes indicate incompatible API changes.
*   **`MINOR`** version changes add functionality in a backward-compatible manner.
*   **`PATCH`** version changes are for backward-compatible bug fixes.

### API Versioning

The Anansi REST API is versioned via its URL prefix (e.g., `/v1`).

*   All endpoints within a major version (e.g., `/v1`) are guaranteed to be backward-compatible.
*   Breaking changes will only be introduced in a new major version (e.g., `/v2`).
*   When a new major API version is released, the previous version will be supported for a minimum deprecation period (see "Deprecation Policy" below).

### Documentation Versioning

The Anansi documentation is versioned in lockstep with the Anansi software.

*   The documentation site (powered by Docusaurus) will use its versioning feature to create a snapshot of the documentation for each major and minor release.
*   A version switcher in the documentation site will allow users to view the documentation corresponding to the version of Anansi they are using.
*   The `main` branch of the documentation will always reflect the upcoming release.

## Redirects for Moved Content

To prevent broken links, we are committed to creating redirects for any content that is moved or renamed.

*   When a documentation page's URL changes, a redirect will be created from the old URL to the new one.
*   Our documentation platform (Docusaurus) provides plugins for managing these redirects, which will be maintained in a central configuration file.

## Changelog and Release Notes

We maintain both a developer-focused changelog and user-friendly release notes.

*   **`CHANGELOG.md`:** The `CHANGELOG.md` file in the root of the repository provides a detailed, chronological list of all changes, intended for contributors and developers who need to understand the technical evolution of the codebase.
*   **Release Notes:** For each new software version, a set of user-friendly release notes will be published on our documentation site (e.g., under a `docs/releases/` directory). These notes will summarize the key features, improvements, and any breaking changes in a clear and concise format.

## Deprecation Policy

When it becomes necessary to deprecate a feature or API, we will follow a clear and predictable process.

*   **Announcement:** Deprecations will be announced in the release notes and the relevant documentation will be updated to mark the feature as deprecated.
*   **Deprecation Period:**
    *   For **major API versions**, the deprecated version (e.g., `/v1`) will continue to be supported for a minimum of **90 days** after the new version (e.g., `/v2`) is released.
    *   For **features within a stable API version**, they will be marked as deprecated and will continue to function for at least one `MINOR` release cycle before being removed.
*   **Removal:** After the deprecation period has ended, the deprecated API or feature will be removed.

This policy ensures that our users have ample time to migrate their applications and workflows to the latest versions.
