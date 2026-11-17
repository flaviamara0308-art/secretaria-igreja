export const ROOT_PLATFORM_ADMIN_EMAIL = 'flaviamara0308@gmail.com';
export const ROOT_PLATFORM_ADMIN_EMAILS = [
  'flaviamara0308@gmail.com',
  'aplicativosflavia27@gmail.com',
];
const PLATFORM_ADMIN_CRED_KEY = 'sec_igreja_platform_admin_cred_v1';

// SHA-256 hash of initial bootstrap password ('123456') — replaceable at any time in Platform Admin Panel
const DEFAULT_INITIAL_PASSWORD_HASH =
  '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92';

interface StoredPlatformCredential {
  email: string;
  passwordHash: string;
  isDefaultPassword: boolean;
  updatedAt: string;
}

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

export function sha256Hex(ascii: string): string {
  const bytes = new TextEncoder().encode(ascii);
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] = (words[i >> 2] || 0) | (bytes[i] << (24 - (i % 4) * 8));
  }
  const bitLength = bytes.length * 8;
  words[bitLength >> 5] = (words[bitLength >> 5] || 0) | (0x80 << (24 - (bitLength % 32)));
  words[(((bitLength + 64) >> 9) << 4) + 15] = bitLength;

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  const w = new Array<number>(64).fill(0);
  for (let j = 0; j < words.length; j += 16) {
    for (let i = 0; i < 16; i++) {
      w[i] = words[j + i] || 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k[i] + w[i]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }

  return hash.map(val => (val >>> 0).toString(16).padStart(8, '0')).join('');
}

function getStoredCredential(): StoredPlatformCredential {
  const fallback: StoredPlatformCredential = {
    email: ROOT_PLATFORM_ADMIN_EMAIL,
    passwordHash: DEFAULT_INITIAL_PASSWORD_HASH,
    isDefaultPassword: true,
    updatedAt: '2026-11-16T00:00:00.000Z',
  };

  if (typeof localStorage === 'undefined') return fallback;
  const raw = localStorage.getItem(PLATFORM_ADMIN_CRED_KEY);
  if (!raw) {
    localStorage.setItem(PLATFORM_ADMIN_CRED_KEY, JSON.stringify(fallback));
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as StoredPlatformCredential;
    if (!parsed?.passwordHash) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

export const PlatformAdminAuthService = {
  isRootPlatformEmail(email: string | null | undefined): boolean {
    const normalized = (email || '').trim().toLowerCase();
    return ROOT_PLATFORM_ADMIN_EMAILS.includes(normalized);
  },

  verifyLocalAdminPassword(email: string, password: string): boolean {
    if (!this.isRootPlatformEmail(email) || !password) return false;
    const cred = getStoredCredential();
    return sha256Hex(password) === cred.passwordHash;
  },

  isUsingInitialDefaultPassword(): boolean {
    return getStoredCredential().isDefaultPassword;
  },

  changeLocalAdminPassword(
    email: string,
    currentPassword: string,
    newPassword: string
  ): { ok: boolean; error?: string } {
    if (!this.isRootPlatformEmail(email)) {
      return { ok: false, error: 'Conta não corresponde ao Administrador Principal da Plataforma.' };
    }
    if (!this.verifyLocalAdminPassword(email, currentPassword)) {
      return { ok: false, error: 'Senha atual incorreta.' };
    }
    if (!newPassword || newPassword.length < 6) {
      return { ok: false, error: 'A nova senha deve ter no mínimo 6 caracteres.' };
    }
    this.syncLocalAdminPassword(email, newPassword);
    return { ok: true };
  },

  syncLocalAdminPassword(email: string, newPassword: string): void {
    if (!this.isRootPlatformEmail(email) || typeof localStorage === 'undefined') return;
    const nextHash = sha256Hex(newPassword);
    const next: StoredPlatformCredential = {
      email: ROOT_PLATFORM_ADMIN_EMAIL,
      passwordHash: nextHash,
      isDefaultPassword: nextHash === DEFAULT_INITIAL_PASSWORD_HASH,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(PLATFORM_ADMIN_CRED_KEY, JSON.stringify(next));
  },
};
