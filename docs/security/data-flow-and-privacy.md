---
title: Data Flow and Privacy
description: An overview of how data flows through the Anansi system, the privacy boundaries that protect your data, and our support access policy.
audience: [admin, security, operator, evaluator]
edition: [cloud, enterprise]
last_verified: 2026-08-01
verified_commit: "94c039fc"
owner: "Security Team"
related_runbook: ""
---

# Data Flow and Privacy

This document provides an overview of how your data is processed and protected within the Anansi platform. Understanding the data flow, privacy boundaries, and support access policies is crucial for security and compliance.

## Data Flow

The Anansi data flow is designed to be secure and efficient, from the moment you ingest content to when you retrieve synthesized context.

1.  **Ingest:**
    *   You send content to the Anansi API via the `POST /v1/ingest` endpoint or through a configured [Connector](/docs/administration/connectors.md).
    *   The API validates the request and queues the content for background processing in a BullMQ queue backed by Redis.
    *   A `202 Accepted` response is immediately returned, so your application does not have to wait for processing.

2.  **Processing (Background Workers):**
    *   **Redaction:** If you have configured [redaction rules](/docs/security/governance-and-redaction.md), they are applied to the content to remove sensitive information.
    *   **Chunking:** The content is broken down into smaller, manageable chunks.
    *   **Embedding:** Each chunk is converted into a vector embedding using an embedding model. In `local` deployment mode, this happens on your own infrastructure using Ollama. In `cloud` mode, this may use a third-party service.
    *   **Storage:** The original (redacted) content chunks and their vector embeddings are stored in the PostgreSQL database.
    *   **Synthesis:** The content is analyzed by an LLM to extract entities and facts, which are used to build the knowledge graph and synthesized user profile. This also happens locally or in the cloud depending on your [deployment mode](/docs/architecture/deployment.md).

3.  **Retrieval:**
    *   You request context via the `GET /v1/context` endpoint.
    *   Anansi performs a search over the vector embeddings in PostgreSQL to find relevant chunks.
    *   The synthesized profile and the most relevant chunks are returned to your application.

## Privacy Boundaries

Anansi is built on a multi-tenant architecture with strong data isolation at its core.

*   **Organization Boundary:** The organization is the primary account boundary. All resources, including users, workspaces, and billing, are scoped to a single organization. Users cannot access data from other organizations.
*   **Workspace Boundary:** Within an organization, data can be further segregated by workspaces. The `/v1` API is scoped to a workspace via the API key, ensuring that data from one workspace cannot be accessed by another, even within the same organization. PostgreSQL Row-Level Security (RLS) is used as a secondary backstop to enforce this isolation at the database level.
*   **User Boundary:** Within a workspace, most data is associated with a specific `userId`. By default, API calls are scoped to a single user's memory. Workspace-level context can be retrieved by explicitly setting `scope=workspace` in a `context` API call, but this is a privileged operation.

### Air-Gapped Environments

For maximum data privacy, Anansi can be run in `local` deployment mode. As explained in the [Deployment Architecture Guide](/docs/architecture/deployment.md), this mode enforces at startup that no cloud API keys are set, guaranteeing that your content is never sent to a third-party AI provider for embedding or synthesis.

## Support Access Policy (Anansi Cloud)

For customers using the Anansi Cloud managed service, this policy outlines when and how Anansi personnel may access customer data.

*   **Principle of Least Privilege:** Anansi support personnel are granted the minimum level of access necessary to perform their job functions.
*   **Explicit Customer Consent:** Support personnel will only access your organization's data with your explicit, logged consent, typically given in response to a support ticket you have initiated.
*   **Audited Access:** All access to customer data by support personnel is logged in an internal audit trail.
*   **Purpose:** Access is limited to the purpose of troubleshooting and resolving the specific issue you have reported. Anansi personnel will never access your data for any other reason.

This policy ensures that your data is treated with the utmost care and confidentiality.
