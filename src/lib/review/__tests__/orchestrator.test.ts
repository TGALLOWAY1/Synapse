import { describe, expect, it } from 'vitest';
import { runAdversarialReview, type SpecialistTransport } from '../orchestrator';
import { makeManifest, validResponse } from './reviewTestUtils';

describe('adversarial review orchestration', () => {
    it('isolates failure, preserves zero-finding success, and bounds concurrency', async () => {
        const manifest = makeManifest();
        const locator = manifest.locators.find(item => item.path === 'prd.risks')!;
        let active = 0;
        let maxActive = 0;
        const transport: SpecialistTransport = async ({ specialist }) => {
            active++;
            maxActive = Math.max(maxActive, active);
            await Promise.resolve();
            active--;
            if (specialist.id === 'architecture') throw new Error('model unavailable');
            if (specialist.id === 'product_scope') {
                return JSON.stringify({ coverageSummary: 'No material scope findings.', resolvedAreas: ['Scope'], findings: [] });
            }
            return validResponse(locator);
        };
        const result = await runAdversarialReview(
            manifest,
            ['product_scope', 'architecture', 'ai_model_risk'],
            { transport, concurrency: 2 },
        );
        expect(result.status).toBe('partial');
        expect(result.coverage.completed).toEqual(['product_scope', 'ai_model_risk']);
        expect(result.coverage.failed).toEqual(['architecture']);
        expect(result.specialistResults.find(item => item.specialistId === 'product_scope')?.findings).toEqual([]);
        expect(result.clusters).toHaveLength(1);
        expect(maxActive).toBeLessThanOrEqual(2);
    });

    it('performs one bounded structured repair attempt', async () => {
        const manifest = makeManifest();
        const locator = manifest.locators.find(item => item.path === 'prd.risks')!;
        const attempts: number[] = [];
        const transport: SpecialistTransport = async ({ attempt, repair }) => {
            attempts.push(attempt);
            if (attempt === 1) return '{not json';
            expect(repair?.validationError).toContain('valid JSON');
            return validResponse(locator);
        };
        const result = await runAdversarialReview(manifest, ['ai_model_risk'], { transport });
        expect(result.status).toBe('complete');
        expect(attempts).toEqual([1, 2]);
        expect(result.specialistResults[0].attempts).toBe(2);
    });

    it('cancels unstarted specialists without discarding completed result objects', async () => {
        const manifest = makeManifest();
        const controller = new AbortController();
        controller.abort();
        const transport: SpecialistTransport = async () => { throw new Error('must not run'); };
        const result = await runAdversarialReview(
            manifest,
            ['product_scope', 'architecture'],
            { transport, signal: controller.signal, concurrency: 1 },
        );
        expect(result.status).toBe('cancelled');
        expect(result.coverage.cancelled).toEqual(['product_scope', 'architecture']);
        expect(result.specialistResults.every(item => item.attempts === 0)).toBe(true);
    });
});
