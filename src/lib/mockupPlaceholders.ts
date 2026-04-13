// Inline SVG image placeholders for mockup HTML.
//
// The LLM is instructed to emit opaque placeholder markers like
//   <div data-placeholder="avatar" data-size="md"></div>
// instead of referencing external images. At render time, `expandPlaceholders`
// walks the HTML fragment and replaces each marker with a self-contained
// inline <svg> wrapped in a Tailwind-sized container, so the sandbox iframe
// never has to make a network call.

export const PLACEHOLDER_TYPES = ['avatar', 'hero', 'product', 'logo', 'chart', 'thumbnail'] as const;
export type PlaceholderType = (typeof PLACEHOLDER_TYPES)[number];

const PLACEHOLDER_SIZES = ['sm', 'md', 'lg', 'xl'] as const;
export type PlaceholderSize = (typeof PLACEHOLDER_SIZES)[number];

interface RenderOptions {
    size: PlaceholderSize;
    label?: string;
    /** Extra Tailwind utility classes appended to the wrapper (e.g. shadow-md, rounded-full). */
    extraClass?: string;
    /** When provided, replaces the default size classes entirely. */
    sizeClassOverride?: string;
}

// Default Tailwind size classes per placeholder type / size bucket.
const SIZE_CLASSES: Record<PlaceholderType, Record<PlaceholderSize, string>> = {
    avatar:    { sm: 'w-8 h-8',     md: 'w-12 h-12',   lg: 'w-16 h-16',   xl: 'w-24 h-24' },
    hero:      { sm: 'w-full h-32', md: 'w-full h-48', lg: 'w-full h-64', xl: 'w-full h-80' },
    product:   { sm: 'w-24 h-24',   md: 'w-40 h-40',   lg: 'w-56 h-56',   xl: 'w-72 h-72' },
    logo:      { sm: 'h-6',         md: 'h-8',         lg: 'h-10',        xl: 'h-14' },
    chart:     { sm: 'w-full h-32', md: 'w-full h-48', lg: 'w-full h-64', xl: 'w-full h-80' },
    thumbnail: { sm: 'w-12 h-12',   md: 'w-20 h-20',   lg: 'w-28 h-28',   xl: 'w-40 h-40' },
};

// Base wrapper classes that keep the placeholder visually coherent.
const BASE_WRAPPER: Record<PlaceholderType, string> = {
    avatar:    'inline-flex items-center justify-center rounded-full overflow-hidden bg-indigo-100 text-indigo-700',
    hero:      'flex items-center justify-center rounded-xl overflow-hidden bg-gradient-to-br from-indigo-100 via-indigo-50 to-neutral-100',
    product:   'flex items-center justify-center rounded-xl overflow-hidden bg-gradient-to-br from-neutral-100 to-neutral-200',
    logo:      'inline-flex items-center gap-1.5 text-neutral-500',
    chart:     'flex items-end rounded-lg overflow-hidden bg-neutral-50 border border-neutral-200 p-3',
    thumbnail: 'flex items-center justify-center rounded-lg overflow-hidden bg-neutral-100',
};

const AVATAR_SVG = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" aria-hidden="true">
  <circle cx="24" cy="18" r="8" fill="currentColor" opacity="0.35"/>
  <path d="M8 42c2-8 8-12 16-12s14 4 16 12z" fill="currentColor" opacity="0.35"/>
</svg>`;

const HERO_SVG = `<svg viewBox="0 0 600 200" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="ph-hero-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#c7d2fe"/>
      <stop offset="100%" stop-color="#e0e7ff"/>
    </linearGradient>
  </defs>
  <rect width="600" height="200" fill="url(#ph-hero-grad)"/>
  <circle cx="470" cy="50" r="26" fill="#ffffff" opacity="0.8"/>
  <polygon points="0,200 150,110 260,160 380,80 500,150 600,100 600,200" fill="#6366f1" opacity="0.35"/>
  <polygon points="0,200 90,150 200,180 320,130 450,170 600,150 600,200" fill="#4f46e5" opacity="0.45"/>
