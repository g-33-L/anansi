# @anansi/graph-explorer

Interactive visualization of a memory user's **bi-temporal entity graph** — nodes are entities (people, orgs, tech, projects, locations), edges are relationships with valid-time bounds, rendered in 2D or 3D with a timeline slider for point-in-time (`asOf`) exploration.

**Status: internal demo, not deployed.** This is the visual payoff of the bi-temporal differentiator and the planned opt-in "share your memory graph" growth loop. Productizing it (hosted, shareable views) is a post-launch roadmap item; until then it runs locally against any Anansi instance.

## Run it

```bash
pnpm install
cd apps/graph-explorer
VITE_ANANSI_URL=https://anansimemory.com pnpm dev
```

Open the printed URL, paste an API key (`ans_…`), and pick a memory user. Leave `VITE_ANANSI_URL` unset to proxy a local API on `http://localhost:3000`.

## What it shows

- **Graph canvas** (`src/components/GraphCanvas.tsx`) — force-directed layout, 2D (`force-graph`) or 3D (`3d-force-graph`); node color = entity type, dashed edges = ended relationships.
- **Timeline slider** (`src/components/TimelineSlider.tsx`) — scrub `asOf` to watch the graph as it was valid at any instant.
- **Node panel** (`src/components/NodeSidePanel.tsx`) — the selected entity's relationships and the memory chunks that produced them.

Data comes from `GET /v1/entities` and `GET /v1/memories` (`src/lib/api.ts`); the entity graph is a Pro+ feature on the hosted service.
