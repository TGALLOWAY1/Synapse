import { describe, it, expect } from 'vitest';
import { diffText, diffStructuredPRD, getDiffSummary } from '../versionDiff';
import type { StructuredPRD } from '../../types';

const basePRD: StructuredPRD = {
    vision: 'Help teams ship faster',
    targetUsers: ['PMs', 'Engineers'],
    coreProblem: 'Specs are slow to write',
    features: [
        { id: 'f1', name: 'Editor', description: 'Edit specs', userValue: 'Speed', complexity: 'medium' },
    ],
    architecture: 'Client-side SPA',
    risks: ['Scope creep'],
};

describe('diffText', () => {
    it('returns an empty array for two empty strings', () => {
        expect(diffText('', '')).toEqual([]);
    });

    it('returns a single unchanged segment for identical text', () => {
        const segs = diffText('hello world', 'hello world');
        expect(segs).toHaveLength(1);
        expect(segs[0].added).toBeUndefined();
        expect(segs[0].removed).toBeUndefined();
        expect(segs[0].value).toBe('hello world');
    });

    it('marks added text', () => {
        const segs = diffText('hello', 'hello world');
        expect(segs.some(s => s.added && s.value.includes('world'))).toBe(true);
        expect(segs.some(s => s.removed)).toBe(false);
    });

    it('marks removed text', () => {
        const segs = diffText('hello world', 'hello');
        expect(segs.some(s => s.removed && s.value.includes('world'))).toBe(true);
        expect(segs.some(s => s.added)).toBe(false);
    });

    it('marks both removed and added for changed text', () => {
        const segs = diffText('hello world', 'hello there');
        expect(segs.some(s => s.removed)).toBe(true);
        expect(segs.some(s => s.added)).toBe(true);
    });
});

describe('diffStructuredPRD', () => {
    it('classifies all sections unchanged for identical PRDs', () => {
        const diffs = diffStructuredPRD(basePRD, basePRD);
        expect(diffs.every(d => d.kind === 'unchanged')).toBe(true);
        const summary = getDiffSummary(diffs);
        expect(summary.changed).toBe(0);
        expect(summary.added).toBe(0);
        expect(summary.removed).toBe(0);
    });

    it('detects a changed section', () => {
        const after = { ...basePRD, vision: 'Help teams ship even faster' };
        const diffs = diffStructuredPRD(basePRD, after);
        const vision = diffs.find(d => d.key === 'vision')!;
        expect(vision.kind).toBe('changed');
        expect(vision.segments.some(s => s.added)).toBe(true);
    });

    it('detects an added section (absent before, present after)', () => {
        const before: StructuredPRD = { ...basePRD, constraints: undefined };
        const after: StructuredPRD = { ...basePRD, constraints: ['No PII'] };
        const diffs = diffStructuredPRD(before, after);
        const constraints = diffs.find(d => d.key === 'constraints')!;
        expect(constraints.kind).toBe('added');
    });

    it('detects a removed section (present before, absent after)', () => {
        const before: StructuredPRD = { ...basePRD, constraints: ['No PII'] };
        const after: StructuredPRD = { ...basePRD, constraints: [] };
        const diffs = diffStructuredPRD(before, after);
        const constraints = diffs.find(d => d.key === 'constraints')!;
        expect(constraints.kind).toBe('removed');
    });

    it('handles missing/legacy fields safely (undefined PRDs)', () => {
        const diffs = diffStructuredPRD(undefined, undefined);
        expect(diffs.every(d => d.kind === 'unchanged')).toBe(true);
    });

    it('detects a changed features section', () => {
        const after: StructuredPRD = {
            ...basePRD,
            features: [
                { id: 'f1', name: 'Editor Pro', description: 'Edit specs', userValue: 'Speed', complexity: 'medium' },
            ],
        };
        const diffs = diffStructuredPRD(basePRD, after);
        const features = diffs.find(d => d.key === 'features')!;
        expect(features.kind).toBe('changed');
    });
});
