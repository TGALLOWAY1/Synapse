import { expandPlaceholders } from './mockupPlaceholders';

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

// Within a class="..." attribute, strip a specific Tailwind utility token
// without disturbing surrounding classes.
const stripClassToken = (classAttr: string, token: string): string =>
    classAttr.replace(new RegExp(`(?:^|\\s)${token}(?=\\s|$)`, 'g'), ' ').replace(/\s+/g, ' ').trim();

// Inject a Tailwind utility token into a class="..." attribute if it isn't
// already present. Used to splice in `min-h-0` so flex children can actually
// shrink and let `overflow-y-auto` activate inside the iframe.
const ensureClassToken = (classAttr: string, token: string): string => {
    if (new RegExp(`(?:^|\\s)${token}(?=\\s|$)`).test(classAttr)) return classAttr;
    return `${classAttr.trim()} ${token}`.trim();
};

// Rewrite each class="..." attribute in the fragment so that:
// 1. Shell containers don't trap their children with `overflow-hidden` — the
//    sandbox iframe is already a scroll viewport, and nested `overflow-hidden`
//    chains are how LLM-emitted dashboards end up showing nothing.
// 2. Any `flex-1 overflow-y-auto` scroll container also carries `min-h-0` so
//    the classic flexbox `min-height: auto` gotcha doesn't push content past
//    the viewport.
const fixOverflowScrollChains = (html: string): string => {
    return html.replace(/class\s*=\s*("|')([^"']*)\1/gi, (match, quote, value) => {
        let next = value as string;
        const hasFlex = /(?:^|\s)flex(?=\s|$)/.test(next);
        const hasFlexCol = /(?:^|\s)flex-col(?=\s|$)/.test(next);
        const hasFlex1 = /(?:^|\s)flex-1(?=\s|$)/.test(next);
        const hasOverflowHidden = /(?:^|\s)overflow-hidden(?=\s|$)/.test(next);
        const hasOverflowYAuto = /(?:^|\s)overflow-y-auto(?=\s|$)/.test(next);

        // Drop overflow-hidden from shell containers (anything that's also a
        // flex container or already inside a flex-1 column). This is the
        // pattern that traps content above the iframe fold.
        if (hasOverflowHidden && (hasFlex || hasFlexCol || hasFlex1)) {
            next = stripClassToken(next, 'overflow-hidden');
        }

        // Make sure flex-1 + overflow-y-auto chains can actually scroll.
        if (hasFlex1 && hasOverflowYAuto) {
            next = ensureClassToken(next, 'min-h-0');
        }

        // Make sure column-direction flex children can shrink so nested
        // scroll containers behave correctly (`flex-col` parents need
        // `min-h-0` for the same reason).
        if (hasFlex1 && hasFlexCol) {
            next = ensureClassToken(next, 'min-h-0');
        }

        if (next === value) return match;
        return `class=${quote}${next}${quote}`;
    });
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

    out = fixOverflowScrollChains(out);

    return out;
};

export const normalizeMockupHtml = (html: string): string => {
    const noFences = stripFences(html);
    const sanitized = sanitizeMockupHtmlForPreview(noFences);
    const withPlaceholders = expandPlaceholders(sanitized);
    return normalizeRootWrapper(withPlaceholders).trim();
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

    // Layout-viability check: nested-scroll shells that don't fit the iframe
    // viewport are the #1 cause of "preview is blank" reports. Both `flex-1
    // overflow-y-auto` (without `min-h-0`) and `overflow-hidden` on a flex
    // shell are normalized by `sanitizeMockupHtmlForPreview`, but we still
    // surface a low-severity warning so authors can see what was rewritten.
    const hasNestedScroll = /class\s*=\s*['"][^'"]*\bflex-1\b[^'"]*\boverflow-y-auto\b[^'"]*['"]|class\s*=\s*['"][^'"]*\boverflow-y-auto\b[^'"]*\bflex-1\b[^'"]*['"]/i.test(trimmed);
    const hasShellOverflowHidden = /class\s*=\s*['"][^'"]*\b(?:flex|flex-col)\b[^'"]*\boverflow-hidden\b[^'"]*['"]|class\s*=\s*['"][^'"]*\boverflow-hidden\b[^'"]*\b(?:flex|flex-col)\b[^'"]*['"]/i.test(trimmed);
    if (hasNestedScroll || hasShellOverflowHidden) {
        issues.push({
            code: 'fragile_scroll_shell',
            severity: 'low',
            message: 'Used a nested-scroll shell pattern (flex-1 overflow-y-auto / overflow-hidden); auto-rewritten for preview compatibility.',
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
