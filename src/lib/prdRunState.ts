// Pure, read-side derivations of where a PRD spine is in its lifecycle:
// clarifying (preflight interview open, generation not started), generating
// (a run is writing the spine in place), or settled. Shared by the workspace
// header badge, the preflight host gate, and the PRD edit lock so the three can
// never disagree about which phase a spine is in.

import type { SpineVersion } from '../types';

/** responseText a spine carries until its first PRD content lands. */
export const PRD_GENERATING_PLACEHOLDER = 'Generating PRD...';

export type PrdRunStateSpine = Pick<
    SpineVersion,
    'preflightSession' | 'structuredPRD' | 'safetyReview' | 'generationPhase' | 'responseText' | 'generationError'
>;

/**
 * True while the spine hosts an open preflight clarification interview: a
 * session exists, it is not completed, no PRD has been produced, and the idea
 * is not safety-blocked. PRD generation has NOT started yet — the spine only
 * carries the placeholder text — so this state must never read as generating.
 */
export function isPreflightClarifying(spine: PrdRunStateSpine | undefined): boolean {
    return !!spine?.preflightSession
        && !spine.preflightSession.completed
        && !spine.structuredPRD
        && spine.safetyReview?.status !== 'blocked';
}

/**
 * True while a PRD generation run may still write this spine IN PLACE
 * (`onPartial` → `onResult`), i.e. while appending a new version on top of it
 * would fork the run. Signals:
 * - never while clarifying (the placeholder is present, but no run started);
 * - the durable `generationPhase === 'running'` flag, stamped when a run begins
 *   and cleared by every settle path — the only signal that also covers the
 *   final consistency-review pass, which emits no section status;
 * - live section activity from the transient section grid (`sectionsRunning`),
 *   which also covers a single-section retry;
 * - the legacy placeholder window (no PRD and no error yet) for spines that
 *   predate `generationPhase`.
 */
export function isPrdRunInFlight(
    spine: PrdRunStateSpine | undefined,
    { sectionsRunning }: { sectionsRunning: boolean },
): boolean {
    if (!spine || isPreflightClarifying(spine)) return false;
    if (spine.generationPhase === 'running' || sectionsRunning) return true;
    return spine.responseText === PRD_GENERATING_PLACEHOLDER
        && !spine.structuredPRD
        && !spine.generationError;
}

export interface HeaderPlanStatusInput {
    blocked: boolean;
    generationFailed: boolean;
    /** Preflight interview open — see isPreflightClarifying. */
    clarifying: boolean;
    /** A PRD run is in flight — see isPrdRunInFlight. */
    generating: boolean;
}

/** The workspace header badge's plan status ("Version N · <status>"). There
 * is no committed/finalized state: the plan is always a working plan, and
 * outputs are generated from it directly. */
export function deriveHeaderPlanStatus(input: HeaderPlanStatusInput): string {
    if (input.blocked) return 'Blocked';
    if (input.generationFailed) return 'Generation failed';
    if (input.clarifying) return 'Clarifying…';
    if (input.generating) return 'Generating…';
    return 'Working plan';
}
