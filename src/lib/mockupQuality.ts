export type MockupQualitySeverity = 'low' | 'medium' | 'high';

export interface MockupQualityIssue {
    code: string;
    severity: MockupQualitySeverity;
    message: string;
}

export interface MockupQualityReport {
    score: number;
    issues: MockupQualityIssue[];
    reject: boolean;
}

const MAX_FRAGMENT_LENGTH = 200_000;

const PLACEHOLDER_PATTERNS: RegExp[] = [
    /lorem ipsum/i,
    /button\s*\d+/i,
    /\bitem\s+[a-z0-9]/i,
    /todo\b/i,
    /your\s+content\s+here/i,
];

const FORBIDDEN_TAG_REGEX = /<(script|style|link|meta|iframe|object|embed|base|noscript|form)\b[^>]*>/i;

const countMatches = (value: string, regex: RegExp): number => {
    const matches = value.match(regex);
    return matches ? matches.length : 0;
};

const stripFences = (html: string): string => html
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/i, '');

const normalizeRootWrapper = (html: string): string => {
    const trimmed = html.trim();
    if (!trimmed) return trimmed;

    const hasRequiredRoot = /<div\b[^>]*class\s*=\s*["'][^"']*min-h-screen[^"']*["'][^>]*>/i.test(trimmed);
    if (hasRequiredRoot) return trimmed;

    return `<div class="min-h-screen bg-neutral-50 text-neutral-900 font-sans antialiased">\n${trimmed}\n</div>`;
};

export const sanitizeMockupHtmlForPreview = (html: string): string => {
    let out = html.length > MAX_FRAGMENT_LENGTH
        ? html.slice(0, MAX_FRAGMENT_LENGTH) + '\n<!-- truncated: exceeded maximum safe length -->'
        : html;

    out = out.replace(/<!doctype[^>]*>/gi, '');
    out = out.replace(/<\/?(html|head|body)\b[^>]*>/gi, '');

    out = out.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    out = out.replace(/<script\b[^>]*\/?>/gi, '');
    out = out.replace(/<style\b[\s\S]*?<\/style>/gi, '');
    out = out.replace(/<style\b[^>]*\/?>/gi, '');
    out = out.replace(/<(link|meta|iframe|object|embed|base|noscript|form)\b[^>]*>/gi, '');
    out = out.replace(/<\/(iframe|object|embed|noscript|form)>/gi, '');

    out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
    out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
    out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');

    out = out.replace(/(href|src|action)\s*=\s*"\s*(javascript|data):[^"]*"/gi, '$1="#"');
    out = out.replace(/(href|src|action)\s*=\s*'\s*(javascript|data):[^']*'/gi, "$1='#'");
    out = out.replace(/(href|src|action)\s*=\s*(javascript|data):[^\s>]*/gi, '$1="#"');

    return out;
};

export const normalizeMockupHtml = (html: string): string => {
    const noFences = stripFences(html);
    const sanitized = sanitizeMockupHtmlForPreview(noFences);
    return normalizeRootWrapper(sanitized).trim();
};

export const assessMockupHtmlQuality = (html: string): MockupQualityReport => {
    const issues: MockupQualityIssue[] = [];
    const trimmed = html.trim();

    if (!trimmed || trimmed.length < 80) {
        issues.push({
            code: 'too_short',
            severity: 'high',
            message: 'HTML fragment is too short to be a credible screen.',
        });
    }

    if (FORBIDDEN_TAG_REGEX.test(trimmed)) {
        issues.push({
            code: 'forbidden_tags',
            severity: 'high',
            message: 'Contains forbidden tags (script/style/form/iframe/etc).',
        });
    }

    if (!/min-h-screen/.test(trimmed)) {
        issues.push({
            code: 'missing_shell',
            severity: 'medium',
            message: 'Missing full-screen shell wrapper; layout may look clipped.',
        });
    }

    if (!/(<header\b|<nav\b|<main\b|<section\b)/i.test(trimmed)) {
        issues.push({
            code: 'weak_structure',
            severity: 'medium',
            message: 'Screen lacks semantic structure landmarks.',
        });
    }

    const tailwindClassCount = countMatches(trimmed, /class\s*=\s*['"][^'"]+['"]/g);
    if (tailwindClassCount < 6) {
        issues.push({
            code: 'low_styling_density',
            severity: 'medium',
            message: 'Too few styled elements; screen likely looks unfinished.',
        });
    }

    if (!/(<button\b|<input\b|<select\b|<table\b|<ul\b|<ol\b)/i.test(trimmed)) {
        issues.push({
            code: 'no_interactive_patterns',
            severity: 'low',
            message: 'No common UI components detected (buttons/inputs/lists/tables).',
        });
    }

    if (PLACEHOLDER_PATTERNS.some(pattern => pattern.test(trimmed))) {
        issues.push({
            code: 'placeholder_copy',
            severity: 'high',
            message: 'Contains placeholder copy that reduces artifact credibility.',
        });
    }

    const penalties = issues.reduce((sum, issue) => {
        if (issue.severity === 'high') return sum + 30;
        if (issue.severity === 'medium') return sum + 15;
        return sum + 8;
    }, 0);

    const score = Math.max(0, 100 - penalties);
    const reject = score < 55 || issues.some(issue => issue.severity === 'high');

    return { score, issues, reject };
};
