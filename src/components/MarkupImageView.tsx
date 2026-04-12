import { useState } from 'react';
import { Layers, Plus, RefreshCcw, Download, AlertCircle, Loader2 } from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import { generateMarkupImage } from '../lib/llmProvider';
import { MarkupImageRenderer } from './MarkupImageRenderer';
import { GenerationProgress } from './GenerationProgress';
import { getMarkupImageStages } from './generationStages';
import type { StructuredPRD, MarkupImageSubtype, MarkupImageSpec } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface MarkupImageViewProps {
    projectId: string;
    spineVersionId: string;
    prdContent: string;
    structuredPRD?: StructuredPRD;
}

const MARKUP_IMAGE_TYPES: { subtype: MarkupImageSubtype; title: string; description: string }[] = [
    { subtype: 'critique_board', title: 'Critique Board', description: 'Visual design critique with annotated callouts and improvement suggestions' },
    { subtype: 'wireframe_callout', title: 'Wireframe Callout', description: 'Annotated wireframe layout with labeled components and flow arrows' },
    { subtype: 'flow_annotation', title: 'Flow Annotation', description: 'User flow diagram with numbered steps and decision points' },
    { subtype: 'screenshot_annotation', title: 'Screenshot Annotation', description: 'Annotated UI layout with numbered highlights and explanations' },
    { subtype: 'design_feedback', title: 'Design Feedback', description: 'Visual feedback board with constructive annotations' },
];

