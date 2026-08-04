import { useState } from 'react';

interface Props {
  onLoad: (userId: string, apiKey: string) => void;
  loading: boolean;
  error: string | null;
}

export function UserSearch({ onLoad, loading, error }: Props) {
  const [userId, setUserId] = useState('');
  const [apiKey, setApiKey] = useState(import.meta.env.VITE_ANANSI_API_KEY ?? '');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (userId.trim() && apiKey.trim()) {
      onLoad(userId.trim(), apiKey.trim());
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#f6f5f0] p-5 text-[#151b24]">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-6 rounded-xl border border-[#d8d9d2] bg-white px-6 py-7 shadow-[0_24px_64px_rgb(21_27_36/0.12)] sm:px-8 sm:py-9"
      >
        <div>
          <p className="font-mono text-[0.625rem] font-medium uppercase tracking-[0.12em] text-[#315ef4]">Anansi / research view</p>
          <h1 className="mt-2 font-display text-4xl font-medium tracking-[-0.04em] text-[#151b24]">Knowledge map</h1>
          <p className="mt-2 text-sm leading-6 text-[#667085]">Open a subject’s entity topology, evidence, and temporal history.</p>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="graph-user-id" className="mb-1.5 block text-xs font-semibold text-[#344054]">User ID</label>
            <input
              id="graph-user-id"
              type="text"
              value={userId}
              onChange={e => setUserId(e.target.value)}
              placeholder="+15551234567"
              className="w-full rounded-md border border-[#c6c8c1] bg-white px-3 py-2.5 text-sm text-[#151b24] placeholder:text-[#98a2b3] focus:border-[#315ef4] focus:outline-none focus:ring-2 focus:ring-[#315ef4]/20"
              required
            />
          </div>

          <div>
            <label htmlFor="graph-api-key" className="mb-1.5 block text-xs font-semibold text-[#344054]">API key</label>
            <input
              id="graph-api-key"
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="ans_..."
              className="w-full rounded-md border border-[#c6c8c1] bg-white px-3 py-2.5 text-sm text-[#151b24] placeholder:text-[#98a2b3] focus:border-[#315ef4] focus:outline-none focus:ring-2 focus:ring-[#315ef4]/20"
              required
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-[#f4c7c3] bg-[#fff1f0] px-3 py-2 text-xs text-[#9f1c13]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md border border-[#315ef4] bg-[#315ef4] py-2.5 text-sm font-medium text-white shadow-sm transition-[background-color,transform] hover:bg-[#254ad4] disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-px"
        >
          {loading ? 'Loading…' : 'Explore Graph'}
        </button>
      </form>
    </div>
  );
}
