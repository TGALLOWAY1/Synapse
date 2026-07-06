import { useEffect, useState, useCallback } from 'react';
import {
  ShieldCheck,
  Lock,
  Trash2,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Check,
  Pencil,
  Activity,
} from 'lucide-react';
import {
  fetchProviderKeyStatus,
  saveProviderKey,
  deleteProviderKey,
  testProviderKey,
  type ProviderId,
  type ProviderKeyStatusMap,
} from '../../lib/providerKeysApi';
import { primeProviderSession } from '../../lib/providerSession';

// Encrypted, server-side provider-key management. Talks only to
// /api/provider-keys, which returns masked status (never key material). This is
// the recommended way to store keys: they are encrypted at rest and used
// server-side (OpenAI image generation is fully proxied; the Gemini key is
// served to the authenticated client at call time only).

interface ProviderMeta {
  id: ProviderId;
  label: string;
  placeholder: string;
  getKeyUrl: string;
  blurb: string;
  paidWarning: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    placeholder: 'Paste your AIzaSy… key',
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    blurb: 'Powers PRD generation and all text artifacts.',
    paidWarning:
      'Gemini usage is billed to your Google account. Generous free tier exists, but heavy use may incur charges.',
  },
  {
    id: 'openai',
    label: 'OpenAI (image generation)',
    placeholder: 'Paste your sk-… key',
    getKeyUrl: 'https://platform.openai.com/api-keys',
    blurb: 'Powers AI mockup image previews (gpt-image-2).',
    paidWarning:
      'Image generation is a paid OpenAI operation billed to your account — typically a few cents per image. No free tier.',
  },
];

/** Brand mark for a provider, rendered in the provider card header. */
function ProviderLogo({ id }: { id: ProviderId }) {
  if (id === 'gemini') {
    return (
      <span className="w-9 h-9 shrink-0 flex items-center justify-center" aria-hidden>
        <svg viewBox="0 0 48 48" className="w-7 h-7">
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
          />
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
          />
          <path
            fill="#FBBC05"
            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
          />
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
          />
        </svg>
      </span>
    );
  }
  return (
    <span className="w-9 h-9 shrink-0 flex items-center justify-center text-white" aria-hidden>
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.1419.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997z" />
      </svg>
    </span>
  );
}

