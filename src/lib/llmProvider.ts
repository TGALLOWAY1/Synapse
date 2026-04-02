import type { StructuredPRD, Milestone, AgentTarget, MockupSettings, CoreArtifactSubtype, ScreenInventoryContent, DataModelContent, ComponentInventoryContent, MarkupImageSpec, MarkupImageSubtype } from '../types';
import { screenInventorySchema, dataModelSchema, componentInventorySchema } from './schemas/artifactSchemas';
import { markupImageSchema } from './schemas/markupImageSchema';

const getApiKey = () => {
    const key = localStorage.getItem('GEMINI_API_KEY');
    if (!key) {
        throw new Error('Missing Gemini API Key. Please click the Settings gear icon in the top right to add your key.');
    }
    return key;
};

const getModel = () => {
    return localStorage.getItem('GEMINI_MODEL') || 'gemini-2.5-flash';
};

interface JsonModeConfig {
    responseMimeType: string;
    responseSchema: object;
}

const callGemini = async (systemInstruction: string, promptText: string, jsonMode?: JsonModeConfig, signal?: AbortSignal) => {
    const startTime = performance.now();
    const apiKey = getApiKey();
    const model = getModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const body: Record<string, unknown> = {
        systemInstruction: {
            parts: [{ text: systemInstruction }]
        },
        contents: [{
            parts: [{ text: promptText }]
        }]
    };

    if (jsonMode) {
        body.generationConfig = {
            responseMimeType: jsonMode.responseMimeType,
            responseSchema: jsonMode.responseSchema,
        };
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal,
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(`Gemini API Error: ${response.statusText} - ${errorData?.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    const text = data.candidates[0].content.parts[0].text;
    const durationMs = performance.now() - startTime;
    console.log(`[GEN] callGemini: ${durationMs.toFixed(0)}ms (${text.length} chars)`);
    return text;
};

export interface StreamCallbacks {
    onChunk: (text: string) => void;
    onComplete: (fullText: string) => void;
    onError: (error: Error) => void;
}

const callGeminiStream = async (
    systemInstruction: string,
    promptText: string,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
): Promise<string> => {
    const startTime = performance.now();
    const apiKey = getApiKey();
    const model = getModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

    const body = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ parts: [{ text: promptText }] }],
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal,
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const err = new Error(`Gemini API Error: ${response.statusText} - ${errorData?.error?.message || 'Unknown error'}`);
        callbacks.onError(err);
        throw err;
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body for streaming');

    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const jsonStr = line.slice(6).trim();
                if (!jsonStr || jsonStr === '[DONE]') continue;

                try {
                    const chunk = JSON.parse(jsonStr);
                    const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) {
                        fullText += text;
                        callbacks.onChunk(text);
                    }
                } catch {
                    // Skip malformed JSON chunks
                }
            }
        }
    } catch (e) {
        if (signal?.aborted) {
            reader.cancel();
            throw new DOMException('Aborted', 'AbortError');
        }
        throw e;
    }

    const durationMs = performance.now() - startTime;
    console.log(`[GEN] callGeminiStream: ${durationMs.toFixed(0)}ms (${fullText.length} chars)`);
    callbacks.onComplete(fullText);
    return fullText;
};

export { callGeminiStream };

export interface ConsolidationResult {
    localPatch?: string;
    docWidePatch?: string;
}

export type ConsolidationScope = 'local' | 'doc-wide';

export const consolidateBranch = async (
    spineText: string,
    branch: { anchorText: string, messages?: { role: string, content: string }[] },
    scope?: ConsolidationScope
): Promise<ConsolidationResult> => {
    let threadContext = '';
    if (branch.messages && branch.messages.length > 0) {
        threadContext = '\n\nConversation Context:\n' + branch.messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    }

    const localSystem = "You are a helpful assistant. You need to rewrite a specific excerpt from a PRD based on a thread of feedback. Only provide the rewritten excerpt, nothing else.";
    const localPrompt = `Original Excerpt: "${branch.anchorText}"\nFeedback Context: The user wants to consolidate the changes discussed in the branch.${threadContext}\n\nPlease provide ONLY the rewritten excerpt.`;

    const docSystem = "You are a helpful assistant. Please rewrite the entire PRD document to incorporate the following change requested.";
    const docPrompt = `Requested change for excerpt: "${branch.anchorText}".${threadContext}\nMake sure the entire document reflects this change coherently. Provide ONLY the new Markdown document without any introductory or concluding text.\n\nOriginal Document:\n${spineText}`;

    try {
        if (scope === 'local') {
            const localPatch = await callGemini(localSystem, localPrompt);
            return { localPatch: localPatch.trim() };
        } else if (scope === 'doc-wide') {
            const docWidePatch = await callGemini(docSystem, docPrompt);
            return { docWidePatch: docWidePatch.trim() };
        } else {
            // Default to both for backward compatibility or if not specified
            const [localPatch, docWidePatch] = await Promise.all([
                callGemini(localSystem, localPrompt),
                callGemini(docSystem, docPrompt)
            ]);
            return {
                localPatch: localPatch.trim(),
                docWidePatch: docWidePatch.trim()
            };
        }
    } catch (e: unknown) {
        console.error(e);
        throw e;
    }
};

export const replyInBranch = async (
    context: { anchorText: string, intent: string, threadHistory: { role: string; content: string }[] }
): Promise<string> => {
    try {
        const system = `You are a product management assistant helping a user refine a PRD. The user has selected the text: "${context.anchorText}". Please respond to their intent concisely. If they ask for a change, provide a "Suggested replacement for selected text:" block.`;

        let promptText = `Thread History:\n`;
        if (context.threadHistory && context.threadHistory.length > 0) {
            context.threadHistory.forEach(msg => {
                promptText += `${msg.role.toUpperCase()}: ${msg.content}\n\n`;
            });
        }
        promptText += `USER INTENT: ${context.intent}`;

        return await callGemini(system, promptText);
    } catch (e: unknown) {
        console.error(e);
        const errorMsg = e instanceof Error ? e.message : String(e);
        return `Error: ${errorMsg}`;
    }
};

export interface ProviderOptions {
    onStatus?: (status: string) => void;
}

// Structured PRD schema for Gemini JSON mode
const structuredPRDSchema = {
    type: "OBJECT",
    properties: {
        vision: { type: "STRING" },
        targetUsers: { type: "ARRAY", items: { type: "STRING" } },
        coreProblem: { type: "STRING" },
        features: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    id: { type: "STRING" },
                    name: { type: "STRING" },
                    description: { type: "STRING" },
                    userValue: { type: "STRING" },
                    complexity: { type: "STRING", enum: ["low", "medium", "high"] },
                    priority: { type: "STRING", enum: ["must", "should", "could"] },
                    acceptanceCriteria: { type: "ARRAY", items: { type: "STRING" } },
                    dependencies: { type: "ARRAY", items: { type: "STRING" } },
                },
                required: ["id", "name", "description", "userValue", "complexity", "priority", "acceptanceCriteria"],
            }
        },
        architecture: { type: "STRING" },
        risks: { type: "ARRAY", items: { type: "STRING" } },
        nonFunctionalRequirements: { type: "ARRAY", items: { type: "STRING" } },
        constraints: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["vision", "targetUsers", "coreProblem", "features", "architecture", "risks", "nonFunctionalRequirements", "constraints"],
};

export const generateStructuredPRD = async (promptText: string, options?: ProviderOptions): Promise<StructuredPRD> => {
    options?.onStatus?.("Generating structured PRD with Gemini...");

    const system = `You are an expert product manager. Generate a structured Product Requirements Document based on the user's idea.

Provide:
- A clear, compelling vision statement (1-2 sentences)
- Specific target user personas (not generic descriptions)
- The core problem being solved (specific, not vague)
- Features with: unique id (f1, f2...), name, description, user value, complexity (low/medium/high), priority (must/should/could), acceptance criteria (at least 2 per feature), and dependencies (feature IDs this depends on, if any)
- Technical architecture with specific technology choices, not generic patterns
- Risks with specific mitigation strategies
- Non-functional requirements (performance, security, accessibility, etc.)
- Constraints (budget, timeline, technical, regulatory)

Each acceptance criterion must be testable and specific. Prioritize features using MoSCoW: "must" for launch-critical, "should" for important, "could" for nice-to-have.`;

    const result = await callGemini(
        system,
        `User's Idea: ${promptText}`,
        { responseMimeType: "application/json", responseSchema: structuredPRDSchema }
    );

    try {
        return JSON.parse(result) as StructuredPRD;
    } catch {
        throw new Error('Failed to parse structured PRD response from LLM. Please try again.');
    }
};

// Dev Plan schema for Gemini JSON mode
const devPlanSchema = {
    type: "OBJECT",
    properties: {
        milestones: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    id: { type: "STRING" },
                    name: { type: "STRING" },
                    description: { type: "STRING" },
                    order: { type: "INTEGER" },
                    tasks: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                id: { type: "STRING" },
                                name: { type: "STRING" },
                                description: { type: "STRING" },
                                status: { type: "STRING", enum: ["pending", "in-progress", "done"] },
                            },
                            required: ["id", "name", "description", "status"],
                        }
                    },
                },
                required: ["id", "name", "description", "order", "tasks"],
            }
        }
    },
    required: ["milestones"],
};

