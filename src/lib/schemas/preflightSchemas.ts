// Gemini JSON-mode schemas for the optional preflight clarification step.
// Mirrors the style of safetySchemas.ts (uppercase types, required fields).

// Question generation: the model returns an array of idea-specific clarifying
// questions, each with a short "why this matters" intent line.
export const preflightQuestionsSchema = {
    type: "OBJECT",
    properties: {
        questions: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    question: { type: "STRING" },
                    intent: { type: "STRING" },
                },
                required: ["question"],
            },
        },
    },
    required: ["questions"],
};

// Summary generation: a concise scannable recap plus derived assumptions and
// open unknowns (skipped questions feed unknowns/assumptions, never fake
// certainty).
export const preflightSummarySchema = {
    type: "OBJECT",
    properties: {
        summary: { type: "STRING" },
        assumptions: { type: "ARRAY", items: { type: "STRING" } },
        unknowns: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["summary", "assumptions", "unknowns"],
};
