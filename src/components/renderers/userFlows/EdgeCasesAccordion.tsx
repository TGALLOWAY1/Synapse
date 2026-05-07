import { ChevronDown } from 'lucide-react';
import type { ViewMode } from './types';
import { blockMd, inlineMd } from './markdown';

interface Props {
    edgeCases?: string;
    viewMode: ViewMode;
}

function splitItems(block: string): string[] {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const items: string[] = [];
    let buffer = '';
    for (const line of lines) {
        if (/^[-*]\s+/.test(line)) {
            if (buffer) items.push(buffer);
            buffer = line.replace(/^[-*]\s+/, '');
        } else if (buffer) {
            buffer += ' ' + line;
        } else {
            items.push(line);
        }
    }
    if (buffer) items.push(buffer);
    return items;
}

export function EdgeCasesAccordion({ edgeCases, viewMode }: Props) {
    if (!edgeCases) return null;
    const items = splitItems(edgeCases);
    const isList = items.length > 1;
    const defaultOpen = viewMode === 'debug';

    return (
        <details
            className="group bg-white rounded-xl border border-neutral-200 mb-4"
            open={defaultOpen}
        >
            <summary className="flex items-center justify-between cursor-pointer list-none px-4 py-3 select-none">
                <span className="text-sm font-semibold text-neutral-700">
                    Edge cases
                    {isList && (
                        <span className="ml-1.5 text-xs font-normal text-neutral-500">
                            · {items.length} {items.length === 1 ? 'item' : 'items'}
                        </span>
                    )}
                </span>
                <ChevronDown
                    size={16}
                    className="text-neutral-400 transition-transform group-open:rotate-180"
                />
            </summary>
            <div className="px-4 pb-4 pt-1 text-sm text-neutral-700">
                {isList ? (
                    <ul className="space-y-1.5">
                        {items.map((item, i) => (
                            <li key={i} className="flex gap-2">
                                <span className="text-neutral-400">•</span>
                                <div className="min-w-0 flex-1">{inlineMd(item)}</div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    blockMd(edgeCases)
                )}
            </div>
        </details>
    );
}
