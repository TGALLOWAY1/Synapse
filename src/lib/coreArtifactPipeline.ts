import type { ArtifactSlotKey, CoreArtifactSubtype } from '../types';

export interface CoreArtifactMeta {
    subtype: CoreArtifactSubtype;
    title: string;
    description: string;
    dependsOn: CoreArtifactSubtype[];
    /** Position in the UI (1 = top). Independent of generation/dependency order. */
    displayOrder: number;
}

// Pipeline is ordered so dependencies appear before dependents (topologically valid).
// Use CORE_ARTIFACT_DISPLAY_ORDER for UI rendering instead of this array.
//
// Dependency rule of thumb: only declare a dep when the dependent artifact
// genuinely needs the dep's *output* to be high quality (e.g. user_flows
// referencing screen names from screen_inventory). The PRD itself is in every
// prompt, so most artifacts can be generated independently from it. Spurious
// deps serialize the pipeline — buildDependencyLayers turns them into wait
// gates — which kneecaps parallelism with little quality benefit.
// `subtype` is the stable internal id and must not change — generation,
// routing, persisted artifacts, and per-artifact model overrides all key off
// it. `title`/`description` are display-only labels (shown in the artifact
// sidebar, settings model picker, and progress messages) and may be renamed
// freely. The grouping that drives the sidebar's visual sections lives in
// ArtifactWorkspace's ARTIFACT_GROUPS, which keys off subtype.
export const CORE_ARTIFACT_PIPELINE: CoreArtifactMeta[] = [
    {
        subtype: 'user_flows',
        title: 'User Flows',
        description: 'Primary user journeys and key flows',
        dependsOn: ['screen_inventory'],
        displayOrder: 1,
    },
    {
        subtype: 'screen_inventory',
        title: 'Screen Inventory',
        description: 'Structured list of screens and views',
        dependsOn: [],
        displayOrder: 2,
    },
    {
        subtype: 'component_inventory',
        title: 'UI Components',
        description: 'Reusable components and patterns',
        dependsOn: ['screen_inventory'],
        displayOrder: 3,
    },
    {
        subtype: 'design_system',
        title: 'Design System',
        description: 'Foundational UI system and styles',
        dependsOn: [],
        displayOrder: 4,
    },
    {
        subtype: 'data_model',
        title: 'Data Model',
        description: 'Entities, relationships, and data schema',
        dependsOn: [],
        displayOrder: 5,
    },
    {
        // RETIRED (see RETIRED_ARTIFACT_SUBTYPES): standalone Developer
        // Prompts no longer generate — the implementation_plan artifact now
        // carries milestone-centered prompt packs. The meta stays so legacy
        // persisted prompt_pack artifacts keep their title, renderer, and
        // export path, and getArtifactMeta never throws for them.
        subtype: 'prompt_pack',
        title: 'Developer Prompts',
        description: 'AI prompts for downstream tasks',
        dependsOn: ['implementation_plan', 'design_system', 'data_model'],
        displayOrder: 6,
    },
    {
        subtype: 'implementation_plan',
        title: 'Implementation Plan',
        description: 'Milestones and copy-ready prompt packs',
        // True data deps: the consolidated plan links milestones to screen and
        // entity names and writes prompt packs that reference them, so it
        // needs those artifacts' output as prompt context.
        //
        // user_flows is a DELIBERATE dep (W2, docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md
        // §W2): flows carry the alternate/error journeys the plan must turn
        // into engineering work — without the edge the plan reads "current"
        // while the artifact defining those journeys is stale or absent, and
        // its prompt never sees them. Because user_flows itself depends on
        // screen_inventory, this makes the active pipeline THREE layers deep;
        // the added wall-clock (~one user_flows run before the plan starts)
        // was weighed and accepted in that plan doc. Do NOT remove the edge to
        // "restore parallelism" — that re-opens the audited defect. The depth
        // test in coreArtifactPipeline.test.ts documents the accepted shape.
        // Note user_flows stays OUT of REQUIRED_DEPENDENCIES below: plan
        // generation waits for flows but is not blocked when they are
        // missing/errored (degraded context instead).
        dependsOn: ['screen_inventory', 'data_model', 'user_flows'],
        displayOrder: 7,
    },
];

