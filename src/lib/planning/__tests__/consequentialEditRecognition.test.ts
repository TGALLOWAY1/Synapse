import { describe, expect, it } from 'vitest';
import type { PlanningRecord, StructuredPRD } from '../../../types';
import {
    analyzeConsequentialPrdEdit,
    recordConsequentialPrdEdit,
} from '../consequentialEditRecognition';

const prd = (overrides: Partial<StructuredPRD> = {}): StructuredPRD => ({
    vision: 'Help teams coordinate projects.',
    targetUsers: ['Enterprise administrators'],
    coreProblem: 'Teams lose context when work is fragmented.',
    features: [{
        id: 'collab', name: 'Shared workspaces', description: 'Teams collaborate in one workspace.',
        userValue: 'Everyone sees the current plan.', complexity: 'medium', tier: 'mvp',
    }],
    architecture: 'Cloud-synchronized web application.',
    risks: ['Adoption'],
    constraints: ['Projects require an account'],
    ...overrides,
});

let nextId = 0;
const idFactory = () => `id-${++nextId}`;

describe('analyzeConsequentialPrdEdit', () => {
    it('keeps punctuation, casing, and small copy cleanup quiet', () => {
        const result = analyzeConsequentialPrdEdit(prd(), prd({
            vision: 'Help teams coordinate projects',
            coreProblem: 'Teams lose context when their work is fragmented.',
        }));

        expect(result.classification).toBe('copy_edit');
        expect(result.changes).toEqual([]);
    });

    it('recognizes a structured primary-user change as an explicit high-confidence change', () => {
        const result = analyzeConsequentialPrdEdit(prd(), prd({ targetUsers: ['Independent creators'] }));

        expect(result.classification).toBe('meaning_changed');
        expect(result.confidence).toBe('high');
        expect(result.changes).toEqual([
            expect.objectContaining({
                key: 'targetUsers',
                authority: 'explicit_user_change',
                before: 'Enterprise administrators',
                after: 'Independent creators',
            }),
        ]);
        expect(result.affectedPrdSections).toContain('Jobs to Be Done');
        expect(result.affectedArtifactSlots).toContain('screen_inventory');
        expect(result.affectedPlanLocations).toContainEqual(expect.objectContaining({
            kind: 'claim', section: 'Target Users', jsonPath: '$.targetUsers',
        }));
        expect(result.affectedPlanLocations).toContainEqual(expect.objectContaining({
            kind: 'flow_step', section: 'UX Pages', jsonPath: '$.uxPages',
        }));
    });

    it('flags cloud-to-local prose as a bounded inference rather than a user-confirmed interpretation', () => {
        const result = analyzeConsequentialPrdEdit(prd(), prd({ architecture: 'Local-only desktop application.' }));

        expect(result.classification).toBe('possibly_consequential');
        expect(result.changes[0]).toMatchObject({
            section: 'architecture',
            confidence: 'medium',
            authority: 'synapse_inference',
        });
    });

    it('recognizes scope removal but ignores an empty feature placeholder and confirmation metadata', () => {
        const removed = analyzeConsequentialPrdEdit(prd(), prd({ features: [] }));
        expect(removed.changes).toContainEqual(expect.objectContaining({
            key: 'feature:collab:scope',
            authority: 'explicit_user_change',
        }));

        const placeholder = {
            id: 'new', name: 'New Feature', description: '', userValue: '', complexity: 'medium' as const,
        };
        expect(analyzeConsequentialPrdEdit(prd({ features: [] }), prd({ features: [placeholder] })).classification)
            .toBe('copy_edit');

        const completedPlaceholder = { ...placeholder, name: 'Offline capture', description: 'Capture work without a connection.' };
        expect(analyzeConsequentialPrdEdit(prd({ features: [placeholder] }), prd({ features: [completedPlaceholder] })).changes)
            .toContainEqual(expect.objectContaining({
                key: 'feature:new:scope', authority: 'explicit_user_change', classification: 'meaning_changed',
            }));

        const confirmed = prd({ features: [{ ...prd().features[0], confirmed: true, confirmedAt: 10 }] });
        expect(analyzeConsequentialPrdEdit(prd(), confirmed).classification).toBe('copy_edit');
    });

    it('recognizes explicit success-criteria changes as consequential requirements', () => {
        const beforeFeature = { ...prd().features[0], successCriteria: ['A shared project opens'] };
        const afterFeature = { ...beforeFeature, successCriteria: ['A shared project opens in under two seconds'] };
        const result = analyzeConsequentialPrdEdit(
            prd({ features: [beforeFeature] }),
            prd({ features: [afterFeature] }),
        );

        expect(result.changes).toContainEqual(expect.objectContaining({
            key: 'feature:collab:successCriteria',
            authority: 'explicit_user_change',
            affectedPlanLocations: expect.arrayContaining([
                expect.objectContaining({
                    kind: 'success_criterion',
                    entityId: 'collab',
                    jsonPath: '$.features.successCriteria',
                }),
            ]),
        }));
    });
});

