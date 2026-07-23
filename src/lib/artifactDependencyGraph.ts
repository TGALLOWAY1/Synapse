// Artifact Dependency Graph — pure, testable model of how Synapse artifacts
// relate to one another, which are stale after upstream changes, and what
// should be regenerated next.
//
// The graph is DERIVED from the real generation pipeline
// (CORE_ARTIFACT_PIPELINE.dependsOn + MOCKUP_DEPENDENCIES), never hand-drawn:
// if the pipeline gains/loses an edge, the graph follows automatically.
// Hidden subtypes (e.g. component_inventory) still generate but have no UI
// row, so they are collapsed transitively — their dependents inherit their
// dependencies. Retired subtypes (prompt_pack) are excluded entirely.
//
// Staleness is deterministic and metadata-driven — no LLM calls, no semantic
// diffing:
//   1. spine ref ≠ latest spine        → the PRD changed        (needs_update)
//   2. recorded dep ref ≠ current dep  → a dependency changed   (needs_update)
//   3. design tokensHash drift (mockup)→ visual direction moved (needs_update)
//   4. no recorded dep ref (legacy) but the dep's preferred version is newer
//      than this artifact              → advisory       (update_recommended)
// Upstream staleness additionally propagates downstream as `impactedBy`, so
// an artifact whose own refs match still warns when an ancestor is stale.
//
// This module must stay free of store/React/LLM imports so it is trivially
// unit-testable (mirrors screenExperience.ts / canonicalPrdSpine.ts).

import type {
    ArtifactSlotKey,
    CoreArtifactSubtype,
    GenerationStatus,
    SourceRef,
    VersionProvenance,
} from '../types';
import {
    CORE_ARTIFACT_PIPELINE,
    MOCKUP_DEPENDENCIES,
    isHiddenArtifactSubtype,
    isRetiredArtifactSubtype,
} from './coreArtifactPipeline';
import { isLikelyUnaffected, type SpineChangeSummary } from './spineChangeAnalysis';
import { readArtifactValidationDisposition } from './artifactValidationPolicy';

// ---------------------------------------------------------------------------
// Graph shape
// ---------------------------------------------------------------------------

/** 'prd' is the spine (source of truth); everything else is an artifact slot. */
export type DependencyNodeId = 'prd' | ArtifactSlotKey;

/**
 * 'hard' — the dependent consumes the upstream artifact's output as prompt
 * context (a true data dependency from the generation pipeline).
 * 'foundation' — every artifact is generated from the PRD (canonical spine +
 * markdown are in every prompt); these are the implicit prd → X edges.
 */
export type DependencyEdgeKind = 'hard' | 'foundation';

export interface DependencyGraphNode {
    id: DependencyNodeId;
    title: string;
    description: string;
}

export interface DependencyGraphEdge {
    /** Upstream node (the input). */
    from: DependencyNodeId;
    /** Downstream node (the consumer). */
    to: DependencyNodeId;
    kind: DependencyEdgeKind;
}

export interface ArtifactDependencyGraph {
    nodes: DependencyGraphNode[];
    edges: DependencyGraphEdge[];
}

const PRD_NODE: DependencyGraphNode = {
    id: 'prd',
    title: 'PRD',
    description: 'Source of truth — the finalized product requirements',
};

const MOCKUP_NODE: DependencyGraphNode = {
    id: 'mockup',
    title: 'Mockups',
    description: 'Per-screen UI mockup specs and images',
};

/** Is this subtype shown in the workspace (not hidden, not retired)? */
const isVisibleSubtype = (subtype: CoreArtifactSubtype): boolean =>
    !isHiddenArtifactSubtype(subtype) && !isRetiredArtifactSubtype(subtype);

/**
 * Resolve a dependency subtype to the visible subtype(s) it stands for.
 * Hidden subtypes are collapsed transitively (their own dependencies are
 * inherited); retired subtypes resolve to nothing.
 */
function expandToVisible(
    subtype: CoreArtifactSubtype,
    seen: Set<CoreArtifactSubtype> = new Set(),
): CoreArtifactSubtype[] {
    if (seen.has(subtype)) return [];
    seen.add(subtype);
    if (isRetiredArtifactSubtype(subtype)) return [];
    if (isVisibleSubtype(subtype)) return [subtype];
    const meta = CORE_ARTIFACT_PIPELINE.find(m => m.subtype === subtype);
    if (!meta) return [];
    return meta.dependsOn.flatMap(dep => expandToVisible(dep, seen));
}

