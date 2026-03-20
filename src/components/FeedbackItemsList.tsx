import { MessageSquare, Check, X, ArrowRight } from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import type { FeedbackItem, FeedbackType } from '../types';

interface FeedbackItemsListProps {
    projectId: string;
    onApplyToPRD?: (feedback: FeedbackItem) => void;
}

const TYPE_LABELS: Record<FeedbackType, string> = {
    feature_addition: 'Feature',
    workflow_refinement: 'Workflow',
    ia_navigation: 'IA/Nav',
    missing_state: 'Missing State',
    visual_system: 'Visual',
    ambiguous_requirement: 'Ambiguous',
    implementation_consideration: 'Implementation',
    naming_wording: 'Naming',
};



export function FeedbackItemsList({ projectId, onApplyToPRD }: FeedbackItemsListProps) {
    const { getFeedbackItems, updateFeedbackStatus } = useProjectStore();
    const allItems = getFeedbackItems(projectId);
    const openItems = allItems.filter(f => f.status === 'open' || f.status === 'accepted');

    if (openItems.length === 0) return null;

    return (
        <div className="bg-amber-50/50 rounded-xl border border-amber-200 p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
                <MessageSquare size={16} className="text-amber-600" />
                <h3 className="text-sm font-bold text-amber-800">
                    Open Feedback ({openItems.length})
                </h3>
            </div>
            <div className="space-y-2">
                {openItems.map(item => (
                    <div key={item.id} className="bg-white rounded-lg border border-amber-100 p-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium text-neutral-800">{item.title}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500 font-medium">
                                    {TYPE_LABELS[item.type]}
                                </span>
                            </div>
                            {item.description && (
                                <p className="text-xs text-neutral-500 line-clamp-2">{item.description}</p>
                            )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            {onApplyToPRD && (
                                <button
                                    onClick={() => onApplyToPRD(item)}
                                    className="flex items-center gap-1 px-2 py-1 text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded transition"
                                    title="Apply to PRD"
                                >
                                    <ArrowRight size={12} />
                                    Apply
                                </button>
                            )}
                            <button
                                onClick={() => updateFeedbackStatus(projectId, item.id, 'incorporated')}
                                className="p-1 text-green-600 hover:bg-green-50 rounded transition"
                                title="Mark as incorporated"
                            >
                                <Check size={14} />
                            </button>
                            <button
                                onClick={() => updateFeedbackStatus(projectId, item.id, 'rejected')}
                                className="p-1 text-neutral-400 hover:bg-neutral-100 rounded transition"
                                title="Dismiss"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
