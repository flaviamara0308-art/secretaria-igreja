import React, { useState } from 'react';
import { Church } from '../types';
import { Building2, X, CheckCircle2, AlertCircle, ShieldCheck, Palette } from 'lucide-react';
import { extractBrandColorsFromDataUrl } from '../utils/themeColorUtils';

interface ChurchRegistrationModalProps {
  googleAccount?: { uid: string; email: string; name: string } | null;
  onClose: () => void;
  onRegister: (church: Church, adminPassword?: string, adminName?: string) => Promise<void> | void;
}

export const ChurchRegistrationModal: React.FC<ChurchRegistrationModalProps> = ({
  googleAccount,
  onClose,
  onRegister,
}) => {
  const [formData, setFormData] = useState({
    name: '',
    denomination: '',
    cnpj: '',
    adminName: googleAccount?.name || '',
    pastorName: '',
    email: googleAccount?.email || '',
    phone: '',
    address: '',
    city: '',
    state: 'SP',
    zipCode: '',
    logoUrl: '',
    primaryColor: '#1e3a8a',
    secondaryColor: '#3b82f6',
  });
  const [adminPassword, setAdminPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [exclusiveCode, setExclusiveCode] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!googleAccount && adminPassword && adminPassword.length < 6) {
      setErrorMsg('A senha de acesso online deve ter pelo menos 6 caracteres.');
      return;
    }

    const code = `IG-${Math.floor(1000 + Math.random() * 9000)}`;
    setExclusiveCode(code);

    const newChurch: Church = {
      id: `church-${Date.now()}`,
      name: formData.name.trim(),
      denomination: formData.denomination.trim() || 'Cristã Evangélica',
      cnpj: formData.cnpj.trim(),
      pastorName: formData.pastorName.trim() || formData.adminName.trim(),
      email: formData.email.trim().toLowerCase(),
      phone: formData.phone.trim(),
      address: formData.address.trim(),
      city: formData.city.trim(),
      state: formData.state.trim().toUpperCase() || 'SP',
      zipCode: formData.zipCode.trim(),
      logoUrl: formData.logoUrl || undefined,
      primaryColor: formData.primaryColor,
      secondaryColor: formData.secondaryColor,
      exclusiveCode: code,
      status: 'PENDING',
      plan: 'FREE',
      planStatus: 'ACTIVE',
      ownerUid: googleAccount?.uid,
      createdAt: new Date().toISOString(),
      offlineConfig: {
        maxOfflineDays: 7,
        autoBackupDaily: true,
      },
    };

    try {
      setSubmitting(true);
      await onRegister(newChurch, adminPassword || undefined, formData.adminName.trim());
      setSubmitted(true);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Não foi possível concluir o cadastro da igreja.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl bg-white p-6 sm:p-8 shadow-2xl dark:bg-gray-900 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-blue-100 p-3 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Cadastrar Nova Igreja (Base Real)</h2>
              <p className="text-xs text-gray-500">Crie uma base limpa e isolada para sua igreja na nuvem e offline.</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {googleAccount && !submitted && (
          <div className="mt-4 flex items-center gap-2.5 rounded-2xl bg-emerald-50 border border-emerald-200 p-3.5 text-xs text-emerald-900 dark:bg-emerald-950/50 dark:border-emerald-800 dark:text-emerald-200">
            <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>
              Conta Google autenticada: <strong>{googleAccount.email}</strong>. A igreja será vinculada diretamente ao seu usuário na nuvem Firebase.
            </span>
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-rose-50 p-3.5 text-xs font-medium text-rose-800 dark:bg-rose-950 dark:text-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {submitted ? (
          <div className="py-8 text-center space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Igreja Cadastrada com Sucesso!</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 max-w-md mx-auto">
              Sua base real foi criada sem dados fictícios. O código exclusivo gerado para a igreja é:
            </p>
            <div className="inline-block rounded-xl bg-blue-50 px-6 py-3 text-xl font-mono font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
              {exclusiveCode}
            </div>
            <p className="text-xs text-gray-400">Você já está conectado como Secretaria Geral para cadastrar ou importar membros reais.</p>
            <div className="pt-4">
              <button
                onClick={onClose}
                className="rounded-xl bg-blue-700 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 hover:bg-blue-800 transition"
              >
                Concluir e Acessar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">Nome da Igreja *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ex: Igreja Batista Central"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">Denominação</label>
                <input
                  type="text"
                  value={formData.denomination}
                  onChange={e => setFormData({ ...formData, denomination: e.target.value })}
                  placeholder="Ex: Batista, Presbiteriana, Assembleia..."
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">Seu Nome de Usuário *</label>
                <input
                  type="text"
                  required
                  value={formData.adminName}
                  onChange={e => setFormData({ ...formData, adminName: e.target.value })}
                  placeholder="Seu nome completo"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">E-mail de Acesso / Contato *</label>
                <input
                  type="email"
                  required
                  disabled={Boolean(googleAccount?.email)}
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  placeholder="secretaria@suaigreja.org"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 focus:border-blue-600 focus:outline-none disabled:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:disabled:bg-gray-800/60"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">CNPJ</label>
                <input
                  type="text"
                  value={formData.cnpj}
                  onChange={e => setFormData({ ...formData, cnpj: e.target.value })}
                  placeholder="00.000.000/0001-00"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">Pastor Titular (Opcional)</label>
                <input
                  type="text"
                  value={formData.pastorName}
                  onChange={e => setFormData({ ...formData, pastorName: e.target.value })}
                  placeholder="Nome do pastor titular"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
            </div>

            {!googleAccount && (
              <div className="rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/70 dark:border-blue-900 p-4 text-xs text-blue-900 dark:text-blue-200">
                <p className="font-semibold flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <span>Vinculação automática via Conta Google</span>
                </p>
                <p className="mt-1 text-[11px] text-blue-800/90 dark:text-blue-300">
                  Ao concluir o cadastro, você poderá vincular sua Conta Google para sincronizar a congregação na nuvem Firebase com segurança.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">Telefone / WhatsApp *</label>
                <input
                  type="text"
                  required
                  value={formData.phone}
                  onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="(11) 99999-9999"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">Endereço Completo</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={e => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Rua, Número, Bairro"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">Cidade</label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={e => setFormData({ ...formData, city: e.target.value })}
                  placeholder="São Paulo"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">Estado</label>
                <input
                  type="text"
                  value={formData.state}
                  onChange={e => setFormData({ ...formData, state: e.target.value })}
                  placeholder="SP"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">CEP</label>
                <input
                  type="text"
                  value={formData.zipCode}
                  onChange={e => setFormData({ ...formData, zipCode: e.target.value })}
                  placeholder="01000-000"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/60 p-4 flex flex-col sm:flex-row items-center gap-4">
              {formData.logoUrl ? (
                <img
                  src={formData.logoUrl}
                  alt="Logomarca"
                  className="h-14 w-14 rounded-xl object-contain bg-white p-1 border border-gray-200"
                />
              ) : (
                <div
                  className="h-14 w-14 rounded-xl flex items-center justify-center text-white font-bold"
                  style={{
                    background: `linear-gradient(135deg, ${formData.primaryColor}, ${formData.secondaryColor})`,
                  }}
                >
                  <Palette className="w-6 h-6" />
                </div>
              )}
              <div className="flex-1 text-center sm:text-left">
                <p className="text-xs font-bold text-gray-800 dark:text-gray-200">
                  Logomarca e Cores da Interface (Opcional)
                </p>
                <p className="text-[11px] text-gray-500">
                  Envie o logo para extrair automaticamente as cores do painel da sua igreja.
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-center sm:justify-start gap-3">
                  <label className="cursor-pointer rounded-xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50">
                    Enviar Logomarca
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
                            }
                          };
                          img.src = String(reader.result);
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                  <div className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300">
                    <input
                      type="color"
                      value={formData.primaryColor}
                      onChange={e => setFormData({ ...formData, primaryColor: e.target.value })}
                      className="h-6 w-7 cursor-pointer rounded border border-gray-300 bg-white p-0.5"
                      title="Cor principal"
                    />
                    <input
                      type="color"
                      value={formData.secondaryColor}
                      onChange={e => setFormData({ ...formData, secondaryColor: e.target.value })}
                      className="h-6 w-7 cursor-pointer rounded border border-gray-300 bg-white p-0.5"
                      title="Cor secundária"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 flex justify-end gap-3 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-xl bg-blue-700 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 hover:bg-blue-800 transition disabled:opacity-60"
              >
                {submitting ? 'Cadastrando...' : 'Criar Igreja e Acessar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
