import { describe, expect, it, vi } from 'vitest';
import type { DecisionImpactPreview, PlanningRecord } from '../../../types';
import { planningContentHash, stablePlanningStringify } from '../decisionImpact';
import {
    complexCandidateToAlignmentHint,
    integrateComplexCandidateIntoPreview,
    reasonAboutComplexPlanningTargets,
    resolvePlanningLocationValue,
    type ComplexTargetReasoningTransport,
} from '../complexTargetReasoning';
import {
    creatorWorkspacePrd,
    creatorWorkspaceReasoningInput,
} from './fixtures/complexTargetReasoningFixtures';

const leaf = (targetId: string, path: string, entityId = '') => {
    const id = `leaf-${planningContentHash(`${targetId}:${path}:${entityId}`)}`;
    return { id, evidence: `target-leaf:${id}` };
};

const causeEvidence = 'cause:decision-solo-first';
const loopLeaf = leaf('planning-loop', '$.userLoops[0].action', 'Planning loop');
const dataLeaf = leaf('workspace-data', '$.richDataModel.entities[0].description', 'Workspace');
const architectureLeaf = leaf('architecture-consequence', '$.architecture');

const candidate = (overrides: Record<string, unknown> = {}) => ({
    targetId: 'planning-loop',
    leafRefId: loopLeaf.id,
    currentValueJson: stablePlanningStringify('Invite teammates and co-edit a shared requirements workspace.'),
    causeRefId: causeEvidence,
    evidenceRefIds: [causeEvidence, loopLeaf.evidence, 'evidence:first-release-constraint'],
    applicability: 'applicable',
    operation: 'replace',
    proposedValueJson: JSON.stringify('Develop and challenge a product plan independently.'),
    proposedSummary: 'Make the planning loop explicitly single-user for the first release.',
    reasoning: 'The current action requires teammates, which directly contradicts the confirmed single-user first-release scope.',
    confidence: 'high',
    ambiguity: '',
    questions: [],
    ...overrides,
});

const needsInputCandidate = () => ({
    targetId: 'workspace-data',
    leafRefId: dataLeaf.id,
    currentValueJson: stablePlanningStringify('A team-owned container for plans and members.'),
    causeRefId: causeEvidence,
    evidenceRefIds: [causeEvidence, dataLeaf.evidence],
    applicability: 'needs_input',
    operation: 'none',
    proposedValueJson: '',
    proposedSummary: '',
    reasoning: 'The team-ownership premise conflicts with solo scope, but the evidence does not establish local versus cloud ownership.',
    confidence: 'medium',
    ambiguity: 'Project ownership and synchronization are separate choices.',
    questions: ['Should projects remain cloud-backed and owned by one creator, or be local-only?'],
});

const alignedCandidate = () => ({
    targetId: 'architecture-consequence',
    leafRefId: architectureLeaf.id,
    currentValueJson: stablePlanningStringify('A local-first web application with optional encrypted cloud backup.'),
    causeRefId: causeEvidence,
    evidenceRefIds: [causeEvidence, architectureLeaf.evidence],
    applicability: 'already_aligned',
    operation: 'none',
    proposedValueJson: '',
    proposedSummary: '',
    reasoning: 'The architecture already supports independent use and does not require team collaboration.',
    confidence: 'high',
    ambiguity: '',
    questions: [],
});

const validResponse = () => JSON.stringify({
    candidates: [candidate(), needsInputCandidate(), alignedCandidate()],
});

