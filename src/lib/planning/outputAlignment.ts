// Product-facing downstream alignment derived from artifact provenance.
//
// The dependency graph intentionally reports low-level integrity facts. This
// module translates those facts into the calmer language users need when a
// plan changes:
//
//   aligned            — no meaningful drift is visible
//   possibly_affected  — review is recommended; the output may still be valid
//   stale              — deterministic evidence shows a contradiction
//
// A version mismatch alone is never treated as proof that an output is wrong.
// The only deterministic contradictions currently recognised are a removed
// feature that the output still references, and changed design tokens consumed
// by a mockup. Everything else preserves uncertainty honestly.

import type {
    Artifact,
    ArtifactSlotKey,
    ArtifactVersion,
    ProjectJobState,
    SpineVersion,
} from '../../types';
import {
    buildArtifactDependencyGraph,
    evaluateDependencyGraph,
    getDependencyNode,
    type DependencyEvaluationInput,
    type DependencyNodeEvaluation,
    type StaleReason,
} from '../artifactDependencyGraph';
import { findFeatureReferences, makeSpineChangeResolver } from '../spineChangeAnalysis';

export type OutputAlignmentState = 'aligned' | 'possibly_affected' | 'stale';
export type OutputAlignmentConfidence = 'definite' | 'possible' | 'unknown';

export interface OutputAlignment {
    artifactId: string;
    nodeId: ArtifactSlotKey;
    title: string;
    state: OutputAlignmentState;
    confidence: OutputAlignmentConfidence;
    /** Short answer to “why is Synapse showing this state?” */
    summary: string;
    reasons: string[];
    nextAction: string;
    /** Existing work remains available as thinking material in every state. */
    usefulForExploration: true;
    /** Only consequential unresolved alignment prevents build-ready treatment. */
    blocksBuildReadiness: boolean;
    generatedFromSpineId?: string;
}

export interface ProjectOutputAlignmentInput {
    artifacts: Artifact[];
    artifactVersions: ArtifactVersion[];
    spineVersions: SpineVersion[];
    job?: ProjectJobState;
}

export interface ProjectOutputAlignmentSummary {
    outputs: OutputAlignment[];
    alignedCount: number;
    possiblyAffectedCount: number;
    staleCount: number;
    blockingCount: number;
}

const preferredVersionFor = (
    artifact: Artifact,
    versions: ArtifactVersion[],
): ArtifactVersion | undefined => {
    if (artifact.currentVersionId) {
        const current = versions.find(version => version.id === artifact.currentVersionId);
        if (current) return current;
    }
    return versions.find(version => version.artifactId === artifact.id && version.isPreferred);
};

const artifactForNode = (
    artifacts: Artifact[],
    nodeId: ArtifactSlotKey,
): Artifact | undefined => nodeId === 'mockup'
    ? artifacts.find(artifact => artifact.type === 'mockup' && artifact.status !== 'archived')
    : artifacts.find(artifact => (
        artifact.type === 'core_artifact'
        && artifact.subtype === nodeId
        && artifact.status !== 'archived'
    ));

const removedFeatureStillReferenced = (
    evaluation: DependencyNodeEvaluation,
    content: string,
): string[] => {
    if (!content.trim()) return [];
    const reason = evaluation.reasons.find(item => item.kind === 'prd_changed');
    const removed = reason?.changeSummary?.features.removed ?? [];
    if (removed.length === 0) return [];

    return removed
        .filter(feature => findFeatureReferences(feature, [{
            artifactId: evaluation.nodeId,
            title: evaluation.nodeId,
            content,
        }]).length > 0)
        .map(feature => feature.name);
};

const reasonsForDisplay = (evaluation: DependencyNodeEvaluation): string[] => {
    const reasons = evaluation.reasons.map(reason => reason.detail);
    if (evaluation.impactedBy.length > 0) {
        reasons.push('One or more upstream outputs also need alignment review.');
    }
    return reasons;
};

const hasReason = (
    evaluation: DependencyNodeEvaluation,
    kind: StaleReason['kind'],
): boolean => evaluation.reasons.some(reason => reason.kind === kind);

