import {
  MdOutlineInfo,
  MdOutlineRefresh,
  MdOutlineMerge,
  MdOutlineLayers,
  MdOutlineChatBubble,
  MdOutlineCheckCircle,
  MdOutlineHistory,
  MdOutlineDifference,
  MdOutlineSkipNext,
} from 'react-icons/md';
import { InfographicSlide } from './InfographicSlide';

const timelineNodes = [
  { icon: MdOutlineInfo, label: 'Init' },
  { icon: MdOutlineRefresh, label: 'Regenerated' },
  { icon: MdOutlineMerge, label: 'Consolidated' },
  { icon: MdOutlineLayers, label: 'Artifact Generated' },
  { icon: MdOutlineRefresh, label: 'Artifact Regenerated' },
  { icon: MdOutlineChatBubble, label: 'Feedback Created' },
  { icon: MdOutlineCheckCircle, label: 'Feedback Applied' },
];

const userActions = [
  { icon: MdOutlineHistory, label: 'View version' },
  { icon: MdOutlineDifference, label: 'See diffs' },
  { icon: MdOutlineSkipNext, label: 'Return to latest' },
];

export function SlideHistory() {
  return (
    <InfographicSlide title="History & Iteration">
      {/* Timeline */}
      <div className="mb-8 overflow-x-auto">
        <div className="relative mx-auto flex min-w-[700px] items-start justify-between px-4">
          {/* Connecting line */}
          <div className="absolute left-8 right-8 top-5 h-px bg-purple-500/30" />

          {timelineNodes.map((node) => (
            <div
              key={node.label}
              className="relative z-10 flex flex-col items-center"
              style={{ width: 90 }}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-purple-500/40 bg-[#1a1530]">
                <node.icon size={20} className="text-[#8b9cf7]" />
              </div>
              <span className="mt-2 text-center text-[11px] leading-tight text-slate-400">
                {node.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* User Actions */}
      <div className="mx-auto max-w-md rounded-xl border border-[#2a3a5c]/60 bg-[#111d35]/50 p-5 shadow-[inset_0_1px_0_0_rgba(148,163,184,0.05)]">
        <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-400">
          User Actions
        </p>
        <div className="flex flex-wrap items-center justify-center gap-5">
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
