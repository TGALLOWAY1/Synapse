import type { PipelineStage } from '../types';

/**
 * The workspace journey, as presented: **Plan · Decide · Build**. A pure
 * projection over the persisted stage keys (`prd`, `review`, `workspace`,
 * legacy `history`) plus the Decision Center slide-over — the stage keys and
 * routes are unchanged, only the presented steps collapsed. There is no
 * Finalize, Generate, or Review step and no "unavailable" label: output
 * generation is reached from the Plan page and the Build stage directly.
 *
 * History Mode (a historical, non-latest PRD version selected for viewing)
 * is a read-only Plan view: Build stays inert there, because the Build stage
 * would regenerate outputs from that old PRD and make them current.
 */
export type JourneyStepId = 'plan' | 'decide' | 'build';

export type JourneyStepDefinition = {
    id: JourneyStepId;
    label: string;
    description: string;
};

export type JourneyStepPresentation = JourneyStepDefinition & {
    current: boolean;
    enabled: boolean;
    /** Decide only: records awaiting an answer (the Decision Center's
     * Needs-attention count). Absent when there is nothing open. */
    badge?: number;
};

export type JourneyPresentation = {
    activeStep: JourneyStepId;
    steps: JourneyStepPresentation[];
};

export type JourneyPresentationInput = {
    currentStage: PipelineStage;
    hasStructuredPlan: boolean;
    safetyBlocked?: boolean;
    /** A historical (non-latest) PRD version is selected — History Mode. */
    viewingHistoricalVersion?: boolean;
    /** The Decision Center slide-over is open over the current surface. */
    decisionCenterOpen?: boolean;
    /** Open decisions + assumptions to confirm. */
    openItemCount?: number;
};

const JOURNEY_STEPS: readonly JourneyStepDefinition[] = [
    {
        id: 'plan',
        label: 'Plan',
        description: 'Shape the working plan: edit the PRD, confirm features, and challenge its reasoning.',
    },
    {
        id: 'decide',
        label: 'Decide',
        description: 'Answer open decisions and confirm assumptions in the Decision Center.',
    },
    {
        id: 'build',
        label: 'Build',
        description: 'Generate, review, and export the design and implementation outputs.',
    },
] as const;

/** The persisted stage keys the Build step presents (`workspace`, plus the
 * legacy `mockups` / `artifacts` keys). */
export const isOutputPipelineStage = (stage: PipelineStage): boolean =>
    stage === 'workspace' || stage === 'mockups' || stage === 'artifacts';

export function deriveJourneyPresentation(
    input: JourneyPresentationInput,
): JourneyPresentation {
    const safePlan = input.hasStructuredPlan && !input.safetyBlocked;
    const enabled: Record<JourneyStepId, boolean> = {
        plan: true,
        decide: safePlan,
        // The Build stage renders only over a safe structured plan; without one
        // the workspace falls back to the plan view, so the step stays inert.
        // A historical spine never drives the Build stage (History Mode is a
        // read-only Plan view), so Build is inert until the user returns to
        // the latest version.
        build: safePlan && !input.viewingHistoricalVersion,
    };
    // The Decision Center is a layer over the current surface, so it wins
    // while open. Both planning surfaces (`prd` and the `review` Challenge
    // stage) and a legacy persisted History stage present as Plan.
    const activeStep: JourneyStepId = input.decisionCenterOpen && enabled.decide
        ? 'decide'
        : enabled.build && isOutputPipelineStage(input.currentStage)
            ? 'build'
            : 'plan';
    const openItemCount = Math.max(0, input.openItemCount ?? 0);

    return {
        activeStep,
        steps: JOURNEY_STEPS.map(step => ({
            ...step,
            current: step.id === activeStep,
            enabled: enabled[step.id],
            ...(step.id === 'decide' && enabled.decide && openItemCount > 0
                ? { badge: openItemCount }
                : {}),
        })),
    };
}
