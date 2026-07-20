import type { FlowCategory, ParsedFlow } from './types';

const RULES: Array<{ category: FlowCategory; keywords: RegExp }> = [
    {
        category: 'Onboarding',
        keywords: /\b(onboard|sign\s?up|signup|register|registration|welcome|first[-\s]?run|tour|tutorial|getting\s?started)\b/i,
    },
    {
        category: 'Auth & Identity',
        keywords: /\b(log\s?in|login|sign\s?in|signin|sso|oauth|password|account|authenticate|authentication|2fa|two[-\s]?factor|reset\s+password|verify\s+email)\b/i,
    },
    {
        category: 'Sharing & Collaboration',
        keywords: /\b(share|sharing|invite|invitation|collaborat|comment|mention|team|workspace|publish)\b/i,
    },
];

export function categorize(title: string, goal?: string): FlowCategory {
    const haystack = `${title} ${goal ?? ''}`;
    if (!haystack.trim()) return 'Other';
    for (const rule of RULES) {
        if (rule.keywords.test(haystack)) return rule.category;
    }
    return 'Core Experience';
}

export const CATEGORY_ORDER: FlowCategory[] = [
    'Onboarding',
    'Auth & Identity',
    'Core Experience',
    'Sharing & Collaboration',
    'Other',
];

/**
 * Maps each flow's original (authored) index to its 1-based display number in
 * the grouped visual order — grouped by `CATEGORY_ORDER`, original order
 * preserved within each category. This is the same order `FlowSidebar`'s
 * `groupFlows` renders in.
 *
 * Every surface that shows a flow's ordinal (sidebar rail, collapsed rail,
 * mobile trigger, summary card) must read its number from here rather than
 * `originalIndex + 1` — the flat original index only happens to match visual
 * order when flows are authored already in `CATEGORY_ORDER` order. Selection
 * (`onPick`/`selectedIndex`) is unaffected — it always uses the original
 * index; only the *displayed* number changes.
 */
export function displayNumbers(flows: ParsedFlow[]): number[] {
    const numbers = new Array<number>(flows.length);
    let n = 0;
    for (const category of CATEGORY_ORDER) {
        flows.forEach((flow, originalIndex) => {
            if (flow.category === category) numbers[originalIndex] = ++n;
        });
    }
    return numbers;
}
