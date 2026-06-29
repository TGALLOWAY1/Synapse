/**
 * Compact summary of a mockup version's image status across all its screens.
 * Reflects the requirement that the artifact shows whether mockups were
 * generated automatically (OpenAI), uploaded manually, or are still awaiting
 * user input. Reads both image stores (AI-generated in `mockupImageStore`,
 * manual uploads in `screenInventoryImageStore`) keyed by the mockup version id.
 */

import { useEffect } from 'react';
import { ImageUp, Sparkles, Clock, Images } from 'lucide-react';
import type { MockupScreen } from '../../types';
import { useMockupImageStore } from '../../store/mockupImageStore';
import { useScreenInventoryImageStore } from '../../store/screenInventoryImageStore';
import { buildScreenScopeKey } from '../../lib/mockupImageStore';
import { slugifyScreenName } from '../../lib/screenInventoryImageStore';

interface Props {
    versionId: string;
    screens: MockupScreen[];
}

export function MockupImageStatusChip({ versionId, screens }: Props) {
    const loadAi = useMockupImageStore((s) => s.loadForVersion);
    const aiImages = useMockupImageStore((s) => s.images);
    const loadUploads = useScreenInventoryImageStore((s) => s.loadForArtifactVersion);
    const uploads = useScreenInventoryImageStore((s) => s.images);

    useEffect(() => {
        void loadAi(versionId);
        void loadUploads(versionId);
    }, [versionId, loadAi, loadUploads]);

    if (screens.length === 0) return null;

    let autoCount = 0;
    let uploadCount = 0;
    for (const screen of screens) {
        const aiScope = buildScreenScopeKey(versionId, screen.id);
        const hasAi = Object.keys(aiImages).some((k) => k.startsWith(aiScope));
        const slug = slugifyScreenName(screen.name);
        const hasUpload = Object.values(uploads).some(
            (r) => r.artifactVersionId === versionId && r.screenSlug === slug && r.isPreferred,
        );
        if (hasUpload) uploadCount++;
        else if (hasAi) autoCount++;
    }

    const total = screens.length;
    const withImages = autoCount + uploadCount;

    let label: string;
    let Icon = Images;
    let tone = 'border-neutral-200 bg-neutral-50 text-neutral-500';

    if (withImages === 0) {
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
            <Icon size={10} />
            {label}
        </span>
    );
}
