import { describe, expect, it } from 'vitest';
import { buildConsolidatedPlan } from '../services/implementationPlanAdapter';
import {
    buildCoverageMatrix,
    computePlanScope,
    findNextPromptPack,
    orderPromptPacks,
    parsePromptSections,
    readPlanProgress,
} from '../services/implementationPlanInsights';
import type { StructuredImplementationPlan } from '../../types';

function fencePlan(plan: StructuredImplementationPlan): string {
    return `# Implementation Plan\n\n\`\`\`json synapse-plan\n${JSON.stringify(plan)}\n\`\`\``;
}

const STRUCTURED: StructuredImplementationPlan = {
    summary: {
        buildStrategy: 'Thin slices.',
        criticalPath: ['m_setup', 'Core Loop', 'Ship it'],
    },
    milestones: [
        {
            id: 'm_setup',
            name: 'Project Setup',
            goal: 'Scaffold.',
            tasks: [{ id: 't1', title: 'Init app', status: 'todo' }],
            linkedArtifacts: { screens: ['Landing'], dataModels: ['User'] },
            promptPacks: [
                { id: 'pp1', title: 'Scaffold', purpose: 'Init.', prompt: '# P1\n## Goal\nGo.', acceptanceCriteria: [] },
            ],
            qualityGates: [
                { id: 'qg1', title: 'Lint passes', category: 'testing', required: true },
            ],
            validationCommands: ['npm run lint'],
        },
        {
            id: 'm_core',
            name: 'Core Loop',
            goal: 'Main flow.',
            dependencies: ['m_setup'],
            tasks: [
                { id: 't2', title: 'Build screen', status: 'todo' },
                { id: 't3', title: 'Wire store', status: 'todo' },
            ],
            linkedArtifacts: { screens: ['Capture'] },
            promptPacks: [
                { id: 'pp2', title: 'Capture flow', purpose: 'Build it.', prompt: 'plain prompt, no headings', acceptanceCriteria: [] },
            ],
            qualityGates: [
                { id: 'qg2', title: 'Flow works end to end', category: 'functional', required: false },
            ],
        },
    ],
    globalQualityGates: [
        { id: 'g1', title: 'All P0 screens implemented', category: 'functional', required: true },
    ],
};

const plan = buildConsolidatedPlan({ planContent: fencePlan(STRUCTURED) })!;

describe('readPlanProgress', () => {
    it('defaults to empty progress and drops invalid entries', () => {
        expect(readPlanProgress(undefined)).toEqual({ copiedPacks: [] });
        expect(readPlanProgress({ planProgress: 'garbage' })).toEqual({ copiedPacks: [] });
        const read = readPlanProgress({
            planProgress: {
                // Legacy overlays may still carry gateStatuses — ignored now
                // that Synapse ends at the plan + prompts handoff.
                gateStatuses: { qg1: 'passed' },
                copiedPacks: ['pp1', 42],
            },
        });
        expect(read.copiedPacks).toEqual(['pp1']);
    });
});

describe('plan scope + prompt order', () => {
    it('counts scope across milestones and global gates', () => {
        expect(computePlanScope(plan)).toEqual({
            milestones: 2, tasks: 3, promptPacks: 2, qualityGates: 3,
        });
    });

    it('orders packs by milestone and resolves prerequisites', () => {
        const ordered = orderPromptPacks(plan);
        expect(ordered.map(o => o.pack.id)).toEqual(['pp1', 'pp2']);
        expect(ordered[0].prerequisiteNames).toEqual([]);
        expect(ordered[1].prerequisiteNames).toEqual(['Project Setup']);
    });

    it('advances "next prompt" past copied packs and returns null when done', () => {
        const ordered = orderPromptPacks(plan);
        expect(findNextPromptPack(ordered, new Set())!.pack.id).toBe('pp1');
        expect(findNextPromptPack(ordered, new Set(['pp1']))!.pack.id).toBe('pp2');
        expect(findNextPromptPack(ordered, new Set(['pp1', 'pp2']))).toBeNull();
    });
});

describe('coverage matrix', () => {
    it('distinguishes covered / missing / not-tracked cells', () => {
        const matrix = buildCoverageMatrix(plan);
        expect(matrix.tracked).toEqual({ screens: true, dataModels: true, components: false });

        const setup = matrix.rows.find(r => r.milestoneId === 'm_setup')!;
        expect(setup.screens).toEqual({ state: 'covered', items: ['Landing'] });
        // Nothing in the plan links components → honest "not tracked", not a gap.
        expect(setup.components.state).toBe('not_tracked');
        expect(setup.gaps).toEqual([]);

        // Data models ARE tracked elsewhere, so this empty cell is a real gap.
        const core = matrix.rows.find(r => r.milestoneId === 'm_core')!;
        expect(core.dataModels.state).toBe('missing');
        expect(core.gaps).toContain('No linked data models');
        expect(matrix.gapCount).toBeGreaterThan(0);
    });

    it('scopes change impact by linked artifact kind', () => {
        const matrix = buildCoverageMatrix(plan);
        const bySource = new Map(matrix.impact.map(e => [e.source, e]));
        expect(bySource.get('prd')!.scope).toBe('all');
        expect(bySource.get('screens')!.scope).toBe('some');
        expect(bySource.get('screens')!.milestones.map(m => m.id)).toEqual(['m_setup', 'm_core']);
        expect(bySource.get('data_model')!.milestones.map(m => m.id)).toEqual(['m_setup']);
        // Components aren't tracked; design-system impact still scopes off screens.
        expect(bySource.get('design_system')!.scope).toBe('some');
    });
});

describe('prompt sections', () => {
    it('parses prompt headings but ignores headings inside code fences', () => {
        const sections = parsePromptSections('# Title\n## Goal\nDo it.\n```\n## not a heading\n```\nafter');
        expect(sections.map(s => s.heading)).toEqual(['Title', 'Goal']);
        expect(sections[1].body).toContain('## not a heading');
        // Unstructured prompts come back as one heading-less section.
        expect(parsePromptSections('just text')).toEqual([{ heading: null, body: 'just text' }]);
    });
});
