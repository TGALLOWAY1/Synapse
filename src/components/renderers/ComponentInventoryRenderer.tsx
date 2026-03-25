import type { ComponentInventoryContent } from '../../types';

interface Props {
    content: string;
}

function tryParseComponentInventory(content: string): ComponentInventoryContent | null {
    try {
        const parsed = JSON.parse(content);
        if (parsed.categories && Array.isArray(parsed.categories)) return parsed;
    } catch {
        // Not JSON
    }
    return null;
}

export function ComponentInventoryRenderer({ content }: Props) {
    const structured = tryParseComponentInventory(content);
    if (!structured) return null;

    return (
        <div className="space-y-6">
            {structured.categories.map((cat, ci) => (
                <div key={ci}>
                    <h3 className="text-sm font-bold text-neutral-500 uppercase tracking-wider mb-3">{cat.name}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {cat.components.map((comp, coi) => (
                            <div key={coi} className="bg-white rounded-lg border border-neutral-200 p-4 space-y-2">
                                <div className="flex items-center justify-between">
                                    <h4 className="font-semibold text-neutral-800 text-sm font-mono">{comp.name}</h4>
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                        comp.complexity === 'simple' ? 'bg-green-100 text-green-700'
                                        : comp.complexity === 'moderate' ? 'bg-amber-100 text-amber-700'
                                        : 'bg-red-100 text-red-700'
                                    }`}>
                                        {comp.complexity}
                                    </span>
                                </div>
                                <p className="text-xs text-neutral-600">{comp.purpose}</p>
                                {comp.props && comp.props.length > 0 && (
                                    <div>
                                        <span className="text-xs font-medium text-neutral-500">Props:</span>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            {comp.props.map((p, pi) => (
                                                <span key={pi} className="text-xs bg-neutral-100 text-neutral-600 px-1.5 py-0.5 rounded font-mono">
                                                    {p.name}: {p.type}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {comp.usedIn && comp.usedIn.length > 0 && (
                                    <p className="text-xs text-neutral-400">
                                        Used in: {comp.usedIn.join(', ')}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
