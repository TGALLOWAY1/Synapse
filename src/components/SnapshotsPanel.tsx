import { useEffect, useState } from 'react';
import { X, Save, Cloud, Trash2, Download, KeyRound, RefreshCw, Star } from 'lucide-react';
import {
    getOwnerToken, setOwnerToken,
    saveSnapshot, listSnapshots, loadSnapshot, restoreSnapshot, deleteSnapshot,
    setDemoSnapshot,
    type SnapshotListItem,
    type SnapshotProgress,
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
    const [demoSnapshotId, setDemoSnapshotIdState] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [saveProgress, setSaveProgress] = useState<SnapshotProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notices, setNotices] = useState<string[]>([]);
    const [title, setTitle] = useState<string>(project?.name ?? 'Untitled');

    const refresh = async () => {
        if (!getOwnerToken()) return;
        setBusy('listing');
        setError(null);
        try {
            const result = await listSnapshots();
            setSnapshots(result.snapshots);
            setDemoSnapshotIdState(result.demoSnapshotId);
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
        setSaveProgress(null);
        setError(null);
        setNotices([]);
        try {
            await saveSnapshot(
                projectId,
                title.trim() || 'Untitled',
                (p) => setSaveProgress(p),
                (warnings) => setNotices(warnings),
            );
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
            setSaveProgress(null);
        }
    };

    const saveButtonLabel = (() => {
        if (busy !== 'saving') return 'Save';
        if (!saveProgress) return 'Saving…';
        if (saveProgress.phase === 'bundle') return 'Saving…';
        if (saveProgress.total === 0) return 'Saving…';
        return `Image ${saveProgress.completed}/${saveProgress.total}…`;
    })();

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

    // Pin (or unpin) a snapshot as the public demo project. The "Demo project"
    // button on the home page fetches whichever snapshot is pinned here via
    // the public `?demo=1` endpoint, so no owner token is needed to view it.
    const handleSetDemo = async (id: string) => {
        const willClear = demoSnapshotId === id;
        const confirmMsg = willClear
            ? 'Unset this snapshot as the public demo? The "View demo project" button will stop working until another snapshot is set.'
            : 'Make this snapshot the public demo? Any visitor (no owner token required) will be able to load it from the home page.';
        if (!confirm(confirmMsg)) return;
        setBusy(`demo:${id}`);
        setError(null);
        try {
            const next = await setDemoSnapshot(willClear ? null : id);
            setDemoSnapshotIdState(next);
            setSnapshots((prev) =>
                prev ? prev.map((s) => ({ ...s, isDemo: s.id === next })) : prev,
            );
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
                                    Bundles this project&rsquo;s spine versions, branches, artifacts, implementation tasks, orchestration metrics, and both AI-generated mockup images and uploaded screen-inventory images, then stores it in Vercel Blob.
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
                                        {saveButtonLabel}
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
                                    {snapshots.map((s) => {
                                        const isDemo = s.id === demoSnapshotId;
                                        return (
                                            <li
                                                key={s.id}
                                                className={`border rounded-md px-3 py-2.5 transition ${
                                                    isDemo
                                                        ? 'border-amber-500/50 bg-amber-500/5 hover:bg-amber-500/10'
                                                        : 'border-neutral-800 bg-neutral-900 hover:bg-neutral-800/50'
                                                }`}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="text-sm text-neutral-100 font-medium truncate flex items-center gap-2">
                                                            {s.title}
                                                            {isDemo && (
                                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide text-amber-300 bg-amber-500/15 border border-amber-500/30">
                                                                    <Star size={9} className="fill-amber-300" />
                                                                    Demo
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-[11px] text-neutral-500 mt-0.5">
                                                            {(() => {
                                                                const total = s.imageCount + (s.screenImageCount ?? 0);
                                                                return `${s.projectName} · ${formatDate(s.createdAt)} · ${total} image${total === 1 ? '' : 's'} · ${formatBytes(s.sizeBytes)}`;
                                                            })()}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        <button
                                                            onClick={() => handleSetDemo(s.id)}
                                                            disabled={busy !== null}
                                                            className={`flex items-center gap-1 px-2 py-1 text-xs rounded disabled:opacity-40 ${
                                                                isDemo
                                                                    ? 'text-amber-300 bg-amber-500/15 hover:bg-amber-500/25'
                                                                    : 'text-neutral-300 bg-neutral-800 hover:bg-neutral-700'
                                                            }`}
                                                            title={isDemo ? 'Unset as public demo' : 'Set as public demo project'}
                                                        >
                                                            <Star size={12} className={isDemo ? 'fill-amber-300' : ''} />
                                                            {busy === `demo:${s.id}`
                                                                ? '…'
                                                                : isDemo
                                                                    ? 'Demo'
                                                                    : 'Set demo'}
                                                        </button>
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
                                        );
                                    })}
                                </ul>
                            )}
                        </>
                    )}

                    {error && (
                        <div className="mt-4 px-3 py-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded">
                            {error}
                        </div>
                    )}
                    {notices.length > 0 && (
                        <div className="mt-4 px-3 py-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded">
                            <div className="font-medium mb-1">Saved with a note</div>
                            <ul className="list-disc list-inside space-y-0.5 text-amber-200/90">
                                {notices.map((n, i) => <li key={i}>{n}</li>)}
                            </ul>
                            <p className="mt-1.5 text-amber-200/70">
                                The screen specs and mockup metadata are still saved — only some
                                variant images were left out.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