/**
 * Build the dependency graph from the actual generation pipeline. Node and
 * edge order is deterministic (pipeline order, mockup last).
 */
export function buildArtifactDependencyGraph(): ArtifactDependencyGraph {
    const visibleCore = CORE_ARTIFACT_PIPELINE.filter(m => isVisibleSubtype(m.subtype));

    const nodes: DependencyGraphNode[] = [
        PRD_NODE,
        ...visibleCore.map(m => ({ id: m.subtype as DependencyNodeId, title: m.title, description: m.description })),
        MOCKUP_NODE,
    ];

    const edges: DependencyGraphEdge[] = [];
    const addEdge = (from: DependencyNodeId, to: DependencyNodeId, kind: DependencyEdgeKind) => {
        if (from === to) return;
        if (edges.some(e => e.from === from && e.to === to)) return;
        edges.push({ from, to, kind });
    };

    for (const meta of visibleCore) {
        addEdge('prd', meta.subtype, 'foundation');
        for (const dep of meta.dependsOn) {
            for (const resolved of expandToVisible(dep)) {
                addEdge(resolved, meta.subtype, 'hard');
            }
        }
    }

    addEdge('prd', 'mockup', 'foundation');
    for (const dep of MOCKUP_DEPENDENCIES) {
        for (const resolved of expandToVisible(dep)) {
            addEdge(resolved, 'mockup', 'hard');
        }
    }

    return { nodes, edges };
}

export function getDependencyNode(
    graph: ArtifactDependencyGraph,
    id: DependencyNodeId,
): DependencyGraphNode | undefined {
    return graph.nodes.find(n => n.id === id);
}

/** Direct upstream inputs of a node (hard + foundation). */
export function getDirectDependencies(
    graph: ArtifactDependencyGraph,
    id: DependencyNodeId,
): DependencyNodeId[] {
    return graph.edges.filter(e => e.to === id).map(e => e.from);
}

/** Direct downstream consumers of a node. */
export function getDirectDependents(
    graph: ArtifactDependencyGraph,
    id: DependencyNodeId,
): DependencyNodeId[] {
    return graph.edges.filter(e => e.from === id).map(e => e.to);
}

/**
 * Everything downstream of a node, split into direct consumers and
 * transitively-impacted nodes. Both lists follow graph node order.
 */
export function computeDownstreamImpacts(
    graph: ArtifactDependencyGraph,
    id: DependencyNodeId,
): { direct: DependencyNodeId[]; indirect: DependencyNodeId[] } {
    const direct = new Set(getDirectDependents(graph, id));
    const all = new Set<DependencyNodeId>();
    const queue = [...direct];
    while (queue.length > 0) {
        const next = queue.shift()!;
        if (all.has(next)) continue;
        all.add(next);
        queue.push(...getDirectDependents(graph, next));
    }
    const order = graph.nodes.map(n => n.id);
    const sorted = (set: Set<DependencyNodeId>, filter: (n: DependencyNodeId) => boolean) =>
        order.filter(n => set.has(n) && filter(n));
    return {
        direct: sorted(all, n => direct.has(n)),
        indirect: sorted(all, n => !direct.has(n)),
    };
}

/**
 * Safe regeneration order for a set of nodes: topological over the graph's
 * edges, so no artifact regenerates before an upstream input that is also
 * being regenerated. Deterministic (graph node order breaks ties).
 * Throws on ids that would cycle — impossible for a pipeline-derived graph,
 * but guards a hand-built test graph.
 */
export function computeUpdateOrder(
    graph: ArtifactDependencyGraph,
    ids: DependencyNodeId[],
): DependencyNodeId[] {
    const wanted = new Set(ids);
    const ordered: DependencyNodeId[] = [];
    const placed = new Set<DependencyNodeId>();
    let remaining = graph.nodes.map(n => n.id).filter(id => wanted.has(id));
    while (remaining.length > 0) {
        const ready = remaining.filter(id =>
            getDirectDependencies(graph, id).every(dep => !wanted.has(dep) || placed.has(dep)),
        );
        if (ready.length === 0) {
            throw new Error(`Cyclic dependency among: ${remaining.join(', ')}`);
        }
        for (const id of ready) {
            ordered.push(id);
            placed.add(id);
        }
        remaining = remaining.filter(id => !placed.has(id));
    }
    return ordered;
}

// ---------------------------------------------------------------------------
// Layout (for the SVG canvas — deterministic, no DOM measurement)
// ---------------------------------------------------------------------------

