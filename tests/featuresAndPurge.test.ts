import { describe, it, expect, beforeEach } from 'vitest';
import { computeDepartmentDistribution } from '../src/utils/dashboardCharts';
import { formatDatePtBr, translateGender, translateMaritalStatus } from '../src/utils/pdfExportUtils';
import { StorageService } from '../src/services/storage';
import {
  buildChurchThemeVars,
  ensureAccessiblePrimary,
  extractBrandColorsFromImageData,
} from '../src/utils/themeColorUtils';
import {
  buildMonthCalendarGrid,
  extractEventDateKey,
  formatEventTime,
  getEventsForMonth,
  groupActiveEventsByDate,
} from '../src/utils/calendarUtils';
import {
  DEFAULT_DASHBOARD_PREFS,
  loadDashboardPrefs,
  saveDashboardPrefs,
} from '../src/utils/dashboardPrefs';
import { BackupService } from '../src/services/backupService';
import { IndexedDBService } from '../src/services/indexedDB';
import { PlatformAdminAuthService, ROOT_PLATFORM_ADMIN_EMAIL } from '../src/utils/platformAdminAuth';
import type { AuditLog, Church, ChurchEvent, Department, Member, User } from '../src/types';

const memoryStorage = new Map<string, string>();
if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as any).localStorage = {
    getItem: (k: string) => memoryStorage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memoryStorage.set(k, String(v));
    },
    removeItem: (k: string) => {
      memoryStorage.delete(k);
    },
    clear: () => {
      memoryStorage.clear();
    },
    get length() {
      return memoryStorage.size;
    },
    key: (i: number) => Array.from(memoryStorage.keys())[i] ?? null,
  };
}

describe('Dashboard Donut Chart Distribution', () => {
  const departments: Department[] = [
    {
      id: 'd1',
      churchId: 'real-1',
      name: 'Louvor',
      description: '',
      leaderId: 'm1',
      leaderName: 'João',
      memberCount: 2,
      status: 'ACTIVE',
      createdAt: '2026-01-01',
    },
    {
      id: 'd2',
      churchId: 'real-1',
      name: 'Diaconia',
      description: '',
      leaderId: 'm2',
      leaderName: 'Maria',
      memberCount: 1,
      status: 'ACTIVE',
      createdAt: '2026-01-01',
    },
  ];

  const members: Member[] = [
    {
      id: 'm1',
      churchId: 'real-1',
      fullName: 'João Pedro',
      memberCode: 'M-1',
      phone: '',
      email: '',
      membershipDate: '2025-01-01',
      status: 'ACTIVE',
      departmentIds: ['d1'],
      address: { street: '', number: '', neighborhood: '', city: 'SP', state: 'SP', zipCode: '' },
    },
    {
      id: 'm2',
      churchId: 'real-1',
      fullName: 'Maria Clara',
      memberCode: 'M-2',
      phone: '',
      email: '',
      membershipDate: '2025-01-01',
      status: 'ACTIVE',
      departmentIds: ['d1', 'd2'],
      address: { street: '', number: '', neighborhood: '', city: 'SP', state: 'SP', zipCode: '' },
    },
    {
      id: 'm3',
      churchId: 'real-1',
      fullName: 'Carlos Sem Depto',
      memberCode: 'M-3',
      phone: '',
      email: '',
      membershipDate: '2025-01-01',
      status: 'ACTIVE',
      departmentIds: [],
      address: { street: '', number: '', neighborhood: '', city: 'SP', state: 'SP', zipCode: '' },
    },
    {
      id: 'm4',
      churchId: 'real-1',
      fullName: 'Inativo Ignorado',
      memberCode: 'M-4',
      phone: '',
      email: '',
      membershipDate: '2025-01-01',
      status: 'INACTIVE',
      departmentIds: ['d2'],
      address: { street: '', number: '', neighborhood: '', city: 'SP', state: 'SP', zipCode: '' },
    },
  ];

  it('computes active member distribution by department plus unassigned slice', () => {
    const result = computeDepartmentDistribution(departments, members);
    expect(result.totalActiveMembers).toBe(3);
    expect(result.totalLinks).toBe(4);
    expect(result.slices.map(s => [s.name, s.value])).toEqual([
      ['Louvor', 2],
      ['Diaconia', 1],
      ['Sem Departamento', 1],
    ]);
  });

  it('returns empty slices when there are no active members', () => {
    const result = computeDepartmentDistribution(departments, [members[3]]);
    expect(result.slices).toEqual([]);
    expect(result.totalActiveMembers).toBe(0);
  });
});

