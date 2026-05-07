import type { StructuredPRD, CoreArtifactSubtype, ScreenInventoryContent, DataModelContent, ComponentInventoryContent, StructuredImplementationPlan } from '../../types';
import { callGemini, callGeminiStream } from '../geminiClient';
import type { ProviderOptions } from '../geminiClient';
import { screenInventorySchema, dataModelSchema, componentInventorySchema, implementationPlanSchema } from '../schemas/artifactSchemas';
import { buildDependencyContext, buildFeatureGlossary, buildNarrativeGuardrails, normalizeArtifactMarkdown } from '../artifactOrchestration';
import { dataModelToMarkdown } from './dataModelMarkdown';

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
        system: `You are an expert UX designer. Create detailed User Flows — the primary user journeys and key flow sequences derived from the PRD and screen inventory context.

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

Cover at minimum: first-time user onboarding, the core value workflow, and one administrative/settings flow.

Begin your response directly with the first section heading. Do NOT include any preamble, introduction, or conversational text (e.g. "Of course", "Here are", "As a UX expert").`,
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
        system: `You are an expert software architect. Produce a structured Implementation Plan as a task-driven execution system, not a narrative document. The JSON you return drives the rendered UI directly.

Top-level shape:
- overview: { summary, criticalPath, teamSize }
  - summary: 2-3 sentences describing the build approach.
  - criticalPath: one sentence naming the milestones on the critical path.
  - teamSize: short recommendation (e.g. "1 frontend + 1 backend" or "Solo dev, ~6 weeks").
- milestones: 4-6 entries. First is infrastructure/setup. Last covers testing and launch prep.
- architecture: top-level array of cross-cutting technical decisions (tech stack picks, key architectural calls). Hoisted out of per-milestone bodies.
- risks: top-level array of { description, mitigation } items spanning the project.
- definitionOfDone: top-level array of project-wide acceptance criteria.

Per milestone:
- id: stable lower-snake-case identifier (e.g. "m_setup", "m_emotion_extraction").
- name: human-readable milestone name.
- timeframe: "Week 1-2" style range.
- goal: one-sentence objective.
- tasks: 3-8 atomic, executable tasks.

Per task:
- id: stable lower-snake-case identifier (e.g. "task_initialize_nextjs"). Unique across the whole plan.
- title: short imperative (e.g. "Initialize Next.js SPA").
- description: optional extra context, ONE sentence max.
- status: ALWAYS "todo". You are generating a plan, not tracking execution.
- dependencies: array of OTHER task ids (from this same plan) that must be done first. Empty array if none.
- linkedArtifacts: { prd, dataModel, mockups }
  - prd: PRD feature names this task implements, drawn from the Canonical Feature Glossary in the user prompt.
  - dataModel: entity names from the data_model dependency context that this task touches.
  - mockups: screen names from the screen_inventory dependency context that this task implements.
  - Omit (or use empty arrays) if there is no genuine reference. Don't invent artifact references.

Rules:
- Task ids must be unique across the entire plan.
- All ids in dependencies must reference other task ids in the same plan.
- Hoist cross-cutting architecture, risks, and definition-of-done into the top-level arrays — do NOT duplicate them per milestone.
- Tasks should read as atomic engineering work, not as themes.`,
        userPrefix: 'Create an Implementation Plan from this PRD:',
    },
    data_model: {
        system: `You are an expert backend architect. Produce a Data Model that reads as a clear product/engineering explanation, not a raw schema dump. The artifact must remain structurally parseable: use the same heading and table conventions on every regeneration, and every field must appear in exactly one fieldGroup.

The JSON you return drives both downstream artifacts and the rendered UI. Populate these top-level fields:

- overview.summary: 2-3 sentences in plain English describing what this data model represents and the primary entities involved.
- overview.dataFlow: 1-2 sentences describing how user input flows through the system (e.g., "User input creates a MoodSnapshot, which seeds a ResonancePlaylist that adapts to swipe feedback over time.").
- overview.productOutcome: 1-2 sentences describing the resulting user-visible behavior. Keep summary + dataFlow + productOutcome combined under ~600 characters total — they appear at the top of the rendered artifact and the first slice is fed to downstream generators.

For each entity, populate:

- name, description: existing fields. Description is what the entity represents; keep distinct from purpose.
- purpose: one sentence on WHY this entity exists.
- userFacing: true if the user directly sees or manipulates this entity's data, false for purely internal/system entities.
- mutability: "immutable" (write-once), "mostly_immutable" (rare changes), or "mutable" (regularly updated).
- fields: each field with name, type, required (boolean), description.
- fieldGroups: assign EVERY field to exactly one of these groups:
  - "Key Product Fields" (the meaningful product attributes)
  - "Relationships" (foreign keys to other entities)
  - "System Metadata" (id, created_at, updated_at, version, audit fields)
  - "API / Integration" (webhook URLs, external IDs, integration payloads)
  - "Privacy / Safety" (PII, secrets, sensitive data subject to safety rules)
- relationships: existing array of { type: has_many|belongs_to|has_one|many_to_many, target, description? }.
- indexes: recommended database indexes for query performance.
- constraints: business/database constraints (uniqueness, check constraints, cardinality limits) — NOT privacy concerns.
- privacyRules: separate from constraints. Privacy/safety rules like "raw_input must be null when source = FACE_SCAN", "PII fields must be encrypted at rest", "soft-delete only — never hard delete". Use this for anything safety, privacy, or compliance related.
- exampleRecord: optional. For the FIRST userFacing entity (and others only when illustrative), provide a compact example record as a JSON-encoded STRING (e.g., "{\\"joy_score\\": 0.7, \\"energy_level\\": 0.6, \\"vibe_title\\": \\"Warm Sunset Drift\\"}"). 4-8 fields max; keep it illustrative, not exhaustive.

Top-level apiEndpoints: existing array of { method, path, description, entity }. Required.

Top-level productMapping: an array of { field, uiBehavior } mapping the most product-relevant fields to visible UI behavior (e.g., { field: "vibe_title", uiBehavior: "Appears as the generated playlist name" }, { field: "energy_level", uiBehavior: "Affects track intensity" }). Aim for 5-10 entries covering the fields that most directly shape the user experience.

Use stable names for entities and fields. Do not rename PRD concepts unless you provide an alias note. Keep terminology consistent across overview, fieldGroups, productMapping, and the entities themselves.`,
        userPrefix: 'Create a Data Model from this PRD:',
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

Include at minimum 6 prompts covering: UI implementation, UX critique, testing strategy, API design, copy/content writing, and accessibility audit.

Every prompt must explicitly reference at least two canonical feature IDs and one named screen/entity.

Begin your response directly with the first section heading. Do NOT include any preamble, introduction, or conversational text (e.g. "Of course", "Here are", "As a UX expert").`,
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

Be specific with hex values, pixel sizes, and font choices. This should be implementable directly.

Begin your response directly with the first section heading. Do NOT include any preamble, introduction, or conversational text (e.g. "Of course", "Here are", "As a UX expert").`,
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
        return dataModelToMarkdown(data as DataModelContent);
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

    if (subtype === 'implementation_plan') {
        return implementationPlanToMarkdown(data as StructuredImplementationPlan);
    }

    return JSON.stringify(data, null, 2);
}