export interface GraphLayout {
    /** Nodes grouped into rows by dependency depth (row 0 = PRD). */
    rows: DependencyNodeId[][];
}

/**
 * Group nodes into rows by longest-path depth from the roots, then order each
 * row by the average column of its upstream nodes (barycenter heuristic) to
 * reduce edge crossings. Pure math — the canvas maps row/col to pixels.
 */
export function computeGraphLayout(graph: ArtifactDependencyGraph): GraphLayout {
    const depth = new Map<DependencyNodeId, number>();
    const resolve = (id: DependencyNodeId, trail: Set<DependencyNodeId> = new Set()): number => {
        const known = depth.get(id);
        if (known !== undefined) return known;
        if (trail.has(id)) return 0; // cycle guard — pipeline graphs are acyclic
        trail.add(id);
        const parents = getDirectDependencies(graph, id);
        const d = parents.length === 0 ? 0 : 1 + Math.max(...parents.map(p => resolve(p, trail)));
        depth.set(id, d);
        return d;
    };
    for (const node of graph.nodes) resolve(node.id);

    const maxDepth = Math.max(0, ...Array.from(depth.values()));
    const rows: DependencyNodeId[][] = [];
    for (let d = 0; d <= maxDepth; d++) {
        rows.push(graph.nodes.filter(n => depth.get(n.id) === d).map(n => n.id));
    }

    // Barycenter pass: order each row (after the first) by the mean column of
    // its parents in the previous rows. Stable — ties keep node order.
    const col = new Map<DependencyNodeId, number>();
    rows[0]?.forEach((id, i) => col.set(id, i));
    for (let r = 1; r < rows.length; r++) {
        const scored = rows[r].map((id, i) => {
            const parents = getDirectDependencies(graph, id).filter(p => col.has(p));
            const score = parents.length > 0
                ? parents.reduce((sum, p) => sum + (col.get(p) ?? 0), 0) / parents.length
                : i;
            return { id, i, score };
        });
        scored.sort((a, b) => (a.score - b.score) || (a.i - b.i));
        rows[r] = scored.map(s => s.id);
        rows[r].forEach((id, i) => col.set(id, i));
    }

    return { rows };
}

/**
 * Edges worth drawing: all hard edges, plus foundation (PRD) edges only for
 * nodes with no hard upstream — deeper nodes' PRD ancestry is already implied
 * by their chain, and drawing every prd → X edge turns the map into noise.
 */
export function computeDisplayEdges(graph: ArtifactDependencyGraph): DependencyGraphEdge[] {
    const hasHardUpstream = new Set(
        graph.edges.filter(e => e.kind === 'hard').map(e => e.to),
    );
    return graph.edges.filter(e => e.kind === 'hard' || !hasHardUpstream.has(e.to));
}

// ---------------------------------------------------------------------------
// Staleness evaluation
// ---------------------------------------------------------------------------

export type DependencyNodeStatus =
    | 'source'             // the PRD node — never stale, it IS the truth
    | 'up_to_date'
    | 'needs_update'       // concrete evidence a direct input changed
    | 'update_recommended' // advisory (legacy timestamp heuristic / weak provenance)
    | 'generating'         // slot queued or generating right now
    | 'needs_review'       // preferred output exists but failed blocking validation
    | 'error'              // slot errored or was interrupted
    | 'missing';           // expected by the map but never generated

export type StaleReasonKind =
    | 'prd_changed'            // spine ref no longer the latest spine
    | 'dependency_changed'     // recorded upstream version ref ≠ current preferred
    | 'design_tokens_changed'  // mockup tokensHash drift
    | 'dependency_newer'       // legacy fallback: upstream regenerated later (no recorded ref)
    | 'no_provenance';         // version has no spine ref at all

export interface StaleReason {
    kind: StaleReasonKind;
    /** The upstream node this reason points at (absent for no_provenance). */
    dependencyId?: DependencyNodeId;
    detail: string;
    /**
     * For prd_changed: WHAT changed between the artifact's source spine and
     * the latest spine (feature-level + section-level, deterministic).
     * Present only when the caller supplies `spineChangeFor`.
     */
    changeSummary?: SpineChangeSummary;
}

/** Minimal slice of an ArtifactVersion the evaluator needs. */
export interface DependencyVersionSnapshot {
    id: string;
    versionNumber: number;
    createdAt: number;
    sourceRefs: SourceRef[];
    provenance?: VersionProvenance;
    /** Optional version metadata — used to detect user overlay edits. */
    metadata?: Record<string, unknown>;
}

