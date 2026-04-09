import {
  MdOutlineViewList,
  MdOutlineAccountTree,
  MdOutlineExtension,
  MdOutlineAssignment,
  MdOutlineStorage,
  MdOutlineChatBubbleOutline,
  MdOutlineDesignServices,
  MdOutlineFactCheck,
  MdOutlineBorderOuter,
  MdOutlineAltRoute,
  MdOutlineScreenshot,
  MdOutlineThumbsUpDown,
  MdOutlineAutorenew,
} from 'react-icons/md';
import { InfographicSlide } from './InfographicSlide';

const artifacts = [
  { icon: MdOutlineViewList, label: 'Screen Inventory' },
  { icon: MdOutlineAccountTree, label: 'User Flows' },
  { icon: MdOutlineExtension, label: 'Component Inventory' },
  { icon: MdOutlineAssignment, label: 'Implementation Plan' },
  { icon: MdOutlineStorage, label: 'Data Model' },
  { icon: MdOutlineChatBubbleOutline, label: 'Prompt Pack' },
  { icon: MdOutlineDesignServices, label: 'Design System' },
];

const markupTypes = [
  { icon: MdOutlineFactCheck, label: 'Critique Board' },
  { icon: MdOutlineBorderOuter, label: 'Wireframe Callout' },
  { icon: MdOutlineAltRoute, label: 'Flow Annotation' },
  { icon: MdOutlineScreenshot, label: 'Screenshot Annotation' },
  { icon: MdOutlineThumbsUpDown, label: 'Design Feedback' },
];

const genControls = [
  'Generate All',
  'Generate One',
  'Refine',
  'Refresh Stale',
];

export function SlideArtifacts() {
  return (
    <InfographicSlide title="Stage 3 — Artifacts">
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Artifact grid */}
        <div className="flex-[60]">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {artifacts.map((a) => (
              <div
                key={a.label}
                className="flex flex-col items-center rounded-xl border border-emerald-500/30 bg-[#111d35]/50 p-4 shadow-[inset_0_1px_0_0_rgba(148,163,184,0.05)]"
              >
                <a.icon size={22} className="mb-2 text-[#8b9cf7]" />
                <span className="text-center text-sm font-bold text-white">
                  {a.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Refine Loop */}
        <div className="flex flex-[40] flex-col items-center justify-center rounded-xl border border-[#2a3a5c]/60 bg-[#111d35]/50 p-5 shadow-[inset_0_1px_0_0_rgba(148,163,184,0.05)]">
          <h3 className="mb-4 text-lg font-semibold text-white">
            Refine Loop
          </h3>
          <div className="relative h-36 w-36">
            <svg className="h-full w-full" viewBox="0 0 144 144">
              {/* Circular arrow */}
              <circle
                cx="72"
                cy="72"
                r="50"
                fill="none"
                stroke="#4a5a8a"
                strokeWidth="1.5"
                strokeDasharray="6 4"
              />
              <polygon points="72,22 77,32 67,32" fill="#4a5a8a" />
            </svg>
            <MdOutlineAutorenew
              size={28}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[#8b9cf7]"
            />
          </div>
          <div className="mt-3 flex flex-col items-center gap-1 text-xs text-slate-400">
            <span>User instruction</span>
            <span className="text-[#8b9cf7]">→ AI improves output →</span>
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="mt-6 flex flex-col gap-4 md:flex-row">
        {/* Generation Controls */}
        <div className="flex-1 rounded-xl border border-emerald-500/20 bg-[#111d35]/50 p-4 shadow-[inset_0_1px_0_0_rgba(148,163,184,0.05)]">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Generation Controls
          </p>
          <div className="flex flex-wrap gap-2">
            {genControls.map((ctrl) => (
              <span
                key={ctrl}
                className="rounded-lg border border-emerald-500/30 bg-[#0d1829] px-3 py-1.5 text-xs text-slate-300"
              >
                {ctrl}
              </span>
            ))}
          </div>
        </div>

        {/* Markup Image Types */}
        <div className="flex-1 rounded-xl border border-[#2a3a5c]/60 bg-[#111d35]/50 p-4 shadow-[inset_0_1px_0_0_rgba(148,163,184,0.05)]">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Markup Image Types
          </p>
          <ul className="space-y-2">
            {markupTypes.map((m) => (
              <li key={m.label} className="flex items-center gap-2">
                <m.icon size={16} className="text-[#8b9cf7]" />
                <span className="text-sm text-slate-300">{m.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </InfographicSlide>
  );
}
