// Phase 5A: the screen → implementation handoff layer.
//
// Phases 4A/4B turned the Screens artifact into a review workflow (user
// sign-off vs. system readiness) and a downstream-impact + preflight surface.
// Phase 5A layers ON TOP of those (and NEVER changes them) to make an accepted
// screen directly useful for development: it derives a lightweight, per-screen
// *implementation handoff package* — route, components, state, events, data
// dependencies, mockup references, acceptance criteria, a QA checklist, and a
// small build-task list — plus a per-screen implementation-readiness verdict.
//
// It is PURE and read-time only (no store, no IDB, no React, no LLM). It is
// DERIVED (nothing here is persisted — a stale persisted handoff would be worse
// than none). It reuses the existing resolvers (resolveScreenHandoff,
// resolveAcceptanceCriteria, buildScreenTraceability) so it never drifts from
// the readiness layer, and it consumes the already-computed Phase 4A review
// model and Phase 4B downstream impact rather than recomputing them.
//
// Honesty rules (mirroring the rest of the Screens layer): every derived value
// is an estimate from the generated spec; a route/component/state inferred from
// the title is labeled `derived`, never presented as final; missing data is
// shown as "Not specified" / a review warning, never fabricated as certain;
// language stays calm and practical ("Review recommended", "Derived route —
// confirm before building"), never punitive ("Invalid", "Broken").

import type { DataModelContent, Feature, ScreenItem, StructuredImplementationPlan } from '../types';
import type { ScreenExperienceItem } from './screenExperience';
import { slugifyScreenName } from './screenInventoryImageStore';
import {
    buildScreenTraceability, resolveAcceptanceCriteria,
    type ScreenReviewStatus,
} from './screenReadiness';
import {
    buildScreenArtifactTraceBridge,
    type ScreenArtifactTraceBridge, type ScreenImplementationPlanMatch,
    type ScreenTraceContext, type TraceConfidence,
} from './screenArtifactTraceBridge';
import {
    formatVariantLabel, type DerivedMockupVariant, type MockupVariantCoverage,
} from './mockupVariants';
import type {
    ScreenReviewFreshnessStatus, ScreenReviewModel, SystemReadinessStatus,
} from './screenReviewWorkflow';
import type { MockupVariantFreshness } from './mockupVariantTrust';
import type { ScreenDownstreamImpact } from './screenDownstreamImpact';

// --- Types -------------------------------------------------------------------

export type ScreenImplementationReadiness = 'ready' | 'review_recommended' | 'blocked';

export const IMPLEMENTATION_READINESS_LABELS: Record<ScreenImplementationReadiness, string> = {
    ready: 'Ready for implementation',
    review_recommended: 'Handoff needs review',
    blocked: 'Handoff blocked',
};

export type HandoffConfidence = 'explicit' | 'derived' | 'missing';

export interface HandoffRoute {
    path?: string;
    routeName?: string;
    confidence: HandoffConfidence;
    notes: string[];
}

export type HandoffComponentSource = 'core_ui' | 'handoff' | 'derived' | 'mockup' | 'unknown';

export interface HandoffComponent {
    name: string;
    purpose?: string;
    source: HandoffComponentSource;
    required: boolean;
}

export type HandoffStateSource = 'screen_state' | 'handoff' | 'derived';

export interface HandoffStateEntry {
    name: string;
    purpose?: string;
    source: HandoffStateSource;
}

export type HandoffEventSource = 'user_action' | 'flow' | 'handoff' | 'derived';

export interface HandoffEvent {
    name: string;
    trigger?: string;
    expectedOutcome?: string;
    source: HandoffEventSource;
}

export type HandoffDataType =
    | 'entity' | 'field' | 'api' | 'storage' | 'input' | 'output' | 'unknown';
export type HandoffDataDirection = 'read' | 'write' | 'read_write';
export type HandoffDataSource =
    | 'screen_outputs' | 'screen_inputs' | 'handoff' | 'data_model_trace' | 'derived';

export interface HandoffDataDependency {
    label: string;
    type: HandoffDataType;
    direction?: HandoffDataDirection;
    source: HandoffDataSource;
    /** Phase 5B: confidence of a Data Model trace, when one was found. */
    confidence?: TraceConfidence;
    /** Phase 5B: the Data Model entity this dependency was matched to. */
    matchedEntity?: string;
    /** Phase 5B: the specific entity field this dependency was matched to. */
    matchedField?: string;
}

export interface HandoffMockupReference {
    variantId: string;
    label: string;
    viewport?: string;
    stateName?: string;
    freshness?: MockupVariantFreshness['status'];
    coverage?: MockupVariantCoverage;
    recommendedForBuild: boolean;
}

export type HandoffQaCategory =
    | 'rendering' | 'interaction' | 'state' | 'data'
    | 'accessibility' | 'responsive' | 'error_handling' | 'acceptance';
export type HandoffQaSource =
    | 'acceptance_criteria' | 'states' | 'risks' | 'mockups' | 'derived';

export interface HandoffQaItem {
    id: string;
    label: string;
    category: HandoffQaCategory;
    source: HandoffQaSource;
    required: boolean;
}

export type HandoffTaskCategory =
    | 'route' | 'component' | 'state' | 'data' | 'mockup' | 'qa' | 'accessibility';
export type HandoffTaskPriority = 'must' | 'should' | 'could';

export interface HandoffBuildTask {
    id: string;
    title: string;
    description: string;
    category: HandoffTaskCategory;
    priority: HandoffTaskPriority;
    source: string;
}

export interface HandoffTrace {
    prdFeatures: string[];
    userFlows: string[];
    relatedArtifacts: string[];
    estimated: boolean;
    warnings: string[];
}

export interface ScreenImplementationReadinessDetail {
    status: ScreenImplementationReadiness;
    reasons: string[];
    blockingCount: number;
    reviewCount: number;
}

export interface ScreenImplementationHandoff {
    screenId: string;
    screenTitle: string;
    priority?: string;
    readiness: ScreenImplementationReadinessDetail;
    route: HandoffRoute;
    components: HandoffComponent[];
    state: HandoffStateEntry[];
    events: HandoffEvent[];
    dataDependencies: HandoffDataDependency[];
    mockupReferences: HandoffMockupReference[];
    acceptanceCriteria: string[];
    qaChecklist: HandoffQaItem[];
    buildTasks: HandoffBuildTask[];
    trace: HandoffTrace;
    /**
     * Phase 5B: read-only correlation of this screen with the Data Model and
     * Implementation Plan artifacts. Present only when trace inputs were
     * provided (the workspace always provides them; legacy/test callers that
     * omit them leave this undefined, preserving Phase 5A behavior).
     */
    traceBridge?: ScreenArtifactTraceBridge;
    /** Phase 5B: Implementation Plan tasks that appear to build this screen. */
    implementationPlanReferences?: ScreenImplementationPlanMatch[];
}

