// Structured review surface for the `component_inventory` artifact.
//
// W4 of docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md: this artifact feeds every
// mockup (MOCKUP_DEPENDENCIES) but used to have no renderer at all, so it
// influenced the product and could not be inspected. The renderer had to land
// BEFORE the artifact was unhidden — otherwise the first thing a user saw was
// raw markdown/JSON.
//
// It shows, per component: name + complexity, purpose, props, accessibility
// contract, notes, and — the part that makes it reviewable — WHICH SCREENS
// REFERENCE IT. Those back-references and the component/screen contradictions
// come from the derived `src/lib/componentExperience.ts` join over the canonical
// Screens index; they are advisory, name-based estimates and are labelled as
// such (cross-cutting rule 10). Nothing here gates anything.
//
// Legacy artifacts render unchanged: every optional field degrades to "Not
// specified", and content that isn't a parseable component inventory falls back
// to plain markdown here (the same graceful-degradation contract the other
// bespoke renderers follow) so nothing is ever unreadable.

import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
    AlertTriangle, Blocks, ChevronDown, ChevronUp, Info, Keyboard, Link2, MonitorSmartphone, Target,
} from 'lucide-react';
import type { ComponentA11y, ComponentItem } from '../../types';
import { parseComponentInventoryMarkdown } from '../../lib/componentInventoryParse';
import {
    buildComponentInventoryModel,
    type ComponentInventoryEntry,
    type ComponentJoinScreen,
    type ComponentReferenceIssue,
} from '../../lib/componentExperience';

interface Props {
    content: string;
    /**
     * Screens for the back-reference join, projected from the canonical Screens
     * index via `componentJoinScreensFromIndex`. Omitted → the components still
     * render, with no back-references and no contradiction advisories (there is
     * no evidence either way).
     */
    screens?: readonly ComponentJoinScreen[];
    /** Navigate to a screen by slug (the Screens view's own navigation key). */
    onNavigateToScreen?: (screenSlug: string) => void;
}

const COMPLEXITY_STYLES: Record<ComponentItem['complexity'], string> = {
    simple: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    moderate: 'bg-sky-50 text-sky-700 ring-sky-200',
    complex: 'bg-amber-50 text-amber-700 ring-amber-200',
};

const EMPTY_SCREENS: readonly ComponentJoinScreen[] = [];

/**
 * Structured Component Inventory view. Content that doesn't parse as a
 * component inventory degrades to plain markdown rather than disappearing.
 */
