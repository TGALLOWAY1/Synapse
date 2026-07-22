import type { StructuredPRD, CoreArtifactSubtype, DataModelContent, ComponentInventoryContent, DesignTokens, StructuredImplementationPlan, CanonicalPrdSpine } from '../../types';
import { callGeminiStream } from '../geminiClient';
import type { ProviderOptions, GeminiTokenUsage } from '../geminiClient';
import { repairTruncatedJson } from '../jsonRepair';
import type { LlmTraceMeta } from '../trace/traceTypes';
import { artifactRole, AGENT_AGNOSTIC_RULE, ANTI_PREAMBLE_RULE } from '../prompts/artifactPromptFragments';
import { getArtifactModel, CORE_ARTIFACT_COMPLEXITY } from '../artifactModelSettings';
import type { ArtifactComplexity } from '../artifactModelSettings';
import { screenInventorySchema, dataModelSchema, componentInventorySchema, designSystemTokensSchema, implementationPlanSchema } from '../schemas/artifactSchemas';
import { buildDependencyContext, buildFeatureGlossary, buildNarrativeGuardrails, normalizeArtifactMarkdown } from '../artifactOrchestration';
import { assertDependenciesSufficient, findMissingRequiredDependencies } from '../artifactDependencyGate';
import { buildArtifactPrompt } from './artifactPromptBuilder';
import { buildCanonicalPrdSpine, buildCanonicalSpinePromptSection } from '../canonicalPrdSpine';
import { normalizeScreenInventory, screenInventoryToMarkdown } from '../screenInventoryNormalize';
import { dataModelToMarkdown } from './dataModelMarkdown';
import {
    normalizeDesignTokens,
    hashDesignTokens,
    designSystemTokensToMarkdown,
} from '../designTokens';
import { getDesignSystemPresetDirective } from '../designSystemPresets';

export interface CoreArtifactGenerationResult {
    /** Canonical markdown body, stored in `ArtifactVersion.content`. */
    content: string;
    /**
     * Subtype-specific metadata to merge into `ArtifactVersion.metadata` when
     * the version is created. For `design_system`, this carries the
     * structured `tokens` plus `tokensHash`. When the model's response hit its
     * output-token cap it carries `truncated: true`, which the job controller
     * converts into a blocking-validation issue (slot reads `needs_review`,
     * never `done`). Undefined for subtypes that have no extra metadata to
     * surface.
     */
    metadata?: Record<string, unknown>;
}

/**
 * Explicit output cap for core-artifact generation. Without one, Gemini
 * applies a conservative default (~8K tokens) that rich structured artifacts
 * (screen inventory, implementation plan) routinely exceed — truncating the
 * JSON mid-string. The cap is generous headroom, not a target; responses only
 * spend what they emit.
 */
export const ARTIFACT_MAX_OUTPUT_TOKENS = 32768;

/** Blocker text the job controller surfaces for a truncated artifact body. */
export const ARTIFACT_TRUNCATED_BLOCKER =
    'The model response hit its output limit and was cut off — content at the end is missing. Regenerate this artifact.';

// Per-artifact model routing now lives in `artifactModelSettings.ts` so the
// Settings UI and the generation pipeline share one source of truth. Re-export
// the complexity map and type for back-compat with existing importers.
export { CORE_ARTIFACT_COMPLEXITY };
export type { ArtifactComplexity };

/**
 * Resolve the Gemini model id a given core artifact should generate with.
 * Honors an explicit per-artifact override (Settings → "Artifact Generation
 * Models") and otherwise falls back to the complexity recommendation. Exported
 * so the artifact orchestrator can record the *actual* model in workflow
 * metrics.
 */
export const selectArtifactModel = (subtype: CoreArtifactSubtype): string =>
    getArtifactModel(subtype);

