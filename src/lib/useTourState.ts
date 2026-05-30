import { useEffect, useReducer } from 'react';
import {
    type TourAction,
    type TourMode,
    type TourState,
    TOTAL_STEPS,
} from '../components/tour/tourTypes';
import { hasCompletedTour, markCompleted } from './tourPersistence';

const lastIndex = TOTAL_STEPS - 1;
const clamp = (n: number) => Math.max(0, Math.min(n, lastIndex));

/** Pure reducer — exported for unit tests. */
export function tourReducer(state: TourState, action: TourAction): TourState {
    switch (action.type) {
        case 'NEXT':
            return { ...state, activeIndex: clamp(state.activeIndex + 1), direction: 'forward' };
        case 'PREV':
            return { ...state, activeIndex: clamp(state.activeIndex - 1), direction: 'back' };
        case 'GOTO': {
            const index = clamp(action.index);
            return {
                ...state,
                activeIndex: index,
                direction: index >= state.activeIndex ? 'forward' : 'back',
            };
        }
        case 'SET_MODE':
            return { ...state, mode: action.mode };
        case 'RESTART':
            return { activeIndex: 0, mode: 'guided', direction: 'back' };
        default:
            return state;
    }
}

export function initialTourState(mode: TourMode): TourState {
    return { activeIndex: 0, mode, direction: 'forward' };
}

export interface UseTourStateResult {
    state: TourState;
    dispatch: React.Dispatch<TourAction>;
}

/**
 * Single source of truth for the tour. First-time visitors start in `guided`
 * mode; anyone who has completed the tour before starts in `overview` mode
 * (decided once, at mount, from the persisted completion flag).
 *
 * Reaching the final screen — by any route (guided Next, swipe, arrow key, or
 * an overview jump) — marks the tour completed exactly once.
 */
export function useTourState(): UseTourStateResult {
    const [state, dispatch] = useReducer(
        tourReducer,
        hasCompletedTour() ? 'overview' : 'guided',
        initialTourState,
    );

    useEffect(() => {
        if (state.activeIndex === lastIndex) {
            markCompleted();
        }
    }, [state.activeIndex]);

    return { state, dispatch };
}
