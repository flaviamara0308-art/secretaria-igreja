import React, { useState, useRef } from 'react';
import { Member, Church, User, Department } from '../../types';
import {
  Users,
  Search,
  Plus,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Upload,
  Eye,
  Edit3,
  ShieldAlert,
  Trash2,
  Download,
  CheckCircle2,
  Camera,
  FileSpreadsheet,
  X,
} from 'lucide-react';
import { SecurityConfirmModal } from '../SecurityConfirmModal';
import { SecurityPolicy } from '../../services/securityPolicy';
import {
  parseMembersCsv,
  generateMembersTemplateCsv,
  triggerCsvDownload,
  CsvParseSummary,
} from '../../utils/csvMemberUtils';

interface MembersScreenProps {
  church: Church;
  members: Member[];
  departments?: Department[];
  currentUser: User;
  onSaveMember: (member: Member) => void;
  onSaveBatchMembers?: (members: Member[]) => Promise<void> | void;
  onDeleteMember?: (memberId: string, reason: string) => void;
}

async function resizeImageToDataUrl(file: File, maxSize = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error('Imagem inválida.'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('Erro ao ler imagem.'));
    reader.readAsDataURL(file);
  });
}

export const MembersScreen: React.FC<MembersScreenProps> = ({
  church,
  members,
  departments = [],
  currentUser,
  onSaveMember,
  onSaveBatchMembers,
  onDeleteMember,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [memberToDelete, setMemberToDelete] = useState<Member | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteReason] = useState('Solicitação formal do titular / Desligamento definitivo');
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  // CSV Import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importFileName, setImportFileName] = useState<string>('');
  const [csvSummary, setCsvSummary] = useState<CsvParseSummary | null>(null);
  const [skipNameDuplicates, setSkipNameDuplicates] = useState(true);
  const [isImporting, setIsImporting] = useState(false);

  // Form state
  const [formData, setFormData] = useState<Partial<Member>>({
    fullName: '',
    memberCode: `MEM-${Math.floor(100 + Math.random() * 900)}`,
    birthDate: '',
    gender: 'MALE',
    maritalStatus: 'SINGLE',
    spouse: '',
    motherName: '',
    fatherName: '',
    birthplace: '',
    nationality: 'Brasileira',
    profession: '',
    educationLevel: 'Ensino Médio',
    address: {
      street: '',
      number: '',
      complement: '',
      neighborhood: '',
      city: church.city || '',
      state: church.state || 'SP',
      zipCode: '',
    },
    phone: '',
    email: '',
    membershipDate: new Date().toISOString().split('T')[0],
    baptismDate: '',
    churchRole: 'Membro',
    departmentIds: [],
    status: 'ACTIVE',
    notes: '',
    photoUrl: '',
  });

  const canEditMembers = SecurityPolicy.canCreateOrEditMember(currentUser, church.id);
  const canDeleteMembers = SecurityPolicy.canDeleteMember(currentUser, church.id);
  const canViewPII = SecurityPolicy.canViewRestrictedMemberPII(currentUser, church.id);

  // Strict multi-tenant & department-leader visibility scope
  const visibleMembers = SecurityPolicy.filterVisibleMembers(currentUser, church.id, members).map(m =>
    SecurityPolicy.sanitizeMemberForViewer(currentUser, church.id, m)
  );

  const filteredMembers = visibleMembers.filter(m => {
    if (!showInactive && m.status === 'INACTIVE') return false;
    const matchesSearch =
      m.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (canViewPII && m.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
      m.memberCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (canViewPII && m.phone.includes(searchTerm));
    return matchesSearch;
  });

  const handleOpenNew = () => {
    if (!canEditMembers) return;
    setEditingMember(null);
    setFormData({
      fullName: '',
      memberCode: `MEM-${Math.floor(1000 + Math.random() * 9000)}`,
      birthDate: '',
      gender: 'MALE',
      maritalStatus: 'SINGLE',
      spouse: '',
      motherName: '',
      fatherName: '',
      birthplace: '',
      nationality: 'Brasileira',
      profession: '',
      educationLevel: 'Ensino Médio',
      address: {
        street: '',
        number: '',
        complement: '',
        neighborhood: '',
        city: church.city || '',
        state: church.state || 'SP',
        zipCode: '',
      },
      phone: '',
      email: '',
      membershipDate: new Date().toISOString().split('T')[0],
      baptismDate: '',
      churchRole: 'Membro',
      departmentIds: [],
      status: 'ACTIVE',
      notes: '',
      photoUrl: '',
    });
    setDuplicateWarning(null);
    setShowModal(true);
  };

  const handleOpenEdit = (member: Member) => {
    if (!canEditMembers) return;
    setEditingMember(member);
    setFormData({
      ...member,
      address: {
        street: member.address?.street || '',
        number: member.address?.number || '',
        complement: member.address?.complement || '',
        neighborhood: member.address?.neighborhood || '',
        city: member.address?.city || '',
        state: member.address?.state || '',
        zipCode: member.address?.zipCode || '',
      },
      departmentIds: member.departmentIds || [],
    });
    setDuplicateWarning(null);
    setShowModal(true);
  };

  const checkDuplicates = (name: string) => {
    if (!name || editingMember) return;
    const found = visibleMembers.find(m => m.fullName.toLowerCase().trim() === name.toLowerCase().trim());
    if (found) {
      setDuplicateWarning(
        `Atenção: Já existe um membro cadastrado com o nome "${found.fullName}" (Código: ${found.memberCode}).`
      );
    } else {
      setDuplicateWarning(null);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setFormData(prev => ({ ...prev, photoUrl: dataUrl }));
    } catch {
      setDuplicateWarning('Não foi possível processar a fotografia selecionada. Tente uma imagem JPG ou PNG.');
    }
  };

  const toggleDepartment = (deptId: string) => {
    const current = formData.departmentIds || [];
    const exists = current.includes(deptId);
    setFormData({
      ...formData,
      departmentIds: exists ? current.filter(id => id !== deptId) : [...current, deptId],
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditMembers || !formData.fullName) return;

    const codeExists = members.some(
      m => m.churchId === church.id && m.memberCode === formData.memberCode && m.id !== editingMember?.id
    );
    if (codeExists) {
      setDuplicateWarning('Já existe um membro com este código na igreja. Por favor, utilize outro código.');
      return;
    }

    const memberToSave: Member = {
      id: editingMember ? editingMember.id : `mem-${Date.now()}`,
      churchId: church.id,
      fullName: formData.fullName.trim(),
      memberCode: formData.memberCode || `MEM-${Math.floor(1000 + Math.random() * 9000)}`,
      birthDate: formData.birthDate || '',
      gender: formData.gender as any,
      maritalStatus: formData.maritalStatus as any,
      spouse: formData.spouse || '',
      motherName: formData.motherName || '',
      fatherName: formData.fatherName || '',
      birthplace: formData.birthplace || '',
      nationality: formData.nationality || 'Brasileira',
      profession: formData.profession || '',
      educationLevel: formData.educationLevel || '',
      address: {
        street: formData.address?.street || '',
        number: formData.address?.number || '',
        complement: formData.address?.complement || '',
        neighborhood: formData.address?.neighborhood || '',
        city: formData.address?.city || '',
        state: formData.address?.state || '',
        zipCode: formData.address?.zipCode || '',
      },
      phone: formData.phone || '',
      email: formData.email || '',
      membershipDate: formData.membershipDate || new Date().toISOString().split('T')[0],
      baptismDate: formData.baptismDate || '',
      churchRole: formData.churchRole || 'Membro',
      departmentIds: formData.departmentIds || [],
      photoUrl: formData.photoUrl || '',
      notes: formData.notes || '',
      status: formData.status as 'ACTIVE' | 'INACTIVE',
      deactivationReason: formData.deactivationReason || '',
      history: editingMember
        ? [
            ...(editingMember.history || []),
            { date: new Date().toLocaleDateString('pt-BR'), action: 'Atualização de cadastro', author: currentUser.name },
          ]
        : [{ date: new Date().toLocaleDateString('pt-BR'), action: 'Cadastro inicial', author: currentUser.name }],
      updatedAt: new Date().toISOString(),
    };

    onSaveMember(memberToSave);
    setFeedbackBanner(
      editingMember
        ? `Ficha de "${memberToSave.fullName}" atualizada com sucesso.`
        : `Membro "${memberToSave.fullName}" cadastrado com sucesso.`
    );
    setTimeout(() => setFeedbackBanner(null), 4000);
    setShowModal(false);
  };

  const handleDeleteClick = (member: Member) => {
    if (!canDeleteMembers) return;
    setMemberToDelete(member);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!memberToDelete || !onDeleteMember) return;
    onDeleteMember(memberToDelete.id, deleteReason);
    setShowDeleteModal(false);
    setMemberToDelete(null);
    setShowModal(false);
  };

  // CSV Handlers
  const handleSelectCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    const text = await file.text();
    const summary = parseMembersCsv(text, church.id, members, church.city, church.state);
    setCsvSummary(summary);
  };

  const rowsReadyToImport = csvSummary
    ? csvSummary.rows.filter(r => r.isValid && (!skipNameDuplicates || !r.isDuplicateName))
    : [];

  const handleConfirmCsvImport = async () => {
    if (rowsReadyToImport.length === 0) return;
    setIsImporting(true);
    try {
      const membersList = rowsReadyToImport.map(r => ({
        ...r.member,
        history: [
          {
            date: new Date().toLocaleDateString('pt-BR'),
            action: `Importação via Planilha (${importFileName || 'CSV'})`,
            author: currentUser.name,
          },
        ],
      }));

      if (onSaveBatchMembers) {
        await onSaveBatchMembers(membersList);
      } else {
        for (const m of membersList) {
          onSaveMember(m);
        }
      }

      setFeedbackBanner(`${membersList.length} membro(s) importado(s) com sucesso da planilha "${importFileName}".`);
      setTimeout(() => setFeedbackBanner(null), 5000);
      setCsvSummary(null);
      setImportFileName('');
      setShowImportModal(false);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Rol de Membros</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Cadastro completo e gestão de membros da {church.name}.
          </p>
        </div>
        {canEditMembers && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setCsvSummary(null);
                setImportFileName('');
                setShowImportModal(true);
              }}
              className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              <Upload className="w-4 h-4" />
              Importar Planilha (.csv)
            </button>
            <button
              onClick={handleOpenNew}
              className="flex items-center gap-2 rounded-xl church-btn-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition"
            >
              <Plus className="w-4 h-4" />
              Novo Membro
            </button>
          </div>
        )}
      </div>

      {feedbackBanner && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-xs font-medium text-emerald-900 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{feedbackBanner}</span>
        </div>
      )}

      {/* Filters and Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-white p-4 rounded-xl shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-800">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Pesquisar por nome, código, e-mail ou telefone..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span>Exibir membros inativos</span>
          </label>
        </div>
      </div>

      {/* Members Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredMembers.map(member => (
          <div
            key={member.id}
            className={`rounded-2xl bg-white p-5 shadow-sm border transition flex flex-col justify-between dark:bg-gray-900 ${
              member.status === 'INACTIVE'
                ? 'border-amber-200 bg-amber-50/20 dark:border-amber-900'
                : 'border-gray-100 dark:border-gray-800 hover:shadow-md'
            }`}
          >
            <div>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {member.photoUrl ? (
                    <img src={member.photoUrl} alt={member.fullName} className="h-12 w-12 rounded-full object-cover shadow-sm" />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-800 font-bold text-lg dark:bg-blue-950 dark:text-blue-300">
                      {member.fullName.charAt(0)}
                    </div>
                  )}
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-white">{member.fullName}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        {member.memberCode}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          member.status === 'ACTIVE'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        }`}
                      >
                        {member.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2 text-xs text-gray-600 dark:text-gray-300">
                <div className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-gray-400" />
                  <span>{canViewPII ? member.email || 'Não informado' : '•••••••• (Restrito)'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-gray-400" />
                  <span>{canViewPII ? member.phone || 'Não informado' : '•••••••• (Restrito)'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-gray-400" />
                  <span>
                    {member.address.city || 'Cidade não informada'}
                    {member.address.state ? `, ${member.address.state}` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                  <span>Membro desde: {member.membershipDate || 'Não informada'}</span>
                </div>
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <span className="text-[10px] text-gray-400">Cargo: {member.churchRole || 'Membro'}</span>
              <div className="flex items-center gap-2">
                {canDeleteMembers && (
                  <button
                    onClick={() => handleDeleteClick(member)}
                    className="p-1.5 text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 transition"
                    title="Excluir Registro Permanentemente"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                {canEditMembers ? (
                  <button
                    onClick={() => handleOpenEdit(member)}
                    className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Editar
                  </button>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-gray-400">
                    <Eye className="w-3.5 h-3.5" />
                    Somente leitura
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}

        {filteredMembers.length === 0 && (
          <div className="col-span-full rounded-2xl bg-white p-12 text-center border border-gray-100 dark:bg-gray-900 dark:border-gray-800">
            <Users className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-3 font-semibold text-gray-900 dark:text-white">Nenhum membro encontrado</h3>
            <p className="mt-1 text-sm text-gray-500">
              Cadastre um membro manualmente ou clique em "Importar Planilha (.csv)" para carregar os dados reais da sua igreja.
            </p>
          </div>
        )}
      </div>

      {/* Modal Cadastro / Edição Completa */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl rounded-3xl bg-white p-6 sm:p-8 shadow-2xl dark:bg-gray-900 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-800">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  {editingMember ? 'Editar Ficha do Membro' : 'Novo Cadastro de Membro'}
                </h2>
                <p className="text-xs text-gray-500">Preencha os dados reais e informações eclesiásticas. Somente o Nome Completo é obrigatório.</p>
              </div>
              <button onClick={() => setShowModal(false)} className="rounded-full p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                ✕
              </button>
            </div>

            {duplicateWarning && (
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 p-3.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200 border border-amber-200 dark:border-amber-900">
                <ShieldAlert className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <span>{duplicateWarning}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-6">
              {/* FOTOGRAFIA & IDENTIFICAÇÃO */}
              <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/70 border border-gray-200/70 dark:border-gray-700">
                {formData.photoUrl ? (
                  <img src={formData.photoUrl} alt="Foto do membro" className="h-20 w-20 rounded-2xl object-cover shadow" />
                ) : (
                  <div className="h-20 w-20 rounded-2xl bg-blue-100 dark:bg-blue-950 flex items-center justify-center text-blue-700 dark:text-blue-300">
                    <Camera className="w-7 h-7" />
                  </div>
                )}
                <div className="flex-1 text-center sm:text-left">
                  <p className="text-xs font-bold text-gray-800 dark:text-gray-200">Fotografia Opcional do Membro</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">Imagem otimizada automaticamente para funcionamento online e offline.</p>
                  <div className="mt-2 flex flex-wrap justify-center sm:justify-start gap-2">
                    <label className="cursor-pointer rounded-xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50">
                      Selecionar Foto
                      <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                    </label>
                    {formData.photoUrl && (
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, photoUrl: '' })}
                        className="rounded-xl px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      >
                        Remover Foto
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* 1. DADOS PESSOAIS */}
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-3">1. Dados Pessoais</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Nome Completo *</label>
                    <input
                      type="text"
                      required
                      value={formData.fullName}
                      onChange={e => {
                        setFormData({ ...formData, fullName: e.target.value });
                        checkDuplicates(e.target.value);
                      }}
                      placeholder="Ex: Maria da Silva"
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Código do Membro</label>
                    <input
                      type="text"
                      value={formData.memberCode}
                      onChange={e => setFormData({ ...formData, memberCode: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 mt-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Data de Nascimento</label>
                    <input
                      type="date"
                      value={formData.birthDate}
                      onChange={e => setFormData({ ...formData, birthDate: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Sexo</label>
                    <select
                      value={formData.gender}
                      onChange={e => setFormData({ ...formData, gender: e.target.value as any })}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    >
                      <option value="MALE">Masculino</option>
                      <option value="FEMALE">Feminino</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Estado Civil</label>
                    <select
                      value={formData.maritalStatus}
                      onChange={e => setFormData({ ...formData, maritalStatus: e.target.value as any })}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    >
                      <option value="SINGLE">Solteiro(a)</option>
                      <option value="MARRIED">Casado(a)</option>
                      <option value="WIDOWED">Viúvo(a)</option>
                      <option value="DIVORCED">Divorciado(a)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Cônjuge</label>
                    <input
                      type="text"
                      value={formData.spouse}
                      onChange={e => setFormData({ ...formData, spouse: e.target.value })}
                      placeholder="Nome do cônjuge"
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mt-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Nome da Mãe</label>
                    <input
                      type="text"
                      value={formData.motherName}
                      onChange={e => setFormData({ ...formData, motherName: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Nome do Pai</label>
                    <input
                      type="text"
                      value={formData.fatherName}
                      onChange={e => setFormData({ ...formData, fatherName: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Naturalidade</label>
                    <input
                      type="text"
                      value={formData.birthplace}
                      onChange={e => setFormData({ ...formData, birthplace: e.target.value })}
                      placeholder="Cidade - UF de nascimento"
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mt-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Nacionalidade</label>
                    <input
                      type="text"
                      value={formData.nationality}
                      onChange={e => setFormData({ ...formData, nationality: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Profissão</label>
                    <input
                      type="text"
                      value={formData.profession}
                      onChange={e => setFormData({ ...formData, profession: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Escolaridade</label>
                    <input
                      type="text"
                      value={formData.educationLevel}
                      onChange={e => setFormData({ ...formData, educationLevel: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                </div>
              </div>

              {/* 2. ENDEREÇO & CONTATO */}
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-3">2. Endereço e Contato</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Rua / Logradouro</label>
                    <input
                      type="text"
                      value={formData.address?.street}
                      onChange={e => setFormData({ ...formData, address: { ...formData.address!, street: e.target.value } })}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Número</label>
                    <input
                      type="text"
                      value={formData.address?.number}
                      onChange={e => setFormData({ ...formData, address: { ...formData.address!, number: e.target.value } })}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Complemento</label>
                    <input
                      type="text"
                      value={formData.address?.complement}
                      onChange={e => setFormData({ ...formData, address: { ...formData.address!, complement: e.target.value } })}
                      placeholder="Apto, Bloco..."
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 mt-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Bairro</label>
                    <input
                      type="text"
                      value={formData.address?.neighborhood}
                      onChange={e => setFormData({ ...formData, address: { ...formData.address!, neighborhood: e.target.value } })}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Cidade</label>
                    <input
                      type="text"
                      value={formData.address?.city}
                      onChange={e => setFormData({ ...formData, address: { ...formData.address!, city: e.target.value } })}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Estado (UF)</label>
                    <input
                      type="text"
                      value={formData.address?.state}
                      onChange={e => setFormData({ ...formData, address: { ...formData.address!, state: e.target.value } })}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">CEP</label>
                    <input
                      type="text"
                      value={formData.address?.zipCode}
                      onChange={e => setFormData({ ...formData, address: { ...formData.address!, zipCode: e.target.value } })}
                      placeholder="00000-000"
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mt-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Telefone / WhatsApp</label>
                    <input
                      type="text"
                      value={formData.phone}
                      onChange={e => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="(11) 99999-9999"
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">E-mail</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={e => setFormData({ ...formData, email: e.target.value })}
                      placeholder="membro@email.com"
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                </div>
              </div>

              {/* 3. DADOS DA IGREJA, DEPARTAMENTOS & SITUAÇÃO */}
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-3">3. Dados Eclesiásticos e Situação</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Data de Entrada</label>
                    <input
                      type="date"
                      value={formData.membershipDate}
                      onChange={e => setFormData({ ...formData, membershipDate: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Data de Batismo</label>
                    <input
                      type="date"
                      value={formData.baptismDate}
                      onChange={e => setFormData({ ...formData, baptismDate: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Cargo / Função</label>
                    <input
                      type="text"
                      value={formData.churchRole}
                      onChange={e => setFormData({ ...formData, churchRole: e.target.value })}
                      placeholder="Membro, Diácono, Presbítero..."
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                </div>

                {departments.length > 0 && (
                  <div className="mt-3">
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                      Departamentos Vinculados
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {departments.map(dept => {
                        const checked = (formData.departmentIds || []).includes(dept.id);
                        return (
                          <button
                            key={dept.id}
                            type="button"
                            onClick={() => toggleDepartment(dept.id)}
                            className={`rounded-xl px-3 py-1.5 text-xs font-semibold border transition ${
                              checked
                                ? 'church-btn-primary text-white border-transparent'
                                : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
                            }`}
                          >
                            {dept.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mt-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Situação Cadastral</label>
                    <select
                      value={formData.status}
                      onChange={e => setFormData({ ...formData, status: e.target.value as any })}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    >
                      <option value="ACTIVE">Ativo</option>
                      <option value="INACTIVE">Inativo</option>
                    </select>
                  </div>
                  {formData.status === 'INACTIVE' && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Motivo da Inativação</label>
                      <input
                        type="text"
                        value={formData.deactivationReason}
                        onChange={e => setFormData({ ...formData, deactivationReason: e.target.value })}
                        placeholder="Ex: Mudança de cidade, transferência..."
                        className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                      />
                    </div>
                  )}
                </div>

                <div className="mt-3">
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Observações Gerais</label>
                  <textarea
                    rows={2}
                    value={formData.notes}
                    onChange={e => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Informações pastorais, dons, histórico resumido..."
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-6 border-t border-gray-100 dark:border-gray-800">
                <div>
                  {editingMember && canDeleteMembers && (
                    <button
                      type="button"
                      onClick={() => handleDeleteClick(editingMember)}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-xl transition dark:hover:bg-rose-950/40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Excluir Cadastro Definitivamente</span>
                    </button>
                  )}
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="rounded-xl church-btn-primary px-6 py-2.5 text-sm font-semibold text-white shadow-md transition"
                  >
                    Salvar Ficha do Membro
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Real de Importação CSV */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-900 max-h-[90vh] overflow-y-auto space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-blue-600" />
                  <span>Importação Real de Membros (.CSV)</span>
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  Importe a planilha da sua igreja em formato CSV (separado por ponto-e-vírgula ou vírgula). No Excel, utilize "Salvar como &gt; CSV UTF-8".
                </p>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900">
              <div className="text-xs text-blue-950 dark:text-blue-200">
                <p className="font-bold">Precisa do modelo padrão?</p>
                <p className="text-[11px] opacity-80">Baixe a planilha modelo já configurada com todas as colunas e datas brasileiras (DD/MM/AAAA).</p>
              </div>
              <button
                type="button"
                onClick={() =>
                  triggerCsvDownload(
                    `modelo_membros_${church.exclusiveCode || 'igreja'}.csv`,
                    generateMembersTemplateCsv()
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-xl bg-white dark:bg-gray-900 border border-blue-300 dark:border-blue-700 px-3.5 py-2 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Baixar Planilha Modelo</span>
              </button>
            </div>

            <div className="rounded-2xl border-2 border-dashed border-gray-300 p-6 text-center dark:border-gray-700">
              <Upload className="mx-auto h-9 w-9 text-gray-400" />
              <p className="mt-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                {importFileName ? `Arquivo selecionado: ${importFileName}` : 'Selecione o arquivo CSV com os membros reais'}
              </p>
              <p className="text-xs text-gray-400 mt-1">Formatos aceitos: .csv, .txt (UTF-8 com ";" ou ",")</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleSelectCsvFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 rounded-xl church-btn-primary px-4 py-2 text-xs font-semibold text-white transition"
              >
                Selecionar Arquivo CSV
              </button>
            </div>

            {csvSummary && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 p-3 border border-emerald-200 dark:border-emerald-900">
                    <span className="text-emerald-700 dark:text-emerald-300 font-semibold block">Prontos p/ Importar</span>
                    <span className="text-lg font-bold text-emerald-900 dark:text-white">{rowsReadyToImport.length}</span>
                  </div>
                  <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-3 border border-amber-200 dark:border-amber-900">
                    <span className="text-amber-700 dark:text-amber-300 font-semibold block">Duplicidades</span>
                    <span className="text-lg font-bold text-amber-900 dark:text-white">{csvSummary.duplicateCount}</span>
                  </div>
                  <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 p-3 border border-rose-200 dark:border-rose-900">
                    <span className="text-rose-700 dark:text-rose-300 font-semibold block">Com Erro</span>
                    <span className="text-lg font-bold text-rose-900 dark:text-white">{csvSummary.errorCount}</span>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipNameDuplicates}
                    onChange={e => setSkipNameDuplicates(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Ignorar automaticamente registros com o mesmo Nome Completo já cadastrado</span>
                </label>

                <div className="border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 sticky top-0">
                      <tr>
                        <th className="p-2.5">Linha</th>
                        <th className="p-2.5">Nome Completo</th>
                        <th className="p-2.5">Código</th>
                        <th className="p-2.5">Cidade</th>
                        <th className="p-2.5">Validação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {csvSummary.rows.map(row => {
                        const willSkip = !row.isValid || (skipNameDuplicates && row.isDuplicateName);
                        return (
                          <tr key={row.rowIndex} className={willSkip ? 'opacity-60 bg-gray-50/50 dark:bg-gray-800/30' : ''}>
                            <td className="p-2.5 font-mono text-[11px]">{row.rowIndex}</td>
                            <td className="p-2.5 font-semibold text-gray-900 dark:text-white">{row.member.fullName || '—'}</td>
                            <td className="p-2.5 font-mono">{row.member.memberCode}</td>
                            <td className="p-2.5">{row.member.address.city || '—'}</td>
                            <td className="p-2.5">
                              {!row.isValid ? (
                                <span className="text-rose-600 font-semibold">{row.errors.join('; ')}</span>
                              ) : row.isDuplicateName ? (
                                <span className="text-amber-600 font-semibold">
                                  {skipNameDuplicates ? 'Ignorado (Nome duplicado)' : 'Aviso: Nome já existe'}
                                </span>
                              ) : (
                                <span className="text-emerald-600 font-semibold">Válido</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Fechar
              </button>
              {csvSummary && (
                <button
                  type="button"
                  disabled={rowsReadyToImport.length === 0 || isImporting}
                  onClick={handleConfirmCsvImport}
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition disabled:opacity-50"
                >
                  {isImporting
                    ? 'Importando...'
                    : `Confirmar Importação (${rowsReadyToImport.length})`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Reautenticação / Confirmação de Senha para Exclusão */}
      {showDeleteModal && memberToDelete && (
        <SecurityConfirmModal
          title="Autorizar Exclusão Definitiva de Membro"
          description={`Confirme sua senha de acesso para autorizar a exclusão definitiva de ${memberToDelete.fullName} (${memberToDelete.memberCode}). Todos os vínculos departamentais serão cancelados e a operação será registrada no Log de Auditoria.`}
          actionName="Excluir Permanentemente"
          isDanger={true}
          onConfirm={handleConfirmDelete}
          onCancel={() => {
            setShowDeleteModal(false);
            setMemberToDelete(null);
          }}
        />
      )}
    </div>
  );
};
