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
export const CORE_ARTIFACT_PIPELINE: CoreArtifactMeta[] = [
    {
        subtype: 'screen_inventory',
        title: 'Screen Inventory',
        description: 'Structured list of screens and views implied by the PRD',
        dependsOn: [],
        displayOrder: 3,
    },
    {
        subtype: 'user_flows',
        title: 'User Flows',
        description: 'Primary user journeys and key flow sequences',
        dependsOn: ['screen_inventory'],
        displayOrder: 2,
    },
    {
        subtype: 'component_inventory',
        title: 'Component Inventory',
        description: 'Reusable components implied by the product design',
        dependsOn: ['screen_inventory', 'user_flows'],
        displayOrder: 4,
    },
    {
        subtype: 'data_model',
        title: 'Data Model Draft',
        description: 'Primary entities, relationships, and data needs',
        dependsOn: ['user_flows'],
        displayOrder: 1,
    },
    {
        subtype: 'implementation_plan',
        title: 'Implementation Plan',
        description: 'High-level build sequence and milestone-oriented dev plan',
        dependsOn: ['component_inventory', 'data_model'],
        displayOrder: 6,
    },
    {
        subtype: 'design_system',
        title: 'Design System Starter',
        description: 'Foundational UI system draft with patterns and components',
        dependsOn: ['component_inventory'],
        displayOrder: 5,
    },
    {
        subtype: 'prompt_pack',
        title: 'Prompt Pack',
        description: 'Downstream prompts for design, coding, critique, and testing',
        dependsOn: ['implementation_plan', 'design_system', 'data_model'],
        displayOrder: 7,
    },
];

/** Artifacts sorted for UI display. Iteration order does NOT respect dependencies. */
export const CORE_ARTIFACT_DISPLAY_ORDER: CoreArtifactMeta[] =
    CORE_ARTIFACT_PIPELINE.slice().sort((a, b) => a.displayOrder - b.displayOrder);

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
