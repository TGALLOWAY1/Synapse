import { useEffect, useState } from 'react';
import { X, Save, Cloud, Trash2, Download, KeyRound, RefreshCw, Star, LayoutGrid, ChevronUp, ChevronDown } from 'lucide-react';
import {
    getOwnerToken, setOwnerToken,
    saveSnapshot, listSnapshots, loadSnapshot, restoreSnapshot, deleteSnapshot,
    setDemoSnapshot, addGallerySnapshot, removeGallerySnapshot, setGalleryMode,
    reorderGallerySnapshots,
    type GalleryInfo,
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
    const [gallery, setGallery] = useState<GalleryInfo | null>(null);
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
            setGallery(result.gallery);
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

    // SYN-003 — pin-time completeness HARD GATE (no override; pre-launch, the
    // owner's recourse is to regenerate the images + re-save). A publicly
    // pinned snapshot whose mockup spec describes screens but carries 0
    // rendered images would render "Generated" cards with no image — refuse
    // to pin it, whether the target is the demo pointer or a gallery slot.
    // (The server backstops this with a 422; this is the fast, explanatory
    // client block.) `mockupScreenCount === 0` (a legitimate PRD-only
    // showcase) pins cleanly. Returns null when the pin may proceed.
    const completenessGateError = (id: string): string | null => {
        const snapshot = snapshots?.find((s) => s.id === id);
        const totalImages = snapshot
            ? snapshot.imageCount + (snapshot.screenImageCount ?? 0) + (snapshot.variantImageCount ?? 0)
            : 0;
        const mockupScreenCount = snapshot?.mockupScreenCount;
        if (mockupScreenCount !== undefined && mockupScreenCount > 0 && totalImages === 0) {
            return (
                `This snapshot's mockup spec describes ${mockupScreenCount} screen`
                + `${mockupScreenCount === 1 ? '' : 's'} but contains 0 rendered images — `
                + 'it would claim mockups it can’t show. Generate the images, save a '
                + 'new snapshot, and pin that.'
            );
        }
        if (mockupScreenCount === undefined && totalImages === 0) {
            // Legacy snapshot with no completeness metadata and no images —
            // block and ask for a re-save so Synapse can verify it.
            return (
                'This snapshot has 0 rendered images and predates image-completeness '
                + 'tracking, so Synapse can’t verify its mockups. Re-save this snapshot '
                + 'with the current app version, then pin the new snapshot.'
            );
        }
        return null;
    };

    // Pin (or unpin) a snapshot as the public demo project. The "Demo project"
    // button on the home page fetches whichever snapshot is pinned here via
    // the public `?demo=1` endpoint, so no owner token is needed to view it.
    const handleSetDemo = async (id: string) => {
        const willClear = demoSnapshotId === id;

        // Unpinning is never gated.
        if (!willClear) {
            const gateError = completenessGateError(id);
            if (gateError) {
                setError(gateError);
                return;
            }
        }

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

    // Add / remove a snapshot in the project gallery. Adding shares the same
    // SYN-003 completeness gate as pinning the demo — a gallery slot is just
    // as public. Removal is never gated.
    const handleToggleGallery = async (id: string) => {
        const inGallery = gallery?.snapshotIds.includes(id) ?? false;
        if (!inGallery) {
            const gateError = completenessGateError(id);
            if (gateError) {
                setError(gateError);
                return;
            }
        } else if (gallery?.mode === 'gallery' && gallery.snapshotIds.length - 1 < gallery.minLive) {
            // Removing this slot drops a LIVE gallery below the go-live
            // minimum, so the server demotes the showcase back to demo mode —
            // make that consequence explicit before proceeding. Removals that
            // stay at or above the minimum leave the gallery live.
            const confirmed = confirm(
                'Removing this snapshot takes the live gallery below '
                + `${gallery.minLive} projects, so the public showcase will switch back to the `
                + 'single demo project. The remaining slots are kept — re-fill and go '
                + 'live again when ready. Continue?',
            );
            if (!confirmed) return;
        }
        setBusy(`gallery:${id}`);
        setError(null);
        try {
            const next = inGallery
                ? await removeGallerySnapshot(id)
                : await addGallerySnapshot(id);
            setGallery(next);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    };

    // The go-live switch. Flipping to gallery mode swaps the public
    // "View demo project" entry for the project gallery; the server refuses
    // the flip until at least `minLive` snapshots are pinned, so an
    // accidental early toggle can't publish a near-empty gallery.
    const handleToggleGalleryMode = async () => {
        if (!gallery) return;
        const nextMode = gallery.mode === 'gallery' ? 'demo' : 'gallery';
        const confirmMsg = nextMode === 'gallery'
            ? `Go live with the project gallery? Visitors will see the ${gallery.snapshotIds.length}-project gallery instead of the single demo project.`
            : 'Switch back to single-demo mode? Visitors will see the pinned demo project again; the gallery keeps its slots for the next go-live.';
        if (!confirm(confirmMsg)) return;
        setBusy('gallery-mode');
        setError(null);
        try {
            setGallery(await setGalleryMode(nextMode));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    };

    // Move one gallery slot up or down. The server takes the full new order
    // (an exact permutation of the current ids), so a stale panel gets a
    // clean 400 instead of silently corrupting the slot list.
    const handleMoveGallerySlot = async (index: number, direction: -1 | 1) => {
        if (!gallery) return;
        const target = index + direction;
        if (target < 0 || target >= gallery.snapshotIds.length) return;
        const order = [...gallery.snapshotIds];
        [order[index], order[target]] = [order[target], order[index]];
        setBusy(`gallery-order:${index}`);
        setError(null);
        try {
            setGallery(await reorderGallerySnapshots(order));
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

                            {gallery && (
                                <div className={`rounded-md border p-4 mb-4 ${
                                    gallery.mode === 'gallery'
                                        ? 'border-emerald-500/40 bg-emerald-500/5'
                                        : 'border-neutral-700 bg-neutral-800/50'
                                }`}>
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 text-sm text-neutral-200 font-medium mb-1">
                                                <LayoutGrid size={14} className={gallery.mode === 'gallery' ? 'text-emerald-400' : 'text-indigo-400'} />
                                                Public showcase: {gallery.mode === 'gallery' ? 'project gallery (live)' : 'single demo project'}
                                            </div>
                                            <p className="text-xs text-neutral-400">
                                                {gallery.mode === 'gallery'
                                                    ? `Visitors see the ${gallery.snapshotIds.length}-project gallery (room for ${gallery.size}). Switching back to demo mode keeps the slots.`
                                                    : `Pin snapshots into gallery slots (${gallery.snapshotIds.length} pinned, up to ${gallery.size}). Go live once you have at least ${gallery.minLive} to replace the single demo with the project gallery.`}
                                            </p>
                                        </div>
                                        <button
                                            onClick={handleToggleGalleryMode}
                                            disabled={busy !== null || (gallery.mode === 'demo' && gallery.snapshotIds.length < gallery.minLive)}
                                            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition disabled:opacity-40 ${
                                                gallery.mode === 'gallery'
                                                    ? 'text-neutral-200 bg-neutral-800 hover:bg-neutral-700'
                                                    : 'text-white bg-emerald-600 hover:bg-emerald-500'
                                            }`}
                                            title={gallery.mode === 'demo' && gallery.snapshotIds.length < gallery.minLive
                                                ? `Pin at least ${gallery.minLive} snapshots to enable go-live`
                                                : undefined}
                                        >
                                            {busy === 'gallery-mode'
                                                ? '…'
                                                : gallery.mode === 'gallery'
                                                    ? 'Switch to demo mode'
                                                    : 'Go live with gallery'}
                                        </button>
                                    </div>
                                    {gallery.snapshotIds.length > 0 && (
                                        <ul className="mt-3 space-y-1">
                                            {gallery.snapshotIds.map((snapshotId, index) => {
                                                const snapshot = snapshots?.find((s) => s.id === snapshotId);
                                                return (
                                                    <li
                                                        key={snapshotId}
                                                        className="flex items-center gap-2 rounded border border-neutral-800 bg-neutral-900/60 px-2 py-1"
                                                    >
                                                        <span className="text-[10px] font-semibold text-emerald-300 w-6 shrink-0">#{index + 1}</span>
                                                        <span className="text-xs text-neutral-200 truncate flex-1">
                                                            {snapshot?.title ?? snapshotId}
                                                        </span>
                                                        <button
                                                            onClick={() => handleMoveGallerySlot(index, -1)}
                                                            disabled={busy !== null || index === 0}
                                                            className="text-neutral-400 hover:text-neutral-100 disabled:opacity-30 p-0.5"
                                                            title="Move up"
                                                            aria-label={`Move gallery slot ${index + 1} up`}
                                                        >
                                                            <ChevronUp size={13} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleMoveGallerySlot(index, 1)}
                                                            disabled={busy !== null || index === gallery.snapshotIds.length - 1}
                                                            className="text-neutral-400 hover:text-neutral-100 disabled:opacity-30 p-0.5"
                                                            title="Move down"
                                                            aria-label={`Move gallery slot ${index + 1} down`}
                                                        >
                                                            <ChevronDown size={13} />
                                                        </button>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </div>
                            )}

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
                                        const gallerySlot = gallery ? gallery.snapshotIds.indexOf(s.id) : -1;
                                        const inGallery = gallerySlot !== -1;
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
                                                            {inGallery && (
                                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide text-emerald-300 bg-emerald-500/15 border border-emerald-500/30">
                                                                    <LayoutGrid size={9} />
                                                                    Gallery #{gallerySlot + 1}
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
                                                            onClick={() => handleToggleGallery(s.id)}
                                                            disabled={busy !== null
                                                                || (!inGallery && gallery !== null && gallery.snapshotIds.length >= gallery.size)}
                                                            className={`flex items-center gap-1 px-2 py-1 text-xs rounded disabled:opacity-40 ${
                                                                inGallery
                                                                    ? 'text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25'
                                                                    : 'text-neutral-300 bg-neutral-800 hover:bg-neutral-700'
                                                            }`}
                                                            title={inGallery
                                                                ? 'Remove from the project gallery'
                                                                : gallery !== null && gallery.snapshotIds.length >= gallery.size
                                                                    ? 'Gallery is full — remove a snapshot first'
                                                                    : 'Add to the project gallery'}
                                                        >
                                                            <LayoutGrid size={12} />
                                                            {busy === `gallery:${s.id}`
                                                                ? '…'
                                                                : inGallery
                                                                    ? `#${gallerySlot + 1}`
                                                                    : 'Gallery'}
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
                                preview images may be missing.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