describe('recordConsequentialPrdEdit', () => {
    it('records an exact structured edit as user-authored authority', () => {
        nextId = 0;
        const result = recordConsequentialPrdEdit({
            projectId: 'p1',
            sourceSpineVersionId: 's2',
            before: prd(),
            after: prd({ targetUsers: ['Independent creators'] }),
            existingRecords: [],
            at: 100,
            idFactory,
        });

        expect(result.records).toHaveLength(1);
        expect(result.records[0]).toMatchObject({
            type: 'decision',
            status: 'confirmed',
            createdBy: 'user',
            resolution: 'Independent creators',
            resultingSpineVersionId: 's2',
        });
        expect(result.records[0].affectedPlanLocations).toContainEqual(expect.objectContaining({
            section: 'Target Users', jsonPath: '$.targetUsers',
        }));
        expect(result.records[0].events?.map(event => [event.type, event.actor])).toEqual([
            ['created', 'user'],
            ['custom_answered', 'user'],
        ]);
    });

    it('keeps freeform meaning classification Synapse-authored and proposed', () => {
        nextId = 0;
        const result = recordConsequentialPrdEdit({
            projectId: 'p1', sourceSpineVersionId: 's2', before: prd(),
            after: prd({ architecture: 'Local-only desktop application.' }),
            existingRecords: [], at: 100, idFactory,
        });

        expect(result.records[0]).toMatchObject({
            status: 'proposed',
            createdBy: 'synapse',
            sourceState: 'current',
        });
        expect(result.records[0].events).toEqual([
            expect.objectContaining({ type: 'created', actor: 'synapse' }),
        ]);
    });

    it('appends a user revision to the stable structured-claim record', () => {
        nextId = 0;
        const first = recordConsequentialPrdEdit({
            projectId: 'p1', sourceSpineVersionId: 's2', before: prd(),
            after: prd({ targetUsers: ['Independent creators'] }),
            existingRecords: [], at: 100, idFactory,
        });
        const second = recordConsequentialPrdEdit({
            projectId: 'p1', sourceSpineVersionId: 's3',
            before: prd({ targetUsers: ['Independent creators'] }),
            after: prd({ targetUsers: ['Freelance designers'] }),
            existingRecords: first.records, at: 200, idFactory,
        });

        expect(second.records).toHaveLength(1);
        expect(second.records[0].id).toBe(first.records[0].id);
        expect(second.records[0].resolution).toBe('Freelance designers');
        expect(second.records[0].events?.at(-1)).toMatchObject({
            type: 'revised', actor: 'user', answer: 'Freelance designers',
        });
    });

    it('creates a separate machine-authored conflict without revising the earlier user decision', () => {
        nextId = 0;
        const existing: PlanningRecord = {
            id: 'existing-decision', projectId: 'p1', type: 'decision', status: 'confirmed',
            title: 'Who is the primary user?', statement: 'Choose the primary audience',
            resolution: 'Enterprise administrators', evidence: [], sourceFindingIds: [], createdBy: 'user',
            createdAt: 1, updatedAt: 2, confirmedAt: 2,
            events: [{
                id: 'verdict', planningRecordId: 'existing-decision', type: 'custom_answered', actor: 'user', at: 2,
                answer: 'Enterprise administrators',
            }],
        };
        const result = recordConsequentialPrdEdit({
            projectId: 'p1', sourceSpineVersionId: 's2', before: prd(),
            after: prd({ targetUsers: ['Independent creators'] }),
            existingRecords: [existing], at: 100, idFactory,
        });

        expect(result.records.find(record => record.id === 'existing-decision')?.resolution)
            .toBe('Enterprise administrators');
        const conflict = result.records.find(record => record.type === 'conflict');
        expect(conflict).toMatchObject({ status: 'open', createdBy: 'synapse' });
        expect(conflict?.relatedPlanningRecordIds).toContain('existing-decision');
        expect(result.recognition.possibleConflictRecordIds).toEqual([conflict?.id]);
    });
});
