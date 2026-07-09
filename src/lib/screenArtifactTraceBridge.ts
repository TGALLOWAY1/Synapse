// Phase 5B: the screen → downstream-artifact trace bridge.
//
// Phase 5A derived a per-screen implementation handoff (route, components,
// state, events, data dependencies, mockups, acceptance, QA, build tasks) but
// its data dependencies and route/component guidance were ESTIMATED from the
// screen contract alone — nothing correlated them to the actual Data Model or
// Implementation Plan artifacts. Phase 5B layers ON TOP of that (and NEVER
// changes it) to add a READ-ONLY correlation layer: given the already-loaded
// Data Model and Implementation Plan content, it finds which entities/fields
// appear to support a screen and which plan tasks appear to correspond to it,
// each with an honest confidence label and a plain-language reason.
//
// It is PURE (no store, no IDB, no React, no LLM) and READ-ONLY — it never
// mutates, fetches, or regenerates any artifact. It DERIVES nothing that is
// persisted. Honesty rules mirror the rest of the Screens layer:
//   - confidence is labeled explicit / strong / weak / estimated / missing and
//     never overstated (a token overlap is `weak`, never "confirmed");
//   - a missing match is shown as review guidance, never a crash or a blocker;
//   - legacy artifacts (no featureRefs, no structured plan) degrade to
//     name/field/token matching or `missing`, never an exception.

import type {
    DataEntity, DataModelContent, StructuredImplementationPlan,
} from '../types';
import { normalizeFeatureId } from './screenReadiness';
import { extractStructuredPlan, parseImplementationPlan, parseMilestoneBody } from './services/implementationPlanParser';
import { parseDataModelMarkdown } from './services/dataModelMarkdown';

// --- Types -------------------------------------------------------------------

export type TraceConfidence = 'explicit' | 'strong' | 'weak' | 'estimated' | 'missing';

export type DataModelMatchSource =
    | 'explicit_screen_ref'
    | 'feature_ref'
    | 'input_output_match'
    | 'entity_name_match'
    | 'field_name_match'
    | 'semantic_label_match'
    | 'estimated';

export interface ScreenDataModelFieldMatch {
    name: string;
    confidence: TraceConfidence;
    reason?: string;
}

export interface ScreenDataModelMatch {
    entityName: string;
    entityId?: string;
    confidence: TraceConfidence;
    fields?: ScreenDataModelFieldMatch[];
    relationshipHints?: string[];
    reason: string;
    source: DataModelMatchSource;
}

export type PlanMatchSource =
    | 'explicit_screen_ref'
    | 'route_match'
    | 'component_match'
    | 'feature_ref'
    | 'screen_title_match'
    | 'acceptance_criteria_match'
    | 'estimated';

export interface ScreenImplementationPlanMatch {
    taskId?: string;
    title: string;
    confidence: TraceConfidence;
    phaseName?: string;
    milestoneName?: string;
    status?: string;
    priority?: string;
    reason: string;
    source: PlanMatchSource;
}

export interface ScreenArtifactTraceBridge {
    screenId: string;
    screenTitle: string;
    dataModel: {
        matches: ScreenDataModelMatch[];
        confidence: TraceConfidence;
        warnings: string[];
    };
    implementationPlan: {
        matches: ScreenImplementationPlanMatch[];
        confidence: TraceConfidence;
        warnings: string[];
    };
    overall: {
        confidence: TraceConfidence;
        warnings: string[];
        recommendedActions: string[];
    };
}

/**
 * The already-derived, screen-side signals the bridge correlates against the
 * downstream artifacts. Assembled by the handoff layer from the screen contract
 * + Phase 5A derivations — the bridge never re-derives them, so it stays a pure
 * correlation step decoupled from the handoff internals.
 */
export interface ScreenTraceContext {
    screenId: string;
    screenTitle: string;
    isP0: boolean;
    /** Screen PRD feature refs (ids and/or "id: name" strings). */
    featureRefs: readonly string[];
    /** Derived route path (may be explicit or derived). */
    route?: string;
    /** Whether the route came from the generated handoff (vs. derived). */
    routeExplicit: boolean;
    /** Derived component names (PascalCase). */
    components: readonly string[];
    /** Data-dependency labels the handoff derived (entities / fields / apis). */
    dataLabels: readonly string[];
    /** Whether the screen carries any data requirements at all. */
    hasDataRequirements: boolean;
}

