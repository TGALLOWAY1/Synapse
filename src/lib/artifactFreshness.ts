// Canonical artifact-freshness seam (SYN-005). One place to turn raw project
// store slices into a `DependencyEvaluationInput`, evaluate it through the
// canonical engine (`evaluateDependencyGraph`), and read the result by slot or
// by artifact id. It centralizes the input-assembly loop that was duplicated in
// DependencyGraphView and ProjectWorkspace's update-plan builder.
//
// This module is PURE — no store or React imports. It takes a plain
// `FreshnessStateSlice` (the four store maps it needs, structurally typed) so
// it is trivially unit-testable and callable from any layer, mirroring
// artifactDependencyGraph.ts / screenExperience.ts. The React binding lives in
// src/hooks/useProjectFreshness.ts; presentation in src/components/FreshnessBadge.tsx.

import type {
    Artifact,
    ArtifactSlotKey,
    ArtifactVersion,
    GenerationStatus,
    ProjectJobState,
    SpineVersion,
} from '../types';
import { selectPreferredDesignSystem } from './designTokens/storeSelectors';
import { makeSpineChangeResolver } from './spineChangeAnalysis';
import {
    buildArtifactDependencyGraph,
    evaluateDependencyGraph,
    type ArtifactDependencyGraph,
    type DependencyEvaluationInput,
    type DependencyNodeEvaluation,
    type DependencyNodeId,
    type DependencyNodeStatus,
} from './artifactDependencyGraph';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * The minimal slice of the project store the freshness seam reads. Structurally
 * a subset of the real Zustand state, so `useProjectStore.getState()` satisfies
 * it directly. Every map is tolerated as possibly-undefined at the project key
 * (see the guards below) so legacy / half-loaded state never throws.
 */
export interface FreshnessStateSlice {
    artifacts: Record<string, Artifact[]>;
    artifactVersions: Record<string, ArtifactVersion[]>;
    spineVersions: Record<string, SpineVersion[]>;
    /** Transient per-project generation job state (live slot statuses). */
    jobs?: Record<string, ProjectJobState | undefined>;
}

export interface FreshnessBuildOptions {
    /**
     * Evaluate as-of a specific spine id instead of the project's `isLatest`
     * spine. The re-finalize / Update-Assets-plan path uses this to evaluate
     * against the spine being finalized (which may not yet be the latest).
     */
    asOfSpineId?: string;
    /**
     * Include live job slot statuses (generating/queued/error/interrupted) in
     * the evaluation input. Default true. The update-plan path passes false so
     * transient generation state doesn't colour the plan.
     */
    includeSlotStatus?: boolean;
}

/**
 * Everything a caller needs to evaluate and then act on a project's freshness:
 * the graph, the assembled `DependencyEvaluationInput` (WITHOUT `spineChangeFor`
 * — see below), the slot → artifact-id map for inverting results, the spine
 * list, and the resolved "latest" spine id.
 *
 * `input.spineChangeFor` is deliberately NOT attached by
 * `buildDependencyEvaluationInput`. The change-aware resolver
 * (`makeSpineChangeResolver`) is memoized differently per caller: the React
 * hook memoizes it on the spine list + latest-id refs across renders, while a
 * one-shot pure caller wants it built inline. Each caller attaches its own
 * resolver onto `context.input.spineChangeFor` before evaluating (or lets
 * `evaluateProjectFreshness` build one for it).
 */
export interface FreshnessContext {
    graph: ArtifactDependencyGraph;
    input: DependencyEvaluationInput;
    artifactIdBySlot: Partial<Record<ArtifactSlotKey, string>>;
    spines: SpineVersion[];
    latestSpineId?: string;
}

const EMPTY_ARTIFACTS: readonly Artifact[] = [];
const EMPTY_VERSIONS: readonly ArtifactVersion[] = [];
const EMPTY_SPINES: readonly SpineVersion[] = [];

/**
 * Assemble the canonical `DependencyEvaluationInput` for one project from raw
 * store slices — the single de-duplicated version of the loop that lived in
 * DependencyGraphView and ProjectWorkspace.
 *
 * Assembly semantics (replicated exactly from both call sites):
 *   - mockup slot  → the first `type === 'mockup'` artifact (no archived filter;
 *                    both call sites take the first mockup artifact as-is),
 *   - core slots   → the first non-archived `type === 'core_artifact'` artifact
 *                    matching the slot's subtype,
 *   - preferred version → the artifact's `isPreferred` version
 *                    (getPreferredVersion semantics — NOT a currentVersionId
 *                    lookup),
 *   - slotStatus   → `jobs[projectId].slots[slot].status` when it isn't 'idle'
 *                    (omitted entirely when includeSlotStatus === false),
 *   - currentDesignTokensHash → selectPreferredDesignSystem(...).tokensHash,
 *   - latest spine → the `asOfSpineId` spine when given, else the `isLatest`
 *                    spine (`spineVersionIds` always lists every spine in order).
 */
