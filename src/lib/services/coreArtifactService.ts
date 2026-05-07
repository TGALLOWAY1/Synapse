import type { StructuredPRD, CoreArtifactSubtype, DataModelContent, ComponentInventoryContent } from '../../types';
import { callGemini, callGeminiStream } from '../geminiClient';
import type { ProviderOptions } from '../geminiClient';
import { screenInventorySchema, dataModelSchema, componentInventorySchema } from '../schemas/artifactSchemas';
import { buildDependencyContext, buildFeatureGlossary, buildNarrativeGuardrails, normalizeArtifactMarkdown } from '../artifactOrchestration';
import { normalizeScreenInventory, screenInventoryToMarkdown } from '../screenInventoryNormalize';
import { dataModelToMarkdown } from './dataModelMarkdown';

const CORE_ARTIFACT_PROMPTS: Record<CoreArtifactSubtype, { system: string; userPrefix: string }> = {
    screen_inventory: {
        system: `You are an expert product designer. Produce a system-level Screen Inventory — a structured map of the product experience, NOT a flat list.

Output strictly the JSON shape supplied. The schema groups screens into product-area sections; for each screen you must model state, intent, entry/exit, and risk.

Rules:
1. Group screens into \`sections[]\` by product area (e.g. "Onboarding", "Mood Capture", "Library", "Account"). Give each section a one-line \`description\` and a textual \`flowSummary\` like "Landing → Mood Capture → Loading → Auth → Player".
2. A loading / error / empty / permission-denied variant of a screen is a \`state\` under that screen's \`states[]\`, NOT its own screen. Only promote a state to its own screen when it has a separate route or full-page ownership (e.g. a dedicated /404 page).
3. Use \`entryPoints[]\` (where the user comes from) and \`exitPaths[]\` (label → target screen, with optional condition). Never write inline "from X → here → to Y" navigation prose.
4. \`coreUIElements[]\` must be **semantic**: "Mood capture canvas", "Camera permission prompt", "Submit CTA". Do NOT list implementation details like "div", "input element", or "button with hover state".
5. Provide \`userIntent\` per screen — the goal in the user's own words (e.g. "Capture a vibe in under 5 seconds and share it"). This is distinct from \`purpose\` (which is the screen's role in the product).
6. Use the priority rubric LITERALLY:
   - P0 = essential to the main product loop
   - P1 = important supporting flow
   - P2 = edge case / fallback / admin / secondary view
   - P3 = nice-to-have / future
   Do NOT mark every screen P0. A typical inventory has a handful of P0s, several P1s, and a long tail of P2/P3.
7. Use \`type\` to distinguish "screen" (full route) from "modal", "overlay", or "system-state".
8. Populate \`risks[]\` with edge cases or failure modes worth surfacing ("camera permission denied", "low-light noise", "rate limit hit"). Populate \`outputData[]\` when a screen produces named data ("mood vector", "caption text", "uploaded photo URL").
9. Populate \`featureRefs[]\` with the canonical feature IDs each screen implements.
10. Reuse exact PRD terminology for screen and feature names.`,
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
        system: `You are an expert software architect. Create a high-level Implementation Plan — a milestone-oriented development roadmap grounded in the other generated artifacts.

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
End with:
- A critical path summary
- Team size recommendation
- Traceability map (milestone → PRD feature IDs)`,
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

export function structuredArtifactToMarkdown(subtype: CoreArtifactSubtype, data: unknown): string {
    if (subtype === 'screen_inventory') {
        const normalized = normalizeScreenInventory(data);
        if (!normalized) {
            // Unrecognized shape — surface raw JSON so a human can recover.
            return `# Screen Inventory\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
        }
        return screenInventoryToMarkdown(normalized);
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

    return JSON.stringify(data, null, 2);
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
            // For screen_inventory we persist the structured JSON so the
            // structured renderer in `renderers/index.tsx` activates and
            // export / dependency-context flows can re-render markdown
            // on demand. Other JSON-mode subtypes still serialize to
            // markdown for storage to avoid cross-cutting changes.
            if (subtype === 'screen_inventory') {
                const normalized = normalizeScreenInventory(parsed) ?? parsed;
                return JSON.stringify(normalized, null, 2);
            }
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

    const featureSummary = structuredPRD.features.map(f => `- ${f.name}: ${f.description}`).join('\n');

    if (subtype === 'screen_inventory') {
        const system = `You are an expert product designer refining a structured Screen Inventory.

The current artifact may be either:
- The post-upgrade JSON shape (sections[].screens[] with states, entryPoints, exitPaths, P0–P3 priority, etc.), OR
- A legacy markdown or JSON artifact (groups[].screens[] with core/secondary/supporting priority).

Rules:
1. Apply the user's requested changes precisely. Do not rewrite parts that weren't asked about.
2. If the input is legacy, migrate it to the post-upgrade shape on output: sections, P0–P3 priorities, states arrays, entryPoints, exitPaths.
3. Loading / error / empty / permission states belong under \`states[]\` of their parent screen, never as separate screens (unless they own a route).
4. coreUIElements must be semantic, not implementation-level. Provide userIntent for every screen.
5. Return strictly the JSON shape supplied — no commentary, no markdown.`;

        const result = await callGemini(
            system,
            `Here is the current screen inventory (may be JSON or markdown):\n\n${currentContent}\n\n---\n\nUser's refinement instruction: ${instruction}\n\n---\n\nPRD context for reference:\n${prdContent}\n\nFeatures:\n${featureSummary}`,
            { responseMimeType: 'application/json', responseSchema: screenInventorySchema },
            options?.signal,
        );

        try {
            const parsed = JSON.parse(result);
            const normalized = normalizeScreenInventory(parsed) ?? parsed;
            return JSON.stringify(normalized, null, 2);
        } catch {
            return result;
        }
    }

    const system = `You are an expert product designer helping refine a ${subtype.replace(/_/g, ' ')}. The user has an existing artifact and wants specific changes.

Rules:
1. Preserve the overall structure and formatting of the original artifact.
2. Apply the user's requested changes precisely.
3. If the user asks to add content, integrate it naturally into the existing structure.
4. If the user asks to modify content, change only what's requested — don't rewrite everything.
5. Return the complete updated artifact (not just the changes).`;

    return callGemini(
        system,
        `Here is the current ${subtype.replace(/_/g, ' ')}:\n\n${currentContent}\n\n---\n\nUser's refinement instruction: ${instruction}\n\n---\n\nPRD context for reference:\n${prdContent}\n\nFeatures:\n${featureSummary}`,
        undefined,
        options?.signal,
    );
};