// Exported ONLY for the prompt-surface snapshot tests (promptSurfaces.test.ts)
// so any edit to an artifact system prompt shows up as a reviewed snapshot
// diff. Runtime consumers must keep going through generateCoreArtifact.
export const CORE_ARTIFACT_PROMPTS: Record<CoreArtifactSubtype, { system: string; userPrefix: string }> = {
    screen_inventory: {
        system: `${artifactRole('senior product designer')} Produce a system-level Screen Inventory — a structured map of the product experience, NOT a flat list.

Output strictly the JSON shape supplied. The schema groups screens into product-area sections; for each screen you must model state, intent, entry/exit, and risk.

Rules:
1. Group screens into \`sections[]\` by product area (e.g. "Onboarding", "Mood Capture", "Library", "Account"). Give each section a one-line \`description\` and a textual \`flowSummary\` like "Landing → Mood Capture → Loading → Auth → Player".
2. Distinguish screens from states precisely. A screen is a distinct destination with its own route or full-page ownership. A loading / error / empty / permission-denied variant of a screen is a \`state\` under that screen's \`states[]\`, NOT its own screen. Promote a state to its own screen only when it owns a separate route or full page (e.g. a dedicated /404 page). Model each state as a contract: \`type\` (default/loading/empty/error/success/disabled/permission/responsive/other), a concrete \`trigger\` ("No saved evaluations exist for the current user"), \`description\` = what the USER sees, \`systemBehavior\` = what the SYSTEM does, \`recoveryPath\` when the user needs a way out, \`required: true\` for states the screen cannot ship without, \`needsMockup: true\` for states that warrant their own mockup variant (typically the default state plus required empty/error states of P0/P1 screens), and 1-3 checkable \`acceptanceCriteria\`. Every screen needs at least a default state; add empty/loading/error states wherever the screen loads or lists data.
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
8. Populate \`riskDetails[]\` with edge cases or failure modes worth surfacing, covering data, UX, permission, and API failure modes where relevant ("camera permission denied", "low-light noise", "rate limit hit"). Give each risk a \`severity\` and a concrete \`proposedHandling\` describing how the product should respond — a risk without handling is unfinished. Populate \`outputData[]\` for every named datum a screen produces ("mood vector", "caption text", "uploaded photo URL").
9. Populate \`featureRefs[]\` with the canonical feature IDs each screen implements, drawn from the Canonical Feature Glossary / Canonical PRD Spine. Use ONLY real feature ids — never invent one. Every screen should trace to at least one feature unless it is genuinely supporting UI (settings, legal).
10. Reuse exact PRD terminology for screen and feature names.
11. Populate screen-level \`acceptanceCriteria[]\`: 3-6 checkable statements a reviewer can verify ("Empty history state appears when no evaluations are found"). Ground every criterion in the PRD or this screen's own spec — never invent product behavior.
12. Populate \`handoff\` with practical implementation fields: a \`route\` hint (plus \`routeParams\`), \`primaryComponents\` (PascalCase component names), \`stateVariables\`, \`events\` (name + trigger + effect, e.g. "onSubmitProject"), \`dataDependencies\`, \`apiDependencies\`, \`accessibilityNotes\` (concrete, e.g. "Wizard steps must be keyboard navigable"), and \`responsiveNotes\`. Do NOT over-specify: when the PRD gives no basis for a field, omit it entirely rather than guessing — downstream views show "Not specified" honestly.`,
        userPrefix: 'Create a Screen Inventory from this PRD:',
    },
    user_flows: {
        system: `${artifactRole('senior UX designer')} Create detailed User Flows — the primary user journeys and key flow sequences derived from the PRD and screen inventory context.

Adhere strictly to the format below. Do not drift into narrative prose; every flow must use the exact headings and the step → response structure. Edge cases must be meaningful failure or boundary scenarios that affect the flow, not filler.

For each flow, use this exact format:

### Flow: [Flow Name]
**Goal:** What the user is trying to accomplish.
**Related Features:** the canonical PRD feature ids and names this flow implements, drawn from the Canonical Feature Glossary / Canonical PRD Spine (e.g. "[f1] Trip Creation, [f2] Route Planning"). Every flow MUST map to at least one real feature; use ONLY ids/names from the glossary — never invent a feature id.
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

In the "[Screen Name]" bracket, always write the screen's human-readable display name exactly as it appears in the screen inventory / PRD (e.g. "[Infographic Library]"). Never put a screen seed id or slug there (e.g. NOT "[scr-infographic-library]") — the flow steps are joined to screens by that display name, so a seed id detaches the step from its screen.

Cover at minimum: first-time user onboarding, the core value workflow, and one administrative/settings flow.

${ANTI_PREAMBLE_RULE}`,
        userPrefix: 'Create User Flows from this PRD:',
    },
    component_inventory: {
        system: `${artifactRole('senior frontend architect')} Create a Component Inventory — a structured catalog of reusable UI components implied by the product design.

Maintain consistent granularity: each entry must be a reusable component at the same level of abstraction. Do not list duplicate or overlapping components; consolidate variants of one component under that component's props.

Return a single JSON object matching the provided schema: \`categories[]\`, each with a \`name\` and its \`components[]\`. For each component, populate:

- name: the component's PascalCase name (e.g. "PrimaryButton", "MoodCaptureCanvas").
- purpose: one sentence on what this component does.
- props: the key props, each { name, type, required, description } — include variant/size style props where the component has them (e.g. variant: primary | secondary | ghost; size: sm | md | lg), with a one-line description of each prop's purpose.
- usedIn: the screen names (from the screen inventory / PRD) where this component appears.
- complexity: "simple" | "moderate" | "complex".
- notes: any implementation considerations.
- previewType: one of "accordion", "input", "toggle", "button", or "custom" — the visual archetype that best represents how the component looks/behaves.
- accessibility: which of keyboard navigation, focus management, and screen-reader support the component must implement, plus any required ARIA attributes/states. Be honest — only mark a capability when the component genuinely requires it.

Categories to cover: Navigation, Forms & Inputs, Data Display, Feedback & Status, Layout & Containers, Overlays & Modals.`,
        userPrefix: 'Create a Component Inventory from this PRD:',
    },
    implementation_plan: {
        system: `${artifactRole('senior software architect')} Produce a consolidated Implementation Plan — a milestone-driven execution system that takes a developer from this product design to working software with a coding agent. The JSON you return drives the rendered UI directly. Every task must be atomic and actionable — concrete engineering work a developer can execute — never an abstract theme. Dependencies must be explicit and accurate so the execution order is unambiguous.

Top-level shape:
- overview: { summary, criticalPath, teamSize }
  - summary: 2-3 sentences describing the build approach.
  - criticalPath: one sentence naming the milestones on the critical path.
  - teamSize: short recommendation (e.g. "1 frontend + 1 backend" or "Solo dev, ~6 weeks").
- summary: { buildStrategy, stackSummary, criticalPath, estimatedEffort, teamAssumption }
  - buildStrategy: 2-3 sentences on the overall approach (walking skeleton, thin vertical slices, etc.).
  - stackSummary: 3-6 short entries naming the concrete stack (e.g. "React + Vite SPA", "Postgres via Supabase").
  - criticalPath: ordered array of the milestone NAMES on the critical path.
  - estimatedEffort: total effort estimate (e.g. "~4 weeks solo").
  - teamAssumption: who this plan assumes is building (e.g. "One developer pairing with a coding agent").
- milestones: 4-6 entries. First is infrastructure/setup. Last covers testing and launch prep. Keep milestones SMALL — each should be independently shippable and verifiable.
- globalQualityGates: 3-6 project-wide quality gates (shape below) that apply to every milestone.
- architecture: top-level array of cross-cutting technical decisions (tech stack picks, key architectural calls). Hoisted out of per-milestone bodies.
- risks: top-level array of { description, mitigation } items spanning the project.
- definitionOfDone: top-level array of project-wide acceptance criteria.

Per milestone:
- id: stable lower-snake-case identifier (e.g. "m_setup", "m_emotion_extraction").
- name: human-readable milestone name.
- timeframe: "Week 1-2" style range.
- goal: one-sentence objective.
- objective: 1-2 sentence richer statement of what the milestone delivers and why it's next.
- priority: "critical" | "high" | "medium" | "low" — by position on the critical path.
- estimatedEffort: short effort estimate (e.g. "2-3 days").
- dependencies: array of OTHER milestone ids that must complete first. Empty array if none.
- linkedArtifacts: { screens, dataModels, components, userFlows, apis } — EXACT names drawn from the dependency artifacts and PRD. Link only what this milestone directly implements; do not invent names.
- tasks: 3-8 atomic, executable tasks.
- promptPacks: 1-3 copy-ready coding-agent prompts (shape below) that implement this milestone. Every milestone MUST have at least one.
- qualityGates: 2-4 milestone-specific quality gates.
- validationCommands: shell commands to verify the milestone (e.g. "npm run build", "npm test"), consistent with the chosen stack.
- definitionOfDone: 2-5 observable acceptance criteria for the milestone.

Per task:
- id: stable lower-snake-case identifier (e.g. "task_initialize_nextjs"). Unique across the whole plan.
- title: short imperative (e.g. "Initialize Next.js SPA").
- description: optional extra context, ONE sentence max.
- status: ALWAYS "todo", without exception. You are generating a plan, not tracking execution; never emit any other status value.
- dependencies: array of OTHER task ids (from this same plan) that must be done first. Empty array if none.
- linkedArtifacts: { prd, dataModel, mockups }
  - prd: PRD feature names (and/or ids) this task implements, drawn from the Canonical Feature Glossary in the user prompt. Across the whole plan, every canonical feature should be implemented by at least one task; use ONLY names/ids from the glossary — never invent a feature reference.
  - dataModel: entity names from the data_model dependency context that this task touches.
  - mockups: screen names from the screen_inventory dependency context that this task implements.
  - Link an artifact only when the task directly implements or modifies it. Omit (or use empty arrays) otherwise. Don't invent artifact references.

Per prompt pack:
- id: stable lower-snake-case identifier, unique across the plan (e.g. "pp_setup_scaffold").
- title: short imperative name.
- purpose: one sentence on what running this prompt accomplishes.
- prompt: the FULL copy-ready prompt body, structured with exactly these markdown headings:
  # Prompt: [Title]
  ## Goal
  ## Relevant Synapse Artifacts
  ## Scope
  ## Out of Scope
  ## Implementation Steps
  ## Acceptance Criteria
  ## Quality Gates
  ## Validation Commands
  ## Commit Guidance
  The body must be fully self-contained (the recipient sees ONLY this text — no PRD, no other artifact): restate the relevant product context, feature behavior, screen/entity names, and constraints inline. Refer to features by human name, never bare IDs. Never use triple backticks inside the prompt body. ${AGENT_AGNOSTIC_RULE}
- scope: { include, exclude } — bulleted scope boundaries; exclude MUST list explicit non-goals.
- acceptanceCriteria: 3-6 specific, testable criteria.
- recommendedCommitMessage: a conventional, imperative commit message for the resulting change.

Rules:
- Task, milestone, prompt-pack, and quality-gate ids must be unique across the entire plan.
- All ids in dependencies must reference ids in the same plan.
- Quality gate shape: { id, title, description?, category, required } with category one of design_fidelity | functional | data_integrity | integration | accessibility | performance | testing | regression.
- Hoist cross-cutting architecture, risks, and definition-of-done into the top-level arrays — do NOT duplicate them per milestone.
- Tasks should read as atomic engineering work, not as themes.
- Favor safe implementation: small milestones, frequent commits, explicit non-goals, validation after every milestone, no broad rewrites.`,
        userPrefix: 'Create a consolidated Implementation Plan (milestones + prompt packs + quality gates) from this PRD:',
    },
    data_model: {
        system: `${artifactRole('senior backend architect')} Produce a Data Model that reads as a clear product/engineering explanation, not a raw schema dump. The artifact must remain structurally parseable: use the same heading and table conventions on every regeneration, and every field must appear in exactly one fieldGroup. Define every field at field level — name, type, requiredness, and a precise description. Model only entities and fields that the PRD's features and entities require; do not introduce speculative fields. Keep entity and field names consistent with the PRD's defined entities.

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
- featureRefs: the canonical PRD feature ids (e.g. "f1", "f3") — and/or their exact names — that this entity supports, drawn from the Canonical Feature Glossary in the user prompt. EVERY entity must map to at least one real feature. Use ONLY ids/names that appear in the glossary; never invent a feature id. If an entity is cross-cutting, list multiple.
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
    // ── RETIRED — legacy rendering contract only. `prompt_pack` is in
    // RETIRED_ARTIFACT_SUBTYPES and is never generated by new runs (the
    // implementation_plan's milestone prompt packs replaced it). This block
    // survives because its `### N. Title` / `**Category:**` /
    // `**Expected Output:**` shape is the contract promptPackParser.ts parses
    // for legacy persisted artifacts. Do NOT extend it; extend
    // implementation_plan instead.
    prompt_pack: {
        system: `${artifactRole('senior prompt engineer')} Create a Prompt Pack — a bundle of ready-to-use downstream prompts that a developer can copy directly into any coding agent or AI assistant WITHOUT also pasting the PRD. Each prompt must be deterministic and directly tool-usable: precise, specific, and free of stylistic or "creative" language. ${AGENT_AGNOSTIC_RULE} Do not tailor a prompt to any one agent's features.

For each prompt, use this exact format:

### [N]. [Prompt Title]
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

${ANTI_PREAMBLE_RULE}`,
        userPrefix: 'Create a Prompt Pack from this PRD:',
    },
    design_system: {
        system: `${artifactRole('senior design systems architect')} Produce a Design System Starter as a STRUCTURED TOKEN CONTRACT. The output is consumed by downstream mockup generation, so every value must be machine-usable and consistent.

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
                if (comp.previewType) {
                    lines.push(`**Preview:** ${comp.previewType}`);
                }
                if (comp.props?.length) {
                    lines.push('**Props:**');
                    comp.props.forEach(p => lines.push(`- \`${p.name}\`: ${p.type}${p.required ? ' (required)' : ''}${p.description ? ` — ${p.description}` : ''}`));
                }
                if (comp.usedIn?.length) {
                    lines.push(`**Used In:** ${comp.usedIn.join(', ')}`);
                }
                if (comp.accessibility) {
                    const a = comp.accessibility;
                    const flags: string[] = [];
                    if (a.keyboard) flags.push('Keyboard');
                    if (a.focusManagement) flags.push('Focus Management');
                    if (a.screenReader) flags.push('Screen Reader');
                    if (a.aria?.length) flags.push(`ARIA: ${a.aria.join(', ')}`);
                    if (a.notes) flags.push(a.notes);
                    if (flags.length) lines.push(`**Accessibility:** ${flags.join('; ')}`);
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
        if (m.goal) lines.push(`**Goal:** ${m.objective ?? m.goal}`);
        if (m.tasks.length) {
            lines.push('**Key Deliverables:**');
            for (const t of m.tasks) {
                lines.push(`- [${t.status === 'done' ? 'x' : ' '}] **${t.title}** — _${t.status}_`);
            }
        }
        // Milestone-level dependencies (consolidated plans) win over the
        // task-id rollup (legacy plans) — same header either way, which is
        // what artifactValidation and the legacy parser expect.
        const deps = m.dependencies?.length
            ? m.dependencies
            : Array.from(new Set(m.tasks.flatMap(t => t.dependencies ?? []))).filter(Boolean);
        if (deps.length) lines.push(`**Dependencies:** ${deps.join(', ')}`);
        // Consolidated-plan sections. Prompt bodies live only in the JSON
        // fence below (they can be long and may collide with markdown
        // formatting); the readable body carries title + purpose.
        if (m.promptPacks?.length) {
            lines.push('**Prompt Packs:**');
            m.promptPacks.forEach(p => lines.push(`- **${p.title}** — ${p.purpose}`));
        }
        if (m.qualityGates?.length) {
            lines.push('**Quality Gates:**');
            m.qualityGates.forEach(g => lines.push(`- [${g.required ? 'required' : 'optional'} · ${g.category}] ${g.title}`));
        }
        if (m.validationCommands?.length) {
            lines.push(`**Validation Commands:** ${m.validationCommands.map(c => `\`${c}\``).join(' · ')}`);
        }
        if (m.definitionOfDone?.length) {
            lines.push('**Definition of Done:**');
            m.definitionOfDone.forEach(d => lines.push(`- [ ] ${d}`));
        }
        lines.push('');
    });

    if (plan.globalQualityGates?.length) {
        lines.push('---', '', '## Global Quality Gates');
        plan.globalQualityGates.forEach(g => {
            lines.push(`- [${g.required ? 'required' : 'optional'} · ${g.category}] ${g.title}`);
        });
        lines.push('');
    }
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
        /**
         * The project's chosen design-system preset id (see
         * DESIGN_SYSTEM_PRESETS). Consumed only by the `design_system` subtype;
         * other subtypes ignore it. Absent/unknown/'custom' → no steering.
         */
        designSystemPreset?: string;
        /**
         * The Canonical PRD Spine — the primary, authoritative source of truth
         * for artifact generation. When present (and non-empty), the prompt
         * leads with it and demotes full PRD markdown to a secondary fallback.
         * When absent, one is rebuilt deterministically from `structuredPRD`;
         * an empty spine (no features) falls back to the legacy summary prompt.
         */
        canonicalSpine?: CanonicalPrdSpine;
        /**
         * Explicit acknowledgement that generation may proceed with one or more
         * REQUIRED upstream dependencies missing (degraded output). Without it,
         * a missing required dependency throws DependencyInsufficiencyError
         * before any model call.
         */
        allowMissingDependencies?: boolean;
        /** Developer-only LLM trace identity (session grouping + project). */
        traceContext?: { sessionId?: string; projectId?: string; projectName?: string };
        /**
         * Observational token-usage sink, forwarded to the transport. Powers
         * the Metrics dashboard's per-artifact token/cost columns.
         */
        onUsage?: (usage: GeminiTokenUsage) => void;
    },
): Promise<CoreArtifactGenerationResult> => {
    const config = CORE_ARTIFACT_PROMPTS[subtype];
    const onProgress = options?.onProgress;
    // Route by complexity: high-reasoning artifacts → Expert (Pro), the rest →
    // Fast (Flash). Mirrors the PRD pipeline's per-section tiering.
    const model = selectArtifactModel(subtype);

    const generatedArtifacts = options?.generatedArtifacts ?? {};
    // Dependency sufficiency gate: block before any model call when a required
    // upstream artifact is missing/empty (unless degraded generation is
    // explicitly acknowledged), rather than silently generating from a soft
    // "Not generated yet." placeholder.
    assertDependenciesSufficient(subtype, generatedArtifacts, {
        allowMissing: options?.allowMissingDependencies,
    });
    const dependencyContext = buildDependencyContext(subtype, generatedArtifacts);
    const guardrails = buildNarrativeGuardrails(structuredPRD);

    const mockupSection = options?.mockupContext
        ? `\n\n---\n\nMockup Context (reference for screens, components, and layout):\n${options.mockupContext.slice(0, 3000)}`
        : '';

    // Design-system preset steering. Only the design_system subtype consumes
    // it; an absent/unknown/'custom' preset yields '' (no steering → original
    // PRD-only behavior). The model still adapts the direction to the domain.
    const presetDirective = subtype === 'design_system'
        ? getDesignSystemPresetDirective(options?.designSystemPreset)
        : '';
    const presetSection = presetDirective
        ? `\n\n---\n\nSELECTED DESIGN DIRECTION (the user explicitly chose this preset — honor it while still fitting the product's domain and audience):\n${presetDirective}\n\nEnsure your token choices (palette, typography, radius, spacing, component recipes) clearly reflect this direction, and include one \`rules\` entry that names the resulting design direction and briefly explains why it fits this product.`
        : '';

    // Use JSON mode for supported artifact types
    const jsonSchemas: Partial<Record<CoreArtifactSubtype, object>> = {
        screen_inventory: screenInventorySchema,
        data_model: dataModelSchema,
        component_inventory: componentInventorySchema,
        design_system: designSystemTokensSchema,
        implementation_plan: implementationPlanSchema,
    };

    // Canonical PRD Spine — the primary, authoritative source of truth. Rebuild
    // deterministically when the caller didn't pass one (e.g. legacy projects
    // with no saved spine). A spine with no features yields a null section; we
    // then fall back to the legacy feature-glossary + inline-summary prompt.
    const canonicalSpine = options?.canonicalSpine
        ?? buildCanonicalPrdSpine(structuredPRD, { designSystemPreset: options?.designSystemPreset });
    const spineSection = buildCanonicalSpinePromptSection(canonicalSpine);
    const spineContextUsed = spineSection !== null;

    // Legacy structured fallback (feature glossary + inline PRD summary), used
    // only when there is no reliable spine (e.g. a PRD with no features). Built
    // lazily so the spine path pays nothing for it.
    const buildLegacyStructured = (): string => {
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
        return `Canonical Feature Glossary:\n${featureGlossary}\n\n${prdSummary}`;
    };

    // Known conflicts / staleness to surface to the model. Missing REQUIRED
    // dependencies (only reachable here when degraded generation was
    // acknowledged) and spine validation warnings are the machine-derivable
    // ones; stale prose feature names are detected inside the prompt builder.
    const missingRequired = findMissingRequiredDependencies(subtype, generatedArtifacts);
    const notices: string[] = [];
    if (missingRequired.length > 0) {
        notices.push(
            `Required upstream ${missingRequired.length > 1 ? 'dependencies are' : 'dependency is'} missing (${missingRequired.join(', ')}); ` +
            'generate against the Canonical PRD Spine and note any gaps rather than inventing detail.',
        );
    }
    for (const w of canonicalSpine.meta.validation.warnings) {
        notices.push(`Canonical PRD Spine warning: ${w}`);
    }

    // Assemble the prompt with an explicit, machine-checkable source hierarchy:
    // task → authoritative canonical spine → authoritative structured dependency
    // summaries → selected options → known conflicts/staleness → SECONDARY full
    // PRD markdown appendix. Prose in the appendix must never override the
    // structured sources. See artifactPromptBuilder.ts.
    const built = buildArtifactPrompt({
        userPrefix: config.userPrefix,
        guardrails,
        canonicalSpine,
        spineSection,
        legacyStructured: spineSection ? undefined : buildLegacyStructured(),
        dependencyContext,
        dependencyKeys: Object.keys(generatedArtifacts),
        presetSection,
        prdMarkdown: prdContent,
        mockupSection,
        notices,
    });
    const userPrompt = built.prompt;

    // Diagnostics stamped onto every artifact version — records whether the
    // canonical spine drove generation or the legacy summary path was used.
    const spineMeta: Record<string, unknown> = {
        spineContextUsed,
        spineSchemaVersion: canonicalSpine.meta.schemaVersion,
    };

    // Developer-only trace enrichment (LLM Trace Viewer). Describes how this
    // artifact's prompt was assembled so prompt contamination is debuggable.
    const artifactLabel = subtype.replace(/_/g, ' ');
    const dependencyKeys = Object.keys(options?.generatedArtifacts ?? {});
    const traceMeta: LlmTraceMeta = {
        sessionId: options?.traceContext?.sessionId,
        sessionLabel: options?.traceContext?.projectName
            ? `Assets · ${options.traceContext.projectName}`
            : 'Artifact Generation',
        stage: 'Artifact',
        purpose: `Generate ${artifactLabel}`,
        artifact: subtype,
        projectId: options?.traceContext?.projectId,
        projectName: options?.traceContext?.projectName,
        inputs: [
            spineContextUsed ? 'Canonical PRD Spine (authoritative)' : 'Legacy PRD summary + feature glossary',
            dependencyKeys.length ? `Dependency artifacts: ${dependencyKeys.join(', ')}` : 'No dependency artifacts',
            options?.mockupContext ? 'Mockup context' : 'No mockup context',
            ...(presetDirective ? ['Design-system preset directive'] : []),
            'Full PRD (secondary reference)',
        ],
        promptPieces: [
            { label: 'Artifact template (userPrefix)', present: true },
            { label: 'Source hierarchy header', present: true },
            { label: 'Narrative guardrails', present: true },
            { label: 'Canonical PRD Spine (authoritative)', present: spineContextUsed },
            { label: 'Legacy structured PRD summary (fallback)', present: !spineContextUsed },
            { label: 'Structured dependency summaries (authoritative)', present: dependencyKeys.length > 0, detail: dependencyKeys.join(', ') || undefined },
            { label: 'Selected options / preset directive', present: Boolean(presetDirective) },
            {
                label: 'Known conflicts & staleness block',
                present: built.hasConflictBlock,
                detail: built.staleNameConflicts.length
                    ? `${built.staleNameConflicts.length} stale feature name(s)`
                    : undefined,
            },
            { label: 'Mockup context', present: Boolean(options?.mockupContext) },
            { label: 'Full PRD markdown appendix (secondary)', present: true },
        ],
    };

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
        let finishReason: string | undefined;
        const result = await callGeminiStream(
            jsonSystem,
            userPrompt,
            {
                onChunk: makeChunkEmitter(() => 'Streaming structured JSON…'),
                onComplete: () => {},
                onError: () => {},
                onFinish: (info) => { finishReason = info.finishReason; },
            },
            options?.signal,
            {
                responseMimeType: 'application/json',
                responseSchema: schema,
                model,
                maxOutputTokens: ARTIFACT_MAX_OUTPUT_TOKENS,
                onUsage: options?.onUsage,
                traceMeta,
            },
        );
        onProgress?.('Validating output…');
        const truncated = finishReason === 'MAX_TOKENS';
        const truncationMeta = truncated ? { truncated: true, finishReason } : {};

        // Parse the JSON body; on a truncated/malformed response, attempt the
        // truncation repair before giving up. A raw unparseable body must NEVER
        // be stored as a completed artifact — the old fallback saved a wall of
        // broken JSON with slot status `done` (and, for design_system, silently
        // dropped the tokens contract that anchors mockups and freshness).
        let parsed: unknown;
        try {
            parsed = JSON.parse(result);
        } catch {
            const { text: repairedText, repaired } = repairTruncatedJson(result);
            if (repaired) {
                parsed = JSON.parse(repairedText);
            } else {
                throw new Error(
                    truncated
                        ? `The ${artifactLabel} response hit the model's output limit and could not be salvaged. Regenerate this artifact.`
                        : `The ${artifactLabel} response returned unparseable JSON. Regenerate this artifact.`,
                );
            }
        }
        // For screen_inventory we persist the structured JSON so the
        // structured renderer in `renderers/index.tsx` activates and
        // export / dependency-context flows can re-render markdown
        // on demand. Other JSON-mode subtypes still serialize to
        // markdown for storage to avoid cross-cutting changes.
        if (subtype === 'screen_inventory') {
            const normalized = normalizeScreenInventory(parsed) ?? parsed;
            return { content: JSON.stringify(normalized, null, 2), metadata: { ...spineMeta, ...truncationMeta } };
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
                metadata: { ...spineMeta, ...truncationMeta, tokens, tokensHash: hashDesignTokens(tokens) },
            };
        }
        return { content, metadata: { ...spineMeta, ...truncationMeta } };
    }

    onProgress?.('Sending request to model…');
    let finishReason: string | undefined;
    const result = await callGeminiStream(
        config.system,
        userPrompt,
        {
            onChunk: makeChunkEmitter(streamingLabel),
            onComplete: () => {},
            onError: () => {},
            onFinish: (info) => { finishReason = info.finishReason; },
        },
        options?.signal,
        { model, maxOutputTokens: ARTIFACT_MAX_OUTPUT_TOKENS, onUsage: options?.onUsage, traceMeta },
    );
    onProgress?.('Validating output…');
    // Markdown artifacts degrade more gracefully under truncation (the partial
    // text is still readable), but the cut-off must not read as `done` —
    // stamp it so the job controller flags the slot needs_review.
    const truncationMeta = finishReason === 'MAX_TOKENS' ? { truncated: true, finishReason } : {};
    return { content: normalizeArtifactMarkdown(result), metadata: { ...spineMeta, ...truncationMeta } };
};
