import React, { useState, useEffect } from 'react';
import { Church, User, AuditLog, BackupRecord, Member, Department, ChurchEvent } from '../../types';
import { BackupService } from '../../services/backupService';
import { IndexedDBService } from '../../services/indexedDB';
import { FirebaseService } from '../../services/firebase';
import { syncEngine } from '../../services/syncEngine';
import { SecurityPolicy } from '../../services/securityPolicy';
import { SecurityConfirmModal } from '../SecurityConfirmModal';
import { GoogleDriveService, GoogleDriveFile } from '../../services/googleDriveService';
import { FirebaseAuthService } from '../../services/firebase';
import { ChurchUserAuthService } from '../../utils/churchUserAuth';
import { 
  Building2, 
  CheckCircle2, 
  ShieldCheck, 
  Database, 
  History, 
  FileCheck, 
  AlertTriangle, 
  Download, 
  RefreshCw, 
  Lock, 
  Search, 
  UserCheck, 
  FileText,
  RotateCcw,
  Sparkles,
  Palette,
  LayoutGrid,
  FileSpreadsheet,
  Clock,
  Upload,
  KeyRound,
  Cloud,
  Trash2,
  ExternalLink
} from 'lucide-react';
import {
  DEFAULT_CHURCH_PRIMARY,
  DEFAULT_CHURCH_SECONDARY,
  extractBrandColorsFromDataUrl,
} from '../../utils/themeColorUtils';
import {
  DEFAULT_DASHBOARD_PREFS,
  DashboardPanelPrefs,
  loadDashboardPrefs,
  saveDashboardPrefs,
} from '../../utils/dashboardPrefs';

