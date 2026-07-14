import { describe, expect, it } from 'vitest';
import type { DecisionEvent, PlanningRecord } from '../../../types';
import {
    appendDecisionEvent,
    normalizePlanningRecord,
    projectDecision,
    validateDecisionEvent,
} from '../decisionProjection';

const record = (patch: Partial<PlanningRecord> = {}): PlanningRecord => ({
    id: 'd1', projectId: 'p1', type: 'decision', status: 'open', title: 'Account?',
    statement: 'Should signup be required?', evidence: [], sourceFindingIds: [],
    createdBy: 'user', createdAt: 1, updatedAt: 1,
    decisionOptions: [{ id: 'anonymous', label: 'Anonymous' }, { id: 'account', label: 'Account' }],
    ...patch,
});

describe('decision projection and invariants', () => {
    it('keeps AI/review-created records proposed until a user verdict exists', () => {
        const legacy = record({ createdBy: 'specialist_review', status: 'confirmed', confirmedAt: 2 });
        expect(normalizePlanningRecord(legacy).status).toBe('proposed');
        const selected: DecisionEvent = {
            id: 'e1', planningRecordId: 'd1', type: 'option_selected', actor: 'user',
            optionId: 'anonymous', at: 3, rationale: 'Lower activation friction',
        };
        const result = appendDecisionEvent(legacy, selected);
        expect(result.ok && result.record.status).toBe('confirmed');
        expect(result.ok && projectDecision(result.record).selectedOptionId).toBe('anonymous');
    });

    it('rejects an untyped AI-authored verdict at runtime', () => {
        const unsafe = {
            id: 'e1', planningRecordId: 'd1', type: 'option_selected', actor: 'synapse',
            optionId: 'anonymous', at: 2,
        } as unknown as DecisionEvent;
        expect(validateDecisionEvent(unsafe)).toEqual({
            valid: false, reason: 'Only a user may author a decision verdict.',
        });
        expect(appendDecisionEvent(record(), unsafe).ok).toBe(false);
    });

    it('projects revision, deferral, reopening, invalidation, and supersession in append order', () => {
        let current = record();
        const events: DecisionEvent[] = [
            { id: 'e1', planningRecordId: 'd1', type: 'custom_answered', actor: 'user', answer: 'Email link', at: 2 },
            { id: 'e2', planningRecordId: 'd1', type: 'revised', actor: 'user', previousEventId: 'e1', optionId: 'account', at: 3 },
            { id: 'e3', planningRecordId: 'd1', type: 'deferred', actor: 'user', at: 4 },
            { id: 'e4', planningRecordId: 'd1', type: 'reopened', actor: 'user', at: 5 },
            { id: 'e5', planningRecordId: 'd1', type: 'invalidated', actor: 'user', reason: 'Premise changed', at: 6 },
            { id: 'e6', planningRecordId: 'd1', type: 'superseded', actor: 'user', supersededById: 'd2', at: 7 },
        ];
        for (const event of events) {
            const result = appendDecisionEvent(current, event);
            expect(result.ok).toBe(true);
            if (result.ok) current = result.record;
        }
        expect(projectDecision(current)).toMatchObject({ status: 'superseded', supersededById: 'd2' });
        expect(current.events).toHaveLength(6);
    });

    it('applies only resolved decisions and deduplicates an impact preview', () => {
        const apply: DecisionEvent = {
            id: 'apply-1', planningRecordId: 'd1', type: 'applied_to_plan', actor: 'user',
            impactPreviewId: 'preview-1', baselineSpineVersionId: 's1', resultingSpineVersionId: 's2', at: 3,
        };
        expect(appendDecisionEvent(record(), apply).ok).toBe(false);
        const selected = appendDecisionEvent(record(), {
            id: 'e1', planningRecordId: 'd1', type: 'option_selected', actor: 'user', optionId: 'account', at: 2,
        });
        if (!selected.ok) throw new Error(selected.reason);
        const applied = appendDecisionEvent(selected.record, apply);
        if (!applied.ok) throw new Error(applied.reason);
        const duplicate = appendDecisionEvent(applied.record, { ...apply, id: 'apply-2', at: 4 });
        expect(duplicate.ok && duplicate.duplicate).toBe(true);
        expect(applied.record.confirmedAt).toBe(2);
        expect(projectDecision(applied.record).resultingSpineVersionId).toBe('s2');
    });

    it('keeps alignment review user-authored and scoped to a stored proposal', () => {
        const resolved = appendDecisionEvent(record(), {
            id: 'verdict', planningRecordId: 'd1', type: 'option_selected', actor: 'user', optionId: 'account', at: 2,
        });
        if (!resolved.ok) throw new Error(resolved.reason);
        const withProposal = {
            ...resolved.record,
            assessments: [{
                id: 'assessment', projectId: 'p1', planningRecordId: 'd1', sourceSpineVersionId: 's1', status: 'fresh' as const,
                evidence: [], inferredAssumptions: [], possibleConflictRecordIds: [], createdAt: 3,
                impactPreview: {
                    id: 'preview', projectId: 'p1', planningRecordId: 'd1', decisionEventId: 'verdict', status: 'ready' as const,
                    baseline: { spineVersionId: 's1', spineContentHash: 'hash' }, affectedPrdSections: ['Vision'],
                    affectedArtifactSlots: [], possibleConflictRecordIds: [], createdAt: 3,
                    alignmentProposals: [{
                        id: 'proposal', target: { kind: 'claim' as const, section: 'Vision', label: 'Audience promise' },
                        operation: 'replace' as const, proposedValue: 'New promise', proposedSummary: 'New promise',
                        reason: 'Reflect the decision.', confidence: 'definite' as const,
                    }],
                },
            }],
        };
        expect(appendDecisionEvent(withProposal, {
            id: 'review', planningRecordId: 'd1', type: 'alignment_change_reviewed', actor: 'user',
            impactPreviewId: 'preview', proposalId: 'proposal', disposition: 'accepted', at: 4,
        }).ok).toBe(true);
        expect(appendDecisionEvent(withProposal, {
            id: 'unknown', planningRecordId: 'd1', type: 'alignment_change_reviewed', actor: 'user',
            impactPreviewId: 'preview', proposalId: 'missing', disposition: 'accepted', at: 4,
        })).toMatchObject({ ok: false, reason: 'Alignment proposal does not belong to this decision preview.' });
    });
});
