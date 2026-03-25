import type { DataModelContent } from '../../types';

interface Props {
    content: string;
}

function tryParseDataModel(content: string): DataModelContent | null {
    try {
        const parsed = JSON.parse(content);
        if (parsed.entities && Array.isArray(parsed.entities)) return parsed;
    } catch {
        // Not JSON
    }
    return null;
}

export function DataModelRenderer({ content }: Props) {
    const structured = tryParseDataModel(content);
    if (!structured) return null;

    return (
        <div className="space-y-6">
            {structured.entities.map((entity, ei) => (
                <div key={ei} className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
                    <div className="bg-indigo-50 border-b border-indigo-100 px-4 py-2.5">
                        <h4 className="font-semibold text-indigo-800 text-sm">{entity.name}</h4>
                        <p className="text-xs text-indigo-600 mt-0.5">{entity.description}</p>
                    </div>
                    <div className="overflow-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="bg-neutral-50 text-neutral-500 uppercase tracking-wider">
                                    <th className="text-left px-3 py-2 font-medium">Field</th>
                                    <th className="text-left px-3 py-2 font-medium">Type</th>
                                    <th className="text-center px-3 py-2 font-medium">Req</th>
                                    <th className="text-left px-3 py-2 font-medium">Description</th>
                                </tr>
                            </thead>
                            <tbody>
                                {entity.fields.map((field, fi) => (
                                    <tr key={fi} className="border-t border-neutral-100">
                                        <td className="px-3 py-1.5 font-mono text-neutral-800">{field.name}</td>
                                        <td className="px-3 py-1.5 font-mono text-indigo-600">{field.type}</td>
                                        <td className="px-3 py-1.5 text-center">{field.required ? '✓' : ''}</td>
                                        <td className="px-3 py-1.5 text-neutral-600">{field.description}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {entity.relationships && entity.relationships.length > 0 && (
                        <div className="border-t border-neutral-100 px-4 py-2">
                            <span className="text-xs font-medium text-neutral-500">Relationships: </span>
                            {entity.relationships.map((r, ri) => (
                                <span key={ri} className="text-xs text-neutral-600">
                                    {ri > 0 ? ' · ' : ''}
                                    {r.type.replace(/_/g, ' ')} → {r.target}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            ))}

            {structured.apiEndpoints && structured.apiEndpoints.length > 0 && (
                <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
                    <div className="bg-neutral-50 border-b border-neutral-100 px-4 py-2.5">
                        <h4 className="font-semibold text-neutral-700 text-sm">API Endpoints</h4>
                    </div>
                    <div className="overflow-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="bg-neutral-50 text-neutral-500 uppercase tracking-wider">
                                    <th className="text-left px-3 py-2 font-medium">Method</th>
                                    <th className="text-left px-3 py-2 font-medium">Path</th>
                                    <th className="text-left px-3 py-2 font-medium">Description</th>
                                </tr>
                            </thead>
                            <tbody>
                                {structured.apiEndpoints.map((ep, ei) => (
                                    <tr key={ei} className="border-t border-neutral-100">
                                        <td className="px-3 py-1.5">
                                            <span className={`font-mono font-bold ${
                                                ep.method === 'GET' ? 'text-green-600'
                                                : ep.method === 'POST' ? 'text-blue-600'
                                                : ep.method === 'PUT' || ep.method === 'PATCH' ? 'text-amber-600'
                                                : ep.method === 'DELETE' ? 'text-red-600'
                                                : 'text-neutral-600'
                                            }`}>
                                                {ep.method}
                                            </span>
                                        </td>
                                        <td className="px-3 py-1.5 font-mono text-neutral-800">{ep.path}</td>
                                        <td className="px-3 py-1.5 text-neutral-600">{ep.description}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