export const generateDevPlan = async (structuredPRD: StructuredPRD, options?: ProviderOptions): Promise<Milestone[]> => {
    options?.onStatus?.("Generating development plan...");

    const system = `You are an expert software architect and project planner. Given a structured PRD, create a milestone-based development roadmap.
Each milestone should represent a logical phase of development (e.g., "Core Architecture", "Core Features", "UX & Polish", "Testing & Launch").
Each milestone should contain specific, actionable tasks.
Use unique IDs like "m1", "m2" for milestones and "t1", "t2" for tasks.
All tasks should start with status "pending".
Order milestones sequentially (order: 1, 2, 3...).
Be practical and specific to the product described.`;

    const prdSummary = `Vision: ${structuredPRD.vision}
Core Problem: ${structuredPRD.coreProblem}
Target Users: ${structuredPRD.targetUsers.join(', ')}
Features: ${structuredPRD.features.map(f => `${f.name} (${f.complexity})`).join(', ')}
Architecture: ${structuredPRD.architecture}`;

    const result = await callGemini(
        system,
        `Create a development plan for this product:\n\n${prdSummary}`,
        { responseMimeType: "application/json", responseSchema: devPlanSchema }
    );

    try {
        const parsed = JSON.parse(result);
        return parsed.milestones as Milestone[];
    } catch {
        throw new Error('Failed to parse development plan response from LLM. Please try again.');
    }
};

