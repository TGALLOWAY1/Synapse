import { describe, it, expect } from 'vitest';
import { tourReducer, initialTourState } from '../useTourState';
import { TOTAL_STEPS, type TourState } from '../../components/tour/tourTypes';

const last = TOTAL_STEPS - 1;
const at = (index: number, overrides: Partial<TourState> = {}): TourState => ({
    activeIndex: index,
    mode: 'guided',
    direction: 'forward',
    ...overrides,
});

describe('initialTourState', () => {
    it('starts at index 0 with the given mode', () => {
        expect(initialTourState('guided')).toEqual({ activeIndex: 0, mode: 'guided', direction: 'forward' });
        expect(initialTourState('overview').mode).toBe('overview');
    });
});

describe('tourReducer', () => {
    it('NEXT advances and sets forward direction', () => {
        expect(tourReducer(at(0), { type: 'NEXT' })).toMatchObject({ activeIndex: 1, direction: 'forward' });
    });

    it('NEXT clamps at the last step', () => {
        expect(tourReducer(at(last), { type: 'NEXT' }).activeIndex).toBe(last);
    });

    it('PREV goes back and sets back direction', () => {
        expect(tourReducer(at(2), { type: 'PREV' })).toMatchObject({ activeIndex: 1, direction: 'back' });
    });

    it('PREV clamps at 0', () => {
        expect(tourReducer(at(0), { type: 'PREV' }).activeIndex).toBe(0);
    });

    it('GOTO jumps and derives direction from the delta', () => {
        expect(tourReducer(at(1), { type: 'GOTO', index: 4 })).toMatchObject({ activeIndex: 4, direction: 'forward' });
        expect(tourReducer(at(4), { type: 'GOTO', index: 1 })).toMatchObject({ activeIndex: 1, direction: 'back' });
    });

    it('GOTO clamps out-of-range indices', () => {
        expect(tourReducer(at(0), { type: 'GOTO', index: 99 }).activeIndex).toBe(last);
        expect(tourReducer(at(3), { type: 'GOTO', index: -5 }).activeIndex).toBe(0);
    });

    it('SET_MODE switches mode without moving', () => {
        const next = tourReducer(at(3), { type: 'SET_MODE', mode: 'overview' });
        expect(next).toMatchObject({ activeIndex: 3, mode: 'overview' });
    });

    it('RESTART returns to guided mode at step 0', () => {
        expect(tourReducer(at(5, { mode: 'overview' }), { type: 'RESTART' })).toMatchObject({
            activeIndex: 0,
            mode: 'guided',
        });
    });
});
