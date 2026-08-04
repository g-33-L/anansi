---
title: SAML Authentication Status
description: The current support status of SAML 2.0 for single sign-on (SSO) in Anansi, and how assertions are validated.
audience: [admin, security, operator, evaluator]
edition: [enterprise]
last_verified: 2026-08-04
verified_commit: "e17da946"
owner: "Enterprise Team"
related_runbook: ""
---

# SAML Authentication Status

**Status: Supported.** SAML 2.0 SSO is implemented and live.

> **Correction (2026-08-04).** An earlier version of this page stated that SAML
> was "not supported" and that assertion validation was "intentionally disabled
> and not implemented." **That was wrong**, and wrong in the more dangerous
> direction: it described a live authentication endpoint as inert. The page was
> written on 2026-08-04 while the assertion consumer was still gated off, the
> gate was removed 52 minutes later, and the page was never revisited. If you
> evaluated Anansi's authentication surface using the previous text, re-read
> this one — `POST /sso/:slug/acs` is a real authentication path.

## What is implemented

SAML is enabled **per organization**, not globally. An organization has SAML SSO
once it has an SSO connection record with `protocol = "saml"` and `enabled =
true`. There is no global on/off switch; an organization without such a record
gets `404 SAML is not enabled for this organization`.

| Endpoint | Purpose |
| --- | --- |
| `GET /sso/:slug/metadata` | SP metadata XML to upload into your IdP |
| `GET /sso/:slug/authorize` | SP-initiated login redirect |
| `POST /sso/:slug/acs` | Assertion Consumer Service — **validates and consumes assertions** |

A successful login provisions the user just-in-time, maps IdP groups to roles
via the connection's `groupRoleMap`, sets a session cookie, issues a CSRF token,
and records an `sso.login` audit event.

## How assertions are validated

Validation is delegated entirely to
[`@node-saml/node-saml`](https://github.com/node-saml/node-saml), which verifies
the XML digital signature before returning a profile.
**There is deliberately no XML-parsing fallback**, so there is no code path that
reads attributes out of an unverified document.

The client is configured (`apps/api/src/lib/enterprise/sso/saml.ts`) with:

| Control | Setting | Effect |
| --- | --- | --- |
| `wantAssertionsSigned` | `true` | An unsigned assertion is rejected |
| `wantAuthnResponseSigned` | `true` | An unsigned response is rejected |
| `idpIssuer` | pinned to `idpEntityId` | Assertions from another issuer are rejected |
| `audience` | pinned to `spEntityId` | Assertions minted for another SP are rejected |
| `acceptedClockSkewMs` | `60000` | One minute of tolerance |
| `maxAssertionAgeMs` | `300000` | Assertions older than 5 minutes are rejected |
| `validateInResponseTo` | `ifPresent` | SP-initiated responses are correlated to their request; signed IdP-initiated SSO is still accepted |

After signature verification, the profile must yield a syntactically valid email
(from `email`, `mail`, or `nameID`) or provisioning is refused. A malformed,
expired, unsigned, wrongly-issued, or wrong-audience response therefore fails
**before** any identity is created.

## OIDC is also supported

OIDC remains fully supported and is generally simpler to configure. See the
[OIDC and SCIM Configuration Guide](/docs/enterprise/oidc-scim.md). Choosing
between them is a matter of what your IdP does best — it is no longer a
correctness or security trade-off, as the previous version of this page implied.

## Reporting a problem

If you believe an assertion is being accepted that should not be, treat it as a
security issue and follow [`SECURITY.md`](../../SECURITY.md) rather than opening
a public issue.