export function MarkupImageView({ projectId, spineVersionId, prdContent, structuredPRD }: MarkupImageViewProps) {
    const {
        createArtifact, createArtifactVersion,
        getArtifacts, getArtifactVersions,
    } = useProjectStore();

    const [generatingSubtype, setGeneratingSubtype] = useState<MarkupImageSubtype | null>(null);
    const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const markupArtifacts = getArtifacts(projectId, 'markup_image');

    const handleGenerate = async (subtype: MarkupImageSubtype) => {
        if (!structuredPRD) return;
        setError(null);
        setGeneratingSubtype(subtype);
        try {
            const spec = await generateMarkupImage(subtype, prdContent, structuredPRD);
            const meta = MARKUP_IMAGE_TYPES.find(t => t.subtype === subtype)!;

            const { artifactId } = createArtifact(projectId, 'markup_image', meta.title, undefined);

            createArtifactVersion(
                projectId, artifactId,
                JSON.stringify(spec),
                { subtype, markupImageSpec: true },
                [{ id: uuidv4(), sourceArtifactId: projectId, sourceArtifactVersionId: spineVersionId, sourceType: 'spine' }],
                `Generate ${meta.title} from PRD`,
            );

            setSelectedArtifactId(artifactId);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setGeneratingSubtype(null);
        }
    };

    const handleRegenerate = async (artifactId: string, subtype: MarkupImageSubtype) => {
        if (!structuredPRD) return;
        setError(null);
        setGeneratingSubtype(subtype);
        try {
            const spec = await generateMarkupImage(subtype, prdContent, structuredPRD);

            const versions = getArtifactVersions(projectId, artifactId);
            const parentVersionId = versions.length > 0 ? versions[versions.length - 1].id : null;

            createArtifactVersion(
                projectId, artifactId,
                JSON.stringify(spec),
                { subtype, markupImageSpec: true },
                [{ id: uuidv4(), sourceArtifactId: projectId, sourceArtifactVersionId: spineVersionId, sourceType: 'spine' }],
                `Regenerate ${subtype.replace(/_/g, ' ')}`,
                parentVersionId,
            );
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setGeneratingSubtype(null);
        }
    };

    const parseSpec = (content: string): MarkupImageSpec | null => {
        try {
            return JSON.parse(content) as MarkupImageSpec;
        } catch {
            return null;
        }
    };

    const handleExportSVG = (title: string) => {
        const svgEl = document.querySelector(`[data-markup-id="${title}"] svg`);
        if (!svgEl) return;
        const svgData = new XMLSerializer().serializeToString(svgEl);
        const blob = new Blob([svgData], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/\s+/g, '-').toLowerCase()}.svg`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Layers size={24} className="text-indigo-600" />
                    <h2 className="text-xl font-bold text-neutral-900">Markup Images</h2>
                    {markupArtifacts.length > 0 && (
                        <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full font-medium">
                            {markupArtifacts.length}
                        </span>
                    )}
                </div>
            </div>

            {!structuredPRD && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
                    Mark your PRD as Final to generate markup images.
                </div>
            )}

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex items-start gap-3">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <p className="font-medium mb-1">Markup generation failed</p>
                        <p>{error}</p>
                    </div>
                    <button type="button" onClick={() => setError(null)} className="shrink-0 text-red-400 hover:text-red-600 text-xs font-medium">&times;</button>
                </div>
            )}

            {/* Generate Buttons */}
            {structuredPRD && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {MARKUP_IMAGE_TYPES.map(meta => (
                        <button
                            key={meta.subtype}
                            onClick={() => handleGenerate(meta.subtype)}
                            disabled={!!generatingSubtype}
                            className="flex flex-col items-start gap-1 p-3 bg-white border border-neutral-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50/50 transition text-left disabled:opacity-50"
                        >
                            <div className="flex items-center gap-2">
                                <Plus size={14} className="text-indigo-500" />
                                <span className="text-sm font-medium text-neutral-800">{meta.title}</span>
                            </div>
                            <p className="text-xs text-neutral-500">{meta.description}</p>
                            {generatingSubtype === meta.subtype && (
                                <span className="text-xs text-indigo-500 flex items-center gap-1.5">
                                    <Loader2 size={10} className="animate-spin" />
                                    Working...
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            )}

            {/* Generation progress */}
            {generatingSubtype && (
                <div className="bg-white rounded-xl border border-neutral-200 p-5">
                    <GenerationProgress
                        stages={getMarkupImageStages(generatingSubtype)}

                        variant="creative"
                        title={`Creating ${MARKUP_IMAGE_TYPES.find(t => t.subtype === generatingSubtype)?.title || 'markup image'}`}
                    />
                </div>
            )}

            {/* Existing Markup Images */}
            {markupArtifacts.map(artifact => {
                const versions = getArtifactVersions(projectId, artifact.id);
                const preferredVersion = versions.find(v => v.isPreferred);
                const isSelected = selectedArtifactId === artifact.id;
                const spec = preferredVersion ? parseSpec(preferredVersion.content) : null;
                const subtype = (preferredVersion?.metadata?.subtype as MarkupImageSubtype) || 'critique_board';

                return (
                    <div key={artifact.id} className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
                        <button
                            onClick={() => setSelectedArtifactId(isSelected ? null : artifact.id)}
                            className="w-full flex items-center justify-between p-4 hover:bg-neutral-50/50 transition text-left"
                        >
                            <div className="flex items-center gap-3">
                                <Layers size={18} className="text-indigo-500" />
                                <span className="font-medium text-neutral-800">{artifact.title}</span>
                                <span className="text-xs text-neutral-400">
                                    {versions.length} version{versions.length !== 1 ? 's' : ''}
                                </span>
                            </div>
                            <span className="text-xs text-neutral-400">
                                {new Date(artifact.updatedAt).toLocaleDateString()}
                            </span>
                        </button>

                        {isSelected && spec && (
                            <div className="border-t border-neutral-100 p-4 space-y-4">
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleRegenerate(artifact.id, subtype)}
                                        disabled={!!generatingSubtype}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition disabled:opacity-50"
                                    >
                                        <RefreshCcw size={12} />
                                        Regenerate
                                    </button>
                                    <button
                                        onClick={() => handleExportSVG(artifact.title)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition"
                                    >
                                        <Download size={12} />
                                        Export SVG
                                    </button>
                                </div>

                                <div
                                    data-markup-id={artifact.title}
                                    className="bg-neutral-50 rounded-lg border border-neutral-200 p-4 overflow-auto"
                                >
                                    <MarkupImageRenderer spec={spec} />
                                </div>

                                {/* Legend from number markers */}
                                {spec.layers.filter(l => l.numberMarker).length > 0 && (
                                    <div className="bg-neutral-50 rounded-lg border border-neutral-200 p-4">
                                        <h4 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Legend</h4>
                                        <div className="space-y-1.5">
                                            {spec.layers
                                                .filter(l => l.numberMarker)
                                                .sort((a, b) => (a.numberMarker!.number - b.numberMarker!.number))
                                                .map(l => (
                                                    <div key={l.id} className="flex items-start gap-2 text-sm">
                                                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white shrink-0"
                                                            style={{ backgroundColor: l.style.color }}>
                                                            {l.numberMarker!.number}
                                                        </span>
                                                        <span className="text-neutral-700">{l.numberMarker!.description}</span>
                                                    </div>
                                                ))}
                                        </div>
                                    </div>
                                )}

                                <div className="text-xs text-neutral-400 pt-2 border-t border-neutral-100">
                                    v{preferredVersion?.versionNumber}
                                    {' · '}{preferredVersion && new Date(preferredVersion.createdAt).toLocaleString()}
                                    {' · '}{spec.canvas.width}x{spec.canvas.height}
                                    {' · '}{spec.layers.length} annotations
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
