// Centralized mockup HTML render-document builder.
//
// Generated mockup HTML is a Tailwind-utility-class soup whose layout and
// icon sizing depend entirely on Tailwind being available inside the render
// context. The runtime preview renders the fragment inside a sandbox iframe
// (via `srcDoc`), and the Playwright eval harness renders the same fragment
// for screenshotting. Both paths must share identical wrapping so behavior
// stays in lockstep.
//
// Failure mode this guards against
// --------------------------------
// Without Tailwind, classes like `class="w-5 h-5"` on an inline `<svg>` do
// nothing, and the SVG falls back to the user-agent default of 300x150 —
// the "huge blue shapes dominate the preview" pathology. The defensive CSS
// below caps unsized SVGs at icon dimensions inside a cascade layer, so
// Tailwind utility rules (which the CDN injects unlayered) always win on
// the happy path while still leaving a sane fallback if the CDN is slow,
// blocked by CSP, or fails outright.

import { normalizeMockupHtml } from '../../lib/mockupQuality';

export type MockupRenderViewport = 'desktop' | 'tablet' | 'mobile';

export interface BuildMockupRenderDocumentParams {
    /** Generated mockup HTML fragment (body content; no `<html>`/`<head>`). */
    html: string;
    /** Document `<title>`. Defaults to "Mockup preview". */
    title?: string;
    /** Logical viewport hint. Currently only echoed in `<meta name="viewport">`. */
    viewport?: MockupRenderViewport;
    /** When provided, injects a layout-probe script that posts a single
     *  `MockupProbeReport` back to the parent window via postMessage. The
     *  parent scopes incoming messages by matching probeId so multiple
     *  previews on the same page don't cross-contaminate. */
    probeId?: string;
}

export interface BuildMockupSrcDocOptions {
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

const escapeHtmlText = (value: string): string => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Shared head-stylesheet block. Exported so the Node-side Playwright eval
// harness can load and inject the exact same defensive CSS (keeps the
// preview iframe and screenshot pipelines in lockstep).
export const MOCKUP_RENDER_HEAD_STYLES = `
    /* Page reset */
    :root { color-scheme: light; }
    html, body { margin: 0; padding: 0; background: #e5e7eb; }
    html, body { overflow-y: auto; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #111827; }

    /* Defensive overrides for LLM-emitted shells that trap content above
       the iframe fold. The sandbox iframe is itself the scroll viewport,
       so root shells should grow naturally instead of clipping. */
    body > div.min-h-screen { min-height: 100vh; height: auto; }
    body > div.min-h-screen.flex { min-height: 100vh; }
    /* Belt-and-suspenders: even if the sanitizer misses a token, force any
       main or flex column shell to release the overflow-hidden token. */
    main.overflow-hidden, div.overflow-hidden.flex, div.overflow-hidden.flex-col { overflow: visible !important; }

    /* SVG sizing safety net. Generated mockups frequently emit inline
       SVGs whose only sizing comes from Tailwind utility classes such as
       \`w-5 h-5\`, \`w-8 h-8\`. If the Tailwind CDN is slow, blocked, or
       fails outright, those classes never apply and the SVG renders at
       the user-agent default of 300x150 — the giant-shape pathology. The
       rule below caps unsized SVGs at icon dimensions inside a cascade
       layer so Tailwind utility rules (which the CDN injects unlayered,
       i.e. with implicit-highest cascade priority) always override on the
       happy path. Placeholder SVGs in mockupPlaceholders.ts ship explicit
       width/height attributes, so the :not([width]):not([height]) guard
       leaves them untouched. */
    @layer mockup-fallback {
        svg:not([width]):not([height]) { width: 1.25rem; height: 1.25rem; flex-shrink: 0; }
        img:not([width]):not([height]) { max-width: 100%; height: auto; }
    }
`;

const VIEWPORT_META: Record<MockupRenderViewport, string> = {
    desktop: 'width=device-width, initial-scale=1',
    tablet: 'width=device-width, initial-scale=1',
    mobile: 'width=device-width, initial-scale=1',
};

/**
 * Wrap a sanitized mockup fragment in a complete `<!doctype html>` document
 * suitable for either iframe `srcDoc` use or Playwright `setContent`. The
 * returned document is screenshot-safe: Tailwind is loaded synchronously,
 * defensive CSS guards against missing-Tailwind icon blow-up, and the
 * `min-h-screen` root shell always renders at full viewport height.
 */
export const buildMockupRenderDocument = ({
    html,
    title = 'Mockup preview',
    viewport = 'desktop',
    probeId,
}: BuildMockupRenderDocumentParams): string => {
    const normalized = normalizeMockupHtml(html);
    const probeScript = probeId ? buildProbeScript(probeId) : '';
    const meta = VIEWPORT_META[viewport] ?? VIEWPORT_META.desktop;
    return `<!doctype html>
<html lang="en" data-viewport="${viewport}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="${meta}" />
  <title>${escapeHtmlText(title)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>${MOCKUP_RENDER_HEAD_STYLES}</style>
</head>
<body>
${normalized}
${probeScript}
</body>
</html>`;
};

// Backwards-compatible shim used by MockupHtmlPreview / MockupViewer. Existing
// call sites pass a fragment string + optional probeId; under the hood we just
// delegate to buildMockupRenderDocument().
export const buildMockupSrcDoc = (
    fragment: string,
    options: BuildMockupSrcDocOptions = {},
): string => buildMockupRenderDocument({ html: fragment, probeId: options.probeId });
