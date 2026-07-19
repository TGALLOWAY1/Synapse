import { describe, expect, it } from 'vitest';
import type { Artifact, ArtifactVersion, SpineVersion, StructuredPRD } from '../../../types';
import { deriveDownstreamUpdatePlans } from '../downstreamUpdatePlanGeneration';

const basePrd = (patch: Partial<StructuredPRD> = {}): StructuredPRD => ({
    vision: 'Help teams plan work.', coreProblem: 'Planning is fragmented.', targetUsers: ['Enterprise administrators'],
    architecture: 'Cloud synchronization keeps every workspace current.', risks: [],
    features: [{
        id: 'f1', name: 'Team collaboration', description: 'Invite members into shared workspaces with a team membership relationship.',
        userValue: 'Work together.', complexity: 'medium',
    }],
    ...patch,
});

const spine = (id: string, structuredPRD: StructuredPRD, isLatest: boolean): SpineVersion => ({
    id, projectId: 'p1', promptText: 'Plan', responseText: JSON.stringify(structuredPRD), createdAt: isLatest ? 2 : 1,
    isLatest, isFinal: isLatest, structuredPRD,
});

const artifact = (id: string, subtype: Artifact['subtype'], title: string): Artifact => ({
    id, projectId: 'p1', type: 'core_artifact', subtype, title, status: 'active', currentVersionId: `${id}-v1`,
    createdAt: 1, updatedAt: 1,
});

const version = (item: Artifact, content: string, sourceSpineId = 's1'): ArtifactVersion => ({
    id: `${item.id}-v1`, artifactId: item.id, versionNumber: 1, parentVersionId: null, content,
    metadata: {}, generationPrompt: '', isPreferred: true, createdAt: 1,
    sourceRefs: sourceSpineId ? [{
        id: `ref-${item.id}`, sourceArtifactId: 'p1', sourceArtifactVersionId: sourceSpineId, sourceType: 'spine',
    }] : [],
});

const screenContent = JSON.stringify({ sections: [{ title: 'Product', screens: [
    {
        id: 'shared-workspace', name: 'Shared workspace', priority: 'P0', purpose: 'Team collaboration workspace',
        featureRefs: ['f1'], states: [{ name: 'Syncing', description: 'Cloud synchronization is in progress.' }],
    },
    { id: 'settings', name: 'Personal settings', priority: 'P1', purpose: 'Manage local preferences', featureRefs: ['f9'] },
] }] });

const flowContent = `# User Flows
### Flow: Invite a teammate
**Related Features:** [f1]
**Goal:** Add a team member to a shared workspace.
**Steps:**
1. [Shared workspace] — User selects Invite → System opens membership form
   - **Decision:** If invitation succeeds → show member
2. [Shared workspace] — User submits member → System saves membership
**Success Outcome:** Team member joins.

### Flow: Update personal settings
**Related Features:** [f9]
**Goal:** Update a preference.
**Steps:**
1. [Settings] — User changes preference → System saves locally
**Success Outcome:** Preference saved.`;

const dataContent = `# Data Model
## WorkspaceMembership
Stores the team membership relationship used by collaboration.

**Purpose:** Connect members to shared workspaces.
**Related Features:** f1

**Key Product Fields**

| Field | Type | Required | Description |
|---|---|---|---|
| workspace_id | string | Yes | Shared workspace identifier |
| member_id | string | Yes | Team member identifier |

> [!RELATIONSHIP] Workspace has many members through WorkspaceMembership

## PersonalPreference
Stores unrelated local settings.

**Key Product Fields**

| Field | Type | Required | Description |
|---|---|---|---|
| theme | string | No | Selected theme |`;

const implementationPlanContent = `# Implementation Plan

\`\`\`json synapse-plan
${JSON.stringify({
        milestones: [{ id: 'm1', name: 'Foundation', tasks: [{ id: 't1', title: 'Build local editor', status: 'todo' }] }],
        architecture: [
            '[feature:f1] Authentication and permission boundary for shared workspaces.',
            'Local persistence for personal preferences.',
        ],
    }, null, 2)}
\`\`\``;