// Converts the structured plan to a markdown body that the new tabbed
// renderer can re-parse via the trailing `synapse-plan` JSON fence, while
// the legacy milestone-regex parser still produces a usable timeline view
// for older builds. Headers ('Milestone', 'Goal', 'Deliverables',
// 'Dependencies') match what artifactValidation expects.
function implementationPlanToMarkdown(plan: StructuredImplementationPlan): string {
    const lines: string[] = ['# Implementation Plan\n'];
    if (plan.overview?.summary) lines.push(plan.overview.summary, '');

    plan.milestones.forEach((m, i) => {
        const heading = `### Milestone ${i + 1}: ${m.name}${m.timeframe ? ` (${m.timeframe})` : ''}`;
        lines.push(heading);
        if (m.goal) lines.push(`**Goal:** ${m.goal}`);
        if (m.tasks.length) {
            lines.push('**Key Deliverables:**');
            for (const t of m.tasks) {
                lines.push(`- [${t.status === 'done' ? 'x' : ' '}] **${t.title}** — _${t.status}_`);
            }
        }
        const deps = Array.from(new Set(m.tasks.flatMap(t => t.dependencies ?? []))).filter(Boolean);
        if (deps.length) lines.push(`**Dependencies:** ${deps.join(', ')}`);
        lines.push('');
    });

    if (plan.architecture?.length) {
        lines.push('---', '', '## Architecture');
        plan.architecture.forEach(a => lines.push(`- ${a}`));
        lines.push('');
    }
    if (plan.risks?.length) {
        lines.push('## Risks');
        plan.risks.forEach(r => {
            lines.push(`- **${r.description}**${r.mitigation ? ` — Mitigation: ${r.mitigation}` : ''}`);
        });
        lines.push('');
    }
    if (plan.definitionOfDone?.length) {
        lines.push('## Definition of Done');
        plan.definitionOfDone.forEach(d => lines.push(`- [ ] ${d}`));
        lines.push('');
    }
    if (plan.overview?.criticalPath || plan.overview?.teamSize) {
        if (!plan.architecture?.length) lines.push('---', '');
        if (plan.overview.criticalPath) lines.push(`**Critical Path:** ${plan.overview.criticalPath}`);
        if (plan.overview.teamSize) lines.push(`**Team Size:** ${plan.overview.teamSize}`);
        lines.push('');
    }

    lines.push('```json synapse-plan');
    lines.push(JSON.stringify(plan, null, 2));
    lines.push('```');

    return lines.join('\n');
}

