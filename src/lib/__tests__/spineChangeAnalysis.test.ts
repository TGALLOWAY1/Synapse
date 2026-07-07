import { describe, it, expect } from 'vitest';
import {
    diffFeatures,
    summarizeSpineChange,
    isLikelyUnaffected,
    findFeatureReferences,
    makeSpineChangeResolver,
} from '../spineChangeAnalysis';
import type { Feature, StructuredPRD } from '../../types';

const feature = (id: string, name: string, overrides: Partial<Feature> = {}): Feature => ({
    id,
    name,
    description: `${name} description`,
    userValue: 'value',
    complexity: 'low',
    ...overrides,
});

const basePrd = (overrides: Partial<StructuredPRD> = {}): StructuredPRD => ({
    vision: 'A tool for teams',
    targetUsers: ['Managers'],
    coreProblem: 'Coordination is hard',
    features: [feature('feat-tasks', 'Task Boards'), feature('feat-chat', 'Team Chat')],
    architecture: 'Local-first SPA',
    risks: ['Adoption'],
    ...overrides,
});

describe('diffFeatures', () => {
    it('classifies added, removed, renamed, and changed by stable id', () => {
        const before = [
            feature('a', 'Alpha'),
            feature('b', 'Beta'),
            feature('c', 'Gamma', { complexity: 'low' }),
        ];
        const after = [
            feature('a', 'Alpha Prime', { description: 'Alpha description' }), // renamed only
            feature('c', 'Gamma', { complexity: 'high' }), // changed
            feature('d', 'Delta'), // added
        ];
        const diff = diffFeatures(before, after);
        expect(diff.added).toEqual([{ id: 'd', name: 'Delta' }]);
        expect(diff.removed).toEqual([{ id: 'b', name: 'Beta' }]);
        expect(diff.renamed).toEqual([{ id: 'a', from: 'Alpha', to: 'Alpha Prime' }]);
        expect(diff.changed).toEqual([{ id: 'c', name: 'Gamma', changedFields: ['complexity'] }]);
    });

    it('reports no changes for identical lists and tolerates undefined', () => {
        const list = [feature('a', 'Alpha')];
        const diff = diffFeatures(list, [...list]);
        expect(diff.added).toHaveLength(0);
        expect(diff.removed).toHaveLength(0);
        expect(diff.renamed).toHaveLength(0);
        expect(diff.changed).toHaveLength(0);
        expect(diffFeatures(undefined, undefined)).toEqual({
            added: [], removed: [], renamed: [], changed: [],
        });
    });

    it('compares optional array fields (acceptanceCriteria) semantically', () => {
        const before = [feature('a', 'Alpha', { acceptanceCriteria: ['one'] })];
        const after = [feature('a', 'Alpha', { acceptanceCriteria: ['one', 'two'] })];
        expect(diffFeatures(before, after).changed).toEqual([
            { id: 'a', name: 'Alpha', changedFields: ['acceptanceCriteria'] },
        ]);
    });
});

describe('summarizeSpineChange', () => {
    it('produces a deterministic headline covering features and sections', () => {
        const before = basePrd();
        const after = basePrd({
            features: [feature('feat-tasks', 'Task Boards')], // feat-chat removed
            architecture: 'Server-first with Postgres',
        });
        const summary = summarizeSpineChange(before, after);
        expect(summary.comparable).toBe(true);
        expect(summary.hasChanges).toBe(true);
        expect(summary.features.removed).toEqual([{ id: 'feat-chat', name: 'Team Chat' }]);
        expect(summary.changedSectionKeys).toContain('architecture');
        expect(summary.headline).toContain('1 feature removed');
        expect(summary.headline).toContain('Architecture');
    });

    it('reports no structural changes for identical PRDs', () => {
        const prd = basePrd();
        const summary = summarizeSpineChange(prd, { ...prd });
        expect(summary.hasChanges).toBe(false);
        expect(summary.headline).toBe('No structural changes detected');
    });

    it('degrades to a generic headline when a side lacks a structured PRD', () => {
        const summary = summarizeSpineChange(undefined, basePrd());
        expect(summary.comparable).toBe(false);
        expect(summary.hasChanges).toBe(true);
        expect(summary.sections).toHaveLength(0);
        expect(summary.headline).toContain('PRD content changed');
    });
});

