import { useState } from 'react';
import { Download, Terminal } from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import { AgentPromptCard } from './AgentPromptCard';

interface AgentPromptViewProps {
    projectId: string;
    projectName: string;
}

export function AgentPromptView({ projectId, projectName }: AgentPromptViewProps) {
    const { getAgentPrompts, deleteAgentPrompt, getLatestDevPlan } = useProjectStore();
    const [filterTarget, setFilterTarget] = useState<string>('all');

    const allPrompts = getAgentPrompts(projectId);
    const latestPlan = getLatestDevPlan(projectId);

    const filteredPrompts = filterTarget === 'all'
        ? allPrompts
        : allPrompts.filter(p => p.target === filterTarget);

    // Group prompts by milestone
    const milestoneGroups = new Map<string, typeof filteredPrompts>();
    filteredPrompts.forEach(prompt => {
        const existing = milestoneGroups.get(prompt.milestoneId) || [];
        milestoneGroups.set(prompt.milestoneId, [...existing, prompt]);
    });

    const getMilestoneName = (milestoneId: string): string => {
        if (!latestPlan) return milestoneId;
        const milestone = latestPlan.milestones.find(m => m.id === milestoneId);
        return milestone?.name || milestoneId;
    };

    const handleExportAll = () => {
        const lines: string[] = [`# ${projectName} — Agent Prompts\n`];

        milestoneGroups.forEach((prompts, milestoneId) => {
            lines.push(`## ${getMilestoneName(milestoneId)}\n`);
            prompts.forEach(prompt => {
                lines.push(`### ${prompt.target.toUpperCase()} — ${prompt.branchName}\n`);
                lines.push(prompt.rawPromptText);
                lines.push('\n---\n');
            });
        });

        const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${projectName.toLowerCase().replace(/\s+/g, '-')}-agent-prompts.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    if (allPrompts.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center text-center py-20">
                <div className="bg-purple-50 p-4 rounded-full mb-6">
                    <Terminal size={32} className="text-purple-500" />
                </div>
                <h3 className="text-xl font-medium text-neutral-800 mb-2">No Agent Prompts Yet</h3>
                <p className="text-neutral-500 max-w-md">
                    Generate agent prompts from the Dev Plan stage by clicking "Agent Prompts" on any milestone.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider">Agent Prompts</h3>
                <button
                    onClick={handleExportAll}
                    className="flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-700 transition"
                >
                    <Download size={12} />
                    Export All
                </button>
            </div>

            {/* Filter Bar */}
            <div className="flex items-center gap-2">
                {['all', 'cursor', 'claude', 'codex', 'copilot'].map(target => (
                    <button
                        key={target}
                        onClick={() => setFilterTarget(target)}
                        className={`px-3 py-1 text-xs rounded-full transition ${
                            filterTarget === target
                                ? 'bg-neutral-800 text-white'
                                : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
                        }`}
                    >
                        {target === 'all' ? 'All' : target === 'claude' ? 'Claude Code' : target.charAt(0).toUpperCase() + target.slice(1)}
                    </button>
                ))}
            </div>

            {/* Grouped by Milestone */}
            {Array.from(milestoneGroups.entries()).map(([milestoneId, prompts]) => (
                <div key={milestoneId}>
                    <h4 className="text-sm font-medium text-neutral-700 mb-2 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-indigo-400" />
                        {getMilestoneName(milestoneId)}
                    </h4>
                    <div className="space-y-3 ml-4">
                        {prompts.map(prompt => (
                            <AgentPromptCard
                                key={prompt.id}
                                prompt={prompt}
                                onDelete={() => deleteAgentPrompt(projectId, prompt.id)}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
