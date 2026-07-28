import type {
    ArtifactSlotKey,
    CoreArtifactSubtype,
    PlanningRecord,
} from '../../types';
import type {
    CrossCuttingObligationKey,
    CrossCuttingObligationStatus,
} from './crossCuttingObligations';
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

// --- Cross-cutting obligations (plan §W5) → Decision Center -------------------
//
// An unresolved cross-cutting obligation is a real open question about the plan
// ("the PRD declares success metrics and the plan says how none of them is
// measured"). The Implementation Plan surface flags it *quietly* and offers one
// user action that routes it here, through the SAME `flagPlanningConcern` path
// every other artifact concern uses (cross-cutting rule 13: one durable
// planning aggregate, records created only by an explicit user action).
//
// Nothing in this module runs on render — `deriveCrossCuttingObligations` stays
// a pure read-side projection, and no planning record exists until the user
// clicks.

/**
 * Source key for an obligation concern. Deliberately **version-less**: the same
 * obligation on a regenerated plan is the same open question, so a promoted
 * obligation stays deduplicated across plan versions (the rationale
 * `assetOpenItemPlanningSourceKey` uses).
 */
export const crossCuttingObligationPlanningSourceKey = (input: {
    artifactId: string;
    obligationKey: CrossCuttingObligationKey;
}): string => `cross-cutting-obligation:${input.artifactId}:${input.obligationKey}`;

/**
 * Title matches §W6's blocker title for the same obligation on purpose — the
 * Final Review blocker and the planning record must read as ONE item, not two
 * findings. The statement carries the derived reason plus every named gap at
 * flag time, untruncated (the blocker copy truncates for a list row; a planning
 * record is where the detail is worked).
 */
export const buildCrossCuttingObligationConcernInput = (input: {
    artifactId: string;
    artifactVersionId: string;
    spineVersionId: string;
    status: CrossCuttingObligationStatus;
}): FlagPlanningConcernInput => ({
    sourceKey: crossCuttingObligationPlanningSourceKey({
        artifactId: input.artifactId,
        obligationKey: input.status.key,
    }),
    artifactId: input.artifactId,
    artifactVersionId: input.artifactVersionId,
    artifactSubtype: 'implementation_plan',
    artifactSlot: 'implementation_plan',
    spineVersionId: input.spineVersionId,
    title: `${input.status.label} not discharged`,
    statement: [input.status.reason, ...input.status.missing]
        .map(part => part.trim())
        .filter(Boolean)
        .join(' '),
    // NOT `'blocking'`. The obligation already blocks the build packet through
    // §W6, which is the single authoritative expression of its severity. A
    // `'blocking'` record would additionally arm the Finalize materiality
    // hard stop (`deriveMaterialityGateSnapshot`) off a one-click UI action —
    // a second gate for one fact, which is exactly the duplication this flow
    // removes.
    materiality: 'normal',
    locator: {
        entityType: 'artifact',
        entityId: input.artifactId,
    },
});

/**
 * Flags an unresolved obligation as a planning concern. Returns the store's
 * result unchanged so the caller can navigate on success and report a rejection
 * (a stale plan version) honestly instead of silently doing nothing.
 */
export const flagCrossCuttingObligationConcern = (
    input: {
        projectId: string;
        artifactId?: string;
        artifactVersionId?: string;
        spineVersionId: string;
        status: CrossCuttingObligationStatus;
    },
    flagPlanningConcern: (
        projectId: string,
        concern: FlagPlanningConcernInput,
    ) => FlagPlanningConcernResult,
): FlagPlanningConcernResult => {
    if (!input.artifactId || !input.artifactVersionId) {
        return { status: 'rejected', reason: 'source_not_found' };
    }
    return flagPlanningConcern(input.projectId, buildCrossCuttingObligationConcernInput({
        artifactId: input.artifactId,
        artifactVersionId: input.artifactVersionId,
        spineVersionId: input.spineVersionId,
        status: input.status,
    }));
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
