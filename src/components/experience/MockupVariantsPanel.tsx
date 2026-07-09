// Phase 3A: the redesigned Mockups tab for a single screen. Presents the
// screen's mockups as a viewport × state VARIANT grid (see
// src/lib/mockupVariants.ts) instead of a lone image preview:
//   - a summary row (generated / missing / coverage),
//   - a selectable variant gallery (generated vs. missing, visually distinct),
//   - a selected-variant detail panel (preview, status, metadata, coverage),
//   - a spec-coverage panel for the generated mockup.
//
// Everything is derived + read-time. The single generated image still renders
// through the existing MockupScreenImage (its generate / upload / regenerate
// actions are untouched). Missing variants are honest placeholders — Phase 3A
// introduces NO per-variant generation, so no dead "Generate variant" button
// is shown. Status is tracked from generated metadata + the user's overlay,
// never from inspecting pixels, and the copy says so.

import { useMemo, useState } from 'react';
import {
    CheckCircle2, ImageOff, Info, Layers, Monitor, Smartphone, Tablet,
} from 'lucide-react';
import type { MockupPlatform } from '../../types';
import {
    COVERAGE_STATUS_LABELS,
    VARIANT_STATUS_LABELS,
    formatVariantLabel,
    type DerivedMockupVariant,
    type MockupVariantStatus,
    type MockupViewport,
    type ScreenMockupVariantSummary,
} from '../../lib/mockupVariants';
import { buildMockupSpecCoverage } from '../../lib/screenReadiness';
import type { ScreenExperienceItem } from '../../lib/screenExperience';
import { MockupScreenImage } from '../mockups/MockupScreenImage';
import type { ScreenDetailMockupContext } from './ScreenDetailView';

const VIEWPORT_ICON: Record<MockupViewport, typeof Monitor> = {
    desktop: Monitor,
    mobile: Smartphone,
    tablet: Tablet,
};

const STATUS_PILL: Record<MockupVariantStatus, string> = {
    generated: 'text-emerald-700 bg-emerald-50 ring-emerald-200',
    missing: 'text-amber-700 bg-amber-50 ring-amber-200',
    accepted: 'text-sky-700 bg-sky-50 ring-sky-200',
    not_needed: 'text-neutral-500 bg-neutral-100 ring-neutral-200',
};

const COVERAGE_TONE: Record<DerivedMockupVariant['coverageStatus'], string> = {
    aligned: 'text-emerald-700',
    partial: 'text-amber-700',
    missing_items: 'text-amber-700',
    unknown: 'text-neutral-500',
};

const PLATFORM_LABELS: Record<MockupPlatform, string> = {
    mobile: 'Mobile',
    desktop: 'Desktop',
    responsive: 'Responsive',
};

interface Props {
    item: ScreenExperienceItem;
    variants: DerivedMockupVariant[];
    summary: ScreenMockupVariantSummary;
    mockupContext: ScreenDetailMockupContext;
    /** Persists a per-variant status onto the screen edit overlay (null clears
     * it back to the tracked/derived status). */
    onSetVariantStatus?: (variantId: string, status: 'accepted' | 'not_needed' | null) => void;
}

/** The variant that holds the single generated image (primary Default). The
 * image renders whenever a mockup exists for this screen — even after the user
 * marks the default "accepted" (which flips status off 'generated'). */
const holdsGeneratedImage = (v: DerivedMockupVariant, hasMockup: boolean): boolean =>
    v.id === 'default' && hasMockup;

