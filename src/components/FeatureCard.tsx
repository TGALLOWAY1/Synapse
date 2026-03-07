import { useState } from 'react';
import { Pencil, Check, X } from 'lucide-react';
import type { Feature } from '../types';

interface FeatureCardProps {
    feature: Feature;
    onUpdate: (updated: Feature) => void;
    readOnly: boolean;
}

const complexityColors = {
    low: 'bg-green-100 text-green-700 border-green-200',
    medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    high: 'bg-red-100 text-red-700 border-red-200',
};

export function FeatureCard({ feature, onUpdate, readOnly }: FeatureCardProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(feature.name);
    const [editDescription, setEditDescription] = useState(feature.description);
    const [editUserValue, setEditUserValue] = useState(feature.userValue);
    const [editComplexity, setEditComplexity] = useState(feature.complexity);

    const handleSave = () => {
        onUpdate({
            ...feature,
            name: editName,
            description: editDescription,
            userValue: editUserValue,
            complexity: editComplexity,
        });
        setIsEditing(false);
    };

    const handleCancel = () => {
        setEditName(feature.name);
        setEditDescription(feature.description);
        setEditUserValue(feature.userValue);
        setEditComplexity(feature.complexity);
        setIsEditing(false);
    };

    if (isEditing) {
        return (
            <div className="p-4 bg-white border border-blue-200 rounded-lg shadow-sm">
                <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full font-semibold text-neutral-800 bg-neutral-50 border border-neutral-200 rounded px-3 py-1.5 mb-3 focus:outline-none focus:border-blue-400"
                    placeholder="Feature name"
                />
                <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 rounded px-3 py-1.5 mb-3 min-h-[60px] focus:outline-none focus:border-blue-400"
                    placeholder="Description"
                />
                <input
                    type="text"
                    value={editUserValue}
                    onChange={(e) => setEditUserValue(e.target.value)}
                    className="w-full text-sm text-neutral-600 bg-neutral-50 border border-neutral-200 rounded px-3 py-1.5 mb-3 focus:outline-none focus:border-blue-400"
                    placeholder="User value"
                />
                <div className="flex items-center justify-between">
                    <select
                        value={editComplexity}
                        onChange={(e) => setEditComplexity(e.target.value as Feature['complexity'])}
                        className="text-xs bg-neutral-50 border border-neutral-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                    >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                    </select>
                    <div className="flex items-center gap-2">
                        <button onClick={handleCancel} className="p-1.5 text-neutral-400 hover:text-neutral-600 transition" title="Cancel" aria-label="Cancel editing">
                            <X size={16} />
                        </button>
                        <button onClick={handleSave} className="p-1.5 text-blue-500 hover:text-blue-700 transition" title="Save" aria-label="Save changes">
                            <Check size={16} />
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="group p-4 bg-white border border-neutral-200 rounded-lg hover:border-neutral-300 transition">
            <div className="flex items-start justify-between mb-2">
                <h4 className="font-semibold text-neutral-800">{feature.name}</h4>
                <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${complexityColors[feature.complexity]}`}>
                        {feature.complexity}
                    </span>
                    {!readOnly && (
                        <button
                            onClick={() => setIsEditing(true)}
                            className="p-1 text-neutral-300 hover:text-neutral-500 opacity-0 group-hover:opacity-100 transition"
                            title="Edit feature"
                            aria-label="Edit feature"
                        >
                            <Pencil size={14} />
                        </button>
                    )}
                </div>
            </div>
            <p className="text-sm text-neutral-600 mb-2">{feature.description}</p>
            <p className="text-xs text-neutral-500">
                <span className="font-medium">User Value:</span> {feature.userValue}
            </p>
        </div>
    );
}
