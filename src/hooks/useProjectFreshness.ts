// React binding for the canonical artifact-freshness seam (SYN-005). Subscribes
// to the four project store maps the evaluation needs — plus the project
// options the input fingerprints read — and returns a stable, memoized
// `ProjectFreshness` for one project.
//
// SELECTOR-STABILITY RULE (CLAUDE.md; React error #185): each store read is
// its OWN selector returning the store's own reference, a primitive, or
// undefined — never a `?? []` / `?? {}` literal inside a selector (that
// allocates a fresh empty container every call, making useSyncExternalStore
// see an endless snapshot change). The project options are read as four
// primitives rather than the project object, so the output-run heartbeat
// (which rewrites the project record every few seconds) does not re-evaluate
// freshness. The single useMemo keyed on those refs + projectId is the only
// place work happens, so the returned object is reference-stable until one of
// the underlying inputs actually changes.

import { useMemo } from 'react';
import { useProjectStore } from '../store/projectStore';
import {
    computeRecommendedUpdates,
    evaluateDependencyGraph,
    type ArtifactDependencyGraph,
    type DependencyNodeEvaluation,
    type DependencyNodeId,
} from '../lib/artifactDependencyGraph';
import {
    buildDependencyEvaluationInput,
    invertToArtifactIds,
    type FreshnessStateSlice,
} from '../lib/artifactFreshness';
import { makeSpineChangeResolver } from '../lib/spineChangeAnalysis';
import type { ArtifactSlotKey } from '../types';

export interface ProjectFreshness {
    graph: ArtifactDependencyGraph;
    evaluations: Map<DependencyNodeId, DependencyNodeEvaluation>;
    /** Evaluation for a slot (node) id, e.g. bySlot('data_model'). */
    bySlot: (slot: DependencyNodeId) => DependencyNodeEvaluation | undefined;
    /** Evaluation keyed by the artifact's own id (for artifact-scoped surfaces). */
    byArtifactId: Map<string, DependencyNodeEvaluation>;
    artifactIdBySlot: Partial<Record<ArtifactSlotKey, string>>;
    latestSpineId?: string;
    /** Nodes worth regenerating, in safe update order. */
    recommendedUpdates: DependencyNodeId[];
}

export function useProjectFreshness(projectId: string): ProjectFreshness {
    // Four independent selectors — each returns the store's own reference or
    // undefined. No literal fallbacks here (see the module header).
    const artifacts = useProjectStore(s => s.artifacts[projectId]);
    const artifactVersions = useProjectStore(s => s.artifactVersions[projectId]);
    const spineVersions = useProjectStore(s => s.spineVersions[projectId]);
    const jobs = useProjectStore(s => s.jobs[projectId]);
    const projectExists = useProjectStore(s => s.projects[projectId] !== undefined);
    const projectName = useProjectStore(s => s.projects[projectId]?.name);
    const productName = useProjectStore(s => s.projects[projectId]?.productName);
    const platform = useProjectStore(s => s.projects[projectId]?.platform);
    const designSystemPreset = useProjectStore(s => s.projects[projectId]?.designSystemPreset);

    return useMemo(() => {
        const state: FreshnessStateSlice = {
            artifacts: artifacts ? { [projectId]: artifacts } : {},
            artifactVersions: artifactVersions ? { [projectId]: artifactVersions } : {},
            spineVersions: spineVersions ? { [projectId]: spineVersions } : {},
            jobs: { [projectId]: jobs },
            projects: projectExists
                ? { [projectId]: { name: projectName, productName, platform, designSystemPreset } }
                : {},
        };
        const context = buildDependencyEvaluationInput(state, projectId);
        // The hook owns its resolver's lifecycle (memoized with this pass),
        // so it attaches spineChangeFor itself rather than going through
        // evaluateProjectFreshness.
        context.input.spineChangeFor = makeSpineChangeResolver(context.spines, context.latestSpineId);
        const evaluations = evaluateDependencyGraph(context.graph, context.input);
        const byArtifactId = invertToArtifactIds(context, evaluations);
        const recommendedUpdates = computeRecommendedUpdates(context.graph, evaluations);
        return {
            graph: context.graph,
            evaluations,
            bySlot: (slot: DependencyNodeId) => evaluations.get(slot),
            byArtifactId,
            artifactIdBySlot: context.artifactIdBySlot,
            latestSpineId: context.latestSpineId,
            recommendedUpdates,
        };
    }, [
        projectId, artifacts, artifactVersions, spineVersions, jobs,
        projectExists, projectName, productName, platform, designSystemPreset,
    ]);
}