describe('isLikelyUnaffected', () => {
    it('flags slots whose affinity sections did not change', () => {
        // Risks-only change: screens/mockups chiefly derive from features/UX,
        // not risks — advisory note applies. Implementation plan includes
        // risks in its affinity — no note.
        const summary = summarizeSpineChange(basePrd(), basePrd({ risks: ['Adoption', 'Churn'] }));
        expect(isLikelyUnaffected('screen_inventory', summary)).toBe(true);
        expect(isLikelyUnaffected('mockup', summary)).toBe(true);
        expect(isLikelyUnaffected('implementation_plan', summary)).toBe(false);
    });

    it('never fires on feature changes, universal sections, or weak evidence', () => {
        const featureChange = summarizeSpineChange(
            basePrd(),
            basePrd({ features: [feature('feat-tasks', 'Task Boards')] }),
        );
        expect(isLikelyUnaffected('data_model', featureChange)).toBe(false);

        const visionChange = summarizeSpineChange(basePrd(), basePrd({ vision: 'New vision' }));
        expect(isLikelyUnaffected('screen_inventory', visionChange)).toBe(false);

        const incomparable = summarizeSpineChange(undefined, basePrd());
        expect(isLikelyUnaffected('screen_inventory', incomparable)).toBe(false);

        const unchanged = summarizeSpineChange(basePrd(), basePrd());
        expect(isLikelyUnaffected('screen_inventory', unchanged)).toBe(false);
    });
});

describe('findFeatureReferences', () => {
    const candidates = [
        { artifactId: 'a1', slot: 'user_flows', title: 'User Flows', content: 'Step 3: open Team Chat panel' },
        { artifactId: 'a2', slot: 'data_model', title: 'Data Model', content: 'Entities: Task, Board. Related Features: feat-chat' },
        { artifactId: 'a3', slot: 'design_system', title: 'Design System', content: 'Palette and typography only.' },
    ];

    it('matches by id first, then by whole-word name', () => {
        const hits = findFeatureReferences({ id: 'feat-chat', name: 'Team Chat' }, candidates);
        expect(hits).toEqual([
            { artifactId: 'a1', slot: 'user_flows', title: 'User Flows', matchedBy: 'name' },
            { artifactId: 'a2', slot: 'data_model', title: 'Data Model', matchedBy: 'id' },
        ]);
    });

    it('skips short needles and partial-word matches (conservative)', () => {
        // Short id AND short name — both below the match threshold.
        expect(findFeatureReferences({ id: 'F1', name: 'app' }, candidates)).toHaveLength(0);
        // "Chat" alone should not match inside "Chatter".
        const hits = findFeatureReferences(
            { id: 'feat-none', name: 'Chatter' },
            [{ artifactId: 'x', title: 'X', content: 'ChatterBox is unrelated' }],
        );
        expect(hits).toHaveLength(0);
    });
});

describe('makeSpineChangeResolver', () => {
    const spines = [
        { id: 's1', structuredPRD: basePrd() },
        { id: 's2', structuredPRD: basePrd({ risks: ['Adoption', 'Churn'] }) },
    ];

    it('summarizes drift against the latest spine and returns null for the latest', () => {
        const resolve = makeSpineChangeResolver(spines, 's2');
        expect(resolve('s2')).toBeNull();
        const summary = resolve('s1');
        expect(summary?.hasChanges).toBe(true);
        expect(summary?.changedSectionKeys).toEqual(['risks']);
        // Memoized: same reference on repeat calls.
        expect(resolve('s1')).toBe(summary);
    });

    it('returns null for unknown ids or when no latest spine exists', () => {
        expect(makeSpineChangeResolver(spines, 's2')('nope')).toBeNull();
        expect(makeSpineChangeResolver(spines, undefined)('s1')).toBeNull();
    });
});