export function MockupVariantsPanel({
    item, variants, summary, mockupContext, onSetVariantStatus,
}: Props) {
    const [selectedId, setSelectedId] = useState<string>(() => {
        const generated = variants.find(v => v.status === 'generated');
        return (generated ?? variants[0])?.id ?? 'default';
    });
    const selected = variants.find(v => v.id === selectedId) ?? variants[0];

    const specCoverage = useMemo(
        () => buildMockupSpecCoverage(item.baseScreen, item.mockupScreen?.coreUIElements),
        [item.baseScreen, item.mockupScreen],
    );

    const summaryParts: string[] = [
        `${summary.generated} of ${summary.recommended} recommended ${summary.recommended === 1 ? 'variant' : 'variants'} generated`,
    ];
    if (summary.missing > 0) summaryParts.push(`${summary.missing} missing`);
    if (summary.coverageUnknown) summaryParts.push('coverage unknown for legacy mockup');

    return (
        <div className="space-y-3">
            {/* Header + summary */}
            <div>
                <h3 className="text-sm font-semibold text-neutral-900">Mockups</h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                    Generated product screen previews mapped to this screen&rsquo;s states and viewports.
                </p>
                <p className="mt-1.5 text-[11px] text-neutral-500">{summaryParts.join(' · ')}</p>
            </div>

            {/* Variant gallery — pills, selectable */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {variants.map(v => (
                    <VariantCard
                        key={v.id}
                        variant={v}
                        selected={v.id === selected?.id}
                        onSelect={() => setSelectedId(v.id)}
                    />
                ))}
            </div>

            {/* Selected variant detail */}
            {selected && (
                <VariantDetail
                    variant={selected}
                    item={item}
                    mockupContext={mockupContext}
                    specCoverage={specCoverage}
                    onSetVariantStatus={onSetVariantStatus}
                />
            )}
        </div>
    );
}

function VariantCard({
    variant, selected, onSelect,
}: {
    variant: DerivedMockupVariant;
    selected: boolean;
    onSelect: () => void;
}) {
    const Icon = VIEWPORT_ICON[variant.viewport];
    const generated = variant.status === 'generated' || variant.status === 'accepted';
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            className={`text-left rounded-lg border p-3 transition ${
                selected
                    ? 'border-indigo-400 ring-1 ring-indigo-200 bg-indigo-50/40'
                    : 'border-neutral-200 bg-white hover:border-indigo-300'
            }`}
        >
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                    <Icon size={13} className={generated ? 'text-emerald-500' : 'text-neutral-400'} aria-hidden />
                    <span className="text-xs font-medium text-neutral-800 truncate">
                        {formatVariantLabel(variant)}
                    </span>
                </div>
                <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ring-1 ${STATUS_PILL[variant.status]}`}>
                    {VARIANT_STATUS_LABELS[variant.status]}
                </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[10px]">
                {variant.required && variant.status === 'missing' && variant.id !== 'default' && (
                    <span className="uppercase tracking-wide text-violet-700 bg-violet-50 ring-1 ring-violet-100 px-1.5 py-px rounded">
                        Recommended
                    </span>
                )}
                {variant.status === 'generated' && (
                    <span className={COVERAGE_TONE[variant.coverageStatus]}>
                        Coverage: {COVERAGE_STATUS_LABELS[variant.coverageStatus].toLowerCase()}
                    </span>
                )}
                {variant.status === 'missing' && (
                    <span className="text-neutral-400">Not generated yet</span>
                )}
            </div>
        </button>
    );
}

function VariantDetail({
    variant, item, mockupContext, specCoverage, onSetVariantStatus,
}: {
    variant: DerivedMockupVariant;
    item: ScreenExperienceItem;
    mockupContext: ScreenDetailMockupContext;
    specCoverage: ReturnType<typeof buildMockupSpecCoverage>;
    onSetVariantStatus?: (variantId: string, status: 'accepted' | 'not_needed' | null) => void;
}) {
    const primaryGenerated = holdsGeneratedImage(variant, Boolean(item.mockupScreen));
    const metaParts = [
        PLATFORM_LABELS[mockupContext.settings.platform],
        mockupContext.prdVersionLabel ? `Generated from PRD ${mockupContext.prdVersionLabel}` : null,
        mockupContext.versionNumber ? `Mockup v${mockupContext.versionNumber}` : null,
    ].filter(Boolean);

    return (
        <div className="bg-white rounded-xl border border-neutral-200 p-4 space-y-3">
            <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-neutral-900">{formatVariantLabel(variant)}</h4>
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                        Status: {VARIANT_STATUS_LABELS[variant.status]}
                        {variant.userSet && ' (set by you)'}
                        {variant.status === 'generated' && variant.source === 'legacy' && ' · Source: existing mockup'}
                    </p>
                </div>
                <VariantActions variant={variant} onSetVariantStatus={onSetVariantStatus} />
            </div>

            {/* Preview */}
            {primaryGenerated ? (
                <div className="space-y-2">
                    <div className="rounded-lg border border-neutral-200 overflow-hidden">
                        <MockupScreenImage
                            projectId={mockupContext.projectId}
                            artifactId={mockupContext.artifactId}
                            versionId={mockupContext.versionId}
                            screen={item.mockupScreen!}
                            payload={mockupContext.payload}
                            settings={mockupContext.settings}
                        />
                    </div>
                    {metaParts.length > 0 && (
                        <p className="text-[11px] text-neutral-400">{metaParts.join(' · ')}</p>
                    )}
                </div>
            ) : variant.status === 'missing' ? (
                <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50/60 p-6 text-center">
                    <ImageOff size={18} className="text-neutral-300 mx-auto mb-2" aria-hidden />
                    <p className="text-xs font-medium text-neutral-700">
                        No mockup for {formatVariantLabel(variant)} yet.
                    </p>
                    <p className="text-[11px] text-neutral-500 mt-1 max-w-sm mx-auto">
                        {variant.notes[0] ?? 'Recommended for this screen.'}
                    </p>
                    <p className="text-[11px] text-neutral-400 mt-2">
                        Per-variant generation lands in Phase 3B. For now, regenerate the full mockup
                        or upload an image and mark this variant accepted.
                    </p>
                </div>
            ) : (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-4 text-center">
                    <p className="text-xs text-neutral-600">
                        {variant.status === 'accepted'
                            ? 'You marked this variant accepted — no generated preview is stored in Synapse for it.'
                            : 'This variant is marked not needed.'}
                    </p>
                </div>
            )}

            {/* Spec coverage — only for the variant that holds the real image. */}
            <SpecCoverageSection show={primaryGenerated} specCoverage={specCoverage} />

            {/* Notes */}
            {variant.notes.length > 0 && variant.status !== 'missing' && (
                <ul className="space-y-1">
                    {variant.notes.map((note, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[11px] text-neutral-500">
                            <Info size={11} className="mt-0.5 shrink-0 text-neutral-400" aria-hidden />
                            <span>{note}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function SpecCoverageSection({
    show, specCoverage,
}: {
    show: boolean;
    specCoverage: ReturnType<typeof buildMockupSpecCoverage>;
}) {
    // Coverage is only meaningful for the variant that holds the real image;
    // other variants show the honest "unknown" state rather than a fabricated grid.
    if (!show) return null;
    return (
        <div className="rounded-lg border border-neutral-200 p-3">
            <div className="flex items-center gap-1.5 mb-2">
                <Layers size={12} className="text-neutral-400" aria-hidden />
                <h5 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    Spec coverage
                </h5>
            </div>
            {specCoverage.length === 0 ? (
                <div className="text-[11px] text-neutral-500 space-y-1">
                    <p className="font-medium text-neutral-600">Coverage unknown</p>
                    <p>
                        This mockup was generated before coverage metadata was recorded. It may still
                        be useful visually, but Synapse cannot confirm which screen-spec items are
                        represented.
                    </p>
                    <p className="text-neutral-400">
                        UI Regions · Required States · User Actions · Acceptance Criteria — Not checked.
                    </p>
                </div>
            ) : (
                <>
                    <ul className="space-y-1 text-xs">
                        {specCoverage.map((row, i) => (
                            <li key={i} className="flex items-center justify-between gap-2">
                                <span className="text-neutral-700">{row.element}</span>
                                {row.status === 'in_spec' ? (
                                    <span className="text-emerald-700 font-medium">In mockup spec</span>
                                ) : (
                                    <span className="text-amber-700">Not in mockup spec</span>
                                )}
                            </li>
                        ))}
                    </ul>
                    <p className="text-[11px] text-neutral-400 mt-2">
                        Compared against the mockup&rsquo;s generation spec, not the rendered image —
                        treat &ldquo;Not in mockup spec&rdquo; as a prompt to double-check the visual.
                    </p>
                </>
            )}
        </div>
    );
}

function VariantActions({
    variant, onSetVariantStatus,
}: {
    variant: DerivedMockupVariant;
    onSetVariantStatus?: (variantId: string, status: 'accepted' | 'not_needed' | null) => void;
}) {
    if (!onSetVariantStatus) return null;
    const btn = 'text-[10px] px-2 py-0.5 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-700 transition';
    if (variant.userSet) {
        return (
            <button
                type="button"
                onClick={() => onSetVariantStatus(variant.id, null)}
                className="text-[10px] text-neutral-500 hover:text-neutral-700 underline decoration-dotted shrink-0"
            >
                Undo
            </button>
        );
    }
    if (variant.status === 'generated') {
        return (
            <button
                type="button"
                onClick={() => onSetVariantStatus(variant.id, 'accepted')}
                className={`${btn} shrink-0 inline-flex items-center gap-1`}
                title="Confirm this variant looks good"
            >
                <CheckCircle2 size={11} aria-hidden /> Mark accepted
            </button>
        );
    }
    if (variant.status === 'missing') {
        return (
            <div className="flex items-center gap-1.5 shrink-0">
                <button
                    type="button"
                    onClick={() => onSetVariantStatus(variant.id, 'accepted')}
                    className={btn}
                    title="Confirm this variant is covered — e.g. you uploaded or verified it outside the generated set"
                >
                    Mark accepted
                </button>
                <button
                    type="button"
                    onClick={() => onSetVariantStatus(variant.id, 'not_needed')}
                    className={btn}
                    title="Skip this recommended variant"
                >
                    Not needed
                </button>
            </div>
        );
    }
    return null;
}
