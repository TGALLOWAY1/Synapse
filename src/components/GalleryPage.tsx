import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, FolderOpen, Image as ImageIcon, Loader2 } from 'lucide-react';
import {
    fetchPublicGalleryState,
    type PublicGalleryEntry,
    type PublicGalleryState,
} from '../lib/galleryStatus';
import { galleryProjectIdForSlot, DEMO_PROJECT_ID } from '../data/demoProject';

type GalleryPagePhase = 'loading' | 'ready' | 'failed';

const formatDate = (iso: string | undefined): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString();
};

function GalleryCard({ entry }: { entry: PublicGalleryEntry }) {
    const navigate = useNavigate();
    const projectId = galleryProjectIdForSlot(entry.slot);
    if (!projectId) return null;
    const images = (entry.imageCount ?? 0) + (entry.screenImageCount ?? 0);
    const date = formatDate(entry.createdAt);
    return (
        <button
            type="button"
            onClick={() => navigate(`/p/${projectId}`)}
            className="group text-left rounded-2xl border border-white/10 bg-white/[0.03] hover:border-indigo-400/50 hover:bg-indigo-500/[0.06] transition p-5 flex flex-col gap-2"
        >
            <div className="flex items-center gap-2 text-indigo-300">
                <FolderOpen size={16} />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    Project {entry.slot + 1}
                </span>
            </div>
            <div className="text-base font-semibold text-neutral-100 group-hover:text-white">
                {entry.title || entry.projectName || `Project ${entry.slot + 1}`}
            </div>
            <div className="text-xs text-neutral-400 flex items-center gap-3">
                {entry.projectName && entry.projectName !== entry.title && (
                    <span className="truncate">{entry.projectName}</span>
                )}
                {images > 0 && (
                    <span className="inline-flex items-center gap-1 shrink-0">
                        <ImageIcon size={12} />
                        {images} image{images === 1 ? '' : 's'}
                    </span>
                )}
                {date && <span className="shrink-0">{date}</span>}
            </div>
        </button>
    );
}

/**
 * Public project gallery — the multi-project upgrade of "View demo project".
 * Renders the owner's pinned showcase projects as cards; each card opens the
 * matching read-only gallery slot at `/p/<slot id>` (hydrated route-side by
 * `DemoRouteGate`, exactly like the demo).
 *
 * The gallery only presents itself once the owner has flipped the showcase
 * mode to 'gallery' (the go-live switch). Until then this page — reachable
 * only by typing the URL, since no entry surface links to it in demo mode —
 * redirects visitors to the classic demo project.
 */
export function GalleryPage() {
    const [phase, setPhase] = useState<GalleryPagePhase>('loading');
    const [state, setState] = useState<PublicGalleryState | null>(null);
    const navigate = useNavigate();

    useEffect(() => {
        if (phase !== 'loading') return;
        let cancelled = false;
        void fetchPublicGalleryState({ fresh: true }).then((result) => {
            if (cancelled) return;
            if (!result) {
                setPhase('failed');
                return;
            }
            if (result.mode !== 'gallery') {
                // Gallery isn't live — keep the classic demo experience.
                navigate(`/p/${DEMO_PROJECT_ID}`, { replace: true });
                return;
            }
            setState(result);
            setPhase('ready');
        });
        return () => {
            cancelled = true;
        };
    }, [phase, navigate]);

    if (phase === 'loading') {
        return (
            <div className="min-h-screen flex items-center justify-center px-6">
                <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 text-center">
                    <Loader2 className="animate-spin text-neutral-400" size={24} aria-hidden="true" />
                    <p className="text-sm text-neutral-400">Loading project gallery…</p>
                </div>
            </div>
        );
    }

    if (phase === 'failed' || !state) {
        return (
            <div className="min-h-screen flex items-center justify-center px-6">
                <div role="alert" className="max-w-md w-full text-center space-y-4">
                    <h2 className="text-xl font-semibold">Unable to load the gallery</h2>
                    <p className="text-sm text-neutral-400">
                        The project gallery couldn't be loaded right now. This is
                        usually a temporary connection issue.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        <button
                            type="button"
                            onClick={() => setPhase('loading')}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm hover:bg-indigo-700 transition"
                        >
                            Retry
                        </button>
                        <Link
                            to="/"
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/15 text-sm text-neutral-300 hover:border-white/30 hover:text-white transition"
                        >
                            Return home
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen px-6 py-10">
            <div className="max-w-4xl mx-auto space-y-8">
                <div className="space-y-3">
                    <Link
                        to="/"
                        className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-200 transition"
                    >
                        <ArrowLeft size={13} />
                        Home
                    </Link>
                    <h1 className="text-2xl font-semibold text-neutral-100">Project gallery</h1>
                    <p className="text-sm text-neutral-400 max-w-2xl">
                        A set of real projects built with Synapse — from a plain-language
                        idea to a structured PRD, mockups, and build-ready artifacts.
                        Every project is read-only; open one and explore its assets.
                    </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                    {state.entries.map((entry) => (
                        <GalleryCard key={entry.slot} entry={entry} />
                    ))}
                </div>
            </div>
        </div>
    );
}