export interface DependencyNodeSnapshot {
    artifactId: string;
    version: DependencyVersionSnapshot;
}

export interface DependencyEvaluationInput {
    /** Spine version ids in store order (array position N → "Version N+1"). */
    spineVersionIds: string[];
    latestSpineId?: string;
    latestSpineProvenance?: VersionProvenance;
    /** tokensHash of the current preferred design system, when one exists. */
    currentDesignTokensHash?: string;
    /** Preferred-version snapshot per artifact node; absent = not generated. */
    snapshots: Partial<Record<ArtifactSlotKey, DependencyNodeSnapshot>>;
    /** Live generation status per slot (transient job state). */
    slotStatus?: Partial<Record<ArtifactSlotKey, GenerationStatus>>;
    /**
     * Optional change-awareness hook (see spineChangeAnalysis's
     * makeSpineChangeResolver): "what changed between spine X and the latest
     * spine?". When present, prd_changed reasons carry a changeSummary and
     * nodes may gain the advisory `likelyUnaffected` flag.
     */
    spineChangeFor?: (fromSpineVersionId: string) => SpineChangeSummary | null;
}

export interface DependencyNodeEvaluation {
    nodeId: DependencyNodeId;
    status: DependencyNodeStatus;
    reasons: StaleReason[];
    /**
     * Upstream nodes (transitive, hard edges) that are themselves stale,
     * missing, or errored. Non-empty on an up_to_date node means "your inputs
     * are fine today, but an ancestor is drifting".
     */
    impactedBy: DependencyNodeId[];
    /** True when the latest version was a manual user edit (caution flag). */
    manuallyEdited: boolean;
    versionNumber?: number;
    generatedAt?: number;
    /** "Version N" label of the PRD version this artifact was generated from. */
    prdVersionLabel?: string;
    /**
     * ADVISORY: the PRD did change, but no changed section is one this slot
     * chiefly derives from (ARTIFACT_SECTION_AFFINITY). Never downgrades the
     * hard needs_update status — it is a hint for "mark as up to date", not a
     * verdict. Only set when the sole hard evidence is prd_changed.
     */
    likelyUnaffected?: boolean;
}

const spineLabel = (spineVersionIds: string[], spineId: string | undefined): string | undefined => {
    if (!spineId) return undefined;
    const idx = spineVersionIds.indexOf(spineId);
    return idx >= 0 ? `Version ${idx + 1}` : undefined;
};

const nodeTitle = (graph: ArtifactDependencyGraph, id: DependencyNodeId): string =>
    getDependencyNode(graph, id)?.title ?? id;

// User overlay edits (screenEdits / promptEdits) customize the preferred
// version's metadata without creating a version — surface them with the same
// "edited manually" caution flag as provenance-tracked edits.
const hasOverlayEdits = (metadata?: Record<string, unknown>): boolean => {
    if (!metadata) return false;
    for (const key of ['screenEdits', 'promptEdits'] as const) {
        const overlay = metadata[key];
        if (overlay && typeof overlay === 'object' && Object.keys(overlay).length > 0) return true;
    }
    return false;
};

/**
 * Evaluate every node's local staleness, then propagate upstream trouble
 * downstream as `impactedBy`. Deterministic; safe on legacy data (missing
 * refs degrade to the timestamp heuristic, missing artifacts to 'missing').
 */
