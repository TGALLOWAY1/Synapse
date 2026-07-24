import { describe, it, expect } from 'vitest';
import {
    isOverlayMetadataKey,
    patchDestroysOverlayWork,
    patchTouchesOverlay,
    pickOverlayKeys,
} from '../artifactOverlays';

describe('overlay key classification', () => {
    it('recognizes user-authored keys and rejects generation/authority metadata', () => {
        expect(isOverlayMetadataKey('screenEdits')).toBe(true);
        expect(isOverlayMetadataKey('mockupApproval')).toBe(true);
        expect(isOverlayMetadataKey('validationBlockers')).toBe(false);
        expect(isOverlayMetadataKey('tokensHash')).toBe(false);
    });

    it('picks only user-authored keys, so a restore never drags generation state along', () => {
        expect(pickOverlayKeys({
            screenEdits: { a: 1 },
            planProgress: { t: true },
            tokensHash: 'abc',
            validationBlockers: ['x'],
        })).toEqual({ screenEdits: { a: 1 }, planProgress: { t: true } });
    });

    it('detects whether a patch touches user work at all', () => {
        expect(patchTouchesOverlay({ screenLinks: {} })).toBe(true);
        expect(patchTouchesOverlay({ repairType: 'x' })).toBe(false);
    });
});

describe('patchDestroysOverlayWork', () => {
    it('is false when adding the first edit', () => {
        expect(patchDestroysOverlayWork({}, { screenEdits: { a: { name: 'A' } } })).toBe(false);
        expect(patchDestroysOverlayWork(undefined, { screenEdits: { a: 1 } })).toBe(false);
    });

    it('is false when adding a new entry alongside existing ones', () => {
        expect(patchDestroysOverlayWork(
            { screenEdits: { a: { name: 'A' } } },
            { screenEdits: { a: { name: 'A' }, b: { name: 'B' } } },
        )).toBe(false);
    });

    it('is true when an existing entry is removed (reset to generated)', () => {
        expect(patchDestroysOverlayWork(
            { screenEdits: { a: { name: 'A' } } },
            { screenEdits: {} },
        )).toBe(true);
    });

    it('is true when an existing entry is rewritten', () => {
        expect(patchDestroysOverlayWork(
            { screenEdits: { a: { name: 'A' } } },
            { screenEdits: { a: { name: 'Different' } } },
        )).toBe(true);
    });

    it('is true when a populated array overlay is emptied', () => {
        expect(patchDestroysOverlayWork(
            { extraScreens: [{ id: 's1' }] },
            { extraScreens: [] },
        )).toBe(true);
    });

    it('ignores non-overlay keys entirely', () => {
        expect(patchDestroysOverlayWork(
            { tokensHash: 'old' },
            { tokensHash: 'new' },
        )).toBe(false);
    });
});
