import type { StructuredPRD, Milestone, AgentTarget, ProjectPlatform } from '../../types';
import { callGemini } from '../geminiClient';
import type { ProviderOptions } from '../geminiClient';
import { structuredPRDSchema, devPlanSchema, agentPromptSchema, targetLabels } from '../schemas/prdSchemas';

const PLATFORM_CONTEXT: Record<ProjectPlatform, string> = {
    app: 'The user is building a native mobile application (iOS/Android). Focus on mobile-specific patterns: touch interactions, offline support, push notifications, device APIs, responsive mobile layouts, and app store distribution.',
    web: 'The user is building a web application. Focus on web-specific patterns: responsive design, browser compatibility, SEO, progressive enhancement, URL routing, and web deployment.',
};

export const enhancePrompt = async (rawPrompt: string): Promise<string> => {
    const system = `You are an expert product consultant. The user has written a rough product idea. Your job is to expand it into a clear, detailed product description that will produce an excellent PRD.

Rules:
- Keep the user's core idea and intent intact
- Add specificity: target users, key features, differentiators, and technical considerations
- Keep it to 2-3 paragraphs maximum
- Write in a natural, descriptive style (not bullet points)
- Do NOT add markdown formatting
- Return ONLY the enhanced prompt text, nothing else`;

    return await callGemini(system, rawPrompt);
};

export interface GeneratedAgentPrompt {
    branchName: string;
    objective: string;
    tasks: string[];
    constraints: string[];
    verificationSteps: string[];
    rawPromptText: string;
}

export const generateStructuredPRD = async (promptText: string, options?: ProviderOptions, platform?: ProjectPlatform): Promise<StructuredPRD> => {
    options?.onStatus?.("Generating structured PRD with Gemini...");

    const platformNote = platform ? `\n\n${PLATFORM_CONTEXT[platform]}` : '';

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

Each acceptance criterion must be testable and specific. Prioritize features using MoSCoW: "must" for launch-critical, "should" for important, "could" for nice-to-have.${platformNote}`;

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
