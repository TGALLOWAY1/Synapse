import { useState } from 'react';
import { Image, Plus, GitCompare, MessageSquarePlus, RefreshCw, Sparkles, Monitor, Smartphone, Columns3, Loader2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useProjectStore } from '../store/projectStore';
import { generateMockup } from '../lib/llmProvider';
import { normalizeError, userMessage } from '../lib/errors';
import { ErrorBanner } from './ErrorBanner';
import { StalenessBadge } from './StalenessBadge';
import { FeedbackModal } from './FeedbackModal';
import { MockupViewer } from './mockups/MockupViewer';
import { MockupErrorBoundary } from './mockups/MockupErrorBoundary';
import { GenerationProgress } from './GenerationProgress';
import { MOCKUP_GENERATION_STAGES } from './generationStages';
import type {
    StructuredPRD,
    MockupSettings,
    MockupPlatform,
    MockupFidelity,
    MockupScope,
    MockupPayload,
    MockupScreen,
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

const PLATFORM_OPTIONS: { value: MockupPlatform; label: string; desc: string; icon: typeof Monitor }[] = [
    { value: 'desktop', label: 'Desktop', desc: '1440px with sidebar', icon: Monitor },
    { value: 'mobile', label: 'Mobile', desc: '390px single-column', icon: Smartphone },
    { value: 'responsive', label: 'Responsive', desc: 'Desktop-first, adaptive', icon: Columns3 },
];

const FIDELITY_OPTIONS: { value: MockupFidelity; label: string; desc: string }[] = [
    { value: 'low', label: 'Wireframe', desc: 'Structural layout with neutral palette' },
    { value: 'mid', label: 'Structured', desc: 'Real copy, data tables, stat tiles' },
    { value: 'high', label: 'Polished', desc: 'Production-ready visual fidelity' },
];

const SCOPE_OPTIONS: { value: MockupScope; label: string; desc: string }[] = [
    { value: 'key_workflow', label: 'Key Workflow', desc: '3–5 screens forming a user journey' },
    { value: 'multi_screen', label: 'Multiple Screens', desc: '3–4 screens across the core experience' },
    { value: 'single_screen', label: 'Single Screen', desc: 'One high-value screen in depth' },
];

const STYLE_PRESETS: { label: string; value: string }[] = [
    { label: 'Minimal', value: 'minimal, clean whitespace, simple typography' },
    { label: 'Dashboard', value: 'dashboard-style, data-dense, stat tiles and charts' },
    { label: 'Dark Mode', value: 'dark theme, high contrast, muted accents' },
    { label: 'Playful', value: 'playful, rounded corners, vibrant colors, friendly tone' },
    { label: 'Enterprise', value: 'enterprise, dense information, professional, neutral palette' },
    { label: 'Marketing', value: 'marketing site, hero sections, bold CTAs, lifestyle imagery' },
];

// Safely extract a MockupPayload from an ArtifactVersion. Returns null for
// legacy markdown versions or unparseable content — callers fall back to the
// legacy markdown renderer. Validates field types so corrupted localStorage
// data doesn't cause downstream crashes.
const tryParsePayload = (version: ArtifactVersion): MockupPayload | null => {
    const format = (version.metadata as { format?: string } | undefined)?.format;
    if (format !== MOCKUP_HTML_V1) return null;
    try {
        const parsed = JSON.parse(version.content);
        if (!parsed || typeof parsed !== 'object') return null;
        if (!Array.isArray(parsed.screens) || parsed.screens.length === 0) return null;

        // Validate every screen has the minimum required string fields.
        const validScreens = parsed.screens.filter(
            (s: unknown): s is MockupScreen =>
                !!s &&
                typeof s === 'object' &&
                typeof (s as Record<string, unknown>).id === 'string' &&
                typeof (s as Record<string, unknown>).name === 'string' &&
                typeof (s as Record<string, unknown>).html === 'string' &&
                ((s as Record<string, unknown>).html as string).trim().length > 0
        );
        if (validScreens.length === 0) return null;

        return {
            version: 'mockup_html_v1',
            title: typeof parsed.title === 'string' ? parsed.title : 'Mockup concept',
            summary: typeof parsed.summary === 'string' ? parsed.summary : '',
            screens: validScreens,
        };
    } catch {
        return null;
    }
};

const DEFAULT_SETTINGS: MockupSettings = {
    platform: 'desktop', fidelity: 'mid', scope: 'key_workflow',
};

/** Safely extract MockupSettings from version metadata, falling back to
 *  sensible defaults so a corrupted metadata blob never crashes the UI. */
const extractSettings = (version: ArtifactVersion): MockupSettings => {
    const raw = (version.metadata as Record<string, unknown> | undefined)?.settings;
    if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS;
    const s = raw as Record<string, unknown>;
    return {
        platform: (typeof s.platform === 'string' && ['mobile', 'desktop', 'responsive'].includes(s.platform)
            ? s.platform : 'desktop') as MockupPlatform,
        fidelity: (typeof s.fidelity === 'string' && ['low', 'mid', 'high'].includes(s.fidelity)
            ? s.fidelity : 'mid') as MockupFidelity,
        scope: (typeof s.scope === 'string' && ['single_screen', 'multi_screen', 'key_workflow'].includes(s.scope)
            ? s.scope : 'key_workflow') as MockupScope,
        style: typeof s.style === 'string' ? s.style : undefined,
        notes: typeof s.notes === 'string' ? s.notes : undefined,
    };
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
    const [warning, setWarning] = useState<string | null>(null);

    // Settings
    const [platform, setPlatform] = useState<MockupPlatform>('desktop');
    const [fidelity, setFidelity] = useState<MockupFidelity>('mid');
    const [scope, setScope] = useState<MockupScope>('key_workflow');
    const [style, setStyle] = useState('');
    const [notes, setNotes] = useState('');

    const mockupArtifacts = getArtifacts(projectId, 'mockup');

    const handleGenerate = async () => {
        setError(null);
        setWarning(null);
        setIsGenerating(true);
        try {
            const settings: MockupSettings = {
                platform, fidelity, scope,
                style: style || undefined,
                notes: notes || undefined,
            };

            const { payload, warnings } = await generateMockup(prdContent, settings, structuredPRD);

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
            if (warnings.length > 0) {
                setWarning(`Generated with ${warnings.length} skipped screen(s): ${warnings.join(' ')}`);
            }
        } catch (e) {
            const err = normalizeError(e);
            console.error('[Mockup generation failed]', err.raw);
            setError(userMessage(err));
        } finally {
            setIsGenerating(false);
        }
    };

    const handleRegenerate = async (artifactId: string) => {
        setError(null);
        setWarning(null);
        setIsGenerating(true);
        try {
            const versions = getArtifactVersions(projectId, artifactId);
            const latestVersion = versions[versions.length - 1];
            const settings = latestVersion ? extractSettings(latestVersion) : DEFAULT_SETTINGS;

            const { payload, warnings } = await generateMockup(prdContent, settings, structuredPRD);

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
            if (warnings.length > 0) {
                setWarning(`Regenerated with ${warnings.length} skipped screen(s): ${warnings.join(' ')}`);
            }
        } catch (e) {
            // On regeneration failure, the previous version is preserved — the
            // user still sees the last known good content.
            const err = normalizeError(e);
            console.error('[Mockup regeneration failed]', err.raw);
            setError(userMessage(err));
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
                {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {isGenerating ? 'Regenerating...' : 'Regenerate'}
            </button>
            <button
                type="button"
                onClick={() => {
                    const entering = !compareMode;
                    setCompareMode(entering);
                    if (entering) {
                        const preferred = allVersions.find(v => v.isPreferred);
                        const sorted = [...allVersions].sort((a, b) => b.versionNumber - a.versionNumber);
                        const vA = preferred || sorted[0];
                        const vB = sorted.find(v => v.id !== vA?.id) || null;
                        setCompareVersions([vA?.id || null, vB?.id || null]);
                    } else {
                        setCompareVersions([null, null]);
                    }
                }}
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
                Feedback
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
            const settings = extractSettings(version);
            const sourceSpineVersionId = version.sourceRefs.find(r => r.sourceType === 'spine')?.sourceArtifactVersionId;
            return (
                <MockupErrorBoundary key={version.id}>
                    <MockupViewer
                        payload={payload}
                        settings={settings}
                        staleness={staleness}
                        versionNumber={version.versionNumber}
                        createdAt={version.createdAt}
                        sourceSpineVersionId={sourceSpineVersionId}
                        actions={actions}
                    />
                </MockupErrorBoundary>
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
                const settings = extractSettings(v);
                return (
                    <MockupErrorBoundary key={v.id}>
                        <MockupViewer
                            payload={payload}
                            settings={settings}
                            staleness={staleness}
                            versionNumber={v.versionNumber}
                            createdAt={v.createdAt}
                            sourceSpineVersionId={v.sourceRefs.find(r => r.sourceType === 'spine')?.sourceArtifactVersionId}
                        />
                    </MockupErrorBoundary>
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
                <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-neutral-500 uppercase">Compare Versions</span>
                    <button type="button" onClick={() => { setCompareMode(false); setCompareVersions([null, null]); }}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded transition">
                        <X size={12} /> Exit Compare
                    </button>
                </div>
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
        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
            <div className="p-5">
                <GenerationProgress
                    stages={MOCKUP_GENERATION_STAGES}

                    variant="creative"
                    title="Creating mockup"
                    subtitle={`${platform} layout, ${fidelity} fidelity, ${scope.replace('_', ' ')} scope`}
                />
            </div>
            <div className="px-5 pt-2 pb-2 flex items-center gap-2 animate-pulse">
                <div className="h-7 w-28 bg-neutral-100 rounded-full" />
                <div className="h-7 w-28 bg-neutral-100 rounded-full" />
                <div className="h-7 w-28 bg-neutral-100 rounded-full" />
            </div>
            <div className="px-5 pb-5 animate-pulse">
                <div className="h-[480px] bg-neutral-100 rounded-lg relative overflow-hidden">
                    {/* Shimmer effect */}
                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                </div>
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
                    New Mockup
                </button>
            </div>

            {error && (
                <ErrorBanner
                    message={error}
                    onDismiss={() => setError(null)}
                />
            )}
            {warning && (
                <ErrorBanner
                    message={warning}
                    variant="warning"
                    onDismiss={() => setWarning(null)}
                />
            )}

            {/* Generate Panel */}
            {showGeneratePanel && (
                <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-6 space-y-5">
                    <div>
                        <h3 className="text-sm font-bold text-neutral-900">Configure Mockup</h3>
                        <p className="text-xs text-neutral-500 mt-1">Choose how your UI concept should look. The AI will generate a rendered HTML preview based on your PRD.</p>
                    </div>

                    <div className="grid grid-cols-3 gap-5">
                        <div>
                            <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">Platform</label>
                            <div className="space-y-1">
                                {PLATFORM_OPTIONS.map(opt => {
                                    const Icon = opt.icon;
                                    return (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setPlatform(opt.value)}
                                            className={`flex items-start gap-2.5 w-full text-left px-3 py-2 rounded-lg transition ${
                                                platform === opt.value
                                                    ? 'bg-indigo-50 border border-indigo-200'
                                                    : 'hover:bg-neutral-50 border border-transparent'
                                            }`}
                                        >
                                            <Icon size={14} className={`mt-0.5 shrink-0 ${platform === opt.value ? 'text-indigo-600' : 'text-neutral-400'}`} />
                                            <div>
                                                <div className={`text-sm ${platform === opt.value ? 'text-indigo-700 font-medium' : 'text-neutral-700'}`}>{opt.label}</div>
                                                <div className="text-[11px] text-neutral-400 leading-tight">{opt.desc}</div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <div>
                            <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">Fidelity</label>
                            <div className="space-y-1">
                                {FIDELITY_OPTIONS.map(opt => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => setFidelity(opt.value)}
                                        className={`block w-full text-left px-3 py-2 rounded-lg transition ${
                                            fidelity === opt.value
                                                ? 'bg-indigo-50 border border-indigo-200'
                                                : 'hover:bg-neutral-50 border border-transparent'
                                        }`}
                                    >
                                        <div className={`text-sm ${fidelity === opt.value ? 'text-indigo-700 font-medium' : 'text-neutral-700'}`}>{opt.label}</div>
                                        <div className="text-[11px] text-neutral-400 leading-tight">{opt.desc}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">Scope</label>
                            <div className="space-y-1">
                                {SCOPE_OPTIONS.map(opt => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => setScope(opt.value)}
                                        className={`block w-full text-left px-3 py-2 rounded-lg transition ${
                                            scope === opt.value
                                                ? 'bg-indigo-50 border border-indigo-200'
                                                : 'hover:bg-neutral-50 border border-transparent'
                                        }`}
                                    >
                                        <div className={`text-sm ${scope === opt.value ? 'text-indigo-700 font-medium' : 'text-neutral-700'}`}>{opt.label}</div>
                                        <div className="text-[11px] text-neutral-400 leading-tight">{opt.desc}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Style Direction <span className="normal-case font-normal">(optional)</span></label>
                            <div className="flex flex-wrap gap-1.5 mb-2">
                                {STYLE_PRESETS.map(preset => (
                                    <button
                                        key={preset.label}
                                        type="button"
                                        onClick={() => setStyle(style === preset.value ? '' : preset.value)}
                                        className={`px-2.5 py-1 rounded-full text-xs transition ${
                                            style === preset.value
                                                ? 'bg-indigo-100 text-indigo-700 border border-indigo-300 font-medium'
                                                : 'bg-neutral-50 text-neutral-600 border border-neutral-200 hover:bg-neutral-100'
                                        }`}
                                    >
                                        {preset.label}
                                    </button>
                                ))}
                            </div>
                            <input
                                type="text"
                                value={style}
                                onChange={e => setStyle(e.target.value)}
                                placeholder="Select a preset or type your own…"
                                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
                            />
                        </div>
                        <div>
                            <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Notes <span className="normal-case font-normal">(optional)</span></label>
                            <input
                                type="text"
                                value={notes}
                                onChange={e => setNotes(e.target.value)}
                                placeholder="Areas to emphasize or constraints…"
                                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-3 pt-1 border-t border-neutral-100">
                        <button
                            type="button"
                            onClick={handleGenerate}
                            disabled={isGenerating}
                            className="flex items-center gap-2 mt-4 px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50"
                        >
                            {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                            {isGenerating ? 'Generating mockup...' : 'Generate Mockup'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowGeneratePanel(false)}
                            className="mt-4 px-4 py-2.5 text-neutral-500 hover:text-neutral-700 text-sm transition"
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
                <div className="text-center py-16">
                    <div className="mx-auto mb-5 w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">
                        <Image size={24} className="text-indigo-400" />
                    </div>
                    <p className="text-lg font-semibold text-neutral-700 mb-2">Visualize your product</p>
                    <p className="text-sm text-neutral-500 max-w-sm mx-auto mb-6">
                        Turn your PRD into interactive UI concepts — rendered as real HTML you can click through, screen by screen.
                    </p>
                    <button
                        type="button"
                        onClick={() => setShowGeneratePanel(true)}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
                    >
                        <Sparkles size={14} />
                        Generate Your First Mockup
                    </button>
                </div>
            ) : (
                <div className="space-y-4">
                    {mockupArtifacts.map(artifact => {
                        const versions = getArtifactVersions(projectId, artifact.id);
                        const preferredVersion = versions.find(v => v.isPreferred);
                        const staleness = getArtifactStaleness(projectId, artifact.id);
                        const isSelected = selectedArtifactId === artifact.id;
                        const previewSettings = preferredVersion ? extractSettings(preferredVersion) : null;

                        return (
                            <div key={artifact.id}>
                                {/* Card Header — always visible */}
                                <button
                                    type="button"
                                    onClick={() => {
                                setSelectedArtifactId(isSelected ? null : artifact.id);
                                setCompareMode(false);
                                setCompareVersions([null, null]);
                            }}
                                    className={`w-full flex items-center justify-between p-4 bg-white border border-neutral-200 shadow-sm transition text-left ${
                                        isSelected ? 'rounded-t-xl border-b-0' : 'rounded-xl hover:bg-neutral-50/50'
                                    }`}
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <Image size={18} className="text-indigo-500 shrink-0" />
                                        <span className="font-medium text-neutral-800 truncate">{artifact.title}</span>
                                        {previewSettings && (
                                            <span className="hidden sm:inline text-[10px] text-neutral-400 uppercase tracking-wide">
                                                {previewSettings.platform} · {previewSettings.fidelity}
                                            </span>
                                        )}
                                        <StalenessBadge staleness={staleness} />
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <span className="text-xs text-neutral-400">
                                            {versions.length} version{versions.length !== 1 ? 's' : ''}
                                        </span>
                                        <span className="text-xs text-neutral-400">
                                            {new Date(artifact.updatedAt).toLocaleDateString()}
                                        </span>
                                    </div>
                                </button>

                                {/* Expanded Detail — renders directly, no nested card */}
                                {isSelected && preferredVersion && (
                                    <div className="border-x border-b border-neutral-200 rounded-b-xl bg-neutral-50/30 overflow-hidden">
                                        {isGenerating && (
                                            <div className="px-5 py-3 bg-violet-50/50 border-b border-violet-100">
                                                <GenerationProgress
                                                    stages={MOCKUP_GENERATION_STAGES}
                                
                                                    variant="creative"
                                                    inline
                                                />
                                            </div>
                                        )}
                                        {compareMode ? (
                                            <div className="p-4">
                                                {renderCompareView()}
                                            </div>
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
