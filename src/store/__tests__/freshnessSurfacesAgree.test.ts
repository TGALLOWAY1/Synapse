import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { useProjectStore } from '../projectStore';
import {
    evaluateProjectFreshness,
    DEPENDENCY_STATUS_LABELS,
    isStaleStatus,
} from '../../lib/artifactFreshness';
import { computeRecommendedUpdates } from '../../lib/artifactDependencyGraph';
import { buildExportManifest, renderManifestMarkdown } from '../../lib/exportManifest';
import type { SourceRef, StructuredPRD } from '../../types';

// THE SYN-005 ACCEPTANCE TEST — one canonical freshness engine, one verdict.
//
// Every freshness surface (workspace artifact header, export manifest, Project
// Map / dependency graph, and the re-finalize Update-Assets plan) now reads the
// SAME evaluateDependencyGraph via the shared artifactFreshness seam. This test
// pins that they can never disagree again: it builds ONE real store fixture
// (implementation_plan generated from data_model v1, then data_model
// regenerated to v2) and asserts the identical "needs_update / dependency_changed"
// verdict flows through the evaluator, the export manifest, the recommended-
// updates order, and the shared status-label map every renderer keys off.

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
    vision: 'v',
    targetUsers: [],
    coreProblem: '',
    features: [],
    architecture: '',
    risks: [],
});

const spineRef = (spineId: string): SourceRef => ({
    id: uuidv4(),
    sourceArtifactId: 'project',
    sourceArtifactVersionId: spineId,
    sourceType: 'spine',
});

/**
 * data_model generated at v1; implementation_plan generated from spine + that
 * data_model v1; then data_model regenerated (v2 becomes preferred), so the
 * plan's recorded data_model ref is now stale.
 */
function seedStalePlan() {
    const store = useProjectStore.getState();
    const { projectId } = store.createProject('P', 'idea');
    const spine = useProjectStore.getState().spineVersions[projectId][0];
    store.updateSpineStructuredPRD(projectId, spine.id, prd(), 'md');

    // data_model v1 (from the latest spine)
    const { artifactId: dataModelId } = store.createArtifact(projectId, 'core_artifact', 'Data Model', 'data_model');
    const { versionId: dataModelV1 } = store.createArtifactVersion(
        projectId, dataModelId, 'dm v1', {}, [spineRef(spine.id)], 'p',
    );

    // implementation_plan built from the latest spine AND data_model v1
    const { artifactId: planId } = store.createArtifact(
        projectId, 'core_artifact', 'Implementation Plan', 'implementation_plan',
    );
    store.createArtifactVersion(projectId, planId, 'plan v1', {}, [
        spineRef(spine.id),
        {
            id: uuidv4(),
            sourceArtifactId: dataModelId,
            sourceArtifactVersionId: dataModelV1,
            sourceType: 'core_artifact',
        },
    ], 'p');

    // data_model regenerated → v2 becomes preferred; the plan's ref is now stale.
    store.createArtifactVersion(projectId, dataModelId, 'dm v2', {}, [spineRef(spine.id)], 'p');

    return { projectId, planId, dataModelId };
}

describe('SYN-005 — every freshness surface agrees on one verdict', () => {
    it('implementation_plan reads needs_update / dependency_changed across evaluator, export, plan, and labels', () => {
        const { projectId, planId } = seedStalePlan();

        // (a) The canonical evaluator: needs_update, caused by dependency_changed.
        const { context, evaluations } = evaluateProjectFreshness(useProjectStore.getState(), projectId);
        const planEval = evaluations.get('implementation_plan');
        expect(planEval?.status).toBe('needs_update');
        expect(planEval?.reasons.some(r => r.kind === 'dependency_changed' && r.dependencyId === 'data_model')).toBe(true);
        // Sanity: the regenerated data_model itself is up to date.
        expect(evaluations.get('data_model')?.status).toBe('up_to_date');

        // (b) An export-manifest entry built the way ExportModal builds it — the
        //     same byArtifactId lookup → the same status.
        const planStatus = context.artifactIdBySlot.implementation_plan === planId
            ? evaluations.get('implementation_plan')!.status
            : 'missing';
        expect(planStatus).toBe('needs_update');
        const manifest = buildExportManifest({
            projectName: 'P',
            entries: [{ title: 'Implementation Plan', versionNumber: 1, status: planStatus }],
        });
        expect(manifest.staleCount).toBe(1);
        expect(isStaleStatus(planStatus)).toBe(true);
        const md = renderManifestMarkdown(manifest);
        expect(md).toContain('| Implementation Plan | v1 | — | Needs update |');
        expect(md).toContain('1 output has an advisory alignment note');

        // (c) The Project Map's recommended-update batch includes the plan.
        const recommended = computeRecommendedUpdates(context.graph, evaluations);
        expect(recommended).toContain('implementation_plan');

        // (d) The single shared status-label map PlanHeader / DataModelOverview /
        //     the export manifest all render from.
        expect(DEPENDENCY_STATUS_LABELS[planEval!.status]).toBe('Needs update');
    });
});
