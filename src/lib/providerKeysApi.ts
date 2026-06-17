// Client helper for the encrypted provider-key vault (`/api/provider-keys`).
//
// The server only ever returns masked status (`configured`, `last4`,
// `updatedAt`) — never key material. This module mirrors that: it can save,
// delete, test, and read status, but it has no way to read a key back.

export type ProviderId = 'gemini' | 'openai';

export interface ProviderStatus {
  configured: boolean;
  last4: string;
  updatedAt: string | null;
}

export type ProviderKeyStatusMap = Record<ProviderId, ProviderStatus>;

export interface ProviderKeyStatusResponse {
  status: ProviderKeyStatusMap;
  vaultConfigured: boolean;
}

const EMPTY_STATUS: ProviderStatus = { configured: false, last4: '', updatedAt: null };

export async function fetchProviderKeyStatus(): Promise<ProviderKeyStatusResponse> {
  const res = await fetch('/api/provider-keys', { credentials: 'include' });
  if (res.status === 401) {
    return { status: { gemini: EMPTY_STATUS, openai: EMPTY_STATUS }, vaultConfigured: false };
  }
  if (res.status === 503) {
    return { status: { gemini: EMPTY_STATUS, openai: EMPTY_STATUS }, vaultConfigured: false };
  }
  if (!res.ok) throw new Error('Failed to load provider key status.');
  return res.json();
}

export async function saveProviderKey(
  provider: ProviderId,
  key: string,
): Promise<{ ok: true; last4: string } | { ok: false; message: string }> {
  const res = await fetch('/api/provider-keys', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, key }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data?.configured) return { ok: true, last4: data.last4 ?? '' };
  return { ok: false, message: data?.message || 'Could not save key.' };
}

export async function deleteProviderKey(provider: ProviderId): Promise<boolean> {
  const res = await fetch(`/api/provider-keys?provider=${encodeURIComponent(provider)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  return res.ok;
}

export async function testProviderKey(
  provider: ProviderId,
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch('/api/provider-keys?action=test', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: Boolean(data?.ok), message: data?.message || (data?.ok ? 'Connection succeeded.' : 'Connection failed.') };
}
