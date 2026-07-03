// Rule-based design-preset recommendation for the setup step. Deliberately
// NOT an AI call — the recommendation must render instantly while the PRD
// generates in the background, and a keyword heuristic over the idea +
// clarification answers is plenty to pick a sensible starting direction.
// The user can always choose any preset; this only drives the "Recommended"
// badge and the initial selection when no saved default exists.

/** Preset recommended when nothing else matches. */
export const FALLBACK_DESIGN_PRESET_ID = 'saas_minimal';

interface RecommendationRule {
    presetId: string;
    /** Word-boundary keyword alternatives (may contain spaces). */
    keywords: string[];
}

// Order matters only for ties: earlier rules win when match counts are equal.
const RULES: RecommendationRule[] = [
    {
        presetId: 'creative_studio',
        keywords: [
            'music', 'audio', 'dj', 'song', 'songs', 'playlist', 'podcast', 'band',
            'video', 'film', 'photo', 'photos', 'photography', 'camera',
            'art', 'artist', 'artists', 'creator', 'creators', 'creative',
            'studio', 'portfolio', 'media', 'illustration', 'animation', 'gallery',
        ],
    },
    {
        presetId: 'enterprise_professional',
        keywords: [
            'crm', 'sales', 'operations', 'admin', 'finance', 'financial',
            'accounting', 'invoice', 'invoicing', 'enterprise', 'erp', 'hr',
            'payroll', 'compliance', 'procurement', 'analytics', 'reporting',
            'internal tool', 'internal tools', 'back office', 'back-office',
        ],
    },
    {
        presetId: 'consumer_mobile',
        keywords: [
            'habit', 'habits', 'wellness', 'fitness', 'workout', 'health',
            'lifestyle', 'consumer', 'mobile', 'social', 'dating', 'travel',
            'recipe', 'recipes', 'meal', 'meditation', 'sleep', 'mindfulness',
        ],
    },
    {
        presetId: 'developer_tool',
        keywords: [
            'developer', 'developers', 'dev tool', 'dev tools', 'api', 'apis',
            'sdk', 'cli', 'code', 'coding', 'ide', 'devops', 'infrastructure',
            'workbench', 'llm', 'agent', 'agents', 'terminal', 'git',
            'database', 'dashboard', 'dashboards', 'monitoring', 'observability',
            'technical',
        ],
    },
    {
        presetId: 'editorial_learning',
        keywords: [
            'notes', 'note-taking', 'note taking', 'research', 'writing',
            'writer', 'writers', 'blog', 'journal', 'journaling', 'learning',
            'course', 'courses', 'education', 'study', 'studying', 'knowledge',
            'reading', 'book', 'books', 'wiki', 'documentation', 'flashcard',
            'flashcards',
        ],
    },
];

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildRuleRegex = (keywords: string[]): RegExp =>
    new RegExp(`\\b(?:${keywords.map(escapeRegex).join('|')})\\b`, 'gi');

export interface DesignPresetRecommendation {
    presetId: string;
    /** Distinct keywords that drove the pick (empty for the fallback). */
    matchedTerms: string[];
}

/**
 * Recommend a design preset for a project from its idea + clarification text.
 * Scores each rule by the number of DISTINCT keywords it matches; the highest
 * score wins (ties break by rule order). No match at all → `saas_minimal`,
 * the safe general-purpose default.
 */
export function recommendDesignSystemPreset(text: string): DesignPresetRecommendation {
    if (!text || !text.trim()) {
        return { presetId: FALLBACK_DESIGN_PRESET_ID, matchedTerms: [] };
    }
    let best: DesignPresetRecommendation | null = null;
    let bestScore = 0;
    for (const rule of RULES) {
        const matches = text.match(buildRuleRegex(rule.keywords)) ?? [];
        const distinct = [...new Set(matches.map(m => m.toLowerCase()))];
        if (distinct.length > bestScore) {
            bestScore = distinct.length;
            best = { presetId: rule.presetId, matchedTerms: distinct };
        }
    }
    return best ?? { presetId: FALLBACK_DESIGN_PRESET_ID, matchedTerms: [] };
}

/** Convenience wrapper returning only the preset id. */
export function recommendDesignSystemPresetId(text: string): string {
    return recommendDesignSystemPreset(text).presetId;
}
