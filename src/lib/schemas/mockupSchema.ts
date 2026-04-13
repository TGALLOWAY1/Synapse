// Gemini JSON mode schema for rendered HTML/Tailwind mockup generation.
// Mirrors MockupPayload in src/types/index.ts. The client-side `id` field on
// each MockupScreen is assigned after parsing (via uuid) and is intentionally
// not part of the model's output schema.
export const mockupSchema = {
    type: 'OBJECT',
    properties: {
        version: { type: 'STRING', enum: ['mockup_html_v1'] },
        title: { type: 'STRING' },
        summary: { type: 'STRING' },
        screens: {
            type: 'ARRAY',
            minItems: 1,
            maxItems: 5,
            items: {
                type: 'OBJECT',
                properties: {
                    name: { type: 'STRING' },
                    purpose: { type: 'STRING' },
                    html: { type: 'STRING' },
                    notes: { type: 'STRING' },
                },
                required: ['name', 'purpose', 'html'],
                propertyOrdering: ['name', 'purpose', 'html', 'notes'],
            },
        },
    },
    required: ['version', 'title', 'summary', 'screens'],
    propertyOrdering: ['version', 'title', 'summary', 'screens'],
};