export function evaluateDependencyGraph(
    graph: ArtifactDependencyGraph,
    input: DependencyEvaluationInput,
): Map<DependencyNodeId, DependencyNodeEvaluation> {
    const evaluations = new Map<DependencyNodeId, DependencyNodeEvaluation>();

    evaluations.set('prd', {
        nodeId: 'prd',
        status: 'source',
        reasons: [],
        impactedBy: [],
        manuallyEdited: input.latestSpineProvenance?.changeSource === 'user_edit',
    });

    for (const node of graph.nodes) {
        if (node.id === 'prd') continue;
        const slotKey = node.id as ArtifactSlotKey;
        const snapshot = input.snapshots[slotKey];
        const live = input.slotStatus?.[slotKey];

        if (live === 'generating' || live === 'queued') {
            evaluations.set(node.id, {
                nodeId: node.id, status: 'generating', reasons: [], impactedBy: [], manuallyEdited: false,
            });
            continue;
        }
        if (live === 'error' || live === 'interrupted') {
            evaluations.set(node.id, {
                nodeId: node.id, status: 'error', reasons: [], impactedBy: [], manuallyEdited: false,
            });
            continue;
        }
        if (!snapshot) {
            evaluations.set(node.id, {
                nodeId: node.id, status: 'missing', reasons: [], impactedBy: [], manuallyEdited: false,
            });
            continue;
        }

        const { version } = snapshot;
        const validationNeedsReview =
            live === 'needs_review'
            || readArtifactValidationDisposition(version.metadata).effectiveStatus === 'needs_review';
        const reasons: StaleReason[] = [];
        let advisory = false;

        // 1. PRD drift — the artifact's recorded spine ref vs the latest spine.
        const spineRef = version.sourceRefs.find(r => r.sourceType === 'spine');
        const refLabel = spineLabel(input.spineVersionIds, spineRef?.sourceArtifactVersionId);
        if (!spineRef) {
            reasons.push({
                kind: 'no_provenance',
                detail: 'No recorded PRD link for this artifact — it may predate provenance tracking.',
            });
            advisory = true;
        } else if (input.latestSpineId && spineRef.sourceArtifactVersionId !== input.latestSpineId) {
            const latestLabel = spineLabel(input.spineVersionIds, input.latestSpineId);
            const changeSummary = input.spineChangeFor?.(spineRef.sourceArtifactVersionId) ?? undefined;
            reasons.push({
                kind: 'prd_changed',
                dependencyId: 'prd',
                detail: `The PRD changed after this was generated${refLabel && latestLabel ? ` (generated from ${refLabel}, now on ${latestLabel})` : ''}.`,
                ...(changeSummary ? { changeSummary } : {}),
            });
        }

        // 2. Upstream artifact drift — hard dependencies only.
        const hardDeps = graph.edges
            .filter(e => e.to === node.id && e.kind === 'hard')
            .map(e => e.from as ArtifactSlotKey);
        for (const dep of hardDeps) {
            const depSnapshot = input.snapshots[dep];
            if (!depSnapshot) continue; // dep missing — nothing concrete to compare

            // Mockups record the design system's tokensHash on the source ref
            // (SourceRef.anchorInfo). Token-identical regenerations keep the
            // hash stable, so hash comparison beats version-id comparison — a
            // token-identical design regen keeps mockups current.
            if (node.id === 'mockup' && dep === 'design_system') {
                const designRef = version.sourceRefs.find(
                    r => r.sourceType === 'core_artifact' && typeof r.anchorInfo === 'string',
                );
                if (designRef && input.currentDesignTokensHash) {
                    if (designRef.anchorInfo !== input.currentDesignTokensHash) {
                        reasons.push({
                            kind: 'design_tokens_changed',
                            dependencyId: dep,
                            detail: 'Design system tokens changed after these mockups were generated — they may no longer match the visual direction.',
                        });
                    }
                    continue;
                }
            }

            const recordedRef = version.sourceRefs.find(
                r => r.sourceType === 'core_artifact' && r.sourceArtifactId === depSnapshot.artifactId,
            );
            if (recordedRef) {
                if (recordedRef.sourceArtifactVersionId !== depSnapshot.version.id) {
                    reasons.push({
                        kind: 'dependency_changed',
                        dependencyId: dep,
                        detail: `${nodeTitle(graph, dep)} was regenerated (now Version ${depSnapshot.version.versionNumber}) after this was created.`,
                    });
                }
            } else if (depSnapshot.version.createdAt > version.createdAt) {
                // Legacy artifact with no recorded dependency ref: fall back to
                // a conservative timestamp comparison. Advisory only.
                reasons.push({
                    kind: 'dependency_newer',
                    dependencyId: dep,
                    detail: `${nodeTitle(graph, dep)} is newer than this artifact — it may be out of sync.`,
                });
                advisory = true;
            }
        }

        const hasHardEvidence = reasons.some(r =>
            r.kind === 'prd_changed' || r.kind === 'dependency_changed' || r.kind === 'design_tokens_changed',
        );
        const status: DependencyNodeStatus = validationNeedsReview
            ? 'needs_review'
            : hasHardEvidence
                ? 'needs_update'
                : reasons.length > 0 && advisory
                    ? 'update_recommended'
                    : 'up_to_date';

        // Advisory scoping: only when the PRD change is the SOLE reason (any
        // dependency/token drift or legacy heuristic is its own evidence) and
        // the change avoided every section this slot chiefly derives from.
        const prdReason = reasons.find(r => r.kind === 'prd_changed');
        const likelyUnaffected =
            reasons.length === 1
            && prdReason?.changeSummary !== undefined
            && isLikelyUnaffected(slotKey, prdReason.changeSummary);

        evaluations.set(node.id, {
            nodeId: node.id,
            status,
            reasons,
            impactedBy: [],
            manuallyEdited: version.provenance?.changeSource === 'user_edit'
                || hasOverlayEdits(version.metadata),
            versionNumber: version.versionNumber,
            generatedAt: version.createdAt,
            prdVersionLabel: refLabel,
            ...(likelyUnaffected ? { likelyUnaffected: true } : {}),
        });
    }

    // Propagate: collect each node's transitive hard-edge ancestors that are
    // themselves in trouble. PRD is 'source' and never propagates.
    const troubled = (id: DependencyNodeId): boolean => {
        const s = evaluations.get(id)?.status;
        return s === 'needs_update'
            || s === 'update_recommended'
            || s === 'needs_review'
            || s === 'missing'
            || s === 'error';
    };
    for (const node of graph.nodes) {
        if (node.id === 'prd') continue;
        const seen = new Set<DependencyNodeId>();
        const queue = graph.edges.filter(e => e.to === node.id && e.kind === 'hard').map(e => e.from);
        const impacted: DependencyNodeId[] = [];
        while (queue.length > 0) {
            const up = queue.shift()!;
            if (seen.has(up)) continue;
            seen.add(up);
            if (troubled(up)) impacted.push(up);
            queue.push(...graph.edges.filter(e => e.to === up && e.kind === 'hard').map(e => e.from));
        }
        const order = graph.nodes.map(n => n.id);
        evaluations.get(node.id)!.impactedBy = order.filter(id => impacted.includes(id));
    }

    return evaluations;
}