</svg>`;

const PRODUCT_SVG = `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" width="70%" height="70%" aria-hidden="true">
  <path d="M60 14 L100 34 L100 86 L60 106 L20 86 L20 34 Z" fill="#a5b4fc" opacity="0.45"/>
  <path d="M60 14 L100 34 L60 54 L20 34 Z" fill="#818cf8" opacity="0.7"/>
  <path d="M60 54 L100 34 L100 86 L60 106 Z" fill="#6366f1" opacity="0.55"/>
  <path d="M60 54 L60 106 L20 86 L20 34 Z" fill="#4f46e5" opacity="0.4"/>
</svg>`;

// Tight logo mark used as the swatch inside logo lockups.
const LOGO_MARK_SVG = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" width="16" height="16" aria-hidden="true"><path d="M10 20 L16 10 L22 20 Z" fill="#ffffff"/></svg>`;

const CHART_SVG = `<svg viewBox="0 0 300 120" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true">
  <g fill="#a5b4fc" opacity="0.75">
    <rect x="10"  y="70" width="22" height="45" rx="2"/>
    <rect x="42"  y="50" width="22" height="65" rx="2"/>
    <rect x="74"  y="35" width="22" height="80" rx="2"/>
    <rect x="106" y="60" width="22" height="55" rx="2"/>
    <rect x="138" y="25" width="22" height="90" rx="2"/>
    <rect x="170" y="45" width="22" height="70" rx="2"/>
    <rect x="202" y="15" width="22" height="100" rx="2"/>
    <rect x="234" y="40" width="22" height="75" rx="2"/>
    <rect x="266" y="20" width="22" height="95" rx="2"/>
  </g>
  <path d="M10 90 L42 72 L74 54 L106 64 L138 36 L170 46 L202 22 L234 42 L266 24" fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const THUMBNAIL_SVG = `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" width="70%" height="70%" aria-hidden="true">
  <circle cx="28" cy="26" r="6" fill="#a1a1aa"/>
  <path d="M8 64 L28 44 L48 58 L58 48 L72 64 Z" fill="#a1a1aa"/>
  <path d="M8 64 L72 64" stroke="#71717a" stroke-width="1" opacity="0.3"/>
