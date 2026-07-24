/**
 * Shared Gemini model catalog. The single source of truth for the selectable
 * model ids, their display names, and which tier (current vs legacy) they
 * belong to. Used by the Settings model pickers (Default model, PRD Generation
 * Models, and per-artifact Artifact Generation Models).
 *
 * The `id` is passed straight into the Gemini REST URL, so it must match what
 * Google's API accepts (see https://ai.google.dev/gemini-api/docs/models).
 */
export type ModelCatalogTier = 'current' | 'legacy';

export interface ModelOption {
    id: string;
    name: string;
    description: string;
    tier: ModelCatalogTier;
}

export const MODEL_CATALOG: ModelOption[] = [
    {
        id: 'gemini-3.6-flash',
        name: 'Gemini 3.6 Flash',
        description: 'Recommended default. Latest GA Flash — frontier-class quality with full quotas.',
        tier: 'current',
    },
    {
        id: 'gemini-3.1-pro-preview',
        name: 'Gemini 3.1 Pro',
        description: 'Maximum reasoning power for the most complex PRDs.',
        tier: 'current',
    },
    {
        id: 'gemini-3.1-flash-lite-preview',
        name: 'Gemini 3.1 Flash-Lite',
        description: 'Cheapest option. Good for quick drafts and iteration.',
        tier: 'current',
    },
    {
        id: 'gemini-3.5-flash',
        name: 'Gemini 3.5 Flash',
        description: 'Previous-generation GA Flash — superseded by 3.6 Flash.',
        tier: 'legacy',
    },
    {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash',
        description: 'Previous-generation Flash preview — prefer 3.6 Flash, which is GA.',
        tier: 'legacy',
    },
    {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        description: 'Previous-generation high-reasoning model.',
        tier: 'legacy',
    },
    {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        description: 'Previous-generation fast model. Often hits capacity limits — prefer 3.6 Flash.',
        tier: 'legacy',
    },
];

export const CURRENT_MODELS = MODEL_CATALOG.filter((m) => m.tier === 'current');
export const LEGACY_MODELS = MODEL_CATALOG.filter((m) => m.tier === 'legacy');

/** Human-readable label for a model id, falling back to the raw id. */
export const modelDisplayName = (id: string): string =>
    MODEL_CATALOG.find((m) => m.id === id)?.name ?? id;
