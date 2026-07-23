import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BatchVerdictCandidate } from '../../lib/planning';
import { DecisionCenter, type DecisionCenterRecordView } from '../review/DecisionCenter';

const openRecord: DecisionCenterRecordView = {
    id: 'd1', type: 'assumption', title: 'Should guests start without an account?',
    statement: 'Guests can begin without an account',
    whyItMatters: 'This affects onboarding and persistence.', status: 'open',
    options: [
        { id: 'guest', label: 'Allow a limited guest session', tradeoffs: [{ kind: 'benefit', summary: 'Lower activation friction' }] },
        { id: 'account', label: 'Require an account first', tradeoffs: [{ kind: 'cost', summary: 'Higher onboarding friction' }] },
    ],
    recommendation: { optionId: 'guest', summary: 'Allow a limited guest session', rationale: 'It preserves a low-friction first experience.' },
    sourceLabels: ['PRD assumption'], createdAt: 1,
    history: [{ id: 'import', label: 'imported', at: 1 }],
};

const callbacks = () => ({
    onDecide: vi.fn(),
    onPreviewImpact: vi.fn(),
    onApplyToPlan: vi.fn(),
    onReviewAlignmentProposal: vi.fn(),
    onRequestAlignmentProposal: vi.fn(),
});

const eligibleRecommendation = (id: string): DecisionCenterRecordView => {
    const batchRecommendation: BatchVerdictCandidate = {
        recordId: id,
        action: 'accept_recommendation',
        expectedStatus: 'open',
        expectedTargetHash: `target-${id}`,
        expectedRecommendationIdentity: `recommendation-${id}`,
        optionId: 'guest',
        answer: 'Allow a limited guest session',
    };
    return {
        ...openRecord,
        id,
        type: 'decision',
        title: `${id} decision`,
        batchRecommendation,
    };
};

