// Props rendered as a real table — never as paragraph or bullet text.
// Monospace is scoped to the prop name/type only. The wrapper scrolls
// horizontally on narrow screens so the table stays readable on mobile.

import type { ComponentItem } from '../../../types';

type Prop = NonNullable<ComponentItem['props']>[number];

export function PropsTable({ props }: { props: Prop[] }) {
    if (props.length === 0) return null;
    return (
        <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-xs border-collapse">
                <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-neutral-400 border-b border-neutral-200">
                        <th className="font-medium py-1.5 pr-3">Prop</th>
                        <th className="font-medium py-1.5 pr-3">Type</th>
                        <th className="font-medium py-1.5 pr-3 whitespace-nowrap">Required</th>
                        <th className="font-medium py-1.5">Description</th>
                    </tr>
                </thead>
                <tbody>
                    {props.map((p, i) => (
                        <tr key={i} className="border-b border-neutral-100 last:border-0 align-top">
                            <td className="py-1.5 pr-3 font-mono text-neutral-800 whitespace-nowrap">{p.name}</td>
                            <td className="py-1.5 pr-3 font-mono text-neutral-500 whitespace-nowrap">{p.type}</td>
                            <td className="py-1.5 pr-3 whitespace-nowrap">
                                {p.required === true ? (
                                    <span className="text-green-600 font-medium">Yes</span>
                                ) : p.required === false ? (
                                    <span className="text-neutral-400">No</span>
                                ) : (
                                    <span className="text-neutral-300">—</span>
                                )}
                            </td>
                            <td className="py-1.5 text-neutral-600">{p.description || '—'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
