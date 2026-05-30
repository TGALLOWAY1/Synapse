/**
 * Pure, DOM-free swipe-commit decision used by the tour's drag gesture.
 *
 * framer-motion hands us `info.offset.x` (px dragged) and `info.velocity.x`
 * (px/s) on drag end; this helper decides whether that gesture should advance
 * (`next`), go back (`prev`), or spring back (`none`). Kept pure so it can be
 * unit-tested without a DOM.
 *
 * Convention: dragging/flinging LEFT (negative offset/velocity) advances to the
 * NEXT screen; RIGHT (positive) goes to the PREVIOUS screen — matching native
 * horizontal-pager behaviour.
 */
export interface SwipeDecisionInput {
    /** Horizontal drag distance in px (negative = leftward). */
    offset: number;
    /** Horizontal velocity in px/s (negative = leftward). */
    velocity: number;
    /** Width of the swipe container in px (distance threshold is a fraction of this). */
    width: number;
    /** Commit if |offset| exceeds this fraction of `width`. Default 0.25. */
    distanceRatio?: number;
    /** Commit if |velocity| exceeds this many px/s (a quick flick). Default 500. */
    velocityThreshold?: number;
}

export type SwipeDecision = 'next' | 'prev' | 'none';

export function shouldCommitSwipe({
    offset,
    velocity,
    width,
    distanceRatio = 0.25,
    velocityThreshold = 500,
}: SwipeDecisionInput): SwipeDecision {
    const distanceThreshold = Math.max(0, width) * distanceRatio;

    // Leftward: far enough OR fast enough → next.
    if (offset <= -distanceThreshold || velocity <= -velocityThreshold) {
        return 'next';
    }
    // Rightward: far enough OR fast enough → prev.
    if (offset >= distanceThreshold || velocity >= velocityThreshold) {
        return 'prev';
    }
    return 'none';
}
