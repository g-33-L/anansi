---
title: Organization and Member Management
description: A guide for administrators on how to set up an organization, manage teams, and control member permissions in Anansi.
audience: [admin, operator]
edition: [cloud, enterprise]
last_verified: 2026-08-01
verified_commit: "94c039fc"
owner: "Product Team"
related_runbook: ""
---

# Organization and Member Management

This guide explains how to manage your organization, teams, and members within the Anansi platform. These features are available in the Anansi web application and are essential for controlling access and collaboration.

## Organizations

An organization is the top-level account in Anansi. It owns all resources, including members, teams, workspaces, and billing information.

### Creating an Organization

When you sign up for Anansi for the first time, a new organization is automatically created for you. The user who signs up becomes the `owner` of the organization.

## Members

You can invite new members to your organization and assign them roles to control their level of access.

### Inviting a New Member

1.  Navigate to **Settings → Members** in the Anansi web application.
2.  Click on the "Invite Member" button.
3.  Enter the email address of the person you want to invite and select a role for them.
4.  An invitation email will be sent to the user. Once they accept the invitation and sign up, they will be added to your organization.

*(Note: The UI for this feature may be a scaffold in the current version of the `apps/web` customer application.)*

### Member Roles and Permissions

Anansi has six member roles with different levels of permissions:

*   **Owner:** The highest level of access. There can only be one owner per organization. The owner can manage all aspects of the organization, including billing, and can transfer ownership to another member.
*   **Admin:** Can manage members, teams, and workspaces. They can invite new members, change member roles, and manage API keys. They cannot manage billing or delete the organization.
*   **Member:** The basic role. Members can access workspaces they are a part of and can manage their own API keys, but they cannot manage other members, teams, or organization settings.
*   **Billing:** A specialized role that can only manage billing and subscription information. This role cannot access memory or other resources.
*   **Auditor:** A read-only role that can view organization settings and export audit logs (`audit:export` permission). This role cannot make any changes.
*   **Viewer:** A read-only role that can view resources within workspaces they are a part of, but cannot make any changes.

### Removing a Member

To remove a member from your organization:

1.  Navigate to **Settings → Members**.
2.  Find the member you want to remove in the member list.
3.  Click the "Remove" button next to their name.

This will revoke their access to the organization and all of its resources.

## Teams

Teams are a way to group members within an organization. You can use teams to manage access to workspaces and other resources.

### Creating a Team

1.  Navigate to **Settings → Teams** in the Anansi web application.
2.  Click on the "Create Team" button.
3.  Give your team a name (e.g., "Engineering", "Product").

### Managing Team Members

Once a team is created, you can add or remove members from it.

1.  Navigate to the team's page.
2.  Use the "Add Member" or "Remove Member" functionality to manage team membership.

By organizing members into teams, you can more easily manage their access to different workspaces and Anansi resources.
