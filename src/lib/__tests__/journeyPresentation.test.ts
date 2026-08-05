import { describe, expect, it } from 'vitest';
import { deriveJourneyPhases, deriveJourneyPresentation } from '../journeyPresentation';

describe('journey presentation', () => {
    it('maps both persisted planning stages to Refine without changing stage keys', () => {
        for (const currentStage of ['prd', 'review'] as const) {
            const presentation = deriveJourneyPresentation({
                currentStage,
                hasStructuredPlan: true,
            });

            expect(presentation.activeStep).toBe('refine');
            expect(presentation.steps.find(step => step.id === 'refine')).toMatchObject({
                status: 'current',
                enabled: true,
            });
        }
    });

    it('derives Define, Generate, and Review from existing project state', () => {
        expect(deriveJourneyPresentation({
            currentStage: 'prd',
            hasStructuredPlan: false,
        }).activeStep).toBe('define');

        expect(deriveJourneyPresentation({
            currentStage: 'workspace',
            hasStructuredPlan: true,
            generationActive: true,
        }).activeStep).toBe('generate');

        expect(deriveJourneyPresentation({
            currentStage: 'workspace',
            hasStructuredPlan: true,
            outputsAvailable: true,
        }).activeStep).toBe('review');
    });

    it('lets checkpoint layers own Finalize and Build presentation', () => {
        expect(deriveJourneyPresentation({
            currentStage: 'prd',
            hasStructuredPlan: true,
            readinessOpen: true,
        }).activeStep).toBe('finalize');

        expect(deriveJourneyPresentation({
            currentStage: 'workspace',
            hasStructuredPlan: true,
            outputsAvailable: true,
            exportOpen: true,
        }).activeStep).toBe('build');
    });

    it('uses only durable state for completed steps', () => {
        const presentation = deriveJourneyPresentation({
            currentStage: 'workspace',
            hasStructuredPlan: true,
            outputsAvailable: true,
            planFinalized: true,
        });
        const statuses = Object.fromEntries(
            presentation.steps.map(step => [step.id, step.status]),
        );

        expect(statuses).toMatchObject({
            define: 'complete',
            refine: 'complete',
            finalize: 'complete',
            generate: 'complete',
            review: 'current',
            build: 'available',
        });
    });

    it('does not allow an explicit unavailable destination to override the safe default', () => {
        const presentation = deriveJourneyPresentation({
            currentStage: 'prd',
            hasStructuredPlan: false,
            explicitStep: 'review',
        });

        expect(presentation.activeStep).toBe('define');
        expect(presentation.steps.find(step => step.id === 'review')).toMatchObject({
            enabled: false,
            status: 'unavailable',
        });
    });
});

describe('journey phase layer', () => {
    it('collapses the six steps into four phases with plan grouping define/refine/finalize', () => {
        const presentation = deriveJourneyPresentation({
            currentStage: 'prd',
            hasStructuredPlan: true,
        });
        const phases = deriveJourneyPhases(presentation);

        expect(phases.map(phase => phase.id)).toEqual(['plan', 'generate', 'review', 'build']);
        const plan = phases[0];
        expect(plan.substeps.map(step => step.id)).toEqual(['define', 'refine', 'finalize']);
        // Active step is refine, so the plan phase is current and clicking it
        // lands on the live sub-step rather than restarting at define.
        expect(plan.status).toBe('current');
        expect(plan.targetStep).toBe('refine');
    });

    it('maps single-step phases one-to-one and mirrors their status', () => {
        const presentation = deriveJourneyPresentation({
            currentStage: 'workspace',
            hasStructuredPlan: true,
            outputsAvailable: true,
            planFinalized: true,
        });
        const phases = deriveJourneyPhases(presentation);
        const byId = Object.fromEntries(phases.map(phase => [phase.id, phase]));

        expect(byId.plan.status).toBe('complete');
        expect(byId.generate).toMatchObject({ targetStep: 'generate', substeps: [] });
        expect(byId.review.status).toBe('current');
    });

    it('keeps plan available (not complete) while any grouped step is unfinished', () => {
        const presentation = deriveJourneyPresentation({
            currentStage: 'workspace',
            hasStructuredPlan: true,
            outputsAvailable: true,
        });
        const phases = deriveJourneyPhases(presentation);
        const plan = phases[0];

        // define is complete but refine/finalize are not, and the active step
        // lives outside the plan group.
        expect(plan.status).toBe('available');
        expect(plan.targetStep).toBe('refine');
    });
});
