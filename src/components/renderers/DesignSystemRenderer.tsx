import { useMemo, Children, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DesignTokens, DesignTypographyToken, DesignComponentToken } from '../../types';
import { useProjectStore } from '../../store/projectStore';
import { getDesignSystemPresetLabel } from '../../lib/designSystemPresets';
import { normalizeDesignTokens } from '../../lib/designTokens';
import { ArtifactOutlineNav, type ArtifactOutlineItem } from '../ArtifactOutlineNav';
import { useArtifactOutline } from '../../lib/useArtifactOutline';
import { useIsMobile } from '../../lib/useIsMobile';

// Render a `design_system` artifact. The renderer prefers a structured
// token contract on `metadata.tokens` (new generations) and falls back
// to regex-parsing the legacy markdown body when tokens aren't present
// (older projects in localStorage).
//
// New token-aware sections (when metadata.tokens is present):
//   1. Color Tokens (grouped by namespace)
//   2. Typography Tokens (live previews)
//   3. Spacing + Radius (proportional bars)
//   4. Component Tokens (recipe cards)
//   5. Usage Rules (verbatim from tokens.rules)
//
// Downstream artifact usage is surfaced by the dedicated Dependency Graph
// artifact, not here.
//
// Legacy markdown rendering preserved unchanged for back-compat.

interface Props {
    content: string;
    metadata?: Record<string, unknown>;
    projectId?: string;
}

export function DesignSystemRenderer({ content, metadata, projectId }: Props) {
    const tokens = useTokensFromMetadata(metadata);
    if (tokens) {
        return <TokenizedDesignSystem tokens={tokens} projectId={projectId} />;
    }
    return <LegacyMarkdownDesignSystem content={content} />;
}

// ─── Token extraction ──────────────────────────────────────────────────────

function useTokensFromMetadata(metadata: Record<string, unknown> | undefined): DesignTokens | null {
    return useMemo(() => {
        if (!metadata) return null;
        const raw = metadata.tokens;
        if (!raw || typeof raw !== 'object') return null;
        // Re-normalize at the render boundary. The generator normalizes before
        // persisting, but metadata also arrives via paths that skip it (server
        // sync payloads, snapshot restore, legacy import) — and these values
        // flow into inline `style={{ background }}`, so a non-hex string here
        // (e.g. `url(https://…)`) could trigger an external fetch under the
        // CSP's `img-src … https:`. `coerceHex` inside normalize guarantees
        // `#rrggbb` only. useMemo keys on the metadata reference, so the
        // tokens reference stays stable across re-renders (no React #185).
        return normalizeDesignTokens(raw);
    }, [metadata]);
}

// ─── Tokenized renderer ───────────────────────────────────────────────────

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
    return `${n} ${n === 1 ? singular : pluralForm}`;
}

function TokenizedDesignSystem({ tokens, projectId }: { tokens: DesignTokens; projectId?: string }) {
    const isMobile = useIsMobile();

    const items: ArtifactOutlineItem[] = useMemo(() => {
        const spacingCount = Object.keys(tokens.spacing).length + Object.keys(tokens.radius).length;
        return [
            { id: 'ds-colors', label: 'Colors', countLabel: plural(Object.keys(tokens.colors).length, 'token') },
            { id: 'ds-typography', label: 'Typography', countLabel: plural(Object.keys(tokens.typography).length, 'role') },
            { id: 'ds-spacing', label: 'Spacing & Radius', countLabel: plural(spacingCount, 'token') },
            { id: 'ds-components', label: 'Components', countLabel: plural(Object.keys(tokens.components).length, 'component') },
            { id: 'ds-rules', label: 'Rules', countLabel: plural(tokens.rules.length, 'rule') },
        ];
    }, [tokens]);

    const ids = useMemo(() => items.map(i => i.id), [items]);
    const { activeId, scrollTo } = useArtifactOutline(ids);

    return (
        <div className="space-y-5">
            <ArtifactOutlineNav
                title="Sections"
                items={items}
                activeId={activeId}
                activeLabel="Current section"
                defaultExpanded={false}
                collapseOnSelect={isMobile}
                onSelect={scrollTo}
            />

            <DesignDirectionNote projectId={projectId} />

            <Section id="ds-colors" title="Color Tokens">
                <ColorTokens tokens={tokens} />
            </Section>

            <Section id="ds-typography" title="Typography Tokens">
                <TypographyTokens tokens={tokens} />
            </Section>

            <Section id="ds-spacing" title="Spacing & Radius">
                <SpacingAndRadius tokens={tokens} />
            </Section>

            <Section id="ds-components" title="Component Tokens">
                <ComponentTokens tokens={tokens} />
            </Section>

            <Section id="ds-rules" title="Usage Rules">
                <UsageRules tokens={tokens} />
            </Section>
        </div>
    );
}

