import type { GraphNode } from '../lib/graphBuilder';
import { TYPE_COLORS } from './GraphCanvas';

interface Props {
  node: GraphNode | null;
  onClose: () => void;
}

function fmt(iso: string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function NodeSidePanel({ node, onClose }: Props) {
  if (!node) return null;

  const color = TYPE_COLORS[node.type] ?? '#94a3b8';

  return (
    <div className="absolute right-0 top-0 bottom-0 w-80 bg-[#16161a] border-l border-white/10 flex flex-col z-20 overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-2 px-4 pt-4 pb-3 border-b border-white/10">
        <span
          className="mt-0.5 w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-sm text-white truncate">{node.name}</h2>
          <p className="text-xs text-slate-500 capitalize">{node.type}</p>
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-white text-lg leading-none ml-2"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {node.type === 'chunk' ? (
          <>
            {node.content && (
              <div>
                <p className="text-slate-400 mb-1 font-medium uppercase tracking-wide text-[10px]">Content</p>
                <p className="text-slate-200 leading-relaxed whitespace-pre-wrap">{node.content}</p>
              </div>
            )}
            <div className="text-slate-500 space-y-1">
              <p>Created: {fmt(node.createdAt)}</p>
            </div>
          </>
        ) : (
          <>
            <div className="text-slate-500 space-y-1">
              <p>First seen: {fmt(node.firstSeenAt)}</p>
              <p>ID: <span className="font-mono text-[10px] break-all text-slate-400">{node.id}</span></p>
            </div>
          </>
        )}

        {node.type === 'supernode' && node.memberIds && (
          <div>
            <p className="text-slate-400 mb-1 font-medium uppercase tracking-wide text-[10px]">Members ({node.memberIds.length})</p>
            <ul className="space-y-0.5 text-slate-400">
              {node.memberIds.slice(0, 20).map(id => (
                <li key={id} className="font-mono text-[10px] truncate">{id}</li>
              ))}
              {node.memberIds.length > 20 && (
                <li className="text-slate-600">+{node.memberIds.length - 20} more</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