// --- Confidence helpers ------------------------------------------------------

const CONFIDENCE_RANK: Record<TraceConfidence, number> = {
    missing: 0, estimated: 1, weak: 2, strong: 3, explicit: 4,
};

/** The stronger of two confidences (ties → the first). */
function maxConfidence(a: TraceConfidence, b: TraceConfidence): TraceConfidence {
    return CONFIDENCE_RANK[a] >= CONFIDENCE_RANK[b] ? a : b;
}

/** The weaker of two confidences — used to combine two independent traces into
 * an overall verdict (a chain is only as trustworthy as its weakest link). */
function minConfidence(a: TraceConfidence, b: TraceConfidence): TraceConfidence {
    return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

function rollup(confidences: readonly TraceConfidence[]): TraceConfidence {
    let best: TraceConfidence = 'missing';
    for (const c of confidences) best = maxConfidence(best, c);
    return best;
}

export const TRACE_CONFIDENCE_LABELS: Record<TraceConfidence, string> = {
    explicit: 'Explicit trace',
    strong: 'Strong match',
    weak: 'Weak match',
    estimated: 'Estimated',
    missing: 'Missing',
};

// --- Text helpers ------------------------------------------------------------

const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'with', 'this',
    'that', 'page', 'screen', 'view', 'panel', 'list', 'form', 'data', 'user',
    'id', 'ids', 'name', 'names', 'new', 'add', 'get', 'set', 'all', 'from',
]);

/** Lowercase, alphanumerics only (used for exact label/name comparison). */
function normalizeLabel(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Drop a single trailing plural 's' for loose singular/plural comparison. */
function singular(s: string): string {
    return s.length > 3 && s.endsWith('s') ? s.slice(0, -1) : s;
}

/** Split camelCase / snake_case / spaced / slashed text into meaningful,
 * de-stopworded lowercase tokens (length ≥ 3). */
function tokenize(s: string): string[] {
    const spaced = s
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .toLowerCase();
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of spaced.split(/\s+/)) {
        const t = singular(raw.trim());
        if (t.length < 3 || STOPWORDS.has(t) || STOPWORDS.has(raw)) continue;
        if (seen.has(t)) continue;
        seen.add(t);
        out.push(t);
    }
    return out;
}

function tokenSet(s: string): Set<string> {
    return new Set(tokenize(s));
}

/** Count of shared meaningful tokens between two strings. */
function sharedTokenCount(a: string, b: string): number {
    const setB = tokenSet(b);
    let n = 0;
    for (const t of tokenSet(a)) if (setB.has(t)) n += 1;
    return n;
}

/** Loose entity/label equality (case/plural-insensitive). */
function labelsMatch(a: string, b: string): boolean {
    const na = singular(normalizeLabel(a));
    const nb = singular(normalizeLabel(b));
    return na.length > 0 && na === nb;
}

// --- Feature ref helpers -----------------------------------------------------

/** Parse the leading feature-id token from a ref like "F1: Role selection". */
function featureIdOf(ref: string): string | undefined {
    const m = ref.trim().match(/^(f-?\d+|feat-?\d+)\b/i);
    return m ? normalizeFeatureId(m[1]) : undefined;
}

function featureIdSet(refs: readonly string[]): Set<string> {
    const out = new Set<string>();
    for (const r of refs) {
        const id = featureIdOf(r);
        if (id) out.add(id);
    }
    return out;
}

// --- Data Model matching -----------------------------------------------------

/**
 * Correlate a screen with the Data Model entities/fields it appears to use.
 * Evidence, strongest first:
 *   1. explicit — a shared PRD feature id (screen.featureRefs ∩ entity.featureRefs);
 *   2. strong  — a screen data label / component exactly names the entity;
 *   3. field   — a data label matches an entity field (strong exact / weak token);
 *   4. weak    — token overlap between the screen and the entity name.
 * Everything is estimated from labels — never a claim that the field is truly
 * read/written. No match with data requirements → `missing` + a review warning.
 */
