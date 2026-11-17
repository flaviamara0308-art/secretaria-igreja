import {
  Church,
  User,
  Member,
  Department,
  DepartmentTransferHistory,
  ChurchEvent,
  AppNotification,
  PaymentProof,
  PlatformPaymentSettings,
  SupportTicket,
} from '../types';
import { ChurchUserAuthService } from '../utils/churchUserAuth';

export const LEGACY_DEMO_IDS = {
  churches: new Set(['church-1', 'church-2', 'church-3']),
  users: new Set([
    'platform-admin-1',
    'platform-admin-2',
    'user-1',
    'user-2',
    'user-3',
    'user-4',
    'user-5',
    'user-6',
  ]),
  members: new Set(['mem-1', 'mem-2', 'mem-3']),
  departments: new Set(['dept-1', 'dept-2', 'dept-3', 'dept-4']),
  events: new Set(['ev-1', 'ev-2', 'ev-3']),
  proofs: new Set(['proof-1', 'proof-2']),
  tickets: new Set(['ticket-1', 'ticket-2', 'ticket-3']),
  notifications: new Set(['notif-1']),
};

const INITIAL_CHURCHES: Church[] = [];

const INITIAL_USERS: User[] = [
  // Único administrador inicial da plataforma (autenticado via Firebase Google)
  {
    id: 'platform-admin-flavia',
    churchId: 'PLATFORM',
    name: 'Flávia (Admin Plataforma)',
    email: 'aplicativosflavia27@gmail.com',
    role: 'PLATFORM_ADMIN',
    platformPermissions: [
      'MANAGE_CHURCHES',
      'MANAGE_FINANCES',
      'SUPPORT',
      'PLATFORM_SETTINGS',
      'TECHNICAL_MONITORING',
      'SUBSCRIPTIONS',
      'CLOSE_CHURCHES',
    ],
    status: 'ACTIVE',
    lastLogin: 'Ativo',
  },
];

const INITIAL_MEMBERS: Member[] = [];

const INITIAL_DEPARTMENTS: Department[] = [];

const INITIAL_EVENTS: ChurchEvent[] = [];

const INITIAL_PAYMENT_SETTINGS: PlatformPaymentSettings = {
  pixKey: '',
  pixKeyType: 'EMAIL',
  recipientName: 'Secretaria da Igreja',
  bankName: '',
  agency: '',
  accountNumber: '',
  instructions:
    'Configure os dados oficiais de recebimento da plataforma no painel Administrativo antes de liberar cobranças via Pix.',
};

const INITIAL_PAYMENT_PROOFS: PaymentProof[] = [];

const INITIAL_TICKETS: SupportTicket[] = [];

const DEMO_PURGE_FLAG_KEY = 'sec_igreja_demo_purged_v1';
const OFFICIAL_LAUNCH_RESET_FLAG_KEY = 'sec_igreja_official_launch_v1';

