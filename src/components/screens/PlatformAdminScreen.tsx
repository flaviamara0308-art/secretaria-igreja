import React, { useEffect, useState } from 'react';
import {
  Church,
  User,
  PlatformPermission,
  SupportTicket,
  TicketMessage,
  TicketStatus,
  Member,
  Department,
  ChurchEvent
} from '../../types';
import { StorageService } from '../../services/storage';
import { auth, FirebaseAuthService, FirebaseService } from '../../services/firebase';
import { syncEngine } from '../../services/syncEngine';
import { BackupService } from '../../services/backupService';
import { PlatformAdminAuthService } from '../../utils/platformAdminAuth';
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  UserPlus,
  Download,
  Trash2,
  Lock,
  Pencil,
  X,
  RefreshCw,
  Upload,
  Building2,
  Users,
  Plus,
  UserCheck,
  Ban,
} from 'lucide-react';

interface PlatformAdminScreenProps {
  currentUser: User;
  churches: Church[];
  onCreateChurch?: (church: Church, initialSecretary?: { name: string; email: string }) => Promise<void> | void;
  onUpdateChurch: (church: Church) => void;
  onDeleteChurch?: (churchId: string) => Promise<void> | void;
  onResetAllForLaunch?: () => Promise<void> | void;
  onRefreshChurches?: () => Promise<void> | void;
  onImportNetlifySnapshot?: (rawJson: string) => Promise<{
    churches: number;
    users: number;
    members: number;
    departments: number;
    events: number;
    syncedToCloud: number;
  }>;
  members: Member[];
  departments: Department[];
  events: ChurchEvent[];
  allUsers: User[];
  onSaveUser: (user: User, initialPassword?: string) => Promise<void> | void;
  onDeleteUser?: (userId: string) => Promise<void> | void;
  selectedNavTab?: string;
  onSelectNavTab?: (navTab: string) => void;
}

const ROLE_LABELS: Record<User['role'], string> = {
  GENERAL_SECRETARY: 'Secretaria Geral',
  ASSISTANT_SECRETARY: 'Secretário(a) Auxiliar',
  PASTOR: 'Pastor',
  DEPARTMENT_LEADER: 'Líder de Departamento',
  ADMIN: 'Administrador Geral (Igreja)',
  SECRETARY: 'Secretaria (Igreja)',
  TREASURER: 'Tesoureiro(a)',
  MEMBER: 'Membro (Consulta)',
  PLATFORM_ADMIN: 'Admin Plataforma',
  PLATFORM_ASSISTANT_ADMIN: 'Admin Auxiliar Plataforma',
};