function projectAlignment(
    nodeId: ArtifactSlotKey,
    artifactId: string,
    title: string,
    version: ArtifactVersion,
    evaluation: DependencyNodeEvaluation,
): OutputAlignment {
    const generatedFromSpineId = version.sourceRefs.find(ref => ref.sourceType === 'spine')
        ?.sourceArtifactVersionId;
    const removedReferences = removedFeatureStillReferenced(evaluation, version.content);
    const tokenMismatch = hasReason(evaluation, 'design_tokens_changed');
    const prdChange = evaluation.reasons.find(reason => reason.kind === 'prd_changed')?.changeSummary;
    const meaningfulPrdChange = Boolean(prdChange?.hasChanges);
    const noStructuralChange = prdChange?.comparable === true && !prdChange.hasChanges;

    if (tokenMismatch) {
        const reasons = reasonsForDisplay(evaluation);
        return {
            artifactId,
            nodeId,
            title,
            state: 'stale',
            confidence: 'definite',
            summary: 'This output uses a visual direction that has definitely changed.',
            reasons,
            nextAction: `Review and update ${title} before using it to build.`,
            usefulForExploration: true,
            blocksBuildReadiness: true,
            generatedFromSpineId,
        };
    }

    if (removedReferences.length > 0) {
        return {
            artifactId,
            nodeId,
            title,
            state: 'possibly_affected',
            confidence: 'possible',
            summary: 'This output mentions scope removed from the current plan; Synapse cannot determine from text alone whether it still depends on that scope.',
            reasons: [
                `Mentions removed scope: ${removedReferences.join(', ')}.`,
                ...reasonsForDisplay(evaluation),
            ],
            nextAction: `Review ${title} and confirm whether the removed scope is still assumed before using it to build.`,
            usefulForExploration: true,
            blocksBuildReadiness: true,
            generatedFromSpineId,
        };
    }

    const onlyNonStructuralPrdDrift = noStructuralChange
        && evaluation.reasons.every(reason => reason.kind === 'prd_changed');
    if (evaluation.status === 'up_to_date' || onlyNonStructuralPrdDrift) {
        return {
            artifactId,
            nodeId,
            title,
            state: 'aligned',
            confidence: 'definite',
            summary: onlyNonStructuralPrdDrift
                ? 'The plan version changed, but no structural product change was detected.'
                : 'This output reflects the current planning foundation.',
            reasons: [],
            nextAction: `Continue using ${title}.`,
            usefulForExploration: true,
            blocksBuildReadiness: false,
            generatedFromSpineId,
        };
    }

    const incomparablePlanChange = hasReason(evaluation, 'prd_changed')
        && prdChange?.comparable === false;
    const legacyUncertainty = hasReason(evaluation, 'no_provenance')
        || hasReason(evaluation, 'dependency_newer')
        || incomparablePlanChange;
    const relevantPlanChange = hasReason(evaluation, 'prd_changed')
        && prdChange?.comparable === true
        && meaningfulPrdChange
        && !evaluation.likelyUnaffected;
    const directInputChanged = hasReason(evaluation, 'dependency_changed');
    // A dependency version id changing is concrete provenance drift, not proof
    // that the dependent output's meaning is wrong. It becomes consequential
    // only when the changed upstream output itself carries a build blocker
    // (propagated below), or when another deterministic contradiction exists.
    const blocksBuildReadiness = relevantPlanChange;

    const reason = evaluation.reasons[0];
    return {
        artifactId,
        nodeId,
        title,
        state: 'possibly_affected',
        confidence: legacyUncertainty && !relevantPlanChange && !directInputChanged
            ? 'unknown'
            : 'possible',
        summary: evaluation.likelyUnaffected
            ? 'The plan changed, but not in an area this output chiefly depends on.'
            : reason?.changeSummary?.headline
                ? `The current plan changed: ${reason.changeSummary.headline}.`
                : reason?.detail ?? 'An upstream planning input changed after this output was created.',
        reasons: reasonsForDisplay(evaluation),
        nextAction: blocksBuildReadiness
            ? `Review ${title} against the current plan, then confirm it is aligned or update it.`
            : `Review ${title} when practical; no definite contradiction has been found.`,
        usefulForExploration: true,
        blocksBuildReadiness,
        generatedFromSpineId,
    };
}