</svg>`;

const initialsFromLabel = (label: string): string => {
    const parts = label.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
};

const escapeHtml = (value: string): string => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderContent = (type: PlaceholderType, opts: RenderOptions): string => {
    switch (type) {
        case 'avatar': {
            if (opts.label) {
                const initials = initialsFromLabel(opts.label);
                if (initials) {
                    return `<span class="text-xs font-semibold tracking-wide">${escapeHtml(initials)}</span>`;
                }
            }
            return AVATAR_SVG;
        }
        case 'hero':
            return HERO_SVG;
        case 'product':
            return PRODUCT_SVG;
        case 'logo': {
            const text = escapeHtml(opts.label || 'Acme');
            return `<span class="inline-flex items-center justify-center w-6 h-6 rounded-md bg-indigo-600 shrink-0">${LOGO_MARK_SVG}</span><span class="text-sm font-semibold text-neutral-800 tracking-tight">${text}</span>`;
        }
        case 'chart':
            return CHART_SVG;
        case 'thumbnail':
            return THUMBNAIL_SVG;
    }
};

/** Render a single placeholder as an HTML string (wrapper div + inline SVG). */
export function renderPlaceholder(type: PlaceholderType, options: Partial<RenderOptions> = {}): string {
    const size: PlaceholderSize = PLACEHOLDER_SIZES.includes(options.size as PlaceholderSize)
        ? (options.size as PlaceholderSize)
        : 'md';
    const opts: RenderOptions = { size, label: options.label, extraClass: options.extraClass, sizeClassOverride: options.sizeClassOverride };

    const sizeClass = opts.sizeClassOverride ?? SIZE_CLASSES[type][size];
    const wrapperClass = [BASE_WRAPPER[type], sizeClass, opts.extraClass].filter(Boolean).join(' ').trim();
    const content = renderContent(type, opts);
    return `<div class="${wrapperClass}" data-placeholder-rendered="${type}">${content}</div>`;
}

const isPlaceholderType = (value: string | null): value is PlaceholderType =>
    !!value && (PLACEHOLDER_TYPES as readonly string[]).includes(value);

const isPlaceholderSize = (value: string | null): value is PlaceholderSize =>
    !!value && (PLACEHOLDER_SIZES as readonly string[]).includes(value);

/**
 * Replace every `<element data-placeholder="...">` in the given HTML fragment
 * with the rendered inline-SVG placeholder. Unknown types are left alone so
 * the author can inspect and correct their markup. Already-expanded
 * placeholders (marked with `data-placeholder-rendered`) are skipped.
 */
export function expandPlaceholders(html: string): string {
    if (!html || !html.includes('data-placeholder')) return html;
    if (typeof DOMParser === 'undefined') return html;

    try {
        const doc = new DOMParser().parseFromString(
            `<!DOCTYPE html><html><body>${html}</body></html>`,
            'text/html',
        );
        const nodes = Array.from(doc.querySelectorAll('[data-placeholder]'));
        for (const node of nodes) {
            if (node.hasAttribute('data-placeholder-rendered')) continue;

            const rawType = node.getAttribute('data-placeholder');
            if (!isPlaceholderType(rawType)) continue;

            const rawSize = node.getAttribute('data-size');
            const size: PlaceholderSize = isPlaceholderSize(rawSize) ? rawSize : 'md';
            const label = node.getAttribute('data-label') || undefined;
            // `data-class` replaces the default size classes (full override).
            const sizeClassOverride = node.getAttribute('data-class') || undefined;
            // Author-supplied `class` on the placeholder node is preserved as
            // additional utility classes (e.g. shadow-md, ring-1).
            const extraClass = node.getAttribute('class') || undefined;

            const rendered = renderPlaceholder(rawType, { size, label, extraClass, sizeClassOverride });

            const wrapper = doc.createElement('div');
            wrapper.innerHTML = rendered;
            const replacement = wrapper.firstElementChild;
            if (replacement) node.replaceWith(replacement);
        }
        return doc.body.innerHTML;
    } catch {
        return html;
    }
}

/**
 * Short human-readable catalog included in the mockup system prompt so the
 * LLM knows which tokens are available. Derived from the same data as the
 * renderer to avoid drift.
 */
export const PLACEHOLDER_PROMPT_CATALOG = `Available placeholder tokens (use these INSTEAD of <img> or plain CSS boxes whenever an image or photo would go):
- <div data-placeholder="avatar" data-size="sm|md|lg|xl" data-label="Jane Doe"></div> — user avatar (circle). The label is used for initials; omit for a silhouette.
- <div data-placeholder="hero" data-size="sm|md|lg|xl"></div> — wide hero banner (gradient + abstract landscape).
- <div data-placeholder="product" data-size="sm|md|lg|xl"></div> — product image (3D box motif, square).
- <div data-placeholder="logo" data-size="sm|md|lg|xl" data-label="Acme"></div> — brand lockup (mark + wordmark).
- <div data-placeholder="chart" data-size="sm|md|lg|xl"></div> — bar + line chart motif for analytics sections.
- <div data-placeholder="thumbnail" data-size="sm|md|lg|xl"></div> — small image tile (image-file icon).

Sizing defaults: sm = small inline, md = standard, lg = prominent, xl = centerpiece. Pass data-class="w-... h-..." to fully override the default dimensions with Tailwind classes. Any extra class="..." on the placeholder element is preserved (useful for shadows, rings, rounded overrides).`;
