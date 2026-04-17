import { useState } from 'react';
import { X, Key, Cpu, Shield, ExternalLink, Activity, ChevronDown, AlertTriangle, Briefcase } from 'lucide-react';
import { DEFAULT_GEMINI_MODEL } from '../lib/geminiClient';

interface SettingsModalProps {
    onClose: () => void;
}

/**
 * Model catalog. Order within each tier = display order in the UI. `current`
 * models render expanded; `legacy` models render inside a collapsed section.
 * The `id` is passed straight into the Gemini REST URL, so it must match what
 * Google's API accepts (see https://ai.google.dev/gemini-api/docs/models).
 */
type ModelTier = 'current' | 'legacy';
interface ModelOption {
    id: string;
    name: string;
    description: string;
    tier: ModelTier;
}

const MODEL_CATALOG: ModelOption[] = [
    {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash',
        description: 'Recommended default. Frontier-class quality with capacity to spare.',
        tier: 'current',
    },
    {
        id: 'gemini-3.1-pro-preview',
        name: 'Gemini 3.1 Pro',
        description: 'Maximum reasoning power for the most complex PRDs.',
        tier: 'current',
    },
    {
        id: 'gemini-3.1-flash-lite-preview',
        name: 'Gemini 3.1 Flash-Lite',
        description: 'Cheapest option. Good for quick drafts and iteration.',
        tier: 'current',
    },
    {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        description: 'Previous-generation high-reasoning model.',
        tier: 'legacy',
    },
    {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        description: 'Previous-generation fast model. Often hits capacity limits — prefer 3 Flash.',
        tier: 'legacy',
    },
];

const CURRENT_MODELS = MODEL_CATALOG.filter((m) => m.tier === 'current');
const LEGACY_MODELS = MODEL_CATALOG.filter((m) => m.tier === 'legacy');

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
    const [apiKey, setApiKey] = useState(() => localStorage.getItem('GEMINI_API_KEY') || '');
    const [projectId, setProjectId] = useState(() => localStorage.getItem('GEMINI_PROJECT_ID') || '');
    const [model, setModel] = useState(() => localStorage.getItem('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL);
    const selectedIsPreview = model.includes('preview');

    // Expand the legacy section automatically if the user is currently on a
    // legacy model — otherwise keep it collapsed to reduce visual noise.
    const currentIsLegacy = LEGACY_MODELS.some((m) => m.id === model);
    const [legacyOpen, setLegacyOpen] = useState(currentIsLegacy);

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        localStorage.setItem('GEMINI_API_KEY', apiKey.trim());
        localStorage.setItem('GEMINI_MODEL', model);
        const trimmedProjectId = projectId.trim();
        if (trimmedProjectId) {
            localStorage.setItem('GEMINI_PROJECT_ID', trimmedProjectId);
        } else {
            localStorage.removeItem('GEMINI_PROJECT_ID');
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
                    </div>

                    {/* Model Selection */}
                    <div className="space-y-4">
                        <label className="text-sm font-semibold text-neutral-300 flex items-center gap-2">
                            <Cpu size={14} className="text-indigo-400" />
                            Intelligence Level
                        </label>

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
                                <p className="text-[10px] uppercase tracking-widest font-bold text-neutral-500 mb-0.5">V1.2.0-PRO</p>
                                <p className="text-xs text-neutral-300 font-medium select-none">Build: 031626</p>
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
