import { useEffect, useMemo, useState } from 'react';
import type { MockupPlatform } from '../../types';
import { buildMockupSrcDoc } from './buildMockupSrcDoc';

type Props = {
    html: string;
    platform: MockupPlatform;
    className?: string;
};

// Sandboxed iframe preview for a single mockup screen. `sandbox="allow-scripts"`
// lets Tailwind CDN JIT-compile utility classes inside the iframe, but without
// `allow-same-origin` the iframe is treated as cross-origin and cannot touch
// Synapse state.
export function MockupHtmlPreview({ html, platform, className }: Props) {
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [retryCount, setRetryCount] = useState(0);
    const frameKey = `${retryCount}-${html.length}`;
    const srcDoc = useMemo(() => {
        if (!html || !html.trim()) return null;
        try {
            return buildMockupSrcDoc(html);
        } catch (e) {
            console.warn('[MockupHtmlPreview] buildMockupSrcDoc failed:', e);
            return null;
        }
    }, [html]);

    useEffect(() => {
        window.setTimeout(() => setStatus(srcDoc ? 'loading' : 'error'), 0);
        const timer = window.setTimeout(() => {
            setStatus(current => (current === 'loading' ? 'error' : current));
        }, 4500);
        return () => window.clearTimeout(timer);
    }, [srcDoc, retryCount]);

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
