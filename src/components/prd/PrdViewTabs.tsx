import { FileText, Layers } from 'lucide-react';
import { PRD_VIEWS, type PrdViewId } from '../../lib/derive/prdViews';
import { UnderlineTabs, type UnderlineTab } from '../ui/UnderlineTabs';

// Segmented tab navigation for the two coordinated PRD views. Thin wrapper
// around the shared UnderlineTabs (ARIA tablist + roving arrow-key nav) that
// maps PRD_VIEWS to its tab shape. The row scrolls horizontally on very
// narrow screens rather than shrinking labels, and never overflows the page
// (min-w-0 + overflow-x-auto on the container).

const ICONS: Record<PrdViewId, typeof FileText> = {
    overview: FileText,
    features: Layers,
};

interface Props {
    active: PrdViewId;
    onChange: (view: PrdViewId) => void;
    /** Optional per-view count badge (e.g. feature count, decisions pending). */
    counts?: Partial<Record<PrdViewId, number>>;
}

export function PrdViewTabs({ active, onChange, counts }: Props) {
    const tabs: UnderlineTab[] = PRD_VIEWS.map(view => {
        const Icon = ICONS[view.id];
        return {
            id: view.id,
            label: view.label,
            icon: <Icon size={16} />,
            count: counts?.[view.id],
            domId: `prd-tab-${view.id}`,
            controls: `prd-panel-${view.id}`,
        };
    });

    return (
        <UnderlineTabs
            tabs={tabs}
            activeId={active}
            onChange={id => onChange(id as PrdViewId)}
            ariaLabel="PRD views"
            className="items-center gap-1 overflow-x-auto overflow-y-hidden -mx-1 px-1 mb-6"
        />
    );
}
