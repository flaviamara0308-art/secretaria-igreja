import React, { useState } from 'react';
import { Department, Church, Member, User, DepartmentTransferHistory } from '../../types';
import { StorageService } from '../../services/storage';
import { SecurityPolicy } from '../../services/securityPolicy';
import {
  FolderGit2,
  Users,
  Calendar,
  Plus,
  ArrowRightLeft,
  History,
  Pencil,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  X,
} from 'lucide-react';

interface DepartmentsScreenProps {
  church: Church;
  departments: Department[];
  members: Member[];
  currentUser: User;
  onSaveDepartment: (dept: Department) => void;
  onDeleteDepartment?: (deptId: string) => void;
  onUpdateMember: (member: Member) => void;
}

export const DepartmentsScreen: React.FC<DepartmentsScreenProps> = ({
  church,
  departments,
  members,
  currentUser,
  onSaveDepartment,
  onDeleteDepartment,
  onUpdateMember,
}) => {
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [deptToDelete, setDeptToDelete] = useState<Department | null>(null);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Create/Edit dept form
  const [deptName, setDeptName] = useState('');
  const [deptDesc, setDeptDesc] = useState('');
  const [deptLeader, setDeptLeader] = useState('');
  const [meetingDay, setMeetingDay] = useState('');
  const [deptStatus, setDeptStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');

  // Transfer form
  const [transferMemberId, setTransferMemberId] = useState('');
  const [targetDeptId, setTargetDeptId] = useState('');
  const [transferType, setTransferType] = useState<'ADD' | 'TRANSFER'>('TRANSFER');

  const [transfers, setTransfers] = useState<DepartmentTransferHistory[]>(
    StorageService.getDepartmentTransfers(church.id)
  );

  const canManageDepartments = SecurityPolicy.canManageDepartments(currentUser, church.id);
  const canDeleteDepartments = SecurityPolicy.canDeleteDepartment(currentUser, church.id);
  const visibleDepartments = SecurityPolicy.filterVisibleDepartments(currentUser, church.id, departments);
  const visibleMembers = SecurityPolicy.filterVisibleMembers(currentUser, church.id, members);

  const showToast = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(null), 4000);
  };

  const handleOpenNewDept = () => {
    if (!canManageDepartments) return;
    setEditingDept(null);
    setDeptName('');
    setDeptDesc('');
    setDeptLeader('');
    setMeetingDay('');
    setDeptStatus('ACTIVE');
    setShowDeptModal(true);
  };

  const handleOpenEditDept = (dept: Department) => {
    if (!canManageDepartments) return;
    setEditingDept(dept);
    setDeptName(dept.name);
    setDeptDesc(dept.description || '');
    setDeptLeader(dept.leaderName || '');
    setMeetingDay(dept.meetingDay || '');
    setDeptStatus(dept.status || 'ACTIVE');
    setShowDeptModal(true);
  };

  const handleSaveDeptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageDepartments || !deptName.trim()) return;

    const deptToSave: Department = editingDept
      ? {
          ...editingDept,
          name: deptName.trim(),
          description: deptDesc.trim(),
          leaderName: deptLeader.trim() || 'A definir',
          meetingDay: meetingDay.trim(),
          status: deptStatus,
          updatedAt: new Date().toISOString(),
        }
      : {
          id: `dept-${Date.now()}`,
          churchId: church.id,
          name: deptName.trim(),
          description: deptDesc.trim(),
          leaderId: 'leader-1',
          leaderName: deptLeader.trim() || 'A definir',
          memberCount: 0,
          meetingDay: meetingDay.trim(),
          status: deptStatus,
          createdAt: new Date().toISOString().split('T')[0],
        };

    onSaveDepartment(deptToSave);
    setShowDeptModal(false);
    setEditingDept(null);
    setDeptName('');
    setDeptDesc('');
    setDeptLeader('');
    setMeetingDay('');
    setDeptStatus('ACTIVE');
    showToast(
      editingDept
        ? `Departamento "${deptToSave.name}" atualizado com sucesso!`
        : `Departamento "${deptToSave.name}" criado com sucesso!`
    );
  };

  const handleConfirmDeleteDept = () => {
    if (!deptToDelete || !canDeleteDepartments || !onDeleteDepartment) return;
    const deletedName = deptToDelete.name;
    const deletedId = deptToDelete.id;
    onDeleteDepartment(deletedId);
    if (selectedDept?.id === deletedId) {
      setSelectedDept(null);
    }
    setDeptToDelete(null);
    showToast(`Departamento "${deletedName}" excluído com sucesso.`);
  };

  const handleTransferSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageDepartments || !transferMemberId || !targetDeptId) return;

    const member = visibleMembers.find(m => m.id === transferMemberId);
    const targetDept = visibleDepartments.find(d => d.id === targetDeptId);
    if (!member || !targetDept) return;

    let updatedDeptIds = [...(member.departmentIds || [])];
    const prevDeptId = updatedDeptIds[0];
    const prevDept = departments.find(d => d.id === prevDeptId);

    if (transferType === 'TRANSFER') {
      updatedDeptIds = [targetDeptId];
    } else {
      if (!updatedDeptIds.includes(targetDeptId)) {
        updatedDeptIds.push(targetDeptId);
      }
    }

    const updatedMember: Member = {
      ...member,
      departmentIds: updatedDeptIds,
    };

    onUpdateMember(updatedMember);

    const historyRecord: DepartmentTransferHistory = {
      id: `trans-${Date.now()}`,
      churchId: church.id,
      memberId: member.id,
      memberName: member.fullName,
      fromDepartmentId: prevDept?.id,
      fromDepartmentName: prevDept?.name || 'Nenhum',
      toDepartmentId: targetDept.id,
      toDepartmentName: targetDept.name,
      date: new Date().toLocaleString('pt-BR'),
      author: currentUser.name,
      type: transferType,
    };

    StorageService.saveDepartmentTransfer(historyRecord);
    setTransfers(StorageService.getDepartmentTransfers(church.id));
    setShowTransferModal(false);
    setTransferMemberId('');
    setTargetDeptId('');
    showToast(`Vínculo de ${member.fullName} atualizado para "${targetDept.name}".`);
  };

  const linkedMembersCountForDelete = deptToDelete
    ? members.filter(m => m.churchId === church.id && m.departmentIds?.includes(deptToDelete.id)).length
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Departamentos e Ministérios</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Gerenciamento de equipes, edição, exclusão, múltiplos vínculos e transferências na {church.name}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowHistoryModal(true)}
            className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            <History className="w-4 h-4" />
            Histórico de Transferências
          </button>
          {canManageDepartments && (
            <>
              <button
                onClick={() => setShowTransferModal(true)}
                className="flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-sm transition church-soft-badge"
              >
                <ArrowRightLeft className="w-4 h-4" />
                Transferir / Vincular
              </button>
              <button
                onClick={handleOpenNewDept}
                className="flex items-center gap-2 rounded-xl church-btn-primary px-4 py-2.5 text-sm font-semibold transition"
              >
                <Plus className="w-4 h-4" />
                Novo Departamento
              </button>
            </>
          )}
        </div>
      </div>

      {feedbackMsg && (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {visibleDepartments.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-gray-900">
          <FolderGit2 className="mx-auto h-10 w-10 text-gray-400" />
          <h3 className="mt-3 text-base font-bold text-gray-900 dark:text-white">
            Nenhum departamento cadastrado
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Crie os departamentos e ministérios reais da {church.name} para organizar líderes e membros.
          </p>
          {canManageDepartments && (
            <button
              onClick={handleOpenNewDept}
              className="mt-4 inline-flex items-center gap-2 rounded-xl church-btn-primary px-5 py-2.5 text-xs font-semibold transition"
            >
              <Plus className="w-4 h-4" />
              Criar Primeiro Departamento
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {visibleDepartments.map(dept => {
            const deptMembers = visibleMembers.filter(m => m.departmentIds?.includes(dept.id));
            return (
              <div
                key={dept.id}
                className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 hover:shadow-md transition dark:bg-gray-900 dark:border-gray-800 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="rounded-xl p-3 border church-soft-badge flex-shrink-0">
                        <FolderGit2 className="w-6 h-6" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-gray-900 dark:text-white truncate">{dept.name}</h3>
                        <span className="text-xs text-gray-500 block truncate">Líder: {dept.leaderName}</span>
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold flex-shrink-0 ${
                        dept.status === 'INACTIVE'
                          ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      }`}
                    >
                      {dept.status === 'INACTIVE' ? 'Inativo' : 'Ativo'}
                    </span>
                  </div>

                  {dept.description && (
                    <p className="mt-4 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                      {dept.description}
                    </p>
                  )}

                  <div className="mt-6 space-y-2 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 pt-4 dark:border-gray-800">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-gray-400" />
                      <span>{deptMembers.length} membros vinculados</span>
                    </div>
                    {dept.meetingDay && (
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <span>Encontro: {dept.meetingDay}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {canManageDepartments && (
                      <button
                        type="button"
                        onClick={() => handleOpenEditDept(dept)}
                        title="Editar departamento"
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800 transition"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Editar</span>
                      </button>
                    )}
                    {canDeleteDepartments && onDeleteDepartment && (
                      <button
                        type="button"
                        onClick={() => setDeptToDelete(dept)}
                        title="Excluir departamento"
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Excluir</span>
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => setSelectedDept(dept)}
                    className="text-xs font-semibold church-accent-text hover:underline"
                  >
                    Ver Integrantes &rarr;
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Detalhes do Departamento / Integrantes */}
      {selectedDept && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-900 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-800">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{selectedDept.name}</h3>
                <p className="text-xs text-gray-500">Líder: {selectedDept.leaderName}</p>
              </div>
              <button
                onClick={() => setSelectedDept(null)}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Membros Integrantes</h4>
              {visibleMembers
                .filter(m => m.departmentIds?.includes(selectedDept.id))
                .map(m => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-800 text-xs"
                  >
                    <span className="font-semibold text-gray-900 dark:text-white">{m.fullName}</span>
                    <span className="font-mono text-gray-500">{m.memberCode}</span>
                  </div>
                ))}
              {visibleMembers.filter(m => m.departmentIds?.includes(selectedDept.id)).length === 0 && (
                <p className="text-xs text-gray-400 text-center py-6">
                  Nenhum membro vinculado a este departamento.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Criar / Editar Departamento */}
      {showDeptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-900">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                {editingDept ? 'Editar Departamento' : 'Criar Novo Departamento'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowDeptModal(false);
                  setEditingDept(null);
                }}
                className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveDeptSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Nome do Departamento *
                </label>
                <input
                  type="text"
                  required
                  value={deptName}
                  onChange={e => setDeptName(e.target.value)}
                  placeholder="Ex: Ministério de Jovens"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Descrição</label>
                <textarea
                  rows={3}
                  value={deptDesc}
                  onChange={e => setDeptDesc(e.target.value)}
                  placeholder="Finalidade do departamento..."
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Líder Responsável
                </label>
                <input
                  type="text"
                  value={deptLeader}
                  onChange={e => setDeptLeader(e.target.value)}
                  placeholder="Nome do líder"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                    Dia de Encontro
                  </label>
                  <input
                    type="text"
                    value={meetingDay}
                    onChange={e => setMeetingDay(e.target.value)}
                    placeholder="Sábados às 19h"
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                    Situação
                  </label>
                  <select
                    value={deptStatus}
                    onChange={e => setDeptStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  >
                    <option value="ACTIVE">Ativo</option>
                    <option value="INACTIVE">Inativo</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeptModal(false);
                    setEditingDept(null);
                  }}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl church-btn-primary px-5 py-2 text-xs font-semibold transition"
                >
                  {editingDept ? 'Salvar Alterações' : 'Salvar Departamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Confirmar Exclusão de Departamento */}
      {deptToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-900 border border-rose-200 dark:border-rose-900 space-y-4">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-rose-100 p-3 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                  Excluir Departamento
                </h3>
                <p className="text-xs text-gray-500">Ação irreversível na base desta igreja.</p>
              </div>
            </div>

            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              Tem certeza que deseja excluir o departamento <strong>"{deptToDelete.name}"</strong>?
              {linkedMembersCountForDelete > 0
                ? ` Os ${linkedMembersCountForDelete} membro(s) vinculados continuarão cadastrados no rol geral, apenas com este vínculo removido.`
                : ' Nenhum membro está vinculado a este departamento no momento.'}
            </p>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setDeptToDelete(null)}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteDept}
                className="rounded-xl bg-rose-600 px-5 py-2 text-xs font-semibold text-white hover:bg-rose-700 transition shadow-sm"
              >
                Confirmar Exclusão
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Transferência / Múltiplos Vínculos */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-900">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Transferir ou Vincular Membro</h3>
            <p className="text-xs text-gray-500 mt-1">
              Permite transferir de departamento ou adicionar múltiplos vínculos.
            </p>

            <form onSubmit={handleTransferSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Selecionar Membro *
                </label>
                <select
                  required
                  value={transferMemberId}
                  onChange={e => setTransferMemberId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                >
                  <option value="">Escolha um membro...</option>
                  {members.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.fullName} ({m.memberCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Departamento Destino *
                </label>
                <select
                  required
                  value={targetDeptId}
                  onChange={e => setTargetDeptId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                >
                  <option value="">Escolha o departamento...</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Tipo de Operação
                </label>
                <select
                  value={transferType}
                  onChange={e => setTransferType(e.target.value as any)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                >
                  <option value="TRANSFER">Transferência (Substituir anterior)</option>
                  <option value="ADD">Adicionar (Manter múltiplos departamentos)</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowTransferModal(false)}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl church-btn-primary px-5 py-2 text-xs font-semibold transition"
                >
                  Confirmar Operação
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Histórico */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-900 max-h-[85vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">
              Histórico Permanente de Transferências
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Registro imutável de entradas, saídas e movimentações entre departamentos.
            </p>

            <div className="mt-6 space-y-3">
              {transfers.map(t => (
                <div key={t.id} className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800 text-xs space-y-1">
                  <div className="flex items-center justify-between font-bold text-gray-900 dark:text-white">
                    <span>{t.memberName}</span>
                    <span className="church-accent-text font-mono">{t.date}</span>
                  </div>
                  <p className="text-gray-600 dark:text-gray-300">
                    Movimentação: <strong>{t.fromDepartmentName || 'Nenhum'}</strong> &rarr;{' '}
                    <strong>{t.toDepartmentName}</strong> ({t.type === 'TRANSFER' ? 'Substituição' : 'Adicionado'})
                  </p>
                  <p className="text-[10px] text-gray-400">Responsável: {t.author}</p>
                </div>
              ))}
              {transfers.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-8">
                  Nenhum histórico de transferência registrado ainda.
                </p>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowHistoryModal(false)}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
