import { useState } from 'react';
import { Box, FileText, Image as ImageIcon, ChevronDown, Sparkles, Zap, Brain } from 'lucide-react';
import { MODEL_CATALOG, modelDisplayName } from '../../lib/modelCatalog';
import { CORE_ARTIFACT_DISPLAY_ORDER, isRetiredArtifactSubtype } from '../../lib/coreArtifactPipeline';
import { CORE_ARTIFACT_COMPLEXITY } from '../../lib/artifactModelSettings';
import type { MockupImageMode } from '../../lib/artifactModelSettings';
import { DEFAULT_PRD_SECTIONS, selectModelTier } from '../../lib/services/progressivePrdGeneration';
import type { CoreArtifactSubtype } from '../../types';

interface ArtifactModelsSectionProps {
    /**
     * Fast/Expert model ids used by the PRD per-section router. These are the
     * authoritative control for PRD generation (see the expandable PRD row) —
     * simple sections run on the Fast model, complex sections on the Expert
     * model. Editable here so there is ONE place that governs PRD models.
     */
    fastModel: string;
    strongModel: string;
    onFastModelChange: (modelId: string) => void;
    onStrongModelChange: (modelId: string) => void;
    /** Per-artifact model overrides (controlled). */
    overrides: Partial<Record<CoreArtifactSubtype, string>>;
    onOverridesChange: (next: Partial<Record<CoreArtifactSubtype, string>>) => void;
    /** Mockup image source mode (controlled). */
    mockupMode: MockupImageMode;
    onMockupModeChange: (mode: MockupImageMode) => void;
}

const selectClass =
    'w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-neutral-100 text-xs transition-all';

function ArtifactRow({
    icon,
    title,
    description,
    children,
    badge,
}: {
    icon: React.ReactNode;
    title: string;
    description: string;
    children: React.ReactNode;
    badge?: React.ReactNode;
}) {
    return (
        <div className="bg-white/5 border border-white/5 rounded-2xl p-4 space-y-3">
            <div className="flex items-start gap-3">
                <div className="text-neutral-400 mt-0.5 shrink-0">{icon}</div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-bold text-white">{title}</h4>
                        {badge}
                    </div>
                    <p className="text-[11px] text-neutral-400 leading-snug">{description}</p>
                </div>
            </div>
            <div className="space-y-2">{children}</div>
        </div>
    );
}

