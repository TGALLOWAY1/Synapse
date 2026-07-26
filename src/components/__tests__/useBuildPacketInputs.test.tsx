import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjectStore } from '../../store/projectStore';
import { useBuildPacketInputs } from '../../hooks/useBuildPacketInputs';
import { deriveBuildPacketReadiness } from '../../lib/planning/buildPacketReadiness';
import type { SourceRef, StructuredImplementationPlan, StructuredPRD } from '../../types';

// Guards the store→input assembly for the build-packet evaluator: the slot
// states line up with the freshness engine's own resolution (preferred version
// per slot), the Data Model's endpoint contracts survive the round trip, and the
// hook stays reference-stable across an unrelated store update (selector
// stability — React #185).

beforeEach(() => {
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
        jobs: {},
    });
    localStorage.clear();
});

const prd = (): StructuredPRD => ({
    vision: 'Mood playlists',
    targetUsers: ['Listeners'],
    coreProblem: 'Playlists ignore how someone feels.',
    features: [{
        id: 'f1',
        name: 'Mood capture',
        description: 'Capture a mood fast.',
        userValue: 'Fast start',
        complexity: 'medium',
        priority: 'must',
        tier: 'mvp',
        acceptanceCriteria: ['A mood is captured in under five seconds'],
    }],
    architecture: 'React SPA',
    risks: [],
});

const dataModelContent = JSON.stringify({
    entities: [{
        name: 'MoodSnapshot',
        description: 'One captured mood.',
        fields: [{ name: 'joy_score', type: 'Float', required: true, description: 'Joy 0-1.' }],
        relationships: [],
    }],
    apiEndpoints: [{
        method: 'POST',
        path: '/api/moods',
        description: 'Create a mood snapshot',
        entity: 'MoodSnapshot',
        auth: { authentication: 'Bearer JWT required', authorization: 'Owner only' },
        requestSchema: '{ joy_score: Float }',
        responseSchema: '{ id: string }',
        errors: ['401 — missing token'],
        requirementIds: ['f1'],
    }],
});

const structuredPlan: StructuredImplementationPlan = {
    milestones: [{
        id: 'm_capture',
        name: 'Mood capture end to end',
        tasks: [{
            id: 'task_capture',
            title: 'Build the mood capture screen',
            status: 'todo',
            linkedArtifacts: { prd: ['f1'], dataModel: ['MoodSnapshot'] },
        }],
        definitionOfDone: ['A mood is captured in under five seconds'],
    }],
};
const planContent = `# Implementation Plan\n\n\`\`\`json synapse-plan\n${JSON.stringify(structuredPlan)}\n\`\`\`\n`;

function seedProject() {
    const store = useProjectStore.getState();
    const { projectId } = store.createProject('P', 'idea');
    const spine = useProjectStore.getState().spineVersions[projectId][0];
    store.updateSpineStructuredPRD(projectId, spine.id, prd(), 'md');
    const refs: SourceRef[] = [
        { id: 'r1', sourceArtifactId: spine.id, sourceArtifactVersionId: spine.id, sourceType: 'spine' },
    ];
    const seed = (title: string, subtype: 'data_model' | 'implementation_plan', content: string) => {
        const { artifactId } = store.createArtifact(projectId, 'core_artifact', title, subtype);
        store.createArtifactVersion(projectId, artifactId, content, {}, refs, 'prompt');
        return artifactId;
    };
    seed('Data Model', 'data_model', dataModelContent);
    seed('Implementation Plan', 'implementation_plan', planContent);
    return { projectId, spineId: spine.id };
}

describe('useBuildPacketInputs', () => {
    it('assembles per-slot artifact state, endpoints, and the consolidated plan', () => {
        const { projectId } = seedProject();
        const { result } = renderHook(() => useBuildPacketInputs(projectId));

        const dataModelState = result.current.artifacts.find(state => state.nodeId === 'data_model')!;
        expect(dataModelState.versionId).toBeTruthy();
        expect(dataModelState.errored).toBe(false);
        expect(dataModelState.validation?.effectiveStatus).toBe('clear');

        // Slots with no artifact are reported with no version — the evaluator
        // treats that as missing rather than the hook inventing state.
        const mockupState = result.current.artifacts.find(state => state.nodeId === 'mockup')!;
        expect(mockupState.versionId).toBeUndefined();

        expect(result.current.apiEndpoints.map(endpoint => endpoint.path)).toEqual(['/api/moods']);
        expect(result.current.dataModel?.entities.map(entity => entity.name)).toEqual(['MoodSnapshot']);
        expect(result.current.plan?.milestones?.[0].name).toBe('Mood capture end to end');
        expect(result.current.freshness.evaluations.get('data_model')?.status).toBe('up_to_date');
    });

    it('feeds the evaluator, which then reports the un-generated outputs as blockers', () => {
        const { projectId } = seedProject();
        const { result } = renderHook(() => useBuildPacketInputs(projectId));

        const packet = deriveBuildPacketReadiness({
            ...result.current,
            prd: prd(),
            committedReadiness: null,
        });

        expect(packet.isPacketComplete).toBe(false);
        const missing = packet.blockers.filter(blocker => blocker.criterionId === 'artifacts_present');
        expect(missing.map(blocker => blocker.title)).toContain('Mockups has not been generated');
        // The generated Data Model + plan satisfy the criteria they feed.
        expect(packet.criteria.find(item => item.id === 'api_contract')?.blocking).toBe(false);
        expect(packet.criteria.find(item => item.id === 'requirement_coverage')?.blocking).toBe(false);
    });

    it('returns a stable reference across an unrelated store update', () => {
        const { projectId } = seedProject();
        const { result } = renderHook(() => useBuildPacketInputs(projectId));
        const first = result.current;

        act(() => {
            useProjectStore.setState(s => ({
                feedbackItems: { ...s.feedbackItems, other: [] },
            }));
        });

        expect(result.current).toBe(first);
    });
});
