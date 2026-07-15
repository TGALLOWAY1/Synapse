import { describe, expect, it } from 'vitest';
import { runAdversarialReview, type SpecialistTransport } from '../orchestrator';
import { makeManifest, validCoverageChecks, validProductCoverageChecks, validResponse } from './reviewTestUtils';

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
                return JSON.stringify({
                    coverageSummary: 'No material scope findings.', resolvedAreas: ['Scope'],
                    coverageChecks: validProductCoverageChecks(manifest), findings: [],
                });
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
        expect(result.specialistResults.find(item => item.specialistId === 'product_scope')).toMatchObject({
            coverageSummary: 'No material scope findings.',
            resolvedAreas: ['Scope'],
        });
        expect(result.clusters).toHaveLength(1);
        expect(maxActive).toBeLessThanOrEqual(2);
    });

    it('rejects product coverage that reuses one unrelated exact locator for every area', async () => {
        const manifest = makeManifest();
        const risk = manifest.locators.find(item => item.path === 'prd.risks')!;
        const result = await runAdversarialReview(manifest, ['product_scope'], {
            transport: async () => JSON.stringify({
                coverageSummary: 'Everything appears sufficiently reviewed.', resolvedAreas: [], findings: [],
                coverageChecks: ['problem', 'primary_user', 'intended_outcome', 'first_release_scope', 'material_assumptions']
                    .map(area => ({ ...validCoverageChecks(risk)[0], area })),
            }),
        });
        expect(result.status).toBe('failed');
        expect(result.coverage.failed).toEqual(['product_scope']);
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

    it('repairs an output whose findings are wholly unsupported', async () => {
        const manifest = makeManifest();
        const locator = manifest.locators.find(item => item.path === 'prd.risks')!;
        const attempts: number[] = [];
        const transport: SpecialistTransport = async ({ attempt, repair }) => {
            attempts.push(attempt);
            if (attempt === 1) {
                return validResponse(locator, {
                    evidence: [{
                        sourceKey: locator.sourceKey,
                        locatorId: locator.id,
                        path: locator.path,
                        excerpt: 'This requirement is invented and absent from the cited locator.',
                    }],
                });
            }
            expect(repair?.validationError).toContain('failed evidence validation');
            return validResponse(locator);
        };
        const result = await runAdversarialReview(manifest, ['ai_model_risk'], { transport });
        expect(result.status).toBe('complete');
        expect(attempts).toEqual([1, 2]);
        expect(result.specialistResults[0].findings[0].grounded).toBe(true);
    });

    it('repairs mixed grounded and unsupported findings before marking a specialist complete', async () => {
        const manifest = makeManifest();
        const locator = manifest.locators.find(item => item.path === 'prd.risks')!;
        const attempts: number[] = [];
        const transport: SpecialistTransport = async ({ attempt, repair }) => {
            attempts.push(attempt);
            if (attempt === 1) {
                const mixed = JSON.parse(validResponse(locator)) as { findings: Array<Record<string, unknown>> };
                mixed.findings.push({
                    ...mixed.findings[0],
                    title: 'Unsupported secondary claim',
                    evidence: [{
                        sourceKey: locator.sourceKey, locatorId: 'missing-locator', path: 'prd.missing',
                        excerpt: 'This evidence does not exist in the reviewed plan.',
                    }],
                });
                return JSON.stringify(mixed);
            }
            expect(repair?.validationError).toContain('One or more specialist findings failed evidence validation');
            return validResponse(locator);
        };
        const result = await runAdversarialReview(manifest, ['ai_model_risk'], { transport });
        expect(result.status).toBe('complete');
        expect(attempts).toEqual([1, 2]);
        expect(result.specialistResults[0].findings).toHaveLength(1);
        expect(result.specialistResults[0].findings[0].grounded).toBe(true);
    });

    it('fails a review when no selected specialist completes', async () => {
        const result = await runAdversarialReview(makeManifest(), ['product_scope', 'architecture'], {
            transport: async () => { throw new Error('provider unavailable'); },
        });
        expect(result.status).toBe('failed');
        expect(result.coverage.completed).toEqual([]);
        expect(result.coverage.failed).toEqual(['product_scope', 'architecture']);
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
