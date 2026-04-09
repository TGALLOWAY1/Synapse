import type { ReactNode } from 'react';

interface InfographicSlideProps {
  title: string;
  children: ReactNode;
}

export function InfographicSlide({ title, children }: InfographicSlideProps) {
  return (
    <div className="relative min-h-[500px] overflow-hidden rounded-2xl bg-gradient-to-b from-[#0a1128] via-[#101d3a] to-[#0a1128] p-8 md:p-10">
      {/* Dot grid overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'radial-gradient(circle, #8b9cf7 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Content */}
      <div className="relative z-10">
        <h2 className="mb-8 text-center text-3xl font-bold tracking-tight text-white md:text-4xl">
          {title}
        </h2>
        {children}
      </div>

      {/* Synapse star logo */}
      <svg
        className="absolute bottom-4 right-4 h-6 w-6 text-slate-500/40"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
      </svg>
    </div>
  );
}