// --- Small helpers -----------------------------------------------------------

const isP0 = (screen: ScreenItem): boolean =>
    screen.priority === 'P0' || screen.priority === 'core';

/** Primary = a screen users routinely land on (P0/P1). Route/component
 * blockers only apply to primary screens; supporting UI can lack them. */
const isPrimary = (screen: ScreenItem): boolean =>
    isP0(screen) || screen.priority === 'P1' || screen.priority === 'secondary';

const displayPriority = (screen: ScreenItem): string | undefined => {
    switch (screen.priority) {
        case 'P0': case 'core': return 'P0';
        case 'P1': case 'secondary': return 'P1';
        case 'P2': case 'supporting': return 'P2';
        case 'P3': return 'P3';
        default: return undefined;
    }
};

const clean = (values: readonly (string | undefined | null)[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of values) {
        const t = v?.trim();
        if (!t) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
    }
    return out;
};

const trimSentence = (text: string): string => text.trim().replace(/\.+$/, '');

/** Turn a screen/UI label into a conventional PascalCase component name. */
function toComponentName(label: string): string {
    const cleaned = label.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
    if (!cleaned) return 'Component';
    return cleaned
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join('');
}

/** Turn a label into a camelCase-ish handler name: onSelectRole, onSubmit… */
function toEventName(base: string): string {
    const parts = base.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'onEvent';
    const pascal = parts.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
    return `on${pascal}`;
}

// --- Route -------------------------------------------------------------------

/** Small map of conventional routes for common screen names, so a derived route
 * reads naturally (Landing → `/`, Settings → `/settings`). Not authoritative —
 * every derived route is labeled `derived` and "confirm before building". */
const KNOWN_ROUTE_KEYWORDS: Array<{ match: RegExp; path: string }> = [
    { match: /\b(landing|home|welcome|role selection)\b/i, path: '/' },
    { match: /\bdashboard\b/i, path: '/dashboard' },
    { match: /\bsettings?\b/i, path: '/settings' },
    { match: /\b(sign ?in|log ?in)\b/i, path: '/login' },
    { match: /\b(sign ?up|register|onboarding)\b/i, path: '/signup' },
    { match: /\bprofile\b/i, path: '/profile' },
    { match: /\b(search|results?)\b/i, path: '/search' },
];

/** Derive the route/page a screen maps to. Prefers the generated handoff route
 * (explicit); falls back to a small keyword map / slug of the title (derived).
 * Never claims a derived route is final. */
export function deriveHandoffRoute(screen: ScreenItem): HandoffRoute {
    const explicit = screen.handoff?.route?.trim();
    if (explicit) {
        const params = clean(screen.handoff?.routeParams ?? []);
        return {
            path: explicit,
            routeName: toComponentName(screen.name) + 'Page',
            confidence: 'explicit',
            notes: params.length > 0 ? [`Route params: ${params.join(', ')}`] : [],
        };
    }
    const name = screen.name?.trim();
    if (!name) {
        return { confidence: 'missing', notes: ['No screen name to derive a route from.'] };
    }
    const known = KNOWN_ROUTE_KEYWORDS.find(k => k.match.test(name));
    const path = known ? known.path : `/${slugifyScreenName(name)}`;
    return {
        path,
        routeName: toComponentName(name) + 'Page',
        confidence: 'derived',
        notes: ['Derived from the screen name — confirm before building.'],
    };
}

// --- Components ---------------------------------------------------------------

/** Derive the components to build for a screen. Prefers the generated handoff
 * `primaryComponents`; falls back to the spec's core UI regions, then to a
 * single derived shell named from the title. Also folds in the mockup screen's
 * own UI elements (source 'mockup') when they add coverage. */
export function deriveHandoffComponents(
    screen: ScreenItem,
    mockupElements?: readonly string[],
): HandoffComponent[] {
    const out: HandoffComponent[] = [];
    const seen = new Set<string>();
    const push = (name: string, source: HandoffComponentSource, required: boolean) => {
        const key = name.toLowerCase();
        if (!name || seen.has(key)) return;
        seen.add(key);
        out.push({ name, source, required });
    };

    const handoffComponents = clean(screen.handoff?.primaryComponents ?? []);
    for (const c of handoffComponents) push(toComponentName(c), 'handoff', true);

    if (out.length === 0) {
        const core = clean(
            (screen.coreUIElements && screen.coreUIElements.length > 0)
                ? screen.coreUIElements
                : screen.components ?? [],
        );
        for (const c of core) push(toComponentName(c), 'core_ui', true);
    }

    for (const c of clean(mockupElements ?? [])) push(toComponentName(c), 'mockup', false);

    if (out.length === 0 && screen.name?.trim()) {
        push(toComponentName(screen.name), 'derived', true);
    }
    return out;
}

// --- State --------------------------------------------------------------------

/** Derive the client state entries a screen implies. Prefers the generated
 * handoff `stateVariables` (source 'handoff'); adds a state entry per documented
 * required UI state (source 'screen_state'); when neither exists, a light
 * derived selection/status entry for a primary screen. */
export function deriveHandoffState(screen: ScreenItem): HandoffStateEntry[] {
    const out: HandoffStateEntry[] = [];
    const seen = new Set<string>();
    const push = (name: string, source: HandoffStateSource, purpose?: string) => {
        const key = name.toLowerCase();
        if (!name || seen.has(key)) return;
        seen.add(key);
        out.push({ name, source, purpose });
    };

    for (const v of clean(screen.handoff?.stateVariables ?? [])) push(v, 'handoff');

    for (const state of screen.states ?? []) {
        const stateName = state.name?.trim();
        if (!stateName) continue;
        if (state.type === 'default') continue;
        // A UI state usually maps to a status/flag rather than a data variable.
        const varName = `${slugifyScreenName(stateName).replace(/-/g, '_')}_state`;
        push(varName, 'screen_state', state.description?.trim() || state.trigger?.trim() || undefined);
    }

    if (out.length === 0 && isPrimary(screen)) {
        push('viewStatus', 'derived', 'Loading / ready / error status for this screen (derived).');
    }
    return out;
}

// --- Events -------------------------------------------------------------------

/** Derive the interaction events a screen needs. Prefers the generated handoff
 * `events` (source 'handoff'); adds events derived from exit paths (source
 * 'derived') and the flow user-actions referencing this screen (source 'flow'). */
