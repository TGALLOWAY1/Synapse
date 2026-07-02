// Presentational tab strip for the Screen Detail view (Experience workspace).
// Controlled — the active tab lives in ArtifactWorkspace's local state so
// navigation from a flow node can land on a specific tab. Mirrors the
// underline-tab idiom already used by ProjectWorkspace's right-rail tabs.

export type ScreenDetailTab = 'overview' | 'flow' | 'mockups';

interface Props {
    active: ScreenDetailTab;
    onChange: (tab: ScreenDetailTab) => void;
    /** Number of flow steps referencing this screen — shown as a count chip. */
    flowRefCount: number;
    /** Whether a matching mockup screen exists — shown as a subtle dot. */
    hasMockup: boolean;
}

const TABS: Array<{ id: ScreenDetailTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'flow', label: 'Flow' },
    { id: 'mockups', label: 'Mockups' },
];

export function ScreenDetailTabs({ active, onChange, flowRefCount, hasMockup }: Props) {
    return (
        <div
            role="tablist"
            aria-label="Screen detail sections"
            className="flex items-center gap-1 border-b border-neutral-200"
        >
            {TABS.map(tab => {
                const selected = tab.id === active;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => onChange(tab.id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 -mb-px text-sm font-medium border-b-2 transition ${
                            selected
                                ? 'border-indigo-600 text-indigo-700'
                                : 'border-transparent text-neutral-500 hover:text-neutral-800 hover:border-neutral-300'
                        }`}
                    >
                        {tab.label}
                        {tab.id === 'flow' && flowRefCount > 0 && (
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums ${
                                selected ? 'bg-indigo-100 text-indigo-700' : 'bg-neutral-100 text-neutral-500'
                            }`}>
                                {flowRefCount}
                            </span>
                        )}
                        {tab.id === 'mockups' && hasMockup && (
                            <span
                                className="w-1.5 h-1.5 rounded-full bg-emerald-500"
                                title="A mockup exists for this screen"
                                aria-hidden="true"
                            />
                        )}
                    </button>
                );
            })}
        </div>
    );
}
