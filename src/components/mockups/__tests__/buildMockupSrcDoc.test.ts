import { describe, expect, it } from 'vitest';
import { buildMockupSrcDoc } from '../buildMockupSrcDoc';

const fragment = '<div class="min-h-screen bg-neutral-50 p-6"><header><h1>Hi</h1></header><main><section>body</section></main></div>';

describe('buildMockupSrcDoc', () => {
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
    });

    it('keeps the Tailwind CDN script and defensive overflow overrides', () => {
        const srcDoc = buildMockupSrcDoc(fragment, { probeId: 'probe-1' });
        expect(srcDoc).toContain('cdn.tailwindcss.com');
        expect(srcDoc).toContain('overflow: visible !important');
    });
});
