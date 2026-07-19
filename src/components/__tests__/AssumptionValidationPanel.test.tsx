import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AssumptionEvidenceRecord, AssumptionValidationPlan } from '../../types';
import {
    AssumptionValidationPanel,
    type AssumptionValidationView,
} from '../review/AssumptionValidationPanel';

const plan: AssumptionValidationPlan = {
    id: 'plan-1',
    question: 'Will independent creators pay $20 per month after trying the core workflow?',
    method: { kind: 'user_interviews', label: 'Five focused user interviews' },
    supportSignals: ['Creators describe the problem as urgent and accept the price after a trial.'],
    contradictionSignals: ['Creators will only use a permanently free tier.'],
    inconclusiveConditions: ['Participants discuss intent without making a realistic choice.'],
    limitations: ['A small sample cannot estimate market-wide conversion.'],
    revisitCondition: 'Before pricing is finalized',
    authoredBy: 'user',
    createdAt: 10,
    contentHash: 'plan-hash',
};

const evidence = (overrides: Partial<AssumptionEvidenceRecord> = {}): AssumptionEvidenceRecord => ({
    id: 'evidence-1', planningRecordId: 'assumption-1', sourceType: 'user_interview',
    source: 'Creator interview 1', sourceIdentity: 'session-1', observedAt: 20, recordedAt: 21,
    observation: 'The creator would pay after completing the core workflow.',
    validationQuestion: plan.question, scopeOrSample: 'One independent creator', limitations: ['Self-reported intent'],
    character: 'direct', relation: 'supports', assumptionStatementHash: 'statement-hash',
    validationPlanHash: plan.contentHash, sourceFingerprint: 'source-fingerprint', authoredBy: 'user',
    contentHash: 'evidence-hash', ...overrides,
});

const baseValidation = (overrides: Partial<AssumptionValidationView> = {}): AssumptionValidationView => ({
    workflowState: 'not_planned', activeEvidence: [], duplicateEvidenceIds: [],
    evidenceFromAnotherQuestionIds: [], conclusionIsCurrent: false, hasHistoricalValidation: false,
    dependentLabels: ['Pricing', 'First-release scope'], history: [], ...overrides,
});

const callbacks = () => ({
    onGeneratePlan: vi.fn(), onRecordPlan: vi.fn(), onAddEvidence: vi.fn(),
    onCorrectEvidence: vi.fn(), onRetractEvidence: vi.fn(),
    onInterpretEvidence: vi.fn(), onRecordOutcome: vi.fn(), onRecordTreatment: vi.fn(),
    onReopenOutcome: vi.fn(), onPreviewImpact: vi.fn(),
});

