import type { ArtifactSlotKey, PipelineStage } from '../../types';
import type { ImplementationPlanNavigationTarget } from './implementationPlanNavigation';
import type { PlanningAttentionItem } from './planningAttention';

/** Presentation-only navigation. These values must never participate in
 * planning authority, provenance, readiness hashes, or persisted project data. */
export type PlanningScreenTab = 'overview' | 'flow' | 'mockups';

export type PlanningScreenDestination = {
    kind: 'screen';
    artifactId?: string;
    nodeId?: 'screen_inventory' | 'mockup';
    screenId: string;
    tab?: PlanningScreenTab;
    label: string;
    planId?: never;
    itemId?: never;
};

export type ActivePlanningStage = 'prd' | 'review' | 'workspace' | 'history';

type PlanningSurfaceDestination = {
    kind: 'workspace' | 'history';
    artifactId?: never;
    nodeId?: never;
    planId?: never;
    itemId?: never;
};

export type PlanningArtifactRegionTarget = {
    planId: string;
    itemId: string;
    label: string;
    screenId?: string;
    flowId?: string;
    flowStepIndex?: number;
    dataEntityName?: string;
    dataMemberName?: string;
    dataMemberAspect?: 'field' | 'relationship' | 'constraint' | 'data_expectation';
    implementationTarget?: ImplementationPlanNavigationTarget;
};

export type PlanningDestination =
    | { kind: 'prd'; anchorId?: string }
    | { kind: 'decision_center' }
    | { kind: 'planning_record'; recordId: string }
    | { kind: 'challenge'; reviewId?: string; issueId?: string; findingId?: string }
    | { kind: 'readiness'; reviewId: string; concernId?: string }
    | PlanningScreenDestination
    | PlanningSurfaceDestination
    | {
        kind: 'artifact';
        artifactId?: string;
        nodeId?: ArtifactSlotKey;
        region?: PlanningArtifactRegionTarget;
    }
    | {
        kind: 'update_plan';
        planId: string;
        itemId?: string;
        artifactId?: string;
        nodeId?: ArtifactSlotKey;
    };

export type PlanningReturnTarget = {
    destination: PlanningDestination;
    label: string;
};

export type PlanningNavigationIntent = {
    destination: PlanningDestination;
    returnTo?: PlanningReturnTarget;
};

export const PLANNING_NAVIGATION_QUERY_PARAM = 'planning';

const MAX_SERIALIZED_LENGTH = 8_000;
const MAX_VALUE_LENGTH = 500;
const nonEmpty = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= MAX_VALUE_LENGTH;
const optionalString = (value: unknown): value is string | undefined =>
    value === undefined || nonEmpty(value);

export function isPlanningScreenTab(value: unknown): value is PlanningScreenTab {
    return typeof value === 'string' && ['overview', 'flow', 'mockups'].includes(value);
}

export function dispatchPlanningAttentionItem(
    item: PlanningAttentionItem,
    {
        onCommit,
        onNavigate,
    }: {
        onCommit: () => void;
        onNavigate: (destination: PlanningDestination) => void;
    },
): void {
    if (item.condition === 'ready_to_commit') {
        onCommit();
        return;
    }
    onNavigate(item.destination);
}

export function resolveActivePlanningScreen({
    screenId,
    rawTab,
    idsByArtifactId,
    labels,
    preferredArtifactId,
}: {
    screenId: string | null | undefined;
    rawTab: string | null | undefined;
    idsByArtifactId: ReadonlyMap<string, ReadonlySet<string>>;
    labels: ReadonlyMap<string, string>;
    preferredArtifactId?: string;
}): Omit<PlanningScreenDestination, 'kind'> | undefined {
    if (!nonEmpty(screenId)) return undefined;

    const preferredMatches = nonEmpty(preferredArtifactId)
        && idsByArtifactId.get(preferredArtifactId)?.has(screenId);
    const matchingArtifactIds = preferredMatches
        ? [preferredArtifactId]
        : Array.from(idsByArtifactId.entries())
            .filter(([artifactId, ids]) => nonEmpty(artifactId) && ids.has(screenId))
            .map(([artifactId]) => artifactId);
    if (matchingArtifactIds.length !== 1) return undefined;

    const artifactId = matchingArtifactIds[0];
    const label = labels.get(`${artifactId}:${screenId}`);
    if (!nonEmpty(label)) return undefined;

    return {
        artifactId,
        nodeId: 'screen_inventory',
        screenId,
        tab: isPlanningScreenTab(rawTab) ? rawTab : 'overview',
        label,
    };
}

