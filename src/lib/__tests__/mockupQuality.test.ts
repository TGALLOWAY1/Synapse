import { describe, expect, it } from 'vitest';
import {
    assessMockupHtmlQuality,
    normalizeMockupHtml,
    sanitizeMockupHtmlForPreview,
} from '../mockupQuality';

describe('mockupQuality', () => {
    it('sanitizes dangerous tags and handlers', () => {
        const raw = '<div onclick="alert(1)"><script>alert(1)</script><a href="javascript:evil()">Go</a></div>';
        const sanitized = sanitizeMockupHtmlForPreview(raw);
        expect(sanitized).not.toContain('<script');
        expect(sanitized).not.toContain('onclick=');
        expect(sanitized).toContain('href="#"');
    });

    it('normalizes by adding the required shell wrapper', () => {
        const normalized = normalizeMockupHtml('<main class="p-6">Hello</main>');
        expect(normalized).toContain('min-h-screen');
        expect(normalized).toContain('<main');
    });

    it('flags placeholder-heavy low-trust output', () => {
        const report = assessMockupHtmlQuality('<div class="p-2">Lorem ipsum Button 1</div>');
        expect(report.reject).toBe(true);
        expect(report.score).toBeLessThan(55);
        expect(report.issues.some(issue => issue.code === 'placeholder_copy')).toBe(true);
    });

    it('accepts a structured realistic screen fragment', () => {
        const html = `
        <div class="min-h-screen bg-neutral-50 text-neutral-900">
          <header class="px-6 py-4 border-b border-neutral-200 flex items-center justify-between">
            <h1 class="text-xl font-semibold">Pipeline Dashboard</h1>
            <button type="button" class="px-3 py-2 rounded-lg bg-indigo-600 text-white">Create branch</button>
          </header>
          <main class="p-6 grid grid-cols-3 gap-4">
            <section class="col-span-2 rounded-xl border border-neutral-200 bg-white p-5">
              <table class="w-full text-sm"><tbody><tr><td>Artifact</td><td>Status</td></tr></tbody></table>
            </section>
            <aside class="rounded-xl border border-neutral-200 bg-white p-5">
              <ul class="space-y-2"><li>Feedback queue</li></ul>
            </aside>
          </main>
        </div>`;
        const report = assessMockupHtmlQuality(html);
        expect(report.reject).toBe(false);
        expect(report.score).toBeGreaterThanOrEqual(65);
    });

    it('rejects malformed structure missing required sections', () => {
        const html = '<div class="min-h-screen"><section>Only one section</section></div>';
        const report = assessMockupHtmlQuality(html);
        expect(report.reject).toBe(true);
        expect(report.issues.some(issue => issue.code === 'invalid_structure')).toBe(true);
    });
});
