import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Church, User, Member, Department, ChurchEvent, SystemReport } from './types';
import { auth, FirebaseAuthService, FirebaseService } from './services/firebase';
import { StorageService, LEGACY_DEMO_IDS } from './services/storage';
import { IndexedDBService } from './services/indexedDB';
import { syncEngine } from './services/syncEngine';
import { SecurityPolicy } from './services/securityPolicy';
import { BackupService } from './services/backupService';
import { notifyImportantEvent, notifyMemberStatusChange } from './services/pushService';
import { buildChurchThemeVars } from './utils/themeColorUtils';
import { ChurchUserAuthService } from './utils/churchUserAuth';
import { mergeTenantRecords } from './utils/dataMerge';
import { PlatformAdminAuthService } from './utils/platformAdminAuth';

import { AuthScreen } from './components/AuthScreen';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { OfflineIndicator } from './components/PWAComponents';
import { SyncStatusDrawer } from './components/SyncStatusDrawer';
import { FinalizarCadastroModal } from './components/FinalizarCadastroModal';

import { Dashboard } from './components/screens/Dashboard';
import { MembersScreen } from './components/screens/MembersScreen';
import { DepartmentsScreen } from './components/screens/DepartmentsScreen';
import { UsersScreen } from './components/screens/UsersScreen';
import { AgendaScreen } from './components/screens/AgendaScreen';
import { ReportsScreen } from './components/screens/ReportsScreen';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { PlatformAdminScreen } from './components/screens/PlatformAdminScreen';
import { ChurchSupportScreen } from './components/screens/ChurchSupportScreen';
import { ShieldAlert, RefreshCw } from 'lucide-react';

