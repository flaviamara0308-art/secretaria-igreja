import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { SecurityPolicy } from '../src/services/securityPolicy';
import { BackupService } from '../src/services/backupService';
import type { BackupRecord, Church, Department, Member, User } from '../src/types';

const ROOT = process.cwd();
const RULES_PATH = path.join(ROOT, 'firestore.rules');
const BLUEPRINT_PATH = path.join(ROOT, 'firebase-blueprint.json');

// ---------------------------------------------------------------------------
// Shared Fixtures (Multi-Tenant & Multi-Role)
// ---------------------------------------------------------------------------
const churchA: Church = {
  id: 'church-1',
  name: 'Igreja Batista Central',
  denomination: 'Batista',
  pastorName: 'Pr. João Silva',
  email: 'contato@ibc.org.br',
  phone: '(11) 3333-4444',
  address: 'Rua Central, 100',
  exclusiveCode: 'IBC2025',
  city: 'São Paulo',
  state: 'SP',
  zipCode: '01000-000',
  logoUrl: '',
  primaryColor: '#1e3a8a',
  secondaryColor: '#3b82f6',
  plan: 'MONTHLY_50',
  planStatus: 'ACTIVE',
  status: 'ACTIVE',
  createdAt: '2025-01-01',
};

const churchB: Church = {
  id: 'church-2',
  name: 'Igreja Presbiteriana Esperança',
  denomination: 'Presbiteriana',
  pastorName: 'Rev. Marcos Lima',
  email: 'secretaria@ipe.org.br',
  phone: '(41) 3222-1111',
  address: 'Av. Brasil, 250',
  exclusiveCode: 'IPE2025',
  city: 'Curitiba',
  state: 'PR',
  zipCode: '80020-000',
  logoUrl: '',
  primaryColor: '#065f46',
  secondaryColor: '#10b981',
  plan: 'FREE_PERMANENT',
  planStatus: 'ACTIVE',
  status: 'ACTIVE',
  createdAt: '2025-01-01',
};

const secretaryA: User = {
  id: 'sec-a-1',
  churchId: 'church-1',
  name: 'Ana Secretaria Geral',
  email: 'ana@ibc.org.br',
  role: 'GENERAL_SECRETARY',
  status: 'ACTIVE',
};

const adminA: User = {
  id: 'admin-a-1',
  churchId: 'church-1',
  name: 'Roberto Administrador Geral',
  email: 'roberto@ibc.org.br',
  role: 'ADMIN',
  status: 'ACTIVE',
};

const secRoleA: User = {
  id: 'secrole-a-1',
  churchId: 'church-1',
  name: 'Helena Secretaria',
  email: 'helena@ibc.org.br',
  role: 'SECRETARY',
  status: 'ACTIVE',
};

const assistantSecA: User = {
  id: 'asec-a-1',
  churchId: 'church-1',
  name: 'Carlos Auxiliar',
  email: 'carlos@ibc.org.br',
  role: 'ASSISTANT_SECRETARY',
  status: 'ACTIVE',
};

const pastorA: User = {
  id: 'pastor-a-1',
  churchId: 'church-1',
  name: 'Pr. João Silva',
  email: 'joao@ibc.org.br',
  role: 'PASTOR',
  status: 'ACTIVE',
};

const leaderA_Jovens: User = {
  id: 'leader-a-1',
  churchId: 'church-1',
  name: 'Marcos Líder Jovens',
  email: 'marcos@ibc.org.br',
  role: 'DEPARTMENT_LEADER',
  departmentIds: ['dept-jovens'],
  status: 'ACTIVE',
};

const suspendedSecA: User = {
  ...secretaryA,
  id: 'sec-a-inactive',
  status: 'INACTIVE',
};

const secretaryB: User = {
  id: 'sec-b-1',
  churchId: 'church-2',
  name: 'Beatriz Secretaria B',
  email: 'beatriz@ipe.org.br',
  role: 'GENERAL_SECRETARY',
  status: 'ACTIVE',
};

const platformRootAdmin: User = {
  id: 'platform-admin-1',
  churchId: 'PLATFORM',
  name: 'Admin Plataforma Geral',
  email: 'root@plataforma.org',
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
};

const platformSupportOnly: User = {
  id: 'platform-support-1',
  churchId: 'PLATFORM',
  name: 'Atendente Suporte',
  email: 'suporte@plataforma.org',
  role: 'PLATFORM_ASSISTANT_ADMIN',
  platformPermissions: ['SUPPORT'],
  status: 'ACTIVE',
};

const deptsFixture: Department[] = [
  {
    id: 'dept-jovens',
    churchId: 'church-1',
    name: 'Mocidade',
    description: 'Jovens',
    leaderId: 'leader-a-1',
    leaderName: 'Marcos',
    memberCount: 1,
    status: 'ACTIVE',
    createdAt: '2025-01-01',
  },
  {
    id: 'dept-infantil',
    churchId: 'church-1',
    name: 'Infantil',
    description: 'Crianças',
    leaderId: 'leader-a-2',
    leaderName: 'Lucia',
    memberCount: 1,
    status: 'ACTIVE',
    createdAt: '2025-01-01',
  },
  {
    id: 'dept-b-geral',
    churchId: 'church-2',
    name: 'Louvor IPE',
    description: 'Louvor',
    leaderId: 'leader-b-1',
    leaderName: 'Paulo',
    memberCount: 1,
    status: 'ACTIVE',
    createdAt: '2025-01-01',
  },
];

const membersFixture: Member[] = [
  {
    id: 'mem-a-1',
    churchId: 'church-1',
    fullName: 'Pedro Henrique',
    memberCode: 'IBC-001',
    birthDate: '2001-05-12',
    gender: 'MALE',
    maritalStatus: 'SINGLE',
    address: {
      street: 'Rua das Flores',
      number: '123',
      neighborhood: 'Centro',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01000-000',
    },
    phone: '(11) 99999-1111',
    email: 'pedro@email.com',
    membershipDate: '2022-01-10',
    churchRole: 'Membro',
    departmentIds: ['dept-jovens'],
    status: 'ACTIVE',
    notes: 'Informação pastoral sensível',
  },
  {
    id: 'mem-a-2',
    churchId: 'church-1',
    fullName: 'Sofia Costa',
    memberCode: 'IBC-002',
    birthDate: '2015-08-20',
    gender: 'FEMALE',
    maritalStatus: 'SINGLE',
    address: {
      street: 'Av. Paulista',
      number: '500',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01310-000',
    },
    phone: '(11) 98888-2222',
    email: 'sofia@email.com',
    membershipDate: '2023-03-01',
    churchRole: 'Membro',
    departmentIds: ['dept-infantil'],
    status: 'ACTIVE',
  },
  {
    id: 'mem-b-1',
    churchId: 'church-2',
    fullName: 'Daniela Oliveira (Igreja B)',
    memberCode: 'IPE-001',
    birthDate: '1990-02-14',
    gender: 'FEMALE',
    maritalStatus: 'MARRIED',
    address: {
      street: 'Rua XV',
      number: '45',
      neighborhood: 'Centro',
      city: 'Curitiba',
      state: 'PR',
      zipCode: '80020-000',
    },
    phone: '(41) 97777-3333',
    email: 'daniela@ipe.org.br',
    membershipDate: '2020-06-15',
    churchRole: 'Diaconisa',
    departmentIds: ['dept-b-geral'],
    status: 'ACTIVE',
  },
];

