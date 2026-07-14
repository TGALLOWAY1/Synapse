import type { StructuredPRD } from '../../../../types';
import type { ComplexTargetReasoningInput } from '../../complexTargetReasoning';

export const creatorWorkspacePrd: StructuredPRD = {
    vision: 'Help independent creators turn rough ideas into executable product plans.',
    targetUsers: ['Independent creators'],
    coreProblem: 'Creators build too early because product uncertainty remains hidden.',
    features: [{
        id: 'planning',
        name: 'Guided planning',
        description: 'Develop and challenge a working product plan.',
        userValue: 'Reach a buildable plan before spending implementation effort.',
        complexity: 'high',
        tier: 'mvp',
        successCriteria: ['A creator can commit a coherent plan without inviting another user.'],
    }],
    architecture: 'A local-first web application with optional encrypted cloud backup.',
    risks: ['Solo creators may defer important validation.'],
    constraints: ['The first release must work without team administration.'],
    userLoops: [{
        name: 'Planning loop',
        trigger: 'A creator has an uncertain product idea.',
        action: 'Invite teammates and co-edit a shared requirements workspace.',
        systemResponse: 'Synapse records decisions and highlights unresolved dependencies.',
        reward: 'The plan becomes more coherent.',
        retentionMechanic: 'Return when new evidence changes a decision.',
    }],
    uxPages: [{
        id: 'workspace',
        name: 'Planning workspace',
        purpose: 'Coordinate a team around a shared plan.',
        components: ['PRD', 'Decision Center'],
        interactions: ['Resolve a decision', 'Review affected content'],
    }],
    richDataModel: {
        entities: [{
            name: 'Workspace',
            description: 'A team-owned container for plans and members.',
            fields: [{ name: 'ownerId', type: 'string', required: true }],
            constraints: ['Every workspace must have at least one member.'],
        }],
    },
    architectureFlows: [{
        name: 'Plan persistence',
        steps: ['Save locally', 'Synchronize to the shared cloud workspace'],
    }],
};

export const creatorWorkspaceReasoningInput: ComplexTargetReasoningInput = {
    baselineSpineVersionId: 'spine-creators-v2',
    structuredPRD: creatorWorkspacePrd,
    cause: {
        id: 'decision-solo-first',
        kind: 'decision',
        summary: 'The first release is for independent creators and excludes collaboration.',
        answer: 'Ship a single-user first release; defer team workspaces.',
        planningRecordId: 'decision-solo-first',
        decisionEventId: 'decision-solo-first-verdict',
        sourceSpineVersionId: 'spine-creators-v2',
    },
    targets: [
        {
            id: 'planning-loop',
            location: {
                kind: 'flow_step',
                section: 'User Loops',
                label: 'Planning loop',
                jsonPath: '$.userLoops',
            },
        },
        {
            id: 'workspace-data',
            location: {
                kind: 'data_expectation',
                section: 'Data Model',
                label: 'Workspace ownership',
                jsonPath: '$.richDataModel',
            },
        },
        {
            id: 'architecture-consequence',
            location: {
                kind: 'claim',
                section: 'Architecture',
                label: 'Architecture approach',
                jsonPath: '$.architecture',
            },
        },
    ],
    evidence: [{
        id: 'evidence:first-release-constraint',
        sourceType: 'prd',
        sourceId: 'spine-creators-v2',
        excerpt: 'The first release must work without team administration.',
        location: {
            kind: 'constraint',
            section: 'Constraints',
            label: 'First-release constraint',
            jsonPath: '$.constraints[0]',
        },
    }],
};
