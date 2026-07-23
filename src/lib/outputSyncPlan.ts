import type { ArtifactSlotKey } from '../types';
import {
    computeUpdateOrder,
    expandSelectionWithTroubledUpstreams,
    type ArtifactDependencyGraph,
    type DependencyNodeEvaluation,
    type DependencyNodeId,
} from './artifactDependencyGraph';
import { DEPENDENCY_STATUS_LABELS } from './artifactFreshness';

export type OutputSyncChoice = 'update' | 'mark_current' | 'skip';

export interface CarefulSyncPlanRef {
    id: string;
    itemCount: number;
}

export interface OutputSyncRow {
    id: ArtifactSlotKey;
    artifactId?: string;
    title: string;
    statusLabel: string;
    /** Included in the canonical recommended update batch. */
    needsSync: boolean;
    /** True for source/dependency drift, including an impacted dependent. */
    isDrifted: boolean;
    changeHeadline?: string;
    likelyUnaffected?: boolean;
    manuallyEdited?: boolean;
    defaultChoice: OutputSyncChoice;
    canMarkCurrent: boolean;
    carefulSupported: boolean;
    carefulPlanId?: string;
    carefulItemCount?: number;
}

export interface BuildOutputSyncRowsInput {
    graph: ArtifactDependencyGraph;
    evaluations: Map<DependencyNodeId, DependencyNodeEvaluation>;
    artifactIdBySlot: Partial<Record<ArtifactSlotKey, string>>;
    recommendedUpdates: DependencyNodeId[];
    carefulPlansByArtifactId?: ReadonlyMap<string, CarefulSyncPlanRef>;
}

export interface OutputSyncExecutionPlan {
    markCurrent: ArtifactSlotKey[];
    regenerate: ArtifactSlotKey[];
    /**
     * Requested mark-current choices that are unsafe because a hard upstream
     * is being regenerated or a troubled upstream is left unresolved. They
     * remain flagged unless regeneration also needs them for another choice.
     */
    deferredMarkCurrent: ArtifactSlotKey[];
}

export type OutputSyncRunResult =
    | { status: 'stale' }
    | { status: 'blocked' }
    | { status: 'completed'; execution: OutputSyncExecutionPlan };

const CAREFUL_SLOTS = new Set<ArtifactSlotKey>([
    'screen_inventory',
    'user_flows',
    'data_model',
    'implementation_plan',
]);

const isArtifactSlot = (id: DependencyNodeId): id is ArtifactSlotKey => id !== 'prd';

export interface OutputSyncSessionSource {
    slot: ArtifactSlotKey;
    artifactId?: string;
    preferredVersionId?: string;
    preferredContent?: string;
    preferredMetadata?: Record<string, unknown>;
    sourceRefs?: ReadonlyArray<{
        sourceType: string;
        sourceArtifactId: string;
        sourceArtifactVersionId: string;
        anchorInfo?: string;
    }>;
}

