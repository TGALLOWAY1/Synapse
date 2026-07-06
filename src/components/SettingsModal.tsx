import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Key, Cpu, Shield, ExternalLink, Activity, ChevronDown, AlertTriangle, Briefcase, Sparkles, Zap, Brain, Github, ChevronRight, Bug } from 'lucide-react';
import { getOwnerToken } from '../lib/snapshotClient';
import { DEFAULT_GEMINI_MODEL } from '../lib/geminiClient';
import { ProviderKeysSection } from './settings/ProviderKeysSection';
import { ConnectedAccountsSection } from './settings/ConnectedAccountsSection';
import { ArtifactModelsSection } from './settings/ArtifactModelsSection';
import { MODEL_CATALOG, CURRENT_MODELS, LEGACY_MODELS, type ModelOption } from '../lib/modelCatalog';
import {
    getArtifactModelOverrides,
    setArtifactModelOverrides,
    getMockupImageMode,
    setMockupImageMode,
    type MockupImageMode,
} from '../lib/artifactModelSettings';
import type { CoreArtifactSubtype } from '../types';
import {
    getLocalCredential,
    setLocalCredential,
    removeLocalCredential,
    GEMINI_API_KEY,
    OPENAI_API_KEY,
    GITHUB_TOKEN,
} from '../lib/localCredentials';

const DEFAULT_FAST_MODEL = 'gemini-3.5-flash';
const DEFAULT_STRONG_MODEL = 'gemini-3.1-pro-preview';

interface SettingsModalProps {
    onClose: () => void;
}

function ModelRadio({
    option,
    selected,
    onSelect,
}: {
    option: ModelOption;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={`flex items-start gap-4 p-4 rounded-2xl border transition-all text-left ${
                selected
                    ? 'bg-indigo-500/10 border-indigo-500/50 ring-1 ring-indigo-500/50'
                    : 'bg-white/5 border-white/5 hover:bg-white/10'
            }`}
        >
            <div
                className={`mt-1 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    selected ? 'border-indigo-500' : 'border-neutral-600'
                }`}
            >
                {selected && <div className="w-2 h-2 rounded-full bg-indigo-400" />}
            </div>
            <div>
                <h4 className="text-sm font-bold text-white mb-0.5">{option.name}</h4>
                <p className="text-xs text-neutral-400">{option.description}</p>
            </div>
        </button>
    );
}

