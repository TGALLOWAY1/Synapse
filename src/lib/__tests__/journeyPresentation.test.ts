import { describe, expect, it } from 'vitest';
import { deriveJourneyPresentation } from '../journeyPresentation';

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