describe('Zero Demo Seed Data & Legacy Purge', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it('starts with empty churches, members, departments, and events, keeping only Platform Admin Flávia', () => {
    expect(StorageService.getChurches()).toEqual([]);
    const users = StorageService.getUsers();
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe('aplicativosflavia27@gmail.com');
    expect(StorageService.getMembers('real-church')).toEqual([]);
    expect(StorageService.getDepartments('real-church')).toEqual([]);
    expect(StorageService.getEvents('real-church')).toEqual([]);
    expect(StorageService.getPaymentProofs()).toEqual([]);
    expect(StorageService.getSupportTickets()).toEqual([]);
  });

  it('purges legacy demo records while preserving real user-created church and member records', () => {
    globalThis.localStorage.setItem(
      'sec_igreja_churches',
      JSON.stringify([
        { id: 'church-1', name: 'Igreja Demo' },
        { id: 'real-church-99', name: 'Igreja Real Esperança' },
      ])
    );
    globalThis.localStorage.setItem(
      'sec_igreja_members',
      JSON.stringify([
        { id: 'mem-1', churchId: 'church-1', fullName: 'Demo Member' },
        { id: 'mem-real-1', churchId: 'real-church-99', fullName: 'Membro Real' },
      ])
    );

    const churches = StorageService.getChurches();
    expect(churches).toHaveLength(1);
    expect(churches[0].id).toBe('real-church-99');

    const members = StorageService.getMembers('real-church-99');
    expect(members).toHaveLength(1);
    expect(members[0].fullName).toBe('Membro Real');
  });
});

describe('PDF Formatting Helpers', () => {
  it('formats ISO dates and translates civil status and gender in pt-BR', () => {
    expect(formatDatePtBr('1992-07-19')).toBe('19/07/1992');
    expect(formatDatePtBr('')).toBe('Não informada');
    expect(translateMaritalStatus('MARRIED')).toBe('Casado(a)');
    expect(translateGender('FEMALE')).toBe('Feminino');
  });
});