describe('AssumptionValidationPanel', () => {
    it('keeps a generated validation plan advisory until the user records an editable draft', () => {
        const handlers = callbacks();
        const proposal = {
            id: 'proposal-1', planningRecordId: 'assumption-1', contractVersion: 1 as const,
            authoredBy: 'synapse' as const, question: plan.question, method: plan.method,
            supportSignals: plan.supportSignals, contradictionSignals: plan.contradictionSignals,
            inconclusiveConditions: plan.inconclusiveConditions, limitations: plan.limitations,
            revisitCondition: plan.revisitCondition, assumptionStatementHash: 'statement-hash',
            evidenceSetHash: 'empty-evidence', createdAt: 10, contentHash: 'proposal-hash',
        };
        render(<AssumptionValidationPanel recordId="assumption-1" validation={baseValidation({ latestPlanProposal: proposal })} requiresValidation hasPlanImpact={false} consequence="Pricing may not sustain the product." {...handlers} />);

        expect(screen.getByText('Synapse proposal · not yet your plan')).toBeInTheDocument();
        expect(handlers.onRecordPlan).not.toHaveBeenCalled();
        expect(handlers.onRecordOutcome).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Use suggestion as a draft' }));
        expect(screen.getByLabelText('Validation question')).toHaveValue(plan.question);
        fireEvent.click(screen.getByRole('button', { name: 'Record my validation plan' }));

        expect(handlers.onRecordPlan).toHaveBeenCalledWith('assumption-1', expect.objectContaining({
            question: plan.question,
            sourceProposalId: 'proposal-1',
            sourceProposalContentHash: 'proposal-hash',
        }));
        expect(handlers.onRecordOutcome).not.toHaveBeenCalled();
    });

    it('shows duplicate and irrelevant evidence without treating either as independent support', () => {
        const handlers = callbacks();
        const duplicate = evidence({ id: 'evidence-duplicate', source: 'Copy of interview summary', contentHash: 'duplicate-hash' });
        const irrelevant = evidence({ id: 'evidence-irrelevant', source: 'General market report', sourceIdentity: 'report-1', sourceFingerprint: 'report-fingerprint', relation: 'irrelevant', observation: 'The report describes the market but does not test willingness to pay.', contentHash: 'irrelevant-hash' });
        render(<AssumptionValidationPanel recordId="assumption-1" validation={baseValidation({ currentPlan: plan, workflowState: 'in_progress', activeEvidence: [duplicate, irrelevant], duplicateEvidenceIds: [duplicate.id] })} requiresValidation hasPlanImpact={false} {...handlers} />);

        fireEvent.click(screen.getByText(/2\. Add evidence/));
        const evidenceList = screen.getByRole('list', { name: 'Recorded evidence' });
        expect(within(evidenceList).getByText(/Duplicate source/)).toBeInTheDocument();
        expect(within(evidenceList).getByText(/does not count as support/)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Prototype checkout test' } });
        fireEvent.change(screen.getByLabelText('Source identity'), { target: { value: 'prototype-run-7' } });
        fireEvent.change(screen.getByLabelText('Observed on'), { target: { value: '2026-06-10' } });
        fireEvent.change(screen.getByLabelText('Observation or result'), { target: { value: 'Three participants abandoned at checkout.' } });
        const add = screen.getByRole('button', { name: 'Add evidence' });
        expect(add).toHaveClass('min-h-11', 'w-full');
        fireEvent.click(add);
        expect(handlers.onAddEvidence).toHaveBeenCalledWith('assumption-1', expect.objectContaining({
            sourceIdentity: 'prototype-run-7',
            observedAt: new Date('2026-06-10T12:00:00').getTime(),
        }));
    });

    it('corrects or retracts exact active evidence only with an explicit user reason', () => {
        const handlers = callbacks();
        const currentEvidence = evidence();
        render(<AssumptionValidationPanel
            recordId="assumption-1"
            validation={baseValidation({
                currentPlan: plan,
                workflowState: 'in_progress',
                activeEvidence: [currentEvidence],
                evidenceSetHash: 'evidence-set-hash',
                sourceSpineVersionId: 'spine-1',
                sourceSpineContentHash: 'spine-content-hash',
            })}
            requiresValidation
            hasPlanImpact={false}
            {...handlers}
        />);

        fireEvent.click(screen.getByText(/2\. Add evidence/));
        fireEvent.click(screen.getByRole('button', { name: 'Correct' }));
        expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled();
        fireEvent.change(screen.getByLabelText(`Corrected observation for ${currentEvidence.source}`), {
            target: { value: 'The creator abandoned when the price appeared.' },
        });
        fireEvent.change(screen.getByLabelText(`Correction reason for ${currentEvidence.source}`), {
            target: { value: 'The original note reversed the observed behavior.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
        expect(handlers.onCorrectEvidence).toHaveBeenCalledWith('assumption-1', expect.objectContaining({
            evidenceId: currentEvidence.id,
            expectedEvidenceContentHash: currentEvidence.contentHash,
            expectedEvidenceSetHash: 'evidence-set-hash',
            expectedSpineVersionId: 'spine-1',
            reason: 'The original note reversed the observed behavior.',
            replacement: expect.objectContaining({
                observation: 'The creator abandoned when the price appeared.',
                sourceIdentity: currentEvidence.sourceIdentity,
            }),
        }));

        fireEvent.click(screen.getByRole('button', { name: 'Retract' }));
        expect(screen.getByRole('button', { name: 'Retract evidence' })).toBeDisabled();
        fireEvent.change(screen.getByLabelText(`Retraction reason for ${currentEvidence.source}`), {
            target: { value: 'The session was attributed to the wrong participant.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Retract evidence' }));
        expect(handlers.onRetractEvidence).toHaveBeenCalledWith('assumption-1', {
            evidenceId: currentEvidence.id,
            expectedEvidenceContentHash: currentEvidence.contentHash,
            expectedEvidenceSetHash: 'evidence-set-hash',
            expectedSpineVersionId: 'spine-1',
            expectedSpineContentHash: 'spine-content-hash',
            reason: 'The session was attributed to the wrong participant.',
        });
    });

    it('allows contradictory evidence to remain inconclusive and never turns advisory interpretation into authority', () => {
        const handlers = callbacks();
        const supporting = evidence();
        const contradicting = evidence({ id: 'evidence-2', source: 'Observed checkout test', sourceIdentity: 'prototype-test-1', sourceFingerprint: 'prototype-fingerprint', relation: 'contradicts', observation: 'Participants abandoned when the price appeared.', contentHash: 'evidence-2-hash' });
        const interpretation = {
            id: 'interpretation-1', planningRecordId: 'assumption-1', contractVersion: 1 as const,
            authoredBy: 'synapse' as const, recommendedConclusion: 'inconclusive' as const,
            reasoning: 'Independent evidence points in conflicting directions.', supportingEvidenceIds: [supporting.id],
            contradictingEvidenceIds: [contradicting.id], inconclusiveEvidenceIds: [], irrelevantEvidenceIds: [],
            duplicateEvidenceIds: [], limitations: ['The sample is small.'], assumptionStatementHash: 'statement-hash',
            validationPlanHash: plan.contentHash, evidenceSetHash: 'evidence-set', createdAt: 30,
            contentHash: 'interpretation-hash',
        };
        render(<AssumptionValidationPanel recordId="assumption-1" validation={baseValidation({ currentPlan: plan, workflowState: 'in_progress', activeEvidence: [supporting, contradicting], latestInterpretation: interpretation })} requiresValidation hasPlanImpact={false} {...handlers} />);

        expect(screen.getByText('Synapse interpretation · advisory')).toBeInTheDocument();
        expect(handlers.onRecordOutcome).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Use as my draft conclusion' }));
        expect(screen.getByLabelText('Your validation conclusion')).toHaveValue('inconclusive');
        expect(handlers.onRecordOutcome).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('Conclusion revisit on (optional)'), { target: { value: '2026-09-01' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record my conclusion' }));
        expect(handlers.onRecordOutcome).toHaveBeenCalledWith('assumption-1', expect.objectContaining({
            conclusion: 'inconclusive', sourceInterpretationId: 'interpretation-1',
            revisitAt: new Date('2026-09-01T12:00:00').getTime(),
        }));
    });

    it('records proceeding under uncertainty separately and exposes a mobile-sized impact action', () => {
        const handlers = callbacks();
        render(<AssumptionValidationPanel recordId="assumption-1" validation={baseValidation({ userTreatment: 'accepted_without_validation', treatmentRationale: 'Test demand during a limited beta.' })} requiresValidation hasPlanImpact={false} {...handlers} />);

        expect(screen.getAllByText('Accepted without validation')[0]).toBeInTheDocument();
        expect(screen.queryByText('Supported')).not.toBeInTheDocument();
        const impact = screen.getByRole('button', { name: 'Review plan impact' });
        expect(impact).toHaveClass('min-h-11', 'w-full', 'sm:w-auto');
        fireEvent.click(impact);
        expect(handlers.onPreviewImpact).toHaveBeenCalledWith('assumption-1');

        fireEvent.click(screen.getByText('Proceed without validation'));
        fireEvent.change(screen.getByLabelText('Why proceed?'), { target: { value: 'Run a limited beta first.' } });
        fireEvent.change(screen.getByLabelText('Uncertainty revisit on (optional)'), { target: { value: '2026-10-01' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record unresolved uncertainty' }));
        expect(handlers.onRecordTreatment).toHaveBeenCalledWith('assumption-1', expect.objectContaining({
            revisitAt: new Date('2026-10-01T12:00:00').getTime(),
        }));
    });

    it('records an explicit validation expiration date on a user-authored plan', () => {
        const handlers = callbacks();
        render(<AssumptionValidationPanel recordId="assumption-1" validation={baseValidation()} requiresValidation hasPlanImpact={false} {...handlers} />);

        fireEvent.change(screen.getByLabelText('Validation question'), { target: { value: plan.question } });
        fireEvent.change(screen.getByLabelText('Validation expires on (optional)'), { target: { value: '2026-08-15' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record my validation plan' }));
        expect(handlers.onRecordPlan).toHaveBeenCalledWith('assumption-1', expect.objectContaining({
            expiresAt: new Date('2026-08-15T12:00:00').getTime(),
        }));
    });

    it('shows consequence and exact dependencies before the validation workflow', () => {
        render(<AssumptionValidationPanel recordId="assumption-1" validation={baseValidation()} requiresValidation hasPlanImpact={false} consequence="The onboarding and pricing model would need to change." {...callbacks()} />);

        const impact = screen.getByRole('region', { name: 'Potential plan impact' });
        expect(impact).not.toHaveAttribute('open');
        expect(impact).toHaveTextContent('The onboarding and pricing model would need to change.');
        expect(impact).toHaveTextContent('Pricing · First-release scope');
        const planStep = screen.getByText('1. Plan the smallest credible test');
        expect(impact.compareDocumentPosition(planStep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('keeps user authority explicit while validation details remain progressively disclosed', () => {
        const advisoryInterpretation = {
            id: 'interpretation-advisory', planningRecordId: 'assumption-1', contractVersion: 1 as const,
            authoredBy: 'synapse' as const, recommendedConclusion: 'inconclusive' as const,
            reasoning: 'The available evidence does not settle the question.', supportingEvidenceIds: [],
            contradictingEvidenceIds: [], inconclusiveEvidenceIds: ['evidence-1'], irrelevantEvidenceIds: [],
            duplicateEvidenceIds: [], limitations: ['Small sample'], assumptionStatementHash: 'statement-hash',
            validationPlanHash: plan.contentHash, evidenceSetHash: 'evidence-set', createdAt: 30,
            contentHash: 'interpretation-content',
        };
        render(<AssumptionValidationPanel recordId="assumption-1" validation={baseValidation({
            currentPlan: plan,
            activeEvidence: [evidence()],
            latestInterpretation: advisoryInterpretation,
            userTreatment: 'temporarily_tolerated',
            treatmentRationale: 'Proceed only for the pilot.',
            history: [{ id: 'history-1', label: 'Treatment recorded', at: 31 }],
        })} requiresValidation hasPlanImpact {...callbacks()} />);

        expect(screen.getByText(/cannot become the project outcome until you explicitly record your conclusion/i)).toBeInTheDocument();
        expect(screen.getByText('How unresolved uncertainty is being treated').closest('details')).not.toHaveAttribute('open');
        expect(screen.getByRole('region', { name: 'Potential plan impact' })).not.toHaveAttribute('open');
        expect(screen.getByText('Validation history (1)').closest('details')).not.toHaveAttribute('open');
        expect(screen.getByText(/review the affected plan areas next/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Refresh plan impact' })).not.toBeInTheDocument();
    });

    it('does not repeat an existing consequence prefix', () => {
        render(<AssumptionValidationPanel recordId="assumption-1" validation={baseValidation()} requiresValidation hasPlanImpact={false} consequence="If this is wrong, onboarding and pricing must change." {...callbacks()} />);

        const impact = screen.getByRole('region', { name: 'Potential plan impact' });
        expect(impact).toHaveTextContent('If this is wrong: onboarding and pricing must change.');
        expect(impact).not.toHaveTextContent('If this is wrong: If this is wrong,');
    });

    it('requires a reason before reopening a current conclusion', () => {
        const handlers = callbacks();
        render(<AssumptionValidationPanel recordId="assumption-1" validation={baseValidation({
            currentPlan: plan,
            workflowState: 'completed',
            activeEvidence: [evidence()],
            acceptedConclusion: 'supported',
            conclusionIsCurrent: true,
            hasHistoricalValidation: true,
        })} requiresValidation={false} hasPlanImpact={false} {...handlers} />);

        fireEvent.click(screen.getByText('Reopen this conclusion'));
        const reopen = screen.getByRole('button', { name: 'Reopen conclusion' });
        expect(reopen).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Why reopen this conclusion?'), { target: { value: 'A new technical test contradicts the earlier result.' } });
        fireEvent.click(reopen);

        expect(handlers.onReopenOutcome).toHaveBeenCalledWith('assumption-1', 'A new technical test contradicts the earlier result.');
    });

    it('frames formal validation as optional for a low-impact assumption', () => {
        render(<AssumptionValidationPanel recordId="assumption-1" validation={baseValidation()} requiresValidation={false} hasPlanImpact={false} {...callbacks()} />);

        expect(screen.getByText('Optional assumption validation')).toBeInTheDocument();
        expect(screen.getByText(/not consequential enough to require a formal test/i)).toBeInTheDocument();
    });
});
