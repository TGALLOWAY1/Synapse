import type {
    ArtifactSlotKey,
    CoreArtifactSubtype,
    PlanningRecord,
} from '../../types';
import { planningContentHash } from './planningHash';

export type FlagPlanningConcernInput = {
    sourceKey: string;
    artifactId: string;
    artifactVersionId: string;
    artifactSubtype?: CoreArtifactSubtype;
    artifactSlot: ArtifactSlotKey;
    spineVersionId: string;
    title: string;
    statement: string;
    materiality: NonNullable<PlanningRecord['materiality']>;
    locator: {
        entityType: 'screen_review_note' | 'artifact';
        entityId: string;
    };
};

export type FlagPlanningConcernResult =
    | { status: 'created' | 'existing'; planningRecordId: string }
    | {
        status: 'rejected';
        reason: 'source_not_found' | 'source_changed' | 'spine_not_found';
    };

export const screenNotePlanningSourceKey = (input: {
    artifactId: string;
    artifactVersionId: string;
    screenId: string;
    noteId: string;
}): string => [
    'screen-note',
    input.artifactId,
    input.artifactVersionId,
    input.screenId,
    input.noteId,
].join(':');

const canonicalizeArtifactConcernContent = (input: {
    title: string;
    statement: string;
}): { title: string; statement: string } => ({
    title: input.title.trim().toLowerCase(),
    statement: input.statement.trim().toLowerCase(),
});

export const artifactConcernPlanningSourceKey = (input: {
    artifactId: string;
    artifactVersionId: string;
    title: string;
    statement: string;
}): string => {
    const canonicalContent = canonicalizeArtifactConcernContent(input);
    const losslessContentIdentity = encodeURIComponent(JSON.stringify([
        canonicalContent.title,
        canonicalContent.statement,
    ]));
    return `artifact-concern:${input.artifactId}:${input.artifactVersionId}:${
        planningContentHash(canonicalContent)
    }:${losslessContentIdentity}`;
};

export const screenIssueMateriality = (
    severity: 'blocking' | 'review' | 'info',
): NonNullable<PlanningRecord['materiality']> => (
    severity === 'blocking' ? 'blocking'
        : severity === 'info' ? 'low'
            : 'normal'
);

export const buildFlagPlanningRecordInput = (
    input: FlagPlanningConcernInput,
): Omit<PlanningRecord, 'id' | 'projectId' | 'createdAt' | 'updatedAt'> => ({
    type: 'open_question',
    status: 'open',
    title: input.title.trim(),
    statement: input.statement.trim(),
    evidence: [{
        id: `evidence:${input.sourceKey}`,
        sourceType: 'artifact',
        sourceId: input.artifactId,
        sourceVersionId: input.artifactVersionId,
        artifactSubtype: input.artifactSubtype,
        locator: input.locator,
        excerpt: input.statement.trim(),
        verified: true,
    }],
    sourceFindingIds: [],
    createdBy: 'user',
    sources: [{
        key: input.sourceKey,
        sourceType: 'artifact',
        sourceId: input.artifactId,
        sourceVersionId: input.artifactVersionId,
        artifactSubtype: input.artifactSubtype,
        locator: input.locator,
    }, {
        key: `prd:${input.spineVersionId}`,
        sourceType: 'prd',
        sourceId: 'prd',
        sourceVersionId: input.spineVersionId,
    }],
    materiality: input.materiality,
    affectedArtifactSlots: [input.artifactSlot],
    sourceState: 'current',
});
