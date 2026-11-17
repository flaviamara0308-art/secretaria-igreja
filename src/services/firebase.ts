import { initializeApp, deleteApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signOut,
  onAuthStateChanged,
  updatePassword,
  sendEmailVerification,
  EmailAuthProvider,
  linkWithCredential,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  getAdditionalUserInfo,
  User as FirebaseUser 
} from 'firebase/auth';
import { getFirestore, doc, getDoc, getDocFromServer, collection, getDocs, setDoc, updateDoc, deleteDoc, query, where, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import { Church, Member, User, AuditLog, BackupRecord, PaymentProof, SupportTicket, PlatformPaymentSettings, Department, ChurchEvent } from '../types';
import { sanitizeForFirestore } from '../utils/dataMerge';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || 'ai-studio-secretariadaigre-a57dacac-71b7-420f-972a-87c36548d486');
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(err => console.warn('Auth persistence init warning:', err));
export const storage = getStorage(app);

// Standard Firebase Google Sign-In (basic identity only — prevents 403 access_denied from restricted Workspace scopes during login)
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Dedicated Workspace Provider requested only on-demand inside Settings for Google Drive backups & Gmail
export const workspaceGoogleProvider = new GoogleAuthProvider();
workspaceGoogleProvider.addScope('email');
workspaceGoogleProvider.addScope('profile');
workspaceGoogleProvider.addScope('https://www.googleapis.com/auth/drive.file');
workspaceGoogleProvider.addScope('https://www.googleapis.com/auth/drive');
workspaceGoogleProvider.addScope('https://www.googleapis.com/auth/gmail.send');
workspaceGoogleProvider.setCustomParameters({ prompt: 'consent select_account' });

// In-memory cache for Google Workspace OAuth Access Token (Drive / Gmail only) & resolved identity email
let cachedGoogleAccessToken: string | null = null;
let cachedGoogleIdentityEmail: { uid: string; email: string } | null = null;

export interface FirebaseAuthLogEntry {
  timestamp: string;
  operation: 'SIGN_IN' | 'REGISTER' | 'RESET_PASSWORD' | 'UPDATE_PASSWORD' | 'GOOGLE_SIGN_IN' | 'GOOGLE_WORKSPACE_CONNECT' | 'LINK_CREDENTIAL';
  uid?: string;
  email?: string;
  status: 'SUCCESS' | 'ERROR';
  errorCode?: string;
  errorMessage?: string;
  friendlyMessage?: string;
  technicalDetails?: any;
}

const authErrorLogs: FirebaseAuthLogEntry[] = [];