// ===========================================================================
// 1. FRONTEND RBAC & MULTI-TENANT SECURITY POLICY TESTS
// ===========================================================================
describe('Frontend SecurityPolicy — Multi-Tenant & RBAC', () => {
  it('enforces strict churchId isolation across all tenant actions', () => {
    // Secretary A has full access on Church A, ZERO access on Church B
    expect(SecurityPolicy.belongsToChurch(secretaryA, 'church-1')).toBe(true);
    expect(SecurityPolicy.belongsToChurch(secretaryA, 'church-2')).toBe(false);
    expect(SecurityPolicy.canAccessMembersModule(secretaryA, 'church-2')).toBe(false);
    expect(SecurityPolicy.canCreateOrEditMember(secretaryA, 'church-2')).toBe(false);
    expect(SecurityPolicy.canDeleteMember(secretaryA, 'church-2')).toBe(false);
    expect(SecurityPolicy.canManageDepartments(secretaryA, 'church-2')).toBe(false);
    expect(SecurityPolicy.canManageUsers(secretaryA, 'church-2')).toBe(false);
    expect(SecurityPolicy.canExportReports(secretaryA, 'church-2')).toBe(false);
    expect(SecurityPolicy.canManageAgenda(secretaryA, 'church-2')).toBe(false);
    expect(SecurityPolicy.canOpenSupportTicket(secretaryA, 'church-2')).toBe(false);
    expect(SecurityPolicy.canManageSettingsAndBackups(secretaryA, 'church-2')).toBe(false);
  });

  it('blocks INACTIVE church users from accessing any tenant resources', () => {
    expect(SecurityPolicy.belongsToChurch(suspendedSecA, 'church-1')).toBe(false);
    expect(SecurityPolicy.canAccessMembersModule(suspendedSecA, 'church-1')).toBe(false);
    expect(SecurityPolicy.filterVisibleMembers(suspendedSecA, 'church-1', membersFixture)).toHaveLength(0);
  });

  it('blocks Platform Admins and Support Staff from church member PII & internal church actions', () => {
    for (const staff of [platformRootAdmin, platformSupportOnly]) {
      expect(SecurityPolicy.isPlatformStaff(staff)).toBe(true);
      expect(SecurityPolicy.canAccessMembersModule(staff, 'church-1')).toBe(false);
      expect(SecurityPolicy.canViewRestrictedMemberPII(staff, 'church-1')).toBe(false);
      expect(SecurityPolicy.canCreateOrEditMember(staff, 'church-1')).toBe(false);
      expect(SecurityPolicy.canDeleteMember(staff, 'church-1')).toBe(false);
      expect(SecurityPolicy.filterVisibleMembers(staff, 'church-1', membersFixture)).toHaveLength(0);
      expect(SecurityPolicy.canManageSettingsAndBackups(staff, 'church-1')).toBe(false);
    }
  });

  it('enforces granular permissions for Platform Assistant Admins', () => {
    expect(SecurityPolicy.hasPlatformPermission(platformRootAdmin, 'CLOSE_CHURCHES')).toBe(true);
    expect(SecurityPolicy.hasPlatformPermission(platformRootAdmin, 'MANAGE_FINANCES')).toBe(true);
    expect(SecurityPolicy.hasPlatformPermission(platformSupportOnly, 'SUPPORT')).toBe(true);
    expect(SecurityPolicy.hasPlatformPermission(platformSupportOnly, 'MANAGE_FINANCES')).toBe(false);
    expect(SecurityPolicy.hasPlatformPermission(platformSupportOnly, 'CLOSE_CHURCHES')).toBe(false);
    expect(SecurityPolicy.hasPlatformPermission(platformSupportOnly, 'PLATFORM_SETTINGS')).toBe(false);
  });

  it('filters members & departments strictly by churchId and Department Leader assignment', () => {
    // Secretary A sees all Church A members (2), never Church B (1)
    const secVisible = SecurityPolicy.filterVisibleMembers(secretaryA, 'church-1', membersFixture);
    expect(secVisible.map(m => m.id)).toEqual(['mem-a-1', 'mem-a-2']);

    // Department Leader sees ONLY dept-jovens member (mem-a-1), NOT dept-infantil (mem-a-2) or Church B
    const leaderVisible = SecurityPolicy.filterVisibleMembers(leaderA_Jovens, 'church-1', membersFixture);
    expect(leaderVisible.map(m => m.id)).toEqual(['mem-a-1']);

    // Department Leader sees ONLY assigned department
    const leaderDepts = SecurityPolicy.filterVisibleDepartments(leaderA_Jovens, 'church-1', deptsFixture);
    expect(leaderDepts.map(d => d.id)).toEqual(['dept-jovens']);

    // Cross-tenant query even with mixed array returns 0
    expect(SecurityPolicy.filterVisibleMembers(secretaryA, 'church-2', membersFixture)).toHaveLength(0);
  });

  it('masks restricted PII for Pastor and Department Leader while allowing Secretary full view', () => {
    const targetMember = membersFixture[0];

    const secView = SecurityPolicy.sanitizeMemberForViewer(secretaryA, 'church-1', targetMember);
    expect(secView.email).toBe('pedro@email.com');
    expect(secView.phone).toBe('(11) 99999-1111');
    expect(secView.notes).toBe('Informação pastoral sensível');

    for (const restrictedViewer of [pastorA, leaderA_Jovens]) {
      const view = SecurityPolicy.sanitizeMemberForViewer(restrictedViewer, 'church-1', targetMember);
      expect(view.email).toContain('Restrito');
      expect(view.phone).toContain('Restrito');
      expect(view.notes).toBeUndefined();
      expect(view.address.street).toBe('Restrito');
      expect(view.address.city).toBe('São Paulo');
    }
  });

  it('restricts write/export/agenda/support permissions strictly to authorized church roles', () => {
    // Member creation/editing: General & Assistant Secretary allowed; Pastor & Leader denied
    expect(SecurityPolicy.canCreateOrEditMember(secretaryA, 'church-1')).toBe(true);
    expect(SecurityPolicy.canCreateOrEditMember(assistantSecA, 'church-1')).toBe(true);
    expect(SecurityPolicy.canCreateOrEditMember(pastorA, 'church-1')).toBe(false);
    expect(SecurityPolicy.canCreateOrEditMember(leaderA_Jovens, 'church-1')).toBe(false);

    // Member deletion, report export, agenda management, support tickets, settings: ONLY General Secretary
    for (const limitedUser of [assistantSecA, pastorA, leaderA_Jovens]) {
      expect(SecurityPolicy.canDeleteMember(limitedUser, 'church-1')).toBe(false);
      expect(SecurityPolicy.canExportReports(limitedUser, 'church-1')).toBe(false);
      expect(SecurityPolicy.canManageAgenda(limitedUser, 'church-1')).toBe(false);
      expect(SecurityPolicy.canOpenSupportTicket(limitedUser, 'church-1')).toBe(false);
      expect(SecurityPolicy.canManageSettingsAndBackups(limitedUser, 'church-1')).toBe(false);
    }

    expect(SecurityPolicy.canDeleteMember(secretaryA, 'church-1')).toBe(true);
    expect(SecurityPolicy.canExportReports(secretaryA, 'church-1')).toBe(true);
    expect(SecurityPolicy.canManageAgenda(secretaryA, 'church-1')).toBe(true);
    expect(SecurityPolicy.canOpenSupportTicket(secretaryA, 'church-1')).toBe(true);
    expect(SecurityPolicy.canManageSettingsAndBackups(secretaryA, 'church-1')).toBe(true);
    expect(SecurityPolicy.canDeleteDepartment(secretaryA, 'church-1')).toBe(true);
  });

  it('grants General Administrator (ADMIN) and Secretary (SECRETARY) full parity with GENERAL_SECRETARY while isolating tenants', () => {
    for (const fullAdmin of [adminA, secRoleA]) {
      expect(SecurityPolicy.canAccessMembersModule(fullAdmin, 'church-1')).toBe(true);
      expect(SecurityPolicy.canViewRestrictedMemberPII(fullAdmin, 'church-1')).toBe(true);
      expect(SecurityPolicy.canCreateOrEditMember(fullAdmin, 'church-1')).toBe(true);
      expect(SecurityPolicy.canDeleteMember(fullAdmin, 'church-1')).toBe(true);
      expect(SecurityPolicy.canManageDepartments(fullAdmin, 'church-1')).toBe(true);
      expect(SecurityPolicy.canDeleteDepartment(fullAdmin, 'church-1')).toBe(true);
      expect(SecurityPolicy.canManageUsers(fullAdmin, 'church-1')).toBe(true);
      expect(SecurityPolicy.canExportReports(fullAdmin, 'church-1')).toBe(true);
      expect(SecurityPolicy.canManageAgenda(fullAdmin, 'church-1')).toBe(true);
      expect(SecurityPolicy.canOpenSupportTicket(fullAdmin, 'church-1')).toBe(true);
      expect(SecurityPolicy.canManageSettingsAndBackups(fullAdmin, 'church-1')).toBe(true);
      expect(SecurityPolicy.canModifyTargetUser(fullAdmin, pastorA, 'ASSISTANT_SECRETARY').allowed).toBe(true);
      expect(SecurityPolicy.canModifyTargetUser(fullAdmin, pastorA, 'PLATFORM_ADMIN').allowed).toBe(false);

      // Zero access to other tenants
      expect(SecurityPolicy.canDeleteDepartment(fullAdmin, 'church-2')).toBe(false);
      expect(SecurityPolicy.canManageUsers(fullAdmin, 'church-2')).toBe(false);
      expect(SecurityPolicy.canDeleteMember(fullAdmin, 'church-2')).toBe(false);
    }

    // Assistant secretary can create/edit departments, but deletion stays restricted
    expect(SecurityPolicy.canManageDepartments(assistantSecA, 'church-1')).toBe(true);
    expect(SecurityPolicy.canDeleteDepartment(assistantSecA, 'church-1')).toBe(false);
    expect(SecurityPolicy.canDeleteDepartment(pastorA, 'church-1')).toBe(false);
  });

  it('prevents self-privilege escalation, cross-tenant user mutation, and church->platform role promotion', () => {
    // Self modification blocked
    expect(SecurityPolicy.canModifyTargetUser(secretaryA, secretaryA, 'GENERAL_SECRETARY').allowed).toBe(false);
    expect(SecurityPolicy.canModifyTargetUser(pastorA, pastorA, 'GENERAL_SECRETARY').allowed).toBe(false);

    // Cross-tenant modification blocked
    expect(SecurityPolicy.canModifyTargetUser(secretaryA, { ...pastorA, churchId: 'church-2' }).allowed).toBe(false);

    // Church Secretary cannot promote user to PLATFORM_ADMIN
    expect(SecurityPolicy.canModifyTargetUser(secretaryA, pastorA, 'PLATFORM_ADMIN').allowed).toBe(false);
    expect(SecurityPolicy.canModifyTargetUser(secretaryA, pastorA, 'PLATFORM_ASSISTANT_ADMIN').allowed).toBe(false);

    // Church Secretary CAN manage roles within own church
    expect(SecurityPolicy.canModifyTargetUser(secretaryA, pastorA, 'ASSISTANT_SECRETARY').allowed).toBe(true);

    // Regular users cannot switch church context
    expect(SecurityPolicy.canSwitchChurchContext(secretaryA, churchA)).toBe(true);
    expect(SecurityPolicy.canSwitchChurchContext(secretaryA, churchB)).toBe(false);
  });

  it('blocks cross-tenant backup restoration in BackupService', async () => {
    // Backup belonging to church-2
    const foreignBackup: BackupRecord = {
      id: 'backup-foreign-1',
      churchId: 'church-2',
      churchName: churchB.name,
      createdAt: new Date().toISOString(),
      createdBy: secretaryB.name,
      recordCounts: { members: 1, departments: 1, events: 0, users: 1 },
      checksum: 'CRC32-TEST',
      dataJson: JSON.stringify({ data: { members: [], departments: [], events: [] } }),
      status: 'COMPLETED',
      sizeBytes: 120,
      integrityVerified: true,
    };

    const result = await BackupService.restoreBackup(foreignBackup, churchA, secretaryA);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Violação grave de isolamento');
  });
});

