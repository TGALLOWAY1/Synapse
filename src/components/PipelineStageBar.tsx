import { FileText, Image, Package, Clock } from 'lucide-react';
import type { PipelineStage } from '../types';

interface PipelineStageBarProps {
    currentStage: PipelineStage;
    onStageChange: (stage: PipelineStage) => void;
    hasPRD: boolean;
}

const stages: { key: PipelineStage; label: string; icon: typeof FileText }[] = [
    { key: 'prd', label: 'PRD', icon: FileText },
    { key: 'mockups', label: 'Mockups', icon: Image },
    { key: 'artifacts', label: 'Artifacts', icon: Package },
    { key: 'history', label: 'History', icon: Clock },
];

export function PipelineStageBar({ currentStage, onStageChange, hasPRD }: PipelineStageBarProps) {
    const isEnabled = (stage: PipelineStage): boolean => {
        if (stage === 'prd' || stage === 'history') return true;
        if (stage === 'mockups' || stage === 'artifacts') return hasPRD;
        return false;
    };

    return (
        <div className="flex items-center gap-1 px-4 py-2 bg-neutral-900 border-b border-neutral-800">
            {stages.map((stage) => {
                const enabled = isEnabled(stage.key);
                const active = currentStage === stage.key;
                const Icon = stage.icon;

                return (
                    <button
                        key={stage.key}
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
                );
            })}
        </div>
    );
}