export function deriveHandoffEvents(
    screen: ScreenItem,
    flowUserActions: readonly string[] = [],
): HandoffEvent[] {
    const out: HandoffEvent[] = [];
    const seen = new Set<string>();
    const push = (event: HandoffEvent) => {
        const key = event.name.toLowerCase();
        if (!event.name || seen.has(key)) return;
        seen.add(key);
        out.push(event);
    };

    for (const e of screen.handoff?.events ?? []) {
        const name = e.name?.trim();
        if (!name) continue;
        push({
            name: name.startsWith('on') ? name : toEventName(name),
            trigger: e.trigger?.trim() || undefined,
            expectedOutcome: e.effect?.trim() || undefined,
            source: 'handoff',
        });
    }

    for (const exit of screen.exitPaths ?? []) {
        const label = exit.label?.trim();
        if (!label) continue;
        push({
            name: toEventName(label),
            trigger: label,
            expectedOutcome: exit.target?.trim() ? `Navigate to ${trimSentence(exit.target)}` : undefined,
            source: 'derived',
        });
    }

    for (const action of clean(flowUserActions)) {
        // Flow user actions read like "User selects a role" — turn the verb
        // phrase into a handler. Keep only the first few to avoid noise.
        push({ name: toEventName(action), trigger: action, source: 'flow' });
    }

    return out.slice(0, 12);
}

// --- Data dependencies --------------------------------------------------------

function classifyDataLabel(label: string): HandoffDataType {
    const lower = label.toLowerCase();
    if (/local ?storage|session ?storage|indexeddb|cache/.test(lower)) return 'storage';
    if (/\bapi\b|endpoint|\/|https?:|graphql|rest/.test(lower)) return 'api';
    if (/\bfield\b|column|attribute/.test(lower)) return 'field';
    return 'entity';
}

/** Derive the data a screen reads/writes. Combines generated handoff
 * data/api dependencies, the spec's outputData (writes), and entry inputs.
 * When nothing can be found, returns [] — the caller surfaces the
 * "No linked data model entities found" review warning. Everything is estimated
 * (source labels say so); we never claim a real Data Model trace exists. */
export function deriveHandoffDataDependencies(screen: ScreenItem): HandoffDataDependency[] {
    const out: HandoffDataDependency[] = [];
    const seen = new Set<string>();
    const push = (dep: HandoffDataDependency) => {
        const key = `${dep.label.toLowerCase()}|${dep.direction ?? ''}`;
        if (!dep.label || seen.has(key)) return;
        seen.add(key);
        out.push(dep);
    };

    const h = screen.handoff;
    for (const d of clean(h?.dataDependencies ?? [])) {
        push({ label: d, type: classifyDataLabel(d), direction: 'read_write', source: 'handoff' });
    }
    for (const a of clean(h?.apiDependencies ?? [])) {
        push({ label: a, type: 'api', direction: 'read_write', source: 'handoff' });
    }
    for (const o of clean(screen.outputData ?? [])) {
        push({ label: o, type: classifyDataLabel(o), direction: 'write', source: 'screen_outputs' });
    }
    return out;
}

// --- Mockup references --------------------------------------------------------

/** Project the derived variant grid into build-facing mockup references. Only
 * variants that hold a real generated image (legacy / per-variant) or are
 * user-accepted are listed as references; recommendedForBuild flags the default
 * + generated variants a developer should look at first. */
export function deriveHandoffMockupReferences(
    variants: readonly DerivedMockupVariant[],
): HandoffMockupReference[] {
    const out: HandoffMockupReference[] = [];
    for (const v of variants) {
        const hasImage = v.source === 'legacy' || v.source === 'variant';
        const accepted = v.status === 'accepted';
        if (!hasImage && !accepted) continue;
        out.push({
            variantId: v.id,
            label: formatVariantLabel(v),
            viewport: v.viewport,
            stateName: v.stateName,
            freshness: v.freshness?.status,
            coverage: v.coverageStatus,
            recommendedForBuild: hasImage,
        });
    }
    return out;
}

// --- QA checklist -------------------------------------------------------------

export interface QaChecklistSignals {
    acceptanceCriteria: readonly string[];
    mobileMissing: boolean;
    hasMockup: boolean;
    /** Freshness concern on a generated mockup (stale / possibly / unknown). */
    mockupFreshnessConcern: boolean;
}

/** Derive a practical QA checklist from the screen contract. Concise and
 * grouped by category (rendering / interaction / state / data / accessibility /
 * responsive / error handling / acceptance). Everything here is a restatement of
 * a fact the spec already carries; nothing is invented. */
export function deriveHandoffQaChecklist(
    screen: ScreenItem,
    signals: QaChecklistSignals,
): HandoffQaItem[] {
    const out: HandoffQaItem[] = [];
    let n = 0;
    const add = (
        label: string, category: HandoffQaCategory, source: HandoffQaSource, required: boolean,
    ) => {
        out.push({ id: `qa-${n++}`, label, category, source, required });
    };

    // Rendering — always applicable.
    add('Screen renders its primary layout without console errors.', 'rendering', 'derived', true);
    const components = (screen.coreUIElements?.length ? screen.coreUIElements : screen.components) ?? [];
    if (components.length > 0) {
        add('Core UI regions are present and populated.', 'rendering', 'derived', true);
    }

    // Interaction — from the user intent + exits.
    if (screen.userIntent?.trim()) {
        add(`User can ${trimSentence(screen.userIntent).toLowerCase()}.`, 'interaction', 'derived', true);
    }
    for (const exit of screen.exitPaths ?? []) {
        if (!exit.label?.trim() || !exit.target?.trim()) continue;
        add(`"${trimSentence(exit.label)}" navigates to ${trimSentence(exit.target)}.`, 'interaction', 'derived', false);
    }

    // State + error handling — from documented states.
    for (const state of screen.states ?? []) {
        const stateName = state.name?.trim();
        if (!stateName || state.type === 'default') continue;
        const category: HandoffQaCategory = state.type === 'error' ? 'error_handling' : 'state';
        const required = state.required === true;
        add(`The "${trimSentence(stateName)}" state renders as specified.`, category, 'states', required);
    }

    // Data — from output data / risks touching data.
    for (const out2 of clean(screen.outputData ?? [])) {
        add(`${trimSentence(out2)} is persisted / read from the expected source.`, 'data', 'derived', false);
    }

    // Risks → error-handling checks.
    const riskDescriptions = (screen.riskDetails && screen.riskDetails.length > 0)
        ? screen.riskDetails.map(r => r.description)
        : (screen.risks ?? []);
    for (const risk of clean(riskDescriptions)) {
        add(`Edge case handled: ${trimSentence(risk)}.`, 'error_handling', 'risks', false);
    }

    // Responsive / mockups.
    if (signals.mobileMissing) {
        add('Mobile layout remains usable (mobile mockup recommended).', 'responsive', 'mockups', false);
    } else if (signals.hasMockup) {
        add('Layout matches the generated mockup at desktop and mobile.', 'responsive', 'mockups', false);
    }
    if (signals.mockupFreshnessConcern) {
        add('Confirm the mockup still matches the current screen spec before building.', 'rendering', 'mockups', false);
    }

    // Accessibility — from handoff notes, else a light default.
    const a11y = clean(screen.handoff?.accessibilityNotes ?? []);
    if (a11y.length > 0) {
        for (const note of a11y) add(trimSentence(note) + '.', 'accessibility', 'derived', false);
    } else {
        add('Interactive elements are keyboard reachable and labeled.', 'accessibility', 'derived', false);
    }

    // Acceptance — the derived/generated criteria.
    for (const c of signals.acceptanceCriteria) {
        add(`Acceptance: ${trimSentence(c)}.`, 'acceptance', 'acceptance_criteria', true);
    }

    return out;
}