export function ArtifactModelsSection({
    fastModel,
    strongModel,
    onFastModelChange,
    onStrongModelChange,
    overrides,
    onOverridesChange,
    mockupMode,
    onMockupModeChange,
}: ArtifactModelsSectionProps) {
    const [prdExpanded, setPrdExpanded] = useState(false);

    const recommendedModel = (subtype: CoreArtifactSubtype): string =>
        CORE_ARTIFACT_COMPLEXITY[subtype] === 'high' ? strongModel : fastModel;

    const setOverride = (subtype: CoreArtifactSubtype, modelId: string) => {
        onOverridesChange({ ...overrides, [subtype]: modelId });
    };

    // Section routing split, computed from the live Fast/Expert selections so
    // the collapsed PRD summary always reflects the current models (and makes
    // clear PRD is NOT a single "Flash" model — simple vs complex sections
    // route differently).
    const fastSectionCount = DEFAULT_PRD_SECTIONS.filter((s) => selectModelTier(s.risk) === 'fast').length;
    const strongSectionCount = DEFAULT_PRD_SECTIONS.length - fastSectionCount;

    return (
        <div className="space-y-4">
            <div className="space-y-1">
                <label className="text-sm font-semibold text-neutral-300 flex items-center gap-2">
                    <Box size={14} className="text-indigo-400" />
                    Generation Models
                    <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        Recommended
                    </span>
                </label>
                <p className="text-[11px] text-neutral-500 leading-relaxed">
                    The AI model used for each thing Synapse generates. The PRD routes each section
                    automatically (simple sections on the Fast model, complex ones on the Expert
                    model); every other artifact uses a single model you can override.
                </p>
            </div>

            <div className="space-y-3">
                {/* PRD — multi-model. Expanding reveals the Fast/Expert controls
                    that govern the whole PRD run, plus a per-section preview so
                    it's transparent which model each section actually uses. */}
                <ArtifactRow
                    icon={<FileText size={18} />}
                    title="PRD"
                    description="Final product requirements document — generated section by section"
                    badge={
                        <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-300 border border-violet-500/30">
                            Per-section
                        </span>
                    }
                >
                    <button
                        type="button"
                        onClick={() => setPrdExpanded((v) => !v)}
                        className={`${selectClass} flex items-center justify-between text-left`}
                        aria-expanded={prdExpanded}
                    >
                        <span className="text-neutral-300 truncate min-w-0">
                            {fastSectionCount} simple → {modelDisplayName(fastModel)} · {strongSectionCount} complex → {modelDisplayName(strongModel)}
                        </span>
                        <ChevronDown
                            size={14}
                            className={`shrink-0 ml-2 transition-transform ${prdExpanded ? 'rotate-180' : ''}`}
                        />
                    </button>
                    {prdExpanded && (
                        <div className="space-y-3">
                            {/* Authoritative Fast/Expert controls for PRD generation. */}
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1.5">
                                    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-teal-400">
                                        <Zap size={11} />
                                        Fast model (Flash)
                                    </label>
                                    <select
                                        value={fastModel}
                                        onChange={(e) => onFastModelChange(e.target.value)}
                                        className={selectClass}
                                        aria-label="PRD fast (Flash) model"
                                    >
                                        {MODEL_CATALOG.map((m) => (
                                            <option key={m.id} value={m.id}>{m.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-400">
                                        <Brain size={11} />
                                        Expert model (Pro)
                                    </label>
                                    <select
                                        value={strongModel}
                                        onChange={(e) => onStrongModelChange(e.target.value)}
                                        className={selectClass}
                                        aria-label="PRD expert (Pro) model"
                                    >
                                        {MODEL_CATALOG.map((m) => (
                                            <option key={m.id} value={m.id}>{m.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Per-section preview: which model each section runs on. */}
                            <div className="rounded-xl border border-white/5 bg-black/20 divide-y divide-white/5">
                                {DEFAULT_PRD_SECTIONS.map((section) => {
                                    const tier = selectModelTier(section.risk);
                                    const model = tier === 'fast' ? fastModel : strongModel;
                                    const isFast = tier === 'fast';
                                    return (
                                        <div
                                            key={section.id}
                                            className="flex items-center justify-between gap-2 px-3 py-2"
                                        >
                                            <span className="text-[11px] text-neutral-300 min-w-0 truncate flex items-center gap-1.5">
                                                {isFast
                                                    ? <Zap size={10} className="text-teal-400 shrink-0" />
                                                    : <Brain size={10} className="text-indigo-400 shrink-0" />}
                                                {section.title}
                                            </span>
                                            <span className="text-[11px] text-neutral-400 shrink-0">
                                                {modelDisplayName(model)}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                            <p className="text-[10px] text-neutral-500 leading-relaxed">
                                Sections are routed by complexity — you can't override a single
                                section, but changing the Fast or Expert model above updates every
                                section on that tier. If you hit rate limits, set both to the same model.
                            </p>
                        </div>
                    )}
                </ArtifactRow>

                {/* Text artifacts — one model selector each. Retired subtypes
                    (prompt_pack, folded into the Implementation Plan) no longer
                    generate, so they get no model row. */}
                {CORE_ARTIFACT_DISPLAY_ORDER.filter((meta) => !isRetiredArtifactSubtype(meta.subtype)).map((meta) => {
                    const value = overrides[meta.subtype] ?? recommendedModel(meta.subtype);
                    return (
                        <ArtifactRow
                            key={meta.subtype}
                            icon={<Box size={18} />}
                            title={meta.title}
                            description={meta.description}
                        >
                            <select
                                value={value}
                                onChange={(e) => setOverride(meta.subtype, e.target.value)}
                                className={selectClass}
                                aria-label={`Model for ${meta.title}`}
                            >
                                {MODEL_CATALOG.map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.name}
                                    </option>
                                ))}
                            </select>
                        </ArtifactRow>
                    );
                })}

                {/* Mockups — image source, not a text model. */}
                <ArtifactRow
                    icon={<ImageIcon size={18} />}
                    title="Mockups"
                    description="Interactive UI mockups and prototypes"
                    badge={
                        <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30">
                            Image Source
                        </span>
                    }
                >
                    <select
                        value={mockupMode}
                        onChange={(e) => onMockupModeChange(e.target.value as MockupImageMode)}
                        className={selectClass}
                        aria-label="Mockup image source"
                    >
                        <option value="gpt_image">GPT Image 2</option>
                        <option value="user_uploaded">User Uploaded</option>
                    </select>
                    <p className="text-[10px] text-neutral-500 leading-relaxed">
                        GPT Image 2 needs an OpenAI key (added above). “User Uploaded” gives you a
                        per-screen prompt sheet to create and upload your own mockups. If no OpenAI
                        key is configured, Synapse falls back to the upload sheet automatically.
                    </p>
                </ArtifactRow>
            </div>

            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl p-4 flex items-start gap-3">
                <Sparkles size={16} className="text-indigo-300 mt-0.5 shrink-0" />
                <div>
                    <p className="text-xs font-bold text-indigo-200 mb-0.5">Smart Model Routing</p>
                    <p className="text-[11px] text-indigo-200/70 leading-relaxed">
                        Defaults pick the best model for each artifact based on complexity, balancing
                        accuracy against cost. Your overrides above always take precedence.
                    </p>
                </div>
            </div>
        </div>
    );
}