describe('Department & Church Deletion + Brand Color Theme Extraction', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it('deletes a department and cleanly unlinks it from members in that church only', () => {
    const dept1: Department = {
      id: 'd-real-1',
      churchId: 'real-c1',
      name: 'Louvor',
      description: '',
      leaderId: 'm1',
      leaderName: 'João',
      memberCount: 1,
      status: 'ACTIVE',
      createdAt: '2026-01-01',
    };
    const dept2: Department = {
      ...dept1,
      id: 'd-real-2',
      name: 'Diaconia',
    };
    StorageService.saveDepartment(dept1);
    StorageService.saveDepartment(dept2);

    const member: Member = {
      id: 'm-real-1',
      churchId: 'real-c1',
      fullName: 'Maria Real',
      memberCode: 'M-10',
      phone: '',
      email: '',
      membershipDate: '2026-01-01',
      status: 'ACTIVE',
      departmentIds: ['d-real-1', 'd-real-2'],
      address: { street: '', number: '', neighborhood: '', city: 'SP', state: 'SP', zipCode: '' },
    };
    StorageService.saveMember(member);

    StorageService.deleteDepartment('real-c1', 'd-real-1');

    const remainingDepts = StorageService.getDepartments('real-c1');
    expect(remainingDepts.map(d => d.id)).toEqual(['d-real-2']);

    const updatedMembers = StorageService.getMembers('real-c1');
    expect(updatedMembers[0].departmentIds).toEqual(['d-real-2']);
  });

  it('deletes a registered church and purges all its tenant records while preserving other churches', () => {
    const churchOne: Church = {
      id: 'real-c1',
      name: 'Igreja Real Um',
      denomination: 'Batista',
      pastorName: 'Pr. Pedro',
      email: 'um@igreja.org',
      phone: '11999999999',
      address: 'Rua A, 1',
      exclusiveCode: 'UM001',
      city: 'SP',
      state: 'SP',
      zipCode: '01000-000',
      logoUrl: '',
      primaryColor: '#1e3a8a',
      secondaryColor: '#3b82f6',
      plan: 'MONTHLY_50',
      planStatus: 'ACTIVE',
      status: 'ACTIVE',
      createdAt: '2026-01-01',
    };
    const churchTwo: Church = { ...churchOne, id: 'real-c2', name: 'Igreja Real Dois', exclusiveCode: 'DOIS02' };
    StorageService.saveChurches([churchOne, churchTwo]);

    StorageService.saveMember({
      id: 'm-c1',
      churchId: 'real-c1',
      fullName: 'Membro Um',
      memberCode: 'U-1',
      phone: '',
      email: '',
      membershipDate: '2026-01-01',
      status: 'ACTIVE',
      departmentIds: [],
      address: { street: '', number: '', neighborhood: '', city: 'SP', state: 'SP', zipCode: '' },
    });
    StorageService.saveMember({
      id: 'm-c2',
      churchId: 'real-c2',
      fullName: 'Membro Dois',
      memberCode: 'D-1',
      phone: '',
      email: '',
      membershipDate: '2026-01-01',
      status: 'ACTIVE',
      departmentIds: [],
      address: { street: '', number: '', neighborhood: '', city: 'SP', state: 'SP', zipCode: '' },
    });

    StorageService.deleteChurch('real-c1');

    expect(StorageService.getChurches().map(c => c.id)).toEqual(['real-c2']);
    expect(StorageService.getMembers('real-c1')).toEqual([]);
    expect(StorageService.getMembers('real-c2')).toHaveLength(1);
    expect(StorageService.getUsers().some(u => u.email === 'aplicativosflavia27@gmail.com')).toBe(true);
  });

  it('extracts dominant brand colors from logo pixel buffer and builds accessible CSS theme variables', () => {
    // 6 emerald pixels (#107c41) + 2 gold accent pixels (#d97706) + 4 white background pixels
    const pixels = [
      16, 124, 65, 255,
      16, 124, 65, 255,
      16, 124, 65, 255,
      16, 124, 65, 255,
      16, 124, 65, 255,
      16, 124, 65, 255,
      217, 119, 6, 255,
      217, 119, 6, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ];

    const extracted = extractBrandColorsFromImageData(pixels);
    expect(extracted).not.toBeNull();
    expect(extracted!.primaryColor).toBe('#107c41');
    expect(extracted!.secondaryColor).toBe('#d97706');

    // Very bright yellow gets darkened so white button text stays legible
    const accessibleYellow = ensureAccessiblePrimary('#fef08a');
    expect(accessibleYellow).not.toBe('#fef08a');

    const vars = buildChurchThemeVars({ primaryColor: '#7c2d12', secondaryColor: '#f59e0b' } as Church, false) as Record<string, string>;
    expect(vars['--church-primary']).toBe('#7c2d12');
    expect(vars['--church-secondary']).toBe('#f59e0b');
    expect(vars['--church-primary-rgb']).toBe('124, 45, 18');
  });
});

