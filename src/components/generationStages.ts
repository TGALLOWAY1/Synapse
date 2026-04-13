export interface ProgressStage {
    label: string;
    /** Minimum ms to display this stage before advancing */
    minDuration?: number;
}

// ── Pre-defined stage sets for common operations ──

export const PRD_GENERATION_STAGES: ProgressStage[] = [
    { label: 'Analyzing product vision...', minDuration: 2500 },
    { label: 'Structuring requirements...', minDuration: 3000 },
    { label: 'Defining core features...', minDuration: 3500 },
    { label: 'Drafting user stories...', minDuration: 3000 },
    { label: 'Composing PRD sections...', minDuration: 4000 },
    { label: 'Finalizing document structure...', minDuration: 5000 },
];

export const PRD_REGENERATION_STAGES: ProgressStage[] = [
    { label: 'Re-evaluating requirements...', minDuration: 2500 },
    { label: 'Restructuring product definition...', minDuration: 3500 },
    { label: 'Drafting updated PRD...', minDuration: 4000 },
    { label: 'Finalizing revisions...', minDuration: 5000 },
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

