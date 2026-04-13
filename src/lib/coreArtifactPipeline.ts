import type { CoreArtifactSubtype } from '../types';

export interface CoreArtifactMeta {
    subtype: CoreArtifactSubtype;
    title: string;
    description: string;
    dependsOn: CoreArtifactSubtype[];
}

export const CORE_ARTIFACT_PIPELINE: CoreArtifactMeta[] = [
    {
        subtype: 'screen_inventory',
        title: 'Screen Inventory',
        description: 'Structured list of screens and views implied by the PRD',
        dependsOn: [],
    },
    {
        subtype: 'user_flows',
        title: 'User Flows',
        description: 'Primary user journeys and key flow sequences',
        dependsOn: ['screen_inventory'],
    },
    {
        subtype: 'component_inventory',
        title: 'Component Inventory',
        description: 'Reusable components implied by the product design',
        dependsOn: ['screen_inventory', 'user_flows'],
    },
    {
        subtype: 'data_model',
        title: 'Data Model Draft',
        description: 'Primary entities, relationships, and data needs',
        dependsOn: ['user_flows'],
    },
    {
        subtype: 'implementation_plan',
        title: 'Implementation Plan',
        description: 'High-level build sequence and milestone-oriented dev plan',
        dependsOn: ['component_inventory', 'data_model'],
    },
    {
        subtype: 'design_system',
        title: 'Design System Starter',
        description: 'Foundational UI system draft with patterns and components',
        dependsOn: ['component_inventory'],
    },
    {
        subtype: 'prompt_pack',
        title: 'Prompt Pack',
        description: 'Downstream prompts for design, coding, critique, and testing',
        dependsOn: ['implementation_plan', 'design_system', 'data_model'],
    },
];

export function getArtifactMeta(subtype: CoreArtifactSubtype): CoreArtifactMeta {
    const meta = CORE_ARTIFACT_PIPELINE.find(artifact => artifact.subtype === subtype);
    if (!meta) {
        throw new Error(`Unknown artifact subtype: ${subtype}`);
    }
    return meta;
}
