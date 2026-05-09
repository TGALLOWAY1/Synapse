/**
 * Pure parser for `implementation_plan` artifact markdown.
 *
 * Two on-disk shapes are supported:
 *
 * 1. **Structured (current)** — the artifact body ends with a
 *    ` ```json synapse-plan ` fenced block holding a
 *    `StructuredImplementationPlan`. `extractStructuredPlan` returns it
 *    when present; both the renderer and task extractor prefer this
 *    path because the data is already typed.
 * 2. **Legacy markdown** — older artifacts (and the markdown rendered
 *    above the fence even on new artifacts) use the milestone heading
 *    convention from `coreArtifactService.ts`:
 *
 *      ### Milestone N: Title (Week X-Y)
 *      **Goal:** ...
 *      **Key Deliverables:**
 *      - [ ] Item one
 *      **Technical Approach:** ...
 *      **Dependencies:** ...
 *      **Risks:** ...
 *      **Definition of Done:** ...
 *      ---
 *      ## Critical Path Summary
 *
 * `parseImplementationPlan` parses that shape; `parseMilestoneBody`
 * splits a single milestone body into labeled sections + checkbox
 * deliverables.
 */

import type { StructuredImplementationPlan } from '../../types';

const STRUCTURED_FENCE = /```json\s+synapse-plan\s*\n([\s\S]*?)\n```/;

/**
 * Returns the structured plan from the trailing JSON fence, or `null` if
 * the artifact doesn't have one (legacy markdown-only).
 */
export function extractStructuredPlan(
    markdown: string,
): StructuredImplementationPlan | null {
    const match = markdown.match(STRUCTURED_FENCE);
    if (!match) return null;
    try {
        const parsed = JSON.parse(match[1]) as StructuredImplementationPlan;
        if (!Array.isArray(parsed?.milestones)) return null;
        return parsed;
    } catch {
        return null;
    }
}

export interface ParsedDeliverable {
    text: string;
    checked: boolean;
}

export interface ParsedSection {
    label: string;
    body: string;
}

export interface ParsedMilestone {
    id: number;
    title: string;
    timeframe?: string;
    body: string;
}

export interface ParsedPlan {
    preamble: string;
    milestones: ParsedMilestone[];
    appendix: string;
}

export interface MilestoneDetails {
    sections: ParsedSection[];
    deliverables: ParsedDeliverable[];
}

export const MILESTONE_HEADING =
    /^###\s+Milestone\s+(\d+)\s*[:\-—]?\s*(.+?)\s*(\(([^)]*)\))?\s*$/i;

const SECTION_LABEL = /^\*\*([^*]+):\*\*\s*(.*)$/;
const CHECKLIST_LINE = /^\s*-\s*\[\s*([ xX])\s*\]\s*(.+)$/;

export function parseImplementationPlan(markdown: string): ParsedPlan {
    const lines = markdown.split('\n');
    const preamble: string[] = [];
    const milestones: ParsedMilestone[] = [];
    let inMilestones = false;
    let appendixStart = -1;
    let current: ParsedMilestone | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(MILESTONE_HEADING);
        if (m) {
            if (current) milestones.push(current);
            inMilestones = true;
            const id = Number(m[1]);
            const baseTitle = m[2].trim();
            const timeframe = m[4]?.trim();
            current = {
                id,
                title: timeframe ? baseTitle : baseTitle.replace(/\s*\([^)]*\)\s*$/, ''),
                timeframe: timeframe ?? extractTrailingParens(baseTitle),
                body: '',
            };
            continue;
        }
        if (inMilestones && /^---+\s*$/.test(line.trim())) {
            if (current) {
                milestones.push(current);
                current = null;
            }
            appendixStart = i + 1;
            break;
        }
        if (current) {
            current.body += line + '\n';
        } else if (!inMilestones) {
            preamble.push(line);
        }
    }
    if (current) milestones.push(current);

    const appendix = appendixStart >= 0 ? lines.slice(appendixStart).join('\n').trim() : '';
    return {
        preamble: preamble.join('\n').trim(),
        milestones,
        appendix,
    };
}

function extractTrailingParens(title: string): string | undefined {
    const m = title.match(/\(([^)]*)\)\s*$/);
    return m?.[1];
}

export function parseMilestoneBody(body: string): MilestoneDetails {
    const lines = body.split('\n');
    const sections: ParsedSection[] = [];
    const deliverables: ParsedDeliverable[] = [];
    let currentLabel: string | null = null;
    let currentLines: string[] = [];

    const flushSection = () => {
        if (currentLabel) {
            sections.push({ label: currentLabel, body: currentLines.join('\n').trim() });
        }
        currentLabel = null;
        currentLines = [];
    };

    for (const raw of lines) {
        const labelMatch = raw.match(SECTION_LABEL);
        if (labelMatch) {
            flushSection();
            currentLabel = labelMatch[1].trim();
            currentLines = labelMatch[2] ? [labelMatch[2]] : [];
            continue;
        }
        const checklistMatch = raw.match(CHECKLIST_LINE);
        if (checklistMatch) {
            deliverables.push({
                text: checklistMatch[2].trim(),
                checked: checklistMatch[1].toLowerCase() === 'x',
            });
            continue;
        }
        if (currentLabel) {
            currentLines.push(raw);
        }
    }
    flushSection();
    return { sections, deliverables };
}

/**
 * Look up a section on a milestone by case-insensitive label match.
 * Returns the trimmed body string, or `undefined` when the milestone
 * never declared that section.
 */
export function findSection(details: MilestoneDetails, label: string): string | undefined {
    const wanted = label.toLowerCase();
    return details.sections.find(s => s.label.toLowerCase() === wanted)?.body;
}
