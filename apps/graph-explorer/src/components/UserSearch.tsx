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
    <div className="fixed inset-0 flex items-center justify-center bg-[#0f0f11] z-50">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 px-6 py-8 bg-[#16161a] rounded-2xl border border-white/10 shadow-2xl"
      >
        <div>
          <h1 className="text-lg font-semibold text-white">Memory Graph</h1>
          <p className="text-xs text-slate-500 mt-0.5">Enter a userId to explore their knowledge graph</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">User ID</label>
            <input
              type="text"
              value={userId}
              onChange={e => setUserId(e.target.value)}
              placeholder="+15551234567"
              className="w-full px-3 py-2 text-sm bg-[#0f0f11] border border-white/15 rounded-lg text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="ans_..."
              className="w-full px-3 py-2 text-sm bg-[#0f0f11] border border-white/15 rounded-lg text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              required
            />
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-950/40 border border-red-800/40 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white transition-colors"
        >
          {loading ? 'Loading…' : 'Explore Graph'}
        </button>
      </form>
    </div>
  );
}