describe('Dashboard Church Calendar & Settings Panel Preferences', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it('builds a complete month calendar grid and groups active church events without cancelled ones', () => {
    const grid = buildMonthCalendarGrid(2026, 10, new Date(2026, 10, 16)); // Nov 2026
    expect(grid.length % 7).toBe(0);
    const todayCell = grid.find(c => c.dateKey === '2026-11-16');
    expect(todayCell?.isToday).toBe(true);
    expect(todayCell?.inCurrentMonth).toBe(true);

    const events: ChurchEvent[] = [
      {
        id: 'ev-1',
        churchId: 'c1',
        title: 'Culto da Família',
        description: '',
        startDate: '2026-11-22T18:30',
        endDate: '2026-11-22T20:30',
        location: 'Templo Principal',
        category: 'CULT',
        organizer: 'Secretaria',
        status: 'SCHEDULED',
      },
      {
        id: 'ev-2',
        churchId: 'c1',
        title: 'Reunião Cancelada',
        description: '',
        startDate: '2026-11-22T15:00',
        endDate: '2026-11-22T16:00',
        location: 'Sala 2',
        category: 'REUNION',
        organizer: 'Secretaria',
        status: 'CANCELLED',
      },
    ];

    expect(extractEventDateKey('2026-11-22T18:30')).toBe('2026-11-22');
    expect(formatEventTime('2026-11-22T18:30')).toBe('18:30');

    const grouped = groupActiveEventsByDate(events);
    expect(grouped['2026-11-22']).toHaveLength(1);
    expect(grouped['2026-11-22'][0].title).toBe('Culto da Família');

    const monthEvents = getEventsForMonth(events, 2026, 10);
    expect(monthEvents).toHaveLength(1);
  });

  it('persists and loads dashboard visibility preferences per church from Settings', () => {
    expect(loadDashboardPrefs('c-real-1')).toEqual(DEFAULT_DASHBOARD_PREFS);

    saveDashboardPrefs('c-real-1', {
      showQuickActions: false,
      showStats: true,
      showCalendar: true,
      showBirthdays: false,
    });

    expect(loadDashboardPrefs('c-real-1')).toEqual({
      showQuickActions: false,
      showStats: true,
      showCalendar: true,
      showBirthdays: false,
    });
    expect(loadDashboardPrefs('c-real-2')).toEqual(DEFAULT_DASHBOARD_PREFS);
  });

  it('wipes all previously registered churches and tenant data for official launch while preserving Platform Admin and subsequent registrations', () => {
    const preLaunchChurch: Church = {
      id: 'church-1763200000',
      name: 'Igreja Teste Pré-Lançamento',
      denomination: 'Batista',
      pastorName: 'Pr. Teste',
      email: 'teste@igreja.org',
      phone: '11999990000',
      address: 'Rua Teste, 10',
      exclusiveCode: 'IG-9001',
      city: 'SP',
      state: 'SP',
      zipCode: '01000-000',
      primaryColor: '#1e3a8a',
      secondaryColor: '#3b82f6',
      plan: 'FREE',
      planStatus: 'ACTIVE',
      status: 'ACTIVE',
      createdAt: '2026-01-01',
    };
    StorageService.saveChurches([preLaunchChurch]);
    StorageService.saveUsers([
      ...StorageService.getUsers(),
      {
        id: 'user-prelaunch',
        churchId: preLaunchChurch.id,
        name: 'Usuário Teste',
        email: 'usuario@igreja.org',
        role: 'GENERAL_SECRETARY',
        status: 'ACTIVE',
      },
    ]);
    StorageService.saveMember({
      id: 'mem-prelaunch',
      churchId: preLaunchChurch.id,
      fullName: 'Membro Teste',
      memberCode: 'M-99',
      phone: '',
      email: '',
      membershipDate: '2026-01-01',
      status: 'ACTIVE',
      departmentIds: [],
      address: { street: '', number: '', neighborhood: '', city: 'SP', state: 'SP', zipCode: '' },
    });
    StorageService.saveEvent({
      id: 'ev-prelaunch',
      churchId: preLaunchChurch.id,
      title: 'Evento Teste',
      description: '',
      startDate: '2026-11-20T19:00',
      endDate: '2026-11-20T21:00',
      location: 'Templo',
      category: 'CULT',
      organizer: 'Secretaria',
      status: 'SCHEDULED',
    });
    saveDashboardPrefs(preLaunchChurch.id, {
      showQuickActions: false,
      showStats: false,
      showCalendar: true,
      showBirthdays: false,
    });
    StorageService.markCleanSlate(preLaunchChurch.id);

    // First run executes full official launch wipe
    expect(StorageService.runOfficialLaunchResetOnce()).toBe(true);
    expect(StorageService.getChurches()).toEqual([]);
    expect(StorageService.getMembers(preLaunchChurch.id)).toEqual([]);
    expect(StorageService.getEvents(preLaunchChurch.id)).toEqual([]);
    expect(StorageService.getUsers().map(u => u.email)).toEqual(['aplicativosflavia27@gmail.com']);
    expect(loadDashboardPrefs(preLaunchChurch.id)).toEqual(DEFAULT_DASHBOARD_PREFS);

    // Register first official church after reset
    const firstOfficialChurch: Church = {
      ...preLaunchChurch,
      id: 'church-official-1',
      name: 'Igreja Oficial 1',
      exclusiveCode: 'IG-1001',
    };
    StorageService.saveChurches([firstOfficialChurch]);

    // Subsequent boots do NOT re-wipe official registrations
    expect(StorageService.runOfficialLaunchResetOnce()).toBe(false);
    expect(StorageService.getChurches().map(c => c.id)).toEqual(['church-official-1']);
  });
});

