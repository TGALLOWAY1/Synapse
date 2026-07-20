import { planningReadinessCopy } from './planningLanguage';
import type { PlanningReadiness } from './planningReadiness';

/**
 * Presentation-only projection of the Plan-stage overview card. Every freshly
 * generated PRD lands in `needs_decisions` (imported assumptions are open and
 * scope is unconfirmed), so that phase alone must never read as a warning — a
 * caution that fires for 100% of new drafts carries no signal and turns the
 * product's moment of success into alarm. The caution treatment is reserved
 * for genuine regressions: conflicts and changed sources. This never alters
 * readiness authority; `derivePlanningReadiness` remains the single source of
 * phase truth.
 */
export type PlanningOverviewTone = 'exploring' | 'calm' | 'caution' | 'challenge' | 'alignment' | 'ready';

export type PlanningOverviewPresentation = {
    tone: PlanningOverviewTone;
    headline: string;
    summary: string;
    hasRegression: boolean;
};

const phaseTone: Record<PlanningReadiness['phase'], PlanningOverviewTone> = {
    exploring: 'exploring',
    needs_decisions: 'caution',
    ready_to_challenge: 'challenge',
    needs_alignment: 'alignment',
    ready_to_build: 'ready',
};

export function derivePlanningOverviewPresentation(
    readiness: PlanningReadiness,
    openQuestionCount: number,
): PlanningOverviewPresentation {
    const hasRegression = readiness.conflictCount > 0 || readiness.changedSourceCount > 0;
    if (readiness.phase === 'needs_decisions' && !hasRegression) {
        return {
            tone: 'calm',
            headline: 'Your draft is ready',
            summary: openQuestionCount > 0
                ? `Synapse filled ${openQuestionCount} gap${openQuestionCount === 1 ? '' : 's'} with working assumptions while drafting. A few quick answers will sharpen the plan around what you actually know.`
                : 'A few confirmations will sharpen the plan around what you actually know.',
            hasRegression,
        };
    }
    return {
        tone: phaseTone[readiness.phase],
        headline: planningReadinessCopy(readiness.phase).label,
        summary: readiness.summary,
        hasRegression,
    };
}