// ===========================================================================
// 2. FIRESTORE.RULES STRUCTURAL AUDIT & SECURITY POLICY SIMULATOR
// ===========================================================================
describe('Backend Firestore Security Rules — Structural Audit & Policy Simulation', () => {
  const rulesContent = fs.readFileSync(RULES_PATH, 'utf8');
  const blueprint = JSON.parse(fs.readFileSync(BLUEPRINT_PATH, 'utf8'));

  it('enforces a global default-deny safety net as the first matcher and contains zero blanket auth rules', () => {
    // 1. Default deny catch-all exists and precedes collection rules
    const defaultDenyIdx = rulesContent.indexOf('match /{document=**}');
    const churchesMatchIdx = rulesContent.indexOf('match /churches/{churchId}');
    expect(defaultDenyIdx).toBeGreaterThan(-1);
    expect(churchesMatchIdx).toBeGreaterThan(defaultDenyIdx);
    expect(rulesContent).toMatch(/match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);

    // 2. Forbidden insecure patterns ("Dirty Dozen" red flags)
    expect(rulesContent).not.toMatch(/allow\s+(read|write|get|list|create|update|delete)\s*:\s*if\s+true\s*;/);
    expect(rulesContent).not.toMatch(/allow\s+(read|write|get|list|create|update|delete)\s*:\s*if\s+(isSignedIn\(\)|request\.auth\s*!=\s*null)\s*;/);
  });

  it('covers every top-level and nested collection declared in firebase-blueprint.json', () => {
    const blueprintPaths = Object.keys(blueprint.firestore || {});
    expect(blueprintPaths.length).toBeGreaterThanOrEqual(7);

    expect(rulesContent).toContain('match /churches/{churchId}');
    expect(rulesContent).toContain('match /members/{memberId}');
    expect(rulesContent).toContain('match /departments/{deptId}');
    expect(rulesContent).toContain('match /events/{eventId}');
    expect(rulesContent).toContain('match /users/{userId}');
    expect(rulesContent).toContain('match /auditLogs/{auditId}');
    expect(rulesContent).toContain('match /backups/{backupId}');
    expect(rulesContent).toContain('match /paymentProofs/{proofId}');
    expect(rulesContent).toContain('match /tickets/{ticketId}');
    expect(rulesContent).toContain('match /platformSettings/{settingId}');
  });

  it('explicitly excludes Platform Staff from /members and /backups in firestore.rules', () => {
    // Extract members match block
    const membersBlockMatch = rulesContent.match(/match \/members\/\{memberId\}\s*\{[\s\S]*?\n\s{6}\}/);
    expect(membersBlockMatch).not.toBeNull();
    const membersBlock = membersBlockMatch![0];
    expect(membersBlock).not.toContain('isPlatformStaff');
    expect(membersBlock).not.toContain('isPlatformRootAdmin');
    expect(membersBlock).not.toContain('hasPlatformPermission');

    // Extract backups match block
    const backupsBlockMatch = rulesContent.match(/match \/backups\/\{backupId\}\s*\{[\s\S]*?\n\s{4}\}/);
    expect(backupsBlockMatch).not.toBeNull();
    const backupsBlock = backupsBlockMatch![0];
    expect(backupsBlock).not.toContain('isPlatformStaff');
    expect(backupsBlock).not.toContain('hasPlatformPermission');
  });

  it('locks auditLogs to immutable append-only (allow update, delete: if false)', () => {
    const auditBlockMatch = rulesContent.match(/match \/auditLogs\/\{auditId\}\s*\{[\s\S]*?\n\s{4}\}/);
    expect(auditBlockMatch).not.toBeNull();
    expect(auditBlockMatch![0]).toMatch(/allow update, delete:\s*if false;/);
  });
});