// Agent Prompt schema for Gemini JSON mode
const agentPromptSchema = {
    type: "OBJECT",
    properties: {
        branchName: { type: "STRING" },
        objective: { type: "STRING" },
        tasks: { type: "ARRAY", items: { type: "STRING" } },
        constraints: { type: "ARRAY", items: { type: "STRING" } },
        verificationSteps: { type: "ARRAY", items: { type: "STRING" } },
        rawPromptText: { type: "STRING" },
    },
    required: ["branchName", "objective", "tasks", "constraints", "verificationSteps", "rawPromptText"],
};

const targetLabels: Record<AgentTarget, string> = {
    cursor: 'Cursor',
    codex: 'Codex',
    claude: 'Claude Code',
    copilot: 'GitHub Copilot',
};

export interface GeneratedAgentPrompt {
    branchName: string;
    objective: string;
    tasks: string[];
    constraints: string[];
    verificationSteps: string[];
    rawPromptText: string;
}

export const generateAgentPrompt = async (
    milestone: { name: string; description: string; tasks: { name: string; description: string }[] },
    target: AgentTarget,
    prdContext: string,
    options?: ProviderOptions
): Promise<GeneratedAgentPrompt> => {
    options?.onStatus?.(`Generating ${targetLabels[target]} prompt...`);

    const system = `You are an expert at writing prompts for AI coding agents. Generate a structured, ready-to-use coding prompt for ${targetLabels[target]}.
The prompt should be specific, actionable, and include a git branch name, clear objective, task breakdown, technical constraints, and verification steps.
The rawPromptText field should be the full, copy-pasteable prompt that a developer can give directly to ${targetLabels[target]}.
Make the rawPromptText comprehensive but focused — it should be a self-contained instruction that the coding agent can execute.`;

    const milestoneContext = `Milestone: ${milestone.name}
Description: ${milestone.description}
Tasks: ${milestone.tasks.map(t => `- ${t.name}: ${t.description}`).join('\n')}

PRD Context:
${prdContext}`;

    const result = await callGemini(
        system,
        `Generate a ${targetLabels[target]} coding prompt for this milestone:\n\n${milestoneContext}`,
        { responseMimeType: "application/json", responseSchema: agentPromptSchema }
    );

    try {
        return JSON.parse(result) as GeneratedAgentPrompt;
    } catch {
        throw new Error('Failed to parse agent prompt response from LLM. Please try again.');
    }
};

