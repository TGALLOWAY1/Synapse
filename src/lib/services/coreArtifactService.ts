import type { StructuredPRD, CoreArtifactSubtype, ScreenInventoryContent, DataModelContent, ComponentInventoryContent, DesignTokens } from '../../types';
import { callGemini, callGeminiStream } from '../geminiClient';
import type { ProviderOptions } from '../geminiClient';
import { screenInventorySchema, dataModelSchema, componentInventorySchema, designSystemTokensSchema } from '../schemas/artifactSchemas';
import { buildDependencyContext, buildFeatureGlossary, buildNarrativeGuardrails, normalizeArtifactMarkdown } from '../artifactOrchestration';
import { dataModelToMarkdown } from './dataModelMarkdown';
import {
    normalizeDesignTokens,
    hashDesignTokens,
    designSystemTokensToMarkdown,
} from '../designTokens';

export interface CoreArtifactGenerationResult {
    /** Canonical markdown body, stored in `ArtifactVersion.content`. */
    content: string;
    /**
     * Subtype-specific metadata to merge into `ArtifactVersion.metadata` when
     * the version is created. For `design_system`, this carries the
     * structured `tokens` plus `tokensHash`. Undefined for subtypes that
     * have no extra metadata to surface.
     */
    metadata?: Record<string, unknown>;
}

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
        system: `You are an expert design systems architect. Produce a Design System Starter as a STRUCTURED TOKEN CONTRACT. The output is consumed by downstream mockup generation, so every value must be machine-usable and consistent.

Return a single JSON object matching the provided schema. Token namespaces:

- colors: dot-pathed hex tokens. REQUIRED keys: brand.primary, text.primary, surface.app, surface.card. Strongly suggested additional keys: brand.secondary, text.secondary, border.subtle, state.success, state.warning, state.error, state.info. Add product-specific extensions if useful (still as dot-paths, e.g. "accent.glow"). Hex format: #RRGGBB.
- typography: dot-pathed type roles. REQUIRED: heading.lg, heading.md, body.md. Suggested: heading.xl, body.sm. Each token: { font, size (px), weight (100..900), lineHeight (unitless multiplier) }. Pick fonts that are real and broadly available (Inter, Outfit, Manrope, Roboto, system-ui, etc.).
- spacing: px values. REQUIRED: xs, sm, md, lg. Suggested xl. Use a consistent scale (typically 4-8 multiples).
- radius: px values. REQUIRED: sm, md. Suggested: lg.
- components: dot-pathed component recipes. REQUIRED: button.primary, card.default. Suggested: button.secondary, input.default. Each value references token names where possible (e.g. background "brand.primary", radius "md", padding "sm md"); raw hex is acceptable when the token name doesn't fit. Optional notes field for short usage hints.
- rules: 5–8 short imperative rules describing how to apply the tokens (e.g. "Use brand.primary only for primary actions.", "Use state colors only for status, warning, success, error, info.").

Constraints:
- Choose tokens that match the PRD's product personality (e.g. healthcare → calm trust palette; consumer audio → vibrant energy; B2B SaaS → restrained neutrals + one accent). Do not default to a generic indigo-on-neutral system unless the PRD truly calls for it.
- Keep typography practical: 1 or 2 fonts max. Don't pick decorative fonts for body.
- Component recipes must reference tokens that exist in your output.
- All required keys MUST be present.`,
        userPrefix: 'Create a Design System Starter from this PRD. Produce structured token JSON only:',
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

    if (subtype === 'design_system') {
        return designSystemTokensToMarkdown(data as DesignTokens);
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
): Promise<CoreArtifactGenerationResult> => {
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
        design_system: designSystemTokensSchema,
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
            const content = normalizeArtifactMarkdown(structuredArtifactToMarkdown(subtype, parsed));
            // For design_system specifically, the parsed JSON IS the token
            // contract — surface it back to the caller as metadata so the
            // controller can persist tokens + tokensHash on the
            // ArtifactVersion alongside the canonical markdown.
            if (subtype === 'design_system') {
                const tokens = normalizeDesignTokens(parsed);
                return {
                    content,
                    metadata: { tokens, tokensHash: hashDesignTokens(tokens) },
                };
            }
            return { content };
        } catch {
            // JSON-mode failure: fall back to the raw text body. For
            // design_system this means we won't have structured tokens —
            // legacy markdown rendering still works in the UI.
            return { content: normalizeArtifactMarkdown(result) };
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
    return { content: normalizeArtifactMarkdown(result) };
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