interface SettingsScreenProps {
  church: Church;
  currentUser: User;
  members: Member[];
  departments: Department[];
  events: ChurchEvent[];
  onUpdateChurch: (church: Church) => void;
  onRefreshData?: () => void;
  onClearDemoData?: () => Promise<void> | void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ 
  church, 
  currentUser,
  members,
  departments,
  events,
  onUpdateChurch,
  onRefreshData,
  onClearDemoData
}) => {
  const [activeTab, setActiveTab] = useState<'INSTITUTIONAL' | 'DASHBOARD_PREFS' | 'OFFLINE_SECURITY' | 'AUDIT_LOGS' | 'BACKUP_RESTORE' | 'LGPD'>('INSTITUTIONAL');
  const [formData, setFormData] = useState<Church>(church);
  const [saved, setSaved] = useState(false);
  const [paletteNotice, setPaletteNotice] = useState<string | null>(null);
  const [panelPrefs, setPanelPrefs] = useState<DashboardPanelPrefs>(() =>
    loadDashboardPrefs(church.id, currentUser.id)
  );
  const [panelPrefsSaved, setPanelPrefsSaved] = useState(false);

  // Offline & Auto Backup settings
  const [maxOfflineDays, setMaxOfflineDays] = useState<number>(church.offlineConfig?.maxOfflineDays || 7);
  const [autoBackupDaily, setAutoBackupDaily] = useState<boolean>(church.offlineConfig?.autoBackupDaily ?? true);
  const [autoBackupFrequency, setAutoBackupFrequency] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY' | 'DISABLED'>(
    () => church.offlineConfig?.autoBackupFrequency || (church.offlineConfig?.autoBackupDaily === false ? 'DISABLED' : 'DAILY')
  );
  const [autoBackupFormat, setAutoBackupFormat] = useState<'JSON' | 'CSV' | 'BOTH'>(
    () => church.offlineConfig?.autoBackupFormat || 'JSON'
  );
  const [autoScheduleSaved, setAutoScheduleSaved] = useState(false);

  // Audit Logs state
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditFilterType, setAuditFilterType] = useState('ALL');

  // Backup & Restore state
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [loadingBackup, setLoadingBackup] = useState(false);
  const [selectedBackupForRestore, setSelectedBackupForRestore] = useState<BackupRecord | null>(null);
  const [showRestoreConfirmModal, setShowRestoreConfirmModal] = useState(false);
  const [showClearDemoConfirmModal, setShowClearDemoConfirmModal] = useState(false);
  const [restoreStatusMsg, setRestoreStatusMsg] = useState<{ type: 'SUCCESS' | 'ERROR'; msg: string } | null>(null);

  // LGPD Dossier
  const [lgpdSelectedMemberId, setLgpdSelectedMemberId] = useState<string>('');
  const [lgpdDossier, setLgpdDossier] = useState<string | null>(null);

  // User Password Change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordStatusMsg, setPasswordStatusMsg] = useState<{ type: 'SUCCESS' | 'ERROR'; text: string } | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Google Drive backups state
  const [driveBackups, setDriveBackups] = useState<GoogleDriveFile[]>([]);
  const [loadingDriveBackups, setLoadingDriveBackups] = useState(false);
  const [driveUploadStatus, setDriveUploadStatus] = useState<{ type: 'SUCCESS' | 'ERROR'; text: string } | null>(null);
  const [driveFileToDelete, setDriveFileToDelete] = useState<GoogleDriveFile | null>(null);

  const isSecretary = SecurityPolicy.canManageSettingsAndBackups(currentUser, church.id);

  const loadAuditAndBackups = async () => {
    // 1. Fetch from local IndexedDB
    const localLogs = await IndexedDBService.getAll<AuditLog>('auditLogs', church.id);
    let mergedLogs = [...localLogs];

    // 2. If online and cloud profile is verified, fetch from Firestore 'auditLogs' collection and merge
    if (navigator.onLine && syncEngine.isCloudAccessEnabled(church.id)) {
      try {
        const cloudLogs = await FirebaseService.getAuditLogs(church.id);
        const map = new Map<string, AuditLog>();
        localLogs.forEach(l => map.set(l.id, l));
        cloudLogs.forEach(c => map.set(c.id, { ...c, syncedToFirestore: true }));
        mergedLogs = Array.from(map.values());
        // Update local IndexedDB cache
        await IndexedDBService.putMany('auditLogs', mergedLogs);
      } catch (e) {
        console.warn('Could not sync audit logs from Firestore:', e);
      }
    }

    setAuditLogs(mergedLogs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));

    const backupList = await BackupService.getBackups(church.id);
    setBackups(backupList);

    if (activeTab === 'BACKUP_RESTORE' && GoogleDriveService.getAccessToken()) {
      setLoadingDriveBackups(true);
      try {
        const files = await GoogleDriveService.listChurchBackups(church.name);
        setDriveBackups(files);
      } catch {
        // Keep silent if token expired or offline
      } finally {
        setLoadingDriveBackups(false);
      }
    }
  };

  useEffect(() => {
    setFormData(church);
    setMaxOfflineDays(church.offlineConfig?.maxOfflineDays || 7);
    setAutoBackupDaily(church.offlineConfig?.autoBackupDaily ?? true);
    setAutoBackupFrequency(
      church.offlineConfig?.autoBackupFrequency ||
        (church.offlineConfig?.autoBackupDaily === false ? 'DISABLED' : 'DAILY')
    );
    setAutoBackupFormat(church.offlineConfig?.autoBackupFormat || 'JSON');
    setPanelPrefs(loadDashboardPrefs(church.id, currentUser.id));
  }, [church, currentUser.id]);

  useEffect(() => {
    loadAuditAndBackups();
  }, [church.id, activeTab]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updatedChurch: Church = {
      ...formData,
      pastorName: formData.pastorName.trim(),
      offlineConfig: {
        maxOfflineDays,
        autoBackupDaily: autoBackupFrequency !== 'DISABLED' && autoBackupDaily,
        autoBackupFrequency,
        autoBackupFormat,
        autoDownloadLocalBackup: false,
        lastAutoBackupAt: church.offlineConfig?.lastAutoBackupAt,
      }
    };
    onUpdateChurch(updatedChurch);

    const previousPastor = (church.pastorName || '').trim();
    const nextPastor = updatedChurch.pastorName.trim();
    if (previousPastor !== nextPastor) {
      syncEngine.logAudit({
        churchId: church.id,
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'Alteração de Pastor Responsável',
        entityType: 'SETTINGS',
        entityId: church.id,
        details: `Pastor responsável alterado de "${previousPastor || 'Não informado'}" para "${nextPastor || 'Não informado'}" por ${currentUser.name}.`,
      });
    }

    syncEngine.logAudit({
      churchId: church.id,
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'Atualização de Configurações Institucionais',
      entityType: 'SETTINGS',
      entityId: church.id,
      details: `Configurações da igreja atualizadas por ${currentUser.name}. Tolerância offline: ${maxOfflineDays} dias.`,
    });

    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleCreateBackupNow = async () => {
    setLoadingBackup(true);
    try {
      const newBackup = await BackupService.createBackup(church, currentUser, { trigger: 'MANUAL' });
      setBackups([newBackup, ...backups]);
      setRestoreStatusMsg({
        type: 'SUCCESS',
        msg: `Backup criado com sucesso! Verificado com ${newBackup.checksum}. ${newBackup.recordCounts.members} membros, ${newBackup.recordCounts.departments} depts, ${newBackup.recordCounts.events} eventos e ${newBackup.recordCounts.auditLogs || 0} logs.`
      });
    } catch (e: any) {
      setRestoreStatusMsg({ type: 'ERROR', msg: `Erro ao criar backup: ${e.message}` });
    } finally {
      setLoadingBackup(false);
    }
  };

  const handleManualExport = async (format: 'JSON' | 'CSV' | 'BOTH') => {
    setLoadingBackup(true);
    try {
      const newBackup = await BackupService.exportManualBackup(church, currentUser, format);
      setBackups(prev => [newBackup, ...prev]);
      setRestoreStatusMsg({
        type: 'SUCCESS',
        msg: `Backup completo exportado em ${format} para o dispositivo! (${newBackup.recordCounts.members} membros, ${newBackup.recordCounts.departments} depts, ${newBackup.recordCounts.events} eventos e ${newBackup.recordCounts.auditLogs || 0} logs de auditoria).`
      });
    } catch (e: any) {
      setRestoreStatusMsg({ type: 'ERROR', msg: `Erro ao exportar backup: ${e.message}` });
    } finally {
      setLoadingBackup(false);
    }
  };

  const handleSaveAutoBackupSchedule = () => {
    const updatedChurch: Church = {
      ...church,
      offlineConfig: {
        maxOfflineDays,
        autoBackupDaily: autoBackupFrequency !== 'DISABLED',
        autoBackupFrequency,
        autoBackupFormat,
        autoDownloadLocalBackup: false,
        lastAutoBackupAt: church.offlineConfig?.lastAutoBackupAt,
      },
    };
    onUpdateChurch(updatedChurch);
    syncEngine.logAudit({
      churchId: church.id,
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'Configuração de Backup Automático',
      entityType: 'BACKUP',
      entityId: church.id,
      details: `Agendamento de backup no banco de dados atualizado por ${currentUser.name}: frequência ${autoBackupFrequency}, formato manual padrão ${autoBackupFormat}.`,
    });
    setAutoScheduleSaved(true);
    setTimeout(() => setAutoScheduleSaved(false), 3000);
  };

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordStatusMsg(null);
    if (newPassword.length < 6) {
      setPasswordStatusMsg({ type: 'ERROR', text: 'A nova senha deve ter pelo menos 6 caracteres.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordStatusMsg({ type: 'ERROR', text: 'A confirmação da nova senha não confere.' });
      return;
    }

    setIsChangingPassword(true);
    try {
      ChurchUserAuthService.setPassword(church.id, currentUser.email, newPassword);
      await FirebaseAuthService.linkOrUpdateEmailPassword(
        currentUser.email,
        newPassword,
        currentPassword || undefined
      );
      await syncEngine.logAudit({
        churchId: church.id,
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'Alteração de Senha do Usuário',
        entityType: 'SECURITY',
        entityId: currentUser.id,
        details: `Senha de acesso atualizada no Firebase Authentication por ${currentUser.name}.`,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordStatusMsg({
        type: 'SUCCESS',
        text: 'Senha de acesso atualizada com sucesso no Firebase Authentication e no dispositivo!',
      });
    } catch (err: any) {
      const code = err?.code ? ` (${err.code})` : '';
      const friendly = FirebaseAuthService.getFriendlyAuthError(err);
      setPasswordStatusMsg({
        type: 'ERROR',
        text: `${friendly}${code}`,
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleRefreshDriveBackups = async () => {
    setDriveUploadStatus(null);
    setLoadingDriveBackups(true);
    try {
      const files = await GoogleDriveService.listChurchBackups(church.name);
      setDriveBackups(files);
    } catch (err: any) {
      setDriveUploadStatus({
        type: 'ERROR',
        text: err?.message || 'Não foi possível listar a pasta da igreja no Google Drive.',
      });
    } finally {
      setLoadingDriveBackups(false);
    }
  };

  const handleConnectGoogleDrive = async () => {
    setDriveUploadStatus(null);
    setLoadingDriveBackups(true);
    try {
      await FirebaseAuthService.connectGoogleWorkspace(true);
      const files = await GoogleDriveService.listChurchBackups(church.name);
      setDriveBackups(files);
      setDriveUploadStatus({
        type: 'SUCCESS',
        text: `Google Drive conectado à pasta "Secretaria da Igreja - ${church.name}".`,
      });
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') {
        setDriveUploadStatus({
          type: 'ERROR',
          text: FirebaseAuthService.getFriendlyAuthError(err),
        });
      }
    } finally {
      setLoadingDriveBackups(false);
    }
  };

  const handleUploadBackupToDrive = async (existingBackup?: BackupRecord) => {
    setDriveUploadStatus(null);
    setLoadingDriveBackups(true);
    try {
      const record =
        existingBackup ||
        (await BackupService.createBackup(church, currentUser, { trigger: 'MANUAL' }));
      if (!existingBackup) {
        setBackups(prev => [record, ...prev]);
      }
      const timestampLabel = (record.createdAtIso || new Date().toISOString())
        .replace(/[:.]/g, '-')
        .slice(0, 19);
      const fileName = `backup_${church.exclusiveCode || church.id}_${timestampLabel}.json`;
      const uploaded = await GoogleDriveService.uploadBackupToDrive(
        church.name,
        fileName,
        record.dataJson,
        'application/json'
      );
      await syncEngine.logAudit({
        churchId: church.id,
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'Envio de Backup para Google Drive',
        entityType: 'BACKUP',
        entityId: record.id,
        details: `Backup "${uploaded.name}" enviado para a pasta da igreja no Google Drive.`,
      });
      const files = await GoogleDriveService.listChurchBackups(church.name);
      setDriveBackups(files);
      setDriveUploadStatus({
        type: 'SUCCESS',
        text: `Backup "${uploaded.name}" salvo na pasta "Secretaria da Igreja - ${church.name}" do Google Drive.`,
      });
    } catch (err: any) {
      setDriveUploadStatus({
        type: 'ERROR',
        text: err?.message || 'Não foi possível enviar o backup para o Google Drive.',
      });
    } finally {
      setLoadingDriveBackups(false);
    }
  };

  const handleRestoreFromDriveFile = async (file: GoogleDriveFile) => {
    setLoadingDriveBackups(true);
    setDriveUploadStatus(null);
    try {
      const content = await GoogleDriveService.downloadBackupContent(file.id);
      const result = await BackupService.restoreBackupFromJsonString(content, church, currentUser);
      if (result.success) {
        setRestoreStatusMsg({
          type: 'SUCCESS',
          msg: `Backup "${file.name}" restaurado do Google Drive! ${result.restoredCounts.members} membros, ${result.restoredCounts.departments} depts e ${result.restoredCounts.events} eventos aplicados.`,
        });
        await loadAuditAndBackups();
        onRefreshData?.();
      } else {
        setDriveUploadStatus({
          type: 'ERROR',
          text: result.error || 'O arquivo do Google Drive não pôde ser restaurado.',
        });
      }
    } catch (err: any) {
      setDriveUploadStatus({
        type: 'ERROR',
        text: err?.message || 'Falha ao baixar backup do Google Drive.',
      });
    } finally {
      setLoadingDriveBackups(false);
    }
  };

  const handleConfirmDeleteDriveFile = async () => {
    if (!driveFileToDelete) return;
    const target = driveFileToDelete;
    setDriveFileToDelete(null);
    setLoadingDriveBackups(true);
    try {
      await GoogleDriveService.deleteBackupFromDrive(target.id);
      setDriveBackups(prev => prev.filter(f => f.id !== target.id));
      setDriveUploadStatus({
        type: 'SUCCESS',
        text: `Arquivo "${target.name}" removido da pasta do Google Drive.`,
      });
    } catch (err: any) {
      setDriveUploadStatus({
        type: 'ERROR',
        text: err?.message || 'Erro ao excluir arquivo no Google Drive.',
      });
    } finally {
      setLoadingDriveBackups(false);
    }
  };

  const handleImportJsonBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const rawJson = await file.text();
      const result = await BackupService.restoreBackupFromJsonString(rawJson, church, currentUser);
      if (result.success) {
        setRestoreStatusMsg({
          type: 'SUCCESS',
          msg: `Backup externo restaurado com sucesso! ${result.restoredCounts.members} membros, ${result.restoredCounts.departments} depts e ${result.restoredCounts.events} eventos aplicados.`
        });
        await loadAuditAndBackups();
        if (onRefreshData) onRefreshData();
      } else {
        setRestoreStatusMsg({
          type: 'ERROR',
          msg: result.error || 'Não foi possível restaurar o arquivo JSON selecionado.'
        });
      }
    } catch (err: any) {
      setRestoreStatusMsg({
        type: 'ERROR',
        msg: `Erro ao ler o arquivo de backup: ${err?.message || 'Formato inválido.'}`
      });
    }
  };

  const handleConfirmRestore = async (password: string) => {
    if (!selectedBackupForRestore) return;

    setShowRestoreConfirmModal(false);
    const result = await BackupService.restoreBackup(selectedBackupForRestore, church, currentUser);

    if (result.success) {
      setRestoreStatusMsg({
        type: 'SUCCESS',
        msg: `Restauração concluída com sucesso! ${result.restoredCounts.members} membros restaurados. Backup preventivo anterior foi salvo automaticamente.`
      });
      setSelectedBackupForRestore(null);
      await loadAuditAndBackups();
      if (onRefreshData) onRefreshData();
    } else {
      setRestoreStatusMsg({
        type: 'ERROR',
        msg: result.error || 'Falha ao restaurar backup.'
      });
    }
  };

  const handleGenerateLGPDDossier = () => {
    const member = members.find(m => m.id === lgpdSelectedMemberId);
    if (!member) return;

    const dossierText = JSON.stringify({
      relatorioLGPD: 'Dossiê do Titular de Dados Pessoais (Art. 18 LGPD)',
      igrejaControladora: church.name,
      emitidoEm: new Date().toLocaleString('pt-BR'),
      responsavelEmissao: currentUser.name,
      titular: {
        codigo: member.memberCode,
        nomeCompleto: member.fullName,
        dataNascimento: member.birthDate,
        dadosContato: {
          telefone: member.phone,
          email: member.email,
        },
        filiacao: {
          mae: member.motherName,
          pai: member.fatherName,
        },
        endereco: member.address,
        dadosEclesiasticos: {
          dataMembro: member.membershipDate,
          dataBatismo: member.baptismDate,
          cargo: member.churchRole,
          status: member.status,
          departamentos: member.departmentIds,
        },
        historicoOperacoes: member.history || [],
      },
      finalidadeTratamento: 'Administração eclesiástica de rol de membros conforme base legal associativa e legítimo interesse eclesiástico.',
      tempoRetencao: 'Retenção durante o período de membresia ativa + 5 anos para fins de arquivo histórico e certidões batismais.',
    }, null, 2);

    setLgpdDossier(dossierText);

    syncEngine.logAudit({
      churchId: church.id,
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'Geração de Dossiê do Titular (LGPD Art. 18)',
      entityType: 'EXPORT',
      entityId: member.id,
      details: `Dossiê completo de dados pessoais gerado para o membro ${member.fullName} (${member.memberCode}).`,
    });
  };

  const filteredLogs = auditLogs.filter(log => {
    const matchesSearch = log.action.toLowerCase().includes(auditSearch.toLowerCase()) ||
                          log.userName.toLowerCase().includes(auditSearch.toLowerCase()) ||
                          log.details.toLowerCase().includes(auditSearch.toLowerCase());
    const matchesType = auditFilterType === 'ALL' || log.entityType === auditFilterType;
    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Configurações & Administração</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Dados institucionais, segurança offline, logs de auditoria imutáveis, backup e conformidade LGPD da {church.name}.
        </p>
      </div>

      {saved && (
        <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-sm font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          Configurações salvas e registradas na auditoria com sucesso!
        </div>
      )}

      {restoreStatusMsg && (
        <div className={`flex items-center gap-2 rounded-2xl p-4 text-sm font-medium border ${
          restoreStatusMsg.type === 'SUCCESS' 
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300'
            : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300'
        }`}>
          {restoreStatusMsg.type === 'SUCCESS' ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertTriangle className="w-5 h-5 text-rose-600" />}
          <span>{restoreStatusMsg.msg}</span>
        </div>
      )}

      {/* Tabs navigation */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-800 pb-2">
        <button
          onClick={() => setActiveTab('INSTITUTIONAL')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${
            activeTab === 'INSTITUTIONAL'
              ? 'church-btn-primary'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Institucional & Identidade Visual</span>
        </button>

        <button
          onClick={() => setActiveTab('DASHBOARD_PREFS')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${
            activeTab === 'DASHBOARD_PREFS'
              ? 'church-btn-primary'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
          }`}
        >
          <LayoutGrid className="w-4 h-4" />
          <span>Personalizar Painel</span>
        </button>

        <button
          onClick={() => setActiveTab('OFFLINE_SECURITY')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${
            activeTab === 'OFFLINE_SECURITY'
              ? 'church-btn-primary'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Segurança Offline</span>
        </button>

        <button
          onClick={() => setActiveTab('AUDIT_LOGS')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${
            activeTab === 'AUDIT_LOGS'
              ? 'church-btn-primary'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Auditoria Geral (Logs)</span>
        </button>

        <button
          onClick={() => setActiveTab('BACKUP_RESTORE')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${
            activeTab === 'BACKUP_RESTORE'
              ? 'church-btn-primary'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Backup & Restauração</span>
        </button>

        <button
          onClick={() => setActiveTab('LGPD')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${
            activeTab === 'LGPD'
              ? 'church-btn-primary'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
          }`}
        >
          <FileCheck className="w-4 h-4" />
          <span>Privacidade & LGPD</span>
        </button>
      </div>

      {/* TAB 1: INSTITUTIONAL */}
      {activeTab === 'INSTITUTIONAL' && (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-800 space-y-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-600" />
              Dados Institucionais e Logotipo
            </h3>

            <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700">
              {formData.logoUrl ? (
                <img src={formData.logoUrl} alt={formData.name} className="h-16 w-16 rounded-2xl object-contain bg-white p-1 border border-gray-200" />
              ) : (
                <div className="h-16 w-16 rounded-2xl church-gradient-bg flex items-center justify-center font-bold text-xl">
                  {formData.name.charAt(0) || 'I'}
                </div>
              )}
              <div className="flex-1 text-center sm:text-left">
                <p className="text-xs font-bold text-gray-800 dark:text-gray-200">Logotipo Oficial da Igreja & Cores da Interface</p>
                <p className="text-[11px] text-gray-500">As cores do sistema serão adaptadas automaticamente a partir da logomarca enviada.</p>
                <div className="mt-2 flex flex-wrap justify-center sm:justify-start gap-2">
                  <label className="cursor-pointer rounded-xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50">
                    Carregar Logotipo
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          const img = new Image();
                          img.onload = async () => {
                            const scale = Math.min(240 / img.width, 240 / img.height, 1);
                            const canvas = document.createElement('canvas');
                            canvas.width = Math.round(img.width * scale);
                            canvas.height = Math.round(img.height * scale);
                            const ctx = canvas.getContext('2d');
                            if (ctx) {
                              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                              const dataUrl = canvas.toDataURL('image/png');
                              const extracted = await extractBrandColorsFromDataUrl(dataUrl);
                              setFormData(prev => ({
                                ...prev,
                                logoUrl: dataUrl,
                                primaryColor: extracted?.primaryColor || prev.primaryColor,
                                secondaryColor: extracted?.secondaryColor || prev.secondaryColor,
                              }));
                              if (extracted) {
                                setPaletteNotice('Cores extraídas automaticamente da logomarca! Clique em "Salvar Alterações" para aplicar em toda a interface.');
                              }
                            }
                          };
                          img.src = String(reader.result);
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                  {formData.logoUrl && (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!formData.logoUrl) return;
                          const extracted = await extractBrandColorsFromDataUrl(formData.logoUrl);
                          if (extracted) {
                            setFormData(prev => ({
                              ...prev,
                              primaryColor: extracted.primaryColor,
                              secondaryColor: extracted.secondaryColor,
                            }));
                            setPaletteNotice('Paleta re-extraída da logomarca! Clique em "Salvar Alterações" para confirmar.');
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-xl border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-800"
                      >
                        <Palette className="w-3.5 h-3.5" />
                        Extrair Cores do Logo
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, logoUrl: '' }))}
                        className="rounded-xl px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      >
                        Remover Logotipo
                      </button>
                    </>
                  )}
                </div>

                {/* Live Brand Color Customization */}
                <div className="mt-3 pt-3 border-t border-gray-200/80 dark:border-gray-700 flex flex-wrap items-center justify-center sm:justify-start gap-4">
                  <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
                    <span>Cor Principal:</span>
                    <input
                      type="color"
                      value={formData.primaryColor || DEFAULT_CHURCH_PRIMARY}
                      onChange={e => setFormData(prev => ({ ...prev, primaryColor: e.target.value }))}
                      className="h-7 w-9 cursor-pointer rounded border border-gray-300 bg-white p-0.5"
                    />
                    <span className="font-mono text-[11px] text-gray-500">{formData.primaryColor}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
                    <span>Cor Secundária:</span>
                    <input
                      type="color"
                      value={formData.secondaryColor || DEFAULT_CHURCH_SECONDARY}
                      onChange={e => setFormData(prev => ({ ...prev, secondaryColor: e.target.value }))}
                      className="h-7 w-9 cursor-pointer rounded border border-gray-300 bg-white p-0.5"
                    />
                    <span className="font-mono text-[11px] text-gray-500">{formData.secondaryColor}</span>
                  </label>
                  <div
                    className="h-7 px-3 rounded-lg flex items-center text-[11px] font-bold text-white shadow-xs"
                    style={{
                      background: `linear-gradient(135deg, ${formData.primaryColor || DEFAULT_CHURCH_PRIMARY}, ${formData.secondaryColor || DEFAULT_CHURCH_SECONDARY})`,
                    }}
                  >
                    Prévia da Identidade
                  </div>
                </div>

                {paletteNotice && (
                  <p className="mt-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                    {paletteNotice}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Nome da Igreja</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Denominação</label>
                <input
                  type="text"
                  value={formData.denomination}
                  onChange={e => setFormData({ ...formData, denomination: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">CNPJ</label>
                <input
                  type="text"
                  value={formData.cnpj || ''}
                  onChange={e => setFormData({ ...formData, cnpj: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Pastor Responsável
                </label>
                <input
                  type="text"
                  value={formData.pastorName}
                  onChange={e => setFormData({ ...formData, pastorName: e.target.value })}
                  placeholder="Nome do pastor responsável atual"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  Editável a qualquer momento em caso de troca periódica de pastor.
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">E-mail de Contato</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Telefone / WhatsApp</label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Código Exclusivo da Igreja</label>
                <input
                  type="text"
                  disabled
                  value={formData.exclusiveCode}
                  className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-100 px-3 py-2 text-sm font-mono text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Endereço Completo</label>
              <input
                type="text"
                value={formData.address}
                onChange={e => setFormData({ ...formData, address: e.target.value })}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-800 space-y-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              Licenciamento Institucional
            </h3>
            <div className="flex items-center justify-between p-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900">
              <div>
                <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Regime de Uso</p>
                <h4 className="font-bold text-gray-900 dark:text-white text-base mt-0.5">
                  Sistema 100% Gratuito
                </h4>
              </div>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                Liberado
              </span>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-xl church-btn-primary px-6 py-2.5 text-sm font-semibold transition"
            >
              Salvar Alterações
            </button>
          </div>
        </form>
      )}

      {activeTab === 'INSTITUTIONAL' && (
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-800 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Segurança da Conta</h3>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Sua sessão ({currentUser.email}) é protegida pela autenticação Google (Firebase Authentication). Gerencie sua senha e verificação em duas etapas diretamente na sua Conta Google.
          </p>
        </div>
      )}

      {/* TAB: PERSONALIZAR PAINEL */}
      {activeTab === 'DASHBOARD_PREFS' && (
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-800 space-y-6">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl p-3 border church-soft-badge">
              <LayoutGrid className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Personalizar Painel Principal</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Escolha quais blocos e módulos ficam visíveis na tela inicial da {church.name}.
              </p>
            </div>
          </div>

          {panelPrefsSaved && (
            <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-3.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>Preferências do painel principal atualizadas com sucesso!</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="flex items-start justify-between gap-4 p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/40 cursor-pointer hover:border-gray-300 dark:hover:border-gray-600 transition">
              <div>
                <span className="block text-sm font-bold text-gray-900 dark:text-white">
                  Atalhos de Acesso Rápido
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Exibe os botões em destaque para Membros, Departamentos, Agenda e Relatórios no topo do painel.
                </span>
              </div>
              <input
                type="checkbox"
                checked={panelPrefs.showQuickActions}
                onChange={e =>
                  setPanelPrefs(prev => ({ ...prev, showQuickActions: e.target.checked }))
                }
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </label>

            <label className="flex items-start justify-between gap-4 p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/40 cursor-pointer hover:border-gray-300 dark:hover:border-gray-600 transition">
              <div>
                <span className="block text-sm font-bold text-gray-900 dark:text-white">
                  Cartões de Indicadores
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Exibe os totais de Membros Ativos, Departamentos, Eventos do Mês e Batismos no Ano.
                </span>
              </div>
              <input
                type="checkbox"
                checked={panelPrefs.showStats}
                onChange={e =>
                  setPanelPrefs(prev => ({ ...prev, showStats: e.target.checked }))
                }
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </label>

            <label className="flex items-start justify-between gap-4 p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/40 cursor-pointer hover:border-gray-300 dark:hover:border-gray-600 transition">
              <div>
                <span className="block text-sm font-bold text-gray-900 dark:text-white">
                  Calendário da Agenda da Igreja
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Exibe o calendário mensal interativo para todos os usuários visualizarem os cultos e eventos.
                </span>
              </div>
              <input
                type="checkbox"
                checked={panelPrefs.showCalendar}
                onChange={e =>
                  setPanelPrefs(prev => ({ ...prev, showCalendar: e.target.checked }))
                }
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </label>

            <label className="flex items-start justify-between gap-4 p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/40 cursor-pointer hover:border-gray-300 dark:hover:border-gray-600 transition">
              <div>
                <span className="block text-sm font-bold text-gray-900 dark:text-white">
                  Módulo de Aniversariantes
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Exibe a lista filtrável de aniversariantes do dia, da semana ou do mês no painel principal.
                </span>
              </div>
              <input
                type="checkbox"
                checked={panelPrefs.showBirthdays}
                onChange={e =>
                  setPanelPrefs(prev => ({ ...prev, showBirthdays: e.target.checked }))
                }
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={() => {
                const reset = { ...DEFAULT_DASHBOARD_PREFS };
                setPanelPrefs(reset);
                saveDashboardPrefs(church.id, reset);
                window.dispatchEvent(new Event('dashboard-prefs-updated'));
                setPanelPrefsSaved(true);
                setTimeout(() => setPanelPrefsSaved(false), 3000);
              }}
              className="rounded-xl border border-gray-300 dark:border-gray-700 px-4 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
            >
              Restaurar Padrão
            </button>

            <button
              type="button"
              onClick={() => {
                saveDashboardPrefs(church.id, panelPrefs);
                window.dispatchEvent(new Event('dashboard-prefs-updated'));
                syncEngine.logAudit({
                  churchId: church.id,
                  userId: currentUser.id,
                  userName: currentUser.name,
                  action: 'Personalização do Painel Principal',
                  entityType: 'SETTINGS',
                  entityId: church.id,
                  details: `Visibilidade dos módulos do painel atualizada por ${currentUser.name}.`,
                });
                setPanelPrefsSaved(true);
                setTimeout(() => setPanelPrefsSaved(false), 3000);
              }}
              className="rounded-xl church-btn-primary px-6 py-2.5 text-sm font-semibold text-white transition"
            >
              Salvar Preferências do Painel
            </button>
          </div>
        </div>
      )}

      {/* TAB 2: OFFLINE SECURITY */}
      {activeTab === 'OFFLINE_SECURITY' && (
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-800 space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Políticas de Segurança da Sessão Offline</h3>
              <p className="text-xs text-gray-500">
                Configure a tolerância de funcionamento sem conexão e a proteção dos dados armazenados no IndexedDB.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-1">
            <p className="font-bold">Diretriz de Segurança Eclesiástica:</p>
            <p>
              O sistema armazena localmente no IndexedDB dados estritamente autorizados para o perfil do usuário. Para evitar que dispositivos perdidos ou furtados permaneçam acessíveis indefinidamente, a sessão offline possui um prazo máximo de validade antes de exigir reautenticação online.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-700 space-y-3">
              <label className="block text-xs font-bold text-gray-800 dark:text-gray-200 uppercase">
                Prazo Máximo de Uso Offline (Dias)
              </label>
              <select
                value={maxOfflineDays}
                onChange={e => setMaxOfflineDays(Number(e.target.value))}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              >
                <option value={3}>3 dias de tolerância</option>
                <option value={7}>7 dias de tolerância (Recomendado)</option>
                <option value={15}>15 dias de tolerância</option>
                <option value={30}>30 dias de tolerância</option>
              </select>
              <p className="text-[11px] text-gray-500">
                Após este período sem conexão com a internet, o aplicativo bloqueia operações e exige que o usuário se conecte novamente para validar suas credenciais.
              </p>
            </div>

            <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-700 space-y-3">
              <label className="block text-xs font-bold text-gray-800 dark:text-gray-200 uppercase">
                Backup Automático Preventivo
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoBackupDaily}
                  onChange={e => setAutoBackupDaily(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                />
                <span className="text-xs text-gray-700 dark:text-gray-300 font-medium">
                  Gerar backup snapshot automaticamente após operações de sincronização
                </span>
              </label>
              <p className="text-[11px] text-gray-500">
                Mantém cópia local e na nuvem dos dados no IndexedDB, protegendo contra exclusões e falhas de rede.
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleSubmit}
              className="rounded-xl church-btn-primary px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition"
            >
              Salvar Políticas de Segurança Offline
            </button>
          </div>
        </div>
      )}

      {/* TAB 3: AUDIT LOGS */}
      {activeTab === 'AUDIT_LOGS' && (
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-800 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <History className="w-5 h-5 text-indigo-600" />
                Histórico Completo de Auditoria (Imutável)
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Registros de segurança de logins, cadastros, alterações de permissão, exclusões e restaurações.
              </p>
            </div>
            <button
              onClick={loadAuditAndBackups}
              className="self-start sm:self-center flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Atualizar Logs</span>
            </button>
          </div>

          <div className="p-3.5 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-xs text-blue-900 dark:text-blue-200 flex items-center gap-2">
            <Lock className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <span>
              <strong>Registro protegido contra adulteração:</strong> As regras de segurança do Firestore e a arquitetura do sistema bloqueiam edições e exclusões de registros de auditoria por qualquer usuário.
            </span>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Pesquisar por ação, responsável ou detalhes..."
                value={auditSearch}
                onChange={e => setAuditSearch(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2 pl-10 pr-4 text-xs text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </div>
            <select
              value={auditFilterType}
              onChange={e => setAuditFilterType(e.target.value)}
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            >
              <option value="ALL">Todas as Categorias</option>
              <option value="MEMBER">Membros</option>
              <option value="DEPARTMENT">Departamentos</option>
              <option value="USER">Usuários / Permissões</option>
              <option value="BACKUP">Backups / Restauração</option>
              <option value="EXPORT">Exportações / LGPD</option>
              <option value="SECURITY">Segurança</option>
            </select>
          </div>

          {/* Audit Logs Table */}
          <div className="border border-gray-200 rounded-2xl overflow-hidden dark:border-gray-800">
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 sticky top-0">
                  <tr>
                    <th className="p-3">Data e Horário</th>
                    <th className="p-3">Usuário</th>
                    <th className="p-3">Ação</th>
                    <th className="p-3">Detalhes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredLogs.map(log => (
                    <tr key={log.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/40">
                      <td className="p-3 font-mono text-[11px] whitespace-nowrap text-gray-500">{log.date}</td>
                      <td className="p-3 font-semibold text-gray-900 dark:text-white whitespace-nowrap">{log.userName}</td>
                      <td className="p-3 font-semibold text-blue-700 dark:text-blue-400">{log.action}</td>
                      <td className="p-3 text-gray-600 dark:text-gray-300 max-w-xs truncate" title={log.details}>
                        {log.details}
                      </td>
                    </tr>
                  ))}
                  {filteredLogs.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-gray-400 text-xs">
                        Nenhum registro de auditoria encontrado para os critérios selecionados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: BACKUP & RESTORE */}
      {activeTab === 'BACKUP_RESTORE' && (
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-800 space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-600" />
                Backup Automático e Exportação Completa
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Exporte membros, departamentos, eventos e logs em JSON ou CSV para o dispositivo local (manual ou periódico).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleManualExport('JSON')}
                disabled={loadingBackup}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 transition disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{loadingBackup ? 'Exportando...' : 'Exportar JSON'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleManualExport('CSV')}
                disabled={loadingBackup}
                className="flex items-center gap-1.5 rounded-xl bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-800 transition disabled:opacity-50"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Exportar CSV</span>
              </button>
              <button
                type="button"
                onClick={handleCreateBackupNow}
                disabled={loadingBackup}
                className="flex items-center gap-1.5 rounded-xl border border-gray-300 bg-gray-50 px-3.5 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 transition disabled:opacity-50"
              >
                <Database className="w-3.5 h-3.5" />
                <span>Gerar Snapshot</span>
              </button>
              {isSecretary && (
                <label className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 cursor-pointer transition">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Importar JSON</span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={handleImportJsonBackupFile}
                  />
                </label>
              )}
            </div>
          </div>

          {restoreStatusMsg && (
            <div className={`p-3.5 rounded-2xl text-xs font-medium flex items-center justify-between gap-3 ${
              restoreStatusMsg.type === 'SUCCESS'
                ? 'bg-emerald-50 text-emerald-900 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200'
                : 'bg-rose-50 text-rose-900 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200'
            }`}>
              <span>{restoreStatusMsg.msg}</span>
              <button type="button" onClick={() => setRestoreStatusMsg(null)} className="font-bold px-2">OK</button>
            </div>
          )}

          {/* Automatic Scheduled Backup Card */}
          <div className="p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/50 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-600" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-800 dark:text-gray-200">
                  Agendamento Automático no Banco de Dados
                </h4>
              </div>
              {autoScheduleSaved && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Agendamento salvo
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 dark:text-gray-300 uppercase mb-1">
                  Periodicidade Automática
                </label>
                <select
                  value={autoBackupFrequency}
                  onChange={e => setAutoBackupFrequency(e.target.value as 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'DISABLED')}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value="DAILY">Diário (a cada 24 horas)</option>
                  <option value="WEEKLY">Semanal (a cada 7 dias)</option>
                  <option value="MONTHLY">Mensal (a cada 30 dias)</option>
                  <option value="DISABLED">Desativado (somente manual)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 dark:text-gray-300 uppercase mb-1">
                  Formato Padrão de Exportação Manual
                </label>
                <select
                  value={autoBackupFormat}
                  onChange={e => setAutoBackupFormat(e.target.value as 'JSON' | 'CSV' | 'BOTH')}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value="JSON">JSON Completo (Recomendado)</option>
                  <option value="CSV">CSV Planilha (Excel)</option>
                  <option value="BOTH">Ambos (JSON + CSV)</option>
                </select>
              </div>
            </div>

            <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
              Os backups automáticos são gravados exclusivamente dentro do banco de dados da igreja (Cloud Firestore e IndexedDB), sem baixar arquivos na memória do celular ou computador ao entrar no aplicativo. Use os botões manuais acima para baixar cópias em JSON ou CSV quando precisar.
            </p>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-gray-200/70 dark:border-gray-700">
              <div className="text-[11px] text-gray-500 space-x-3">
                <span>
                  <strong>Último automático:</strong>{' '}
                  {church.offlineConfig?.lastAutoBackupAt
                    ? new Date(church.offlineConfig.lastAutoBackupAt).toLocaleString('pt-BR')
                    : 'Aguardando primeira execução'}
                </span>
                <span>•</span>
                <span>
                  <strong>Próximo:</strong>{' '}
                  {(() => {
                    const nextDate = BackupService.getNextAutoBackupDate({
                      ...church,
                      offlineConfig: {
                        ...church.offlineConfig,
                        maxOfflineDays,
                        autoBackupDaily: autoBackupFrequency !== 'DISABLED',
                        autoBackupFrequency,
                      },
                    });
                    return nextDate ? nextDate.toLocaleString('pt-BR') : 'Desativado';
                  })()}
                </span>
              </div>
              <button
                type="button"
                onClick={handleSaveAutoBackupSchedule}
                className="self-start sm:self-center rounded-xl church-btn-primary px-4 py-2 text-xs font-semibold text-white transition"
              >
                Salvar Agendamento Automático
              </button>
            </div>
          </div>

          {/* Google Drive Church Folder Backups */}
          <div className="p-5 rounded-2xl border border-blue-200/80 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-blue-900 dark:text-blue-200 flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-blue-600" />
                  Backup em Pasta da Igreja no Google Drive
                </h4>
                <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-0.5">
                  Pasta dedicada: <strong>Secretaria da Igreja - {church.name}</strong>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {GoogleDriveService.getAccessToken() ? (
                  <>
                    <button
                      type="button"
                      onClick={handleRefreshDriveBackups}
                      disabled={loadingDriveBackups}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 disabled:opacity-50"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Atualizar Drive</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUploadBackupToDrive()}
                      disabled={loadingDriveBackups}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 transition disabled:opacity-50"
                    >
                      <Cloud className="w-3.5 h-3.5" />
                      <span>{loadingDriveBackups ? 'Sincronizando...' : 'Enviar Backup para o Drive'}</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleConnectGoogleDrive}
                    disabled={loadingDriveBackups}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 transition disabled:opacity-50"
                  >
                    <Cloud className="w-3.5 h-3.5" />
                    <span>{loadingDriveBackups ? 'Conectando...' : 'Conectar Google Drive'}</span>
                  </button>
                )}
              </div>
            </div>

            {driveUploadStatus && (
              <div
                className={`p-3 rounded-xl text-xs font-medium border ${
                  driveUploadStatus.type === 'SUCCESS'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200'
                    : 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200'
                }`}
              >
                {driveUploadStatus.text}
              </div>
            )}

            {GoogleDriveService.getAccessToken() && (
              <div className="divide-y divide-gray-200/70 dark:divide-gray-800 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
                {driveBackups.map(file => (
                  <div key={file.id} className="p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white">{file.name}</p>
                      <p className="text-[11px] text-gray-500">
                        {new Date(file.createdTime).toLocaleString('pt-BR')}
                        {file.size ? ` • ${(Number(file.size) / 1024).toFixed(1)} KB` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {file.webViewLink && (
                        <a
                          href={file.webViewLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-200 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Abrir</span>
                        </a>
                      )}
                      {isSecretary && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleRestoreFromDriveFile(file)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 text-[11px] font-semibold"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Restaurar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setDriveFileToDelete(file)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950 dark:text-rose-300 text-[11px] font-semibold"
                            title="Excluir do Google Drive"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {driveBackups.length === 0 && !loadingDriveBackups && (
                  <div className="p-4 text-center text-[11px] text-gray-400">
                    Nenhum backup encontrado na pasta da igreja no Google Drive ainda.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 space-y-1">
            <p className="font-bold">Conteúdo Completo & Proteção Multi-Tenant:</p>
            <p>
              Cada backup reúne <strong>membros, departamentos, eventos e logs de auditoria</strong> com checksum digital e isolamento por igreja. Antes de restaurar qualquer cópia, um <strong>backup preventivo automático</strong> é criado para reversão segura.
            </p>
          </div>

          {/* Backups List */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Histórico de Backups da Igreja ({backups.length})
            </h4>

            <div className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200 rounded-2xl overflow-hidden dark:border-gray-800">
              {backups.map(b => (
                <div key={b.id} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white dark:bg-gray-900">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-gray-900 dark:text-white text-xs">{b.createdAt}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        b.status === 'PRE_RESTORE'
                          ? 'bg-amber-100 text-amber-800'
                          : b.trigger === 'AUTOMATIC'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {b.status === 'PRE_RESTORE'
                          ? 'Preventivo Pré-Restauração'
                          : b.trigger === 'AUTOMATIC'
                          ? 'Automático Periódico'
                          : 'Manual / Sincronizado'}
                      </span>
                      <span className="text-[10px] font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                        {b.checksum}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                      <span>Criado por: {b.createdBy}</span>
                      <span>•</span>
                      <span>{b.recordCounts.members} membros</span>
                      <span>•</span>
                      <span>{b.recordCounts.departments} depts</span>
                      <span>•</span>
                      <span>{b.recordCounts.events} eventos</span>
                      <span>•</span>
                      <span>{b.recordCounts.auditLogs || 0} logs</span>
                      <span>•</span>
                      <span>{(b.sizeBytes / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => BackupService.downloadBackupToDevice(church.name, b.dataJson, 'JSON', b.createdAtIso || b.createdAt)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 text-[11px] font-semibold"
                      title="Baixar Arquivo JSON do Backup"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>JSON</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => BackupService.downloadBackupToDevice(church.name, b.dataJson, 'CSV', b.createdAtIso || b.createdAt)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 text-[11px] font-semibold"
                      title="Baixar Arquivo CSV do Backup"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>CSV</span>
                    </button>

                    {isSecretary && (
                      <button
                        type="button"
                        onClick={() => setSelectedBackupForRestore(b)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 text-xs font-semibold transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Restaurar</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {backups.length === 0 && (
                <div className="p-8 text-center text-gray-400 text-xs">
                  Nenhum backup registrado ainda. Clique em "Exportar JSON" ou "Exportar CSV" para salvar o primeiro backup completo no seu dispositivo.
                </div>
              )}
            </div>
          </div>

          {onClearDemoData && isSecretary && (
            <div className="mt-4 p-5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-1">
                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-600" />
                  <span>Preparar Base Real (Remover Dados de Demonstração)</span>
                </h4>
                <p className="text-xs text-amber-800/90 dark:text-amber-300 leading-relaxed">
                  Remove os registros de exemplo locais de membros, departamentos e eventos desta igreja (mantendo sua conta e configurações) para você iniciar ou importar sua planilha real do zero.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowClearDemoConfirmModal(true)}
                className="flex-shrink-0 rounded-xl bg-amber-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-amber-800 transition shadow-sm"
              >
                Limpar Dados de Exemplo
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: LGPD */}
      {activeTab === 'LGPD' && (
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-800 space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
              <FileCheck className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Privacidade & Conformidade LGPD (Lei 13.709/2018)</h3>
              <p className="text-xs text-gray-500">
                Atendimento aos direitos dos titulares de dados pessoais, controle de consentimento e retenção.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs space-y-2">
              <h4 className="font-bold text-gray-900 dark:text-white">1. Minimização de Dados</h4>
              <p className="text-gray-500 leading-relaxed">
                Apenas dados eclesiásticos necessários ao rol congregacional são armazenados. O único campo de preenchimento compulsório é o nome completo.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs space-y-2">
              <h4 className="font-bold text-gray-900 dark:text-white">2. Sigilo de Informações Sensíveis</h4>
              <p className="text-gray-500 leading-relaxed">
                Telefones, endereços e filiação são restritos exclusivamente à Secretaria Geral e Administradores, inacessíveis a líderes de departamento e visitantes.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs space-y-2">
              <h4 className="font-bold text-gray-900 dark:text-white">3. Direito de Acesso e Portabilidade</h4>
              <p className="text-gray-500 leading-relaxed">
                O membro pode solicitar a qualquer momento cópia integral de seu dossiê de dados armazenados para portabilidade ou conferência.
              </p>
            </div>
          </div>

          {/* Dossiê Generator */}
          <div className="p-5 rounded-2xl border border-gray-200 dark:border-gray-700 space-y-4">
            <h4 className="font-bold text-sm text-gray-900 dark:text-white">
              Emissão de Dossiê do Titular (Artigo 18 da LGPD)
            </h4>
            <p className="text-xs text-gray-500">
              Selecione o membro para emitir o relatório completo de dados mantidos pela igreja:
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <select
                value={lgpdSelectedMemberId}
                onChange={e => setLgpdSelectedMemberId(e.target.value)}
                className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              >
                <option value="">Selecione o membro titular...</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.fullName} ({m.memberCode})</option>
                ))}
              </select>

              <button
                disabled={!lgpdSelectedMemberId}
                onClick={handleGenerateLGPDDossier}
                className="rounded-xl bg-indigo-700 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-800 transition disabled:opacity-40"
              >
                Gerar Dossiê do Titular
              </button>
            </div>

            {lgpdDossier && (
              <div className="mt-4 p-4 rounded-xl bg-gray-900 text-emerald-400 font-mono text-[11px] overflow-x-auto max-h-72">
                <pre>{lgpdDossier}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Prévia de Restauração com Confirmação de Senha */}
      {selectedBackupForRestore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 sm:p-8 shadow-2xl dark:bg-gray-900 max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-gray-100 dark:border-gray-800">
              <div className="p-3 rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">Pré-visualização e Restauração de Dados</h3>
                <p className="text-xs text-gray-500">Igreja: {selectedBackupForRestore.churchName}</p>
              </div>
            </div>

            <div className="space-y-3 text-xs text-gray-700 dark:text-gray-300">
              <p>Você está prestes a restaurar os dados gravados no backup de <strong>{selectedBackupForRestore.createdAt}</strong>.</p>
              
              <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800 space-y-1 text-[11px]">
                <p><strong>Membros a serem restaurados:</strong> {selectedBackupForRestore.recordCounts.members}</p>
                <p><strong>Departamentos:</strong> {selectedBackupForRestore.recordCounts.departments}</p>
                <p><strong>Eventos:</strong> {selectedBackupForRestore.recordCounts.events}</p>
                <p><strong>Checksum de Integridade:</strong> {selectedBackupForRestore.checksum}</p>
              </div>

              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-300 border border-amber-200 dark:border-amber-900">
                <strong>Garantia de Reversão:</strong> Um backup preventivo automático do estado atual será criado imediatamente antes da restauração.
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={() => setSelectedBackupForRestore(null)}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => setShowRestoreConfirmModal(true)}
                className="rounded-xl church-btn-primary px-5 py-2 text-xs font-semibold text-white transition"
              >
                Prosseguir com Confirmação de Senha &rarr;
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Security Password Reauthentication Modal */}
      {showRestoreConfirmModal && (
        <SecurityConfirmModal
          title="Autorizar Restauração de Backup"
          description={`Confirme sua senha para restaurar o backup de ${selectedBackupForRestore?.createdAt}. Esta operação sobrescreverá o estado atual após gerar backup preventivo.`}
          actionName="Confirmar e Restaurar Dados"
          isDanger={true}
          onConfirm={handleConfirmRestore}
          onCancel={() => setShowRestoreConfirmModal(false)}
        />
      )}

      {showClearDemoConfirmModal && onClearDemoData && (
        <SecurityConfirmModal
          title="Limpar Dados de Demonstração"
          description={`Confirme sua senha para remover os registros locais de exemplo (membros, departamentos e agenda) de "${church.name}" e iniciar a base real limpa.`}
          actionName="Confirmar Limpeza da Base"
          isDanger={true}
          onConfirm={async () => {
            setShowClearDemoConfirmModal(false);
            await onClearDemoData();
            setRestoreStatusMsg({
              type: 'SUCCESS',
              msg: 'Dados de demonstração removidos com sucesso! Agora você pode cadastrar ou importar seus membros reais.'
            });
          }}
          onCancel={() => setShowClearDemoConfirmModal(false)}
        />
      )}

      {driveFileToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-900 space-y-4">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Excluir Backup do Google Drive</h3>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Deseja realmente remover o arquivo <strong>"{driveFileToDelete.name}"</strong> da pasta da igreja no Google Drive? Esta ação não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setDriveFileToDelete(null)}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteDriveFile}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 transition"
              >
                Excluir do Drive
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