// --- Build tasks --------------------------------------------------------------

export interface BuildTaskSignals {
    route: HandoffRoute;
    components: readonly HandoffComponent[];
    state: readonly HandoffStateEntry[];
    dataDependencies: readonly HandoffDataDependency[];
    hasStateVariants: boolean;
    hasMockup: boolean;
    isP0: boolean;
}

/** Derive a small, hand-to-a-developer build-task list from the handoff pieces.
 * Not a project manager — just the obvious steps, each with a `source` so the
 * user understands why it exists. Priority: P0 / acceptance-critical → must;
 * recommended states/mockup review → should; polish → could. */
export function deriveHandoffBuildTasks(
    screen: ScreenItem,
    signals: BuildTaskSignals,
): HandoffBuildTask[] {
    const out: HandoffBuildTask[] = [];
    let n = 0;
    const add = (
        title: string, description: string, category: HandoffTaskCategory,
        priority: HandoffTaskPriority, source: string,
    ) => {
        out.push({ id: `task-${n++}`, title, description, category, priority, source });
    };

    const title = screen.name?.trim() || 'this screen';
    const mustOrShould: HandoffTaskPriority = signals.isP0 ? 'must' : 'should';

    // 1. Route / page shell.
    add(
        `Create the route and page shell for ${title}`,
        signals.route.path
            ? `Wire the ${signals.route.confidence === 'explicit' ? '' : 'derived '}route ${signals.route.path}.`
            : 'Add the route and page shell.',
        'route', mustOrShould,
        signals.route.confidence === 'explicit' ? 'Generated handoff route' : 'Derived route',
    );

    // 2. Components.
    if (signals.components.length > 0) {
        const names = signals.components.slice(0, 4).map(c => c.name).join(', ');
        add(
            `Build the components for ${title}`,
            `Implement ${names}${signals.components.length > 4 ? ', …' : ''}.`,
            'component', mustOrShould, 'Screen UI regions / handoff components',
        );
    }

    // 3. State.
    if (signals.state.length > 0) {
        add(
            `Implement screen state for ${title}`,
            `Wire ${signals.state.slice(0, 4).map(s => s.name).join(', ')}${signals.state.length > 4 ? ', …' : ''}.`,
            'state', mustOrShould, 'Screen states / handoff state variables',
        );
    }

    // 4. Data.
    if (signals.dataDependencies.length > 0) {
        add(
            `Wire data dependencies for ${title}`,
            `Read/write ${signals.dataDependencies.slice(0, 4).map(d => d.label).join(', ')}${signals.dataDependencies.length > 4 ? ', …' : ''}.`,
            'data', 'should', 'Screen data dependencies',
        );
    }

    // 5. States (empty / loading / error).
    const nonDefaultStates = (screen.states ?? []).filter(s => s.name?.trim() && s.type !== 'default');
    if (nonDefaultStates.length > 0) {
        add(
            `Add empty / loading / error states for ${title}`,
            `Cover ${nonDefaultStates.slice(0, 4).map(s => s.name).join(', ')}${nonDefaultStates.length > 4 ? ', …' : ''}.`,
            'state', 'should', 'Documented screen states',
        );
    }

    // 6. Mockup review.
    if (signals.hasMockup || signals.hasStateVariants) {
        add(
            `Verify desktop and mobile mockups for ${title}`,
            'Check the implementation against the generated mockup variants.',
            'mockup', 'should', 'Mockup variants',
        );
    }

    // 7. Accessibility.
    add(
        `Confirm accessibility for ${title}`,
        'Keyboard reachability, focus order, and labels for interactive elements.',
        'accessibility', 'could', 'Accessibility review',
    );

    // 8. QA.
    add(
        `Add QA coverage for ${title}`,
        'Cover the acceptance criteria and required states in tests.',
        'qa', mustOrShould, 'Acceptance criteria',
    );

    return out;
}

// --- Readiness ----------------------------------------------------------------

export interface HandoffReadinessSignals {
    isP0: boolean;
    isPrimary: boolean;
    userStatus?: ScreenReviewStatus;
    systemReadiness: SystemReadinessStatus;
    blockingCount: number;
    reviewCount: number;
    reviewFreshness: ScreenReviewFreshnessStatus;
    hasAcceptanceCriteria: boolean;
    /** At least a route OR a component can be offered for this screen. */
    hasRouteOrComponentGuidance: boolean;
    /** Any generated mockup reads stale / possibly-stale / unknown. */
    mockupFreshnessConcern: boolean;
    /** A recommended Mobile default variant is missing. */
    mobileMissing: boolean;
    /** No data dependencies could be derived at all (missing trace). */
    dataDependenciesMissing: boolean;
    /** Developer handoff is thin (no route + no components + no events). */
    handoffThin: boolean;
    /** A blocking downstream implementation impact exists (Phase 4B). */
    downstreamBlocking: boolean;
    /**
     * Phase 5B trace signals (all optional — only set when the corresponding
     * artifact was provided AND present, so a missing/unloaded artifact never
     * nags). A present-but-unmatched artifact is review-worthy, never blocking.
     */
    /** Data Model exists and carries data reqs but no entity matched. */
    dataModelTraceMissing?: boolean;
    /** Implementation Plan exists but no task matched an accepted P0 screen. */
    planBridgeMissing?: boolean;
    /** Overall trace confidence is weak/estimated for a critical P0 screen. */
    traceConfidenceWeakForP0?: boolean;
}

const signedOff = (status: ScreenReviewStatus | undefined): boolean =>
    status === 'accepted' || status === 'implementation_ready';