function isArtifactSlotKey(value: unknown): value is ArtifactSlotKey {
    return typeof value === 'string' && [
        'screen_inventory',
        'user_flows',
        'component_inventory',
        'implementation_plan',
        'data_model',
        'prompt_pack',
        'design_system',
        'mockup',
    ].includes(value);
}

function isPlanningScreenDestination(value: unknown): value is PlanningScreenDestination {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<PlanningScreenDestination>;
    return candidate.kind === 'screen'
        && optionalString(candidate.artifactId)
        && (candidate.nodeId === undefined || ['screen_inventory', 'mockup'].includes(candidate.nodeId))
        && nonEmpty(candidate.screenId)
        && (candidate.tab === undefined || isPlanningScreenTab(candidate.tab))
        && nonEmpty(candidate.label)
        && candidate.planId === undefined
        && candidate.itemId === undefined
        && Boolean(candidate.artifactId || candidate.nodeId);
}

function isImplementationTarget(value: unknown): value is ImplementationPlanNavigationTarget {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<ImplementationPlanNavigationTarget>;
    return nonEmpty(candidate.anchorId)
        && ['overview', 'milestones', 'quality_gates'].includes(candidate.tab ?? '')
        && optionalString(candidate.milestoneId);
}

function isRegion(value: unknown): value is PlanningArtifactRegionTarget {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<PlanningArtifactRegionTarget>;
    return nonEmpty(candidate.planId)
        && nonEmpty(candidate.itemId)
        && nonEmpty(candidate.label)
        && optionalString(candidate.screenId)
        && optionalString(candidate.flowId)
        && (candidate.flowStepIndex === undefined
            || typeof candidate.flowStepIndex === 'number'
                && Number.isInteger(candidate.flowStepIndex)
                && candidate.flowStepIndex >= 0)
        && optionalString(candidate.dataEntityName)
        && optionalString(candidate.dataMemberName)
        && (candidate.dataMemberAspect === undefined
            || ['field', 'relationship', 'constraint', 'data_expectation'].includes(candidate.dataMemberAspect))
        && ((candidate.dataMemberName === undefined) === (candidate.dataMemberAspect === undefined))
        && (candidate.implementationTarget === undefined
            || isImplementationTarget(candidate.implementationTarget));
}

export function isPlanningDestination(value: unknown): value is PlanningDestination {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<PlanningDestination> & Record<string, unknown>;
    if (candidate.kind === 'prd') return optionalString(candidate.anchorId);
    if (candidate.kind === 'decision_center') return true;
    if (candidate.kind === 'planning_record') return nonEmpty(candidate.recordId);
    if (candidate.kind === 'challenge') {
        return optionalString(candidate.reviewId)
            && optionalString(candidate.issueId)
            && optionalString(candidate.findingId);
    }
    if (candidate.kind === 'readiness') {
        return nonEmpty(candidate.reviewId) && optionalString(candidate.concernId);
    }
    if (candidate.kind === 'screen') return isPlanningScreenDestination(candidate);
    if (candidate.kind === 'workspace' || candidate.kind === 'history') {
        return candidate.artifactId === undefined
            && candidate.nodeId === undefined
            && candidate.planId === undefined
            && candidate.itemId === undefined;
    }
    if (candidate.kind === 'artifact') {
        return optionalString(candidate.artifactId)
            && (candidate.nodeId === undefined || isArtifactSlotKey(candidate.nodeId))
            && (candidate.region === undefined || isRegion(candidate.region))
            && Boolean(candidate.artifactId || candidate.nodeId || candidate.region);
    }
    if (candidate.kind === 'update_plan') {
        return nonEmpty(candidate.planId)
            && optionalString(candidate.itemId)
            && optionalString(candidate.artifactId)
            && (candidate.nodeId === undefined || isArtifactSlotKey(candidate.nodeId));
    }
    return false;
}

function isReturnTarget(value: unknown): value is PlanningReturnTarget {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<PlanningReturnTarget>;
    return nonEmpty(candidate.label) && isPlanningDestination(candidate.destination);
}

export function serializePlanningNavigationIntent(intent: PlanningNavigationIntent): string {
    if (!isPlanningDestination(intent.destination)
        || intent.returnTo !== undefined && !isReturnTarget(intent.returnTo)) return '';
    return JSON.stringify(intent);
}

export function parsePlanningNavigationIntent(value: string | null | undefined): PlanningNavigationIntent | undefined {
    if (!value || value.length > MAX_SERIALIZED_LENGTH) return undefined;
    try {
        const parsed = JSON.parse(value) as Partial<PlanningNavigationIntent>;
        if (!isPlanningDestination(parsed.destination)) return undefined;
        if (parsed.returnTo !== undefined && !isReturnTarget(parsed.returnTo)) return undefined;
        return { destination: parsed.destination, ...(parsed.returnTo ? { returnTo: parsed.returnTo } : {}) };
    } catch {
        return undefined;
    }
}