/** Artifacts sorted for UI display. Iteration order does NOT respect dependencies. */
export const CORE_ARTIFACT_DISPLAY_ORDER: CoreArtifactMeta[] =
    CORE_ARTIFACT_PIPELINE.slice().sort((a, b) => a.displayOrder - b.displayOrder);

// A subset of each artifact's `dependsOn` that is genuinely REQUIRED: the
// dependent cannot be meaningfully generated without the dependency's output.
// Missing required dependencies (not generated, errored, or empty) block
// generation unless the user acknowledges degraded generation. Every other
// declared dependency is treated as optional context. Keep this conservative —
// over-marking a dep as required needlessly blocks generation.
export const REQUIRED_DEPENDENCIES: Partial<Record<CoreArtifactSubtype, CoreArtifactSubtype[]>> = {
    // Flows reference specific screens by name — without the inventory they'd be
    // invented.
    user_flows: ['screen_inventory'],
    // The consolidated plan links milestones/prompt packs to concrete screens
    // and entities; both are required for a trustworthy, traceable plan.
    // user_flows is deliberately NOT required (W2): generation waits for
    // flows (dependsOn) but proceeds with degraded context when they are
    // missing/errored — the gap then surfaces via the dependency graph's
    // impactedBy, not as a generation blocker.
    implementation_plan: ['screen_inventory', 'data_model'],
};

export function getRequiredDependencies(subtype: CoreArtifactSubtype): CoreArtifactSubtype[] {
    return REQUIRED_DEPENDENCIES[subtype] ?? [];
}

// Upstream core artifacts the mockup spec builder consumes (screen list,
// component tags, design tokens). Lives here — next to the pipeline it
// extends — so the artifact dependency graph and the job controller share
// one definition. The design_system ref additionally carries the tokensHash
// via SourceRef.anchorInfo (see artifactJobController.runMockupSlot).
export const MOCKUP_DEPENDENCIES: CoreArtifactSubtype[] = [
    'screen_inventory',
    'component_inventory',
    'design_system',
];

// Subtypes that are still *generated* (they remain in CORE_ARTIFACT_PIPELINE and
// MOCKUP_DEPENDENCIES so downstream consumers like mockups keep working) but are
// **hidden from every user-facing surface**. This is the single source of truth
// for "hidden": it drives the sidebar omission (ArtifactWorkspace.buildSlotMetas),
// the output-completion signal (ProjectWorkspace.assetsReady), the export list
// (ExportModal), the dependency graph's visible nodes
// (artifactDependencyGraph.isVisibleSubtype), and the auto-resume decision
// (artifactJobController.resumeIfNeeded).
//
// LOAD-BEARING RULE (unchanged, and it is why the set is empty today): **a
// hidden artifact must never gate user-facing readiness or trigger an invisible
// retry loop**, because the user has no surface on which to see its status or
// retry it. If you hide a subtype, the readiness/auto-resume filters above must
// keep excluding it.
//
// **The set is currently EMPTY.** `component_inventory` was the last member and
// was unhidden by W4 of docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md: it feeds
// every mockup through MOCKUP_DEPENDENCIES, so an invisible failure silently
// degraded the product. It now renders through
// `ComponentInventoryRenderer` inside the **Components section of the Screens
// experience** (`ScreenComponentsSection`) — which is also where its slot status
// and Retry live. It is deliberately NOT in `ARTIFACT_GROUPS`, so it still has
// no sidebar row of its own (same treatment as `screen_inventory`/`mockup`);
// "no row" is a layout choice, "hidden" is a visibility contract — do not
// conflate them. Two consequences of unhiding are intentional and tested: the
// slot now gates `assetsReady`, and `resumeIfNeeded` will auto-wake for it.
//
// The mechanism is retained (empty, not deleted) so a future subtype can be
// hidden without re-deriving the rule — `expandWithHiddenDependencyClosure`
// below stays as the closure guard hidden subtypes require, and takes an
// injectable predicate so it remains directly testable while the set is empty.
export const HIDDEN_ARTIFACT_SUBTYPES: ReadonlySet<CoreArtifactSubtype> =
    new Set<CoreArtifactSubtype>([]);