export function matchScreenToDataModel(
    ctx: ScreenTraceContext,
    dataModel: DataModelContent | null,
): { matches: ScreenDataModelMatch[]; confidence: TraceConfidence; warnings: string[] } {
    if (!dataModel || dataModel.entities.length === 0) {
        return {
            matches: [],
            confidence: 'missing',
            warnings: ['No Data Model artifact is available to trace against.'],
        };
    }

    const screenFeatureIds = featureIdSet(ctx.featureRefs);
    const labels = [...ctx.dataLabels];
    const nameProbes = [...labels, ...ctx.components, ctx.screenTitle];
    const matches: ScreenDataModelMatch[] = [];

    for (const entity of dataModel.entities) {
        const match = matchOneEntity(entity, screenFeatureIds, labels, nameProbes, ctx.screenTitle);
        if (match) matches.push(match);
    }

    // Strongest first, then by field count so the most useful match leads.
    matches.sort((a, b) =>
        CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]
        || (b.fields?.length ?? 0) - (a.fields?.length ?? 0));

    const confidence = rollup(matches.map(m => m.confidence));
    const warnings: string[] = [];
    if (matches.length === 0) {
        if (ctx.hasDataRequirements) {
            warnings.push('No linked Data Model entities found. Review recommended before implementation if this screen stores or reads project data.');
        } else {
            warnings.push('No Data Model entities appear to back this screen.');
        }
    }
    return { matches: matches.slice(0, 8), confidence, warnings };
}

function matchOneEntity(
    entity: DataEntity,
    screenFeatureIds: ReadonlySet<string>,
    dataLabels: readonly string[],
    nameProbes: readonly string[],
    screenTitle: string,
): ScreenDataModelMatch | null {
    let confidence: TraceConfidence = 'missing';
    let source: DataModelMatchSource = 'estimated';
    let reason = '';

    // 1. Explicit — a shared PRD feature id.
    const entityFeatureIds = featureIdSet(entity.featureRefs ?? []);
    const sharedFeature = [...screenFeatureIds].find(id => entityFeatureIds.has(id));
    if (sharedFeature) {
        confidence = 'explicit';
        source = 'feature_ref';
        reason = `Screen and entity both reference PRD feature ${sharedFeature.toUpperCase()}.`;
    }

    // 2. Strong — a data label / component exactly names the entity.
    if (CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK.strong) {
        const namedByLabel = dataLabels.some(l => labelsMatch(l, entity.name));
        const namedByProbe = !namedByLabel && nameProbes.some(l => labelsMatch(l, entity.name));
        if (namedByLabel || namedByProbe) {
            confidence = maxConfidence(confidence, 'strong');
            if (source === 'estimated') {
                source = namedByLabel ? 'input_output_match' : 'entity_name_match';
                reason = namedByLabel
                    ? `A screen data dependency names the "${entity.name}" entity.`
                    : `The screen references the "${entity.name}" entity by name.`;
            }
        }
    }

    // 3. Field-level — data labels matching entity fields.
    const fieldMatches: ScreenDataModelFieldMatch[] = [];
    for (const field of entity.fields ?? []) {
        const exact = dataLabels.some(l => labelsMatch(l, field.name)
            || labelsMatch(l, `${entity.name} ${field.name}`));
        const tokenHit = !exact && dataLabels.some(l => sharedTokenCount(l, field.name) > 0
            && normalizeLabel(field.name).length > 2);
        if (exact) {
            fieldMatches.push({ name: field.name, confidence: 'strong', reason: 'Named by a screen data dependency.' });
        } else if (tokenHit) {
            fieldMatches.push({ name: field.name, confidence: 'weak', reason: 'Overlaps a screen data dependency label.' });
        }
    }
    if (fieldMatches.length > 0) {
        const fieldConfidence = fieldMatches.some(f => f.confidence === 'strong') ? 'strong' : 'weak';
        confidence = maxConfidence(confidence, fieldConfidence);
        if (source === 'estimated') {
            source = 'field_name_match';
            reason = `Screen data dependencies overlap fields on "${entity.name}".`;
        }
    }

    // 4. Weak — token overlap between the screen and the entity name.
    if (CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK.weak) {
        const overlap = [...dataLabels, screenTitle].some(l => sharedTokenCount(l, entity.name) > 0);
        if (overlap) {
            confidence = 'weak';
            source = 'semantic_label_match';
            reason = `The screen's labels overlap the "${entity.name}" entity name.`;
        }
    }

    if (confidence === 'missing') return null;

    const relationshipHints = (entity.relationships ?? [])
        .map(r => `${r.type.replace(/_/g, ' ')} ${r.target}`)
        .slice(0, 4);

    return {
        entityName: entity.name,
        confidence,
        source,
        reason: reason || `Estimated correlation with "${entity.name}".`,
        fields: fieldMatches.length > 0 ? fieldMatches.slice(0, 8) : undefined,
        relationshipHints: relationshipHints.length > 0 ? relationshipHints : undefined,
    };
}

