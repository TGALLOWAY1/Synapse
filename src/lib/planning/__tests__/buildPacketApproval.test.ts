import { describe, expect, it } from 'vitest';
import {
    BUILD_PACKET_APPROVAL_KEY,
    buildPacketApprovalPatch,
    deriveFinalReviewCta,
    readBuildPacketApproval,
    reconcileBuildPacketManifest,
    type BuildPacketApprovalOverlay,
    type BuildPacketManifestEntry,
} from '../buildPacketApproval';
import type { BuildPacketBlocker, BuildPacketReadiness } from '../buildPacketReadiness';
import { OVERLAY_METADATA_KEYS } from '../../artifactOverlays';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const blocker = (id: string, criterionId: BuildPacketBlocker['criterionId']): BuildPacketBlocker => ({
    id,
    criterionId,
    title: `${id} title`,
    consequence: `${id} consequence`,
    remedy: `${id} remedy`,
    evidenceQuality: 'incomplete',
    actionTarget: { kind: 'artifact_slot', nodeId: 'data_model' },
});

const packet = (overrides: Partial<BuildPacketReadiness> = {}): BuildPacketReadiness => {
    const blockers = overrides.blockers ?? [];
    return {
        isPacketComplete: blockers.length === 0,
        status: blockers.length === 0 ? 'complete' : 'incomplete',
        headline: blockers.length === 0 ? 'Implementation packet complete' : 'Implementation packet incomplete',
        summary: 'Packet summary.',
        criteria: [],
        blockers,
        warnings: [],
        nextBlocker: blockers[0],
        evaluatedAt: 1_700_000_000_000,
        ...overrides,
    };
};

const manifest = (overrides: Partial<Record<string, string | undefined>> = {}): BuildPacketManifestEntry[] => ([
    { nodeId: 'data_model', title: 'Data Model', artifactId: 'a-dm', versionId: overrides.data_model ?? 'v-dm', versionLabel: 'v1' },
    { nodeId: 'implementation_plan', title: 'Implementation Plan', artifactId: 'a-plan', versionId: overrides.implementation_plan ?? 'v-plan', versionLabel: 'v2' },
]);

const approvalFor = (entries: BuildPacketManifestEntry[]): BuildPacketApprovalOverlay => ({
    approvedAt: 1_700_000_000_000,
    manifest: entries,
});

// ---------------------------------------------------------------------------
// The overlay: rule 12 compliance
// ---------------------------------------------------------------------------

describe('build-packet approval overlay', () => {
    it('is registered as a user-authored overlay key', () => {
        // Without this registration the approval would be treated as generation
        // authority: it would not survive a content restore, and overwriting it
        // would not force an append (cross-cutting rule 12).
        expect(OVERLAY_METADATA_KEYS).toContain(BUILD_PACKET_APPROVAL_KEY);
    });

    it('reads a well-formed approval back off a version metadata bag', () => {
        const stored = { [BUILD_PACKET_APPROVAL_KEY]: approvalFor(manifest()) };
        const read = readBuildPacketApproval(stored);
        expect(read?.approvedAt).toBe(1_700_000_000_000);
        expect(read?.manifest.map(entry => entry.nodeId)).toEqual(['data_model', 'implementation_plan']);
    });

    it('treats an absent or unreadable approval as no approval', () => {
        expect(readBuildPacketApproval(undefined)).toBeNull();
        expect(readBuildPacketApproval({})).toBeNull();
        expect(readBuildPacketApproval({ [BUILD_PACKET_APPROVAL_KEY]: 'yes' })).toBeNull();
        // No timestamp → not an approval, rather than an approval at time zero.
        expect(readBuildPacketApproval({ [BUILD_PACKET_APPROVAL_KEY]: { manifest: [] } })).toBeNull();
    });

    it('drops manifest entries it cannot read instead of inventing a nodeId', () => {
        const read = readBuildPacketApproval({
            [BUILD_PACKET_APPROVAL_KEY]: { approvedAt: 1, manifest: [{ nodeId: 'data_model' }, { title: 'orphan' }] },
        });
        expect(read?.manifest).toEqual([{ nodeId: 'data_model', title: 'data_model' }]);
    });

    it('merges from the existing overlay so unknown keys survive a re-approval', () => {
        const existing = {
            [BUILD_PACKET_APPROVAL_KEY]: {
                approvedAt: 1,
                manifest: [],
                signedOffNote: 'written by a future build',
            },
        };
        const next = buildPacketApprovalPatch(existing, {
            manifest: manifest(),
            approvedAt: 2,
            spineVersionId: 'spine-9',
            prdVersionLabel: 'Version 3',
        });
        expect(next.signedOffNote).toBe('written by a future build');
        expect(next.approvedAt).toBe(2);
        expect(next.spineVersionId).toBe('spine-9');
        expect(next.prdVersionLabel).toBe('Version 3');
        expect(next.manifest).toHaveLength(2);
    });

    it('copies manifest entries rather than aliasing the caller array', () => {
        const entries = manifest();
        const next = buildPacketApprovalPatch(undefined, { manifest: entries, approvedAt: 5 });
        expect(next.manifest[0]).not.toBe(entries[0]);
        expect(next.manifest[0]).toEqual(entries[0]);
    });
});

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

