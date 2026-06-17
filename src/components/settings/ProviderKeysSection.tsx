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
} from 'lucide-react';
import {
  fetchProviderKeyStatus,
  saveProviderKey,
  deleteProviderKey,
  testProviderKey,
  type ProviderId,
  type ProviderKeyStatusMap,
} from '../../lib/providerKeysApi';

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
      'Gemini usage is billed to YOUR Google account. Generous free tier exists, but heavy use may incur charges.',
  },
  {
    id: 'openai',
    label: 'OpenAI (image generation)',
    placeholder: 'Paste your sk-… key',
    getKeyUrl: 'https://platform.openai.com/api-keys',
    blurb: 'Powers AI mockup image previews (gpt-image-2).',
    paidWarning:
      'Image generation is a PAID OpenAI operation billed to YOUR account — typically a few cents per image. No free tier.',
  },
];

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
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-neutral-200 truncate">{meta.label}</span>
          {configured ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2 py-0.5">
              <ShieldCheck size={11} /> Configured
            </span>
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
              Not configured
            </span>
          )}
        </div>
        <a
          href={meta.getKeyUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] font-bold uppercase tracking-wider text-indigo-400 hover:text-indigo-300 transition flex items-center gap-1 shrink-0"
        >
          Get Key <ExternalLink size={10} />
        </a>
      </div>

      <p className="text-[11px] text-neutral-500 leading-relaxed">{meta.blurb}</p>

      {configured && !editing && (
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-neutral-400">Key on file: {last4 || '…'}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTest}
              disabled={busy}
              className="text-xs font-semibold text-neutral-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 transition disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : 'Test'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-semibold text-neutral-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 transition"
            >
              Update
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="text-xs font-semibold text-rose-300 hover:text-rose-200 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg px-2.5 py-1.5 transition disabled:opacity-50"
              title="Delete key"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
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
              className="text-xs font-semibold text-white bg-indigo-500 hover:bg-indigo-400 rounded-lg px-3 py-1.5 transition disabled:opacity-40"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : configured ? 'Save new key' : 'Save key'}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => { setEditing(false); setValue(''); setError(null); }}
                className="text-xs font-semibold text-neutral-400 hover:text-white px-2 py-1.5 transition"
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

      <p className="flex items-start gap-1.5 text-[11px] text-amber-300/80 leading-relaxed">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {meta.paidWarning}
      </p>
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
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Lock size={14} className="text-emerald-400" />
        <h3 className="text-sm font-semibold text-neutral-200">AI Providers — encrypted key vault</h3>
      </div>
      <p className="text-[11px] text-neutral-500 leading-relaxed">
        Keys saved here are <strong>encrypted at rest on the server</strong> and used to make
        AI calls on your behalf. They are never shown again after saving and never returned to
        the browser. You can update or delete a key at any time.
      </p>

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
        <div className="space-y-3">
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
    </section>
  );
}
