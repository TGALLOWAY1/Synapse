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