describe('reconcileBuildPacketManifest', () => {
    it('reports every current slot as unpinned when nothing is approved', () => {
        const result = reconcileBuildPacketManifest(null, manifest());
        expect(result.unpinned).toBe(true);
        expect(result.hasDrift).toBe(false);
        expect(result.rows.map(row => row.drift)).toEqual(['unpinned', 'unpinned']);
        expect(result.rows[0].currentVersionLabel).toBe('v1');
    });

    it('matches when the approved versions are still current', () => {
        const result = reconcileBuildPacketManifest(approvalFor(manifest()), manifest());
        expect(result.rows.every(row => row.drift === 'match')).toBe(true);
        expect(result.driftCount).toBe(0);
        expect(result.hasDrift).toBe(false);
    });

    it('flags a slot whose current version differs from the approved one', () => {
        const result = reconcileBuildPacketManifest(
            approvalFor(manifest()),
            manifest({ data_model: 'v-dm-2' }),
        );
        const row = result.rows.find(item => item.nodeId === 'data_model')!;
        expect(row.drift).toBe('changed');
        expect(row.approvedVersionId).toBe('v-dm');
        expect(row.currentVersionId).toBe('v-dm-2');
        expect(result.hasDrift).toBe(true);
        expect(result.driftCount).toBe(1);
    });

    it('flags a slot that gained an output after the approval', () => {
        // Compared against a non-host slot: the host row is pinned by carrying
        // the overlay, not by version comparison.
        const approval = approvalFor([manifest()[1]]);
        const result = reconcileBuildPacketManifest(approval, manifest());
        expect(result.rows.find(row => row.nodeId === 'data_model')!.drift).toBe('added');
        expect(result.hasDrift).toBe(true);
    });

    it('never reports the slot hosting the approval as drifted', () => {
        // `updateArtifactOverlay` appends a content-identical clone, so writing
        // the approval moves the plan's own preferred version id. Comparing that
        // naively would mark every fresh approval superseded immediately.
        const result = reconcileBuildPacketManifest(
            approvalFor(manifest()),
            manifest({ implementation_plan: 'v-plan-clone' }),
        );
        const host = result.rows.find(row => row.nodeId === 'implementation_plan')!;
        expect(host.drift).toBe('match');
        // The row reports the version the approval is stored on.
        expect(host.approvedVersionId).toBe('v-plan-clone');
        expect(result.hasDrift).toBe(false);
    });

    it('honours an explicit host slot override', () => {
        const result = reconcileBuildPacketManifest(
            approvalFor(manifest()),
            manifest({ data_model: 'v-dm-2', implementation_plan: 'v-plan-2' }),
            { hostNodeId: 'data_model' },
        );
        expect(result.rows.find(row => row.nodeId === 'data_model')!.drift).toBe('match');
        expect(result.rows.find(row => row.nodeId === 'implementation_plan')!.drift).toBe('changed');
    });

    it('keeps an approved slot reportable after it leaves the current set', () => {
        const approval = approvalFor(manifest());
        const result = reconcileBuildPacketManifest(approval, [manifest()[0]]);
        const row = result.rows.find(item => item.nodeId === 'implementation_plan')!;
        expect(row.drift).toBe('removed');
        expect(row.approvedVersionId).toBe('v-plan');
        expect(row.currentVersionId).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// The CTA state machine — §W7's central claim
// ---------------------------------------------------------------------------

const PRIMARY_ONLY = (cta: ReturnType<typeof deriveFinalReviewCta>) => [
    cta.primary,
    ...cta.secondary,
].filter(action => action.kind === 'primary');

describe('deriveFinalReviewCta — exactly one primary in every state', () => {
    const cases = [
        { name: 'unavailable', input: {} },
        {
            name: 'not ready',
            input: { packet: packet({ blockers: [blocker('b1', 'artifacts_present')] }) },
        },
        {
            name: 'ready, not approved',
            input: { packet: packet(), manifest: manifest(), canApprove: true },
        },
        {
            name: 'approved',
            input: {
                packet: packet(),
                manifest: manifest(),
                approval: approvalFor(manifest()),
                canApprove: true,
            },
        },
    ];

    for (const { name, input } of cases) {
        it(`promotes exactly one primary action — ${name}`, () => {
            const cta = deriveFinalReviewCta(input);
            expect(PRIMARY_ONLY(cta)).toHaveLength(1);
            expect(cta.primary.kind).toBe('primary');
        });

        it(`never promotes copy plan, review prompts or convert to tasks — ${name}`, () => {
            const cta = deriveFinalReviewCta({ ...input, canConvertTasks: true, savedTaskCount: 3 });
            expect(cta.secondary.map(action => action.id)).toEqual([
                'review_prompts', 'convert_tasks', 'copy_plan',
            ]);
            expect(cta.secondary.every(action => action.kind === 'secondary')).toBe(true);
            // The primary is never one of the demoted three, in any state —
            // including when the packet is ready.
            expect(['review_prompts', 'convert_tasks', 'copy_plan']).not.toContain(cta.primary.id);
        });
    }

    it('omits convert-to-tasks when no entry point is wired', () => {
        const cta = deriveFinalReviewCta({ packet: packet() });
        expect(cta.secondary.map(action => action.id)).toEqual(['review_prompts', 'copy_plan']);
    });

    it('labels the task action with the saved count once tasks exist', () => {
        const cta = deriveFinalReviewCta({ packet: packet(), canConvertTasks: true, savedTaskCount: 4 });
        expect(cta.secondary.find(action => action.id === 'convert_tasks')?.label).toBe('Manage tasks (4)');
    });
});

describe('deriveFinalReviewCta — not ready', () => {
    it('counts N from the evaluator blocker list', () => {
        const cta = deriveFinalReviewCta({
            packet: packet({
                blockers: [blocker('b1', 'artifacts_present'), blocker('b2', 'api_contract')],
            }),
        });
        expect(cta.state).toBe('resolve_blockers');
        expect(cta.primary.id).toBe('resolve_blockers');
        expect(cta.primary.label).toBe('Resolve 2 blockers');
        expect(cta.blockerCount).toBe(2);
    });

    it('uses the singular form for one blocker', () => {
        const cta = deriveFinalReviewCta({ packet: packet({ blockers: [blocker('b1', 'first_slice')] }) });
        expect(cta.primary.label).toBe('Resolve 1 blocker');
    });

    it('states the evaluator summary as the rationale rather than inventing one', () => {
        const cta = deriveFinalReviewCta({
            packet: packet({ blockers: [blocker('b1', 'first_slice')], summary: '1 blocker must be resolved.' }),
        });
        expect(cta.rationale).toBe('1 blocker must be resolved.');
    });

    it('never promotes a build action just because an approval was recorded earlier', () => {
        // A packet that regressed after approval: blockers dominate.
        const cta = deriveFinalReviewCta({
            packet: packet({ blockers: [blocker('b1', 'sources_current')] }),
            manifest: manifest({ data_model: 'v-dm-2' }),
            approval: approvalFor(manifest()),
            canApprove: true,
            hasNextPrompt: true,
        });
        expect(cta.state).toBe('resolve_blockers');
        expect(cta.primary.id).toBe('resolve_blockers');
    });

    it('degrades to a blocker review label if the packet is incomplete with no itemised blocker', () => {
        const cta = deriveFinalReviewCta({ packet: packet({ isPacketComplete: false, blockers: [] }) });
        expect(cta.primary.label).toBe('Review packet blockers');
    });
});

describe('deriveFinalReviewCta — ready but not approved', () => {
    it('promotes the one genuine approval', () => {
        const cta = deriveFinalReviewCta({ packet: packet(), manifest: manifest(), canApprove: true });
        expect(cta.state).toBe('approve');
        expect(cta.primary).toMatchObject({ id: 'approve', label: 'Approve build packet', kind: 'primary' });
        expect(cta.primary.disabled).toBeUndefined();
    });

    it('disables the approval with a reason in a read-only project', () => {
        const cta = deriveFinalReviewCta({ packet: packet(), manifest: manifest(), canApprove: false });
        expect(cta.state).toBe('approve');
        expect(cta.primary.disabled).toBe(true);
        expect(cta.primary.disabledReason).toMatch(/read-only/);
        // Still exactly one primary — read-only never promotes a copy action.
        expect(PRIMARY_ONLY(cta)).toHaveLength(1);
    });

    it('does not ask for re-approval merely because recording the approval appended a plan version', () => {
        const cta = deriveFinalReviewCta({
            packet: packet(),
            manifest: manifest({ implementation_plan: 'v-plan-clone' }),
            approval: approvalFor(manifest()),
            canApprove: true,
            hasNextPrompt: true,
        });
        expect(cta.state).toBe('start_build');
        expect(cta.supersededApproval).toBe(false);
    });

    it('asks for re-approval when a recorded approval no longer covers the current versions', () => {
        const cta = deriveFinalReviewCta({
            packet: packet(),
            manifest: manifest({ data_model: 'v-dm-2' }),
            approval: approvalFor(manifest()),
            canApprove: true,
            hasNextPrompt: true,
        });
        expect(cta.state).toBe('approve');
        expect(cta.primary.label).toBe('Re-approve build packet');
        expect(cta.supersededApproval).toBe(true);
    });
});

describe('deriveFinalReviewCta — approved', () => {
    const approved = {
        packet: packet(),
        manifest: manifest(),
        approval: approvalFor(manifest()),
        canApprove: true,
    };

    it('promotes the first implementation prompt', () => {
        const cta = deriveFinalReviewCta({ ...approved, hasNextPrompt: true });
        expect(cta.state).toBe('start_build');
        expect(cta.primary).toMatchObject({ id: 'start_build', label: 'Copy first implementation prompt' });
    });

    it('says "next" once a prompt has already been copied', () => {
        const cta = deriveFinalReviewCta({ ...approved, hasNextPrompt: true, hasCopiedPrompt: true });
        expect(cta.primary.label).toBe('Copy next implementation prompt');
    });

    it('falls back to starting the first slice when there is no prompt left to copy', () => {
        const cta = deriveFinalReviewCta({ ...approved, hasNextPrompt: false });
        expect(cta.primary.label).toBe('Start first slice');
    });
});

describe('deriveFinalReviewCta — unavailable', () => {
    it('never promotes a copy action when readiness was not evaluated', () => {
        const cta = deriveFinalReviewCta({ hasNextPrompt: true, canConvertTasks: true });
        expect(cta.state).toBe('unavailable');
        expect(cta.primary.id).toBe('check_readiness');
        expect(cta.primary.disabled).toBe(true);
        expect(cta.blockerCount).toBe(0);
    });
});
