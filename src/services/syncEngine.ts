import { IndexedDBService } from './indexedDB';
import { auth, FirebaseService } from './firebase';
import { SyncQueueItem, SyncConflict, AuditLog, Member, Department, ChurchEvent, User, Church, BackupRecord } from '../types';

export type SyncStatusState = 'IDLE' | 'SYNCING' | 'OFFLINE' | 'CONFLICTS_DETECTED' | 'ERROR';

type SyncListener = (state: {
  status: SyncStatusState;
  pendingCount: number;
  conflictCount: number;
  lastSyncTime: string | null;
}) => void;

class SyncEngine {
  private isProcessing = false;
  private cloudAccessEnabled = false;
  private cloudChurchId: string | null = null;
  private listeners: SyncListener[] = [];
  private lastSyncTime: string | null = null;

  setCloudAccessEnabled(enabled: boolean, churchId?: string | null) {
    this.cloudAccessEnabled = enabled;
    this.cloudChurchId = enabled ? (churchId ?? null) : null;
  }

  isCloudAccessEnabled(churchId?: string): boolean {
    if (!this.cloudAccessEnabled || !auth.currentUser) return false;
    if (!churchId || !this.cloudChurchId) return true;
    return this.cloudChurchId === churchId || this.cloudChurchId === 'PLATFORM' || this.cloudChurchId === 'PLATFORM_TENANT';
  }

