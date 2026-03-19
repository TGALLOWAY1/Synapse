import { useState } from 'react';
import { X } from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import type { FeedbackType, ArtifactType } from '../types';

interface FeedbackModalProps {
    projectId: string;
    sourceArtifactVersionId: string;
    onClose: () => void;
}

const FEEDBACK_TYPES: { value: FeedbackType; label: string; description: string }[] = [
    { value: 'feature_addition', label: 'Feature Addition', description: 'A new feature idea or capability' },
    { value: 'workflow_refinement', label: 'Workflow Refinement', description: 'Improvement to an existing flow' },
    { value: 'ia_navigation', label: 'IA / Navigation', description: 'Information architecture or navigation issue' },
    { value: 'missing_state', label: 'Missing State', description: 'Missing empty, error, or loading state' },
    { value: 'visual_system', label: 'Visual System', description: 'Design system or visual pattern idea' },
    { value: 'ambiguous_requirement', label: 'Ambiguous Requirement', description: 'Unclear or underspecified requirement' },
    { value: 'implementation_consideration', label: 'Implementation', description: 'Technical implementation concern' },
    { value: 'naming_wording', label: 'Naming / Wording', description: 'Naming or copy improvement' },
];

const TARGET_TYPES: { value: ArtifactType; label: string }[] = [
    { value: 'prd', label: 'PRD' },
    { value: 'mockup', label: 'Mockup' },
    { value: 'core_artifact', label: 'Core Artifact' },
];

export function FeedbackModal({ projectId, sourceArtifactVersionId, onClose }: FeedbackModalProps) {
    const { createFeedbackItem } = useProjectStore();
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [type, setType] = useState<FeedbackType>('feature_addition');
    const [target, setTarget] = useState<ArtifactType>('prd');

    const handleSubmit = () => {
        if (!title.trim()) return;
        createFeedbackItem(projectId, sourceArtifactVersionId, type, title.trim(), description.trim(), target);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-5" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-neutral-900">Extract Feedback</h3>
                    <button onClick={onClose} className="p-1 hover:bg-neutral-100 rounded-md transition">
                        <X size={18} className="text-neutral-400" />
                    </button>
                </div>

                <div>
                    <label className="block text-xs font-medium text-neutral-500 mb-1.5">Title</label>
                    <input
                        type="text"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="Brief description of the insight..."
                        className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        autoFocus
                    />
                </div>

                <div>
                    <label className="block text-xs font-medium text-neutral-500 mb-1.5">Description</label>
                    <textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        placeholder="Detailed explanation of the feedback..."
                        rows={3}
                        className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                    />
                </div>

                <div>
                    <label className="block text-xs font-medium text-neutral-500 mb-1.5">Feedback Type</label>
                    <div className="grid grid-cols-2 gap-1.5">
                        {FEEDBACK_TYPES.map(ft => (
                            <button
                                key={ft.value}
                                onClick={() => setType(ft.value)}
                                className={`text-left px-3 py-2 rounded-md text-xs transition ${
                                    type === ft.value
                                        ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium'
                                        : 'text-neutral-600 hover:bg-neutral-50 border border-transparent'
                                }`}
                            >
                                <div className="font-medium">{ft.label}</div>
                                <div className="text-[10px] opacity-70 mt-0.5">{ft.description}</div>
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-medium text-neutral-500 mb-1.5">Target</label>
                    <div className="flex gap-2">
                        {TARGET_TYPES.map(tt => (
                            <button
                                key={tt.value}
                                onClick={() => setTarget(tt.value)}
                                className={`px-3 py-1.5 rounded-md text-sm transition ${
                                    target === tt.value
                                        ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium'
                                        : 'text-neutral-500 hover:bg-neutral-50 border border-neutral-200'
                                }`}
                            >
                                {tt.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                    <button
                        onClick={handleSubmit}
                        disabled={!title.trim()}
                        className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50"
                    >
                        Create Feedback
                    </button>
                    <button onClick={onClose} className="px-4 py-2 text-neutral-500 hover:text-neutral-700 text-sm transition">
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}
