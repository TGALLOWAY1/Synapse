import type { CoreArtifactSubtype } from '../types';
import { dedupeSentences } from './textCleanup';
import { parseScreenInventory, screenInventoryToMarkdown } from './screenInventoryNormalize';

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
    // NOTE: the screen_inventory entry matches the LEGACY markdown shape only.
    // Current inventories are structured JSON and take the
    // validateScreenInventoryStructured path below, never this list — the
    // "Components"/"Navigation" labels here are what the old markdown
    // renderer emitted, kept solely for legacy persisted artifacts.
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
    // Screen inventory is now persisted as structured JSON. Validate the
    // shape directly when we recognize it, and fall back to the markdown
    // path for legacy artifacts.
    if (subtype === 'screen_inventory') {
        const parsed = parseScreenInventory(content);
        if (parsed) return validateScreenInventoryStructured(parsed);
    }

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
    // Detail can be carried by bullet/numbered lists, GFM tables, OR admonition
    // callouts — not bullets alone. The data_model artifact, for instance,
    // expresses every entity as `| … |` tables plus `> [!…]` callouts and
    // legitimately contains no bullet list; a bullets-only check falsely flags
    // that richly structured output as "may lack detail".
    const hasBulletList = /^[-*]\s/m.test(content) || /^\d+\.\s/m.test(content);
    const hasTable = /^\s*\|.*\|\s*$/m.test(content);
    const hasCallout = /^\s*>\s*\[!/m.test(content);
    const hasDetail = hasBulletList || hasTable || hasCallout;
    if (!hasHeaders) {
        warnings.push('No markdown headers found — output may lack structure');
        score -= 15;
    }
    if (!hasDetail) {
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

function validateScreenInventoryStructured(
    parsed: import('../types').ScreenInventoryContent,
): ValidationResult {
    const warnings: string[] = [];
    let score = 100;

    if (parsed.sections.length === 0) {
        warnings.push('No sections found — screen inventory is empty');
        score -= 40;
    }

    const allScreens = parsed.sections.flatMap(s => s.screens);
    if (allScreens.length === 0) {
        warnings.push('No screens found in any section');
        score -= 30;
    }

    const missingPurpose = allScreens.filter(s => !s.purpose || s.purpose.length < 8).length;
    if (allScreens.length > 0 && missingPurpose / allScreens.length > 0.25) {
        warnings.push(`${missingPurpose} screens have a missing or stub \`purpose\``);
        score -= 15;
    }

    const allP0 = allScreens.length > 1 && allScreens.every(s => s.priority === 'P0');
    if (allP0) {
        warnings.push('Every screen is marked P0 — priorities are not meaningfully differentiated');
        score -= 10;
    }

    // Reuse the markdown degenerate-text scan against the rendered form
    // so a degenerate LLM repetition still surfaces a warning.
    const md = screenInventoryToMarkdown(parsed);
    const degenerate = detectDegenerateContent(md);
    if (degenerate) {
        warnings.push(degenerate);
        score -= 15;
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