function derive(before: StructuredPRD, after: StructuredPRD, entries: Array<{ artifact: Artifact; content: string; source?: string }>) {
    return deriveDownstreamUpdatePlans({
        projectId: 'p1', artifacts: entries.map(entry => entry.artifact),
        artifactVersions: entries.map(entry => version(entry.artifact, entry.content, entry.source ?? 's1')),
        spineVersions: [spine('s1', before, false), spine('s2', after, true)], planningRecords: [], createdAt: 10,
    });
}

describe('bounded downstream update-plan generation', () => {
    it('scopes collaboration removal to traced screens and flow steps while preserving unrelated work', () => {
        const screens = artifact('screens', 'screen_inventory', 'Screens');
        const flows = artifact('flows', 'user_flows', 'User flows');
        const data = artifact('data', 'data_model', 'Data model');
        const unrelatedData = `# Data Model
## PersonalPreference
Stores local display choices.

**Key Product Fields**

| Field | Type | Required | Description |
|---|---|---|---|
| theme | string | No | Selected visual theme |`;
        const plans = derive(basePrd(), basePrd({ features: [] }), [
            { artifact: screens, content: screenContent },
            { artifact: flows, content: flowContent },
            { artifact: data, content: unrelatedData },
        ]);

        expect(plans.map(plan => plan.artifact.slot)).toEqual(['screen_inventory', 'user_flows']);
        const screenPlan = plans.find(plan => plan.artifact.slot === 'screen_inventory')!;
        expect(screenPlan.items).toHaveLength(1);
        expect(screenPlan.items[0]).toMatchObject({
            region: { kind: 'screen', screenId: 'shared-workspace' }, certainty: 'definite',
        });
        expect(screenPlan.items[0].preservedScope).toContain('Screen: Personal settings');
        const flowPlan = plans.find(plan => plan.artifact.slot === 'user_flows')!;
        expect(flowPlan.items[0]).toMatchObject({ region: { kind: 'flow', flowName: 'Invite a teammate' }, certainty: 'definite' });
        expect(flowPlan.items[0].preservedScope).toContain('Flow: Update personal settings');
    });

    it('identifies an obsolete data relationship without replacing the model', () => {
        const data = artifact('data', 'data_model', 'Data model');
        const [plan] = derive(basePrd(), basePrd({ features: [] }), [{ artifact: data, content: dataContent }]);
        expect(plan.items[0]).toMatchObject({
            region: { kind: 'data_model', entityName: 'WorkspaceMembership', aspect: 'relationship' },
            certainty: 'definite', recommendedAction: 'review_relationship',
        });
        expect(plan.items[0].preservedScope).toContain('Entity: PersonalPreference');
        expect(plan.preservedArtifactSummary).toContain('Only 1 identified region');
    });

    it('targets one explicitly traced architecture entry inside the structured implementation plan', () => {
        const implementation = artifact('implementation', 'implementation_plan', 'Implementation Plan');
        const [plan] = derive(basePrd(), basePrd({ features: [] }), [{ artifact: implementation, content: implementationPlanContent }]);
        expect(plan.artifact.slot).toBe('implementation_plan');
        expect(plan.items).toEqual([expect.objectContaining({
            region: expect.objectContaining({
                kind: 'implementation_plan', section: 'architecture', aspect: 'authentication', entryIndex: 0,
            }),
            certainty: 'definite',
            recommendedAction: 'review_architecture',
        })]);
        expect(plan.items[0].preservedScope).toContain('Architecture entry 2: Local persistence for personal preferences.');
    });

    it('keeps an architecture language match possible when no explicit trace proves a mismatch', () => {
        const implementation = artifact('implementation', 'implementation_plan', 'Implementation Plan');
        const ambiguous = implementationPlanContent.replace('[feature:f1] ', '');
        const [plan] = derive(basePrd(), basePrd({ features: [] }), [{ artifact: implementation, content: ambiguous }]);
        expect(plan.items[0]).toMatchObject({
            region: { kind: 'implementation_plan', section: 'architecture' },
            certainty: 'possible',
        });
        expect(plan.items[0].ambiguity).toContain('relevance, not proof');
    });

    it('keeps literal relevance possible rather than definite', () => {
        const screens = artifact('screens', 'screen_inventory', 'Screens');
        const withoutTrace = screenContent.replace('"featureRefs":["f1"]', '"featureRefs":[]');
        const [plan] = derive(basePrd(), basePrd({ features: [] }), [{ artifact: screens, content: withoutTrace }]);
        expect(plan.items[0]).toMatchObject({ certainty: 'possible' });
        expect(plan.items[0].ambiguity).toContain('relevance, not proof');
    });

    it('targets onboarding language after a primary-user change and leaves data untouched', () => {
        const screens = artifact('screens', 'screen_inventory', 'Screens');
        const data = artifact('data', 'data_model', 'Data model');
        const onboarding = JSON.stringify({ sections: [{ title: 'Start', screens: [{
            id: 'onboarding', name: 'Onboarding', priority: 'P0', purpose: 'Welcome enterprise administrators', featureRefs: [],
        }] }] });
        const plans = derive(basePrd(), basePrd({ targetUsers: ['Independent creators'] }), [
            { artifact: screens, content: onboarding }, { artifact: data, content: dataContent },
        ]);
        expect(plans).toHaveLength(1);
        expect(plans[0].artifact.slot).toBe('screen_inventory');
        expect(plans[0].items[0]).toMatchObject({ region: { kind: 'screen', screenId: 'onboarding', aspect: 'role' }, certainty: 'possible' });
    });

    it('scopes local-only changes to sync states and fields rather than entire artifacts', () => {
        const screens = artifact('screens', 'screen_inventory', 'Screens');
        const data = artifact('data', 'data_model', 'Data model');
        const syncData = dataContent.replace('| theme | string | No | Selected theme |', '| cloud_sync_id | string | No | Cloud synchronization cursor |');
        const plans = derive(basePrd(), basePrd({ architecture: 'Local-only storage with no synchronization.' }), [
            { artifact: screens, content: screenContent }, { artifact: data, content: syncData },
        ]);
        expect(plans.find(plan => plan.artifact.slot === 'screen_inventory')?.items[0].region).toMatchObject({ kind: 'screen', aspect: 'state' });
        expect(plans.find(plan => plan.artifact.slot === 'data_model')?.items.some(item => (
            item.region.kind === 'data_model' && item.region.aspect === 'field' && item.region.memberName === 'cloud_sync_id'
        ))).toBe(true);
    });

    it('uses one bounded possible review for legacy provenance instead of fabricating a region', () => {
        const screens = artifact('screens', 'screen_inventory', 'Legacy screens');
        const plans = deriveDownstreamUpdatePlans({
            projectId: 'p1', artifacts: [screens], artifactVersions: [version(screens, 'Legacy screen notes', '')],
            spineVersions: [spine('s2', basePrd({ features: [] }), true)], planningRecords: [], createdAt: 10,
        });
        expect(plans[0].items).toEqual([expect.objectContaining({
            region: { kind: 'artifact_review', reason: 'legacy_provenance', label: 'Legacy screens' }, certainty: 'possible',
        })]);
        expect(plans[0].items[0].preservedScope[0]).toContain('manual work remains preserved');
    });

    it('is deterministic for the same bound versions', () => {
        const screens = artifact('screens', 'screen_inventory', 'Screens');
        const first = derive(basePrd(), basePrd({ features: [] }), [{ artifact: screens, content: screenContent }]);
        const second = derive(basePrd(), basePrd({ features: [] }), [{ artifact: screens, content: screenContent }]);
        expect(second).toEqual(first);
    });
});
