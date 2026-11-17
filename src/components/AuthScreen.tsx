import React, { useEffect, useState } from 'react';
import { Church, User } from '../types';
import {
  PlusCircle,
  AlertCircle,
  CheckCircle2,
  Upload,
} from 'lucide-react';
import { ChurchRegistrationModal } from './ChurchRegistrationModal';
import { FirebaseAuthService, FirebaseService } from '../services/firebase';
import { PlatformAdminAuthService, ROOT_PLATFORM_ADMIN_EMAIL } from '../utils/platformAdminAuth';
import { SecurityPolicy } from '../services/securityPolicy';
import { BackupService } from '../services/backupService';
import { StorageService } from '../services/storage';

interface AuthScreenProps {
  churches: Church[];
  users: User[];
  onLogin: (church: Church, user: User, cloudSynced?: boolean) => void;
  onRegisterChurch: (church: Church, adminPassword?: string, adminName?: string) => Promise<void> | void;
  onDataImported?: () => void;
  initialNotice?: string | null;
  isSwitchingAccount?: boolean;
}

const GoogleIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
    />
  </svg>
);

export const AuthScreen: React.FC<AuthScreenProps> = ({
  churches,
  users,
  onLogin,
  onRegisterChurch,
  onDataImported,
  initialNotice = null,
  isSwitchingAccount = false,
}) => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(initialNotice);
  const [showRegModal, setShowRegModal] = useState(false);
  const [pendingGoogleAccount, setPendingGoogleAccount] = useState<{
    uid: string;
    email: string;
    name: string;
  } | null>(null);

  useEffect(() => {
    setSuccessMsg(initialNotice);
    if (isSwitchingAccount) {
      setErrorMsg(null);
    }
  }, [initialNotice, isSwitchingAccount]);

  const buildPlatformChurchContext = (userEmail: string): Church => ({
    id: 'PLATFORM_TENANT',
    name: 'Administração Geral da Plataforma',
    denomination: 'Plataforma Central Multi-tenant',
    pastorName: 'Diretoria da Plataforma',
    email: userEmail,
    phone: '(11) 4000-0000',
    address: 'Av. Paulista, 1000 - Bela Vista',
    city: 'São Paulo',
    state: 'SP',
    zipCode: '01310-100',
    primaryColor: '#0f172a',
    secondaryColor: '#4f46e5',
    exclusiveCode: 'PLATFORM',
    status: 'ACTIVE',
    plan: 'FREE_PERMANENT',
    planStatus: 'ACTIVE',
    createdAt: '2025-01-01T00:00:00.000Z',
  });

  const buildRootAdminUser = (normalizedEmail: string, uid?: string, displayName?: string | null): User => ({
    id: uid || (normalizedEmail === ROOT_PLATFORM_ADMIN_EMAIL ? 'platform-admin-owner' : 'platform-admin-flavia'),
    churchId: 'PLATFORM',
    name: displayName || 'Flávia (Admin Plataforma)',
    email: normalizedEmail,
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
    lastLogin: new Date().toLocaleString('pt-BR'),
  });

  const claimPreAuthorizedUid = async (
    fbUid: string,
    baseUser: User,
    displayName?: string | null,
    remotePreAuthId?: string | null,
    allowCloudWrite: boolean = true
  ): Promise<{ user: User; cloudSynced: boolean }> => {
    const needsUidClaim = baseUser.id !== fbUid;
    const activeUser: User = {
      ...baseUser,
      id: fbUid,
      name: baseUser.name || displayName || baseUser.email.split('@')[0],
      status: 'ACTIVE',
      ...(needsUidClaim && remotePreAuthId ? { claimedFromUserId: remotePreAuthId } : {}),
      lastLogin: new Date().toLocaleString('pt-BR'),
    };

    let cloudSynced = false;
    if (allowCloudWrite) {
      try {
        await FirebaseService.saveUser(activeUser);
        cloudSynced = true;
        if (needsUidClaim && remotePreAuthId) {
          await FirebaseService.deleteUser(remotePreAuthId).catch(() => {});
        }
      } catch (err) {
        console.warn('Sincronização do perfil ao UID Google pendente:', err);
      }
    }

    const latestUsers = StorageService.getUsers();
    const cleaned = latestUsers.filter(
      u => u.id !== activeUser.id && (!remotePreAuthId || u.id !== remotePreAuthId)
    );
    StorageService.saveUsers([...cleaned, activeUser]);

    return { user: activeUser, cloudSynced };
  };

  const handleRestoreFromBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsLoading(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as any;
      if (parsed?.format === 'SECRETARIA_NETLIFY_SYNC_V1') {
        const imported = await BackupService.importFullPlatformSnapshot(text);
        onDataImported?.();
        setSuccessMsg(
          `Dados sincronizados! ${imported.churches} congregação(ões), ${imported.users} usuário(s) e ${imported.members} membro(s) importados.`
        );
      } else {
        const restored = await BackupService.importStandaloneBackupFile(text);
        onDataImported?.();
        setSuccessMsg(
          `Congregação "${restored.church.name}" e usuário "${restored.primaryUser.name}" recuperados com sucesso!`
        );
        onLogin(restored.church, restored.primaryUser);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Não foi possível importar o arquivo de backup.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsLoading(true);
    try {
      const fbUser = await FirebaseAuthService.signInWithGoogle(true);
      const rawEmail = FirebaseAuthService.resolveUserEmail(fbUser);
      const normalizedEmail = rawEmail.trim().toLowerCase();
      const hasServerEmailClaim = Boolean(fbUser.email);
      const isRootAdmin = PlatformAdminAuthService.isRootPlatformEmail(normalizedEmail);

      const remoteById = await FirebaseService.getUserById(fbUser.uid).catch(() => null);
      const remoteByEmail =
        !remoteById && normalizedEmail && hasServerEmailClaim
          ? await FirebaseService.getUserByEmail(normalizedEmail).catch(() => null)
          : null;
      const remoteUser = remoteById || remoteByEmail;

      const allLocalUsers = StorageService.getUsers();
      const emailMatch = normalizedEmail
        ? allLocalUsers.find(u => u.email.toLowerCase() === normalizedEmail) ||
          users.find(u => u.email.toLowerCase() === normalizedEmail)
        : undefined;

      // 1. Authorized Root Owner / Platform Admin (e.g. flaviamara0308@gmail.com)
      if (isRootAdmin) {
        if (!remoteById && !hasServerEmailClaim) {
          await FirebaseAuthService.signOut();
          setErrorMsg(
            `A conta Google (${normalizedEmail}) entrou sem e-mail verificado no token do Firebase (email: null). No Firebase Console, abra Authentication > Settings > User account management e selecione "Link accounts that use the same email" (Vincular contas que usam o mesmo e-mail).`
          );
          return;
        }
        const bootstrappedAdmin = buildRootAdminUser(
          normalizedEmail,
          fbUser.uid,
          fbUser.displayName || remoteUser?.name || emailMatch?.name
        );
        let rootCloudSynced = Boolean(remoteById);
        try {
          await FirebaseService.saveUser(bootstrappedAdmin);
          rootCloudSynced = true;
        } catch (e) {
          console.warn('Bootstrap admin na nuvem pendente:', e);
        }
        onLogin(buildPlatformChurchContext(normalizedEmail), bootstrappedAdmin, rootCloudSynced);
        return;
      }

      let resolvedUser = remoteUser || emailMatch;
      let cloudSynced = Boolean(remoteById);
      let preFetchedChurch: Church | null = null;

      // 2. Match by registered church email / ownerUid if user profile doc wasn't created yet
      if (!resolvedUser && normalizedEmail) {
        const allLocalChurches = StorageService.getChurches();
        const churchMatch =
          allLocalChurches.find(
            c => (c.email && c.email.toLowerCase() === normalizedEmail) || c.ownerUid === fbUser.uid
          ) ||
          churches.find(
            c => (c.email && c.email.toLowerCase() === normalizedEmail) || c.ownerUid === fbUser.uid
          );

        if (churchMatch) {
          if (hasServerEmailClaim || churchMatch.ownerUid === fbUser.uid) {
            preFetchedChurch = await FirebaseService.getChurchById(churchMatch.id).catch(() => null);
          }

          let canWriteUserToCloud = Boolean(
            preFetchedChurch &&
              (preFetchedChurch.ownerUid === fbUser.uid ||
                (hasServerEmailClaim && preFetchedChurch.email?.toLowerCase() === normalizedEmail))
          );

          if (!preFetchedChurch && churchMatch.status === 'PENDING' && churchMatch.plan !== 'FREE_PERMANENT') {
            try {
              const pendingChurchWithOwner = { ...churchMatch, ownerUid: fbUser.uid };
              await FirebaseService.saveChurch(pendingChurchWithOwner);
              preFetchedChurch = pendingChurchWithOwner;
              canWriteUserToCloud = true;
            } catch {
              canWriteUserToCloud = false;
            }
          }

          const claimed = await claimPreAuthorizedUid(
            fbUser.uid,
            {
              id: fbUser.uid,
              churchId: churchMatch.id,
              name: fbUser.displayName || churchMatch.pastorName || churchMatch.name,
              email: normalizedEmail,
              role: 'GENERAL_SECRETARY',
              status: 'ACTIVE',
              lastLogin: new Date().toLocaleString('pt-BR'),
            },
            fbUser.displayName,
            null,
            canWriteUserToCloud
          );
          resolvedUser = claimed.user;
          cloudSynced = claimed.cloudSynced;
        }
      }

      // 3. No authorization found -> block automatic entry, inform clearly & allow congregation registration
      if (!resolvedUser) {
        if (normalizedEmail) {
          setPendingGoogleAccount({
            uid: fbUser.uid,
            email: normalizedEmail,
            name: fbUser.displayName || normalizedEmail.split('@')[0],
          });
          await FirebaseAuthService.signOut();
          setErrorMsg(
            `O e-mail ${normalizedEmail} ainda não está autorizado em nenhuma congregação. Solicite a liberação à Administração ou à Secretaria Geral da sua igreja.`
          );
          return;
        }
        await FirebaseAuthService.signOut();
        setErrorMsg(
          `Não foi possível obter o e-mail da Conta Google (UID: ${fbUser.uid}). Verifique se a permissão de e-mail foi concedida ao entrar com o Google e tente novamente.`
        );
        return;
      }

      if (resolvedUser.status === 'INACTIVE') {
        await FirebaseAuthService.signOut();
        setErrorMsg('Esta conta está bloqueada. Entre em contato com a Administração ou Secretaria Geral.');
        return;
      }

      // 4. Platform Assistant / Additional Platform Admin
      if (SecurityPolicy.isPlatformStaff(resolvedUser)) {
        let activePlatformUser = resolvedUser;
        if (!remoteById && remoteByEmail) {
          const claimed = await claimPreAuthorizedUid(fbUser.uid, remoteByEmail, fbUser.displayName, remoteByEmail.id, true);
          activePlatformUser = claimed.user;
          cloudSynced = claimed.cloudSynced;
        } else if (!remoteUser && hasServerEmailClaim) {
          const claimed = await claimPreAuthorizedUid(fbUser.uid, resolvedUser, fbUser.displayName, null, false);
          activePlatformUser = claimed.user;
        } else {
          activePlatformUser = {
            ...resolvedUser,
            status: 'ACTIVE' as const,
            lastLogin: new Date().toLocaleString('pt-BR'),
          };
        }

        onLogin(buildPlatformChurchContext(activePlatformUser.email), activePlatformUser, cloudSynced);
        return;
      }

      // 5. Authorized Church User (Claim pre-authorized UID document FIRST so Firestore isSameChurch succeeds)
      let activeUser = resolvedUser;
      if (!remoteById && remoteByEmail) {
        const claimed = await claimPreAuthorizedUid(fbUser.uid, remoteByEmail, fbUser.displayName, remoteByEmail.id, true);
        activeUser = claimed.user;
        cloudSynced = claimed.cloudSynced;
      } else if (!remoteUser && resolvedUser.id !== fbUser.uid) {
        const claimed = await claimPreAuthorizedUid(fbUser.uid, resolvedUser, fbUser.displayName, null, false);
        activeUser = claimed.user;
      } else {
        activeUser = {
          ...resolvedUser,
          name: resolvedUser.name || fbUser.displayName || normalizedEmail.split('@')[0],
          status: 'ACTIVE' as const,
          lastLogin: new Date().toLocaleString('pt-BR'),
        };
      }

      const canFetchRemoteChurch = cloudSynced || hasServerEmailClaim;
      const remoteChurch =
        preFetchedChurch ||
        (canFetchRemoteChurch
          ? await FirebaseService.getChurchById(activeUser.churchId).catch(() => null)
          : null);
      const localChurch =
        churches.find(c => c.id === activeUser.churchId) ||
        StorageService.getChurches().find(c => c.id === activeUser.churchId);
      let targetChurch = remoteChurch || localChurch;

      if (!targetChurch) {
        const fallbackChurch =
          StorageService.getChurches().find(c => c.email.toLowerCase() === normalizedEmail) ||
          churches.find(c => c.email.toLowerCase() === normalizedEmail);
        if (fallbackChurch) {
          targetChurch = fallbackChurch;
        } else {
          setPendingGoogleAccount({
            uid: fbUser.uid,
            email: normalizedEmail,
            name: fbUser.displayName || (normalizedEmail ? normalizedEmail.split('@')[0] : 'Usuário'),
          });
          setShowRegModal(true);
          setSuccessMsg(
            'Conta Google autenticada! Conclua o cadastro da sua congregação para vincular seu acesso.'
          );
          return;
        }
      }

      if (
        !remoteChurch &&
        activeUser.role === 'GENERAL_SECRETARY' &&
        targetChurch.status === 'PENDING' &&
        targetChurch.plan !== 'FREE_PERMANENT'
      ) {
        targetChurch = { ...targetChurch, ownerUid: fbUser.uid };
        try {
          await FirebaseService.saveChurch(targetChurch);
          if (!cloudSynced) {
            await FirebaseService.saveUser(activeUser);
            cloudSynced = true;
          }
        } catch (err) {
          console.warn('Sincronização da congregação ao Google pendente:', err);
        }
      }

      onLogin(targetChurch, activeUser, cloudSynced);
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') {
        const friendly = FirebaseAuthService.getFriendlyAuthError(err);
        const codeTag = err?.code ? ` (${err.code})` : '';
        setErrorMsg(friendly.includes(err?.code || '') ? friendly : `${friendly}${codeTag}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-[420px] rounded-2xl bg-white p-7 sm:p-8 shadow-sm border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
        {/* Clean Institutional Header */}
        <div className="text-center">
          <img
            src="/icon.svg"
            alt="Secretaria da Igreja"
            className="mx-auto h-12 w-12 rounded-xl"
          />
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Secretaria da Igreja
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Gestão de congregações, membros e departamentos
          </p>
        </div>

        {errorMsg && (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs leading-relaxed text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/50 dark:text-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs leading-relaxed text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/50 dark:text-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Primary Focal Action: Google Sign-In */}
        <div className="mt-6">
          <button
            type="button"
            disabled={isLoading}
            onClick={handleGoogleSignIn}
            className="w-full flex items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-xs hover:bg-slate-50 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700/80 dark:focus:ring-offset-slate-900 disabled:opacity-60 whitespace-nowrap"
          >
            <GoogleIcon className="w-5 h-5 flex-shrink-0" />
            <span>{isLoading ? 'Conectando...' : 'Entrar com Google'}</span>
          </button>
        </div>

        {/* Quiet Secondary Links */}
        <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 text-xs">
          <button
            type="button"
            onClick={() => setShowRegModal(true)}
            className="inline-flex items-center gap-1.5 font-medium text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 whitespace-nowrap shrink-0"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Cadastrar congregação</span>
          </button>

          <label className="inline-flex items-center gap-1.5 font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer whitespace-nowrap shrink-0">
            <Upload className="w-3.5 h-3.5" />
            <span>Restaurar backup</span>
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleRestoreFromBackupFile}
            />
          </label>
        </div>
      </div>

      {showRegModal && (
        <ChurchRegistrationModal
          googleAccount={pendingGoogleAccount}
          onClose={() => {
            setShowRegModal(false);
            setPendingGoogleAccount(null);
          }}
          onRegister={async (newChurch, adminPassword, adminName) => {
            await onRegisterChurch(newChurch, adminPassword, adminName);
          }}
        />
      )}
    </div>
  );
};
