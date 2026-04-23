// Sanitize a Gemini-generated HTML fragment and wrap it in a full HTML
// document suitable for an iframe's `srcDoc`. Kept separate from the component
// file so `react-refresh/only-export-components` stays happy and so the
// helper can be reused by the "Open in new tab" flow in MockupViewer.

import { normalizeMockupHtml } from '../../lib/mockupQuality';

export interface BuildMockupSrcDocOptions {
    // Phase C: when provided, the wrapper injects a post-load probe that
    // reports styled/overflow/occupancy back to the parent via postMessage.
    // The parent scopes incoming messages by matching probeId so multiple
    // previews on the same page don't cross-contaminate.
    probeId?: string;
}

export interface MockupProbeReport {
    type: 'mockup-probe';
    probeId: string;
    styled: boolean;         // whether a vetted Tailwind utility actually applied
    horizontalOverflow: boolean; // scrollWidth > clientWidth
    bodyHeight: number;      // rendered body height in px
    visibleElements: number; // rough element count inside the root shell
}

const buildProbeScript = (probeId: string): string => {
    // Pure-browser IIFE: waits for load, inspects computed styles + layout,
    // posts one MockupProbeReport. Kept inline (no external file) so the
    // iframe works even when bundled into a downloaded artifact.
    const script = `(() => {
        const report = () => {
            try {
                const root = document.querySelector('.min-h-screen') || document.body;
                // Styled check: the vetted templates always ship the root
                // with 'min-h-screen'. If Tailwind CDN applied its styles,
                // the computed min-height resolves to at least 100vh; if
                // the CDN failed (CSP, network), min-height stays 0.
                const cs = window.getComputedStyle(root);
                const styled = parseFloat(cs.minHeight || '0') >= 1
                    || cs.display !== 'inline'
                    || parseFloat(cs.padding || '0') > 0;
                const body = document.body;
                const horizontalOverflow = (body.scrollWidth - body.clientWidth) > 1;
                const bodyHeight = body.scrollHeight;
                const visibleElements = root.querySelectorAll('section, header, main, aside, nav, table, ul, button').length;
                parent.postMessage({
                    type: 'mockup-probe',
                    probeId: ${JSON.stringify(probeId)},
                    styled,
                    horizontalOverflow,
                    bodyHeight,
                    visibleElements,
                }, '*');
            } catch (_) {
                parent.postMessage({
                    type: 'mockup-probe',
                    probeId: ${JSON.stringify(probeId)},
                    styled: false,
                    horizontalOverflow: false,
                    bodyHeight: 0,
                    visibleElements: 0,
                }, '*');
            }
        };
        if (document.readyState === 'complete') {
            setTimeout(report, 50);
        } else {
            window.addEventListener('load', () => setTimeout(report, 50), { once: true });
        }
    })();`;
    return `<script>${script}</script>`;
};

export const buildMockupSrcDoc = (
    fragment: string,
    options: BuildMockupSrcDocOptions = {},
): string => {
    const normalized = normalizeMockupHtml(fragment);
    const probeScript = options.probeId ? buildProbeScript(options.probeId) : '';
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mockup preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root { color-scheme: light; }
    html, body { margin: 0; padding: 0; background: #e5e7eb; }
    html, body { overflow-y: auto; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    /* Defensive overrides for LLM-emitted shells that trap content above
       the iframe fold. The sandbox iframe is itself the scroll viewport,
       so root shells should grow naturally instead of clipping. */
    body > div.min-h-screen { min-height: 100vh; height: auto; }
    body > div.min-h-screen.flex { min-height: 100vh; }
    /* Belt-and-suspenders: even if the sanitizer misses a token, force any
       main or flex column shell to release the overflow-hidden token. */
    main.overflow-hidden, div.overflow-hidden.flex, div.overflow-hidden.flex-col { overflow: visible !important; }
  </style>
</head>
<body>
${normalized}
${probeScript}
</body>
</html>`;
};
