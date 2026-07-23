import { describe, expect, it } from 'vitest';
import {
    extractProposedReplacement,
    applyStagedEditsToStructuredPRD,
    getStagedEdits,
} from '../stagedBranchEdits';
import type { Branch, StructuredPRD } from '../../types';

const prd: StructuredPRD = {
    vision: 'A calm habit tracker.',
    targetUsers: ['Busy parents'],
    coreProblem: 'Habit apps punish missed days.',
    features: [],
    architecture: 'Local-first.',
    risks: [],
};

describe('extractProposedReplacement', () => {
    it('pulls the replacement out of the marker block', () => {
        const content = 'Here is a sharper version.\n\nSuggested replacement for selected text:\nA forgiving habit tracker.';
        expect(extractProposedReplacement(content)).toBe('A forgiving habit tracker.');
    });

    it('is case-insensitive and uses the last marker', () => {
        const content = 'suggested replacement for selected text: first\nSuggested replacement for selected text: final';
        expect(extractProposedReplacement(content)).toBe('final');
    });

    it('returns null when there is no marker or nothing after it', () => {
        expect(extractProposedReplacement('Just a clarifying question?')).toBeNull();
        expect(extractProposedReplacement('Suggested replacement for selected text:   ')).toBeNull();
        expect(extractProposedReplacement('')).toBeNull();
    });
});

describe('applyStagedEditsToStructuredPRD', () => {
    it('applies distinct edits in sequence', () => {
        const result = applyStagedEditsToStructuredPRD(prd, [
            { branchId: 'b1', anchorText: 'A calm habit tracker.', replacement: 'A forgiving tracker.' },
            { branchId: 'b2', anchorText: 'Habit apps punish missed days.', replacement: 'Apps shame slips.' },
        ]);
        expect(result.applied).toEqual(['b1', 'b2']);
        expect(result.skipped).toHaveLength(0);
        expect(result.structuredPRD.vision).toBe('A forgiving tracker.');
        expect(result.structuredPRD.coreProblem).toBe('Apps shame slips.');
    });

    it('skips (never drops) an edit whose anchor is not found, and applies the rest', () => {
        const result = applyStagedEditsToStructuredPRD(prd, [
            { branchId: 'b1', anchorText: 'A calm habit tracker.', replacement: 'A forgiving tracker.' },
            { branchId: 'b2', anchorText: 'nonexistent passage', replacement: 'x' },
        ]);
        expect(result.applied).toEqual(['b1']);
        expect(result.skipped).toEqual([{ branchId: 'b2', reason: 'not_found' }]);
    });

    it('skips an empty replacement', () => {
        const result = applyStagedEditsToStructuredPRD(prd, [
            { branchId: 'b1', anchorText: 'A calm habit tracker.', replacement: '   ' },
        ]);
        expect(result.applied).toHaveLength(0);
        expect(result.skipped).toEqual([{ branchId: 'b1', reason: 'empty' }]);
    });
});

describe('getStagedEdits', () => {
    it('returns only resolved branches that carry a replacement', () => {
        const branches: Branch[] = [
            { id: 'b1', projectId: 'p', spineVersionId: 's', anchorText: 'a', status: 'resolved', createdAt: 1, messages: [], proposedReplacement: 'A' },
            { id: 'b2', projectId: 'p', spineVersionId: 's', anchorText: 'b', status: 'active', createdAt: 1, messages: [] },
            { id: 'b3', projectId: 'p', spineVersionId: 's', anchorText: 'c', status: 'resolved', createdAt: 1, messages: [] },
        ];
        expect(getStagedEdits(branches)).toEqual([
            { branchId: 'b1', anchorText: 'a', replacement: 'A' },
        ]);
    });
});
