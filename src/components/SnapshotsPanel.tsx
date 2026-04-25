import { useEffect, useState } from 'react';
import { X, Save, Cloud, Trash2, Download, KeyRound, RefreshCw } from 'lucide-react';
import {
    getOwnerToken, setOwnerToken,
    saveSnapshot, listSnapshots, loadSnapshot, restoreSnapshot, deleteSnapshot,
    type SnapshotListItem,
} from '../lib/snapshotClient';
import { useProjectStore } from '../store/projectStore';

interface SnapshotsPanelProps {
    projectId: string;
    onClose: () => void;
    onRestored?: (projectId: string) => void;
}

const formatBytes = (n: number | undefined): string => {
    if (!n || n <= 0) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};

const formatDate = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
};

export function SnapshotsPanel({ projectId, onClose, onRestored }: SnapshotsPanelProps) {
    const project = useProjectStore((s) => s.projects[projectId]);

    const [token, setTokenState] = useState<string>(getOwnerToken() ?? '');
    const [tokenDraft, setTokenDraft] = useState<string>(token);
    const [snapshots, setSnapshots] = useState<SnapshotListItem[] | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [title, setTitle] = useState<string>(project?.name ?? 'Untitled');

    const refresh = async () => {
        if (!getOwnerToken()) return;
        setBusy('listing');
        setError(null);
        try {
            const items = await listSnapshots();
            setSnapshots(items);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    };

    useEffect(() => {
        if (token) refresh();
    }, [token]);

    const handleSaveToken = () => {
        const trimmed = tokenDraft.trim();
        setOwnerToken(trimmed);
        setTokenState(trimmed);
    };

    const handleClearToken = () => {
        setOwnerToken('');
        setTokenState('');
        setTokenDraft('');
        setSnapshots(null);
    };

    const handleSave = async () => {
        setBusy('saving');
        setError(null);
        try {
            await saveSnapshot(projectId, title.trim() || 'Untitled');
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    };

    const handleLoad = async (id: string) => {
        if (!confirm('Loading will replace the current copy of this project in the workspace. Continue?')) return;
        setBusy(`loading:${id}`);
        setError(null);
        try {
            const payload = await loadSnapshot(id);
            const restoredId = await restoreSnapshot(payload);
            onRestored?.(restoredId);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this snapshot from cloud storage? This cannot be undone.')) return;
        setBusy(`deleting:${id}`);
        setError(null);
        try {
            await deleteSnapshot(id);
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <div
                className="bg-neutral-900 border border-neutral-700 rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
                    <div className="flex items-center gap-2">
                        <Cloud size={18} className="text-indigo-400" />
                        <h2 className="text-base font-semibold text-neutral-100">Cloud snapshots</h2>
                    </div>
                    <button onClick={onClose} className="text-neutral-400 hover:text-white" aria-label="Close">
                        <X size={18} />
                    </button>
                </div>

                <div className="px-5 py-4 overflow-y-auto">
                    {!token && (
                        <div className="rounded-md border border-neutral-700 bg-neutral-800/50 p-4 mb-4">
                            <div className="flex items-center gap-2 text-sm text-neutral-200 font-medium mb-1">
                                <KeyRound size={14} className="text-amber-400" />
                                Owner token required
                            </div>
                            <p className="text-xs text-neutral-400 mb-3">
                                Snapshots are an owner-only feature. Paste the value of <code className="text-amber-300">SYNAPSE_OWNER_TOKEN</code> from your Vercel project env. The token stays in your browser&rsquo;s localStorage.
                            </p>
                            <div className="flex gap-2">
                                <input
                                    type="password"
                                    value={tokenDraft}
                                    onChange={(e) => setTokenDraft(e.target.value)}
                                    placeholder="Paste owner token"
                                    className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-100 focus:outline-none focus:border-indigo-500"
                                />
                                <button
                                    onClick={handleSaveToken}
                                    disabled={!tokenDraft.trim()}
                                    className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded transition"
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    )}

                    {token && (
                        <>
                            <div className="rounded-md border border-neutral-700 bg-neutral-800/50 p-4 mb-4">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2 text-sm text-neutral-200 font-medium">
                                        <Save size={14} className="text-emerald-400" />
                                        Save current project
                                    </div>
                                    <button
                                        onClick={handleClearToken}
                                        className="text-[11px] text-neutral-500 hover:text-neutral-300 underline"
                                    >
                                        forget token
                                    </button>
                                </div>
                                <p className="text-xs text-neutral-400 mb-3">
                                    Bundles this project&rsquo;s spine versions, branches, artifacts, and any AI-generated mockup images, then stores it in Vercel Blob.
                                </p>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={title}
                                        onChange={(e) => setTitle(e.target.value)}
                                        placeholder="Snapshot title"
                                        className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-100 focus:outline-none focus:border-indigo-500"
                                    />
                                    <button
                                        onClick={handleSave}
                                        disabled={busy === 'saving' || !title.trim()}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded transition"
                                    >
                                        <Save size={14} />
                                        {busy === 'saving' ? 'Saving…' : 'Save'}
                                    </button>
                                </div>
                            </div>

                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm font-medium text-neutral-200">Saved snapshots</h3>
                                <button
                                    onClick={refresh}
                                    disabled={busy === 'listing'}
                                    className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200 disabled:opacity-40"
                                >
                                    <RefreshCw size={12} className={busy === 'listing' ? 'animate-spin' : ''} />
                                    Refresh
                                </button>
                            </div>

                            {snapshots === null && busy === 'listing' && (
                                <div className="text-xs text-neutral-500 py-4 text-center">Loading…</div>
                            )}
                            {snapshots !== null && snapshots.length === 0 && (
                                <div className="text-xs text-neutral-500 py-6 text-center border border-dashed border-neutral-800 rounded">
                                    No snapshots saved yet.
                                </div>
                            )}
                            {snapshots !== null && snapshots.length > 0 && (
                                <ul className="space-y-2">
                                    {snapshots.map((s) => (
                                        <li
                                            key={s.id}
                                            className="border border-neutral-800 rounded-md px-3 py-2.5 bg-neutral-900 hover:bg-neutral-800/50 transition"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-sm text-neutral-100 font-medium truncate">{s.title}</div>
                                                    <div className="text-[11px] text-neutral-500 mt-0.5">
                                                        {s.projectName} &middot; {formatDate(s.createdAt)} &middot; {s.imageCount} image{s.imageCount === 1 ? '' : 's'} &middot; {formatBytes(s.sizeBytes)}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button
                                                        onClick={() => handleLoad(s.id)}
                                                        disabled={busy !== null}
                                                        className="flex items-center gap-1 px-2 py-1 text-xs text-neutral-200 bg-neutral-800 hover:bg-neutral-700 rounded disabled:opacity-40"
                                                        title="Load into workspace"
                                                    >
                                                        <Download size={12} />
                                                        {busy === `loading:${s.id}` ? 'Loading…' : 'Load'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(s.id)}
                                                        disabled={busy !== null}
                                                        className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded disabled:opacity-40"
                                                        title="Delete from cloud"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}

                    {error && (
                        <div className="mt-4 px-3 py-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded">
                            {error}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
