// Prompts and fallbacks for the optional preflight clarification step.
//
// The authoritative safety guardrail is the code-level classifier
// (classifyProjectSafety), which the preflight service runs BEFORE generating
// any questions. SAFETY_OVERRIDE is prepended here as defense-in-depth so the
// model never produces questions that help specify harmful intent.

import { SAFETY_OVERRIDE } from './prdPrompts';
import type { PreflightMode, PreflightQuestion } from '../../types';

/** Number of questions per mode. */
export const QUESTION_COUNT: Record<Exclude<PreflightMode, 'none'>, number> = {
    quick: 5,
    deep: 10,
};

// System instruction for question generation. The model returns exactly N
// idea-specific questions — no generic boilerplate.
export const buildQuestionSystemInstruction = (count: number): string => `${SAFETY_OVERRIDE}

You are a senior product strategist running a fast, focused discovery interview before a Product Requirements Document is written. You receive a plain-language product idea. Generate exactly ${count} clarifying questions tailored specifically to THIS idea.

Rules:
- Generate exactly ${count} questions. No more, no fewer.
- Each question must be specific to the stated idea — never generic filler that would apply to any product.
- Cover the highest-leverage unknowns first. Draw from: target users, the core problem, user goals, MVP scope, key workflows, success criteria, constraints, differentiation, technical expectations, and — only when relevant to this idea — monetization/business model and safety/compliance concerns.
- One clear question per item. Keep each question to a single sentence a non-technical founder can answer.
- For each question, include a short "intent" (≤ 12 words) explaining why it matters.
- Do not ask the user to write the PRD; ask for decisions and facts that inform it.
- Do not number the questions or add commentary.

Return only the JSON object matching the schema.`;

// System instruction for summary generation. Produces a concise, scannable
// recap plus derived assumptions and open unknowns.
export const SUMMARY_SYSTEM_INSTRUCTION = `${SAFETY_OVERRIDE}

You are a senior product strategist. You receive a product idea and the user's answers to a set of clarifying questions (some may be skipped). Produce a brief recap that will seed PRD generation.

Rules:
- "summary": 4-7 short, scannable bullet-style sentences capturing what was learned. Lead each with the concrete decision or fact. No marketing language, no hedging.
- "assumptions": reasonable assumptions you are making where the user gave partial or no answer. State them plainly; do not invent certainty the user did not express.
- "unknowns": questions the user skipped or left genuinely undecided, phrased as open items for the PRD's open-questions/assumptions handling.
- Treat answered questions as authoritative user intent. Never contradict an explicit answer.
- Be concise. Do not restate the questions verbatim.

Return only the JSON object matching the schema.`;

// Generic fallback question sets, used only when AI question generation fails.
// These are the exact sets specified in the product brief.
export const FALLBACK_QUESTIONS_5: { question: string; intent: string }[] = [
    { question: 'Who is the primary user?', intent: 'Anchors the whole product to a real audience.' },
    { question: 'What problem are they trying to solve?', intent: 'Defines the core job to be done.' },
    { question: 'What should the MVP absolutely include?', intent: 'Sets the must-have scope.' },
    { question: 'What should be excluded from the first version?', intent: 'Keeps the MVP shippable.' },
    { question: 'How will you know the product is successful?', intent: 'Defines success criteria.' },
];

export const FALLBACK_QUESTIONS_10: { question: string; intent: string }[] = [
    ...FALLBACK_QUESTIONS_5,
    { question: 'What are the most important user workflows?', intent: 'Drives screen and flow design.' },
    { question: 'Are there any technical constraints?', intent: 'Shapes architecture decisions.' },
    { question: 'Are there any privacy, safety, or compliance concerns?', intent: 'Surfaces guardrails early.' },
    { question: 'What makes this different from existing solutions?', intent: 'Clarifies differentiation.' },
    { question: 'What assumptions should the PRD make if details are unknown?', intent: 'Guides assumption handling.' },
];

export const fallbackQuestionsFor = (mode: Exclude<PreflightMode, 'none'>) =>
    mode === 'deep' ? FALLBACK_QUESTIONS_10 : FALLBACK_QUESTIONS_5;

/** Shape of the clarification context forwarded into PRD generation. */
export interface PreflightContext {
    mode: PreflightMode;
    clarificationResponses: {
        question: string;
        answer: string | null;
        skipped: boolean;
        intent?: string;
    }[];
    summary?: string;
    assumptions?: string[];
    unknowns?: string[];
}

/**
 * Build the clarification block appended to the PRD prompt. Includes the
 * authoritative-intent instruction (verbatim from the product brief) so the
 * generator treats answers as intent and skipped questions as unknowns rather
 * than fabricating certainty.
 */
export const buildClarificationPromptBlock = (ctx: PreflightContext): string => {
    const lines: string[] = [];
    lines.push('## Preflight Clarification');
    lines.push(
        'The user optionally completed a preflight clarification step. Treat answered clarification responses as authoritative intent. Use them to resolve ambiguity in the PRD. If a question was skipped, do not invent certainty. Instead, make a reasonable assumption and include it in the assumptions or open questions section where appropriate.',
    );

    if (ctx.clarificationResponses.length > 0) {
        lines.push('\nClarification responses:');
        for (const r of ctx.clarificationResponses) {
            if (r.skipped || !r.answer || !r.answer.trim()) {
                lines.push(`- Q: ${r.question}\n  A: (skipped — treat as an open unknown)`);
            } else {
                lines.push(`- Q: ${r.question}\n  A: ${r.answer.trim()}`);
            }
        }
    }

    if (ctx.summary && ctx.summary.trim()) {
        lines.push(`\nSummary of intent:\n${ctx.summary.trim()}`);
    }
    if (ctx.assumptions && ctx.assumptions.length > 0) {
        lines.push(`\nAssumptions to carry into the PRD:\n${ctx.assumptions.map((a) => `- ${a}`).join('\n')}`);
    }
    if (ctx.unknowns && ctx.unknowns.length > 0) {
        lines.push(`\nOpen unknowns (do not fabricate answers):\n${ctx.unknowns.map((u) => `- ${u}`).join('\n')}`);
    }

    return lines.join('\n');
};

/** Format question/answer pairs for the summary prompt. */
export const formatAnswersForSummary = (idea: string, questions: PreflightQuestion[]): string => {
    const qa = questions
        .map((q, i) => {
            const answered = !q.skipped && q.answer && q.answer.trim();
            return `${i + 1}. ${q.question}\n   Answer: ${answered ? q.answer!.trim() : '(skipped)'}`;
        })
        .join('\n');
    return `Product idea:\n${idea}\n\nClarification Q&A:\n${qa}`;
};
