import React, { useState } from 'react';
import { User, Church, UserRole } from '../../types';
import { Shield, Plus, Mail, UserX, Check, X, Pencil, AlertCircle, CheckCircle2 } from 'lucide-react';
import { SecurityPolicy } from '../../services/securityPolicy';

interface UsersScreenProps {
  church: Church;
  users: User[];
  currentUser: User;
  onSaveUser: (user: User, initialPassword?: string) => Promise<void> | void;
}

export const UsersScreen: React.FC<UsersScreenProps> = ({ church, users, currentUser, onSaveUser }) => {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('ASSISTANT_SECRETARY');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const canManageUsers = SecurityPolicy.canManageUsers(currentUser, church.id);
  const churchUsers = users.filter(u => u.churchId === church.id && u.churchId === currentUser.churchId);

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageUsers) {
      setErrorMsg('Acesso negado: apenas a Secretaria ou Administrador Geral pode autorizar usuários.');
      return;
    }
    const cleanName = inviteName.trim();
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (!cleanName || !normalizedEmail) return;

    if (inviteRole === 'PLATFORM_ADMIN' || inviteRole === 'PLATFORM_ASSISTANT_ADMIN') {
      setErrorMsg('Usuários de igreja não podem atribuir perfis administrativos da plataforma.');
      return;
    }

    if (churchUsers.some(u => u.email.toLowerCase() === normalizedEmail)) {
      setErrorMsg('Já existe um usuário cadastrado com este e-mail nesta igreja.');
      return;
    }

    const newUser: User = {
      id: `user-${Date.now()}`,
      churchId: church.id,
      name: cleanName,
      email: normalizedEmail,
      role: inviteRole,
      status: 'ACTIVE',
      lastLogin: 'Aguardando acesso Google',
    };

    await onSaveUser(newUser);
    setShowInviteModal(false);
    setInviteName('');
    setInviteEmail('');
    setErrorMsg(null);
    setSuccessMsg(`Usuário "${newUser.name}" (${newUser.email}) autorizado para entrar com Google na ${church.name}.`);
    setTimeout(() => setSuccessMsg(null), 5000);
  };

  const handleToggleStatus = (targetUser: User) => {
    const check = SecurityPolicy.canModifyTargetUser(currentUser, targetUser);
    if (!check.allowed) {
      setErrorMsg(check.reason || 'Operação não permitida.');
      return;
    }
    setErrorMsg(null);
    const updated: User = {
      ...targetUser,
      status: targetUser.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    };
    onSaveUser(updated);
  };

  const handleChangeRole = (targetUser: User, newRole: UserRole) => {
    const check = SecurityPolicy.canModifyTargetUser(currentUser, targetUser, newRole);
    if (!check.allowed) {
      setErrorMsg(check.reason || 'Operação não permitida.');
      return;
    }
    setErrorMsg(null);
    const updated: User = {
      ...targetUser,
      role: newRole
    };
    onSaveUser(updated);
  };

  const handleStartEditName = (user: User) => {
    setEditingUserId(user.id);
    setEditingName(user.name);
    setErrorMsg(null);
  };

  const handleSaveEditName = (targetUser: User) => {
    const trimmed = editingName.trim();
    if (trimmed.length < 2) {
      setErrorMsg('O nome do usuário deve ter pelo menos 2 caracteres.');
      return;
    }
    if (targetUser.id !== currentUser.id) {
      const check = SecurityPolicy.canModifyTargetUser(currentUser, targetUser);
      if (!check.allowed) {
        setErrorMsg(check.reason || 'Operação não permitida.');
        return;
      }
    }
    setErrorMsg(null);
    onSaveUser({ ...targetUser, name: trimmed });
    setEditingUserId(null);
    setEditingName('');
  };

  if (!canManageUsers) {
    return (
      <div className="rounded-2xl bg-rose-50 border border-rose-200 p-8 text-center dark:bg-rose-950/30 dark:border-rose-900">
        <Shield className="mx-auto h-10 w-10 text-rose-600" />
        <h2 className="mt-3 text-lg font-bold text-rose-900 dark:text-rose-200">Acesso Restrito à Secretaria Geral</h2>
        <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">
          Seu perfil ({currentUser.role}) não possui autorização para gerenciar usuários ou permissões da {church.name}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Usuários e Permissões (RBAC)</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Gerenciamento de perfis e acessos eclesiásticos na {church.name}.
          </p>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="flex items-center gap-2 rounded-lg church-btn-primary px-4 py-2.5 text-sm font-semibold transition"
        >
          <Plus className="w-4 h-4" />
          Convidar Novo Usuário
        </button>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3.5 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 p-3.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
        <div className="p-6 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-semibold text-gray-900 dark:text-white">Membros da Equipe com Acesso</h3>
          <p className="text-xs text-gray-500 mt-0.5">Perfis: Secretaria Geral, Administrador Geral, Secretaria, Secretário Auxiliar, Pastor, Líder de Departamento, etc.</p>
        </div>
        
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {churchUsers.map(user => (
            <div key={user.id} className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full church-soft-badge border font-bold flex items-center justify-center text-base">
                  {user.name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {editingUserId === user.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleSaveEditName(user);
                            } else if (e.key === 'Escape') {
                              setEditingUserId(null);
                            }
                          }}
                          className="rounded-lg border border-blue-500 bg-white px-2.5 py-1 text-sm font-semibold text-gray-900 focus:outline-none dark:bg-gray-800 dark:text-white"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveEditName(user)}
                          className="rounded-lg bg-emerald-600 p-1.5 text-white hover:bg-emerald-700 transition"
                          title="Salvar nome"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingUserId(null)}
                          className="rounded-lg border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 transition"
                          title="Cancelar"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <h4 className="font-semibold text-gray-900 dark:text-white">{user.name}</h4>
                        <button
                          type="button"
                          onClick={() => handleStartEditName(user)}
                          className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-800 dark:hover:text-blue-400 transition"
                          title="Editar nome do usuário"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    {user.id === currentUser.id && (
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                        Você
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                    <span className="flex items-center gap-1">
                      <Mail className="w-3.5 h-3.5" />
                      {user.email}
                    </span>
                    <span>•</span>
                    <span>Acesso: {user.lastLogin || 'Ativo'}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <select
                  value={user.role}
                  disabled={user.id === currentUser.id}
                  onChange={e => handleChangeRole(user, e.target.value as UserRole)}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white disabled:opacity-60"
                >
                  <option value="GENERAL_SECRETARY">Secretaria Geral</option>
                  <option value="ADMIN">Administrador Geral</option>
                  <option value="SECRETARY">Secretaria</option>
                  <option value="ASSISTANT_SECRETARY">Secretário Auxiliar</option>
                  <option value="PASTOR">Pastor</option>
                  <option value="DEPARTMENT_LEADER">Líder de Departamento</option>
                  <option value="TREASURER">Tesoureiro</option>
                </select>

                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  user.status === 'ACTIVE' 
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : user.status === 'PENDING_INVITE'
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                    : 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                }`}>
                  {user.status === 'ACTIVE' ? 'Ativo' : user.status === 'PENDING_INVITE' ? 'Convite Pendente' : 'Bloqueado'}
                </span>

                {user.id !== currentUser.id && (
                  <button
                    onClick={() => handleToggleStatus(user)}
                    className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 transition"
                    title={user.status === 'ACTIVE' ? 'Bloquear Usuário' : 'Reativar Usuário'}
                  >
                    <UserX className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal Autorizar Usuário */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-900">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Autorizar Novo Usuário</h3>
            <p className="text-xs text-gray-500 mt-1">Informe o Gmail do usuário para liberar o acesso direto via Conta Google.</p>
            
            <form onSubmit={handleInviteSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Nome Completo *</label>
                <input
                  type="text"
                  required
                  value={inviteName}
                  onChange={e => setInviteName(e.target.value)}
                  placeholder="Ex: Pr. João Pereira"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">E-mail (Gmail) *</label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="usuario@gmail.com"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Perfil de Acesso *</label>
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as UserRole)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                >
                  <option value="GENERAL_SECRETARY">Secretaria Geral (Acesso Completo)</option>
                  <option value="ADMIN">Administrador Geral (Acesso Completo)</option>
                  <option value="SECRETARY">Secretaria (Acesso Completo)</option>
                  <option value="ASSISTANT_SECRETARY">Secretário Auxiliar</option>
                  <option value="PASTOR">Pastor (Consulta e Departamentos)</option>
                  <option value="DEPARTMENT_LEADER">Líder de Departamento</option>
                  <option value="TREASURER">Tesoureiro</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl church-btn-primary px-5 py-2 text-xs font-semibold transition"
                >
                  Autorizar Usuário
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