export default function App() {
  const [churches, setChurches] = useState<Church[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentChurch, setCurrentChurch] = useState<Church | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentTab, setCurrentTab] = useState<string>('dashboard');

  const [members, setMembers] = useState<Member[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [events, setEvents] = useState<ChurchEvent[]>([]);

  // Pending Firestore account linking for authenticated Firebase UID
  const [pendingRegistrationUser, setPendingRegistrationUser] = useState<{
    uid: string;
    email: string | null;
    displayName: string | null;
  } | null>(null);

  // Offline, Sync & Security Session states
  const [isSyncDrawerOpen, setIsSyncDrawerOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSimulatedOffline, setIsSimulatedOffline] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [isOfflineSessionExpired, setIsOfflineSessionExpired] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);

  const [authReady, setAuthReady] = useState(false);
  const [cloudAccessActive, setCloudAccessActive] = useState(false);
  const autoBackupInFlightRef = useRef(false);

  // Load local catalog & purge ONLY legacy demo records (never wipe registered real churches/users on boot)
  useEffect(() => {
    const didPurge = StorageService.purgeLegacyDemoData();
    const localChurches = StorageService.getChurches();
    const localUsers = StorageService.getUsers();
    setChurches(localChurches);
    setUsers(localUsers);

    const indexedDbReady = didPurge
      ? (async () => {
          const cleanStore = async <T extends { id: string; churchId?: string }>(
            store: 'members' | 'departments' | 'events' | 'users',
            legacyIds: Set<string>
          ) => {
            const all = await IndexedDBService.getAll<T>(store);
            for (const rec of all) {
              if (legacyIds.has(rec.id) || (rec.churchId && LEGACY_DEMO_IDS.churches.has(rec.churchId))) {
                await IndexedDBService.delete(store, rec.id);
              }
            }
          };
          await cleanStore('members', LEGACY_DEMO_IDS.members);
          await cleanStore('departments', LEGACY_DEMO_IDS.departments);
          await cleanStore('events', LEGACY_DEMO_IDS.events);
          await cleanStore('users', LEGACY_DEMO_IDS.users);
        })().catch(() => {})
      : Promise.resolve();

    const unsubscribeAuth = FirebaseAuthService.onAuthChanged(async (fbUser) => {
      await indexedDbReady;
      if (!fbUser) {
        setPendingRegistrationUser(null);
        setCloudAccessActive(false);
        syncEngine.setCloudAccessEnabled(false);
        setAuthReady(true);
        return;
      }

      try {
        const latestLocalUsers = StorageService.getUsers();
        const latestLocalChurches = StorageService.getChurches();
        const rawEmail = FirebaseAuthService.resolveUserEmail(fbUser);
        const normalizedEmail = rawEmail.trim().toLowerCase();
        const hasServerEmailClaim = Boolean(fbUser.email);
        const isRootAdmin = PlatformAdminAuthService.isRootPlatformEmail(normalizedEmail);

        // 1. Resolve user profile from Firestore /users/{uid}, verified email query, or local fallback
        let remoteById: User | null = null;
        let remoteByEmail: User | null = null;
        try {
          remoteById = await FirebaseService.getUserById(fbUser.uid);
          if (!remoteById && !isRootAdmin && normalizedEmail && hasServerEmailClaim) {
            remoteByEmail = await FirebaseService.getUserByEmail(normalizedEmail);
          }
        } catch {
          remoteById = null;
        }
        let remoteUser: User | null = remoteById || remoteByEmail;
        let resolvedUser: User | null = remoteUser;
        let cloudVerified = Boolean(remoteById);

        if (isRootAdmin) {
          if (!remoteById && !hasServerEmailClaim) {
            await FirebaseAuthService.signOut().catch(() => {});
            setCloudAccessActive(false);
            syncEngine.setCloudAccessEnabled(false);
            setAuthNotice(
              `A conta Google (${normalizedEmail}) entrou sem e-mail verificado no token do Firebase (email: null). No Firebase Console, acesse Authentication > Settings > User account management e ative "Link accounts that use the same email".`
            );
            setAuthReady(true);
            return;
          }
          const bootstrappedAdmin: User = {
            id: fbUser.uid,
            churchId: 'PLATFORM',
            name: fbUser.displayName || remoteUser?.name || 'Flávia (Admin Plataforma)',
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
          };
          try {
            await FirebaseService.saveUser(bootstrappedAdmin);
            cloudVerified = true;
          } catch (e) {
            console.warn('Bootstrap Firestore admin profile deferred:', e);
          }
          resolvedUser = bootstrappedAdmin;
        }

        if (!resolvedUser && normalizedEmail) {
          const emailMatch =
            latestLocalUsers.find(u => u.email.toLowerCase() === normalizedEmail) || null;
          resolvedUser = emailMatch;

          if (!resolvedUser) {
            const churchMatch = latestLocalChurches.find(
              c => (c.email && c.email.toLowerCase() === normalizedEmail) || c.ownerUid === fbUser.uid
            );
            if (churchMatch) {
              resolvedUser = {
                id: fbUser.uid,
                churchId: churchMatch.id,
                name: fbUser.displayName || churchMatch.pastorName || churchMatch.name,
                email: normalizedEmail,
                role: 'GENERAL_SECRETARY',
                status: 'ACTIVE',
                lastLogin: new Date().toLocaleString('pt-BR'),
              };
            }
          }
        }

        if (resolvedUser && resolvedUser.status !== 'INACTIVE') {
          if (resolvedUser.status === 'PENDING_INVITE') {
            resolvedUser = {
              ...resolvedUser,
              status: 'ACTIVE',
              lastLogin: new Date().toLocaleString('pt-BR'),
            };
          }

          if (remoteUser && remoteUser.id !== fbUser.uid) {
            const oldPreAuthId = remoteUser.id;
            const claimedUser: User = {
              ...resolvedUser,
              id: fbUser.uid,
              name: resolvedUser.name || fbUser.displayName || normalizedEmail.split('@')[0],
              status: 'ACTIVE',
              claimedFromUserId: oldPreAuthId,
              lastLogin: new Date().toLocaleString('pt-BR'),
            };
            try {
              await FirebaseService.saveUser(claimedUser);
              await FirebaseService.deleteUser(oldPreAuthId).catch(() => {});
              cloudVerified = true;
            } catch {
              // Deferred sync
            }
            resolvedUser = claimedUser;
            remoteUser = claimedUser;
          }

          if (
            resolvedUser.role === 'GENERAL_SECRETARY' &&
            /filemon\s+soares/i.test((resolvedUser.name || '').trim())
          ) {
            resolvedUser = { ...resolvedUser, name: 'Silvia' };
            const updatedLocalUsers = latestLocalUsers.some(u => u.id === resolvedUser!.id)
              ? latestLocalUsers.map(u => (u.id === resolvedUser!.id ? resolvedUser! : u))
              : [...latestLocalUsers, resolvedUser];
            setUsers(updatedLocalUsers);
            StorageService.saveUsers(updatedLocalUsers);
            await IndexedDBService.put('users', resolvedUser);
            try {
              await FirebaseService.updateUserName(resolvedUser.id, 'Silvia');
            } catch {
              try {
                await FirebaseService.saveUser(resolvedUser);
              } catch (syncErr) {
                console.warn('Atualização do nome da Secretaria Geral adiada:', syncErr);
              }
            }
          }

          if (SecurityPolicy.isPlatformStaff(resolvedUser)) {
            if (cloudVerified) {
              try {
                const fbChurches = await FirebaseService.getChurches();
                if (fbChurches.length > 0) {
                  setChurches(fbChurches);
                  StorageService.saveChurches(fbChurches);
                }
              } catch (err) {
                console.warn('Não foi possível carregar igrejas da nuvem:', err);
              }
              try {
                const fbUsers = await FirebaseService.getUsers();
                if (fbUsers.length > 0) {
                  setUsers(fbUsers);
                  StorageService.saveUsers(fbUsers);
                }
              } catch {
                // Ignore if assistant admin lacks root user list permissions
              }
            }
            const platformChurchContext: Church = {
              id: 'PLATFORM_TENANT',
              name: 'Administração Geral da Plataforma',
              denomination: 'Plataforma Central Multi-tenant',
              pastorName: 'Diretoria da Plataforma',
              email: resolvedUser.email,
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
            };
            setCloudAccessActive(cloudVerified);
            syncEngine.setCloudAccessEnabled(cloudVerified, 'PLATFORM');
            setCurrentChurch(platformChurchContext);
            setCurrentUser(resolvedUser);
            setCurrentTab('platform-admin');
          } else {
            // Church user: fetch ONLY their own church when UID or verified email claim allows Firestore read
            let fbChurch: Church | null = null;
            if ((cloudVerified || hasServerEmailClaim) && resolvedUser.churchId) {
              try {
                fbChurch = await FirebaseService.getChurchById(resolvedUser.churchId);
              } catch {
                fbChurch = null;
              }
            }
            let matchedChurch = fbChurch
              || latestLocalChurches.find(c => c.id === resolvedUser!.churchId)
              || latestLocalChurches.find(c => c.ownerUid === fbUser.uid)
              || latestLocalChurches.find(c => Boolean(c.email && c.email.toLowerCase() === resolvedUser!.email.toLowerCase()))
              || null;
            if (matchedChurch) {
              if (!remoteUser) {
                resolvedUser = { ...resolvedUser, id: fbUser.uid };
              }
              if (
                !fbChurch &&
                resolvedUser.role === 'GENERAL_SECRETARY' &&
                matchedChurch.status === 'PENDING' &&
                matchedChurch.plan !== 'FREE_PERMANENT'
              ) {
                matchedChurch = { ...matchedChurch, ownerUid: fbUser.uid };
                try {
                  await FirebaseService.saveChurch(matchedChurch);
                  fbChurch = matchedChurch;
                } catch {
                  // Local fallback
                }
              }
              if (!remoteUser && fbChurch) {
                const canClaimChurchOwner =
                  fbChurch.ownerUid === fbUser.uid ||
                  (hasServerEmailClaim && fbChurch.email?.toLowerCase() === normalizedEmail);
                if (canClaimChurchOwner) {
                  try {
                    await FirebaseService.saveUser(resolvedUser);
                    cloudVerified = true;
                  } catch {
                    // Local fallback
                  }
                }
              }

              setChurches(prev => {
                const merged = prev.some(c => c.id === matchedChurch!.id)
                  ? prev.map(c => (c.id === matchedChurch!.id ? matchedChurch! : c))
                  : [...prev, matchedChurch!];
                StorageService.saveChurches(merged);
                return merged;
              });
              setUsers(prev => {
                const byEmailFiltered = prev.filter(
                  u => !(u.churchId === resolvedUser!.churchId && u.email.toLowerCase() === resolvedUser!.email.toLowerCase() && u.id !== resolvedUser!.id)
                );
                const merged = byEmailFiltered.some(u => u.id === resolvedUser!.id)
                  ? byEmailFiltered.map(u => (u.id === resolvedUser!.id ? resolvedUser! : u))
                  : [...byEmailFiltered, resolvedUser!];
                StorageService.saveUsers(merged);
                return merged;
              });
              IndexedDBService.put('users', resolvedUser).catch(() => {});
              setCloudAccessActive(cloudVerified);
              syncEngine.setCloudAccessEnabled(cloudVerified, matchedChurch.id);
              setCurrentChurch(matchedChurch);
              setCurrentUser(resolvedUser);
              setPendingRegistrationUser(null);
              setCurrentTab('dashboard');
            } else {
              // User has profile but no active church document linked in Firestore
              setCloudAccessActive(false);
              syncEngine.setCloudAccessEnabled(false);
              setPendingRegistrationUser({
                uid: fbUser.uid,
                email: rawEmail || null,
                displayName: fbUser.displayName,
              });
            }
          }
          if (navigator.onLine) {
            await syncEngine.recordOnlineAuth();
            if (cloudVerified) {
              syncEngine.processQueue().catch(() => {});
            }
          }
        } else if (!isRootAdmin && !resolvedUser) {
          // UID exists in Firebase Auth, but user document not found in Firestore
          setPendingRegistrationUser({
            uid: fbUser.uid,
            email: rawEmail || null,
            displayName: fbUser.displayName,
          });
        } else if (resolvedUser && resolvedUser.status === 'INACTIVE') {
          await FirebaseAuthService.signOut();
          setAuthNotice('Esta conta está bloqueada na igreja. Entre em contato com a Secretaria Geral.');
        }
      } catch (e) {
        console.warn('Erro ao restaurar sessão Firebase:', e);
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // Subscribe to SyncEngine
  useEffect(() => {
    const unsubscribe = syncEngine.subscribe(async (state) => {
      setPendingSyncCount(state.pendingCount);
      setConflictCount(state.conflictCount);

      // Verify offline session validity
      if (currentChurch) {
        const maxDays = currentChurch.offlineConfig?.maxOfflineDays || 7;
        const sessionCheck = await syncEngine.checkOfflineSession(maxDays);
        if (!navigator.onLine && !sessionCheck.isValid) {
          setIsOfflineSessionExpired(true);
        } else {
          setIsOfflineSessionExpired(false);
        }
      }
    });
    return () => unsubscribe();
  }, [currentChurch]);

  // Load Church Data (IndexedDB first for instant offline readiness, then Firestore sync)
  // SECURITY: Platform Staff NEVER loads private member PII from churches!
  const loadChurchData = useCallback(async () => {
    if (!currentChurch) return;
    if (SecurityPolicy.isPlatformStaff(currentUser)) {
      setMembers([]);
      setDepartments([]);
      setEvents([]);
      return;
    }

    try {
      const pendingQueue = await syncEngine.getPendingQueueForChurch(currentChurch.id);
      const pendingMembers = pendingQueue.filter(q => q.entity === 'MEMBER');
      const pendingDepts = pendingQueue.filter(q => q.entity === 'DEPARTMENT');
      const pendingEvents = pendingQueue.filter(q => q.entity === 'EVENT');

      // 1. Load & merge local IndexedDB and StorageService stores (isolated by churchId)
      const idbMembers = await IndexedDBService.getAll<Member>('members', currentChurch.id);
      const storageMembers = StorageService.getMembers(currentChurch.id);
      const localMembers = mergeTenantRecords({
        localRecords: idbMembers,
        remoteRecords: storageMembers,
        pendingQueueItems: pendingMembers,
      });

      if (localMembers.length > 0) {
        await IndexedDBService.putMany('members', localMembers);
        StorageService.replaceChurchMembers(currentChurch.id, localMembers);
      }
      setMembers(localMembers);

      const idbDepts = await IndexedDBService.getAll<Department>('departments', currentChurch.id);
      const storageDepts = StorageService.getDepartments(currentChurch.id);
      const localDepts = mergeTenantRecords({
        localRecords: idbDepts,
        remoteRecords: storageDepts,
        pendingQueueItems: pendingDepts,
      });

      if (localDepts.length > 0) {
        await IndexedDBService.putMany('departments', localDepts);
        StorageService.replaceChurchDepartments(currentChurch.id, localDepts);
      }
      setDepartments(localDepts);

      const idbEvents = await IndexedDBService.getAll<ChurchEvent>('events', currentChurch.id);
      const storageEvents = StorageService.getEvents(currentChurch.id);
      const localEvents = mergeTenantRecords({
        localRecords: idbEvents,
        remoteRecords: storageEvents,
        pendingQueueItems: pendingEvents,
      });

      if (localEvents.length > 0) {
        await IndexedDBService.putMany('events', localEvents);
        StorageService.replaceChurchEvents(currentChurch.id, localEvents);
      }
      setEvents(localEvents);

      // 2. Refresh & merge with Firestore only when UID profile is verified in Firestore
      if (navigator.onLine && !isSimulatedOffline && auth.currentUser && cloudAccessActive) {
        if (SecurityPolicy.canAccessMembersModule(currentUser, currentChurch.id)) {
          try {
            const deptFilter =
              currentUser?.role === 'DEPARTMENT_LEADER' ? currentUser.departmentIds : undefined;
            const fbMembers = await FirebaseService.getMembers(currentChurch.id, deptFilter);
            const mergedMembers = mergeTenantRecords({
              localRecords: localMembers,
              remoteRecords: fbMembers,
              pendingQueueItems: pendingMembers,
            });
            setMembers(mergedMembers);
            await IndexedDBService.putMany('members', mergedMembers);
            StorageService.replaceChurchMembers(currentChurch.id, mergedMembers);
          } catch (fbErr) {
            console.warn('Firestore member sync skipped or fell back to local cache:', fbErr);
          }
        }

        try {
          const deptFilter =
            currentUser?.role === 'DEPARTMENT_LEADER' ? currentUser.departmentIds : undefined;
          const fbDepts = await FirebaseService.getDepartments(currentChurch.id, deptFilter);
          const mergedDepts = mergeTenantRecords({
            localRecords: localDepts,
            remoteRecords: fbDepts,
            pendingQueueItems: pendingDepts,
          });
          setDepartments(mergedDepts);
          await IndexedDBService.putMany('departments', mergedDepts);
          StorageService.replaceChurchDepartments(currentChurch.id, mergedDepts);
        } catch (deptErr) {
          console.warn('Firestore department sync skipped:', deptErr);
        }

        try {
          const fbEvents = await FirebaseService.getEvents(currentChurch.id);
          const mergedEvents = mergeTenantRecords({
            localRecords: localEvents,
            remoteRecords: fbEvents,
            pendingQueueItems: pendingEvents,
          });
          setEvents(mergedEvents);
          await IndexedDBService.putMany('events', mergedEvents);
          StorageService.replaceChurchEvents(currentChurch.id, mergedEvents);
        } catch (evErr) {
          console.warn('Firestore event sync skipped:', evErr);
        }

        try {
          const fbChurchUsers = await FirebaseService.getUsers(currentChurch.id);
          if (fbChurchUsers.length > 0) {
            const normalizedFbUsers = fbChurchUsers.map(u =>
              u.role === 'GENERAL_SECRETARY' && /filemon\s+soares/i.test((u.name || '').trim())
                ? { ...u, name: 'Silvia' }
                : u
            );
            setUsers(prev => {
              const otherUsers = prev.filter(u => u.churchId !== currentChurch.id);
              const existingLocalChurchUsers = prev.filter(u => u.churchId === currentChurch.id);
              const fbEmailSet = new Set(normalizedFbUsers.map(u => u.email.toLowerCase()));
              const localOnlyUsers = existingLocalChurchUsers.filter(
                lu => !fbEmailSet.has(lu.email.toLowerCase()) && !normalizedFbUsers.some(fu => fu.id === lu.id)
              );
              const merged = [...otherUsers, ...normalizedFbUsers, ...localOnlyUsers];
              StorageService.saveUsers(merged);
              return merged;
            });
          }
        } catch (userErr) {
          console.warn('Firestore church users sync skipped:', userErr);
        }
      }
    } catch (e) {
      console.warn("Offline loading fallback:", e);
      setMembers(StorageService.getMembers(currentChurch.id));
      setDepartments(StorageService.getDepartments(currentChurch.id));
      setEvents(StorageService.getEvents(currentChurch.id));
    }
  }, [currentChurch, currentUser, isSimulatedOffline]);

  useEffect(() => {
    loadChurchData();
  }, [loadChurchData]);

  // Real-time Cloud Firestore listeners (keep Netlify & AI Studio sessions synchronized live)
  useEffect(() => {
    if (!authReady || !auth.currentUser || !currentUser || !currentChurch || isSimulatedOffline || !navigator.onLine || !cloudAccessActive) {
      return;
    }

    const unsubs: Array<() => void> = [];

    if (SecurityPolicy.isPlatformStaff(currentUser)) {
      unsubs.push(
        FirebaseService.subscribeToChurches(fbChurches => {
          setChurches(fbChurches);
          StorageService.saveChurches(fbChurches);
        }, () => {})
      );
      if (currentUser.role === 'PLATFORM_ADMIN') {
        unsubs.push(
          FirebaseService.subscribeToUsers(undefined, fbUsers => {
            if (fbUsers.length > 0) {
              setUsers(fbUsers);
              StorageService.saveUsers(fbUsers);
            }
          }, () => {})
        );
      }
      return () => {
        unsubs.forEach(u => u());
      };
    }

    const targetChurchId = currentChurch.id;
    const deptFilter = currentUser.role === 'DEPARTMENT_LEADER' ? currentUser.departmentIds : undefined;

    unsubs.push(
      FirebaseService.subscribeToChurchById(targetChurchId, fbChurch => {
        if (!fbChurch) return;
        setCurrentChurch(fbChurch);
        setChurches(prev => {
          const next = prev.some(c => c.id === fbChurch.id)
            ? prev.map(c => (c.id === fbChurch.id ? fbChurch : c))
            : [...prev, fbChurch];
          StorageService.saveChurches(next);
          return next;
        });
      }, () => {})
    );

    if (SecurityPolicy.canAccessMembersModule(currentUser, targetChurchId)) {
      unsubs.push(
        FirebaseService.subscribeToMembers(targetChurchId, deptFilter, async fbMembers => {
          const pending = (await syncEngine.getPendingQueueForChurch(targetChurchId)).filter(q => q.entity === 'MEMBER');
          const idbMembers = await IndexedDBService.getAll<Member>('members', targetChurchId);
          const merged = mergeTenantRecords({
            localRecords: idbMembers,
            remoteRecords: fbMembers,
            pendingQueueItems: pending,
          });
          setMembers(merged);
          await IndexedDBService.putMany('members', merged);
          StorageService.replaceChurchMembers(targetChurchId, merged);
        }, () => {})
      );
    }

    unsubs.push(
      FirebaseService.subscribeToDepartments(targetChurchId, deptFilter, async fbDepts => {
        const pending = (await syncEngine.getPendingQueueForChurch(targetChurchId)).filter(q => q.entity === 'DEPARTMENT');
        const idbDepts = await IndexedDBService.getAll<Department>('departments', targetChurchId);
        const merged = mergeTenantRecords({
          localRecords: idbDepts,
          remoteRecords: fbDepts,
          pendingQueueItems: pending,
        });
        setDepartments(merged);
        await IndexedDBService.putMany('departments', merged);
        StorageService.replaceChurchDepartments(targetChurchId, merged);
      }, () => {})
    );

    unsubs.push(
      FirebaseService.subscribeToEvents(targetChurchId, async fbEvents => {
        const pending = (await syncEngine.getPendingQueueForChurch(targetChurchId)).filter(q => q.entity === 'EVENT');
        const idbEvents = await IndexedDBService.getAll<ChurchEvent>('events', targetChurchId);
        const merged = mergeTenantRecords({
          localRecords: idbEvents,
          remoteRecords: fbEvents,
          pendingQueueItems: pending,
        });
        setEvents(merged);
        await IndexedDBService.putMany('events', merged);
        StorageService.replaceChurchEvents(targetChurchId, merged);
      }, () => {})
    );

    unsubs.push(
      FirebaseService.subscribeToUsers(targetChurchId, fbChurchUsers => {
        if (fbChurchUsers.length === 0) return;
        setUsers(prev => {
          const otherUsers = prev.filter(u => u.churchId !== targetChurchId);
          const merged = [...otherUsers, ...fbChurchUsers];
          StorageService.saveUsers(merged);
          return merged;
        });
      }, () => {})
    );

    return () => {
      unsubs.forEach(u => u());
    };
  }, [authReady, currentUser?.id, currentUser?.role, currentChurch?.id, isSimulatedOffline]);

  const handlePullFromCloud = useCallback(async () => {
    if (!auth.currentUser || !navigator.onLine || isSimulatedOffline) return;
    if (SecurityPolicy.isPlatformStaff(currentUser)) {
      const fbChurches = await FirebaseService.getChurches();
      setChurches(fbChurches);
      StorageService.saveChurches(fbChurches);
      if (currentUser?.role === 'PLATFORM_ADMIN') {
        try {
          const fbUsers = await FirebaseService.getUsers();
          if (fbUsers.length > 0) {
            setUsers(fbUsers);
            StorageService.saveUsers(fbUsers);
          }
        } catch {
          // Skip if rules disallow
        }
      }
      return;
    }

    if (currentChurch) {
      const remoteChurch = await FirebaseService.getChurchById(currentChurch.id).catch(() => null);
      if (remoteChurch) {
        setCurrentChurch(remoteChurch);
        setChurches(prev => {
          const next = prev.some(c => c.id === remoteChurch.id)
            ? prev.map(c => (c.id === remoteChurch.id ? remoteChurch : c))
            : [...prev, remoteChurch];
          StorageService.saveChurches(next);
          return next;
        });
      }
      await loadChurchData();
    }
  }, [currentUser, currentChurch, isSimulatedOffline, loadChurchData]);

  const handlePushAllLocalToCloud = useCallback(async (): Promise<{ pushed: number; queued: number }> => {
    if (!currentChurch) return { pushed: 0, queued: 0 };
    if (SecurityPolicy.isPlatformStaff(currentUser)) {
      let pushed = 0;
      for (const c of churches) {
        try {
          await FirebaseService.saveChurch(c);
          pushed++;
        } catch {
          // Ignore individual failures
        }
      }
      return { pushed, queued: 0 };
    }
    const churchUsers = users.filter(u => u.churchId === currentChurch.id);
    return await BackupService.pushChurchLocalDataToCloud(
      currentChurch,
      churchUsers,
      members,
      departments,
      events,
      false
    );
  }, [currentChurch, currentUser, churches, users, members, departments, events]);

  const handleImportNetlifySnapshot = useCallback(
    async (rawJson: string) => {
      const isPlatform = SecurityPolicy.isPlatformStaff(currentUser);
      const res = await BackupService.importFullPlatformSnapshot(rawJson, { isPlatformAdmin: isPlatform });
      setChurches(StorageService.getChurches());
      setUsers(StorageService.getUsers());
      if (currentChurch && !isPlatform) {
        const refreshedChurch = StorageService.getChurches().find(c => c.id === currentChurch.id);
        if (refreshedChurch) setCurrentChurch(refreshedChurch);
        await loadChurchData();
      }
      return res;
    },
    [currentUser, currentChurch, loadChurchData]
  );

  // Automatic periodic full backup scheduler (runs when due for church admins & saves directly in DB)
  useEffect(() => {
    if (!currentChurch || !currentUser) return;
    if (SecurityPolicy.isPlatformStaff(currentUser)) return;
    if (!SecurityPolicy.canManageSettingsAndBackups(currentUser, currentChurch.id)) return;

    const checkAndRunBackup = async () => {
      if (autoBackupInFlightRef.current) return;
      if (!BackupService.isAutoBackupDue(currentChurch)) return;

      autoBackupInFlightRef.current = true;
      try {
        const result = await BackupService.runScheduledBackupIfDue(currentChurch, currentUser);
        if (result.executed && result.updatedChurch) {
          await handleUpdateChurch(result.updatedChurch);
        }
      } catch (err) {
        console.warn('Falha na verificação do backup automático periódico:', err);
      } finally {
        autoBackupInFlightRef.current = false;
      }
    };

    const initialTimer = setTimeout(() => {
      checkAndRunBackup();
    }, 3500);

    const intervalId = setInterval(() => {
      checkAndRunBackup();
    }, 15 * 60 * 1000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalId);
    };
  }, [currentChurch, currentUser]);

  const handleLogin = (church: Church, user: User, cloudSynced?: boolean) => {
    let activeUser = user;
    const isCloudReady = Boolean(cloudSynced);
    setCloudAccessActive(isCloudReady);
    syncEngine.setCloudAccessEnabled(
      isCloudReady,
      SecurityPolicy.isPlatformStaff(activeUser) ? 'PLATFORM' : church.id
    );

    if (
      activeUser.role === 'GENERAL_SECRETARY' &&
      /filemon\s+soares/i.test((activeUser.name || '').trim())
    ) {
      activeUser = { ...activeUser, name: 'Silvia' };
      const updatedUsers = users.some(u => u.id === activeUser.id)
        ? users.map(u => (u.id === activeUser.id ? activeUser : u))
        : [...users, activeUser];
      setUsers(updatedUsers);
      StorageService.saveUsers(updatedUsers);
      IndexedDBService.put('users', activeUser);
      if (auth.currentUser && isCloudReady) {
        FirebaseService.updateUserName(activeUser.id, 'Silvia').catch(() =>
          FirebaseService.saveUser(activeUser).catch(() => {})
        );
      }
    }

    // Persist recovered / logged-in church and user locally so reload/logout always preserves them
    if (!SecurityPolicy.isPlatformStaff(activeUser)) {
      setChurches(prev => {
        const merged = prev.some(c => c.id === church.id)
          ? prev.map(c => (c.id === church.id ? church : c))
          : [...prev, church];
        StorageService.saveChurches(merged);
        return merged;
      });
      setUsers(prev => {
        const merged = prev.some(u => u.id === activeUser.id)
          ? prev.map(u => (u.id === activeUser.id ? activeUser : u))
          : [...prev, activeUser];
        StorageService.saveUsers(merged);
        return merged;
      });
      IndexedDBService.put('users', activeUser).catch(() => {});
    } else if (auth.currentUser && navigator.onLine && isCloudReady) {
      FirebaseService.getChurches()
        .then(fbChurches => {
          setChurches(fbChurches);
          StorageService.saveChurches(fbChurches);
        })
        .catch(() => {});
      FirebaseService.getUsers()
        .then(fbUsers => {
          if (fbUsers.length > 0) {
            setUsers(fbUsers);
            StorageService.saveUsers(fbUsers);
          }
        })
        .catch(() => {});
    }

    setAuthNotice(null);
    setIsSwitchingAccount(false);
    setCurrentChurch(church);
    setCurrentUser(activeUser);
    setCurrentTab(SecurityPolicy.isPlatformStaff(activeUser) ? 'platform-admin' : 'dashboard');
    syncEngine.recordOnlineAuth();
    if (navigator.onLine && auth.currentUser && isCloudReady) {
      syncEngine.processQueue().catch(() => {});
    }

    syncEngine.logAudit({
      churchId: church.id,
      userId: activeUser.id,
      userName: activeUser.name,
      action: 'Acesso ao Sistema (Login)',
      entityType: 'AUTH',
      entityId: activeUser.id,
      details: `Usuário ${activeUser.name} (${activeUser.role}) realizou login com sucesso.`,
    });
  };

  const handleLogout = async (switchAccount = false) => {
    if (currentUser && currentChurch) {
      syncEngine.logAudit({
        churchId: currentChurch.id,
        userId: currentUser.id,
        userName: currentUser.name,
        action: switchAccount ? 'Saída para Troca de Conta' : 'Saída do Sistema (Logout)',
        entityType: 'AUTH',
        entityId: currentUser.id,
        details: `Usuário ${currentUser.name} encerrou a sessão${switchAccount ? ' para entrar com outra conta' : ''}.`,
      });
    }
    try {
      await FirebaseAuthService.signOut();
    } catch (e) {
      console.warn('Erro ao encerrar sessão Firebase:', e);
    }
    setCloudAccessActive(false);
    syncEngine.setCloudAccessEnabled(false);
    setPendingRegistrationUser(null);
    setIsSyncDrawerOpen(false);
    setIsMobileMenuOpen(false);
    setMembers([]);
    setDepartments([]);
    setEvents([]);
    setIsSwitchingAccount(switchAccount);
    setAuthNotice(
      switchAccount
        ? 'Sessão encerrada com segurança. Informe ou escolha outra conta para entrar.'
        : null
    );
    setCurrentChurch(null);
    setCurrentUser(null);
  };

  const handleSwitchChurch = (churchId: string) => {
    const church = churches.find(c => c.id === churchId);
    if (!church || !currentUser) return;
    if (!SecurityPolicy.canSwitchChurchContext(currentUser, church)) {
      syncEngine.logAudit({
        churchId: currentUser.churchId,
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'Tentativa Bloqueada de Troca de Igreja (Multi-Tenant)',
        entityType: 'SECURITY',
        entityId: churchId,
        details: `Usuário ${currentUser.name} tentou acessar contexto da igreja ${church.name} (${churchId}). Bloqueado por isolamento.`,
      });
      return;
    }
    setCurrentChurch(church);
  };

  const handleRegisterChurch = async (newChurch: Church, adminPassword?: string, adminName?: string) => {
    let activeUid = auth.currentUser?.uid;

    // Preserve local confirmation hash if provided
    if (adminPassword && adminPassword.length >= 6) {
      ChurchUserAuthService.setPassword(newChurch.id, newChurch.email, adminPassword);
    }

    // Authenticate with Google if not yet authenticated online so Firestore receives ownerUid
    if (!activeUid && navigator.onLine && !isSimulatedOffline) {
      try {
        const fbUser = await FirebaseAuthService.signInWithGoogle(true);
        activeUid = fbUser.uid;
      } catch (authErr: any) {
        if (authErr?.code === 'auth/popup-closed-by-user' || authErr?.code === 'auth/cancelled-popup-request') {
          console.warn('Cadastro local concluído sem login Google imediato.');
        } else {
          console.warn('Login Google opcional ignorado (seguindo modo local/offline):', authErr);
        }
      }
    }

    const churchWithOwner: Church = activeUid
      ? { ...newChurch, ownerUid: activeUid }
      : newChurch;

    StorageService.markCleanSlate(churchWithOwner.id);

    const updated = [...churches, churchWithOwner];
    setChurches(updated);
    StorageService.saveChurches(updated);

    const resolvedUserName =
      adminName?.trim() ||
      auth.currentUser?.displayName?.trim() ||
      churchWithOwner.email.split('@')[0];

    const newUser: User = {
      id: activeUid || `user-${Date.now()}`,
      churchId: churchWithOwner.id,
      name: resolvedUserName,
      email: churchWithOwner.email.trim().toLowerCase(),
      role: 'GENERAL_SECRETARY',
      status: 'ACTIVE',
      lastLogin: 'Agora',
    };
    const updatedUsers = [...users, newUser];
    setUsers(updatedUsers);
    StorageService.saveUsers(updatedUsers);
    await IndexedDBService.put('users', newUser);

    let regCloudSynced = false;
    if (auth.currentUser && navigator.onLine && !isSimulatedOffline) {
      try {
        await FirebaseService.saveChurch(churchWithOwner);
        await FirebaseService.saveUser(newUser);
        regCloudSynced = true;
      } catch (e) {
        console.warn('Nova igreja salva localmente; sincronização em nuvem pendente:', e);
      }
    }

    setCloudAccessActive(regCloudSynced);
    syncEngine.setCloudAccessEnabled(regCloudSynced, churchWithOwner.id);

    setMembers([]);
    setDepartments([]);
    setEvents([]);
    setCurrentChurch(churchWithOwner);
    setCurrentUser(newUser);
    setCurrentTab('dashboard');

    syncEngine.logAudit({
      churchId: churchWithOwner.id,
      userId: newUser.id,
      userName: newUser.name,
      action: 'Cadastro de Nova Igreja',
      entityType: 'SETTINGS',
      entityId: churchWithOwner.id,
      details: `Igreja "${churchWithOwner.name}" cadastrada com código exclusivo ${churchWithOwner.exclusiveCode}.`,
    });
  };

  const handleLinkPendingAccountToChurch = async ({
    churchId,
    name,
    role,
    password,
    exclusiveCode,
  }: {
    churchId: string;
    name: string;
    role: any;
    password?: string;
    exclusiveCode?: string;
  }) => {
    if (!auth.currentUser) {
      throw new Error('Nenhuma sessão Firebase ativa detectada.');
    }
    const fbUser = auth.currentUser;
    const allChurches = StorageService.getChurches();
    const targetChurch =
      churches.find(c => c.id === churchId) ||
      allChurches.find(c => c.id === churchId) ||
      (exclusiveCode
        ? churches.find(c => (c.exclusiveCode || '').toUpperCase() === exclusiveCode.trim().toUpperCase()) ||
          allChurches.find(c => (c.exclusiveCode || '').toUpperCase() === exclusiveCode.trim().toUpperCase())
        : undefined);

    if (!targetChurch) {
      throw new Error('Igreja selecionada não encontrada.');
    }

    if (exclusiveCode && targetChurch.exclusiveCode) {
      if (exclusiveCode.trim().toUpperCase() !== targetChurch.exclusiveCode.trim().toUpperCase()) {
        throw new Error('Código exclusivo da igreja incorreto.');
      }
    }

    const resolvedEmail = FirebaseAuthService.resolveUserEmail(fbUser);
    const newUser: User = {
      id: fbUser.uid,
      churchId: targetChurch.id,
      name: name.trim() || fbUser.displayName || (resolvedEmail ? resolvedEmail.split('@')[0] : 'Usuário'),
      email: resolvedEmail.trim().toLowerCase(),
      role: role || 'GENERAL_SECRETARY',
      status: 'ACTIVE',
      lastLogin: new Date().toLocaleString('pt-BR'),
    };

    if (password && password.length >= 6) {
      ChurchUserAuthService.setPassword(targetChurch.id, newUser.email, password);
    }

    let updatedChurch = targetChurch;
    let linkCloudSynced = false;
    if (
      (!targetChurch.ownerUid || role === 'GENERAL_SECRETARY') &&
      targetChurch.status === 'PENDING' &&
      targetChurch.plan !== 'FREE_PERMANENT'
    ) {
      updatedChurch = {
        ...targetChurch,
        ownerUid: fbUser.uid,
      };
      try {
        await FirebaseService.saveChurch(updatedChurch);
      } catch (e) {
        console.warn('Atualização de proprietário da igreja no Firestore pendente:', e);
      }
    }

    try {
      await FirebaseService.saveUser(newUser);
      linkCloudSynced = true;
    } catch (e) {
      console.warn('Erro ao salvar usuário no Firestore:', e);
    }

    const updatedChurches = churches.some(c => c.id === updatedChurch.id)
      ? churches.map(c => c.id === updatedChurch.id ? updatedChurch : c)
      : [...churches, updatedChurch];
    setChurches(updatedChurches);
    StorageService.saveChurches(updatedChurches);

    const updatedUsers = [...users.filter(u => u.id !== newUser.id), newUser];
    setUsers(updatedUsers);
    StorageService.saveUsers(updatedUsers);
    await IndexedDBService.put('users', newUser);

    setCloudAccessActive(linkCloudSynced);
    syncEngine.setCloudAccessEnabled(linkCloudSynced, updatedChurch.id);
    setPendingRegistrationUser(null);
    setCurrentChurch(updatedChurch);
    setCurrentUser(newUser);
    setCurrentTab('dashboard');

    syncEngine.logAudit({
      churchId: updatedChurch.id,
      userId: newUser.id,
      userName: newUser.name,
      action: 'Vinculação de Conta Concluída',
      entityType: 'USER',
      entityId: newUser.id,
      details: `Conta Firebase (UID: ${newUser.id}) vinculada à igreja "${updatedChurch.name}" como ${newUser.role}.`,
    });
  };

  // Member Save (Online / Offline with IndexedDB, Firestore, Push Alert and AuditLog)
  const handleSaveMember = async (member: Member) => {
    const existingMember = members.find(m => m.id === member.id);
    const isNew = !existingMember;
    const memberToPersist: Member = {
      ...member,
      updatedAt: member.updatedAt || new Date().toISOString(),
    };
    const updatedList = isNew
      ? [memberToPersist, ...members]
      : members.map(m => m.id === memberToPersist.id ? memberToPersist : m);
    setMembers(updatedList);

    // 1. Save in local IndexedDB & localStorage
    await IndexedDBService.put('members', memberToPersist);
    StorageService.saveMember(memberToPersist);

    // 2. Log in Audit & Trigger Service Worker Push if member status changed
    if (currentUser && currentChurch) {
      await syncEngine.logAudit({
        churchId: currentChurch.id,
        userId: currentUser.id,
        userName: currentUser.name,
        action: isNew ? 'Cadastro de Membro' : 'Atualização de Membro',
        entityType: 'MEMBER',
        entityId: memberToPersist.id,
        details: `${isNew ? 'Novo membro cadastrado' : 'Ficha atualizada'}: ${memberToPersist.fullName} (${memberToPersist.memberCode}). Status: ${memberToPersist.status}`,
      });

      notifyMemberStatusChange(
        currentChurch,
        memberToPersist,
        existingMember?.status,
        memberToPersist.status,
        currentUser.id
      ).catch(() => {});
    }

    // 3. Sync to Firestore immediately or enqueue so local data is preserved and synced later
    if (auth.currentUser && navigator.onLine && !isSimulatedOffline) {
      try {
        await FirebaseService.saveMember(memberToPersist);
      } catch (e) {
        console.warn("Could not save to Firestore, enqueuing for sync:", e);
        await syncEngine.enqueue({
          churchId: memberToPersist.churchId,
          operation: isNew ? 'CREATE' : 'UPDATE',
          entity: 'MEMBER',
          entityId: memberToPersist.id,
          payload: memberToPersist,
        });
      }
    } else {
      await syncEngine.enqueue({
        churchId: memberToPersist.churchId,
        operation: isNew ? 'CREATE' : 'UPDATE',
        entity: 'MEMBER',
        entityId: memberToPersist.id,
        payload: memberToPersist,
      });
    }
  };

  const handleSaveBatchMembers = async (importedMembers: Member[]) => {
    if (importedMembers.length === 0 || !currentChurch) return;
    const stampedMembers = importedMembers.map(m => ({
      ...m,
      updatedAt: m.updatedAt || new Date().toISOString(),
    }));
    const updatedList = [...stampedMembers, ...members];
    setMembers(updatedList);
    StorageService.markCleanSlate(currentChurch.id);
    await IndexedDBService.putMany('members', stampedMembers);
    StorageService.saveMembersBatch(stampedMembers);

    if (currentUser) {
      await syncEngine.logAudit({
        churchId: currentChurch.id,
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'Importação em Lote de Membros (Planilha CSV)',
        entityType: 'MEMBER',
        details: `${stampedMembers.length} membro(s) importado(s) por ${currentUser.name}.`,
      });
    }

    for (const m of stampedMembers) {
      if (auth.currentUser && navigator.onLine && !isSimulatedOffline) {
        try {
          await FirebaseService.saveMember(m);
        } catch {
          await syncEngine.enqueue({
            churchId: m.churchId,
            operation: 'CREATE',
            entity: 'MEMBER',
            entityId: m.id,
            payload: m,
          });
        }
      } else {
        await syncEngine.enqueue({
          churchId: m.churchId,
          operation: 'CREATE',
          entity: 'MEMBER',
          entityId: m.id,
          payload: m,
        });
      }
    }
  };

  const handleClearDemoData = async () => {
    if (!currentChurch) return;
    const targetId = currentChurch.id;
    StorageService.clearChurchDemoData(targetId);

    const clearStoreByChurch = async (store: 'members' | 'departments' | 'events') => {
      const existing = await IndexedDBService.getAll<{ id: string }>(store, targetId);
      for (const rec of existing) {
        await IndexedDBService.delete(store, rec.id);
      }
    };
    await clearStoreByChurch('members');
    await clearStoreByChurch('departments');
    await clearStoreByChurch('events');

    setMembers([]);
    setDepartments([]);
    setEvents([]);

    if (currentUser) {
      await syncEngine.logAudit({
        churchId: targetId,
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'Limpeza de Dados de Demonstração (Início da Base Real)',
        entityType: 'SETTINGS',
        entityId: targetId,
        details: `Registros locais de demonstração removidos por ${currentUser.name} para uso com dados reais.`,
      });
    }
  };

  // Member Delete (Permanent deletion requested by General Secretary)
  const handleDeleteMember = async (memberId: string, reason: string) => {
    const target = members.find(m => m.id === memberId);
    const updatedList = members.filter(m => m.id !== memberId);
    setMembers(updatedList);

    // 1. Remove from local IndexedDB & localStorage
    await IndexedDBService.delete('members', memberId);
    if (currentChurch) {
      StorageService.deleteMember(currentChurch.id, memberId);
    }

    // 2. Log in Audit
    if (currentUser && currentChurch) {
      await syncEngine.logAudit({
        churchId: currentChurch.id,
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'Exclusão Definitiva de Membro',
        entityType: 'MEMBER',
        entityId: memberId,
        details: `Membro ${target?.fullName || memberId} excluído permanentemente por ${currentUser.name}. Motivo registrado: ${reason}`,
      });
    }

    // 3. Sync or enqueue deletion
    if (currentChurch) {
      if (auth.currentUser && navigator.onLine && !isSimulatedOffline) {
        try {
          await FirebaseService.deleteMember(currentChurch.id, memberId);
        } catch {
          await syncEngine.enqueue({
            churchId: currentChurch.id,
            operation: 'DELETE',
            entity: 'MEMBER',
            entityId: memberId,
            payload: null,
          });
        }
      } else {
        await syncEngine.enqueue({
          churchId: currentChurch.id,
          operation: 'DELETE',
          entity: 'MEMBER',
          entityId: memberId,
          payload: null,
        });
      }
    }
  };

  const handleSaveUser = async (user: User, initialPassword?: string) => {
    const isNew = !users.some(u => u.id === user.id);
    const userToPersist = user;

    if (initialPassword && initialPassword.length >= 6) {
      ChurchUserAuthService.setPassword(user.churchId, user.email, initialPassword);
    }

    const updatedUsers = isNew
      ? [...users, userToPersist]
      : users.map(u => (u.id === userToPersist.id ? userToPersist : u));
    setUsers(updatedUsers);
    StorageService.saveUsers(updatedUsers);
    await IndexedDBService.put('users', userToPersist);

    if (currentUser && userToPersist.id === currentUser.id) {
      setCurrentUser(userToPersist);
    }

    if (currentUser && currentChurch) {
      syncEngine.logAudit({
        churchId: SecurityPolicy.isPlatformStaff(currentUser) ? 'PLATFORM' : currentChurch.id,
        userId: currentUser.id,
        userName: currentUser.id === userToPersist.id ? userToPersist.name : currentUser.name,
        action: 'Atualização de Usuário / Permissões',
        entityType: 'USER',
        entityId: userToPersist.id,
        details: `Usuário ${userToPersist.name} (${userToPersist.email}) atualizado. Função: ${userToPersist.role}, Status: ${userToPersist.status}.`,
      });
    }

    if (auth.currentUser && navigator.onLine && !isSimulatedOffline) {
      try {
        if (
          currentUser &&
          userToPersist.id === currentUser.id &&
          userToPersist.role === currentUser.role &&
          userToPersist.status === currentUser.status &&
          userToPersist.name !== currentUser.name
        ) {
          try {
            await FirebaseService.updateUserName(userToPersist.id, userToPersist.name);
          } catch {
            await FirebaseService.saveUser(userToPersist);
          }
        } else {
          await FirebaseService.saveUser(userToPersist);
        }
      } catch {
        await syncEngine.enqueue({
          churchId: userToPersist.churchId,
          operation: isNew ? 'CREATE' : 'UPDATE',
          entity: 'USER',
          entityId: userToPersist.id,
          payload: userToPersist,
        });
      }
    } else {
      await syncEngine.enqueue({
        churchId: userToPersist.churchId,
        operation: isNew ? 'CREATE' : 'UPDATE',
        entity: 'USER',
        entityId: userToPersist.id,
        payload: userToPersist,
      });
    }
  };

  const handleDeleteUser = async (userId: string) => {
    const target = users.find(u => u.id === userId);
    const updatedUsers = users.filter(u => u.id !== userId);
    setUsers(updatedUsers);
    StorageService.saveUsers(updatedUsers);
    await IndexedDBService.delete('users', userId).catch(() => {});

    if (currentUser) {
      await syncEngine.logAudit({
        churchId: SecurityPolicy.isPlatformStaff(currentUser) ? 'PLATFORM' : (currentChurch?.id || 'PLATFORM'),
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'Exclusão de Usuário',
        entityType: 'USER',
        entityId: userId,
        details: `Usuário "${target?.name || userId}" (${target?.email || ''}) removido por ${currentUser.name}.`,
      });
    }

    if (auth.currentUser && navigator.onLine && !isSimulatedOffline) {
      try {
        await FirebaseService.deleteUser(userId);
      } catch (err) {
        console.warn('Exclusão do usuário na nuvem adiada/ignorada:', err);
      }
    }
  };

  const handleCreateChurchFromAdmin = async (
    newChurch: Church,
    initialSecretary?: { name: string; email: string }
  ) => {
    StorageService.markCleanSlate(newChurch.id);
    const nextChurches = [...churches, newChurch];
    setChurches(nextChurches);
    StorageService.saveChurches(nextChurches);

    if (auth.currentUser && navigator.onLine && !isSimulatedOffline) {
      try {
        await FirebaseService.saveChurch(newChurch);
      } catch {
        await syncEngine.enqueue({
          churchId: newChurch.id,
          operation: 'CREATE',
          entity: 'SETTINGS',
          entityId: newChurch.id,
          payload: newChurch,
        });
      }
    } else {
      await syncEngine.enqueue({
        churchId: newChurch.id,
        operation: 'CREATE',
        entity: 'SETTINGS',
        entityId: newChurch.id,
        payload: newChurch,
      });
    }

    if (initialSecretary && initialSecretary.email) {
      const secretaryUser: User = {
        id: `user-${Date.now()}`,
        churchId: newChurch.id,
        name: initialSecretary.name.trim() || newChurch.pastorName,
        email: initialSecretary.email.trim().toLowerCase(),
        role: 'GENERAL_SECRETARY',
        status: 'ACTIVE',
        lastLogin: 'Aguardando acesso',
      };
      await handleSaveUser(secretaryUser);
    }

    if (currentUser) {
      await syncEngine.logAudit({
        churchId: 'PLATFORM',
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'Cadastro de Congregação pela Administração',
        entityType: 'PLATFORM',
        entityId: newChurch.id,
        details: `Congregação "${newChurch.name}" (${newChurch.exclusiveCode}) cadastrada por ${currentUser.name}.${
          initialSecretary ? ` Secretaria autorizada: ${initialSecretary.email}.` : ''
        }`,
      });
    }
  };

  const handleUpdateChurch = async (updatedChurch: Church) => {
    const previousChurch = churches.find(c => c.id === updatedChurch.id);
    const updatedChurches = churches.map(c => c.id === updatedChurch.id ? updatedChurch : c);
    setChurches(updatedChurches);
    StorageService.saveChurches(updatedChurches);
    if (currentChurch?.id === updatedChurch.id) {
      setCurrentChurch(updatedChurch);
    }

    if (auth.currentUser && navigator.onLine && !isSimulatedOffline) {
      try {
        const institutionalKeys: (keyof Church)[] = [
          'name',
          'denomination',
          'cnpj',
          'pastorName',
          'email',
          'phone',
          'address',
          'city',
          'state',
          'zipCode',
          'logoUrl',
          'primaryColor',
          'secondaryColor',
          'offlineConfig',
        ];
        const changedInstitutional: Partial<Church> = {};
        if (previousChurch && !SecurityPolicy.isPlatformStaff(currentUser)) {
          for (const key of institutionalKeys) {
            if (JSON.stringify(previousChurch[key]) !== JSON.stringify(updatedChurch[key])) {
              (changedInstitutional as Record<string, unknown>)[key] = updatedChurch[key];
            }
          }
        }

        if (Object.keys(changedInstitutional).length > 0 && !SecurityPolicy.isPlatformStaff(currentUser)) {
          try {
            await FirebaseService.updateChurchFields(updatedChurch.id, changedInstitutional);
          } catch {
            await FirebaseService.saveChurch(updatedChurch);
          }
        } else {
          await FirebaseService.saveChurch(updatedChurch);
        }
      } catch {
        await syncEngine.enqueue({
          churchId: updatedChurch.id,
          operation: 'UPDATE',
          entity: 'SETTINGS',
          entityId: updatedChurch.id,
          payload: updatedChurch,
        });
      }
    } else {
      await syncEngine.enqueue({
        churchId: updatedChurch.id,
        operation: 'UPDATE',
        entity: 'SETTINGS',
        entityId: updatedChurch.id,
        payload: updatedChurch,
      });
    }
  };

  const handleSaveDepartment = async (dept: Department) => {
    const isNew = !departments.some(d => d.id === dept.id);
    const deptToPersist: Department = {
      ...dept,
      updatedAt: dept.updatedAt || new Date().toISOString(),
    };
    const nextDepts = isNew
      ? [...departments, deptToPersist]
      : departments.map(d => (d.id === deptToPersist.id ? deptToPersist : d));
    setDepartments(nextDepts);
    StorageService.saveDepartment(deptToPersist);
    await IndexedDBService.put('departments', deptToPersist);

    if (currentChurch && currentUser) {
      syncEngine.logAudit({
        churchId: currentChurch.id,
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'Cadastro / Atualização de Departamento',
        entityType: 'DEPARTMENT',
        entityId: deptToPersist.id,
        details: `Departamento "${deptToPersist.name}" atualizado por ${currentUser.name}. Líder: ${deptToPersist.leaderName}.`,
      });
    }

    if (auth.currentUser && navigator.onLine && !isSimulatedOffline) {
      try {
        await FirebaseService.saveDepartment(deptToPersist);
      } catch {
        await syncEngine.enqueue({
          churchId: deptToPersist.churchId,
          operation: isNew ? 'CREATE' : 'UPDATE',
          entity: 'DEPARTMENT',
          entityId: deptToPersist.id,
          payload: deptToPersist,
        });
      }
    } else {
      await syncEngine.enqueue({
        churchId: deptToPersist.churchId,
        operation: isNew ? 'CREATE' : 'UPDATE',
        entity: 'DEPARTMENT',
        entityId: deptToPersist.id,
        payload: deptToPersist,
      });
    }
  };

  const handleDeleteDepartment = async (deptId: string) => {
    if (!currentChurch || !currentUser) return;
    if (!SecurityPolicy.canDeleteDepartment(currentUser, currentChurch.id)) return;

    const targetDept = departments.find(d => d.id === deptId);

    // Unlink deptId from affected members
    const affectedMembers = members.filter(
      m => m.churchId === currentChurch.id && Array.isArray(m.departmentIds) && m.departmentIds.includes(deptId)
    );
    const updatedMembers = members.map(m =>
      m.churchId === currentChurch.id && Array.isArray(m.departmentIds) && m.departmentIds.includes(deptId)
        ? { ...m, departmentIds: m.departmentIds.filter(id => id !== deptId), updatedAt: new Date().toISOString() }
        : m
    );
    if (affectedMembers.length > 0) {
      setMembers(updatedMembers);
      const updatedAffected = updatedMembers.filter(m =>
        affectedMembers.some(orig => orig.id === m.id)
      );
      await IndexedDBService.putMany('members', updatedAffected);
      StorageService.saveMembersBatch(updatedAffected);
    }

    StorageService.deleteDepartment(currentChurch.id, deptId);
    await IndexedDBService.delete('departments', deptId);
    setDepartments(prev => prev.filter(d => d.id !== deptId));

    await syncEngine.logAudit({
      churchId: currentChurch.id,
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'Exclusão de Departamento',
      entityType: 'DEPARTMENT',
      entityId: deptId,
      details: `Departamento "${targetDept?.name || deptId}" excluído por ${currentUser.name}. ${affectedMembers.length} membro(s) desvinculado(s).`,
    });

    if (auth.currentUser && navigator.onLine && !isSimulatedOffline) {
      try {
        await FirebaseService.deleteDepartment(currentChurch.id, deptId);
        for (const orig of affectedMembers) {
          const cleanedMember = updatedMembers.find(m => m.id === orig.id);
          if (cleanedMember) {
            await FirebaseService.saveMember(cleanedMember);
          }
        }
      } catch {
        await syncEngine.enqueue({
          churchId: currentChurch.id,
          operation: 'DELETE',
          entity: 'DEPARTMENT',
          entityId: deptId,
          payload: null,
        });
      }
    } else {
      await syncEngine.enqueue({
        churchId: currentChurch.id,
        operation: 'DELETE',
        entity: 'DEPARTMENT',
        entityId: deptId,
        payload: null,
      });
      for (const orig of affectedMembers) {
        const cleanedMember = updatedMembers.find(m => m.id === orig.id);
        if (cleanedMember) {
          await syncEngine.enqueue({
            churchId: currentChurch.id,
            operation: 'UPDATE',
            entity: 'MEMBER',
            entityId: cleanedMember.id,
            payload: cleanedMember,
          });
        }
      }
    }
  };

  const handleDeleteChurch = async (churchId: string) => {
    if (!currentUser) return;
    if (
      !SecurityPolicy.hasPlatformPermission(currentUser, 'CLOSE_CHURCHES') &&
      currentUser.role !== 'PLATFORM_ADMIN'
    ) {
      return;
    }

    const targetChurch = churches.find(c => c.id === churchId);
    setChurches(prev => prev.filter(c => c.id !== churchId));
    setUsers(prev => prev.filter(u => u.churchId !== churchId));
    StorageService.deleteChurch(churchId);

    const storesToClean = ['members', 'departments', 'events', 'users', 'backups', 'auditLogs', 'syncQueue'] as const;
    for (const store of storesToClean) {
      try {
        const records = await IndexedDBService.getAll<{ id: string }>(store, churchId);
        for (const rec of records) {
          await IndexedDBService.delete(store, rec.id);
        }
      } catch {
        // Ignore local IndexedDB cleanup errors
      }
    }

    await syncEngine.logAudit({
      churchId: 'PLATFORM',
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'Exclusão Definitiva de Igreja Cadastrada',
      entityType: 'PLATFORM',
      entityId: churchId,
      details: `Igreja "${targetChurch?.name || churchId}" (${targetChurch?.exclusiveCode || ''}) excluída pelo administrador da plataforma ${currentUser.name}.`,
    });

    if (auth.currentUser && navigator.onLine && !isSimulatedOffline) {
      try {
        await FirebaseService.deleteChurchCascade(churchId, currentUser.id);
      } catch (err) {
        console.warn('Exclusão na nuvem concluída localmente / adiada:', err);
      }
    }
  };

  const handleResetAllDataForOfficialLaunch = async () => {
    if (!currentUser || currentUser.role !== 'PLATFORM_ADMIN') {
      throw new Error('Somente o Administrador Principal da Plataforma pode zerar a base.');
    }

    if (auth.currentUser && navigator.onLine && !isSimulatedOffline) {
      await FirebaseService.resetAllDataForOfficialLaunch(currentUser.id);
    }

    StorageService.resetAllDataForOfficialLaunch();
    await IndexedDBService.clearAllStores();

    setChurches([]);
    setUsers(StorageService.getUsers());
    setMembers([]);
    setDepartments([]);
    setEvents([]);

    await syncEngine.logAudit({
      churchId: 'PLATFORM',
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'Limpeza Total para Início Oficial do Aplicativo',
      entityType: 'PLATFORM',
      entityId: 'OFFICIAL_LAUNCH_RESET',
      details: `Todas as igrejas cadastradas e dados prévios foram excluídos por ${currentUser.name} para iniciar o uso oficial a partir do primeiro cadastro.`,
    });
  };

  const handleUpdateMember = async (member: Member) => {
    await handleSaveMember(member);
  };

  const handleSaveEvent = async (event: ChurchEvent) => {
    const existingEvent = events.find(e => e.id === event.id);
    const isNew = !existingEvent;
    const eventToPersist: ChurchEvent = {
      ...event,
      updatedAt: event.updatedAt || new Date().toISOString(),
    };
    const nextEvents = isNew
      ? [eventToPersist, ...events]
      : events.map(e => (e.id === eventToPersist.id ? eventToPersist : e));
    setEvents(nextEvents);
    StorageService.saveEvent(eventToPersist);
    await IndexedDBService.put('events', eventToPersist);

    if (currentChurch && currentUser) {
      syncEngine.logAudit({
        churchId: currentChurch.id,
        userId: currentUser.id,
        userName: currentUser.name,
        action: eventToPersist.status === 'CANCELLED' ? 'Cancelamento de Evento' : 'Agendamento de Evento',
        entityType: 'EVENT',
        entityId: eventToPersist.id,
        details: `Evento "${eventToPersist.title}" (${eventToPersist.category}) em ${eventToPersist.location}. Início: ${eventToPersist.startDate}.`,
      });

      const pushAction: 'CREATED' | 'UPDATED' | 'CANCELLED' =
        eventToPersist.status === 'CANCELLED'
          ? 'CANCELLED'
          : isNew
          ? 'CREATED'
          : 'UPDATED';
      notifyImportantEvent(currentChurch, eventToPersist, pushAction, currentUser.id).catch(() => {});
    }

    if (auth.currentUser && navigator.onLine && !isSimulatedOffline) {
      try {
        await FirebaseService.saveEvent(eventToPersist);
      } catch {
        await syncEngine.enqueue({
          churchId: eventToPersist.churchId,
          operation: isNew ? 'CREATE' : 'UPDATE',
          entity: 'EVENT',
          entityId: eventToPersist.id,
          payload: eventToPersist,
        });
      }
    } else {
      await syncEngine.enqueue({
        churchId: eventToPersist.churchId,
        operation: isNew ? 'CREATE' : 'UPDATE',
        entity: 'EVENT',
        entityId: eventToPersist.id,
        payload: eventToPersist,
      });
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-indigo-950 flex items-center justify-center text-white text-sm font-medium">
        Verificando sessão de segurança...
      </div>
    );
  }

  if (pendingRegistrationUser) {
    return (
      <FinalizarCadastroModal
        firebaseUser={pendingRegistrationUser}
        churches={churches}
        onLinkToChurch={handleLinkPendingAccountToChurch}
        onRegisterNewChurch={handleRegisterChurch}
        onSignOut={async () => {
          await FirebaseAuthService.signOut();
          setPendingRegistrationUser(null);
          setCurrentUser(null);
          setCurrentChurch(null);
        }}
      />
    );
  }

  if (!currentChurch || !currentUser) {
    return (
      <AuthScreen 
        churches={churches} 
        users={users} 
        onLogin={handleLogin} 
        onRegisterChurch={handleRegisterChurch}
        onDataImported={() => {
          setChurches(StorageService.getChurches());
          setUsers(StorageService.getUsers());
        }}
        initialNotice={authNotice}
        isSwitchingAccount={isSwitchingAccount}
      />
    );
  }

  // Security Lockout if offline session expired
  if (isOfflineSessionExpired) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-950 via-slate-900 to-indigo-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-2xl dark:bg-gray-900 space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Sessão Offline Expirada</h2>
          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            Por política de segurança da igreja e proteção aos dados sigilosos dos membros, o prazo de tolerância offline ({currentChurch.offlineConfig?.maxOfflineDays || 7} dias) foi atingido.
          </p>
          <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800 text-[11px] text-gray-500">
            Conecte-se à internet para que o sistema valide suas credenciais e sincronize as operações pendentes.
          </div>
          <button
            onClick={() => {
              setIsSimulatedOffline(false);
              syncEngine.recordOnlineAuth();
              setIsOfflineSessionExpired(false);
            }}
            className="w-full py-3 rounded-xl church-btn-primary text-white text-xs font-semibold transition shadow-md"
          >
            Revalidar Credenciais Online
          </button>
        </div>
      </div>
    );
  }

  const currentYearPrefix = String(new Date().getFullYear());
  const currentMonthPrefix = `${currentYearPrefix}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

  const report: SystemReport = {
    totalMembers: members.length,
    activeMembers: members.filter(m => m.status === 'ACTIVE').length,
    inactiveMembers: members.filter(m => m.status !== 'ACTIVE').length,
    totalDepartments: departments.length,
    totalEventsThisMonth: events.filter(
      e => e.status !== 'CANCELLED' && Boolean(e.startDate?.startsWith(currentMonthPrefix))
    ).length,
    baptismsThisYear: members.filter(
      m => Boolean(m.baptismDate && m.baptismDate.startsWith(currentYearPrefix))
    ).length,
  };

  const isPlatformUser = SecurityPolicy.isPlatformStaff(currentUser);
  const isChurchClosed = !isPlatformUser && currentChurch.status === 'CLOSED';

  const renderScreen = () => {
    // 1. Platform Staff Interface (Completely isolated from church member PII)
    if (isPlatformUser) {
      if (
        currentTab === 'platform-admin' ||
        currentTab === 'platform-churches' ||
        currentTab === 'platform-users' ||
        currentTab === 'platform-support' ||
        currentTab === 'platform-monitoring' ||
        currentTab === 'dashboard'
      ) {
        return (
          <PlatformAdminScreen
            currentUser={currentUser}
            churches={churches}
            onCreateChurch={handleCreateChurchFromAdmin}
            onUpdateChurch={handleUpdateChurch}
            onDeleteChurch={handleDeleteChurch}
            onResetAllForLaunch={handleResetAllDataForOfficialLaunch}
            onImportNetlifySnapshot={handleImportNetlifySnapshot}
            onRefreshChurches={async () => {
              if (auth.currentUser && navigator.onLine && !isSimulatedOffline) {
                try {
                  const fbChurches = await FirebaseService.getChurches();
                  setChurches(fbChurches);
                  StorageService.saveChurches(fbChurches);
                  if (currentUser.role === 'PLATFORM_ADMIN') {
                    const fbUsers = await FirebaseService.getUsers().catch(() => []);
                    if (fbUsers.length > 0) {
                      setUsers(fbUsers);
                      StorageService.saveUsers(fbUsers);
                    }
                  }
                } catch (err) {
                  console.warn('Falha ao atualizar lista de igrejas:', err);
                }
              }
            }}
            members={[]}
            departments={[]}
            events={[]}
            allUsers={users}
            onSaveUser={handleSaveUser}
            onDeleteUser={handleDeleteUser}
            selectedNavTab={currentTab}
            onSelectNavTab={setCurrentTab}
          />
        );
      }

      return (
        <div className="rounded-2xl bg-rose-50 p-6 text-center text-rose-900 dark:bg-rose-950 dark:text-rose-200 border border-rose-200 dark:border-rose-800">
          <h2 className="text-lg font-bold">Acesso Isolado (Proteção de Dados dos Membros)</h2>
          <p className="text-sm mt-1">
            Administradores da plataforma e suporte não possuem acesso automático aos cadastros pessoais dos membros das igrejas.
          </p>
        </div>
      );
    }

    // 2. Closed Church State
    if (isChurchClosed) {
      return (
        <div className="max-w-xl mx-auto mt-10 rounded-3xl bg-white p-8 text-center shadow-xl dark:bg-gray-900 border border-rose-200 dark:border-rose-900 space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Igreja Encerrada na Plataforma
          </h2>
          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            Todos os dados, cadastros de membros, backups e históricos da <strong>{currentChurch.name}</strong> permanecem preservados com segurança. Entre em contato com a equipe técnica para reativação.
          </p>
        </div>
      );
    }

    // 3. Church Internal RBAC Guards
    if (currentTab === 'users' && !SecurityPolicy.canManageUsers(currentUser, currentChurch.id)) {
      return (
        <div className="rounded-2xl bg-amber-50 p-6 text-center text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <h2 className="text-lg font-bold">Acesso Restrito</h2>
          <p className="text-sm mt-1">Somente a Secretaria ou o Administrador Geral possuem permissão para gerenciar usuários e permissões.</p>
        </div>
      );
    }

    if (currentTab === 'settings' && !SecurityPolicy.canManageSettingsAndBackups(currentUser, currentChurch.id)) {
      return (
        <div className="rounded-2xl bg-amber-50 p-6 text-center text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <h2 className="text-lg font-bold">Acesso Restrito</h2>
          <p className="text-sm mt-1">Somente a Secretaria ou o Administrador Geral possuem permissão para acessar configurações, auditoria, backups e LGPD.</p>
        </div>
      );
    }

    switch (currentTab) {
      case 'dashboard':
        return (
          <Dashboard 
            church={currentChurch} 
            report={report} 
            currentUser={currentUser} 
            members={members} 
            departments={departments} 
            events={events}
            onNavigate={setCurrentTab}
            onUpdateChurch={handleUpdateChurch}
          />
        );
      case 'members':
        return (
          <MembersScreen 
            church={currentChurch} 
            members={members}
            departments={departments}
            currentUser={currentUser} 
            onSaveMember={handleSaveMember}
            onSaveBatchMembers={handleSaveBatchMembers}
            onDeleteMember={handleDeleteMember}
          />
        );
      case 'departments':
        return (
          <DepartmentsScreen 
            church={currentChurch} 
            departments={departments} 
            members={members} 
            currentUser={currentUser} 
            onSaveDepartment={handleSaveDepartment} 
            onDeleteDepartment={handleDeleteDepartment}
            onUpdateMember={handleUpdateMember} 
          />
        );
      case 'users':
        return (
          <UsersScreen 
            church={currentChurch} 
            users={users} 
            currentUser={currentUser} 
            onSaveUser={handleSaveUser} 
          />
        );
      case 'agenda':
        return (
          <AgendaScreen 
            church={currentChurch} 
            events={events} 
            currentUser={currentUser} 
            onSaveEvent={handleSaveEvent} 
          />
        );
      case 'reports':
        return (
          <ReportsScreen 
            church={currentChurch} 
            report={report} 
            members={members} 
            departments={departments} 
            currentUser={currentUser} 
          />
        );
      case 'support':
        return (
          <ChurchSupportScreen
            church={currentChurch}
            currentUser={currentUser}
          />
        );
      case 'settings':
        return (
          <SettingsScreen 
            church={currentChurch} 
            currentUser={currentUser}
            members={members}
            departments={departments}
            events={events}
            onUpdateChurch={handleUpdateChurch}
            onRefreshData={loadChurchData}
            onClearDemoData={handleClearDemoData}
          />
        );
      default:
        return (
          <Dashboard 
            church={currentChurch} 
            report={report} 
            currentUser={currentUser} 
            members={members} 
            departments={departments} 
            onNavigate={setCurrentTab} 
          />
        );
    }
  };

  return (
    <div
      className="flex h-screen bg-gray-50 text-gray-900 overflow-hidden dark:bg-gray-950 dark:text-gray-100"
      style={buildChurchThemeVars(currentChurch, isPlatformUser)}
    >
      <Sidebar 
        currentTab={currentTab} 
        onSelectTab={setCurrentTab} 
        church={currentChurch}
        currentUser={currentUser}
        onLogout={() => handleLogout(false)}
        isMobileOpen={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
      />

      <div className="flex flex-col flex-1 h-full overflow-hidden">
        <Header 
          church={currentChurch} 
          currentUser={currentUser} 
          churches={churches} 
          onSwitchChurch={handleSwitchChurch} 
          onOpenSyncDrawer={() => setIsSyncDrawerOpen(true)}
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          onLogout={handleLogout}
          pendingSyncCount={pendingSyncCount}
          conflictCount={conflictCount}
          isOffline={!navigator.onLine || isSimulatedOffline}
        />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {renderScreen()}
        </main>
      </div>

      <OfflineIndicator />

      {/* Sync Status, Conflict Resolution & Offline Simulation Drawer */}
      <SyncStatusDrawer
        isOpen={isSyncDrawerOpen}
        onClose={() => setIsSyncDrawerOpen(false)}
        isSimulatedOffline={isSimulatedOffline}
        onToggleSimulateOffline={() => {
          setIsSimulatedOffline(!isSimulatedOffline);
          if (isSimulatedOffline) {
            syncEngine.processQueue();
          }
        }}
        onPullFromCloud={handlePullFromCloud}
        onPushAllLocalToCloud={handlePushAllLocalToCloud}
        onImportNetlifySnapshot={handleImportNetlifySnapshot}
        isPlatformUser={isPlatformUser}
      />
    </div>
  );
}
