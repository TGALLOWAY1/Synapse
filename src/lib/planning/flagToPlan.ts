import type {
    ArtifactSlotKey,
    CoreArtifactSubtype,
    PlanningRecord,
} from '../../types';
import { planningContentHash } from './planningHash';
import type {
    PlanningReturnTarget,
    PlanningScreenTab,
} from './planningNavigation';

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

export type ScreenNotePlanningRequest = {
    noteId: string;
    title: string;
    statement: string;
    materiality: 'blocking' | 'high' | 'normal' | 'low';
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

export const screenNotePlanningSourceScopeKey = (input: {
    artifactId: string;
    artifactVersionId: string;
    screenId: string;
}): string => [
    'screen-note-scope',
    input.artifactId,
    input.artifactVersionId,
    input.screenId,
].join(':');

export const buildScreenNotePlanningConcernInput = (input: {
    artifactId: string;
    artifactVersionId: string;
    spineVersionId: string;
    screenId: string;
    request: ScreenNotePlanningRequest;
}): FlagPlanningConcernInput => ({
    sourceKey: screenNotePlanningSourceKey({
        artifactId: input.artifactId,
        artifactVersionId: input.artifactVersionId,
        screenId: input.screenId,
        noteId: input.request.noteId,
    }),
    artifactId: input.artifactId,
    artifactVersionId: input.artifactVersionId,
    artifactSubtype: 'screen_inventory',
    artifactSlot: 'screen_inventory',
    spineVersionId: input.spineVersionId,
    title: input.request.title,
    statement: input.request.statement,
    materiality: input.request.materiality,
    locator: {
        entityType: 'screen_review_note',
        entityId: `${input.screenId}:${input.request.noteId}`,
    },
});

export const flagScreenNotePlanningConcern = (
    input: {
        projectId: string;
        artifactId?: string;
        artifactVersionId?: string;
        spineVersionId: string;
        screenId: string;
        request: ScreenNotePlanningRequest;
    },
    flagPlanningConcern: (
        projectId: string,
        concern: FlagPlanningConcernInput,
    ) => FlagPlanningConcernResult,
): FlagPlanningConcernResult => {
    if (!input.artifactId || !input.artifactVersionId) {
        return { status: 'rejected', reason: 'source_not_found' };
    }
    return flagPlanningConcern(input.projectId, buildScreenNotePlanningConcernInput({
        artifactId: input.artifactId,
        artifactVersionId: input.artifactVersionId,
        spineVersionId: input.spineVersionId,
        screenId: input.screenId,
        request: input.request,
    }));
};

export const buildScreenNotePlanningReturnTarget = (input: {
    artifactId: string;
    screenId: string;
    screenName: string;
    tab: PlanningScreenTab;
}): PlanningReturnTarget => {
    const tabLabel = input.tab === 'flow'
        ? 'Flow'
        : input.tab === 'mockups'
            ? 'Mockups'
            : 'Overview';
    return {
        destination: {
            kind: 'screen',
            artifactId: input.artifactId,
            nodeId: 'screen_inventory',
            screenId: input.screenId,
            tab: input.tab,
            label: `${input.screenName} · ${tabLabel}`,
        },
        label: `Back to ${input.screenName}`,
    };
};

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
