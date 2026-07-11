import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Sparkles, Check, ArrowUp, MessageSquareText, AlertTriangle, Loader2, RefreshCcw, Clock, Images } from 'lucide-react';
import type { MockupImageRecord, MockupPayload, MockupScreen, MockupSettings } from '../../types';
import type { DependencyNodeStatus } from '../../lib/artifactDependencyGraph';
import { useMockupImageStore } from '../../store/mockupImageStore';
import { useScreenInventoryImageStore } from '../../store/screenInventoryImageStore';
import { buildScreenScopeKey } from '../../lib/mockupImageStore';
import { slugifyScreenName } from '../../lib/screenInventoryImageStore';
import { computeMockupImageCompletion, type ScreenImageState } from '../../lib/mockupImageCompletion';
import { FreshnessBadge } from '../FreshnessBadge';
import { MockupScreenImage } from './MockupScreenImage';
import { MockupPromptDialog } from './MockupPromptDialog';
import { useIsMobile } from '../../lib/useIsMobile';

type Props = {
    payload: MockupPayload;
    settings: MockupSettings;
    staleness?: DependencyNodeStatus;
    versionNumber: number;
    createdAt: number;
    sourceSpineVersionId?: string;
    actions?: React.ReactNode;
    versionId?: string;
    projectId?: string;
    artifactId?: string;
};

const QUALITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(ts: number): string {
    return new Date(ts).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
}

function pickPreviewRecord(records: MockupImageRecord[]): MockupImageRecord | undefined {
    if (records.length === 0) return undefined;
    return records.reduce<MockupImageRecord>(
        (best, r) => (QUALITY_RANK[r.quality] > QUALITY_RANK[best.quality] ? r : best),
        records[0],
    );
}

function pageAnchorId(versionId: string | undefined, screen: MockupScreen, idx: number): string {
    const base = versionId ?? 'mockup';
    return `mockup-page-${base}-${screen.id ?? idx}`;
}

/**
 * Tiny thumbnail rendered inside the Pages navigator. Reads from the
 * mockup-image-store (AI) and screen-inventory-image-store (uploaded) so the
 * navigator mirrors whatever the user is actually viewing below. If no image
 * exists yet, falls back to a neutral placeholder so the row still aligns.
 */
function PageThumb({ versionId, screen }: { versionId?: string; screen: MockupScreen }) {
    const aiImages = useMockupImageStore((s) => s.images);
    const uploads = useScreenInventoryImageStore((s) => s.images);

    const src = useMemo(() => {
        if (!versionId) return null;
        const slug = slugifyScreenName(screen.name);
        const upload = Object.values(uploads).find(
            (u) => u.artifactVersionId === versionId && u.screenSlug === slug && u.isPreferred,
        );
        if (upload) return upload.dataUrl;
        const aiScope = buildScreenScopeKey(versionId, screen.id);
        const matching: MockupImageRecord[] = [];
        for (const k of Object.keys(aiImages)) {
            if (k.startsWith(aiScope)) matching.push(aiImages[k]);
        }
        const best = pickPreviewRecord(matching);
        return best?.dataUrl ?? null;
    }, [versionId, aiImages, uploads, screen.id, screen.name]);

    if (!src) {
        return (
            <div className="w-16 h-12 sm:w-20 sm:h-14 rounded-md bg-neutral-100 border border-neutral-200 shrink-0" />
        );
    }
    return (
        <div className="w-16 h-12 sm:w-20 sm:h-14 rounded-md overflow-hidden border border-neutral-200 bg-neutral-900 shrink-0">
            <img src={src} alt="" className="w-full h-full object-cover" />
        </div>
    );
}

/**
 * Per-page footer: simple "AI Generated · date" plus a "view prompt" icon
 * button that opens the prompt used to create the image. Only shown when an
 * image actually exists for this screen — empty/loading states are rendered
 * by MockupScreenImage itself.
 */
