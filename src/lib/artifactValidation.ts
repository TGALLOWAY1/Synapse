import type { CoreArtifactSubtype } from '../types';
import { dedupeSentences } from './textCleanup';

export interface ValidationResult {
    isValid: boolean;
    qualityScore: number; // 0-100
    warnings: string[];
}

// Cell-level threshold beyond which a single | … | … | markdown table cell
// is almost certainly carrying degenerate LLM output. Cells > 800 chars
// are visually unscannable in a 5-column table.
const MAX_TABLE_CELL_CHARS = 800;

const MIN_CONTENT_LENGTH: Record<CoreArtifactSubtype, number> = {
    screen_inventory: 200,
    user_flows: 200,
    component_inventory: 200,
    implementation_plan: 200,
    data_model: 200,
    prompt_pack: 200,
    design_system: 200,
};

const EXPECTED_HEADERS: Record<CoreArtifactSubtype, string[]> = {
    screen_inventory: ['###', 'Purpose', 'Components', 'Navigation', 'Priority'],
    user_flows: ['Flow', 'Goal', 'Steps', 'Success', 'Error'],
    component_inventory: ['Purpose', 'Props', 'Used In', 'Complexity'],
    implementation_plan: ['Milestone', 'Goal', 'Deliverables', 'Dependencies'],
    data_model: ['Fields', 'Relationships', 'Type'],
    prompt_pack: ['Prompt', 'Category', 'Target'],
    design_system: ['Color', 'Typography', 'Spacing', 'Component'],
};

export function validateArtifactContent(
    subtype: CoreArtifactSubtype,
    content: string
): ValidationResult {
    const warnings: string[] = [];
    let score = 100;

    // Check minimum length
    const minLen = MIN_CONTENT_LENGTH[subtype];
    if (content.length < minLen) {
        warnings.push(`Content appears truncated (${content.length} chars, expected at least ${minLen})`);
        score -= 30;
    }

    // Check for expected headers/keywords
    const expectedHeaders = EXPECTED_HEADERS[subtype];
    const missingHeaders = expectedHeaders.filter(h => !content.includes(h));
    if (missingHeaders.length > 0) {
        const missingRatio = missingHeaders.length / expectedHeaders.length;
        if (missingRatio > 0.5) {
            warnings.push(`Missing expected sections: ${missingHeaders.join(', ')}`);
            score -= 20;
        } else if (missingRatio > 0.2) {
            warnings.push(`Some expected sections may be missing: ${missingHeaders.join(', ')}`);
            score -= 10;
        }
    }

    // Check for markdown structure
    const hasHeaders = /^#{1,4}\s/m.test(content);
    const hasList = /^[-*]\s/m.test(content) || /^\d+\.\s/m.test(content);
    if (!hasHeaders) {
        warnings.push('No markdown headers found — output may lack structure');
        score -= 15;
    }
    if (!hasList) {
        warnings.push('No lists found — output may lack detail');
        score -= 10;
    }

    // Check for overly short sections (potential truncation mid-section)
    if (content.endsWith('...') || content.endsWith('etc.')) {
        warnings.push('Content may be incomplete (ends with ellipsis)');
        score -= 10;
    }

    // Quality gate: detect degenerate output patterns. The classic failure
    // mode is a single markdown table cell holding a phrase repeated 30+
    // times — cleanup utilities now defend against it at render time, but
    // we surface a warning so users can choose to regenerate.
    const degenerate = detectDegenerateContent(content);
    if (degenerate) {
        warnings.push(degenerate);
        score -= 15;
    }

    // Soft check for the implementation_plan structured payload. The renderer
    // falls back to legacy markdown parsing when the fence is missing or
    // malformed, so this is a warning, not a hard fail.
    if (subtype === 'implementation_plan') {
        const fence = content.match(/```json\s+synapse-plan\s*\n([\s\S]*?)\n```/);
        if (fence) {
            try {
                JSON.parse(fence[1]);
            } catch {
                warnings.push('Implementation plan structured JSON fence is malformed — UI will fall back to legacy timeline.');
                score -= 5;
            }
        }
    }

    return {
        isValid: score >= 40,
        qualityScore: Math.max(0, Math.min(100, score)),
        warnings,
    };
}

/**
 * Scan markdown for two degenerate patterns we want to flag:
 *   1. A table row with any single cell over MAX_TABLE_CELL_CHARS.
 *   2. A list bullet whose dedupe-pass collapses ≥ 50% of the original
 *      sentence count (clear sign of a repetition loop).
 *
 * Returns a human-readable warning string or null when content is clean.
 */
export function detectDegenerateContent(content: string): string | null {
    const lines = content.split('\n');
    for (const line of lines) {
        // Markdown table row: starts and ends with `|`.
        if (!line.trim().startsWith('|') || !line.trim().endsWith('|')) continue;
        const cells = line.split('|').slice(1, -1).map(c => c.trim());
        for (const cell of cells) {
            if (cell.length > MAX_TABLE_CELL_CHARS) {
                return `A table cell is unusually long (${cell.length} chars) — output may be repeating itself. Consider regenerating.`;
            }
            if (cell.length > 200) {
                const dedup = dedupeSentences(cell);
                const rough = cell.split(/(?<=[.!?])\s+/).filter(Boolean).length;
                if (rough >= 4 && dedup.length <= rough / 2) {
                    return `A table cell repeats the same sentence multiple times — output may be degenerate. Consider regenerating.`;
                }
            }
        }
    }
    return null;
}
