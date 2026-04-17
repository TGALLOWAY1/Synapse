export interface MockupStructureValidationResult {
    isValid: boolean;
    score: number;
    issues: string[];
}

const REQUIRED_SECTION_SELECTORS = [
    /<header\b/i,
    /<main\b/i,
    /<section\b/i,
    /<(button|input|select|textarea|a)\b/i,
];

const STYLE_TOKENS = [
    /\btext-(xs|sm|base|lg|xl|2xl|3xl)\b/g,
    /\bp-[23468]\b/g,
    /\bpx-[23468]\b/g,
    /\bpy-[23468]\b/g,
    /\bg-(neutral-(50|100)|white|indigo-(50|100|600))\b/g,
];

const hasBalancedAngleBrackets = (html: string): boolean => {
    const opens = (html.match(/</g) ?? []).length;
    const closes = (html.match(/>/g) ?? []).length;
    return opens > 0 && opens === closes;
};

export const validateMockupHtmlStructure = (html: string): MockupStructureValidationResult => {
    const trimmed = html.trim();
    const issues: string[] = [];

    if (!trimmed) {
        return { isValid: false, score: 0, issues: ['HTML is empty.'] };
    }

    if (!hasBalancedAngleBrackets(trimmed)) {
        issues.push('HTML appears malformed (unbalanced tag delimiters).');
    }

    if (!/<div\b[^>]*\bmin-h-screen\b/i.test(trimmed)) {
        issues.push('Missing required root shell with min-h-screen.');
    }

    REQUIRED_SECTION_SELECTORS.forEach((selector, index) => {
        if (!selector.test(trimmed)) {
            const labels = ['header', 'main content area', 'section block', 'interactive control'];
            issues.push(`Missing required ${labels[index]}.`);
        }
    });

    if (/<\/?(html|head|body|script|style|iframe|form)\b/i.test(trimmed)) {
        issues.push('Contains forbidden document-level or unsafe tags.');
    }

    const styleTokenCount = STYLE_TOKENS.reduce((sum, token) => sum + (trimmed.match(token)?.length ?? 0), 0);
    if (styleTokenCount < 6) {
        issues.push('Styling token density is too low for a polished mockup.');
    }

    const penalty = issues.length * 14;
    const score = Math.max(0, 100 - penalty);
    const isValid = issues.length === 0 || score >= 70;

    return {
        isValid,
        score,
        issues,
    };
};
