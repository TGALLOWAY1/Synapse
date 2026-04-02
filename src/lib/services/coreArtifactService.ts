import type { StructuredPRD, CoreArtifactSubtype, ScreenInventoryContent, DataModelContent, ComponentInventoryContent } from '../../types';
import { callGemini } from '../geminiClient';
import type { ProviderOptions } from '../geminiClient';
import { screenInventorySchema, dataModelSchema, componentInventorySchema } from '../schemas/artifactSchemas';

const CORE_ARTIFACT_PROMPTS: Record<CoreArtifactSubtype, { system: string; userPrefix: string }> = {
    screen_inventory: {
        system: `You are an expert product designer. Create a comprehensive Screen Inventory — a structured list of all screens and views implied by the PRD.

Group screens by functional area (e.g., "Authentication", "Dashboard", "Settings"). For each screen, use this exact format:

### [Screen Name]
**Purpose:** One-sentence description of what the user accomplishes here.
**Components:** Bulleted list of key UI components on this screen.
**Navigation:** Where users come from → this screen → where they go next.
**Priority:** Core | Secondary | Supporting
**Feature Refs:** Which PRD features this screen implements (by feature ID if available).

Include screens for: empty states, error states, loading states, and onboarding flows — not just happy-path screens.
End with a summary table listing all screens with their priority and functional area.`,
        userPrefix: 'Create a Screen Inventory from this PRD:',
    },
    user_flows: {
        system: `You are an expert UX designer. Create detailed User Flows — the primary user journeys and key flow sequences derived from the PRD.

For each flow, use this exact format:

### Flow: [Flow Name]
**Goal:** What the user is trying to accomplish.
**Preconditions:** What must be true before this flow starts.
**Steps:**
1. [Screen Name] — User action → System response
2. [Screen Name] — User action → System response
   - **Decision:** If [condition], go to step X; otherwise step Y
3. ...
**Success Outcome:** What happens when the flow completes successfully.
**Error Paths:**
- [Error condition] → [How the system handles it]
**Edge Cases:** Unusual but important scenarios.

Cover at minimum: first-time user onboarding, the core value workflow, and one administrative/settings flow.`,
        userPrefix: 'Create User Flows from this PRD:',
    },
    component_inventory: {
        system: `You are an expert frontend architect. Create a Component Inventory — a structured catalog of reusable UI components implied by the product design.

Group by category. For each component, use this exact format:

#### [ComponentName]
**Purpose:** What this component does.
**Props/Variants:**
- \`variant\`: primary | secondary | ghost
- \`size\`: sm | md | lg
- (list key props)
**Used In:** [Screen 1], [Screen 2], ...
**Complexity:** Simple | Moderate | Complex
**Notes:** Any implementation considerations.

Categories to cover: Navigation, Forms & Inputs, Data Display, Feedback & Status, Layout & Containers, Overlays & Modals.
End with a dependency summary showing which components compose other components.`,
        userPrefix: 'Create a Component Inventory from this PRD:',
    },
    implementation_plan: {
        system: `You are an expert software architect. Create a high-level Implementation Plan — a milestone-oriented development roadmap.

Use this exact format for each milestone:

### Milestone [N]: [Name] (Week [X]-[Y])
**Goal:** One-sentence objective.
**Key Deliverables:**
- [ ] Deliverable 1
- [ ] Deliverable 2
**Technical Approach:** Specific technology choices and architectural decisions.
**Dependencies:** Which milestones must be completed first.
**Risks:** What could go wrong and how to mitigate it.
**Definition of Done:** How to verify this milestone is complete.

Include 4-6 milestones. First milestone should be infrastructure/setup. Last milestone should include testing and launch prep.
End with a critical path summary and team size recommendation.`,
        userPrefix: 'Create an Implementation Plan from this PRD:',
    },
    data_model: {
        system: `You are an expert backend architect. Create a Data Model Draft — the primary entities, relationships, and data needs.

For each entity, use this exact format:

### [EntityName]
**Description:** What this entity represents.
**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| ... | ... | ... | ... |

**Relationships:**
- Has many [OtherEntity] (via foreign key \`entity_id\`)
- Belongs to [OtherEntity]
**Indexes:** List recommended indexes for query performance.
**Constraints:** Uniqueness, check constraints, etc.

After all entities, include:
- An entity-relationship summary showing all connections
- API surface implications (key endpoints each entity needs)
- State management notes for the frontend`,
        userPrefix: 'Create a Data Model Draft from this PRD:',
    },
    prompt_pack: {
        system: `You are an expert at writing AI prompts. Create a Prompt Pack — a bundle of ready-to-use downstream prompts.

For each prompt, use this exact format:

### [N]. [Prompt Title]
**Target Tool:** Cursor | Claude Code | ChatGPT | Copilot | Generic
**Category:** UI Implementation | UX Critique | Testing | API Design | Content | Accessibility
**Prompt:**
\`\`\`
[The full, copy-pasteable prompt text here. Include all necessary context from the PRD. Make it self-contained — the recipient should not need to read the PRD separately.]
\`\`\`
**Expected Output:** What this prompt should produce.

Include at minimum 6 prompts covering: UI implementation, UX critique, testing strategy, API design, copy/content writing, and accessibility audit.`,
        userPrefix: 'Create a Prompt Pack from this PRD:',
    },
    design_system: {
        system: `You are an expert design systems architect. Create a Design System Starter — a foundational UI system draft.

Use this exact structure:

### Color Palette
**Primary:** [hex] — usage description
**Secondary:** [hex] — usage description
**Neutral Scale:** 50/100/200/.../900 hex values
**Semantic:** Success [hex], Warning [hex], Error [hex], Info [hex]

### Typography
| Role | Font | Size | Weight | Line Height |
|------|------|------|--------|-------------|
| H1 | ... | ... | ... | ... |
| Body | ... | ... | ... | ... |

### Spacing Scale
Base unit and scale (4px, 8px, 12px, 16px, 24px, 32px, 48px, 64px).

### Component Patterns
For each pattern (Button, Input, Card, Modal, Toast, Badge, Avatar):
- Variants with visual description
- States: default, hover, focus, disabled, loading
- Sizing options

### Interaction Patterns
- Transitions and animation timing
- Loading states approach
- Error state patterns
- Empty state patterns

### Layout
- Grid system (columns, gutters, margins)
- Breakpoints
- Container max-widths

Be specific with hex values, pixel sizes, and font choices. This should be implementable directly.`,
        userPrefix: 'Create a Design System Starter from this PRD:',
    },
};