describe('complex planning-target reasoning', () => {
    it('returns grounded scalar candidates and a safe bounded hint', async () => {
        const transport = vi.fn<ComplexTargetReasoningTransport>().mockResolvedValue(validResponse());
        const inputSnapshot = JSON.stringify(creatorWorkspaceReasoningInput);
        const result = await reasonAboutComplexPlanningTargets(creatorWorkspaceReasoningInput, {
            transport,
            model: 'strong-reasoner-test',
        });

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.errors.join('; '));
        expect(result.candidates).toHaveLength(3);
        expect(result.candidates[0]).toMatchObject({
            applicability: 'applicable',
            target: { location: { jsonPath: '$.userLoops[0].action' } },
            currentValue: 'Invite teammates and co-edit a shared requirements workspace.',
            proposedValue: 'Develop and challenge a product plan independently.',
        });
        expect(result.candidates[0].evidence.map(item => item.id)).toEqual(expect.arrayContaining([
            causeEvidence, loopLeaf.evidence, 'evidence:first-release-constraint',
        ]));
        const hint = complexCandidateToAlignmentHint(result.candidates[0], { model: result.model });
        expect(hint).toMatchObject({
            operation: 'replace',
            proposedValue: 'Develop and challenge a product plan independently.',
            analysisStatus: 'bounded_applicable',
            analysisMethod: 'model',
            model: 'strong-reasoner-test',
            provider: 'gemini',
            target: { jsonPath: '$.userLoops[0].action' },
        });
        expect(JSON.stringify(creatorWorkspaceReasoningInput)).toBe(inputSnapshot);
    });

    it('preserves ambiguity and focused questions without manufacturing a patch', async () => {
        const result = await reasonAboutComplexPlanningTargets(creatorWorkspaceReasoningInput, {
            transport: async () => validResponse(), model: 'strong-test',
        });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('expected success');
        const ambiguous = result.candidates[1];
        expect(ambiguous.applicability).toBe('needs_input');
        expect(ambiguous).not.toHaveProperty('proposedValue');
        const hint = complexCandidateToAlignmentHint(ambiguous, { model: result.model });
        expect(hint?.analysisStatus).toBe('needs_input');
        expect(hint).not.toHaveProperty('proposedValue');
        expect(hint?.failureReason).toContain('Should projects remain cloud-backed');
    });

    it('represents already-aligned targets without creating a mutation hint', async () => {
        const result = await reasonAboutComplexPlanningTargets(creatorWorkspaceReasoningInput, {
            transport: async () => validResponse(), model: 'strong-test',
        });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('expected success');
        expect(result.candidates[2].applicability).toBe('already_aligned');
        expect(complexCandidateToAlignmentHint(result.candidates[2], { model: result.model })).toBeUndefined();
    });

    it('fails closed on an overbroad replacement', async () => {
        const response = JSON.stringify({
            candidates: [
                candidate({ proposedValueJson: JSON.stringify([{ action: 'Rewrite the whole loop' }]) }),
                needsInputCandidate(),
                alignedCandidate(),
            ],
        });
        const result = await reasonAboutComplexPlanningTargets(creatorWorkspaceReasoningInput, {
            transport: async () => response, model: 'strong-test', maxStructuredRepairAttempts: 0,
        });
        expect(result).toMatchObject({ ok: false, reason: 'invalid_response' });
        if (result.ok) throw new Error('expected failure');
        expect(result.errors.join(' ')).toMatch(/non-scalar|shape/i);
    });

    it('fails closed when a candidate cites unsupported evidence or a fabricated target', async () => {
        const response = JSON.stringify({
            candidates: [
                candidate({ evidenceRefIds: [causeEvidence, loopLeaf.evidence, 'evidence:not-real'] }),
                needsInputCandidate(),
                { ...alignedCandidate(), targetId: 'entire-prd' },
            ],
        });
        const result = await reasonAboutComplexPlanningTargets(creatorWorkspaceReasoningInput, {
            transport: async () => response, model: 'strong-test', maxStructuredRepairAttempts: 0,
        });
        expect(result).toMatchObject({ ok: false, reason: 'invalid_response' });
        if (result.ok) throw new Error('expected failure');
        expect(result.errors.join(' ')).toMatch(/unsupported evidence|unsupported target/i);
    });

    it('cannot ignore context the user explicitly supplied for this interpretation', async () => {
        const result = await reasonAboutComplexPlanningTargets({
            ...creatorWorkspaceReasoningInput,
            requiredEvidenceRefIds: ['evidence:first-release-constraint'],
        }, {
            transport: async () => JSON.stringify({
                candidates: [
                    candidate({ evidenceRefIds: [causeEvidence, loopLeaf.evidence] }),
                    needsInputCandidate(),
                    alignedCandidate(),
                ],
            }),
            model: 'strong-test', maxStructuredRepairAttempts: 0,
        });
        expect(result).toMatchObject({ ok: false, reason: 'invalid_response' });
        if (result.ok) throw new Error('expected failure');
        expect(result.errors.join(' ')).toMatch(/omitted required user evidence/i);
    });

    it('performs one bounded repair and still fails closed on malformed responses', async () => {
        const transport = vi.fn<ComplexTargetReasoningTransport>().mockResolvedValue('{not-json');
        const result = await reasonAboutComplexPlanningTargets(creatorWorkspaceReasoningInput, {
            transport, model: 'strong-test', maxStructuredRepairAttempts: 1,
        });
        expect(result).toMatchObject({ ok: false, reason: 'invalid_response', attempts: 2 });
        expect(transport).toHaveBeenCalledTimes(2);
        expect(transport.mock.calls[1][0].repair?.validationErrors).toContain('Response was not valid JSON.');
    });

    it('rejects unsupported broad sections before invoking the model', async () => {
        const transport = vi.fn<ComplexTargetReasoningTransport>();
        const result = await reasonAboutComplexPlanningTargets({
            ...creatorWorkspaceReasoningInput,
            targets: [{
                id: 'whole-plan',
                location: { kind: 'section', section: 'Working plan', label: 'Whole plan', jsonPath: '$.features' },
            }],
        }, { transport, model: 'strong-test' });
        expect(result).toMatchObject({ ok: false, reason: 'invalid_context', attempts: 0 });
        expect(transport).not.toHaveBeenCalled();
    });

    it('resolves canonical indexed leaves without fuzzy matching', () => {
        expect(resolvePlanningLocationValue(creatorWorkspacePrd, {
            kind: 'flow_step', section: 'User Loops', label: 'Action', jsonPath: '$.userLoops[0].action',
        })).toEqual({
            ok: true,
            value: 'Invite teammates and co-edit a shared requirements workspace.',
            canonicalPath: '$.userLoops[0].action',
        });
        expect(resolvePlanningLocationValue(creatorWorkspacePrd, {
            kind: 'flow_step', section: 'User Loops', label: 'Action', jsonPath: '$.userLoops[*].action',
        })).toMatchObject({ ok: false });
    });

    it('integrates one refined leaf, preserves siblings, and rejects target redirection', async () => {
        const reasoned = await reasonAboutComplexPlanningTargets(creatorWorkspaceReasoningInput, {
            transport: async () => validResponse(), model: 'strong-test',
        });
        if (!reasoned.ok) throw new Error('expected success');
        const record: PlanningRecord = {
            id: 'decision-solo-first', projectId: 'p1', type: 'decision', status: 'confirmed',
            title: 'Single-user first release', statement: 'Defer collaboration.', evidence: [], sourceFindingIds: [],
            createdBy: 'user', createdAt: 1, updatedAt: 2,
            events: [{ id: 'decision-solo-first-verdict', planningRecordId: 'decision-solo-first', type: 'custom_answered', actor: 'user', answer: 'Ship a single-user first release; defer team workspaces.', at: 2 }],
        };
        const preview: DecisionImpactPreview = {
            id: 'preview', projectId: 'p1', planningRecordId: record.id,
            decisionEventId: 'decision-solo-first-verdict', status: 'ready', proposalContractVersion: 1,
            baseline: { spineVersionId: 'spine-creators-v2', spineContentHash: planningContentHash(creatorWorkspacePrd) },
            affectedPrdSections: ['User Loops'], affectedArtifactSlots: [], possibleConflictRecordIds: [], createdAt: 3,
            alignmentProposals: [{
                id: 'planning-loop', target: creatorWorkspaceReasoningInput.targets[0].location,
                operation: 'review', reason: 'Review this affected flow.', confidence: 'possible', requiresInput: true,
            }],
        };
        const integrated = integrateComplexCandidateIntoPreview({
            preview, replaceProposalId: 'planning-loop', candidate: reasoned.candidates[0], record,
            structuredPRD: creatorWorkspacePrd, model: reasoned.model,
        });
        expect(integrated.ok).toBe(true);
        if (!integrated.ok) throw new Error(integrated.reason);
        expect(integrated.preview.alignmentProposals?.[0]).toMatchObject({
            target: { jsonPath: '$.userLoops[0].action' },
            proposedValue: 'Develop and challenge a product plan independently.',
            contract: { analysisStatus: 'bounded_applicable', maxTouchedTargets: 1 },
        });
        expect(integrated.preview.proposedPrdPatch).toHaveLength(1);
        expect(creatorWorkspacePrd.userLoops?.[0].systemResponse).toBe('Synapse records decisions and highlights unresolved dependencies.');

        const redirected = integrateComplexCandidateIntoPreview({
            preview, replaceProposalId: 'planning-loop', record, structuredPRD: creatorWorkspacePrd, model: reasoned.model,
            candidate: {
                ...reasoned.candidates[0],
                target: { ...reasoned.candidates[0].target, location: { ...reasoned.candidates[0].target.location, jsonPath: '$.uxPages[0].purpose' } },
                currentValue: creatorWorkspacePrd.uxPages![0].purpose,
            },
        });
        expect(redirected).toMatchObject({ ok: false, reason: expect.stringMatching(/outside the original review target/i) });
    });

    it('allows a user-rejected interpretation to be replaced but never overwrites accepted wording', async () => {
        const reasoned = await reasonAboutComplexPlanningTargets(creatorWorkspaceReasoningInput, {
            transport: async () => validResponse(), model: 'strong-test',
        });
        if (!reasoned.ok) throw new Error('expected success');
        const baseRecord: PlanningRecord = {
            id: 'decision-solo-first', projectId: 'p1', type: 'decision', status: 'confirmed',
            title: 'Single-user first release', statement: 'Defer collaboration.', evidence: [], sourceFindingIds: [],
            createdBy: 'user', createdAt: 1, updatedAt: 2,
            events: [{ id: 'decision-solo-first-verdict', planningRecordId: 'decision-solo-first', type: 'custom_answered', actor: 'user', answer: 'Ship solo first.', at: 2 }],
        };
        const preview: DecisionImpactPreview = {
            id: 'preview', projectId: 'p1', planningRecordId: baseRecord.id,
            decisionEventId: 'decision-solo-first-verdict', status: 'ready', proposalContractVersion: 1,
            baseline: { spineVersionId: 'spine-creators-v2', spineContentHash: planningContentHash(creatorWorkspacePrd) },
            affectedPrdSections: ['User Loops'], affectedArtifactSlots: [], possibleConflictRecordIds: [], createdAt: 3,
            alignmentProposals: [{ id: 'planning-loop', target: creatorWorkspaceReasoningInput.targets[0].location, operation: 'review', reason: 'Review flow.', confidence: 'possible', requiresInput: true }],
        };
        const reviewed = (disposition: 'rejected' | 'accepted'): PlanningRecord => ({
            ...baseRecord,
            events: [...baseRecord.events!, {
                id: disposition, planningRecordId: baseRecord.id, type: 'alignment_change_reviewed', actor: 'user',
                impactPreviewId: preview.id, proposalId: 'planning-loop', disposition, at: 4,
            }],
        });
        const input = { preview, replaceProposalId: 'planning-loop', candidate: reasoned.candidates[0], structuredPRD: creatorWorkspacePrd, model: reasoned.model };
        expect(integrateComplexCandidateIntoPreview({ ...input, record: reviewed('rejected') }).ok).toBe(true);
        expect(integrateComplexCandidateIntoPreview({ ...input, record: reviewed('accepted') })).toMatchObject({ ok: false, reason: expect.stringMatching(/accepted wording/i) });
    });
});
