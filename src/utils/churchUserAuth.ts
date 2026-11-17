import { sha256Hex } from './platformAdminAuth';

const CHURCH_USER_CREDS_KEY = 'sec_igreja_church_user_creds_v1';

interface StoredChurchUserCredential {
  churchId: string;
  email: string;
  passwordHash: string;
  updatedAt: string;
}

function makeCredKey(churchId: string, email: string): string {
  return `${churchId.trim()}::${email.trim().toLowerCase()}`;
}

function loadStore(): Record<string, StoredChurchUserCredential> {
  if (typeof localStorage === 'undefined') return {};
  const raw = localStorage.getItem(CHURCH_USER_CREDS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveStore(store: Record<string, StoredChurchUserCredential>): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(CHURCH_USER_CREDS_KEY, JSON.stringify(store));
}

export const ChurchUserAuthService = {
  setPassword(churchId: string, email: string, password: string): void {
    const normalizedEmail = email.trim().toLowerCase();
    if (!churchId || !normalizedEmail || !password) return;
    const store = loadStore();
    store[makeCredKey(churchId, normalizedEmail)] = {
      churchId: churchId.trim(),
      email: normalizedEmail,
      passwordHash: sha256Hex(password),
      updatedAt: new Date().toISOString(),
    };
    saveStore(store);
  },

  hasPassword(churchId: string, email: string): boolean {
    const normalizedEmail = email.trim().toLowerCase();
    if (!churchId || !normalizedEmail) return false;
    const store = loadStore();
    return Boolean(store[makeCredKey(churchId, normalizedEmail)]?.passwordHash);
  },

  verifyPassword(churchId: string, email: string, password: string): boolean {
    const normalizedEmail = email.trim().toLowerCase();
    if (!churchId || !normalizedEmail || !password) return false;
    const store = loadStore();
    const record = store[makeCredKey(churchId, normalizedEmail)];
    if (!record?.passwordHash) return false;
    return sha256Hex(password) === record.passwordHash;
  },

  removeChurchCredentials(churchId: string): void {
    if (!churchId) return;
    const store = loadStore();
    const prefix = `${churchId.trim()}::`;
    let changed = false;
    for (const key of Object.keys(store)) {
      if (key.startsWith(prefix)) {
        delete store[key];
        changed = true;
      }
    }
    if (changed) saveStore(store);
  },

  clearAllCredentials(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(CHURCH_USER_CREDS_KEY);
  },
};
