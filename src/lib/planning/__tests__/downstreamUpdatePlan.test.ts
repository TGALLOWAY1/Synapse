import { describe, expect, it } from 'vitest';
import type { PlanningRecord } from '../../../types';
import {
    compareDownstreamUpdatePlanCurrentness,
    deriveDownstreamUpdatePlanSummary,
    downstreamPlanningContextHash,
    latestDownstreamUpdatePlanItemState,
    projectDownstreamUpdatePlan,
    normalizeDownstreamUpdatePlanCollections,
    sealDownstreamUpdatePlan,
    sealDownstreamUpdatePlanEvent,
    validateDownstreamUpdatePlanEventIntegrity,
    validateDownstreamUpdatePlanIntegrity,
    type DownstreamUpdatePlan,
} from '../downstreamUpdatePlan';

const plan = (): DownstreamUpdatePlan => sealDownstreamUpdatePlan({
    schemaVersion: 1, id: 'plan-1', projectId: 'p1', authoredBy: 'synapse', createdAt: 10,
    source: {
        kind: 'planning_change', summary: 'Collaboration was removed.', sourceSpineVersionId: 'spine-1',
        targetSpineVersionId: 'spine-2', targetSpineContentHash: 'spine-hash-2',
        planningContextHash: 'context-1', confirmed: true,
    },
    artifact: {
        artifactId: 'screens', artifactVersionId: 'screens-v1', artifactContentHash: 'screens-hash',
        slot: 'screen_inventory', title: 'Screens',
    },
    items: [{
        id: 'item-1',
        region: { kind: 'screen', screenId: 'shared-workspace', screenName: 'Shared workspace', aspect: 'screen' },
        currentInterpretation: 'The screen supports shared workspaces.',
        whyAffected: 'The current plan removed collaboration.', certainty: 'possible',
        evidence: [{ id: 'e1', kind: 'deterministic_reference', quality: 'direct', summary: 'Screen name mentions shared workspace.' }],
        ambiguity: 'A read-only version may still be useful.', recommendedAction: 'review_only',
        recommendation: 'Review whether this screen remains in scope.', preservedScope: ['Settings screen'],
        recommendedPriority: 1, implementationCritical: false,
    }],
    preservedArtifactSummary: 'The existing artifact remains usable; only the listed screen needs review.',
});