export const isHiddenArtifactSubtype = (subtype: CoreArtifactSubtype): boolean =>
    HIDDEN_ARTIFACT_SUBTYPES.has(subtype);

// Subtypes that are fully retired from **new generation**: no sidebar row, no
// slot in new runs, no Settings model row — stronger than HIDDEN (which still
// generates). The subtype stays in the type union and CORE_ARTIFACT_PIPELINE
// so legacy persisted artifacts keep rendering/exporting, and their content is
// consumed by newer views (the Implementation Plan adapter reads legacy
// prompt_pack artifacts). Retired subtypes must never gate readiness, never
// appear in pendingSlotsForSpine, and never surface a generation-config row.
export const RETIRED_ARTIFACT_SUBTYPES: ReadonlySet<CoreArtifactSubtype> = new Set<CoreArtifactSubtype>([
    'prompt_pack',
]);

export const isRetiredArtifactSubtype = (subtype: CoreArtifactSubtype): boolean =>
    RETIRED_ARTIFACT_SUBTYPES.has(subtype);

/**
 * Core subtypes that are user-visible: neither hidden nor retired. The shared
 * definition behind the output-completion signal
 * (`ProjectWorkspace.assetsReady`) — so "which outputs must exist before we tell
 * the user their outputs are ready" has exactly one answer, and unhiding a
 * subtype changes that gate in one place. In display order.
 *
 * Note `component_inventory` IS in this list since W4 — the gate is intentional
 * and only safe because the Components section in the Screens experience gives
 * the slot a visible status and a Retry (see HIDDEN_ARTIFACT_SUBTYPES above).
 */
export function visibleCoreSubtypes(): CoreArtifactSubtype[] {
    return CORE_ARTIFACT_DISPLAY_ORDER
        .filter(meta => !isHiddenArtifactSubtype(meta.subtype) && !isRetiredArtifactSubtype(meta.subtype))
        .map(meta => meta.subtype);
}

/**
 * Expand an explicit regeneration batch with the hidden-subtype dependency
 * closure. Hidden subtypes still generate and feed visible dependents, but the
 * dependency graph collapses them out of the UI, so a graph-driven batch never
 * names them. Without this expansion, a batch like [screen_inventory, …,
 * mockup] would rebuild the mockup against a hidden input generated from the
 * OLD screen inventory (or none at all), and resumeIfNeeded deliberately never
 * wakes a hidden-only pending slot afterwards.
 *
 * A hidden subtype is added when some requested slot consumes it (directly)
 * AND either (a) one of its own inputs is also being regenerated — it will be
 * stale the moment the batch runs — or (b) it is not currently done for this
 * spine (missing/errored), per the `isSlotDone` callback. Runs to a fixed
 * point so hidden-on-hidden chains close too. Pure: the controller supplies
 * the store-backed `isSlotDone`.
 *
 * **`HIDDEN_ARTIFACT_SUBTYPES` is empty today** (W4 unhid `component_inventory`),
 * so in production this is currently an identity function — a graph batch now
 * names every input directly. The mechanism is retained because the rule it
 * enforces returns the moment anything is hidden again; `isHidden` is injectable
 * purely so that behavior stays unit-testable with a synthetic hidden set.
 */
export function expandWithHiddenDependencyClosure(
    slots: ArtifactSlotKey[],
    isSlotDone: (subtype: CoreArtifactSubtype) => boolean,
    isHidden: (subtype: CoreArtifactSubtype) => boolean = isHiddenArtifactSubtype,
): ArtifactSlotKey[] {
    const requested = new Set<ArtifactSlotKey>(slots);
    let changed = true;
    while (changed) {
        changed = false;
        for (const meta of CORE_ARTIFACT_PIPELINE) {
            if (!isHidden(meta.subtype) || requested.has(meta.subtype)) continue;
            const consumers: ArtifactSlotKey[] = [
                ...CORE_ARTIFACT_PIPELINE
                    .filter(m => !isRetiredArtifactSubtype(m.subtype) && m.dependsOn.includes(meta.subtype))
                    .map(m => m.subtype),
                ...(MOCKUP_DEPENDENCIES.includes(meta.subtype) ? (['mockup'] as ArtifactSlotKey[]) : []),
            ];
            if (!consumers.some(c => requested.has(c))) continue;
            const inputRequested = meta.dependsOn.some(d => requested.has(d));
            if (inputRequested || !isSlotDone(meta.subtype)) {
                requested.add(meta.subtype);
                changed = true;
            }
        }
    }
    // Preserve caller order, appending the hidden additions at the end —
    // execution order is derived from buildDependencyLayers, not this array.
    return [...slots, ...[...requested].filter(s => !slots.includes(s))];
}

