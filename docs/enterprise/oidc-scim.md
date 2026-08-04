---
title: OIDC and SCIM Configuration
description: A guide for enterprise administrators on how to configure OIDC for single sign-on (SSO) and SCIM for automated user provisioning.
audience: [admin, security, operator]
edition: [enterprise]
last_verified: 2026-08-01
verified_commit: "94c039fc"
owner: "Enterprise Team"
related_runbook: ""
---

# OIDC and SCIM Configuration

Anansi's enterprise plan supports OpenID Connect (OIDC) for single sign-on (SSO) and System for Cross-domain Identity Management (SCIM) for automated user and group provisioning. This guide explains how to configure these features to integrate Anansi with your Identity Provider (IdP) like Okta, Azure AD, or Auth0.

**Note:** While the backend for OIDC and SCIM is implemented, it has not yet undergone live integration testing with all major providers. It is strongly recommended to perform thorough testing in a staging environment before rolling out to your organization.

## 1. OIDC for Single Sign-On (SSO)

OIDC allows your users to sign in to Anansi using their existing corporate credentials, providing a seamless and secure authentication experience.

### Configuration Steps

To configure an OIDC connection, you will need to provide the following information to your Anansi support contact or in the Anansi admin dashboard (when available):

*   **Identity Provider (IdP) Issuer URL:** The root URL of your IdP's OIDC discovery document (e.g., `https://your-domain.okta.com`).
*   **Client ID:** The client ID for the Anansi application, obtained from your IdP.
*   **Client Secret:** The client secret for the Anansi application, obtained from your IdP.

In your IdP, you will need to configure an OIDC application for Anansi with the following settings:

*   **Application Type:** Web Application
*   **Grant Types:** Authorization Code
*   **Sign-in redirect URIs / Callback URLs:** Provide your Anansi instance's callback URL. This will be provided to you by Anansi support or can be found in your admin dashboard. It will typically look like:
    `https://your-anansi-domain.com/sso/{org-slug}/callback`

### Role and Group Mapping

Anansi can map claims from the OIDC token to user roles and team memberships. During setup, you will define how attributes in the OIDC `id_token` (such as `groups` or a custom role attribute) map to Anansi roles (`admin` or `member`).

### User Experience

Once OIDC is configured, users can sign in by clicking a "Sign in with SSO" button on the Anansi login page. They will be redirected to your IdP to authenticate, and then redirected back to Anansi, automatically signed in.

## 2. SCIM for User and Group Provisioning

SCIM automates the process of creating, updating, and deactivating users and groups in Anansi based on changes in your IdP. This reduces manual administration and ensures user access is always up-to-date.

### Configuration Steps

To configure SCIM, you will need to set up a SCIM application in your IdP and provide it with the following from your Anansi instance:

*   **SCIM Base URL (Tenant URL):** This is the base URL for the SCIM API on your Anansi instance. It will typically look like:
    `https://your-anansi-domain.com/scim/v2`
*   **Authentication Token (Secret Token):** A long-lived bearer token generated from your Anansi instance that the IdP will use to authenticate its SCIM requests.

In your IdP's SCIM application settings:

1.  Enable "Push New Users" and "Push Profile Updates" to automatically create and update users in Anansi.
2.  Enable "Push Groups" to sync groups from your IdP to Anansi teams.
3.  Configure attribute mappings to ensure standard attributes like `userName`, `givenName`, `familyName`, and `active` are correctly mapped.

### Supported SCIM Features

*   **Users:**
    *   Create (`POST /Users`): Provision new users in Anansi when they are assigned to the SCIM app in your IdP.
    *   Read (`GET /Users`, `GET /Users/{id}`): Fetch users from Anansi.
    *   Update (`PATCH /Users/{id}`): Update user attributes (e.g., name, email).
    *   Deactivate (`PATCH /Users/{id}` with `active: false`): Deactivating a user in your IdP will deactivate their Anansi account.
*   **Groups:**
    *   Create (`POST /Groups`): Create new teams in Anansi.
    *   Read (`GET /Groups`, `GET /Groups/{id}`): Fetch teams from Anansi.

### Deprovisioning

When a user is unassigned from the Anansi SCIM application in your IdP or deactivated, their `active` status in Anansi will be set to `false`, and they will no longer be able to log in. Their data and contributions remain in the system, but their access is revoked.

## 3. Audit Events

All significant OIDC and SCIM events are recorded in the organization's audit log, including:

*   OIDC login success and failure.
*   SCIM user created, updated, or deactivated.
*   SCIM group created, updated, or deleted.

This provides administrators with a clear trail of identity and access management activities.