describe('Automatic & Manual Full Backup System (JSON & CSV + Audit Logs)', () => {
  const realChurch: Church = {
    id: 'church-bkp-1',
    name: 'Igreja Teste Backup',
    denomination: 'Batista',
    pastorName: 'Pr. Daniel',
    email: 'bkp@igreja.org',
    phone: '11999990001',
    address: 'Rua Central, 50',
    exclusiveCode: 'IG-7777',
    city: 'São Paulo',
    state: 'SP',
    zipCode: '01000-000',
    primaryColor: '#1e3a8a',
    secondaryColor: '#3b82f6',
    plan: 'FREE',
    planStatus: 'ACTIVE',
    status: 'ACTIVE',
    createdAt: '2026-01-10',
    offlineConfig: {
      maxOfflineDays: 7,
      autoBackupDaily: true,
      autoBackupFrequency: 'WEEKLY',
      autoBackupFormat: 'BOTH',
      autoDownloadLocalBackup: true,
    },
  };

  const adminUser: User = {
    id: 'user-sec-1',
    churchId: 'church-bkp-1',
    name: 'Silvia',
    email: 'silvia@igreja.org',
    role: 'GENERAL_SECRETARY',
    status: 'ACTIVE',
  };

  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it('exports complete church data (members, departments, events, auditLogs) to JSON and CSV and supports standalone recovery', async () => {
    StorageService.saveChurches([realChurch]);
    StorageService.saveUsers([...StorageService.getUsers(), adminUser]);
    StorageService.saveDepartment({
      id: 'dept-bkp-1',
      churchId: realChurch.id,
      name: 'Louvor',
      description: 'Ministério de Louvor',
      leaderId: 'mem-bkp-1',
      leaderName: 'João Lucas',
      memberCount: 1,
      status: 'ACTIVE',
      createdAt: '2026-01-11',
    });
    StorageService.saveMember({
      id: 'mem-bkp-1',
      churchId: realChurch.id,
      fullName: 'João Lucas',
      memberCode: 'M-100',
      phone: '11988887777',
      email: 'joao@igreja.org',
      membershipDate: '2025-05-01',
      status: 'ACTIVE',
      departmentIds: ['dept-bkp-1'],
      address: { street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'SP', state: 'SP', zipCode: '' },
    });
    StorageService.saveEvent({
      id: 'ev-bkp-1',
      churchId: realChurch.id,
      title: 'Culto de Oração',
      description: 'Culto semanal',
      startDate: '2026-11-20T19:30',
      endDate: '2026-11-20T21:00',
      location: 'Templo Principal',
      category: 'CULT',
      organizer: 'Silvia',
      status: 'SCHEDULED',
    });

    const sampleAudit: AuditLog = {
      id: 'log-bkp-1',
      churchId: realChurch.id,
      userId: adminUser.id,
      userName: adminUser.name,
      action: 'Alteração de Cadastro',
      entityType: 'MEMBER',
      entityId: 'mem-bkp-1',
      details: 'Atualização de telefone do membro João Lucas',
      date: '16/11/2026 10:00:00',
      timestamp: 1794823200000,
    };

    const origGetAll = IndexedDBService.getAll.bind(IndexedDBService);
    IndexedDBService.getAll = (async (storeName: string) => {
      if (storeName === 'auditLogs') return [sampleAudit] as any;
      return [];
    }) as any;

    try {
      const record = await BackupService.createBackup(realChurch, adminUser, { trigger: 'MANUAL' });
      expect(record.recordCounts.members).toBe(1);
      expect(record.recordCounts.departments).toBe(1);
      expect(record.recordCounts.events).toBe(1);
      expect(record.recordCounts.auditLogs).toBe(1);
      expect(record.trigger).toBe('MANUAL');

      const csv = BackupService.buildBackupCsvFromDataJson(record.dataJson);
      expect(csv).toContain('MEMBRO');
      expect(csv).toContain('João Lucas');
      expect(csv).toContain('DEPARTAMENTO');
      expect(csv).toContain('Louvor');
      expect(csv).toContain('EVENTO');
      expect(csv).toContain('Culto de Oração');
      expect(csv).toContain('LOG_AUDITORIA');
      expect(csv).toContain('Alteração de Cadastro');

      // Simulate wipe and recover from exported JSON
      StorageService.resetAllDataForOfficialLaunch();
      expect(StorageService.getChurches()).toEqual([]);

      const recovered = await BackupService.importStandaloneBackupFile(record.dataJson);
      expect(recovered.church.id).toBe(realChurch.id);
      expect(recovered.primaryUser.email).toBe('silvia@igreja.org');
      expect(StorageService.getChurches().map(c => c.id)).toEqual([realChurch.id]);
      expect(StorageService.getMembers(realChurch.id)).toHaveLength(1);
    } finally {
      IndexedDBService.getAll = origGetAll;
    }
  });

  it('evaluates periodic schedule due state and executes scheduled automatic backup', async () => {
    const now = Date.now();
    const recentChurch: Church = {
      ...realChurch,
      offlineConfig: {
        maxOfflineDays: 7,
        autoBackupDaily: true,
        autoBackupFrequency: 'WEEKLY',
        lastAutoBackupAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
      },
    };
    expect(BackupService.isAutoBackupDue(recentChurch, now)).toBe(false);

    const overdueChurch: Church = {
      ...realChurch,
      offlineConfig: {
        maxOfflineDays: 7,
        autoBackupDaily: true,
        autoBackupFrequency: 'WEEKLY',
        lastAutoBackupAt: new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(), // 8 days ago
      },
    };
    expect(BackupService.isAutoBackupDue(overdueChurch, now)).toBe(true);

    const disabledChurch: Church = {
      ...realChurch,
      offlineConfig: {
        maxOfflineDays: 7,
        autoBackupDaily: false,
        autoBackupFrequency: 'DISABLED',
      },
    };
    expect(BackupService.isAutoBackupDue(disabledChurch, now)).toBe(false);
    expect(BackupService.getNextAutoBackupDate(disabledChurch)).toBeNull();

    const runResult = await BackupService.runScheduledBackupIfDue(overdueChurch, adminUser);
    expect(runResult.executed).toBe(true);
    expect(runResult.backup?.trigger).toBe('AUTOMATIC');
    expect(runResult.updatedChurch?.offlineConfig?.lastAutoBackupAt).toBeDefined();
    expect(runResult.updatedChurch?.offlineConfig?.autoDownloadLocalBackup).toBe(false);
  });

  it('saves scheduled automatic backups strictly inside database without triggering device file download', async () => {
    StorageService.saveChurches([realChurch]);
    StorageService.saveUsers([...StorageService.getUsers(), adminUser]);

    const overdueChurch: Church = {
      ...realChurch,
      offlineConfig: {
        maxOfflineDays: 7,
        autoBackupDaily: true,
        autoBackupFrequency: 'DAILY',
        autoDownloadLocalBackup: true,
        lastAutoBackupAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
    };

    const storedBackups: Record<string, any> = {};
    const origPut = IndexedDBService.put.bind(IndexedDBService);
    const origGetAll = IndexedDBService.getAll.bind(IndexedDBService);
    const origCreateObjectUrl = globalThis.URL?.createObjectURL;
    let downloadTriggered = false;

    if (globalThis.URL) {
      globalThis.URL.createObjectURL = (() => {
        downloadTriggered = true;
        return 'blob:should-not-happen';
      }) as any;
    }

    IndexedDBService.put = (async (storeName: string, data: any) => {
      if (storeName === 'backups') {
        storedBackups[data.id] = data;
      }
    }) as any;

    IndexedDBService.getAll = (async (storeName: string) => {
      if (storeName === 'backups') return Object.values(storedBackups) as any;
      return [];
    }) as any;

    try {
      const result = await BackupService.runScheduledBackupIfDue(overdueChurch, adminUser);
      expect(result.executed).toBe(true);
      expect(downloadTriggered).toBe(false);
      expect(Object.keys(storedBackups)).toHaveLength(1);
      const savedList = await BackupService.getBackups(realChurch.id);
      expect(savedList).toHaveLength(1);
      expect(savedList[0].trigger).toBe('AUTOMATIC');
    } finally {
      IndexedDBService.put = origPut;
      IndexedDBService.getAll = origGetAll;
      if (globalThis.URL && origCreateObjectUrl) {
        globalThis.URL.createObjectURL = origCreateObjectUrl;
      }
    }
  });
});

describe('General Platform Admin Credential Setup & Password Change', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it('authenticates root platform owners including flaviamara0308@gmail.com and aplicativosflavia27@gmail.com and allows password update', () => {
    expect(PlatformAdminAuthService.isRootPlatformEmail(ROOT_PLATFORM_ADMIN_EMAIL)).toBe(true);
    expect(PlatformAdminAuthService.isRootPlatformEmail('flaviamara0308@gmail.com')).toBe(true);
    expect(PlatformAdminAuthService.verifyLocalAdminPassword(ROOT_PLATFORM_ADMIN_EMAIL, '123456')).toBe(true);
    expect(PlatformAdminAuthService.verifyLocalAdminPassword(ROOT_PLATFORM_ADMIN_EMAIL, 'wrong')).toBe(false);
    expect(PlatformAdminAuthService.isUsingInitialDefaultPassword()).toBe(true);

    const changed = PlatformAdminAuthService.changeLocalAdminPassword(ROOT_PLATFORM_ADMIN_EMAIL, '123456', 'NovaSenha@2026');
    expect(changed.ok).toBe(true);
    expect(PlatformAdminAuthService.isUsingInitialDefaultPassword()).toBe(false);
    expect(PlatformAdminAuthService.verifyLocalAdminPassword(ROOT_PLATFORM_ADMIN_EMAIL, '123456')).toBe(false);
    expect(PlatformAdminAuthService.verifyLocalAdminPassword(ROOT_PLATFORM_ADMIN_EMAIL, 'NovaSenha@2026')).toBe(true);

    // Changed password survives official launch reset
    StorageService.resetAllDataForOfficialLaunch();
    expect(PlatformAdminAuthService.verifyLocalAdminPassword(ROOT_PLATFORM_ADMIN_EMAIL, 'NovaSenha@2026')).toBe(true);
  });
});