describe('DecisionCenter', () => {
    it('leads with one condition and next action before recommendation and alternatives', () => {
        render(<DecisionCenter records={[openRecord]} {...callbacks()} />);

        expect(screen.getAllByText('Worth validating').length).toBeGreaterThan(0);
        const nextAction = screen.getByRole('region', { name: 'Next action' });
        const answer = screen.getByLabelText('Your answer');
        const recommendation = screen.getByText('Synapse recommendation');
        const alternatives = screen.getByRole('heading', { name: 'Alternatives and tradeoffs' });
        expect(nextAction).toHaveTextContent(/Decide whether to test this assumption/);
        expect(answer.compareDocumentPosition(recommendation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(recommendation.compareDocumentPosition(alternatives) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByText('Source and history').closest('details')).not.toHaveAttribute('open');
        expect(screen.getByRole('button', { name: 'Back to decisions' })).toHaveClass('min-h-11');
    });

    it('suppresses the generic next-action callout for an assumption with a validation flow', () => {
        const { unmount } = render(<DecisionCenter records={[openRecord]} {...callbacks()} />);
        // No validation flow → the generic "Next action" guidance is shown.
        expect(screen.getByRole('region', { name: 'Next action' })).toBeInTheDocument();
        unmount();

        // With a validation flow, AssumptionValidationPanel carries the guidance,
        // so the duplicate generic callout is suppressed.
        render(<DecisionCenter records={[{
            ...openRecord,
            validation: {
                workflowState: 'not_planned', activeEvidence: [], duplicateEvidenceIds: [],
                evidenceFromAnotherQuestionIds: [], conclusionIsCurrent: false,
                hasHistoricalValidation: false, dependentLabels: [], history: [],
            },
        }]} {...callbacks()} />);
        expect(screen.queryByRole('region', { name: 'Next action' })).toBeNull();
    });

    it('switches to a newly linked exact record while the center remains mounted', () => {
        const resolved = { ...openRecord, id: 'resolved', title: 'Resolved audience', status: 'confirmed' as const, resolution: 'Independent creators' };
        const props = callbacks();
        const { rerender } = render(<DecisionCenter records={[openRecord, resolved]} initialSelectedId="d1" {...props} />);
        expect(screen.getByRole('button', { name: /Should guests start without an account/ })).toHaveAttribute('aria-current', 'true');

        rerender(<DecisionCenter records={[openRecord, resolved]} initialSelectedId="resolved" {...props} />);
        expect(screen.getByRole('button', { name: /Resolved audience/ })).toHaveAttribute('aria-current', 'true');
        expect(screen.getByText('Accepted for planning · not validated')).toBeInTheDocument();
    });

    it('shows a calm queue/detail layout with recommendation distinct from user actions', () => {
        const props = callbacks();
        const { rerender } = render(<DecisionCenter records={[openRecord]} {...props} />);
        expect(screen.getByLabelText('Decision queue')).toBeInTheDocument();
        expect(screen.getByLabelText('Decision detail')).toBeInTheDocument();
        expect(screen.getByText('Synapse recommendation')).toBeInTheDocument();
        expect(screen.getByText('1 needs an answer')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Allow a limited guest session/ }));
        expect(props.onDecide).toHaveBeenCalledWith('d1', 'confirm', 'guest', undefined);
        rerender(<DecisionCenter records={[{ ...openRecord, status: 'confirmed', resolution: 'Allow a limited guest session' }]} {...props} />);
        expect(screen.getByRole('button', { name: 'Preview impact' })).toBeInTheDocument();
    });

    it('requires a correction before rejecting a premise', () => {
        const props = callbacks();
        render(<DecisionCenter records={[openRecord]} {...props} />);
        expect(screen.queryByRole('button', { name: 'Confirm as true' })).toBeNull();
        // The button is never a dead end: it's enabled from the start, and an
        // empty first click focuses the correction area instead of submitting.
        const reject = screen.getByRole('button', { name: /Not quite/ });
        expect(reject).toBeEnabled();
        fireEvent.click(reject);
        expect(props.onDecide).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Guests may browse but must sign in before saving' } });
        fireEvent.click(reject);
        expect(props.onDecide).toHaveBeenCalledWith('d1', 'reject', 'Guests may browse but must sign in before saving', undefined);
    });

    it('shows impact before apply and never applies from a stale preview', () => {
        const props = callbacks();
        const ready: DecisionCenterRecordView = {
            ...openRecord, status: 'confirmed', resolution: 'Allow a limited guest session',
            preview: {
                id: 'preview', status: 'ready', affectedPrdSections: ['Assumptions'],
                affectedArtifactLabels: ['screen inventory', 'implementation plan'],
                beforeSummary: openRecord.statement, afterSummary: 'Confirmed — limited guest session',
                canApply: true,
            },
        };
        const { rerender } = render(<DecisionCenter records={[ready]} {...props} />);
        // The alignment review is a follow-up step: its body stays behind a
        // closed disclosure so recording an answer never dumps proposal cards.
        expect(screen.getByText(/Plan alignment/).closest('details')).not.toHaveAttribute('open');
        fireEvent.click(screen.getByRole('button', { name: 'Apply accepted changes' }));
        expect(props.onApplyToPlan).toHaveBeenCalledWith('d1');

        rerender(<DecisionCenter records={[{ ...ready, preview: { ...ready.preview!, status: 'stale' } }]} {...props} />);
        expect(screen.queryByRole('button', { name: 'Apply accepted changes' })).toBeNull();
        const previewSection = screen.getByText(/Plan alignment/).closest('section')!;
        fireEvent.click(within(previewSection).getByRole('button', { name: /Refresh preview/ }));
        expect(props.onPreviewImpact).toHaveBeenCalledWith('d1');
    });

    it('supports accept, edit, reject, and defer without changing the decision itself', () => {
        const props = callbacks();
        const record: DecisionCenterRecordView = {
            ...openRecord, status: 'confirmed', resolution: 'Independent creators',
            preview: {
                id: 'preview', status: 'ready', affectedPrdSections: ['Target Users'], affectedArtifactLabels: [],
                canApply: false,
                proposals: [{
                    id: 'change-1', targetLabel: 'Primary user', targetKind: 'claim', section: 'Target Users',
                    beforeSummary: 'Enterprise administrators', proposedSummary: 'Independent creators',
                    reason: 'Reflect the selected audience.', confidence: 'definite', disposition: 'pending',
                }],
            },
        };
        render(<DecisionCenter records={[record]} {...props} />);
        const accept = screen.getByRole('button', { name: 'Accept' });
        expect(accept).toHaveClass('min-h-11', 'w-full', 'sm:w-auto');
        fireEvent.click(accept);
        expect(props.onReviewAlignmentProposal).toHaveBeenCalledWith('d1', 'preview', 'change-1', 'accepted');

        const wording = screen.getByLabelText('Edit proposed change for Primary user');
        fireEvent.change(wording, { target: { value: 'Independent working creators' } });
        fireEvent.click(screen.getByRole('button', { name: 'Use my wording' }));
        expect(props.onReviewAlignmentProposal).toHaveBeenCalledWith('d1', 'preview', 'change-1', 'edited', 'Independent working creators');
        fireEvent.click(screen.getByRole('button', { name: 'Keep current' }));
        fireEvent.click(screen.getByRole('button', { name: 'Defer' }));
        expect(props.onDecide).not.toHaveBeenCalled();
    });

    it('collects missing context for a bounded proposal without replacing Phase 1 fallback actions', async () => {
        const props = callbacks();
        const record: DecisionCenterRecordView = {
            ...openRecord, status: 'confirmed', resolution: 'Local-only projects',
            preview: {
                id: 'preview', status: 'ready', affectedPrdSections: ['User Flows'], affectedArtifactLabels: [],
                proposals: [{
                    id: 'flow-review', targetLabel: 'Save project flow', targetKind: 'flow_step', section: 'User Flows',
                    beforeSummary: 'Upload the project and sync it across devices.',
                    reason: 'This flow may still depend on cloud synchronization.', confidence: 'possible',
                    requiresInput: true, canRequestReasoning: true, disposition: 'pending', analysisStatus: 'needs_input',
                    analysisMethod: 'model', analysisAmbiguity: 'The offline save behavior is not specified.',
                    analysisQuestions: ['Should projects remain available on more than one device?'],
                    analysisEvidence: [
                        { label: 'Your decision', excerpt: 'Projects are local-only.' },
                        { label: 'Current flow', excerpt: 'Upload and synchronize the project.' },
                    ],
                }],
            },
        };
        render(<DecisionCenter records={[record]} {...props} />);

        expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
        expect(screen.getByText('Needs context')).toBeInTheDocument();
        expect(screen.getByText(/offline save behavior is not specified/i)).toBeInTheDocument();
        expect(screen.getByText(/Should projects remain available/)).toBeInTheDocument();
        fireEvent.click(screen.getByText(/Reasoning basis/));
        expect(screen.getByText('Your decision')).toBeInTheDocument();

        const openRequest = screen.getByRole('button', { name: 'Provide missing information' });
        expect(openRequest).toHaveClass('w-full', 'min-h-11');
        fireEvent.click(openRequest);
        const guidance = screen.getByLabelText('What missing information should Synapse account for?');
        fireEvent.change(guidance, { target: { value: 'Projects stay on one device and autosave locally.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Try again with context' }));

        expect(props.onRequestAlignmentProposal).toHaveBeenCalledWith('d1', 'preview', 'flow-review', {
            kind: 'missing_info', guidance: 'Projects stay on one device and autosave locally.',
        });
        expect(screen.getByRole('button', { name: 'Not affected' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Defer review' })).toBeInTheDocument();
    });

    it('can request an initial bounded interpretation without manufacturing extra user context', () => {
        const props = callbacks();
        const record: DecisionCenterRecordView = {
            ...openRecord, status: 'confirmed', resolution: 'Local-only projects',
            preview: {
                id: 'preview', status: 'ready', affectedPrdSections: ['User Flows'], affectedArtifactLabels: [],
                proposals: [{
                    id: 'flow-review', targetLabel: 'Save flow', targetKind: 'flow_step', section: 'User Flows',
                    reason: 'This flow may depend on synchronization.', confidence: 'possible', requiresInput: true,
                    canRequestReasoning: true, disposition: 'pending', analysisStatus: 'needs_input', analysisMethod: 'deterministic',
                }],
            },
        };
        render(<DecisionCenter records={[record]} {...props} />);

        fireEvent.click(screen.getByRole('button', { name: 'Ask Synapse to propose wording' }));
        expect(screen.getByLabelText('Add context for this proposal (optional)')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Prepare proposed change' }));
        expect(props.onRequestAlignmentProposal).toHaveBeenCalledWith('d1', 'preview', 'flow-review', {
            kind: 'missing_info', guidance: '',
        });
    });

    it('shows a bounded proposal and requests a different interpretation without encoding acceptance', () => {
        const props = callbacks();
        const record: DecisionCenterRecordView = {
            ...openRecord, status: 'confirmed', resolution: 'Independent creators',
            preview: {
                id: 'preview', status: 'ready', affectedPrdSections: ['User Flows'], affectedArtifactLabels: [],
                proposals: [{
                    id: 'flow-change', targetLabel: 'Invitation flow', targetKind: 'flow_step', section: 'User Flows',
                    beforeSummary: 'An administrator invites a team member.',
                    proposedSummary: 'A creator starts a personal project without an invitation.',
                    reason: 'The current flow assumes an enterprise administrator.', confidence: 'likely',
                    canRequestReasoning: true, disposition: 'pending', analysisStatus: 'bounded_applicable', analysisMethod: 'model',
                    analysisModel: 'reasoning-model', analysisProvider: 'provider',
                    analysisEvidence: [{ label: 'Primary-user decision', excerpt: 'Independent creators' }],
                }],
            },
        };
        render(<DecisionCenter records={[record]} {...props} />);

        expect(screen.getByText('Current: An administrator invites a team member.')).toBeInTheDocument();
        expect(screen.getByText('Proposed: A creator starts a personal project without an invitation.')).toBeInTheDocument();
        expect(screen.getByText('Ready to review')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
        const basis = screen.getByText(/Reasoning basis/).closest('details')!;
        expect(basis).not.toHaveAttribute('open');
        expect(within(basis).getByText(/reasoning-model/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Ask for a different reading' }));
        fireEvent.change(screen.getByLabelText('What should Synapse interpret differently?'), {
            target: { value: 'Keep optional invitations, but remove administrator ownership.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Prepare another interpretation' }));
        expect(props.onRequestAlignmentProposal).toHaveBeenCalledWith('d1', 'preview', 'flow-change', {
            kind: 'different_interpretation', guidance: 'Keep optional invitations, but remove administrator ownership.',
        });
        expect(props.onReviewAlignmentProposal).not.toHaveBeenCalled();
    });

    it('preserves aligned and not-applicable reasoning for user confirmation or reinterpretation', () => {
        const props = callbacks();
        const record: DecisionCenterRecordView = {
            ...openRecord, status: 'confirmed', resolution: 'Independent creators',
            preview: {
                id: 'preview', status: 'ready', affectedPrdSections: ['Architecture', 'Constraints'], affectedArtifactLabels: [],
                proposals: [
                    {
                        id: 'architecture-aligned', targetLabel: 'Architecture approach', targetKind: 'claim', section: 'Architecture',
                        beforeSummary: 'Local-first application', reason: 'The current architecture already supports the decision.',
                        confidence: 'likely', reasoningConfidence: 'high', evidenceCharacter: 'supported_inference',
                        analysisStatus: 'already_aligned', analysisMethod: 'model', canRequestReasoning: false, disposition: 'pending',
                    },
                    {
                        id: 'constraint-unaffected', targetLabel: 'Export retention', targetKind: 'constraint', section: 'Constraints',
                        reason: 'The decision does not govern export retention.', confidence: 'possible', reasoningConfidence: 'medium',
                        evidenceCharacter: 'direct', analysisStatus: 'not_applicable', analysisMethod: 'model',
                        canRequestReasoning: true, disposition: 'pending',
                    },
                ],
            },
        };
        render(<DecisionCenter records={[record]} {...props} />);

        expect(screen.getByText('Appears already aligned')).toBeInTheDocument();
        expect(screen.getByText('Appears not affected')).toBeInTheDocument();
        expect(screen.getByText(/high reasoning confidence/i)).toBeInTheDocument();
        expect(screen.getByText(/Supported inference/)).toBeInTheDocument();
        const confirmAligned = screen.getByRole('button', { name: 'Confirm already aligned' });
        expect(confirmAligned).toHaveClass('min-h-11', 'w-full', 'sm:w-auto');
        fireEvent.click(confirmAligned);
        expect(props.onReviewAlignmentProposal).toHaveBeenCalledWith('d1', 'preview', 'architecture-aligned', 'confirmed_aligned');
        fireEvent.click(screen.getByRole('button', { name: 'Confirm not affected' }));
        expect(props.onReviewAlignmentProposal).toHaveBeenCalledWith('d1', 'preview', 'constraint-unaffected', 'confirmed_not_applicable');

        expect(screen.getAllByRole('button', { name: 'Ask for a different reading' })).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Ask for a different reading' }));
        fireEvent.change(screen.getByLabelText('What should Synapse interpret differently?'), {
            target: { value: 'Reconsider whether exports depend on project ownership.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Prepare another interpretation' }));
        expect(props.onRequestAlignmentProposal).toHaveBeenCalledWith('d1', 'preview', 'constraint-unaffected', {
            kind: 'different_interpretation', guidance: 'Reconsider whether exports depend on project ownership.',
        });
    });

    it('makes keeping a verdict-defining source claim visibly unaligned', () => {
        const record: DecisionCenterRecordView = {
            ...openRecord, status: 'confirmed', resolution: 'Independent creators',
            preview: {
                id: 'preview', status: 'ready', affectedPrdSections: ['Target Users'], affectedArtifactLabels: [],
                proposals: [{
                    id: 'source-change', targetLabel: 'Primary user', targetKind: 'claim', section: 'Target Users',
                    beforeSummary: 'Enterprise administrators', proposedSummary: 'Independent creators',
                    reason: 'This exact claim records the selected audience.', confidence: 'definite',
                    requiredForVerdictAlignment: true, disposition: 'rejected',
                }],
            },
        };
        render(<DecisionCenter records={[record]} {...callbacks()} />);

        expect(screen.getByText(/preserves a contradiction with your selected answer/i)).toBeInTheDocument();
        expect(screen.getByText('Keeping current')).toBeInTheDocument();
    });

    it('renders an explicit completed state and decision log', () => {
        render(<DecisionCenter records={[{ ...openRecord, status: 'confirmed', resolution: 'Confirmed' }]} {...callbacks()} />);
        expect(screen.getByText('Nothing needs an answer right now')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: 'Resolved & history' }));
        expect(screen.getByRole('button', { name: /Should guests start/ })).toBeInTheDocument();
    });

    it('marks a deferred record with a chip in Resolved & history', () => {
        render(<DecisionCenter records={[{ ...openRecord, status: 'deferred' }]} {...callbacks()} />);
        fireEvent.click(screen.getByRole('tab', { name: 'Resolved & history' }));
        const row = screen.getByRole('button', { name: /Should guests start/ });
        expect(within(row).getByText('Deferred')).toBeInTheDocument();
    });

    it('moves an answered material assumption to Resolved & history labeled as answered, not pending', () => {
        render(<DecisionCenter records={[{
            ...openRecord,
            status: 'confirmed',
            resolution: openRecord.statement,
            materiality: 'high',
            requiresValidation: true,
            validation: {
                workflowState: 'not_planned', activeEvidence: [], duplicateEvidenceIds: [],
                evidenceFromAnotherQuestionIds: [], conclusionIsCurrent: false,
                hasHistoricalValidation: false, dependentLabels: ['Onboarding'], history: [],
            },
        }]} {...callbacks()} />);

        // Answering is terminal for the queue: the count chip disappears, the
        // record lives under Resolved & history, and its label says answered.
        expect(screen.queryByText(/needs? an answer$/)).toBeNull();
        expect(screen.getByText('Nothing needs an answer right now')).toBeInTheDocument();
        expect(screen.getAllByText('Answered · not validated').length).toBeGreaterThan(0);
        expect(screen.queryByText('Worth validating')).toBeNull();
        expect(screen.getByText('Accepted for planning · not validated')).toBeInTheDocument();
        // The evidence workflow stays available, but behind a closed disclosure.
        const validationDisclosure = screen.getByText(/Validate with evidence/).closest('details')!;
        expect(validationDisclosure).not.toHaveAttribute('open');
        expect(screen.getByText('Replace belief with evidence')).toBeInTheDocument();
    });

    it('leads an open assumption with the answer form, validation collapsed below it', () => {
        render(<DecisionCenter records={[{
            ...openRecord,
            options: undefined,
            materiality: 'high',
            requiresValidation: true,
            validation: {
                workflowState: 'not_planned', activeEvidence: [], duplicateEvidenceIds: [],
                evidenceFromAnotherQuestionIds: [], conclusionIsCurrent: false,
                hasHistoricalValidation: false, dependentLabels: ['Onboarding'], history: [],
            },
        }]} {...callbacks()} />);

        const confirm = screen.getByRole('button', { name: "Yes, that's right" });
        const disclosure = screen.getByText(/Validate with evidence · recommended before you build/).closest('details')!;
        expect(confirm.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(disclosure).not.toHaveAttribute('open');
    });

    it('opens the validation disclosure when a validation is already underway', () => {
        render(<DecisionCenter records={[{
            ...openRecord,
            status: 'confirmed',
            resolution: openRecord.statement,
            requiresValidation: true,
            validation: {
                workflowState: 'in_progress', activeEvidence: [], duplicateEvidenceIds: [],
                evidenceFromAnotherQuestionIds: [], conclusionIsCurrent: false,
                hasHistoricalValidation: false, dependentLabels: [], history: [],
                currentPlan: {
                    id: 'plan-1', question: 'Do parents want parity?', contentHash: 'hash',
                    method: { kind: 'user_interviews', label: 'User interviews' },
                    supportSignals: [], contradictionSignals: [], inconclusiveConditions: [], limitations: [],
                    authoredBy: 'user', createdAt: 1,
                },
            },
        }]} {...callbacks()} />);

        const disclosure = screen.getByText(/Validate with evidence/).closest('details')!;
        expect(disclosure).toHaveAttribute('open');
        expect(screen.getByText('Gathering evidence')).toBeInTheDocument();
    });

    it('keeps a generated-but-unrecorded validation-plan proposal visible', () => {
        // Proposals do not advance workflowState — the disclosure must still
        // open so the "use suggestion as a draft" affordance stays reachable.
        render(<DecisionCenter records={[{
            ...openRecord,
            options: undefined,
            requiresValidation: true,
            validation: {
                workflowState: 'not_planned', activeEvidence: [], duplicateEvidenceIds: [],
                evidenceFromAnotherQuestionIds: [], conclusionIsCurrent: false,
                hasHistoricalValidation: false, dependentLabels: [], history: [],
                latestPlanProposal: {
                    id: 'proposal-1', planningRecordId: 'd1', contractVersion: 1, authoredBy: 'synapse',
                    question: 'Do guests convert without an account?', method: { kind: 'analytics_measurement', label: 'Analytics measurement' },
                    supportSignals: [], contradictionSignals: [], inconclusiveConditions: [], limitations: [],
                    assumptionStatementHash: 'hash-a', evidenceSetHash: 'hash-e', createdAt: 1, contentHash: 'hash-c',
                },
            },
        }]} {...callbacks()} />);

        expect(screen.getByText(/Validate with evidence/).closest('details')).toHaveAttribute('open');
    });

    it('does not imply that a low-impact open assumption requires formal validation', () => {
        render(<DecisionCenter records={[{
            ...openRecord,
            options: undefined,
            materiality: 'low',
            requiresValidation: false,
            validation: {
                workflowState: 'not_planned', activeEvidence: [], duplicateEvidenceIds: [],
                evidenceFromAnotherQuestionIds: [], conclusionIsCurrent: false,
                hasHistoricalValidation: false, dependentLabels: [], history: [],
            },
        }]} {...callbacks()} />);

        expect(screen.getByText('Optional assumption validation')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: "Yes, that's right" })).toBeInTheDocument();
    });

    it('opens a linked resolved decision directly even when unresolved work also exists', () => {
        const resolved = { ...openRecord, id: 'resolved', status: 'confirmed' as const, resolution: 'Independent creators' };
        render(<DecisionCenter records={[openRecord, resolved]} initialSelectedId="resolved" {...callbacks()} />);

        expect(screen.getByText('Accepted for planning · not validated')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Should guests start without an account/ })).toHaveAttribute('aria-current', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Back to decisions' }));
        expect(screen.getByLabelText('Decision detail')).toHaveClass('hidden');
        expect(screen.getByLabelText('Decision queue')).toHaveClass('flex');
    });

    describe('suggested alternatives for open decisions', () => {
        const decisionRecord: DecisionCenterRecordView = {
            id: 'dec-1', type: 'decision', title: 'How should mixed-success days render?',
            statement: 'The contribution graph needs a rule for days with mixed project outcomes.',
            whyItMatters: 'It defines what the graph communicates at a glance.', status: 'proposed',
            options: [
                { id: 'opt-split', label: 'Split-color cells', description: 'Each day cell shows proportional success and failure.', tradeoffs: [{ kind: 'risk', summary: 'Harder to read at small sizes' }] },
                { id: 'opt-dominant', label: 'Dominant outcome wins', description: 'The day takes the color of the majority outcome.', tradeoffs: [{ kind: 'cost', summary: 'Hides minority outcomes' }] },
            ],
            recommendation: { optionId: 'opt-dominant', summary: 'Dominant outcome wins', rationale: 'It keeps the graph legible.' },
            sourceLabels: ['specialist review'], createdAt: 1, history: [],
        };

        it('preselects the recommendation for a one-click explicit approval', () => {
            const props = callbacks();
            render(<DecisionCenter records={[decisionRecord]} {...props} />);

            const group = screen.getByRole('radiogroup', { name: 'Your answer' });
            const radios = within(group).getAllByRole('radio');
            expect(radios[0]).toHaveTextContent('Dominant outcome wins');
            expect(radios[0]).toHaveTextContent('Recommended');
            expect(radios[0]).toHaveTextContent('It keeps the graph legible.');
            // The recommendation is the default choice — approving it is one
            // explicit click, and nothing is recorded until that click.
            expect(radios[0]).toHaveAttribute('aria-checked', 'true');
            expect(radios.at(-1)).toHaveTextContent('Other');
            expect(props.onDecide).not.toHaveBeenCalled();

            const approve = screen.getByRole('button', { name: /Approve recommendation/ });
            expect(approve).toBeEnabled();
            fireEvent.click(approve);
            expect(props.onDecide).toHaveBeenCalledWith('dec-1', 'confirm', 'opt-dominant', undefined);
        });

        it('saves a different option as an ordinary decision instead of an approval', () => {
            const props = callbacks();
            render(<DecisionCenter records={[decisionRecord]} {...props} />);

            const group = screen.getByRole('radiogroup', { name: 'Your answer' });
            fireEvent.click(within(group).getByRole('radio', { name: /Split-color cells/ }));
            expect(props.onDecide).not.toHaveBeenCalled();
            const save = screen.getByRole('button', { name: 'Save decision' });
            expect(screen.queryByRole('button', { name: /Approve recommendation/ })).toBeNull();
            expect(save).toBeEnabled();
            fireEvent.click(save);
            expect(props.onDecide).toHaveBeenCalledWith('dec-1', 'confirm', 'opt-split', undefined);
        });

        it('supports an "Other" custom answer alongside the suggestions', () => {
            const props = callbacks();
            render(<DecisionCenter records={[decisionRecord]} {...props} />);

            expect(screen.queryByLabelText('Your answer', { selector: 'textarea' })).toBeNull();
            fireEvent.click(screen.getByRole('radio', { name: /Other/ }));
            const save = screen.getByRole('button', { name: 'Save decision' });
            expect(save).toBeDisabled();
            fireEvent.change(screen.getByPlaceholderText('Describe the approach that should govern the plan'), {
                target: { value: 'Render a small stacked bar inside the day cell.' },
            });
            fireEvent.click(save);
            expect(props.onDecide).toHaveBeenCalledWith('dec-1', 'custom', 'Render a small stacked bar inside the day cell.', undefined);
        });

        it('requests suggestions automatically for an open decision without options', () => {
            const onPrepareOptions = vi.fn();
            render(<DecisionCenter
                records={[{ ...decisionRecord, options: undefined, recommendation: undefined }]}
                {...callbacks()}
                onPrepareOptions={onPrepareOptions}
            />);
            expect(onPrepareOptions).toHaveBeenCalledWith('dec-1');
            expect(onPrepareOptions).toHaveBeenCalledTimes(1);
        });

        it('keeps the direct answer available while suggestions generate, and retries after failure', () => {
            const onPrepareOptions = vi.fn();
            const props = callbacks();
            const { rerender } = render(<DecisionCenter
                records={[{ ...decisionRecord, options: undefined, recommendation: undefined, optionsSuggestion: { busy: true } }]}
                {...props}
                onPrepareOptions={onPrepareOptions}
            />);
            expect(onPrepareOptions).not.toHaveBeenCalled();
            expect(screen.getByText(/preparing 2-3 suggested approaches/i)).toBeInTheDocument();
            expect(screen.getByLabelText('Your answer', { selector: 'textarea' })).toBeInTheDocument();

            rerender(<DecisionCenter
                records={[{ ...decisionRecord, options: undefined, recommendation: undefined, optionsSuggestion: { busy: false, error: 'The model is unavailable.' } }]}
                {...props}
                onPrepareOptions={onPrepareOptions}
            />);
            expect(screen.getByText(/Suggested approaches are unavailable/)).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
            expect(onPrepareOptions).toHaveBeenCalledWith('dec-1');
        });

        it('offers the next unresolved item right after an answer is recorded', () => {
            const other: DecisionCenterRecordView = {
                ...decisionRecord, id: 'dec-2', options: undefined, recommendation: undefined,
                title: 'Should streaks reset on failure?', status: 'open',
            };
            const props = callbacks();
            const { rerender } = render(<DecisionCenter records={[decisionRecord, other]} {...props} />);
            fireEvent.click(screen.getByRole('button', { name: /Approve recommendation/ }));

            rerender(<DecisionCenter
                records={[{ ...decisionRecord, status: 'confirmed', resolution: 'Dominant outcome wins' }, other]}
                {...props}
            />);
            const status = screen.getByRole('status', { name: 'Answer recorded' });
            expect(status).toHaveTextContent('1 item still needs an answer');
            fireEvent.click(within(status).getByRole('button', { name: /Next: Should streaks reset on failure\?/ }));
            expect(screen.getByRole('heading', { name: 'Should streaks reset on failure?' })).toBeInTheDocument();
        });

        it('reveals the explanation field before a premise can be rejected', () => {
            const props = callbacks();
            render(<DecisionCenter records={[decisionRecord]} {...props} />);
            const reject = screen.getByRole('button', { name: /Not quite/ });
            expect(reject).toBeEnabled();
            fireEvent.click(reject);
            expect(props.onDecide).not.toHaveBeenCalled();
            const textarea = screen.getByPlaceholderText('Describe the approach that should govern the plan');
            fireEvent.change(textarea, { target: { value: 'The graph should not encode success at all.' } });
            fireEvent.click(reject);
            expect(props.onDecide).toHaveBeenCalledWith('dec-1', 'reject', 'The graph should not encode success at all.', undefined);
        });
    });

    it('offers a way through to Explore and explains what each attention group needs', () => {
        const decisionRecord: DecisionCenterRecordView = {
            ...openRecord, id: 'dec-1', type: 'decision', title: 'How should mixed days render?', status: 'open',
        };
        const onContinueToExplore = vi.fn();
        render(<DecisionCenter records={[openRecord, decisionRecord]} {...callbacks()} onContinueToExplore={onContinueToExplore} />);

        expect(screen.getByText(/Open items never block your design assets/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Continue to Explore' }));
        expect(onContinueToExplore).toHaveBeenCalledTimes(1);

        // Each queue group says what to do with its items in plain language.
        expect(screen.getByText('Synapse recommends an answer for each — approve it or choose your own.')).toBeInTheDocument();
        expect(screen.getByText(/Confirm or correct what Synapse assumed/)).toBeInTheDocument();
    });

    it('keeps the Explore link out of the header when no navigation is provided', () => {
        render(<DecisionCenter records={[openRecord]} {...callbacks()} />);
        expect(screen.queryByRole('button', { name: 'Continue to Explore' })).toBeNull();
    });

    it('shows Accept N only for two valid visible candidates', () => {
        const onAccept = vi.fn();
        const { rerender } = render(
            <DecisionCenter
                records={[eligibleRecommendation('one')]}
                {...callbacks()}
                onAcceptRecommendations={onAccept}
            />,
        );
        expect(screen.queryByRole('button', {
            name: 'Accept 1 recommendation',
        })).toBeNull();

        const records = [
            eligibleRecommendation('one'),
            eligibleRecommendation('two'),
        ];
        rerender(
            <DecisionCenter
                records={records}
                {...callbacks()}
                onAcceptRecommendations={onAccept}
            />,
        );
        const button = screen.getByRole('button', {
            name: 'Accept 2 recommendations',
        });
        expect(button).toHaveClass('min-h-11');
        fireEvent.click(button);
        expect(onAccept).toHaveBeenCalledWith([
            records[0].batchRecommendation,
            records[1].batchRecommendation,
        ]);
    });

    it('disables busy, announces partial results, links skipped records, and hides read-only mutation', () => {
        const records = [
            eligibleRecommendation('one'),
            eligibleRecommendation('two'),
        ];
        const onAccept = vi.fn();
        const { rerender } = render(
            <DecisionCenter
                records={records}
                {...callbacks()}
                onAcceptRecommendations={onAccept}
                recommendationBatchBusy
            />,
        );
        expect(screen.getByRole('button', {
            name: 'Accepting 2 recommendations',
        })).toBeDisabled();

        rerender(
            <DecisionCenter
                records={records}
                {...callbacks()}
                onAcceptRecommendations={onAccept}
                recommendationBatchResult={{
                    succeeded: ['one'],
                    skipped: [{ recordId: 'two', reason: 'The recommendation changed.' }],
                    failed: [],
                }}
            />,
        );
        const status = screen.getByRole('status', {
            name: 'Batch decision result',
        });
        expect(status).toHaveAttribute('aria-live', 'polite');
        expect(status).toHaveTextContent('1 accepted · 1 skipped · 0 failed');
        const skipped = within(status).getByRole('button', {
            name: 'Review skipped decision two decision: The recommendation changed.',
        });
        fireEvent.click(skipped);
        expect(screen.getByRole('heading', { name: 'two decision' })).toBeInTheDocument();

        rerender(
            <DecisionCenter
                records={records}
                {...callbacks()}
                onAcceptRecommendations={onAccept}
                readOnly
            />,
        );
        expect(screen.queryByRole('button', {
            name: 'Accept 2 recommendations',
        })).toBeNull();
    });

    it('nests related records within their existing condition and keeps each sub-item actionable', () => {
        const group = {
            key: 'prd-section:target%20users',
            kind: 'prd_section' as const,
            label: 'Target Users',
        };
        const first: DecisionCenterRecordView = {
            ...openRecord,
            id: 'audience-one',
            title: 'Who owns the workspace?',
            options: undefined,
            recommendation: undefined,
            presentationGroup: group,
        };
        const second: DecisionCenterRecordView = {
            ...openRecord,
            id: 'audience-two',
            title: 'Who can invite collaborators?',
            options: undefined,
            recommendation: undefined,
            presentationGroup: group,
        };
        const props = callbacks();
        render(
            <DecisionCenter
                records={[first, second]}
                initialSelectedId="audience-two"
                {...props}
            />,
        );

        const related = screen.getByRole('region', {
            name: 'Target Users related planning items',
        });
        expect(related).toHaveTextContent('2 related sub-items');
        expect(within(related).getByText('PRD section')).toBeInTheDocument();
        expect(within(related).getAllByRole('button')).toHaveLength(2);
        expect(related.querySelector('button button')).toBeNull();
        expect(within(related).getByRole('button', {
            name: /Who can invite collaborators/,
        })).toHaveAttribute('aria-current', 'true');
        expect(screen.getByRole('heading', {
            name: 'Who can invite collaborators?',
        })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Yes, that's right/ }));
        expect(props.onDecide).toHaveBeenCalledWith(
            'audience-two',
            'confirm',
            openRecord.statement,
            undefined,
        );
    });

    it('renders a relationship as ordinary rows when only one member is visible in a queue section', () => {
        const presentationGroup = {
            key: 'critique:issue-1',
            kind: 'critique_cluster' as const,
            label: 'Account boundary',
        };
        const resolved: DecisionCenterRecordView = {
            ...openRecord,
            id: 'resolved-related',
            title: 'Resolved account boundary',
            status: 'confirmed',
            resolution: 'Require an account',
            presentationGroup,
        };
        render(
            <DecisionCenter
                records={[{ ...openRecord, presentationGroup }, resolved]}
                {...callbacks()}
            />,
        );

        expect(screen.queryByRole('region', {
            name: 'Account boundary related planning items',
        })).toBeNull();
        expect(screen.getByRole('button', {
            name: /Should guests start without an account/,
        })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', { name: 'Resolved & history' }));
        expect(screen.queryByRole('region', {
            name: 'Account boundary related planning items',
        })).toBeNull();
        expect(screen.getByRole('button', {
            name: /Resolved account boundary/,
        })).toBeInTheDocument();
    });

    it('lets a user explicitly revise or invalidate a recorded decision', () => {
        const props = callbacks();
        render(<DecisionCenter records={[{ ...openRecord, status: 'confirmed', resolution: 'Confirmed' }]} {...props} />);
        fireEvent.click(screen.getByText('Change this record'));
        const revision = screen.getByLabelText('Revise or invalidate');
        fireEvent.change(revision, { target: { value: 'Require sign-in before the first save' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
        expect(props.onDecide).toHaveBeenCalledWith('d1', 'revise', 'Require sign-in before the first save', undefined);
        fireEvent.change(revision, { target: { value: 'The onboarding flow was removed' } });
        fireEvent.click(screen.getByRole('button', { name: 'Mark no longer valid' }));
        expect(props.onDecide).toHaveBeenCalledWith('d1', 'invalidate', 'The onboarding flow was removed', undefined);
    });
});