// --- Implementation Plan matching --------------------------------------------

interface FlatPlanTask {
    taskId?: string;
    title: string;
    text: string;
    milestoneName: string;
    phaseName?: string;
    status?: string;
    priority?: string;
    /** PRD feature refs linked on the task or milestone. */
    featureRefs: string[];
    /** Screen names/ids the milestone explicitly links. */
    explicitScreens: string[];
}

/** Flatten a structured plan into per-task probes with milestone context. A
 * milestone that explicitly links a screen but has no tasks still contributes a
 * milestone-level probe so an explicit link is never lost. */
function flattenPlan(plan: StructuredImplementationPlan): FlatPlanTask[] {
    const out: FlatPlanTask[] = [];
    for (const m of plan.milestones ?? []) {
        const explicitScreens = m.linkedArtifacts?.screens ?? [];
        const tasks = m.tasks ?? [];
        if (tasks.length === 0) {
            out.push({
                title: m.name,
                text: [m.name, m.objective, m.goal].filter(Boolean).join(' '),
                milestoneName: m.name,
                phaseName: m.phase,
                priority: m.priority,
                featureRefs: [],
                explicitScreens,
            });
            continue;
        }
        for (const t of tasks) {
            out.push({
                taskId: t.id,
                title: t.title,
                text: [t.title, t.description].filter(Boolean).join(' '),
                milestoneName: m.name,
                phaseName: m.phase,
                status: t.status,
                priority: m.priority,
                featureRefs: t.linkedArtifacts?.prd ?? [],
                explicitScreens,
            });
        }
    }
    return out;
}

/**
 * Correlate a screen with the Implementation Plan tasks that appear to build
 * it. Evidence, strongest first:
 *   1. explicit — the milestone links the screen by name/id, or a task links a
 *      shared PRD feature id;
 *   2. strong  — the handoff route path or an exact component name appears in a
 *      task, or the exact screen title appears;
 *   3. weak    — component/screen-title token overlap.
 * Read-only — it never mutates the plan. No match → `missing` + a recommended
 * action to review/regenerate the plan after accepting the screen.
 */
export function matchScreenToPlan(
    ctx: ScreenTraceContext,
    plan: StructuredImplementationPlan | null,
): { matches: ScreenImplementationPlanMatch[]; confidence: TraceConfidence; warnings: string[] } {
    if (!plan || (plan.milestones ?? []).length === 0) {
        return {
            matches: [],
            confidence: 'missing',
            warnings: ['No Implementation Plan artifact is available to trace against.'],
        };
    }

    const screenFeatureIds = featureIdSet(ctx.featureRefs);
    const route = ctx.route?.trim();
    const routeToken = route && route.length > 1 ? route : undefined; // skip bare "/"
    const titleNorm = normalizeLabel(ctx.screenTitle);
    const matches: ScreenImplementationPlanMatch[] = [];

    for (const task of flattenPlan(plan)) {
        const match = matchOnePlanTask(task, ctx, screenFeatureIds, routeToken, titleNorm);
        if (match) matches.push(match);
    }

    matches.sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]);
    const confidence = rollup(matches.map(m => m.confidence));
    const warnings: string[] = [];
    if (matches.length === 0) {
        warnings.push('No related Implementation Plan tasks found. Review or regenerate the Implementation Plan after accepting this screen.');
    }
    return { matches: matches.slice(0, 8), confidence, warnings };
}

