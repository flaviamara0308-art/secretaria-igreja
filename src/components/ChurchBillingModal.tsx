import React, { useState } from 'react';
import { Church, User, PaymentProof, PlatformPaymentSettings } from '../types';
import { StorageService } from '../services/storage';
import { FirebaseService } from '../services/firebase';
import { syncEngine } from '../services/syncEngine';
import { 
  CreditCard, 
  CheckCircle2, 
  AlertTriangle, 
  X, 
  Upload, 
  Clock, 
  FileText, 
  Copy, 
  Building2, 
  ShieldCheck, 
  RefreshCw,
  AlertCircle
} from 'lucide-react';

interface ChurchBillingModalProps {
  isOpen: boolean;
  onClose: () => void;
  church: Church;
  currentUser: User;
  onUpdateChurch: (updatedChurch: Church) => void;
}

export const ChurchBillingModal: React.FC<ChurchBillingModalProps> = ({
  isOpen,
  onClose,
  church,
  currentUser,
  onUpdateChurch
}) => {
  const [activeTab, setActiveTab] = useState<'PLAN' | 'SUBMIT' | 'HISTORY'>('PLAN');
  const [paymentSettings, setPaymentSettings] = useState<PlatformPaymentSettings>(StorageService.getPaymentSettings());
  const [proofs, setProofs] = useState<PaymentProof[]>(StorageService.getPaymentProofs(church.id));
  const [copiedKey, setCopiedKey] = useState(false);

  // Form state
  const [selectedPlan, setSelectedPlan] = useState<'MONTHLY_50' | 'ANNUAL_600'>('MONTHLY_50');
  const [amount, setAmount] = useState<number>(50.00);
  const [paymentMethod, setPaymentMethod] = useState<'PIX' | 'TRANSFER' | 'OTHER'>('PIX');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [proofFileName, setProofFileName] = useState('');
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  if (!isOpen) return null;

  const isSecretary = currentUser.role === 'GENERAL_SECRETARY' || currentUser.role === 'ADMIN' || currentUser.role === 'PLATFORM_ADMIN';

  const handlePlanChange = (plan: 'MONTHLY_50' | 'ANNUAL_600') => {
    setSelectedPlan(plan);
    setAmount(plan === 'MONTHLY_50' ? 50.00 : 600.00);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setProofFileName(file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        setProofPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCopyPix = () => {
    navigator.clipboard.writeText(paymentSettings.pixKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2500);
  };

  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSecretary) {
      alert('Somente a Secretaria Geral pode enviar comprovantes de pagamento.');
      return;
    }

    setSubmitting(true);
    const newProof: PaymentProof = {
      id: `proof-${Date.now()}`,
      churchId: church.id,
      churchName: church.name,
      plan: selectedPlan,
      amount: amount,
      paymentMethod: paymentMethod,
      receiptNumber: receiptNumber || `REC-${Date.now().toString().slice(-6)}`,
      proofFileName: proofFileName || 'comprovante_pagamento.pdf',
      proofUrl: proofPreview || '',
      notes: notes,
      submittedAt: new Date().toISOString(),
      submittedBy: currentUser.name,
      status: 'PENDING'
    };

    StorageService.savePaymentProof(newProof);
    try {
      await FirebaseService.savePaymentProof(newProof);
    } catch (e) {
      console.warn('Saved proof locally:', e);
    }

    // Immutable audit log
    await syncEngine.logAudit({
      churchId: church.id,
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'Envio de Comprovante de Pagamento',
      entityType: 'PLATFORM',
      entityId: newProof.id,
      details: `Comprovante de ${selectedPlan === 'MONTHLY_50' ? 'R$ 50,00 (Mensal)' : 'R$ 600,00 (Anual)'} enviado para análise administrativa.`,
    });

    setProofs([newProof, ...proofs]);
    setSubmitting(false);
    setSubmitSuccess(true);
    setTimeout(() => {
      setSubmitSuccess(false);
      setActiveTab('HISTORY');
    }, 1500);
  };

  const isPermanentFree = church.plan === 'FREE_PERMANENT';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-3xl bg-white shadow-2xl dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden my-8">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-6 py-5 bg-gradient-to-r from-blue-900 to-indigo-900 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Assinatura & Pagamento</h2>
              <p className="text-xs text-blue-200">{church.name} ({church.exclusiveCode})</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="rounded-xl p-2 text-white/80 hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-800 px-6 pt-3 bg-gray-50 dark:bg-gray-950">
          <button
            onClick={() => setActiveTab('PLAN')}
            className={`pb-3 px-4 text-xs font-semibold border-b-2 transition ${
              activeTab === 'PLAN'
                ? 'border-blue-600 text-blue-700 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'
            }`}
          >
            Plano & Instruções
          </button>
          {!isPermanentFree && (
            <button
              onClick={() => setActiveTab('SUBMIT')}
              className={`pb-3 px-4 text-xs font-semibold border-b-2 transition ${
                activeTab === 'SUBMIT'
                  ? 'border-blue-600 text-blue-700 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'
              }`}
            >
              Enviar Comprovante
            </button>
          )}
          <button
            onClick={() => setActiveTab('HISTORY')}
            className={`pb-3 px-4 text-xs font-semibold border-b-2 transition ${
              activeTab === 'HISTORY'
                ? 'border-blue-600 text-blue-700 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'
            }`}
          >
            Histórico ({proofs.length})
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[70vh] overflow-y-auto space-y-6">

          {/* TAB 1: PLAN */}
          {activeTab === 'PLAN' && (
            <div className="space-y-6">
              {/* Permanent Free Tier Badge */}
              {isPermanentFree ? (
                <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 p-5 text-emerald-900 dark:text-emerald-200 space-y-2">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <h3 className="font-bold text-base">Benefício de Gratuidade Permanente</h3>
                      <p className="text-xs text-emerald-700 dark:text-emerald-300">
                        Primeira Igreja Gratuita da Plataforma
                      </p>
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed text-emerald-800 dark:text-emerald-300 pt-2 border-t border-emerald-200 dark:border-emerald-800">
                    Sua igreja foi contemplada manualmente pelo administrador principal com o benefício vitalício de gratuidade permanente. Todas as funcionalidades operacionais, backups, emissão de relatórios e suporte técnico estão liberados sem cobrança e sem vencimento.
                  </p>
                </div>
              ) : (
                <>
                  {/* Status Card */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-2xl bg-gray-50 dark:bg-gray-800/60 p-4 border border-gray-200 dark:border-gray-700">
                      <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase">Plano Atual</span>
                      <p className="text-sm font-bold text-gray-900 dark:text-white mt-1">
                        {church.plan === 'ANNUAL_600' ? 'Anual (R$ 600,00)' : 'Mensal (R$ 50,00)'}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-gray-50 dark:bg-gray-800/60 p-4 border border-gray-200 dark:border-gray-700">
                      <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase">Situação</span>
                      <div className="mt-1">
                        {church.planStatus === 'ACTIVE' && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600"></span> Em dia
                          </span>
                        )}
                        {church.planStatus === 'IN_GRACE_PERIOD' && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-600"></span> Em Tolerância (7 dias)
                          </span>
                        )}
                        {church.planStatus === 'SUSPENDED_OVERDUE' && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-600"></span> Suspenso por Inadimplência
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-gray-50 dark:bg-gray-800/60 p-4 border border-gray-200 dark:border-gray-700">
                      <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase">Vencimento</span>
                      <p className="text-sm font-bold text-gray-900 dark:text-white mt-1">
                        {church.dueDate ? new Date(church.dueDate).toLocaleDateString('pt-BR') : 'Não definido'}
                      </p>
                    </div>
                  </div>

                  {/* Grace period explanation banner */}
                  {church.planStatus === 'IN_GRACE_PERIOD' && (
                    <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 p-4 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs space-y-1">
                      <div className="flex items-center gap-2 font-bold">
                        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                        <span>Aviso de Tolerância Operacional (7 dias)</span>
                      </div>
                      <p className="leading-relaxed">
                        Sua mensalidade venceu em {church.dueDate ? new Date(church.dueDate).toLocaleDateString('pt-BR') : 'data recente'}. O acesso operacional de cadastros e relatórios é mantido normalmente durante a tolerância de 7 dias. Regularize enviando o comprovante para evitar suspensão automática.
                      </p>
                    </div>
                  )}

                  {/* Payment Instructions Card */}
                  <div className="rounded-2xl border border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/30 p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-blue-950 dark:text-blue-200">
                        Dados Oficiais para Pagamento Manual
                      </h4>
                      <span className="text-[11px] text-blue-700 dark:text-blue-300 font-medium">
                        Pix ou Transferência
                      </span>
                    </div>

                    <div className="rounded-xl bg-white dark:bg-gray-900 p-4 border border-blue-100 dark:border-blue-900/60 space-y-3">
                      <div>
                        <span className="text-[10px] font-bold text-gray-500 uppercase">Chave Pix ({paymentSettings.pixKeyType})</span>
                        <div className="flex items-center justify-between mt-1 p-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                          <code className="text-xs font-mono font-bold text-gray-900 dark:text-white">
                            {paymentSettings.pixKey}
                          </code>
                          <button
                            type="button"
                            onClick={handleCopyPix}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-blue-700 text-white hover:bg-blue-800 transition"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>{copiedKey ? 'Copiado!' : 'Copiar'}</span>
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-xs pt-2 border-t border-gray-100 dark:border-gray-800">
                        <div>
                          <span className="text-[10px] text-gray-500 block">Favorecido</span>
                          <span className="font-semibold text-gray-900 dark:text-white">{paymentSettings.recipientName}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-gray-500 block">Banco</span>
                          <span className="font-semibold text-gray-900 dark:text-white">{paymentSettings.bankName}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-gray-500 block">Agência</span>
                          <span className="font-semibold text-gray-900 dark:text-white">{paymentSettings.agency}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-gray-500 block">Conta</span>
                          <span className="font-semibold text-gray-900 dark:text-white">{paymentSettings.accountNumber}</span>
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                      {paymentSettings.instructions}
                    </p>

                    <button
                      type="button"
                      onClick={() => setActiveTab('SUBMIT')}
                      className="w-full py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs transition shadow-md flex items-center justify-center gap-2"
                    >
                      <Upload className="w-4 h-4" />
                      <span>Anexar e Enviar Comprovante de Pagamento</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 2: SUBMIT */}
          {activeTab === 'SUBMIT' && !isPermanentFree && (
            <form onSubmit={handleSubmitProof} className="space-y-4">
              {submitSuccess && (
                <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Comprovante enviado com sucesso! Aguarde a análise da equipe financeira.</span>
                </div>
              )}

              {/* Plan selection */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                  1. Selecione o Plano Referente *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div
                    onClick={() => handlePlanChange('MONTHLY_50')}
                    className={`cursor-pointer rounded-2xl p-4 border text-center transition ${
                      selectedPlan === 'MONTHLY_50'
                        ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40 ring-2 ring-blue-600'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <span className="text-xs font-bold text-gray-900 dark:text-white block">Plano Mensal</span>
                    <span className="text-lg font-black text-blue-700 dark:text-blue-400 mt-1 block">R$ 50,00</span>
                    <span className="text-[10px] text-gray-500">Cobrança manual por mês</span>
                  </div>
                  <div
                    onClick={() => handlePlanChange('ANNUAL_600')}
                    className={`cursor-pointer rounded-2xl p-4 border text-center transition ${
                      selectedPlan === 'ANNUAL_600'
                        ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40 ring-2 ring-blue-600'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <span className="text-xs font-bold text-gray-900 dark:text-white block">Plano Anual</span>
                    <span className="text-lg font-black text-blue-700 dark:text-blue-400 mt-1 block">R$ 600,00</span>
                    <span className="text-[10px] text-gray-500">Validade de 1 ano completo</span>
                  </div>
                </div>
              </div>

              {/* Payment Method & Receipt */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                    2. Meio Utilizado *
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as any)}
                    className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                  >
                    <option value="PIX">Pix (Chave da Plataforma)</option>
                    <option value="TRANSFER">Transferência Bancária (TED/DOC)</option>
                    <option value="OTHER">Depósito em Conta</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                    Número do Documento / Autenticação (Opcional)
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: E2E1234567890..."
                    value={receiptNumber}
                    onChange={(e) => setReceiptNumber(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                  />
                </div>
              </div>

              {/* Proof File Attachment */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                  3. Anexo do Comprovante (Imagem ou PDF) *
                </label>
                <div className="rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700 p-4 text-center hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleFileChange}
                    className="hidden"
                    id="proof-upload"
                  />
                  <label htmlFor="proof-upload" className="cursor-pointer flex flex-col items-center">
                    <Upload className="w-8 h-8 text-gray-400 mb-2" />
                    <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                      {proofFileName ? proofFileName : 'Clique para selecionar o comprovante'}
                    </span>
                    <span className="text-[10px] text-gray-500 mt-1">
                      Formatos aceitos: JPG, PNG, PDF até 5MB
                    </span>
                  </label>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                  Observações ou Mensagem à Equipe Financeira
                </label>
                <textarea
                  rows={2}
                  placeholder="Informações adicionais sobre o pagamento..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                />
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('PLAN')}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 dark:text-gray-400"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs shadow-md transition disabled:opacity-50"
                >
                  {submitting ? 'Enviando...' : 'Confirmar Envio para Análise'}
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: HISTORY */}
          {activeTab === 'HISTORY' && (
            <div className="space-y-3">
              {proofs.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-xs">
                  Nenhum comprovante de pagamento registrado até o momento.
                </div>
              ) : (
                proofs.map((proof) => (
                  <div
                    key={proof.id}
                    className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4 bg-white dark:bg-gray-900 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-gray-900 dark:text-white">
                          {proof.plan === 'ANNUAL_600' ? 'Plano Anual (R$ 600,00)' : 'Plano Mensal (R$ 50,00)'}
                        </span>
                        <span className="text-[10px] text-gray-500">via {proof.paymentMethod}</span>
                      </div>
                      <div>
                        {proof.status === 'PENDING' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                            Em Análise
                          </span>
                        )}
                        {proof.status === 'APPROVED' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                            Aprovado
                          </span>
                        )}
                        {proof.status === 'REJECTED' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200">
                            Rejeitado
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-[11px] text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-4">
                      <span>Data: {new Date(proof.submittedAt).toLocaleString('pt-BR')}</span>
                      <span>Enviado por: {proof.submittedBy}</span>
                      {proof.receiptNumber && <span>Doc: {proof.receiptNumber}</span>}
                    </div>

                    {proof.notes && (
                      <p className="text-xs text-gray-600 dark:text-gray-300 italic bg-gray-50 dark:bg-gray-800/50 p-2 rounded-lg">
                        "{proof.notes}"
                      </p>
                    )}

                    {/* Rejection box with mandatory reason */}
                    {proof.status === 'REJECTED' && proof.rejectionReason && (
                      <div className="rounded-xl bg-rose-50 dark:bg-rose-950/60 p-3 border border-rose-200 dark:border-rose-900 text-rose-900 dark:text-rose-200 text-xs space-y-1">
                        <div className="flex items-center gap-1.5 font-bold">
                          <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                          <span>Motivo da Rejeição:</span>
                        </div>
                        <p>{proof.rejectionReason}</p>
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => setActiveTab('SUBMIT')}
                            className="text-[11px] font-bold text-rose-700 dark:text-rose-300 underline"
                          >
                            Clique aqui para enviar um novo comprovante regularizado
                          </button>
                        </div>
                      </div>
                    )}

                    {proof.status === 'APPROVED' && proof.reviewedBy && (
                      <div className="text-[10px] text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Aprovado por {proof.reviewedBy} em {proof.reviewedAt ? new Date(proof.reviewedAt).toLocaleDateString('pt-BR') : ''}</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 dark:border-gray-800 px-6 py-4 bg-gray-50 dark:bg-gray-950 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 text-gray-800 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-white font-semibold text-xs transition"
          >
            Fechar
          </button>
        </div>

      </div>
    </div>
  );
};
