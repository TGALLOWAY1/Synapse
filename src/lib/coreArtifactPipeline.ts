import type { CoreArtifactSubtype } from '../types';

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
        subtype: 'prompt_pack',
        title: 'Developer Prompts',
        description: 'AI prompts for downstream tasks',
        dependsOn: ['implementation_plan', 'design_system', 'data_model'],
        displayOrder: 6,
    },
    {
        subtype: 'implementation_plan',
        title: 'Build Plan',
        description: 'High-level build sequence and milestones',
        dependsOn: [],
        displayOrder: 7,
    },
];

/** Artifacts sorted for UI display. Iteration order does NOT respect dependencies. */
export const CORE_ARTIFACT_DISPLAY_ORDER: CoreArtifactMeta[] =
    CORE_ARTIFACT_PIPELINE.slice().sort((a, b) => a.displayOrder - b.displayOrder);

// Subtypes that are still *generated* (they remain in CORE_ARTIFACT_PIPELINE and
// MOCKUP_DEPENDENCIES so downstream consumers like mockups keep working) but are
// **hidden from the assets list** — no hard dependents, not useful to surface
// directly right now. This is the single source of truth for "hidden": it drives
// the sidebar omission (ArtifactWorkspace.buildSlotMetas), the finalize readiness
// gate (ProjectWorkspace.assetsReady), and the auto-resume decision
// (artifactJobController.resumeIfNeeded). A hidden artifact must never gate
// user-facing readiness or trigger an invisible retry loop, since the user has no
// row to see its status or retry it. See docs/backlog/BACKLOG.md §6.
export const HIDDEN_ARTIFACT_SUBTYPES: ReadonlySet<CoreArtifactSubtype> = new Set<CoreArtifactSubtype>([
    'component_inventory',
]);

export const isHiddenArtifactSubtype = (subtype: CoreArtifactSubtype): boolean =>
    HIDDEN_ARTIFACT_SUBTYPES.has(subtype);

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
