import { describe, expect, it } from 'vitest';
import type { StructuredPRD } from '../../../types';
import { importPrdAssumptions } from '../assumptionImport';

const prd = (statement = 'Users accept email verification'): StructuredPRD => ({
    vision: 'v', targetUsers: [], coreProblem: 'p', features: [], architecture: 'a', risks: [],
    assumptions: [{ id: 'a1', statement, confidence: 'med' }],
});

describe('lazy PRD assumption import', () => {
    it('is idempotent across spine versions and wording changes', () => {
        const first = importPrdAssumptions({
            projectId: 'p1', sourceSpineVersionId: 's1', structuredPRD: prd(), existingRecords: [], now: () => 10,
        });
        expect(first.imported).toHaveLength(1);
        expect(first.imported[0]).toMatchObject({ createdBy: 'migration', status: 'open', schemaVersion: 1 });

        const second = importPrdAssumptions({
            projectId: 'p1', sourceSpineVersionId: 's2', structuredPRD: prd('Reworded by retry'),
            existingRecords: first.records, now: () => 20,
        });
        expect(second.imported).toHaveLength(0);
        expect(second.existing).toHaveLength(1);
        expect(second.records[0].statement).toBe('Users accept email verification');
        expect(second.records[0]).toMatchObject({
            sourceState: 'changed',
            currentSourceStatement: 'Reworded by retry',
        });
        expect(second.records[0].events).toHaveLength(1);
    });

    it('marks a durable record when its source assumption disappears', () => {
        const first = importPrdAssumptions({
            projectId: 'p1', sourceSpineVersionId: 's1', structuredPRD: prd(), existingRecords: [], now: () => 10,
        });
        const withoutAssumptions = prd();
        withoutAssumptions.assumptions = [];
        const next = importPrdAssumptions({
            projectId: 'p1', sourceSpineVersionId: 's2', structuredPRD: withoutAssumptions,
            existingRecords: first.records, now: () => 20,
        });
        expect(next.records[0].sourceState).toBe('missing');
        expect(next.records[0].events).toEqual(first.records[0].events);
    });

    it('refreshes planning context without replacing the durable statement or history', () => {
        const initial = prd();
        initial.assumptions![0] = {
            ...initial.assumptions![0],
            materiality: 'normal',
            affectedPrdSections: ['vision'],
        };
        const first = importPrdAssumptions({
            projectId: 'p1', sourceSpineVersionId: 's1', structuredPRD: initial,
            existingRecords: [], now: () => 10,
        });
        const revised = prd();
        revised.assumptions![0] = {
            ...revised.assumptions![0],
            materiality: 'blocking',
            affectedPrdSections: ['coreProblem', 'features'],
        };
        const next = importPrdAssumptions({
            projectId: 'p1', sourceSpineVersionId: 's2', structuredPRD: revised,
            existingRecords: first.records, now: () => 20,
        });
        expect(next.updated).toHaveLength(1);
        expect(next.records[0]).toMatchObject({
            statement: 'Users accept email verification',
            materiality: 'blocking',
            affectedPrdSections: ['coreProblem', 'features'],
        });
        expect(next.records[0].events).toEqual(first.records[0].events);
    });

    it('brings preflight assumptions and unknowns into the same durable queue', () => {
        const result = importPrdAssumptions({
            projectId: 'p1', sourceSpineVersionId: 's1', structuredPRD: prd(), existingRecords: [], now: () => 10,
            preflightSession: {
                mode: 'quick', originalIdea: 'idea', questions: [], currentQuestionIndex: 0,
                status: 'completed', completed: true,
                assumptions: ['The buyer and daily user are the same person'],
                unknowns: ['Which outcome makes the first release successful?'],
            },
        });
        expect(result.records.map(record => record.type)).toEqual(['assumption', 'open_question', 'assumption']);
        expect(result.records.filter(record => record.sources?.[0].sourceType === 'preflight')).toHaveLength(2);
        expect(result.records.filter(record => record.sources?.[0].sourceType === 'preflight').every(record =>
            record.events?.every(event => event.actor !== 'user'),
        )).toBe(true);
    });

    it('skips malformed assumptions without disturbing existing records', () => {
        const malformed = prd();
        malformed.assumptions = [{ id: '', statement: '', confidence: 'low' }];
        const result = importPrdAssumptions({
            projectId: 'p1', sourceSpineVersionId: 's1', structuredPRD: malformed,
            existingRecords: [], now: () => 10,
        });
        expect(result.records).toEqual([]);
    });

    it('imports a legacy user verdict but fabricates none for undecided assumptions', () => {
        const decided = prd();
        decided.assumptions = [
            { id: 'a1', statement: 'Email is required', confidence: 'high', decision: 'confirmed', decidedAt: 5 },
            { id: 'a2', statement: 'Teams need SSO', confidence: 'low' },
        ];
        const result = importPrdAssumptions({
            projectId: 'p1', sourceSpineVersionId: 's1', structuredPRD: decided,
            existingRecords: [], now: () => 10,
        });
        expect(result.records[0]).toMatchObject({ status: 'confirmed', confirmedAt: 5 });
        expect(result.records[0].events?.filter((event) => event.actor === 'user')).toHaveLength(1);
        expect(result.records[1].events?.filter((event) => event.actor === 'user')).toHaveLength(0);
    });
});
