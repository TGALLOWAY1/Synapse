import { describe, expect, it } from 'vitest';
import { deriveJourneyPresentation } from '../journeyPresentation';

describe('journey presentation (Plan · Decide · Build)', () => {
    it('presents exactly three steps — no Finalize, Generate, or Review', () => {
        const presentation = deriveJourneyPresentation({ currentStage: 'prd', hasStructuredPlan: true });
        expect(presentation.steps.map(step => step.id)).toEqual(['plan', 'decide', 'build']);
        expect(presentation.steps.map(step => step.label)).toEqual(['Plan', 'Decide', 'Build']);
    });

    it('maps both persisted planning stages and the legacy History stage to Plan without changing stage keys', () => {
        for (const currentStage of ['prd', 'review', 'history'] as const) {
            const presentation = deriveJourneyPresentation({ currentStage, hasStructuredPlan: true });
            expect(presentation.activeStep).toBe('plan');
            expect(presentation.steps.find(step => step.id === 'plan')).toMatchObject({ current: true, enabled: true });
        }
    });

    it('maps the outputs stage (and legacy output stages) to Build', () => {
        for (const currentStage of ['workspace', 'mockups', 'artifacts'] as const) {
            expect(deriveJourneyPresentation({ currentStage, hasStructuredPlan: true }).activeStep).toBe('build');
        }
    });

    it('presents Decide while the Decision Center is open over any surface', () => {
        for (const currentStage of ['prd', 'workspace'] as const) {
            const presentation = deriveJourneyPresentation({
                currentStage,
                hasStructuredPlan: true,
                decisionCenterOpen: true,
            });
            expect(presentation.activeStep).toBe('decide');
            expect(presentation.steps.filter(step => step.current).map(step => step.id)).toEqual(['decide']);
        }
    });

    it('keeps Decide and Build inert without a safe structured plan, and never labels them unavailable', () => {
        for (const input of [
            { currentStage: 'prd' as const, hasStructuredPlan: false },
            { currentStage: 'workspace' as const, hasStructuredPlan: true, safetyBlocked: true },
        ]) {
            const presentation = deriveJourneyPresentation(input);
            expect(presentation.activeStep).toBe('plan');
            expect(presentation.steps.map(step => step.enabled)).toEqual([true, false, false]);
            expect(JSON.stringify(presentation)).not.toMatch(/unavailable/i);
        }
    });

    it('badges Decide with the open-item count only when something is open', () => {
        const withItems = deriveJourneyPresentation({ currentStage: 'prd', hasStructuredPlan: true, openItemCount: 4 });
        expect(withItems.steps.find(step => step.id === 'decide')?.badge).toBe(4);
        expect(withItems.steps.find(step => step.id === 'plan')?.badge).toBeUndefined();

        const none = deriveJourneyPresentation({ currentStage: 'prd', hasStructuredPlan: true, openItemCount: 0 });
        expect(none.steps.find(step => step.id === 'decide')).not.toHaveProperty('badge');

        const noPlan = deriveJourneyPresentation({ currentStage: 'prd', hasStructuredPlan: false, openItemCount: 2 });
        expect(noPlan.steps.find(step => step.id === 'decide')).not.toHaveProperty('badge');
    });
});
