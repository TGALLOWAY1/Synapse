import {
  MdOutlinePhoneIphone,
  MdOutlineLaptopMac,
  MdOutlineDevices,
  MdOutlineTune,
  MdOutlineEqualizer,
  MdOutlineSignalCellularAlt,
  MdOutlineCropSquare,
  MdOutlineFilterNone,
  MdOutlineShare,
  MdOutlineRefresh,
  MdOutlineCompareArrows,
  MdOutlineRateReview,
  MdOutlineArrowUpward,
} from 'react-icons/md';
import { InfographicSlide } from './InfographicSlide';

const configGroups = [
  {
    title: 'Platform',
    options: [
      { icon: MdOutlinePhoneIphone, label: 'Mobile' },
      { icon: MdOutlineLaptopMac, label: 'Desktop' },
      { icon: MdOutlineDevices, label: 'Responsive' },
    ],
  },
  {
    title: 'Fidelity',
    options: [
      { icon: MdOutlineTune, label: 'Low' },
      { icon: MdOutlineEqualizer, label: 'Mid' },
      { icon: MdOutlineSignalCellularAlt, label: 'High' },
    ],
  },
  {
    title: 'Scope',
    options: [
      { icon: MdOutlineCropSquare, label: 'Single Screen' },
      { icon: MdOutlineFilterNone, label: 'Multi-Screen' },
      { icon: MdOutlineShare, label: 'Key Workflow' },
    ],
  },
];

const mockupActions = [
  { icon: MdOutlineRefresh, label: 'Regenerate' },
  { icon: MdOutlineCompareArrows, label: 'Compare Versions' },
  { icon: MdOutlineRateReview, label: 'Extract Feedback' },
];

export function SlideUIMockups() {
  return (
    <InfographicSlide title="Stage 2 — UI Mockups">
      {/* Config row */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {configGroups.map((group) => (
          <div
            key={group.title}
            className="rounded-xl border border-[#2a3a5c]/60 bg-[#111d35]/50 p-5 shadow-[inset_0_1px_0_0_rgba(148,163,184,0.05)]"
          >
            <h3 className="mb-3 text-center text-lg font-semibold text-white">
              {group.title}
            </h3>
            <div className="flex justify-center gap-4">
              {group.options.map((opt) => (
                <div
                  key={opt.label}
                  className="flex flex-col items-center gap-1.5"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#2a3a5c]/60 bg-[#0d1829]">
                    <opt.icon size={20} className="text-[#8b9cf7]" />
                  </div>
                  <span className="text-xs text-slate-400">{opt.label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Middle section */}
      <div className="mb-6 flex flex-col gap-4 md:flex-row">
        {/* AI Mockups panel */}
        <div className="flex-[60] rounded-xl border border-[#2a3a5c]/60 bg-[#111d35]/50 p-5 shadow-[inset_0_1px_0_0_rgba(148,163,184,0.05)]">
          <h3 className="mb-4 text-lg font-semibold text-white">AI Mockups</h3>
          {/* Simple wireframe illustration */}
          <div className="flex flex-col gap-2 rounded-lg border border-[#2a3a5c]/40 bg-[#0d1829]/60 p-4">
            {/* Header bar */}
            <div className="h-3 w-1/3 rounded-sm bg-[#2a3a5c]/80" />
            {/* Nav row */}
            <div className="flex gap-2">
              <div className="h-2 w-12 rounded-sm bg-[#2a3a5c]/50" />
              <div className="h-2 w-12 rounded-sm bg-[#2a3a5c]/50" />
              <div className="h-2 w-12 rounded-sm bg-[#2a3a5c]/50" />
            </div>
            {/* Content blocks */}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="h-16 rounded bg-[#2a3a5c]/30" />
              <div className="h-16 rounded bg-[#2a3a5c]/30" />
            </div>
            <div className="h-8 rounded bg-[#2a3a5c]/20" />
          </div>
        </div>

        {/* User Actions */}
        <div className="flex-[40] rounded-xl border border-[#2a3a5c]/60 bg-[#111d35]/50 p-5 shadow-[inset_0_1px_0_0_rgba(148,163,184,0.05)]">
          <h3 className="mb-4 text-lg font-semibold text-white">
            User Actions
          </h3>
          <ul className="space-y-3">
            {mockupActions.map((a) => (
              <li key={a.label} className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#2a3a5c]/60 bg-[#0d1829]">
                  <a.icon size={18} className="text-[#8b9cf7]" />
                </div>
                <span className="text-sm text-slate-300">{a.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Bottom — Feedback to PRD */}
      <div className="flex items-center justify-center gap-2 text-[#8b9cf7]">
        <MdOutlineArrowUpward size={20} />
        <span className="text-sm font-semibold text-slate-300">
          Feedback to PRD
        </span>
        <MdOutlineArrowUpward size={20} />
      </div>
    </InfographicSlide>
  );
}
