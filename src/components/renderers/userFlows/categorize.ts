import type { FlowCategory } from './types';

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
