import { useCallback, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { DecisionEvent } from '../../types';
import {
    revalidateBatchVerdictCandidate,
    type BatchVerdictCandidate,
    type BatchVerdictResult,
} from '../../lib/planning';
import { useProjectStore } from '../../store/projectStore';

const eventFor = (candidate: BatchVerdictCandidate): DecisionEvent => {
    const base = {
        id: uuidv4(),
        planningRecordId: candidate.recordId,
        actor: 'user' as const,
        at: Date.now(),
    };
    if (candidate.action === 'accept_recommendation') {
        return {
            ...base,
            type: 'option_selected',
            optionId: candidate.optionId,
            answer: candidate.answer,
        };
    }
    if (candidate.action === 'accept_default') {
        return {
            ...base,
            type: 'custom_answered',
            answer: candidate.answer,
        };
    }
    return { ...base, type: 'deferred' };
};

export function useBatchVerdictCoordinator(input: {
    projectId: string;
    canWrite: boolean;
    prepareImpact: (recordId: string) => void | Promise<void>;
}) {
    const { projectId, canWrite, prepareImpact } = input;
    const inFlightProjects = useRef(new Set<string>());
    const [ui, setUi] = useState<{
        projectId: string;
        runId?: symbol;
        busy: boolean;
        result?: BatchVerdictResult;
    }>({ projectId, busy: false });

    const runBatch = useCallback(async (candidates: BatchVerdictCandidate[]) => {
        if (!canWrite || inFlightProjects.current.has(projectId) || !candidates.length) return;
        const runId = Symbol(projectId);
        inFlightProjects.current.add(projectId);
        setUi({ projectId, runId, busy: true });
        const next: BatchVerdictResult = {
            succeeded: [],
            skipped: [],
            failed: [],
        };
        try {
            for (const candidate of candidates) {
                const record = useProjectStore.getState()
                    .planningRecords[projectId]
                    ?.find(item => item.id === candidate.recordId);
                const valid = revalidateBatchVerdictCandidate(record, candidate);
                if (!valid.ok) {
                    next.skipped.push({
                        recordId: candidate.recordId,
                        reason: valid.reason,
                    });
                    continue;
                }
                let saved: ReturnType<
                    ReturnType<typeof useProjectStore.getState>['appendPlanningDecisionEvent']
                >;
                try {
                    saved = useProjectStore.getState().appendPlanningDecisionEvent(
                        projectId,
                        candidate.recordId,
                        eventFor(candidate),
                        candidate,
                    );
                } catch (error) {
                    next.failed.push({
                        recordId: candidate.recordId,
                        reason: error instanceof Error ? error.message : String(error),
                    });
                    continue;
                }
                if (!saved.ok) {
                    (saved.code === 'stale_target' ? next.skipped : next.failed).push({
                        recordId: candidate.recordId,
                        reason: saved.reason,
                    });
                    continue;
                }
                next.succeeded.push(candidate.recordId);
                if (candidate.action !== 'defer') {
                    try {
                        await prepareImpact(candidate.recordId);
                    } catch (error) {
                        (next.impactPreviewFailures ??= []).push({
                            recordId: candidate.recordId,
                            reason: `The verdict was recorded, but its optional plan-impact preview could not be prepared: ${
                                error instanceof Error ? error.message : String(error)
                            }`,
                        });
                    }
                }
            }
            setUi(previous => (
                previous.projectId === projectId
                && previous.runId === runId
                    ? { projectId, runId, busy: true, result: next }
                    : previous
            ));
            return next;
        } finally {
            inFlightProjects.current.delete(projectId);
            setUi(previous => (
                previous.projectId === projectId && previous.runId === runId
                    ? { ...previous, busy: false }
                    : previous
            ));
        }
    }, [canWrite, prepareImpact, projectId]);

    const clearResult = useCallback(() => {
        setUi(previous => previous.projectId === projectId
            ? { ...previous, result: undefined }
            : previous);
    }, [projectId]);

    return {
        busy: ui.projectId === projectId && ui.busy,
        result: ui.projectId === projectId ? ui.result : undefined,
        runBatch,
        clearResult,
    };
}
