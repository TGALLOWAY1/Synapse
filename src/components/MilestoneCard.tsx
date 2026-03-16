import { ChevronDown, ChevronRight, Circle, CheckCircle2, PlayCircle, Terminal } from 'lucide-react';
import { useState } from 'react';
import type { Milestone, DevTask } from '../types';

interface MilestoneCardProps {
    milestone: Milestone;
    isGeneratingPrompt: boolean;
    onGeneratePrompts: () => void;
}

const statusConfig: Record<DevTask['status'], { icon: typeof Circle; color: string }> = {
    'pending': { icon: Circle, color: 'text-neutral-400' },
    'in-progress': { icon: PlayCircle, color: 'text-indigo-500' },
    'done': { icon: CheckCircle2, color: 'text-green-500' },
};

export function MilestoneCard({ milestone, isGeneratingPrompt, onGeneratePrompts }: MilestoneCardProps) {
    const [isExpanded, setIsExpanded] = useState(true);

    return (
        <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
            {/* Milestone Header */}
            <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-neutral-50 transition"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 font-bold text-sm">
                        {milestone.order}
                    </div>
                    <div>
                        <h4 className="font-semibold text-neutral-800">{milestone.name}</h4>
                        <p className="text-xs text-neutral-500">{milestone.tasks.length} tasks</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onGeneratePrompts();
                        }}
                        disabled={isGeneratingPrompt}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-50 text-purple-600 hover:bg-purple-100 rounded-md transition disabled:opacity-50"
                        title="Generate coding agent prompts for this milestone"
                    >
                        <Terminal size={12} className={isGeneratingPrompt ? 'animate-pulse' : ''} />
                        {isGeneratingPrompt ? 'Generating...' : 'Agent Prompts'}
                    </button>
                    <button className="text-neutral-400" title={isExpanded ? 'Collapse' : 'Expand'} aria-label={isExpanded ? 'Collapse milestone' : 'Expand milestone'}>
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                </div>
            </div>

            {/* Description */}
            {isExpanded && (
                <>
                    <div className="px-4 pb-3 border-t border-neutral-100">
                        <p className="text-sm text-neutral-600 pt-3">{milestone.description}</p>
                    </div>

                    {/* Task List */}
                    <div className="px-4 pb-4">
                        <div className="space-y-2">
                            {milestone.tasks.map(task => {
                                const { icon: StatusIcon, color } = statusConfig[task.status];
                                return (
                                    <div key={task.id} className="flex items-start gap-2.5 py-1.5">
                                        <StatusIcon size={16} className={`${color} mt-0.5 shrink-0`} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-neutral-700 font-medium">{task.name}</p>
                                            <p className="text-xs text-neutral-500">{task.description}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
