import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    TOUR_COMPLETED_KEY,
    hasCompletedTour,
    markCompleted,
    resetTour,
} from '../tourPersistence';

describe('tourPersistence', () => {
    beforeEach(() => {
        localStorage.clear();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reports not-completed initially', () => {
        expect(hasCompletedTour()).toBe(false);
    });

    it('persists and reads completion', () => {
        markCompleted();
        expect(localStorage.getItem(TOUR_COMPLETED_KEY)).toBe('true');
        expect(hasCompletedTour()).toBe(true);
    });

    it('resetTour clears completion', () => {
        markCompleted();
        resetTour();
        expect(hasCompletedTour()).toBe(false);
    });

    it('swallows localStorage errors (private mode / disabled storage)', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('denied');
        });
        expect(() => markCompleted()).not.toThrow();
        expect(hasCompletedTour()).toBe(false);
    });
});
