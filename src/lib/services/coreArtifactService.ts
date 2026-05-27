import type { StructuredPRD, CoreArtifactSubtype, DataModelContent, ComponentInventoryContent, DesignTokens, StructuredImplementationPlan } from '../../types';
import { callGemini, callGeminiStream } from '../geminiClient';
import type { ProviderOptions } from '../geminiClient';
import { screenInventorySchema, dataModelSchema, componentInventorySchema, designSystemTokensSchema, implementationPlanSchema } from '../schemas/artifactSchemas';
import { buildDependencyContext, buildFeatureGlossary, buildNarrativeGuardrails, normalizeArtifactMarkdown } from '../artifactOrchestration';
import { normalizeScreenInventory, screenInventoryToMarkdown } from '../screenInventoryNormalize';
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
        system: `You are a senior product designer producing production-grade artifacts for engineering teams. Produce a system-level Screen Inventory — a structured map of the product experience, NOT a flat list.

Output strictly the JSON shape supplied. The schema groups screens into product-area sections; for each screen you must model state, intent, entry/exit, and risk.

Rules:
1. Group screens into \`sections[]\` by product area (e.g. "Onboarding", "Mood Capture", "Library", "Account"). Give each section a one-line \`description\` and a textual \`flowSummary\` like "Landing → Mood Capture → Loading → Auth → Player".
2. Distinguish screens from states precisely. A screen is a distinct destination with its own route or full-page ownership. A loading / error / empty / permission-denied variant of a screen is a \`state\` under that screen's \`states[]\`, NOT its own screen. Promote a state to its own screen only when it owns a separate route or full page (e.g. a dedicated /404 page).
3. Use \`entryPoints[]\` (where the user comes from) and \`exitPaths[]\` (label → target screen, with optional condition). Never write inline "from X → here → to Y" navigation prose.
4. \`coreUIElements[]\` must be **semantic**: "Mood capture canvas", "Camera permission prompt", "Submit CTA". Do NOT list implementation details like "div", "input element", or "button with hover state".
5. Provide \`userIntent\` per screen — the goal in the user's own words (e.g. "Capture a vibe in under 5 seconds and share it"). This is distinct from \`purpose\` (which is the screen's role in the product).
6. Use the priority rubric LITERALLY:
   - P0 = essential to the main product loop
   - P1 = important supporting flow
   - P2 = edge case / fallback / admin / secondary view
   - P3 = nice-to-have / future
   Assign priority deterministically by the screen's role in the main product loop, not by perceived importance. Do NOT mark every screen P0. A typical inventory has a handful of P0s, several P1s, and a long tail of P2/P3.
7. Use \`type\` to distinguish "screen" (full route) from "modal", "overlay", or "system-state".
8. Populate \`risks[]\` with edge cases or failure modes worth surfacing, covering data, UX, permission, and API failure modes where relevant ("camera permission denied", "low-light noise", "rate limit hit"). Populate \`outputData[]\` for every named datum a screen produces ("mood vector", "caption text", "uploaded photo URL").
9. Populate \`featureRefs[]\` with the canonical feature IDs each screen implements.
10. Reuse exact PRD terminology for screen and feature names.`,
        userPrefix: 'Create a Screen Inventory from this PRD:',
    },
    user_flows: {
        system: `You are a senior UX designer producing production-grade artifacts for engineering teams. Create detailed User Flows — the primary user journeys and key flow sequences derived from the PRD and screen inventory context.

Adhere strictly to the format below. Do not drift into narrative prose; every flow must use the exact headings and the step → response structure. Edge cases must be meaningful failure or boundary scenarios that affect the flow, not filler.

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

You may also include any of these optional sections when relevant, using the same bold-label format: **Entry Points:** (where the flow can be started from), **Assumptions:**, and **Open Questions:**. Keep step lines in the exact "[Screen Name] — User action → System response" form so each step parses into screen, action, and response.

Cover at minimum: first-time user onboarding, the core value workflow, and one administrative/settings flow.

Begin your response directly with the first section heading. Do NOT include any preamble, introduction, or conversational text (e.g. "Of course", "Here are", "As a UX expert").`,
        userPrefix: 'Create User Flows from this PRD:',
    },
    component_inventory: {
        system: `You are a senior frontend architect producing production-grade artifacts for engineering teams. Create a Component Inventory — a structured catalog of reusable UI components implied by the product design.

Maintain consistent granularity: each entry must be a reusable component at the same level of abstraction. Do not list duplicate or overlapping components; consolidate variants of one component under that component's Props/Variants.

Group by category. For each component, use this exact format:

#### [ComponentName]
**Purpose:** What this component does.
**Props/Variants:**
- \`variant\`: primary | secondary | ghost
- \`size\`: sm | md | lg
- (list key props, each with a one-line description of its purpose)
**Used In:** [Screen 1], [Screen 2], ...
**Complexity:** Simple | Moderate | Complex
**Notes:** Any implementation considerations.

Categories to cover: Navigation, Forms & Inputs, Data Display, Feedback & Status, Layout & Containers, Overlays & Modals.`,
        userPrefix: 'Create a Component Inventory from this PRD:',
    },
    implementation_plan: {
        system: `You are a senior software architect producing production-grade artifacts for engineering teams. Produce a structured Implementation Plan as a task-driven execution system, not a narrative document. The JSON you return drives the rendered UI directly. Every task must be atomic and actionable — concrete engineering work a developer can execute — never an abstract theme. Dependencies must be explicit and accurate so the execution order is unambiguous.

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
- status: ALWAYS "todo", without exception. You are generating a plan, not tracking execution; never emit any other status value.
- dependencies: array of OTHER task ids (from this same plan) that must be done first. Empty array if none.
- linkedArtifacts: { prd, dataModel, mockups }
  - prd: PRD feature names this task implements, drawn from the Canonical Feature Glossary in the user prompt.
  - dataModel: entity names from the data_model dependency context that this task touches.
  - mockups: screen names from the screen_inventory dependency context that this task implements.
  - Link an artifact only when the task directly implements or modifies it. Omit (or use empty arrays) otherwise. Don't invent artifact references.

Rules:
- Task ids must be unique across the entire plan.
- All ids in dependencies must reference other task ids in the same plan.
- Hoist cross-cutting architecture, risks, and definition-of-done into the top-level arrays — do NOT duplicate them per milestone.
- Tasks should read as atomic engineering work, not as themes.`,
        userPrefix: 'Create an Implementation Plan from this PRD:',
    },
    data_model: {
        system: `You are a senior backend architect producing production-grade artifacts for engineering teams. Produce a Data Model that reads as a clear product/engineering explanation, not a raw schema dump. The artifact must remain structurally parseable: use the same heading and table conventions on every regeneration, and every field must appear in exactly one fieldGroup. Define every field at field level — name, type, requiredness, and a precise description. Model only entities and fields that the PRD's features and entities require; do not introduce speculative fields. Keep entity and field names consistent with the PRD's defined entities.

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
- indexes: recommended database indexes for query performance; name the field(s) each index covers.
- constraints: business/database constraints (uniqueness, check constraints, cardinality limits) — NOT privacy concerns.
- privacyRules: separate from constraints. Privacy/safety rules like "raw_input must be null when source = FACE_SCAN", "PII fields must be encrypted at rest", "soft-delete only — never hard delete". Use this for anything safety, privacy, or compliance related.
- exampleRecord: optional. For the FIRST userFacing entity (and others only when illustrative), provide a compact example record as a JSON-encoded STRING (e.g., "{\\"joy_score\\": 0.7, \\"energy_level\\": 0.6, \\"vibe_title\\": \\"Warm Sunset Drift\\"}"). 4-8 fields max; keep it illustrative, not exhaustive.

Top-level apiEndpoints: existing array of { method, path, description, entity }. Required.

Top-level productMapping: an array of { field, uiBehavior } mapping the most product-relevant fields to visible UI behavior (e.g., { field: "vibe_title", uiBehavior: "Appears as the generated playlist name" }, { field: "energy_level", uiBehavior: "Affects track intensity" }). Aim for 5-10 entries covering the fields that most directly shape the user experience.

Use stable names for entities and fields: reuse the PRD's exact entity and field names. Do not rename PRD concepts unless you provide an alias note. Keep terminology consistent across overview, fieldGroups, productMapping, and the entities themselves.`,
        userPrefix: 'Create a Data Model from this PRD:',
    },
    prompt_pack: {
        system: `You are a senior prompt engineer producing production-grade artifacts for engineering teams. Create a Prompt Pack — a bundle of ready-to-use downstream prompts that a developer can copy directly into Cursor, Claude Code, ChatGPT, or Copilot WITHOUT also pasting the PRD. Each prompt must be deterministic and directly tool-usable: precise, specific, and free of stylistic or "creative" language.

For each prompt, use this exact format:

### [N]. [Prompt Title]
**Target Tool:** Cursor | Claude Code | ChatGPT | Copilot | Generic
**Reason:** One short user-facing sentence (≤25 words) explaining why this target tool fits THIS prompt — e.g. "Cursor — best fit for applying multi-file code changes directly in the repo with diff preview." Keep it concrete; do not say "best AI tool". Select the tool by fit: Cursor for multi-file repo edits; Claude Code for repo-aware agentic tasks; ChatGPT or Generic for standalone reasoning, content, and critique; Copilot for inline code completion.
**Category:** UI Implementation | UX Critique | Testing | API Design | Content | Accessibility
**Prompt:**
\`\`\`
# Task
<one-line objective in plain English>

## Context
<2–4 sentences of product/user context drawn from the PRD vision and target users>

## Features In Scope
- <id> — <Feature Name>
  - Purpose: <one sentence>
  - Inputs / behavior: <one sentence>
  - Constraints: <one sentence, or 2–3 bullets if needed>
- <id> — <Feature Name>
  - Purpose: ...
  - Inputs / behavior: ...
  - Constraints: ...

## Requirements
- <bulleted, specific, testable>
- ...

## Constraints
- <bulleted; e.g. tech stack limits, performance budgets, accessibility minimums>
- ...

## Expected Output
- <bulleted; what artifacts/files/behaviors the recipient should produce>
- ...
\`\`\`
**Expected Output:** A one-line summary, outside the fenced block, of what the prompt above should produce.

Hard rules — these are non-negotiable:

1. Every prompt MUST be self-contained. The recipient receives ONLY this fenced block — no PRD, no glossary, no other artifact.
2. Feature IDs (e.g. \`f1\`, \`f2\`) MUST appear ONLY inside the "## Features In Scope" section, where they are defined inline with name, purpose, inputs/behavior, and constraints from the canonical feature glossary above.
3. In every other section ("# Task", "## Context", "## Requirements", "## Constraints", "## Expected Output"), refer to features by their human name only — never by bare ID. Example: write "the WebRTC emotion extractor" in Requirements, not "[f1]" or "f1".
4. Each prompt MUST cover 2–4 features under "Features In Scope" and reference at least one named screen or entity from the dependency artifacts.
5. Do not invent feature IDs. Only use IDs that appear in the canonical feature glossary supplied below.
6. Keep the structure exactly as shown — same headings, same order. The renderer parses it.

Include at minimum 6 prompts covering: UI implementation, UX critique, testing strategy, API design, copy/content writing, and accessibility audit.

Begin your response directly with the first section heading. Do NOT include any preamble, introduction, or conversational text (e.g. "Of course", "Here are", "As a UX expert").`,
        userPrefix: 'Create a Prompt Pack from this PRD:',
    },
    design_system: {
        system: `You are a senior design systems architect producing production-grade artifacts for engineering teams. Produce a Design System Starter as a STRUCTURED TOKEN CONTRACT. The output is consumed by downstream mockup generation, so every value must be machine-usable and consistent.

Return a single JSON object matching the provided schema. Token namespaces:

- colors: dot-pathed hex tokens. REQUIRED keys: brand.primary, text.primary, surface.app, surface.card. Strongly suggested additional keys: brand.secondary, text.secondary, border.subtle, state.success, state.warning, state.error, state.info. Add product-specific extensions if useful (still as dot-paths, e.g. "accent.glow"). Hex format: #RRGGBB.
- typography: dot-pathed type roles. REQUIRED: heading.lg, heading.md, body.md. Suggested: heading.xl, body.sm. Each token: { font, size (px), weight (100..900), lineHeight (unitless multiplier) }. Pick fonts that are real and broadly available (Inter, Outfit, Manrope, Roboto, system-ui, etc.).
- spacing: px values. REQUIRED: xs, sm, md, lg. Suggested xl. Use a consistent scale (typically 4-8 multiples).
- radius: px values. REQUIRED: sm, md. Suggested: lg.
- components: dot-pathed component recipes. REQUIRED: button.primary, card.default. Suggested: button.secondary, input.default. Each value references token names where possible (e.g. background "brand.primary", radius "md", padding "sm md"); raw hex is acceptable when the token name doesn't fit. Optional notes field for short usage hints.
- rules: 5–8 short imperative rules describing how to apply the tokens (e.g. "Use brand.primary only for primary actions.", "Use state colors only for status, warning, success, error, info.").

Constraints:
- Select tokens whose characteristics fit the product domain and audience, and justify the choice by that fit. For example: a healthcare product warrants a low-saturation, high-trust palette; a consumer audio product warrants a high-saturation, high-contrast palette; a B2B SaaS product warrants restrained neutrals with a single accent. Do not default to a generic indigo-on-neutral system unless the PRD requires it.
- Keep typography practical: 1 or 2 fonts maximum. The body font must be a widely available system or sans-serif UI face (e.g. Inter, Roboto, system-ui); do not select decorative fonts for body text.
- Component recipes MUST reference tokens that exist in your output; do not reference undefined tokens.
- All required keys MUST be present.
- Apply the tokens literally and consistently. Do not reinterpret, rename, or substitute token values stylistically.`,
        userPrefix: 'Create a Design System Starter from this PRD. Produce structured token JSON only:',
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

    if (subtype === 'design_system') {
        return designSystemTokensToMarkdown(data as DesignTokens);
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
            // For screen_inventory we persist the structured JSON so the
            // structured renderer in `renderers/index.tsx` activates and
            // export / dependency-context flows can re-render markdown
            // on demand. Other JSON-mode subtypes still serialize to
            // markdown for storage to avoid cross-cutting changes.
            if (subtype === 'screen_inventory') {
                const normalized = normalizeScreenInventory(parsed) ?? parsed;
                return { content: JSON.stringify(normalized, null, 2) };
            }
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

    const featureSummary = structuredPRD.features.map(f => `- ${f.name}: ${f.description}`).join('\n');

    if (subtype === 'screen_inventory') {
        const system = `You are a senior product designer producing production-grade artifacts for engineering teams, refining a structured Screen Inventory. Use formal, professional, implementation-ready language.

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