function matchOnePlanTask(
    task: FlatPlanTask,
    ctx: ScreenTraceContext,
    screenFeatureIds: ReadonlySet<string>,
    routeToken: string | undefined,
    titleNorm: string,
): ScreenImplementationPlanMatch | null {
    let confidence: TraceConfidence = 'missing';
    let source: PlanMatchSource = 'estimated';
    let reason = '';

    // 1. Explicit — milestone links the screen by name/id.
    const explicitScreen = task.explicitScreens.some(s =>
        labelsMatch(s, ctx.screenTitle) || normalizeLabel(s) === normalizeLabel(ctx.screenId));
    if (explicitScreen) {
        confidence = 'explicit';
        source = 'explicit_screen_ref';
        reason = `The "${task.milestoneName}" milestone explicitly links this screen.`;
    }
    // 1b. Explicit — a shared PRD feature id on the task.
    if (CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK.explicit) {
        const taskFeatureIds = featureIdSet(task.featureRefs);
        const shared = [...screenFeatureIds].find(id => taskFeatureIds.has(id));
        if (shared) {
            confidence = 'explicit';
            source = 'feature_ref';
            reason = `Task links PRD feature ${shared.toUpperCase()}, which this screen covers.`;
        }
    }

    const haystack = task.text.toLowerCase();

    // 2. Strong — the route path appears in the task.
    if (CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK.strong && routeToken
        && haystack.includes(routeToken.toLowerCase())) {
        confidence = maxConfidence(confidence, 'strong');
        if (source === 'estimated') {
            source = 'route_match';
            reason = `Task references the route \`${routeToken}\` used by this screen.`;
        }
    }
    // 2b. Strong — an exact component name appears in the task.
    if (CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK.strong) {
        const exactComponent = ctx.components.find(c => c.length > 2
            && new RegExp(`\\b${escapeRegExp(c)}\\b`, 'i').test(task.text));
        if (exactComponent) {
            confidence = maxConfidence(confidence, 'strong');
            if (source === 'estimated') {
                source = 'component_match';
                reason = `Component \`${exactComponent}\` appears in this task.`;
            }
        }
    }
    // 2c. Strong — the exact screen title appears in the task.
    if (CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK.strong && titleNorm.length > 3
        && normalizeLabel(task.text).includes(titleNorm)) {
        confidence = maxConfidence(confidence, 'strong');
        if (source === 'estimated') {
            source = 'screen_title_match';
            reason = `Task text contains the screen title "${ctx.screenTitle}".`;
        }
    }

    // 3. Weak — component / screen-title token overlap.
    if (CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK.weak) {
        const componentOverlap = ctx.components.some(c => sharedTokenCount(c, task.text) > 0);
        const titleOverlap = sharedTokenCount(ctx.screenTitle, task.text) > 0;
        if (componentOverlap || titleOverlap) {
            confidence = 'weak';
            source = componentOverlap ? 'component_match' : 'screen_title_match';
            reason = componentOverlap
                ? `Task mentions terms overlapping this screen's components.`
                : `Task mentions terms overlapping this screen's title.`;
        }
    }

    if (confidence === 'missing') return null;

    return {
        taskId: task.taskId,
        title: task.title,
        confidence,
        source,
        reason,
        milestoneName: task.milestoneName,
        phaseName: task.phaseName,
        status: task.status,
        priority: task.priority,
    };
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Composite bridge --------------------------------------------------------

/**
 * Build the full read-only trace bridge for one screen: its Data Model support
 * and its Implementation Plan correspondence, each with a confidence label and
 * reasons, plus an overall verdict and recommended actions. Never mutates or
 * fetches anything.
 */
export function buildScreenArtifactTraceBridge(
    ctx: ScreenTraceContext,
    dataModel: DataModelContent | null,
    plan: StructuredImplementationPlan | null,
): ScreenArtifactTraceBridge {
    const dm = matchScreenToDataModel(ctx, dataModel);
    const ip = matchScreenToPlan(ctx, plan);

    const warnings: string[] = [];
    const recommendedActions: string[] = [];

    // Data-model review guidance — only nag when the artifact EXISTS but nothing
    // matched a screen that carries data requirements (a missing artifact is an
    // info note, never a review push — see the readiness layer).
    if (dataModel && dm.confidence === 'missing' && ctx.hasDataRequirements) {
        warnings.push('This screen has data dependencies but no matched Data Model entities.');
        recommendedActions.push(`Review Data Model support for ${ctx.screenTitle}.`);
    }
    if (plan && ip.confidence === 'missing') {
        warnings.push('No Implementation Plan tasks appear to correspond to this screen.');
        recommendedActions.push('Review Implementation Plan coverage after accepting P0 screens.');
    }
    if (dm.confidence !== 'missing' && CONFIDENCE_RANK[dm.confidence] <= CONFIDENCE_RANK.weak) {
        warnings.push('Data Model correlation is estimated from labels — confirm the entities/fields before building.');
    }
    if (ip.confidence !== 'missing' && CONFIDENCE_RANK[ip.confidence] <= CONFIDENCE_RANK.weak) {
        warnings.push('Implementation Plan correlation is estimated from token overlap — confirm before building.');
    }

    // Overall = the weaker of the two present traces (a chain is only as strong
    // as its weakest link); if both are missing, the overall is missing too.
    let overallConfidence: TraceConfidence;
    if (dm.confidence === 'missing' && ip.confidence === 'missing') {
        overallConfidence = 'missing';
    } else if (dm.confidence === 'missing') {
        overallConfidence = ip.confidence;
    } else if (ip.confidence === 'missing') {
        overallConfidence = dm.confidence;
    } else {
        overallConfidence = minConfidence(dm.confidence, ip.confidence);
    }

    return {
        screenId: ctx.screenId,
        screenTitle: ctx.screenTitle,
        dataModel: dm,
        implementationPlan: ip,
        overall: { confidence: overallConfidence, warnings, recommendedActions },
    };
}

// --- Artifact-content resolvers (pure) ---------------------------------------

/**
 * Resolve a Data Model artifact's stored content into a `DataModelContent` for
 * tracing. Prefers the structured JSON shape (new generations); falls back to
 * the legacy markdown parser, mapping parsed entities into a light
 * `DataModelContent` (entity + field NAMES only — legacy markdown carries no
 * featureRefs or typed fields, so only name/field matching will fire). Returns
 * null when nothing parseable is present.
 */
export function resolveDataModelForTrace(content: string | undefined | null): DataModelContent | null {
    if (!content || !content.trim()) return null;
    // 1. Structured JSON (current generations store it directly as content).
    try {
        const parsed = JSON.parse(content) as DataModelContent;
        if (parsed && Array.isArray(parsed.entities)) return parsed;
    } catch {
        // not JSON — fall through to markdown
    }
    // 2. Legacy markdown.
    const md = parseDataModelMarkdown(content);
    if (!md || md.entities.length === 0) return null;
    const entities: DataEntity[] = md.entities.map(e => ({
        name: e.name,
        description: e.description,
        fields: e.fieldGroups.flatMap(g => g.fields.map(f => ({
            name: f.name, type: f.type ?? '', required: false, description: f.description ?? '',
        }))),
        relationships: [],
    }));
    return { entities };
}

/**
 * Resolve an Implementation Plan artifact's stored content into a
 * `StructuredImplementationPlan` for tracing. Prefers the trailing
 * `json synapse-plan` fence (native structured plan); falls back to parsing the
 * legacy milestone markdown into a minimal plan (milestone names + checkbox
 * deliverables as pseudo-tasks) so legacy plans still correlate by title/route.
 * Returns null when no milestones can be recovered.
 */
export function resolvePlanForTrace(content: string | undefined | null): StructuredImplementationPlan | null {
    if (!content || !content.trim()) return null;
    const structured = extractStructuredPlan(content);
    if (structured && structured.milestones.length > 0) return structured;
    const legacy = parseImplementationPlan(content);
    if (legacy.milestones.length === 0) return null;
    return {
        milestones: legacy.milestones.map(m => {
            const details = parseMilestoneBody(m.body);
            return {
                id: `m${m.id}`,
                name: m.title,
                timeframe: m.timeframe,
                tasks: details.deliverables.map((d, i) => ({
                    id: `m${m.id}-t${i}`,
                    title: d.text,
                    status: (d.checked ? 'done' : 'todo') as 'done' | 'todo',
                })),
            };
        }),
    };
}
