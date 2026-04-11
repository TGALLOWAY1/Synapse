import { useState } from 'react';
import { Image, Plus, GitCompare, MessageSquarePlus } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useProjectStore } from '../store/projectStore';
import { generateMockup } from '../lib/llmProvider';
import { StalenessBadge } from './StalenessBadge';
import { FeedbackModal } from './FeedbackModal';
import { MockupViewer } from './mockups/MockupViewer';
import type {
    StructuredPRD,
    MockupSettings,
    MockupPlatform,
    MockupFidelity,
    MockupScope,
    MockupPayload,
    ArtifactVersion,
    StalenessState,
} from '../types';
import { MOCKUP_HTML_V1 } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface MockupsViewProps {
    projectId: string;
    spineVersionId: string;
    prdContent: string;
    structuredPRD?: StructuredPRD;
}

const PLATFORM_OPTIONS: { value: MockupPlatform; label: string }[] = [
    { value: 'desktop', label: 'Desktop' },
    { value: 'mobile', label: 'Mobile' },
    { value: 'responsive', label: 'Responsive' },
];

const FIDELITY_OPTIONS: { value: MockupFidelity; label: string }[] = [
    { value: 'low', label: 'Low-fi (Wireframe)' },
    { value: 'mid', label: 'Mid-fi (Structured)' },
    { value: 'high', label: 'High-fi (Polished)' },
];

const SCOPE_OPTIONS: { value: MockupScope; label: string }[] = [
    { value: 'key_workflow', label: 'Key Workflow' },
    { value: 'multi_screen', label: 'Multiple Screens' },
    { value: 'single_screen', label: 'Single Screen' },
];

// Safely extract a MockupPayload from an ArtifactVersion. Returns null for
// legacy markdown versions or unparseable content — callers fall back to the
// legacy markdown renderer.
const tryParsePayload = (version: ArtifactVersion): MockupPayload | null => {
    const format = (version.metadata as { format?: string } | undefined)?.format;
    if (format !== MOCKUP_HTML_V1) return null;
    try {
        const parsed = JSON.parse(version.content) as MockupPayload;
        if (!parsed?.screens?.length) return null;
        return parsed;
    } catch {
        return null;
    }
};