/** Small pill button used for the Test / Update / Delete row actions. */
function RowAction({
  onClick,
  disabled,
  icon,
  label,
  tone = 'neutral',
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  tone?: 'neutral' | 'danger';
}) {
  const base =
    'inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-2 transition disabled:opacity-50';
  const tones =
    tone === 'danger'
      ? 'text-rose-300 hover:text-rose-200 bg-rose-500/[0.07] hover:bg-rose-500/15 border border-rose-500/30'
      : 'text-neutral-200 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10';
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${tones}`}>
      {icon}
      {label}
    </button>
  );
}

function ProviderRow({
  meta,
  configured,
  last4,
  onChanged,
}: {
  meta: ProviderMeta;
  configured: boolean;
  last4: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    const result = await saveProviderKey(meta.id, value.trim());
    setBusy(false);
    if (result.ok) {
      setValue('');
      setEditing(false);
      onChanged();
    } else {
      setError(result.message);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    setError(null);
    await deleteProviderKey(meta.id);
    setBusy(false);
    setTestResult(null);
    onChanged();
  };

  const handleTest = async () => {
    setBusy(true);
    setTestResult(null);
    const result = await testProviderKey(meta.id);
    setBusy(false);
    setTestResult(result);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="flex gap-3">
        <ProviderLogo id={meta.id} />

        <div className="flex-1 min-w-0 space-y-3">
          {/* Title + status + get-key link */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="text-[15px] font-semibold text-white truncate">{meta.label}</span>
              {configured ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-full px-2 py-0.5">
                  <Check size={11} strokeWidth={3} /> Configured
                </span>
              ) : (
                <span className="text-[11px] font-semibold text-neutral-400 bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
                  Not configured
                </span>
              )}
            </div>
            <a
              href={meta.getKeyUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition flex items-center gap-1 shrink-0"
            >
              Get key <ExternalLink size={12} />
            </a>
          </div>

          <p className="text-xs text-neutral-500 leading-relaxed">{meta.blurb}</p>

          {configured && !editing && (
            <>
              <div className="border-t border-white/5" />
              <div className="flex items-end justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-[11px] text-neutral-500">Key on file</p>
                  <p className="font-mono text-sm text-neutral-300 tracking-wide truncate">
                    {last4 || '…'}
                    <span className="text-neutral-600">••••••••••</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <RowAction
                    onClick={handleTest}
                    disabled={busy}
                    icon={busy ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />}
                    label="Test"
                  />
                  <RowAction
                    onClick={() => setEditing(true)}
                    icon={<Pencil size={13} />}
                    label="Update"
                  />
                  <RowAction
                    onClick={handleDelete}
                    disabled={busy}
                    icon={<Trash2 size={13} />}
                    label="Delete"
                    tone="danger"
                  />
                </div>
              </div>
            </>
          )}

          {(!configured || editing) && (
            <div className="space-y-2">
              <input
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={meta.placeholder}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-neutral-100 placeholder:text-neutral-600 transition-all font-mono text-sm"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={busy || value.trim().length < 8}
                  className="text-xs font-semibold text-white bg-indigo-500 hover:bg-indigo-400 rounded-lg px-3 py-2 transition disabled:opacity-40"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : configured ? 'Save new key' : 'Save key'}
                </button>
                {editing && (
                  <button
                    type="button"
                    onClick={() => { setEditing(false); setValue(''); setError(null); }}
                    className="text-xs font-semibold text-neutral-400 hover:text-white px-2 py-2 transition"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}

          {testResult && (
            <div className={`flex items-center gap-1.5 text-[11px] ${testResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
              {testResult.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
              {testResult.message}
            </div>
          )}
          {error && (
            <div className="flex items-center gap-1.5 text-[11px] text-rose-400">
              <XCircle size={12} /> {error}
            </div>
          )}

          <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5 text-[11px] text-amber-300/90 leading-relaxed">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>{meta.paidWarning}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProviderKeysSection() {
  const [status, setStatus] = useState<ProviderKeyStatusMap | null>(null);
  const [vaultConfigured, setVaultConfigured] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetchProviderKeyStatus();
      setStatus(res.status);
      setVaultConfigured(res.vaultConfigured);
      // Keep the runtime AI clients in sync with the latest vault state so a
      // just-added/removed key takes effect without a page reload.
      void primeProviderSession();
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="space-y-5">
      {/* Encrypted key vault reassurance card */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 flex items-start justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <Lock size={17} className="text-emerald-400 shrink-0" />
            <h3 className="text-base font-semibold text-white">Encrypted AI Key Vault</h3>
          </div>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Your API keys are encrypted at rest on our servers and never shown to you again.
          </p>
          <p className="text-xs text-neutral-500 leading-relaxed">
            Update or delete keys at any time.
          </p>
        </div>
        <ShieldCheck size={40} strokeWidth={1.5} className="text-emerald-400/70 shrink-0" />
      </div>

      {/* AI Providers heading */}
      <div>
        <h3 className="text-lg font-bold text-white">AI Providers</h3>
        <p className="text-xs text-neutral-500 mt-0.5">Manage the AI providers that power your project.</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500 py-3">
          <Loader2 size={14} className="animate-spin" /> Loading provider status…
        </div>
      ) : !vaultConfigured ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-[11px] text-amber-200 leading-relaxed flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Encrypted key storage is not available (you may be signed out, or the deployment has
            no encryption secret configured). You can still use the local-browser keys below.
          </span>
        </div>
      ) : (
        <div className="space-y-4">
          {PROVIDERS.map((meta) => (
            <ProviderRow
              key={meta.id}
              meta={meta}
              configured={status?.[meta.id]?.configured ?? false}
              last4={status?.[meta.id]?.last4 ?? ''}
              onChanged={load}
            />
          ))}
        </div>
      )}

      {/* Security footer */}
      <div className="pt-1 text-center space-y-2">
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-neutral-500">
          <Lock size={12} className="shrink-0" /> All keys are encrypted at rest and never visible in the browser.
        </p>
        <a
          href="/privacy"
          className="inline-block text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition"
        >
          Learn more about security
        </a>
      </div>
    </section>
  );
}
