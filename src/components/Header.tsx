import React, { useState, useEffect } from 'react';
import { Church, User } from '../types';
import { auth, FirebaseAuthService } from '../services/firebase';
import { PWAInstallButton } from './PWAComponents';
import {
  getPushSupportInfo,
  requestPushPermission,
  dispatchPushNotification,
  PushPermissionState,
} from '../services/pushService';
import {
  Building2,
  Shield,
  Wifi,
  WifiOff,
  AlertTriangle,
  Award,
  LogOut,
  Menu,
  Bell,
  BellRing,
  BellOff,
  CloudOff,
  CloudCheck,
} from 'lucide-react';

interface HeaderProps {
  church: Church;
  currentUser: User;
  churches: Church[];
  onSwitchChurch: (churchId: string) => void;
  onOpenSyncDrawer: () => void;
  onOpenMobileMenu?: () => void;
  onLogout: (switchAccount?: boolean) => void;
  pendingSyncCount: number;
  conflictCount: number;
  isOffline: boolean;
}

const getRoleLabel = (role: User['role']): string => {
  switch (role) {
    case 'PLATFORM_ADMIN':
      return 'Administrador da Plataforma';
    case 'PLATFORM_ASSISTANT_ADMIN':
      return 'Administrador Auxiliar';
    case 'GENERAL_SECRETARY':
      return 'Secretaria Geral';
    case 'ADMIN':
      return 'Administrador Geral';
    case 'SECRETARY':
      return 'Secretaria';
    case 'ASSISTANT_SECRETARY':
      return 'Secretário Auxiliar';
    case 'PASTOR':
      return 'Consulta Ministerial';
    case 'DEPARTMENT_LEADER':
      return 'Líder de Departamento';
    case 'TREASURER':
      return 'Tesoureiro';
    default:
      return role;
  }
};