const stableSerialize = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
    return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
        .join(',')}}`;
};

const digest = (value: unknown): string => {
    const text = stableSerialize(value);
    let left = 0x811c9dc5;
    let right = 0x9e3779b9;
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        left = Math.imul(left ^ code, 0x01000193);
        right = Math.imul(right ^ code, 0x85ebca6b);
    }
    return `${text.length}:${(left >>> 0).toString(16)}:${(right >>> 0).toString(16)}`;
};

/**
 * Bind a Sync-outputs session to the exact immutable inputs the choices were
 * made against. Sorting keeps this deterministic even if a source-ref array or
 * slot projection was assembled in a different iteration order.
 */
export function buildOutputSyncSessionFingerprint(input: {
    spineVersionId?: string;
    spineContent?: unknown;
    sources: ReadonlyArray<OutputSyncSessionSource>;
}): string {
    const sources = [...input.sources]
        .sort((a, b) => a.slot.localeCompare(b.slot))
        .map(source => ({
            slot: source.slot,
            artifactId: source.artifactId ?? null,
            preferredVersionId: source.preferredVersionId ?? null,
            preferredArtifactFingerprint: digest({
                content: source.preferredContent ?? null,
                metadata: source.preferredMetadata ?? null,
            }),
            sourceRefs: [...(source.sourceRefs ?? [])]
                .map(ref => ({
                    sourceType: ref.sourceType,
                    sourceArtifactId: ref.sourceArtifactId,
                    sourceArtifactVersionId: ref.sourceArtifactVersionId,
                    anchorInfo: ref.anchorInfo ?? null,
                }))
                .sort((a, b) => (
                    a.sourceType.localeCompare(b.sourceType)
                    || a.sourceArtifactId.localeCompare(b.sourceArtifactId)
                    || a.sourceArtifactVersionId.localeCompare(b.sourceArtifactVersionId)
                    || String(a.anchorInfo).localeCompare(String(b.anchorInfo))
                )),
        }));

    return JSON.stringify({
        spineVersionId: input.spineVersionId ?? null,
        spineContentFingerprint: digest(input.spineContent ?? null),
        sources,
    });
}

/**
 * Execute one guarded Sync session. The exact-session check happens before
 * deriving or applying work, mark-current writes are ordered before the one
 * regeneration batch, and blocked runs remain side-effect free.
 */
export function runOutputSyncSession(input: {
    expectedFingerprint?: string;
    currentFingerprint: string;
    canExecute: boolean;
    canRegenerate: boolean;
    createExecution: () => OutputSyncExecutionPlan;
    onMarkCurrent: (slot: ArtifactSlotKey) => void;
    onRegenerate: (slots: ArtifactSlotKey[]) => void;
}): OutputSyncRunResult {
    if (
        !input.expectedFingerprint
        || input.expectedFingerprint !== input.currentFingerprint
    ) {
        return { status: 'stale' };
    }
    if (!input.canExecute) return { status: 'blocked' };

    const execution = input.createExecution();
    if (execution.regenerate.length > 0 && !input.canRegenerate) {
        return { status: 'blocked' };
    }
    for (const slot of execution.markCurrent) input.onMarkCurrent(slot);
    if (execution.regenerate.length > 0) input.onRegenerate(execution.regenerate);
    return { status: 'completed', execution };
}

/**
 * Build the one shared Sync-outputs triage model from the canonical freshness
 * evaluation. The dependency graph already excludes retired nodes and
 * collapses hidden nodes, so this never invents a second visible-node list.
 */
export function buildOutputSyncRows(input: BuildOutputSyncRowsInput): OutputSyncRow[] {
    const recommended = new Set(input.recommendedUpdates);

    return input.graph.nodes.flatMap(node => {
        if (!isArtifactSlot(node.id)) return [];
        const evaluation = input.evaluations.get(node.id);
        if (!evaluation) return [];
        const artifactId = input.artifactIdBySlot[node.id];
        const careful = artifactId
            ? input.carefulPlansByArtifactId?.get(artifactId)
            : undefined;
        const impacted = evaluation.impactedBy.length > 0;
        const directlyDrifted = evaluation.status === 'needs_update'
            || evaluation.status === 'update_recommended'
            || evaluation.status === 'needs_review';
        const isDrifted = directlyDrifted || impacted;
        const needsSync = recommended.has(node.id);
        const prdChange = evaluation.reasons.find(reason => reason.kind === 'prd_changed');

        return [{
            id: node.id,
            ...(artifactId ? { artifactId } : {}),
            title: node.title,
            statusLabel: impacted && evaluation.status === 'up_to_date'
                ? 'Impacted'
                : DEPENDENCY_STATUS_LABELS[evaluation.status],
            needsSync,
            isDrifted,
            ...(prdChange?.changeSummary?.headline
                ? { changeHeadline: prdChange.changeSummary.headline }
                : {}),
            ...(evaluation.likelyUnaffected ? { likelyUnaffected: true } : {}),
            ...(evaluation.manuallyEdited ? { manuallyEdited: true } : {}),
            defaultChoice: needsSync ? 'update' as const : 'skip' as const,
            canMarkCurrent: Boolean(
                artifactId
                && isDrifted
                && evaluation.status !== 'needs_review',
            ),
            carefulSupported: CAREFUL_SLOTS.has(node.id),
            ...(careful ? { carefulPlanId: careful.id, carefulItemCount: careful.itemCount } : {}),
        }];
    });
}

export function hasOutputSyncDrift(rows: OutputSyncRow[]): boolean {
    return rows.some(row => row.isDrifted);
}

/**
 * Translate the user's triage choices into an auditable mark-current batch and
 * one dependency-safe regeneration batch. Callers apply markCurrent first,
 * then pass regenerate to artifactJobController.regenerateSlots exactly once.
 */
export function planOutputSyncExecution(input: {
    graph: ArtifactDependencyGraph;
    evaluations: Map<DependencyNodeId, DependencyNodeEvaluation>;
    rows: OutputSyncRow[];
    choices: Record<string, OutputSyncChoice>;
}): OutputSyncExecutionPlan {
    const rowById = new Map(input.rows.map(row => [row.id, row]));
    const requestedMarkCurrent = new Set<DependencyNodeId>(input.rows
        .filter(row => input.choices[row.id] === 'mark_current' && row.canMarkCurrent)
        .map(row => row.id));
    const troubled = (id: DependencyNodeId): boolean => {
        const status = input.evaluations.get(id)?.status;
        return status === 'needs_update'
            || status === 'update_recommended'
            || status === 'needs_review'
            || status === 'missing'
            || status === 'error';
    };
    const upstreamsFor = (id: DependencyNodeId): DependencyNodeId[] => {
        const seen = new Set<DependencyNodeId>();
        const queue = input.graph.edges
            .filter(edge => edge.to === id && edge.kind === 'hard')
            .map(edge => edge.from);
        const result: DependencyNodeId[] = [];
        while (queue.length > 0) {
            const upstream = queue.shift()!;
            if (seen.has(upstream)) continue;
            seen.add(upstream);
            if (upstream !== 'prd') result.push(upstream);
            queue.push(...input.graph.edges
                .filter(edge => edge.to === upstream && edge.kind === 'hard')
                .map(edge => edge.from));
        }
        return result;
    };

    // Work in dependency order so a requested upstream mark must itself be
    // valid before it can make a dependent mark safe.
    const markCurrentSet = new Set<DependencyNodeId>();
    for (const id of computeUpdateOrder(input.graph, [...requestedMarkCurrent])) {
        if (!requestedMarkCurrent.has(id)) continue;
        const safe = upstreamsFor(id).every(upstream => (
            input.choices[upstream] !== 'update'
            && (!troubled(upstream) || markCurrentSet.has(upstream))
        ));
        if (safe) markCurrentSet.add(id);
    }
    const markCurrent = input.rows
        .filter(row => markCurrentSet.has(row.id))
        .map(row => row.id);
    const deferredMarkCurrent = input.rows
        .filter(row => requestedMarkCurrent.has(row.id) && !markCurrentSet.has(row.id))
        .map(row => row.id);
    const selected = input.rows
        .filter(row => input.choices[row.id] === 'update')
        .map(row => row.id);
    const regenerate = expandSelectionWithTroubledUpstreams(
        input.graph,
        input.evaluations,
        selected,
        markCurrentSet,
    ).filter((id): id is ArtifactSlotKey => isArtifactSlot(id) && rowById.has(id));

    return { markCurrent, regenerate, deferredMarkCurrent };
}
