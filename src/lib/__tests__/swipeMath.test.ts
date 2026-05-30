import { describe, it, expect } from 'vitest';
import { shouldCommitSwipe } from '../swipeMath';

const WIDTH = 400; // distance threshold = 100 by default (0.25 * 400)

describe('shouldCommitSwipe', () => {
    it('returns none for a small, slow drag', () => {
        expect(shouldCommitSwipe({ offset: -20, velocity: -50, width: WIDTH })).toBe('none');
        expect(shouldCommitSwipe({ offset: 20, velocity: 50, width: WIDTH })).toBe('none');
    });

    it('commits next when dragged far enough left', () => {
        expect(shouldCommitSwipe({ offset: -120, velocity: 0, width: WIDTH })).toBe('next');
    });

    it('commits prev when dragged far enough right', () => {
        expect(shouldCommitSwipe({ offset: 120, velocity: 0, width: WIDTH })).toBe('prev');
    });

    it('commits on a fast flick even when the distance is short', () => {
        expect(shouldCommitSwipe({ offset: -10, velocity: -800, width: WIDTH })).toBe('next');
        expect(shouldCommitSwipe({ offset: 10, velocity: 800, width: WIDTH })).toBe('prev');
    });

    it('honours custom thresholds', () => {
        // distanceRatio 0.5 → threshold 200, so 120 is no longer enough.
        expect(shouldCommitSwipe({ offset: -120, velocity: 0, width: WIDTH, distanceRatio: 0.5 })).toBe('none');
        expect(
            shouldCommitSwipe({ offset: -10, velocity: -300, width: WIDTH, velocityThreshold: 200 }),
        ).toBe('next');
    });

    it('maps direction by sign (left = next, right = prev)', () => {
        expect(shouldCommitSwipe({ offset: -300, velocity: -900, width: WIDTH })).toBe('next');
        expect(shouldCommitSwipe({ offset: 300, velocity: 900, width: WIDTH })).toBe('prev');
    });
});
