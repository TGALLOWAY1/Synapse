// Phase 5C: the Screens implementation-handoff EXPORT surface — a local,
// collapsible panel above the screen list that turns the trace-backed handoff
// into a copy/downloadable developer package. Purely presentational over the
// derived ScreensHandoffExportPackage (src/lib/screenHandoffExport.ts). Like the
// Phase 4B preflight panel it is a decision surface, NEVER a hard gate: a
// not-ready export shows a calm, non-blocking warning and still lets the user
// export. No downstream artifact is mutated; no binary image data is embedded.

import { useCallback, useMemo, useState } from 'react';
import {
    AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Copy, Download, FileJson, FileText, Package,
} from 'lucide-react';
import {
    buildScreensHandoffExportPackage, deriveScreensExportStatus,
    renderScreensHandoffExportMarkdown, renderScreensHandoffExportJson,
    screensHandoffExportFilename,
    EXPORT_STATUS_LABELS, EXPORT_STATUS_DESCRIPTIONS,
    type ScreensHandoffExportInput, type ScreensHandoffExportPackage,
    type ScreensHandoffExportStatus, type ScreensHandoffExportFormat,
} from '../../lib/screenHandoffExport';
import { copyToClipboard } from '../../lib/utils/copyToClipboard';
import { downloadFile } from '../../lib/utils/downloadFile';

interface Props {
    /** Everything needed to build the export package, minus the timestamp (which
     * is stamped here so the pure builder stays deterministic). */
    input: Omit<ScreensHandoffExportInput, 'exportedAt'>;
}

type CopyState = 'idle' | 'copied' | 'failed';

const STATUS_TONE: Record<ScreensHandoffExportStatus, 'good' | 'warn' | 'bad'> = {
    ready: 'good',
    review_recommended: 'warn',
    not_ready: 'bad',
};

const TONE_CLASSES: Record<'good' | 'warn' | 'bad', { chip: string; icon: string; text: string }> = {
    good: { chip: 'bg-emerald-50', icon: 'text-emerald-600', text: 'text-emerald-700' },
    warn: { chip: 'bg-amber-50', icon: 'text-amber-600', text: 'text-amber-700' },
    bad: { chip: 'bg-red-50', icon: 'text-red-600', text: 'text-red-700' },
};

