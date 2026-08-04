---
title: Managing Connectors
description: A guide for administrators on how to connect and manage third-party data sources like Notion and Google Docs in Anansi.
audience: [admin, operator]
edition: [cloud, enterprise]
last_verified: 2026-08-01
verified_commit: "94c039fc"
owner: "Product Team"
related_runbook: ""
---

# Managing Connectors

Anansi's connectors allow you to seamlessly ingest data from third-party platforms like Notion and Google Docs, making it available within your Anansi memory. This guide explains how to manage these connections from an administrative perspective.

For developer-focused information on how connectors work, see the [Connector Ingestion Guide](/docs/developer/guides/connector-ingestion.md).

## How Connectors Work

From an administrator's point of view, a connector is a bridge between your Anansi organization and a third-party application. By authorizing Anansi to access your data on these platforms, you enable it to automatically ingest content, keeping your memory profiles rich and up-to-date without manual `ingest` calls.

## Connecting to a New Data Source

To connect a new data source:

1.  Navigate to the **Connectors** section in the Anansi web application.
2.  You will see a list of available connectors (e.g., Notion, Google Docs).
3.  Click the "Connect" button next to the platform you want to integrate.
4.  You will be redirected to the third-party platform's OAuth consent screen. Here, you will be asked to grant Anansi permission to access your data.
5.  Follow the on-screen instructions to authorize the connection. You may need to select which specific pages, documents, or workspaces you want to grant Anansi access to.
6.  Once you complete the authorization process, you will be redirected back to Anansi.

The connection is now active, and Anansi's background workers will begin to ingest content from the authorized source.

*(Note: The UI for this feature may be a scaffold in the current version of the `apps/web` customer application.)*

## Managing Existing Connections

From the **Connectors** page, you can view all your active connections. For each connection, you will typically see:

*   The name of the connected platform.
*   The account that was used to authorize the connection.
*   The status of the connection (e.g., "Active", "Syncing", "Error").

### Disconnecting a Data Source

If you no longer want Anansi to ingest data from a connected source, you can disconnect it.

1.  Navigate to the **Connectors** page.
2.  Find the connection you want to remove.
3.  Click the "Disconnect" or "Revoke" button.

This will revoke Anansi's access token for that platform. No new data will be ingested from that source. **This action does not delete data that has already been ingested.** To remove previously ingested data, you will need to use the `DELETE /v1/memory` API, filtering by the appropriate `sourceId`.
