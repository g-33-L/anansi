/*
 * /console — session-authenticated product BFF (distinct from the bearer-token
 * public /v1 API). Mounted at /console by app.ts.
 *
 *   /console/auth/*          public (magic-link login)
 *   everything else          requireSession + requireCsrf
 */
import { Hono } from "hono";
import { requireCsrf, requireSession, type ConsoleEnv } from "../../lib/auth/console-middleware.js";
import { authRoutes } from "./auth.js";
import { organizationRoutes } from "./organizations.js";
import { memberRoutes } from "./members.js";
import { teamRoutes } from "./teams.js";
import { profileRoutes } from "./profile.js";
import { apiKeyRoutes } from "./api-keys.js";
import { dataRoutes } from "./data.js";
import { enterpriseRoutes } from "./enterprise.js";

export const consoleRoutes = new Hono<ConsoleEnv>();

// Public authentication endpoints.
consoleRoutes.route("/auth", authRoutes);

// Authenticated surface — session cookie + CSRF double-submit on every request.
const authed = new Hono<ConsoleEnv>();
authed.use("*", requireSession);
authed.use("*", requireCsrf);
authed.route("/", profileRoutes); // GET/PATCH /me
authed.route("/organizations", organizationRoutes);
authed.route("/organizations", memberRoutes); // /organizations/members, /organizations/invitations
authed.route("/teams", teamRoutes);
authed.route("/api-keys", apiKeyRoutes);
authed.route("/", dataRoutes); // /usage, /search, /memory
authed.route("/enterprise", enterpriseRoutes); // SSO, SCIM tokens, audit, governance, redaction, license

consoleRoutes.route("/", authed);