export const PlatformAdminScreen: React.FC<PlatformAdminScreenProps> = ({
  currentUser,
  churches,
  onCreateChurch,
  onUpdateChurch,
  onDeleteChurch,
  onResetAllForLaunch,
  onRefreshChurches,
  onImportNetlifySnapshot,
  members,
  departments,
  events,
  allUsers,
  onSaveUser,
  onDeleteUser,
  selectedNavTab,
  onSelectNavTab,
}) => {
  type PlatformTab = 'OVERVIEW' | 'CHURCHES' | 'USERS' | 'SUPPORT' | 'MONITORING' | 'CLOSURE';

  const navToPlatformTab = (nav?: string): PlatformTab => {
    switch (nav) {
      case 'platform-churches':
        return 'CHURCHES';
      case 'platform-users':
        return 'USERS';
      case 'platform-support':
        return 'SUPPORT';
      case 'platform-monitoring':
        return 'MONITORING';
      default:
        return 'OVERVIEW';
    }
  };

  const [activeTab, setActiveTab] = useState<PlatformTab>(() => navToPlatformTab(selectedNavTab));

  useEffect(() => {
    if (selectedNavTab) {
      setActiveTab(navToPlatformTab(selectedNavTab));
    }
  }, [selectedNavTab]);

  const selectTab = (tab: PlatformTab) => {
    setActiveTab(tab);
    if (onSelectNavTab) {
      const map: Record<PlatformTab, string> = {
        OVERVIEW: 'platform-admin',
        CHURCHES: 'platform-churches',
        USERS: 'platform-users',
        SUPPORT: 'platform-support',
        MONITORING: 'platform-monitoring',
        CLOSURE: 'platform-admin',
      };
      onSelectNavTab(map[tab]);
    }
  };

  // Search & Filters
  const [churchSearch, setChurchSearch] = useState('');
  const [churchStatusFilter, setChurchStatusFilter] = useState<string>('ALL');
  const [userSearch, setUserSearch] = useState('');
  const [userChurchFilter, setUserChurchFilter] = useState<string>('ALL');
  const [userStatusFilter, setUserStatusFilter] = useState<string>('ALL');

  // Datasets
  const [tickets, setTickets] = useState<SupportTicket[]>(StorageService.getSupportTickets());
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);

  // Modals and action states
  const [selectedChurchForClosure, setSelectedChurchForClosure] = useState<Church | null>(null);
  const [legalRetentionConfirmed, setLegalRetentionConfirmed] = useState(false);
  const [closureConfirmText, setClosureConfirmText] = useState('');
  const [closureSuccessMsg, setClosureSuccessMsg] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'SUCCESS' | 'ERROR'; msg: string } | null>(null);

  // Edit / Suspend / Delete / Create church modals + Official Launch Reset
  const [showNewChurchModal, setShowNewChurchModal] = useState(false);
  const [newChurchForm, setNewChurchForm] = useState({
    name: '',
    denomination: '',
    city: '',
    state: 'SP',
    pastorName: '',
    email: '',
    phone: '',
    cnpj: '',
    createSecretary: true,
    secretaryName: '',
    secretaryEmail: '',
  });
  const [creatingChurch, setCreatingChurch] = useState(false);
  const [churchToEdit, setChurchToEdit] = useState<Church | null>(null);
  const [churchToSuspend, setChurchToSuspend] = useState<Church | null>(null);
  const [churchToDelete, setChurchToDelete] = useState<Church | null>(null);
  const [deleteConfirmChecked, setDeleteConfirmChecked] = useState(false);
  const [deletingChurch, setDeletingChurch] = useState(false);
  const [showOfficialResetModal, setShowOfficialResetModal] = useState(false);
  const [officialResetText, setOfficialResetText] = useState('');
  const [officialResetChecked, setOfficialResetChecked] = useState(false);
  const [resettingLaunch, setResettingLaunch] = useState(false);

  // User Create / Edit / Delete modal state (for both church users & platform admins)
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUserTarget, setEditingUserTarget] = useState<User | null>(null);
  const [userFormName, setUserFormName] = useState('');
  const [userFormEmail, setUserFormEmail] = useState('');
  const [userFormChurchId, setUserFormChurchId] = useState<string>(churches[0]?.id || 'PLATFORM');
  const [userFormRole, setUserFormRole] = useState<User['role']>('GENERAL_SECRETARY');
  const [userFormStatus, setUserFormStatus] = useState<User['status']>('ACTIVE');
  const [userFormPermissions, setUserFormPermissions] = useState<PlatformPermission[]>([
    'SUPPORT',
    'MANAGE_CHURCHES',
  ]);
  const [savingUserForm, setSavingUserForm] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);

  // Support reply state
  const [staffReplyText, setStaffReplyText] = useState('');

  // Platform Admin password change state
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [currentAdminPwd, setCurrentAdminPwd] = useState('');
  const [newAdminPwd, setNewAdminPwd] = useState('');
  const [confirmAdminPwd, setConfirmAdminPwd] = useState('');
  const [pwdErrorMsg, setPwdErrorMsg] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);
  const [usingDefaultPassword, setUsingDefaultPassword] = useState<boolean>(() =>
    PlatformAdminAuthService.isRootPlatformEmail(currentUser.email) &&
    PlatformAdminAuthService.isUsingInitialDefaultPassword()
  );

  const showFeedback = (type: 'SUCCESS' | 'ERROR', msg: string) => {
    setActionFeedback({ type, msg });
    setTimeout(() => setActionFeedback(null), 5000);
  };

  // Permission helpers
  const isPlatformAdminRoot = currentUser.role === 'PLATFORM_ADMIN';
  const hasPermission = (perm: PlatformPermission) => {
    if (isPlatformAdminRoot) return true;
    return currentUser.platformPermissions?.includes(perm) ?? false;
  };

  const [syncingCloud, setSyncingCloud] = useState(false);

  useEffect(() => {
    if (!auth.currentUser || !navigator.onLine) return;
    let active = true;
    const unsubs: Array<() => void> = [];

    if (hasPermission('SUPPORT')) {
      const unsubTickets = FirebaseService.subscribeToTickets(
        fbTickets => {
          if (active) {
            setTickets(fbTickets);
            localStorage.setItem('sec_igreja_support_tickets', JSON.stringify(fbTickets));
          }
        },
        undefined,
        () => {
          // Keep local cache fallback
        }
      );
      unsubs.push(unsubTickets);
    }

    return () => {
      active = false;
      unsubs.forEach(u => u());
    };
  }, [currentUser.id]);

  const handleManualPlatformSync = async () => {
    if (!navigator.onLine) {
      showFeedback('ERROR', 'Conecte-se à internet para sincronizar os dados com o Firestore.');
      return;
    }
    setSyncingCloud(true);
    try {
      if (onRefreshChurches) {
        await onRefreshChurches();
      }
      if (!auth.currentUser) {
        showFeedback('SUCCESS', 'Conectando ao Firebase com Conta Google para sincronizar...');
        try {
          await FirebaseAuthService.signInWithGoogle(true);
        } catch (authErr: any) {
          if (authErr?.code !== 'auth/popup-closed-by-user') {
            showFeedback('ERROR', FirebaseAuthService.getFriendlyAuthError(authErr));
          } else {
            showFeedback('ERROR', 'Autenticação Google cancelada. Necessária para sincronizar com o Firestore.');
          }
          setSyncingCloud(false);
          return;
        }
      }
      if (auth.currentUser) {
        if (hasPermission('SUPPORT')) {
          const fbTickets = await FirebaseService.getSupportTickets();
          setTickets(fbTickets);
          localStorage.setItem('sec_igreja_support_tickets', JSON.stringify(fbTickets));
        }
        showFeedback('SUCCESS', 'Sincronização em tempo real com o Firestore (Netlify ↔ Nuvem) concluída!');
      } else {
        showFeedback('ERROR', 'Conecte-se com sua Conta Google para sincronizar registros na nuvem compartilhada.');
      }
    } catch (err: any) {
      showFeedback('ERROR', err?.message || 'Não foi possível concluir a sincronização com a nuvem.');
    } finally {
      setSyncingCloud(false);
    }
  };

  const handleExportNetlifyPackage = async () => {
    try {
      const snapshot = await BackupService.exportFullPlatformSnapshot();
      BackupService.downloadPlatformSnapshotToDevice(snapshot);
      showFeedback(
        'SUCCESS',
        `Pacote de sincronização exportado (${snapshot.churches.length} igreja(s), ${snapshot.users.length} usuário(s), ${snapshot.members.length} membro(s)).`
      );
    } catch (err: any) {
      showFeedback('ERROR', err?.message || 'Erro ao exportar pacote de sincronização.');
    }
  };

  const handleImportNetlifyPackage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setSyncingCloud(true);
    try {
      const rawJson = await file.text();
      if (onImportNetlifySnapshot) {
        const res = await onImportNetlifySnapshot(rawJson);
        showFeedback(
          'SUCCESS',
          `Dados do Netlify sincronizados: ${res.churches} igreja(s), ${res.users} usuário(s), ${res.members} membro(s). (${res.syncedToCloud} gravado(s) no Firestore).`
        );
      } else {
        const res = await BackupService.importFullPlatformSnapshot(rawJson, { isPlatformAdmin: true });
        if (onRefreshChurches) await onRefreshChurches();
        showFeedback(
          'SUCCESS',
          `Pacote importado: ${res.churches} igreja(s), ${res.users} usuário(s), ${res.members} membro(s).`
        );
      }
    } catch (err: any) {
      showFeedback('ERROR', err?.message || 'Falha ao importar arquivo de sincronização do Netlify.');
    } finally {
      setSyncingCloud(false);
    }
  };

  /* ---------------- OPERATIONAL INDICATORS (100% FREE INSTITUTIONAL SYSTEM) ---------------- */
  const totalChurches = churches.length;
  const activeChurches = churches.filter(c => c.status === 'ACTIVE');
  const pendingChurches = churches.filter(c => c.status === 'PENDING');
  const suspendedChurches = churches.filter(c => c.status === 'SUSPENDED' || c.planStatus === 'SUSPENDED_OVERDUE');
  const authorizedUsers = allUsers.filter(u => u.status === 'ACTIVE');
  const pendingUsers = allUsers.filter(u => u.status === 'PENDING_INVITE');
  const openTickets = tickets.filter(t => t.status === 'OPEN');

  /* ---------------- SUPPORT TICKET STAFF REPLY ---------------- */
  const handleStaffReply = async (newStatus?: TicketStatus) => {
    if (!selectedTicket || (!staffReplyText.trim() && !newStatus)) return;
    if (!hasPermission('SUPPORT')) {
      showFeedback('ERROR', 'Acesso negado: Você não possui permissão de Atendimento ao Suporte.');
      return;
    }

    const messages = [...selectedTicket.messages];
    if (staffReplyText.trim()) {
      const newMsg: TicketMessage = {
        id: `msg-${Date.now()}`,
        ticketId: selectedTicket.id,
        senderId: currentUser.id,
        senderName: currentUser.name,
        senderRole: currentUser.role,
        isStaff: true,
        content: staffReplyText.trim(),
        createdAt: new Date().toISOString(),
      };
      messages.push(newMsg);
    }

    const updatedTicket: SupportTicket = {
      ...selectedTicket,
      status: newStatus || (selectedTicket.status === 'OPEN' ? 'IN_PROGRESS' : selectedTicket.status),
      assignedAdminName: currentUser.name,
      updatedAt: new Date().toISOString(),
      messages
    };

    StorageService.saveSupportTicket(updatedTicket);
    try {
      await FirebaseService.saveSupportTicket(updatedTicket);
    } catch (e) {
      console.warn('Saved ticket locally:', e);
    }

    // Notify church secretary
    StorageService.saveNotification({
      id: `notif-${Date.now()}`,
      churchId: selectedTicket.churchId,
      userId: 'all',
      title: `Resposta no Chamado ${selectedTicket.id}`,
      message: `A equipe de suporte técnico respondeu ao seu chamado "${selectedTicket.subject}". Clique na Central de Ajuda para visualizar.`,
      date: new Date().toLocaleString('pt-BR'),
      read: false,
      type: 'SYSTEM'
    });

    const updatedList = tickets.map(t => t.id === updatedTicket.id ? updatedTicket : t);
    setTickets(updatedList);
    setSelectedTicket(updatedTicket);
    setStaffReplyText('');
  };

  /* ---------------- CHURCH CLOSURE WITH FORMAL RETENTION & AUDIT ---------------- */
  const handleExportFullChurchArchive = (church: Church) => {
    const churchMembers = members.filter(m => m.churchId === church.id);
    const churchDepts = departments.filter(d => d.churchId === church.id);
    const churchEvents = events.filter(e => e.churchId === church.id);
    const churchUsers = allUsers.filter(u => u.churchId === church.id);

    const archive = {
      platformMetadata: {
        exportedAt: new Date().toISOString(),
        exportedBy: currentUser.name,
        exportReason: 'Encerramento de Igreja e Retenção Legal de Dados',
      },
      church,
      members: churchMembers,
      departments: churchDepts,
      events: churchEvents,
      users: churchUsers
    };

    const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ARQUIVO_LEGAL_ENCERRAMENTO_${church.exclusiveCode}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleConfirmChurchClosure = async () => {
    if (!selectedChurchForClosure) return;
    if (!hasPermission('CLOSE_CHURCHES')) {
      showFeedback('ERROR', 'Acesso negado: Você não possui a permissão de Encerramento de Igrejas.');
      return;
    }
    if (!legalRetentionConfirmed) {
      showFeedback('ERROR', 'Confirme as obrigações legais de retenção antes de encerrar a igreja.');
      return;
    }
    if (closureConfirmText.trim().toUpperCase() !== selectedChurchForClosure.exclusiveCode.toUpperCase()) {
      showFeedback('ERROR', `Digite exatamente o código exclusivo (${selectedChurchForClosure.exclusiveCode}) para confirmar.`);
      return;
    }

    // Perform closure
    const closedChurch: Church = {
      ...selectedChurchForClosure,
      status: 'CLOSED',
      closureRequested: false,
      closureLegalRetentionVerified: true
    };

    onUpdateChurch(closedChurch);
    try {
      await FirebaseService.saveChurch(closedChurch);
    } catch (e) {
      console.warn('Saved closure locally:', e);
    }

    // Immutable audit log
    await syncEngine.logAudit({
      churchId: selectedChurchForClosure.id,
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'Encerramento Definitivo de Igreja',
      entityType: 'PLATFORM',
      entityId: selectedChurchForClosure.id,
      details: `Encerramento formal autorizado pelo Administrador da Plataforma (${currentUser.name}) para "${selectedChurchForClosure.name}". Obrigações legais de retenção verificadas e arquivo exportado.`,
    });

    setClosureSuccessMsg(`A igreja "${selectedChurchForClosure.name}" foi encerrada definitivamente no sistema.`);
    setSelectedChurchForClosure(null);
    setClosureConfirmText('');
    setLegalRetentionConfirmed(false);
  };

  /* ---------------- EDIT & DELETE REGISTERED CHURCH ---------------- */
  const handleSaveEditedChurch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!churchToEdit) return;
    if (!hasPermission('MANAGE_CHURCHES') && !isPlatformAdminRoot) {
      showFeedback('ERROR', 'Sem permissão para editar igrejas.');
      return;
    }
    onUpdateChurch(churchToEdit);
    await syncEngine.logAudit({
      churchId: churchToEdit.id,
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'Alteração Cadastral de Igreja (Administração)',
      entityType: 'PLATFORM',
      entityId: churchToEdit.id,
      details: `Dados cadastrais e plano da igreja "${churchToEdit.name}" atualizados por ${currentUser.name}.`,
    });
    showFeedback('SUCCESS', `Igreja "${churchToEdit.name}" atualizada com sucesso!`);
    setChurchToEdit(null);
  };

  const handleConfirmDeleteChurch = async () => {
    if (!churchToDelete || !onDeleteChurch) return;
    if (!hasPermission('CLOSE_CHURCHES') && !isPlatformAdminRoot) {
      showFeedback('ERROR', 'Sem permissão para excluir igrejas.');
      return;
    }
    try {
      setDeletingChurch(true);
      const deletedId = churchToDelete.id;
      const deletedName = churchToDelete.name;
      await onDeleteChurch(deletedId);
      setTickets(prev => prev.filter(t => t.churchId !== deletedId));
      setChurchToDelete(null);
      setDeleteConfirmChecked(false);
      showFeedback('SUCCESS', `Igreja "${deletedName}" excluída definitivamente.`);
    } catch (err: any) {
      showFeedback('ERROR', err?.message || 'Não foi possível excluir a igreja.');
    } finally {
      setDeletingChurch(false);
    }
  };

  const handleConfirmOfficialLaunchReset = async () => {
    if (!isPlatformAdminRoot || !onResetAllForLaunch) return;
    if (!officialResetChecked || officialResetText.trim().toUpperCase() !== 'ZERAR BASE') {
      showFeedback('ERROR', 'Confirme a caixa de verificação e digite exatamente "ZERAR BASE".');
      return;
    }
    try {
      setResettingLaunch(true);
      await onResetAllForLaunch();
      setTickets([]);
      setSelectedTicket(null);
      setChurchSearch('');
      setChurchStatusFilter('ALL');
      setShowOfficialResetModal(false);
      setOfficialResetChecked(false);
      setOfficialResetText('');
      showFeedback(
        'SUCCESS',
        'Todas as igrejas e dados prévios foram excluídos! O aplicativo está zerado e pronto para o primeiro cadastro oficial.'
      );
    } catch (err: any) {
      showFeedback('ERROR', err?.message || 'Não foi possível concluir a limpeza completa da base.');
    } finally {
      setResettingLaunch(false);
    }
  };

  /* ---------------- CREATE NEW CONGREGATION & OPTIONAL GENERAL SECRETARY ---------------- */
  const openNewChurchModal = () => {
    setNewChurchForm({
      name: '',
      denomination: '',
      city: '',
      state: 'SP',
      pastorName: '',
      email: '',
      phone: '',
      cnpj: '',
      createSecretary: true,
      secretaryName: '',
      secretaryEmail: '',
    });
    setShowNewChurchModal(true);
  };

  const handleCreateNewChurch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasPermission('MANAGE_CHURCHES') && !isPlatformAdminRoot) {
      showFeedback('ERROR', 'Sem permissão para cadastrar congregações.');
      return;
    }
    if (!newChurchForm.name.trim()) {
      showFeedback('ERROR', 'Informe o nome da congregação / igreja.');
      return;
    }

    const code = `IG-${Math.floor(1000 + Math.random() * 9000)}`;
    const primaryEmail = (
      newChurchForm.email.trim() ||
      newChurchForm.secretaryEmail.trim() ||
      currentUser.email
    ).toLowerCase();

    const createdChurch: Church = {
      id: `church-${Date.now()}`,
      name: newChurchForm.name.trim(),
      denomination: newChurchForm.denomination.trim() || 'Cristã Evangélica',
      cnpj: newChurchForm.cnpj.trim(),
      pastorName: newChurchForm.pastorName.trim() || newChurchForm.secretaryName.trim() || 'Secretaria Geral',
      email: primaryEmail,
      phone: newChurchForm.phone.trim(),
      address: '',
      city: newChurchForm.city.trim(),
      state: newChurchForm.state.trim().toUpperCase() || 'SP',
      zipCode: '',
      primaryColor: '#1e3a8a',
      secondaryColor: '#3b82f6',
      exclusiveCode: code,
      status: 'ACTIVE',
      plan: 'FREE',
      planStatus: 'ACTIVE',
      createdAt: new Date().toISOString(),
      offlineConfig: {
        maxOfflineDays: 7,
        autoBackupDaily: true,
      },
    };

    const initialSec =
      newChurchForm.createSecretary && newChurchForm.secretaryEmail.trim()
        ? {
            name: newChurchForm.secretaryName.trim() || createdChurch.pastorName,
            email: newChurchForm.secretaryEmail.trim().toLowerCase(),
          }
        : undefined;

    try {
      setCreatingChurch(true);
      if (onCreateChurch) {
        await onCreateChurch(createdChurch, initialSec);
      } else {
        const updatedList = [...churches, createdChurch];
        StorageService.saveChurches(updatedList);
        await FirebaseService.saveChurch(createdChurch);
        if (initialSec) {
          const secUser: User = {
            id: `user-${Date.now()}`,
            churchId: createdChurch.id,
            name: initialSec.name,
            email: initialSec.email,
            role: 'GENERAL_SECRETARY',
            status: 'ACTIVE',
            lastLogin: 'Nunca',
          };
          await onSaveUser(secUser);
        }
      }
      setShowNewChurchModal(false);
      showFeedback(
        'SUCCESS',
        `Congregação "${createdChurch.name}" cadastrada e ativada (Código: ${code})${
          initialSec ? ` com Gmail autorizado para ${initialSec.email}` : ''
        }!`
      );
    } catch (err: any) {
      showFeedback('ERROR', err?.message || 'Não foi possível cadastrar a congregação.');
    } finally {
      setCreatingChurch(false);
    }
  };

  /* ---------------- CREATE / EDIT / AUTHORIZE USER ---------------- */
  const openCreateUserModal = (presetChurchId?: string) => {
    const defaultChurchId = presetChurchId || churches[0]?.id || 'PLATFORM';
    setEditingUserTarget(null);
    setUserFormName('');
    setUserFormEmail('');
    setUserFormChurchId(defaultChurchId);
    setUserFormRole(defaultChurchId === 'PLATFORM' ? 'PLATFORM_ASSISTANT_ADMIN' : 'GENERAL_SECRETARY');
    setUserFormStatus('ACTIVE');
    setUserFormPermissions(['SUPPORT', 'MANAGE_CHURCHES']);
    setShowUserModal(true);
  };

  const openEditUserModal = (target: User) => {
    setEditingUserTarget(target);
    setUserFormName(target.name);
    setUserFormEmail(target.email);
    setUserFormChurchId(target.churchId);
    setUserFormRole(target.role);
    setUserFormStatus(target.status);
    setUserFormPermissions(target.platformPermissions || ['SUPPORT', 'MANAGE_CHURCHES']);
    setShowUserModal(true);
  };

  const handleUserModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPlatformAdminRoot) {
      showFeedback('ERROR', 'Somente a Administradora Principal pode cadastrar e autorizar usuários aqui.');
      return;
    }
    const cleanEmail = userFormEmail.trim().toLowerCase();
    if (!cleanEmail || !userFormName.trim()) {
      showFeedback('ERROR', 'Preencha o nome completo e o e-mail (Gmail).');
      return;
    }

    const isPlatformRole =
      userFormChurchId === 'PLATFORM' ||
      userFormRole === 'PLATFORM_ADMIN' ||
      userFormRole === 'PLATFORM_ASSISTANT_ADMIN';

    const targetChurchId = isPlatformRole ? 'PLATFORM' : userFormChurchId;
    const duplicate = allUsers.find(
      u =>
        u.email.toLowerCase() === cleanEmail &&
        u.churchId === targetChurchId &&
        u.id !== editingUserTarget?.id
    );
    if (duplicate) {
      showFeedback('ERROR', `Já existe um usuário com o e-mail ${cleanEmail} nesta congregação.`);
      return;
    }

    const userPayload: User = {
      ...(editingUserTarget || {}),
      id: editingUserTarget?.id || `user-${Date.now()}`,
      churchId: targetChurchId,
      name: userFormName.trim(),
      email: cleanEmail,
      role: userFormRole,
      ...(userFormRole === 'PLATFORM_ADMIN'
        ? {
            platformPermissions: [
              'MANAGE_CHURCHES',
              'MANAGE_FINANCES',
              'SUPPORT',
              'PLATFORM_SETTINGS',
              'TECHNICAL_MONITORING',
              'SUBSCRIPTIONS',
              'CLOSE_CHURCHES',
            ] as PlatformPermission[],
          }
        : userFormRole === 'PLATFORM_ASSISTANT_ADMIN'
        ? { platformPermissions: userFormPermissions }
        : { platformPermissions: undefined }),
      status: userFormStatus,
      lastLogin: editingUserTarget?.lastLogin || 'Aguardando acesso',
    };

    try {
      setSavingUserForm(true);
      await onSaveUser(userPayload);
      await syncEngine.logAudit({
        churchId: 'PLATFORM',
        userId: currentUser.id,
        userName: currentUser.name,
        action: editingUserTarget ? 'Atualização / Autorização de Usuário' : 'Cadastro e Autorização de Usuário',
        entityType: 'SECURITY',
        entityId: userPayload.id,
        details: `Usuário "${userPayload.name}" (${userPayload.email}) vinculado a ${targetChurchId} como ${userPayload.role} (${userPayload.status}).`,
      });
      setShowUserModal(false);
      setEditingUserTarget(null);
      showFeedback(
        'SUCCESS',
        editingUserTarget
          ? `Usuário "${userPayload.name}" atualizado (${userPayload.status === 'ACTIVE' ? 'Autorizado' : userPayload.status}).`
          : `Usuário "${userPayload.name}" cadastrado e autorizado para entrar com Gmail (${userPayload.email})!`
      );
    } catch (err: any) {
      showFeedback('ERROR', err?.message || 'Não foi possível salvar o usuário.');
    } finally {
      setSavingUserForm(false);
    }
  };

  const handleQuickToggleUserStatus = async (target: User, newStatus: User['status']) => {
    if (!isPlatformAdminRoot) return;
    if (target.id === currentUser.id || PlatformAdminAuthService.isRootPlatformEmail(target.email)) {
      showFeedback('ERROR', 'A conta proprietária principal não pode ser bloqueada.');
      return;
    }
    const updated: User = { ...target, status: newStatus };
    await onSaveUser(updated);
    showFeedback(
      'SUCCESS',
      newStatus === 'ACTIVE'
        ? `Acesso de ${target.name} (${target.email}) autorizado!`
        : `Acesso de ${target.name} bloqueado.`
    );
  };

  const handleConfirmDeleteUser = async () => {
    if (!userToDelete || !onDeleteUser) return;
    try {
      setDeletingUser(true);
      const removed = userToDelete;
      await onDeleteUser(removed.id);
      setUserToDelete(null);
      showFeedback('SUCCESS', `Usuário "${removed.name}" (${removed.email}) removido.`);
    } catch (err: any) {
      showFeedback('ERROR', err?.message || 'Não foi possível remover o usuário.');
    } finally {
      setDeletingUser(false);
    }
  };

  const togglePermission = (perm: PlatformPermission) => {
    if (userFormPermissions.includes(perm)) {
      setUserFormPermissions(userFormPermissions.filter(p => p !== perm));
    } else {
      setUserFormPermissions([...userFormPermissions, perm]);
    }
  };

  const churchNameById = (churchId: string) => {
    if (churchId === 'PLATFORM') return 'Administração Geral da Plataforma';
    return churches.find(c => c.id === churchId)?.name || churchId;
  };

  const filteredUsersList = allUsers.filter(u => {
    const q = userSearch.trim().toLowerCase();
    const matchesSearch =
      !q ||
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      churchNameById(u.churchId).toLowerCase().includes(q);
    const matchesChurch = userChurchFilter === 'ALL' || u.churchId === userChurchFilter;
    const matchesStatus = userStatusFilter === 'ALL' || u.status === userStatusFilter;
    return matchesSearch && matchesChurch && matchesStatus;
  });

  return (
    <div className="space-y-6">

      {/* HEADER BANNER */}
      <div className="rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 p-6 sm:p-7 text-white shadow-xl border border-indigo-900/60 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 shadow-inner">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                Painel Administrativo Geral
              </h1>
              <p className="text-xs text-indigo-200/85 mt-0.5">
                {currentUser.name} • {currentUser.email}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(hasPermission('MANAGE_CHURCHES') || isPlatformAdminRoot) && (
              <button
                type="button"
                onClick={openNewChurchModal}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition whitespace-nowrap"
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>+ Congregação</span>
              </button>
            )}
            {isPlatformAdminRoot && (
              <button
                type="button"
                onClick={() => openCreateUserModal()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition whitespace-nowrap"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>+ Autorizar Usuário</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleManualPlatformSync}
              disabled={syncingCloud}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 px-3.5 py-2 text-xs font-semibold text-white transition disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingCloud ? 'animate-spin' : ''}`} />
              <span>Sincronizar Nuvem</span>
            </button>
            {isPlatformAdminRoot && (
              <button
                type="button"
                onClick={() => {
                  setCurrentAdminPwd('');
                  setNewAdminPwd('');
                  setConfirmAdminPwd('');
                  setPwdErrorMsg(null);
                  setShowChangePasswordModal(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 px-3.5 py-2 text-xs font-semibold text-white transition whitespace-nowrap"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Alterar Senha</span>
              </button>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-indigo-900/60 text-xs font-semibold">
          {[
            { id: 'OVERVIEW', label: 'Visão Geral', perm: null },
            {
              id: 'CHURCHES',
              label: `Congregações (${churches.length})${pendingChurches.length > 0 ? ` • ${pendingChurches.length} pend.` : ''}`,
              perm: 'MANAGE_CHURCHES' as PlatformPermission,
            },
            {
              id: 'USERS',
              label: `Usuários e Autorizações (${allUsers.length})${pendingUsers.length > 0 ? ` • ${pendingUsers.length} pend.` : ''}`,
              perm: null,
              rootOnly: true,
            },
            { id: 'SUPPORT', label: `Suporte (${openTickets.length})`, perm: 'SUPPORT' as PlatformPermission },
            { id: 'MONITORING', label: 'Sistema', perm: 'TECHNICAL_MONITORING' as PlatformPermission },
            { id: 'CLOSURE', label: 'Encerramentos', perm: 'CLOSE_CHURCHES' as PlatformPermission },
          ].map(tab => {
            if (tab.rootOnly && !isPlatformAdminRoot) return null;
            if (tab.perm && !hasPermission(tab.perm)) return null;

            return (
              <button
                key={tab.id}
                onClick={() => selectTab(tab.id as PlatformTab)}
                className={`px-3.5 py-2 rounded-xl transition whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-white text-slate-900 font-bold shadow-md'
                    : 'text-indigo-200 hover:bg-white/10'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {usingDefaultPassword && (
        <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 p-4 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <span>
              <strong>Senha inicial temporária em uso:</strong> Você está usando a senha provisória padrão (123456). Recomendamos alterá-la agora para proteger a administração geral.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setCurrentAdminPwd('');
              setNewAdminPwd('');
              setConfirmAdminPwd('');
              setPwdErrorMsg(null);
              setShowChangePasswordModal(true);
            }}
            className="self-start sm:self-center flex-shrink-0 rounded-xl bg-amber-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-amber-800 transition"
          >
            Trocar Senha Agora
          </button>
        </div>
      )}

      {actionFeedback && (
        <div
          className={`rounded-2xl p-4 border text-xs flex items-center justify-between ${
            actionFeedback.type === 'SUCCESS'
              ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionFeedback.type === 'SUCCESS' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0" />
            )}
            <span className="font-semibold">{actionFeedback.msg}</span>
          </div>
          <button onClick={() => setActionFeedback(null)} className="font-bold px-2">
            OK
          </button>
        </div>
      )}

      {closureSuccessMsg && (
        <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950 p-4 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span>{closureSuccessMsg}</span>
          </div>
          <button onClick={() => setClosureSuccessMsg(null)} className="text-emerald-700 font-bold">OK</button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: OVERVIEW                                                           */}
      {/* ========================================================================= */}
      {activeTab === 'OVERVIEW' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 space-y-1">
              <span className="text-[11px] font-semibold text-gray-500">Congregações</span>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalChurches}</p>
              <span className="text-[11px] text-gray-400">Cadastradas</span>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/20 space-y-1">
              <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Ativas</span>
              <p className="text-2xl font-bold text-emerald-800 dark:text-emerald-200">{activeChurches.length}</p>
              <span className="text-[11px] text-emerald-600">Em operação</span>
            </div>

            <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/20 space-y-1">
              <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">Usuários Autorizados</span>
              <p className="text-2xl font-bold text-blue-800 dark:text-blue-200">{authorizedUsers.length}</p>
              <span className="text-[11px] text-blue-600">Acesso liberado</span>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/20 space-y-1">
              <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">Aguardando Liberação</span>
              <p className="text-2xl font-bold text-amber-800 dark:text-amber-200">
                {pendingChurches.length + pendingUsers.length}
              </p>
              <span className="text-[11px] text-amber-600">Igrejas / Usuários</span>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 space-y-1">
              <span className="text-[11px] font-semibold text-slate-500">Chamados Abertos</span>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{openTickets.length}</p>
              <span className="text-[11px] text-slate-400">Suporte técnico</span>
            </div>
          </div>

          {/* Quick Actions for Official Day-to-Day Operation */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">Cadastrar Congregação / Igreja</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Adicione novas congregações com código exclusivo e já libere o Gmail da Secretaria Geral.
                </p>
              </div>
              <button
                type="button"
                onClick={openNewChurchModal}
                className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-800 transition whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>Nova Congregação</span>
              </button>
            </div>

            {isPlatformAdminRoot && (
              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">Cadastrar e Autorizar Usuários</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Libere contas Gmail para secretarias, pastores, líderes de departamento ou equipe administrativa.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openCreateUserModal()}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800 transition whitespace-nowrap"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Novo Usuário</span>
                </button>
              </div>
            )}
          </div>

          {/* Pending Authorizations Section */}
          {(pendingChurches.length > 0 || pendingUsers.length > 0) && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 dark:border-amber-900 dark:bg-amber-950/30 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                  Pendências de Autorização ({pendingChurches.length + pendingUsers.length})
                </h3>
              </div>

              <div className="space-y-2">
                {pendingChurches.map(c => (
                  <div
                    key={c.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl bg-white dark:bg-gray-900 p-3 border border-amber-200/80 dark:border-gray-800 text-xs"
                  >
                    <div>
                      <span className="font-bold text-gray-900 dark:text-white">{c.name}</span>
                      <span className="ml-2 font-mono text-[11px] text-gray-500">({c.exclusiveCode})</span>
                      <p className="text-[11px] text-gray-500">Congregação pendente de ativação • {c.email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateChurch({ ...c, status: 'ACTIVE', planStatus: 'ACTIVE' });
                        showFeedback('SUCCESS', `Congregação "${c.name}" ativada com sucesso!`);
                      }}
                      className="self-start sm:self-center inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 transition whitespace-nowrap"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Ativar Congregação</span>
                    </button>
                  </div>
                ))}

                {pendingUsers.map(u => (
                  <div
                    key={u.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl bg-white dark:bg-gray-900 p-3 border border-amber-200/80 dark:border-gray-800 text-xs"
                  >
                    <div>
                      <span className="font-bold text-gray-900 dark:text-white">{u.name}</span>
                      <span className="ml-2 text-gray-500">{u.email}</span>
                      <p className="text-[11px] text-gray-500">
                        {churchNameById(u.churchId)} • {ROLE_LABELS[u.role] || u.role}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleQuickToggleUserStatus(u, 'ACTIVE')}
                      className="self-start sm:self-center inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 transition whitespace-nowrap"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Autorizar Usuário</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {openTickets.length > 0 && (
            <div className="rounded-2xl bg-blue-50 border border-blue-200 p-4 dark:bg-blue-950/40 dark:border-blue-900 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-blue-600" />
                <span className="text-xs font-semibold text-blue-900 dark:text-blue-200">
                  Existem {openTickets.length} chamado(s) de suporte aguardando atendimento.
                </span>
              </div>
              <button
                onClick={() => selectTab('SUPPORT')}
                className="px-3.5 py-1.5 rounded-xl bg-blue-700 text-white font-semibold text-xs hover:bg-blue-800 transition whitespace-nowrap"
              >
                Abrir Suporte
              </button>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: CONGREGAÇÕES / IGREJAS (MANAGE_CHURCHES)                           */}
      {/* ========================================================================= */}
      {activeTab === 'CHURCHES' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Congregações e Igrejas</h2>
              <p className="text-xs text-gray-500">
                Cadastre novas congregações, ative acessos pendentes e gerencie informações institucionais.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Buscar por nome, código ou cidade..."
                value={churchSearch}
                onChange={(e) => setChurchSearch(e.target.value)}
                className="rounded-xl border border-gray-300 dark:border-gray-700 p-2 text-xs dark:bg-gray-800 dark:text-white w-56"
              />
              <select
                value={churchStatusFilter}
                onChange={(e) => setChurchStatusFilter(e.target.value)}
                className="rounded-xl border border-gray-300 dark:border-gray-700 p-2 text-xs dark:bg-gray-800 dark:text-white"
              >
                <option value="ALL">Todas as Situações</option>
                <option value="ACTIVE">Ativas</option>
                <option value="PENDING">Pendentes</option>
                <option value="SUSPENDED">Suspensas</option>
                <option value="CLOSED">Encerradas</option>
              </select>
              <button
                type="button"
                onClick={openNewChurchModal}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-800 transition shadow-sm whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Cadastrar Congregação</span>
              </button>
              {isPlatformAdminRoot && onResetAllForLaunch && churches.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setOfficialResetChecked(false);
                    setOfficialResetText('');
                    setShowOfficialResetModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-2 text-xs font-bold text-white hover:bg-rose-700 transition shadow-sm whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Zerar Base</span>
                </button>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-gray-600 dark:text-gray-300">
                <thead className="bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
                  <tr>
                    <th className="p-4">Congregação & Código</th>
                    <th className="p-4">Pastor / Contato</th>
                    <th className="p-4">Localização & CNPJ</th>
                    <th className="p-4">Usuários</th>
                    <th className="p-4">Situação</th>
                    <th className="p-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {churches
                    .filter(c => {
                      const matchesSearch =
                        c.name.toLowerCase().includes(churchSearch.toLowerCase()) ||
                        c.exclusiveCode.toLowerCase().includes(churchSearch.toLowerCase()) ||
                        c.city.toLowerCase().includes(churchSearch.toLowerCase());
                      const matchesStatus =
                        churchStatusFilter === 'ALL' ||
                        c.status === churchStatusFilter ||
                        c.planStatus === churchStatusFilter;
                      return matchesSearch && matchesStatus;
                    })
                    .map(c => {
                      const churchUserCount = allUsers.filter(u => u.churchId === c.id).length;

                      return (
                        <tr key={c.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/40">
                          <td className="p-4">
                            <span className="font-bold text-gray-900 dark:text-white block">{c.name}</span>
                            <span className="font-mono text-[11px] text-gray-400">{c.exclusiveCode}</span>
                          </td>
                          <td className="p-4">
                            <span className="block font-medium">{c.pastorName}</span>
                            <span className="text-[11px] text-gray-400">{c.email}</span>
                          </td>
                          <td className="p-4">
                            <span>{c.city ? `${c.city} - ${c.state}` : c.state || '—'}</span>
                            <span className="block text-[11px] text-gray-400">{c.cnpj || 'Sem CNPJ'}</span>
                          </td>
                          <td className="p-4">
                            <span className="font-semibold text-gray-700 dark:text-gray-300">
                              {churchUserCount} usuário(s)
                            </span>
                          </td>
                          <td className="p-4">
                            {c.status === 'CLOSED' ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-700">
                                Encerrada
                              </span>
                            ) : c.status === 'PENDING' ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                                Pendente
                              </span>
                            ) : c.planStatus === 'SUSPENDED_OVERDUE' || c.status === 'SUSPENDED' ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200">
                                Suspensa
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                                Ativa
                              </span>
                            )}
                          </td>
                          <td className="p-4 text-right">
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              {c.status === 'PENDING' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onUpdateChurch({ ...c, status: 'ACTIVE', planStatus: 'ACTIVE' });
                                    showFeedback('SUCCESS', `Congregação "${c.name}" autorizada e ativada!`);
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 whitespace-nowrap"
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Ativar</span>
                                </button>
                              )}
                              {isPlatformAdminRoot && (
                                <button
                                  type="button"
                                  onClick={() => openCreateUserModal(c.id)}
                                  title="Autorizar usuário nesta congregação"
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-emerald-200 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300 whitespace-nowrap"
                                >
                                  <UserPlus className="w-3 h-3" />
                                  <span>+ Usuário</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setChurchToEdit(c)}
                                title="Editar dados da congregação"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-blue-200 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-950/40 whitespace-nowrap"
                              >
                                <Pencil className="w-3 h-3" />
                                <span>Editar</span>
                              </button>

                              {c.status === 'ACTIVE' && c.planStatus !== 'SUSPENDED_OVERDUE' ? (
                                <button
                                  type="button"
                                  onClick={() => setChurchToSuspend(c)}
                                  className="px-2 py-1 rounded-lg border border-gray-300 text-[11px] text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 whitespace-nowrap"
                                >
                                  Suspender
                                </button>
                              ) : c.status !== 'CLOSED' && c.status !== 'PENDING' ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated: Church = { ...c, status: 'ACTIVE', planStatus: 'ACTIVE' };
                                    onUpdateChurch(updated);
                                    showFeedback('SUCCESS', `Congregação "${c.name}" reativada com sucesso.`);
                                  }}
                                  className="px-2 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 whitespace-nowrap"
                                >
                                  Reativar
                                </button>
                              ) : null}

                              {(hasPermission('CLOSE_CHURCHES') || isPlatformAdminRoot) && onDeleteChurch && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeleteConfirmChecked(false);
                                    setChurchToDelete(c);
                                  }}
                                  title="Excluir congregação"
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-bold hover:bg-rose-700 transition whitespace-nowrap"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>Excluir</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  {churches.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-xs text-gray-500 dark:text-gray-400">
                        Nenhuma congregação cadastrada ainda. Clique em <strong>Cadastrar Congregação</strong> para iniciar.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}



      {/* ========================================================================= */}
      {/* TAB 5: CENTRAL DE ATENDIMENTO AO SUPORTE TÉCNICO (SUPPORT)                 */}
      {/* ========================================================================= */}
      {activeTab === 'SUPPORT' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Central de Atendimento ao Suporte Técnico</h2>
              <p className="text-xs text-gray-500">
                Atendimento direto aos chamados abertos pelas Secretarias das Igrejas.
              </p>
            </div>
          </div>

          {selectedTicket ? (
            /* TICKET CHAT THREAD */
            <div className="rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 overflow-hidden">
              <div className="border-b border-gray-200 dark:border-gray-800 p-6 bg-gray-50/60 dark:bg-gray-950/40 flex items-center justify-between">
                <div>
                  <button
                    onClick={() => setSelectedTicket(null)}
                    className="text-xs font-semibold text-blue-600 hover:underline mb-2 block"
                  >
                    ← Voltar a todos os chamados
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-gray-400">{selectedTicket.id}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                      {selectedTicket.churchName}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
                      {selectedTicket.status}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mt-1">
                    {selectedTicket.subject}
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={selectedTicket.status}
                    onChange={(e) => handleStaffReply(e.target.value as TicketStatus)}
                    className="rounded-xl border border-gray-300 dark:border-gray-700 p-2 text-xs font-semibold dark:bg-gray-800"
                  >
                    <option value="OPEN">Aberto</option>
                    <option value="IN_PROGRESS">Em Atendimento</option>
                    <option value="WAITING_RESPONSE">Aguardando Resposta da Igreja</option>
                    <option value="RESOLVED">Concluído</option>
                    <option value="CANCELLED">Cancelado</option>
                  </select>
                </div>
              </div>

              {/* Messages Thread */}
              <div className="p-6 space-y-4 max-h-[500px] overflow-y-auto bg-gray-50/20 dark:bg-gray-950/20">
                {selectedTicket.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.isStaff ? 'items-end' : 'items-start'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">
                        {msg.senderName}
                      </span>
                      {msg.isStaff ? (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                          Equipe de Suporte
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          Secretaria Geral da Igreja
                        </span>
                      )}
                      <span className="text-[10px] text-gray-400">
                        {new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div
                      className={`rounded-2xl p-4 max-w-lg text-xs leading-relaxed ${
                        msg.isStaff
                          ? 'bg-blue-700 text-white shadow-md'
                          : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white shadow-sm'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Staff Reply Form */}
              <div className="p-4 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex gap-2">
                <input
                  type="text"
                  placeholder="Escrever resposta técnica para a igreja..."
                  value={staffReplyText}
                  onChange={(e) => setStaffReplyText(e.target.value)}
                  className="flex-1 rounded-xl border border-gray-300 dark:border-gray-700 p-2.5 text-xs dark:bg-gray-800 dark:text-white"
                />
                <button
                  onClick={() => handleStaffReply()}
                  disabled={!staffReplyText.trim()}
                  className="px-5 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs transition disabled:opacity-50"
                >
                  Responder
                </button>
              </div>
            </div>
          ) : (
            /* TICKETS TABLE */
            <div className="rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 overflow-hidden">
              <table className="w-full text-left text-xs text-gray-600 dark:text-gray-300">
                <thead className="bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
                  <tr>
                    <th className="p-4">ID & Igreja</th>
                    <th className="p-4">Assunto & Categoria</th>
                    <th className="p-4">Prioridade</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Aberto por</th>
                    <th className="p-4 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {tickets.map(t => (
                    <tr key={t.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/40">
                      <td className="p-4">
                        <span className="font-mono text-[10px] text-gray-400 block">{t.id}</span>
                        <span className="font-bold text-gray-900 dark:text-white">{t.churchName}</span>
                      </td>
                      <td className="p-4">
                        <span className="font-semibold text-gray-900 dark:text-white block">{t.subject}</span>
                        <span className="text-[10px] text-gray-500">{t.category}</span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          t.priority === 'URGENTE' || t.priority === 'ALTA'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                        }`}>
                          {t.priority}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className="font-bold text-xs">{t.status}</span>
                      </td>
                      <td className="p-4">
                        <span>{t.createdBy}</span>
                      </td>
                      <td className="p-4 text-right">
                        <button
                          onClick={() => setSelectedTicket(t)}
                          className="px-3 py-1.5 rounded-xl bg-blue-700 text-white font-semibold text-xs hover:bg-blue-800 transition"
                        >
                          Atender
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: USUÁRIOS E AUTORIZAÇÕES (CONGREGAÇÕES + PLATAFORMA)                */}
      {/* ========================================================================= */}
      {activeTab === 'USERS' && isPlatformAdminRoot && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Usuários e Autorizações (Gmail)</h2>
              <p className="text-xs text-gray-500">
                Cadastre e autorize usuários de todas as congregações e da administração para entrada direta com Gmail.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Buscar por nome ou Gmail..."
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                className="rounded-xl border border-gray-300 dark:border-gray-700 p-2 text-xs dark:bg-gray-800 dark:text-white w-48"
              />
              <select
                value={userChurchFilter}
                onChange={e => setUserChurchFilter(e.target.value)}
                className="rounded-xl border border-gray-300 dark:border-gray-700 p-2 text-xs dark:bg-gray-800 dark:text-white"
              >
                <option value="ALL">Todas as Congregações</option>
                <option value="PLATFORM">Administração Geral</option>
                {churches.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={userStatusFilter}
                onChange={e => setUserStatusFilter(e.target.value)}
                className="rounded-xl border border-gray-300 dark:border-gray-700 p-2 text-xs dark:bg-gray-800 dark:text-white"
              >
                <option value="ALL">Todos os Status</option>
                <option value="ACTIVE">Autorizados</option>
                <option value="PENDING_INVITE">Aguardando Autorização</option>
                <option value="INACTIVE">Bloqueados</option>
              </select>
              <button
                type="button"
                onClick={() => openCreateUserModal()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition whitespace-nowrap"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Cadastrar / Autorizar Usuário</span>
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-gray-600 dark:text-gray-300">
                <thead className="bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
                  <tr>
                    <th className="p-4">Nome & Gmail</th>
                    <th className="p-4">Congregação / Igreja</th>
                    <th className="p-4">Função</th>
                    <th className="p-4">Situação</th>
                    <th className="p-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredUsersList.map(u => {
                    const isProtectedOwner =
                      u.id === currentUser.id || PlatformAdminAuthService.isRootPlatformEmail(u.email);

                    return (
                      <tr key={u.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/40">
                        <td className="p-4">
                          <span className="font-bold text-gray-900 dark:text-white block">{u.name}</span>
                          <span className="text-[11px] text-gray-500">{u.email}</span>
                        </td>
                        <td className="p-4">
                          <span className="font-medium text-gray-800 dark:text-gray-200">
                            {churchNameById(u.churchId)}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-slate-100 text-slate-700 dark:bg-gray-800 dark:text-gray-300">
                            {ROLE_LABELS[u.role] || u.role}
                          </span>
                        </td>
                        <td className="p-4">
                          {u.status === 'ACTIVE' ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                              Autorizado
                            </span>
                          ) : u.status === 'PENDING_INVITE' ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                              Pendente
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200">
                              Bloqueado
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            {u.status !== 'ACTIVE' && (
                              <button
                                type="button"
                                onClick={() => handleQuickToggleUserStatus(u, 'ACTIVE')}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 whitespace-nowrap"
                              >
                                <UserCheck className="w-3 h-3" />
                                <span>Autorizar</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditUserModal(u)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-blue-200 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-300 whitespace-nowrap"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>Editar</span>
                            </button>
                            {!isProtectedOwner && u.status === 'ACTIVE' && (
                              <button
                                type="button"
                                onClick={() => handleQuickToggleUserStatus(u, 'INACTIVE')}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-amber-200 text-[11px] text-amber-800 hover:bg-amber-50 dark:border-amber-900 dark:text-amber-300 whitespace-nowrap"
                              >
                                <Ban className="w-3 h-3" />
                                <span>Bloquear</span>
                              </button>
                            )}
                            {!isProtectedOwner && onDeleteUser && (
                              <button
                                type="button"
                                onClick={() => setUserToDelete(u)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-bold hover:bg-rose-700 whitespace-nowrap"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Excluir</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredUsersList.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-xs text-gray-500 dark:text-gray-400">
                        Nenhum usuário encontrado para o filtro selecionado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}



      {/* ========================================================================= */}
      {/* TAB 8: MONITORAMENTO TÉCNICO (TECHNICAL_MONITORING)                       */}
      {/* ========================================================================= */}
      {activeTab === 'MONITORING' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Monitoramento Técnico do Sistema</h2>
            <p className="text-xs text-gray-500">Status dos serviços de infraestrutura, armazenamento e PWA.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-3xl border border-emerald-200 bg-white dark:bg-gray-900 p-5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-900 dark:text-white">Cloud Firestore</span>
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              </div>
              <p className="text-xs text-emerald-600 font-semibold">Conectado & Operacional</p>
              <span className="text-[10px] text-gray-400 block">Database ID: ai-studio-secretariadaigre</span>
            </div>

            <div className="rounded-3xl border border-emerald-200 bg-white dark:bg-gray-900 p-5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-900 dark:text-white">IndexedDB Local</span>
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              </div>
              <p className="text-xs text-emerald-600 font-semibold">Ativo (Offline-First)</p>
              <span className="text-[10px] text-gray-400 block">Banco: SecretariaIgreja_OfflineDB</span>
            </div>

            <div className="rounded-3xl border border-emerald-200 bg-white dark:bg-gray-900 p-5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-900 dark:text-white">Service Worker & PWA</span>
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              </div>
              <p className="text-xs text-emerald-600 font-semibold">Registrado & Ativo</p>
              <span className="text-[10px] text-gray-400 block">Cache: Workbox precache 4MB</span>
            </div>

            <div className="rounded-3xl border border-emerald-200 bg-white dark:bg-gray-900 p-5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-900 dark:text-white">Regras de Segurança</span>
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              </div>
              <p className="text-xs text-emerald-600 font-semibold">Audit Logs Imutáveis</p>
              <span className="text-[10px] text-gray-400 block">Deploy efetuado no Firebase</span>
            </div>
          </div>

          <div className="rounded-3xl border border-indigo-200 bg-indigo-50/50 dark:border-indigo-900 dark:bg-indigo-950/30 p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-indigo-950 dark:text-indigo-200">
                  Ponte de Sincronização Netlify ↔ Cloud Firestore
                </h3>
                <p className="text-xs text-indigo-800/80 dark:text-indigo-300 mt-0.5">
                  Projeto ativo: <strong className="font-mono">{FirebaseService.getConnectionInfo().projectId}</strong> • Banco:{' '}
                  <strong className="font-mono">{FirebaseService.getConnectionInfo().firestoreDatabaseId}</strong>. Use o pacote JSON caso queira migrar registros locais do navegador no Netlify diretamente para cá e para a nuvem.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleManualPlatformSync}
                  disabled={syncingCloud}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-700 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-800 transition disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingCloud ? 'animate-spin' : ''}`} />
                  <span>Sincronizar da Nuvem</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportNetlifyPackage}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-300 bg-white px-4 py-2 text-xs font-bold text-indigo-800 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-gray-900 dark:text-indigo-200 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Exportar Pacote (.json)</span>
                </button>
                <label className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 cursor-pointer transition">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Importar do Netlify (.json)</span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={handleImportNetlifyPackage}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 9: ENCERRAMENTO DE IGREJAS (CLOSE_CHURCHES)                           */}
      {/* ========================================================================= */}
      {activeTab === 'CLOSURE' && (
        <div className="space-y-4 max-w-3xl">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Encerramento Formal de Igrejas</h2>
            <p className="text-xs text-gray-500">
              Conformidade legal: exportação de dossiê completo, retenção e autorização administrativa.
            </p>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 space-y-4">
            <h3 className="font-bold text-sm text-gray-900 dark:text-white">
              Procedimento para Encerramento Definitivo
            </h3>
            <ol className="text-xs text-gray-600 dark:text-gray-300 space-y-2 list-decimal list-inside leading-relaxed">
              <li><strong>Solicitação formal da igreja</strong> ou encerramento motivado por encerramento de atividades.</li>
              <li><strong>Exportação completa do arquivo de dados</strong> (JSON estruturado com todos os membros, histórico e departamentos).</li>
              <li><strong>Verificação das obrigações legais de retenção</strong> e guarda fiscal/eclesiástica conforme a legislação brasileira e LGPD.</li>
              <li><strong>Autorização do administrador da plataforma</strong> com confirmação de senha de segurança e registro imutável em auditoria.</li>
            </ol>

            <div className="pt-4 border-t border-gray-100 dark:border-gray-800 space-y-3">
              <h4 className="text-xs font-bold uppercase text-gray-500">Selecione uma Igreja para Encerramento:</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {churches.filter(c => c.status !== 'CLOSED').map(c => (
                  <div key={c.id} className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-xs text-gray-900 dark:text-white block">{c.name}</span>
                      <span className="text-[10px] text-gray-400 font-mono">{c.exclusiveCode}</span>
                    </div>
                    <button
                      onClick={() => setSelectedChurchForClosure(c)}
                      className="px-3 py-1.5 rounded-xl border border-rose-300 text-rose-700 text-xs font-bold hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300"
                    >
                      Iniciar Encerramento
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {isPlatformAdminRoot && onResetAllForLaunch && (
            <div className="rounded-3xl border-2 border-rose-200 bg-rose-50/70 p-6 dark:border-rose-900 dark:bg-rose-950/30 space-y-3">
              <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="font-bold text-sm">Reinicialização Completa para Uso Oficial</h3>
              </div>
              <p className="text-xs text-rose-900/90 dark:text-rose-200 leading-relaxed">
                Exclui todas as igrejas cadastradas, usuários vinculados, departamentos, eventos, comprovantes e chamados prévios (locais e na nuvem), preservando apenas a sua conta de Administradora Principal para iniciar oficialmente a partir do primeiro cadastro.
              </p>
              <button
                type="button"
                onClick={() => {
                  setOfficialResetChecked(false);
                  setOfficialResetText('');
                  setShowOfficialResetModal(true);
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 transition shadow-sm"
              >
                <Trash2 className="w-4 h-4" />
                <span>Excluir Todas as Igrejas e Dados Prévios</span>
              </button>
            </div>
          )}
        </div>
      )}



      {/* ========================================================================= */}
      {/* MODAL: ENCERRAMENTO FORMAL DA IGREJA                                      */}
      {/* ========================================================================= */}
      {selectedChurchForClosure && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl dark:bg-gray-900 p-6 space-y-4 border border-rose-300 dark:border-rose-900">
            <div className="flex items-center gap-2 text-rose-600">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="font-bold text-base text-gray-900 dark:text-white">
                Autorização de Encerramento: {selectedChurchForClosure.name}
              </h3>
            </div>

            <div className="rounded-2xl bg-gray-50 dark:bg-gray-800/60 p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span>1. Exportação Prévia de Segurança:</span>
                <button
                  type="button"
                  onClick={() => handleExportFullChurchArchive(selectedChurchForClosure)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-700 text-white text-[11px] font-bold shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Baixar Arquivo Completo (JSON)</span>
                </button>
              </div>

              <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={legalRetentionConfirmed}
                    onChange={(e) => setLegalRetentionConfirmed(e.target.checked)}
                    className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">
                    Confirmo que as obrigações legais de retenção de documentos eclesiásticos e fiscais foram verificadas e que o backup foi gerado.
                  </span>
                </label>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                  Digite o Código Exclusivo da Igreja ({selectedChurchForClosure.exclusiveCode}) para Autorizar
                </label>
                <input
                  type="text"
                  value={closureConfirmText}
                  onChange={(e) => setClosureConfirmText(e.target.value)}
                  placeholder={selectedChurchForClosure.exclusiveCode}
                  className="w-full rounded-xl border border-gray-300 p-2 text-xs font-mono dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedChurchForClosure(null);
                  setClosureConfirmText('');
                }}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={
                  !legalRetentionConfirmed ||
                  closureConfirmText.trim().toUpperCase() !== selectedChurchForClosure.exclusiveCode.toUpperCase()
                }
                onClick={handleConfirmChurchClosure}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md transition disabled:opacity-50"
              >
                Autorizar Encerramento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CONFIRMAR EXCLUSÃO DEFINITIVA DE IGREJA                            */}
      {/* ========================================================================= */}
      {churchToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl dark:bg-gray-900 p-6 space-y-4 border border-rose-300 dark:border-rose-900">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-rose-600">
                <Trash2 className="w-5 h-5" />
                <h3 className="font-bold text-base text-gray-900 dark:text-white">
                  Excluir Igreja Cadastrada
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setChurchToDelete(null)}
                className="rounded-full p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              Você está prestes a excluir permanentemente a igreja <strong>"{churchToDelete.name}"</strong>{' '}
              (<span className="font-mono">{churchToDelete.exclusiveCode}</span>). Todos os registros vinculados na plataforma serão removidos.
            </p>

            <label className="flex items-start gap-2 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteConfirmChecked}
                onChange={e => setDeleteConfirmChecked(e.target.checked)}
                className="mt-0.5 rounded text-rose-600 focus:ring-rose-500"
              />
              <span className="text-[11px] font-semibold text-rose-900 dark:text-rose-200">
                Confirmo a exclusão definitiva desta igreja e estou ciente de que esta ação não pode ser desfeita.
              </span>
            </label>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setChurchToDelete(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 dark:text-gray-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!deleteConfirmChecked || deletingChurch}
                onClick={handleConfirmDeleteChurch}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md transition disabled:opacity-50"
              >
                {deletingChurch ? 'Excluindo...' : 'Excluir Igreja'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EDITAR IGREJA CADASTRADA                                           */}
      {/* ========================================================================= */}
      {churchToEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl dark:bg-gray-900 p-6 space-y-4 border border-gray-200 dark:border-gray-800 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-gray-800">
              <h3 className="font-bold text-base text-gray-900 dark:text-white">
                Editar Igreja: {churchToEdit.name}
              </h3>
              <button
                type="button"
                onClick={() => setChurchToEdit(null)}
                className="rounded-full p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditedChurch} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">Nome da Igreja *</label>
                  <input
                    type="text"
                    required
                    value={churchToEdit.name}
                    onChange={e => setChurchToEdit({ ...churchToEdit, name: e.target.value })}
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">Denominação</label>
                  <input
                    type="text"
                    value={churchToEdit.denomination}
                    onChange={e => setChurchToEdit({ ...churchToEdit, denomination: e.target.value })}
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">Pastor Responsável</label>
                  <input
                    type="text"
                    value={churchToEdit.pastorName}
                    onChange={e => setChurchToEdit({ ...churchToEdit, pastorName: e.target.value })}
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">E-mail de Contato</label>
                  <input
                    type="email"
                    required
                    value={churchToEdit.email}
                    onChange={e => setChurchToEdit({ ...churchToEdit, email: e.target.value })}
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">Telefone</label>
                  <input
                    type="text"
                    value={churchToEdit.phone}
                    onChange={e => setChurchToEdit({ ...churchToEdit, phone: e.target.value })}
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">Cidade</label>
                  <input
                    type="text"
                    value={churchToEdit.city}
                    onChange={e => setChurchToEdit({ ...churchToEdit, city: e.target.value })}
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">UF</label>
                  <input
                    type="text"
                    value={churchToEdit.state}
                    onChange={e => setChurchToEdit({ ...churchToEdit, state: e.target.value })}
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">Licenciamento</label>
                  <select
                    value={churchToEdit.plan}
                    onChange={e => setChurchToEdit({ ...churchToEdit, plan: e.target.value as any })}
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  >
                    <option value="FREE">Sistema 100% Gratuito</option>
                    <option value="FREE_PERMANENT">Gratuito Permanente</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">Situação Operacional</label>
                  <select
                    value={churchToEdit.status}
                    onChange={e => setChurchToEdit({ ...churchToEdit, status: e.target.value as any })}
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  >
                    <option value="ACTIVE">Ativa</option>
                    <option value="PENDING">Pendente</option>
                    <option value="SUSPENDED">Suspensa</option>
                    <option value="CLOSED">Encerrada</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setChurchToEdit(null)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 dark:text-gray-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs shadow-md transition"
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CONFIRMAR SUSPENSÃO DE IGREJA                                      */}
      {/* ========================================================================= */}
      {churchToSuspend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl dark:bg-gray-900 p-6 space-y-4 border border-amber-300 dark:border-amber-900">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-bold text-base text-gray-900 dark:text-white">
                Suspender Operação da Igreja
              </h3>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Deseja suspender operacionalmente a igreja <strong>"{churchToSuspend.name}"</strong>? Os dados permanecem preservados e poderão ser reativados a qualquer momento.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setChurchToSuspend(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const updated: Church = { ...churchToSuspend, status: 'SUSPENDED', planStatus: 'SUSPENDED_OVERDUE' };
                  onUpdateChurch(updated);
                  showFeedback('SUCCESS', `Igreja "${churchToSuspend.name}" suspensa operacionalmente.`);
                  setChurchToSuspend(null);
                }}
                className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition"
              >
                Confirmar Suspensão
              </button>
            </div>
          </div>
        </div>
      )}



      {/* ========================================================================= */}
      {/* MODAL: CADASTRAR NOVA CONGREGAÇÃO                                         */}
      {/* ========================================================================= */}
      {showNewChurchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl dark:bg-gray-900 p-6 space-y-4 border border-gray-200 dark:border-gray-800 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                <Building2 className="w-5 h-5" />
                <h3 className="font-bold text-base text-gray-900 dark:text-white">
                  Cadastrar Nova Congregação / Igreja
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowNewChurchModal(false)}
                className="rounded-full p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateNewChurch} className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Nome da Congregação / Igreja *
                </label>
                <input
                  type="text"
                  required
                  value={newChurchForm.name}
                  onChange={e => setNewChurchForm({ ...newChurchForm, name: e.target.value })}
                  placeholder="Ex: Congregação Monte Sião"
                  className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Pastor / Responsável
                  </label>
                  <input
                    type="text"
                    value={newChurchForm.pastorName}
                    onChange={e => setNewChurchForm({ ...newChurchForm, pastorName: e.target.value })}
                    placeholder="Nome do responsável"
                    className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Denominação / Ministério
                  </label>
                  <input
                    type="text"
                    value={newChurchForm.denomination}
                    onChange={e => setNewChurchForm({ ...newChurchForm, denomination: e.target.value })}
                    placeholder="Ex: Assembleia de Deus"
                    className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Cidade *
                  </label>
                  <input
                    type="text"
                    required
                    value={newChurchForm.city}
                    onChange={e => setNewChurchForm({ ...newChurchForm, city: e.target.value })}
                    placeholder="Ex: São Paulo"
                    className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    UF *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={2}
                    value={newChurchForm.state}
                    onChange={e => setNewChurchForm({ ...newChurchForm, state: e.target.value.toUpperCase() })}
                    placeholder="SP"
                    className="w-full rounded-xl border border-gray-300 p-2.5 text-xs uppercase dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    E-mail Institucional
                  </label>
                  <input
                    type="email"
                    value={newChurchForm.email}
                    onChange={e => setNewChurchForm({ ...newChurchForm, email: e.target.value })}
                    placeholder="congregacao@gmail.com"
                    className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Telefone / WhatsApp
                  </label>
                  <input
                    type="text"
                    value={newChurchForm.phone}
                    onChange={e => setNewChurchForm({ ...newChurchForm, phone: e.target.value })}
                    placeholder="(11) 99999-0000"
                    className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  />
                </div>
              </div>

              {/* Optional First Authorized Gmail User */}
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30 p-3.5 space-y-2.5">
                <label className="flex items-center gap-2 text-xs font-bold text-emerald-900 dark:text-emerald-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newChurchForm.createSecretary}
                    onChange={e => setNewChurchForm({ ...newChurchForm, createSecretary: e.target.checked })}
                    className="rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Já autorizar Secretaria Geral (Gmail) desta congregação</span>
                </label>
                {newChurchForm.createSecretary && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      required
                      value={newChurchForm.secretaryName}
                      onChange={e => setNewChurchForm({ ...newChurchForm, secretaryName: e.target.value })}
                      placeholder="Nome da Secretaria *"
                      className="w-full rounded-xl border border-emerald-200 bg-white p-2 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    />
                    <input
                      type="email"
                      required
                      value={newChurchForm.secretaryEmail}
                      onChange={e => setNewChurchForm({ ...newChurchForm, secretaryEmail: e.target.value })}
                      placeholder="Gmail da Secretaria *"
                      className="w-full rounded-xl border border-emerald-200 bg-white p-2 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowNewChurchModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 dark:text-gray-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingChurch}
                  className="px-5 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs shadow-md transition disabled:opacity-50"
                >
                  {creatingChurch ? 'Cadastrando...' : 'Cadastrar e Ativar Congregação'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CADASTRAR / EDITAR E AUTORIZAR USUÁRIO                             */}
      {/* ========================================================================= */}
      {showUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl dark:bg-gray-900 p-6 space-y-4 border border-gray-200 dark:border-gray-800 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                <Users className="w-5 h-5" />
                <h3 className="font-bold text-base text-gray-900 dark:text-white">
                  {editingUserTarget ? 'Editar / Autorizar Usuário' : 'Cadastrar e Autorizar Usuário'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowUserModal(false);
                  setEditingUserTarget(null);
                }}
                className="rounded-full p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUserModalSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  required
                  value={userFormName}
                  onChange={e => setUserFormName(e.target.value)}
                  placeholder="Ex: Maria da Silva"
                  className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  E-mail / Gmail de Acesso *
                </label>
                <input
                  type="email"
                  required
                  value={userFormEmail}
                  onChange={e => setUserFormEmail(e.target.value)}
                  placeholder="usuario@gmail.com"
                  className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
                <span className="text-[11px] text-gray-400 mt-1 block">
                  Ao autorizar este e-mail, o usuário poderá entrar clicando direto em &ldquo;Entrar com Gmail&rdquo;.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Congregação / Igreja *
                </label>
                <select
                  value={userFormChurchId}
                  onChange={e => {
                    const nextChurch = e.target.value;
                    setUserFormChurchId(nextChurch);
                    if (nextChurch === 'PLATFORM' && userFormRole !== 'PLATFORM_ADMIN' && userFormRole !== 'PLATFORM_ASSISTANT_ADMIN') {
                      setUserFormRole('PLATFORM_ASSISTANT_ADMIN');
                    } else if (nextChurch !== 'PLATFORM' && (userFormRole === 'PLATFORM_ADMIN' || userFormRole === 'PLATFORM_ASSISTANT_ADMIN')) {
                      setUserFormRole('GENERAL_SECRETARY');
                    }
                  }}
                  className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                >
                  {churches.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.exclusiveCode})
                    </option>
                  ))}
                  <option value="PLATFORM">Administração Geral da Plataforma</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Função *
                  </label>
                  <select
                    value={userFormRole}
                    onChange={e => setUserFormRole(e.target.value as User['role'])}
                    className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  >
                    {userFormChurchId === 'PLATFORM' ? (
                      <>
                        <option value="PLATFORM_ASSISTANT_ADMIN">Admin Auxiliar Plataforma</option>
                        <option value="PLATFORM_ADMIN">Admin Geral Plataforma</option>
                      </>
                    ) : (
                      <>
                        <option value="GENERAL_SECRETARY">Secretaria Geral</option>
                        <option value="ASSISTANT_SECRETARY">Secretário(a) Auxiliar</option>
                        <option value="PASTOR">Pastor</option>
                        <option value="DEPARTMENT_LEADER">Líder de Departamento</option>
                        <option value="TREASURER">Tesoureiro(a)</option>
                        <option value="MEMBER">Membro (Consulta)</option>
                      </>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Situação *
                  </label>
                  <select
                    value={userFormStatus}
                    onChange={e => setUserFormStatus(e.target.value as User['status'])}
                    className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  >
                    <option value="ACTIVE">Autorizado (Ativo)</option>
                    <option value="PENDING_INVITE">Aguardando Autorização</option>
                    <option value="INACTIVE">Bloqueado</option>
                  </select>
                </div>
              </div>

              {!editingUserTarget && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                  O acesso ao aplicativo é feito diretamente via Conta Google. Assim que salvo, o Gmail informado acima já poderá entrar sem senha adicional.
                </div>
              )}

              {userFormRole === 'PLATFORM_ASSISTANT_ADMIN' && (
                <div className="space-y-1.5 pt-2 border-t border-gray-100 dark:border-gray-800">
                  <span className="text-[11px] font-bold uppercase text-gray-500">Permissões de Plataforma:</span>
                  {[
                    { id: 'MANAGE_CHURCHES' as PlatformPermission, label: 'Gerenciar Congregações' },
                    { id: 'SUPPORT' as PlatformPermission, label: 'Atendimento de Suporte' },
                    { id: 'TECHNICAL_MONITORING' as PlatformPermission, label: 'Monitoramento Técnico' },
                    { id: 'CLOSE_CHURCHES' as PlatformPermission, label: 'Encerramento de Igrejas' },
                  ].map(perm => (
                    <label
                      key={perm.id}
                      className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={userFormPermissions.includes(perm.id)}
                        onChange={() => togglePermission(perm.id)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span>{perm.label}</span>
                    </label>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowUserModal(false);
                    setEditingUserTarget(null);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 dark:text-gray-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingUserForm}
                  className="px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-md transition disabled:opacity-50"
                >
                  {savingUserForm ? 'Salvando...' : editingUserTarget ? 'Salvar Alterações' : 'Cadastrar e Autorizar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CONFIRMAR EXCLUSÃO DE USUÁRIO                                      */}
      {/* ========================================================================= */}
      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl dark:bg-gray-900 p-6 space-y-4 border border-rose-300 dark:border-rose-900">
            <div className="flex items-center gap-2 text-rose-600">
              <Trash2 className="w-5 h-5" />
              <h3 className="font-bold text-base text-gray-900 dark:text-white">Remover Usuário</h3>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              Deseja remover o acesso de <strong>{userToDelete.name}</strong> ({userToDelete.email})? Esta conta não poderá mais entrar até que seja autorizada novamente.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setUserToDelete(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 dark:text-gray-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deletingUser}
                onClick={handleConfirmDeleteUser}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition disabled:opacity-50"
              >
                {deletingUser ? 'Removendo...' : 'Confirmar Exclusão'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: LIMPEZA TOTAL PARA INÍCIO OFICIAL DO APLICATIVO                    */}
      {/* ========================================================================= */}
      {showOfficialResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl dark:bg-gray-900 p-6 space-y-4 border border-rose-300 dark:border-rose-900">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-rose-600">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="font-bold text-base text-gray-900 dark:text-white">
                  Zerar Base para Uso Oficial
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowOfficialResetModal(false)}
                className="rounded-full p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              Esta ação excluirá <strong>todas as igrejas cadastradas ({churches.length})</strong>, usuários das igrejas, departamentos, eventos, comprovantes, chamados de suporte e caches locais, preparando o sistema do zero para o primeiro cadastro oficial.
            </p>

            <div className="rounded-2xl bg-gray-50 dark:bg-gray-800/70 p-3 text-[11px] text-gray-600 dark:text-gray-300">
              Seu acesso principal de Administradora da Plataforma (<strong>{currentUser.email}</strong>) será mantido normalmente.
            </div>

            <label className="flex items-start gap-2 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={officialResetChecked}
                onChange={e => setOfficialResetChecked(e.target.checked)}
                className="mt-0.5 rounded text-rose-600 focus:ring-rose-500"
              />
              <span className="text-[11px] font-semibold text-rose-900 dark:text-rose-200">
                Confirmo a exclusão de todas as igrejas e dados prévios para iniciar oficialmente o uso do aplicativo.
              </span>
            </label>

            <div>
              <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                Digite ZERAR BASE para confirmar
              </label>
              <input
                type="text"
                value={officialResetText}
                onChange={e => setOfficialResetText(e.target.value)}
                placeholder="ZERAR BASE"
                className="w-full rounded-xl border border-gray-300 p-2 text-xs font-mono uppercase dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowOfficialResetModal(false)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 dark:text-gray-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={
                  !officialResetChecked ||
                  officialResetText.trim().toUpperCase() !== 'ZERAR BASE' ||
                  resettingLaunch
                }
                onClick={handleConfirmOfficialLaunchReset}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md transition disabled:opacity-50"
              >
                {resettingLaunch ? 'Excluindo Tudo...' : 'Confirmar e Zerar Base'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ALTERAR SENHA DA ADMINISTRADORA PRINCIPAL                         */}
      {/* ========================================================================= */}
      {showChangePasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl dark:bg-gray-900 p-6 space-y-4 border border-indigo-200 dark:border-indigo-900">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300">
                <Lock className="w-5 h-5" />
                <h3 className="font-bold text-base text-gray-900 dark:text-white">
                  Alterar Senha de Acesso Geral
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowChangePasswordModal(false)}
                className="rounded-full p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Conta: <strong className="text-gray-800 dark:text-gray-200">{currentUser.email}</strong>
            </p>

            {pwdErrorMsg && (
              <div className="rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 p-3 text-xs text-rose-800 dark:text-rose-200">
                {pwdErrorMsg}
              </div>
            )}

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setPwdErrorMsg(null);
                if (!PlatformAdminAuthService.verifyLocalAdminPassword(currentUser.email, currentAdminPwd)) {
                  setPwdErrorMsg('Senha atual incorreta.');
                  return;
                }
                if (newAdminPwd.trim().length < 6) {
                  setPwdErrorMsg('A nova senha deve ter pelo menos 6 caracteres.');
                  return;
                }
                if (newAdminPwd !== confirmAdminPwd) {
                  setPwdErrorMsg('A confirmação da nova senha não confere.');
                  return;
                }
                setSavingPassword(true);
                try {
                  const changeResult = PlatformAdminAuthService.changeLocalAdminPassword(
                    currentUser.email,
                    currentAdminPwd,
                    newAdminPwd
                  );
                  if (!changeResult.ok) {
                    setPwdErrorMsg(changeResult.error || 'Não foi possível atualizar a senha.');
                    return;
                  }
                  if (auth.currentUser && navigator.onLine) {
                    try {
                      await FirebaseAuthService.linkOrUpdateEmailPassword(
                        currentUser.email,
                        newAdminPwd,
                        currentAdminPwd
                      );
                    } catch (fbErr) {
                      console.warn('Atualização da senha no Firebase Auth adiada/local:', fbErr);
                    }
                  }
                  setUsingDefaultPassword(PlatformAdminAuthService.isUsingInitialDefaultPassword());
                  await syncEngine.logAudit({
                    churchId: 'PLATFORM',
                    userId: currentUser.id,
                    userName: currentUser.name,
                    action: 'Alteração de Senha do Administrador Geral',
                    entityType: 'SECURITY',
                    entityId: currentUser.id,
                    details: `Senha de acesso atualizada pelo administrador geral (${currentUser.email}).`,
                  });
                  setShowChangePasswordModal(false);
                  showFeedback('SUCCESS', 'Sua senha de acesso geral foi atualizada com sucesso!');
                } catch (err: any) {
                  setPwdErrorMsg(err?.message || 'Não foi possível atualizar a senha.');
                } finally {
                  setSavingPassword(false);
                }
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Senha Atual *
                </label>
                <input
                  type="password"
                  required
                  value={currentAdminPwd}
                  onChange={e => setCurrentAdminPwd(e.target.value)}
                  placeholder="Digite sua senha atual"
                  className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Nova Senha (mín. 6 caracteres) *
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newAdminPwd}
                  onChange={e => setNewAdminPwd(e.target.value)}
                  placeholder="Digite a nova senha"
                  className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Confirmar Nova Senha *
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={confirmAdminPwd}
                  onChange={e => setConfirmAdminPwd(e.target.value)}
                  placeholder="Repita a nova senha"
                  className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowChangePasswordModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 dark:text-gray-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingPassword}
                  className="px-5 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-bold text-xs shadow-md transition disabled:opacity-50"
                >
                  {savingPassword ? 'Salvando...' : 'Atualizar Senha'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
