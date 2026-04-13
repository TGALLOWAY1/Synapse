import { useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { RecruiterDashboardItem } from '../lib/recruiterApi';
import { fetchRecruiters } from '../lib/recruiterApi';

type SortMode = 'recency' | 'engagement';

export function RecruiterAdminPage() {
  const [adminKey, setAdminKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('recency');
  const [recruiters, setRecruiters] = useState<RecruiterDashboardItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const items = [...recruiters];
    if (sortMode === 'engagement') {
      return items.sort((a, b) => (b.artifactGenerations + b.clickedSections) - (a.artifactGenerations + a.clickedSections));
    }
    return items.sort((a, b) => new Date(b.lastActiveAt || 0).getTime() - new Date(a.lastActiveAt || 0).getTime());
  }, [recruiters, sortMode]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRecruiters(adminKey);
      setRecruiters(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-6 text-neutral-100">
      <h1 className="text-2xl font-bold mb-4">Recruiter Dashboard</h1>
      <div className="flex gap-2 mb-4">
        <input
          type="password"
          placeholder="Admin key"
          value={adminKey}
          onChange={(e) => setAdminKey(e.target.value)}
          className="px-3 py-2 rounded bg-neutral-800 border border-neutral-700"
        />
        <button onClick={load} className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500">
          {loading ? 'Loading...' : 'Load recruiters'}
        </button>
        <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} className="px-3 py-2 rounded bg-neutral-800 border border-neutral-700">
          <option value="recency">Sort by recency</option>
          <option value="engagement">Sort by engagement</option>
        </select>
      </div>

      {error && <p className="text-rose-400 mb-3">{error}</p>}

      <div className="grid gap-3">
        {sorted.map((r) => {
          const recentlyActive = r.lastActiveAt && (Date.now() - new Date(r.lastActiveAt).getTime()) < 1000 * 60 * 60 * 24;
          const highEngagement = r.artifactGenerations + r.clickedSections >= 5;

          return (
            <div key={r.linkedinId} className={`rounded-xl border p-4 ${recentlyActive ? 'border-emerald-500/50' : 'border-neutral-700'} ${highEngagement ? 'bg-indigo-500/10' : 'bg-neutral-900/50'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{r.name}</p>
                  <a href={r.profileUrl || '#'} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline text-sm">
                    LinkedIn profile
                  </a>
                  <p className="text-sm text-neutral-300 mt-1">{r.headline || 'No headline available'}</p>
                  <p className="text-sm text-neutral-400">{r.company || 'Company unavailable'}</p>
                </div>
                <div className="text-right text-sm text-neutral-300">
                  <p>Sessions: {r.sessions || 0}</p>
                  <p>Artifacts: {r.artifactGenerations || 0}</p>
                  <p>Mockup views: {r.viewedMockups || 0}</p>
                </div>
              </div>
              <p className="text-xs text-neutral-400 mt-2">
                Last active: {r.lastActiveAt ? formatDistanceToNow(new Date(r.lastActiveAt), { addSuffix: true }) : 'Unknown'}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
