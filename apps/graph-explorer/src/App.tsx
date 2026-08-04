import { useState, useCallback, useMemo } from 'react';
import { fetchEntities, fetchMemories, type EntitySummary, type Memory } from './lib/api';
import type { GraphNode } from './lib/graphBuilder';
import { GraphCanvas, type Dimension, type ZMode } from './components/GraphCanvas';
import { Toolbar } from './components/Toolbar';
import { NodeSidePanel } from './components/NodeSidePanel';
import { TimelineSlider } from './components/TimelineSlider';
import { UserSearch } from './components/UserSearch';

interface LoadedState {
  userId: string;
  apiKey: string;
  entities: EntitySummary[];
  memories: Memory[];
}

export default function App() {
  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [dimension, setDimension] = useState<Dimension>('2d');
  const [zMode, setZMode] = useState<ZMode>('timeline');
  const [showHistory, setShowHistory] = useState(false);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<Set<string> | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  async function handleLoad(userId: string, apiKey: string) {
    setLoading(true);
    setFetchError(null);
    try {
      const [entities, memories] = await Promise.all([
        fetchEntities(userId, apiKey),
        fetchMemories(userId, apiKey),
      ]);
      setLoaded({ userId, apiKey, entities, memories });
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const handleTypeFilterToggle = useCallback((type: string) => {
    setTypeFilter(prev => {
      const next = new Set(prev ?? []);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next.size === 0 ? null : next;
    });
  }, []);

  // Timeline slider bounds from entity dates
  const dateBounds = useMemo(() => {
    if (!loaded?.entities.length) return null;
    const dates = loaded.entities.map(e => e.firstSeen).sort();
    return { min: dates[0], max: new Date().toISOString() };
  }, [loaded]);

  // Live node/link count for stats display (approximation using layer 1)
  const statsEntities = loaded?.entities ?? [];
  const nodeCount = statsEntities.length;
  const linkCount = statsEntities.reduce((s, e) => s + e.relationships.length, 0);

  if (!loaded) {
    return (
      <UserSearch
        onLoad={handleLoad}
        loading={loading}
        error={fetchError}
      />
    );
  }

  return (
    <div className="w-screen h-screen relative overflow-hidden bg-[#101925]">
      <Toolbar
        dimension={dimension}
        zMode={zMode}
        showHistory={showHistory}
        typeFilter={typeFilter}
        nodeCount={nodeCount}
        linkCount={linkCount}
        onDimensionChange={setDimension}
        onZModeChange={setZMode}
        onHistoryToggle={() => setShowHistory(v => !v)}
        onTypeFilterToggle={handleTypeFilterToggle}
      />

      {/* Graph area — padded top for toolbar, bottom for slider */}
      <div className="absolute inset-0 top-[60px] bottom-[64px]">
        <GraphCanvas
          entities={loaded.entities}
          memories={loaded.memories}
          dimension={dimension}
          zMode={zMode}
          showHistory={showHistory}
          asOf={asOf}
          typeFilter={typeFilter}
          onNodeClick={setSelectedNode}
        />
      </div>

      <NodeSidePanel
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
      />

      {dateBounds && (
        <TimelineSlider
          min={dateBounds.min}
          max={dateBounds.max}
          value={asOf}
          onChange={setAsOf}
        />
      )}

      {/* User badge */}
      <div className="absolute top-[76px] left-5 flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-[0.1em] text-slate-500">
        <span className="size-1.5 rounded-full bg-[#70c6a3]" aria-hidden />
        {loaded.userId}
        <button
          onClick={() => { setLoaded(null); setSelectedNode(null); setAsOf(null); }}
          aria-label="Change graph subject"
          className="ml-1 text-slate-600 transition-colors hover:text-slate-200"
        >
          ×
        </button>
      </div>
    </div>
  );
}
