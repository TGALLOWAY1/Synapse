import { describe, expect, it } from 'vitest';
import type { PlanningRecord } from '../../types';
import { buildPlanningRecordViews } from '../review/planningRecordViews';

const record = (
    id: string,
    patch: Partial<PlanningRecord> = {},
): PlanningRecord => ({
    id,
    projectId: 'project-1',
    type: 'decision',
    status: 'open',
    title: `Decision ${id}`,
    statement: `Statement ${id}`,
    evidence: [],
    sourceFindingIds: [],
    createdBy: 'user',
    createdAt: 1,
    updatedAt: 1,
    ...patch,
});

describe('buildPlanningRecordViews presentation grouping', () => {
    it('threads critique-first derived grouping without changing per-record identity', () => {
        const views = buildPlanningRecordViews({
            planningRecords: [
                record('first', {
                    sourceReviewIssueId: 'issue-1',
                    affectedPrdSections: ['Scope'],
                }),
                record('second', {
                    sourceReviewIssueId: 'issue-1',
                    affectedPrdSections: ['Architecture'],
                }),
                record('standalone', {
                    affectedPrdSections: ['Scope', 'Architecture'],
                }),
            ],
            latestSpine: undefined,
            alignmentAnalysis: {},
        });

        expect(views.map(view => view.id)).toEqual(['first', 'second', 'standalone']);
        expect(views[0].presentationGroup).toEqual({
            key: 'critique:issue-1',
            kind: 'critique_cluster',
            label: 'Decision first',
        });
        expect(views[1].presentationGroup).toEqual(views[0].presentationGroup);
        expect(views[2].presentationGroup).toBeUndefined();
        expect(views[0].sourceIssueIds).toEqual(['issue-1']);
        expect(views[1].sourceIssueIds).toEqual(['issue-1']);
    });
});