  subscribe(listener: SyncListener) {
    this.listeners.push(listener);
    this.notify();
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private async notify() {
    const queue = await IndexedDBService.getAll<SyncQueueItem>('syncQueue');
    const pending = queue.filter(q => q.status === 'PENDING').length;
    const conflicts = (await IndexedDBService.getAll<SyncConflict>('conflicts')).filter(c => c.status === 'PENDING').length;
    
    let status: SyncStatusState = 'IDLE';
    if (!navigator.onLine) {
      status = 'OFFLINE';
    } else if (this.isProcessing) {
      status = 'SYNCING';
    } else if (conflicts > 0) {
      status = 'CONFLICTS_DETECTED';
    }

    this.listeners.forEach(l => l({
      status,
      pendingCount: pending,
      conflictCount: conflicts,
      lastSyncTime: this.lastSyncTime,
    }));
  }

  // Session Validity Check for Offline Protection
  async recordOnlineAuth() {
    await IndexedDBService.put('sessionConfig', {
      key: 'lastOnlineAuth',
      timestamp: Date.now(),
      isoDate: new Date().toISOString(),
    });
  }

  async checkOfflineSession(maxDays: number = 7): Promise<{
    isValid: boolean;
    remainingDays: number;
    lastAuthDate: string;
  }> {
    const authConfig = await IndexedDBService.getById<{ key: string; timestamp: number; isoDate: string }>(
      'sessionConfig', 
      'lastOnlineAuth'
    );

    if (!authConfig) {
      // First time initialization
      await this.recordOnlineAuth();
      return { isValid: true, remainingDays: maxDays, lastAuthDate: new Date().toLocaleDateString('pt-BR') };
    }

    const elapsedMs = Date.now() - authConfig.timestamp;
    const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
    const remainingDays = Math.max(0, Math.ceil(maxDays - elapsedDays));
    const isValid = elapsedDays <= maxDays;

    return {
      isValid,
      remainingDays,
      lastAuthDate: new Date(authConfig.timestamp).toLocaleDateString('pt-BR'),
    };
  }

  // Enqueue a pending mutation
  async enqueue(item: {
    churchId: string;
    operation: 'CREATE' | 'UPDATE' | 'DELETE';
    entity: 'MEMBER' | 'DEPARTMENT' | 'USER' | 'EVENT' | 'SETTINGS' | 'AUDIT_LOG' | 'BACKUP';
    entityId: string;
    payload: any;
  }) {
    const queueItem: SyncQueueItem = {
      id: `queue-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      churchId: item.churchId,
      operation: item.operation,
      entity: item.entity,
      entityId: item.entityId,
      payload: item.payload,
      timestamp: Date.now(),
      status: 'PENDING',
      retryCount: 0,
    };

    await IndexedDBService.put('syncQueue', queueItem);
    this.notify();

    // If online, authenticated in Firebase, and cloud profile is active, trigger background synchronization
    if (navigator.onLine && auth.currentUser && this.isCloudAccessEnabled(item.churchId)) {
      this.processQueue();
    }
  }

  async getPendingQueueForChurch(churchId: string): Promise<SyncQueueItem[]> {
    const queue = await IndexedDBService.getAll<SyncQueueItem>('syncQueue');
    return queue.filter(q => q.churchId === churchId && q.status === 'PENDING');
  }

  // Record an immutable Audit Log locally and in Firestore
  async logAudit(logData: {
    churchId: string;
    userId: string;
    userName: string;
    action: string;
    entityType?: AuditLog['entityType'];
    entityId?: string;
    details: string;
  }) {
    const auditRecord: AuditLog = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      churchId: logData.churchId,
      userId: logData.userId,
      userName: logData.userName,
      action: logData.action,
      entityType: logData.entityType,
      entityId: logData.entityId,
      details: logData.details,
      timestamp: Date.now(),
      date: new Date().toLocaleString('pt-BR'),
      syncedToFirestore: false,
    };

    // 1. Save in local IndexedDB
    await IndexedDBService.put('auditLogs', auditRecord);

    // 2. If online, authenticated, & cloud profile is verified in Firestore, write to 'auditLogs' immediately
    if (navigator.onLine && auth.currentUser && this.isCloudAccessEnabled(logData.churchId)) {
      const firestoreRecord: AuditLog = {
        ...auditRecord,
        userId: auth.currentUser.uid,
      };
      try {
        await FirebaseService.saveAuditLog(firestoreRecord);
        auditRecord.syncedToFirestore = true;
        await IndexedDBService.put('auditLogs', auditRecord);
      } catch (e: any) {
        if (e?.message !== 'FIREBASE_AUTH_REQUIRED') {
          console.warn('Could not write audit log directly to Firestore, enqueuing for sync:', e);
        }
        await this.enqueue({
          churchId: logData.churchId,
          operation: 'CREATE',
          entity: 'AUDIT_LOG',
          entityId: auditRecord.id,
          payload: firestoreRecord,
        });
      }
    } else if (auth.currentUser && this.cloudAccessEnabled) {
      // Offline while authenticated: enqueue so it syncs when connection returns
      await this.enqueue({
        churchId: logData.churchId,
        operation: 'CREATE',
        entity: 'AUDIT_LOG',
        entityId: auditRecord.id,
        payload: { ...auditRecord, userId: auth.currentUser.uid },
      });
    }

    this.notify();
    return auditRecord;
  }

  // Process sync queue
  async processQueue(): Promise<{ syncedCount: number; conflictCount: number; errors: string[] }> {
    if (this.isProcessing) return { syncedCount: 0, conflictCount: 0, errors: [] };
    if (!navigator.onLine) {
      this.notify();
      return { syncedCount: 0, conflictCount: 0, errors: ['Dispositivo offline'] };
    }
    if (!auth.currentUser || !this.cloudAccessEnabled) {
      this.notify();
      return { syncedCount: 0, conflictCount: 0, errors: [] };
    }

    this.isProcessing = true;
    this.notify();

    let syncedCount = 0;
    let conflictCount = 0;
    const errors: string[] = [];

    try {
      const queue = await IndexedDBService.getAll<SyncQueueItem>('syncQueue');
      const pendingItems = queue
        .filter(q => q.status === 'PENDING')
        .sort((a, b) => a.timestamp - b.timestamp);

      for (const item of pendingItems) {
        if (!this.isCloudAccessEnabled(item.churchId)) {
          continue;
        }
        try {
          if (item.entity === 'MEMBER') {
            if (item.operation === 'CREATE' || item.operation === 'UPDATE') {
              // Conflict detection: Fetch remote item to check if modified on server
              const remoteMembers = await FirebaseService.getMembers(item.churchId);
              const remoteMatch = remoteMembers.find(m => m.id === item.entityId);

              if (remoteMatch && item.operation === 'UPDATE') {
                const remoteTime = remoteMatch.updatedAt ? new Date(remoteMatch.updatedAt).getTime() : 0;
                // If remote was updated after our offline change was created and has differences:
                if (remoteTime > item.timestamp) {
                  const hasDifference = JSON.stringify(remoteMatch) !== JSON.stringify(item.payload);
                  if (hasDifference) {
                    // CONFLICT DETECTED!
                    const conflict: SyncConflict = {
                      id: `conflict-${Date.now()}-${item.entityId}`,
                      churchId: item.churchId,
                      entity: 'MEMBER',
                      entityId: item.entityId,
                      entityName: (item.payload as Member).fullName || remoteMatch.fullName,
                      localVersion: item.payload,
                      remoteVersion: remoteMatch,
                      detectedAt: new Date().toLocaleString('pt-BR'),
                      status: 'PENDING',
                    };

                    await IndexedDBService.put('conflicts', conflict);
                    item.status = 'CONFLICT';
                    await IndexedDBService.put('syncQueue', item);
                    conflictCount++;
                    continue; // Skip automatic overwrite
                  }
                }
              }

              // Normal sync
              await FirebaseService.saveMember(item.payload as Member);
              item.status = 'SYNCED';
              await IndexedDBService.put('syncQueue', item);
              syncedCount++;
            } else if (item.operation === 'DELETE') {
              await FirebaseService.deleteMember(item.churchId, item.entityId);
              item.status = 'SYNCED';
              await IndexedDBService.put('syncQueue', item);
              syncedCount++;
            }
          } else if (item.entity === 'DEPARTMENT') {
            if (item.operation === 'DELETE') {
              await FirebaseService.deleteDepartment(item.churchId, item.entityId);
            } else {
              await FirebaseService.saveDepartment(item.payload as Department);
            }
            item.status = 'SYNCED';
            await IndexedDBService.put('syncQueue', item);
            syncedCount++;
          } else if (item.entity === 'EVENT') {
            if (item.operation === 'DELETE') {
              await FirebaseService.deleteEvent(item.churchId, item.entityId);
            } else {
              await FirebaseService.saveEvent(item.payload as ChurchEvent);
            }
            item.status = 'SYNCED';
            await IndexedDBService.put('syncQueue', item);
            syncedCount++;
          } else if (item.entity === 'USER') {
            if (item.operation === 'DELETE') {
              await FirebaseService.deleteUser(item.entityId);
            } else if (item.payload) {
              await FirebaseService.saveUser(item.payload as User);
            }
            item.status = 'SYNCED';
            await IndexedDBService.put('syncQueue', item);
            syncedCount++;
          } else if (item.entity === 'SETTINGS') {
            if (item.payload && (item.operation === 'CREATE' || item.operation === 'UPDATE')) {
              await FirebaseService.saveChurch(item.payload as Church);
            }
            item.status = 'SYNCED';
            await IndexedDBService.put('syncQueue', item);
            syncedCount++;
          } else if (item.entity === 'AUDIT_LOG') {
            const logPayload: AuditLog = auth.currentUser
              ? { ...(item.payload as AuditLog), userId: auth.currentUser.uid }
              : (item.payload as AuditLog);
            await FirebaseService.saveAuditLog(logPayload);
            item.status = 'SYNCED';
            await IndexedDBService.put('syncQueue', item);
            syncedCount++;
          } else if (item.entity === 'BACKUP') {
            if (item.operation === 'DELETE') {
              await FirebaseService.deleteBackup(item.entityId);
            } else if (item.payload) {
              await FirebaseService.saveBackup(item.payload as BackupRecord);
            }
            item.status = 'SYNCED';
            await IndexedDBService.put('syncQueue', item);
            syncedCount++;
          } else {
            // General entities
            item.status = 'SYNCED';
            await IndexedDBService.put('syncQueue', item);
            syncedCount++;
          }
        } catch (err: any) {
          if (err?.message === 'FIREBASE_AUTH_REQUIRED') {
            // Pause queue cleanly without failing items or logging errors when unauthenticated
            break;
          }
          console.warn(`Queue sync deferred for item ${item.id}:`, err?.message || err);
          item.retryCount = (item.retryCount || 0) + 1;
          item.error = err.message || String(err);
          if (item.retryCount >= 5) {
            item.status = 'FAILED';
          }
          await IndexedDBService.put('syncQueue', item);
          errors.push(`Item ${item.entity}: ${err.message}`);
        }
      }

      this.lastSyncTime = new Date().toLocaleTimeString('pt-BR');
    } finally {
      this.isProcessing = false;
      this.notify();
    }

    return { syncedCount, conflictCount, errors };
  }

  // Resolve a detected conflict
  async resolveConflict(
    conflictId: string, 
    resolution: 'KEPT_LOCAL' | 'KEPT_REMOTE' | 'MERGED', 
    chosenData?: any
  ) {
    const conflict = await IndexedDBService.getById<SyncConflict>('conflicts', conflictId);
    if (!conflict) return;

    let finalPayload: any;
    if (resolution === 'KEPT_LOCAL') {
      finalPayload = conflict.localVersion;
    } else if (resolution === 'KEPT_REMOTE') {
      finalPayload = conflict.remoteVersion;
    } else {
      finalPayload = chosenData || conflict.localVersion;
    }

    if (conflict.entity === 'MEMBER') {
      // Save locally
      await IndexedDBService.put('members', finalPayload);
      // Save remotely if online and authenticated in Firebase
      if (navigator.onLine && auth.currentUser) {
        await FirebaseService.saveMember(finalPayload);
      } else if (auth.currentUser) {
        await this.enqueue({
          churchId: conflict.churchId,
          operation: 'UPDATE',
          entity: 'MEMBER',
          entityId: conflict.entityId,
          payload: finalPayload,
        });
      }
    }

    conflict.status = 'RESOLVED';
    conflict.resolution = resolution;
    await IndexedDBService.put('conflicts', conflict);

    // Remove or mark corresponding queue item as synced
    const queue = await IndexedDBService.getAll<SyncQueueItem>('syncQueue');
    const queueItem = queue.find(q => q.entityId === conflict.entityId && q.status === 'CONFLICT');
    if (queueItem) {
      queueItem.status = 'SYNCED';
      await IndexedDBService.put('syncQueue', queueItem);
    }

    this.notify();
  }
}

export const syncEngine = new SyncEngine();

// Auto-trigger sync on window online event
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[SyncEngine] Conexão restabelecida. Sincronizando fila...');
    syncEngine.processQueue();
  });
}
