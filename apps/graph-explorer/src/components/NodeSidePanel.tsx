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

  const color = TYPE_COLORS[node.type] ?? '#8f9cae';

  return (
    <aside aria-label="Selected graph entity" className="absolute bottom-0 right-0 top-0 z-20 flex w-full max-w-[22rem] flex-col overflow-hidden border-l border-[#304055] bg-[#151f2d] shadow-[-18px_0_48px_rgb(0_0_0/0.22)] sm:w-80">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-[#304055] px-5 pb-4 pt-5">
        <span
          className="mt-1 size-2.5 shrink-0 rounded-full shadow-[0_0_0_3px_rgb(255_255_255/0.06)]"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[0.625rem] uppercase tracking-[0.1em] text-slate-500">Selected entity</p>
          <h2 className="mt-1 truncate text-base font-semibold tracking-[-0.02em] text-white">{node.name}</h2>
          <p className="mt-0.5 text-xs capitalize text-slate-400">{node.type}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close entity inspector"
          className="ml-2 rounded-md px-1.5 py-0.5 text-lg leading-none text-slate-500 transition-colors hover:bg-white/5 hover:text-white"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-5 overflow-y-auto p-5 text-xs">
        {node.type === 'chunk' ? (
          <>
            {node.content && (
              <div>
                <p className="mb-2 font-mono text-[0.625rem] font-medium uppercase tracking-[0.1em] text-slate-500">Source content</p>
                <p className="whitespace-pre-wrap leading-5 text-slate-200">{node.content}</p>
              </div>
            )}
            <div className="space-y-1 text-slate-500">
              <p>Created: {fmt(node.createdAt)}</p>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1 text-slate-500">
              <p>First seen: {fmt(node.firstSeenAt)}</p>
              <p>ID: <span className="break-all font-mono text-[10px] text-slate-400">{node.id}</span></p>
            </div>
          </>
        )}

        {node.type === 'supernode' && node.memberIds && (
          <div>
            <p className="mb-2 font-mono text-[0.625rem] font-medium uppercase tracking-[0.1em] text-slate-500">Members ({node.memberIds.length})</p>
            <ul className="space-y-1 text-slate-400">
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
    </aside>
  );
}
