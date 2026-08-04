---
title: Governance and Redaction
description: A guide for enterprise administrators on how to configure redaction rules, manage governance approvals, and install software licenses.
audience: [admin, security, operator]
edition: [enterprise]
last_verified: 2026-08-01
verified_commit: "94c039fc"
owner: "Enterprise Team"
related_runbook: ""
---

# Governance and Redaction

This guide covers Anansi's enterprise-grade governance features, including content redaction, approval workflows, and software license management. These features provide administrators with fine-grained control over their organization's data and operations.

## Redaction Rules

Redaction rules allow you to define a set of patterns to automatically redact sensitive information from content. This is a powerful tool for compliance and data privacy.

**Note:** The redaction rule engine is not yet automatically applied to the live ingestion path. This is a planned feature.

### How Redaction Works

You can define rules that match specific patterns (using regular expressions) and specify an action to take when a match is found. The rule engine supports the following actions:

*   **Action `mask`**: Replaces the matched content with a placeholder (e.g., `[REDACTED]`).
*   **Action `drop`**: Discards any content that matches the rule.
*   **Action `hash`**: Replaces the matched content with a consistent hash.

### Managing Redaction Rules

Redaction rules are managed via the Anansi API.

*(Note: The UI for this feature may be a scaffold in the current version of the `apps/web` customer application.)*

*   **List Rules:** `GET /console/enterprise/redaction-rules`
*   **Create a Rule:** `POST /console/enterprise/redaction-rules` with a body like:
    ```json
    {
      "pattern": "\\b\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}\\b",
      "action": "mask"
    }
    ```
*   **Delete a Rule:** `DELETE /console/enterprise/redaction-rules/:id`

## Governance Approvals

Certain actions within Anansi can be subjected to a governance approval workflow, requiring another user to approve or deny the action before it takes effect. This is useful for managing changes to critical procedures or skills.

### Approval Workflow

1.  **Request:** A user initiates an action that requires approval. This creates a new approval request in a "pending" state.
2.  **Review:** A designated approver (or any user with `governance:decide` permission) reviews the request.
3.  **Decision:** The approver can either `approve` or `deny` the request.
4.  **Execution:** If approved, the action is executed. If denied, the action is cancelled.

### Managing Approvals

Approvals are managed via the Anansi API.

*(Note: The UI for this feature may be a scaffold in the current version of the `apps/web` customer application.)*

*   **List Pending Approvals:** `GET /console/enterprise/approvals`
*   **Decide on an Approval:** `POST /console/enterprise/approvals/:id/decision` with a body like:
    ```json
    {
      "decision": "approve",
      "reason": "This change is validated and follows our guidelines."
    }
    ```

## License Management

For self-hosted enterprise deployments, a software license is required to unlock enterprise features.

### Viewing Your License

You can view your current license details via the API.

*   **View License:** `GET /console/enterprise/license`
    This will return your current plan (`edition`), and details about your license including the number of seats and the expiration date.

### Installing a License

You will receive a signed license token from Anansi support. This token must be installed to activate your enterprise features.

*   **Install License:** `PUT /console/enterprise/license` with a body like:
    ```json
    {
      "token": "your_signed_license_token_here"
    }
    ```

The API will verify the signature, expiration, and organization details of the license. If valid, it will be stored in the database, and your organization's plan will be updated to the licensed edition. An invalid or expired token will be rejected.