export function withPlanningNavigationIntent(
    current: URLSearchParams,
    intent?: PlanningNavigationIntent,
): URLSearchParams {
    const next = new URLSearchParams(current);
    const serialized = intent ? serializePlanningNavigationIntent(intent) : '';
    if (serialized) next.set(PLANNING_NAVIGATION_QUERY_PARAM, serialized);
    else next.delete(PLANNING_NAVIGATION_QUERY_PARAM);
    return next;
}

export type PlanningNavigationValidationContext = {
    planningRecordIds?: ReadonlySet<string>;
    reviewIds?: ReadonlySet<string>;
    reviewIssueIds?: ReadonlySet<string>;
    reviewFindingIds?: ReadonlySet<string>;
    readinessReviewIds?: ReadonlySet<string>;
    artifactIds?: ReadonlySet<string>;
    updatePlanIds?: ReadonlySet<string>;
    screenIdsByArtifactId?: ReadonlyMap<string, ReadonlySet<string>>;
};

/** Missing or stale presentation targets fail to a safe readable surface. A
 * historical target is valid when its durable id remains in the supplied set. */
export function validatePlanningDestination(
    destination: PlanningDestination,
    context: PlanningNavigationValidationContext,
): PlanningDestination {
    if (destination.kind === 'screen') {
        if (!destination.artifactId && !destination.nodeId) return { kind: 'workspace' };
        if (destination.artifactId
            && context.artifactIds
            && !context.artifactIds.has(destination.artifactId)) {
            return destination.nodeId
                ? { kind: 'artifact', nodeId: destination.nodeId }
                : { kind: 'workspace' };
        }
        if (destination.artifactId
            && context.screenIdsByArtifactId?.has(destination.artifactId)
            && !context.screenIdsByArtifactId.get(destination.artifactId)?.has(destination.screenId)) {
            return {
                kind: 'artifact',
                artifactId: destination.artifactId,
                nodeId: destination.nodeId,
            };
        }
        return destination;
    }
    if (destination.kind === 'planning_record'
        && context.planningRecordIds && !context.planningRecordIds.has(destination.recordId)) {
        return { kind: 'prd' };
    }
    if (destination.kind === 'challenge') {
        if (destination.reviewId && context.reviewIds && !context.reviewIds.has(destination.reviewId)) return { kind: 'prd' };
        if (destination.issueId && context.reviewIssueIds && !context.reviewIssueIds.has(destination.issueId)) return { kind: 'challenge', reviewId: destination.reviewId };
        if (destination.findingId && context.reviewFindingIds && !context.reviewFindingIds.has(destination.findingId)) return { kind: 'challenge', reviewId: destination.reviewId };
    }
    if (destination.kind === 'readiness'
        && context.readinessReviewIds && !context.readinessReviewIds.has(destination.reviewId)) {
        return { kind: 'prd' };
    }
    if (destination.kind === 'artifact'
        && destination.artifactId && context.artifactIds && !context.artifactIds.has(destination.artifactId)) {
        return { kind: 'prd' };
    }
    if (destination.kind === 'update_plan'
        && context.updatePlanIds && !context.updatePlanIds.has(destination.planId)) {
        return destination.artifactId && (!context.artifactIds || context.artifactIds.has(destination.artifactId))
            ? { kind: 'artifact', artifactId: destination.artifactId, nodeId: destination.nodeId }
            : { kind: 'prd' };
    }
    return destination;
}

export function planningStageForDestination(destination: PlanningDestination): ActivePlanningStage {
    if (destination.kind === 'prd' || destination.kind === 'readiness') return 'prd';
    if (destination.kind === 'decision_center'
        || destination.kind === 'planning_record'
        || destination.kind === 'challenge') return 'review';
    if (destination.kind === 'history') return 'history';
    return 'workspace';
}

export function planningReturnTargetForSurface({
    stage,
    screen,
}: {
    stage: PipelineStage;
    screen?: Omit<PlanningScreenDestination, 'kind'>;
}): PlanningReturnTarget {
    if (stage === 'workspace' && screen) {
        return { destination: { ...screen, kind: 'screen' }, label: `Back to ${screen.label}` };
    }
    if (stage === 'review') {
        return { destination: { kind: 'challenge' }, label: 'Back to Challenge' };
    }
    if (stage === 'workspace' || stage === 'mockups' || stage === 'artifacts') {
        return { destination: { kind: 'workspace' }, label: 'Back to Build' };
    }
    if (stage === 'history') {
        return { destination: { kind: 'history' }, label: 'Back to History' };
    }
    return { destination: { kind: 'prd' }, label: 'Back to Plan' };
}
