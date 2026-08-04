---
title: Managing API Keys
description: A guide for administrators and developers on how to create, manage, and scope API keys in Anansi.
audience: [admin, developer, operator]
edition: [cloud, enterprise]
last_verified: 2026-08-01
verified_commit: "94c039fc"
owner: "Product Team"
related_runbook: ""
---

# Managing API Keys

API keys are used to authenticate with the Anansi `/v1` API. You can create multiple API keys with different scopes to provide granular access to your memory workspaces.

## Creating an API Key

1.  Navigate to **Settings → API Keys** in the Anansi web application.
2.  Click on the "Create API Key" button.
3.  Give your API key a descriptive name (e.g., "Production Voice Agent Key", "Development Test Key").
4.  Optionally, you can assign scopes to the key to limit its permissions (see "API Key Scopes" below).
5.  Click "Create".

Your new API key will be displayed. **Copy this key and store it in a secure location.** For security reasons, you will not be able to see the full key again after you leave this page.

*(Note: The UI for this feature may be a scaffold in the current version of the `apps/web` customer application.)*

## API Key Scopes

API key scopes allow you to restrict what an API key can do, following the principle of least privilege. When you create an API key, you can assign it one or more scopes. If no scopes are assigned, the key has full access.

The available scopes are:

*   **`ingest`**: Allows the key to ingest new data (`/v1/ingest`, `/v1/ingest/batch`).
*   **`read`**: Allows the key to read memory data, including synthesized context (`/v1/context`), raw memories (`/v1/memories`), and search (`/v1/search`).
*   **`admin`**: Allows the key to perform administrative actions, such as deleting users (`/v1/user`) or memories (`/v1/memory`).
*   **`entities`**: Allows the key to read the entity graph (`/v1/entities`).
*   **`ledger`**: Allows the key to access the ledger and timeline endpoints (`/v1/ledger/*`).

By assigning scopes, you can create keys with specific purposes. For example, you could create a key that can only ingest data (`ingest`) for a data pipeline, and a separate key that can only read context (`read`) for an LLM agent.

## Managing Existing Keys

From the **Settings → API Keys** page, you can:

*   **View your API keys:** See a list of all your keys, their prefixes, creation dates, and assigned scopes.
*   **Revoke an API key:** To disable a key, click the "Revoke" button next to it. This will permanently delete the key and it can no longer be used to access the API. This action is irreversible.

## Security Best Practices

*   **Treat API keys like passwords:** Store them securely and never expose them in client-side code or commit them to version control.
*   **Use environment variables:** Load API keys from environment variables in your applications.
*   **Use scopes:** Create keys with the minimum required scopes for their intended purpose.
*   **Rotate keys regularly:** Periodically revoke old keys and replace them with new ones to limit the impact of a potential key compromise.