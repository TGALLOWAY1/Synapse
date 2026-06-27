// Assembles a persisted WorkflowRun from a flat list of node observations.
//
// Both pipelines (PRD section DAG and the artifact-bundle controller) collect
// the same per-node facts — when each node started/ended, which model ran it,
// how many tokens it used, what it depended on — and hand them here. This is
// the single place that turns those facts into the aggregate orchestration
// metrics (speedup, concurrency, critical path, cost), so the PRD and artifact
// dashboards stay consistent by construction.

import { v4 as uuidv4 } from 'uuid';
import type { WorkflowNodeRun, WorkflowRun, WorkflowType } from '../../types';
import { estimateCost, providerForModel } from './modelPricing';
import {
    actualRuntimeMs,
    averageConcurrency,
    criticalPathMs,
    maxConcurrency,
    parallelTimeSavedMs,
    sequentialEstimateMs,
    speedupRatio,
} from './workflowMetrics';

/** Raw per-node observation supplied by a pipeline. Absolute epoch ms timings. */
export interface NodeObservation {
    nodeId: string;
    nodeName: string;
    agentName?: string;
    model: string;
    provider?: string;
    status: 'complete' | 'error';
    dependencyIds?: string[];
    parallelGroupId?: number;
    startedAt: number;
    completedAt: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    retryCount?: number;
    errorMessage?: string;
}

export interface BuildWorkflowRunInput {
    projectId: string;
    projectName?: string;
    workflowType: WorkflowType;
    /** Epoch ms when the overall run began (defaults to earliest node start). */
    startedAt?: number;
    /** Epoch ms when the overall run settled (defaults to latest node end). */
    completedAt?: number;
    nodes: NodeObservation[];
    metadata?: Record<string, unknown>;
}

/**
 * Assign each node a topological wave index (0 = no dependencies). Nodes that
 * share a level are dependency-eligible to run concurrently, which is exactly
 * what the "parallel group" column means in the dashboard. Used as a fallback
 * when a pipeline does not already supply parallelGroupId. Unknown deps are
 * ignored; cycles (shouldn't occur — the PRD graph is validated) resolve to 0.
 */
export function computeParallelGroups(
    nodes: Array<{ nodeId: string; dependencyIds?: string[] }>,
): Map<string, number> {
    const byId = new Map(nodes.map((n) => [n.nodeId, n] as const));
    const level = new Map<string, number>();
    const visiting = new Set<string>();

    const resolve = (id: string): number => {
        const cached = level.get(id);
        if (cached !== undefined) return cached;
        const node = byId.get(id);
        if (!node) return 0;
        if (visiting.has(id)) return 0;
        visiting.add(id);
        let max = -1;
        for (const dep of node.dependencyIds ?? []) {
            if (byId.has(dep)) max = Math.max(max, resolve(dep));
        }
        visiting.delete(id);
        const lvl = max + 1;
        level.set(id, lvl);
        return lvl;
    };

    for (const n of nodes) resolve(n.nodeId);
    return level;
}

function toNodeRun(obs: NodeObservation, fallbackGroup?: number): WorkflowNodeRun {
    const durationMs = Math.max(0, obs.completedAt - obs.startedAt);
    const inputTokens = obs.inputTokens;
    const outputTokens = obs.outputTokens;
    const totalTokens =
        obs.totalTokens ??
        (inputTokens !== undefined || outputTokens !== undefined
            ? (inputTokens ?? 0) + (outputTokens ?? 0)
            : undefined);
    const cost = estimateCost(obs.model, { inputTokens, outputTokens, totalTokens: totalTokens ?? 0 });
    return {
        id: uuidv4(),
        nodeId: obs.nodeId,
        nodeName: obs.nodeName,
        agentName: obs.agentName,
        provider: obs.provider ?? providerForModel(obs.model),
        model: obs.model,
        status: obs.status,
        dependencyIds: obs.dependencyIds ?? [],
        parallelGroupId: obs.parallelGroupId ?? fallbackGroup,
        startedAt: obs.startedAt,
        completedAt: obs.completedAt,
        durationMs,
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCost: cost,
        retryCount: obs.retryCount,
        errorMessage: obs.errorMessage,
    };
}

export function buildWorkflowRun(input: BuildWorkflowRunInput): WorkflowRun {
    const groups = computeParallelGroups(input.nodes);
    const nodes = input.nodes.map((obs) => toNodeRun(obs, groups.get(obs.nodeId)));

    const startedAt =
        input.startedAt ?? (nodes.length ? Math.min(...nodes.map((n) => n.startedAt)) : Date.now());
    const completedAt =
        input.completedAt ?? (nodes.length ? Math.max(...nodes.map((n) => n.completedAt)) : startedAt);

    const seqMs = sequentialEstimateMs(nodes);
    // Prefer the explicit run window when given, else derive from the node span.
    const actualMs = input.startedAt !== undefined && input.completedAt !== undefined
        ? Math.max(0, completedAt - startedAt)
        : actualRuntimeMs(nodes);

    const failureCount = nodes.filter((n) => n.status === 'error').length;
    const retryCount = nodes.reduce((sum, n) => sum + (n.retryCount ?? 0), 0);
    const totalInputTokens = nodes.reduce((sum, n) => sum + (n.inputTokens ?? 0), 0);
    const totalOutputTokens = nodes.reduce((sum, n) => sum + (n.outputTokens ?? 0), 0);
    const totalTokens = nodes.reduce((sum, n) => sum + (n.totalTokens ?? 0), 0);
    const estimatedCost = nodes.reduce((sum, n) => sum + (n.estimatedCost ?? 0), 0);
    const groupIds = new Set(
        nodes.map((n) => n.parallelGroupId).filter((g): g is number => g !== undefined),
    );

    const status: WorkflowRun['status'] =
        failureCount === 0 ? 'complete' : failureCount === nodes.length ? 'error' : 'partial';

    return {
        id: uuidv4(),
        projectId: input.projectId,
        projectName: input.projectName,
        workflowType: input.workflowType,
        status,
        startedAt,
        completedAt,
        actualRuntimeMs: actualMs,
        sequentialEstimateMs: seqMs,
        parallelTimeSavedMs: parallelTimeSavedMs(seqMs, actualMs),
        speedupRatio: speedupRatio(seqMs, actualMs),
        maxConcurrency: maxConcurrency(nodes),
        averageConcurrency: averageConcurrency(seqMs, actualMs),
        criticalPathMs: criticalPathMs(nodes),
        totalNodeRuntimeMs: seqMs,
        totalInputTokens,
        totalOutputTokens,
        totalTokens,
        estimatedCost,
        retryCount,
        failureCount,
        nodeCount: nodes.length,
        parallelGroupCount: groupIds.size,
        nodes,
        metadata: input.metadata,
    };
}