describe('downstream update plan integrity and currentness', () => {
    it('seals immutable generated snapshots and detects tampering', () => {
        const sealed = plan();
        expect(validateDownstreamUpdatePlanIntegrity(sealed)).toBe(true);
        expect(validateDownstreamUpdatePlanIntegrity({ ...sealed, preservedArtifactSummary: 'Replace everything.' })).toBe(false);
    });

    it('requires exact planning spine, authority context, and artifact version', () => {
        const sealed = plan();
        const base = {
            spineVersionId: 'spine-2', spineContentHash: 'spine-hash-2', planningContextHash: 'context-1',
            artifactVersions: { screens: { versionId: 'screens-v1', contentHash: 'screens-hash' } },
        };
        expect(compareDownstreamUpdatePlanCurrentness(sealed, base)).toEqual({ current: true, reasons: [] });
        expect(compareDownstreamUpdatePlanCurrentness(sealed, { ...base, spineVersionId: 'spine-3' })).toMatchObject({
            current: false, reasons: ['spine_changed'],
        });
        expect(compareDownstreamUpdatePlanCurrentness(sealed, { ...base, planningContextHash: 'context-2' })).toMatchObject({
            current: false, reasons: ['planning_context_changed'],
        });
        expect(compareDownstreamUpdatePlanCurrentness(sealed, {
            ...base, artifactVersions: { screens: { versionId: 'screens-v2', contentHash: 'screens-hash' } },
        })).toMatchObject({ current: false, reasons: ['artifact_version_changed'] });
    });

    it('hashes user authority but excludes advisory assessments and proposals', () => {
        const record: PlanningRecord = {
            id: 'r1', projectId: 'p1', type: 'decision', status: 'confirmed', title: 'Sharing', statement: 'No sharing',
            resolution: 'Local only', evidence: [], sourceFindingIds: [], createdBy: 'user', createdAt: 1, updatedAt: 1,
            events: [{ id: 'v1', planningRecordId: 'r1', actor: 'user', type: 'custom_answered', at: 1, answer: 'Local only' }],
        };
        const baseline = downstreamPlanningContextHash([record]);
        expect(downstreamPlanningContextHash([{ ...record, updatedAt: 20, assessments: [] }])).toBe(baseline);
        expect(downstreamPlanningContextHash([{ ...record, status: 'open' }])).not.toBe(baseline);
    });

    it('keeps user dispositions append-only and rejects model-authored event integrity', () => {
        const sealed = plan();
        const event = sealDownstreamUpdatePlanEvent({
            schemaVersion: 1, id: 'event-1', projectId: 'p1', planId: sealed.id, itemId: 'item-1', actor: 'user', at: 20,
            expectedPlanIntegrityHash: sealed.integrityHash, type: 'disposition_recorded', disposition: 'planned',
        });
        expect(validateDownstreamUpdatePlanEventIntegrity(event)).toBe(true);
        expect(validateDownstreamUpdatePlanEventIntegrity({ ...event, actor: 'synapse' } as never)).toBe(false);
        expect(latestDownstreamUpdatePlanItemState(sealed, [event], 'item-1')).toEqual({
            disposition: 'planned', priority: 1, eventIds: ['event-1'], eventIntegrityHashes: [event.integrityHash],
        });
        const wrongBinding = sealDownstreamUpdatePlanEvent({
            schemaVersion: 1, id: 'event-2', projectId: 'p1', planId: sealed.id, itemId: 'item-1', actor: 'user', at: 30,
            expectedPlanIntegrityHash: 'different-plan', type: 'disposition_recorded', disposition: 'already_aligned', rationale: 'No longer applies.',
        });
        const projection = projectDownstreamUpdatePlan(sealed, [event, wrongBinding], {
            spineVersionId: 'spine-2', spineContentHash: 'spine-hash-2', planningContextHash: 'context-1',
            artifactVersions: { screens: { versionId: 'screens-v1', contentHash: 'screens-hash' } },
        });
        expect(projection.items[0].disposition).toBe('planned');
        expect(projection.unresolvedAdvisoryCount).toBe(0);
    });

    it('conservatively initializes legacy collections', () => {
        expect(normalizeDownstreamUpdatePlanCollections({})).toEqual({ plans: {}, events: {} });
        expect(normalizeDownstreamUpdatePlanCollections(undefined)).toEqual({ plans: {}, events: {} });
    });

    it('summarizes only current integrity-valid plans and preserves unresolved work semantics', () => {
        const base = plan();
        const definite = sealDownstreamUpdatePlan({
            ...base,
            items: [{ ...base.items[0], certainty: 'definite', implementationCritical: true }],
        });
        const context = {
            spineVersionId: 'spine-2', spineContentHash: 'spine-hash-2', planningContextHash: 'context-1',
            artifactVersions: { screens: { versionId: 'screens-v1', contentHash: 'screens-hash' } },
        };
        const planned = sealDownstreamUpdatePlanEvent({
            schemaVersion: 1, id: 'planned', projectId: 'p1', planId: definite.id, itemId: 'item-1', actor: 'user', at: 20,
            expectedPlanIntegrityHash: definite.integrityHash, type: 'disposition_recorded', disposition: 'planned',
        });
        const modelAuthored = { ...planned, id: 'model', actor: 'synapse' } as never;
        const summary = deriveDownstreamUpdatePlanSummary({ plans: [definite], events: [planned, modelAuthored], context });
        expect(summary).toMatchObject({ currentPlanCount: 1, historicalPlanCount: 0 });
        expect(summary.blockingItems).toContainEqual(expect.objectContaining({ itemId: 'item-1', disposition: 'planned' }));

        const aligned = sealDownstreamUpdatePlanEvent({
            schemaVersion: 1, id: 'aligned', projectId: 'p1', planId: definite.id, itemId: 'item-1', actor: 'user', at: 30,
            expectedPlanIntegrityHash: definite.integrityHash, type: 'disposition_recorded', disposition: 'already_aligned',
            rationale: 'The current screen already reflects the plan.',
        });
        const reviewed = deriveDownstreamUpdatePlanSummary({ plans: [definite], events: [planned, aligned], context });
        expect(reviewed.blockingItems).toEqual([]);
        expect(reviewed.reviewedItems[0]).toMatchObject({ disposition: 'already_aligned' });
        expect(reviewed.snapshotHash).not.toBe(summary.snapshotHash);

        const stale = deriveDownstreamUpdatePlanSummary({
            plans: [definite], events: [aligned], context: { ...context, spineVersionId: 'spine-3' },
        });
        expect(stale).toMatchObject({ currentPlanCount: 0, historicalPlanCount: 1, blockingItems: [] });
    });
});
