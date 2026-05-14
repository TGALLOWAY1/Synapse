// Centralized mockup HTML render-document builder.
//
// Generated mockup HTML is a Tailwind-utility-class soup whose layout and
// icon sizing depend entirely on Tailwind being available inside the render
// context. The runtime preview renders the fragment inside a sandbox iframe
// (via `srcDoc`), and the Playwright eval harness renders the same fragment
// for screenshotting. Both paths must share identical wrapping so behavior
// stays in lockstep.
//
// Tailwind strategy
// -----------------
// The iframe used to depend on the Tailwind Play CDN
// (`https://cdn.tailwindcss.com`) for in-browser JIT compilation. That path
// was the load-bearing source of "Preview degraded: Tailwind styles did not
// apply" reports — the CDN script is slow to load, sandbox iframes can race
// the probe before the JIT compiles, and the CDN occasionally returns
// degraded/empty responses. We now inline a precompiled Tailwind stylesheet
// (src/styles/mockup-tailwind.generated.css) built from a comprehensive
// safelist (scripts/mockup-tailwind.config.cjs). The styles apply
// synchronously with the iframe's first paint and no network is required.
//
// Failure mode this still guards against
// --------------------------------------
// Even with the inlined Tailwind sheet, certain LLM-emitted patterns can
// produce huge or trapped layouts. The cascade-layer rules in
// MOCKUP_RENDER_HEAD_STYLES (below) keep unsized inline `<svg>` icons from
// blowing up to the UA default 300x150 and force overflow-trapped shells to
// release their children. Those defensive rules are independent of the
// Tailwind sheet and remain useful as a belt-and-suspenders measure.
//
// Role in the broader mockup pipeline
// -----------------------------------
// This iframe/HTML render path is the SECONDARY mockup output. The primary
// presentation in MockupViewer is the gpt-image-2-generated PNG (the
// "AI Image" tab, which is the default mode when projectId/artifactId/
// versionId are threaded through — see MockupViewer.tsx). The HTML fragment
// is still the ground-truth artifact in storage and the source of the
// "Preview" + "Code" tabs.

import { normalizeMockupHtml } from '../../lib/mockupQuality';
import { tokensToCssStyleBlock } from '../../lib/designTokens';
import type { DesignTokens } from '../../types';
import mockupTailwindCss from '../../styles/mockup-tailwind.generated';

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
    /**
     * Optional design system tokens. When supplied, a `:root { --color-...,
     * --typography-..., --spacing-..., --radius-... }` block is injected
     * into the iframe `<head>` so generated HTML using
     * `style="background: var(--color-brand-primary)"` (and similar) renders
     * with the project's design tokens.
     */
    designTokens?: DesignTokens;
}

export interface BuildMockupSrcDocOptions {
    probeId?: string;
    designTokens?: DesignTokens;
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
    //
    // The styled check uses a sentinel element with the `.hidden` Tailwind
    // utility (which resolves to `display: none`). If Tailwind loaded, the
    // sentinel's computed display is `none`; if Tailwind failed (CSP block,
    // network failure, sandbox restriction), the sentinel falls back to the
    // user-agent default `display: block` and `styled` flips false. We avoid
    // checking the root's `min-height` or `display` because every <div>
    // defaults to `display: block` regardless of Tailwind, which let the
    // previous probe falsely report "styled" on completely unstyled output.
    const script = `(() => {
        const report = () => {
            try {
                const sentinel = document.createElement('div');
                sentinel.className = 'hidden';
                sentinel.setAttribute('data-mockup-probe-sentinel', '');
                sentinel.setAttribute('aria-hidden', 'true');
                document.body.appendChild(sentinel);
                const sentinelDisplay = window.getComputedStyle(sentinel).display;
                sentinel.remove();
                const styled = sentinelDisplay === 'none';
                const root = document.querySelector('.min-h-screen') || document.body;
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
            setTimeout(report, 250);
        } else {
            window.addEventListener('load', () => setTimeout(report, 250), { once: true });
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
       \`w-5 h-5\`, \`w-8 h-8\`. If the inlined Tailwind sheet misses an
       exotic utility, those classes don't apply and the SVG renders at
       the user-agent default of 300x150 — the giant-shape pathology. The
       rule below caps unsized SVGs at icon dimensions inside a cascade
       layer so Tailwind utility rules (which Tailwind emits unlayered,
       i.e. with implicit-highest cascade priority) always override on the
       happy path. Placeholder SVGs in mockupPlaceholders.ts ship explicit
       width/height attributes, so the :not([width]):not([height]) guard
       leaves them untouched. */
    @layer mockup-fallback {
        svg:not([width]):not([height]) { width: 1.25rem; height: 1.25rem; flex-shrink: 0; }
        img:not([width]):not([height]) { max-width: 100%; height: auto; }
    }
`;

// Precompiled Tailwind stylesheet for the iframe. Generated by
// `npm run mockup-css:build` from scripts/mockup-tailwind.config.cjs.
// Re-exported so the Playwright eval harness can pull the same CSS into
// its render document (the harness is plain Node and can't use Vite's
// `?raw` import).
export const MOCKUP_TAILWIND_CSS = mockupTailwindCss;

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
    designTokens,
}: BuildMockupRenderDocumentParams): string => {
    const normalized = normalizeMockupHtml(html);
    const probeScript = probeId ? buildProbeScript(probeId) : '';
    const meta = VIEWPORT_META[viewport] ?? VIEWPORT_META.desktop;
    // Inject design tokens BEFORE Tailwind so var(--color-...) is resolved
    // synchronously by the browser. The Tailwind sheet is inlined next so
    // utility classes apply on first paint; defensive head styles come last
    // since their cascade-layer rules need to override Tailwind utilities.
    const tokensBlock = designTokens ? tokensToCssStyleBlock(designTokens) : '';
    return `<!doctype html>
<html lang="en" data-viewport="${viewport}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="${meta}" />
  <title>${escapeHtmlText(title)}</title>
  ${tokensBlock}
  <style>${MOCKUP_TAILWIND_CSS}</style>
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
): string => buildMockupRenderDocument({
    html: fragment,
    probeId: options.probeId,
    designTokens: options.designTokens,
});
