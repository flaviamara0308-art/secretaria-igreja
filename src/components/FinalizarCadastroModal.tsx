import React, { useState } from 'react';
import { Church, User, UserRole } from '../types';
import { Building2, PlusCircle, LogOut, CheckCircle2, AlertCircle, ShieldCheck, UserCheck } from 'lucide-react';
import { ChurchRegistrationModal } from './ChurchRegistrationModal';

interface FinalizarCadastroModalProps {
  firebaseUser: {
    uid: string;
    email: string | null;
    displayName: string | null;
  };
  churches: Church[];
  onLinkToChurch: (params: {
    churchId: string;
    name: string;
    role: UserRole;
    password?: string;
    exclusiveCode?: string;
  }) => Promise<void>;
  onRegisterNewChurch: (newChurch: Church, adminPassword?: string, adminName?: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}

export const FinalizarCadastroModal: React.FC<FinalizarCadastroModalProps> = ({
  firebaseUser,
  churches,
  onLinkToChurch,
  onRegisterNewChurch,
  onSignOut,
}) => {
  const [tab, setTab] = useState<'LINK' | 'NEW_CHURCH'>('LINK');
  const [selectedChurchId, setSelectedChurchId] = useState<string>(churches[0]?.id || '');
  const [exclusiveCode, setExclusiveCode] = useState<string>('');
  const [userName, setUserName] = useState<string>(
    firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : '')
  );
  const [userRole, setUserRole] = useState<UserRole>('GENERAL_SECRETARY');
  const [password, setPassword] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showRegModal, setShowRegModal] = useState<boolean>(false);

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      let targetChurch: Church | undefined;
      const cleanCode = exclusiveCode.trim().toUpperCase();

      if (cleanCode) {
        targetChurch = churches.find(
          c => (c.exclusiveCode || '').trim().toUpperCase() === cleanCode
        );
        if (!targetChurch) {
          throw new Error(`Nenhuma igreja encontrada com o código exclusivo "${cleanCode}". Verifique o código ou cadastre uma nova igreja.`);
        }
      } else if (selectedChurchId) {
        targetChurch = churches.find(c => c.id === selectedChurchId);
      }

      if (!targetChurch) {
        throw new Error('Selecione uma igreja existente ou informe o código exclusivo da sua congregação.');
      }

      if (!userName.trim()) {
        throw new Error('Informe seu nome completo para registro.');
      }

      if (password && password.length < 6) {
        throw new Error('A senha deve ter no mínimo 6 caracteres.');
      }

      await onLinkToChurch({
        churchId: targetChurch.id,
        name: userName.trim(),
        role: userRole,
        password: password || undefined,
        exclusiveCode: cleanCode || targetChurch.exclusiveCode,
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha ao vincular usuário à igreja.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md overflow-y-auto">
      <div className="w-full max-w-xl rounded-3xl bg-white p-6 sm:p-8 shadow-2xl dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
        {/* Header */}
        <div className="text-center pb-4 border-b border-gray-100 dark:border-gray-800">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 shadow-md">
            <UserCheck className="w-7 h-7" />
          </div>
          <h2 className="mt-3 text-xl font-bold text-gray-900 dark:text-white">
            Finalizar Cadastro & Vinculação
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Sua conta está autenticada no Firebase Authentication. Conclua a vinculação com sua igreja para acessar os dados no Firestore.
          </p>
        </div>

        {/* Authenticated Firebase UID badge */}
        <div className="mt-4 rounded-2xl bg-slate-50 dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700 p-3.5 text-xs">
          <div className="flex items-center justify-between text-gray-600 dark:text-gray-300">
            <span className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              Conta Firebase Autenticada
            </span>
            <span className="inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              Conectado
            </span>
          </div>
          <div className="mt-2 space-y-1 font-mono text-[11px] text-gray-700 dark:text-gray-300">
            <div>
              <span className="text-gray-400 font-sans">UID: </span>
              <strong className="text-blue-700 dark:text-blue-400">{firebaseUser.uid}</strong>
            </div>
            {firebaseUser.email && (
              <div>
                <span className="text-gray-400 font-sans">E-mail: </span>
                <strong>{firebaseUser.email}</strong>
              </div>
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-xs font-medium text-rose-800 dark:bg-rose-950/60 dark:text-rose-200 border border-rose-200 dark:border-rose-900">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Choice Switcher */}
        <div className="mt-5 grid grid-cols-2 gap-2 p-1 bg-gray-100 dark:bg-gray-800 rounded-2xl text-xs font-semibold">
          <button
            type="button"
            onClick={() => setTab('LINK')}
            className={`py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 ${
              tab === 'LINK'
                ? 'bg-blue-700 text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>Igreja Existente</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('NEW_CHURCH');
              setShowRegModal(true);
            }}
            className={`py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 ${
              tab === 'NEW_CHURCH'
                ? 'bg-blue-700 text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
            }`}
          >
            <PlusCircle className="w-4 h-4" />
            <span>Cadastrar Nova Igreja</span>
          </button>
        </div>

        {/* Link Form */}
        <form onSubmit={handleLinkSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
              Seu Nome Completo *
            </label>
            <input
              type="text"
              required
              value={userName}
              onChange={e => setUserName(e.target.value)}
              placeholder="Ex: Pr. João Silva ou Silvia Santos"
              className="mt-1 w-full rounded-xl border border-gray-200 px-3.5 py-2 text-xs text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
              Código Exclusivo da Igreja (Recomendado se já possuir)
            </label>
            <input
              type="text"
              value={exclusiveCode}
              onChange={e => setExclusiveCode(e.target.value.toUpperCase())}
              placeholder="Ex: IG-0000"
              className="mt-1 w-full rounded-xl border border-gray-200 px-3.5 py-2 text-xs font-mono uppercase text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
            <span className="text-[10px] text-gray-400 mt-0.5 block">
              Ao informar o código exclusivo, sua conta é vinculada automaticamente à igreja correspondente.
            </span>
          </div>

          {churches.length > 0 && !exclusiveCode && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                Ou selecione a igreja cadastrada no sistema
              </label>
              <select
                value={selectedChurchId}
                onChange={e => setSelectedChurchId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3.5 py-2 text-xs text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              >
                {churches.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.city ? `(${c.city}/${c.state})` : ''} - {c.exclusiveCode}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                Função de Acesso *
              </label>
              <select
                value={userRole}
                onChange={e => setUserRole(e.target.value as UserRole)}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3.5 py-2 text-xs text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              >
                <option value="GENERAL_SECRETARY">Secretaria Geral (Admin da Igreja)</option>
                <option value="PASTOR">Pastor Presidente</option>
                <option value="ASSISTANT_SECRETARY">Secretário(a) Adjunto(a)</option>
                <option value="DEPARTMENT_LEADER">Líder de Departamento</option>
                <option value="TREASURER">Tesoureiro(a)</option>
                <option value="MEMBER">Membro / Consulta</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                Definir Senha Local / Recuperação
              </label>
              <input
                type="password"
                minLength={6}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Mín. 6 caracteres"
                className="mt-1 w-full rounded-xl border border-gray-200 px-3.5 py-2 text-xs text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 transition"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sair da Conta</span>
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-6 py-2.5 text-xs font-bold text-white shadow-md shadow-blue-600/30 hover:bg-blue-800 transition disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSubmitting ? 'Vinculando...' : 'Finalizar e Acessar'}</span>
            </button>
          </div>
        </form>
      </div>

      {showRegModal && (
        <ChurchRegistrationModal
          googleAccount={{
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            name: userName,
          }}
          onClose={() => {
            setShowRegModal(false);
            setTab('LINK');
          }}
          onRegister={async (newChurch, adminPassword, adminName) => {
            await onRegisterNewChurch(newChurch, adminPassword, adminName);
            setShowRegModal(false);
          }}
        />
      )}
    </div>
  );
};