export function buildDependencyEvaluationInput(
    state: FreshnessStateSlice,
    projectId: string,
    opts: FreshnessBuildOptions = {},
): FreshnessContext {
    const includeSlotStatus = opts.includeSlotStatus !== false;
    const graph = buildArtifactDependencyGraph();

    const artifacts = state.artifacts?.[projectId] ?? EMPTY_ARTIFACTS;
    const versions = state.artifactVersions?.[projectId] ?? EMPTY_VERSIONS;
    const spines = (state.spineVersions?.[projectId] ?? EMPTY_SPINES) as SpineVersion[];
    const job = state.jobs?.[projectId];

    const asOfSpine = opts.asOfSpineId
        ? spines.find(s => s.id === opts.asOfSpineId)
        : undefined;
    const latestSpine = asOfSpine ?? spines.find(s => s.isLatest);
    const latestSpineId = latestSpine?.id;

    // getPreferredVersion semantics: the isPreferred version for the artifact.
    const preferredFor = (artifactId: string): ArtifactVersion | undefined =>
        versions.find(v => v.artifactId === artifactId && v.isPreferred);

    const mockupArtifact = artifacts.find(a => a.type === 'mockup');

    const snapshots: DependencyEvaluationInput['snapshots'] = {};
    const slotStatus: Partial<Record<ArtifactSlotKey, GenerationStatus>> = {};
    const artifactIdBySlot: Partial<Record<ArtifactSlotKey, string>> = {};

    for (const node of graph.nodes) {
        if (node.id === 'prd') continue;
        const slotKey = node.id as ArtifactSlotKey;
        const artifact = slotKey === 'mockup'
            ? mockupArtifact
            : artifacts.find(
                a => a.type === 'core_artifact' && a.subtype === slotKey && a.status !== 'archived',
            );
        const preferred = artifact ? preferredFor(artifact.id) : undefined;
        if (artifact && preferred) {
            artifactIdBySlot[slotKey] = artifact.id;
            snapshots[slotKey] = {
                artifactId: artifact.id,
                version: {
                    id: preferred.id,
                    versionNumber: preferred.versionNumber,
                    createdAt: preferred.createdAt,
                    sourceRefs: preferred.sourceRefs,
                    provenance: preferred.provenance,
                    metadata: preferred.metadata,
                },
            };
        }
        if (includeSlotStatus) {
            const live = job?.slots[slotKey]?.status;
            if (live && live !== 'idle') slotStatus[slotKey] = live;
        }
    }

    const currentDesignTokensHash = selectPreferredDesignSystem(
        { artifacts: state.artifacts ?? {}, artifactVersions: state.artifactVersions ?? {} },
        projectId,
    )?.tokensHash;

    const input: DependencyEvaluationInput = {
        spineVersionIds: spines.map(s => s.id),
        latestSpineId,
        latestSpineProvenance: latestSpine?.provenance,
        currentDesignTokensHash,
        snapshots,
        ...(includeSlotStatus ? { slotStatus } : {}),
    };

    return { graph, input, artifactIdBySlot, spines, latestSpineId };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Build the input AND evaluate it, attaching a change-aware `spineChangeFor`
 * resolver so `prd_changed` reasons carry a change summary. A convenience for
 * one-shot / non-React callers (and tests); the React hook builds its own
 * memoized resolver instead of calling this.
 */
export function evaluateProjectFreshness(
    state: FreshnessStateSlice,
    projectId: string,
    opts: FreshnessBuildOptions = {},
): { context: FreshnessContext; evaluations: Map<DependencyNodeId, DependencyNodeEvaluation> } {
    const context = buildDependencyEvaluationInput(state, projectId, opts);
    context.input.spineChangeFor = makeSpineChangeResolver(context.spines, context.latestSpineId);
    const evaluations = evaluateDependencyGraph(context.graph, context.input);
    return { context, evaluations };
}

/**
 * Re-key a node-id → evaluation map to artifact-id → evaluation, using the
 * context's `artifactIdBySlot`. Nodes without a resolved artifact (the PRD,
 * missing artifacts) are absent from the result.
 */
export function invertToArtifactIds(
    context: FreshnessContext,
    evaluations: Map<DependencyNodeId, DependencyNodeEvaluation>,
): Map<string, DependencyNodeEvaluation> {
    const byArtifactId = new Map<string, DependencyNodeEvaluation>();
    for (const [slot, artifactId] of Object.entries(context.artifactIdBySlot)) {
        if (!artifactId) continue;
        const ev = evaluations.get(slot as DependencyNodeId);
        if (ev) byArtifactId.set(artifactId, ev);
    }
    return byArtifactId;
}

// ---------------------------------------------------------------------------
// Presentation helpers (shared by every consumer of the canonical status)
// ---------------------------------------------------------------------------

/**
 * Canonical status labels — exactly the strings both legacy call sites used
 * (DependencyGraphView's STATUS_LABELS and ProjectWorkspace's
 * PLAN_STATUS_LABELS, which were already identical).
 */
export const DEPENDENCY_STATUS_LABELS: Record<DependencyNodeStatus, string> = {
    source: 'Source of truth',
    up_to_date: 'Up to date',
    needs_update: 'Needs update',
    update_recommended: 'Update recommended',
    generating: 'Generating…',
    needs_review: 'Needs validation review',
    error: 'Failed',
    missing: 'Not generated',
};

/** The two statuses that mean "the user should consider regenerating this". */
export const isStaleStatus = (s?: DependencyNodeStatus): boolean =>
    s === 'needs_update' || s === 'update_recommended';

/** Does this evaluation carry a mockup design-tokens drift reason? */
export const hasDesignTokenDrift = (ev?: DependencyNodeEvaluation): boolean =>
    !!ev?.reasons?.some(r => r.kind === 'design_tokens_changed');
