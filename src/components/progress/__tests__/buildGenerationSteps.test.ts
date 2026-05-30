import { describe, it, expect } from 'vitest';
import {
    computeWaves,
    buildGenerationSteps,
    summarizeSteps,
    formatModelName,
    flattenLeaves,
    type SectionStatusMap,
} from '../buildGenerationSteps';
import type { PrdSectionTemplate } from '../../../lib/services/progressivePrdGeneration';

const MODELS = { fastModel: 'gemini-3-flash-preview', strongModel: 'gemini-3-pro-preview' };

describe('formatModelName', () => {
    it('renders preview ids with a friendly suffix', () => {
        expect(formatModelName('gemini-3-flash-preview')).toBe('Gemini 3 Flash (preview)');
        expect(formatModelName('gemini-3-pro-preview')).toBe('Gemini 3 Pro (preview)');
    });
    it('keeps version numbers and capitalizes tiers', () => {
        expect(formatModelName('gemini-1.5-flash')).toBe('Gemini 1.5 Flash');
        expect(formatModelName('gemini-2.0-pro')).toBe('Gemini 2.0 Pro');
        expect(formatModelName('gemini-3.5-flash')).toBe('Gemini 3.5 Flash');
    });
    it('strips a models/ prefix and handles empty input', () => {
        expect(formatModelName('models/gemini-2.0-flash')).toBe('Gemini 2.0 Flash');
        expect(formatModelName(undefined)).toBe('Gemini');
        expect(formatModelName('')).toBe('Gemini');
    });
});

describe('computeWaves (default DAG)', () => {
    it('groups the 10 sections into dependency waves', () => {
        const waves = computeWaves();
        expect(waves.map((w) => w.length)).toEqual([1, 2, 1, 3, 1, 2]);
        expect(waves[0][0].id).toBe('product_basics');
        expect(waves[1].map((s) => s.id)).toEqual(['product_thesis', 'grounding']);
        expect(waves[3].map((s) => s.id)).toEqual(['data_model', 'ux_loops', 'metrics_scope']);
        expect(waves[5].map((s) => s.id)).toEqual(['quality_risks', 'implementation_plan']);
    });
});

describe('computeWaves (arbitrary graph — future-proofing)', () => {
    it('supports multiple concurrent groups of arbitrary shape', () => {
        const sections = [
            { id: 'product_basics', title: 'A', order: 1, risk: 'low', estimatedSeconds: 5 },
            { id: 'product_thesis', title: 'B', order: 2, risk: 'high', estimatedSeconds: 5, dependencies: ['product_basics'] },
            { id: 'grounding', title: 'C', order: 3, risk: 'low', estimatedSeconds: 5, dependencies: ['product_basics'] },
            { id: 'features', title: 'D', order: 4, risk: 'high', estimatedSeconds: 5, dependencies: ['product_thesis'] },
            { id: 'data_model', title: 'E', order: 5, risk: 'high', estimatedSeconds: 5, dependencies: ['product_thesis'] },
        ] as PrdSectionTemplate[];
        const waves = computeWaves(sections);
        expect(waves.map((w) => w.length)).toEqual([1, 2, 2]);
    });
});

describe('buildGenerationSteps', () => {
    it('builds sequential rows and concurrent groups with labels', () => {
        const steps = buildGenerationSteps({}, MODELS);
        expect(steps).toHaveLength(6);
        expect(steps[0].sectionId).toBe('product_basics');
        expect(steps[0].label).toBe('1');
        expect(steps[0].executionMode).toBe('sequential');

        const group = steps[1];
        expect(group.executionMode).toBe('concurrent');
        expect(group.title).toBe('Running concurrently');
        expect(group.children?.map((c) => c.label)).toEqual(['2A', '2B']);
        expect(steps[3].children?.map((c) => c.label)).toEqual(['4A', '4B', '4C']);
    });

    it('falls back to the tier model when no live model is present', () => {
        const steps = buildGenerationSteps({}, MODELS);
        // product_basics is a fast/low-risk section
        expect(steps[0].modelName).toBe('Gemini 3 Flash (preview)');
        // product_thesis (first child of wave 2) is a strong/high-risk section
        expect(steps[1].children?.[0].modelName).toBe('Gemini 3 Pro (preview)');
    });

    it('maps live status, timing, model, and error onto steps', () => {
        const status: SectionStatusMap = {
            product_basics: { tier: 'fast', status: 'complete', ms: 5800, model: 'gemini-2.0-flash' },
            product_thesis: { tier: 'strong', status: 'generating', startedAt: Date.now() },
            metrics_scope: { tier: 'fast', status: 'error', ms: 9200, error: 'Model timeout exceeded' },
        };
        const steps = buildGenerationSteps(status, MODELS);

        const basics = steps[0];
        expect(basics.status).toBe('completed');
        expect(basics.actualSeconds).toBeCloseTo(5.8);
        expect(basics.modelName).toBe('Gemini 2.0 Flash'); // live model overrides tier default

        const thesis = steps[1].children?.[0];
        expect(thesis?.status).toBe('in_progress');

        const metrics = steps[3].children?.find((c) => c.sectionId === 'metrics_scope');
        expect(metrics?.status).toBe('failed');
        expect(metrics?.canRetry).toBe(true);
        expect(metrics?.errorMessage).toBe('Model timeout exceeded');
        expect(metrics?.actualSeconds).toBeCloseTo(9.2);
    });
});

describe('summarizeSteps', () => {
    it('counts completed leaves and derives overall status', () => {
        const status: SectionStatusMap = {
            product_basics: { tier: 'fast', status: 'complete' },
            grounding: { tier: 'fast', status: 'complete' },
            product_thesis: { tier: 'strong', status: 'generating' },
        };
        const steps = buildGenerationSteps(status, MODELS);
        const summary = summarizeSteps(steps);
        expect(summary.total).toBe(10);
        expect(summary.completed).toBe(2);
        expect(summary.percent).toBe(20);
        expect(summary.status).toBe('in_progress');
    });

    it('reports failed when a section errors and none are running', () => {
        const status: SectionStatusMap = {
            metrics_scope: { tier: 'fast', status: 'error', error: 'boom' },
        };
        const steps = buildGenerationSteps(status, MODELS);
        expect(summarizeSteps(steps).status).toBe('failed');
    });

    it('flattenLeaves returns all 10 leaf sections', () => {
        const steps = buildGenerationSteps({}, MODELS);
        expect(flattenLeaves(steps)).toHaveLength(10);
    });
});
