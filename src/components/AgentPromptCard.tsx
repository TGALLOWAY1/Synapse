import { useState } from 'react';
import { Copy, Check, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import type { AgentPrompt } from '../types';

interface AgentPromptCardProps {
    prompt: AgentPrompt;
    onDelete: () => void;
}

const targetColors: Record<string, string> = {
    cursor: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    codex: 'bg-orange-100 text-orange-700 border-orange-200',
    claude: 'bg-violet-100 text-violet-700 border-violet-200',
    copilot: 'bg-sky-100 text-sky-700 border-sky-200',
};

const targetLabels: Record<string, string> = {
    cursor: 'Cursor',
    codex: 'Codex',
    claude: 'Claude Code',
    copilot: 'Copilot',
};

export function AgentPromptCard({ prompt, onDelete }: AgentPromptCardProps) {
    const [copied, setCopied] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(prompt.rawPromptText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden group">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-neutral-100">
                <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${targetColors[prompt.target] || 'bg-neutral-100 text-neutral-600'}`}>
                        {targetLabels[prompt.target] || prompt.target}
                    </span>
                    <span className="text-xs text-neutral-400 font-mono">{prompt.branchName}</span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={handleCopy}
                        className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition ${copied ? 'bg-green-50 text-green-600' : 'text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50'}`}
                        title="Copy prompt to clipboard"
                    >
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                        {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button
                        onClick={() => {
                            if (window.confirm('Delete this agent prompt?')) onDelete();
                        }}
                        className="p-1 text-neutral-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                        title="Delete prompt"
                        aria-label="Delete prompt"
                    >
                        <Trash2 size={12} />
                    </button>
                </div>
            </div>

            {/* Objective */}
            <div className="px-4 py-3">
                <p className="text-sm text-neutral-700 font-medium">{prompt.objective}</p>
            </div>

            {/* Expandable Details */}
            <div className="px-4 pb-3">
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-600 transition"
                >
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {isExpanded ? 'Hide Details' : 'Show Details'}
                </button>

                {isExpanded && (
                    <div className="mt-3 space-y-3">
                        {/* Tasks */}
                        <div>
                            <h5 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Tasks</h5>
                            <ul className="space-y-0.5">
                                {prompt.tasks.map((task, i) => (
                                    <li key={i} className="text-xs text-neutral-600 flex items-start gap-1.5">
                                        <span className="text-neutral-400">-</span>{task}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Constraints */}
                        <div>
                            <h5 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Constraints</h5>
                            <ul className="space-y-0.5">
                                {prompt.constraints.map((c, i) => (
                                    <li key={i} className="text-xs text-neutral-600 flex items-start gap-1.5">
                                        <span className="text-neutral-400">-</span>{c}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Verification */}
                        <div>
                            <h5 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Verification</h5>
                            <ul className="space-y-0.5">
                                {prompt.verificationSteps.map((v, i) => (
                                    <li key={i} className="text-xs text-neutral-600 flex items-start gap-1.5">
                                        <span className="text-neutral-400">-</span>{v}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Raw Prompt */}
                        <div>
                            <h5 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Full Prompt</h5>
                            <pre className="text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-md p-3 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono">
                                {prompt.rawPromptText}
                            </pre>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