export const generateCoreArtifact = async (
    subtype: CoreArtifactSubtype,
    prdContent: string,
    structuredPRD: StructuredPRD,
    options?: ProviderOptions & {
        mockupContext?: string;
        generatedArtifacts?: Partial<Record<CoreArtifactSubtype, string>>;
        signal?: AbortSignal;
        onProgress?: (message: string) => void;
    },
): Promise<string> => {
    const config = CORE_ARTIFACT_PROMPTS[subtype];
    const onProgress = options?.onProgress;

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
    const featureGlossary = buildFeatureGlossary(structuredPRD);
    const dependencyContext = buildDependencyContext(subtype, options?.generatedArtifacts ?? {});
    const guardrails = buildNarrativeGuardrails(structuredPRD);

    const mockupSection = options?.mockupContext
        ? `\n\n---\n\nMockup Context (reference for screens, components, and layout):\n${options.mockupContext.slice(0, 3000)}`
        : '';

    // Use JSON mode for supported artifact types
    const jsonSchemas: Partial<Record<CoreArtifactSubtype, object>> = {
        screen_inventory: screenInventorySchema,
        data_model: dataModelSchema,
        component_inventory: componentInventorySchema,
        implementation_plan: implementationPlanSchema,
    };

    const userPrompt = `${config.userPrefix}\n\n${guardrails}\n\nCanonical Feature Glossary:\n${featureGlossary}\n\nDependency Artifacts:\n${dependencyContext}\n\n${prdSummary}\n\n---\n\nFull PRD:\n${prdContent}${mockupSection}`;

    // Cap progress messages at ~3/s; emit every 250 chars OR 350ms to keep the
    // UI feeling alive without thrashing the store.
    const makeChunkEmitter = (label: (chars: number) => string) => {
        let chars = 0;
        let lastEmittedChars = 0;
        let lastEmittedAt = performance.now();
        return (text: string) => {
            chars += text.length;
            const now = performance.now();
            if (chars - lastEmittedChars >= 250 || now - lastEmittedAt >= 350) {
                lastEmittedChars = chars;
                lastEmittedAt = now;
                onProgress?.(label(chars));
            }
        };
    };

    // Phase the streaming label so the user sees motion even when the chars
    // counter alone wouldn't change — different prefixes tell them where in
    // the response we are. Don't include the raw char count in the message:
    // the store dedupes consecutive identical strings, and a changing suffix
    // would defeat that and flood the progress log.
    const streamingLabel = (chars: number): string => {
        if (chars < 600) return 'Drafting opening sections…';
        if (chars < 2000) return 'Filling in details…';
        if (chars < 4500) return 'Expanding examples…';
        return 'Wrapping up…';
    };

    const schema = jsonSchemas[subtype];
    if (schema) {
        const jsonSystem = config.system + '\n\nReturn the result as structured JSON according to the provided schema.';
        onProgress?.('Sending request to model…');
        const result = await callGeminiStream(
            jsonSystem,
            userPrompt,
            {
                onChunk: makeChunkEmitter(() => 'Streaming structured JSON…'),
                onComplete: () => {},
                onError: () => {},
            },
            options?.signal,
            { responseMimeType: 'application/json', responseSchema: schema },
        );
        onProgress?.('Validating output…');

        try {
            const parsed = JSON.parse(result);
            return normalizeArtifactMarkdown(structuredArtifactToMarkdown(subtype, parsed));
        } catch {
            // Fallback: return raw result if JSON parse fails
            return normalizeArtifactMarkdown(result);
        }
    }

    onProgress?.('Sending request to model…');
    const result = await callGeminiStream(
        config.system,
        userPrompt,
        {
            onChunk: makeChunkEmitter(streamingLabel),
            onComplete: () => {},
            onError: () => {},
        },
        options?.signal,
    );
    onProgress?.('Validating output…');
    return normalizeArtifactMarkdown(result);
};

export const refineCoreArtifact = async (
    subtype: CoreArtifactSubtype,
    currentContent: string,
    instruction: string,
    prdContent: string,
    structuredPRD: StructuredPRD,
    options?: ProviderOptions & { signal?: AbortSignal },
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
        `Here is the current ${subtype.replace(/_/g, ' ')}:\n\n${currentContent}\n\n---\n\nUser's refinement instruction: ${instruction}\n\n---\n\nPRD context for reference:\n${prdContent}\n\nFeatures:\n${featureSummary}`,
        undefined,
        options?.signal,
    );
};
