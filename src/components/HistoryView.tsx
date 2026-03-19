import { Clock, FileText, Image, Package, MessageSquare, CheckCircle } from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import type { HistoryEventType } from '../types';

interface HistoryViewProps {
    projectId: string;
}

const EVENT_CONFIG: Record<HistoryEventType, { icon: typeof Clock; color: string; bgColor: string }> = {
    Init: { icon: FileText, color: 'text-blue-600', bgColor: 'bg-blue-50' },
    Regenerated: { icon: FileText, color: 'text-indigo-600', bgColor: 'bg-indigo-50' },
    Consolidated: { icon: CheckCircle, color: 'text-green-600', bgColor: 'bg-green-50' },
    ArtifactGenerated: { icon: Package, color: 'text-purple-600', bgColor: 'bg-purple-50' },
    ArtifactRegenerated: { icon: Package, color: 'text-purple-600', bgColor: 'bg-purple-50' },
    FeedbackCreated: { icon: MessageSquare, color: 'text-amber-600', bgColor: 'bg-amber-50' },
    FeedbackApplied: { icon: CheckCircle, color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
};

export function HistoryView({ projectId }: HistoryViewProps) {
    const { getHistoryEvents } = useProjectStore();
    const events = getHistoryEvents(projectId);
    const sortedEvents = [...events].sort((a, b) => b.createdAt - a.createdAt);

    // Group events by date
    const groupedByDate: Record<string, typeof sortedEvents> = {};
    for (const event of sortedEvents) {
        const dateKey = new Date(event.createdAt).toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
        if (!groupedByDate[dateKey]) groupedByDate[dateKey] = [];
        groupedByDate[dateKey].push(event);
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Clock size={24} className="text-indigo-600" />
                <h2 className="text-xl font-bold text-neutral-900">Project History</h2>
                <span className="bg-neutral-100 text-neutral-600 text-xs px-2 py-0.5 rounded-full font-medium">
                    {events.length} events
                </span>
            </div>

            {events.length === 0 ? (
                <div className="text-center py-16 text-neutral-400">
                    <Clock size={48} className="mx-auto mb-4 opacity-30" />
                    <p className="text-lg font-medium text-neutral-500 mb-2">No history yet</p>
                    <p className="text-sm">Events will appear here as you create and modify artifacts.</p>
                </div>
            ) : (
                <div className="space-y-8">
                    {Object.entries(groupedByDate).map(([dateKey, dateEvents]) => (
                        <div key={dateKey}>
                            <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3 sticky top-0 bg-neutral-50 py-1">
                                {dateKey}
                            </h3>
                            <div className="space-y-2">
                                {dateEvents.map(event => {
                                    const config = EVENT_CONFIG[event.type] || EVENT_CONFIG.Init;
                                    const Icon = config.icon;

                                    return (
                                        <div
                                            key={event.id}
                                            className="flex items-start gap-3 p-3 bg-white rounded-lg border border-neutral-200 hover:border-neutral-300 transition"
                                        >
                                            <div className={`p-1.5 rounded-md shrink-0 ${config.bgColor}`}>
                                                <Icon size={14} className={config.color} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium text-neutral-800">
                                                        {event.description}
                                                    </span>
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500 font-mono shrink-0">
                                                        {event.type}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-neutral-400 mt-1 flex items-center gap-2">
                                                    <span>{new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                    {event.spineVersionId && <span>PRD {event.spineVersionId}</span>}
                                                </div>

                                                {event.diff?.matches && (
                                                    <div className="mt-2 bg-neutral-50 border border-neutral-100 rounded p-2 font-mono text-xs">
                                                        <p className="text-red-500 line-through truncate">- {event.diff.matches[0].before}</p>
                                                        <p className="text-green-600 truncate">+ {event.diff.matches[0].after}</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
