export function sanitizeForFirestore<T>(value: T): T {
  if (value === undefined || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .filter(item => item !== undefined)
      .map(item => sanitizeForFirestore(item)) as unknown as T;
  }

  if (typeof value === 'object' && !(value instanceof Date)) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val !== undefined) {
        cleaned[key] = sanitizeForFirestore(val);
      }
    }
    return cleaned as T;
  }

  return value;
}

export interface PendingQueueRef {
  entityId: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  timestamp: number;
}

function parseIsoMs(iso?: string): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Merges remote Firestore records with local IndexedDB/Storage records without overwriting
 * unsynced local mutations or items queued for upload/deletion.
 */
export function mergeTenantRecords<T extends { id: string; updatedAt?: string }>(options: {
  localRecords: T[];
  remoteRecords: T[];
  pendingQueueItems?: PendingQueueRef[];
}): T[] {
  const { localRecords, remoteRecords, pendingQueueItems = [] } = options;

  const pendingUpsertIds = new Set<string>();
  const pendingDeleteIds = new Set<string>();

  for (const q of pendingQueueItems) {
    if (q.operation === 'DELETE') {
      pendingDeleteIds.add(q.entityId);
    } else {
      pendingUpsertIds.add(q.entityId);
    }
  }

  const merged = new Map<string, T>();

  for (const remote of remoteRecords) {
    if (!pendingDeleteIds.has(remote.id)) {
      merged.set(remote.id, remote);
    }
  }

  for (const local of localRecords) {
    if (pendingDeleteIds.has(local.id)) continue;

    const remote = merged.get(local.id);
    if (!remote) {
      // Exists locally (e.g., saved before cloud sync or offline) — preserve!
      merged.set(local.id, local);
      continue;
    }

    if (pendingUpsertIds.has(local.id)) {
      merged.set(local.id, local);
      continue;
    }

    const localTime = parseIsoMs(local.updatedAt);
    const remoteTime = parseIsoMs(remote.updatedAt);
    if (localTime > remoteTime) {
      merged.set(local.id, local);
    }
  }

  return Array.from(merged.values());
}