export const structuredPRDToMarkdown = (prd: StructuredPRD): string => {
    const lines: string[] = [];

    lines.push('## Vision');
    lines.push(prd.vision);
    lines.push('');

    lines.push('## Target Users');
    prd.targetUsers.forEach(u => lines.push(`- ${u}`));
    lines.push('');

    lines.push('## Core Problem');
    lines.push(prd.coreProblem);
    lines.push('');

    lines.push('## Features');
    prd.features.forEach(f => {
        lines.push(`### ${f.name}`);
        lines.push(f.description);
        lines.push(`- **User Value:** ${f.userValue}`);
        lines.push(`- **Complexity:** ${f.complexity}`);
        if (f.priority) lines.push(`- **Priority:** ${f.priority}`);
        if (f.acceptanceCriteria && f.acceptanceCriteria.length > 0) {
            lines.push('- **Acceptance Criteria:**');
            f.acceptanceCriteria.forEach(ac => lines.push(`  - ${ac}`));
        }
        if (f.dependencies && f.dependencies.length > 0) {
            lines.push(`- **Dependencies:** ${f.dependencies.join(', ')}`);
        }
        lines.push('');
    });

    lines.push('## Architecture');
    lines.push(prd.architecture);
    lines.push('');

    lines.push('## Risks');
    prd.risks.forEach(r => lines.push(`- ${r}`));
    lines.push('');

    if (prd.nonFunctionalRequirements && prd.nonFunctionalRequirements.length > 0) {
        lines.push('## Non-Functional Requirements');
        prd.nonFunctionalRequirements.forEach(r => lines.push(`- ${r}`));
        lines.push('');
    }

    if (prd.constraints && prd.constraints.length > 0) {
        lines.push('## Constraints');
        prd.constraints.forEach(c => lines.push(`- ${c}`));
        lines.push('');
    }

    return lines.join('\n');
};

// --- Mockup Generation ---

const FIDELITY_INSTRUCTIONS: Record<string, string> = {
    low: 'Use simple ASCII wireframes with boxes, lines, and placeholder text. Focus on layout and content hierarchy, not visual detail.',
    mid: 'Use structured text descriptions with clear component names, layout specifications, and content placeholders. Include navigation and interaction notes.',
    high: 'Provide detailed, polished descriptions including typography, spacing, color suggestions, hover states, and micro-interactions.',
};

const PLATFORM_INSTRUCTIONS: Record<string, string> = {
    desktop: 'Design for a desktop/laptop viewport (1280px+ width). Use appropriate navigation patterns like sidebars, top bars, and multi-column layouts.',
    mobile: 'Design for mobile viewport (375px width). Use mobile patterns like bottom navigation, hamburger menus, and single-column layouts.',
    responsive: 'Describe both desktop and mobile layouts, noting how the design adapts across breakpoints.',
};

const SCOPE_INSTRUCTIONS: Record<string, string> = {
    single_screen: 'Generate a single, detailed screen mockup.',
    multi_screen: 'Generate mockups for 3-5 key screens that represent the core experience.',
    key_workflow: 'Generate mockups for a complete key user workflow, showing each step and transition.',
};