// Explains the design system's role as the project's single visual source of
// truth: internal mockups and the prompts users copy for external image tools
// both follow it. Shows the chosen preset direction when one was set. The
// regeneration-impact message is deliberately NOT repeated here — it's already
// carried by `DesignDirectionControl`.
function DesignDirectionNote({ projectId }: { projectId?: string }) {
    const presetId = useProjectStore(s => (projectId ? s.projects[projectId]?.designSystemPreset : undefined));
    const presetLabel = getDesignSystemPresetLabel(presetId);
    const text = `This design system is your project's visual source of truth — mockups and external image prompts follow it.${
        presetLabel ? ` Direction: ${presetLabel}.` : ''
    }`;
    return (
        <div
            className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-4 py-2 text-[11px] text-indigo-900 truncate"
            title={text}
        >
            {text}
        </div>
    );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
    return (
        <section id={id} className="scroll-mt-24">
            <h3 className="text-base font-bold text-neutral-900 mb-3 pb-2 border-b border-neutral-200">
                {title}
            </h3>
            {children}
        </section>
    );
}

// ─── Color/typography helpers ─────────────────────────────────────────────

const NAMESPACE_LABEL: Record<string, string> = {
    brand: 'Brand',
    text: 'Text',
    surface: 'Surface',
    border: 'Border',
    state: 'State',
    accent: 'Accent',
};

function parseHex(hex: string): [number, number, number] | null {
    const clean = hex.replace('#', '').trim();
    if (clean.length !== 6) return null;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r, g, b];
}

function hexToRgbString(hex: string): string {
    const rgb = parseHex(hex);
    if (!rgb) return '—';
    return `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`;
}

