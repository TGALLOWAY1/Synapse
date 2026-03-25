import type { ScreenInventoryContent } from '../../types';

interface Props {
    content: string;
}

function tryParseScreenInventory(content: string): ScreenInventoryContent | null {
    // Try to detect if the content is a JSON screen inventory
    try {
        const parsed = JSON.parse(content);
        if (parsed.groups && Array.isArray(parsed.groups)) return parsed;
    } catch {
        // Not JSON — that's fine, render as markdown
    }
    return null;
}

export function ScreenInventoryRenderer({ content }: Props) {
    const structured = tryParseScreenInventory(content);

    // If we can't parse structured content, return null to fall back to markdown
    if (!structured) return null;

    return (
        <div className="space-y-6">
            {structured.groups.map((group, gi) => (
                <div key={gi}>
                    <h3 className="text-sm font-bold text-neutral-500 uppercase tracking-wider mb-3">{group.name}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {group.screens.map((screen, si) => (
                            <div key={si} className="bg-white rounded-lg border border-neutral-200 p-4 space-y-2">
                                <div className="flex items-center justify-between">
                                    <h4 className="font-semibold text-neutral-800 text-sm">{screen.name}</h4>
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                        screen.priority === 'core' ? 'bg-indigo-100 text-indigo-700'
                                        : screen.priority === 'secondary' ? 'bg-neutral-100 text-neutral-600'
                                        : 'bg-neutral-50 text-neutral-400'
                                    }`}>
                                        {screen.priority}
                                    </span>
                                </div>
                                <p className="text-xs text-neutral-600">{screen.purpose}</p>
                                {screen.components && screen.components.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                        {screen.components.map((c, ci) => (
                                            <span key={ci} className="text-xs bg-neutral-100 text-neutral-600 px-1.5 py-0.5 rounded">
                                                {c}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {(screen.navigationFrom?.length || screen.navigationTo?.length) ? (
                                    <p className="text-xs text-neutral-400">
                                        {screen.navigationFrom?.join(', ') || '?'} → here → {screen.navigationTo?.join(', ') || '?'}
                                    </p>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
