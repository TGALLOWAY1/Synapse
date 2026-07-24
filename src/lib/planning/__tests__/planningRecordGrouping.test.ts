import { describe, expect, it } from 'vitest';
import type { PlanningRecord } from '../../../types';
import {
    derivePlanningRecordPresentation,
    type PlanningRecordPresentationEntry,
} from '../planningRecordGrouping';

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

const representedIds = (entries: PlanningRecordPresentationEntry[]): string[] =>
    entries.flatMap(entry => entry.kind === 'group' ? entry.recordIds : [entry.recordId]);

describe('derivePlanningRecordPresentation', () => {
    it('groups a shared critique cluster before considering PRD sections', () => {
        const entries = derivePlanningRecordPresentation([
            record('first', {
                sourceReviewIssueId: 'issue-1',
                affectedPrdSections: ['Target Users'],
            }),
            record('second', {
                sourceReviewIssueId: 'issue-1',
                affectedPrdSections: ['Architecture'],
            }),
        ]);

        expect(entries).toEqual([{
            kind: 'group',
            key: 'critique:issue-1',
            groupKind: 'critique_cluster',
            label: 'Decision first',
            recordIds: ['first', 'second'],
        }]);
    });

    it('groups exactly matching normalized sections without fuzzy text matching', () => {
        const entries = derivePlanningRecordPresentation([
            record('before'),
            record('target-one', { affectedPrdSections: ['  Target   Users '] }),
            record('target-two', { affectedPrdSections: ['target users'] }),
            record('similar-only', { affectedPrdSections: ['Target User Experience'] }),
        ]);

        expect(entries).toEqual([
            { kind: 'record', key: 'record:before', recordId: 'before' },
            {
                kind: 'group',
                key: 'prd-section:target%20users',
                groupKind: 'prd_section',
                label: 'Target Users',
                recordIds: ['target-one', 'target-two'],
            },
            { kind: 'record', key: 'record:similar-only', recordId: 'similar-only' },
        ]);
    });

    it('keeps multi-section records standalone unless one exact plan location is primary', () => {
        const entries = derivePlanningRecordPresentation([
            record('ambiguous', {
                affectedPrdSections: ['Target Users', 'Architecture'],
                sources: [{
                    key: 'source:ambiguous',
                    sourceType: 'prd',
                    sourceId: 'source-1',
                    locator: { section: 'Target Users' },
                }],
            }),
            record('primary-one', {
                affectedPlanLocations: [{
                    kind: 'claim',
                    section: 'Target Users',
                    label: 'Primary user',
                }],
                affectedPrdSections: ['Target Users', 'Architecture'],
            }),
            record('primary-two', { affectedPrdSections: ['target users'] }),
        ]);

        expect(entries).toEqual([
            { kind: 'record', key: 'record:ambiguous', recordId: 'ambiguous' },
            {
                kind: 'group',
                key: 'prd-section:target%20users',
                groupKind: 'prd_section',
                label: 'Target Users',
                recordIds: ['primary-one', 'primary-two'],
            },
        ]);
    });

    it('uses one source locator only as a final section fallback', () => {
        const source = (section: string) => [{
            key: `source:${section}`,
            sourceType: 'prd' as const,
            sourceId: section,
            locator: { section },
        }];
        const entries = derivePlanningRecordPresentation([
            record('source-one', { sources: source('Scope') }),
            record('source-two', { sources: source(' scope ') }),
        ]);

        expect(entries[0]).toMatchObject({
            kind: 'group',
            groupKind: 'prd_section',
            label: 'Scope',
            recordIds: ['source-one', 'source-two'],
        });
    });

    it('emits groups only for two or more records and represents every record once in input order', () => {
        const records = [
            record('one', { affectedPrdSections: ['Scope'] }),
            record('two'),
            record('three', { sourceReviewIssueId: 'issue-3' }),
            record('four', { affectedPrdSections: ['Scope'] }),
            record('five', { sourceReviewIssueId: 'issue-3' }),
            record('six', { affectedPrdSections: ['Architecture'] }),
        ];

        const entries = derivePlanningRecordPresentation(records);

        expect(entries).toEqual([
            expect.objectContaining({ kind: 'group', recordIds: ['one', 'four'] }),
            { kind: 'record', key: 'record:two', recordId: 'two' },
            expect.objectContaining({ kind: 'group', recordIds: ['three', 'five'] }),
            { kind: 'record', key: 'record:six', recordId: 'six' },
        ]);
        expect(new Set(representedIds(entries)).size).toBe(records.length);
        expect(representedIds(entries).slice().sort()).toEqual(records.map(item => item.id).sort());
        expect(entries.at(-1)).toEqual({
            kind: 'record',
            key: 'record:six',
            recordId: 'six',
        });
    });
});