export const generateMockup = async (
    prdContent: string,
    settings: MockupSettings,
    options?: ProviderOptions
): Promise<string> => {
    options?.onStatus?.('Generating mockup...');

    const system = `You are an expert UI/UX designer. Generate text-based mockups for a product based on its PRD.

${FIDELITY_INSTRUCTIONS[settings.fidelity]}
${PLATFORM_INSTRUCTIONS[settings.platform]}
${SCOPE_INSTRUCTIONS[settings.scope]}

${settings.style ? `Style direction: ${settings.style}` : ''}
${settings.notes ? `Additional notes: ${settings.notes}` : ''}

For each screen, provide:
1. Screen name and purpose
2. Visual layout using ASCII art or structured description
3. Component list with descriptions
4. Navigation and interaction notes
5. Content/copy placeholders

Use clear section headers and consistent formatting throughout.`;

    return callGemini(system, `Generate mockups based on this PRD:\n\n${prdContent}`);
};

// --- Core Artifact Generation ---

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

// Convert structured artifact JSON to markdown for display
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

// --- Artifact Refinement ---

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

// --- Markup Image Generation ---

const MARKUP_IMAGE_PROMPTS: Record<MarkupImageSubtype, string> = {
    screenshot_annotation: 'Create an annotated screenshot layout with numbered callouts highlighting key UI elements, issues, or design decisions. Use highlight boxes to draw attention to specific areas and callouts with explanatory text.',
    critique_board: 'Create a design critique board with highlight regions marking areas of concern, numbered markers for each issue, and callout boxes explaining what could be improved and why.',
    wireframe_callout: 'Create an annotated wireframe layout with labeled boxes for each UI section, arrows showing user flow between elements, and text blocks describing component behavior.',
    flow_annotation: 'Create a flow diagram with numbered steps, arrows showing progression between steps, and text labels describing each action and decision point.',
    design_feedback: 'Create a visual feedback board with highlight regions, arrows pointing to specific elements, and callout boxes with constructive feedback and suggestions.',
};

export const generateMarkupImage = async (
    subtype: MarkupImageSubtype,
    prdContent: string,
    structuredPRD: StructuredPRD,
    sourceArtifactContent?: string,
    options?: ProviderOptions,
): Promise<MarkupImageSpec> => {
    options?.onStatus?.(`Generating ${subtype.replace(/_/g, ' ')}...`);

    const subtypeInstruction = MARKUP_IMAGE_PROMPTS[subtype];

    const system = `You are an expert UI/UX designer and visual annotation specialist. Generate a structured annotation specification in JSON format.

${subtypeInstruction}

Important layout rules:
- Canvas should be 1280x800 pixels with a light background (#f8f8f8 or similar)
- Position all elements within the canvas bounds (0-1280 for x, 0-800 for y)
- Use consistent colors: red (#ef4444) for issues, blue (#3b82f6) for notes, green (#22c55e) for approvals, amber (#f59e0b) for warnings
- Number markers should be 24px circles with white text
- Callouts should be 200-300px wide with 12-14px text
- Leave 20px padding from canvas edges
- Ensure no overlapping elements — space callouts clearly
- Use 4-8 annotation layers for a clear, readable result

Return a MarkupImageSpec with version "markup_v1".`;

    const prompt = `${subtypeInstruction}

PRD Summary:
Vision: ${structuredPRD.vision}
Core Problem: ${structuredPRD.coreProblem}
Features: ${structuredPRD.features.map(f => `${f.name}: ${f.description}`).join('\n')}
${sourceArtifactContent ? `\nSource Artifact:\n${sourceArtifactContent.slice(0, 2000)}` : ''}

Full PRD:\n${prdContent.slice(0, 3000)}`;

    const result = await callGemini(
        system,
        prompt,
        { responseMimeType: 'application/json', responseSchema: markupImageSchema }
    );

    try {
        const spec = JSON.parse(result) as MarkupImageSpec;
        // Post-process: clamp positions to canvas bounds
        return clampMarkupImagePositions(spec);
    } catch {
        throw new Error('Failed to parse markup image spec from LLM. Please try again.');
    }
};

function clampMarkupImagePositions(spec: MarkupImageSpec): MarkupImageSpec {
    const { width, height } = spec.canvas;
    return {
        ...spec,
        layers: spec.layers.map(layer => ({
            ...layer,
            position: {
                x: Math.max(0, Math.min(width - 20, layer.position.x)),
                y: Math.max(0, Math.min(height - 20, layer.position.y)),
            },
        })),
    };
}