// ===========================================================================
// 3. ADVERSARIAL FIRESTORE RULES EVALUATOR (RED-TEAM TEST MATRIX)
// Mirrors the exact CEL logic in /firestore.rules line-by-line
// ===========================================================================
type AuthContext = { uid: string; token?: { email?: string; email_verified?: boolean } } | null;

class FirestoreRulesSimulator {
  private db: {
    users: Record<string, any>;
    churches: Record<string, any>;
    members: Record<string, Record<string, any>>;
    departments: Record<string, Record<string, any>>;
    backups: Record<string, any>;
    auditLogs: Record<string, any>;
    paymentProofs: Record<string, any>;
    tickets: Record<string, any>;
  };

  constructor() {
    this.db = {
      users: {
        [secretaryA.id]: secretaryA,
        [adminA.id]: adminA,
        [secRoleA.id]: secRoleA,
        [assistantSecA.id]: assistantSecA,
        [pastorA.id]: pastorA,
        [leaderA_Jovens.id]: leaderA_Jovens,
        [suspendedSecA.id]: suspendedSecA,
        [secretaryB.id]: secretaryB,
        [platformRootAdmin.id]: platformRootAdmin,
        [platformSupportOnly.id]: platformSupportOnly,
      },
      churches: {
        [churchA.id]: churchA,
        [churchB.id]: churchB,
      },
      members: {
        'church-1': {
          'mem-a-1': membersFixture[0],
          'mem-a-2': membersFixture[1],
        },
        'church-2': {
          'mem-b-1': membersFixture[2],
        },
      },
      departments: {
        'church-1': {
          'dept-jovens': deptsFixture[0],
          'dept-infantil': deptsFixture[1],
        },
        'church-2': {
          'dept-b-geral': deptsFixture[2],
        },
      },
      backups: {
        'backup-c1': {
          id: 'backup-c1',
          churchId: 'church-1',
          createdAt: '2026-01-01',
          checksum: 'CRC32-1111',
          dataJson: '{}',
        },
        'backup-c2': {
          id: 'backup-c2',
          churchId: 'church-2',
          createdAt: '2026-01-01',
          checksum: 'CRC32-2222',
          dataJson: '{}',
        },
      },
      auditLogs: {
        'audit-c1': {
          id: 'audit-c1',
          churchId: 'church-1',
          userId: secretaryA.id,
          userName: secretaryA.name,
          action: 'Exportação PDF',
          details: 'Rol de ativos',
          timestamp: Date.now(),
        },
      },
      paymentProofs: {
        'proof-1': {
          id: 'proof-1',
          churchId: 'church-1',
          plan: 'MONTHLY_50',
          amount: 50,
          paymentMethod: 'PIX',
          status: 'PENDING',
          submittedAt: '2026-05-01',
        },
      },
      tickets: {
        'ticket-1': {
          id: 'ticket-1',
          churchId: 'church-1',
          subject: 'Dúvida na importação',
          category: 'DUVIDA',
          priority: 'MEDIA',
          status: 'OPEN',
          createdAt: '2026-05-01',
        },
      },
    };
  }

  private userData(auth: AuthContext) {
    if (!auth) return null;
    return this.db.users[auth.uid] || null;
  }

  private isActiveUser(auth: AuthContext) {
    const u = this.userData(auth);
    return !!u && u.status === 'ACTIVE';
  }

  private isSameChurch(auth: AuthContext, churchId: string) {
    const u = this.userData(auth);
    return this.isActiveUser(auth) && u.churchId === churchId && u.churchId !== 'PLATFORM';
  }

  private isBootstrappedPlatformAdmin(auth: AuthContext) {
    return (
      Boolean(auth) &&
      auth?.token?.email_verified === true &&
      (auth?.token?.email === 'flaviamara0308@gmail.com' ||
        auth?.token?.email === 'aplicativosflavia27@gmail.com')
    );
  }

  private isPlatformStaff(auth: AuthContext) {
    if (this.isBootstrappedPlatformAdmin(auth)) return true;
    const u = this.userData(auth);
    return (
      this.isActiveUser(auth) &&
      u.churchId === 'PLATFORM' &&
      (u.role === 'PLATFORM_ADMIN' || u.role === 'PLATFORM_ASSISTANT_ADMIN')
    );
  }

  private isPlatformRootAdmin(auth: AuthContext) {
    if (this.isBootstrappedPlatformAdmin(auth)) return true;
    const u = this.userData(auth);
    return this.isActiveUser(auth) && u?.churchId === 'PLATFORM' && u?.role === 'PLATFORM_ADMIN';
  }

  private hasPlatformPermission(auth: AuthContext, perm: string) {
    if (this.isBootstrappedPlatformAdmin(auth)) return true;
    const u = this.userData(auth);
    if (!this.isPlatformStaff(auth)) return false;
    return u.role === 'PLATFORM_ADMIN' || (Array.isArray(u.platformPermissions) && u.platformPermissions.includes(perm));
  }

