// Gemini JSON-mode schema for the pre-generation safety classifier. Mirrors
// the style of prdSchemas.ts (uppercase types, `enum` for closed sets). All
// fields are required so the model always returns a complete verdict.

export const safetyClassificationSchema = {
    type: "OBJECT",
    properties: {
        classification: {
            type: "STRING",
            enum: ["allowed", "allowed_with_restrictions", "disallowed"],
        },
        confidence: {
            type: "STRING",
            enum: ["low", "medium", "high"],
        },
        detectedConcerns: { type: "ARRAY", items: { type: "STRING" } },
        userFacingReason: { type: "STRING" },
        safeAlternatives: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: [
        "classification",
        "confidence",
        "detectedConcerns",
        "userFacingReason",
        "safeAlternatives",
    ],
};
