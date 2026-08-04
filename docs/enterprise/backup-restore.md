---
title: Backup and Restore
description: A guide for self-hosted Anansi operators on how to back up and restore the Anansi database and secrets.
audience: [operator]
edition: [self-host, enterprise]
last_verified: 2026-08-01
verified_commit: "94c039fc"
owner: "Operator"
related_runbook: ""
---

# Backup and Restore Guide

This guide outlines the recommended procedures for backing up and restoring your self-hosted Anansi instance. As Anansi is a memory product, having a robust backup and restore strategy is critical for data durability and disaster recovery.

## What to Back Up

A complete Anansi backup consists of two critical components:

1.  **The PostgreSQL Database:** This is the only durable data store in Anansi and contains all user and system data, including:
    *   Memory chunks and their vector embeddings.
    *   Synthesized user profiles.
    *   The entity knowledge graph.
    *   User accounts, API key hashes, and subscription information.
    *   Encrypted access tokens for third-party connectors (e.g., Notion, Google Docs).

2.  **Your Encryption Secrets:** Several secrets defined in your `.env` file are essential for a successful restore. **A database backup is useless without these secrets.**
    *   `ENCRYPTION_KEY`: Used to encrypt and decrypt third-party secrets at rest (e.g., connector tokens). **If this key is lost, all connector integrations will need to be re-authenticated.**
    *   `API_KEY_HMAC_SECRET`: Used to validate customer API keys. **If this key is lost, all existing API keys will become invalid and will need to be re-issued.**
    *   `CSRF_SIGNING_KEY`: Used for signing CSRF cookies in the web UI.

**Store your secrets securely** in a password manager or a dedicated secrets management service (e.g., HashiCorp Vault), separate from your Anansi host.

### What Not to Back Up

*   **Redis:** The Redis instance is used for caching, rate limiting, and background job queuing (BullMQ). It does not need to be backed up. In the event of a Redis failure, caches will be rebuilt on demand. Any background jobs that were in-flight may be lost, but can be re-enqueued by a manual process if necessary.

## How to Back Up the Database

The standard tool for backing up a PostgreSQL database is `pg_dump`. We recommend using the "custom" format (`-Fc`) as it is compressed and allows for more flexibility during restoration.

**Backup Command:**

```bash
pg_dump \
  --format=custom \
  --dbname=YOUR_DATABASE_URL \
  --file=anansi_backup_$(date +%Y-%m-%d).dump
```

*   Replace `YOUR_DATABASE_URL` with the connection URL for your Anansi PostgreSQL database.
*   This command will create a compressed backup file named `anansi_backup_YYYY-MM-DD.dump`.

**Backup Strategy:**
*   **Frequency:** Run this backup process at least daily. For high-volume instances, consider more frequent backups using Point-in-Time Recovery (PITR).
*   **Location:** Store your backup files in a secure, off-site location (e.g., Amazon S3, Google Cloud Storage, Backblaze B2), preferably with a different cloud provider than your main Anansi host.
*   **Retention:** Keep at least 7 days of daily backups, and consider longer-term retention (e.g., monthly backups for a year) based on your compliance needs.

## How to Restore the Database

Restoring a backup should always be done to a **new, empty database**, never over an existing, potentially corrupted one.

**Restore Command:**

1.  **Create a new, empty database:**
    ```sql
    CREATE DATABASE anansi_restored;
    ```
2.  **Restore the dump file into the new database:**
    The standard tool for restoring `pg_dump` custom-format archives is `pg_restore`.

    ```bash
    pg_restore \
      --verbose \
      --clean \
      --no-acl \
      --no-owner \
      --dbname=YOUR_NEW_DATABASE_URL \
      anansi_backup.dump
    ```
    *   Replace `YOUR_NEW_DATABASE_URL` with the connection URL for your new `anansi_restored` database.
    *   Replace `anansi_backup.dump` with the path to your backup file.

3.  **Update Anansi Configuration:**
    Once the restore is complete and you have verified the data, update the `DATABASE_URL` in your `.env` file to point to the new, restored database.

4.  **Restart Anansi:**
    Restart your Anansi services. The application will connect to the newly restored database.

## Testing Your Backups

A backup strategy is only reliable if it is regularly tested. You should periodically perform a trial restore to a temporary database to ensure your backups are valid and that your restore procedure works as expected. This practice is essential for meeting your Recovery Time Objective (RTO) in a real disaster recovery scenario.