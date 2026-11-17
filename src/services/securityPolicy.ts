import { Church, Member, Department, User, PlatformPermission } from '../types';

/**
 * Central Multi-Tenant & Role-Based Access Control (RBAC) Policy Engine
 * Mirrors the exact security invariants enforced on the backend in firestore.rules.
 */
export const SecurityPolicy = {
  isPlatformStaff(user: User | null | undefined): boolean {
    if (!user) return false;
    return (
      user.churchId === 'PLATFORM' &&
      (user.role === 'PLATFORM_ADMIN' || user.role === 'PLATFORM_ASSISTANT_ADMIN')
    );
  },

  hasPlatformPermission(user: User | null | undefined, perm: PlatformPermission): boolean {
    if (!this.isPlatformStaff(user) || !user) return false;
    if (user.role === 'PLATFORM_ADMIN') return true;
    return Array.isArray(user.platformPermissions) && user.platformPermissions.includes(perm);
  },

  /**
   * Strict tenant isolation check.
   * Ensures a church user can NEVER access or mutate data belonging to another churchId.
   */
  belongsToChurch(user: User | null | undefined, targetChurchId: string | null | undefined): boolean {
    if (!user || !targetChurchId) return false;
    if (user.status !== 'ACTIVE') return false;
    return user.churchId === targetChurchId;
  },

  /**
   * Platform staff must NEVER have automatic access to church members' personal data (PII).
   */
  canAccessMembersModule(user: User | null | undefined, churchId: string): boolean {
    if (!user || this.isPlatformStaff(user)) return false;
    if (!this.belongsToChurch(user, churchId)) return false;
    return [
      'GENERAL_SECRETARY',
      'ASSISTANT_SECRETARY',
      'PASTOR',
      'DEPARTMENT_LEADER',
      'ADMIN',
      'SECRETARY',
    ].includes(user.role);
  },

  /**
   * Full member PII (email, phone, full address, parents, spouse, notes) is restricted to General/Assistant Secretary.
   */
  canViewRestrictedMemberPII(user: User | null | undefined, churchId: string): boolean {
    if (!user || this.isPlatformStaff(user)) return false;
    if (!this.belongsToChurch(user, churchId)) return false;
    return [
      'GENERAL_SECRETARY',
      'ASSISTANT_SECRETARY',
      'ADMIN',
      'SECRETARY',
    ].includes(user.role);
  },

  canCreateOrEditMember(user: User | null | undefined, churchId: string): boolean {
    if (!user || this.isPlatformStaff(user)) return false;
    if (!this.belongsToChurch(user, churchId)) return false;
    return [
      'GENERAL_SECRETARY',
      'ASSISTANT_SECRETARY',
      'ADMIN',
      'SECRETARY',
    ].includes(user.role);
  },

  canDeleteMember(user: User | null | undefined, churchId: string): boolean {
    if (!user || this.isPlatformStaff(user)) return false;
    if (!this.belongsToChurch(user, churchId)) return false;
    return ['GENERAL_SECRETARY', 'ADMIN', 'SECRETARY'].includes(user.role);
  },

  /**
   * Filters members according to Multi-Tenant isolation AND Department Leader scope.
   */
  filterVisibleMembers(user: User | null | undefined, churchId: string, members: Member[]): Member[] {
    if (!this.canAccessMembersModule(user, churchId) || !user) return [];

    // 1. Always enforce strict churchId isolation
    const churchMembers = members.filter(m => m.churchId === churchId && m.churchId === user.churchId);

    // 2. Department Leader sees ONLY members belonging to their authorized departments
    if (user.role === 'DEPARTMENT_LEADER') {
      const allowedDeptIds = user.departmentIds || [];
      return churchMembers.filter(
        m => Array.isArray(m.departmentIds) && m.departmentIds.some(dId => allowedDeptIds.includes(dId))
      );
    }

    return churchMembers;
  },

  /**
   * Sanitizes a member object when viewed by roles without restricted PII access (Pastor, Department Leader).
   */
  sanitizeMemberForViewer(user: User | null | undefined, churchId: string, member: Member): Member {
    if (this.canViewRestrictedMemberPII(user, churchId)) {
      return member;
    }

    return {
      ...member,
      email: '•••••••• (Restrito)',
      phone: '•••••••• (Restrito)',
      spouse: undefined,
      motherName: undefined,
      fatherName: undefined,
      profession: undefined,
      educationLevel: undefined,
      notes: undefined,
      address: {
        street: 'Restrito',
        number: '',
        complement: '',
        neighborhood: 'Restrito',
        city: member.address?.city || '',
        state: member.address?.state || '',
        zipCode: '•••••-•••',
      },
    };
  },

  /**
   * Filters departments for Department Leaders vs Church-wide viewers.
   */
  filterVisibleDepartments(user: User | null | undefined, churchId: string, departments: Department[]): Department[] {
    if (!user || this.isPlatformStaff(user) || !this.belongsToChurch(user, churchId)) return [];
    const churchDepts = departments.filter(d => d.churchId === churchId);
    if (user.role === 'DEPARTMENT_LEADER') {
      const allowedDeptIds = user.departmentIds || [];
      return churchDepts.filter(d => allowedDeptIds.includes(d.id));
    }
    return churchDepts;
  },

  canManageDepartments(user: User | null | undefined, churchId: string): boolean {
    if (!user || this.isPlatformStaff(user)) return false;
    if (!this.belongsToChurch(user, churchId)) return false;
    return ['GENERAL_SECRETARY', 'ASSISTANT_SECRETARY', 'ADMIN', 'SECRETARY'].includes(user.role);
  },

  canDeleteDepartment(user: User | null | undefined, churchId: string): boolean {
    if (!user || this.isPlatformStaff(user)) return false;
    if (!this.belongsToChurch(user, churchId)) return false;
    return ['GENERAL_SECRETARY', 'ADMIN', 'SECRETARY'].includes(user.role);
  },

  canManageUsers(user: User | null | undefined, churchId: string): boolean {
    if (!user || this.isPlatformStaff(user)) return false;
    if (!this.belongsToChurch(user, churchId)) return false;
    return ['GENERAL_SECRETARY', 'ADMIN', 'SECRETARY'].includes(user.role);
  },

  canModifyTargetUser(actor: User | null | undefined, target: User, newRole?: string): { allowed: boolean; reason?: string } {
    if (!actor) return { allowed: false, reason: 'Usuário não autenticado.' };

    // Prevent self role/status escalation
    if (actor.id === target.id) {
      return { allowed: false, reason: 'Você não pode alterar suas próprias permissões ou status.' };
    }

    // Platform Admin managing other Platform Admins
    if (this.isPlatformStaff(actor)) {
      if (actor.role !== 'PLATFORM_ADMIN') {
        return { allowed: false, reason: 'Somente o Administrador Principal da Plataforma pode gerenciar administradores.' };
      }
      if (target.churchId !== 'PLATFORM') {
        return { allowed: false, reason: 'Administradores da plataforma não devem alterar contas internas de igrejas.' };
      }
      return { allowed: true };
    }

    // Church Secretary / General Admin managing own church users
    if (!this.canManageUsers(actor, target.churchId)) {
      return { allowed: false, reason: 'Acesso negado: permissão insuficiente ou tentativa de acesso a outra igreja.' };
    }

    if (newRole === 'PLATFORM_ADMIN' || newRole === 'PLATFORM_ASSISTANT_ADMIN') {
      return { allowed: false, reason: 'Usuários de igreja não podem atribuir perfis da plataforma.' };
    }

    return { allowed: true };
  },

  canExportReports(user: User | null | undefined, churchId: string): boolean {
    if (!user || this.isPlatformStaff(user)) return false;
    if (!this.belongsToChurch(user, churchId)) return false;
    return ['GENERAL_SECRETARY', 'ADMIN', 'SECRETARY'].includes(user.role);
  },

  canManageAgenda(user: User | null | undefined, churchId: string): boolean {
    if (!user || this.isPlatformStaff(user)) return false;
    if (!this.belongsToChurch(user, churchId)) return false;
    return ['GENERAL_SECRETARY', 'ADMIN', 'SECRETARY'].includes(user.role);
  },

  canOpenSupportTicket(user: User | null | undefined, churchId: string): boolean {
    if (!user || this.isPlatformStaff(user)) return false;
    if (!this.belongsToChurch(user, churchId)) return false;
    return ['GENERAL_SECRETARY', 'ADMIN', 'SECRETARY'].includes(user.role);
  },

  canManageSettingsAndBackups(user: User | null | undefined, churchId: string): boolean {
    if (!user || this.isPlatformStaff(user)) return false;
    if (!this.belongsToChurch(user, churchId)) return false;
    return ['GENERAL_SECRETARY', 'ADMIN', 'SECRETARY'].includes(user.role);
  },

  canSwitchChurchContext(user: User | null | undefined, targetChurch: Church): boolean {
    if (!user) return false;
    // Regular church users are strictly bound to their own churchId!
    return user.churchId === targetChurch.id;
  },
};