// Local Storage helpers with strict multi-church isolation and zero demo seed records
export const StorageService = {
  purgeLegacyDemoData(): boolean {
    if (typeof localStorage === 'undefined') return false;
    if (localStorage.getItem(DEMO_PURGE_FLAG_KEY) === '1') return false;

    const filterKey = <T extends { id?: string; churchId?: string }>(
      key: string,
      legacyIds: Set<string>,
      alsoCheckChurchId = false
    ) => {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      try {
        const parsed: T[] = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        const cleaned = parsed.filter(item => {
          if (item.id && legacyIds.has(item.id)) return false;
          if (alsoCheckChurchId && item.churchId && LEGACY_DEMO_IDS.churches.has(item.churchId)) {
            return false;
          }
          return true;
        });
        localStorage.setItem(key, JSON.stringify(cleaned));
      } catch {
        // Ignore malformed local cache
      }
    };

    filterKey<Church>('sec_igreja_churches', LEGACY_DEMO_IDS.churches, false);
    filterKey<User>('sec_igreja_users', LEGACY_DEMO_IDS.users, true);
    filterKey<Member>('sec_igreja_members', LEGACY_DEMO_IDS.members, true);
    filterKey<Department>('sec_igreja_departments', LEGACY_DEMO_IDS.departments, true);
    filterKey<ChurchEvent>('sec_igreja_events', LEGACY_DEMO_IDS.events, true);
    filterKey<PaymentProof>('sec_igreja_payment_proofs', LEGACY_DEMO_IDS.proofs, true);
    filterKey<SupportTicket>('sec_igreja_support_tickets', LEGACY_DEMO_IDS.tickets, true);
    filterKey<AppNotification>('sec_igreja_notifications', LEGACY_DEMO_IDS.notifications, true);

    localStorage.setItem(DEMO_PURGE_FLAG_KEY, '1');
    return true;
  },

  resetAllDataForOfficialLaunch() {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('sec_igreja_churches', JSON.stringify(INITIAL_CHURCHES));
    localStorage.setItem('sec_igreja_users', JSON.stringify(INITIAL_USERS));
    localStorage.setItem('sec_igreja_members', JSON.stringify(INITIAL_MEMBERS));
    localStorage.setItem('sec_igreja_departments', JSON.stringify(INITIAL_DEPARTMENTS));
    localStorage.setItem('sec_igreja_events', JSON.stringify(INITIAL_EVENTS));
    localStorage.setItem('sec_igreja_dept_transfers', JSON.stringify([]));
    localStorage.setItem('sec_igreja_notifications', JSON.stringify([]));
    localStorage.setItem('sec_igreja_payment_proofs', JSON.stringify(INITIAL_PAYMENT_PROOFS));
    localStorage.setItem('sec_igreja_support_tickets', JSON.stringify(INITIAL_TICKETS));

    const keysToRemove: string[] = [];
    if (typeof localStorage.length === 'number' && typeof localStorage.key === 'function') {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (
          k &&
          (k.startsWith('sec_igreja_clean_slate_') || k.startsWith('sec_igreja_dashboard_prefs_'))
        ) {
          keysToRemove.push(k);
        }
      }
    } else {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('sec_igreja_clean_slate_') || k.startsWith('sec_igreja_dashboard_prefs_')) {
          keysToRemove.push(k);
        }
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));

    localStorage.setItem(DEMO_PURGE_FLAG_KEY, '1');
    localStorage.setItem(OFFICIAL_LAUNCH_RESET_FLAG_KEY, '1');
    ChurchUserAuthService.clearAllCredentials();
  },

  runOfficialLaunchResetOnce(): boolean {
    if (typeof localStorage === 'undefined') return false;
    if (localStorage.getItem(OFFICIAL_LAUNCH_RESET_FLAG_KEY) === '1') return false;
    this.resetAllDataForOfficialLaunch();
    return true;
  },

  getChurches(): Church[] {
    this.purgeLegacyDemoData();
    const data = localStorage.getItem('sec_igreja_churches');
    if (!data) {
      localStorage.setItem('sec_igreja_churches', JSON.stringify(INITIAL_CHURCHES));
      return INITIAL_CHURCHES;
    }
    return JSON.parse(data);
  },

  saveChurches(churches: Church[]) {
    localStorage.setItem('sec_igreja_churches', JSON.stringify(churches));
  },

  deleteChurch(churchId: string) {
    const churches = this.getChurches().filter(c => c.id !== churchId);
    this.saveChurches(churches);

    const removeByChurch = <T extends { churchId?: string }>(key: string) => {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      try {
        const list: T[] = JSON.parse(raw);
        if (!Array.isArray(list)) return;
        localStorage.setItem(
          key,
          JSON.stringify(list.filter(item => item.churchId !== churchId))
        );
      } catch {
        // Ignore malformed local storage
      }
    };

    removeByChurch<User>('sec_igreja_users');
    removeByChurch<Member>('sec_igreja_members');
    removeByChurch<Department>('sec_igreja_departments');
    removeByChurch<ChurchEvent>('sec_igreja_events');
    removeByChurch<DepartmentTransferHistory>('sec_igreja_dept_transfers');
    removeByChurch<AppNotification>('sec_igreja_notifications');
    removeByChurch<PaymentProof>('sec_igreja_payment_proofs');
    removeByChurch<SupportTicket>('sec_igreja_support_tickets');
    localStorage.removeItem(`sec_igreja_clean_slate_${churchId}`);
    localStorage.removeItem(`sec_igreja_dashboard_prefs_church_${churchId}`);
    ChurchUserAuthService.removeChurchCredentials(churchId);
  },

  getUsers(): User[] {
    this.purgeLegacyDemoData();
    const data = localStorage.getItem('sec_igreja_users');
    if (!data) {
      localStorage.setItem('sec_igreja_users', JSON.stringify(INITIAL_USERS));
      return INITIAL_USERS;
    }
    let parsed: User[] = JSON.parse(data);
    let changed = false;

    const flaviaSeed = INITIAL_USERS.find(u => u.email === 'aplicativosflavia27@gmail.com');
    if (
      flaviaSeed &&
      !parsed.some(u => u.email.toLowerCase() === 'aplicativosflavia27@gmail.com')
    ) {
      parsed = [flaviaSeed, ...parsed];
      changed = true;
    }

    parsed = parsed.map(u => {
      if (u.role === 'GENERAL_SECRETARY' && /filemon\s+soares/i.test((u.name || '').trim())) {
        changed = true;
        return { ...u, name: 'Silvia' };
      }
      return u;
    });

    if (changed) {
      localStorage.setItem('sec_igreja_users', JSON.stringify(parsed));
    }
    return parsed;
  },

  saveUsers(users: User[]) {
    localStorage.setItem('sec_igreja_users', JSON.stringify(users));
  },

  isCleanSlate(churchId: string): boolean {
    return localStorage.getItem(`sec_igreja_clean_slate_${churchId}`) === '1';
  },

  markCleanSlate(churchId: string) {
    localStorage.setItem(`sec_igreja_clean_slate_${churchId}`, '1');
  },

  clearChurchDemoData(churchId: string) {
    const cleanArrayByChurch = <T extends { churchId: string }>(key: string, fallback: T[]) => {
      const data = localStorage.getItem(key);
      const all: T[] = data ? JSON.parse(data) : fallback;
      const filtered = all.filter(item => item.churchId !== churchId);
      localStorage.setItem(key, JSON.stringify(filtered));
    };

    cleanArrayByChurch('sec_igreja_members', INITIAL_MEMBERS);
    cleanArrayByChurch('sec_igreja_departments', INITIAL_DEPARTMENTS);
    cleanArrayByChurch('sec_igreja_events', INITIAL_EVENTS);
    cleanArrayByChurch('sec_igreja_dept_transfers', []);
    cleanArrayByChurch('sec_igreja_notifications', []);
    this.markCleanSlate(churchId);
  },

  getMembers(churchId: string): Member[] {
    this.purgeLegacyDemoData();
    const data = localStorage.getItem('sec_igreja_members');
    if (!data) {
      return [];
    }
    const allMembers: Member[] = JSON.parse(data);
    return allMembers.filter(m => m.churchId === churchId);
  },

  saveMember(member: Member) {
    const data = localStorage.getItem('sec_igreja_members');
    const allMembers: Member[] = data ? JSON.parse(data) : [];
    const index = allMembers.findIndex(m => m.id === member.id);
    if (index >= 0) {
      allMembers[index] = member;
    } else {
      allMembers.push(member);
    }
    localStorage.setItem('sec_igreja_members', JSON.stringify(allMembers));
  },

  saveMembersBatch(membersToSave: Member[]) {
    if (membersToSave.length === 0) return;
    const data = localStorage.getItem('sec_igreja_members');
    const allMembers: Member[] = data ? JSON.parse(data) : [];
    const map = new Map<string, Member>(allMembers.map(m => [m.id, m]));
    membersToSave.forEach(m => map.set(m.id, m));
    localStorage.setItem('sec_igreja_members', JSON.stringify(Array.from(map.values())));
  },

  deleteMember(churchId: string, memberId: string) {
    const data = localStorage.getItem('sec_igreja_members');
    if (!data) return;
    try {
      const allMembers: Member[] = JSON.parse(data);
      localStorage.setItem(
        'sec_igreja_members',
        JSON.stringify(allMembers.filter(m => !(m.churchId === churchId && m.id === memberId)))
      );
    } catch {
      // Ignore malformed storage
    }
  },

  replaceChurchMembers(churchId: string, churchMembers: Member[]) {
    const data = localStorage.getItem('sec_igreja_members');
    const allMembers: Member[] = data ? JSON.parse(data) : [];
    const otherChurches = allMembers.filter(m => m.churchId !== churchId);
    localStorage.setItem('sec_igreja_members', JSON.stringify([...otherChurches, ...churchMembers]));
  },

  getDepartments(churchId: string): Department[] {
    this.purgeLegacyDemoData();
    const data = localStorage.getItem('sec_igreja_departments');
    if (!data) {
      return [];
    }
    const all: Department[] = JSON.parse(data);
    return all.filter(d => d.churchId === churchId);
  },

  saveDepartment(dept: Department) {
    const data = localStorage.getItem('sec_igreja_departments');
    const all: Department[] = data ? JSON.parse(data) : [];
    const idx = all.findIndex(d => d.id === dept.id);
    if (idx >= 0) {
      all[idx] = dept;
    } else {
      all.push(dept);
    }
    localStorage.setItem('sec_igreja_departments', JSON.stringify(all));
  },

  replaceChurchDepartments(churchId: string, churchDepts: Department[]) {
    const data = localStorage.getItem('sec_igreja_departments');
    const all: Department[] = data ? JSON.parse(data) : [];
    const otherChurches = all.filter(d => d.churchId !== churchId);
    localStorage.setItem('sec_igreja_departments', JSON.stringify([...otherChurches, ...churchDepts]));
  },

  deleteDepartment(churchId: string, deptId: string) {
    const data = localStorage.getItem('sec_igreja_departments');
    if (data) {
      try {
        const all: Department[] = JSON.parse(data);
        localStorage.setItem(
          'sec_igreja_departments',
          JSON.stringify(all.filter(d => !(d.churchId === churchId && d.id === deptId)))
        );
      } catch {
        // Ignore malformed storage
      }
    }

    const membersData = localStorage.getItem('sec_igreja_members');
    if (membersData) {
      try {
        const allMembers: Member[] = JSON.parse(membersData);
        const updatedMembers = allMembers.map(m =>
          m.churchId === churchId && Array.isArray(m.departmentIds) && m.departmentIds.includes(deptId)
            ? { ...m, departmentIds: m.departmentIds.filter(id => id !== deptId) }
            : m
        );
        localStorage.setItem('sec_igreja_members', JSON.stringify(updatedMembers));
      } catch {
        // Ignore malformed storage
      }
    }
  },

  getDepartmentTransfers(churchId: string): DepartmentTransferHistory[] {
    const data = localStorage.getItem('sec_igreja_dept_transfers');
    const all: DepartmentTransferHistory[] = data ? JSON.parse(data) : [];
    return all.filter(t => t.churchId === churchId);
  },

  saveDepartmentTransfer(transfer: DepartmentTransferHistory) {
    const data = localStorage.getItem('sec_igreja_dept_transfers');
    const all: DepartmentTransferHistory[] = data ? JSON.parse(data) : [];
    all.unshift(transfer);
    localStorage.setItem('sec_igreja_dept_transfers', JSON.stringify(all));
  },

  getEvents(churchId: string): ChurchEvent[] {
    this.purgeLegacyDemoData();
    const data = localStorage.getItem('sec_igreja_events');
    if (!data) {
      return [];
    }
    const all: ChurchEvent[] = JSON.parse(data);
    return all.filter(e => e.churchId === churchId);
  },

  saveEvent(ev: ChurchEvent) {
    const data = localStorage.getItem('sec_igreja_events');
    const all: ChurchEvent[] = data ? JSON.parse(data) : [];
    const idx = all.findIndex(e => e.id === ev.id);
    if (idx >= 0) {
      all[idx] = ev;
    } else {
      all.unshift(ev);
    }
    localStorage.setItem('sec_igreja_events', JSON.stringify(all));
  },

  deleteEvent(churchId: string, eventId: string) {
    const data = localStorage.getItem('sec_igreja_events');
    if (!data) return;
    try {
      const all: ChurchEvent[] = JSON.parse(data);
      localStorage.setItem(
        'sec_igreja_events',
        JSON.stringify(all.filter(e => !(e.churchId === churchId && e.id === eventId)))
      );
    } catch {
      // Ignore malformed storage
    }
  },

  replaceChurchEvents(churchId: string, churchEvents: ChurchEvent[]) {
    const data = localStorage.getItem('sec_igreja_events');
    const all: ChurchEvent[] = data ? JSON.parse(data) : [];
    const otherChurches = all.filter(e => e.churchId !== churchId);
    localStorage.setItem('sec_igreja_events', JSON.stringify([...otherChurches, ...churchEvents]));
  },

  getNotifications(churchId: string, userId: string): AppNotification[] {
    this.purgeLegacyDemoData();
    const data = localStorage.getItem('sec_igreja_notifications');
    if (!data) return [];
    const all: AppNotification[] = JSON.parse(data);
    return all.filter(n => n.churchId === churchId && (n.userId === userId || n.userId === 'all'));
  },

  saveNotification(notification: AppNotification) {
    const data = localStorage.getItem('sec_igreja_notifications');
    const all: AppNotification[] = data ? JSON.parse(data) : [];
    all.unshift(notification);
    localStorage.setItem('sec_igreja_notifications', JSON.stringify(all));
  },

  getPaymentSettings(): PlatformPaymentSettings {
    const data = localStorage.getItem('sec_igreja_payment_settings');
    return data ? JSON.parse(data) : INITIAL_PAYMENT_SETTINGS;
  },

  savePaymentSettings(settings: PlatformPaymentSettings) {
    localStorage.setItem('sec_igreja_payment_settings', JSON.stringify(settings));
  },

  getPaymentProofs(churchId?: string): PaymentProof[] {
    this.purgeLegacyDemoData();
    const data = localStorage.getItem('sec_igreja_payment_proofs');
    const all: PaymentProof[] = data ? JSON.parse(data) : INITIAL_PAYMENT_PROOFS;
    if (churchId) {
      return all.filter(p => p.churchId === churchId);
    }
    return all;
  },

  savePaymentProof(proof: PaymentProof) {
    const data = localStorage.getItem('sec_igreja_payment_proofs');
    const all: PaymentProof[] = data ? JSON.parse(data) : INITIAL_PAYMENT_PROOFS;
    const idx = all.findIndex(p => p.id === proof.id);
    if (idx >= 0) {
      all[idx] = proof;
    } else {
      all.unshift(proof);
    }
    localStorage.setItem('sec_igreja_payment_proofs', JSON.stringify(all));
  },

  getSupportTickets(churchId?: string): SupportTicket[] {
    this.purgeLegacyDemoData();
    const data = localStorage.getItem('sec_igreja_support_tickets');
    const all: SupportTicket[] = data ? JSON.parse(data) : INITIAL_TICKETS;
    if (churchId) {
      return all.filter(t => t.churchId === churchId);
    }
    return all;
  },

  saveSupportTicket(ticket: SupportTicket) {
    const data = localStorage.getItem('sec_igreja_support_tickets');
    const all: SupportTicket[] = data ? JSON.parse(data) : INITIAL_TICKETS;
    const idx = all.findIndex(t => t.id === ticket.id);
    if (idx >= 0) {
      all[idx] = ticket;
    } else {
      all.unshift(ticket);
    }
    localStorage.setItem('sec_igreja_support_tickets', JSON.stringify(all));
  },
};
