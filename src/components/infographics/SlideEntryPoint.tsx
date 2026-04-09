import {
  MdOutlineChat,
  MdDevices,
  MdAutoAwesome,
  MdDashboard,
} from 'react-icons/md';
import { InfographicSlide } from './InfographicSlide';
import { FlowArrow } from './FlowArrow';

const steps = [
  {
    icon: MdOutlineChat,
    title: 'Describe Product Idea',
    subtitle: 'Natural language or uploaded brief',
  },
  {
    icon: MdDevices,
    title: 'Select Platform',
    subtitle: 'App or Web',
  },
  {
    icon: MdAutoAwesome,
    title: 'Enhance Prompt',
    subtitle: 'Optional AI refinement',
  },
  {
    icon: MdDashboard,
    title: 'Enter Workspace',
    subtitle: 'Your project hub',
  },
];

export function SlideEntryPoint() {
  return (
    <InfographicSlide title="Entry Point — Project Creation">
      <div className="flex flex-wrap items-center justify-center gap-3 md:gap-4">
        {steps.map((step, i) => (
          <div key={step.title} className="flex items-center gap-3 md:gap-4">
            {/* Card */}
            <div className="flex w-40 flex-col items-center rounded-xl border border-[#2a3a5c]/60 bg-[#111d35]/50 p-5 shadow-[inset_0_1px_0_0_rgba(148,163,184,0.05)] md:w-48">
              <step.icon size={22} className="mb-3 text-[#8b9cf7]" />
              <p className="text-center text-base font-bold text-white">
                {step.title}
              </p>
              <p className="mt-1 text-center text-sm text-slate-400">
                {step.subtitle}
              </p>
            </div>

            {/* Arrow between cards (not after the last) */}
            {i < steps.length - 1 && (
              <FlowArrow className="hidden shrink-0 md:block" />
            )}
          </div>
        ))}
      </div>
    </InfographicSlide>
  );
}
