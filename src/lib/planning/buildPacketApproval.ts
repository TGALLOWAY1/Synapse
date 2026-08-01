// The build-packet APPROVAL and the plan surface's single-primary CTA state
// machine — §W7 of docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md ("Final Review:
// one blocker list, one CTA").
//
// WHAT THIS ADDS AND WHAT IT DELIBERATELY DOES NOT.
//
// §W6 (`buildPacketReadiness.ts`) answers "is the implementation packet
// complete and current?" — purely derived, recomputed every render, never
// persisted. That is the right shape for a *report*, but an APPROVAL is a user
// authority act: it has to survive a reload and say which artifact versions it
// covered. So exactly one durable thing is recorded here, and nothing else:
//
//   `ArtifactVersion.metadata.buildPacketApproval` on the implementation_plan
//   version — a USER OVERLAY (cross-cutting rule 12), written only through
//   `updateArtifactOverlay`, listed in `src/lib/artifactOverlays.ts`, and
//   therefore already carried by snapshots, sync, and the recovery bundle
//   because `artifactVersions` is an existing persisted collection.
//
// NO NEW PERSISTED COLLECTION (rule 6). This is the same pattern
// `src/lib/mockupApproval.ts` uses for the mockup flow approval, chosen for the
// same reason: an overlay travels for free, a new collection would need
// `ALL_PROJECT_COLLECTIONS` + snapshot collectors/restorers + sync + demo
// cleanup.
//
// NOT the readiness commitment. `readinessCommitment.ts` records the user's
// commitment to the PRODUCT REASONING (`derivePlanningReadiness`). Reusing it
// here would conflate the two evaluators §W6 exists to keep apart, and a
// build-packet approval has to pin ARTIFACT versions, which a `ReadinessReview`
// does not know about. The two stay separate and separately reportable; the
// packet's `reasoning_committed` criterion is how one depends on the other.
//
// Everything else in this module is DERIVED ON READ (rule 10): the manifest,
// the drift reconciliation, and the CTA state machine are pure functions of the
// evaluator's result plus the overlay. Nothing here blocks rendering.

import type { ArtifactSlotKey } from '../../types';
import type { BuildPacketReadiness } from './buildPacketReadiness';

/**
 * Overlay key on the implementation_plan version's metadata bag. MUST stay
 * listed in `OVERLAY_METADATA_KEYS` (`src/lib/artifactOverlays.ts`) — that list
 * is what makes it user work rather than generation authority, so it survives a
 * content restore and forces an append when it would be overwritten.
 */
export const BUILD_PACKET_APPROVAL_KEY = 'buildPacketApproval';

/**
 * The slot whose ArtifactVersion metadata HOSTS the approval overlay.
 *
 * This matters for drift reconciliation. `updateArtifactOverlay` appends a
 * content-identical clone, so recording an approval moves the plan's preferred
 * version id — and naively comparing the pinned plan version against the
 * current one would mark every fresh approval superseded the instant it was
 * written. The host row needs no version comparison anyway: the approval
 * physically lives on that version, so its presence IS the pin, and a
 * REGENERATED plan produces a new version with no overlay at all, which reads
 * back as "not approved" through `readBuildPacketApproval`.
 *
 * (One edge remains by design: restoring older plan content keeps current
 * overlays by default, so an approval can outlive the content it signed. The
 * packet's own currency/validation criteria are what catch that.)
 */
export const BUILD_PACKET_APPROVAL_HOST_SLOT: ArtifactSlotKey = 'implementation_plan';

/** One pinned row of the signed-off artifact-version manifest. */
export interface BuildPacketManifestEntry {
    nodeId: ArtifactSlotKey;
    title: string;
    artifactId?: string;
    /** The preferred version id at approval time. Absent → the slot had no output. */
    versionId?: string;
    /** "v3" — display label derived from `ArtifactVersion.versionNumber`. */
    versionLabel?: string;
}

/**
 * The durable approval record. Written whole (one approval at a time) but
 * MERGED from whatever was already stored, so a key this build does not know
 * about is preserved rather than dropped (rule 12).
 */
