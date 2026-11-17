import {
  Church,
  User,
  Member,
  Department,
  ChurchEvent,
  AuditLog,
  BackupRecord,
  AutoBackupFrequency,
  BackupExportFormat,
  PaymentProof,
  SupportTicket,
  PlatformPaymentSettings,
} from '../types';
import { IndexedDBService } from './indexedDB';
import { auth, FirebaseService } from './firebase';
import { StorageService } from './storage';
import { syncEngine } from './syncEngine';
import { generateReportCsv, triggerCsvDownload } from '../utils/csvMemberUtils';

// Simple CRC32 / Checksum generator for data integrity verification
function generateChecksum(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return `CRC32-${Math.abs(hash).toString(16).toUpperCase()}`;
}

function sanitizeFileSegment(raw: string): string {
  return (raw || 'igreja')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'igreja';
}

function formatBackupTimestampForFilename(isoOrLabel?: string): string {
  const date = isoOrLabel ? new Date(isoOrLabel) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

export interface CreateBackupOptions {
  isPreRestore?: boolean;
  trigger?: 'MANUAL' | 'AUTOMATIC' | 'PRE_RESTORE';
}

export interface FullBackupPayload {
  version: string;
  exportedAt: string;
  churchId: string;
  churchName: string;
  data: {
    church: Church;
    members: Member[];
    departments: Department[];
    events: ChurchEvent[];
    auditLogs: AuditLog[];
    users: User[];
  };
}

export interface PlatformNetlifySnapshot {
  format: 'SECRETARIA_NETLIFY_SYNC_V1';
  exportedAt: string;
  sourceOrigin: string;
  churches: Church[];
  users: User[];
  members: Member[];
  departments: Department[];
  events: ChurchEvent[];
  paymentProofs: PaymentProof[];
  tickets: SupportTicket[];
  paymentSettings?: PlatformPaymentSettings;
}

export const BackupService = {
  getAutoBackupFrequency(church: Church): AutoBackupFrequency {
    const configured = church.offlineConfig?.autoBackupFrequency;
    if (configured) return configured;
    if (church.offlineConfig?.autoBackupDaily === false) return 'DISABLED';
    return 'DAILY';
  },

  getIntervalMs(frequency: AutoBackupFrequency): number {
    switch (frequency) {
      case 'DAILY':
        return 24 * 60 * 60 * 1000;
      case 'WEEKLY':
        return 7 * 24 * 60 * 60 * 1000;
      case 'MONTHLY':
        return 30 * 24 * 60 * 60 * 1000;
      default:
        return Number.POSITIVE_INFINITY;
    }
  },

  isAutoBackupDue(church: Church, nowMs = Date.now()): boolean {
    const frequency = this.getAutoBackupFrequency(church);
    if (frequency === 'DISABLED') return false;
    const lastIso = church.offlineConfig?.lastAutoBackupAt;
    if (!lastIso) return true;
    const lastMs = new Date(lastIso).getTime();
    if (Number.isNaN(lastMs)) return true;
    return nowMs - lastMs >= this.getIntervalMs(frequency);
  },

  getNextAutoBackupDate(church: Church): Date | null {
    const frequency = this.getAutoBackupFrequency(church);
    if (frequency === 'DISABLED') return null;
    const lastIso = church.offlineConfig?.lastAutoBackupAt;
    if (!lastIso) return new Date();
    const lastMs = new Date(lastIso).getTime();
    if (Number.isNaN(lastMs)) return new Date();
    return new Date(lastMs + this.getIntervalMs(frequency));
  },

  // Create a complete backup snapshot of current church data (members, departments, events, auditLogs, users)
  async createBackup(
    church: Church,
    user: User,
    isPreRestoreOrOptions: boolean | CreateBackupOptions = false
  ): Promise<BackupRecord> {
    const opts: CreateBackupOptions =
      typeof isPreRestoreOrOptions === 'boolean'
        ? { isPreRestore: isPreRestoreOrOptions, trigger: isPreRestoreOrOptions ? 'PRE_RESTORE' : 'MANUAL' }
        : isPreRestoreOrOptions;

    const isPreRestore = Boolean(opts.isPreRestore);
    const trigger: 'MANUAL' | 'AUTOMATIC' | 'PRE_RESTORE' =
      opts.trigger || (isPreRestore ? 'PRE_RESTORE' : 'MANUAL');

    // Gather all local and synced data for this church
    let members = await IndexedDBService.getAll<Member>('members', church.id);
    if (members.length === 0) {
      members = StorageService.getMembers(church.id);
    }

    let departments = await IndexedDBService.getAll<Department>('departments', church.id);
    if (departments.length === 0) {
      departments = StorageService.getDepartments(church.id);
    }

    let events = await IndexedDBService.getAll<ChurchEvent>('events', church.id);
    if (events.length === 0) {
      events = StorageService.getEvents(church.id);
    }

    let users = await IndexedDBService.getAll<User>('users', church.id);
    if (users.length === 0) {
      users = StorageService.getUsers().filter(u => u.churchId === church.id);
    }

    let auditLogs = await IndexedDBService.getAll<AuditLog>('auditLogs', church.id);
    if (auth.currentUser && typeof navigator !== 'undefined' && navigator.onLine && syncEngine.isCloudAccessEnabled(church.id)) {
      try {
        const cloudLogs = await FirebaseService.getAuditLogs(church.id);
        if (cloudLogs.length > 0) {
          const merged = new Map<string, AuditLog>();
          auditLogs.forEach(l => merged.set(l.id, l));
          cloudLogs.forEach(c => merged.set(c.id, { ...c, syncedToFirestore: true }));
          auditLogs = Array.from(merged.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        }
      } catch {
        // Fallback to local audit logs
      }
    } else {
      auditLogs = [...auditLogs].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    const nowIso = new Date().toISOString();
    const payload: FullBackupPayload = {
      version: '2.0',
      exportedAt: nowIso,
      churchId: church.id,
      churchName: church.name,
      data: {
        church,
        members,
        departments,
        events,
        auditLogs,
        users,
      },
    };

    const jsonString = JSON.stringify(payload);
    const checksum = generateChecksum(jsonString);
    const sizeBytes =
      typeof Blob !== 'undefined' ? new Blob([jsonString]).size : new TextEncoder().encode(jsonString).length;

    const backupRecord: BackupRecord = {
      id: `backup-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      churchId: church.id,
      churchName: church.name,
      createdAt: new Date().toLocaleString('pt-BR'),
      createdAtIso: nowIso,
      createdBy: user.name,
      recordCounts: {
        members: members.length,
        departments: departments.length,
        events: events.length,
        users: users.length,
        auditLogs: auditLogs.length,
      },
      checksum,
      dataJson: jsonString,
      status: isPreRestore ? 'PRE_RESTORE' : 'COMPLETED',
      trigger,
      sizeBytes,
      integrityVerified: true,
    };

    // Save locally in IndexedDB database store
    await IndexedDBService.put('backups', backupRecord);

    // Save to Cloud Firestore database when signed into Firebase Auth & cloud profile is active
    const isOnline = typeof navigator === 'undefined' || navigator.onLine;
    if (auth.currentUser && isOnline && syncEngine.isCloudAccessEnabled(church.id)) {
      try {
        await FirebaseService.saveBackup(backupRecord);
      } catch (e) {
        console.warn('Could not sync backup to Firestore immediately, queuing for retry:', e);
        await syncEngine.enqueue({
          churchId: church.id,
          operation: 'CREATE',
          entity: 'BACKUP',
          entityId: backupRecord.id,
          payload: backupRecord,
        });
      }
    } else if (auth.currentUser && syncEngine.isCloudAccessEnabled(church.id)) {
      await syncEngine.enqueue({
        churchId: church.id,
        operation: 'CREATE',
        entity: 'BACKUP',
        entityId: backupRecord.id,
        payload: backupRecord,
      });
    }

    // Log in Audit
    const actionLabel =
      trigger === 'PRE_RESTORE'
        ? 'Backup Preventivo (Pré-Restauração)'
        : trigger === 'AUTOMATIC'
        ? 'Backup Automático Periódico Executado'
        : 'Criação de Backup Completo da Igreja';

    await syncEngine.logAudit({
      churchId: church.id,
      userId: user.id,
      userName: user.name,
      action: actionLabel,
      entityType: 'BACKUP',
      entityId: backupRecord.id,
      details: `Backup gerado: ${members.length} membros, ${departments.length} depts, ${events.length} eventos, ${auditLogs.length} logs de auditoria. Integridade: ${checksum}`,
    });

    return backupRecord;
  },

  buildBackupCsvFromDataJson(dataJson: string): string {
    const parsed = JSON.parse(dataJson) as Partial<FullBackupPayload>;
    const data = parsed?.data;

    const headers = [
      'TIPO_REGISTRO',
      'ID',
      'NOME_OU_TITULO',
      'STATUS_OU_CATEGORIA',
      'DATA_REFERENCIA',
      'RESPONSAVEL_OU_EMAIL',
      'TELEFONE_OU_LOCAL',
      'DETALHES',
    ];

    const rows: (string | number | undefined | null)[][] = [];

    if (data?.church) {
      const c = data.church;
      rows.push([
        'IGREJA',
        c.id,
        c.name,
        `${c.status} / ${c.plan}`,
        c.createdAt,
        `${c.pastorName || ''} (${c.email || ''})`.trim(),
        `${c.phone || ''} | ${c.city || ''}-${c.state || ''}`.trim(),
        `Código: ${c.exclusiveCode} | Denominação: ${c.denomination || ''} | Exportado em: ${parsed.exportedAt || ''}`,
      ]);
    }

    const deptNameMap = new Map<string, string>(
      (Array.isArray(data?.departments) ? data.departments : []).map(d => [d.id, d.name])
    );

    if (Array.isArray(data?.members)) {
      for (const m of data.members) {
        const deptNames = Array.isArray(m.departmentIds)
          ? m.departmentIds.map(id => deptNameMap.get(id) || id).join(', ')
          : '';
        const addressSummary = m.address
          ? [m.address.street, m.address.number, m.address.neighborhood, m.address.city, m.address.state]
              .filter(Boolean)
              .join(', ')
          : '';
        rows.push([
          'MEMBRO',
          m.id,
          m.fullName,
          m.status === 'ACTIVE' ? 'ATIVO' : 'INATIVO',
          m.membershipDate || m.birthDate || '',
          m.email || '',
          m.phone || '',
          `Código: ${m.memberCode || ''} | Cargo: ${m.churchRole || ''} | Depts: ${deptNames || 'Nenhum'} | Endereço: ${addressSummary}`,
        ]);
      }
    }

    if (Array.isArray(data?.departments)) {
      for (const d of data.departments) {
        rows.push([
          'DEPARTAMENTO',
          d.id,
          d.name,
          d.status === 'ACTIVE' ? 'ATIVO' : 'INATIVO',
          d.createdAt || '',
          d.leaderName || d.leaderId || '',
          `${d.memberCount || 0} membro(s)`,
          d.description || '',
        ]);
      }
    }

    if (Array.isArray(data?.events)) {
      for (const ev of data.events) {
        rows.push([
          'EVENTO',
          ev.id,
          ev.title,
          `${ev.category} (${ev.status})`,
          `${ev.startDate}${ev.endDate ? ` até ${ev.endDate}` : ''}`,
          ev.organizer || '',
          ev.location || '',
          ev.description || '',
        ]);
      }
    }

    if (Array.isArray(data?.auditLogs)) {
      for (const log of data.auditLogs) {
        rows.push([
          'LOG_AUDITORIA',
          log.id,
          log.action,
          log.entityType,
          log.date || (log.timestamp ? new Date(log.timestamp).toISOString() : ''),
          log.userName,
          log.entityId || '',
          log.details,
        ]);
      }
    }

    if (Array.isArray(data?.users)) {
      for (const u of data.users) {
        rows.push([
          'USUARIO',
          u.id,
          u.name,
          `${u.role} (${u.status})`,
          u.lastLogin || '',
          u.email,
          u.churchId,
          Array.isArray(u.departmentIds) && u.departmentIds.length > 0
            ? `Departamentos: ${u.departmentIds.map(id => deptNameMap.get(id) || id).join(', ')}`
            : '',
        ]);
      }
    }

    return generateReportCsv(headers, rows);
  },

  downloadBackupToDevice(
    churchName: string,
    dataJson: string,
    format: BackupExportFormat,
    dateIsoOrLabel?: string
  ): void {
    if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return;
    }

    const baseName = `backup_completo_${sanitizeFileSegment(churchName)}_${formatBackupTimestampForFilename(dateIsoOrLabel)}`;

    if (format === 'JSON' || format === 'BOTH') {
      let formattedJson = dataJson;
      try {
        formattedJson = JSON.stringify(JSON.parse(dataJson), null, 2);
      } catch {
        // Keep raw JSON if already valid string
      }
      const blob = new Blob([formattedJson], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    if (format === 'CSV' || format === 'BOTH') {
      const csvContent = this.buildBackupCsvFromDataJson(dataJson);
      triggerCsvDownload(`${baseName}.csv`, csvContent);
    }
  },

  async exportManualBackup(
    church: Church,
    user: User,
    format: 'JSON' | 'CSV' | 'BOTH'
  ): Promise<BackupRecord> {
    const backup = await this.createBackup(church, user, { trigger: 'MANUAL' });
    this.downloadBackupToDevice(church.name, backup.dataJson, format, backup.createdAtIso);

    await syncEngine.logAudit({
      churchId: church.id,
      userId: user.id,
      userName: user.name,
      action: `Exportação Local de Backup (${format})`,
      entityType: 'EXPORT',
      entityId: backup.id,
      details: `Backup completo baixado para o dispositivo em formato ${format} (${backup.recordCounts.members} membros, ${backup.recordCounts.departments} depts, ${backup.recordCounts.events} eventos, ${backup.recordCounts.auditLogs || 0} logs).`,
    });

    return backup;
  },

  async runScheduledBackupIfDue(
    church: Church,
    user: User
  ): Promise<{ executed: boolean; backup?: BackupRecord; updatedChurch?: Church }> {
    if (!this.isAutoBackupDue(church)) {
      return { executed: false };
    }

    // Save automatic backup exclusively in the database (IndexedDB + Cloud Firestore),
    // never triggering automatic downloads to the phone/computer filesystem on startup.
    const backup = await this.createBackup(church, user, { trigger: 'AUTOMATIC' });
    const format: BackupExportFormat = church.offlineConfig?.autoBackupFormat || 'JSON';

    const updatedChurch: Church = {
      ...church,
      offlineConfig: {
        maxOfflineDays: church.offlineConfig?.maxOfflineDays || 7,
        autoBackupDaily: this.getAutoBackupFrequency(church) !== 'DISABLED',
        autoBackupFrequency: this.getAutoBackupFrequency(church),
        autoBackupFormat: format,
        autoDownloadLocalBackup: false,
        lastAutoBackupAt: backup.createdAtIso || new Date().toISOString(),
      },
    };

    return { executed: true, backup, updatedChurch };
  },

  // Verify backup integrity
  verifyIntegrity(backup: BackupRecord): boolean {
    const computed = generateChecksum(backup.dataJson);
    return computed === backup.checksum;
  },

  // Restore backup safely with strict church tenant verification
  async restoreBackup(
    backup: BackupRecord,
    currentChurch: Church,
    user: User
  ): Promise<{ success: boolean; restoredCounts?: any; error?: string }> {
    // 1. Strict Tenant Isolation Check
    if (backup.churchId !== currentChurch.id) {
      const errorMsg = `Violação grave de isolamento: O backup pertence à igreja "${backup.churchName}" (${backup.churchId}), não sendo permitido restaurar sobre "${currentChurch.name}" (${currentChurch.id}).`;

      await syncEngine.logAudit({
        churchId: currentChurch.id,
        userId: user.id,
        userName: user.name,
        action: 'Tentativa Bloqueada de Restauração Cruzada',
        entityType: 'SECURITY',
        entityId: backup.id,
        details: errorMsg,
      });

      return { success: false, error: errorMsg };
    }

    // 2. Verify Integrity (external imported JSON without checksum skips checksum error)
    if (backup.checksum && !backup.checksum.startsWith('IMPORTED-') && !this.verifyIntegrity(backup)) {
      return { success: false, error: 'O backup falhou na verificação de integridade (Checksum inválido ou arquivo corrompido).' };
    }

    // 3. Create automatic Preventive Backup before restoring!
    await this.createBackup(currentChurch, user, { isPreRestore: true, trigger: 'PRE_RESTORE' });

    // 4. Parse and restore data
    try {
      const parsed = JSON.parse(backup.dataJson);
      const { members, departments, events, auditLogs } = parsed.data || {};

      // Restore into IndexedDB + Church-scoped StorageService
      if (Array.isArray(members)) {
        await IndexedDBService.putMany('members', members);
        const existingOther = (() => {
          try {
            const raw = localStorage.getItem('sec_igreja_members');
            return raw ? (JSON.parse(raw) as Member[]).filter(m => m.churchId !== currentChurch.id) : [];
          } catch {
            return [];
          }
        })();
        localStorage.setItem('sec_igreja_members', JSON.stringify([...existingOther, ...members]));
      }

      if (Array.isArray(departments)) {
        await IndexedDBService.putMany('departments', departments);
        const existingOther = (() => {
          try {
            const raw = localStorage.getItem('sec_igreja_departments');
            return raw ? (JSON.parse(raw) as Department[]).filter(d => d.churchId !== currentChurch.id) : [];
          } catch {
            return [];
          }
        })();
        localStorage.setItem('sec_igreja_departments', JSON.stringify([...existingOther, ...departments]));
      }

      if (Array.isArray(events)) {
        await IndexedDBService.putMany('events', events);
        const existingOther = (() => {
          try {
            const raw = localStorage.getItem('sec_igreja_events');
            return raw ? (JSON.parse(raw) as ChurchEvent[]).filter(e => e.churchId !== currentChurch.id) : [];
          } catch {
            return [];
          }
        })();
        localStorage.setItem('sec_igreja_events', JSON.stringify([...existingOther, ...events]));
      }

      if (Array.isArray(auditLogs) && auditLogs.length > 0) {
        await IndexedDBService.putMany('auditLogs', auditLogs);
      }

      // Sync restored church entities to Firestore immediately or via syncQueue
      await this.pushChurchLocalDataToCloud(
        currentChurch,
        [],
        Array.isArray(members) ? members : [],
        Array.isArray(departments) ? departments : [],
        Array.isArray(events) ? events : [],
        true
      );

      // Log success in Audit
      await syncEngine.logAudit({
        churchId: currentChurch.id,
        userId: user.id,
        userName: user.name,
        action: 'Restauração de Backup Concluída',
        entityType: 'BACKUP',
        entityId: backup.id,
        details: `Restauração aplicada com sucesso a partir do backup de ${backup.createdAt}.`,
      });

      return {
        success: true,
        restoredCounts: {
          members: members?.length || 0,
          departments: departments?.length || 0,
          events: events?.length || 0,
          auditLogs: auditLogs?.length || 0,
        },
      };
    } catch (e: any) {
      return { success: false, error: `Falha ao processar dados do backup: ${e.message}` };
    }
  },

  async restoreBackupFromJsonString(
    rawJson: string,
    currentChurch: Church,
    user: User
  ): Promise<{ success: boolean; restoredCounts?: any; error?: string }> {
    try {
      const parsed = JSON.parse(rawJson) as Partial<FullBackupPayload>;
      if (!parsed || !parsed.data || !parsed.churchId) {
        return { success: false, error: 'Arquivo JSON inválido: estrutura de backup da igreja não reconhecida.' };
      }

      const syntheticRecord: BackupRecord = {
        id: `import-${Date.now()}`,
        churchId: parsed.churchId,
        churchName: parsed.churchName || parsed.data.church?.name || 'Igreja do Arquivo',
        createdAt: parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR'),
        createdAtIso: parsed.exportedAt || new Date().toISOString(),
        createdBy: user.name,
        recordCounts: {
          members: parsed.data.members?.length || 0,
          departments: parsed.data.departments?.length || 0,
          events: parsed.data.events?.length || 0,
          users: parsed.data.users?.length || 0,
          auditLogs: parsed.data.auditLogs?.length || 0,
        },
        checksum: `IMPORTED-${Date.now().toString(16).toUpperCase()}`,
        dataJson: rawJson,
        status: 'COMPLETED',
        trigger: 'MANUAL',
        sizeBytes: rawJson.length,
        integrityVerified: true,
      };

      return await this.restoreBackup(syntheticRecord, currentChurch, user);
    } catch (e: any) {
      return { success: false, error: `Não foi possível ler o arquivo de backup JSON: ${e.message}` };
    }
  },

  // Standalone recovery helper for restoring a church + its users & records from an exported JSON backup on the login screen
  async importStandaloneBackupFile(rawJson: string): Promise<{
    church: Church;
    primaryUser: User;
    users: User[];
    members: Member[];
    departments: Department[];
    events: ChurchEvent[];
  }> {
    const parsed = JSON.parse(rawJson) as Partial<FullBackupPayload>;
    const church = parsed?.data?.church;
    if (!church || !church.id || !church.name) {
      throw new Error('O arquivo JSON não contém um registro de igreja válido para recuperação.');
    }

    const importedUsers: User[] = Array.isArray(parsed.data?.users) && parsed.data!.users.length > 0
      ? parsed.data!.users
      : [
          {
            id: church.ownerUid || `user-${Date.now()}`,
            churchId: church.id,
            name: church.pastorName || church.name,
            email: church.email,
            role: 'GENERAL_SECRETARY',
            status: 'ACTIVE',
            lastLogin: 'Recuperado via Backup',
          },
        ];

    const primaryUser =
      importedUsers.find(u => u.role === 'GENERAL_SECRETARY') || importedUsers[0];

    const members = Array.isArray(parsed.data?.members) ? parsed.data!.members : [];
    const departments = Array.isArray(parsed.data?.departments) ? parsed.data!.departments : [];
    const events = Array.isArray(parsed.data?.events) ? parsed.data!.events : [];
    const auditLogs = Array.isArray(parsed.data?.auditLogs) ? parsed.data!.auditLogs : [];

    // Persist into StorageService
    const existingChurches = StorageService.getChurches().filter(c => c.id !== church.id);
    StorageService.saveChurches([...existingChurches, church]);

    const existingUsers = StorageService.getUsers().filter(
      u => u.churchId !== church.id && !importedUsers.some(iu => iu.id === u.id)
    );
    StorageService.saveUsers([...existingUsers, ...importedUsers]);

    StorageService.markCleanSlate(church.id);
    if (members.length > 0) StorageService.saveMembersBatch(members);
    departments.forEach(d => StorageService.saveDepartment(d));
    events.forEach(e => StorageService.saveEvent(e));

    // Persist into IndexedDB
    await IndexedDBService.putMany('users', importedUsers);
    if (members.length > 0) await IndexedDBService.putMany('members', members);
    if (departments.length > 0) await IndexedDBService.putMany('departments', departments);
    if (events.length > 0) await IndexedDBService.putMany('events', events);
    if (auditLogs.length > 0) await IndexedDBService.putMany('auditLogs', auditLogs);

    // Enqueue / push to Firestore so recovered church data syncs to Cloud Firestore upon auth
    await this.pushChurchLocalDataToCloud(church, importedUsers, members, departments, events, false);

    return {
      church,
      primaryUser,
      users: importedUsers,
      members,
      departments,
      events,
    };
  },

  async pushChurchLocalDataToCloud(
    church: Church,
    churchUsers: User[],
    members: Member[],
    departments: Department[],
    events: ChurchEvent[],
    skipChurchSettings = false
  ): Promise<{ pushed: number; queued: number }> {
    const canPushNow = Boolean(auth.currentUser) && (typeof navigator === 'undefined' || navigator.onLine);
    let pushed = 0;
    let queued = 0;

    const pushOrQueue = async (
      entity: 'SETTINGS' | 'USER' | 'DEPARTMENT' | 'EVENT' | 'MEMBER',
      entityId: string,
      payload: any,
      directFn: () => Promise<void>
    ) => {
      if (canPushNow) {
        try {
          await directFn();
          pushed++;
          return;
        } catch {
          // Fallback to sync queue if Firestore rejects or goes offline mid-batch
        }
      }
      await syncEngine.enqueue({
        churchId: church.id,
        operation: 'UPDATE',
        entity,
        entityId,
        payload,
      });
      queued++;
    };

    if (!skipChurchSettings) {
      const normalizedChurch: Church =
        auth.currentUser && !church.ownerUid ? { ...church, ownerUid: auth.currentUser.uid } : church;
      await pushOrQueue('SETTINGS', church.id, normalizedChurch, () =>
        FirebaseService.saveChurch(normalizedChurch)
      );
    }

    for (const u of churchUsers) {
      await pushOrQueue('USER', u.id, u, () => FirebaseService.saveUser(u));
    }

    for (const dept of departments) {
      await pushOrQueue('DEPARTMENT', dept.id, dept, () => FirebaseService.saveDepartment(dept));
    }

    for (const ev of events) {
      await pushOrQueue('EVENT', ev.id, ev, () => FirebaseService.saveEvent(ev));
    }

    for (const mem of members) {
      await pushOrQueue('MEMBER', mem.id, mem, () => FirebaseService.saveMember(mem));
    }

    return { pushed, queued };
  },

  async exportFullPlatformSnapshot(): Promise<PlatformNetlifySnapshot> {
    const churches = StorageService.getChurches();
    const users = StorageService.getUsers();
    const paymentProofs = StorageService.getPaymentProofs();
    const tickets = StorageService.getSupportTickets();
    const paymentSettings = StorageService.getPaymentSettings();

    const idbMembers = (await IndexedDBService.getAll('members', '').catch(() => [])) as Member[];
    const lsMembers = (() => {
      try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('sec_igreja_members') : null;
        return raw ? (JSON.parse(raw) as Member[]) : [];
      } catch {
        return [];
      }
    })();
    const memberMap = new Map<string, Member>();
    lsMembers.forEach(m => memberMap.set(m.id, m));
    idbMembers.forEach(m => memberMap.set(m.id, m));

    const idbDepts = (await IndexedDBService.getAll('departments', '').catch(() => [])) as Department[];
    const lsDepts = (() => {
      try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('sec_igreja_departments') : null;
        return raw ? (JSON.parse(raw) as Department[]) : [];
      } catch {
        return [];
      }
    })();
    const deptMap = new Map<string, Department>();
    lsDepts.forEach(d => deptMap.set(d.id, d));
    idbDepts.forEach(d => deptMap.set(d.id, d));

    const idbEvents = (await IndexedDBService.getAll('events', '').catch(() => [])) as ChurchEvent[];
    const lsEvents = (() => {
      try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('sec_igreja_events') : null;
        return raw ? (JSON.parse(raw) as ChurchEvent[]) : [];
      } catch {
        return [];
      }
    })();
    const eventMap = new Map<string, ChurchEvent>();
    lsEvents.forEach(ev => eventMap.set(ev.id, ev));
    idbEvents.forEach(ev => eventMap.set(ev.id, ev));

    return {
      format: 'SECRETARIA_NETLIFY_SYNC_V1',
      exportedAt: new Date().toISOString(),
      sourceOrigin: typeof window !== 'undefined' ? window.location.origin : 'local',
      churches,
      users,
      members: Array.from(memberMap.values()),
      departments: Array.from(deptMap.values()),
      events: Array.from(eventMap.values()),
      paymentProofs,
      tickets,
      paymentSettings,
    };
  },

  downloadPlatformSnapshotToDevice(snapshot: PlatformNetlifySnapshot): void {
    if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return;
    }
    const stamp = formatBackupTimestampForFilename(snapshot.exportedAt);
    const json = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sincronizacao_netlify_secretaria_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  async importFullPlatformSnapshot(
    rawJson: string,
    options?: { isPlatformAdmin?: boolean }
  ): Promise<{
    churches: number;
    users: number;
    members: number;
    departments: number;
    events: number;
    paymentProofs: number;
    tickets: number;
    syncedToCloud: number;
  }> {
    const parsed = JSON.parse(rawJson) as any;

    let incomingChurches: Church[] = [];
    let incomingUsers: User[] = [];
    let incomingMembers: Member[] = [];
    let incomingDepartments: Department[] = [];
    let incomingEvents: ChurchEvent[] = [];
    let incomingProofs: PaymentProof[] = [];
    let incomingTickets: SupportTicket[] = [];
    let incomingPaymentSettings: PlatformPaymentSettings | undefined;

    if (parsed?.format === 'SECRETARIA_NETLIFY_SYNC_V1') {
      incomingChurches = Array.isArray(parsed.churches) ? parsed.churches : [];
      incomingUsers = Array.isArray(parsed.users) ? parsed.users : [];
      incomingMembers = Array.isArray(parsed.members) ? parsed.members : [];
      incomingDepartments = Array.isArray(parsed.departments) ? parsed.departments : [];
      incomingEvents = Array.isArray(parsed.events) ? parsed.events : [];
      incomingProofs = Array.isArray(parsed.paymentProofs) ? parsed.paymentProofs : [];
      incomingTickets = Array.isArray(parsed.tickets) ? parsed.tickets : [];
      incomingPaymentSettings = parsed.paymentSettings;
    } else if (parsed?.data?.church) {
      incomingChurches = [parsed.data.church];
      incomingUsers = Array.isArray(parsed.data.users) ? parsed.data.users : [];
      incomingMembers = Array.isArray(parsed.data.members) ? parsed.data.members : [];
      incomingDepartments = Array.isArray(parsed.data.departments) ? parsed.data.departments : [];
      incomingEvents = Array.isArray(parsed.data.events) ? parsed.data.events : [];
    } else {
      throw new Error('Arquivo JSON não reconhecido como backup da igreja ou pacote de sincronização do Netlify.');
    }

    // Merge into StorageService cleanly without discarding existing local tenants
    const churchMap = new Map<string, Church>();
    StorageService.getChurches().forEach(c => churchMap.set(c.id, c));
    incomingChurches.forEach(c => {
      if (c && c.id) {
        StorageService.markCleanSlate(c.id);
        churchMap.set(c.id, c);
      }
    });
    StorageService.saveChurches(Array.from(churchMap.values()));

    const userMap = new Map<string, User>();
    StorageService.getUsers().forEach(u => userMap.set(u.id, u));
    incomingUsers.forEach(u => {
      if (u && u.id) userMap.set(u.id, u);
    });
    StorageService.saveUsers(Array.from(userMap.values()));

    if (incomingMembers.length > 0) {
      StorageService.saveMembersBatch(incomingMembers);
      await IndexedDBService.putMany('members', incomingMembers);
    }
    if (incomingDepartments.length > 0) {
      incomingDepartments.forEach(d => StorageService.saveDepartment(d));
      await IndexedDBService.putMany('departments', incomingDepartments);
    }
    if (incomingEvents.length > 0) {
      incomingEvents.forEach(ev => StorageService.saveEvent(ev));
      await IndexedDBService.putMany('events', incomingEvents);
    }
    if (incomingUsers.length > 0) {
      await IndexedDBService.putMany('users', incomingUsers);
    }
    incomingProofs.forEach(p => StorageService.savePaymentProof(p));
    incomingTickets.forEach(t => StorageService.saveSupportTicket(t));
    if (incomingPaymentSettings) {
      StorageService.savePaymentSettings(incomingPaymentSettings);
    }

    // Push to Cloud Firestore when authenticated & online (respecting Platform vs Church permissions)
    let syncedToCloud = 0;
    const onlineAuthed = Boolean(auth.currentUser) && (typeof navigator === 'undefined' || navigator.onLine);
    if (onlineAuthed) {
      for (const c of incomingChurches) {
        try {
          await FirebaseService.saveChurch(
            !options?.isPlatformAdmin && auth.currentUser && !c.ownerUid
              ? { ...c, ownerUid: auth.currentUser.uid }
              : c
          );
          syncedToCloud++;
        } catch {
          // Enqueue fallback handled below for non-platform church users
        }
      }

      if (options?.isPlatformAdmin) {
        for (const p of incomingProofs) {
          try {
            await FirebaseService.savePaymentProof(p);
            syncedToCloud++;
          } catch {
            // Skip if permission denied
          }
        }
        for (const t of incomingTickets) {
          try {
            await FirebaseService.saveSupportTicket(t);
            syncedToCloud++;
          } catch {
            // Skip if permission denied
          }
        }
        if (incomingPaymentSettings) {
          try {
            await FirebaseService.savePlatformPaymentSettings(incomingPaymentSettings);
            syncedToCloud++;
          } catch {
            // Skip
          }
        }
      } else {
        for (const c of incomingChurches) {
          const churchUsers = incomingUsers.filter(u => u.churchId === c.id);
          const churchMembers = incomingMembers.filter(m => m.churchId === c.id);
          const churchDepts = incomingDepartments.filter(d => d.churchId === c.id);
          const churchEvents = incomingEvents.filter(ev => ev.churchId === c.id);
          const res = await this.pushChurchLocalDataToCloud(
            c,
            churchUsers,
            churchMembers,
            churchDepts,
            churchEvents,
            true
          );
          syncedToCloud += res.pushed;
        }
      }
    }

    return {
      churches: incomingChurches.length,
      users: incomingUsers.length,
      members: incomingMembers.length,
      departments: incomingDepartments.length,
      events: incomingEvents.length,
      paymentProofs: incomingProofs.length,
      tickets: incomingTickets.length,
      syncedToCloud,
    };
  },

  async getBackups(churchId: string): Promise<BackupRecord[]> {
    const localList = await IndexedDBService.getAll<BackupRecord>('backups', churchId);
    const mergedMap = new Map<string, BackupRecord>();
    localList.forEach(b => mergedMap.set(b.id, b));

    const isOnline = typeof navigator === 'undefined' || navigator.onLine;
    if (auth.currentUser && isOnline) {
      try {
        const remoteList = await FirebaseService.getBackups(churchId);
        if (remoteList.length > 0) {
          remoteList.forEach(rb => {
            if (rb.churchId === churchId) {
              mergedMap.set(rb.id, rb);
            }
          });
          await IndexedDBService.putMany('backups', remoteList.filter(rb => rb.churchId === churchId));
        }
      } catch (e) {
        console.warn('Could not fetch backups from Firestore:', e);
      }
    }

    return Array.from(mergedMap.values()).sort((a, b) => {
      const aTime = new Date(a.createdAtIso || a.createdAt).getTime() || 0;
      const bTime = new Date(b.createdAtIso || b.createdAt).getTime() || 0;
      return bTime - aTime;
    });
  },
};
