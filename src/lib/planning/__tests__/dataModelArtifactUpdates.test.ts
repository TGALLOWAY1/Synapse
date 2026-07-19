import { describe, expect, it } from 'vitest';
import type { ArtifactVersion } from '../../../types';
import { hashReviewValue } from '../../review/hash';
import {
    sealDownstreamArtifactUpdateReviewEvent,
    validateDownstreamArtifactUpdateProposalIntegrity,
} from '../downstreamArtifactUpdateProposal';
import { sealDownstreamUpdatePlan, type DownstreamUpdatePlan, type DownstreamUpdatePlanItem } from '../downstreamUpdatePlan';
import {
    applyDataModelArtifactUpdate,
    deriveDataModelArtifactUpdateProposal,
    parseUserGroundedDataModelChange,
} from '../dataModelArtifactUpdates';

const directEvidence = [{
    id: 'e1', kind: 'structured_trace' as const, quality: 'direct' as const,
    summary: 'The exact data region explicitly traces to the removed feature.',
}];

function version(content: string): ArtifactVersion {
    return {
        id: 'data-v1', artifactId: 'data', versionNumber: 1, parentVersionId: null, content,
        metadata: { manual: 'preserve' }, sourceRefs: [], generationPrompt: 'original', isPreferred: true, createdAt: 1,
    };
}

function planFor(artifactVersion: ArtifactVersion, item: DownstreamUpdatePlanItem): DownstreamUpdatePlan {
    return sealDownstreamUpdatePlan({
        schemaVersion: 1, id: 'plan-data', projectId: 'p1', authoredBy: 'synapse', createdAt: 10,
        source: {
            kind: 'planning_change', summary: 'Cloud synchronization was removed.', sourceSpineVersionId: 'spine-1',
            targetSpineVersionId: 'spine-2', targetSpineContentHash: 'spine-hash', planningContextHash: 'context-hash',
            planningRecordId: 'decision-1', planningEventId: 'event-1', confirmed: true,
        },
        artifact: {
            artifactId: artifactVersion.artifactId, artifactVersionId: artifactVersion.id,
            artifactContentHash: hashReviewValue(artifactVersion.content), slot: 'data_model', title: 'Data model',
        },
        items: [item], preservedArtifactSummary: 'Everything outside the exact member remains unchanged.',
    });
}

function approved(proposal: ReturnType<typeof deriveDataModelArtifactUpdateProposal> & { ok: true }, plan: DownstreamUpdatePlan) {
    return sealDownstreamArtifactUpdateReviewEvent({
        schemaVersion: 1, id: 'review', projectId: 'p1', proposalId: proposal.proposal.id, actor: 'user', at: 30,
        expectedProposalIntegrityHash: proposal.proposal.integrityHash,
        expectedPlanIntegrityHash: plan.integrityHash,
        expectedItemIntegrityHash: proposal.proposal.updatePlanBinding.itemIntegrityHash,
        expectedRegionContentHash: proposal.proposal.currentRegionContentHash,
        action: 'accepted',
    });
}

