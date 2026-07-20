import { useMemo, useRef } from 'react';
import type { Artifact, ArtifactVersion, Project, ReviewRun, SpineVersion } from '../../types';
import {
    buildReviewContextManifest,
    recommendSpecialistPanel,
    SPECIALIST_REGISTRY,
    type ReviewContextManifest,
} from '../../lib/review';
import type { ReviewSpecialistOption } from './ReviewWorkspace';

/**
 * Builds the current review context manifest from the latest spine and
 * committed core artifacts, reconstructs (and caches) the exact source
 * manifest for a persisted review run, and derives the recommended
 * specialist panel for the current context.
 */
export function useReviewContextManifest(params: {
    projectId: string;
    project: Project | undefined;
    spines: SpineVersion[];
    artifacts: Artifact[];
    artifactVersions: ArtifactVersion[];
    reviewRuns: ReviewRun[];
}) {
    const { projectId, project, spines, artifacts, artifactVersions, reviewRuns } = params;
    const manifests = useRef(new Map<string, ReviewContextManifest>());

    const latestSpine = spines.find(spine => spine.isLatest) ?? spines.at(-1);

    // canonicalSpine is a rebuildable cache no longer persisted onto edit/revert
    // spine versions (mobile localStorage quota — fix c9df7c5). The review
    // context reads the persisted field directly and omits the canonical block
    // when it is absent (exactly as it already did for legacy spines that never
    // had one). This is deliberate: the readiness/challenge context-signature
    // builders (readinessSlice, ProjectWorkspace, HistoryView) also read the
    // persisted field, so rebuilding one here — but not there — would desync the
    // signatures and stop a just-completed review from counting toward
    // readiness. Uniformly reading the persisted field keeps every signature
    // consistent with zero migration of existing review runs.
    const preferredArtifacts = useMemo(() => artifacts.flatMap(artifact => {
        if (artifact.type !== 'core_artifact' || !artifact.subtype || !artifact.currentVersionId) return [];
        const version = artifactVersions.find(candidate => candidate.id === artifact.currentVersionId);
        return version ? [{
            artifactId: artifact.id,
            versionId: version.id,
            subtype: artifact.subtype,
            title: artifact.title,
            content: version.content,
        }] : [];
    }), [artifacts, artifactVersions]);

    const currentManifest = useMemo(() => {
        if (!project || !latestSpine?.structuredPRD) return undefined;
        return buildReviewContextManifest({
            projectId,
            projectName: project.name,
            platform: project.platform,
            productCategory: project.productCategory,
            spine: {
                versionId: latestSpine.id,
                schemaVersion: latestSpine.prdVersion,
                content: latestSpine.responseText,
                structuredPRD: latestSpine.structuredPRD,
                canonicalSpine: latestSpine.canonicalSpine,
            },
            artifacts: preferredArtifacts,
            safetyBoundaries: latestSpine.safetyReview?.detectedConcerns ?? [],
        });
    }, [latestSpine, preferredArtifacts, project, projectId]);

    const manifestForReview = (reviewId: string): ReviewContextManifest | undefined => {
        const cached = manifests.current.get(reviewId);
        if (cached) return cached;
        const run = reviewRuns.find(candidate => candidate.id === reviewId);
        const sourceSpine = spines.find(candidate => candidate.id === run?.sourceManifest.spineVersionId);
        if (!run || !project || !sourceSpine?.structuredPRD) return undefined;
        const sourceArtifacts = run.sourceManifest.artifactRefs.flatMap(ref => {
            const artifact = artifacts.find(candidate => candidate.id === ref.artifactId);
            const version = artifactVersions.find(candidate => candidate.id === ref.artifactVersionId);
            if (!artifact?.subtype || !version) return [];
            return [{ artifactId: artifact.id, versionId: version.id, subtype: artifact.subtype, title: artifact.title, content: version.content }];
        });
        if (sourceArtifacts.length !== run.sourceManifest.artifactRefs.length) return undefined;
        const manifest = buildReviewContextManifest({
            projectId,
            projectName: project.name,
            platform: project.platform,
            productCategory: project.productCategory,
            capturedAt: run.sourceManifest.capturedAt,
            spine: {
                versionId: sourceSpine.id,
                schemaVersion: sourceSpine.prdVersion,
                content: sourceSpine.responseText,
                structuredPRD: sourceSpine.structuredPRD,
                canonicalSpine: sourceSpine.canonicalSpine,
            },
            artifacts: sourceArtifacts,
            expectedArtifactSubtypes: [
                ...sourceArtifacts.map(item => item.subtype),
                ...(run.sourceManifest.missingArtifactSubtypes ?? []),
            ],
            safetyBoundaries: sourceSpine.safetyReview?.detectedConcerns ?? [],
        });
        if (manifest.contextSignature !== run.sourceManifest.contextSignature) return undefined;
        manifests.current.set(reviewId, manifest);
        return manifest;
    };

    const panel = useMemo<ReviewSpecialistOption[]>(() => {
        if (!currentManifest) return [];
        return recommendSpecialistPanel(currentManifest).map(item => {
            const specialist = SPECIALIST_REGISTRY[item.specialistId];
            return {
                id: item.specialistId,
                name: specialist.label,
                responsibility: specialist.responsibility,
                selectionReason: item.reasons.join(' '),
                recommended: true,
            };
        });
    }, [currentManifest]);

    return { latestSpine, manifests, currentManifest, manifestForReview, panel };
}