function structuredArtifactToMarkdown(subtype: CoreArtifactSubtype, data: unknown): string {
    if (subtype === 'screen_inventory') {
        const inv = data as ScreenInventoryContent;
        const lines: string[] = ['# Screen Inventory\n'];
        for (const group of inv.groups) {
            lines.push(`## ${group.name}\n`);
            for (const screen of group.screens) {
                lines.push(`### ${screen.name}`);
                lines.push(`**Purpose:** ${screen.purpose}`);
                lines.push(`**Priority:** ${screen.priority}`);
                if (screen.components?.length) {
                    lines.push(`**Components:**`);
                    screen.components.forEach(c => lines.push(`- ${c}`));
                }
                if (screen.navigationFrom?.length || screen.navigationTo?.length) {
                    const from = screen.navigationFrom?.join(', ') || 'N/A';
                    const to = screen.navigationTo?.join(', ') || 'N/A';
                    lines.push(`**Navigation:** ${from} → this screen → ${to}`);
                }
                if (screen.featureRefs?.length) {
                    lines.push(`**Feature Refs:** ${screen.featureRefs.join(', ')}`);
                }
                lines.push('');
            }
        }
        return lines.join('\n');
    }

    if (subtype === 'data_model') {
        const model = data as DataModelContent;
        const lines: string[] = ['# Data Model\n'];
        for (const entity of model.entities) {
            lines.push(`## ${entity.name}`);
            lines.push(`${entity.description}\n`);
            lines.push('| Field | Type | Required | Description |');
            lines.push('|-------|------|----------|-------------|');
            for (const field of entity.fields) {
                lines.push(`| ${field.name} | ${field.type} | ${field.required ? 'Yes' : 'No'} | ${field.description} |`);
            }
            lines.push('');
            if (entity.relationships?.length) {
                lines.push('**Relationships:**');
                entity.relationships.forEach(r => lines.push(`- ${r.type.replace(/_/g, ' ')} → ${r.target}${r.description ? ` (${r.description})` : ''}`));
                lines.push('');
            }
            if (entity.indexes?.length) {
                lines.push(`**Indexes:** ${entity.indexes.join(', ')}`);
            }
            if (entity.constraints?.length) {
                lines.push(`**Constraints:** ${entity.constraints.join(', ')}`);
            }
            lines.push('');
        }
        if (model.apiEndpoints?.length) {
            lines.push('## API Endpoints\n');
            lines.push('| Method | Path | Description | Entity |');
            lines.push('|--------|------|-------------|--------|');
            for (const ep of model.apiEndpoints) {
                lines.push(`| ${ep.method} | ${ep.path} | ${ep.description} | ${ep.entity} |`);
            }
        }
        return lines.join('\n');
    }

    if (subtype === 'component_inventory') {
        const inv = data as ComponentInventoryContent;
        const lines: string[] = ['# Component Inventory\n'];
        for (const cat of inv.categories) {
            lines.push(`## ${cat.name}\n`);
            for (const comp of cat.components) {
                lines.push(`### ${comp.name}`);
                lines.push(`**Purpose:** ${comp.purpose}`);
                lines.push(`**Complexity:** ${comp.complexity}`);
                if (comp.props?.length) {
                    lines.push('**Props:**');
                    comp.props.forEach(p => lines.push(`- \`${p.name}\`: ${p.type}${p.description ? ` — ${p.description}` : ''}`));
                }
                if (comp.usedIn?.length) {
                    lines.push(`**Used In:** ${comp.usedIn.join(', ')}`);
                }
                if (comp.notes) {
                    lines.push(`**Notes:** ${comp.notes}`);
                }
                lines.push('');
            }
        }
        return lines.join('\n');
    }

    return JSON.stringify(data, null, 2);
}

