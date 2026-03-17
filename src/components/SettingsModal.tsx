import { useState } from 'react';
import { X, Key, Cpu, Shield, ExternalLink, Activity } from 'lucide-react';

interface SettingsModalProps {
    onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
    const [apiKey, setApiKey] = useState(() => localStorage.getItem('GEMINI_API_KEY') || '');
    const [model, setModel] = useState(() => localStorage.getItem('GEMINI_MODEL') || 'gemini-2.5-flash');

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        localStorage.setItem('GEMINI_API_KEY', apiKey.trim());
        localStorage.setItem('GEMINI_MODEL', model);
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

                    {/* Model Selection */}
                    <div className="space-y-4">
                        <label className="text-sm font-semibold text-neutral-300 flex items-center gap-2">
                            <Cpu size={14} className="text-indigo-400" />
                            Intelligence Level
                        </label>
                        
                        <div className="grid grid-cols-1 gap-3">
                            <button
                                type="button"
                                onClick={() => setModel('gemini-2.5-flash')}
                                className={`flex items-start gap-4 p-4 rounded-2xl border transition-all text-left ${model === 'gemini-2.5-flash' ? 'bg-indigo-500/10 border-indigo-500/50 ring-1 ring-indigo-500/50' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}
                            >
                                <div className={`mt-1 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${model === 'gemini-2.5-flash' ? 'border-indigo-500' : 'border-neutral-600'}`}>
                                    {model === 'gemini-2.5-flash' && <div className="w-2 h-2 rounded-full bg-indigo-400" />}
                                </div>
                                <div>
                                    <h4 className="text-sm font-bold text-white mb-0.5">Gemini 2.5 Flash</h4>
                                    <p className="text-xs text-neutral-400">Extreme speed. Best for rapid brainstorming.</p>
                                </div>
                            </button>

                            <button
                                type="button"
                                onClick={() => setModel('gemini-2.5-pro')}
                                className={`flex items-start gap-4 p-4 rounded-2xl border transition-all text-left ${model === 'gemini-2.5-pro' ? 'bg-indigo-500/10 border-indigo-500/50 ring-1 ring-indigo-500/50' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}
                            >
                                <div className={`mt-1 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${model === 'gemini-2.5-pro' ? 'border-indigo-500' : 'border-neutral-600'}`}>
                                    {model === 'gemini-2.5-pro' && <div className="w-2 h-2 rounded-full bg-indigo-400" />}
                                </div>
                                <div>
                                    <h4 className="text-sm font-bold text-white mb-0.5">Gemini 2.5 Pro</h4>
                                    <p className="text-xs text-neutral-400">Max reasoning power. Best for complex PRDs.</p>
                                </div>
                            </button>

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
