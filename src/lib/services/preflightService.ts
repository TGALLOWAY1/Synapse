// Optional preflight clarification: AI-generated discovery questions and a
// pre-PRD summary. Safety is classified BEFORE any questions are generated —
// a disallowed idea throws SafetyBlockedError and no questions are produced.
//
// Both calls degrade gracefully: question generation falls back to a generic
// set on non-safety failure, and summary generation falls back to a
// deterministic local recap, so the user is never blocked from continuing.

import { callGemini, type JsonModeConfig } from '../geminiClient';
import { classifyProjectSafety, SafetyBlockedError, type SafetyTransport } from '../safety';
import { preflightQuestionsSchema, preflightSummarySchema } from '../schemas/preflightSchemas';
import { repairTruncatedJson } from '../jsonRepair';
import {
    buildQuestionSystemInstruction,
    SUMMARY_SYSTEM_INSTRUCTION,
    QUESTION_COUNT,
    fallbackQuestionsFor,
    formatAnswersForSummary,
} from '../prompts/preflightPrompts';
import type { PreflightMode, PreflightQuestion } from '../../types';

/** Injectable transport so tests can run without hitting the network. */
export type PreflightTransport = (
    system: string,
    prompt: string,
    jsonMode: JsonModeConfig,
) => Promise<string>;

const defaultTransport: PreflightTransport = (system, prompt, jsonMode) =>
    callGemini(system, prompt, jsonMode);

export interface PreflightServiceOptions {
    signal?: AbortSignal;
    /** Transport for the question/summary generation call. */
    transport?: PreflightTransport;
    /** Transport forwarded to the safety classifier (tests). */
    safetyTransport?: SafetyTransport;
}

export interface PreflightQuestionsResult {
    questions: PreflightQuestion[];
    usedFallback: boolean;
}

const asStringArray = (value: unknown): string[] =>
    Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        : [];

const parseJson = (raw: string): unknown => {
    try {
        return JSON.parse(raw);
    } catch {
        const { text, repaired } = repairTruncatedJson(raw);
        if (!repaired) return null;
        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    }
};

const fallbackQuestions = (mode: Exclude<PreflightMode, 'none'>): PreflightQuestion[] =>
    fallbackQuestionsFor(mode).map((q, i) => ({
        id: `q${i + 1}`,
        question: q.question,
        intent: q.intent,
    }));

/**
 * Generate idea-specific clarification questions for the chosen mode. Runs the
 * safety gate first: a `disallowed` verdict throws SafetyBlockedError before
 * any questions are produced. On a non-safety failure, returns the generic
 * fallback set with `usedFallback: true`.
 */
export const generatePreflightQuestions = async (
    idea: string,
    mode: Exclude<PreflightMode, 'none'>,
    opts?: PreflightServiceOptions,
): Promise<PreflightQuestionsResult> => {
    // Safety gate — identical chokepoint to PRD generation, run up front.
    const safety = await classifyProjectSafety(idea, {
        signal: opts?.signal,
        transport: opts?.safetyTransport,
    });
    if (safety.classification === 'disallowed') {
        throw new SafetyBlockedError(safety);
    }

    const count = QUESTION_COUNT[mode];
    const transport = opts?.transport ?? defaultTransport;

    try {
        const raw = await transport(buildQuestionSystemInstruction(count), idea, {
            responseMimeType: 'application/json',
            responseSchema: preflightQuestionsSchema,
            temperature: 0.5,
            topP: 0.95,
            maxOutputTokens: 2048,
            traceMeta: {
                stage: 'Preflight',
                purpose: 'Generate clarification questions',
                artifact: 'preflight_questions',
                inputs: ['Product idea'],
            },
        });
        const parsed = parseJson(raw) as { questions?: unknown[] } | null;
        const rawQuestions = Array.isArray(parsed?.questions) ? parsed!.questions : [];

        const questions: PreflightQuestion[] = rawQuestions
            .map((q, i): PreflightQuestion | null => {
                const obj = q as Record<string, unknown>;
                const question = typeof obj?.question === 'string' ? obj.question.trim() : '';
                if (!question) return null;
                const intent = typeof obj?.intent === 'string' ? obj.intent.trim() : undefined;
                return { id: `q${i + 1}`, question, intent };
            })
            .filter((q): q is PreflightQuestion => q !== null)
            // Never exceed the requested count, even if the model over-produces.
            .slice(0, count);

        if (questions.length === 0) {
            return { questions: fallbackQuestions(mode), usedFallback: true };
        }
        // Top up with fallbacks if the model under-produced, keeping unique ids.
        if (questions.length < count) {
            const extras = fallbackQuestions(mode)
                .slice(questions.length)
                .map((q, i) => ({ ...q, id: `q${questions.length + i + 1}` }));
            return { questions: [...questions, ...extras], usedFallback: false };
        }
        return { questions, usedFallback: false };
    } catch (e) {
        console.warn('[preflight] question generation failed; using fallback set', e);
        return { questions: fallbackQuestions(mode), usedFallback: true };
    }
};

export interface PreflightSummaryResult {
    summary: string;
    assumptions: string[];
    unknowns: string[];
}

/** Deterministic local recap used when summary generation fails. */
const localSummary = (questions: PreflightQuestion[]): PreflightSummaryResult => {
    const answered = questions.filter((q) => !q.skipped && q.answer && q.answer.trim());
    const skipped = questions.filter((q) => q.skipped || !q.answer || !q.answer.trim());
    return {
        summary: answered.length
            ? answered.map((q) => `- ${q.question} → ${q.answer!.trim()}`).join('\n')
            : 'No clarification answers were provided.',
        assumptions: [],
        unknowns: skipped.map((q) => q.question),
    };
};

/**
 * Summarize the clarification answers into a concise recap plus derived
 * assumptions and unknowns. Falls back to a deterministic local recap on
 * failure so the flow never blocks.
 */
export const generatePreflightSummary = async (
    idea: string,
    questions: PreflightQuestion[],
    opts?: PreflightServiceOptions,
): Promise<PreflightSummaryResult> => {
    const transport = opts?.transport ?? defaultTransport;
    try {
        const raw = await transport(SUMMARY_SYSTEM_INSTRUCTION, formatAnswersForSummary(idea, questions), {
            responseMimeType: 'application/json',
            responseSchema: preflightSummarySchema,
            temperature: 0.3,
            topP: 0.9,
            maxOutputTokens: 1536,
            traceMeta: {
                stage: 'Preflight',
                purpose: 'Summarize clarification answers',
                artifact: 'preflight_summary',
                inputs: ['Product idea', 'Clarification answers'],
            },
        });
        const parsed = parseJson(raw) as Record<string, unknown> | null;
        if (!parsed || typeof parsed.summary !== 'string' || !parsed.summary.trim()) {
            return localSummary(questions);
        }
        return {
            summary: parsed.summary.trim(),
            assumptions: asStringArray(parsed.assumptions),
            unknowns: asStringArray(parsed.unknowns),
        };
    } catch (e) {
        console.warn('[preflight] summary generation failed; using local recap', e);
        return localSummary(questions);
    }
};
