---
title: Documentation CI Pipeline
description: A proposal for a CI/CD pipeline to automatically check and validate documentation quality.
audience: [developer, contributor, operator]
edition: [oss, self-host, cloud, enterprise]
last_verified: 2026-08-01
verified_commit: "94c039fc"
owner: "DevOps Team"
related_runbook: ""
---

# Documentation CI Pipeline

This document outlines a proposed CI/CD pipeline for the Anansi documentation. The goal of this pipeline is to automate quality checks, ensuring that our documentation is always correct, consistent, and up-to-date.

This pipeline should be triggered on every pull request that modifies files in the `docs/`, `examples/`, or other key documentation directories.

## 1. Link Checking

*   **Purpose:** To find broken internal and external links in our documentation.
*   **Proposed Tool:** [`lychee-link-checker`](https://github.com/lycheeverse/lychee)
*   **Configuration:**
    *   The CI job should run `lychee` against all Markdown files in the repository.
    *   It should be configured to check both HTTP(S) links and relative file path links.
    *   A configuration file (`lychee.toml`) should be used to define accepted status codes (e.g., `200`, `204`) and to exclude certain links that may be problematic to check automatically.

    **Example CI Step:**
    ```yaml
    - name: Check for broken links
      run: lychee --config ./lychee.toml '**/*.md'
    ```

## 2. Markdown Style Linting

*   **Purpose:** To enforce a consistent style and formatting for all Markdown files.
*   **Proposed Tool:** [`markdownlint-cli`](https://github.com/igorshubovych/markdownlint-cli)
*   **Configuration:**
    *   A `.markdownlint.json` configuration file should be created in the root of the repository to define the style rules.
    *   Rules should enforce conventions such as heading style, list formatting, line length, and code block formatting.

    **Example CI Step:**
    ```yaml
    - name: Lint Markdown files
      run: markdownlint --config ./.markdownlint.json '**/*.md'
    ```

## 3. Code Snippet and Example Tests

*   **Purpose:** To ensure that code examples in the documentation are correct and will not break with future updates.
*   **Approach:**
    1.  **Smoke Tests for Examples:** The `examples/` directory should be treated as a set of smoke tests. The CI pipeline should `npm install` the dependencies for each example and attempt to run a basic, non-interactive version of the script to ensure it does not crash.
    2.  **Linting Code Blocks:** Tools like `eslint-plugin-markdown` can be configured to lint code blocks within Markdown files, catching syntax errors in our examples.

    **Example CI Step:**
    ```yaml
    - name: Test 'claude-chatbot' example
      run: |
        cd examples/claude-chatbot
        npm install
        # A test script could be added to run the example with a timeout
        # or check for successful startup.

    - name: Lint code snippets in Markdown
      run: eslint --ext .md .
    ```

## 4. API Drift Checks

*   **Purpose:** To automatically detect when the API implementation has drifted from its published specification.
*   **Prerequisite:** A machine-readable API specification (e.g., `openapi.json`), as proposed in `docs/api/SPECIFICATION.md`.
*   **Approach:**
    1.  The CI pipeline should generate the `openapi.json` file from the Hono API code.
    2.  A tool like [`optic`](https://www.useoptic.com/) or [`dredd`](https://dredd.org/) should be used to compare the generated specification against the behavior of a live, running instance of the API (e.g., started in the CI environment).
    3.  The job should fail if any breaking changes or discrepancies are detected.

## 5. Navigation Checks

*   **Purpose:** To ensure that all documentation pages are reachable and that there are no "orphan" documents.
*   **Approach (with Docusaurus):**
    *   The Docusaurus build process naturally handles this. When Docusaurus builds the site, it will fail if it encounters broken links in the sidebar navigation configuration (`sidebars.js`).
    *   The CI job should simply run the Docusaurus build command.

    **Example CI Step:**
    ```yaml
    - name: Build Docusaurus site
      run: |
        cd apps/docusaurus # Or wherever the docs site lives
        npm install
        npm run build # Fails on broken internal links
    ```

## 6. Preview Deployment

*   **Purpose:** To provide a live preview of documentation changes for every pull request, making the review process easier and more effective.
*   **Proposed Tool:** Vercel, Netlify, or GitHub Pages.
*   **Approach:**
    *   Configure the chosen platform to connect to the Anansi GitHub repository.
    *   The platform will automatically build and deploy the Docusaurus site for each pull request.
    *   A link to the preview deployment will be automatically posted as a comment on the pull request.

By implementing this comprehensive CI pipeline, we can maintain a high standard of quality for our documentation and provide a better experience for both our users and our contributors.
