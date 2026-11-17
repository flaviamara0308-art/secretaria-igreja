import { registerSW } from 'virtual:pwa-register';
import type { Church, ChurchEvent, Member } from '../types';
import { StorageService } from './storage';

export type PushPermissionState = NotificationPermission | 'unsupported';

let swRegistrationRef: ServiceWorkerRegistration | null = null;
let swInitialized = false;

export function getPushSupportInfo(): {
  supported: boolean;
  permission: PushPermissionState;
} {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { supported: false, permission: 'unsupported' };
  }
  return {
    supported: true,
    permission: Notification.permission,
  };
}

export async function registerAppServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  if (!swInitialized) {
    swInitialized = true;
    try {
      registerSW({
        immediate: true,
        onRegisteredSW(_swUrl, registration) {
          if (registration) {
            swRegistrationRef = registration;
          }
        },
        onRegisterError(err) {
          console.warn('Falha ao registrar Service Worker PWA:', err);
        },
      });
    } catch (err) {
      console.warn('Registro PWA adiado:', err);
    }
  }

  if (swRegistrationRef) return swRegistrationRef;

  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) {
      swRegistrationRef = existing;
      return existing;
    }
    const readyReg = await Promise.race<ServiceWorkerRegistration | null>([
      navigator.serviceWorker.ready,
      new Promise<null>(resolve => setTimeout(() => resolve(null), 1500)),
    ]);
    if (readyReg) {
      swRegistrationRef = readyReg;
      return readyReg;
    }
  } catch {
    // Ignore registration lookup failures
  }

  return null;
}

export async function requestPushPermission(): Promise<PushPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }

  await registerAppServiceWorker();

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission;
  }
}

export async function dispatchPushNotification(params: {
  churchId: string;
  userId?: string;
  title: string;
  body: string;
  tag: string;
  type: 'EVENT' | 'REMINDER' | 'SYSTEM';
  url?: string;
}): Promise<boolean> {
  StorageService.saveNotification({
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    churchId: params.churchId,
    userId: params.userId || 'all',
    title: params.title,
    message: params.body,
    date: new Date().toLocaleString('pt-BR'),
    read: false,
    type: params.type,
  });

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  if (Notification.permission !== 'granted') {
    return false;
  }

  const options: NotificationOptions = {
    body: params.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: params.tag,
    data: { url: params.url || '/' },
  };

  try {
    const reg = await registerAppServiceWorker();
    if (reg && typeof reg.showNotification === 'function') {
      await reg.showNotification(params.title, options);
      return true;
    }
    if (reg?.active) {
      reg.active.postMessage({
        type: 'SHOW_NOTIFICATION',
        payload: { title: params.title, ...options },
      });
      return true;
    }
    new Notification(params.title, options);
    return true;
  } catch (err) {
    try {
      new Notification(params.title, options);
      return true;
    } catch {
      console.warn('Não foi possível exibir notificação push:', err);
      return false;
    }
  }
}

const IMPORTANT_EVENT_CATEGORIES = new Set<ChurchEvent['category']>([
  'CULT',
  'BAPTISM',
  'SPECIAL',
  'REUNION',
]);

const CATEGORY_LABELS: Record<ChurchEvent['category'], string> = {
  CULT: 'Culto',
  BAPTISM: 'Batismo',
  SPECIAL: 'Evento Especial',
  REUNION: 'Reunião',
  DEPARTMENT: 'Departamento',
  ADMIN: 'Administração',
};

export async function notifyImportantEvent(
  church: Church,
  event: ChurchEvent,
  actionType: 'CREATED' | 'UPDATED' | 'CANCELLED',
  userId?: string
): Promise<boolean> {
  const isImportant =
    actionType === 'CANCELLED' ||
    event.status === 'CANCELLED' ||
    IMPORTANT_EVENT_CATEGORIES.has(event.category);

  if (!isImportant) return false;

  const formattedDate = event.startDate
    ? event.startDate.replace('T', ' às ')
    : 'data a confirmar';

  let title = `${church.name} — Novo Evento Importante`;
  if (actionType === 'CANCELLED' || event.status === 'CANCELLED') {
    title = `${church.name} — Evento Cancelado`;
  } else if (actionType === 'UPDATED') {
    title = `${church.name} — Evento Atualizado`;
  }

  const catLabel = CATEGORY_LABELS[event.category] || 'Agenda';
  const body = `${catLabel}: "${event.title}" (${formattedDate}${event.location ? ` • ${event.location}` : ''}).`;

  return dispatchPushNotification({
    churchId: church.id,
    userId,
    title,
    body,
    tag: `event-${event.id}`,
    type: 'EVENT',
    url: '/#agenda',
  });
}

export async function notifyMemberStatusChange(
  church: Church,
  member: Member,
  previousStatus: Member['status'] | undefined,
  nextStatus: Member['status'],
  userId?: string
): Promise<boolean> {
  const statusChanged = previousStatus !== undefined && previousStatus !== nextStatus;
  const createdInactive = previousStatus === undefined && nextStatus === 'INACTIVE';

  if (!statusChanged && !createdInactive) return false;

  const statusLabel = nextStatus === 'ACTIVE' ? 'Ativo' : 'Inativo';
  const reasonSuffix =
    nextStatus === 'INACTIVE' && member.deactivationReason
      ? ` Motivo: ${member.deactivationReason}.`
      : '';

  return dispatchPushNotification({
    churchId: church.id,
    userId,
    title: `${church.name} — Mudança de Status de Membro`,
    body: `${member.fullName} (${member.memberCode}) teve o status alterado para ${statusLabel}.${reasonSuffix}`,
    tag: `member-status-${member.id}`,
    type: 'SYSTEM',
    url: '/#members',
  });
}