export const Header: React.FC<HeaderProps> = ({ 
  church, 
  currentUser,
  onOpenSyncDrawer,
  onOpenMobileMenu,
  onLogout,
  pendingSyncCount,
  conflictCount,
  isOffline,
}) => {
  const isPlatformStaff = currentUser.role === 'PLATFORM_ADMIN' || currentUser.role === 'PLATFORM_ASSISTANT_ADMIN';
  const displayName = currentUser.name?.trim() || currentUser.email;
  const displayInitial = displayName.charAt(0).toUpperCase();
  const initialPush = getPushSupportInfo();
  const [pushPerm, setPushPerm] = useState<PushPermissionState>(initialPush.permission);
  const [firebaseAuthed, setFirebaseAuthed] = useState(Boolean(auth.currentUser));

  useEffect(() => {
    const unsub = FirebaseAuthService.onAuthChanged(u => {
      setFirebaseAuthed(Boolean(u));
    });
    return () => unsub();
  }, []);

  const handleTogglePush = async () => {
    const result = await requestPushPermission();
    setPushPerm(result);
    if (result === 'granted') {
      await dispatchPushNotification({
        churchId: church.id,
        userId: currentUser.id,
        title: `${church.name} — Alertas Push Ativados`,
        body: 'Você receberá notificações sobre eventos importantes e mudanças de status de membros.',
        tag: `push-ready-${church.id}`,
        type: 'SYSTEM',
        url: '/',
      });
    }
  };

  return (
    <header
      className={`sticky top-0 z-30 flex h-16 w-full items-center justify-between gap-2 border-b px-3 sm:px-6 backdrop-blur-md transition ${
        isPlatformStaff
          ? 'border-indigo-900 bg-slate-900/95 text-white'
          : 'border-gray-200 bg-white/95 dark:border-gray-800 dark:bg-gray-900/95'
      }`}
      style={
        !isPlatformStaff
          ? { borderBottomColor: 'rgba(var(--church-primary-rgb), 0.22)' }
          : undefined
      }
    >
      {/* Current Context (Mobile Left Menu Toggle + Church badge or Platform Central badge) */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {onOpenMobileMenu && (
          <button
            type="button"
            onClick={onOpenMobileMenu}
            aria-label="Abrir menu lateral"
            title="Abrir menu lateral"
            className={`md:hidden inline-flex items-center justify-center rounded-xl border p-2 transition ${
              isPlatformStaff
                ? 'border-indigo-700 bg-slate-800 text-white hover:bg-slate-700'
                : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        {isPlatformStaff ? (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
              <Shield className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <span className="text-xs font-bold tracking-tight text-white block truncate">
                ADMINISTRAÇÃO DA PLATAFORMA
              </span>
              <span className="text-[10px] text-indigo-300 hidden sm:block truncate">
                Gestão Multi-Tenant & Atendimento Geral
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            {church.logoUrl ? (
              <img
                src={church.logoUrl}
                alt={church.name}
                className="h-8 w-8 flex-shrink-0 rounded-lg object-contain bg-white p-0.5 border border-gray-200 dark:border-gray-700"
              />
            ) : (
              <Building2 className="w-5 h-5 flex-shrink-0 church-accent-text" />
            )}
            <div
              className="rounded-xl border py-1.5 px-2.5 sm:px-3 text-xs sm:text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[160px] sm:max-w-xs"
              style={{
                backgroundColor: 'rgba(var(--church-primary-rgb), 0.06)',
                borderColor: 'rgba(var(--church-primary-rgb), 0.2)',
              }}
            >
              {church.name} <span className="hidden sm:inline text-[11px] font-mono text-gray-500 dark:text-gray-400">({church.exclusiveCode})</span>
            </div>

            {/* Quick Status Pill for Church */}
            <span className="hidden xl:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              <Award className="w-3 h-3" /> Sistema 100% Gratuito
            </span>
          </div>
        )}
      </div>

      {/* Right Actions: Sync Status, PWA Install, User Info & Switch Account */}
      <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
        {/* Sync Status Button */}
        <button
          onClick={onOpenSyncDrawer}
          className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold border transition shadow-xs ${
            conflictCount > 0
              ? 'bg-rose-50 border-rose-300 text-rose-700 dark:bg-rose-950 dark:border-rose-800 dark:text-rose-300 animate-bounce'
              : isOffline
              ? 'bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-300'
              : pendingSyncCount > 0
              ? 'bg-blue-50 border-blue-300 text-blue-800 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-300'
              : 'bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-300'
          }`}
          title="Central de Sincronização e Modo Offline"
        >
          {conflictCount > 0 ? (
            <>
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
              <span className="hidden sm:inline">{conflictCount} Conflito{conflictCount > 1 ? 's' : ''}</span>
            </>
          ) : isOffline ? (
            <>
              <WifiOff className="w-3.5 h-3.5 text-amber-600" />
              <span className="hidden sm:inline">Offline</span>
              {pendingSyncCount > 0 && <span className="bg-amber-200 dark:bg-amber-800 px-1.5 py-0.2 rounded-full text-[10px]">{pendingSyncCount}</span>}
            </>
          ) : (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-600" />
              <span className="hidden sm:inline">{pendingSyncCount > 0 ? `${pendingSyncCount} pendente` : 'Online'}</span>
            </>
          )}
        </button>

        {!isOffline && !firebaseAuthed && (
          <button
            type="button"
            onClick={async () => {
              try {
                await FirebaseAuthService.signInWithGoogle(true);
              } catch {
                onOpenSyncDrawer();
              }
            }}
            title="Conectar Conta Google para gravar e sincronizar na nuvem Firestore"
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-200 transition shadow-xs"
          >
            <CloudOff className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
            <span>Conectar Nuvem</span>
          </button>
        )}

        <PWAInstallButton />

        {initialPush.supported && (
          <button
            type="button"
            onClick={handleTogglePush}
            title={
              pushPerm === 'granted'
                ? 'Notificações Push ativadas (clique para testar)'
                : pushPerm === 'denied'
                ? 'Notificações bloqueadas nas configurações do navegador'
                : 'Ativar notificações push de eventos e status'
            }
            aria-label="Notificações Push"
            className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${
              pushPerm === 'granted'
                ? isPlatformStaff
                  ? 'border-indigo-700 bg-indigo-900/60 text-emerald-300 hover:bg-indigo-800'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                : pushPerm === 'denied'
                ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300'
                : isPlatformStaff
                ? 'border-indigo-700 bg-slate-800 text-indigo-100 hover:bg-slate-700'
                : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'
            }`}
          >
            {pushPerm === 'granted' ? (
              <BellRing className="w-3.5 h-3.5" />
            ) : pushPerm === 'denied' ? (
              <BellOff className="w-3.5 h-3.5" />
            ) : (
              <Bell className="w-3.5 h-3.5" />
            )}
            <span className="hidden lg:inline">
              {pushPerm === 'granted'
                ? 'Alertas Ativos'
                : pushPerm === 'denied'
                ? 'Bloqueado'
                : 'Ativar Alertas'}
            </span>
          </button>
        )}

        <div className={`flex items-center gap-2 border-l pl-2 sm:pl-3 ${
          isPlatformStaff ? 'border-indigo-800' : 'border-gray-200 dark:border-gray-700'
        }`}>
          <div className={`h-8 w-8 flex-shrink-0 rounded-full font-bold flex items-center justify-center text-xs border ${
            isPlatformStaff
              ? 'bg-indigo-600 text-white border-indigo-500'
              : 'church-soft-badge'
          }`}>
            {displayInitial}
          </div>
          <div className="text-left min-w-0">
            <p className={`text-xs font-bold leading-tight truncate max-w-[105px] sm:max-w-[170px] ${isPlatformStaff ? 'text-white' : 'text-gray-900 dark:text-white'}`}>
              {displayName}
            </p>
            <p className={`hidden sm:block text-[10px] uppercase tracking-wider truncate ${isPlatformStaff ? 'text-indigo-300' : 'text-gray-500 dark:text-gray-400'}`}>
              {getRoleLabel(currentUser.role)}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onLogout(true)}
          title="Sair e entrar com outra conta"
          aria-label="Sair e entrar com outra conta"
          className={`flex items-center gap-1.5 rounded-xl border px-2.5 sm:px-3 py-1.5 text-xs font-semibold transition whitespace-nowrap ${
            isPlatformStaff
              ? 'border-indigo-700 bg-slate-800 text-indigo-100 hover:bg-rose-950/80 hover:border-rose-600 hover:text-white'
              : 'border-gray-200 bg-white text-gray-700 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-rose-950/60 dark:hover:border-rose-800 dark:hover:text-rose-300'
          }`}
        >
          <LogOut className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="hidden md:inline">Sair e entrar com outra conta</span>
          <span className="md:hidden">Sair</span>
        </button>
      </div>
    </header>
  );
};