export const generateCoreArtifact = async (
    subtype: CoreArtifactSubtype,
    prdContent: string,
    structuredPRD: StructuredPRD,
    options?: ProviderOptions & { mockupContext?: string },
): Promise<string> => {
    const config = CORE_ARTIFACT_PROMPTS[subtype];
    options?.onStatus?.(`Generating ${subtype.replace(/_/g, ' ')}...`);

    const featureList = structuredPRD.features.map(f => {
        let line = `- [${f.id}] ${f.name} (${f.complexity}${f.priority ? `, ${f.priority}` : ''}): ${f.description}`;
        if (f.acceptanceCriteria && f.acceptanceCriteria.length > 0) {
            line += `\n  Acceptance Criteria: ${f.acceptanceCriteria.join('; ')}`;
        }
        if (f.dependencies && f.dependencies.length > 0) {
            line += `\n  Dependencies: ${f.dependencies.join(', ')}`;
        }
        return line;
    }).join('\n');

    const prdSummary = `Vision: ${structuredPRD.vision}
Core Problem: ${structuredPRD.coreProblem}
Target Users: ${structuredPRD.targetUsers.join(', ')}

Features:
${featureList}

Architecture: ${structuredPRD.architecture}${
    structuredPRD.nonFunctionalRequirements?.length
        ? `\n\nNon-Functional Requirements:\n${structuredPRD.nonFunctionalRequirements.map(r => `- ${r}`).join('\n')}`
        : ''
}${
    structuredPRD.constraints?.length
        ? `\n\nConstraints:\n${structuredPRD.constraints.map(c => `- ${c}`).join('\n')}`
        : ''
}`;

    const mockupSection = options?.mockupContext
        ? `\n\n---\n\nMockup Context (reference for screens, components, and layout):\n${options.mockupContext.slice(0, 3000)}`
        : '';

    // Use JSON mode for supported artifact types
    const jsonSchemas: Partial<Record<CoreArtifactSubtype, object>> = {
        screen_inventory: screenInventorySchema,
        data_model: dataModelSchema,
        component_inventory: componentInventorySchema,
    };

    const schema = jsonSchemas[subtype];
    if (schema) {
        const jsonSystem = config.system + '\n\nReturn the result as structured JSON according to the provided schema.';
        const result = await callGemini(
            jsonSystem,
            `${config.userPrefix}\n\n${prdSummary}\n\n---\n\nFull PRD:\n${prdContent}${mockupSection}`,
            { responseMimeType: 'application/json', responseSchema: schema }
        );

        try {
            const parsed = JSON.parse(result);
            // Convert structured JSON to readable markdown for storage/display
            return structuredArtifactToMarkdown(subtype, parsed);
        } catch {
            // Fallback: return raw result if JSON parse fails
            return result;
        }
    }

    return callGemini(
        config.system,
        `${config.userPrefix}\n\n${prdSummary}\n\n---\n\nFull PRD:\n${prdContent}${mockupSection}`
    );
};

export const refineCoreArtifact = async (
    subtype: CoreArtifactSubtype,
    currentContent: string,
    instruction: string,
    prdContent: string,
    structuredPRD: StructuredPRD,
    options?: ProviderOptions
): Promise<string> => {
    options?.onStatus?.(`Refining ${subtype.replace(/_/g, ' ')}...`);

    const system = `You are an expert product designer helping refine a ${subtype.replace(/_/g, ' ')}. The user has an existing artifact and wants specific changes.

Rules:
1. Preserve the overall structure and formatting of the original artifact.
2. Apply the user's requested changes precisely.
3. If the user asks to add content, integrate it naturally into the existing structure.
4. If the user asks to modify content, change only what's requested — don't rewrite everything.
5. Return the complete updated artifact (not just the changes).`;

    const featureSummary = structuredPRD.features.map(f => `- ${f.name}: ${f.description}`).join('\n');

    return callGemini(
        system,
        `Here is the current ${subtype.replace(/_/g, ' ')}:\n\n${currentContent}\n\n---\n\nUser's refinement instruction: ${instruction}\n\n---\n\nPRD context for reference:\n${prdContent}\n\nFeatures:\n${featureSummary}`
    );
};
