import { describe, expect, it } from 'vitest';
import { validateMockupHtmlStructure } from '../mockupValidation';

describe('mockupValidation', () => {
    it('passes canonical screen structure', () => {
        const html = `
        <div class="min-h-screen bg-neutral-50">
          <header class="px-6 py-4 border-b border-neutral-200">
            <button type="button" class="bg-indigo-600 text-white px-4 py-2">Create</button>
          </header>
          <main class="p-6">
            <section class="rounded-xl border border-neutral-200 bg-white p-6">Primary</section>
          </main>
        </div>`;
        const result = validateMockupHtmlStructure(html);
        expect(result.isValid).toBe(true);
        expect(result.score).toBeGreaterThanOrEqual(70);
    });

    it('flags missing required landmarks', () => {
        const result = validateMockupHtmlStructure('<div class="min-h-screen"><article>Hi</article></div>');
        expect(result.isValid).toBe(false);
        expect(result.issues.some(issue => issue.includes('Missing required header'))).toBe(true);
    });
});
