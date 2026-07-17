import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

describe('DecisionCenter', () => {
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
        expect(screen.getByText('1 needs attention')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Allow a limited guest session/ }));
        expect(props.onDecide).toHaveBeenCalledWith('d1', 'confirm', 'guest', undefined);
        rerender(<DecisionCenter records={[{ ...openRecord, status: 'confirmed', resolution: 'Allow a limited guest session' }]} {...props} />);
        expect(screen.getByRole('button', { name: 'Preview impact' })).toBeInTheDocument();
    });

    it('requires a correction before rejecting a premise', () => {
        const props = callbacks();
        render(<DecisionCenter records={[openRecord]} {...props} />);
        expect(screen.queryByRole('button', { name: 'Confirm as true' })).toBeNull();
        const reject = screen.getByRole('button', { name: /Reject premise/ });
        expect(reject).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Guests may browse but must sign in before saving' } });
        expect(reject).toBeEnabled();
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
        fireEvent.click(screen.getByRole('button', { name: 'Prepare bounded proposal' }));
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

        fireEvent.click(screen.getByRole('button', { name: 'Request different interpretation' }));
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

        expect(screen.getAllByRole('button', { name: 'Request different interpretation' })).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Request different interpretation' }));
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
        expect(screen.getByText('Nothing needs attention right now')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Resolved & history' }));
        expect(screen.getByRole('button', { name: /Should guests start/ })).toBeInTheDocument();
    });

    it('keeps a material accepted-but-unvalidated assumption in the attention queue', () => {
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

        expect(screen.getByText('1 needs attention')).toBeInTheDocument();
        expect(screen.queryByText('All current planning items reviewed')).toBeNull();
        expect(screen.getByText('Accepted for planning · not validated')).toBeInTheDocument();
        expect(screen.getAllByText('Worth validating').length).toBeGreaterThan(0);
        expect(screen.getByText('Replace belief with evidence')).toBeInTheDocument();
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
        expect(screen.getByRole('button', { name: 'Accept for planning · not validated' })).toBeInTheDocument();
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

    it('lets a user explicitly revise or invalidate a recorded decision', () => {
        const props = callbacks();
        render(<DecisionCenter records={[{ ...openRecord, status: 'confirmed', resolution: 'Confirmed' }]} {...props} />);
        const revision = screen.getByLabelText('Revise or invalidate');
        fireEvent.change(revision, { target: { value: 'Require sign-in before the first save' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
        expect(props.onDecide).toHaveBeenCalledWith('d1', 'revise', 'Require sign-in before the first save', undefined);
        fireEvent.change(revision, { target: { value: 'The onboarding flow was removed' } });
        fireEvent.click(screen.getByRole('button', { name: 'Mark no longer valid' }));
        expect(props.onDecide).toHaveBeenCalledWith('d1', 'invalidate', 'The onboarding flow was removed', undefined);
    });
});
