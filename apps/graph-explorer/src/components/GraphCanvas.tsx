import { useEffect, useRef, useMemo, useState } from 'react';
import type { EntitySummary, Memory } from '../lib/api';
import {
  buildLayer0,
  buildLayer1,
  buildLayer2,
  buildEntityChunkIndex,
  timeToZ,
  type GraphNode,
  type GraphLink,
  type GraphData,
} from '../lib/graphBuilder';
import { filterLinksByAsOf } from '../lib/temporal';

// ── Shared graph instance interface (force-graph and 3d-force-graph) ─────────

interface FGInstance {
  backgroundColor(c: string): this;
  nodeColor(fn: (n: GraphNode) => string): this;
  nodeLabel(fn: (n: GraphNode) => string): this;
  nodeVal(fn: (n: GraphNode) => number): this;
  linkColor(fn: (l: GraphLink) => string): this;
  linkWidth(fn: (l: GraphLink) => number): this;
  linkLineDash?(fn: (l: GraphLink) => number[] | null): this;
  linkLabel(fn: (l: GraphLink) => string): this;
  linkDirectionalArrowLength(n: number): this;
  linkDirectionalArrowRelPos(n: number): this;
  linkDirectionalParticles(fn: (l: GraphLink) => number): this;
  linkDirectionalParticleWidth(n: number): this;
  onNodeClick(fn: (n: GraphNode) => void): this;
  nodeCanvasObject?(fn: (n: GraphNode, ctx: CanvasRenderingContext2D, scale: number) => void): this;
  nodeCanvasObjectMode?(fn: (n: GraphNode) => string): this;
  onZoom?(fn: (z: { k: number }) => void): this;
  onCameraChange?(fn: (cam: { position: { x: number; y: number; z: number } }) => void): this;
  d3Force(name: string): { strength(v: number): void } | undefined;
  graphData(data?: GraphData): GraphData;
  d3AlphaDecay?(v: number): void;
  pauseAnimation?(): void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const TYPE_COLORS: Record<string, string> = {
  person: '#818cf8',
  org: '#fb923c',
  tech: '#34d399',
  project: '#60a5fa',
  location: '#f87171',
  chunk: '#94a3b8',
  supernode: '#e2e8f0',
};

const ZOOM_MACRO = 0.5; // < this → Layer 0 (supernodes)
const ZOOM_MICRO = 3.0; // > this → Layer 2 (chunk leaves)

export type Dimension = '2d' | '3d';
export type ZMode = 'timeline' | 'cluster' | 'free';

interface Props {
  entities: EntitySummary[];
  memories: Memory[];
  dimension: Dimension;
  zMode: ZMode;
  showHistory: boolean;
  asOf: string | null;
  typeFilter: Set<string> | null;
  onNodeClick: (node: GraphNode) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GraphCanvas({
  entities,
  memories,
  dimension,
  zMode,
  showHistory,
  asOf,
  typeFilter,
  onNodeClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<FGInstance | null>(null);

  // Safeguard 1: persists through layer swaps and re-renders (not state)
  const positionCache = useRef<Map<string, Partial<GraphNode>>>(new Map());
  const prevLayerRef = useRef<0 | 1 | 2>(1);

  const [zoomLevel, setZoomLevel] = useState(1);

  // ── Safeguard 2: inverted index built once per [entities, memories] ──────────
  const chunkIndex = useMemo(
    () => buildEntityChunkIndex(entities, memories),
    [entities, memories],
  );

  // Date bounds for Z-axis — stable across renders
  const dateBounds = useMemo(() => {
    const ts = entities
      .map(e => new Date(e.firstSeen).getTime())
      .filter(n => !isNaN(n));
    if (!ts.length) return { oldest: new Date(0), newest: new Date() };
    return { oldest: new Date(Math.min(...ts)), newest: new Date(Math.max(...ts)) };
  }, [entities]);

  // Filter entities by type if a filter is active
  const filteredEntities = useMemo(() => {
    if (!typeFilter || typeFilter.size === 0) return entities;
    return entities.filter(e => typeFilter.has(e.type));
  }, [entities, typeFilter]);

  // Three independently-memoised layers
  const layer0 = useMemo(() => buildLayer0(filteredEntities), [filteredEntities]);
  const layer1 = useMemo(
    () => buildLayer1(filteredEntities, showHistory, positionCache.current),
    [filteredEntities, showHistory],
  );
  const layer2 = useMemo(
    () => buildLayer2(filteredEntities, memories, chunkIndex, showHistory, positionCache.current),
    [filteredEntities, memories, chunkIndex, showHistory],
  );

  // Derived zoom layer
  const currentLayer: 0 | 1 | 2 =
    zoomLevel < ZOOM_MACRO ? 0 : zoomLevel > ZOOM_MICRO ? 2 : 1;

  const activeData: GraphData = useMemo(
    () => (currentLayer === 0 ? layer0 : currentLayer === 2 ? layer2 : layer1),
    [currentLayer, layer0, layer1, layer2],
  );

  // Apply asOf temporal filter
  const temporalData: GraphData = useMemo(() => {
    if (!asOf) return activeData;
    return { ...activeData, links: filterLinksByAsOf(activeData.links, asOf) };
  }, [activeData, asOf]);

  // Apply fixed Z in Timeline 3D mode (Safeguard 3 is inside timeToZ)
  const graphData: GraphData = useMemo(() => {
    if (dimension !== '3d' || zMode !== 'timeline') return temporalData;
    return {
      ...temporalData,
      nodes: temporalData.nodes.map(n =>
        n.firstSeenAt
          ? { ...n, fz: timeToZ(n.id, n.firstSeenAt, dateBounds.oldest, dateBounds.newest) }
          : n,
      ),
    };
  }, [temporalData, dimension, zMode, dateBounds]);

  // ── Safeguard 1: snapshot positions before layer swap ────────────────────────
  useEffect(() => {
    if (currentLayer === prevLayerRef.current) return;
    const liveNodes = graphRef.current?.graphData?.()?.nodes;
    if (liveNodes) {
      for (const n of liveNodes) {
        if (n.x !== undefined) {
          positionCache.current.set(n.id, {
            x: n.x, y: n.y, z: n.z ?? 0,
            vx: n.vx ?? 0, vy: n.vy ?? 0, vz: n.vz ?? 0,
          });
        }
      }
    }
    prevLayerRef.current = currentLayer;
  }, [currentLayer]);

  // ── Initialize graph (re-runs only when dimension flips) ─────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    graphRef.current?.pauseAnimation?.();
    containerRef.current.innerHTML = '';

    let cancelled = false;

    void (async () => {
      if (dimension === '2d') {
        const { default: ForceGraph } = await import('force-graph');
        if (cancelled) return;

        const fg = (ForceGraph as any)()(containerRef.current!) as FGInstance;

        fg.backgroundColor('#0f0f11')
          .nodeColor((n: GraphNode) => TYPE_COLORS[n.type] ?? '#94a3b8')
          .nodeLabel((n: GraphNode) => `${n.name} (${n.type})`)
          .nodeVal((n: GraphNode) => n.val)
          .linkColor((l: GraphLink) => (l.active ? '#64748b' : '#475569'))
          .linkWidth((l: GraphLink) => (l.confidence ?? 0.5) * 2.5)
          .linkLabel((l: GraphLink) => `${l.label}${l.validUntil ? ' [ended]' : ''}`)
          .linkDirectionalArrowLength(4)
          .linkDirectionalArrowRelPos(1)
          .linkDirectionalParticles((l: GraphLink) => (l.active ? 2 : 0))
          .linkDirectionalParticleWidth(1.5)
          .onNodeClick((n: GraphNode) => onNodeClick(n));

        // Optional 2D-only methods called separately to avoid chain type errors
        fg.nodeCanvasObject?.((n: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const r = Math.sqrt(n.val ?? 1) * 3;
          ctx.beginPath();
          ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI);
          ctx.fillStyle = TYPE_COLORS[n.type] ?? '#94a3b8';
          ctx.fill();
          const fontSize = Math.max(10, 14 / globalScale);
          ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = '#e2e8f0';
          ctx.fillText(n.name, n.x ?? 0, (n.y ?? 0) + r + 3);
        });
        fg.nodeCanvasObjectMode?.(() => 'replace');
        fg.linkLineDash?.((l: GraphLink) => (l.active ? null : [3, 3]));
        fg.onZoom?.(({ k }: { k: number }) => setZoomLevel(k));

        fg.d3Force('charge')?.strength(-120);
        graphRef.current = fg;
      } else {
        const { default: ForceGraph3D } = await import('3d-force-graph');
        if (cancelled) return;

        const fg = (ForceGraph3D as any)()(containerRef.current!) as FGInstance;

        fg.backgroundColor('#0f0f11')
          .nodeColor((n: GraphNode) => TYPE_COLORS[n.type] ?? '#94a3b8')
          .nodeLabel((n: GraphNode) => n.name)
          .nodeVal((n: GraphNode) => n.val)
          .linkColor((l: GraphLink) => (l.active ? '#64748b' : '#475569'))
          .linkWidth((l: GraphLink) => (l.confidence ?? 0.5) * 2)
          .linkLabel((l: GraphLink) => l.label)
          .linkDirectionalArrowLength(4)
          .linkDirectionalArrowRelPos(1)
          .linkDirectionalParticles((l: GraphLink) => (l.active ? 2 : 0))
          .linkDirectionalParticleWidth(1.5)
          .onNodeClick((n: GraphNode) => onNodeClick(n));

        // Optional 3D-only method called separately
        fg.onCameraChange?.(({ position }: { position: { x: number; y: number; z: number } }) => {
          const dist = Math.sqrt(position.x ** 2 + position.y ** 2 + position.z ** 2);
          setZoomLevel(3000 / Math.max(dist, 1));
        });

        fg.d3Force('charge')?.strength(-120);
        graphRef.current = fg;
      }

      graphRef.current?.graphData(graphData);
    })();

    return () => { cancelled = true; };
  }, [dimension]); // intentionally omit graphData — handled below

  // ── Stream data updates without re-initializing ───────────────────────────────
  useEffect(() => {
    if (!graphRef.current) return;
    graphRef.current.graphData(graphData);
    if (currentLayer !== prevLayerRef.current) {
      graphRef.current.d3AlphaDecay?.(0.05);
    }
  }, [graphData, currentLayer]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      data-layer={currentLayer}
      data-dimension={dimension}
    />
  );
}
