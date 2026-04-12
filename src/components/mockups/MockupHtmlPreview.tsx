import { useMemo } from 'react';
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
    const srcDoc = useMemo(() => {
        if (!html || !html.trim()) return null;
        try {
            return buildMockupSrcDoc(html);
        } catch (e) {
            console.warn('[MockupHtmlPreview] buildMockupSrcDoc failed:', e);
            return null;
        }
    }, [html]);

    const height = platform === 'mobile' ? 720 : 680;

    if (!srcDoc) {
        return (
            <div
                className={`w-full bg-neutral-50 rounded-lg border border-dashed border-neutral-300 flex flex-col items-center justify-center text-neutral-400 ${className ?? ''}`}
                style={{ height: 240 }}
            >
                <p className="text-sm font-medium text-neutral-500">Preview unavailable</p>
                <p className="text-xs mt-1">This screen's content could not be rendered. Try regenerating.</p>
            </div>
        );
    }

    return (
        <iframe
            title="Mockup preview"
            srcDoc={srcDoc}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            loading="lazy"
            className={`w-full bg-white rounded-lg border border-neutral-200 ${className ?? ''}`}
            style={{ height }}
        />
    );
}
