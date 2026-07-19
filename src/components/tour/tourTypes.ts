/** Shared types + screen metadata for the interactive product tour. */

export type TourMode = 'guided' | 'overview';
export type TourDirection = 'forward' | 'back';

export interface TourState {
    /** 0-based index of the visible screen. */
    activeIndex: number;
    mode: TourMode;
    /** Direction of the last navigation — drives the slide transition. */
    direction: TourDirection;
}

export type TourAction =
    | { type: 'NEXT' }
    | { type: 'PREV' }
    | { type: 'GOTO'; index: number }
    | { type: 'SET_MODE'; mode: TourMode }
    | { type: 'RESTART' };

export interface TourScreenMeta {
    /** Stable id (used for keys / aria). */
    id: string;
    /** Full title for screen readers and the overview rail. */
    title: string;
    /** Short label for the compact progress rail. */
    shortLabel: string;
}

/**
 * The seven tour screens, in guided order. The index in this array is the
 * single source of truth for "which screen" — reducer, rail, counter and
 * container all key off it.
 */
export const TOUR_SCREENS: TourScreenMeta[] = [
    { id: 'idea', title: 'Start with a single idea', shortLabel: 'Idea' },
    { id: 'spec', title: 'AI builds the spec section by section', shortLabel: 'Generation' },
    { id: 'refine', title: 'Refine specific parts of the document', shortLabel: 'Refine' },
    { id: 'decisions', title: 'Challenge the plan — the decisions stay yours', shortLabel: 'Decisions' },
    { id: 'versions', title: 'Nothing gets lost — every change is versioned', shortLabel: 'Versions' },
    { id: 'assets', title: 'Commit the reasoning, then generate outputs', shortLabel: 'Build' },
    { id: 'connections', title: 'Everything stays connected', shortLabel: 'Connected' },
];

export const TOTAL_STEPS = TOUR_SCREENS.length;

/** Props every screen component receives. */
export interface ScreenProps {
    /** True while this screen is the visible one — gates auto-play animations. */
    isActive: boolean;
    /** OS reduced-motion preference — screens render their final state instantly. */
    reducedMotion: boolean;
}