/** The direct dependencies a slot consumes (core deps, or MOCKUP_DEPENDENCIES for the mockup). */
export function slotDependencies(slot: ArtifactSlotKey): CoreArtifactSubtype[] {
    if (slot === 'mockup') return [...MOCKUP_DEPENDENCIES];
    return getArtifactMeta(slot).dependsOn;
}

export interface RetryPlan {
    /** Slots to (re)generate in dependency order — unhealthy upstreams first, then the target. */
    slots: ArtifactSlotKey[];
    /** Upstream dependencies found unhealthy (drove the closure). Empty → a plain single-slot retry. */
    unhealthyDeps: CoreArtifactSubtype[];
}

/**
 * Plan a single-slot retry so it never regenerates against missing/errored/
 * stale/needs-review upstream dependencies. Walks the slot's dependency
 * closure (including deps with no sidebar row of their own, like the
 * component_inventory the mockup consumes) and, for any dependency the caller
 * reports as unhealthy, pulls it
 * (and transitively its own unhealthy inputs) into the batch so it regenerates
 * BEFORE the target slot. When every dependency is healthy, returns just the
 * target slot (a plain retry). Pure: the caller supplies `isHealthy`.
 */
export function planSlotRetry(
    slot: ArtifactSlotKey,
    isHealthy: (subtype: CoreArtifactSubtype) => boolean,
): RetryPlan {
    const unhealthy = new Set<CoreArtifactSubtype>();
    const visit = (deps: CoreArtifactSubtype[]) => {
        for (const dep of deps) {
            if (isRetiredArtifactSubtype(dep) || unhealthy.has(dep)) continue;
            if (!isHealthy(dep)) {
                unhealthy.add(dep);
                // The dep will be regenerated, so its own inputs must be sound too.
                visit(getArtifactMeta(dep).dependsOn);
            }
        }
    };
    visit(slotDependencies(slot));
    return { slots: [...unhealthy, slot], unhealthyDeps: [...unhealthy] };
}

/**
 * Group the pipeline into dependency layers. Items in the same layer have no
 * dependency on each other and may be generated in parallel. Layers must run
 * sequentially because later layers consume earlier layers' outputs.
 */
export function buildDependencyLayers(pipeline: CoreArtifactMeta[] = CORE_ARTIFACT_PIPELINE): CoreArtifactMeta[][] {
    const layers: CoreArtifactMeta[][] = [];
    const placed = new Set<CoreArtifactSubtype>();
    const remaining = [...pipeline];

    while (remaining.length > 0) {
        const ready = remaining.filter(meta => meta.dependsOn.every(dep => placed.has(dep)));
        if (ready.length === 0) {
            throw new Error(`Cyclic or unresolved dependencies in core artifact pipeline: ${remaining.map(r => r.subtype).join(', ')}`);
        }
        layers.push(ready);
        ready.forEach(meta => placed.add(meta.subtype));
        for (const meta of ready) {
            const idx = remaining.indexOf(meta);
            if (idx >= 0) remaining.splice(idx, 1);
        }
    }

    return layers;
}

export function getArtifactMeta(subtype: CoreArtifactSubtype): CoreArtifactMeta {
    const meta = CORE_ARTIFACT_PIPELINE.find(artifact => artifact.subtype === subtype);
    if (!meta) {
        throw new Error(`Unknown artifact subtype: ${subtype}`);
    }
    return meta;
}