export function ComponentInventoryRenderer({ content, screens = EMPTY_SCREENS, onNavigateToScreen }: Props) {
    const model = useMemo(
        () => buildComponentInventoryModel(parseComponentInventoryMarkdown(content), screens),
        [content, screens],
    );

    if (model.entries.length === 0) {
        return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
    }

    const { summary } = model;

    return (
        <div className="space-y-4">
            <header className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
                        <Blocks size={16} className="text-indigo-600" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-neutral-900">Reusable components</h2>
                        <p className="mt-0.5 text-xs text-neutral-600">
                            {summary.componentCount} component{summary.componentCount === 1 ? '' : 's'}
                            {' across '}
                            {summary.categoryCount} categor{summary.categoryCount === 1 ? 'y' : 'ies'}
                            {summary.joinAvailable && (
                                <>
                                    {' · '}
                                    {summary.referencedCount} referenced by a screen
                                    {summary.unreferencedCount > 0 && ` · ${summary.unreferencedCount} not referenced`}
                                </>
                            )}
                        </p>
                        <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-400">
                            Screen references are <strong className="font-medium">derived</strong> by matching component
                            and screen names between the two artifacts — there is no stored link, so treat them as
                            estimates. Everything on this page is advisory and blocks nothing.
                        </p>
                    </div>
                </div>
            </header>

            {model.issues.length > 0 && <ComponentAdvisories issues={model.issues} onNavigateToScreen={onNavigateToScreen} />}

            {model.categories.map(category => (
                <section key={category.name} className="space-y-2">
                    <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                        {category.name}
                    </h3>
                    <div className="space-y-3">
                        {category.components.map(entry => (
                            <ComponentCard
                                key={entry.id}
                                entry={entry}
                                joinAvailable={summary.joinAvailable}
                                onNavigateToScreen={onNavigateToScreen}
                            />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

function ComponentCard({ entry, joinAvailable, onNavigateToScreen }: {
    entry: ComponentInventoryEntry;
    joinAvailable: boolean;
    onNavigateToScreen?: (screenSlug: string) => void;
}) {
    const { component } = entry;
    const props = component.props ?? [];

    return (
        <article id={`component-${entry.id}`} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
                <h4 className="min-w-0 break-words text-sm font-semibold text-neutral-900">{component.name}</h4>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ring-1 ${COMPLEXITY_STYLES[component.complexity] ?? COMPLEXITY_STYLES.moderate}`}>
                    {component.complexity}
                </span>
                {component.previewType && (
                    <span className="rounded-full bg-neutral-50 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 ring-1 ring-neutral-200">
                        {component.previewType}
                    </span>
                )}
            </div>

            <p className="mt-1.5 text-xs leading-relaxed text-neutral-700">
                {component.purpose?.trim() || <span className="text-neutral-400">Purpose not specified.</span>}
            </p>

            <Field icon={<Target size={12} className="text-neutral-400" />} label="Props">
                {props.length === 0
                    ? <span className="text-xs text-neutral-400">Not specified.</span>
                    : (
                        <ul className="space-y-1">
                            {props.map((prop, i) => (
                                <li key={`${prop.name}-${i}`} className="text-xs leading-relaxed text-neutral-700">
                                    <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[11px] text-neutral-800">
                                        {prop.name}
                                    </code>
                                    {prop.type && <span className="ml-1.5 text-neutral-500">{prop.type}</span>}
                                    {prop.required && (
                                        <span className="ml-1.5 rounded bg-rose-50 px-1 py-0.5 text-[10px] font-medium text-rose-700">
                                            required
                                        </span>
                                    )}
                                    {prop.description && <span className="ml-1.5 text-neutral-600">— {prop.description}</span>}
                                </li>
                            ))}
                        </ul>
                    )}
            </Field>

            <Field icon={<MonitorSmartphone size={12} className="text-neutral-400" />} label="Used on screens">
                <ScreenRefs entry={entry} joinAvailable={joinAvailable} onNavigateToScreen={onNavigateToScreen} />
            </Field>

            <Field icon={<Keyboard size={12} className="text-neutral-400" />} label="Accessibility">
                <Accessibility a11y={component.accessibility} />
            </Field>

            {component.notes && (
                <Field icon={<Info size={12} className="text-neutral-400" />} label="Notes">
                    <p className="text-xs leading-relaxed text-neutral-700">{component.notes}</p>
                </Field>
            )}
        </article>
    );
}

function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
    return (
        <div className="mt-3 border-t border-neutral-100 pt-2.5">
            <div className="mb-1 flex items-center gap-1.5">
                {icon}
                <h5 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{label}</h5>
            </div>
            {children}
        </div>
    );
}

function ScreenRefs({ entry, joinAvailable, onNavigateToScreen }: {
    entry: ComponentInventoryEntry;
    joinAvailable: boolean;
    onNavigateToScreen?: (screenSlug: string) => void;
}) {
    if (!joinAvailable) {
        // No screen inventory was supplied — fall back to the component's own
        // raw `usedIn` names rather than claiming "not referenced".
        const usedIn = entry.component.usedIn ?? [];
        if (usedIn.length === 0) return <span className="text-xs text-neutral-400">Not specified.</span>;
        return (
            <div className="flex flex-wrap gap-1.5">
                {usedIn.map((name, i) => (
                    <span key={`${name}-${i}`} className="rounded-full bg-neutral-50 px-2 py-0.5 text-[11px] text-neutral-600 ring-1 ring-neutral-200">
                        {name}
                    </span>
                ))}
            </div>
        );
    }

    if (entry.screenRefs.length === 0 && entry.unresolvedUsedIn.length === 0) {
        return (
            <span className="text-xs text-neutral-400">
                No screen references this component (estimated from names).
            </span>
        );
    }

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {entry.screenRefs.map(ref => {
                const label = ref.confidence === 'partial' ? `${ref.screenName} (approximate match)` : ref.screenName;
                const title = ref.sources.includes('screen_contract')
                    ? 'This screen lists the component in its handoff contract'
                    : 'The component lists this screen under “Used in”';
                if (!onNavigateToScreen) {
                    return (
                        <span
                            key={ref.screenId}
                            title={title}
                            className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700 ring-1 ring-indigo-200"
                        >
                            {label}
                        </span>
                    );
                }
                return (
                    <button
                        key={ref.screenId}
                        type="button"
                        title={title}
                        onClick={() => onNavigateToScreen(ref.slug)}
                        className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-100"
                    >
                        <Link2 size={10} aria-hidden />
                        {label}
                    </button>
                );
            })}
            {entry.unresolvedUsedIn.map(name => (
                <span
                    key={`unresolved-${name}`}
                    title="Listed under “Used in” but no screen with that name exists in the screen inventory"
                    className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 ring-1 ring-amber-200"
                >
                    {name} · no matching screen
                </span>
            ))}
        </div>
    );
}

function Accessibility({ a11y }: { a11y?: ComponentA11y }) {
    const flags: string[] = [];
    if (a11y?.keyboard) flags.push('Keyboard');
    if (a11y?.focusManagement) flags.push('Focus management');
    if (a11y?.screenReader) flags.push('Screen reader');
    const aria = a11y?.aria ?? [];

    if (flags.length === 0 && aria.length === 0 && !a11y?.notes) {
        return (
            <span className="text-xs text-neutral-400">
                Not specified — this component has no recorded accessibility contract.
            </span>
        );
    }

    return (
        <div className="space-y-1.5">
            {flags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {flags.map(flag => (
                        <span key={flag} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 ring-1 ring-emerald-200">
                            {flag}
                        </span>
                    ))}
                </div>
            )}
            {aria.length > 0 && (
                <p className="text-xs text-neutral-700">
                    <span className="text-neutral-500">ARIA: </span>
                    {aria.map((token, i) => (
                        <span key={`${token}-${i}`}>
                            {i > 0 && ', '}
                            <code className="rounded bg-neutral-100 px-1 font-mono text-[11px]">{token}</code>
                        </span>
                    ))}
                </p>
            )}
            {a11y?.notes && <p className="text-xs leading-relaxed text-neutral-700">{a11y.notes}</p>}
        </div>
    );
}

/**
 * Advisory component/screen contradictions. Collapsed by default when there is
 * nothing review-severity to act on; never a gate, never alarming language.
 */
function ComponentAdvisories({ issues, onNavigateToScreen }: {
    issues: readonly ComponentReferenceIssue[];
    onNavigateToScreen?: (screenSlug: string) => void;
}) {
    const review = issues.filter(issue => issue.severity === 'review');
    const info = issues.filter(issue => issue.severity === 'info');
    const [open, setOpen] = useState(review.length > 0);

    return (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                aria-expanded={open}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 transition hover:bg-neutral-50"
            >
                <div className="flex min-w-0 items-center gap-2">
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${review.length > 0 ? 'bg-amber-50' : 'bg-neutral-100'}`}>
                        {review.length > 0
                            ? <AlertTriangle size={14} className="text-amber-600" />
                            : <Info size={14} className="text-neutral-400" />}
                    </div>
                    <div className="min-w-0 text-left">
                        <h3 className="text-sm font-semibold text-neutral-900">Component review notes</h3>
                        <p className="text-[11px] text-neutral-500">
                            {review.length > 0
                                ? `${review.length} screen reference${review.length === 1 ? '' : 's'} may benefit from review`
                                : `${info.length} note${info.length === 1 ? '' : 's'} for your information`}
                        </p>
                    </div>
                </div>
                {open ? <ChevronUp size={16} className="text-neutral-400" /> : <ChevronDown size={16} className="text-neutral-400" />}
            </button>

            {open && (
                <div className="space-y-3 border-t border-neutral-100 px-4 pb-4 pt-3">
                    {review.length > 0 && (
                        <IssueGroup title="Review recommended" tone="text-amber-700" issues={review} onNavigateToScreen={onNavigateToScreen} />
                    )}
                    {info.length > 0 && (
                        <IssueGroup title="For your information" tone="text-neutral-500" issues={info} onNavigateToScreen={onNavigateToScreen} />
                    )}
                    <p className="text-[11px] text-neutral-400">
                        Derived by comparing component and screen names across the two artifacts — advisory only, and it
                        never blocks generation or review.
                    </p>
                </div>
            )}
        </div>
    );
}

function IssueGroup({ title, tone, issues, onNavigateToScreen }: {
    title: string;
    tone: string;
    issues: readonly ComponentReferenceIssue[];
    onNavigateToScreen?: (screenSlug: string) => void;
}) {
    return (
        <div>
            <h4 className={`mb-1 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>{title}</h4>
            <ul className="space-y-1 text-xs text-neutral-700">
                {issues.map(issue => (
                    <li key={issue.key} className="flex gap-1.5">
                        <span className="select-none text-neutral-300">·</span>
                        <span className="min-w-0">
                            {issue.message}
                            {issue.screenSlug && onNavigateToScreen && (
                                <button
                                    type="button"
                                    onClick={() => onNavigateToScreen(issue.screenSlug!)}
                                    className="ml-1.5 font-medium text-indigo-600 underline-offset-2 hover:underline"
                                >
                                    Open screen
                                </button>
                            )}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
