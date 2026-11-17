import React, { useState, useEffect } from 'react';
import { syncEngine } from '../services/syncEngine';
import { IndexedDBService } from '../services/indexedDB';
import { auth, FirebaseService, FirebaseAuthService } from '../services/firebase';
import type { User as FirebaseUser } from 'firebase/auth';
import { BackupService } from '../services/backupService';
import { SyncQueueItem, SyncConflict } from '../types';
import { 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Layers, 
  ShieldCheck, 
  X,
  CloudUpload,
  Download,
  Upload,
  Database
} from 'lucide-react';

interface SyncStatusDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  isSimulatedOffline: boolean;
  onToggleSimulateOffline: () => void;
  onPullFromCloud?: () => Promise<void>;
  onPushAllLocalToCloud?: () => Promise<{ pushed: number; queued: number }>;
  onImportNetlifySnapshot?: (rawJson: string) => Promise<{
    churches: number;
    users: number;
    members: number;
    departments: number;
    events: number;
    syncedToCloud: number;
  }>;
  isPlatformUser?: boolean;
}

export const SyncStatusDrawer: React.FC<SyncStatusDrawerProps> = ({
  isOpen,
  onClose,
  isSimulatedOffline,
  onToggleSimulateOffline,
  onPullFromCloud,
  onPushAllLocalToCloud,
  onImportNetlifySnapshot,
  isPlatformUser = false,
}) => {
  const [queueItems, setQueueItems] = useState<SyncQueueItem[]>([]);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [syncStatus, setSyncStatus] = useState<string>('IDLE');
  const [isSyncing, setIsSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'SUCCESS' | 'ERROR' | 'INFO'; text: string } | null>(null);
  const [sessionInfo, setSessionInfo] = useState<{ remainingDays: number; lastAuthDate: string }>({
    remainingDays: 7,
    lastAuthDate: new Date().toLocaleDateString('pt-BR'),
  });

  const connInfo = FirebaseService.getConnectionInfo();

  const loadData = async () => {
    const queue = await IndexedDBService.getAll<SyncQueueItem>('syncQueue');
    const conflictList = await IndexedDBService.getAll<SyncConflict>('conflicts');
    const sess = await syncEngine.checkOfflineSession(7);

    setQueueItems(queue.sort((a, b) => b.timestamp - a.timestamp));
    setConflicts(conflictList.filter(c => c.status === 'PENDING'));
    setSessionInfo({
      remainingDays: sess.remainingDays,
      lastAuthDate: sess.lastAuthDate,
    });
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
    const unsubscribe = syncEngine.subscribe((state) => {
      setSyncStatus(state.status);
      loadData();
    });
    return () => unsubscribe();
  }, [isOpen]);

  const [currentUserAuth, setCurrentUserAuth] = useState(auth.currentUser);

  useEffect(() => {
    const unsub = FirebaseAuthService.onAuthChanged((user: FirebaseUser | null) => {
      setCurrentUserAuth(user);
    });
    return () => unsub();
  }, []);

  const handleConnectGoogle = async () => {
    if (!navigator.onLine || isSimulatedOffline) {
      setFeedback({ type: 'ERROR', text: 'Conecte-se à internet para autenticar no Firebase.' });
      return;
    }
    setIsSyncing(true);
    setFeedback(null);
    try {
      const user = await FirebaseAuthService.signInWithGoogle(true);
      if (user) {
        setFeedback({
          type: 'SUCCESS',
          text: `Autenticado com sucesso no Firebase como ${user.email}! Nuvem Firestore ativada.`,
        });
        if (onPullFromCloud) await onPullFromCloud();
        await loadData();
      }
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        setFeedback({
          type: 'ERROR',
          text: FirebaseAuthService.getFriendlyAuthError(err) || 'Erro ao autenticar com Conta Google.',
        });
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleManualSync = async () => {
    if (isSimulatedOffline || !navigator.onLine) {
      setFeedback({ type: 'ERROR', text: 'Não é possível sincronizar enquanto estiver em modo offline.' });
      return;
    }
    if (!auth.currentUser) {
      setIsSyncing(true);
      setFeedback({ type: 'INFO', text: 'Conectando ao Firebase com Conta Google para sincronizar com a nuvem...' });
      try {
        const user = await FirebaseAuthService.signInWithGoogle(true);
        if (!user) {
          setIsSyncing(false);
          setFeedback({ type: 'ERROR', text: 'Autenticação Google cancelada.' });
          return;
        }
        setFeedback({ type: 'SUCCESS', text: `Autenticado como ${user.email}! Sincronizando com o Firestore...` });
      } catch (err: any) {
        setIsSyncing(false);
        if (err?.code !== 'auth/popup-closed-by-user') {
          setFeedback({ type: 'ERROR', text: FirebaseAuthService.getFriendlyAuthError(err) });
        } else {
          setFeedback({
            type: 'INFO',
            text: 'Autenticação cancelada. Clique em "Conectar Conta Google" para sincronizar com a nuvem.',
          });
        }
        return;
      }
    }
    setIsSyncing(true);
    setFeedback(null);
    try {
      const result = await syncEngine.processQueue();
      if (onPullFromCloud) {
        await onPullFromCloud();
      }
      await loadData();
      if (result.errors.length > 0) {
        setFeedback({
          type: 'ERROR',
          text: `Sincronização concluída com avisos: ${result.errors.join(' | ')}`,
        });
      } else {
        setFeedback({
          type: 'SUCCESS',
          text: `Sincronização bidirecional concluída! ${result.syncedCount} operação(ões) enviada(s) e dados atualizados da nuvem Firestore.`,
        });
      }
    } catch (err: any) {
      setFeedback({ type: 'ERROR', text: err?.message || 'Falha ao sincronizar com a nuvem.' });
    } finally {
      setIsSyncing(false);
    }
  };

  const handlePushAllLocal = async () => {
    if (isSimulatedOffline || !navigator.onLine) {
      setFeedback({ type: 'ERROR', text: 'Conecte-se à internet para enviar seus dados locais ao Firestore.' });
      return;
    }
    if (!auth.currentUser) {
      setIsSyncing(true);
      setFeedback({ type: 'INFO', text: 'Conectando ao Firebase com Conta Google para gravar dados na nuvem...' });
      try {
        const user = await FirebaseAuthService.signInWithGoogle(true);
        if (!user) {
          setIsSyncing(false);
          setFeedback({ type: 'ERROR', text: 'Autenticação Google cancelada.' });
          return;
        }
        setFeedback({ type: 'SUCCESS', text: `Autenticado como ${user.email}! Gravando dados locais no Firestore...` });
      } catch (err: any) {
        setIsSyncing(false);
        if (err?.code !== 'auth/popup-closed-by-user') {
          setFeedback({ type: 'ERROR', text: FirebaseAuthService.getFriendlyAuthError(err) });
        } else {
          setFeedback({
            type: 'INFO',
            text: 'Autenticação cancelada. Clique em "Conectar Conta Google" para gravar na nuvem.',
          });
        }
        return;
      }
    }
    if (!onPushAllLocalToCloud) return;
    setIsSyncing(true);
    setFeedback(null);
    try {
      const res = await onPushAllLocalToCloud();
      await loadData();
      setFeedback({
        type: 'SUCCESS',
        text: `Envio completo concluído: ${res.pushed} registro(s) gravado(s) no Firestore${res.queued > 0 ? ` e ${res.queued} na fila` : ''}.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'ERROR', text: err?.message || 'Erro ao reenviar dados locais.' });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleExportSnapshot = async () => {
    try {
      const snapshot = await BackupService.exportFullPlatformSnapshot();
      BackupService.downloadPlatformSnapshotToDevice(snapshot);
      setFeedback({
        type: 'SUCCESS',
        text: `Pacote de sincronização exportado (${snapshot.churches.length} igreja(s), ${snapshot.members.length} membro(s)).`,
      });
    } catch (err: any) {
      setFeedback({ type: 'ERROR', text: err?.message || 'Não foi possível exportar o pacote.' });
    }
  };

  const handleImportSnapshotFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setIsSyncing(true);
    setFeedback(null);
    try {
      const rawJson = await file.text();
      if (onImportNetlifySnapshot) {
        const res = await onImportNetlifySnapshot(rawJson);
        setFeedback({
          type: 'SUCCESS',
          text: `Dados do Netlify importados: ${res.churches} igreja(s), ${res.users} usuário(s), ${res.members} membro(s), ${res.departments} depto(s), ${res.events} evento(s). (${res.syncedToCloud} enviado(s) ao Firestore).`,
        });
      } else {
        const res = await BackupService.importFullPlatformSnapshot(rawJson, { isPlatformAdmin: isPlatformUser });
        if (onPullFromCloud) await onPullFromCloud();
        setFeedback({
          type: 'SUCCESS',
          text: `Pacote importado (${res.churches} igreja(s), ${res.members} membro(s)).`,
        });
      }
      await loadData();
    } catch (err: any) {
      setFeedback({ type: 'ERROR', text: err?.message || 'Falha ao importar arquivo JSON do Netlify.' });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleResolveConflict = async (conflictId: string, resolution: 'KEPT_LOCAL' | 'KEPT_REMOTE') => {
    await syncEngine.resolveConflict(conflictId, resolution);
    await loadData();
    setFeedback({
      type: 'SUCCESS',
      text: `Conflito resolvido com a opção: ${resolution === 'KEPT_LOCAL' ? 'Versão Local' : 'Versão Remota'}.`,
    });
  };

  const handleSimulateConflict = async () => {
    const fakeConflict: SyncConflict = {
      id: `conflict-test-${Date.now()}`,
      churchId: 'church-1',
      entity: 'MEMBER',
      entityId: 'mem-1',
      entityName: 'Juliana Almeida',
      localVersion: {
        id: 'mem-1',
        fullName: 'Juliana Almeida Santos (Editado Offline)',
        phone: '(11) 91111-9999',
        notes: 'Atualização feita sem conexão',
        updatedAt: new Date().toISOString(),
      },
      remoteVersion: {
        id: 'mem-1',
        fullName: 'Juliana Almeida Silva (Editado na Nuvem)',
        phone: '(11) 91111-2222',
        notes: 'Alteração feita por outro usuário no servidor',
        updatedAt: new Date(Date.now() + 1000).toISOString(),
      },
      detectedAt: new Date().toLocaleString('pt-BR'),
      status: 'PENDING',
    };

    await IndexedDBService.put('conflicts', fakeConflict);
    await loadData();
    setFeedback({
      type: 'INFO',
      text: 'Simulação de conflito gerada. Veja o comparativo lado a lado abaixo.',
    });
  };

  if (!isOpen) return null;

  const isOnline = navigator.onLine && !isSimulatedOffline;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/50 backdrop-blur-xs">
      <div className="h-full w-full max-w-lg bg-white p-6 shadow-2xl dark:bg-gray-900 overflow-y-auto flex flex-col justify-between">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${isOnline ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}`}>
                {isOnline ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white text-base">Central Offline & Sincronização</h3>
                <p className="text-[11px] text-gray-500">Firestore em Tempo Real • IndexedDB • Ponte Netlify</p>
              </div>
            </div>
            <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
              <X className="w-5 h-5" />
            </button>
          </div>

          {feedback && (
            <div className={`mt-3 p-3 rounded-2xl text-xs font-medium flex items-start justify-between gap-2 border ${
              feedback.type === 'SUCCESS'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-200'
                : feedback.type === 'ERROR'
                ? 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/60 dark:border-rose-800 dark:text-rose-200'
                : 'bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/60 dark:border-blue-800 dark:text-blue-200'
            }`}>
              <span>{feedback.text}</span>
              <button onClick={() => setFeedback(null)} className="text-[11px] font-bold opacity-70 hover:opacity-100">OK</button>
            </div>
          )}

          {/* Connection status banner */}
          <div className={`mt-4 p-4 rounded-2xl flex items-center justify-between border ${
            isOnline 
              ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200' 
              : 'bg-amber-50/70 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200'
          }`}>
            <div>
              <div className="flex items-center gap-2 font-bold text-xs">
                <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                <span>{isOnline ? 'Dispositivo Online (Firestore em Tempo Real)' : 'Dispositivo Offline (Operando via IndexedDB)'}</span>
              </div>
              <p className="text-[11px] mt-0.5 opacity-80">
                {isOnline 
                  ? `Status: ${syncStatus} • Sincronização automática com o mesmo banco usado pelo Netlify.` 
                  : 'Todas as operações serão salvas no IndexedDB e sincronizadas ao retornar a internet.'}
              </p>
            </div>
            <button
              onClick={onToggleSimulateOffline}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold shadow-xs transition flex-shrink-0 ${
                isSimulatedOffline 
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700' 
                  : 'bg-amber-600 text-white hover:bg-amber-700'
              }`}
            >
              {isSimulatedOffline ? 'Reconectar' : 'Simular Offline'}
            </button>
          </div>

          {!currentUserAuth && (
            <div className="mt-3 p-3.5 rounded-2xl bg-amber-50 border border-amber-300 dark:bg-amber-950/40 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-bold">Conexão Firebase Pendente</p>
                  <p className="text-[11px] text-amber-800/90 dark:text-amber-300">
                    Conecte sua Conta Google para gravar diretamente no Firestore compartilhado.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleConnectGoogle}
                disabled={isSyncing}
                className="flex-shrink-0 rounded-xl bg-amber-700 hover:bg-amber-800 text-white px-3.5 py-1.5 text-xs font-bold transition shadow-xs disabled:opacity-50"
              >
                Conectar Conta Google
              </button>
            </div>
          )}

          {/* Active Cloud Firestore Bridge Info */}
          <div className="mt-3 p-3.5 rounded-2xl bg-slate-50 dark:bg-gray-800/70 border border-slate-200 dark:border-gray-700 text-[11px] space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-gray-200">
                <Database className="w-4 h-4 text-indigo-600" />
                <span>Banco Compartilhado (Netlify ↔ App)</span>
              </div>
              {currentUserAuth ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 truncate max-w-[190px]">
                  {currentUserAuth.email || 'Autenticado'}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleConnectGoogle}
                  disabled={isSyncing}
                  className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 hover:bg-amber-200 transition"
                >
                  Conectar Google
                </button>
              )}
            </div>
            <div className="text-[10px] text-slate-600 dark:text-gray-400 space-y-0.5 font-mono">
              <p className="truncate">Projeto: {connInfo.projectId}</p>
              <p className="truncate">Firestore DB: {connInfo.firestoreDatabaseId}</p>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {onPushAllLocalToCloud && (
                <button
                  type="button"
                  onClick={handlePushAllLocal}
                  disabled={isSyncing || !isOnline}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-700 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-800 transition disabled:opacity-40"
                >
                  <CloudUpload className="w-3.5 h-3.5" />
                  <span>Enviar Tudo p/ Nuvem</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleExportSnapshot}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Exportar Pacote (.json)</span>
              </button>
              <label className="inline-flex items-center gap-1.5 rounded-xl border border-blue-300 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-200 cursor-pointer transition">
                <Upload className="w-3.5 h-3.5" />
                <span>Importar do Netlify (.json)</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={handleImportSnapshotFile}
                />
              </label>
            </div>
          </div>

          {/* Offline Security Session Badge */}
          <div className="mt-3 p-3.5 rounded-2xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-900 text-xs text-blue-900 dark:text-blue-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <div>
                <p className="font-semibold">Segurança Offline Ativa</p>
                <p className="text-[10px] text-blue-600/80 dark:text-blue-400">
                  Sessão válida por mais <strong>{sessionInfo.remainingDays} dias</strong> (Última autenticação: {sessionInfo.lastAuthDate})
                </p>
              </div>
            </div>
            <span className="text-[10px] font-mono bg-blue-100 dark:bg-blue-900 px-2 py-0.5 rounded text-blue-800 dark:text-blue-200 font-bold">
              7 dias máx
            </span>
          </div>

          {/* Conflicts Section */}
          {conflicts.length > 0 && (
            <div className="mt-6 space-y-3">
              <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400 font-bold text-xs uppercase tracking-wider">
                <AlertTriangle className="w-4 h-4" />
                <span>Conflitos Detectados ({conflicts.length})</span>
              </div>
              <p className="text-[11px] text-gray-500">
                Duas pessoas alteraram o mesmo cadastro. Selecione qual versão preservar para evitar sobrescrita silenciosa:
              </p>

              {conflicts.map(c => (
                <div key={c.id} className="p-4 rounded-2xl border border-rose-200 bg-rose-50/40 dark:border-rose-900 dark:bg-rose-950/30 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-gray-900 dark:text-white">{c.entityName}</span>
                    <span className="text-[10px] text-gray-500 font-mono">{c.detectedAt}</span>
                  </div>

                  {/* Side-by-side comparison */}
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="p-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                      <p className="font-bold text-blue-700 dark:text-blue-400 mb-1">Versão Local (Offline)</p>
                      <p className="truncate"><strong>Nome:</strong> {c.localVersion.fullName}</p>
                      <p className="truncate"><strong>Telefone:</strong> {c.localVersion.phone || 'N/A'}</p>
                      <p className="text-[10px] text-gray-400 mt-1 italic">{c.localVersion.notes || 'Sem notas'}</p>
                    </div>

                    <div className="p-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                      <p className="font-bold text-indigo-700 dark:text-indigo-400 mb-1">Versão Remota (Servidor)</p>
                      <p className="truncate"><strong>Nome:</strong> {c.remoteVersion.fullName}</p>
                      <p className="truncate"><strong>Telefone:</strong> {c.remoteVersion.phone || 'N/A'}</p>
                      <p className="text-[10px] text-gray-400 mt-1 italic">{c.remoteVersion.notes || 'Sem notas'}</p>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handleResolveConflict(c.id, 'KEPT_LOCAL')}
                      className="flex-1 py-1.5 rounded-xl bg-blue-700 text-white text-[11px] font-semibold hover:bg-blue-800 transition"
                    >
                      Manter Versão Local
                    </button>
                    <button
                      onClick={() => handleResolveConflict(c.id, 'KEPT_REMOTE')}
                      className="flex-1 py-1.5 rounded-xl border border-gray-300 bg-white text-gray-700 text-[11px] font-semibold hover:bg-gray-50 transition"
                    >
                      Manter Versão Remota
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Sync Queue */}
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300 font-bold text-xs uppercase tracking-wider">
                <Layers className="w-4 h-4 text-blue-600" />
                <span>Fila de Operações Pendentes ({queueItems.filter(q => q.status === 'PENDING').length})</span>
              </div>
              <button
                onClick={handleManualSync}
                disabled={isSyncing || !isOnline}
                className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400 disabled:opacity-40"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>Sincronizar Agora</span>
              </button>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {queueItems.map(item => (
                <div key={item.id} className="p-3 rounded-xl border border-gray-100 bg-gray-50/70 dark:border-gray-800 dark:bg-gray-800/40 text-xs flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        item.operation === 'CREATE' ? 'bg-emerald-100 text-emerald-800' :
                        item.operation === 'UPDATE' ? 'bg-blue-100 text-blue-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {item.operation}
                      </span>
                      <span className="font-semibold text-gray-800 dark:text-gray-200">{item.entity}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(item.timestamp).toLocaleTimeString('pt-BR')}
                    </p>
                  </div>

                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    item.status === 'SYNCED' ? 'bg-emerald-100 text-emerald-800' :
                    item.status === 'CONFLICT' ? 'bg-rose-100 text-rose-800' :
                    item.status === 'FAILED' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {item.status === 'SYNCED' ? 'Sincronizado' :
                     item.status === 'CONFLICT' ? 'Conflito' :
                     item.status === 'FAILED' ? 'Falhou' : 'Pendente'}
                  </span>
                </div>
              ))}

              {queueItems.length === 0 && (
                <div className="text-center py-6 text-gray-400 text-xs">
                  <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500/60 mb-1" />
                  <span>Nenhuma operação pendente. Todos os dados sincronizados.</span>
                </div>
              )}
            </div>
          </div>

          {/* Test simulation button */}
          <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Simulação de Testes Reais</p>
            <button
              onClick={handleSimulateConflict}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-dashed border-gray-300 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 transition"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              <span>Simular Conflito Simultâneo (Teste)</span>
            </button>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100 dark:border-gray-800 flex justify-end">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-gray-100 text-gray-700 text-xs font-semibold hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 transition"
          >
            Fechar Painel
          </button>
        </div>
      </div>
    </div>
  );
};
