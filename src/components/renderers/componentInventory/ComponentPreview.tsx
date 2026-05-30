// Live, interactive-but-inert previews. Each archetype demonstrates the
// component's behavior with local state (accordion opens, toggle flips, button
// shows a pressed state) but never triggers real app behavior. Previews are
// the primary visual object on every card.

import { useState } from 'react';
import { ChevronDown, ChevronRight, MapPin } from 'lucide-react';
import type { ComponentPreviewType } from '../../../types';

function AccordionPreview() {
    const [open, setOpen] = useState(false);
    return (
        <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="w-full text-left bg-white border border-neutral-200 rounded-md p-2.5 text-xs"
        >
            <div className="flex items-center justify-between font-medium text-neutral-700">
                Settings
                <ChevronDown size={14} className={`text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </div>
            {open ? (
                <div className="mt-2 pt-2 border-t border-neutral-100 space-y-1.5 text-neutral-500">
                    <div className="flex items-center justify-between">
                        <span>Enable Discovery</span>
                        <span className="w-7 h-4 rounded-full bg-indigo-500 relative">
                            <span className="absolute right-0.5 top-0.5 w-3 h-3 rounded-full bg-white" />
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span>Discovery Timeout</span>
                        <span className="text-neutral-400">30s ▾</span>
                    </div>
                </div>
            ) : (
                <div className="mt-1.5 flex items-center justify-between text-neutral-400">
                    Advanced Settings
                    <ChevronRight size={13} />
                </div>
            )}
        </button>
    );
}

function InputPreview() {
    const [value, setValue] = useState('');
    return (
        <div className="flex items-center gap-2 bg-white border border-neutral-200 rounded-md px-2.5 py-2">
            <input
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder="Search address..."
                className="flex-1 min-w-0 text-xs text-neutral-700 outline-none bg-transparent placeholder:text-neutral-400"
            />
            <MapPin size={14} className="text-neutral-400 shrink-0" />
        </div>
    );
}

function TogglePreview() {
    const [on, setOn] = useState(true);
    return (
        <div className="flex items-center justify-between bg-white border border-neutral-200 rounded-md px-2.5 py-2 text-xs">
            <span className="text-neutral-600">Enable Notifications</span>
            <button
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => setOn(o => !o)}
                className={`w-9 h-5 rounded-full relative transition-colors ${on ? 'bg-indigo-500' : 'bg-neutral-300'}`}
            >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
        </div>
    );
}

function ButtonPreview() {
    const [pressed, setPressed] = useState(false);
    return (
        <button
            type="button"
            onPointerDown={() => setPressed(true)}
            onPointerUp={() => setPressed(false)}
            onPointerLeave={() => setPressed(false)}
            className={`w-full rounded-md px-3 py-2 text-xs font-medium text-white transition-all ${
                pressed ? 'bg-indigo-700 scale-[0.98]' : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
        >
            Save Changes
        </button>
    );
}

function CustomPreview() {
    return (
        <div className="flex items-center justify-center bg-white border border-dashed border-neutral-200 rounded-md px-2.5 py-4 text-[11px] text-neutral-400">
            Component preview
        </div>
    );
}

const PREVIEWS: Record<ComponentPreviewType, () => React.ReactElement> = {
    accordion: AccordionPreview,
    input: InputPreview,
    toggle: TogglePreview,
    button: ButtonPreview,
    custom: CustomPreview,
};

export function ComponentPreview({ previewType }: { previewType: ComponentPreviewType }) {
    const Preview = PREVIEWS[previewType] ?? CustomPreview;
    return (
        <div className="bg-neutral-50 rounded-lg p-3 border border-neutral-100">
            <Preview />
        </div>
    );
}
