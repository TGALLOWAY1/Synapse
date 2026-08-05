import type { PipelineStage } from '../types';

export type JourneyStepId =
    | 'define'
    | 'refine'
    | 'finalize'
    | 'generate'
    | 'review'
    | 'build';

export type JourneyStepStatus = 'complete' | 'current' | 'available' | 'unavailable';

export type JourneyStepDefinition = {
    id: JourneyStepId;
    label: string;
    description: string;
};

export type JourneyStepPresentation = JourneyStepDefinition & {
    status: JourneyStepStatus;
    enabled: boolean;
};

export type JourneyPresentation = {
    activeStep: JourneyStepId;
    steps: JourneyStepPresentation[];
};

export type JourneyPresentationInput = {
    currentStage: PipelineStage;
    hasStructuredPlan: boolean;
    safetyBlocked?: boolean;
    readinessOpen?: boolean;
    exportOpen?: boolean;
    generationActive?: boolean;
    outputsAvailable?: boolean;
    planFinalized?: boolean;
    reviewComplete?: boolean;
    explicitStep?: JourneyStepId;
    canFinalize?: boolean;
    canGenerate?: boolean;
    canReview?: boolean;
    canBuild?: boolean;
};

export const JOURNEY_STEPS: readonly JourneyStepDefinition[] = [
    {
        id: 'define',
        label: 'Define',
        description: 'Describe the product and create a structured working plan.',
    },
    {
        id: 'refine',
        label: 'Refine',
        description: 'Edit the plan, answer key questions, and challenge its reasoning.',
    },
    {
        id: 'finalize',
        label: 'Finalize',
        description: 'Review readiness and record the plan checkpoint.',
    },
    {
        id: 'generate',
        label: 'Generate',
        description: 'Create downstream product and implementation outputs.',
    },
    {
        id: 'review',
        label: 'Review',
        description: 'Inspect generated outputs and synchronize any changes.',
    },
    {
        id: 'build',
        label: 'Build',
        description: 'Export the reviewed handoff and continue into implementation.',
    },
] as const;

const isLegacyOutputStage = (stage: PipelineStage) =>
    stage === 'mockups' || stage === 'artifacts';

function deriveDefaultActiveStep(input: JourneyPresentationInput): JourneyStepId {
    if (input.readinessOpen) return 'finalize';
    if (input.exportOpen) return 'build';
    if (!input.hasStructuredPlan || input.safetyBlocked) return 'define';

    if (input.currentStage === 'workspace' || isLegacyOutputStage(input.currentStage)) {
        if (input.generationActive || !input.outputsAvailable) return 'generate';
        return 'review';
    }

    // Both persisted planning surfaces (`prd` and `review`) belong to the
    // Refine presentation. A legacy persisted History stage also falls back
    // here while the project-history panel is presented above the workspace.
    return 'refine';
}

// ---------------------------------------------------------------------------
// Phase layer: the rail presents FOUR top-level phases (working-memory budget)
// while the six step ids stay the routing/deep-link vocabulary. `plan` groups
// define/refine/finalize as sub-states; the other phases map 1:1 to steps.

export type JourneyPhaseId = 'plan' | 'generate' | 'review' | 'build';

export type JourneyPhasePresentation = {
    id: JourneyPhaseId;
    label: string;
    description: string;
    status: JourneyStepStatus;
    enabled: boolean;
    /** The step to activate when the phase itself is clicked. */
    targetStep: JourneyStepId;
    /** Plan's sub-states (define/refine/finalize); single-step phases are empty. */
    substeps: JourneyStepPresentation[];
};

const PLAN_STEP_IDS: readonly JourneyStepId[] = ['define', 'refine', 'finalize'];

const PHASE_DEFINITIONS: readonly { id: JourneyPhaseId; label: string; description: string }[] = [
    { id: 'plan', label: 'Plan', description: 'Define the product, refine the plan, and record the readiness checkpoint.' },
    { id: 'generate', label: 'Generate', description: 'Create downstream product and implementation outputs.' },
    { id: 'review', label: 'Review', description: 'Inspect generated outputs and synchronize any changes.' },
    { id: 'build', label: 'Build', description: 'Export the reviewed handoff and continue into implementation.' },
];

export function deriveJourneyPhases(presentation: JourneyPresentation): JourneyPhasePresentation[] {
    const byId = new Map(presentation.steps.map(step => [step.id, step]));
    return PHASE_DEFINITIONS.map(def => {
        if (def.id !== 'plan') {
            const step = byId.get(def.id as JourneyStepId)!;
            return { ...def, status: step.status, enabled: step.enabled, targetStep: step.id, substeps: [] };
        }
        const substeps = PLAN_STEP_IDS.map(id => byId.get(id)!);
        const current = substeps.find(step => step.status === 'current');
        const status: JourneyStepStatus = current
            ? 'current'
            : substeps.every(step => step.status === 'complete')
                ? 'complete'
                : substeps.some(step => step.enabled)
                    ? 'available'
                    : 'unavailable';
        // Clicking Plan lands on the step with live work: the active substep,
        // else the first enabled unfinished one, else the furthest enabled.
        const targetStep = (current
            ?? substeps.find(step => step.enabled && step.status !== 'complete')
            ?? [...substeps].reverse().find(step => step.enabled)
            ?? substeps[0]).id;
        return { ...def, status, enabled: substeps.some(step => step.enabled), targetStep, substeps };
    });
}

export function deriveJourneyPresentation(
    input: JourneyPresentationInput,
): JourneyPresentation {
    const safePlan = input.hasStructuredPlan && !input.safetyBlocked;
    const enabled: Record<JourneyStepId, boolean> = {
        define: true,
        refine: safePlan,
        finalize: safePlan && (input.canFinalize ?? true),
        generate: safePlan && (input.canGenerate ?? true),
        review: safePlan && Boolean(input.outputsAvailable) && (input.canReview ?? true),
        build: input.hasStructuredPlan && (input.canBuild ?? true),
    };
    const defaultActive = deriveDefaultActiveStep(input);
    const activeStep = input.explicitStep && enabled[input.explicitStep]
        ? input.explicitStep
        : defaultActive;
    const completed = new Set<JourneyStepId>();
    if (input.hasStructuredPlan) completed.add('define');
    if (input.planFinalized) {
        completed.add('refine');
        completed.add('finalize');
    }
    if (input.outputsAvailable) completed.add('generate');
    if (input.reviewComplete) completed.add('review');

    return {
        activeStep,
        steps: JOURNEY_STEPS.map(step => ({
            ...step,
            enabled: enabled[step.id],
            status: step.id === activeStep
                ? 'current'
                : completed.has(step.id)
                    ? 'complete'
                    : enabled[step.id]
                        ? 'available'
                        : 'unavailable',
        })),
    };
}