/**
 * Derive alignment for every generated, visible output in a project. Nothing
 * is persisted and no regeneration is started. Legacy provenance gaps remain
 * advisory and never block readiness by themselves.
 */
export function deriveProjectOutputAlignment(
    input: ProjectOutputAlignmentInput,
): ProjectOutputAlignmentSummary {
    const graph = buildArtifactDependencyGraph();
    const latestSpine = input.spineVersions.find(spine => spine.isLatest);
    const snapshots: DependencyEvaluationInput['snapshots'] = {};
    const slotStatus: DependencyEvaluationInput['slotStatus'] = {};
    const artifactsByNode = new Map<ArtifactSlotKey, Artifact>();
    const versionsByNode = new Map<ArtifactSlotKey, ArtifactVersion>();

    for (const node of graph.nodes) {
        if (node.id === 'prd') continue;
        const nodeId = node.id as ArtifactSlotKey;
        const artifact = artifactForNode(input.artifacts, nodeId);
        const version = artifact ? preferredVersionFor(artifact, input.artifactVersions) : undefined;
        if (artifact && version) {
            artifactsByNode.set(nodeId, artifact);
            versionsByNode.set(nodeId, version);
            snapshots[nodeId] = {
                artifactId: artifact.id,
                version: {
                    id: version.id,
                    versionNumber: version.versionNumber,
                    createdAt: version.createdAt,
                    sourceRefs: version.sourceRefs,
                    provenance: version.provenance,
                    metadata: version.metadata,
                },
            };
        }
        const live = input.job?.slots[nodeId]?.status;
        if (live && live !== 'idle') slotStatus[nodeId] = live;
    }

    const designSystemArtifact = artifactForNode(input.artifacts, 'design_system');
    const designSystemVersion = designSystemArtifact
        ? preferredVersionFor(designSystemArtifact, input.artifactVersions)
        : undefined;
    const currentTokensHash = designSystemVersion?.metadata.tokensHash;

    const evaluations = evaluateDependencyGraph(graph, {
        spineVersionIds: input.spineVersions.map(spine => spine.id),
        latestSpineId: latestSpine?.id,
        latestSpineProvenance: latestSpine?.provenance,
        currentDesignTokensHash: typeof currentTokensHash === 'string' ? currentTokensHash : undefined,
        snapshots,
        slotStatus,
        spineChangeFor: makeSpineChangeResolver(input.spineVersions, latestSpine?.id),
    });

    const outputs: OutputAlignment[] = [];
    for (const node of graph.nodes) {
        if (node.id === 'prd') continue;
        const nodeId = node.id as ArtifactSlotKey;
        const artifact = artifactsByNode.get(nodeId);
        const version = versionsByNode.get(nodeId);
        const evaluation = evaluations.get(node.id);
        if (!artifact || !version || !evaluation) continue;
        outputs.push(projectAlignment(
            nodeId,
            artifact.id,
            getDependencyNode(graph, node.id)?.title ?? artifact.title,
            version,
            evaluation,
        ));
    }

    // Propagate only product-facing consequential alignment. The low-level
    // dependency evaluator also propagates legacy/missing uncertainty; using
    // that directly would turn an advisory provenance gap into a build block.
    const outputByNode = new Map(outputs.map(output => [output.nodeId, output]));
    const projectedOutputs = outputs.map(output => {
        const evaluation = evaluations.get(output.nodeId);
        const consequentialUpstream = evaluation?.impactedBy.some(id => (
            id !== 'prd' && outputByNode.get(id as ArtifactSlotKey)?.blocksBuildReadiness
        ));
        if (!consequentialUpstream || output.blocksBuildReadiness) return output;
        return {
            ...output,
            blocksBuildReadiness: true,
            nextAction: `Review ${output.title} after its affected upstream output is aligned.`,
        };
    });

    return {
        outputs: projectedOutputs,
        alignedCount: projectedOutputs.filter(output => output.state === 'aligned').length,
        possiblyAffectedCount: projectedOutputs.filter(output => output.state === 'possibly_affected').length,
        staleCount: projectedOutputs.filter(output => output.state === 'stale').length,
        blockingCount: projectedOutputs.filter(output => output.blocksBuildReadiness).length,
    };
}
