import { Hono } from "hono";

// Shared router instance; page modules register their routes onto it as a
// side effect of being imported from index.ts.
export const docsRoutes = new Hono();