function PageImageFooter({ versionId, screen }: { versionId?: string; screen: MockupScreen }) {
    const aiImages = useMockupImageStore((s) => s.images);
    const uploads = useScreenInventoryImageStore((s) => s.images);
    const [promptOpen, setPromptOpen] = useState(false);

    const info = useMemo(() => {
        if (!versionId) return null;
        const slug = slugifyScreenName(screen.name);
        const upload = Object.values(uploads).find(
            (u) => u.artifactVersionId === versionId && u.screenSlug === slug && u.isPreferred,
        );
        if (upload) {
            return { label: 'Uploaded', generatedAt: upload.generatedAt, prompt: upload.prompt ?? '' };
        }
        const aiScope = buildScreenScopeKey(versionId, screen.id);
        const matching: MockupImageRecord[] = [];
        for (const k of Object.keys(aiImages)) {
            if (k.startsWith(aiScope)) matching.push(aiImages[k]);
        }
        const best = pickPreviewRecord(matching);
        if (!best) return null;
        return { label: 'AI Generated', generatedAt: best.generatedAt, prompt: best.prompt ?? '' };
    }, [versionId, aiImages, uploads, screen.id, screen.name]);

    if (!info) return null;
    const hasPrompt = info.prompt.length > 0;
    return (
        <>
            <div className="px-5 py-2.5 border-t border-neutral-100 bg-neutral-50/60 flex items-center gap-2 flex-wrap text-[11px]">
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 font-medium">
                    <Sparkles size={10} />
                    {info.label}
                </span>
                <span className="text-neutral-500">{formatDateTime(info.generatedAt)}</span>
                <button
                    type="button"
                    onClick={() => setPromptOpen(true)}
                    disabled={!hasPrompt}
                    className="ml-auto inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-neutral-500 hover:text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    aria-label={`View prompt for ${screen.name}`}
                    title={hasPrompt ? 'View image prompt' : 'No prompt recorded for this image'}
                >
                    <MessageSquareText size={13} />
                    <span className="text-[11px] font-medium hidden sm:inline">Prompt</span>
                </button>
            </div>
            <MockupPromptDialog
                open={promptOpen}
                onClose={() => setPromptOpen(false)}
                screenName={screen.name}
                prompt={info.prompt}
            />
        </>
    );
}

/**
 * The mockups page. Treats the artifact as a document whose chapters are the
 * screens: a collapsible "Pages" table-of-contents at the top, then every
 * screen rendered in order. An IntersectionObserver tracks which screen is in
 * view so the navigator stays in sync as the user scrolls.
 *
 * On mobile, once the navigator scrolls out of view a floating "Pages" button
 * reopens it (uncollapsing if needed) so the user never loses navigation.
 */
