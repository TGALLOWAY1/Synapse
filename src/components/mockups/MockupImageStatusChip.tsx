/**
 * Compact summary of a mockup version's image status across all its screens.
 * Reflects the requirement that the artifact shows whether mockups were
 * generated automatically (OpenAI), uploaded manually, or are still awaiting
 * user input. Reads both image stores (AI-generated in `mockupImageStore`,
 * manual uploads in `screenInventoryImageStore`) keyed by the mockup version id.
 */

import { useEffect } from 'react';
import { ImageUp, Sparkles, Clock, Images, Loader2, AlertTriangle } from 'lucide-react';
import type { MockupScreen } from '../../types';
import { useMockupImageStore } from '../../store/mockupImageStore';
import { useScreenInventoryImageStore } from '../../store/screenInventoryImageStore';
import { buildScreenScopeKey } from '../../lib/mockupImageStore';
import { slugifyScreenName } from '../../lib/screenInventoryImageStore';
import { computeMockupImageCompletion, type ScreenImageState } from '../../lib/mockupImageCompletion';

interface Props {
    versionId: string;
    screens: MockupScreen[];
}

export function MockupImageStatusChip({ versionId, screens }: Props) {
    const loadAi = useMockupImageStore((s) => s.loadForVersion);
    const aiImages = useMockupImageStore((s) => s.images);
    const errors = useMockupImageStore((s) => s.errors);
    const inFlight = useMockupImageStore((s) => s.inFlight);
    const loadUploads = useScreenInventoryImageStore((s) => s.loadForArtifactVersion);
    const uploads = useScreenInventoryImageStore((s) => s.images);

    useEffect(() => {
        void loadAi(versionId);
        void loadUploads(versionId);
    }, [versionId, loadAi, loadUploads]);

    if (screens.length === 0) return null;

    let uploadCount = 0;
    const states: ScreenImageState[] = screens.map((screen) => {
        const scope = buildScreenScopeKey(versionId, screen.id);
        const hasAi = Object.keys(aiImages).some((k) => k.startsWith(scope));
        const slug = slugifyScreenName(screen.name);
        const hasUpload = Object.values(uploads).some(
            (r) => r.artifactVersionId === versionId && r.screenSlug === slug && r.isPreferred,
        );
        const generated = hasAi || hasUpload;
        if (hasUpload) uploadCount++;
        return {
            screenId: screen.id,
            generated,
            generating: !generated && !!inFlight[scope],
            failed: !generated && !inFlight[scope] && !!errors[scope],
        };
    });

    const completion = computeMockupImageCompletion(states);
    const total = completion.total;
    const withImages = completion.generated;
    const autoCount = withImages - uploadCount;

    let label: string;
    let Icon = Images;
    let tone = 'border-neutral-200 bg-neutral-50 text-neutral-500';

    if (completion.failed > 0) {
        // Some images failed — never present the mockup as fully complete.
        label = `Images incomplete · ${withImages}/${total} · ${completion.failed} failed`;
        Icon = AlertTriangle;
        tone = 'border-red-200 bg-red-50 text-red-700';
    } else if (completion.status === 'generating') {
        label = `Generating images · ${withImages}/${total}`;
        Icon = Loader2;
        tone = 'border-sky-200 bg-sky-50 text-sky-700';
    } else if (withImages === 0) {
        label = `Awaiting images · 0/${total}`;
        Icon = Clock;
        tone = 'border-amber-200 bg-amber-50 text-amber-700';
    } else if (uploadCount === total) {
        label = `Uploaded · ${total}/${total}`;
        Icon = ImageUp;
        tone = 'border-emerald-200 bg-emerald-50 text-emerald-700';
    } else if (autoCount === total) {
        label = `AI-generated · ${total}/${total}`;
        Icon = Sparkles;
        tone = 'border-indigo-200 bg-indigo-50 text-indigo-700';
    } else {
        label = `Images · ${withImages}/${total}`;
        Icon = Images;
        tone = 'border-neutral-200 bg-neutral-50 text-neutral-600';
    }

    return (
        <span
            className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-medium inline-flex items-center gap-1 ${tone}`}
            title="Mockup image status across all screens"
        >
            <Icon size={10} className={Icon === Loader2 ? 'animate-spin' : undefined} />
            {label}
        </span>
    );
}
