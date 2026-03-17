import { FileText, ListChecks, Terminal, ChevronRight } from 'lucide-react';
import type { PipelineStage } from '../types';

interface PipelineStageBarProps {
    currentStage: PipelineStage;
    onStageChange: (stage: PipelineStage) => void;
    hasPRD: boolean;
    hasDevPlan: boolean;
}

const stages: { key: PipelineStage; label: string; icon: typeof FileText }[] = [
    { key: 'prd', label: 'PRD', icon: FileText },
    { key: 'devplan', label: 'Dev Plan', icon: ListChecks },
    { key: 'prompts', label: 'Agent Prompts', icon: Terminal },
];

export function PipelineStageBar({ currentStage, onStageChange, hasPRD, hasDevPlan }: PipelineStageBarProps) {
    const isEnabled = (stage: PipelineStage): boolean => {
        if (stage === 'prd') return true;
        if (stage === 'devplan') return hasPRD;
        if (stage === 'prompts') return hasDevPlan;
        return false;
    };

    return (
        <div className="flex items-center gap-1 px-4 py-2 bg-neutral-900 border-b border-neutral-800">
            {stages.map((stage, index) => {
                const enabled = isEnabled(stage.key);
                const active = currentStage === stage.key;
                const Icon = stage.icon;

                return (
                    <div key={stage.key} className="flex items-center">
                        {index > 0 && (
                            <ChevronRight size={14} className="text-neutral-600 mx-1" />
                        )}
                        <button
                            onClick={() => enabled && onStageChange(stage.key)}
                            disabled={!enabled}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition ${
                                active
                                    ? 'bg-indigo-600 text-white'
                                    : enabled
                                        ? 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                                        : 'text-neutral-600 cursor-not-allowed'
                            }`}
                        >
                            <Icon size={14} />
                            {stage.label}
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
