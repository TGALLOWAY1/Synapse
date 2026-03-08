import { useState } from 'react';
import { X, Key } from 'lucide-react';

interface SettingsModalProps {
    onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
    const [apiKey, setApiKey] = useState(() => localStorage.getItem('GEMINI_API_KEY') || '');

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        localStorage.setItem('GEMINI_API_KEY', apiKey.trim());
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
            <div className="bg-neutral-800 rounded-lg w-full max-w-md shadow-2xl overflow-hidden border border-neutral-700" onClick={e => e.stopPropagation()}>
                <div className="px-6 py-4 border-b border-neutral-700 flex items-center justify-between">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        <Key size={20} className="text-blue-400" />
                        API Settings
                    </h2>
                    <button onClick={onClose} className="p-1 text-neutral-400 hover:text-white transition">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSave} className="p-6 space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-neutral-300 mb-2">
                            Google Gemini API Key
                        </label>
                        <input
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            className="w-full bg-neutral-900 border border-neutral-600 rounded-md px-4 py-2 focus:outline-none focus:border-blue-500 text-neutral-100"
                            placeholder="AIzaSy..."
                            autoFocus
                        />
                        <p className="mt-2 text-xs text-neutral-400">
                            Synapse uses Google's Gemini 2.5 Flash model for lightning-fast PRD generation.
                            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline ml-1">
                                Get your free key here.
                            </a>
                        </p>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-neutral-400 hover:text-neutral-200 transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
                        >
                            Save Key
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
