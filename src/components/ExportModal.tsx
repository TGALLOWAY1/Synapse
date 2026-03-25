import { useState } from 'react';
import { Download, X, FileText, Package } from 'lucide-react';
import { useProjectStore } from '../store/projectStore';

interface ExportModalProps {
    projectId: string;
    onClose: () => void;
}

export function ExportModal({ projectId, onClose }: ExportModalProps) {
    const { getProject, getLatestSpine, getArtifacts, getArtifactVersions } = useProjectStore();
    const [exporting, setExporting] = useState(false);

    const project = getProject(projectId);
    const latestSpine = getLatestSpine(projectId);
    const coreArtifacts = getArtifacts(projectId, 'core_artifact');
    const mockupArtifacts = getArtifacts(projectId, 'mockup');

    const downloadFile = (content: string, filename: string, mimeType: string = 'text/markdown') => {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };

    const exportPRD = () => {
        if (!latestSpine) return;
        downloadFile(latestSpine.responseText, `${project?.name || 'project'}-prd.md`);
    };

    const exportArtifact = (artifactId: string, title: string) => {
        const versions = getArtifactVersions(projectId, artifactId);
        const preferred = versions.find(v => v.isPreferred);
        if (!preferred) return;
        downloadFile(preferred.content, `${title.replace(/\s+/g, '-').toLowerCase()}.md`);
    };

    const exportStructuredJSON = () => {
        if (!latestSpine?.structuredPRD) return;
        const data = {
            project: project,
            structuredPRD: latestSpine.structuredPRD,
            artifacts: coreArtifacts.map(a => {
                const versions = getArtifactVersions(projectId, a.id);
                const preferred = versions.find(v => v.isPreferred);
                return {
                    id: a.id,
                    type: a.type,
                    subtype: a.subtype,
                    title: a.title,
                    content: preferred?.content || '',
                    versionNumber: preferred?.versionNumber,
                };
            }),
        };
        downloadFile(JSON.stringify(data, null, 2), `${project?.name || 'project'}-export.json`, 'application/json');
    };

    const exportFullBundle = async () => {
        setExporting(true);
        try {
            const sections: string[] = [];

            // PRD
            if (latestSpine) {
                sections.push('# Product Requirements Document\n');
                sections.push(latestSpine.responseText);
                sections.push('\n---\n');
            }

            // Core Artifacts
            for (const artifact of coreArtifacts) {
                const versions = getArtifactVersions(projectId, artifact.id);
                const preferred = versions.find(v => v.isPreferred);
                if (preferred) {
                    sections.push(`# ${artifact.title}\n`);
                    sections.push(preferred.content);
                    sections.push('\n---\n');
                }
            }

            // Mockups
            for (const mockup of mockupArtifacts) {
                const versions = getArtifactVersions(projectId, mockup.id);
                const preferred = versions.find(v => v.isPreferred);
                if (preferred) {
                    sections.push(`# ${mockup.title}\n`);
                    sections.push(preferred.content);
                    sections.push('\n---\n');
                }
            }

            downloadFile(sections.join('\n'), `${project?.name || 'project'}-full-bundle.md`);
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-neutral-200">
                    <h3 className="font-bold text-neutral-900">Export Project</h3>
                    <button onClick={onClose} className="p-1 hover:bg-neutral-100 rounded transition">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-4 space-y-3">
                    {/* PRD */}
                    <button
                        onClick={exportPRD}
                        disabled={!latestSpine}
                        className="w-full flex items-center gap-3 p-3 bg-neutral-50 hover:bg-neutral-100 rounded-lg transition text-left disabled:opacity-50"
                    >
                        <FileText size={18} className="text-indigo-500 shrink-0" />
                        <div>
                            <div className="text-sm font-medium text-neutral-800">Export PRD</div>
                            <div className="text-xs text-neutral-500">Download PRD as Markdown</div>
                        </div>
                    </button>

                    {/* Individual Artifacts */}
                    {coreArtifacts.length > 0 && (
                        <div>
                            <span className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Artifacts</span>
                            <div className="mt-1 space-y-1">
                                {coreArtifacts.map(a => (
                                    <button
                                        key={a.id}
                                        onClick={() => exportArtifact(a.id, a.title)}
                                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-neutral-50 rounded-md transition text-left text-sm text-neutral-700"
                                    >
                                        <Download size={14} className="text-neutral-400 shrink-0" />
                                        {a.title}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Full Bundle */}
                    <button
                        onClick={exportFullBundle}
                        disabled={exporting}
                        className="w-full flex items-center gap-3 p-3 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition text-left disabled:opacity-50"
                    >
                        <Package size={18} className="text-indigo-600 shrink-0" />
                        <div>
                            <div className="text-sm font-medium text-indigo-800">
                                {exporting ? 'Exporting...' : 'Export Full Bundle'}
                            </div>
                            <div className="text-xs text-indigo-600">PRD + all artifacts + mockups as single Markdown</div>
                        </div>
                    </button>

                    {/* Structured JSON */}
                    <button
                        onClick={exportStructuredJSON}
                        disabled={!latestSpine?.structuredPRD}
                        className="w-full flex items-center gap-3 p-3 bg-neutral-50 hover:bg-neutral-100 rounded-lg transition text-left disabled:opacity-50"
                    >
                        <Download size={18} className="text-neutral-500 shrink-0" />
                        <div>
                            <div className="text-sm font-medium text-neutral-800">Export Structured JSON</div>
                            <div className="text-xs text-neutral-500">PRD + artifacts as structured data</div>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
}
