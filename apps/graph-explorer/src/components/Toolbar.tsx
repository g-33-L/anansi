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
    <div className="absolute inset-x-0 top-0 z-10 flex min-h-[60px] items-center gap-4 overflow-x-auto border-b border-[#2b394d] bg-[#111b29]/95 px-5 py-2.5 backdrop-blur-sm">
      <div className="mr-1 flex shrink-0 items-center gap-2 border-r border-[#2b394d] pr-5">
        <span className="size-2 rounded-full bg-[#88a9ff] shadow-[0_0_0_3px_rgb(136_169_255/0.12)]" aria-hidden />
        <div>
          <p className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-slate-400">Knowledge map</p>
          <p className="text-xs font-medium tracking-[-0.01em] text-slate-100">Entity topology</p>
        </div>
      </div>
      {/* Dimension toggle */}
      <div className="flex shrink-0 overflow-hidden rounded-md border border-[#3a485d] text-xs" role="group" aria-label="Graph dimension">
        <button
          onClick={() => onDimensionChange('2d')}
          aria-pressed={dimension === '2d'}
          className={`px-3 py-1.5 transition-colors ${dimension === '2d' ? 'bg-[#88a9ff] font-medium text-[#0e1726]' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
        >
          2D
        </button>
        <button
          onClick={() => onDimensionChange('3d')}
          aria-pressed={dimension === '3d'}
          className={`px-3 py-1.5 transition-colors ${dimension === '3d' ? 'bg-[#88a9ff] font-medium text-[#0e1726]' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
        >
          3D
        </button>
      </div>

      {/* Z-mode (3D only) */}
      {dimension === '3d' && (
        <div className="flex shrink-0 overflow-hidden rounded-md border border-[#3a485d] text-xs" role="group" aria-label="Three-dimensional layout">
          {(['timeline', 'cluster', 'free'] as ZMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => onZModeChange(mode)}
              aria-pressed={zMode === mode}
              className={`px-3 py-1.5 capitalize transition-colors ${zMode === mode ? 'bg-[#70c6a3] font-medium text-[#0d241c]' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
            >
              {mode}
            </button>
          ))}
        </div>
      )}

      {/* History toggle */}
      <button
        onClick={onHistoryToggle}
        aria-pressed={showHistory}
        className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${showHistory ? 'border-[#53647b] bg-[#27364d] text-slate-100' : 'border-[#3a485d] text-slate-400 hover:border-[#53647b] hover:text-white'}`}
      >
        History
      </button>

      {/* Type filter chips */}
      <div className="flex shrink-0 gap-1" role="group" aria-label="Entity type filters">
        {ENTITY_TYPES.map(t => {
          const active = isTypeActive(t);
          return (
            <button
              key={t}
              onClick={() => onTypeFilterToggle(t)}
              aria-pressed={active}
              className={`rounded-sm border px-2 py-1 font-mono text-[0.625rem] uppercase tracking-[0.06em] transition-all ${active ? 'border-transparent font-medium text-[#101925]' : 'border-[#3a485d] text-slate-500 hover:text-slate-300'}`}
              style={active ? { backgroundColor: TYPE_COLORS[t] } : {}}
            >
              {t}
            </button>
          );
        })}
      </div>

      {/* Stats */}
      <span className="ml-auto shrink-0 font-mono text-[0.625rem] uppercase tracking-[0.08em] text-slate-500">
        {nodeCount} nodes · {linkCount} links
      </span>
    </div>
  );
}