export function SettingsModal({ onClose }: SettingsModalProps) {
    const navigate = useNavigate();
    // Owner-only affordances are gated on possession of the SYNAPSE_OWNER_TOKEN,
    // the same client signal the Snapshots panel uses.
    const hasOwnerToken = Boolean(getOwnerToken());
    const [apiKey, setApiKey] = useState(() => getLocalCredential(GEMINI_API_KEY) || '');
    const [projectId, setProjectId] = useState(() => localStorage.getItem('GEMINI_PROJECT_ID') || '');
    const [model, setModel] = useState(() => localStorage.getItem('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL);
    const [openaiKey, setOpenaiKey] = useState(() => getLocalCredential(OPENAI_API_KEY) || '');
    const [fastModel, setFastModel] = useState(() => localStorage.getItem('GEMINI_FAST_MODEL') || DEFAULT_FAST_MODEL);
    const [strongModel, setStrongModel] = useState(() => localStorage.getItem('GEMINI_STRONG_MODEL') || DEFAULT_STRONG_MODEL);
    const [githubToken, setGithubToken] = useState(() => getLocalCredential(GITHUB_TOKEN) || '');
    const [githubRepo, setGithubRepo] = useState(() => localStorage.getItem('GITHUB_DEFAULT_REPO') || '');
    const [artifactOverrides, setArtifactOverrides] = useState<Partial<Record<CoreArtifactSubtype, string>>>(
        () => getArtifactModelOverrides(),
    );
    const [mockupMode, setMockupMode] = useState<MockupImageMode>(() => getMockupImageMode());

    // Expand the legacy section automatically if the user is currently on a
    // legacy model — otherwise keep it collapsed to reduce visual noise.
    const currentIsLegacy = LEGACY_MODELS.some((m) => m.id === model);
    const [legacyOpen, setLegacyOpen] = useState(currentIsLegacy);

    const selectedIsPreview = /preview/i.test(model);

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        setLocalCredential(GEMINI_API_KEY, apiKey.trim());
        localStorage.setItem('GEMINI_MODEL', model);
        localStorage.setItem('GEMINI_FAST_MODEL', fastModel);
        localStorage.setItem('GEMINI_STRONG_MODEL', strongModel);
        setArtifactModelOverrides(artifactOverrides);
        setMockupImageMode(mockupMode);
        const trimmedProjectId = projectId.trim();
        if (trimmedProjectId) {
            localStorage.setItem('GEMINI_PROJECT_ID', trimmedProjectId);
        } else {
            localStorage.removeItem('GEMINI_PROJECT_ID');
        }
        const trimmedOpenai = openaiKey.trim();
        if (trimmedOpenai) {
            setLocalCredential(OPENAI_API_KEY, trimmedOpenai);
        } else {
            removeLocalCredential(OPENAI_API_KEY);
        }
        const trimmedGithubToken = githubToken.trim();
        if (trimmedGithubToken) {
            setLocalCredential(GITHUB_TOKEN, trimmedGithubToken);
        } else {
            removeLocalCredential(GITHUB_TOKEN);
        }
        const trimmedGithubRepo = githubRepo.trim();
        if (trimmedGithubRepo) {
            localStorage.setItem('GITHUB_DEFAULT_REPO', trimmedGithubRepo);
        } else {
            localStorage.removeItem('GITHUB_DEFAULT_REPO');
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200" onClick={onClose}>
            <div
                className="bg-neutral-900/90 backdrop-blur-xl rounded-3xl w-full max-w-lg shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)] overflow-hidden border border-white/10 flex flex-col animate-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-indigo-500/10 to-transparent">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                            <Key size={20} className="text-indigo-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold tracking-tight text-white">Project Settings</h2>
                            <p className="text-xs text-neutral-400 font-medium">Configure your AI intelligence</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-500 hover:text-white hover:bg-white/5 transition-all"
                    >
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSave} className="p-8 space-y-8 overflow-y-auto max-h-[80vh]">
                    {/* Connected sign-in methods (account linking — resolves R3) */}
                    <ConnectedAccountsSection />

                    {/* Encrypted, server-side provider key vault (recommended) */}
                    <ProviderKeysSection />

                    <div className="border-t border-white/5 pt-6 space-y-1">
                        <h3 className="text-sm font-semibold text-neutral-400">Local browser keys (advanced fallback)</h3>
                        <p className="text-[11px] text-neutral-500 leading-relaxed">
                            These keys are stored only in this browser's localStorage. The encrypted
                            vault above is preferred; local keys are used as a fallback when no vault key
                            is configured (e.g. offline or local development).
                        </p>
                    </div>

                    {/* API Key Section */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-semibold text-neutral-300 flex items-center gap-2">
                                <Shield size={14} className="text-indigo-400" />
                                Google Gemini API Key
                            </label>
                            <a
                                href="https://aistudio.google.com/app/apikey"
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] font-bold uppercase tracking-wider text-indigo-400 hover:text-indigo-300 transition flex items-center gap-1"
                            >
                                Get Key <ExternalLink size={10} />
                            </a>
                        </div>
                        <input
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-neutral-100 placeholder:text-neutral-600 transition-all font-mono text-sm"
                            placeholder="Paste your AIzaSy... key here"
                            autoFocus
                        />
                        <p className="text-[11px] text-neutral-500 leading-relaxed px-1">
                            Your key is stored locally in your browser and never leaves your machine.
                        </p>
                    </div>

                    {/* Billing Project ID — forces paid-tier quota */}
                    <div className="space-y-3">
                        <label className="text-sm font-semibold text-neutral-300 flex items-center gap-2">
                            <Briefcase size={14} className="text-indigo-400" />
                            Billing Project ID
                            <span className="text-[10px] uppercase tracking-wider font-bold text-neutral-500">Optional</span>
                        </label>
                        <input
                            type="text"
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-neutral-100 placeholder:text-neutral-600 transition-all font-mono text-sm"
                            placeholder="e.g. my-gcp-project-123"
                        />
                        <p className="text-[11px] text-neutral-500 leading-relaxed px-1">
                            If you enabled billing on a specific Google Cloud project, paste its ID here.
                            Synapse sends it as <code className="text-neutral-400">x-goog-user-project</code> so
                            Gemini meters requests against that project — fixes the case where a key defaults
                            to free-tier quota even after billing is on.
                        </p>
                        <p className="text-[11px] text-amber-300/80 leading-relaxed px-1">
                            Use the Project <strong>ID</strong> (e.g. <code className="text-neutral-400">my-project-123</code>),
                            not the Project Number. The <strong>Generative Language API</strong> must be
                            enabled on this project (Google Cloud Console → APIs &amp; Services → Library).
                        </p>
                    </div>

                    {/* OpenAI image preview (optional) */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-semibold text-neutral-300 flex items-center gap-2">
                                <Sparkles size={14} className="text-indigo-400" />
                                OpenAI Image Preview
                                <span className="text-[10px] uppercase tracking-wider font-bold text-neutral-500">Optional</span>
                            </label>
                            <a
                                href="https://platform.openai.com/api-keys"
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] font-bold uppercase tracking-wider text-indigo-400 hover:text-indigo-300 transition flex items-center gap-1"
                            >
                                Get Key <ExternalLink size={10} />
                            </a>
                        </div>
                        <input
                            type="password"
                            value={openaiKey}
                            onChange={(e) => setOpenaiKey(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-neutral-100 placeholder:text-neutral-600 transition-all font-mono text-sm"
                            placeholder="Paste your sk-... OpenAI key here"
                        />
                        <p className="text-[11px] text-neutral-500 leading-relaxed px-1">
                            Adds an "AI Image" tab to each mockup screen, powered by OpenAI <code className="text-neutral-400">gpt-image-2</code>.
                            Click to generate a low-quality draft image; if you like it, regenerate at high quality.
                            Your key is stored locally in your browser and never leaves your machine.
                        </p>
                    </div>

                    {/* Integrations — credentials for task export targets */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-semibold text-neutral-300 flex items-center gap-2">
                                <Github size={14} className="text-indigo-400" />
                                GitHub Integration
                                <span className="text-[10px] uppercase tracking-wider font-bold text-neutral-500">Optional</span>
                            </label>
                            <a
                                href="https://github.com/settings/tokens?type=beta"
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] font-bold uppercase tracking-wider text-indigo-400 hover:text-indigo-300 transition flex items-center gap-1"
                            >
                                Create Token <ExternalLink size={10} />
                            </a>
                        </div>
                        <input
                            type="password"
                            value={githubToken}
                            onChange={(e) => setGithubToken(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-neutral-100 placeholder:text-neutral-600 transition-all font-mono text-sm"
                            placeholder="ghp_... or github_pat_..."
                        />
                        <input
                            type="text"
                            value={githubRepo}
                            onChange={(e) => setGithubRepo(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-neutral-100 placeholder:text-neutral-600 transition-all font-mono text-sm"
                            placeholder="owner/repo (default destination for exported tasks)"
                        />
                        <p className="text-[11px] text-neutral-500 leading-relaxed px-1">
                            Used by <strong>Convert to Tasks</strong> on the Implementation Plan artifact to create
                            real GitHub issues. Token needs <code className="text-neutral-400">issues:write</code>
                            scope on the target repo. Stored locally in your browser only.
                        </p>
                    </div>

                    {/* Model Tiers for Progressive PRD */}
                    <div className="space-y-4">
                        <label className="text-sm font-semibold text-neutral-300 flex items-center gap-2">
                            <Brain size={14} className="text-indigo-400" />
                            PRD Generation Models
                        </label>
                        <p className="text-[11px] text-neutral-500 leading-relaxed -mt-1">
                            PRD sections are generated concurrently using two models: Flash for simpler sections (product basics, grounding, risks, metrics) and Pro for complex sections (features, architecture, data model). If you hit rate limits, set both to the same model.
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label className="flex items-center gap-1.5 text-xs font-semibold text-teal-400">
                                    <Zap size={11} />
                                    Fast model (Flash)
                                </label>
                                <select
                                    value={fastModel}
                                    onChange={(e) => setFastModel(e.target.value)}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500 text-neutral-100 text-xs transition-all"
                                >
                                    {MODEL_CATALOG.map((m) => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="flex items-center gap-1.5 text-xs font-semibold text-indigo-400">
                                    <Brain size={11} />
                                    Expert model (Pro)
                                </label>
                                <select
                                    value={strongModel}
                                    onChange={(e) => setStrongModel(e.target.value)}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-neutral-100 text-xs transition-all"
                                >
                                    {MODEL_CATALOG.map((m) => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Per-artifact model routing */}
                    <ArtifactModelsSection
                        fastModel={fastModel}
                        strongModel={strongModel}
                        overrides={artifactOverrides}
                        onOverridesChange={setArtifactOverrides}
                        mockupMode={mockupMode}
                        onMockupModeChange={setMockupMode}
                    />

                    {/* Model Selection */}
                    <div className="space-y-4">
                        <label className="text-sm font-semibold text-neutral-300 flex items-center gap-2">
                            <Cpu size={14} className="text-indigo-400" />
                            Default model
                            <span className="text-[10px] uppercase tracking-wider font-bold text-neutral-500">Refine & enhance</span>
                        </label>
                        <p className="text-[11px] text-neutral-500 leading-relaxed -mt-1">
                            Used for everything that isn't tiered above — the PRD refinement
                            conversations (highlight &rarr; branch &rarr; consolidate) and the
                            "Enhance" prompt helper. PRD sections and the core artifacts route
                            automatically between the Fast and Expert models by complexity (see
                            "PRD Generation Models"); this also acts as the fallback for those
                            tiers when they're left unset.
                        </p>

                        <div className="grid grid-cols-1 gap-3">
                            {CURRENT_MODELS.map((option) => (
                                <ModelRadio
                                    key={option.id}
                                    option={option}
                                    selected={model === option.id}
                                    onSelect={() => setModel(option.id)}
                                />
                            ))}
                        </div>

                        {selectedIsPreview && (
                            <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200/90">
                                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                <p className="text-[11px] leading-relaxed">
                                    Preview models have reduced per-project quotas <em>even on paid tier</em>.
                                    If you see persistent rate-limit / free-tier errors, switch to a stable model
                                    (e.g. Gemini 2.5 Flash in Legacy models) until the Gemini 3 series exits preview.
                                </p>
                            </div>
                        )}

                        {/* Legacy section — collapsed by default unless the user
                            is on a legacy model. */}
                        <div className="pt-2">
                            <button
                                type="button"
                                onClick={() => setLegacyOpen((v) => !v)}
                                className="w-full flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 transition py-1"
                                aria-expanded={legacyOpen}
                            >
                                <span>Legacy models</span>
                                <ChevronDown
                                    size={14}
                                    className={`transition-transform ${legacyOpen ? 'rotate-180' : ''}`}
                                />
                            </button>
                            {legacyOpen && (
                                <div className="grid grid-cols-1 gap-3 mt-3">
                                    {LEGACY_MODELS.map((option) => (
                                        <ModelRadio
                                            key={option.id}
                                            option={option}
                                            selected={model === option.id}
                                            onSelect={() => setModel(option.id)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Orchestration Metrics link */}
                    <div className="pt-4 border-t border-white/5">
                        <button
                            type="button"
                            onClick={() => { onClose(); navigate('/metrics'); }}
                            className="w-full bg-white/5 rounded-2xl p-4 flex items-center justify-between border border-white/5 hover:bg-white/10 transition-all text-left"
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                                    <Activity size={14} />
                                </div>
                                <div>
                                    <p className="text-[10px] uppercase tracking-widest font-bold text-neutral-500 mb-0.5">Metrics</p>
                                    <p className="text-xs text-neutral-300 font-medium">Orchestration & AI workflow telemetry</p>
                                </div>
                            </div>
                            <ChevronRight size={16} className="text-neutral-500" />
                        </button>
                    </div>

                    {/* Developer — owner-only (gated on possession of the
                        SYNAPSE_OWNER_TOKEN, mirroring the Snapshots panel). */}
                    {hasOwnerToken && (
                        <div className="pt-4 border-t border-white/5">
                            <p className="text-[10px] uppercase tracking-widest font-bold text-neutral-500 mb-2">Developer</p>
                            <button
                                type="button"
                                onClick={() => { onClose(); navigate('/developer/llm-trace'); }}
                                className="w-full bg-white/5 rounded-2xl p-4 flex items-center justify-between border border-white/5 hover:bg-white/10 transition-all text-left"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                                        <Bug size={14} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase tracking-widest font-bold text-neutral-500 mb-0.5">LLM Trace Viewer</p>
                                        <p className="text-xs text-neutral-300 font-medium">Inspect every LLM call, prompt & response</p>
                                    </div>
                                </div>
                                <ChevronRight size={16} className="text-neutral-500" />
                            </button>
                        </div>
                    )}

                    {/* Meta Info */}
                    <div className="pt-4 border-t border-white/5">
                        <div className="bg-white/5 rounded-2xl p-4 flex items-center justify-between border border-white/5">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-green-500/10 text-green-400">
                                    <Activity size={14} />
                                </div>
                                <div className="text-left">
                                    <p className="text-[10px] uppercase tracking-widest font-bold text-neutral-500 mb-0.5">System Status</p>
                                    <p className="text-xs text-neutral-300 font-medium select-none">All systems operational</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-[10px] uppercase tracking-widest font-bold text-neutral-500 mb-0.5">v{__APP_VERSION__}</p>
                                <p className="text-xs text-neutral-300 font-medium select-none">Build: {__BUILD_DATE__}</p>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-6 py-2.5 text-sm font-bold text-neutral-400 hover:text-white transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-8 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-xl shadow-lg shadow-indigo-500/20 transition-all hover:-translate-y-0.5 active:translate-y-0"
                        >
                            Apply Changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