export function ScreensHandoffExportPanel({ input }: Props) {
    const pkg = useMemo<ScreensHandoffExportPackage>(() => {
        // Stamp the timestamp at build time. new Date() is fine in app code.
        return buildScreensHandoffExportPackage({ ...input, exportedAt: new Date().toISOString() });
        // Re-derive when the underlying inputs change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [input.handoffs, input.reviewModels, input.preflight, input.handoffRollup, input.p0Ids, input.manifest, input.projectName]);

    // Status is stable regardless of the timestamp — read it off the derived
    // inputs so the button copy doesn't flicker on re-render.
    const status = deriveScreensExportStatus(input.preflight, input.handoffRollup);
    const tone = STATUS_TONE[status];
    const toneClass = TONE_CLASSES[tone];

    const [open, setOpen] = useState(false);
    const [mdCopy, setMdCopy] = useState<CopyState>('idle');
    const [jsonCopy, setJsonCopy] = useState<CopyState>('idle');
    const [markdownFallback, setMarkdownFallback] = useState<string | null>(null);

    const doCopy = useCallback(async (
        format: ScreensHandoffExportFormat, setState: (s: CopyState) => void,
    ) => {
        const text = format === 'json'
            ? renderScreensHandoffExportJson(pkg)
            : renderScreensHandoffExportMarkdown(pkg);
        const ok = await copyToClipboard(text);
        if (ok) {
            setState('copied');
            setTimeout(() => setState('idle'), 2000);
        } else {
            setState('failed');
            // Reveal markdown for manual copy (mirrors the Phase 5A fallback).
            if (format === 'markdown') setMarkdownFallback(text);
        }
    }, [pkg]);

    const doDownload = useCallback((format: ScreensHandoffExportFormat) => {
        const text = format === 'json'
            ? renderScreensHandoffExportJson(pkg)
            : renderScreensHandoffExportMarkdown(pkg);
        downloadFile(
            text,
            screensHandoffExportFilename(pkg, format),
            format === 'json' ? 'application/json' : 'text/markdown',
        );
    }, [pkg]);

    const s = pkg.summary;

    return (
        <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-50 transition"
            >
                <div className="flex items-center gap-2 min-w-0">
                    <div className={`h-7 w-7 shrink-0 rounded-lg flex items-center justify-center ${toneClass.chip}`}>
                        <Package size={15} className={toneClass.icon} />
                    </div>
                    <div className="min-w-0 text-left">
                        <h3 className="text-sm font-semibold text-neutral-900">Implementation handoff export</h3>
                        <p className={`text-[11px] ${toneClass.text}`}>{EXPORT_STATUS_LABELS[status]}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-neutral-400 tabular-nums hidden sm:inline">
                        {s.totalScreens} {s.totalScreens === 1 ? 'screen' : 'screens'} · {s.p0Screens} P0
                    </span>
                    {open ? <ChevronUp size={16} className="text-neutral-400" /> : <ChevronDown size={16} className="text-neutral-400" />}
                </div>
            </button>

            {open && (
                <div className="px-4 pb-4 space-y-3 border-t border-neutral-100 pt-3">
                    {/* Status banner */}
                    {status === 'ready' ? (
                        <p className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
                            <CheckCircle2 size={13} />
                            {EXPORT_STATUS_DESCRIPTIONS.ready}
                        </p>
                    ) : (
                        <div className={`rounded-lg p-3 text-xs ${tone === 'bad' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>
                            <p className="flex items-center gap-1.5 font-medium">
                                <AlertTriangle size={13} className={toneClass.icon} />
                                {EXPORT_STATUS_LABELS[status]}
                            </p>
                            <p className="mt-1 text-[11px] opacity-90">{EXPORT_STATUS_DESCRIPTIONS[status]}</p>
                            {pkg.preflight.blocking.length > 0 && (
                                <ul className="mt-1.5 space-y-0.5 text-[11px]">
                                    {pkg.preflight.blocking.slice(0, 4).map((b, i) => (
                                        <li key={i} className="flex gap-1.5"><span aria-hidden>·</span><span>{b}</span></li>
                                    ))}
                                </ul>
                            )}
                            {status === 'review_recommended' && pkg.preflight.review.length > 0 && (
                                <ul className="mt-1.5 space-y-0.5 text-[11px]">
                                    {pkg.preflight.review.slice(0, 3).map((r, i) => (
                                        <li key={i} className="flex gap-1.5"><span aria-hidden>·</span><span>{r}</span></li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}

                    {/* Summary counts */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                        <Stat label="Accepted" value={s.acceptedScreens} />
                        <Stat label="Impl-ready" value={s.implementationReadyScreens} />
                        <Stat label="Blocked" value={s.blockedScreens} tone={s.blockedScreens > 0 ? 'bad' : undefined} />
                        <Stat label="Review" value={s.reviewRecommendedScreens} tone={s.reviewRecommendedScreens > 0 ? 'warn' : undefined} />
                    </div>

                    {/* Export actions */}
                    <div className="flex flex-wrap gap-2">
                        <ActionButton
                            icon={<Copy size={13} />}
                            label={mdCopy === 'copied' ? 'Copied' : 'Copy Markdown'}
                            onClick={() => doCopy('markdown', setMdCopy)}
                        />
                        <ActionButton
                            icon={<FileText size={13} />}
                            label="Download Markdown"
                            onClick={() => doDownload('markdown')}
                        />
                        <ActionButton
                            icon={jsonCopy === 'copied' ? <Copy size={13} /> : <FileJson size={13} />}
                            label={jsonCopy === 'copied' ? 'Copied' : 'Copy JSON'}
                            onClick={() => doCopy('json', setJsonCopy)}
                        />
                        <ActionButton
                            icon={<Download size={13} />}
                            label="Download JSON"
                            onClick={() => doDownload('json')}
                        />
                    </div>

                    {(mdCopy === 'failed' || jsonCopy === 'failed') && (
                        <p className="text-[11px] text-amber-700">
                            Clipboard unavailable — use Download, or copy the markdown below manually.
                        </p>
                    )}
                    {markdownFallback && (
                        <textarea
                            readOnly
                            value={markdownFallback}
                            onFocus={e => e.currentTarget.select()}
                            rows={10}
                            className="w-full text-[11px] font-mono border border-neutral-200 rounded-md p-2 bg-neutral-50"
                        />
                    )}

                    {/* Caveats */}
                    {pkg.manifest.caveats.length > 0 && (
                        <details className="text-[11px] text-neutral-500">
                            <summary className="cursor-pointer text-neutral-600 font-medium">
                                What's included &amp; caveats
                            </summary>
                            <ul className="mt-1.5 space-y-1">
                                {pkg.manifest.caveats.map((c, i) => (
                                    <li key={i} className="flex gap-1.5">
                                        <span className="select-none text-neutral-300">·</span>
                                        <span>{c}</span>
                                    </li>
                                ))}
                            </ul>
                        </details>
                    )}

                    <p className="text-[11px] text-neutral-400">
                        The export bundles the current screens, their handoff details, and read-only trace
                        references. It never changes the Screens, Data Model, or Implementation Plan artifacts.
                    </p>
                </div>
            )}
        </div>
    );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'bad' }) {
    const color = tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-neutral-800';
    return (
        <div className="rounded-lg bg-neutral-50 ring-1 ring-neutral-100 py-1.5">
            <div className={`text-sm font-semibold tabular-nums ${color}`}>{value}</div>
            <div className="text-[10px] uppercase tracking-wide text-neutral-400">{label}</div>
        </div>
    );
}

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white ring-1 ring-neutral-200 hover:ring-indigo-300 hover:text-indigo-700 text-neutral-700 rounded-md transition"
        >
            {icon}
            {label}
        </button>
    );
}
