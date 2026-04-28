import { useState } from 'react';
import { Pencil, Check, X } from 'lucide-react';
import type { Feature } from '../types';
import { MvpTag } from './prd/PremiumSections';

interface FeatureCardProps {
    feature: Feature;
    onUpdate: (updated: Feature) => void;
    readOnly: boolean;
}

export function FeatureCard({ feature, onUpdate, readOnly }: FeatureCardProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(feature.name);
    const [editDescription, setEditDescription] = useState(feature.description);
    const [editUserValue, setEditUserValue] = useState(feature.userValue);

    const handleSave = () => {
        onUpdate({
            ...feature,
            name: editName,
            description: editDescription,
            userValue: editUserValue,
        });
        setIsEditing(false);
    };

    const handleCancel = () => {
        setEditName(feature.name);
        setEditDescription(feature.description);
        setEditUserValue(feature.userValue);
        setIsEditing(false);
    };

    if (isEditing) {
        return (
            <div className="p-4 bg-white border border-indigo-200 rounded-lg shadow-sm">
                <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full font-semibold text-neutral-800 bg-neutral-50 border border-neutral-200 rounded px-3 py-1.5 mb-3 focus:outline-none focus:border-indigo-400"
                    placeholder="Feature name"
                />
                <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 rounded px-3 py-1.5 mb-3 min-h-[60px] focus:outline-none focus:border-indigo-400"
                    placeholder="Description"
                />
                <input
                    type="text"
                    value={editUserValue}
                    onChange={(e) => setEditUserValue(e.target.value)}
                    className="w-full text-sm text-neutral-600 bg-neutral-50 border border-neutral-200 rounded px-3 py-1.5 mb-3 focus:outline-none focus:border-indigo-400"
                    placeholder="User value"
                />
                <div className="flex items-center justify-end gap-2">
                    <button onClick={handleCancel} className="p-1.5 text-neutral-400 hover:text-neutral-600 transition" title="Cancel" aria-label="Cancel editing">
                        <X size={16} />
                    </button>
                    <button onClick={handleSave} className="p-1.5 text-indigo-500 hover:text-indigo-700 transition" title="Save" aria-label="Save changes">
                        <Check size={16} />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="group p-4 bg-white border border-neutral-200 rounded-lg hover:border-neutral-300 transition">
            <div className="flex items-start justify-between mb-2 gap-2">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <h4 className="font-semibold text-neutral-800">{feature.name}</h4>
                    <MvpTag tier={feature.tier} />
                </div>
                {!readOnly && (
                    <button
                        onClick={() => setIsEditing(true)}
                        className="p-1 text-neutral-300 hover:text-neutral-500 opacity-0 group-hover:opacity-100 transition shrink-0"
                        title="Edit feature"
                        aria-label="Edit feature"
                    >
                        <Pencil size={14} />
                    </button>
                )}
            </div>
            <p className="text-sm text-neutral-600 mb-2">{feature.description}</p>
            <p className="text-xs text-neutral-500 mb-2">
                <span className="font-medium">User Value:</span> {feature.userValue}
            </p>
            {(feature.successCriteria?.length || feature.edgeCases?.length || feature.failureModes?.length || feature.uiAcceptanceCriteria?.length) && (
                <div className="mt-3 pt-3 border-t border-neutral-100 grid sm:grid-cols-2 gap-3 text-xs">
                    {feature.successCriteria?.length ? (
                        <div>
                            <p className="font-semibold text-emerald-700 uppercase tracking-wider text-[10px] mb-1">Success</p>
                            <ul className="list-disc pl-4 space-y-0.5 text-neutral-700">
                                {feature.successCriteria.map((c, i) => <li key={i}>{c}</li>)}
                            </ul>
                        </div>
                    ) : null}
                    {feature.edgeCases?.length ? (
                        <div>
                            <p className="font-semibold text-amber-700 uppercase tracking-wider text-[10px] mb-1">Edge cases</p>
                            <ul className="list-disc pl-4 space-y-0.5 text-neutral-700">
                                {feature.edgeCases.map((c, i) => <li key={i}>{c}</li>)}
                            </ul>
                        </div>
                    ) : null}
                    {feature.failureModes?.length ? (
                        <div>
                            <p className="font-semibold text-red-700 uppercase tracking-wider text-[10px] mb-1">Failure modes</p>
                            <ul className="list-disc pl-4 space-y-0.5 text-neutral-700">
                                {feature.failureModes.map((c, i) => <li key={i}>{c}</li>)}
                            </ul>
                        </div>
                    ) : null}
                    {feature.uiAcceptanceCriteria?.length ? (
                        <div>
                            <p className="font-semibold text-indigo-700 uppercase tracking-wider text-[10px] mb-1">UI behavior</p>
                            <ul className="list-disc pl-4 space-y-0.5 text-neutral-700">
                                {feature.uiAcceptanceCriteria.map((c, i) => <li key={i}>{c}</li>)}
                            </ul>
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}
