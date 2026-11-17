import { describe, it, expect, beforeEach } from 'vitest';
import { ChurchUserAuthService } from '../src/utils/churchUserAuth';
import { sanitizeForFirestore, mergeTenantRecords } from '../src/utils/dataMerge';
import { StorageService } from '../src/services/storage';
import type { Member, Department, ChurchEvent } from '../src/types';

function createMemoryStorage() {
  let store: Record<string, string> = {};
  return {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key: string, val: string) {
      store[key] = String(val);
    },
    removeItem(key: string) {
      delete store[key];
    },
    clear() {
      store = {};
    },
    key(i: number) {
      return Object.keys(store)[i] ?? null;
    },
    get length() {
      return Object.keys(store).length;
    },
  };
}

describe('Login Credentials, Firestore Sanitization & Real Data Persistence', () => {
  beforeEach(() => {
    const mem = createMemoryStorage();
    (globalThis as any).localStorage = mem;
    mem.clear();
  });

  it('stores, verifies, isolates, and cleans church user passwords without plaintext storage', () => {
    ChurchUserAuthService.setPassword('church-100', 'Secretaria@Igreja.org', 'SenhaForte123');
    ChurchUserAuthService.setPassword('church-200', 'Secretaria@Igreja.org', 'OutraSenha456');

    expect(ChurchUserAuthService.hasPassword('church-100', 'secretaria@igreja.org')).toBe(true);
    expect(ChurchUserAuthService.verifyPassword('church-100', 'secretaria@igreja.org', 'SenhaForte123')).toBe(true);
    expect(ChurchUserAuthService.verifyPassword('church-100', 'secretaria@igreja.org', 'SenhaErrada')).toBe(false);
    // Strict tenant isolation across churches with same email
    expect(ChurchUserAuthService.verifyPassword('church-100', 'secretaria@igreja.org', 'OutraSenha456')).toBe(false);
    expect(ChurchUserAuthService.verifyPassword('church-200', 'secretaria@igreja.org', 'OutraSenha456')).toBe(true);

    // Ensure raw plaintext password is never persisted in localStorage
    const rawStore = (globalThis as any).localStorage.getItem('sec_igreja_church_user_creds_v1') || '';
    expect(rawStore).not.toContain('SenhaForte123');
    expect(rawStore).not.toContain('OutraSenha456');

    ChurchUserAuthService.removeChurchCredentials('church-100');
    expect(ChurchUserAuthService.hasPassword('church-100', 'secretaria@igreja.org')).toBe(false);
    expect(ChurchUserAuthService.hasPassword('church-200', 'secretaria@igreja.org')).toBe(true);
  });

  it('strips undefined values recursively for Firestore payloads while preserving falsy primitives', () => {
    const dirtyPayload = {
      id: 'church-1',
      name: 'Igreja Real',
      logoUrl: undefined,
      ownerUid: undefined,
      cnpj: '',
      count: 0,
      active: false,
      notes: null,
      offlineConfig: {
        maxOfflineDays: 7,
        autoBackupDaily: true,
        lastAutoBackupAt: undefined,
      },
      tags: ['oficial', undefined, 'sede'],
    };

    const sanitized = sanitizeForFirestore(dirtyPayload);

    expect('logoUrl' in sanitized).toBe(false);
    expect('ownerUid' in sanitized).toBe(false);
    expect('lastAutoBackupAt' in sanitized.offlineConfig).toBe(false);
    expect(sanitized.cnpj).toBe('');
    expect(sanitized.count).toBe(0);
    expect(sanitized.active).toBe(false);
    expect(sanitized.notes).toBeNull();
    expect(sanitized.tags).toEqual(['oficial', 'sede']);
  });

  it('merges local unsynced records and remote Firestore records without losing local saves or resurrecting deletions', () => {
    const merged = mergeTenantRecords({
      localRecords: [
        { id: 'rec-local-only', name: 'Membro Novo Local', updatedAt: '2026-11-16T10:00:00.000Z' },
        { id: 'rec-pending-edit', name: 'Nome Editado Offline', updatedAt: '2026-11-16T09:00:00.000Z' },
        { id: 'rec-remote-newer', name: 'Versão Antiga Local', updatedAt: '2026-11-16T08:00:00.000Z' },
      ],
      remoteRecords: [
        { id: 'rec-pending-edit', name: 'Nome Antigo Nuvem', updatedAt: '2026-11-16T11:00:00.000Z' },
        { id: 'rec-remote-newer', name: 'Versão Atualizada Nuvem', updatedAt: '2026-11-16T12:00:00.000Z' },
        { id: 'rec-pending-delete', name: 'Membro Excluído Offline', updatedAt: '2026-11-16T07:00:00.000Z' },
      ],
      pendingQueueItems: [
        { entityId: 'rec-pending-edit', operation: 'UPDATE', timestamp: 1700000000000 },
        { entityId: 'rec-pending-delete', operation: 'DELETE', timestamp: 1700000005000 },
      ],
    });

    expect(merged.map(r => r.id).sort()).toEqual([
      'rec-local-only',
      'rec-pending-edit',
      'rec-remote-newer',
    ]);
    expect(merged.find(r => r.id === 'rec-local-only')?.name).toBe('Membro Novo Local');
    expect(merged.find(r => r.id === 'rec-pending-edit')?.name).toBe('Nome Editado Offline');
    expect(merged.find(r => r.id === 'rec-remote-newer')?.name).toBe('Versão Atualizada Nuvem');
    expect(merged.find(r => r.id === 'rec-pending-delete')).toBeUndefined();
  });

  it('persists and deletes members, departments, and events in StorageService without cross-church leakage', () => {
    const mA1: Member = {
      id: 'm-a1',
      churchId: 'church-a',
      fullName: 'Carlos Silva',
      memberCode: 'MEM-001',
      phone: '11999990001',
      email: 'carlos@a.org',
      membershipDate: '2024-01-10',
      departmentIds: [],
      status: 'ACTIVE',
      address: { street: '', number: '', neighborhood: '', city: '', state: '', zipCode: '' },
    };
    const mB1: Member = {
      ...mA1,
      id: 'm-b1',
      churchId: 'church-b',
      fullName: 'Marcos Oliveira',
      email: 'marcos@b.org',
    };

    StorageService.saveMember(mA1);
    StorageService.saveMember(mB1);
    expect(StorageService.getMembers('church-a')).toHaveLength(1);
    expect(StorageService.getMembers('church-b')).toHaveLength(1);

    StorageService.deleteMember('church-a', 'm-a1');
    expect(StorageService.getMembers('church-a')).toHaveLength(0);
    expect(StorageService.getMembers('church-b')).toHaveLength(1);

    const deptA: Department = {
      id: 'dept-a1',
      churchId: 'church-a',
      name: 'Louvor',
      description: 'Ministério de Louvor',
      leaderId: 'l-1',
      leaderName: 'Ana',
      memberCount: 5,
      status: 'ACTIVE',
      createdAt: '2026-11-16',
    };
    const evA: ChurchEvent = {
      id: 'ev-a1',
      churchId: 'church-a',
      title: 'Culto de Oração',
      description: 'Culto semanal',
      startDate: '2026-11-20T19:30',
      endDate: '2026-11-20T21:00',
      location: 'Templo Principal',
      category: 'CULT',
      organizer: 'Secretaria',
      status: 'SCHEDULED',
    };

    StorageService.replaceChurchDepartments('church-a', [deptA]);
    StorageService.replaceChurchEvents('church-a', [evA]);

    expect(StorageService.getDepartments('church-a')).toHaveLength(1);
    expect(StorageService.getEvents('church-a')).toHaveLength(1);

    StorageService.deleteEvent('church-a', 'ev-a1');
    expect(StorageService.getEvents('church-a')).toHaveLength(0);
  });
});
