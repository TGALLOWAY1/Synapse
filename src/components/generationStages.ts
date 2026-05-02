export interface ProgressStage {
    label: string;
    /** Minimum ms to display this stage before advancing */
    minDuration?: number;
}

// ── Pre-defined stage sets for common operations ──

// Stage labels mirror the four phase strings emitted by the single-pass PRD
// pipeline (see `prdPipeline.ts:phaseFor`). The `GenerationProgress` panel
// derives the active stage from the latest progress message rather than a
// timer, so `minDuration` is informational only.
export const PRD_GENERATION_STAGES: ProgressStage[] = [
    { label: 'Drafting vision and target users…' },
    { label: 'Designing UX architecture and feature specs…' },
    { label: 'Defining data model and acceptance criteria…' },
    { label: 'Wrapping up structured PRD…' },
];

export const PRD_REGENERATION_STAGES: ProgressStage[] = [
    { label: 'Drafting vision and target users…' },
    { label: 'Designing UX architecture and feature specs…' },
    { label: 'Defining data model and acceptance criteria…' },
    { label: 'Wrapping up structured PRD…' },
];

export const MOCKUP_GENERATION_STAGES: ProgressStage[] = [
    { label: 'Interpreting layout requirements...', minDuration: 2500 },
    { label: 'Composing screen structures...', minDuration: 3500 },
    { label: 'Rendering HTML views...', minDuration: 4000 },
    { label: 'Assembling mockup payload...', minDuration: 5000 },
];

export const CONSOLIDATION_STAGES: ProgressStage[] = [
    { label: 'Analyzing branch discussion...', minDuration: 2000 },
    { label: 'Identifying key changes...', minDuration: 2500 },
    { label: 'Synthesizing patch...', minDuration: 3500 },
    { label: 'Validating consistency...', minDuration: 4000 },
];

export const STALE_REFRESH_STAGES: ProgressStage[] = [
    { label: 'Detecting outdated artifacts...', minDuration: 2000 },
    { label: 'Reconciling with updated PRD...', minDuration: 3000 },
    { label: 'Regenerating affected artifacts...', minDuration: 4000 },
    { label: 'Validating updated outputs...', minDuration: 5000 },
];

/**
 * Visual scaffold for the artifact bundle progress panel.
 * No `minDuration` — the panel is driven by real completion state, not timers.
 */
export const BUNDLE_GENERATION_STAGES: ProgressStage[] = [
    { label: 'Preparing artifact pipeline...' },
    { label: 'Generating foundational artifacts...' },
    { label: 'Building dependent artifacts...' },
    { label: 'Finalizing prompt pack...' },
];

/** Returns per-artifact-type stage labels for individual generation */
export function getArtifactStages(subtype: string): ProgressStage[] {
    switch (subtype) {
        case 'screen_inventory':
            return [
                { label: 'Extracting screens from PRD...', minDuration: 2500 },
                { label: 'Cataloging views and states...', minDuration: 3000 },
                { label: 'Structuring inventory...', minDuration: 3500 },
            ];
        case 'user_flows':
            return [
                { label: 'Mapping user journeys...', minDuration: 2500 },
                { label: 'Defining flow sequences...', minDuration: 3000 },
                { label: 'Documenting decision points...', minDuration: 3500 },
            ];
        case 'component_inventory':
            return [
                { label: 'Identifying UI components...', minDuration: 2500 },
                { label: 'Mapping component hierarchy...', minDuration: 3000 },
                { label: 'Cataloging props and variants...', minDuration: 3500 },
            ];
        case 'implementation_plan':
            return [
                { label: 'Scoping build phases...', minDuration: 2500 },
                { label: 'Sequencing milestones...', minDuration: 3000 },
                { label: 'Drafting implementation roadmap...', minDuration: 3500 },
            ];
        case 'data_model':
            return [
                { label: 'Identifying core entities...', minDuration: 2500 },
                { label: 'Defining relationships...', minDuration: 3000 },
                { label: 'Structuring data schema...', minDuration: 3500 },
            ];
        case 'prompt_pack':
            return [
                { label: 'Analyzing downstream needs...', minDuration: 2500 },
                { label: 'Crafting specialized prompts...', minDuration: 3000 },
                { label: 'Assembling prompt pack...', minDuration: 3500 },
            ];
        case 'design_system':
            return [
                { label: 'Extracting design patterns...', minDuration: 2500 },
                { label: 'Defining design tokens...', minDuration: 3000 },
                { label: 'Composing system foundation...', minDuration: 3500 },
            ];
        default:
            return [
                { label: 'Analyzing requirements...', minDuration: 2500 },
                { label: 'Generating artifact...', minDuration: 3500 },
                { label: 'Structuring output...', minDuration: 4000 },
            ];
    }
}