  private isChurchSecretary(auth: AuthContext, churchId: string) {
    const u = this.userData(auth);
    return this.isSameChurch(auth, churchId) && ['GENERAL_SECRETARY', 'ADMIN', 'SECRETARY'].includes(u.role);
  }

  private canManageSettingsAndBackups(auth: AuthContext, churchId: string) {
    const u = this.userData(auth);
    return this.isSameChurch(auth, churchId) && ['GENERAL_SECRETARY', 'ADMIN', 'SECRETARY'].includes(u.role);
  }

  private isChurchStaffEditor(auth: AuthContext, churchId: string) {
    const u = this.userData(auth);
    return this.isChurchSecretary(auth, churchId) || (this.isSameChurch(auth, churchId) && u.role === 'ASSISTANT_SECRETARY');
  }

  private isChurchPastor(auth: AuthContext, churchId: string) {
    const u = this.userData(auth);
    return this.isSameChurch(auth, churchId) && u.role === 'PASTOR';
  }

  private isDepartmentLeader(auth: AuthContext, churchId: string) {
    const u = this.userData(auth);
    return this.isSameChurch(auth, churchId) && u.role === 'DEPARTMENT_LEADER';
  }

  private diffAffectedKeys(incoming: Record<string, any>, existing: Record<string, any>) {
    const keys = new Set([...Object.keys(incoming), ...Object.keys(existing)]);
    return Array.from(keys).filter(k => JSON.stringify(incoming[k]) !== JSON.stringify(existing[k]));
  }

  canGetMember(auth: AuthContext, churchId: string, memberId: string): boolean {
    const existing = this.db.members[churchId]?.[memberId];
    if (!existing) return false;
    const u = this.userData(auth);
    return (
      this.isChurchStaffEditor(auth, churchId) ||
      this.isChurchPastor(auth, churchId) ||
      (this.isDepartmentLeader(auth, churchId) &&
        Array.isArray(u?.departmentIds) &&
        Array.isArray(existing.departmentIds) &&
        existing.departmentIds.some((d: string) => u.departmentIds.includes(d)))
    );
  }

  canWriteMember(auth: AuthContext, churchId: string, memberId: string, incoming: Member, op: 'create' | 'update' | 'delete'): boolean {
    if (op === 'delete') return this.isChurchSecretary(auth, churchId);
    if (op === 'create') {
      return incoming.id === memberId && incoming.churchId === churchId && this.isChurchStaffEditor(auth, churchId);
    }
    const existing = this.db.members[churchId]?.[memberId];
    if (!existing) return false;
    return (
      incoming.id === existing.id &&
      incoming.churchId === existing.churchId &&
      incoming.churchId === churchId &&
      this.isChurchStaffEditor(auth, churchId)
    );
  }

  canUpdateChurch(auth: AuthContext, churchId: string, incoming: Church): boolean {
    const existing = this.db.churches[churchId];
    if (!existing || incoming.id !== existing.id) return false;
    const affected = this.diffAffectedKeys(incoming, existing);
    const allowedSecFields = [
      'name', 'denomination', 'cnpj', 'pastorName', 'email', 'phone',
      'address', 'city', 'state', 'zipCode', 'logoUrl',
      'primaryColor', 'secondaryColor', 'offlineConfig', 'updatedAt',
    ];
    const secretaryOnlyBranding =
      this.isChurchSecretary(auth, churchId) &&
      incoming.exclusiveCode === existing.exclusiveCode &&
      incoming.plan === existing.plan &&
      incoming.planStatus === existing.planStatus &&
      incoming.status === existing.status &&
      affected.every(k => allowedSecFields.includes(k));

    return (
      secretaryOnlyBranding ||
      this.hasPlatformPermission(auth, 'MANAGE_CHURCHES') ||
      this.hasPlatformPermission(auth, 'SUBSCRIPTIONS') ||
      this.hasPlatformPermission(auth, 'MANAGE_FINANCES') ||
      this.hasPlatformPermission(auth, 'CLOSE_CHURCHES')
    );
  }

  canCreateChurch(auth: AuthContext, churchId: string, incoming: Church): boolean {
    if (!auth || incoming.id !== churchId) return false;
    const selfPending =
      incoming.status === 'PENDING' &&
      incoming.plan !== 'FREE_PERMANENT' &&
      (!incoming.ownerUid || incoming.ownerUid === auth.uid);
    return selfPending || this.hasPlatformPermission(auth, 'MANAGE_CHURCHES');
  }

  canCreateUser(auth: AuthContext, userId: string, incoming: User): boolean {
    if (!auth || incoming.id !== userId) return false;
    const preAuth = incoming.claimedFromUserId ? this.db.users[incoming.claimedFromUserId] : null;
    const claimAllowed =
      auth.uid === userId &&
      !this.db.users[auth.uid] &&
      auth.token?.email_verified === true &&
      Boolean(preAuth) &&
      preAuth.email === auth.token?.email &&
      ['ACTIVE', 'PENDING_INVITE'].includes(preAuth.status) &&
      incoming.email === auth.token?.email &&
      incoming.churchId === preAuth.churchId &&
      incoming.role === preAuth.role &&
      incoming.status === 'ACTIVE' &&
      (!preAuth.departmentIds || JSON.stringify(incoming.departmentIds) === JSON.stringify(preAuth.departmentIds));

    const secSameChurch =
      this.isChurchSecretary(auth, incoming.churchId) &&
      incoming.churchId !== 'PLATFORM' &&
      incoming.role !== 'PLATFORM_ADMIN' &&
      incoming.role !== 'PLATFORM_ASSISTANT_ADMIN';

    return claimAllowed || secSameChurch || this.isPlatformRootAdmin(auth);
  }

  canUpdateUser(auth: AuthContext, userId: string, incoming: User): boolean {
    const existing = this.db.users[userId];
    if (!existing || !auth) return false;
    if (incoming.id !== existing.id) return false;

    const affected = this.diffAffectedKeys(incoming, existing);
    const selfSafe =
      auth.uid === userId &&
      incoming.churchId === existing.churchId &&
      incoming.role === existing.role &&
      incoming.status === existing.status &&
      affected.every(k => ['name', 'lastLogin', 'notificationPreferences'].includes(k));

    const secSameChurch =
      this.isChurchSecretary(auth, existing.churchId) &&
      auth.uid !== userId &&
      incoming.churchId === existing.churchId &&
      incoming.churchId !== 'PLATFORM' &&
      incoming.role !== 'PLATFORM_ADMIN' &&
      incoming.role !== 'PLATFORM_ASSISTANT_ADMIN';

    const rootPlatform = this.isPlatformRootAdmin(auth) && auth.uid !== userId;

    const bootstrappedRootSelf =
      this.isBootstrappedPlatformAdmin(auth) &&
      auth.uid === userId &&
      incoming.churchId === 'PLATFORM' &&
      incoming.role === 'PLATFORM_ADMIN' &&
      incoming.status === 'ACTIVE';

    return selfSafe || secSameChurch || rootPlatform || bootstrappedRootSelf;
  }

