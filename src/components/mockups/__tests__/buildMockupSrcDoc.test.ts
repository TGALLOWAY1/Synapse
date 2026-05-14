import { describe, expect, it } from 'vitest';
import {
    buildMockupRenderDocument,
    buildMockupSrcDoc,
    MOCKUP_RENDER_HEAD_STYLES,
} from '../buildMockupSrcDoc';

const fragment = '<div class="min-h-screen bg-neutral-50 p-6"><header><h1>Hi</h1></header><main><section>body</section></main></div>';

describe('buildMockupSrcDoc (back-compat shim)', () => {
    it('omits the probe script when no probeId is provided', () => {
        const srcDoc = buildMockupSrcDoc(fragment);
        expect(srcDoc).toContain('min-h-screen');
        expect(srcDoc).not.toContain('mockup-probe');
        expect(srcDoc).not.toContain('parent.postMessage');
    });

    it('injects a probe script when a probeId is provided', () => {
        const srcDoc = buildMockupSrcDoc(fragment, { probeId: 'probe-xyz-123' });
        expect(srcDoc).toContain('mockup-probe');
        expect(srcDoc).toContain('"probe-xyz-123"');
        expect(srcDoc).toContain('parent.postMessage');
        // Probe reports the four signals MockupHtmlPreview interprets.
        expect(srcDoc).toContain('styled');
        expect(srcDoc).toContain('horizontalOverflow');
        expect(srcDoc).toContain('bodyHeight');
        expect(srcDoc).toContain('visibleElements');
        // Styled detection uses a `.hidden` sentinel: Tailwind resolves the
        // class to `display: none`; an unstyled fallback leaves it `block`.
        // This is the only reliable way to distinguish a CSP-blocked CDN
        // from a happy-path render.
        expect(srcDoc).toContain('mockup-probe-sentinel');
        expect(srcDoc).toContain("className = 'hidden'");
    });

    it('inlines the precompiled Tailwind stylesheet and defensive overflow overrides', () => {
        const srcDoc = buildMockupSrcDoc(fragment, { probeId: 'probe-1' });
        // The Tailwind CDN script has been replaced by an inlined Tailwind
        // sheet so styles apply synchronously regardless of network state.
        expect(srcDoc).not.toContain('cdn.tailwindcss.com');
        // Spot-check that the inlined sheet carries the base utilities the
        // probe relies on (`.hidden { display: none }`) and the SVG fallback
        // rules MOCKUP_RENDER_HEAD_STYLES adds.
        expect(srcDoc).toMatch(/\.hidden\s*\{\s*display:\s*none/);
        expect(srcDoc).toContain('overflow: visible !important');
    });
});

describe('buildMockupRenderDocument', () => {
    it('returns a complete <!doctype html> document', () => {
        const doc = buildMockupRenderDocument({ html: fragment });
        expect(doc.startsWith('<!doctype html>')).toBe(true);
        expect(doc).toContain('<html');
        expect(doc).toContain('<head>');
        expect(doc).toContain('<body>');
        expect(doc).toContain('</html>');
    });

    it('uses the supplied title and escapes HTML special characters', () => {
        const doc = buildMockupRenderDocument({
            html: fragment,
            title: 'Account & <Settings>',
        });
        expect(doc).toContain('<title>Account &amp; &lt;Settings&gt;</title>');
    });

    it('falls back to a default title when none is supplied', () => {
        const doc = buildMockupRenderDocument({ html: fragment });
        expect(doc).toContain('<title>Mockup preview</title>');
    });

    it('echoes the viewport hint as a data-attribute on <html>', () => {
        const desktop = buildMockupRenderDocument({ html: fragment, viewport: 'desktop' });
        const mobile = buildMockupRenderDocument({ html: fragment, viewport: 'mobile' });
        const tablet = buildMockupRenderDocument({ html: fragment, viewport: 'tablet' });
        expect(desktop).toContain('data-viewport="desktop"');
        expect(mobile).toContain('data-viewport="mobile"');
        expect(tablet).toContain('data-viewport="tablet"');
    });

    it('inlines the precompiled Tailwind stylesheet instead of the CDN script', () => {
        const doc = buildMockupRenderDocument({ html: fragment });
        // The Play CDN script was the source of "Tailwind styles did not
        // apply" reports — it must not be loaded anymore.
        expect(doc).not.toContain('cdn.tailwindcss.com');
        // Sanity-check the inlined sheet by looking for two utilities the
        // generator always emits: `.flex` and `.hidden`.
        expect(doc).toMatch(/\.flex\s*\{\s*display:\s*flex/);
        expect(doc).toMatch(/\.hidden\s*\{\s*display:\s*none/);
    });

    it('inlines the SVG-sizing safety net inside a cascade layer so Tailwind utilities still win', () => {
        const doc = buildMockupRenderDocument({ html: fragment });
        // The fallback rule must live inside @layer mockup-fallback so the
        // Tailwind CDN's unlayered .w-5/.w-8/etc. rules always override.
        expect(doc).toContain('@layer mockup-fallback');
        expect(doc).toContain('svg:not([width]):not([height])');
        expect(doc).toContain('width: 1.25rem');
    });

    it('exports the head stylesheet so the Playwright harness can stay in lockstep', () => {
        // Spot-check that the exported constant covers the load-bearing rules.
        expect(MOCKUP_RENDER_HEAD_STYLES).toContain('@layer mockup-fallback');
        expect(MOCKUP_RENDER_HEAD_STYLES).toContain('svg:not([width]):not([height])');
        expect(MOCKUP_RENDER_HEAD_STYLES).toContain('overflow: visible !important');
    });

    it('keeps the iframe-preview defensive overrides for trapped shells', () => {
        const doc = buildMockupRenderDocument({ html: fragment });
        expect(doc).toContain('body > div.min-h-screen { min-height: 100vh; height: auto; }');
        expect(doc).toContain('overflow: visible !important');
    });

    it('runs the fragment through the normalizer before wrapping', () => {
        // Fragment without a min-h-screen root should be auto-wrapped by
        // normalizeMockupHtml; verify the wrapped output exposes that.
        const doc = buildMockupRenderDocument({ html: '<main class="p-6">Hello</main>' });
        expect(doc).toContain('min-h-screen');
        expect(doc).toContain('<main');
    });

    it('strips dangerous tags from the fragment before wrapping', () => {
        const doc = buildMockupRenderDocument({
            html: '<div class="min-h-screen p-6">' +
                '<script>alert(1)</script>' +
                '<form action="javascript:evil()"><input/></form>' +
                '</div>',
        });
        // Sanitizer-stripped <script>/<form>. The wrapper no longer injects
        // a Tailwind CDN <script> either, so a fragment with no probe
        // should yield zero <script> tags.
        const scriptMatches = doc.match(/<script\b/gi) || [];
        expect(scriptMatches).toHaveLength(0);
        expect(doc).not.toContain('alert(1)');
        expect(doc).not.toContain('<form');
    });

    it('omits the probe script when no probeId is provided', () => {
        const doc = buildMockupRenderDocument({ html: fragment });
        expect(doc).not.toContain('mockup-probe');
    });

    it('injects the probe script when probeId is provided', () => {
        const doc = buildMockupRenderDocument({ html: fragment, probeId: 'pid-42' });
        expect(doc).toContain('mockup-probe');
        expect(doc).toContain('"pid-42"');
    });
});