function recordAuthLog(entry: FirebaseAuthLogEntry) {
  authErrorLogs.unshift(entry);
  if (authErrorLogs.length > 50) authErrorLogs.pop();
  
  const targetUid = '4QauQOaV6WcFBrujjDogek4Sbvn2';
  const isTarget = entry.uid === targetUid || auth.currentUser?.uid === targetUid;
  const tag = isTarget ? `[FirebaseAuthService:TARGET_UID_4QauQOaV6WcFBrujjDogek4Sbvn2]` : `[FirebaseAuthService]`;

  if (entry.status === 'ERROR') {
    if (entry.errorCode === 'auth/operation-not-allowed') {
      console.warn(`${tag}[${entry.operation}:SKIP_PROVIDER_DISABLED]`, {
        code: entry.errorCode,
        email: entry.email,
        uid: entry.uid || auth.currentUser?.uid,
        timestamp: entry.timestamp,
      });
    } else {
      console.error(`${tag}[${entry.operation}:FALHA]`, {
        code: entry.errorCode,
        message: entry.errorMessage,
        friendly: entry.friendlyMessage,
        email: entry.email,
        uid: entry.uid || auth.currentUser?.uid,
        timestamp: entry.timestamp,
        details: entry.technicalDetails,
      });
    }
  } else {
    console.info(`${tag}[${entry.operation}:SUCESSO]`, {
      email: entry.email,
      uid: entry.uid || auth.currentUser?.uid,
      timestamp: entry.timestamp,
    });
  }
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    // Expected if rules block unauthenticated test/connection reads or client is offline
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase Firestore client appears offline.');
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function ensureAuthenticatedForWrite(): boolean {
  return Boolean(auth.currentUser);
}

export const FirebaseAuthService = {
  onAuthChanged(callback: (user: FirebaseUser | null) => void) {
    return onAuthStateChanged(auth, (user) => {
      if (!user) {
        cachedGoogleAccessToken = null;
        cachedGoogleIdentityEmail = null;
      }
      callback(user);
    });
  },

  resolveUserEmail(fbUser: FirebaseUser | null | undefined): string {
    if (!fbUser) return '';
    const direct =
      fbUser.email ||
      fbUser.providerData?.find(p => Boolean(p?.email))?.email ||
      (cachedGoogleIdentityEmail?.uid === fbUser.uid ? cachedGoogleIdentityEmail.email : '');
    if (direct) return direct.trim();
    try {
      if (typeof sessionStorage !== 'undefined') {
        const stored = sessionStorage.getItem(`sec_igreja_google_email_${fbUser.uid}`);
        if (stored) return stored.trim();
      }
    } catch {
      // Ignore storage access errors
    }
    return '';
  },

  async signInWithEmail(email: string, password: string, rememberMe: boolean): Promise<FirebaseUser> {
    const normalized = email.trim().toLowerCase();
    try {
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      const cred = await signInWithEmailAndPassword(auth, normalized, password);
      recordAuthLog({
        timestamp: new Date().toISOString(),
        operation: 'SIGN_IN',
        uid: cred.user.uid,
        email: normalized,
        status: 'SUCCESS',
      });
      return cred.user;
    } catch (err: any) {
      const friendly = this.getFriendlyAuthError(err);
      recordAuthLog({
        timestamp: new Date().toISOString(),
        operation: 'SIGN_IN',
        email: normalized,
        status: 'ERROR',
        errorCode: err?.code || 'auth/unknown',
        errorMessage: err?.message || String(err),
        friendlyMessage: friendly,
        technicalDetails: err,
      });
      throw err;
    }
  },

  async registerWithEmail(email: string, password: string, rememberMe: boolean): Promise<FirebaseUser> {
    const normalized = email.trim().toLowerCase();
    try {
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      const cred = await createUserWithEmailAndPassword(auth, normalized, password);
      recordAuthLog({
        timestamp: new Date().toISOString(),
        operation: 'REGISTER',
        uid: cred.user.uid,
        email: normalized,
        status: 'SUCCESS',
      });
      return cred.user;
    } catch (err: any) {
      const friendly = this.getFriendlyAuthError(err);
      recordAuthLog({
        timestamp: new Date().toISOString(),
        operation: 'REGISTER',
        email: normalized,
        status: 'ERROR',
        errorCode: err?.code || 'auth/unknown',
        errorMessage: err?.message || String(err),
        friendlyMessage: friendly,
        technicalDetails: err,
      });
      throw err;
    }
  },

  async provisionUserWithEmail(
    email: string,
    password: string
  ): Promise<{ uid?: string; errorCode?: string; errorMessage?: string; alreadyExists?: boolean }> {
    const normalized = email.trim().toLowerCase();
    const secondaryApp = initializeApp(firebaseConfig, `provision-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const secondaryAuth = getAuth(secondaryApp);
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, normalized, password);
      recordAuthLog({
        timestamp: new Date().toISOString(),
        operation: 'REGISTER',
        uid: cred.user.uid,
        email: normalized,
        status: 'SUCCESS',
      });
      return { uid: cred.user.uid };
    } catch (err: any) {
      const friendly = this.getFriendlyAuthError(err);
      recordAuthLog({
        timestamp: new Date().toISOString(),
        operation: 'REGISTER',
        email: normalized,
        status: 'ERROR',
        errorCode: err?.code || 'auth/unknown',
        errorMessage: err?.message || String(err),
        friendlyMessage: friendly,
        technicalDetails: err,
      });
      return {
        errorCode: err?.code || 'auth/unknown',
        errorMessage: friendly,
        alreadyExists: err?.code === 'auth/email-already-in-use',
      };
    } finally {
      await signOut(secondaryAuth).catch(() => {});
      await deleteApp(secondaryApp).catch(() => {});
    }
  },

  async signInWithGoogle(rememberMe: boolean = true): Promise<FirebaseUser> {
    try {
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      googleProvider.setCustomParameters({ prompt: 'select_account' });
      const cred = await signInWithPopup(auth, googleProvider);
      // Clear any prior Workspace token since basic login only requests identity scopes
      cachedGoogleAccessToken = null;

      const additionalInfo = getAdditionalUserInfo(cred);
      const profileEmail =
        typeof additionalInfo?.profile?.email === 'string'
          ? additionalInfo.profile.email
          : '';
      let resolvedEmail =
        cred.user.email ||
        cred.user.providerData?.find(p => Boolean(p?.email))?.email ||
        profileEmail ||
        '';

      if (!resolvedEmail) {
        const oauthCred = GoogleAuthProvider.credentialFromResult(cred);
        if (oauthCred?.accessToken) {
          try {
            const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${oauthCred.accessToken}` },
            });
            if (resp.ok) {
              const profile = (await resp.json()) as { email?: string };
              if (profile?.email) {
                resolvedEmail = profile.email;
              }
            }
          } catch {
            // Non-blocking fallback
          }
        }
      }

      if (resolvedEmail) {
        const cleanEmail = resolvedEmail.trim();
        cachedGoogleIdentityEmail = { uid: cred.user.uid, email: cleanEmail };
        try {
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(`sec_igreja_google_email_${cred.user.uid}`, cleanEmail);
          }
        } catch {
          // Ignore storage access errors
        }
      }

      recordAuthLog({
        timestamp: new Date().toISOString(),
        operation: 'GOOGLE_SIGN_IN',
        uid: cred.user.uid,
        email: resolvedEmail || undefined,
        status: 'SUCCESS',
      });
      return cred.user;
    } catch (err: any) {
      const friendly = this.getFriendlyAuthError(err);
      recordAuthLog({
        timestamp: new Date().toISOString(),
        operation: 'GOOGLE_SIGN_IN',
        status: 'ERROR',
        errorCode: err?.code || 'auth/unknown',
        errorMessage: err?.message || String(err),
        friendlyMessage: friendly,
        technicalDetails: err,
      });
      throw err;
    }
  },

  async connectGoogleWorkspace(rememberMe: boolean = true): Promise<FirebaseUser> {
    try {
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      workspaceGoogleProvider.setCustomParameters({ prompt: 'consent select_account' });
      const hasGoogleLinked = Boolean(
        auth.currentUser?.providerData?.some(p => p.providerId === 'google.com')
      );
      const cred =
        auth.currentUser && hasGoogleLinked
          ? await reauthenticateWithPopup(auth.currentUser, workspaceGoogleProvider)
          : await signInWithPopup(auth, workspaceGoogleProvider);

      const oauthCred = GoogleAuthProvider.credentialFromResult(cred);
      if (oauthCred?.accessToken) {
        cachedGoogleAccessToken = oauthCred.accessToken;
      }

      recordAuthLog({
        timestamp: new Date().toISOString(),
        operation: 'GOOGLE_WORKSPACE_CONNECT',
        uid: cred.user.uid,
        email: cred.user.email || undefined,
        status: 'SUCCESS',
      });
      return cred.user;
    } catch (err: any) {
      const friendly = this.getFriendlyAuthError(err);
      recordAuthLog({
        timestamp: new Date().toISOString(),
        operation: 'GOOGLE_WORKSPACE_CONNECT',
        uid: auth.currentUser?.uid,
        email: auth.currentUser?.email || undefined,
        status: 'ERROR',
        errorCode: err?.code || 'auth/unknown',
        errorMessage: err?.message || String(err),
        friendlyMessage: friendly,
        technicalDetails: err,
      });
      throw err;
    }
  },

  async resetPassword(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    try {
      await sendPasswordResetEmail(auth, normalized);
      recordAuthLog({
        timestamp: new Date().toISOString(),
        operation: 'RESET_PASSWORD',
        email: normalized,
        uid: auth.currentUser?.uid,
        status: 'SUCCESS',
      });
    } catch (err: any) {
      const friendly = this.getFriendlyAuthError(err);
      recordAuthLog({
        timestamp: new Date().toISOString(),
        operation: 'RESET_PASSWORD',
        email: normalized,
        uid: auth.currentUser?.uid,
        status: 'ERROR',
        errorCode: err?.code || 'auth/unknown',
        errorMessage: err?.message || String(err),
        friendlyMessage: friendly,
        technicalDetails: err,
      });
      throw err;
    }
  },

  async sendVerificationEmail(): Promise<void> {
    if (auth.currentUser && !auth.currentUser.emailVerified) {
      await sendEmailVerification(auth.currentUser);
    }
  },

  async linkOrUpdateEmailPassword(
    email: string,
    newPassword: string,
    currentPassword?: string
  ): Promise<void> {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('Nenhum usuário autenticado no Firebase.');
    }
    const normalized = email.trim().toLowerCase();

    try {
      const hasPasswordProvider = user.providerData.some(p => p.providerId === 'password');
      if (hasPasswordProvider) {
        if (currentPassword) {
          try {
            const cred = EmailAuthProvider.credential(normalized, currentPassword);
            await reauthenticateWithCredential(user, cred);
          } catch (reauthErr) {
            console.warn('Reautenticação opcional falhou:', reauthErr);
          }
        }
        await updatePassword(user, newPassword);
      } else {
        const cred = EmailAuthProvider.credential(normalized, newPassword);
        await linkWithCredential(user, cred);
      }

      recordAuthLog({
        timestamp: new Date().toISOString(),
        operation: 'UPDATE_PASSWORD',
        uid: user.uid,
        email: normalized,
        status: 'SUCCESS',
      });
    } catch (err: any) {
      const friendly = this.getFriendlyAuthError(err);
      recordAuthLog({
        timestamp: new Date().toISOString(),
        operation: 'UPDATE_PASSWORD',
        uid: user.uid,
        email: normalized,
        status: 'ERROR',
        errorCode: err?.code || 'auth/unknown',
        errorMessage: err?.message || String(err),
        friendlyMessage: friendly,
        technicalDetails: err,
      });
      throw err;
    }
  },

  async signOut(): Promise<void> {
    const uid = auth.currentUser?.uid;
    cachedGoogleAccessToken = null;
    cachedGoogleIdentityEmail = null;
    try {
      if (uid && typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(`sec_igreja_google_email_${uid}`);
      }
    } catch {
      // Ignore storage access errors
    }
    if (auth.currentUser) {
      await signOut(auth);
    }
  },

  getGoogleAccessToken(): string | null {
    return cachedGoogleAccessToken;
  },

  setGoogleAccessToken(token: string | null) {
    cachedGoogleAccessToken = token;
  },

  getAuthLogs(): FirebaseAuthLogEntry[] {
    return [...authErrorLogs];
  },

  getLastError(): FirebaseAuthLogEntry | null {
    return authErrorLogs.find(l => l.status === 'ERROR') || null;
  },

  clearAuthLogs(): void {
    authErrorLogs.length = 0;
  },

  getFriendlyAuthError(error: any): string {
    const code = error?.code || '';
    const rawMsg = String(error?.message || '').toLowerCase();
    let serialized = '';
    try {
      serialized = JSON.stringify(error || '').toLowerCase();
    } catch {
      serialized = '';
    }

    if (
      rawMsg.includes('access_denied') ||
      rawMsg.includes('403') ||
      serialized.includes('access_denied') ||
      code === 'auth/oauth-access-denied'
    ) {
      return 'Acesso negado pelo Google OAuth (Erro 403: access_denied). No Google Cloud Console (APIs e Serviços > Tela de permissão OAuth > Público-alvo), adicione este e-mail em "Usuários de teste" ou publique o aplicativo para produção.';
    }

    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Não foi possível validar suas credenciais. Tente entrar novamente com sua Conta Google.';
      case 'auth/email-already-in-use':
        return 'Este e-mail já possui uma conta cadastrada no Firebase.';
      case 'auth/operation-not-allowed':
        return 'O provedor E-mail/Senha não está ativado no Console do Firebase. Utilize a entrada direta com Conta Google.';
      case 'auth/requires-recent-login':
        return 'Por segurança, esta operação exige login recente. Saia e entre novamente no sistema.';
      case 'auth/weak-password':
        return 'A senha deve ter pelo menos 6 caracteres.';
      case 'auth/too-many-requests':
        return 'Muitas tentativas consecutivas. Aguarde alguns instantes antes de tentar novamente.';
      case 'auth/network-request-failed':
        return 'Sem conexão com os servidores do Firebase. Verifique sua conexão com a internet.';
      case 'auth/unauthorized-domain':
        return 'Domínio não autorizado no Firebase Authentication (Authentication > Settings > Authorized domains).';
      case 'auth/popup-blocked':
        return 'A janela pop-up do Google foi bloqueada pelo navegador. Permita pop-ups para este site e tente novamente.';
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
        return 'A janela de autenticação Google foi fechada antes de concluir o login.';
      case 'auth/user-mismatch':
        return 'Selecione a mesma Conta Google utilizada para entrar no aplicativo.';
      case 'auth/account-exists-with-different-credential':
        return 'Este e-mail já existe com outro método de login no Firebase. Entre pelo provedor Google ou vincule a conta.';
      case 'auth/internal-error':
        return 'Erro interno no fluxo de autenticação Google. Verifique se o domínio está autorizado no Firebase Authentication e se a Tela de permissão OAuth do Google Cloud permite este e-mail.';
      case 'auth/credential-already-in-use':
        return 'Esta credencial já está associada a outra conta de usuário.';
      default:
        return error?.message || 'Não foi possível concluir a autenticação no Firebase.';
    }
  },
};