  canGetBackup(auth: AuthContext, backupId: string): boolean {
    const b = this.db.backups[backupId];
    if (!b) return false;
    return this.canManageSettingsAndBackups(auth, b.churchId);
  }

  canWriteBackup(
    auth: AuthContext,
    backupId: string,
    incoming: any,
    op: 'create' | 'update' | 'delete'
  ): boolean {
    if (op === 'create') {
      return (
        Boolean(incoming) &&
        incoming.id === backupId &&
        typeof incoming.churchId === 'string' &&
        this.canManageSettingsAndBackups(auth, incoming.churchId)
      );
    }
    const existing = this.db.backups[backupId];
    if (!existing) return false;
    if (op === 'delete') {
      return this.canManageSettingsAndBackups(auth, existing.churchId);
    }
    return (
      Boolean(incoming) &&
      incoming.id === existing.id &&
      incoming.churchId === existing.churchId &&
      this.canManageSettingsAndBackups(auth, existing.churchId)
    );
  }

  canModifyAuditLog(_auth: AuthContext, _op: 'update' | 'delete'): boolean {
    return false;
  }

  canCreatePaymentProof(auth: AuthContext, proofId: string, incoming: any): boolean {
    return incoming.id === proofId && this.isChurchSecretary(auth, incoming.churchId) && incoming.status === 'PENDING';
  }

  canUpdatePaymentProof(auth: AuthContext, proofId: string, incoming: any): boolean {
    const existing = this.db.paymentProofs[proofId];
    if (!existing) return false;
    if (incoming.id !== existing.id || incoming.churchId !== existing.churchId || incoming.plan !== existing.plan) return false;
    if (!this.hasPlatformPermission(auth, 'MANAGE_FINANCES')) return false;
    return (
      incoming.status === 'APPROVED' ||
      (incoming.status === 'REJECTED' && typeof incoming.rejectionReason === 'string' && incoming.rejectionReason.length >= 3)
    );
  }

  canCreateTicket(auth: AuthContext, ticketId: string, incoming: any): boolean {
    return incoming.id === ticketId && this.isChurchSecretary(auth, incoming.churchId) && incoming.status === 'OPEN';
  }

  canDeleteDepartment(auth: AuthContext, churchId: string, deptId: string): boolean {
    return Boolean(this.db.departments[churchId]?.[deptId]) && this.isChurchSecretary(auth, churchId);
  }

  canDeleteChurch(auth: AuthContext, churchId: string): boolean {
    return Boolean(this.db.churches[churchId]) && this.hasPlatformPermission(auth, 'CLOSE_CHURCHES');
  }
}

