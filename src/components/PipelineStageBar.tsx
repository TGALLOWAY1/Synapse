import { FileText, Package, Clock, ShieldCheck } from 'lucide-react';
import type { PipelineStage } from '../types';

interface PipelineStageBarProps {
    currentStage: PipelineStage;
    onStageChange: (stage: PipelineStage) => void;
    canExploreOutputs: boolean;
    isPlanCommitted: boolean;
    canReview?: boolean;
}

const stages: { key: PipelineStage; label: string; description: string; icon: typeof FileText }[] = [
    { key: 'prd', label: 'Plan', description: 'The working product plan, its reasoning state, and the most valuable next step', icon: FileText },
    { key: 'review', label: 'Challenge', description: 'Decisions and adversarial review of the current working plan', icon: ShieldCheck },
    { key: 'workspace', label: 'Build', description: 'Explore or review downstream outputs without confusing generation with readiness', icon: Package },
    { key: 'history', label: 'History', description: 'Chronological timeline of changes', icon: Clock },
];

export function PipelineStageBar({ currentStage, onStageChange, canExploreOutputs, isPlanCommitted, canReview = canExploreOutputs }: PipelineStageBarProps) {
    const isEnabled = (stage: PipelineStage): boolean => {
        if (stage === 'prd' || stage === 'history') return true;
        if (stage === 'review') return canReview;
        if (stage === 'workspace') return canExploreOutputs;
        return false;
    };

    // Legacy currentStage values ('mockups', 'artifacts') route to the
    // workspace tab so its highlighting stays correct during the brief
    // window before the rehydrate migration runs.
    const activeKey: PipelineStage =
        currentStage === 'mockups' || currentStage === 'artifacts'
            ? 'workspace'
            : currentStage;

    return (
        <div className="flex items-center gap-1 px-4 py-2 bg-neutral-900 border-b border-neutral-800">
            {stages.map((stage) => {
                const enabled = isEnabled(stage.key);
                const active = activeKey === stage.key;
                const Icon = stage.icon;
                const label = stage.key === 'workspace' && !isPlanCommitted ? 'Explore' : stage.label;

                return (
                    <button
                        key={stage.key}
                        onClick={() => enabled && onStageChange(stage.key)}
                        disabled={!enabled}
                        title={stage.description}
                        aria-label={`${label}: ${stage.description}`}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition ${
                            active
                                ? 'bg-indigo-600 text-white'
                                : enabled
                                    ? 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                                    : 'text-neutral-600 cursor-not-allowed'
                        }`}
                    >
                        <Icon size={14} />
                        {label}
                    </button>
                );
            })}
        </div>
    );
}
