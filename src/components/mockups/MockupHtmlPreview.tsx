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
    const srcDoc = useMemo(() => buildMockupSrcDoc(html), [html]);
    const height = platform === 'mobile' ? 720 : 680;

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
