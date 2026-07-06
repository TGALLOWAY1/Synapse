import { useState } from 'react';
import {
  Cloud, CloudOff, RefreshCw, AlertTriangle, Check, Loader2, GitMerge, Download,
} from 'lucide-react';
import { useProjectSyncStore } from '../../store/projectSyncStore';
import {
  refreshProjectsFromServer,
  resolveConflictUseCloud,
  resolveConflictKeepLocal,
} from '../../store/projectServerSync';
import { downloadProjectRecoveryBundle } from '../../lib/projectRecovery';

// UI states for server-backed project sync. Reads the projectSyncStore (driven
// by projectServerSync.ts) and renders: loading, offline, sync-failed (with
// retry), a one-line "synced / N migrated" steady state, and — new in phase 2 —
// per-project cloud durability + cross-device conflict resolution. A failed save
// never loses local data, so the error copy is reassuring, not alarming.

function conflictCount(projects: Record<string, { state: string }>): number {
  return Object.values(projects).filter((p) => p.state === 'conflict').length;
}

export function SyncStatusBanner({ signedIn }: { signedIn: boolean }) {
  const phase = useProjectSyncStore((s) => s.phase);
  const online = useProjectSyncStore((s) => s.online);
  const error = useProjectSyncStore((s) => s.error);
  const migratedCount = useProjectSyncStore((s) => s.migratedCount);
  const conflicts = useProjectSyncStore((s) => conflictCount(s.projects));

  if (!signedIn) return null;

  if (!online) {
    return (
      <Row tone="amber" icon={<CloudOff size={13} />}>
        Offline — changes are saved on this device and will sync when you reconnect.
      </Row>
    );
  }

  if (phase === 'loading') {
    return (
      <Row tone="neutral" icon={<Loader2 size={13} className="animate-spin" />}>
        Syncing your projects…
      </Row>
    );
  }

  if (phase === 'error') {
    return (
      <Row tone="amber" icon={<AlertTriangle size={13} />}>
        <span className="flex-1">
          Couldn't sync with the server. Your projects are safe on this device.
        </span>
        <button
          onClick={() => refreshProjectsFromServer()}
          className="inline-flex items-center gap-1 text-xs font-medium text-amber-300 hover:text-amber-200"
        >
          <RefreshCw size={12} /> Retry
        </button>
      </Row>
    );
  }

  if (phase === 'ready') {
    if (conflicts > 0) {
      return (
        <Row tone="amber" icon={<GitMerge size={13} />}>
          {conflicts === 1
            ? '1 project changed on another device — resolve it below.'
            : `${conflicts} projects changed on another device — resolve them below.`}
        </Row>
      );
    }
    return (
      <Row tone="neutral" icon={<Cloud size={13} />}>
        {migratedCount > 0
          ? `Synced — ${migratedCount} local project${migratedCount === 1 ? '' : 's'} uploaded to your account.`
          : 'Projects synced across your devices.'}
        {error ? (
          <span title={error} className="ml-1 text-amber-400">(last error noted)</span>
        ) : null}
      </Row>
    );
  }

  return null;
}