/**
 * Derive the per-screen implementation-readiness verdict from the Phase 4A/4B
 * signals plus the handoff completeness. Conservative and explainable — blocked
 * only on the clear cases; review-recommended is the honest common state; ready
 * requires sign-off + no blockers + minimal guidance.
 */
export function deriveHandoffReadiness(signals: HandoffReadinessSignals): ScreenImplementationReadinessDetail {
    const reasons: string[] = [];
    const blocked: string[] = [];

    // --- Blocked ---
    if (signals.systemReadiness === 'blocked' || signals.blockingCount > 0) {
        blocked.push('This screen has unresolved blocking readiness issues.');
    }
    if (signals.isP0 && !signedOff(signals.userStatus)) {
        blocked.push('This P0 screen has not been accepted yet.');
    }
    if (signals.isP0 && signedOff(signals.userStatus) && signals.reviewFreshness === 'outdated') {
        blocked.push('This P0 screen changed after it was signed off — re-review before building.');
    }
    if (signals.isP0 && signals.downstreamBlocking) {
        blocked.push('A blocking downstream implementation impact affects this P0 screen.');
    }
    if (!signals.hasAcceptanceCriteria) {
        blocked.push('No acceptance criteria could be derived for this screen.');
    }
    if (signals.isPrimary && !signals.hasRouteOrComponentGuidance) {
        blocked.push('No route or component guidance could be derived for this primary screen.');
    }

    if (blocked.length > 0) {
        return {
            status: 'blocked',
            reasons: blocked,
            blockingCount: blocked.length,
            reviewCount: 0,
        };
    }

    // --- Review recommended ---
    if (signedOff(signals.userStatus) && signals.reviewCount > 0) {
        reasons.push('Accepted, but Synapse still flags review items — confirm before building.');
    }
    if (!signedOff(signals.userStatus) && !signals.isP0) {
        reasons.push('This supporting screen is not signed off yet.');
    }
    if (signals.mockupFreshnessConcern) {
        reasons.push('One or more mockups may be out of date or unverified.');
    }
    if (signals.mobileMissing) {
        reasons.push('A recommended mobile mockup is missing.');
    }
    if (signals.dataDependenciesMissing) {
        reasons.push('No linked data model entities found — review data dependencies before implementation.');
    }
    if (signals.dataModelTraceMissing) {
        reasons.push('This screen has data dependencies but no matched Data Model entities — review before implementation.');
    }
    if (signals.planBridgeMissing) {
        reasons.push('No Implementation Plan tasks appear to build this screen — review plan coverage after accepting it.');
    }
    if (signals.traceConfidenceWeakForP0) {
        reasons.push('Downstream trace to the Data Model / Implementation Plan is estimated — confirm before building.');
    }
    if (signals.handoffThin) {
        reasons.push('Developer handoff detail (route, components, events) is thin.');
    }
    if (signals.reviewFreshness === 'outdated') {
        reasons.push('This screen changed after it was reviewed.');
    }

    if (reasons.length > 0) {
        return {
            status: 'review_recommended',
            reasons,
            blockingCount: 0,
            reviewCount: reasons.length,
        };
    }

    return { status: 'ready', reasons: [], blockingCount: 0, reviewCount: 0 };
}

// --- Composite builder --------------------------------------------------------

export interface ScreenHandoffInput {
    item: ScreenExperienceItem;
    reviewModel: ScreenReviewModel;
    variants: readonly DerivedMockupVariant[];
    downstream?: ScreenDownstreamImpact;
    features?: readonly Feature[];
    /**
     * Phase 5B trace inputs — the already-loaded Data Model and Implementation
     * Plan content. `undefined` (omitted) → no trace bridge is computed (Phase
     * 5A behavior, for legacy/test callers). `null` → the artifact genuinely
     * does not exist yet (an info note, never a review nag). Content → the
     * bridge correlates against it. The workspace always passes both.
     */
    dataModel?: DataModelContent | null;
    implementationPlan?: StructuredImplementationPlan | null;
}

/** Build the full implementation handoff for one joined screen. Derives every
 * section from the existing layers (screen contract, review model, variant grid,
 * downstream impact) — pure, read-time, never persisted. */
