import {
  MdOutlineVisibility,
  MdOutlinePeople,
  MdOutlineWarning,
  MdOutlineStarOutline,
  MdOutlineAccountTree,
  MdOutlineReportProblem,
  MdOutlineCode,
  MdOutlineAttachMoney,
  MdOutlineFlag,
  MdOutlineSettings,
  MdOutlineChecklist,
  MdOutlineCallSplit,
  MdOutlineFormatQuote,
  MdOutlineApps,
  MdOutlineChat,
  MdOutlineMerge,
  MdOutlineCommit,
  MdOutlineDeleteSweep,
  MdOutlineGridView,
  MdOutlineEdit,
  MdOutlineLock,
} from 'react-icons/md';
import { InfographicSlide } from './InfographicSlide';

const prdSections = [
  { icon: MdOutlineVisibility, label: 'Vision' },
  { icon: MdOutlinePeople, label: 'Users' },
  { icon: MdOutlineWarning, label: 'Problem' },
  { icon: MdOutlineStarOutline, label: 'Features' },
  { icon: MdOutlineAccountTree, label: 'Architecture' },
  { icon: MdOutlineReportProblem, label: 'Risks' },
  { icon: MdOutlineCode, label: 'Constraints' },
];

const featureDetails = [
  { icon: MdOutlineAttachMoney, label: 'Value' },
  { icon: MdOutlineFlag, label: 'Priority (MoSCoW)' },
  { icon: MdOutlineSettings, label: 'Complexity' },
  { icon: MdOutlineChecklist, label: 'Acceptance Criteria' },
  { icon: MdOutlineCallSplit, label: 'Dependencies' },
];

const branchingNodes = [
  { icon: MdOutlineFormatQuote, label: 'Highlight text' },
  { icon: MdOutlineApps, label: 'Choose intent' },
  { icon: MdOutlineChat, label: 'AI conversation' },
  { icon: MdOutlineMerge, label: 'Consolidate' },
  { icon: MdOutlineCommit, label: 'Commit version' },
  { icon: MdOutlineDeleteSweep, label: 'Mark stale' },
];

const intents = ['Clarify', 'Expand', 'Specify', 'Replace', 'Alternative'];

const userActions = [
  { icon: MdOutlineGridView, label: 'Structured View' },
  { icon: MdOutlineCode, label: 'Markdown View' },
  { icon: MdOutlineEdit, label: 'Highlight to Branch' },
  { icon: MdOutlineLock, label: 'Mark Final' },
];

export function SlidePRDGeneration() {
  return (
    <InfographicSlide title="Stage 1 — PRD Generation">
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Left panel — Structured PRD */}
        <div className="flex-[45] rounded-xl border border-[#2a3a5c]/60 bg-[#111d35]/50 p-5 shadow-[inset_0_1px_0_0_rgba(148,163,184,0.05)]">
          <h3 className="mb-4 text-lg font-semibold text-white">
            AI Generates Structured PRD
          </h3>
          <ul className="space-y-2">
            {prdSections.map((s) => (
              <li key={s.label} className="flex items-center gap-2">
                <s.icon size={18} className="text-[#8b9cf7]" />
                <span className="text-sm text-slate-300">{s.label}</span>
              </li>
            ))}
          </ul>

          {/* Feature breakdown sub-panel */}
          <div className="mt-4 rounded-lg border border-[#2a3a5c]/40 bg-[#0d1829]/60 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Each Feature Includes
            </p>
            <ul className="space-y-1.5">
              {featureDetails.map((f) => (
                <li key={f.label} className="flex items-center gap-2">
                  <f.icon size={16} className="text-[#8b9cf7]" />
                  <span className="text-sm text-slate-300">{f.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Right panel — Branching Loop */}
        <div className="flex-[55] rounded-xl border border-[#2a3a5c]/60 bg-[#111d35]/50 p-5 shadow-[inset_0_1px_0_0_rgba(148,163,184,0.05)]">
          <h3 className="mb-4 text-lg font-semibold text-white">
            Branching Loop
          </h3>

          {/* Circular flow — rendered as a ring of nodes */}
          <div className="relative mx-auto mb-4 h-64 w-64">
            {branchingNodes.map((node, i) => {
              const angle = (i * 360) / branchingNodes.length - 90;
              const rad = (angle * Math.PI) / 180;
              const r = 100;
              const cx = 128 + r * Math.cos(rad);
              const cy = 128 + r * Math.sin(rad);
              return (
                <div
                  key={node.label}
                  className="absolute flex flex-col items-center"
                  style={{
                    left: cx - 28,
                    top: cy - 28,
                    width: 56,
                  }}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#2a3a5c]/60 bg-[#0d1829]">
                    <node.icon size={18} className="text-[#8b9cf7]" />
                  </div>
                  <span className="mt-1 text-center text-[10px] leading-tight text-slate-400">
                    {node.label}
                  </span>
                </div>
              );
            })}
            {/* Center circular arrow (SVG) */}
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 256 256"
            >
              <circle
                cx="128"
                cy="128"
                r="70"
                fill="none"
                stroke="#4a5a8a"
                strokeWidth="1.5"
                strokeDasharray="6 4"
              />
              {/* Arrowhead */}
              <polygon
                points="128,58 133,68 123,68"
                fill="#4a5a8a"
              />
            </svg>
          </div>

          {/* Intent badges */}
          <div className="flex flex-wrap justify-center gap-2">
            {intents.map((intent) => (
              <span
                key={intent}
                className="rounded-full border border-[#2a3a5c]/60 bg-[#0d1829] px-3 py-1 text-xs text-slate-300"
              >
                {intent}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom bar — User Actions */}
      <div className="mt-6 rounded-xl border border-[#2a3a5c]/60 bg-[#111d35]/50 p-4 shadow-[inset_0_1px_0_0_rgba(148,163,184,0.05)]">
        <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-400">
          User Actions
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          {userActions.map((a) => (
            <div key={a.label} className="flex items-center gap-2">
              <a.icon size={18} className="text-[#8b9cf7]" />
              <span className="text-sm text-slate-300">{a.label}</span>
            </div>
          ))}
        </div>
      </div>
    </InfographicSlide>
  );
}