export function MockupsView({ projectId, spineVersionId, prdContent, structuredPRD }: MockupsViewProps) {
    const {
        createArtifact, createArtifactVersion,
        getArtifacts, getArtifactVersions, setPreferredVersion,
        getArtifactStaleness,
    } = useProjectStore();

    const [isGenerating, setIsGenerating] = useState(false);
    const [showGeneratePanel, setShowGeneratePanel] = useState(false);
    const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
    const [compareMode, setCompareMode] = useState(false);
    const [compareVersions, setCompareVersions] = useState<[string | null, string | null]>([null, null]);
    const [feedbackVersionId, setFeedbackVersionId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Settings
    const [platform, setPlatform] = useState<MockupPlatform>('desktop');
    const [fidelity, setFidelity] = useState<MockupFidelity>('mid');
    const [scope, setScope] = useState<MockupScope>('key_workflow');
    const [style, setStyle] = useState('');
    const [notes, setNotes] = useState('');

    const mockupArtifacts = getArtifacts(projectId, 'mockup');

    const handleGenerate = async () => {
        setError(null);
        setIsGenerating(true);
        try {
            const settings: MockupSettings = {
                platform, fidelity, scope,
                style: style || undefined,
                notes: notes || undefined,
            };

            const payload = await generateMockup(prdContent, settings, structuredPRD);

            const title = payload.title?.trim()
                || `Mockup — ${platform} / ${fidelity} / ${scope.replace('_', ' ')}`;
            const { artifactId } = createArtifact(projectId, 'mockup', title);

            createArtifactVersion(
                projectId,
                artifactId,
                JSON.stringify(payload),
                { settings, format: MOCKUP_HTML_V1 },
                [{
                    id: uuidv4(),
                    sourceArtifactId: projectId,
                    sourceArtifactVersionId: spineVersionId,
                    sourceType: 'spine',
                }],
                `Generate ${fidelity} ${platform} mockup for ${scope.replace('_', ' ')}`,
            );

            setSelectedArtifactId(artifactId);
            setShowGeneratePanel(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setIsGenerating(false);
        }
    };

    const handleRegenerate = async (artifactId: string) => {
        setError(null);
        setIsGenerating(true);
        try {
            const versions = getArtifactVersions(projectId, artifactId);
            const latestVersion = versions[versions.length - 1];
            const settings = (latestVersion?.metadata?.settings as MockupSettings) || {
                platform: 'desktop', fidelity: 'mid', scope: 'key_workflow'
            };

            const payload = await generateMockup(prdContent, settings, structuredPRD);

            createArtifactVersion(
                projectId,
                artifactId,
                JSON.stringify(payload),
                { settings, format: MOCKUP_HTML_V1 },
                [{
                    id: uuidv4(),
                    sourceArtifactId: projectId,
                    sourceArtifactVersionId: spineVersionId,
                    sourceType: 'spine',
                }],
                `Regenerate mockup from updated PRD`,
                latestVersion?.id,
            );
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setIsGenerating(false);
        }
    };

    // --- Rendering helpers ---

    const renderVersionActions = (
        artifactId: string,
        preferred: ArtifactVersion,
        allVersions: ArtifactVersion[],
    ) => (
        <>
            <button
                type="button"
                onClick={() => handleRegenerate(artifactId)}
                disabled={isGenerating}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition disabled:opacity-50"
            >
                {isGenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
            <button
                type="button"
                onClick={() => { setCompareMode(!compareMode); setCompareVersions([null, null]); }}
                disabled={allVersions.length < 2}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition disabled:opacity-50"
            >
                <GitCompare size={12} />
                Compare
            </button>
            <button
                type="button"
                onClick={() => setFeedbackVersionId(preferred.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-md transition"
            >
                <MessageSquarePlus size={12} />
                Extract Feedback
            </button>
            {allVersions.length > 1 && (
                <select
                    value={preferred.id}
                    onChange={e => setPreferredVersion(projectId, artifactId, e.target.value)}
                    className="ml-auto px-2 py-1 text-xs border border-neutral-200 rounded-md bg-white"
                >
                    {allVersions.map(v => (
                        <option key={v.id} value={v.id}>
                            v{v.versionNumber}{v.isPreferred ? ' (preferred)' : ''}
                        </option>
                    ))}
                </select>
            )}
        </>
    );

    const renderVersionBody = (
        version: ArtifactVersion,
        staleness: StalenessState,
        actions: React.ReactNode,
    ) => {
        const payload = tryParsePayload(version);
        if (payload) {
            const settings = (version.metadata?.settings as MockupSettings) || {
                platform: 'desktop', fidelity: 'mid', scope: 'key_workflow',
            };
            const sourceSpineVersionId = version.sourceRefs.find(r => r.sourceType === 'spine')?.sourceArtifactVersionId;
            return (
                <MockupViewer
                    payload={payload}
                    settings={settings}
                    staleness={staleness}
                    versionNumber={version.versionNumber}
                    createdAt={version.createdAt}
                    sourceSpineVersionId={sourceSpineVersionId}
                    actions={actions}
                />
            );
        }

        // Legacy markdown fallback — renders old ASCII mockups so existing
        // projects continue to work until they are regenerated.
        return (
            <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
                <div className="px-5 pt-4 flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700 font-medium">
                        Legacy mockup
                    </span>
                    <StalenessBadge staleness={staleness} />
                    <span className="text-[10px] text-neutral-400 ml-auto">
                        v{version.versionNumber}
                    </span>
                </div>
                <div className="px-5 py-4 prose prose-sm prose-neutral max-w-none overflow-auto max-h-[600px]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{version.content}</ReactMarkdown>
                </div>
                <div className="px-5 py-3 border-t border-neutral-100 bg-neutral-50/40 flex items-center gap-2 flex-wrap">
                    {actions}
                </div>
            </div>
        );
    };

    const renderCompareView = () => {
        if (!selectedArtifactId) return null;
        const versions = getArtifactVersions(projectId, selectedArtifactId);
        const staleness = getArtifactStaleness(projectId, selectedArtifactId);
        const vA = versions.find(v => v.id === compareVersions[0]);
        const vB = versions.find(v => v.id === compareVersions[1]);

        const renderSide = (v: ArtifactVersion | undefined) => {
            if (!v) return <div className="text-neutral-400 text-sm italic">Select a version</div>;
            const payload = tryParsePayload(v);
            if (payload) {
                const settings = (v.metadata?.settings as MockupSettings) || {
                    platform: 'desktop', fidelity: 'mid', scope: 'key_workflow',
                };
                return (
                    <MockupViewer
                        payload={payload}
                        settings={settings}
                        staleness={staleness}
                        versionNumber={v.versionNumber}
                        createdAt={v.createdAt}
                        sourceSpineVersionId={v.sourceRefs.find(r => r.sourceType === 'spine')?.sourceArtifactVersionId}
                    />
                );
            }
            return (
                <div className="bg-white rounded-xl border border-neutral-200 p-5 prose prose-sm prose-neutral max-w-none overflow-auto max-h-[600px]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{v.content}</ReactMarkdown>
                </div>
            );
        };

        return (
            <div className="space-y-4">
                <div className="flex items-center gap-4">
                    <select
                        value={compareVersions[0] || ''}
                        onChange={e => setCompareVersions([e.target.value || null, compareVersions[1]])}
                        className="flex-1 px-3 py-2 border border-neutral-300 rounded-lg text-sm bg-white"
                    >
                        <option value="">Select version A</option>
                        {versions.map(v => (
                            <option key={v.id} value={v.id}>v{v.versionNumber}{v.isPreferred ? ' (preferred)' : ''}</option>
                        ))}
                    </select>
                    <span className="text-neutral-400 text-sm">vs</span>
                    <select
                        value={compareVersions[1] || ''}
                        onChange={e => setCompareVersions([compareVersions[0], e.target.value || null])}
                        className="flex-1 px-3 py-2 border border-neutral-300 rounded-lg text-sm bg-white"
                    >
                        <option value="">Select version B</option>
                        {versions.map(v => (
                            <option key={v.id} value={v.id}>v{v.versionNumber}{v.isPreferred ? ' (preferred)' : ''}</option>
                        ))}
                    </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <h4 className="text-xs font-bold text-neutral-500 uppercase mb-2">Version A {vA ? `(v${vA.versionNumber})` : ''}</h4>
                        {renderSide(vA)}
                    </div>
                    <div>
                        <h4 className="text-xs font-bold text-neutral-500 uppercase mb-2">Version B {vB ? `(v${vB.versionNumber})` : ''}</h4>
                        {renderSide(vB)}
                    </div>
                </div>
            </div>
        );
    };

    const renderGeneratingSkeleton = () => (
        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden animate-pulse">
            <div className="px-5 pt-5 pb-4 border-b border-neutral-100">
                <div className="h-5 bg-neutral-200 rounded w-1/3 mb-2" />
                <div className="h-3 bg-neutral-100 rounded w-2/3" />
            </div>
            <div className="px-5 pt-4 pb-2 flex items-center gap-2">
                <div className="h-6 w-24 bg-neutral-100 rounded-full" />
                <div className="h-6 w-24 bg-neutral-100 rounded-full" />
            </div>
            <div className="px-5 pb-5">
                <div className="h-[480px] bg-neutral-100 rounded-lg" />
            </div>
        </div>
    );

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Image size={24} className="text-indigo-600" />
                    <h2 className="text-xl font-bold text-neutral-900">Mockups</h2>
                    {mockupArtifacts.length > 0 && (
                        <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full font-medium">
                            {mockupArtifacts.length}
                        </span>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => setShowGeneratePanel(!showGeneratePanel)}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
                >
                    <Plus size={16} />
                    Generate Mockup
                </button>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
                    {error}
                </div>
            )}

            {/* Generate Panel */}
            {showGeneratePanel && (
                <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-6 space-y-5">
                    <h3 className="text-sm font-bold text-neutral-700 uppercase tracking-wider">Generation Settings</h3>

                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 mb-1.5">Platform</label>
                            {PLATFORM_OPTIONS.map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setPlatform(opt.value)}
                                    className={`block w-full text-left px-3 py-2 text-sm rounded-md mb-1 transition ${
                                        platform === opt.value
                                            ? 'bg-indigo-50 text-indigo-700 font-medium border border-indigo-200'
                                            : 'text-neutral-600 hover:bg-neutral-50 border border-transparent'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 mb-1.5">Fidelity</label>
                            {FIDELITY_OPTIONS.map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setFidelity(opt.value)}
                                    className={`block w-full text-left px-3 py-2 text-sm rounded-md mb-1 transition ${
                                        fidelity === opt.value
                                            ? 'bg-indigo-50 text-indigo-700 font-medium border border-indigo-200'
                                            : 'text-neutral-600 hover:bg-neutral-50 border border-transparent'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 mb-1.5">Scope</label>
                            {SCOPE_OPTIONS.map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setScope(opt.value)}
                                    className={`block w-full text-left px-3 py-2 text-sm rounded-md mb-1 transition ${
                                        scope === opt.value
                                            ? 'bg-indigo-50 text-indigo-700 font-medium border border-indigo-200'
                                            : 'text-neutral-600 hover:bg-neutral-50 border border-transparent'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-neutral-500 mb-1.5">Style Direction (optional)</label>
                        <input
                            type="text"
                            value={style}
                            onChange={e => setStyle(e.target.value)}
                            placeholder="e.g. minimal, dashboard-style, dark theme..."
                            className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-neutral-500 mb-1.5">Notes / Emphasis (optional)</label>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="Any specific areas to emphasize or constraints..."
                            rows={2}
                            className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                        />
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                        <button
                            type="button"
                            onClick={handleGenerate}
                            disabled={isGenerating}
                            className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50"
                        >
                            {isGenerating ? 'Generating...' : 'Generate'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowGeneratePanel(false)}
                            className="px-4 py-2 text-neutral-500 hover:text-neutral-700 text-sm transition"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Loading skeleton when generating the first mockup */}
            {isGenerating && mockupArtifacts.length === 0 && renderGeneratingSkeleton()}

            {/* Mockup List */}
            {mockupArtifacts.length === 0 && !showGeneratePanel && !isGenerating ? (
                <div className="text-center py-16 text-neutral-400">
                    <Image size={48} className="mx-auto mb-4 opacity-30" />
                    <p className="text-lg font-medium text-neutral-500 mb-2">No mockups yet</p>
                    <p className="text-sm max-w-md mx-auto">
                        Generate polished UI concepts grounded in your PRD. Each run produces a rendered HTML preview you can navigate screen-by-screen.
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {mockupArtifacts.map(artifact => {
                        const versions = getArtifactVersions(projectId, artifact.id);
                        const preferredVersion = versions.find(v => v.isPreferred);
                        const staleness = getArtifactStaleness(projectId, artifact.id);
                        const isSelected = selectedArtifactId === artifact.id;

                        return (
                            <div key={artifact.id} className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
                                {/* Card Header */}
                                <button
                                    type="button"
                                    onClick={() => setSelectedArtifactId(isSelected ? null : artifact.id)}
                                    className="w-full flex items-center justify-between p-4 hover:bg-neutral-50/50 transition text-left"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <Image size={18} className="text-indigo-500 shrink-0" />
                                        <span className="font-medium text-neutral-800 truncate">{artifact.title}</span>
                                        <StalenessBadge staleness={staleness} />
                                        <span className="text-xs text-neutral-400">
                                            {versions.length} version{versions.length !== 1 ? 's' : ''}
                                        </span>
                                    </div>
                                    <span className="text-xs text-neutral-400 shrink-0">
                                        {new Date(artifact.updatedAt).toLocaleDateString()}
                                    </span>
                                </button>

                                {/* Expanded Detail */}
                                {isSelected && preferredVersion && (
                                    <div className="border-t border-neutral-100 p-4">
                                        {compareMode ? (
                                            renderCompareView()
                                        ) : (
                                            renderVersionBody(
                                                preferredVersion,
                                                staleness,
                                                renderVersionActions(artifact.id, preferredVersion, versions),
                                            )
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Feedback Modal */}
            {feedbackVersionId && (
                <FeedbackModal
                    projectId={projectId}
                    sourceArtifactVersionId={feedbackVersionId}
                    onClose={() => setFeedbackVersionId(null)}
                />
            )}
        </div>
    );
}
