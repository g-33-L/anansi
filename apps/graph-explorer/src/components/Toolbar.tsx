import type { Dimension, ZMode } from './GraphCanvas';
import { TYPE_COLORS } from './GraphCanvas';

const ENTITY_TYPES = ['person', 'org', 'tech', 'project', 'location', 'chunk'] as const;

interface Props {
  dimension: Dimension;
  zMode: ZMode;
  showHistory: boolean;
  typeFilter: Set<string> | null;
  nodeCount: number;
  linkCount: number;
  onDimensionChange: (d: Dimension) => void;
  onZModeChange: (z: ZMode) => void;
  onHistoryToggle: () => void;
  onTypeFilterToggle: (type: string) => void;
}

export function Toolbar({
  dimension,
  zMode,
  showHistory,
  typeFilter,
  nodeCount,
  linkCount,
  onDimensionChange,
  onZModeChange,
  onHistoryToggle,
  onTypeFilterToggle,
}: Props) {
  const isTypeActive = (t: string) => !typeFilter || typeFilter.size === 0 || typeFilter.has(t);

  return (
    <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-4 py-2 bg-[#0f0f11]/90 backdrop-blur border-b border-white/10 flex-wrap">
      {/* Dimension toggle */}
      <div className="flex rounded overflow-hidden border border-white/20 text-xs">
        <button
          onClick={() => onDimensionChange('2d')}
          className={`px-3 py-1 transition-colors ${dimension === '2d' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          2D
        </button>
        <button
          onClick={() => onDimensionChange('3d')}
          className={`px-3 py-1 transition-colors ${dimension === '3d' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          3D
        </button>
      </div>

      {/* Z-mode (3D only) */}
      {dimension === '3d' && (
        <div className="flex rounded overflow-hidden border border-white/20 text-xs">
          {(['timeline', 'cluster', 'free'] as ZMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => onZModeChange(mode)}
              className={`px-3 py-1 capitalize transition-colors ${zMode === mode ? 'bg-emerald-700 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {mode}
            </button>
          ))}
        </div>
      )}

      {/* History toggle */}
      <button
        onClick={onHistoryToggle}
        className={`px-3 py-1 text-xs rounded border transition-colors ${showHistory ? 'border-slate-500 text-slate-200 bg-slate-700' : 'border-white/20 text-slate-400 hover:text-white'}`}
      >
        History
      </button>

      {/* Type filter chips */}
      <div className="flex gap-1 flex-wrap">
        {ENTITY_TYPES.map(t => {
          const active = isTypeActive(t);
          return (
            <button
              key={t}
              onClick={() => onTypeFilterToggle(t)}
              className={`px-2 py-0.5 text-xs rounded-full border transition-all ${active ? 'border-transparent text-[#0f0f11] font-medium' : 'border-white/20 text-slate-500'}`}
              style={active ? { backgroundColor: TYPE_COLORS[t] } : {}}
            >
              {t}
            </button>
          );
        })}
      </div>

      {/* Stats */}
      <span className="ml-auto text-xs text-slate-500">
        {nodeCount} nodes · {linkCount} links
      </span>
    </div>
  );
}
