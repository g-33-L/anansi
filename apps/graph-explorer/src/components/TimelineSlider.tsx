interface Props {
  min: string; // ISO date
  max: string; // ISO date
  value: string | null;
  onChange: (v: string | null) => void;
}

export function TimelineSlider({ min, max, value, onChange }: Props) {
  const minMs = new Date(min).getTime();
  const maxMs = new Date(max).getTime();
  const span = maxMs - minMs;

  function handleRange(e: React.ChangeEvent<HTMLInputElement>) {
    const pct = Number(e.target.value) / 1000;
    const ts = new Date(minMs + pct * span).toISOString();
    onChange(ts);
  }

  const pct = value
    ? Math.round(((new Date(value).getTime() - minMs) / span) * 1000)
    : 1000;

  function formatDate(iso: string | null) {
    if (!iso) return 'now';
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-[#101925] via-[#101925]/96 to-transparent px-5 pb-4 pt-7">
      <div className="mb-2 flex items-center justify-between font-mono text-[0.625rem] uppercase tracking-[0.08em] text-slate-500">
        <span>{new Date(min).getFullYear()}</span>
        <span className="text-slate-300">
          {value ? `as of ${formatDate(value)}` : 'showing all'}
        </span>
        <button
          onClick={() => onChange(null)}
          aria-label="Reset temporal filter"
          className="text-slate-500 transition-colors hover:text-white"
        >
          Reset
        </button>
      </div>
      <input
        type="range"
        aria-label="Filter graph by date"
        min={0}
        max={1000}
        value={pct}
        onChange={handleRange}
        className="w-full cursor-pointer"
      />
    </div>
  );
}
