import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact, ArtifactVersion, PlanningRecord, SpineVersion } from '../../types';
import { hashReviewValue } from '../../lib/review/hash';
import {
    downstreamPlanningContextHash,
    sealDownstreamUpdatePlan,
    latestDownstreamUpdatePlanItemState,
} from '../../lib/planning/downstreamUpdatePlan';
import { useProjectStore } from '../projectStore';

const projectId = 'p1';
const spine: SpineVersion = {
    id: 'spine-2', projectId, promptText: 'Plan', responseText: 'Current plan', createdAt: 2,
    isLatest: true, isFinal: false,
};
const artifact: Artifact = {
    id: 'screens', projectId, type: 'core_artifact', subtype: 'screen_inventory', title: 'Screens',
    status: 'active', currentVersionId: 'screens-v1', createdAt: 1, updatedAt: 1,
};
const version: ArtifactVersion = {
    id: 'screens-v1', artifactId: artifact.id, versionNumber: 1, parentVersionId: null, content: 'Screens',
    metadata: {}, sourceRefs: [], generationPrompt: '', isPreferred: true, createdAt: 1,
};
const record: PlanningRecord = {
    id: 'decision', projectId, type: 'decision', status: 'confirmed', title: 'Sharing', statement: 'Sharing choice',
    resolution: 'Local only', evidence: [], sourceFindingIds: [], createdBy: 'user', createdAt: 1, updatedAt: 1,
};

const createPlan = () => sealDownstreamUpdatePlan({
    schemaVersion: 1, id: 'plan-1', projectId, authoredBy: 'synapse', createdAt: 10,
    source: {
        kind: 'planning_change', summary: 'Sharing changed.', targetSpineVersionId: spine.id,
        targetSpineContentHash: hashReviewValue(spine.responseText),
        planningContextHash: downstreamPlanningContextHash([record]), confirmed: true,
    },
    artifact: {
        artifactId: artifact.id, artifactVersionId: version.id, artifactContentHash: hashReviewValue(version.content),
        slot: 'screen_inventory', title: artifact.title,
    },
    items: [{
        id: 'item', region: { kind: 'artifact_review', reason: 'insufficient_dependency', label: 'Screens' },
        currentInterpretation: 'Review needed.', whyAffected: 'The plan changed.', certainty: 'possible', evidence: [],
        ambiguity: 'No precise trace exists.', recommendedAction: 'review_only', recommendation: 'Review the screens.',
        preservedScope: ['The artifact remains usable for exploration.'], recommendedPriority: 1, implementationCritical: false,
    }],
    preservedArtifactSummary: 'No artifact content is changed.',
});

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(100);
    useProjectStore.setState({
        projects: { [projectId]: { id: projectId, name: 'Project', createdAt: 1 } },
        spineVersions: { [projectId]: [spine] }, artifacts: { [projectId]: [artifact] },
        artifactVersions: { [projectId]: [version] }, planningRecords: { [projectId]: [record] },
        downstreamUpdatePlans: {}, downstreamUpdatePlanEvents: {},
    });
});

describe('downstream update plan store authority boundary', () => {
    it('records a current immutable plan and append-only user choices', () => {
        const plan = createPlan();
        expect(useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan)).toEqual({ ok: true, duplicate: false });
        expect(useProjectStore.getState().appendDownstreamUpdatePlanEvent(projectId, plan.id, 'item', {
            type: 'disposition_recorded', disposition: 'planned',
        })).toMatchObject({ ok: true, duplicate: false });
        const events = useProjectStore.getState().downstreamUpdatePlanEvents[projectId];
        expect(events[0]).toMatchObject({ actor: 'user', disposition: 'planned' });
        expect(latestDownstreamUpdatePlanItemState(plan, events, 'item').disposition).toBe('planned');
    });

    it('requires rationale for consequential bypasses', () => {
        const plan = createPlan();
        useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan);
        expect(useProjectStore.getState().appendDownstreamUpdatePlanEvent(projectId, plan.id, 'item', {
            type: 'disposition_recorded', disposition: 'already_aligned',
        })).toEqual({ ok: false, reason: 'rationale_required' });
        expect(useProjectStore.getState().appendDownstreamUpdatePlanEvent(projectId, plan.id, 'item', {
            type: 'disposition_recorded', disposition: 'already_aligned', rationale: 'The current screen already omits sharing.',
        })).toMatchObject({ ok: true });
    });

    it('rejects tampered, stale, and different-spine plans even when visible content matches', () => {
        const plan = createPlan();
        expect(useProjectStore.getState().recordDownstreamUpdatePlan(projectId, { ...plan, authoredBy: 'user' } as never))
            .toEqual({ ok: false, reason: 'invalid_plan' });
        useProjectStore.setState({ spineVersions: { [projectId]: [{ ...spine, id: 'spine-3' }] } });
        expect(useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan)).toEqual({ ok: false, reason: 'stale' });
    });

    it('stales recorded review authority after an artifact or planning-authority change', () => {
        const plan = createPlan();
        useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan);
        useProjectStore.setState({ planningRecords: { [projectId]: [{ ...record, status: 'open' }] } });
        expect(useProjectStore.getState().getDownstreamUpdatePlanCurrentness(projectId, plan.id)).toMatchObject({
            current: false, reasons: ['planning_context_changed'],
        });
        expect(useProjectStore.getState().appendDownstreamUpdatePlanEvent(projectId, plan.id, 'item', {
            type: 'priority_changed', priority: 2,
        })).toEqual({ ok: false, reason: 'stale' });
    });
});