function isDarkColor(hex: string): boolean {
    const rgb = parseHex(hex);
    if (!rgb) return false;
    const [rs, gs, bs] = rgb.map(c => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    const lum = 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    return lum < 0.55;
}

// ─── Color Tokens ─────────────────────────────────────────────────────────

function ColorTokens({ tokens }: { tokens: DesignTokens }) {
    const grouped = useMemo(() => {
        const out: Record<string, [string, string][]> = {};
        for (const [name, hex] of Object.entries(tokens.colors)) {
            const ns = name.split('.')[0] || 'other';
            if (!out[ns]) out[ns] = [];
            out[ns].push([name, hex]);
        }
        return out;
    }, [tokens.colors]);

    const namespaceOrder = ['brand', 'text', 'surface', 'border', 'state', 'accent'];
    const namespaces = [
        ...namespaceOrder.filter(n => n in grouped),
        ...Object.keys(grouped).filter(n => !namespaceOrder.includes(n)).sort(),
    ];

    // Namespace clusters flow inline so several groups share a row on desktop
    // instead of each namespace forcing a mostly-empty full-width grid row.
    return (
        <div className="flex flex-wrap gap-x-8 gap-y-4">
            {namespaces.map(ns => (
                <div key={ns}>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500 mb-1.5">
                        {NAMESPACE_LABEL[ns] ?? ns}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {grouped[ns].map(([name, hex]) => (
                            <ColorSwatchCard key={name} name={name} hex={hex} />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function ColorSwatchCard({ name, hex }: { name: string; hex: string }) {
    const subName = name.includes('.') ? name.split('.').slice(1).join('.') : name;
    const rgb = hexToRgbString(hex);
    // The token color fills the whole card face (as the pre-cluster stripes
    // did) so the palette reads at a glance; text sits on the color itself in
    // a contrast-aware ink.
    const dark = isDarkColor(hex);
    const subtleColor = dark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.5)';
    const valueColor = dark ? '#ffffff' : '#0a0a0a';
    return (
        <div
            className="relative w-44 h-24 rounded-lg border border-black/10 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] overflow-hidden"
            style={{ background: hex }}
            title={`${name} · ${hex} · rgb(${rgb})`}
            aria-label={`${name} ${hex}`}
        >
            <p
                className="absolute top-2 left-2.5 right-2.5 text-[10px] font-bold uppercase tracking-wider truncate"
                style={{ color: subtleColor }}
            >
                {subName}
            </p>
            <div className="absolute bottom-2 left-2.5 right-2.5 flex flex-col gap-0.5 pointer-events-none">
                <div className="flex items-baseline gap-1.5 min-w-0">
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] shrink-0" style={{ color: subtleColor }}>
                        HEX
                    </span>
                    <span className="font-mono text-[11px] font-semibold truncate" style={{ color: valueColor }}>
                        {hex.replace('#', '').toUpperCase()}
                    </span>
                </div>
                <div className="flex items-baseline gap-1.5 min-w-0">
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] shrink-0" style={{ color: subtleColor }}>
                        RGB
                    </span>
                    <span className="font-mono text-[10px] truncate" style={{ color: valueColor }}>
                        {rgb}
                    </span>
                </div>
            </div>
        </div>
    );
}

// ─── Typography Tokens ───────────────────────────────────────────────────

function TypographyTokens({ tokens }: { tokens: DesignTokens }) {
    const sorted = useMemo(() => {
        return Object.entries(tokens.typography).sort((a, b) => {
            const aHead = a[0].startsWith('heading.') ? 0 : 1;
            const bHead = b[0].startsWith('heading.') ? 0 : 1;
            if (aHead !== bHead) return aHead - bHead;
            return b[1].size - a[1].size;
        });
    }, [tokens.typography]);

    return (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {sorted.map(([name, t]: [string, DesignTypographyToken]) => (
                <TypographyRow key={name} name={name} token={t} />
            ))}
        </div>
    );
}

function TypographyRow({ name, token }: { name: string; token: DesignTypographyToken }) {
    const tokenFontStyle: React.CSSProperties = {
        fontFamily: token.font,
        fontWeight: token.weight,
        ...(token.letterSpacing !== undefined ? { letterSpacing: `${token.letterSpacing}px` } : {}),
    };

    return (
        <div className="flex items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2">
            <span
                className="shrink-0 text-neutral-900"
                style={{ ...tokenFontStyle, fontSize: `${Math.min(token.size, 26)}px`, lineHeight: 1 }}
                aria-hidden="true"
            >
                Aa
            </span>
            <span className="flex-1 min-w-0 text-sm font-medium text-neutral-900 truncate">{name}</span>
            <span className="shrink-0 font-mono text-[10px] text-neutral-500">
                {token.size}px · {token.weight} · {token.lineHeight}
            </span>
        </div>
    );
}

// ─── Spacing + Radius ───────────────────────────────────────────────────

function SpacingAndRadius({ tokens }: { tokens: DesignTokens }) {
    const spacingEntries = Object.entries(tokens.spacing).sort((a, b) => a[1] - b[1]);
    const radiusEntries = Object.entries(tokens.radius).sort((a, b) => a[1] - b[1]);
    const maxSpacing = Math.max(1, ...spacingEntries.map(([, v]) => v));
    const maxRadius = Math.max(1, ...radiusEntries.map(([, v]) => v));

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2">Spacing scale</p>
                <div className="space-y-1.5">
                    {spacingEntries.map(([key, px]) => (
                        <div key={key} className="flex items-center gap-3 bg-white rounded-md border border-neutral-200 px-3 py-2">
                            <code className="font-mono text-xs text-neutral-700 shrink-0 w-10">{px}px</code>
                            <span className="text-[11px] font-medium uppercase tracking-wider text-indigo-600 shrink-0 w-10">{key}</span>
                            <div
                                className="shrink-0 h-3 bg-indigo-200 rounded-sm"
                                style={{ width: `${(px / maxSpacing) * 200}px` }}
                            />
                        </div>
                    ))}
                </div>
            </div>
            <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2">Radius scale</p>
                <div className="space-y-1.5">
                    {radiusEntries.map(([key, px]) => (
                        <div key={key} className="flex items-center gap-3 bg-white rounded-md border border-neutral-200 px-3 py-2">
                            <code className="font-mono text-xs text-neutral-700 shrink-0 w-10">{px}px</code>
                            <span className="text-[11px] font-medium uppercase tracking-wider text-indigo-600 shrink-0 w-10">{key}</span>
                            <div
                                className="shrink-0 w-12 h-8 bg-indigo-100 border border-indigo-200"
                                style={{ borderRadius: `${(px / maxRadius) * 16}px` }}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ─── Component Tokens ────────────────────────────────────────────────────

function ComponentTokens({ tokens }: { tokens: DesignTokens }) {
    const entries = Object.entries(tokens.components).sort((a, b) => a[0].localeCompare(b[0]));
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {entries.map(([name, c]: [string, DesignComponentToken]) => (
                <div key={name} className="bg-white rounded-lg border border-neutral-200 p-3 space-y-2">
                    <p className="text-xs font-semibold text-neutral-900">{name}</p>
                    <dl className="text-[11px] text-neutral-600 space-y-0.5">
                        {(['background', 'text', 'border', 'radius', 'padding'] as const).map(field => (
                            c[field] !== undefined ? (
                                <div key={field} className="grid grid-cols-[80px,1fr] gap-2">
                                    <dt className="font-medium uppercase tracking-wider text-neutral-400">{field}</dt>
                                    <dd className="font-mono">{c[field]}</dd>
                                </div>
                            ) : null
                        ))}
                    </dl>
                    {c.notes && (
                        <p className="text-[11px] text-neutral-500 italic border-t border-neutral-100 pt-2">{c.notes}</p>
                    )}
                </div>
            ))}
        </div>
    );
}

// ─── Usage Rules ─────────────────────────────────────────────────────────

function UsageRules({ tokens }: { tokens: DesignTokens }) {
    if (tokens.rules.length === 0) {
        return (
            <p className="text-sm text-neutral-500 italic">No usage rules defined.</p>
        );
    }
    return (
        <ul className="space-y-1.5">
            {tokens.rules.map((rule, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-neutral-700">
                    <span className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500" aria-hidden="true" />
                    <span>{rule}</span>
                </li>
            ))}
        </ul>
    );
}

// ─── Legacy markdown renderer (preserved as-is for back-compat) ──────────

const HEX_RE = /#[0-9a-fA-F]{6}\b/g;

function HexSwatch({ hex }: { hex: string }) {
    return (
        <span className="inline-flex items-center gap-1.5 align-middle">
            <span
                className="inline-block w-3.5 h-3.5 rounded border border-neutral-300 align-middle"
                style={{ background: hex }}
                aria-hidden="true"
            />
            <code className="font-mono text-[11px] text-neutral-700">{hex}</code>
        </span>
    );
}

// Splits a plain-text string on hex color literals and wraps each match in a
// swatch. Kept as a pure text transform (no HTML injection) so hex previews
// no longer depend on raw-HTML passthrough — see the react-markdown
// `components` overrides below, which apply this only to string children.
function renderTextWithHexSwatches(text: string, keyPrefix: string): ReactNode[] {
    const matches = text.match(HEX_RE) ?? [];
    if (matches.length === 0) return [text];
    const parts = text.split(HEX_RE);
    const out: ReactNode[] = [];
    parts.forEach((part, i) => {
        if (part) out.push(part);
        if (i < matches.length) {
            out.push(<HexSwatch key={`${keyPrefix}-hex-${i}`} hex={matches[i]} />);
        }
    });
    return out;
}

// Applies renderTextWithHexSwatches to the string children of a rendered
// markdown node, leaving element children (nested bold/italic/code, which
// get their own component overrides) untouched.
function withHexSwatches(children: ReactNode, keyPrefix: string): ReactNode {
    return Children.toArray(children).map((child, i) =>
        typeof child === 'string' ? renderTextWithHexSwatches(child, `${keyPrefix}-${i}`) : child,
    );
}

const baseComponents: Components = {
    p({ children, ...rest }) {
        return <p {...rest}>{withHexSwatches(children, 'p')}</p>;
    },
    li({ children, ...rest }) {
        return <li {...rest}>{withHexSwatches(children, 'li')}</li>;
    },
    td({ children, ...rest }) {
        return <td {...rest}>{withHexSwatches(children, 'td')}</td>;
    },
    code({ children, ...rest }) {
        return <code {...rest}>{withHexSwatches(children, 'code')}</code>;
    },
    strong({ children, ...rest }) {
        return <strong {...rest}>{withHexSwatches(children, 'strong')}</strong>;
    },
    em({ children, ...rest }) {
        return <em {...rest}>{withHexSwatches(children, 'em')}</em>;
    },
};

type Section = { title: string; body: string };

function splitByH3(markdown: string): Section[] {
    const lines = markdown.split('\n');
    const sections: Section[] = [];
    let current: Section | null = null;
    const preamble: string[] = [];
    for (const line of lines) {
        const m = line.match(/^### \s*(.+?)\s*$/);
        if (m) {
            if (current) sections.push(current);
            current = { title: m[1], body: '' };
            continue;
        }
        if (current) {
            current.body += line + '\n';
        } else {
            preamble.push(line);
        }
    }
    if (current) sections.push(current);
    if (preamble.join('').trim().length > 0) {
        sections.unshift({ title: '', body: preamble.join('\n') });
    }
    return sections;
}

type ColorRow = { label: string; hex: string; description: string };

function parseColorPalette(body: string): { rows: ColorRow[]; rest: string } {
    const rows: ColorRow[] = [];
    const restLines: string[] = [];
    for (const line of body.split('\n')) {
        const m = line.match(/^\s*[-*]?\s*\*?\*?\s*([^*:]+?)\s*\*?\*?\s*[:-]\s*(#[0-9a-fA-F]{6})\b\s*(.*)$/);
        if (m) {
            const [, label, hex, description] = m;
            rows.push({
                label: label.trim().replace(/[*_]/g, ''),
                hex,
                description: description.trim().replace(/^[—–-]\s*/, ''),
            });
        } else {
            restLines.push(line);
        }
    }
    return { rows, rest: restLines.join('\n').trim() };
}

function ColorPaletteSection({ body }: { body: string }) {
    const { rows, rest } = useMemo(() => parseColorPalette(body), [body]);
    if (rows.length === 0) return <FallbackMarkdown body={body} />;
    return (
        <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {rows.map((row, i) => (
                    <div
                        key={i}
                        className="flex items-start gap-3 bg-white rounded-lg border border-neutral-200 p-3"
                    >
                        <span
                            className="shrink-0 w-12 h-12 rounded-md border border-neutral-200"
                            style={{ background: row.hex }}
                            aria-hidden="true"
                        />
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-baseline gap-2">
                                <span className="text-sm font-semibold text-neutral-900">{row.label}</span>
                                <code className="font-mono text-[11px] text-neutral-500">{row.hex}</code>
                            </div>
                            {row.description && (
                                <p className="text-xs text-neutral-600 mt-0.5">{row.description}</p>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            {rest && <FallbackMarkdown body={rest} />}
        </div>
    );
}

type TypographyRow = {
    role: string;
    font: string;
    size: string;
    weight: string;
    lineHeight: string;
    application: string;
};

function parseTypographyTable(body: string): TypographyRow[] | null {
    const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i].toLowerCase();
        if (l.includes('role') && l.includes('font') && l.includes('size') && l.includes('weight')) {
            headerIdx = i;
            break;
        }
    }
    if (headerIdx === -1) return null;
    const rows: TypographyRow[] = [];
    for (let i = headerIdx + 2; i < lines.length; i++) {
        const cells = lines[i]
            .split('|')
            .map(c => c.trim())
            .filter((c, idx, arr) => !(idx === 0 && c === '') && !(idx === arr.length - 1 && c === ''));
        if (cells.length < 5) break;
        rows.push({
            role: cells[0],
            font: cells[1],
            size: cells[2],
            weight: cells[3],
            lineHeight: cells[4],
            application: cells[5] || '',
        });
    }
    return rows.length > 0 ? rows : null;
}

function parseSize(size: string): number {
    const m = size.match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : 16;
}

function TypographySection({ body }: { body: string }) {
    const rows = useMemo(() => parseTypographyTable(body), [body]);
    if (!rows) return <FallbackMarkdown body={body} />;
    return (
        <div className="space-y-2">
            {rows.map((row, i) => {
                const px = parseSize(row.size);
                const previewSize = Math.min(Math.max(px, 12), 36);
                return (
                    <div
                        key={i}
                        className="grid grid-cols-[auto,1fr] gap-4 items-center bg-white rounded-lg border border-neutral-200 p-3"
                    >
                        <div className="min-w-[140px]">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                                {row.role}
                            </p>
                            <p className="text-[11px] text-neutral-500 mt-0.5">
                                {row.font} · {row.size} · {row.weight}
                                {row.lineHeight ? ` · LH ${row.lineHeight}` : ''}
                            </p>
                        </div>
                        <div className="min-w-0">
                            <p
                                className="text-neutral-900 truncate"
                                style={{
                                    fontFamily: row.font,
                                    fontSize: `${previewSize}px`,
                                    fontWeight: parseInt(row.weight, 10) || 400,
                                    lineHeight: row.lineHeight || 1.3,
                                }}
                            >
                                The quick brown fox
                            </p>
                            {row.application && (
                                <p className="text-[11px] text-neutral-500 mt-0.5">{row.application}</p>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

type SpacingRow = { px: number; label: string; description: string };

function parseSpacing(body: string): SpacingRow[] {
    const rows: SpacingRow[] = [];
    for (const line of body.split('\n')) {
        const m = line.match(/^\s*[-*]\s*(\d+)px\s*(?:\(([^)]+)\))?\s*[:\-—]?\s*(.*)$/);
        if (m) {
            rows.push({
                px: Number(m[1]),
                label: (m[2] || '').trim(),
                description: m[3].trim(),
            });
        }
    }
    return rows;
}

function SpacingSection({ body }: { body: string }) {
    const rows = useMemo(() => parseSpacing(body), [body]);
    if (rows.length === 0) return <FallbackMarkdown body={body} />;
    const max = Math.max(...rows.map(r => r.px));
    return (
        <div>
            {body.split('\n').filter(l => /^[A-Za-z]/.test(l.trim())).map((line, i) => (
                <p key={`p-${i}`} className="text-sm text-neutral-700 mb-2">
                    {line.trim()}
                </p>
            ))}
            <div className="space-y-1.5">
                {rows.map((row, i) => (
                    <div
                        key={i}
                        className="flex items-center gap-3 bg-white rounded-md border border-neutral-200 px-3 py-2"
                    >
                        <code className="font-mono text-xs text-neutral-700 shrink-0 w-12">
                            {row.px}px
                        </code>
                        {row.label && (
                            <span className="text-[11px] font-medium uppercase tracking-wider text-indigo-600 shrink-0 w-10">
                                {row.label}
                            </span>
                        )}
                        <div className="shrink-0 h-3 bg-indigo-200 rounded-sm" style={{ width: `${(row.px / max) * 200}px` }} />
                        <span className="text-xs text-neutral-600 truncate">{row.description}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function FallbackMarkdown({ body }: { body: string }) {
    return (
        <div className="prose prose-sm prose-neutral max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={baseComponents}>
                {body}
            </ReactMarkdown>
        </div>
    );
}

function LegacyMarkdownDesignSystem({ content }: { content: string }) {
    const isMobile = useIsMobile();
    const sections = useMemo(() => splitByH3(content), [content]);
    const items: ArtifactOutlineItem[] = useMemo(
        () => sections.filter(s => s.title).map(s => ({ id: `ds-${slug(s.title)}`, label: s.title })),
        [sections],
    );
    const ids = useMemo(() => items.map(i => i.id), [items]);
    const { activeId, scrollTo } = useArtifactOutline(ids);

    return (
        <div className="space-y-6">
            {items.length > 1 && (
                <ArtifactOutlineNav
                    title="Sections"
                    items={items}
                    activeId={activeId}
                    activeLabel="Current section"
                    defaultExpanded={false}
                    collapseOnSelect={isMobile}
                    onSelect={scrollTo}
                />
            )}
            {sections.map((section, i) => {
                const title = section.title.toLowerCase();
                let body: React.ReactNode;
                if (title.includes('color') || title.includes('palette')) {
                    body = <ColorPaletteSection body={section.body} />;
                } else if (title.includes('typograph')) {
                    body = <TypographySection body={section.body} />;
                } else if (title.includes('spacing')) {
                    body = <SpacingSection body={section.body} />;
                } else {
                    body = <FallbackMarkdown body={section.body} />;
                }
                return (
                    <section
                        key={i}
                        id={section.title ? `ds-${slug(section.title)}` : undefined}
                        className="scroll-mt-24"
                    >
                        {section.title && (
                            <h3 className="text-base font-bold text-neutral-900 mb-3 pb-2 border-b border-neutral-200">
                                {section.title}
                            </h3>
                        )}
                        {body}
                    </section>
                );
            })}
        </div>
    );
}

function slug(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