function Row({
  tone,
  icon,
  children,
}: {
  tone: 'neutral' | 'amber';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const cls =
    tone === 'amber'
      ? 'bg-amber-900/20 border-amber-800/50 text-amber-200'
      : 'bg-neutral-800/60 border-neutral-700/50 text-neutral-400';
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${cls}`}>
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 flex items-center gap-2">{children}</span>
    </div>
  );
}

/** Tiny per-project sync indicator for list rows. */
export function ProjectSyncDot({ projectId }: { projectId: string }) {
  const info = useProjectSyncStore((s) => s.projects[projectId]);
  if (!info) return null;
  if (info.state === 'conflict') {
    return <GitMerge size={12} className="text-amber-500" aria-label="Cloud conflict — needs resolution" />;
  }
  if (info.state === 'saving') {
    return <Loader2 size={12} className="text-neutral-500 animate-spin" aria-label="Saving" />;
  }
  if (info.state === 'dirty') {
    return <Cloud size={12} className="text-neutral-600" aria-label="Unsaved to cloud" />;
  }
  if (info.state === 'error') {
    return <AlertTriangle size={12} className="text-amber-500" aria-label="Cloud sync failed" />;
  }
  return <Check size={12} className="text-emerald-500/70" aria-label="Synced to cloud" />;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Compact per-project cloud-durability status for a project header. Makes the
 * distinction visible: saved-on-device vs synced-to-cloud vs pending vs failed
 * vs conflict — so "saved locally" is never mistaken for "safe in the cloud".
 */
export function ProjectCloudStatus({
  projectId,
  signedIn,
}: {
  projectId: string;
  signedIn: boolean;
}) {
  const info = useProjectSyncStore((s) => s.projects[projectId]);
  const online = useProjectSyncStore((s) => s.online);
  if (!signedIn) return null;

  // No sync record yet: saved locally, cloud state not yet known.
  const state = info?.state;
  const savedAt = info?.lastCloudSavedAt;

  let icon: React.ReactNode;
  let label: string;
  let tone: string;
  let title: string | undefined;

  if (state === 'conflict') {
    icon = <GitMerge size={12} />;
    label = 'Cloud conflict';
    tone = 'text-amber-400';
    title = 'This project changed on another device. Resolve the conflict to sync.';
  } else if (!online) {
    icon = <CloudOff size={12} />;
    label = 'Offline';
    tone = 'text-amber-400';
    title = 'Offline — changes are on this device and sync when you reconnect.';
  } else if (state === 'error') {
    icon = <AlertTriangle size={12} />;
    label = 'Cloud save failed';
    tone = 'text-amber-400';
    title = info?.lastCloudSaveError
      ? `Last cloud save failed: ${info.lastCloudSaveError}`
      : 'Last cloud save failed — changes are safe on this device.';
  } else if (state === 'saving') {
    icon = <Loader2 size={12} className="animate-spin" />;
    label = 'Saving to cloud…';
    tone = 'text-neutral-400';
  } else if (state === 'dirty') {
    icon = <Cloud size={12} />;
    label = 'Cloud sync pending';
    tone = 'text-neutral-400';
    title = 'Changes saved on this device; not yet synced to the cloud.';
  } else if (state === 'saved') {
    icon = <Check size={12} />;
    label = savedAt ? `Synced ${relativeTime(savedAt)}` : 'Synced to cloud';
    tone = 'text-emerald-500/80';
    title = savedAt ? `Last synced to the cloud at ${new Date(savedAt).toLocaleString()}` : undefined;
  } else {
    icon = <Cloud size={12} />;
    label = 'Saved on this device';
    tone = 'text-neutral-500';
    title = 'Saved on this device. Cloud sync status not yet known.';
  }

  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${tone}`} title={title}>
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
    </span>
  );
}

/**
 * Cross-device conflict banner: shown when a project changed on another device
 * while this device also has unsynced edits. Offers the three safe resolutions —
 * keep local (overwrite cloud), use cloud (discard local), or download a
 * recovery copy of the local work first. Never resolves silently.
 */
export function ProjectConflictBanner({ projectId }: { projectId: string }) {
  const info = useProjectSyncStore((s) => s.projects[projectId]);
  const [busy, setBusy] = useState<null | 'local' | 'cloud'>(null);
  const [downloaded, setDownloaded] = useState(false);

  if (!info || info.state !== 'conflict') return null;

  const keepLocal = async () => {
    if (busy) return;
    setBusy('local');
    try {
      await resolveConflictKeepLocal(projectId);
    } finally {
      setBusy(null);
    }
  };

  const useCloud = async () => {
    if (busy) return;
    if (
      !window.confirm(
        'Replace this device\'s copy with the cloud version? Your local changes will be discarded. Consider downloading a recovery copy first.',
      )
    ) {
      return;
    }
    setBusy('cloud');
    try {
      await resolveConflictUseCloud(projectId);
    } finally {
      setBusy(null);
    }
  };

  const download = () => {
    const ok = downloadProjectRecoveryBundle(projectId, 'cross-device-conflict');
    setDownloaded(ok);
  };

  return (
    <div className="rounded-lg border border-amber-700/60 bg-amber-900/20 p-3 text-amber-100">
      <div className="flex items-start gap-2">
        <GitMerge size={16} className="mt-0.5 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Cloud version changed on another device</p>
          <p className="mt-0.5 text-xs text-amber-200/80">
            This project was updated elsewhere while you also have unsynced changes here.
            Choose which copy to keep — nothing is overwritten until you decide.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={keepLocal}
              disabled={!!busy}
              className="inline-flex items-center gap-1 rounded-md bg-amber-600/90 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {busy === 'local' ? <Loader2 size={12} className="animate-spin" /> : null}
              Keep this device's version
            </button>
            <button
              onClick={useCloud}
              disabled={!!busy}
              className="inline-flex items-center gap-1 rounded-md border border-amber-600/60 px-2.5 py-1 text-xs font-medium text-amber-100 hover:bg-amber-800/40 disabled:opacity-50"
            >
              {busy === 'cloud' ? <Loader2 size={12} className="animate-spin" /> : null}
              Use cloud version
            </button>
            <button
              onClick={download}
              disabled={!!busy}
              className="inline-flex items-center gap-1 rounded-md border border-amber-700/50 px-2.5 py-1 text-xs font-medium text-amber-200 hover:bg-amber-800/30 disabled:opacity-50"
            >
              {downloaded ? <Check size={12} /> : <Download size={12} />}
              {downloaded ? 'Downloaded' : 'Download local copy'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
