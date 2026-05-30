import type { ReactNode } from 'react';

/** Shared screen header (two-tone headline + subtitle) used by every tour screen. */
export function ScreenShell({
    title,
    accent,
    subtitle,
    children,
}: {
    title: string;
    accent: string;
    subtitle: string;
    children: ReactNode;
}) {
    return (
        <div className="mx-auto w-full max-w-5xl">
            <h2 className="text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl">
                {title}{' '}
                <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
                    {accent}
                </span>
            </h2>
            <p className="mt-3 max-w-xl text-base text-neutral-400 sm:text-lg">{subtitle}</p>
            <div className="mt-8">{children}</div>
        </div>
    );
}

/** A simple skeleton line used across screens to suggest body copy. */
export function SkeletonLine({ width = 'w-full' }: { width?: string }) {
    return <span className={`block h-2 rounded bg-neutral-700/70 ${width}`} aria-hidden="true" />;
}
