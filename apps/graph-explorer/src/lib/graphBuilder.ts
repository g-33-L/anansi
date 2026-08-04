import type { EntitySummary, Memory } from './api';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  name: string;
  type: 'person' | 'org' | 'tech' | 'project' | 'location' | 'chunk' | 'supernode';
  val: number;
  firstSeenAt?: string;
  content?: string;
  createdAt?: string;
  memberIds?: string[];
  // Injected by force simulation (preserved by positionCache — Safeguard 1)
  x?: number; y?: number; z?: number;
  vx?: number; vy?: number; vz?: number;
  fz?: number; // fixed Z for Timeline mode (Safeguard 3)
}

export interface GraphLink {
  source: string;
  target: string;
  label: string;
  active: boolean;
  confidence: number;
  validFrom?: string;
  validUntil?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface EntityChunkIndex {
  entityToChunks: Map<string, string[]>;
  chunkToEntities: Map<string, string[]>;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Safeguard 3: stable hash → deterministic ±(range/2) offset per node
function deterministicJitter(nodeId: string, range = 6): number {
  const hash = nodeId.split('').reduce((acc, c) => (acc ^ c.charCodeAt(0)) & 0xffff, 0);
  return ((hash % 1000) / 1000 - 0.5) * range;
}

export function timeToZ(
  nodeId: string,
  isoDate: string,
  oldest: Date,
  newest: Date,
  zRange = 300,
): number {
  const span = newest.getTime() - oldest.getTime();
  const ratio =
    span === 0 ? 0.5 : (new Date(isoDate).getTime() - oldest.getTime()) / span;
  return ratio * zRange + deterministicJitter(nodeId); // Safeguard 3
}

// Safeguard 2: build inverted index once — O(M×E) not O(N×M) per render
export function buildEntityChunkIndex(
  entities: EntitySummary[],
  memories: Memory[],
): EntityChunkIndex {
  const patterns = entities.map(e => ({
    id: e.id,
    re: new RegExp(`\\b${escapeRegex(e.name)}\\b`, 'i'),
  }));

  const entityToChunks = new Map<string, string[]>();
  const chunkToEntities = new Map<string, string[]>();

  for (const m of memories) {
    const matched: string[] = [];
    for (const { id, re } of patterns) {
      if (re.test(m.content ?? '')) {
        matched.push(id);
        entityToChunks.set(id, [...(entityToChunks.get(id) ?? []), m.id]);
      }
    }
    if (matched.length) chunkToEntities.set(m.id, matched);
  }

  return { entityToChunks, chunkToEntities };
}

// Safeguard 1: inject cached x/y/z before passing new layer to graphData()
export function injectPositions(
  nodes: GraphNode[],
  cache: Map<string, Partial<GraphNode>>,
): GraphNode[] {
  return nodes.map(n => {
    const c = cache.get(n.id);
    return c ? { ...n, ...c } : n;
  });
}

// ── Layer 0 — Macro (supernodes by entity type) ───────────────────────────────

export function buildLayer0(entities: EntitySummary[]): GraphData {
  const groups = new Map<string, EntitySummary[]>();
  for (const e of entities) {
    groups.set(e.type, [...(groups.get(e.type) ?? []), e]);
  }

  const nodes: GraphNode[] = [...groups.entries()].map(([type, members]) => ({
    id: `supernode-${type}`,
    name: `${type.charAt(0).toUpperCase() + type.slice(1)} (${members.length})`,
    type: 'supernode' as const,
    val: Math.max(6, members.length * 2),
    memberIds: members.map(m => m.id),
  }));

  const edgeCounts = new Map<string, number>();
  for (const e of entities) {
    for (const rel of e.relationships) {
      if (e.type === rel.target.type) continue;
      const key = [e.type, rel.target.type].sort().join('__');
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }

  const links: GraphLink[] = [...edgeCounts.entries()].map(([key, count]) => {
    const [a, b] = key.split('__');
    return {
      source: `supernode-${a}`,
      target: `supernode-${b}`,
      label: `${count} connection${count !== 1 ? 's' : ''}`,
      active: true,
      confidence: Math.min(1, count / 10),
    };
  });

  return { nodes, links };
}

// ── Layer 1 — Meso (individual entities) ─────────────────────────────────────

export function buildLayer1(
  entities: EntitySummary[],
  showHistory: boolean,
  positionCache: Map<string, Partial<GraphNode>>,
): GraphData {
  const nodeMap = new Map<string, GraphNode>();

  for (const e of entities) {
    nodeMap.set(e.id, {
      id: e.id,
      name: e.name,
      type: e.type as GraphNode['type'],
      val: e.relationships.length + 3,
      firstSeenAt: e.firstSeen,
    });
  }

  const links: GraphLink[] = [];

  for (const e of entities) {
    for (const rel of e.relationships) {
      if (!showHistory && !rel.current) continue;
      if (!nodeMap.has(rel.target.id)) {
        nodeMap.set(rel.target.id, {
          id: rel.target.id,
          name: rel.target.name,
          type: rel.target.type as GraphNode['type'],
          val: 2,
        });
      }
      links.push({
        source: e.id,
        target: rel.target.id,
        label: rel.relationship,
        active: rel.current,
        confidence: 1.0,
        validFrom: rel.validFrom,
        validUntil: rel.validUntil ?? undefined,
      });
    }
  }

  return {
    nodes: injectPositions([...nodeMap.values()], positionCache), // Safeguard 1
    links,
  };
}

// ── Layer 2 — Micro (entities + memory chunk leaves) ─────────────────────────

export function buildLayer2(
  entities: EntitySummary[],
  memories: Memory[],
  index: EntityChunkIndex, // Safeguard 2: pre-computed
  showHistory: boolean,
  positionCache: Map<string, Partial<GraphNode>>,
): GraphData {
  const { nodes: entityNodes, links } = buildLayer1(entities, showHistory, positionCache);
  const nodeMap = new Map(entityNodes.map(n => [n.id, n]));

  for (const m of memories) {
    const matchedEntityIds = index.chunkToEntities.get(m.id); // O(1) — Safeguard 2
    if (!matchedEntityIds?.length) continue;

    if (!nodeMap.has(m.id)) {
      nodeMap.set(m.id, {
        id: m.id,
        name: m.sourceType ?? 'memory',
        type: 'chunk',
        val: 1,
        content: m.content,
        createdAt: m.createdAt,
      });
    }

    for (const entityId of matchedEntityIds) {
      links.push({
        source: entityId,
        target: m.id,
        label: 'source',
        active: true,
        confidence: 0.3,
      });
    }
  }

  return {
    nodes: injectPositions([...nodeMap.values()], positionCache), // Safeguard 1
    links,
  };
}
