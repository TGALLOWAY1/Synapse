import type { StructuredPRD, Milestone, AgentTarget, MockupSettings, CoreArtifactSubtype } from '../types';

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

const callGemini = async (systemInstruction: string, promptText: string, jsonMode?: JsonModeConfig) => {
    const apiKey = getApiKey();
    const model = getModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

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
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(`Gemini API Error: ${response.statusText} - ${errorData?.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
};

export interface ProviderOptions {
    onStatus?: (status: string) => void;
}

export const generatePRD = async (promptText: string, options?: ProviderOptions): Promise<string> => {
    options?.onStatus?.("Generating PRD with Gemini...");
    const system = "You are an expert product manager. Write a comprehensive Product Requirements Document (PRD) based on the following user prompt. Use Markdown formatting. Include sections for Overview, Goals, Scope, and Technical Approach.";
    return callGemini(system, `User Prompt: ${promptText}`);
};

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
                },
                required: ["id", "name", "description", "userValue", "complexity"],
            }
        },
        architecture: { type: "STRING" },
        risks: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["vision", "targetUsers", "coreProblem", "features", "architecture", "risks"],
};

export const generateStructuredPRD = async (promptText: string, options?: ProviderOptions): Promise<StructuredPRD> => {
    options?.onStatus?.("Generating structured PRD with Gemini...");

    const system = `You are an expert product manager. Generate a structured Product Requirements Document based on the user's idea.
Provide a clear vision statement, identify target users, define the core problem, list features with complexity ratings, describe the technical architecture, and identify risks.
Each feature should have a unique id (like "f1", "f2", etc.), a name, description, user value explanation, and complexity rating (low/medium/high).
Be thorough but concise. Focus on actionable, specific content.`;

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
        lines.push('');
    });

    lines.push('## Architecture');
    lines.push(prd.architecture);
    lines.push('');

    lines.push('## Risks');
    prd.risks.forEach(r => lines.push(`- ${r}`));
    lines.push('');

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

For each screen, include:
- Screen name
- Purpose/description
- Key components present
- Navigation context (what leads here, where users go next)
- Priority (core/secondary/supporting)

Group screens by functional area. Use markdown formatting.`,
        userPrefix: 'Create a Screen Inventory from this PRD:',
    },
    user_flows: {
        system: `You are an expert UX designer. Create detailed User Flows — the primary user journeys and key flow sequences derived from the PRD.

For each flow:
- Flow name and goal
- Step-by-step sequence with screen references
- Decision points and branches
- Success and error paths
- Entry and exit points

Use numbered steps and markdown formatting. Include both happy paths and edge cases.`,
        userPrefix: 'Create User Flows from this PRD:',
    },
    component_inventory: {
        system: `You are an expert frontend architect. Create a Component Inventory — a starter list of reusable UI components implied by the product design.

For each component:
- Component name
- Description and purpose
- Props/variants it needs
- Where it appears (screen references)
- Complexity estimate (simple/moderate/complex)

Group by category (navigation, forms, display, feedback, layout). Use markdown formatting.`,
        userPrefix: 'Create a Component Inventory from this PRD:',
    },
    implementation_plan: {
        system: `You are an expert software architect. Create a high-level Implementation Plan — a milestone-oriented development plan.

Include:
- 4-6 milestones in logical build order
- For each milestone: name, description, key deliverables, estimated scope
- Dependencies between milestones
- Suggested technical approach notes
- Risk areas per milestone

Use markdown formatting with clear milestone headers.`,
        userPrefix: 'Create an Implementation Plan from this PRD:',
    },
    data_model: {
        system: `You are an expert backend architect. Create a Data Model Draft — the primary entities, relationships, and state/data needs.

Include:
- Entity definitions with key fields and types
- Relationships between entities (one-to-many, many-to-many, etc.)
- Key indexes and constraints
- State management considerations
- API surface implications

Use markdown formatting. Present entities in a clear, structured format.`,
        userPrefix: 'Create a Data Model Draft from this PRD:',
    },
    prompt_pack: {
        system: `You are an expert at writing AI prompts. Create a Prompt Pack — a bundle of downstream prompts for design, coding, critique, and testing tasks.

Include prompts for:
1. UI Implementation (for coding agents)
2. UX Critique (for design review)
3. Testing Strategy (for QA)
4. API Design (for backend work)
5. Copy/Content Writing
6. Accessibility Audit

Each prompt should be self-contained, specific, and ready to use. Include the context needed.`,
        userPrefix: 'Create a Prompt Pack from this PRD:',
    },
    design_system: {
        system: `You are an expert design systems architect. Create a Design System Starter — a foundational UI system draft.

Include:
- Color palette suggestions (primary, secondary, neutral, semantic)
- Typography scale (headings, body, captions)
- Spacing system
- Component patterns (buttons, inputs, cards, modals, etc.)
- Interaction patterns (hover, focus, loading, transitions)
- Layout grid recommendations
- Iconography direction

Use markdown formatting. Be specific enough to guide implementation.`,
        userPrefix: 'Create a Design System Starter from this PRD:',
    },
};

export const generateCoreArtifact = async (
    subtype: CoreArtifactSubtype,
    prdContent: string,
    structuredPRD: StructuredPRD,
    options?: ProviderOptions
): Promise<string> => {
    const config = CORE_ARTIFACT_PROMPTS[subtype];
    options?.onStatus?.(`Generating ${subtype.replace(/_/g, ' ')}...`);

    const prdSummary = `Vision: ${structuredPRD.vision}
Core Problem: ${structuredPRD.coreProblem}
Target Users: ${structuredPRD.targetUsers.join(', ')}
Features: ${structuredPRD.features.map(f => `${f.name} (${f.complexity}): ${f.description}`).join('\n')}
Architecture: ${structuredPRD.architecture}`;

    return callGemini(
        config.system,
        `${config.userPrefix}\n\n${prdSummary}\n\n---\n\nFull PRD:\n${prdContent}`
    );
};
