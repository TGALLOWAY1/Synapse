// Derive the mockup routing fields from a composite image key so a ref
// persisted only by the (server-to-server) Blob onUploadCompleted callback —
// which carries no full metadata — is still hydratable. Mockup keys are
// `versionId:screenId:quality`, plus a trailing `:gemini` for Nano Banana
// renders (src/lib/mockupImageStore.ts `buildImageKey`). The versionId itself
// may contain colons (namespaced demo restores), so segments are read from the
// end.
export function routingFromKey(key) {
  const parts = String(key).split(':');
  if (parts[parts.length - 1] === 'gemini') parts.pop();
  if (parts.length < 3) return {};
  const quality = parts[parts.length - 1];
  const screenId = parts[parts.length - 2];
  const versionId = parts.slice(0, parts.length - 2).join(':');
  return { versionId, screenId, quality };
}
