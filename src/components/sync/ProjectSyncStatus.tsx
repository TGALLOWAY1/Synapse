import { Cloud, CloudOff, RefreshCw, AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useProjectSyncStore } from '../../store/projectSyncStore';
import { refreshProjectsFromServer } from '../../store/projectServerSync';

// UI states for server-backed project sync. Reads the projectSyncStore (driven
// by projectServerSync.ts) and renders: loading, offline, sync-failed (with
// retry), and a one-line "synced / N migrated" steady state. A failed save
// never loses local data, so the error copy is reassuring, not alarming.

export function SyncStatusBanner({ signedIn }: { signedIn: boolean }) {
  const phase = useProjectSyncStore((s) => s.phase);
  const online = useProjectSyncStore((s) => s.online);
  const error = useProjectSyncStore((s) => s.error);
  const migratedCount = useProjectSyncStore((s) => s.migratedCount);

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
  if (info.state === 'saving') {
    return <Loader2 size={12} className="text-neutral-500 animate-spin" aria-label="Saving" />;
  }
  if (info.state === 'dirty') {
    return <Cloud size={12} className="text-neutral-600" aria-label="Unsaved changes" />;
  }
  if (info.state === 'error') {
    return <AlertTriangle size={12} className="text-amber-500" aria-label="Sync failed" />;
  }
  return <Check size={12} className="text-emerald-500/70" aria-label="Saved" />;
}
