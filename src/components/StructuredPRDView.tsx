import { useState, useEffect, useRef } from 'react';
import { Pencil, Check, X, Plus, Trash2 } from 'lucide-react';
import Mark from 'mark.js';
import { useProjectStore } from '../store/projectStore';
import { structuredPRDToMarkdown, replyInBranch } from '../lib/llmProvider';
import { FeatureCard } from './FeatureCard';
import { v4 as uuidv4 } from 'uuid';
import type { StructuredPRD, Feature } from '../types';

interface StructuredPRDViewProps {
    projectId: string;
    spineId: string;
    structuredPRD: StructuredPRD;
    readOnly: boolean;
}

type EditingSection = 'vision' | 'targetUsers' | 'coreProblem' | 'architecture' | 'risks' | null;

export function StructuredPRDView({ projectId, spineId, structuredPRD, readOnly }: StructuredPRDViewProps) {
    const { updateSpineStructuredPRD, createBranch, addBranchMessage, branches } = useProjectStore();
    const [editingSection, setEditingSection] = useState<EditingSection>(null);
    const [editValue, setEditValue] = useState('');
    const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);
    const [intent, setIntent] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);

    // Get active branches for this spine to highlight their anchors
    const activeBranches = (branches[projectId] || []).filter(b => b.spineVersionId === spineId && b.status === 'active');

    // Highlight branch anchors with mark.js
    useEffect(() => {
        if (!contentRef.current) return;
        const instance = new Mark(contentRef.current);
        instance.unmark();

        activeBranches.forEach(b => {
            if (!b.anchorText) return;
            instance.mark(b.anchorText, {
                className: '!bg-indigo-500/20 !text-inherit !border-l-2 !border-indigo-500 !p-0.5 !rounded',
                accuracy: 'partially',
                separateWordSearch: false,
                diacritics: false,
                acrossElements: true,
            });
        });

        return () => instance.unmark();
    }, [structuredPRD, activeBranches]);

    // Escape to dismiss popover
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && selection) {
                setSelection(null);
                setIntent('');
                window.getSelection()?.removeAllRanges();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selection]);

    const getIntentHelper = (intentStr: string) => {
        if (!intentStr) return null;
        const lower = intentStr.toLowerCase();
        let helper = '';
        if (lower.startsWith('clarify')) helper = 'Ask for precision, fix ambiguity, or correct a specific detail tied to this text.';
        else if (lower.startsWith('expand')) helper = 'Add depth or options. Generate UX ideas, NB3 prompts, or elaborations.';
        else if (lower.startsWith('specify')) helper = 'Turn this into implementable requirements: constraints, acceptance criteria, data/API details.';
        else if (lower.startsWith('alternative')) helper = 'Propose a different approach or architecture and explain tradeoffs.';
        else if (lower.startsWith('replace')) helper = 'Suggest a concrete change. The system will apply locally or across the document during consolidation.';
        if (!helper) return null;
        return (
            <div className="text-xs text-neutral-400 italic leading-snug bg-neutral-800/50 p-2 rounded border border-neutral-700/50 mb-2">
                {helper}
            </div>
        );
    };

    const handleMouseUp = () => {
        if (readOnly || editingSection) return;
        setTimeout(() => {
            const sel = window.getSelection();
            if (sel && sel.toString().trim().length > 0 && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                const rect = range.getBoundingClientRect();

                // Clamp popover to viewport bounds (320px = w-80 popover width)
                const popoverWidth = 320;
                const popoverHeight = 220;
                const rawLeft = rect.left + (rect.width / 2);
                const rawTop = rect.bottom + 8;

                const clampedLeft = Math.max(popoverWidth / 2 + 8, Math.min(rawLeft, window.innerWidth - popoverWidth / 2 - 8));
                const clampedTop = rawTop + popoverHeight > window.innerHeight
                    ? rect.top - popoverHeight - 8
                    : rawTop;

                setSelection({
                    text: sel.toString().trim(),
                    top: Math.max(8, clampedTop),
                    left: clampedLeft,
                });
            } else if (!isSubmitting) {
                setSelection(null);
            }
        }, 10);
    };

    const handleCreateBranch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selection || !intent.trim() || isSubmitting) return;
        try {
            setIsSubmitting(true);
            const anchorText = selection.text;
            const userIntent = intent.trim();
            const { branchId } = createBranch(projectId, spineId, anchorText, userIntent);
            setSelection(null);
            setIntent('');
            window.getSelection()?.removeAllRanges();
            const response = await replyInBranch({ anchorText, intent: userIntent, threadHistory: [] });
            addBranchMessage(projectId, branchId, 'assistant', response);
        } finally {
            setIsSubmitting(false);
        }
    };

    const savePRD = (updated: StructuredPRD) => {
        const markdown = structuredPRDToMarkdown(updated);
        updateSpineStructuredPRD(projectId, spineId, updated, markdown);
    };

    const startEditing = (section: EditingSection, currentValue: string) => {
        if (readOnly) return;
        setEditingSection(section);
        setEditValue(currentValue);
    };

    const cancelEditing = () => {
        setEditingSection(null);
        setEditValue('');
    };

    const saveTextSection = (section: 'vision' | 'coreProblem' | 'architecture') => {
        const updated = { ...structuredPRD, [section]: editValue };
        savePRD(updated);
        setEditingSection(null);
    };

    const saveListSection = (section: 'targetUsers' | 'risks') => {
        const items = editValue.split('\n').map(s => s.trim()).filter(Boolean);
        const updated = { ...structuredPRD, [section]: items };
        savePRD(updated);
        setEditingSection(null);
    };

    const handleFeatureUpdate = (updatedFeature: Feature) => {
        const updated = {
            ...structuredPRD,
            features: structuredPRD.features.map(f => f.id === updatedFeature.id ? updatedFeature : f),
        };
        savePRD(updated);
    };

    const handleAddFeature = () => {
        const newFeature: Feature = {
            id: uuidv4(),
            name: 'New Feature',
            description: '',
            userValue: '',
            complexity: 'medium',
        };
        const updated = { ...structuredPRD, features: [...structuredPRD.features, newFeature] };
        savePRD(updated);
    };

    const handleDeleteFeature = (featureId: string) => {
        const updated = {
            ...structuredPRD,
            features: structuredPRD.features.filter(f => f.id !== featureId),
        };
        savePRD(updated);
    };

    const renderTextSection = (
        title: string,
        section: 'vision' | 'coreProblem' | 'architecture',
        content: string,
    ) => (
        <div className="mb-8">
            <div className="flex items-center justify-between mb-3 border-b border-neutral-200 pb-2">
                <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight">{title}</h3>
                {!readOnly && editingSection !== section && (
                    <button
                        onClick={() => startEditing(section, content)}
                        className="p-1 text-neutral-300 hover:text-neutral-500 transition"
                        title={`Edit ${title.toLowerCase()}`}
                        aria-label={`Edit ${title.toLowerCase()}`}
                    >
                        <Pencil size={14} />
                    </button>
                )}
            </div>
            {editingSection === section ? (
                <div className="space-y-2">
                    <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-full bg-neutral-50 border border-indigo-200 rounded-lg px-4 py-3 text-sm text-neutral-700 focus:outline-none focus:border-indigo-400 min-h-[80px]"
                        autoFocus
                    />
                    <div className="flex justify-end gap-2">
                        <button onClick={cancelEditing} className="p-1.5 text-neutral-400 hover:text-neutral-600" title="Cancel" aria-label="Cancel editing">
                            <X size={16} />
                        </button>
                        <button onClick={() => saveTextSection(section)} className="p-1.5 text-indigo-500 hover:text-indigo-700" title="Save" aria-label="Save changes">
                            <Check size={16} />
                        </button>
                    </div>
                </div>
            ) : (
                <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-lg text-sm text-neutral-700 whitespace-pre-wrap">
                    {content}
                </div>
            )}
        </div>
    );

    const renderListSection = (
        title: string,
        section: 'targetUsers' | 'risks',
        items: string[],
    ) => (
        <div className="mb-8">
            <div className="flex items-center justify-between mb-3 border-b border-neutral-200 pb-2">
                <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight">{title}</h3>
                {!readOnly && editingSection !== section && (
                    <button
                        onClick={() => startEditing(section, items.join('\n'))}
                        className="p-1 text-neutral-300 hover:text-neutral-500 transition"
                        title={`Edit ${title.toLowerCase()}`}
                        aria-label={`Edit ${title.toLowerCase()}`}
                    >
                        <Pencil size={14} />
                    </button>
                )}
            </div>
            {editingSection === section ? (
                <div className="space-y-2">
                    <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-full bg-neutral-50 border border-indigo-200 rounded-lg px-4 py-3 text-sm text-neutral-700 focus:outline-none focus:border-indigo-400 min-h-[80px]"
                        placeholder="One item per line"
                        autoFocus
                    />
                    <div className="flex justify-end gap-2">
                        <button onClick={cancelEditing} className="p-1.5 text-neutral-400 hover:text-neutral-600" title="Cancel" aria-label="Cancel editing">
                            <X size={16} />
                        </button>
                        <button onClick={() => saveListSection(section)} className="p-1.5 text-indigo-500 hover:text-indigo-700" title="Save" aria-label="Save changes">
                            <Check size={16} />
                        </button>
                    </div>
                </div>
            ) : (
                <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-lg">
                    <ul className="space-y-1">
                        {items.map((item, i) => (
                            <li key={i} className="text-sm text-neutral-700 flex items-start gap-2">
                                <span className="text-neutral-400 mt-0.5">-</span>
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );

    return (
        <div className="relative" onMouseUp={handleMouseUp}>
            <div ref={contentRef} className="space-y-2">
                {renderTextSection('Vision', 'vision', structuredPRD.vision)}
                {renderListSection('Target Users', 'targetUsers', structuredPRD.targetUsers)}
                {renderTextSection('Core Problem', 'coreProblem', structuredPRD.coreProblem)}

                {/* Features */}
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-4 border-b border-neutral-200 pb-2">
                        <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight">Features</h3>
                        {!readOnly && (
                            <button
                                onClick={handleAddFeature}
                                className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 transition"
                            >
                                <Plus size={14} />
                                Add Feature
                            </button>
                        )}
                    </div>
                    <div className="space-y-3">
                        {structuredPRD.features.map(feature => (
                            <div key={feature.id} className="relative group/feature">
                                <FeatureCard
                                    feature={feature}
                                    onUpdate={handleFeatureUpdate}
                                    readOnly={readOnly}
                                />
                                {!readOnly && (
                                    <button
                                        onClick={() => {
                                            if (window.confirm(`Delete feature "${feature.name}"?`)) {
                                                handleDeleteFeature(feature.id);
                                            }
                                        }}
                                        className="absolute -right-2 -top-2 p-1 bg-white border border-neutral-200 rounded-full text-neutral-300 hover:text-red-500 opacity-0 group-hover/feature:opacity-100 transition shadow-sm"
                                        title="Delete feature"
                                        aria-label="Delete feature"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {renderTextSection('Architecture', 'architecture', structuredPRD.architecture)}
                {renderListSection('Risks', 'risks', structuredPRD.risks)}
            </div>

            {selection && (
                <div
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseUp={(e) => e.stopPropagation()}
                    className="fixed z-50 bg-neutral-900 border border-neutral-700 shadow-2xl rounded-xl p-4 w-[340px] -translate-x-1/2 flex flex-col gap-3"
                    style={{ top: selection.top, left: selection.left }}
                >
                    <div className="text-xs text-neutral-400">
                        <span className="font-semibold text-neutral-300">Anchor:</span> "{selection.text.length > 50 ? selection.text.substring(0, 50) + '...' : selection.text}"
                    </div>

                    <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
                        {['Clarify', 'Expand', 'Specify', 'Alternative', 'Replace'].map(tag => (
                            <button
                                key={tag}
                                type="button"
                                onClick={() => setIntent(tag + ": ")}
                                className="text-xs px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-full border border-neutral-700 hover:border-neutral-500 transition shadow-sm"
                            >
                                {tag}
                            </button>
                        ))}
                    </div>

                    {getIntentHelper(intent)}

                    <form onSubmit={handleCreateBranch} className="flex gap-2">
                        <input
                            autoFocus
                            type="text"
                            value={intent}
                            onChange={e => setIntent(e.target.value)}
                            placeholder="How should this change?"
                            className="flex-1 bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 rounded px-2 py-1.5 outline-none focus:border-indigo-500 transition"
                            disabled={isSubmitting}
                        />
                        <button
                            type="submit"
                            disabled={isSubmitting || !intent.trim()}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-3 py-1.5 rounded transition disabled:opacity-50"
                        >
                            {isSubmitting ? '...' : 'Branch'}
                        </button>
                    </form>
                </div>
            )}
        </div>
    );
}
