import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { DesignTokens, DesignTypographyToken, DesignComponentToken } from '../../types';
import { useProjectStore } from '../../store/projectStore';
import { getDesignSystemPresetLabel } from '../../lib/designSystemPresets';
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
//   6. Downstream Usage Status (mockup / HTML mockup / component_inventory)
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
        // Trust normalized tokens; the generator runs them through
        // normalizeDesignTokens before persisting. Cast is safe at this
        // boundary; a defensive normalize is unnecessary cost.
        return raw as DesignTokens;
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
            { id: 'ds-downstream', label: 'Downstream Effects' },
        ];
    }, [tokens]);

    const ids = useMemo(() => items.map(i => i.id), [items]);
    const { activeId, scrollTo } = useArtifactOutline(ids);

    return (
        <div className="space-y-6">
            <ArtifactOutlineNav
                title="Sections"
                items={items}
                activeId={activeId}
                activeLabel="Current section"
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

            <Section id="ds-downstream" title="Downstream Usage">
                <DownstreamUsage projectId={projectId} />
            </Section>
        </div>
    );
}

// Explains the design system's role as the project's single visual source of
// truth: internal mockups and the prompts users copy for external image tools
// both follow it, and regenerating it can shift those downstream assets. Shows
// the chosen preset direction when one was set.
function DesignDirectionNote({ projectId }: { projectId?: string }) {
    const presetId = useProjectStore(s => (projectId ? s.projects[projectId]?.designSystemPreset : undefined));
    const presetLabel = getDesignSystemPresetLabel(presetId);
    return (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-4 py-3 text-xs text-indigo-900">
            <p>
                <span className="font-semibold">This design system is your project's visual source of truth.</span>{' '}
                Internal mockups and the prompts you copy for external image tools both follow it, so they
                stay consistent.
                {presetLabel ? <> Direction: <span className="font-medium">{presetLabel}</span>.</> : null}
            </p>
            <p className="mt-1 text-indigo-700/90">
                Regenerating the design system may change your mockups and screen-level prompts.
            </p>
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

    return (
        <div className="space-y-6">
            {namespaces.map(ns => (
                <div key={ns}>
                    <div className="flex items-baseline justify-between mb-3">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                            {NAMESPACE_LABEL[ns] ?? ns}
                        </p>
                        <p className="text-[11px] text-neutral-400 font-mono">
                            {grouped[ns].length} {grouped[ns].length === 1 ? 'token' : 'tokens'}
                        </p>
                    </div>
                    <div className="flex rounded-2xl overflow-hidden border border-neutral-200 h-[140px] shadow-sm bg-white">
                        {grouped[ns].map(([name, hex]) => (
                            <ColorStripe key={name} name={name} hex={hex} />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function ColorStripe({ name, hex }: { name: string; hex: string }) {
    const dark = isDarkColor(hex);
    const subtleColor = dark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.5)';
    const valueColor = dark ? '#ffffff' : '#0a0a0a';
    const subName = name.includes('.') ? name.split('.').slice(1).join('.') : name;
    const rgb = hexToRgbString(hex);
    return (
        <div
            className="flex-1 relative min-w-[64px] transition-[flex-grow] duration-300 ease-out hover:flex-grow-[2]"
            style={{ background: hex }}
            title={`${name} · ${hex} · rgb(${rgb})`}
            aria-label={`${name} ${hex}`}
        >
            <p
                className="absolute top-3 left-3 right-3 text-[10px] font-bold uppercase tracking-wider truncate"
                style={{ color: subtleColor }}
            >
                {subName}
            </p>
            <div className="absolute bottom-2.5 left-3 right-3 flex flex-col gap-0.5 pointer-events-none">
                <div className="flex items-baseline gap-1.5 min-w-0">
                    <span
                        className="font-mono text-[9px] uppercase tracking-[0.1em] shrink-0"
                        style={{ color: subtleColor }}
                    >
                        HEX
                    </span>
                    <span
                        className="font-mono text-[11px] font-semibold truncate"
                        style={{ color: valueColor }}
                    >
                        {hex.replace('#', '').toUpperCase()}
                    </span>
                </div>
                <div className="flex items-baseline gap-1.5 min-w-0">
                    <span
                        className="font-mono text-[9px] uppercase tracking-[0.1em] shrink-0"
                        style={{ color: subtleColor }}
                    >
                        RGB
                    </span>
                    <span
                        className="font-mono text-[10px] truncate"
                        style={{ color: valueColor }}
                    >
                        {rgb}
                    </span>
                </div>
            </div>
        </div>
    );
}

// ─── Typography Tokens ───────────────────────────────────────────────────

const TYPO_CARD_STYLES: Array<{ bg: string; chip: string }> = [
    { bg: 'bg-sky-100', chip: 'bg-white text-neutral-900' },
    { bg: 'bg-neutral-100', chip: 'bg-white text-neutral-900' },
    { bg: 'bg-amber-50', chip: 'bg-white text-neutral-900' },
    { bg: 'bg-emerald-50', chip: 'bg-white text-neutral-900' },
    { bg: 'bg-rose-50', chip: 'bg-white text-neutral-900' },
    { bg: 'bg-violet-50', chip: 'bg-white text-neutral-900' },
];

const ALPHABET_PREVIEW = 'Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kk Ll Mm Nn Oo Pp Qq Rr Ss Tt Uu Vv Ww Xx Yy Zz';

function fontFamilyDisplay(font: string): string {
    const first = font.split(',')[0]?.trim() ?? font;
    return first.replace(/^["']|["']$/g, '');
}

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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sorted.map(([name, t]: [string, DesignTypographyToken], idx) => (
                <TypographyCard key={name} name={name} token={t} index={idx} />
            ))}
        </div>
    );
}

function TypographyCard({ name, token, index }: { name: string; token: DesignTypographyToken; index: number }) {
    const style = TYPO_CARD_STYLES[index % TYPO_CARD_STYLES.length];
    const display = fontFamilyDisplay(token.font);
    const tokenFontStyle: React.CSSProperties = {
        fontFamily: token.font,
        fontWeight: token.weight,
        ...(token.letterSpacing !== undefined ? { letterSpacing: `${token.letterSpacing}px` } : {}),
    };

    return (
        <div className={`relative ${style.bg} rounded-2xl p-4 min-h-[160px] flex flex-col overflow-hidden shadow-sm`}>
            <div className="flex justify-between items-start gap-3">
                <span className={`inline-block ${style.chip} text-[10px] font-semibold px-2.5 py-1 rounded-full shadow-sm`}>
                    {name}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500/80">
                    {token.size}px · {token.weight}
                </span>
            </div>
            <div className="flex-1 flex items-center py-3">
                <p
                    className="text-neutral-900 break-words"
                    style={{
                        ...tokenFontStyle,
                        fontSize: 'clamp(24px, 4vw, 40px)',
                        lineHeight: 1,
                    }}
                >
                    {display}
                </p>
            </div>
            <div>
                <p
                    className="text-neutral-900/90 leading-snug break-words"
                    style={{
                        ...tokenFontStyle,
                        fontSize: '12px',
                        lineHeight: token.lineHeight,
                    }}
                >
                    {ALPHABET_PREVIEW}
                </p>
            </div>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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

// ─── Downstream Usage Status ─────────────────────────────────────────────

interface DownstreamSummary {
    mockupCount: number;
    componentInventoryExists: boolean;
}

function useDownstreamSummary(projectId: string | undefined): DownstreamSummary | null {
    // useShallow is required: Zustand v5's useSyncExternalStore-based subscription
    // calls getSnapshot multiple times per render and compares with Object.is —
    // returning a fresh `{ mockupCount, componentInventoryExists }` object on each
    // call triggers React error #185 ("Maximum update depth exceeded").
    return useProjectStore(useShallow(state => {
        if (!projectId) return null;
        const artifacts = state.artifacts[projectId] ?? [];
        const mockupCount = artifacts.filter(a => a.type === 'mockup' && a.status !== 'archived').length;
        const componentInventoryExists = artifacts.some(
            a => a.type === 'core_artifact' && a.subtype === 'component_inventory' && a.status !== 'archived',
        );
        return { mockupCount, componentInventoryExists };
    }));
}

function DownstreamUsage({ projectId }: { projectId?: string }) {
    const summary = useDownstreamSummary(projectId);

    if (!summary) {
        return (
            <p className="text-sm text-neutral-500 italic">
                Downstream usage is detected automatically when a project context is available.
            </p>
        );
    }

    const consumers: Array<{ label: string; present: boolean; description: string }> = [
        {
            label: 'Mockups',
            present: summary.mockupCount > 0,
            description: summary.mockupCount > 0
                ? `${summary.mockupCount} mockup artifact${summary.mockupCount === 1 ? '' : 's'} pull design tokens at generation time.`
                : 'No mockup artifact has been generated yet — design tokens will be applied to the next generation.',
        },
        {
            label: 'Component inventory',
            present: summary.componentInventoryExists,
            description: summary.componentInventoryExists
                ? 'A component inventory exists; future iterations can map components to design tokens.'
                : 'No component inventory generated yet.',
        },
    ];

    const noConsumers = !consumers.some(c => c.present);

    return (
        <div className="space-y-3">
            {noConsumers && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <div>
                        <p className="font-medium">No downstream artifact is using this design system yet.</p>
                        <p className="text-xs text-amber-700 mt-0.5">
                            Generate a mockup to see the design tokens injected as CSS variables and prompt context.
                        </p>
                    </div>
                </div>
            )}
            <ul className="space-y-1.5">
                {consumers.map(c => (
                    <li
                        key={c.label}
                        className="flex items-start gap-2 rounded-md border border-neutral-200 bg-white p-3 text-sm"
                    >
                        {c.present ? (
                            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                        ) : (
                            <span className="mt-0.5 shrink-0 w-4 h-4 rounded-full border border-neutral-300" />
                        )}
                        <div>
                            <p className="text-neutral-900 font-medium">{c.label}</p>
                            <p className="text-xs text-neutral-500 mt-0.5">{c.description}</p>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}

// ─── Legacy markdown renderer (preserved as-is for back-compat) ──────────

const HEX_RE = /#[0-9a-fA-F]{6}\b/g;
const HEX_TEST = /^#[0-9a-fA-F]{6}$/;

function annotateHexes(markdown: string): string {
    return markdown.replace(HEX_RE, hex => `<span data-hex="${hex}">${hex}</span>`);
}

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

const baseComponents: Components = {
    span(props) {
        const dataHex = (props as Record<string, unknown>)['data-hex'] as string | undefined;
        if (dataHex && HEX_TEST.test(dataHex)) return <HexSwatch hex={dataHex} />;
        const { children, ...rest } = props;
        return <span {...rest}>{children}</span>;
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
    const annotated = useMemo(() => annotateHexes(body), [body]);
    return (
        <div className="prose prose-sm prose-neutral max-w-none">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={baseComponents}
            >
                {annotated}
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