export function MockupViewer({
    payload,
    settings,
    staleness,
    versionNumber,
    createdAt,
    sourceSpineVersionId,
    actions,
    versionId,
    projectId,
    artifactId,
}: Props) {
    const aiImageEnabled = !!(projectId && artifactId && versionId);
    const isMobile = useIsMobile();

    const screens = payload.screens;

    // --- Two-phase completion: the spec exists (this version), but the visual
    // (image) delivery can be partial or have failures. Compute it so the
    // header reflects real image status instead of a flat "AI Generated". ---
    const aiImages = useMockupImageStore((s) => s.images);
    const imgErrors = useMockupImageStore((s) => s.errors);
    const imgInFlight = useMockupImageStore((s) => s.inFlight);
    const generateImage = useMockupImageStore((s) => s.generate);
    const clearImageError = useMockupImageStore((s) => s.clearError);
    const uploadsForCompletion = useScreenInventoryImageStore((s) => s.images);

    const completion = useMemo(() => {
        if (!aiImageEnabled || !versionId) return null;
        const states: ScreenImageState[] = screens.map((screen) => {
            const scope = buildScreenScopeKey(versionId, screen.id);
            const hasAi = Object.keys(aiImages).some((k) => k.startsWith(scope));
            const slug = slugifyScreenName(screen.name);
            const hasUpload = Object.values(uploadsForCompletion).some(
                (r) => r.artifactVersionId === versionId && r.screenSlug === slug && r.isPreferred,
            );
            const generated = hasAi || hasUpload;
            return {
                screenId: screen.id,
                generated,
                generating: !generated && !!imgInFlight[scope],
                failed: !generated && !imgInFlight[scope] && !!imgErrors[scope],
            };
        });
        return computeMockupImageCompletion(states);
    }, [aiImageEnabled, versionId, screens, aiImages, uploadsForCompletion, imgInFlight, imgErrors]);

    const retryFailedImages = () => {
        if (!completion || !versionId || !projectId || !artifactId) return;
        for (const screenId of completion.failedScreenIds) {
            const screen = screens.find((s) => s.id === screenId);
            if (!screen) continue;
            clearImageError(versionId, screenId);
            void generateImage({ projectId, artifactId, versionId, screen, payload, settings, quality: 'low' });
        }
    };

    // Pages navigator: collapsed on mobile once the user picks a row so the
    // long page list doesn't trap them at the top.
    const [navOpen, setNavOpen] = useState(true);
    const [activeIdx, setActiveIdx] = useState(0);

    const navRef = useRef<HTMLDivElement | null>(null);
    const sectionRefs = useRef<Array<HTMLElement | null>>([]);
    const [showFloatingNav, setShowFloatingNav] = useState(false);
    const [descExpanded, setDescExpanded] = useState(false);

    // Track which page is most visible. We score each section by the
    // intersection ratio of its top quarter so a tall page that's just leaving
    // the viewport doesn't keep "winning" over the next one.
    useEffect(() => {
        if (typeof IntersectionObserver === 'undefined') return;
        const observer = new IntersectionObserver(
            (entries) => {
                let best: { idx: number; ratio: number } | null = null;
                for (const entry of entries) {
                    const idxAttr = entry.target.getAttribute('data-page-idx');
                    if (idxAttr === null) continue;
                    const idx = Number(idxAttr);
                    if (Number.isNaN(idx)) continue;
                    if (entry.isIntersecting) {
                        if (!best || entry.intersectionRatio > best.ratio) {
                            best = { idx, ratio: entry.intersectionRatio };
                        }
                    }
                }
                if (best) setActiveIdx(best.idx);
            },
            // Top quarter of the viewport: a section is "active" once its
            // header has reached the top fifth of the page.
            { rootMargin: '-15% 0px -60% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
        );
        for (const el of sectionRefs.current) {
            if (el) observer.observe(el);
        }
        return () => observer.disconnect();
    }, [screens.length]);

    // Show the floating "Pages" button (mobile only) once the navigator card
    // has scrolled out of view.
    useEffect(() => {
        if (typeof IntersectionObserver === 'undefined') return;
        const el = navRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                setShowFloatingNav(!entry.isIntersecting);
            },
            { threshold: 0 },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const handleSelectPage = (idx: number) => {
        setActiveIdx(idx);
        const section = sectionRefs.current[idx];
        if (section) {
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        // On mobile, collapse the navigator after a tap so the page itself is
        // the next thing on screen — the floating button handles re-opening.
        if (isMobile) setNavOpen(false);
    };

    const handleOpenFloatingNav = () => {
        setNavOpen(true);
        if (navRef.current) {
            navRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    if (screens.length === 0) {
        return (
            <div className="bg-white rounded-xl border border-neutral-200 p-6 text-sm text-neutral-500">
                This mockup version has no screens.
            </div>
        );
    }

    const pageCountLabel = `${screens.length} ${screens.length === 1 ? 'Page' : 'Pages'}`;

    return (
        <>
            <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
                {/* --- Artifact header ------------------------------------ */}
                <div className="px-5 pt-5 pb-4 border-b border-neutral-100">
                    <h3 className="text-base font-bold text-neutral-900 tracking-tight">
                        {payload.title}
                    </h3>
                    {payload.summary && (
                        <div className="mt-1">
                            <p className={`text-sm text-neutral-500 ${descExpanded ? '' : 'line-clamp-2'}`}>
                                {payload.summary}
                            </p>
                            {payload.summary.length > 140 && (
                                <button
                                    type="button"
                                    onClick={() => setDescExpanded(!descExpanded)}
                                    className="mt-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                                >
                                    {descExpanded ? 'Show less' : 'Show more'}
                                </button>
                            )}
                        </div>
                    )}

                    <div className="flex items-center justify-between gap-2 flex-wrap mt-3">
                        <div className="flex items-center gap-2 flex-wrap">
                            {/* Only claim "AI Generated" when every screen's image is
                                present. Partial/awaiting/generating/failed states must
                                not read as complete visuals. When completion can't be
                                computed (AI preview unavailable in this context), keep
                                the neutral "AI Generated" label. */}
                            {completion && completion.failed > 0 ? (
                                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-700 font-medium">
                                    <AlertTriangle size={10} />
                                    Images incomplete · {completion.generated}/{completion.total}
                                </span>
                            ) : completion && completion.status === 'generating' ? (
                                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-sky-200 bg-sky-50 text-sky-700 font-medium">
                                    <Loader2 size={10} className="animate-spin" />
                                    Generating images · {completion.generated}/{completion.total}
                                </span>
                            ) : completion && completion.status === 'none' ? (
                                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700 font-medium">
                                    <Clock size={10} />
                                    Awaiting images · 0/{completion.total}
                                </span>
                            ) : completion && completion.status === 'partial' ? (
                                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700 font-medium">
                                    <Images size={10} />
                                    Images · {completion.generated}/{completion.total}
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 font-medium">
                                    <Sparkles size={10} />
                                    AI Generated
                                </span>
                            )}
                            <span className="text-[11px] text-neutral-500">{pageCountLabel}</span>
                            <FreshnessBadge status={staleness} />
                        </div>
                        <span className="text-[11px] text-neutral-400 tabular-nums">
                            v{versionNumber} · {formatDate(createdAt)}
                        </span>
                    </div>
                    {completion && completion.failed > 0 && (
                        <div className="mt-3 flex items-start justify-between gap-3 flex-wrap rounded-lg border border-red-200 bg-red-50 p-3">
                            <div className="flex items-start gap-2 min-w-0">
                                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-600" />
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-red-900">
                                        {completion.failed} of {completion.total} screen image{completion.failed > 1 ? 's' : ''} failed to generate
                                    </p>
                                    <p className="text-xs text-red-700 mt-0.5">
                                        This mockup's visuals are incomplete. Retry the failed images below.
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={retryFailedImages}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-md transition shrink-0"
                            >
                                <RefreshCcw size={12} /> Retry failed images
                            </button>
                        </div>
                    )}
                </div>

                {/* --- Pages navigator ----------------------------------- */}
                <div ref={navRef} className="border-b border-neutral-100">
                    <button
                        type="button"
                        onClick={() => setNavOpen(!navOpen)}
                        className="w-full px-5 py-3 flex items-center justify-between gap-3 text-left hover:bg-neutral-50/60 transition"
                        aria-expanded={navOpen}
                        aria-controls="mockup-pages-list"
                    >
                        <span className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-900">
                            <FileText size={15} className="text-neutral-500" />
                            Pages
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
                            {screens.length} {screens.length === 1 ? 'page' : 'pages'}
                            {navOpen
                                ? <ChevronDown size={14} className="text-neutral-400" />
                                : <ChevronRight size={14} className="text-neutral-400" />}
                        </span>
                    </button>
                    {navOpen && (
                        <ul id="mockup-pages-list" className="pb-2">
                            {screens.map((screen, idx) => {
                                const selected = idx === activeIdx;
                                return (
                                    <li key={screen.id ?? idx}>
                                        <button
                                            type="button"
                                            onClick={() => handleSelectPage(idx)}
                                            className={`w-full px-5 py-2.5 flex items-center gap-3 text-left border-l-2 transition ${
                                                selected
                                                    ? 'border-indigo-500 bg-indigo-50/40'
                                                    : 'border-transparent hover:bg-neutral-50'
                                            }`}
                                            aria-current={selected ? 'true' : undefined}
                                        >
                                            <PageThumb versionId={versionId} screen={screen} />
                                            <span
                                                className={`shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-xs font-semibold tabular-nums ${
                                                    selected
                                                        ? 'bg-indigo-100 text-indigo-700'
                                                        : 'bg-neutral-100 text-neutral-500'
                                                }`}
                                            >
                                                {idx + 1}
                                            </span>
                                            <span className="flex-1 min-w-0">
                                                <span className="block text-sm font-semibold text-neutral-900 truncate">
                                                    {screen.name}
                                                </span>
                                                {screen.purpose && (
                                                    <span className="block text-xs text-neutral-500 truncate">
                                                        {screen.purpose}
                                                    </span>
                                                )}
                                            </span>
                                            <ChevronRight size={16} className="text-neutral-300 shrink-0" />
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                {/* --- Document layout: every page rendered in order ---- */}
                <div className="divide-y divide-neutral-100">
                    {screens.map((screen, idx) => (
                        <section
                            key={screen.id ?? idx}
                            id={pageAnchorId(versionId, screen, idx)}
                            data-page-idx={idx}
                            ref={(el) => {
                                sectionRefs.current[idx] = el;
                            }}
                            className="scroll-mt-20"
                        >
                            <div className="px-5 pt-5 pb-3 flex items-center gap-2">
                                <span className="inline-flex items-center justify-center text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-500">
                                    {idx + 1} / {screens.length}
                                </span>
                                <h4 className="text-sm font-bold text-neutral-900 truncate">
                                    {screen.name}
                                </h4>
                            </div>

                            <div className="px-5 pb-4">
                                {aiImageEnabled && projectId && artifactId && versionId ? (
                                    <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
                                        <MockupScreenImage
                                            key={`${screen.id}:img`}
                                            projectId={projectId}
                                            artifactId={artifactId}
                                            versionId={versionId}
                                            screen={screen}
                                            payload={payload}
                                            settings={settings}
                                        />
                                        <PageImageFooter versionId={versionId} screen={screen} />
                                    </div>
                                ) : (
                                    <div className="bg-white rounded-lg border border-dashed border-neutral-300 p-6 text-sm text-neutral-500 text-center">
                                        AI image preview is unavailable in this context.
                                    </div>
                                )}
                            </div>

                            {(screen.purpose || screen.userIntent) && (
                                <div className="px-5 pb-3 space-y-1">
                                    {screen.purpose && (
                                        <p className="text-sm text-neutral-700">{screen.purpose}</p>
                                    )}
                                    {screen.userIntent && (
                                        <p className="text-xs text-neutral-500 italic">
                                            User intent: {screen.userIntent}
                                        </p>
                                    )}
                                </div>
                            )}

                            {screen.coreUIElements && screen.coreUIElements.length > 0 && (
                                <div className="px-5 pb-4">
                                    <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium mb-1.5">
                                        Key Elements
                                    </p>
                                    <ul className="space-y-1">
                                        {screen.coreUIElements.map((el, i) => (
                                            <li
                                                key={i}
                                                className="flex items-start gap-2 text-xs text-neutral-700"
                                            >
                                                <Check
                                                    size={13}
                                                    className="text-emerald-500 mt-0.5 shrink-0"
                                                />
                                                <span>{el}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {screen.notes && (
                                <p className="px-5 pb-4 text-xs text-neutral-400 italic">
                                    {screen.notes}
                                </p>
                            )}
                        </section>
                    ))}
                </div>

                {actions && (
                    <div className="px-5 py-3 border-t border-neutral-100 bg-neutral-50/40 flex items-center gap-2 flex-wrap">
                        {actions}
                    </div>
                )}
                <div className="px-5 py-2 text-[11px] text-neutral-400 border-t border-neutral-100 flex items-center gap-1.5">
                    <span>v{versionNumber}</span>
                    <span className="text-neutral-300">·</span>
                    <span>{formatDate(createdAt)}</span>
                    {sourceSpineVersionId && (
                        <>
                            <span className="text-neutral-300">·</span>
                            <span>PRD {sourceSpineVersionId.slice(0, 8)}</span>
                        </>
                    )}
                </div>
            </div>

            {/* Floating Pages button (mobile only) — surfaces once the user
                has scrolled past the navigator card. */}
            {isMobile && showFloatingNav && (
                <button
                    type="button"
                    onClick={handleOpenFloatingNav}
                    className="md:hidden fixed bottom-5 right-5 z-30 inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-full bg-neutral-900 text-white text-xs font-semibold shadow-lg hover:bg-neutral-800 active:scale-[0.98] transition"
                    style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem)' }}
                    aria-label="Open Pages navigator"
                >
                    <FileText size={14} />
                    Pages
                    <span className="text-[10px] opacity-70 tabular-nums">
                        {activeIdx + 1}/{screens.length}
                    </span>
                    <ArrowUp size={12} className="opacity-70" />
                </button>
            )}
        </>
    );
}