export const FirebaseService = {
  getConnectionInfo() {
    return {
      projectId: firebaseConfig.projectId,
      firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
      authDomain: firebaseConfig.authDomain,
    };
  },
  async getChurchById(churchId: string): Promise<Church | null> {
    if (!auth.currentUser || !churchId) return null;
    const path = `churches/${churchId}`;
    try {
      const snap = await getDoc(doc(db, 'churches', churchId));
      return snap.exists() ? (snap.data() as Church) : null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
      return null;
    }
  },

  async getChurches(churchIdFilter?: string): Promise<Church[]> {
    // Prevent unauthenticated list calls against Firestore when in local/demo mode
    if (!auth.currentUser) return [];
    const path = 'churches';
    try {
      const q = churchIdFilter
        ? query(collection(db, path), where('id', '==', churchIdFilter))
        : collection(db, path);
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => d.data() as Church);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
      return [];
    }
  },

  async saveChurch(church: Church): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `churches/${church.id}`;
    try {
      await setDoc(doc(db, 'churches', church.id), sanitizeForFirestore({
        ...church,
        updatedAt: new Date().toISOString(),
      }));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async updateChurchFields(churchId: string, fields: Partial<Church>): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `churches/${churchId}`;
    try {
      await updateDoc(doc(db, 'churches', churchId), sanitizeForFirestore({
        ...fields,
        updatedAt: new Date().toISOString(),
      }));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async deleteChurchCascade(churchId: string, currentAdminUid?: string): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }

    // Remove non-PII church subcollections (never query /members or /backups as Platform Staff)
    try {
      const deptsSnap = await getDocs(collection(db, 'churches', churchId, 'departments'));
      for (const d of deptsSnap.docs) {
        await deleteDoc(d.ref);
      }
    } catch (err) {
      console.warn(`Falha parcial ao limpar departamentos da igreja ${churchId}:`, err);
    }

    try {
      const eventsSnap = await getDocs(collection(db, 'churches', churchId, 'events'));
      for (const d of eventsSnap.docs) {
        await deleteDoc(d.ref);
      }
    } catch (err) {
      console.warn(`Falha parcial ao limpar eventos da igreja ${churchId}:`, err);
    }

    try {
      const usersSnap = await getDocs(query(collection(db, 'users'), where('churchId', '==', churchId)));
      for (const d of usersSnap.docs) {
        const data = d.data() as User;
        const emailLower = (data.email || '').toLowerCase();
        if (
          d.id !== currentAdminUid &&
          d.id !== auth.currentUser?.uid &&
          emailLower !== 'flaviamara0308@gmail.com' &&
          emailLower !== 'aplicativosflavia27@gmail.com'
        ) {
          await deleteDoc(d.ref);
        }
      }
    } catch (err) {
      console.warn(`Falha parcial ao limpar usuários da igreja ${churchId}:`, err);
    }

    try {
      const proofsSnap = await getDocs(query(collection(db, 'paymentProofs'), where('churchId', '==', churchId)));
      for (const d of proofsSnap.docs) {
        await deleteDoc(d.ref);
      }
    } catch (err) {
      console.warn(`Falha parcial ao limpar comprovantes da igreja ${churchId}:`, err);
    }

    try {
      const ticketsSnap = await getDocs(query(collection(db, 'tickets'), where('churchId', '==', churchId)));
      for (const d of ticketsSnap.docs) {
        await deleteDoc(d.ref);
      }
    } catch (err) {
      console.warn(`Falha parcial ao limpar chamados da igreja ${churchId}:`, err);
    }

    await this.deleteChurch(churchId);
  },

  async resetAllDataForOfficialLaunch(currentAdminUid?: string): Promise<{
    deletedChurches: number;
    deletedUsers: number;
    deletedProofs: number;
    deletedTickets: number;
  }> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }

    let deletedChurches = 0;
    let deletedUsers = 0;
    let deletedProofs = 0;
    let deletedTickets = 0;

    const allChurches = await this.getChurches();
    for (const c of allChurches) {
      await this.deleteChurchCascade(c.id, currentAdminUid);
      deletedChurches++;
    }

    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      for (const d of usersSnap.docs) {
        const u = d.data() as User;
        const emailLower = (u.email || '').toLowerCase();
        const isRootFlavia =
          emailLower === 'flaviamara0308@gmail.com' ||
          emailLower === 'aplicativosflavia27@gmail.com' ||
          u.role === 'PLATFORM_ADMIN';
        if (
          d.id !== currentAdminUid &&
          d.id !== auth.currentUser?.uid &&
          u.churchId !== 'PLATFORM' &&
          !isRootFlavia
        ) {
          await deleteDoc(d.ref);
          deletedUsers++;
        }
      }
    } catch (err) {
      console.warn('Erro ao limpar usuários restantes na nuvem:', err);
    }

    try {
      const proofsSnap = await getDocs(collection(db, 'paymentProofs'));
      for (const d of proofsSnap.docs) {
        await deleteDoc(d.ref);
        deletedProofs++;
      }
    } catch (err) {
      console.warn('Erro ao limpar comprovantes restantes na nuvem:', err);
    }

    try {
      const ticketsSnap = await getDocs(collection(db, 'tickets'));
      for (const d of ticketsSnap.docs) {
        await deleteDoc(d.ref);
        deletedTickets++;
      }
    } catch (err) {
      console.warn('Erro ao limpar chamados restantes na nuvem:', err);
    }

    return { deletedChurches, deletedUsers, deletedProofs, deletedTickets };
  },

  async deleteChurch(churchId: string): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `churches/${churchId}`;
    try {
      await deleteDoc(doc(db, 'churches', churchId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  async getUserById(userId: string): Promise<User | null> {
    if (!auth.currentUser || !userId) return null;
    const path = `users/${userId}`;
    try {
      const snap = await getDoc(doc(db, 'users', userId));
      return snap.exists() ? (snap.data() as User) : null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
      return null;
    }
  },

  async getUserByEmail(email: string): Promise<User | null> {
    if (!auth.currentUser || !email || !auth.currentUser.email) return null;
    const normalized = email.trim().toLowerCase();
    const path = 'users';
    try {
      const q = query(collection(db, path), where('email', '==', normalized));
      const snap = await getDocs(q);
      if (snap.empty) return null;
      return snap.docs[0].data() as User;
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
      return null;
    }
  },

  async getUsers(churchId?: string): Promise<User[]> {
    if (!auth.currentUser) return [];
    const path = 'users';
    try {
      const q = churchId ? query(collection(db, path), where('churchId', '==', churchId)) : collection(db, path);
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => d.data() as User);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
      return [];
    }
  },

  async saveUser(user: User): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `users/${user.id}`;
    try {
      await setDoc(doc(db, 'users', user.id), sanitizeForFirestore(user));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async updateUserName(userId: string, name: string): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `users/${userId}`;
    try {
      await updateDoc(doc(db, 'users', userId), sanitizeForFirestore({ name }));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async deleteUser(userId: string): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `users/${userId}`;
    try {
      await deleteDoc(doc(db, 'users', userId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  async getMembers(churchId: string, departmentIdsFilter?: string[]): Promise<Member[]> {
    if (!auth.currentUser || !churchId) return [];
    const path = `churches/${churchId}/members`;
    try {
      // Department Leaders MUST constrain query by departmentIds to satisfy Firestore rules
      const q =
        Array.isArray(departmentIdsFilter) && departmentIdsFilter.length > 0
          ? query(collection(db, path), where('departmentIds', 'array-contains-any', departmentIdsFilter.slice(0, 10)))
          : collection(db, path);
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => d.data() as Member);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
      return [];
    }
  },

  async saveMember(member: Member): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `churches/${member.churchId}/members/${member.id}`;
    try {
      await setDoc(doc(db, 'churches', member.churchId, 'members', member.id), sanitizeForFirestore({
        ...member,
        updatedAt: member.updatedAt || new Date().toISOString(),
      }));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async deleteMember(churchId: string, memberId: string): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `churches/${churchId}/members/${memberId}`;
    try {
      await deleteDoc(doc(db, 'churches', churchId, 'members', memberId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  async getDepartments(churchId: string, departmentIdsFilter?: string[]): Promise<Department[]> {
    if (!auth.currentUser || !churchId) return [];
    const path = `churches/${churchId}/departments`;
    try {
      const q =
        Array.isArray(departmentIdsFilter) && departmentIdsFilter.length > 0
          ? query(collection(db, path), where('id', 'in', departmentIdsFilter.slice(0, 10)))
          : collection(db, path);
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => d.data() as Department);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
      return [];
    }
  },

  async saveDepartment(dept: Department): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `churches/${dept.churchId}/departments/${dept.id}`;
    try {
      await setDoc(doc(db, 'churches', dept.churchId, 'departments', dept.id), sanitizeForFirestore({
        ...dept,
        updatedAt: dept.updatedAt || new Date().toISOString(),
      }));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async deleteDepartment(churchId: string, deptId: string): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `churches/${churchId}/departments/${deptId}`;
    try {
      await deleteDoc(doc(db, 'churches', churchId, 'departments', deptId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  async getEvents(churchId: string): Promise<ChurchEvent[]> {
    if (!auth.currentUser || !churchId) return [];
    const path = `churches/${churchId}/events`;
    try {
      const snapshot = await getDocs(collection(db, path));
      return snapshot.docs.map(d => d.data() as ChurchEvent);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
      return [];
    }
  },

  async saveEvent(event: ChurchEvent): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `churches/${event.churchId}/events/${event.id}`;
    try {
      await setDoc(doc(db, 'churches', event.churchId, 'events', event.id), sanitizeForFirestore({
        ...event,
        updatedAt: event.updatedAt || new Date().toISOString(),
      }));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async deleteEvent(churchId: string, eventId: string): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `churches/${churchId}/events/${eventId}`;
    try {
      await deleteDoc(doc(db, 'churches', churchId, 'events', eventId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  // Audit Logs (Firestore collection: auditLogs)
  async saveAuditLog(log: AuditLog): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `auditLogs/${log.id}`;
    try {
      await setDoc(doc(db, 'auditLogs', log.id), sanitizeForFirestore({
        ...log,
        timestamp: log.timestamp || Date.now(),
        date: log.date || new Date().toISOString(),
      }));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async getAuditLogs(churchId: string): Promise<AuditLog[]> {
    if (!auth.currentUser || !churchId) return [];
    const path = 'auditLogs';
    try {
      const q = query(
        collection(db, path),
        where('churchId', '==', churchId)
      );
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map(d => d.data() as AuditLog);
      return list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
      return [];
    }
  },

  // Backups
  async saveBackup(backup: BackupRecord): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `backups/${backup.id}`;
    try {
      await setDoc(doc(db, 'backups', backup.id), sanitizeForFirestore(backup));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async getBackups(churchId: string): Promise<BackupRecord[]> {
    if (!auth.currentUser || !churchId) return [];
    const path = 'backups';
    try {
      const q = query(
        collection(db, path),
        where('churchId', '==', churchId)
      );
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map(d => d.data() as BackupRecord);
      return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
      return [];
    }
  },

  async deleteBackup(backupId: string): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `backups/${backupId}`;
    try {
      await deleteDoc(doc(db, 'backups', backupId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  async uploadLogo(file: File, churchId: string): Promise<string> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const ext = file.name.split('.').pop() || 'png';
    const storageRef = ref(storage, `churches/${churchId}/logo_${Date.now()}.${ext}`);
    await uploadBytes(storageRef, file, { contentType: file.type || 'image/png' });
    return await getDownloadURL(storageRef);
  },

  async uploadMemberPhoto(file: File, churchId: string, memberId: string): Promise<string> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const ext = file.name.split('.').pop() || 'jpg';
    const storageRef = ref(storage, `churches/${churchId}/members/${memberId}_${Date.now()}.${ext}`);
    await uploadBytes(storageRef, file, { contentType: file.type || 'image/jpeg' });
    return await getDownloadURL(storageRef);
  },

  // Payment Proofs
  async savePaymentProof(proof: PaymentProof): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `paymentProofs/${proof.id}`;
    try {
      await setDoc(doc(db, 'paymentProofs', proof.id), sanitizeForFirestore(proof));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async getPaymentProofs(churchId?: string): Promise<PaymentProof[]> {
    if (!auth.currentUser) return [];
    const path = 'paymentProofs';
    try {
      const q = churchId 
        ? query(collection(db, path), where('churchId', '==', churchId))
        : collection(db, path);
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map(d => d.data() as PaymentProof);
      return list.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
      return [];
    }
  },

  async deletePaymentProof(proofId: string): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `paymentProofs/${proofId}`;
    try {
      await deleteDoc(doc(db, 'paymentProofs', proofId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  // Support Tickets
  async saveSupportTicket(ticket: SupportTicket): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `tickets/${ticket.id}`;
    try {
      await setDoc(doc(db, 'tickets', ticket.id), sanitizeForFirestore(ticket));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async getSupportTickets(churchId?: string): Promise<SupportTicket[]> {
    if (!auth.currentUser) return [];
    const path = 'tickets';
    try {
      const q = churchId 
        ? query(collection(db, path), where('churchId', '==', churchId))
        : collection(db, path);
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map(d => d.data() as SupportTicket);
      return list.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
      return [];
    }
  },

  async deleteSupportTicket(ticketId: string): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = `tickets/${ticketId}`;
    try {
      await deleteDoc(doc(db, 'tickets', ticketId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  // Platform Payment Settings
  async savePlatformPaymentSettings(settings: PlatformPaymentSettings): Promise<void> {
    if (!ensureAuthenticatedForWrite()) {
      throw new Error('FIREBASE_AUTH_REQUIRED');
    }
    const path = 'platformSettings/payment';
    try {
      await setDoc(doc(db, 'platformSettings', 'payment'), sanitizeForFirestore(settings));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async getPlatformPaymentSettings(): Promise<PlatformPaymentSettings | null> {
    if (!auth.currentUser) return null;
    const path = 'platformSettings/payment';
    try {
      const snapshot = await getDoc(doc(db, 'platformSettings', 'payment'));
      if (snapshot.exists()) {
        return snapshot.data() as PlatformPaymentSettings;
      }
      return null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
      return null;
    }
  },

  // Real-time Cloud Firestore subscriptions (only attach when auth.currentUser is ready)
  subscribeToChurches(
    onData: (churches: Church[]) => void,
    onError?: (error: unknown) => void
  ): Unsubscribe {
    if (!auth.currentUser) return () => {};
    const path = 'churches';
    return onSnapshot(
      collection(db, path),
      snapshot => {
        onData(snapshot.docs.map(d => d.data() as Church));
      },
      error => {
        try {
          handleFirestoreError(error, OperationType.LIST, path);
        } catch (wrappedErr) {
          onError?.(wrappedErr);
        }
      }
    );
  },

  subscribeToChurchById(
    churchId: string,
    onData: (church: Church | null) => void,
    onError?: (error: unknown) => void
  ): Unsubscribe {
    if (!auth.currentUser || !churchId) return () => {};
    const path = `churches/${churchId}`;
    return onSnapshot(
      doc(db, 'churches', churchId),
      snapshot => {
        onData(snapshot.exists() ? (snapshot.data() as Church) : null);
      },
      error => {
        try {
          handleFirestoreError(error, OperationType.GET, path);
        } catch (wrappedErr) {
          onError?.(wrappedErr);
        }
      }
    );
  },

  subscribeToMembers(
    churchId: string,
    departmentIdsFilter: string[] | undefined,
    onData: (members: Member[]) => void,
    onError?: (error: unknown) => void
  ): Unsubscribe {
    if (!auth.currentUser || !churchId) return () => {};
    const path = `churches/${churchId}/members`;
    const q =
      Array.isArray(departmentIdsFilter) && departmentIdsFilter.length > 0
        ? query(collection(db, path), where('departmentIds', 'array-contains-any', departmentIdsFilter.slice(0, 10)))
        : collection(db, path);
    return onSnapshot(
      q,
      snapshot => {
        onData(snapshot.docs.map(d => d.data() as Member));
      },
      error => {
        try {
          handleFirestoreError(error, OperationType.LIST, path);
        } catch (wrappedErr) {
          onError?.(wrappedErr);
        }
      }
    );
  },

  subscribeToDepartments(
    churchId: string,
    departmentIdsFilter: string[] | undefined,
    onData: (departments: Department[]) => void,
    onError?: (error: unknown) => void
  ): Unsubscribe {
    if (!auth.currentUser || !churchId) return () => {};
    const path = `churches/${churchId}/departments`;
    const q =
      Array.isArray(departmentIdsFilter) && departmentIdsFilter.length > 0
        ? query(collection(db, path), where('id', 'in', departmentIdsFilter.slice(0, 10)))
        : collection(db, path);
    return onSnapshot(
      q,
      snapshot => {
        onData(snapshot.docs.map(d => d.data() as Department));
      },
      error => {
        try {
          handleFirestoreError(error, OperationType.LIST, path);
        } catch (wrappedErr) {
          onError?.(wrappedErr);
        }
      }
    );
  },

  subscribeToEvents(
    churchId: string,
    onData: (events: ChurchEvent[]) => void,
    onError?: (error: unknown) => void
  ): Unsubscribe {
    if (!auth.currentUser || !churchId) return () => {};
    const path = `churches/${churchId}/events`;
    return onSnapshot(
      collection(db, path),
      snapshot => {
        onData(snapshot.docs.map(d => d.data() as ChurchEvent));
      },
      error => {
        try {
          handleFirestoreError(error, OperationType.LIST, path);
        } catch (wrappedErr) {
          onError?.(wrappedErr);
        }
      }
    );
  },

  subscribeToUsers(
    churchId: string | undefined,
    onData: (users: User[]) => void,
    onError?: (error: unknown) => void
  ): Unsubscribe {
    if (!auth.currentUser) return () => {};
    const path = 'users';
    const q = churchId ? query(collection(db, path), where('churchId', '==', churchId)) : collection(db, path);
    return onSnapshot(
      q,
      snapshot => {
        onData(snapshot.docs.map(d => d.data() as User));
      },
      error => {
        try {
          handleFirestoreError(error, OperationType.LIST, path);
        } catch (wrappedErr) {
          onError?.(wrappedErr);
        }
      }
    );
  },

  subscribeToPaymentProofs(
    onData: (proofs: PaymentProof[]) => void,
    churchId?: string,
    onError?: (error: unknown) => void
  ): Unsubscribe {
    if (!auth.currentUser) return () => {};
    const path = 'paymentProofs';
    const q = churchId ? query(collection(db, path), where('churchId', '==', churchId)) : collection(db, path);
    return onSnapshot(
      q,
      snapshot => {
        const list = snapshot.docs.map(d => d.data() as PaymentProof);
        onData(list.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()));
      },
      error => {
        try {
          handleFirestoreError(error, OperationType.LIST, path);
        } catch (wrappedErr) {
          onError?.(wrappedErr);
        }
      }
    );
  },

  subscribeToTickets(
    onData: (tickets: SupportTicket[]) => void,
    churchId?: string,
    onError?: (error: unknown) => void
  ): Unsubscribe {
    if (!auth.currentUser) return () => {};
    const path = 'tickets';
    const q = churchId ? query(collection(db, path), where('churchId', '==', churchId)) : collection(db, path);
    return onSnapshot(
      q,
      snapshot => {
        const list = snapshot.docs.map(d => d.data() as SupportTicket);
        onData(list.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()));
      },
      error => {
        try {
          handleFirestoreError(error, OperationType.LIST, path);
        } catch (wrappedErr) {
          onError?.(wrappedErr);
        }
      }
    );
  },
};
