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
    <div className="absolute bottom-0 left-0 right-0 px-6 pb-4 pt-3 bg-gradient-to-t from-[#0f0f11] to-transparent z-10">
      <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
        <span>{new Date(min).getFullYear()}</span>
        <span className="text-slate-300">
          {value ? `as of ${formatDate(value)}` : 'showing all'}
        </span>
        <button
          onClick={() => onChange(null)}
          className="text-slate-500 hover:text-white transition-colors"
        >
          Reset
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={1000}
        value={pct}
        onChange={handleRange}
        className="w-full accent-indigo-500 cursor-pointer"
      />
    </div>
  );
}
