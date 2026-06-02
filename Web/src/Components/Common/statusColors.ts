// Single source of truth for status palettes across the app. Three domains,
// each with its own map — the strings overlap (`ready` is both a patch
// lifecycle status and an upload lifecycle status) so callers must pick the
// right map for what they're rendering.

// Patch lifecycle (per-platform patch document, rendered in Patches tab,
// Upload-details Patches tab, and PatchPairDetail).
export const PATCH_STATUS_COLORS: Record<string, string> = {
  pending: '#9e9e9e',
  generating: '#42a5f5',
  validating: '#9775fa',
  ready: '#4caf50',
  failed: '#ef5350',
  'not-beneficial': '#ffa94d',
}

// Upload lifecycle (the upload document itself: ready=new, released,
// obsolete, deleted). `deleted` is a soft-delete tombstone — the row keeps
// its identity for stats/audit but is excluded from default list views.
export const UPLOAD_STATUS_COLORS: Record<string, string> = {
  released: '#7fdc96',
  ready: '#7fb3ff', // displayed as "new" in the UI
  obsolete: 'rgba(255,255,255,0.6)',
  deleted: '#ef5350',
}

// Patch-jobs audit events (PatchPairDetail history table).
export const PATCH_EVENT_COLORS: Record<string, string> = {
  created: '#4dabf7',
  'status-changed': '#9775fa',
  removed: '#ff6b6b',
}

// Common label remap: the upload status `ready` is shown as "new" to users
// (matches the StatusPill component). Centralised here so any badge that
// renders upload status uses the same wording.
export const UPLOAD_STATUS_LABELS: Record<string, string> = {
  ready: 'new',
}