export function buildScreenImplementationHandoff(input: ScreenHandoffInput): ScreenImplementationHandoff {
    const { item, reviewModel, variants, downstream, features } = input;
    const screen = item.screen;

    const flowUserActions = item.relatedFlows
        .map(ref => ref.step.userAction)
        .filter((a): a is string => Boolean(a?.trim()));

    const route = deriveHandoffRoute(screen);
    const components = deriveHandoffComponents(screen, item.mockupScreen?.coreUIElements);
    const state = deriveHandoffState(screen);
    const events = deriveHandoffEvents(screen, flowUserActions);
    const dataDependencies = deriveHandoffDataDependencies(screen);
    const mockupReferences = deriveHandoffMockupReferences(variants);
    const { criteria: acceptanceCriteria } = resolveAcceptanceCriteria(screen);

    // Phase 5B: read-only trace bridge — correlate this screen with the Data
    // Model and Implementation Plan artifacts, then upgrade the estimated data
    // dependencies with real matches. Computed only when trace inputs were
    // provided (see ScreenHandoffInput); undefined inputs preserve Phase 5A.
    const traceProvided = input.dataModel !== undefined || input.implementationPlan !== undefined;
    let traceBridge: ScreenArtifactTraceBridge | undefined;
    let implementationPlanReferences: ScreenImplementationPlanMatch[] | undefined;
    if (traceProvided) {
        const traceContext: ScreenTraceContext = {
            screenId: item.id,
            screenTitle: screen.name || item.id,
            isP0: isP0(screen),
            featureRefs: screen.featureRefs ?? [],
            route: route.path,
            routeExplicit: route.confidence === 'explicit',
            components: components.map(c => c.name),
            dataLabels: dataDependencies.map(d => d.label),
            hasDataRequirements: dataDependencies.length > 0,
        };
        traceBridge = buildScreenArtifactTraceBridge(
            traceContext, input.dataModel ?? null, input.implementationPlan ?? null,
        );
        implementationPlanReferences = traceBridge.implementationPlan.matches;
        upgradeDataDependencies(dataDependencies, traceBridge);
    }

    const mobileMissing = variants.some(
        v => v.viewport === 'mobile' && v.stateType === 'default' && v.status === 'missing',
    );
    const hasMockup = variants.some(v => v.source === 'legacy' || v.source === 'variant');
    const mockupFreshnessConcern = variants.some(
        v => v.freshness && (v.freshness.status === 'stale' || v.freshness.status === 'possibly_stale'
            || v.freshness.status === 'unknown'),
    );
    const hasStateVariants = variants.some(v => v.stateType !== 'default');

    const qaChecklist = deriveHandoffQaChecklist(screen, {
        acceptanceCriteria,
        mobileMissing,
        hasMockup,
        mockupFreshnessConcern,
    });

    const buildTasks = deriveHandoffBuildTasks(screen, {
        route,
        components,
        state,
        dataDependencies,
        hasStateVariants,
        hasMockup,
        isP0: isP0(screen),
    });

    // Trace — reuse the existing traceability resolver so ids/confidence match
    // the Overview tab.
    const traceability = buildScreenTraceability(item, features);
    const traceFeatures = traceability.features
        .map(l => l.feature ? `${l.feature.id} ${l.feature.name}` : l.raw)
        .filter(Boolean);
    const traceWarnings: string[] = [];
    if (traceability.confidence === 'missing') {
        traceWarnings.push('No PRD features are linked to this screen.');
    } else if (traceability.invalidRefIds.length > 0) {
        traceWarnings.push(`Some linked feature ids no longer match the PRD: ${traceability.invalidRefIds.join(', ')}.`);
    }
    if (dataDependencies.length === 0) {
        traceWarnings.push('No linked data model entities found. Review recommended before implementation.');
    }

    const downstreamBlocking = downstream?.summary.hasBlockingImpact ?? false;
    const handoffThin = !route.path && components.length === 0 && events.length === 0;

    // Phase 5B readiness signals — only fire when the artifact was PRESENT and
    // produced no/weak match (a missing/unloaded artifact never nags).
    const signedOffP0 = isP0(screen) && signedOff(reviewModel.userStatus);
    const dataModelTraceMissing = Boolean(
        input.dataModel && traceBridge && traceBridge.dataModel.confidence === 'missing'
        && dataDependencies.length > 0,
    );
    const planBridgeMissing = Boolean(
        input.implementationPlan && traceBridge && traceBridge.implementationPlan.confidence === 'missing'
        && signedOffP0,
    );
    const traceConfidenceWeakForP0 = Boolean(
        isP0(screen) && traceBridge
        && traceBridge.overall.confidence !== 'missing'
        && (traceBridge.overall.confidence === 'weak' || traceBridge.overall.confidence === 'estimated'),
    );

    const readiness = deriveHandoffReadiness({
        isP0: isP0(screen),
        isPrimary: isPrimary(screen),
        userStatus: reviewModel.userStatus,
        systemReadiness: reviewModel.systemReadiness,
        blockingCount: reviewModel.blockingCount,
        reviewCount: reviewModel.reviewCount,
        reviewFreshness: reviewModel.freshness,
        hasAcceptanceCriteria: acceptanceCriteria.length > 0,
        hasRouteOrComponentGuidance: Boolean(route.path) || components.length > 0,
        mockupFreshnessConcern,
        mobileMissing,
        dataDependenciesMissing: dataDependencies.length === 0,
        handoffThin,
        downstreamBlocking,
        dataModelTraceMissing,
        planBridgeMissing,
        traceConfidenceWeakForP0,
    });

    return {
        screenId: item.id,
        screenTitle: screen.name || item.id,
        priority: displayPriority(screen),
        readiness,
        route,
        components,
        state,
        events,
        dataDependencies,
        mockupReferences,
        acceptanceCriteria,
        qaChecklist,
        buildTasks,
        trace: {
            prdFeatures: traceFeatures,
            userFlows: traceability.flows,
            relatedArtifacts: mockupReferences.length > 0 ? ['mockups'] : [],
            estimated: true,
            warnings: traceWarnings,
        },
        traceBridge,
        implementationPlanReferences,
    };
}

/**
 * Phase 5B: overlay Data Model trace matches onto the estimated data
 * dependencies, upgrading `source` → 'data_model_trace' and stamping the matched
 * entity/field + confidence. Mutates the passed array in place (it is freshly
 * derived). Never fabricates a match — a dependency with no matched entity/field
 * keeps its original estimated source.
 */
function upgradeDataDependencies(
    deps: HandoffDataDependency[],
    bridge: ScreenArtifactTraceBridge,
): void {
    for (const dep of deps) {
        const depLabel = normalizeTraceLabel(dep.label);
        let best: { entity: string; field?: string; confidence: TraceConfidence } | undefined;
        for (const m of bridge.dataModel.matches) {
            // Field-level match first (more specific).
            const field = m.fields?.find(f => normalizeTraceLabel(f.name) === depLabel
                || normalizeTraceLabel(`${m.entityName} ${f.name}`) === depLabel);
            if (field) {
                if (!best || CONFIDENCE_RANK_LOCAL[field.confidence] > CONFIDENCE_RANK_LOCAL[best.confidence]) {
                    best = { entity: m.entityName, field: field.name, confidence: field.confidence };
                }
                continue;
            }
            if (normalizeTraceLabel(m.entityName) === depLabel
                || singularTrace(normalizeTraceLabel(m.entityName)) === singularTrace(depLabel)) {
                if (!best || CONFIDENCE_RANK_LOCAL[m.confidence] > CONFIDENCE_RANK_LOCAL[best.confidence]) {
                    best = { entity: m.entityName, confidence: m.confidence };
                }
            }
        }
        if (best) {
            dep.source = 'data_model_trace';
            dep.matchedEntity = best.entity;
            dep.matchedField = best.field;
            dep.confidence = best.confidence;
        }
    }
}

const CONFIDENCE_RANK_LOCAL: Record<TraceConfidence, number> = {
    missing: 0, estimated: 1, weak: 2, strong: 3, explicit: 4,
};
const normalizeTraceLabel = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const singularTrace = (s: string): string => (s.length > 3 && s.endsWith('s') ? s.slice(0, -1) : s);

// --- Artifact-level rollup ----------------------------------------------------

/** Phase 5B: artifact-level rollup of the downstream trace confidence across
 * screens (only counts screens whose handoff carried a trace bridge). */
export interface ScreensTraceRollup {
    /** Screens with a computed trace bridge. */
    traced: number;
    /** Overall confidence explicit/strong. */
    strong: number;
    /** Overall confidence weak/estimated. */
    estimated: number;
    /** Overall confidence missing (both traces missing). */
    missing: number;
    /** P0 screens whose Implementation Plan trace is missing. */
    p0PlanMissing: number;
    /** P0 screens whose Data Model trace is missing but carry data deps. */
    p0DataModelMissing: number;
}

export interface ScreensHandoffRollup {
    total: number;
    ready: number;
    reviewRecommended: number;
    blocked: number;
    /** P0 screens whose handoff is ready. */
    p0Ready: number;
    p0Total: number;
    /** Overall verdict: ready only when every P0 screen's handoff is ready. */
    status: ScreenImplementationReadiness;
    message: string;
    /** Phase 5B trace rollup (null when no screen carried a trace bridge). */
    trace: ScreensTraceRollup | null;
}

