import { useState } from 'react';
import { RefreshCcw, ListChecks } from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import { generateDevPlan } from '../lib/llmProvider';
import { generateAgentPrompt as generateAgentPromptLLM, structuredPRDToMarkdown } from '../lib/llmProvider';
import { MilestoneCard } from './MilestoneCard';
import type { StructuredPRD, PipelineStage, AgentTarget } from '../types';

interface DevPlanViewProps {
    projectId: string;
    structuredPRD: StructuredPRD;
    spineVersionId: string;
    onStageChange: (stage: PipelineStage) => void;
}

export function DevPlanView({ projectId, structuredPRD, spineVersionId, onStageChange }: DevPlanViewProps) {
    const { createDevPlan, getLatestDevPlan, createAgentPrompt } = useProjectStore();
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [generatingMilestoneId, setGeneratingMilestoneId] = useState<string | null>(null);

    const latestPlan = getLatestDevPlan(projectId);

    const handleGenerate = async () => {
        setIsGenerating(true);
        setError(null);
        try {
            const milestones = await generateDevPlan(structuredPRD);
            createDevPlan(projectId, spineVersionId, milestones);
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            setError(errorMsg);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleGeneratePrompts = async (milestoneId: string) => {
        if (!latestPlan) return;
        const milestone = latestPlan.milestones.find(m => m.id === milestoneId);
        if (!milestone) return;

        setGeneratingMilestoneId(milestoneId);
        const prdContext = structuredPRDToMarkdown(structuredPRD);
        const targets: AgentTarget[] = ['cursor', 'claude', 'codex', 'copilot'];

        try {
            for (const target of targets) {
                const result = await generateAgentPromptLLM(
                    { name: milestone.name, description: milestone.description, tasks: milestone.tasks },
                    target,
                    prdContext
                );

                createAgentPrompt(projectId, {
                    projectId,
                    devPlanId: latestPlan.id,
                    milestoneId: milestone.id,
                    target,
                    branchName: result.branchName,
                    objective: result.objective,
                    tasks: result.tasks,
                    constraints: result.constraints,
                    verificationSteps: result.verificationSteps,
                    rawPromptText: result.rawPromptText,
                });
            }
            onStageChange('prompts');
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            setError(`Failed to generate prompts: ${errorMsg}`);
        } finally {
            setGeneratingMilestoneId(null);
        }
    };

    if (!latestPlan) {
        return (
            <div className="flex flex-col items-center justify-center text-center py-20">
                <div className="bg-blue-50 p-4 rounded-full mb-6">
                    <ListChecks size={32} className={`text-blue-500 ${isGenerating ? 'animate-pulse' : ''}`} />
                </div>
                <h3 className="text-xl font-medium text-neutral-800 mb-2">
                    {isGenerating ? 'Generating Development Plan...' : 'Generate Development Plan'}
                </h3>
                <p className="text-neutral-500 max-w-md mb-8">
                    {isGenerating
                        ? 'Creating a milestone-based roadmap from your finalized PRD.'
                        : 'Transform your PRD into a structured, milestone-based development roadmap with actionable tasks.'}
                </p>

                {error && (
                    <div className="mb-6 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600 max-w-md">
                        {error}
                    </div>
                )}

                {!isGenerating && (
                    <button
                        onClick={handleGenerate}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-medium shadow-sm transition flex items-center gap-2"
                    >
                        Generate Dev Plan
                        <RefreshCcw size={16} />
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider">
                    Development Roadmap
                </h3>
                <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 transition disabled:opacity-50"
                >
                    <RefreshCcw size={12} className={isGenerating ? 'animate-spin' : ''} />
                    Regenerate
                </button>
            </div>

            {error && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">
                    {error}
                </div>
            )}

            {/* Milestone Timeline */}
            <div className="relative">
                {/* Vertical timeline line */}
                <div className="absolute left-[1.45rem] top-8 bottom-4 w-0.5 bg-neutral-200" />

                <div className="space-y-4 relative">
                    {latestPlan.milestones
                        .slice()
                        .sort((a, b) => a.order - b.order)
                        .map(milestone => (
                            <MilestoneCard
                                key={milestone.id}
                                milestone={milestone}
                                isGeneratingPrompt={generatingMilestoneId === milestone.id}
                                onGeneratePrompts={() => handleGeneratePrompts(milestone.id)}
                            />
                        ))
                    }
                </div>
            </div>
        </div>
    );
}
