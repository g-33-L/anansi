// Docs routes, split per sidebar section. Importing a page module registers
// its routes on the shared router (side-effect imports below).
import { docsRoutes } from "./router.js";
import "./getting-started.js";
import "./api-reference.js";
import "./concepts.js";
import "./guides.js";

export { docsRoutes };