export interface BuildPacketApprovalOverlay {
    /** Epoch ms the user approved the packet. */
    approvedAt: number;
    /** The spine (PRD) version the packet was approved against. */
    spineVersionId?: string;
    /** "Version 3" — the PRD version label shown alongside the manifest. */
    prdVersionLabel?: string;
    /** The artifact versions this approval covers. */
    manifest: BuildPacketManifestEntry[];
    /** Warnings the evaluator recorded at approval time (advisory, not blocking). */
    acknowledgedWarningIds?: string[];
    /** Unknown keys from a future/older writer, preserved verbatim. */
    [key: string]: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const readManifestEntry = (value: unknown): BuildPacketManifestEntry | null => {
    if (!isRecord(value)) return null;
    if (typeof value.nodeId !== 'string') return null;
    return {
        nodeId: value.nodeId as ArtifactSlotKey,
        title: typeof value.title === 'string' ? value.title : value.nodeId,
        ...(typeof value.artifactId === 'string' ? { artifactId: value.artifactId } : {}),
        ...(typeof value.versionId === 'string' ? { versionId: value.versionId } : {}),
        ...(typeof value.versionLabel === 'string' ? { versionLabel: value.versionLabel } : {}),
    };
};

/**
 * Read the approval overlay from an implementation_plan version's metadata.
 * Returns null when absent or unreadable (legacy versions, hand-edited state)
 * so callers treat "no readable approval" uniformly — an unreadable approval is
 * never treated as an approval.
 */
export function readBuildPacketApproval(
    metadata?: Record<string, unknown>,
): BuildPacketApprovalOverlay | null {
    const raw = metadata?.[BUILD_PACKET_APPROVAL_KEY];
    if (!isRecord(raw)) return null;
    if (typeof raw.approvedAt !== 'number') return null;
    const manifest = Array.isArray(raw.manifest)
        ? raw.manifest.map(readManifestEntry).filter((entry): entry is BuildPacketManifestEntry => entry !== null)
        : [];
    return {
        ...raw,
        approvedAt: raw.approvedAt,
        manifest,
        ...(typeof raw.spineVersionId === 'string' ? { spineVersionId: raw.spineVersionId } : {}),
        ...(typeof raw.prdVersionLabel === 'string' ? { prdVersionLabel: raw.prdVersionLabel } : {}),
        ...(Array.isArray(raw.acknowledgedWarningIds)
            ? { acknowledgedWarningIds: raw.acknowledgedWarningIds.filter((id): id is string => typeof id === 'string') }
            : {}),
    };
}

/**
 * Build the overlay value for an approval, MERGED over whatever the version
 * already carried under this key. Callers pass the result straight to
 * `updateArtifactOverlay(projectId, artifactId, { buildPacketApproval: … })` —
 * never `updateArtifactVersionMetadata` (rule 12).
 */
export function buildPacketApprovalPatch(
    existingMetadata: Record<string, unknown> | undefined,
    next: {
        manifest: readonly BuildPacketManifestEntry[];
        approvedAt: number;
        spineVersionId?: string;
        prdVersionLabel?: string;
        acknowledgedWarningIds?: readonly string[];
    },
): BuildPacketApprovalOverlay {
    const existingRaw = existingMetadata?.[BUILD_PACKET_APPROVAL_KEY];
    const existing = isRecord(existingRaw) ? existingRaw : {};
    return {
        // Unknown keys written by another build survive this approval.
        ...existing,
        approvedAt: next.approvedAt,
        manifest: next.manifest.map(entry => ({ ...entry })),
        ...(next.spineVersionId ? { spineVersionId: next.spineVersionId } : {}),
        ...(next.prdVersionLabel ? { prdVersionLabel: next.prdVersionLabel } : {}),
        ...(next.acknowledgedWarningIds ? { acknowledgedWarningIds: [...next.acknowledgedWarningIds] } : {}),
    };
}

// --- Manifest reconciliation --------------------------------------------------

export type BuildPacketManifestDrift =
    /** No approval pinned yet — the row reports the current version only. */
    | 'unpinned'
    /** The pinned version is still the current one. */
    | 'match'
    /** A different version is current than the one approved. */
    | 'changed'
    /** The slot gained an output after the approval. */
    | 'added'
    /** The approved slot no longer has a current output. */
    | 'removed';

export interface BuildPacketManifestRow {
    nodeId: ArtifactSlotKey;
    title: string;
    approvedVersionId?: string;
    approvedVersionLabel?: string;
    currentVersionId?: string;
    currentVersionLabel?: string;
    drift: BuildPacketManifestDrift;
}

export interface BuildPacketManifestReconciliation {
    /** One row per slot, in the current manifest's order, then approved-only slots. */
    rows: BuildPacketManifestRow[];
    /** Rows whose drift is not `match`/`unpinned`. */
    driftCount: number;
    /** True when an approval exists and at least one row drifted. */
    hasDrift: boolean;
    /** True when nothing is pinned (no readable approval). */
    unpinned: boolean;
}

/**
 * Compare the versions an approval pinned against the versions currently
 * preferred. Derived on read — the approval is never rewritten to "catch up",
 * because that would silently re-sign work the user never saw.
 */
export function reconcileBuildPacketManifest(
    approval: BuildPacketApprovalOverlay | null | undefined,
    current: readonly BuildPacketManifestEntry[],
    options: {
        /**
         * The slot whose version carries the approval overlay. Its row is
         * pinned by hosting the overlay, not by version comparison — see
         * `BUILD_PACKET_APPROVAL_HOST_SLOT`.
         */
        hostNodeId?: ArtifactSlotKey;
    } = {},
): BuildPacketManifestReconciliation {
    const hostNodeId = options.hostNodeId ?? BUILD_PACKET_APPROVAL_HOST_SLOT;
    const approved = new Map((approval?.manifest ?? []).map(entry => [entry.nodeId, entry] as const));
    const seen = new Set<ArtifactSlotKey>();
    const rows: BuildPacketManifestRow[] = [];

    for (const entry of current) {
        seen.add(entry.nodeId);
        const pinned = approved.get(entry.nodeId);
        const isHost = entry.nodeId === hostNodeId;
        const drift: BuildPacketManifestDrift = !approval
            ? 'unpinned'
            : isHost
                ? 'match'
                : !pinned || !pinned.versionId
                    ? entry.versionId ? 'added' : 'match'
                    : !entry.versionId
                        ? 'removed'
                        : pinned.versionId === entry.versionId ? 'match' : 'changed';
        // The host row reports the version the approval is stored on, which is
        // the current one by construction.
        const pinnedVersionId = isHost && approval ? entry.versionId : pinned?.versionId;
        const pinnedVersionLabel = isHost && approval ? entry.versionLabel : pinned?.versionLabel;
        rows.push({
            nodeId: entry.nodeId,
            title: entry.title,
            ...(pinnedVersionId ? { approvedVersionId: pinnedVersionId } : {}),
            ...(pinnedVersionLabel ? { approvedVersionLabel: pinnedVersionLabel } : {}),
            ...(entry.versionId ? { currentVersionId: entry.versionId } : {}),
            ...(entry.versionLabel ? { currentVersionLabel: entry.versionLabel } : {}),
            drift,
        });
    }

    // A slot the approval covered that is no longer in the required set still
    // has to be reportable — dropping it would quietly shrink the manifest.
    for (const entry of approved.values()) {
        if (seen.has(entry.nodeId)) continue;
        rows.push({
            nodeId: entry.nodeId,
            title: entry.title,
            ...(entry.versionId ? { approvedVersionId: entry.versionId } : {}),
            ...(entry.versionLabel ? { approvedVersionLabel: entry.versionLabel } : {}),
            drift: 'removed',
        });
    }

    const driftCount = rows.filter(row => row.drift === 'changed' || row.drift === 'added' || row.drift === 'removed').length;
    return {
        rows,
        driftCount,
        hasDrift: Boolean(approval) && driftCount > 0,
        unpinned: !approval,
    };
}

// --- The single-primary CTA state machine -------------------------------------

/**
 * The four states of the plan surface. `unavailable` exists only for renders
 * with no evaluator result (isolated previews / tests); in the product
 * `ArtifactWorkspace` always supplies one.
 */
export type FinalReviewState = 'unavailable' | 'resolve_blockers' | 'approve' | 'start_build';

export type FinalReviewActionId =
    | 'check_readiness'
    | 'resolve_blockers'
    | 'approve'
    | 'start_build'
    | 'review_prompts'
    | 'convert_tasks'
    | 'copy_plan';

export interface FinalReviewAction {
    id: FinalReviewActionId;
    label: string;
    kind: 'primary' | 'secondary';
    disabled?: boolean;
    /** Why the action cannot be taken (read-only project, nothing to do). */
    disabledReason?: string;
}

export interface FinalReviewCta {
    state: FinalReviewState;
    /** EXACTLY ONE primary, in every state. */
    primary: FinalReviewAction;
    /** Copy plan / Review prompts / Convert to tasks — secondary at ALL times. */
    secondary: FinalReviewAction[];
    /** One sentence saying why this is the next step. */
    rationale: string;
    /** N in "Resolve N blockers", straight from the evaluator's blocker list. */
    blockerCount: number;
    /** An approval exists but no longer covers the current artifact versions. */
    supersededApproval: boolean;
}

export interface FinalReviewCtaInput {
    /** §W6's result. Absent → the `unavailable` state. */
    packet?: BuildPacketReadiness | null;
    approval?: BuildPacketApprovalOverlay | null;
    /** The CURRENT manifest, for drift reconciliation against the approval. */
    manifest?: readonly BuildPacketManifestEntry[];
    /** Override the slot hosting the approval overlay (defaults to the plan). */
    hostNodeId?: ArtifactSlotKey;
    /** Capability-gated (`canPersistWorkflowState`) — false in a demo project. */
    canApprove?: boolean;
    /** Convert-to-tasks is wired (an entry point exists). */
    canConvertTasks?: boolean;
    /** A next uncopied prompt pack exists. */
    hasNextPrompt?: boolean;
    /** At least one prompt pack has already been copied. */
    hasCopiedPrompt?: boolean;
    savedTaskCount?: number;
}

const READ_ONLY_REASON = 'This project is read-only, so the packet cannot be approved here.';

const plural = (count: number, word: string): string =>
    `${count} ${word}${count === 1 ? '' : 's'}`;

function secondaryActions(input: FinalReviewCtaInput): FinalReviewAction[] {
    const savedTaskCount = input.savedTaskCount ?? 0;
    const actions: FinalReviewAction[] = [
        { id: 'review_prompts', label: 'Review prompts', kind: 'secondary' },
    ];
    if (input.canConvertTasks) {
        actions.push({
            id: 'convert_tasks',
            label: savedTaskCount > 0 ? `Manage tasks (${savedTaskCount})` : 'Convert to tasks',
            kind: 'secondary',
        });
    }
    actions.push({ id: 'copy_plan', label: 'Copy plan as markdown', kind: 'secondary' });
    return actions;
}

/**
 * Resolve the plan surface's ONE primary action.
 *
 * Blockers dominate: an approval recorded earlier never promotes a build action
 * while the packet is incomplete again, and prompt review / task conversion are
 * never treated as approvals — they stay secondary in every state, which is the
 * whole point of §W7.
 */
export function deriveFinalReviewCta(input: FinalReviewCtaInput): FinalReviewCta {
    const secondary = secondaryActions(input);
    const packet = input.packet ?? null;

    if (!packet) {
        return {
            state: 'unavailable',
            primary: {
                id: 'check_readiness',
                label: 'Check build readiness',
                kind: 'primary',
                disabled: true,
                disabledReason: 'Build-packet readiness has not been evaluated for this view.',
            },
            secondary,
            rationale: 'Build-packet readiness is not available here, so no next step is promoted.',
            blockerCount: 0,
            supersededApproval: false,
        };
    }

    const reconciliation = reconcileBuildPacketManifest(input.approval, input.manifest ?? [], {
        ...(input.hostNodeId ? { hostNodeId: input.hostNodeId } : {}),
    });
    const supersededApproval = reconciliation.hasDrift;
    const approvalCovers = Boolean(input.approval) && !supersededApproval;
    const blockerCount = packet.blockers.length;

    if (!packet.isPacketComplete) {
        return {
            state: 'resolve_blockers',
            primary: {
                id: 'resolve_blockers',
                label: blockerCount > 0 ? `Resolve ${plural(blockerCount, 'blocker')}` : 'Review packet blockers',
                kind: 'primary',
            },
            secondary,
            rationale: packet.summary,
            blockerCount,
            supersededApproval,
        };
    }

    if (!approvalCovers) {
        return {
            state: 'approve',
            primary: {
                id: 'approve',
                label: supersededApproval ? 'Re-approve build packet' : 'Approve build packet',
                kind: 'primary',
                ...(input.canApprove ? {} : { disabled: true, disabledReason: READ_ONLY_REASON }),
            },
            secondary,
            rationale: supersededApproval
                ? 'A recorded approval no longer covers the current output versions. Re-approve to pin the versions below.'
                : 'Every packet check passes. Approving pins the artifact versions below as the packet this build works from.',
            blockerCount,
            supersededApproval,
        };
    }

    return {
        state: 'start_build',
        primary: {
            id: 'start_build',
            label: input.hasNextPrompt
                ? input.hasCopiedPrompt
                    ? 'Copy next implementation prompt'
                    : 'Copy first implementation prompt'
                : 'Start first slice',
            kind: 'primary',
        },
        secondary,
        rationale: 'This packet is approved. Start with the first slice and work down the roadmap.',
        blockerCount,
        supersededApproval,
    };
}
