import { useState } from 'react';
import { Box, FileText, Image as ImageIcon, ChevronDown, Sparkles } from 'lucide-react';
import { MODEL_CATALOG, modelDisplayName } from '../../lib/modelCatalog';
import { CORE_ARTIFACT_DISPLAY_ORDER } from '../../lib/coreArtifactPipeline';
import { CORE_ARTIFACT_COMPLEXITY } from '../../lib/artifactModelSettings';
import type { MockupImageMode } from '../../lib/artifactModelSettings';
import { DEFAULT_PRD_SECTIONS, selectModelTier } from '../../lib/services/progressivePrdGeneration';
import type { CoreArtifactSubtype } from '../../types';

interface ArtifactModelsSectionProps {
    /** Live Fast/Expert model ids from the PRD Generation Models pickers (unsaved edits included). */
    fastModel: string;
    strongModel: string;
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
                <div className="min-w-0">
                    <h4 className="text-sm font-bold text-white">{title}</h4>
                    <p className="text-[11px] text-neutral-400 leading-snug">{description}</p>
                </div>
            </div>
            <div className="space-y-2">
                {children}
                {badge && <div>{badge}</div>}
            </div>
        </div>
    );
}

export function ArtifactModelsSection({
    fastModel,
    strongModel,
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

    return (
        <div className="space-y-4">
            <div className="space-y-1">
                <label className="text-sm font-semibold text-neutral-300 flex items-center gap-2">
                    <Box size={14} className="text-indigo-400" />
                    Artifact Generation Models
                    <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        Recommended
                    </span>
                </label>
                <p className="text-[11px] text-neutral-500 leading-relaxed">
                    Choose the AI model for each type of artifact. By default we use Flash for
                    simple tasks and Pro for complex reasoning — override any of them here.
                </p>
            </div>

            <div className="space-y-3">
                {/* PRD — multi-model, expandable (configured in PRD Generation Models). */}
                <ArtifactRow
                    icon={<FileText size={18} />}
                    title="PRD"
                    description="Final product requirements document"
                    badge={
                        <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-300 border border-violet-500/30">
                            Multi
                        </span>
                    }
                >
                    <button
                        type="button"
                        onClick={() => setPrdExpanded((v) => !v)}
                        className={`${selectClass} flex items-center justify-between text-left`}
                        aria-expanded={prdExpanded}
                    >
                        <span className="text-neutral-300">Per-section routing (Flash / Pro)</span>
                        <ChevronDown
                            size={14}
                            className={`transition-transform ${prdExpanded ? 'rotate-180' : ''}`}
                        />
                    </button>
                    {prdExpanded && (
                        <div className="rounded-xl border border-white/5 bg-black/20 divide-y divide-white/5">
                            {DEFAULT_PRD_SECTIONS.map((section) => {
                                const tier = selectModelTier(section.risk);
                                const model = tier === 'fast' ? fastModel : strongModel;
                                return (
                                    <div
                                        key={section.id}
                                        className="flex items-center justify-between gap-2 px-3 py-2"
                                    >
                                        <span className="text-[11px] text-neutral-300 min-w-0 truncate">
                                            {section.title}
                                        </span>
                                        <span className="text-[11px] text-neutral-400 shrink-0">
                                            {modelDisplayName(model)}
                                        </span>
                                    </div>
                                );
                            })}
                            <p className="text-[10px] text-neutral-500 px-3 py-2">
                                PRD sections route automatically by complexity. Change the underlying
                                models in “PRD Generation Models” above.
                            </p>
                        </div>
                    )}
                </ArtifactRow>

                {/* Text artifacts — one model selector each. */}
                {CORE_ARTIFACT_DISPLAY_ORDER.map((meta) => {
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
