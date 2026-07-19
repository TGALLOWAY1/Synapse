import { useRef, useState } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { generateDecisionOptions, projectDecision } from '../../lib/planning';

/** Live machine-suggestion state per planning record id. Presence of an
 * error means the last attempt failed and a manual retry is offered. */
export type DecisionOptionSuggestionState = Record<string, { busy: boolean; error?: string }>;

/**
 * Prepares 2-3 machine-suggested alternatives for one unresolved decision or
 * open question. Advisory only; duplicate/late requests are ignored and a
 * verdict recorded meanwhile makes the guarded store write a no-op.
 */
export function useDecisionOptionSuggestions(params: { projectId: string; canWrite: boolean }) {
    const { projectId, canWrite } = params;
    const [optionSuggestions, setOptionSuggestions] = useState<DecisionOptionSuggestionState>({});
    const inFlight = useRef(new Set<string>());

    const prepareDecisionOptions = async (recordId: string) => {
        if (!canWrite) return;
        const state = useProjectStore.getState();
        const record = (state.planningRecords[projectId] ?? []).find(item => item.id === recordId);
        const spine = (state.spineVersions[projectId] ?? []).find(item => item.isLatest);
        if (!record || !spine?.structuredPRD) return;
        if (record.type !== 'decision' && record.type !== 'open_question') return;
        const projection = projectDecision(record);
        if (projection.status !== 'open' && projection.status !== 'proposed') return;
        if (record.decisionOptions?.length || inFlight.current.has(recordId)) return;
        inFlight.current.add(recordId);
        setOptionSuggestions(current => ({ ...current, [recordId]: { busy: true } }));
        const clear = () => setOptionSuggestions(current => {
            const next = { ...current };
            delete next[recordId];
            return next;
        });
        const failWith = (message: string) => setOptionSuggestions(current => ({
            ...current, [recordId]: { busy: false, error: message },
        }));
        try {
            const result = await generateDecisionOptions({
                baselineSpineVersionId: spine.id,
                record: {
                    id: record.id,
                    type: record.type,
                    title: record.title,
                    statement: record.statement,
                    whyItMatters: record.whyItMatters,
                    recommendation: record.recommendation,
                    evidence: record.evidence.flatMap(item => item.excerpt ? [{
                        label: item.locator?.section ?? item.artifactSubtype?.replaceAll('_', ' '),
                        excerpt: item.excerpt,
                    }] : []),
                },
                structuredPRD: spine.structuredPRD,
            });
            if (!result.ok) {
                if (result.reason === 'aborted') clear();
                else failWith(result.errors[0] ?? 'Synapse could not prepare trustworthy alternatives.');
                return;
            }
            const saved = useProjectStore.getState().setPlanningRecordDecisionOptions(projectId, recordId, {
                options: result.options,
                recommendation: result.recommendation,
                provenance: {
                    authoredBy: 'synapse',
                    model: result.model,
                    provider: 'gemini',
                    sourceSpineVersionId: spine.id,
                    generatedAt: Date.now(),
                },
            });
            if (saved.ok) clear();
            else failWith(saved.reason);
        } catch (error) {
            failWith(error instanceof Error ? error.message : String(error));
        } finally {
            inFlight.current.delete(recordId);
        }
    };

    return { optionSuggestions, prepareDecisionOptions };
}
