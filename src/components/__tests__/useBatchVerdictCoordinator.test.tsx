import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanningRecord } from '../../types';
import {
    deferBatchCandidate,
    recommendationBatchCandidate,
    type BatchVerdictCandidate,
    type BatchVerdictResult,
} from '../../lib/planning';
import { useProjectStore } from '../../store/projectStore';
import { useBatchVerdictCoordinator } from '../review/useBatchVerdictCoordinator';

const decision = (id: string): PlanningRecord => ({
    id,
    projectId: 'p1',
    type: 'decision',
    status: 'open',
    title: `${id} decision`,
    statement: `Choose ${id}`,
    decisionOptions: [
        { id: `${id}-recommended`, label: `${id} recommended answer` },
        { id: `${id}-other`, label: `${id} other answer` },
    ],
    recommendationDetail: {
        optionId: `${id}-recommended`,
        summary: `${id} recommended answer`,
        rationale: 'Best current fit',
        confidence: 'medium',
    },
    decisionOptionsProvenance: {
        authoredBy: 'synapse',
        model: 'strong',
        generatedAt: 1,
    },
    evidence: [],
    sourceFindingIds: [],
    createdBy: 'user',
    createdAt: 1,
    updatedAt: 1,
});

const candidates = (): BatchVerdictCandidate[] => (
    useProjectStore.getState().planningRecords.p1.map(record =>
        recommendationBatchCandidate(record)!,
    )
);

const changeRecommendationInStore = (recordId: string) => {
    useProjectStore.setState(state => ({
        planningRecords: {
            ...state.planningRecords,
            p1: state.planningRecords.p1.map(record => record.id === recordId
                ? {
                    ...record,
                    recommendationDetail: {
                        ...record.recommendationDetail!,
                        summary: 'Recommendation changed while the batch was running',
                    },
                }
                : record),
        },
    }));
};

const userVerdictEvents = (recordId: string) => (
    useProjectStore.getState().planningRecords.p1
        .find(record => record.id === recordId)
        ?.events?.filter(event => (
            event.actor === 'user'
            && ['option_selected', 'custom_answered', 'deferred'].includes(event.type)
        )) ?? []
);

beforeEach(() => {
    useProjectStore.setState({
        planningRecords: { p1: [decision('one'), decision('two')] },
        spineVersions: { p1: [] },
    });
});

describe('useBatchVerdictCoordinator', () => {
    it('keeps independent successes and prepares impact only after answered writes', async () => {
        const prepareImpact = vi.fn((recordId: string) => {
            if (recordId === 'one') changeRecommendationInStore('two');
        });
        const { result } = renderHook(() => useBatchVerdictCoordinator({
            projectId: 'p1',
            canWrite: true,
            prepareImpact,
        }));

        await act(async () => {
            await result.current.runBatch(candidates());
        });

        expect(result.current.result).toEqual({
            succeeded: ['one'],
            skipped: [{
                recordId: 'two',
                reason: 'The recommendation changed before it could be accepted.',
            }],
            failed: [],
        });
        expect(prepareImpact).toHaveBeenCalledTimes(1);
        expect(prepareImpact).toHaveBeenCalledWith('one');
        expect(userVerdictEvents('one')).toHaveLength(1);
        expect(userVerdictEvents('two')).toHaveLength(0);
    });

    it('records Later per record, blocks repeat submission, and does nothing read-only', async () => {
        let releaseImpact: (() => void) | undefined;
        const prepareImpact = vi.fn(() => new Promise<void>(resolve => {
            releaseImpact = resolve;
        }));
        const { result } = renderHook(() => useBatchVerdictCoordinator({
            projectId: 'p1',
            canWrite: true,
            prepareImpact,
        }));
        const recommendation = recommendationBatchCandidate(
            useProjectStore.getState().planningRecords.p1[0],
        )!;

        await act(async () => {
            const firstRun = result.current.runBatch([recommendation]);
            await Promise.resolve();
            await expect(result.current.runBatch([recommendation])).resolves.toBeUndefined();
            releaseImpact?.();
            await firstRun;
        });
        expect(userVerdictEvents('one')).toHaveLength(1);

        useProjectStore.setState({
            planningRecords: { p1: [decision('one'), decision('two')] },
        });
        const laterCandidates = useProjectStore.getState().planningRecords.p1.map(record =>
            deferBatchCandidate(record)!,
        );
        await act(async () => {
            await result.current.runBatch(laterCandidates);
        });
        expect(userVerdictEvents('one')).toHaveLength(1);
        expect(userVerdictEvents('two')).toHaveLength(1);
        expect(prepareImpact).toHaveBeenCalledTimes(1);

        const readOnly = renderHook(() => useBatchVerdictCoordinator({
            projectId: 'p1',
            canWrite: false,
            prepareImpact,
        }));
        await act(async () => {
            await expect(readOnly.result.current.runBatch(laterCandidates))
                .resolves.toBeUndefined();
        });
        expect(userVerdictEvents('one')).toHaveLength(1);
        expect(userVerdictEvents('two')).toHaveLength(1);
    });

    it('keeps a persisted verdict successful when optional impact preparation fails', async () => {
        const prepareImpact = vi.fn().mockRejectedValue(
            new Error('Impact service unavailable'),
        );
        const { result } = renderHook(() => useBatchVerdictCoordinator({
            projectId: 'p1',
            canWrite: true,
            prepareImpact,
        }));
        const candidate = recommendationBatchCandidate(
            useProjectStore.getState().planningRecords.p1[0],
        )!;

        await act(async () => {
            await result.current.runBatch([candidate]);
        });

        expect(result.current.result).toEqual({
            succeeded: ['one'],
            skipped: [],
            failed: [],
            impactPreviewFailures: [{
                recordId: 'one',
                reason: 'The verdict was recorded, but its optional plan-impact preview could not be prepared: Impact service unavailable',
            }],
        });
        expect(userVerdictEvents('one')).toHaveLength(1);
    });

    it('does not leak an old project run into a reused route instance', async () => {
        useProjectStore.setState(state => ({
            planningRecords: {
                ...state.planningRecords,
                p2: [{ ...decision('three'), projectId: 'p2' }],
            },
        }));
        let releaseOld: (() => void) | undefined;
        const prepareImpact = vi.fn((recordId: string) => (
            recordId === 'one'
                ? new Promise<void>(resolve => { releaseOld = resolve; })
                : Promise.resolve()
        ));
        const { result, rerender } = renderHook(
            ({ projectId }) => useBatchVerdictCoordinator({
                projectId,
                canWrite: true,
                prepareImpact,
            }),
            { initialProps: { projectId: 'p1' } },
        );
        let oldRun: Promise<BatchVerdictResult | undefined>;
        await act(async () => {
            oldRun = result.current.runBatch([
                recommendationBatchCandidate(
                    useProjectStore.getState().planningRecords.p1[0],
                )!,
            ]);
            await Promise.resolve();
        });

        rerender({ projectId: 'p2' });
        expect(result.current.busy).toBe(false);
        expect(result.current.result).toBeUndefined();
        await act(async () => {
            await result.current.runBatch([
                recommendationBatchCandidate(
                    useProjectStore.getState().planningRecords.p2[0],
                )!,
            ]);
        });
        expect(result.current.result?.succeeded).toEqual(['three']);

        await act(async () => {
            releaseOld?.();
            await oldRun!;
        });
        expect(result.current.result?.succeeded).toEqual(['three']);
    });
});