describe('data-model selective update proposals', () => {
    it('removes one exact sync field while preserving unrelated entity markdown byte-for-byte', () => {
        const unrelated = `## PersonalPreference
Manual description and formatting stay exact.

| Field | Type | Required | Description |
|---|---|---|---|
| theme | string | No | Selected theme |
`;
        const content = `# Data Model

## SyncCursor
Tracks obsolete cloud synchronization.

| Field | Type | Required | Description |
|---|---|---|---|
| cloud_sync_id | string | No | Cloud cursor |
| local_id | string | Yes | Local record |

${unrelated}`;
        const artifactVersion = version(content);
        const item: DownstreamUpdatePlanItem = {
            id: 'sync-field', region: { kind: 'data_model', entityName: 'SyncCursor', aspect: 'field', memberName: 'cloud_sync_id' },
            currentInterpretation: 'Cloud cursor remains stored.', whyAffected: 'Removed feature: Cloud synchronization.', certainty: 'definite',
            evidence: directEvidence, recommendedAction: 'review_field', recommendation: 'Remove only the obsolete field.',
            preservedScope: ['Entity: PersonalPreference'], recommendedPriority: 1, implementationCritical: true,
        };
        const plan = planFor(artifactVersion, item);
        const derived = deriveDataModelArtifactUpdateProposal({ projectId: 'p1', plan, item, artifactVersion, createdAt: 20 });
        expect(derived.ok).toBe(true);
        if (!derived.ok) return;
        expect(derived.proposal).toMatchObject({ operation: 'remove', dataModelImpact: { automaticApplicationBlocked: false } });
        const applied = applyDataModelArtifactUpdate({ proposal: derived.proposal, review: approved(derived, plan), artifactVersion });
        expect(applied.ok).toBe(true);
        if (!applied.ok) return;
        expect(applied.content).not.toContain('cloud_sync_id');
        expect(applied.content).toContain('| local_id | string | Yes | Local record |');
        expect(applied.content.split('## PersonalPreference')[1]).toBe(content.split('## PersonalPreference')[1]);
    });

    it('blocks relationship deletion when both endpoints and dependent fields are present', () => {
        const content = `# Data Model

## WorkspaceMembership
Connects workspaces and members.

| Field | Type | Required | Description |
|---|---|---|---|
| workspace_id | string | Yes | Workspace endpoint |
| member_id | string | Yes | Member endpoint |

> [!RELATIONSHIP] Workspace has many members through WorkspaceMembership

## AuditLog
Unrelated manual history.
`;
        const artifactVersion = version(content);
        const member = 'Workspace has many members through WorkspaceMembership';
        const item: DownstreamUpdatePlanItem = {
            id: 'membership', region: { kind: 'data_model', entityName: 'WorkspaceMembership', aspect: 'relationship', memberName: member },
            currentInterpretation: member, whyAffected: 'Removed feature: Team collaboration.', certainty: 'definite',
            evidence: directEvidence, recommendedAction: 'review_relationship', recommendation: 'Review removal.',
            preservedScope: ['Entity: AuditLog'], recommendedPriority: 1, implementationCritical: true,
        };
        const plan = planFor(artifactVersion, item);
        const derived = deriveDataModelArtifactUpdateProposal({ projectId: 'p1', plan, item, artifactVersion, createdAt: 20 });
        expect(derived.ok).toBe(true);
        if (!derived.ok) return;
        expect(derived.proposal.operation).toBe('review_only');
        expect(derived.proposal.dataModelImpact?.relationshipEndpoints).toEqual(expect.arrayContaining(['WorkspaceMembership', 'Workspace', 'member']));
        expect(derived.proposal.dataModelImpact?.dependencies.map(item => item.label)).toEqual(expect.arrayContaining([
            'WorkspaceMembership.workspace_id', 'WorkspaceMembership.member_id',
        ]));
        expect(derived.proposal.dataModelImpact?.automaticApplicationBlocked).toBe(true);
    });

    it('blocks a markdown relationship removal for reciprocal, inbound-FK, and constraint dependencies in another entity', () => {
        const target = 'Workspace has many Memberships';
        const content = `# Data Model

## Workspace
Owns collaborative work.

| Field | Type | Required | Description |
|---|---|---|---|
| id | string | Yes | Workspace id |

> [!RELATIONSHIP] ${target}

## Membership
Joins a user to a workspace.

| Field | Type | Required | Description |
|---|---|---|---|
| workspace_id | string | Yes | Inbound workspace reference |
| user_id | string | Yes | Member identity |

> [!RELATIONSHIP] Membership belongs to Workspace
> [!CONSTRAINT] workspace_id must identify an existing Workspace
`;
        const artifactVersion = version(content);
        const item: DownstreamUpdatePlanItem = {
            id: 'workspace-memberships',
            region: { kind: 'data_model', entityName: 'Workspace', aspect: 'relationship', memberName: target },
            currentInterpretation: target, whyAffected: 'Removed feature: Team collaboration.', certainty: 'definite',
            evidence: directEvidence, recommendedAction: 'review_relationship', recommendation: 'Remove only if dependencies are handled.',
            preservedScope: [], recommendedPriority: 1, implementationCritical: true,
        };
        const plan = planFor(artifactVersion, item);
        const derived = deriveDataModelArtifactUpdateProposal({ projectId: 'p1', plan, item, artifactVersion, createdAt: 20 });
        expect(derived.ok).toBe(true);
        if (!derived.ok) return;
        expect(derived.proposal.operation).toBe('review_only');
        expect(derived.proposal.dataModelImpact?.relationshipEndpoints).toEqual(expect.arrayContaining(['Workspace', 'Membership']));
        expect(derived.proposal.dataModelImpact?.dependencies).toEqual(expect.arrayContaining([
            expect.objectContaining({ label: 'Membership.workspace_id', kind: 'field', certainty: 'direct' }),
            expect.objectContaining({ label: expect.stringContaining('Membership belongs to Workspace'), kind: 'relationship', certainty: 'direct' }),
            expect.objectContaining({ label: expect.stringContaining('workspace_id must identify'), kind: 'constraint' }),
        ]));
        expect(derived.proposal.dataModelImpact?.automaticApplicationBlocked).toBe(true);
    });

    it('blocks a legacy JSON relationship removal for inbound structured dependencies across entities', () => {
        const content = JSON.stringify({ entities: [
            {
                name: 'Workspace', description: 'Work area', fields: [{ name: 'id', type: 'string', required: true, description: 'Id' }],
                relationships: [{ type: 'has_many', target: 'Membership', description: 'Workspace members' }], constraints: [],
            },
            {
                name: 'Membership', description: 'Join',
                fields: [{ name: 'workspace_id', type: 'Workspace', required: true, description: 'Inbound owner' }],
                relationships: [{ type: 'belongs_to', target: 'Workspace', description: 'Reciprocal owner' }],
                constraints: ['workspace_id must reference Workspace'],
            },
        ] });
        const artifactVersion = version(content);
        const item: DownstreamUpdatePlanItem = {
            id: 'legacy-workspace-memberships',
            region: { kind: 'data_model', entityName: 'Workspace', aspect: 'relationship', memberName: 'Membership' },
            currentInterpretation: 'Workspace has many memberships.', whyAffected: 'Removed feature: Team collaboration.', certainty: 'definite',
            evidence: directEvidence, recommendedAction: 'review_relationship', recommendation: 'Review removal.',
            preservedScope: [], recommendedPriority: 1, implementationCritical: true,
        };
        const plan = planFor(artifactVersion, item);
        const derived = deriveDataModelArtifactUpdateProposal({ projectId: 'p1', plan, item, artifactVersion, createdAt: 20 });
        expect(derived.ok).toBe(true);
        if (!derived.ok) return;
        expect(derived.proposal.operation).toBe('review_only');
        expect(derived.proposal.dataModelImpact?.dependencies).toEqual(expect.arrayContaining([
            expect.objectContaining({ label: 'Membership.workspace_id', kind: 'field', certainty: 'direct' }),
            expect.objectContaining({ label: expect.stringContaining('Membership'), kind: 'relationship', certainty: 'direct' }),
            expect.objectContaining({ label: expect.stringContaining('workspace_id must reference Workspace'), kind: 'constraint' }),
        ]));
        expect(derived.proposal.dataModelImpact?.automaticApplicationBlocked).toBe(true);
    });

    it('applies an explicit user-grounded requiredness change without rewriting sibling JSON values', () => {
        const content = JSON.stringify({
            entities: [
                { name: 'User', description: 'Identity', fields: [
                    { name: 'email', type: 'string', required: false, description: 'Login email' },
                    { name: 'display_name', type: 'string', required: false, description: 'Manual profile copy' },
                ], relationships: [], constraints: [] },
                { name: 'Preference', description: 'untouched', fields: [], relationships: [], constraints: [] },
            ], manualMetadata: { owner: 'user' },
        });
        const artifactVersion = version(content);
        const item: DownstreamUpdatePlanItem = {
            id: 'email-required', region: { kind: 'data_model', entityName: 'User', aspect: 'field', memberName: 'email' },
            currentInterpretation: 'Email is optional.', whyAffected: 'Authentication requirements changed.', certainty: 'likely',
            evidence: directEvidence, recommendedAction: 'review_field', recommendation: 'Review requiredness.',
            preservedScope: ['User.display_name', 'Entity: Preference'], recommendedPriority: 1, implementationCritical: true,
        };
        const plan = planFor(artifactVersion, item);
        const context = JSON.stringify({
            changeKind: 'requiredness', memberKind: 'field',
            content: { name: 'email', type: 'string', required: true, description: 'Login email' },
        });
        const grounded = parseUserGroundedDataModelChange(context);
        const derived = deriveDataModelArtifactUpdateProposal({ projectId: 'p1', plan, item, artifactVersion, userGroundedChange: grounded, createdAt: 20 });
        expect(derived.ok).toBe(true);
        if (!derived.ok) return;
        expect(derived.proposal.operation).toBe('replace');
        const applied = applyDataModelArtifactUpdate({ proposal: derived.proposal, review: approved(derived, plan), artifactVersion });
        expect(applied.ok).toBe(true);
        if (!applied.ok) return;
        const before = JSON.parse(content);
        const after = JSON.parse(applied.content);
        expect(after.entities[0].fields[0].required).toBe(true);
        expect(after.entities[0].fields[1]).toEqual(before.entities[0].fields[1]);
        expect(after.entities[1]).toEqual(before.entities[1]);
        expect(after.manualMetadata).toEqual(before.manualMetadata);
    });

    it('keeps an unstructured legacy model review-only', () => {
        const artifactVersion = version('Legacy notes about tables and users.');
        const item: DownstreamUpdatePlanItem = {
            id: 'legacy', region: { kind: 'artifact_review', reason: 'legacy_provenance', label: 'Legacy model' },
            currentInterpretation: 'Legacy model.', whyAffected: 'Provenance is missing.', certainty: 'possible', evidence: [],
            recommendedAction: 'review_only', recommendation: 'Review manually.', preservedScope: ['All manual work'],
            recommendedPriority: 1, implementationCritical: false,
        };
        const plan = planFor(artifactVersion, item);
        const derived = deriveDataModelArtifactUpdateProposal({ projectId: 'p1', plan, item, artifactVersion, createdAt: 20 });
        expect(derived.ok && derived.proposal.operation).toBe('review_only');
        expect(derived.ok && derived.proposal.dataModelImpact).toBeUndefined();
    });

    it('keeps an authentication identity change review-only until exact user content exists', () => {
        const artifactVersion = version(`# Data Model

## User
Stores an authenticated identity.

| Field | Type | Required | Description |
|---|---|---|---|
| identity_provider | string | No | Authentication provider |
`);
        const item: DownstreamUpdatePlanItem = {
            id: 'auth-review', region: { kind: 'data_model', entityName: 'User', aspect: 'field', memberName: 'identity_provider' },
            currentInterpretation: 'Identity provider is optional.', whyAffected: 'Authentication requirements changed.', certainty: 'likely',
            evidence: directEvidence, recommendedAction: 'review_field', recommendation: 'Review the exact identity expectation.',
            preservedScope: [], recommendedPriority: 1, implementationCritical: true,
        };
        const plan = planFor(artifactVersion, item);
        const derived = deriveDataModelArtifactUpdateProposal({ projectId: 'p1', plan, item, artifactVersion, createdAt: 20 });
        expect(derived.ok && derived.proposal.operation).toBe('review_only');
    });

    it('seals dependency blockers and post-change identity against tampering', () => {
        const content = JSON.stringify({ entities: [{
            name: 'User', description: 'Identity', fields: [{ name: 'email', type: 'string', required: false, description: 'Email' }],
            relationships: [], constraints: [],
        }] });
        const artifactVersion = version(content);
        const item: DownstreamUpdatePlanItem = {
            id: 'rename', region: { kind: 'data_model', entityName: 'User', aspect: 'field', memberName: 'email' },
            currentInterpretation: 'Email.', whyAffected: 'Identity naming changed.', certainty: 'likely', evidence: directEvidence,
            recommendedAction: 'review_field', recommendation: 'Rename exactly.', preservedScope: [],
            recommendedPriority: 1, implementationCritical: true,
        };
        const plan = planFor(artifactVersion, item);
        const derived = deriveDataModelArtifactUpdateProposal({
            projectId: 'p1', plan, item, artifactVersion, createdAt: 20,
            userGroundedChange: {
                changeKind: 'rename', memberKind: 'field',
                content: JSON.stringify({ name: 'login_email', type: 'string', required: false, description: 'Email' }),
            },
        });
        expect(derived.ok).toBe(true);
        if (!derived.ok) return;
        expect(derived.proposal.resultingRegion).toMatchObject({ kind: 'data_model', memberName: 'login_email' });
        const applied = applyDataModelArtifactUpdate({ proposal: derived.proposal, review: approved(derived, plan), artifactVersion });
        expect(applied.ok).toBe(true);
        const tampered = {
            ...derived.proposal,
            dataModelImpact: { ...derived.proposal.dataModelImpact!, automaticApplicationBlocked: true },
        };
        expect(validateDownstreamArtifactUpdateProposalIntegrity(tampered)).toBe(false);
    });
});