export function buildScreensHandoffRollup(
    handoffs: readonly ScreenImplementationHandoff[],
    p0Ids: ReadonlySet<string>,
): ScreensHandoffRollup {
    let ready = 0;
    let reviewRecommended = 0;
    let blocked = 0;
    let p0Ready = 0;
    let p0Total = 0;
    let p0Blocked = 0;

    for (const h of handoffs) {
        if (h.readiness.status === 'ready') ready += 1;
        else if (h.readiness.status === 'review_recommended') reviewRecommended += 1;
        else blocked += 1;
        if (p0Ids.has(h.screenId)) {
            p0Total += 1;
            if (h.readiness.status === 'ready') p0Ready += 1;
            if (h.readiness.status === 'blocked') p0Blocked += 1;
        }
    }

    // Phase 5B trace rollup — only over screens that carried a trace bridge.
    let traced = 0, strong = 0, estimated = 0, missing = 0, p0PlanMissing = 0, p0DataModelMissing = 0;
    for (const h of handoffs) {
        const bridge = h.traceBridge;
        if (!bridge) continue;
        traced += 1;
        const oc = bridge.overall.confidence;
        if (oc === 'explicit' || oc === 'strong') strong += 1;
        else if (oc === 'weak' || oc === 'estimated') estimated += 1;
        else missing += 1;
        if (p0Ids.has(h.screenId)) {
            // Only count a PRESENT-but-unmatched artifact (warning-gated), never
            // an absent one — an absent plan/data-model is an info note, not a gap.
            if (bridge.implementationPlan.warnings.some(w => /No related Implementation Plan tasks/.test(w))) {
                p0PlanMissing += 1;
            }
            if (bridge.dataModel.warnings.some(w => /No linked Data Model entities/.test(w))) {
                p0DataModelMissing += 1;
            }
        }
    }
    const trace: ScreensTraceRollup | null = traced > 0
        ? { traced, strong, estimated, missing, p0PlanMissing, p0DataModelMissing }
        : null;

    let status: ScreenImplementationReadiness;
    if (p0Blocked > 0 || (p0Total > 0 && p0Ready < p0Total && blocked > 0)) status = 'blocked';
    else if (p0Total > 0 && p0Ready === p0Total && reviewRecommended === 0 && blocked === 0) status = 'ready';
    else status = 'review_recommended';

    let message: string;
    if (handoffs.length === 0) message = 'No screens to hand off yet.';
    else if (status === 'ready') {
        message = 'All P0 screens have accepted specs and build-ready handoff packages.';
    } else if (status === 'blocked') {
        message = 'Resolve P0 blockers before using these screens as build source.';
    } else {
        message = 'Some screens need review before their handoff packages are build-ready.';
    }

    return {
        total: handoffs.length,
        ready,
        reviewRecommended,
        blocked,
        p0Ready,
        p0Total,
        status,
        message,
        trace,
    };
}

// --- Preflight contribution ---------------------------------------------------

/** Handoff-derived additions to the Phase 4B implementation preflight. Kept in
 * this module (not screenDownstreamImpact) so the downstream layer never depends
 * on the handoff layer — the caller passes this into buildScreensPreflight. */
export interface HandoffPreflightContribution {
    blocking: string[];
    review: string[];
    info: string[];
    recommendedNextActions: string[];
}

export function buildHandoffPreflightContribution(
    handoffs: readonly ScreenImplementationHandoff[],
    p0Ids: ReadonlySet<string>,
): HandoffPreflightContribution {
    const blocking: string[] = [];
    const review: string[] = [];
    const info: string[] = [];
    const recommendedNextActions: string[] = [];

    for (const h of handoffs) {
        const isScreenP0 = p0Ids.has(h.screenId);
        if (h.readiness.status === 'blocked') {
            const reason = h.readiness.reasons[0] ?? 'handoff is blocked';
            blocking.push(`${h.screenTitle} handoff is blocked: ${reason.toLowerCase()}`);
        } else if (h.readiness.status === 'review_recommended' && isScreenP0) {
            const reason = h.readiness.reasons[0];
            if (reason) review.push(`${h.screenTitle}: ${reason.toLowerCase()}`);
        }
        if (h.route.confidence !== 'explicit' && isScreenP0) {
            info.push(`${h.screenTitle} uses a derived route — confirm before building.`);
        }
        // Phase 5B: fold in the trace bridge's own review guidance for P0 screens.
        // Only fire when the artifact was PRESENT-but-unmatched (its warning says
        // so) — never when the artifact is simply absent (a new/partial project
        // must not look like it has plan/data-model coverage defects).
        const bridge = h.traceBridge;
        if (bridge && isScreenP0) {
            if (bridge.dataModel.warnings.some(w => /No linked Data Model entities/.test(w))) {
                review.push(`${h.screenTitle} has data dependencies but no matched Data Model entities.`);
            }
            if (bridge.implementationPlan.warnings.some(w => /No related Implementation Plan tasks/.test(w))) {
                review.push(`${h.screenTitle} has no related Implementation Plan tasks.`);
            }
        }
    }

    // Prioritized next steps (capped to 5, deduped).
    const push = (a: string) => { if (a && !recommendedNextActions.includes(a)) recommendedNextActions.push(a); };
    for (const h of handoffs) {
        if (p0Ids.has(h.screenId) && h.readiness.status === 'blocked') {
            push(`Resolve the handoff blockers on ${h.screenTitle}.`);
        }
    }
    for (const h of handoffs) {
        if (p0Ids.has(h.screenId) && h.readiness.status === 'review_recommended') {
            push(`Review the handoff for ${h.screenTitle} before building.`);
        }
    }
    // Phase 5B trace-driven next steps for P0 screens.
    for (const h of handoffs) {
        if (!p0Ids.has(h.screenId) || !h.traceBridge) continue;
        for (const a of h.traceBridge.overall.recommendedActions) push(a);
    }
    if (handoffs.some(h => p0Ids.has(h.screenId)) && blocking.length === 0) {
        push('Copy the handoff for each P0 screen once its package is ready.');
    }

    return {
        blocking: blocking.slice(0, 6),
        review: review.slice(0, 8),
        info: info.slice(0, 4),
        recommendedNextActions: recommendedNextActions.slice(0, 5),
    };
}

// --- Markdown export ----------------------------------------------------------

const DATA_DIRECTION_LABELS: Record<HandoffDataDirection, string> = {
    read: 'read',
    write: 'write',
    read_write: 'read/write',
};

