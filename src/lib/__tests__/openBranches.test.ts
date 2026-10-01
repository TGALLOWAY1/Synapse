import { describe, expect, it } from 'vitest';
import { isOpenBranch, repointOpenBranches, repointProjectOpenBranches } from '../openBranches';
import type { Branch } from '../../types';

const branch = (id: string, status: Branch['status'], spineVersionId = 'v1'): Branch => ({
    id,
    projectId: 'p1',
    spineVersionId,
    anchorText: `anchor ${id}`,
    status,
    createdAt: 1,
    messages: [],
});

describe('isOpenBranch', () => {
    it('treats live conversations and staged edits as open, merged and rejected as history', () => {
        expect(isOpenBranch({ status: 'active' })).toBe(true);
        expect(isOpenBranch({ status: 'resolved' })).toBe(true);
        expect(isOpenBranch({ status: 'merged' })).toBe(false);
        expect(isOpenBranch({ status: 'rejected' })).toBe(false);
    });
});

describe('repointOpenBranches', () => {
    it('moves only open branches onto the new version', () => {
        const input = [branch('a', 'active'), branch('s', 'resolved'), branch('m', 'merged'), branch('r', 'rejected')];
        const next = repointOpenBranches(input, 'v2');
        expect(next.map(item => [item.id, item.spineVersionId])).toEqual([
            ['a', 'v2'], ['s', 'v2'], ['m', 'v1'], ['r', 'v1'],
        ]);
        // Untouched branches keep their object identity; the input is not mutated.
        expect(next[2]).toBe(input[2]);
        expect(input[0].spineVersionId).toBe('v1');
    });

    it('returns the input array itself when nothing moves', () => {
        const alreadyThere = [branch('a', 'active', 'v2'), branch('m', 'merged')];
        expect(repointOpenBranches(alreadyThere, 'v2')).toBe(alreadyThere);
        const noneOpen = [branch('m', 'merged')];
        expect(repointOpenBranches(noneOpen, 'v2')).toBe(noneOpen);
    });
});

describe('repointProjectOpenBranches', () => {
    it('re-points one project and keeps the map reference when nothing moved', () => {
        const other = [branch('o', 'active', 'other-v1')];
        const map = { p1: [branch('a', 'active')], p2: other };
        const next = repointProjectOpenBranches(map, 'p1', 'v2');
        expect(next).not.toBe(map);
        expect(next.p1[0].spineVersionId).toBe('v2');
        expect(next.p2).toBe(other);

        expect(repointProjectOpenBranches(next, 'p1', 'v2')).toBe(next);
        expect(repointProjectOpenBranches(map, 'missing', 'v2')).toBe(map);
    });
});
