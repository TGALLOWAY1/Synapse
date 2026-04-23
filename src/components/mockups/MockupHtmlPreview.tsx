import { useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { MockupPlatform } from '../../types';
import { buildMockupSrcDoc, type MockupProbeReport } from './buildMockupSrcDoc';
import { useProbeStore } from '../../store/probeStore';

type Props = {
    html: string;
    platform: MockupPlatform;
    className?: string;
    // Optional version id used to record probe outcomes into the session
    // telemetry store. When absent (e.g. "Open in new tab"), probes still
    // drive the degraded badge but aren't aggregated.
    versionId?: string;
};

type ProbeState =
    | { status: 'pending' }
    | { status: 'ok'; report: MockupProbeReport }
    | { status: 'degraded'; reason: string; report?: MockupProbeReport };

// Heuristics for interpreting a probe report. Tuned against the Phase A
// template catalog: a rendered shell should always have >100px body height
// and at least one visible landmark section.
const interpretProbe = (report: MockupProbeReport): ProbeState => {
    if (!report.styled) return { status: 'degraded', reason: 'Tailwind styles did not apply.', report };
    if (report.horizontalOverflow) return { status: 'degraded', reason: 'Screen overflows horizontally.', report };
    if (report.bodyHeight < 100) return { status: 'degraded', reason: 'Screen rendered near-empty viewport.', report };
    if (report.visibleElements === 0) return { status: 'degraded', reason: 'No layout landmarks detected.', report };
    return { status: 'ok', report };
};

// Sandboxed iframe preview for a single mockup screen. `sandbox="allow-scripts"`
// lets Tailwind CDN JIT-compile utility classes inside the iframe, but without
// `allow-same-origin` the iframe is treated as cross-origin and cannot touch
// Synapse state.
export function MockupHtmlPreview({ html, platform, className, versionId }: Props) {
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [retryCount, setRetryCount] = useState(0);
    const [probe, setProbe] = useState<ProbeState>({ status: 'pending' });
    const frameKey = `${retryCount}-${html.length}`;
    const recordProbe = useProbeStore(s => s.recordProbe);

    // Fresh probeId per (html, retryCount) pair so a remount/retry never
    // matches a stale probe message from the previous iframe instance.
    // Computed together with srcDoc so the pair stays in sync without a
    // render-time ref. `retryCount` is intentionally in the closure key —
    // linting can't see that because it's read via html+retry combination
    // below — so we reference it here to keep the memo dep-complete.
    const { srcDoc, probeId } = useMemo(() => {
        void retryCount; // tracked to rotate probeId on retry
        if (!html || !html.trim()) return { srcDoc: null, probeId: '' };
        const id = uuidv4();
        try {
            return { srcDoc: buildMockupSrcDoc(html, { probeId: id }), probeId: id };
        } catch (e) {
            console.warn('[MockupHtmlPreview] buildMockupSrcDoc failed:', e);
            return { srcDoc: null, probeId: '' };
        }
    }, [html, retryCount]);

    useEffect(() => {
        // Both state resets are batched inside a zero-delay timeout so the
        // effect body stays free of direct setState calls (which trigger
        // cascading renders under react-hooks/set-state-in-effect).
        const resetTimer = window.setTimeout(() => {
            setStatus(srcDoc ? 'loading' : 'error');
            setProbe({ status: 'pending' });
        }, 0);
        const loadTimer = window.setTimeout(() => {
            setStatus(current => (current === 'loading' ? 'error' : current));
        }, 4500);
        // Probe arrives after onload + 50ms. If it doesn't arrive within
        // 6s we flag the preview as degraded but keep showing it (better
        // than hiding potentially-fine output on a slow CDN response).
        const probeTimer = window.setTimeout(() => {
            setProbe(current => current.status === 'pending'
                ? { status: 'degraded', reason: 'Preview did not report layout signals.' }
                : current);
        }, 6000);
        return () => {
            window.clearTimeout(resetTimer);
            window.clearTimeout(loadTimer);
            window.clearTimeout(probeTimer);
        };
    }, [srcDoc]);

    useEffect(() => {
        if (!probeId) return;
        const onMessage = (event: MessageEvent) => {
            const data = event.data;
            if (!data || typeof data !== 'object') return;
            if (data.type !== 'mockup-probe') return;
            if (data.probeId !== probeId) return;
            const next = interpretProbe(data as MockupProbeReport);
            setProbe(next);
            // interpretProbe only ever returns 'ok' or 'degraded' — never
            // 'pending' — but TypeScript can't see that from ProbeState, so
            // we narrow explicitly instead of casting.
            if (versionId && next.status === 'ok') {
                recordProbe(versionId, { outcome: 'ok', at: Date.now() });
            } else if (versionId && next.status === 'degraded') {
                recordProbe(versionId, { outcome: 'degraded', reason: next.reason, at: Date.now() });
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [probeId, versionId, recordProbe]);

    const height = platform === 'mobile' ? 760 : platform === 'responsive' ? 720 : 760;
    const maxWidth = platform === 'mobile' ? 430 : undefined;

    if (!srcDoc || status === 'error') {
        return (
            <div
                className={`w-full bg-neutral-50 rounded-lg border border-dashed border-neutral-300 flex flex-col items-center justify-center text-neutral-400 ${className ?? ''}`}
                style={{ height: 240 }}
            >
                <p className="text-sm font-medium text-neutral-500">Preview unavailable</p>
                <p className="text-xs mt-1">This screen's content could not be rendered safely. Try regenerating.</p>
                <button
                    type="button"
                    onClick={() => setRetryCount(v => v + 1)}
                    className="mt-3 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100"
                >
                    Retry preview
                </button>
            </div>
        );
    }

    return (
        <div className="w-full rounded-xl border border-neutral-200 bg-gradient-to-b from-neutral-200 to-neutral-100 p-3">
            {status === 'loading' && (
                <div className="mb-2 rounded-md border border-neutral-200 bg-white/80 px-3 py-2 text-xs text-neutral-600">
                    Rendering preview…
                </div>
            )}
            {probe.status === 'degraded' && status !== 'loading' && (
                <div
                    className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                    role="status"
                >
                    Preview degraded: {probe.reason} The mockup may still be usable — regenerate for a cleaner render.
                </div>
            )}
            <iframe
                key={frameKey}
                title="Mockup preview"
                srcDoc={srcDoc}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                loading="lazy"
                onLoad={() => setStatus('ready')}
                className={`w-full bg-white rounded-lg border border-neutral-300 shadow-sm ${className ?? ''}`}
                style={{ height, maxWidth, margin: '0 auto', display: 'block' }}
            />
        </div>
    );
}
