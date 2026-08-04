/*
 * Anansi Enterprise Edition — licensed under LICENSE-EE, not MIT.
 * See /LICENSE-EE at the repo root. Production use requires a commercial
 * license; evaluation, self-hosted non-production use, and contributions
 * are permitted under LICENSE-EE terms.
 */

/*
 * SCIM 2.0 provisioning endpoint (Phase 7) — public, authed by a per-org SCIM
 * bearer token (Authorization: Bearer scim_…), NOT a session. The IdP calls these
 * to keep users/groups in sync. All operations are scoped to the token's org.
 *
 * Mounted at /scim/v2. Content type is application/scim+json (we accept JSON).
 */
import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { validateScimToken } from "../lib/enterprise/scim/tokens.js";
import {
  scimListUsers,
  scimGetUser,
  scimCreateUser,
  scimPatchUser,
  scimDeleteUser,
  scimListGroups,
  scimCreateGroup,
  type ScimResult,
} from "../lib/enterprise/scim/handler.js";

type ScimEnv = { Variables: { orgId: string } };

export const scimRoutes = new Hono<ScimEnv>();

// Bearer-token auth for every SCIM call.
scimRoutes.use("*", async (c, next) => {
  const auth = c.req.header("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const resolved = await validateScimToken(token);
  if (!resolved) {
    return c.json({ schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: "401", detail: "invalid SCIM token" }, 401);
  }
  c.set("orgId", resolved.organizationId);
  await next();
});

const send = (c: Context, r: ScimResult) =>
  r.status === 204
    ? c.body(null, 204)
    : c.json(r.body as Record<string, unknown>, r.status as ContentfulStatusCode);

async function readJson(c: Context): Promise<Record<string, unknown>> {
  return ((await c.req.json().catch(() => ({}))) as Record<string, unknown>) ?? {};
}

// ── Users ─────────────────────────────────────────────────────────────────────
scimRoutes.get("/Users", async (c) => send(c, await scimListUsers(c.get("orgId"), c.req.query("filter"))));
scimRoutes.get("/Users/:id", async (c) => send(c, await scimGetUser(c.get("orgId"), c.req.param("id"))));
scimRoutes.post("/Users", async (c) => send(c, await scimCreateUser(c.get("orgId"), await readJson(c))));
scimRoutes.patch("/Users/:id", async (c) => send(c, await scimPatchUser(c.get("orgId"), c.req.param("id"), await readJson(c))));
scimRoutes.put("/Users/:id", async (c) => send(c, await scimPatchUser(c.get("orgId"), c.req.param("id"), await readJson(c))));
scimRoutes.delete("/Users/:id", async (c) => send(c, await scimDeleteUser(c.get("orgId"), c.req.param("id"))));

// ── Groups (→ teams) ────────────────────────────────────────────────────────
scimRoutes.get("/Groups", async (c) => send(c, await scimListGroups(c.get("orgId"))));
scimRoutes.post("/Groups", async (c) => send(c, await scimCreateGroup(c.get("orgId"), await readJson(c))));
