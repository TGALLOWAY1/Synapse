import { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { SectionTabs, type SectionTabItem } from '../SectionTabs';

// Render a `design_system` artifact with first-class visual tokens:
//  • inline color swatches for every hex code
//  • a "live preview" cell next to each typography table row
//  • horizontal bars for spacing-scale list items
//
// We don't change the artifact schema — the artifact is still markdown.
// Instead we split the markdown on `### ` boundaries and dispatch each
// section to a specialty sub-renderer where it pays off, then fall
// back to ReactMarkdown for everything else with a small text-level
// enhancement that turns standalone `#RRGGBB` tokens into swatches.

interface Props {
    content: string;
}

const HEX_RE = /#[0-9a-fA-F]{6}\b/g;
const HEX_TEST = /^#[0-9a-fA-F]{6}$/;

// Pre-replace hex codes with a span carrying a data attribute, so the
// span override below can render them as a swatch + label without us
// having to walk every text node by hand.
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
        // rehype-raw lifts the data-hex attribute into props.
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

// ─── Color Palette ──────────────────────────────────────────────────────────

type ColorRow = { label: string; hex: string; description: string };

function parseColorPalette(body: string): { rows: ColorRow[]; rest: string } {
    const rows: ColorRow[] = [];
    const restLines: string[] = [];
    for (const line of body.split('\n')) {
        // **Label:** #RRGGBB optional description
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

// ─── Typography ─────────────────────────────────────────────────────────────

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
    // Rows start two lines after the header (header + separator).
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

// ─── Spacing Scale ──────────────────────────────────────────────────────────

type SpacingRow = { px: number; label: string; description: string };

function parseSpacing(body: string): SpacingRow[] {
    const rows: SpacingRow[] = [];
    for (const line of body.split('\n')) {
        // - 4px (xs): description
        // - 4px: description
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
    // Match the existing markdown list closely while adding a visual bar.
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

// ─── Generic fallback with hex enhancement ─────────────────────────────────

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

// ─── Top-level dispatcher ──────────────────────────────────────────────────

export function DesignSystemRenderer({ content }: Props) {
    const sections = useMemo(() => splitByH3(content), [content]);
    const tabs: SectionTabItem[] = sections
        .filter(s => s.title)
        .map(s => ({ id: `ds-${slug(s.title)}`, label: s.title }));

    return (
        <div className="space-y-6">
            <SectionTabs items={tabs} />
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
