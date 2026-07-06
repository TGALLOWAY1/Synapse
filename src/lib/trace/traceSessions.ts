// Pure helpers for grouping traces into generation sessions and diffing two
// calls. No store / DOM / React imports — unit-tested.

import type { LlmTraceCall, LlmTraceSession } from './traceTypes';

// When calls don't carry an explicit sessionId, group consecutive calls that
// share a stage+project bucket within this idle gap into one session.
const IDLE_GAP_MS = 90_000;

const bucketKey = (call: LlmTraceCall): string =>
    call.meta.sessionId
        ? `sid:${call.meta.sessionId}`
        : `heur:${call.meta.stage ?? 'misc'}:${call.meta.projectId ?? 'none'}`;

const sessionLabel = (call: LlmTraceCall): string => {
    if (call.meta.sessionLabel) return call.meta.sessionLabel;
    const stage = call.meta.stage ?? 'LLM';
    const project = call.meta.projectName ?? call.meta.projectId;
    return project ? `${stage} · ${project}` : stage;
};

/**
 * Group a flat list of traces into sessions. Explicit `meta.sessionId` groups
 * deterministically; otherwise consecutive same-bucket calls within IDLE_GAP_MS
 * form a session. Returns sessions newest-first, calls within each oldest-first.
 */
export const groupIntoSessions = (calls: LlmTraceCall[]): LlmTraceSession[] => {
    const sorted = [...calls].sort((a, b) => a.createdAt - b.createdAt);
    const explicit = new Map<string, LlmTraceSession>();
    const sessions: LlmTraceSession[] = [];
    // Track the open heuristic session per bucket so a gap starts a new one.
    const openHeuristic = new Map<string, LlmTraceSession>();

    for (const call of sorted) {
        const key = bucketKey(call);
        const hasExplicit = Boolean(call.meta.sessionId);

        if (hasExplicit) {
            let s = explicit.get(key);
            if (!s) {
                s = {
                    id: key,
                    label: sessionLabel(call),
                    stage: call.meta.stage,
                    projectId: call.meta.projectId,
                    projectName: call.meta.projectName,
                    startedAt: call.createdAt,
                    endedAt: call.endedAt,
                    calls: [],
                };
                explicit.set(key, s);
                sessions.push(s);
            }
            s.calls.push(call);
            s.endedAt = Math.max(s.endedAt, call.endedAt);
            continue;
        }

        const open = openHeuristic.get(key);
        if (open && call.createdAt - open.endedAt <= IDLE_GAP_MS) {
            open.calls.push(call);
            open.endedAt = Math.max(open.endedAt, call.endedAt);
        } else {
            const s: LlmTraceSession = {
                id: `${key}:${call.createdAt}`,
                label: sessionLabel(call),
                stage: call.meta.stage,
                projectId: call.meta.projectId,
                projectName: call.meta.projectName,
                startedAt: call.createdAt,
                endedAt: call.endedAt,
                calls: [call],
            };
            openHeuristic.set(key, s);
            sessions.push(s);
        }
    }

    return sessions.sort((a, b) => b.startedAt - a.startedAt);
};

// ─── Filtering ─────────────────────────────────────────────────────────────────

export interface TraceFilter {
    text?: string;
    provider?: string;
    model?: string;
    stage?: string;
    artifact?: string;
    projectId?: string;
    onlyErrors?: boolean;
    onlyRetries?: boolean;
    minDurationMs?: number;
}

export const filterTraces = (calls: LlmTraceCall[], filter: TraceFilter): LlmTraceCall[] => {
    const text = filter.text?.trim().toLowerCase();
    return calls.filter((c) => {
        if (filter.provider && c.provider !== filter.provider) return false;
        if (filter.model && c.model !== filter.model) return false;
        if (filter.stage && c.meta.stage !== filter.stage) return false;
        if (filter.artifact && c.meta.artifact !== filter.artifact) return false;
        if (filter.projectId && c.meta.projectId !== filter.projectId) return false;
        if (filter.onlyErrors && c.status !== 'error') return false;
        if (filter.onlyRetries && (c.retryCount ?? 0) < 1) return false;
        if (typeof filter.minDurationMs === 'number' && c.durationMs < filter.minDurationMs) return false;
        if (text) {
            const hay = [
                c.meta.purpose,
                c.meta.artifact,
                c.meta.stage,
                c.model,
                c.provider,
                c.promptText,
                c.rawResponse,
                c.error,
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            if (!hay.includes(text)) return false;
        }
        return true;
    });
};

// ─── Diff ───────────────────────────────────────────────────────────────────────

export interface FieldDiff {
    field: string;
    a: string;
    b: string;
    changed: boolean;
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v ?? '', null, 2));

/** Compute a coarse field-by-field diff between two calls (for Diff Mode). */
export const diffCalls = (a: LlmTraceCall, b: LlmTraceCall): FieldDiff[] => {
    const rows: Array<[string, unknown, unknown]> = [
        ['Purpose', a.meta.purpose, b.meta.purpose],
        ['Model', a.model, b.model],
        ['Stage', a.meta.stage, b.meta.stage],
        ['System instruction', a.systemInstruction, b.systemInstruction],
        ['Prompt', a.promptText, b.promptText],
        ['Raw response', a.rawResponse, b.rawResponse],
        ['Finish reason', a.finishReason, b.finishReason],
        ['Status', a.status, b.status],
        ['Error', a.error, b.error],
    ];
    return rows.map(([field, av, bv]) => {
        const at = asText(av);
        const bt = asText(bv);
        return { field, a: at, b: bt, changed: at !== bt };
    });
};