/**
 * Which artifacts should be regenerated, in safe order? Includes every node
 * that is stale, missing, errored, or downstream of one — regenerating in
 * this order never rebuilds an artifact from a stale input. Nodes currently
 * generating are excluded (they're already being handled).
 */
/**
 * Expand a user-selected regeneration batch with its troubled VISIBLE
 * upstreams. `regenerateSlots` expands hidden subtypes and orders execution,
 * but it does NOT pull in a stale/missing/errored visible input the user left
 * unselected — regenerating a dependent against it would rebuild from stale
 * context. Upstreams in `healed` (about to be marked current in the same
 * action) are treated as healthy and never force-included. Returns the batch
 * in safe update order.
 */
export function expandSelectionWithTroubledUpstreams(
    graph: ArtifactDependencyGraph,
    evaluations: Map<DependencyNodeId, DependencyNodeEvaluation>,
    selected: DependencyNodeId[],
    healed: ReadonlySet<DependencyNodeId> = new Set(),
): DependencyNodeId[] {
    const batch = new Set(selected.filter(id => id !== 'prd'));
    const troubled = (id: DependencyNodeId): boolean => {
        const s = evaluations.get(id)?.status;
        return s === 'needs_update'
            || s === 'update_recommended'
            || s === 'needs_review'
            || s === 'missing'
            || s === 'error';
    };
    let grew = true;
    while (grew) {
        grew = false;
        for (const id of [...batch]) {
            const hardDeps = graph.edges
                .filter(e => e.to === id && e.kind === 'hard')
                .map(e => e.from);
            for (const dep of hardDeps) {
                if (dep === 'prd' || batch.has(dep) || healed.has(dep)) continue;
                if (troubled(dep)) {
                    batch.add(dep);
                    grew = true;
                }
            }
        }
    }
    return computeUpdateOrder(graph, [...batch]);
}

export function computeRecommendedUpdates(
    graph: ArtifactDependencyGraph,
    evaluations: Map<DependencyNodeId, DependencyNodeEvaluation>,
): DependencyNodeId[] {
    const candidates = graph.nodes
        .map(n => n.id)
        .filter(id => {
            if (id === 'prd') return false;
            const ev = evaluations.get(id);
            if (!ev) return false;
            if (ev.status === 'generating') return false;
            return (
                ev.status === 'needs_update'
                || ev.status === 'update_recommended'
                || ev.status === 'needs_review'
                || ev.status === 'missing'
                || ev.status === 'error'
                || ev.impactedBy.length > 0
            );
        });
    return computeUpdateOrder(graph, candidates);
}