describe('Adversarial Firestore Rule Policy Simulation (Multi-Tenant + RBAC)', () => {
  let sim: FirestoreRulesSimulator;

  beforeEach(() => {
    sim = new FirestoreRulesSimulator();
  });

  it('1. Denies all access to unauthenticated requests (auth == null)', () => {
    expect(sim.canGetMember(null, 'church-1', 'mem-a-1')).toBe(false);
    expect(sim.canWriteMember(null, 'church-1', 'mem-a-1', membersFixture[0], 'update')).toBe(false);
    expect(sim.canUpdateChurch(null, 'church-1', churchA)).toBe(false);
    expect(sim.canUpdateUser(null, secretaryA.id, secretaryA)).toBe(false);
    expect(sim.canGetBackup(null, 'backup-c1')).toBe(false);
  });

  it('2. Blocks Cross-Tenant reads and writes between Church A and Church B', () => {
    const authA = { uid: secretaryA.id };
    const authB = { uid: secretaryB.id };

    // Church A Secretary CANNOT access Church B member, backup, or church settings
    expect(sim.canGetMember(authA, 'church-2', 'mem-b-1')).toBe(false);
    expect(sim.canWriteMember(authA, 'church-2', 'mem-b-1', membersFixture[2], 'update')).toBe(false);
    expect(sim.canWriteMember(authA, 'church-2', 'mem-x', { ...membersFixture[0], id: 'mem-x', churchId: 'church-2' }, 'create')).toBe(false);
    expect(sim.canGetBackup(authA, 'backup-c2')).toBe(false);
    expect(sim.canUpdateChurch(authA, 'church-2', { ...churchB, name: 'Hacked' })).toBe(false);

    // Church B Secretary CANNOT access Church A member or backup
    expect(sim.canGetMember(authB, 'church-1', 'mem-a-1')).toBe(false);
    expect(sim.canGetBackup(authB, 'backup-c1')).toBe(false);
  });

  it('3. Blocks Platform Admins & Support Staff from reading or editing Church member PII or backups', () => {
    for (const staff of [platformRootAdmin, platformSupportOnly]) {
      const auth = { uid: staff.id };
      expect(sim.canGetMember(auth, 'church-1', 'mem-a-1')).toBe(false);
      expect(sim.canGetMember(auth, 'church-2', 'mem-b-1')).toBe(false);
      expect(sim.canWriteMember(auth, 'church-1', 'mem-a-1', membersFixture[0], 'update')).toBe(false);
      expect(sim.canGetBackup(auth, 'backup-c1')).toBe(false);
    }
  });

  it('4. Blocks Department Leader outside assigned departments and forbids member mutations', () => {
    const authLeader = { uid: leaderA_Jovens.id };

    // Assigned department member -> read allowed
    expect(sim.canGetMember(authLeader, 'church-1', 'mem-a-1')).toBe(true);
    // Unassigned department member -> read DENIED
    expect(sim.canGetMember(authLeader, 'church-1', 'mem-a-2')).toBe(false);
    // Create/Update/Delete -> DENIED
    expect(sim.canWriteMember(authLeader, 'church-1', 'mem-a-1', membersFixture[0], 'update')).toBe(false);
    expect(sim.canWriteMember(authLeader, 'church-1', 'mem-new', { ...membersFixture[0], id: 'mem-new' }, 'create')).toBe(false);
    expect(sim.canWriteMember(authLeader, 'church-1', 'mem-a-1', membersFixture[0], 'delete')).toBe(false);
  });

  it('5. Allows Pastor read-only member access within own church, denies create/update/delete', () => {
    const authPastor = { uid: pastorA.id };

    expect(sim.canGetMember(authPastor, 'church-1', 'mem-a-1')).toBe(true);
    expect(sim.canGetMember(authPastor, 'church-1', 'mem-a-2')).toBe(true);
    expect(sim.canWriteMember(authPastor, 'church-1', 'mem-a-1', membersFixture[0], 'update')).toBe(false);
    expect(sim.canWriteMember(authPastor, 'church-1', 'mem-a-1', membersFixture[0], 'delete')).toBe(false);
  });

  it('6. Blocks self privilege escalation & cross-church user modification on /users', () => {
    const authPastor = { uid: pastorA.id };
    const authSecA = { uid: secretaryA.id };

    // Pastor tries to upgrade self to GENERAL_SECRETARY -> DENIED
    expect(sim.canUpdateUser(authPastor, pastorA.id, { ...pastorA, role: 'GENERAL_SECRETARY' })).toBe(false);
    // Pastor tries to move self to church-2 -> DENIED
    expect(sim.canUpdateUser(authPastor, pastorA.id, { ...pastorA, churchId: 'church-2' })).toBe(false);
    // Pastor updates own display name -> ALLOWED
    expect(sim.canUpdateUser(authPastor, pastorA.id, { ...pastorA, name: 'Pr. João Atualizado' })).toBe(true);

    // Church A Secretary tries to promote Pastor A to PLATFORM_ADMIN -> DENIED
    expect(sim.canUpdateUser(authSecA, pastorA.id, { ...pastorA, role: 'PLATFORM_ADMIN' })).toBe(false);
    // Church A Secretary promotes Pastor A to ASSISTANT_SECRETARY -> ALLOWED
    expect(sim.canUpdateUser(authSecA, pastorA.id, { ...pastorA, role: 'ASSISTANT_SECRETARY' })).toBe(true);
  });

  it('7. Blocks Church Secretary from self-granting FREE_PERMANENT plan or reactivating suspended church', () => {
    const authSecA = { uid: secretaryA.id };

    // Updating branding -> ALLOWED
    expect(sim.canUpdateChurch(authSecA, 'church-1', { ...churchA, city: 'Campinas' })).toBe(true);

    // Tampering with commercial plan or planStatus -> DENIED
    expect(sim.canUpdateChurch(authSecA, 'church-1', { ...churchA, plan: 'FREE_PERMANENT' })).toBe(false);
    expect(sim.canUpdateChurch(authSecA, 'church-1', { ...churchA, planStatus: 'TRIAL' })).toBe(false);
    expect(sim.canUpdateChurch(authSecA, 'church-1', { ...churchA, status: 'SUSPENDED' })).toBe(false);

    // Platform Admin WITH SUBSCRIPTIONS permission -> ALLOWED
    expect(sim.canUpdateChurch({ uid: platformRootAdmin.id }, 'church-1', { ...churchA, plan: 'FREE_PERMANENT' })).toBe(true);
    // Platform Assistant WITHOUT finance/church perms -> DENIED
    expect(sim.canUpdateChurch({ uid: platformSupportOnly.id }, 'church-1', { ...churchA, plan: 'FREE_PERMANENT' })).toBe(false);
  });

  it('8. Enforces payment proof workflow & mandatory rejection reason + audit immutability', () => {
    const authSecA = { uid: secretaryA.id };
    const authFinance = { uid: platformRootAdmin.id };
    const authSupport = { uid: platformSupportOnly.id };

    // Church submits proof with APPROVED status -> DENIED (must be PENDING)
    expect(
      sim.canCreatePaymentProof(authSecA, 'proof-new', {
        id: 'proof-new',
        churchId: 'church-1',
        plan: 'ANNUAL_600',
        amount: 600,
        status: 'APPROVED',
      })
    ).toBe(false);

    // Church submits PENDING proof -> ALLOWED
    expect(
      sim.canCreatePaymentProof(authSecA, 'proof-new', {
        id: 'proof-new',
        churchId: 'church-1',
        plan: 'ANNUAL_600',
        amount: 600,
        status: 'PENDING',
      })
    ).toBe(true);

    // Support staff without MANAGE_FINANCES cannot approve payment -> DENIED
    expect(
      sim.canUpdatePaymentProof(authSupport, 'proof-1', {
        id: 'proof-1',
        churchId: 'church-1',
        plan: 'MONTHLY_50',
        status: 'APPROVED',
      })
    ).toBe(false);

    // Finance admin rejecting WITHOUT reason -> DENIED; WITH reason -> ALLOWED
    expect(
      sim.canUpdatePaymentProof(authFinance, 'proof-1', {
        id: 'proof-1',
        churchId: 'church-1',
        plan: 'MONTHLY_50',
        status: 'REJECTED',
        rejectionReason: '',
      })
    ).toBe(false);

    expect(
      sim.canUpdatePaymentProof(authFinance, 'proof-1', {
        id: 'proof-1',
        churchId: 'church-1',
        plan: 'MONTHLY_50',
        status: 'REJECTED',
        rejectionReason: 'Comprovante ilegível',
      })
    ).toBe(true);

    // Audit Logs immutable
    expect(sim.canModifyAuditLog(authFinance, 'update')).toBe(false);
    expect(sim.canModifyAuditLog(authSecA, 'delete')).toBe(false);
  });

  it('9. Enforces Support Ticket opening solely for General Secretary', () => {
    const newTicket = { id: 't-new', churchId: 'church-1', status: 'OPEN' };
    expect(sim.canCreateTicket({ uid: secretaryA.id }, 't-new', newTicket)).toBe(true);
    expect(sim.canCreateTicket({ uid: assistantSecA.id }, 't-new', newTicket)).toBe(false);
    expect(sim.canCreateTicket({ uid: pastorA.id }, 't-new', newTicket)).toBe(false);
    expect(sim.canCreateTicket({ uid: leaderA_Jovens.id }, 't-new', newTicket)).toBe(false);
    expect(sim.canCreateTicket({ uid: secretaryB.id }, 't-new', newTicket)).toBe(false);
  });

  it('10. Bootstraps aplicativosflavia27@gmail.com as Platform Admin only when email_verified is true and keeps church PII isolated', () => {
    const verifiedFlavia: AuthContext = {
      uid: 'uid-flavia-google',
      token: { email: 'aplicativosflavia27@gmail.com', email_verified: true },
    };
    const spoofedUnverifiedFlavia: AuthContext = {
      uid: 'uid-spoof',
      token: { email: 'aplicativosflavia27@gmail.com', email_verified: false },
    };

    // Verified email can manage church plans & approve payments
    expect(sim.canUpdateChurch(verifiedFlavia, 'church-1', { ...churchA, plan: 'FREE_PERMANENT' })).toBe(true);
    expect(
      sim.canUpdatePaymentProof(verifiedFlavia, 'proof-1', {
        id: 'proof-1',
        churchId: 'church-1',
        plan: 'MONTHLY_50',
        status: 'APPROVED',
      })
    ).toBe(true);

    // Verified Platform Admin is STILL blocked from reading church member PII & backups
    expect(sim.canGetMember(verifiedFlavia, 'church-1', 'mem-a-1')).toBe(false);
    expect(sim.canGetBackup(verifiedFlavia, 'backup-c1')).toBe(false);

    // Spoofed unverified email is DENIED
    expect(sim.canUpdateChurch(spoofedUnverifiedFlavia, 'church-1', { ...churchA, plan: 'FREE_PERMANENT' })).toBe(false);
  });

  it('11. Enforces department deletion for ADMIN/SECRETARY/GENERAL_SECRETARY and church deletion solely for Platform CLOSE_CHURCHES', () => {
    expect(sim.canDeleteDepartment({ uid: secretaryA.id }, 'church-1', 'dept-jovens')).toBe(true);
    expect(sim.canDeleteDepartment({ uid: adminA.id }, 'church-1', 'dept-jovens')).toBe(true);
    expect(sim.canDeleteDepartment({ uid: secRoleA.id }, 'church-1', 'dept-jovens')).toBe(true);
    expect(sim.canDeleteDepartment({ uid: assistantSecA.id }, 'church-1', 'dept-jovens')).toBe(false);
    expect(sim.canDeleteDepartment({ uid: adminA.id }, 'church-2', 'dept-b-geral')).toBe(false);

    expect(sim.canDeleteChurch({ uid: platformRootAdmin.id }, 'church-1')).toBe(true);
    expect(sim.canDeleteChurch({ uid: platformSupportOnly.id }, 'church-1')).toBe(false);
    expect(sim.canDeleteChurch({ uid: adminA.id }, 'church-1')).toBe(false);
    expect(sim.canDeleteChurch({ uid: secretaryA.id }, 'church-1')).toBe(false);
  });

  it('12. Restricts /backups read & write solely to canManageSettingsAndBackups users within own churchId', () => {
    const validBackupC1 = {
      id: 'backup-new-c1',
      churchId: 'church-1',
      createdAt: '2026-05-10',
      checksum: 'CRC32-9999',
      dataJson: '{}',
    };

    // Allowed: GENERAL_SECRETARY, ADMIN, SECRETARY of church-1
    for (const authorized of [secretaryA, adminA, secRoleA]) {
      const a = { uid: authorized.id };
      expect(sim.canGetBackup(a, 'backup-c1')).toBe(true);
      expect(sim.canWriteBackup(a, 'backup-new-c1', validBackupC1, 'create')).toBe(true);
      expect(sim.canWriteBackup(a, 'backup-c1', { ...sim['db'].backups['backup-c1'], dataJson: '{"v":2}' }, 'update')).toBe(true);
      expect(sim.canWriteBackup(a, 'backup-c1', null, 'delete')).toBe(true);
      // Cross-tenant denied
      expect(sim.canGetBackup(a, 'backup-c2')).toBe(false);
      expect(sim.canWriteBackup(a, 'backup-x', { ...validBackupC1, id: 'backup-x', churchId: 'church-2' }, 'create')).toBe(false);
      expect(sim.canWriteBackup(a, 'backup-c1', { ...sim['db'].backups['backup-c1'], churchId: 'church-2' }, 'update')).toBe(false);
    }

    // Denied: ASSISTANT_SECRETARY, PASTOR, DEPARTMENT_LEADER, INACTIVE, Platform Staff, and flaviamara0308@gmail.com
    for (const unauthorized of [assistantSecA, pastorA, leaderA_Jovens, suspendedSecA, secretaryB, platformRootAdmin, platformSupportOnly]) {
      const a = { uid: unauthorized.id };
      expect(sim.canGetBackup(a, 'backup-c1')).toBe(false);
      expect(sim.canWriteBackup(a, 'backup-new-c1', validBackupC1, 'create')).toBe(false);
      expect(sim.canWriteBackup(a, 'backup-c1', sim['db'].backups['backup-c1'], 'update')).toBe(false);
      expect(sim.canWriteBackup(a, 'backup-c1', null, 'delete')).toBe(false);
    }

    const verifiedFlavia: AuthContext = {
      uid: 'uid-flavia-owner',
      token: { email: 'flaviamara0308@gmail.com', email_verified: true },
    };
    expect(sim.canGetBackup(verifiedFlavia, 'backup-c1')).toBe(false);
    expect(sim.canWriteBackup(verifiedFlavia, 'backup-new-c1', validBackupC1, 'create')).toBe(false);
    expect(sim.canUpdateChurch(verifiedFlavia, 'church-1', { ...churchA, status: 'ACTIVE' })).toBe(true);
  });

  it('13. Allows flaviamara0308@gmail.com to register active congregations & pre-authorize Gmail users while enforcing anti-escalation on UID claim', () => {
    const verifiedFlavia: AuthContext = {
      uid: 'uid-flavia-owner',
      token: { email: 'flaviamara0308@gmail.com', email_verified: true },
    };

    const newCongregation: Church = {
      ...churchA,
      id: 'church-new-1',
      name: 'Congregação Monte Sinai',
      exclusiveCode: 'IG-7788',
      status: 'ACTIVE',
      plan: 'FREE',
      planStatus: 'ACTIVE',
    };

    expect(sim.canCreateChurch(verifiedFlavia, 'church-new-1', newCongregation)).toBe(true);

    const preAuthSecretary: User = {
      id: 'pre-sec-1',
      churchId: 'church-1',
      name: 'Maria Secretaria',
      email: 'maria.sec@gmail.com',
      role: 'GENERAL_SECRETARY',
      status: 'PENDING_INVITE',
    };
    expect(sim.canCreateUser(verifiedFlavia, 'pre-sec-1', preAuthSecretary)).toBe(true);

    // Bootstrapped root admin updating/syncing her own PLATFORM_ADMIN profile on login
    sim['db'].users['uid-flavia-owner'] = {
      id: 'uid-flavia-owner',
      churchId: 'church-1',
      name: 'Flávia Legacy',
      email: 'flaviamara0308@gmail.com',
      role: 'MEMBER',
      status: 'PENDING_INVITE',
    };
    expect(
      sim.canUpdateUser(verifiedFlavia, 'uid-flavia-owner', {
        id: 'uid-flavia-owner',
        churchId: 'PLATFORM',
        name: 'Flávia (Admin Plataforma)',
        email: 'flaviamara0308@gmail.com',
        role: 'PLATFORM_ADMIN',
        status: 'ACTIVE',
      })
    ).toBe(true);

    // Put preAuthSecretary in simulated DB and let Flávia authorize her to ACTIVE
    sim['db'].users['pre-sec-1'] = preAuthSecretary;
    expect(sim.canUpdateUser(verifiedFlavia, 'pre-sec-1', { ...preAuthSecretary, status: 'ACTIVE' })).toBe(true);

    // Pre-authorized Gmail user claiming their Firebase Auth UID doc
    const mariaAuth: AuthContext = {
      uid: 'fb-uid-maria',
      token: { email: 'maria.sec@gmail.com', email_verified: true },
    };
    expect(
      sim.canCreateUser(mariaAuth, 'fb-uid-maria', {
        ...preAuthSecretary,
        id: 'fb-uid-maria',
        status: 'ACTIVE',
        claimedFromUserId: 'pre-sec-1',
      })
    ).toBe(true);

    // Escalation attempt during claim -> DENIED
    expect(
      sim.canCreateUser(mariaAuth, 'fb-uid-maria', {
        ...preAuthSecretary,
        id: 'fb-uid-maria',
        role: 'PLATFORM_ADMIN',
        status: 'ACTIVE',
        claimedFromUserId: 'pre-sec-1',
      })
    ).toBe(false);

    // Inactive/blocked user claiming -> DENIED
    sim['db'].users['pre-sec-1'] = { ...preAuthSecretary, status: 'INACTIVE' };
    expect(
      sim.canCreateUser(mariaAuth, 'fb-uid-maria', {
        ...preAuthSecretary,
        id: 'fb-uid-maria',
        status: 'ACTIVE',
        claimedFromUserId: 'pre-sec-1',
      })
    ).toBe(false);
  });
});