/** Render a copy-ready markdown handoff package for one screen. Covers the main
 * implementation sections; missing/estimated data is labeled, never fabricated. */
export function renderHandoffMarkdown(handoff: ScreenImplementationHandoff): string {
    const lines: string[] = [];
    const priority = handoff.priority ? ` (${handoff.priority})` : '';
    lines.push(`# ${handoff.screenTitle}${priority} — Implementation Handoff`);
    lines.push('');
    lines.push(`Status: ${IMPLEMENTATION_READINESS_LABELS[handoff.readiness.status]}`);
    if (handoff.readiness.reasons.length > 0) {
        for (const r of handoff.readiness.reasons) lines.push(`- ${r}`);
    }
    lines.push('');

    // Route
    lines.push('## Route');
    if (handoff.route.path) {
        const suffix = handoff.route.confidence === 'explicit'
            ? ''
            : ` — ${handoff.route.confidence} from screen (confirm before building)`;
        lines.push(`- \`${handoff.route.path}\`${suffix}`);
    } else {
        lines.push('- Not specified');
    }
    for (const note of handoff.route.notes) lines.push(`  - ${note}`);
    lines.push('');

    // Components
    lines.push('## Components');
    if (handoff.components.length > 0) {
        for (const c of handoff.components) lines.push(`- ${c.name}${c.required ? '' : ' (optional)'}`);
    } else {
        lines.push('- Not specified');
    }
    lines.push('');

    // State
    lines.push('## State');
    if (handoff.state.length > 0) {
        for (const s of handoff.state) lines.push(`- ${s.name}${s.purpose ? ` — ${s.purpose}` : ''}`);
    } else {
        lines.push('- Not specified');
    }
    lines.push('');

    // Events
    lines.push('## Events');
    if (handoff.events.length > 0) {
        for (const e of handoff.events) {
            const detail = [e.trigger, e.expectedOutcome].filter(Boolean).join(' → ');
            lines.push(`- ${e.name}${detail ? ` (${detail})` : ''}`);
        }
    } else {
        lines.push('- Not specified');
    }
    lines.push('');

    // Data dependencies
    lines.push('## Data Dependencies');
    if (handoff.dataDependencies.length > 0) {
        for (const d of handoff.dataDependencies) {
            const dir = d.direction ? ` — ${DATA_DIRECTION_LABELS[d.direction]}` : '';
            lines.push(`- ${d.label}${dir}`);
        }
    } else {
        lines.push('- No linked data model entities found. Review recommended before implementation.');
    }
    lines.push('');

    // Mockups
    lines.push('## Mockups to Reference');
    if (handoff.mockupReferences.length > 0) {
        for (const m of handoff.mockupReferences) {
            const bits: string[] = [];
            if (m.freshness) bits.push(`freshness: ${m.freshness}`);
            if (m.coverage) bits.push(`coverage: ${m.coverage}`);
            lines.push(`- ${m.label}${bits.length ? ` (${bits.join(', ')})` : ''}`);
        }
    } else {
        lines.push('- No generated mockups to reference yet.');
    }
    lines.push('');

    // Acceptance criteria
    lines.push('## Acceptance Criteria');
    if (handoff.acceptanceCriteria.length > 0) {
        for (const c of handoff.acceptanceCriteria) lines.push(`- ${c}`);
    } else {
        lines.push('- Not specified');
    }
    lines.push('');

    // QA checklist
    lines.push('## QA Checklist');
    if (handoff.qaChecklist.length > 0) {
        for (const q of handoff.qaChecklist) lines.push(`- ${q.label}`);
    } else {
        lines.push('- Not specified');
    }
    lines.push('');

    // Build tasks
    lines.push('## Build Tasks');
    if (handoff.buildTasks.length > 0) {
        handoff.buildTasks.forEach((t, i) => {
            lines.push(`${i + 1}. ${t.title} — ${t.description}`);
        });
    } else {
        lines.push('- Not specified');
    }
    lines.push('');

    // Phase 5B: downstream trace sections (only when a bridge was computed).
    const bridge = handoff.traceBridge;
    if (bridge) {
        lines.push('## Trace Confidence');
        lines.push(`- Data Model: ${TRACE_CONFIDENCE_MD[bridge.dataModel.confidence]}`);
        lines.push(`- Implementation Plan: ${TRACE_CONFIDENCE_MD[bridge.implementationPlan.confidence]}`);
        lines.push(`- Overall: ${TRACE_CONFIDENCE_MD[bridge.overall.confidence]}`);
        lines.push('');

        lines.push('## Data Model Support');
        if (bridge.dataModel.matches.length > 0) {
            for (const m of bridge.dataModel.matches) {
                lines.push(`- ${m.entityName} — ${TRACE_CONFIDENCE_MD[m.confidence]}`);
                if (m.fields && m.fields.length > 0) {
                    lines.push(`  - Fields: ${m.fields.map(f => f.name).join(', ')}`);
                }
                lines.push(`  - Reason: ${m.reason}`);
            }
        } else {
            lines.push('No linked Data Model entities found. Review recommended before implementation.');
        }
        lines.push('');

        lines.push('## Related Implementation Plan Items');
        if (bridge.implementationPlan.matches.length > 0) {
            for (const m of bridge.implementationPlan.matches) {
                const where = m.milestoneName ? ` (${m.milestoneName})` : '';
                lines.push(`- ${m.title}${where} — ${TRACE_CONFIDENCE_MD[m.confidence]}`);
                lines.push(`  - Reason: ${m.reason}`);
            }
        } else {
            lines.push('No related Implementation Plan tasks found. Review the Implementation Plan after accepting this screen.');
        }
        lines.push('');
    }

    // Trace
    lines.push('## Trace / Confidence');
    lines.push(`- PRD features: ${handoff.trace.prdFeatures.length > 0 ? handoff.trace.prdFeatures.join(', ') : 'none linked'}`);
    lines.push(`- User flows: ${handoff.trace.userFlows.length > 0 ? handoff.trace.userFlows.join(', ') : 'none'}`);
    for (const w of handoff.trace.warnings) lines.push(`- ${w}`);
    if (bridge) {
        for (const w of bridge.overall.warnings) lines.push(`- ${w}`);
    }
    lines.push('- All fields are estimated from the generated spec — confirm before building.');

    return lines.join('\n');
}

/** Confidence labels for the markdown export (matches the UI labels). */
const TRACE_CONFIDENCE_MD: Record<TraceConfidence, string> = {
    explicit: 'Explicit trace',
    strong: 'Strong match',
    weak: 'Weak match',
    estimated: 'Estimated',
    missing: 'Missing',
};
