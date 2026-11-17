import React, { useState, useEffect, useRef } from 'react';
import { Church, SystemReport, Member, Department, User, AuditLog, DepartmentTransferHistory } from '../../types';
import { StorageService } from '../../services/storage';
import { IndexedDBService } from '../../services/indexedDB';
import { syncEngine } from '../../services/syncEngine';
import { SecurityPolicy } from '../../services/securityPolicy';
import { generateReportCsv, triggerCsvDownload } from '../../utils/csvMemberUtils';
import {
  generateReportPdf,
  generateMemberSheetPdf,
  formatDatePtBr,
  translateMaritalStatus,
  GeneratedPdfResult,
} from '../../utils/pdfExportUtils';
import { Download, Printer, CheckCircle2, Eye, ShieldAlert, FileText } from 'lucide-react';

interface ReportsScreenProps {
  church: Church;
  report: SystemReport;
  members: Member[];
  departments: Department[];
  currentUser: User;
}

const REPORT_TITLES: Record<string, string> = {
  ACTIVE: 'Relatório de Membros Ativos',
  INACTIVE: 'Relatório de Membros Inativos',
  BY_DEPT: 'Relatório de Membros por Departamento',
  BIRTHDAYS: 'Relatório de Aniversariantes do Mês',
  NEW: 'Relatório de Novos Membros',
  BAPTISMS: 'Relatório de Batismos Registrados',
  TRANSFERS: 'Relatório de Transferências Departamentais',
  HISTORY: 'Histórico de Auditoria da Secretaria',
};

export const ReportsScreen: React.FC<ReportsScreenProps> = ({
  church,
  members,
  departments,
  currentUser,
}) => {
  const [reportType, setReportType] = useState<
    'ACTIVE' | 'INACTIVE' | 'BY_DEPT' | 'BIRTHDAYS' | 'NEW' | 'BAPTISMS' | 'TRANSFERS' | 'HISTORY'
  >('ACTIVE');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [selectedMemberForPrint, setSelectedMemberForPrint] = useState<Member | null>(null);
  const [exportBanner, setExportBanner] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<GeneratedPdfResult | null>(null);
  const pdfIframeRef = useRef<HTMLIFrameElement>(null);

  const [transfers, setTransfers] = useState<DepartmentTransferHistory[]>([]);
  const [historyLogs, setHistoryLogs] = useState<AuditLog[]>([]);

  // Print fields selection (restricted personal data defaults to false for A4 safety unless Secretary opts in)
  const [printFields, setPrintFields] = useState({
    code: true,
    birthDate: true,
    maritalStatus: true,
    address: false,
    phone: false,
    email: false,
    membershipDate: true,
    baptismDate: true,
    churchRole: true,
    departments: true,
  });

  const isSecretary = SecurityPolicy.canExportReports(currentUser, church.id);
  const canViewPII = SecurityPolicy.canViewRestrictedMemberPII(currentUser, church.id);

  const scopedMembers = SecurityPolicy.filterVisibleMembers(currentUser, church.id, members).map(m =>
    SecurityPolicy.sanitizeMemberForViewer(currentUser, church.id, m)
  );

  useEffect(() => {
    setTransfers(StorageService.getDepartmentTransfers(church.id));
    IndexedDBService.getAll<AuditLog>('auditLogs', church.id).then(logs => {
      setHistoryLogs(logs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));
    });
  }, [church.id, reportType]);

  useEffect(() => {
    return () => {
      if (pdfPreview?.blobUrl) {
        URL.revokeObjectURL(pdfPreview.blobUrl);
      }
    };
  }, [pdfPreview]);

  const closePdfPreview = () => {
    if (pdfPreview?.blobUrl) {
      URL.revokeObjectURL(pdfPreview.blobUrl);
    }
    setPdfPreview(null);
  };

  const inDateRange = (dateStr?: string): boolean => {
    if (!startDate && !endDate) return true;
    if (!dateStr) return false;
    const normalized = dateStr.slice(0, 10);
    if (startDate && normalized < startDate) return false;
    if (endDate && normalized > endDate) return false;
    return true;
  };

  const getFilteredMembers = (): Member[] => {
    const currentMonth = new Date().getMonth() + 1;
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const ninetyDaysIso = ninetyDaysAgo.toISOString().split('T')[0];

    const deptMatch = (m: Member) => deptFilter === 'ALL' || m.departmentIds?.includes(deptFilter);

    switch (reportType) {
      case 'ACTIVE':
        return scopedMembers.filter(m => m.status === 'ACTIVE' && deptMatch(m) && inDateRange(m.membershipDate));
      case 'INACTIVE':
        return scopedMembers.filter(m => m.status === 'INACTIVE' && deptMatch(m) && inDateRange(m.membershipDate));
      case 'BY_DEPT':
        return scopedMembers.filter(m => deptMatch(m));
      case 'BIRTHDAYS':
        return scopedMembers.filter(m => {
          if (m.status !== 'ACTIVE' || !deptMatch(m) || !m.birthDate) return false;
          const parts = m.birthDate.split('-');
          const birthMonth = parts.length >= 2 ? parseInt(parts[1], 10) : 0;
          return birthMonth === currentMonth;
        });
      case 'NEW':
        return scopedMembers.filter(m => {
          if (!deptMatch(m)) return false;
          if (startDate || endDate) return inDateRange(m.membershipDate);
          return Boolean(m.membershipDate && m.membershipDate >= ninetyDaysIso);
        });
      case 'BAPTISMS':
        return scopedMembers.filter(m => Boolean(m.baptismDate) && deptMatch(m) && inDateRange(m.baptismDate));
      default:
        return scopedMembers;
    }
  };

  const getFilteredTransfers = (): DepartmentTransferHistory[] => {
    return transfers.filter(t => {
      const matchDept =
        deptFilter === 'ALL' || t.toDepartmentId === deptFilter || t.fromDepartmentId === deptFilter;
      return matchDept;
    });
  };

  const buildReportExportPayload = () => {
    if (reportType === 'TRANSFERS') {
      const list = getFilteredTransfers();
      return {
        headers: ['Data', 'Membro', 'Tipo', 'Origem', 'Destino', 'Responsável'],
        rows: list.map(t => [
          t.date,
          t.memberName,
          t.type,
          t.fromDepartmentName || '—',
          t.toDepartmentName,
          t.author,
        ]),
      };
    }

    if (reportType === 'HISTORY') {
      return {
        headers: ['Data/Hora', 'Usuário', 'Ação', 'Categoria', 'Detalhes'],
        rows: historyLogs.map(l => [l.date, l.userName, l.action, l.entityType || 'GERAL', l.details]),
      };
    }

    const list = getFilteredMembers();
    return {
      headers: ['Código', 'Nome Completo', 'Situação', 'Cargo', 'Cidade', 'Telefone', 'E-mail', 'Data Entrada', 'Data Batismo'],
      rows: list.map(m => [
        m.memberCode,
        m.fullName,
        m.status === 'ACTIVE' ? 'Ativo' : 'Inativo',
        m.churchRole || 'Membro',
        `${m.address?.city || ''}${m.address?.state ? `/${m.address.state}` : ''}`,
        canViewPII ? m.phone : 'Restrito',
        canViewPII ? m.email : 'Restrito',
        formatDatePtBr(m.membershipDate),
        m.baptismDate ? formatDatePtBr(m.baptismDate) : '—',
      ]),
    };
  };

  const handleExport = async (format: 'PDF_PREVIEW' | 'PDF_DOWNLOAD' | 'EXCEL') => {
    if (!isSecretary) {
      setExportBanner('Acesso negado: Somente a Secretaria Geral pode exportar dados de membros.');
      return;
    }

    const payload = buildReportExportPayload();
    const safeName = church.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');

    syncEngine
      .logAudit({
        churchId: church.id,
        userId: currentUser.id,
        userName: currentUser.name,
        action: `Exportação de Relatório (${reportType})`,
        entityType: 'EXPORT',
        details: `Formato: ${format} | Registros: ${payload.rows.length} | Filtros: Dept=${deptFilter}, De=${startDate || '*'}, Até=${endDate || '*'}`,
      })
      .catch(err => console.error('Failed to log export audit:', err));

    if (format === 'EXCEL') {
      const csvContent = generateReportCsv(payload.headers, payload.rows);
      triggerCsvDownload(`relatorio_${reportType.toLowerCase()}_${safeName}.csv`, csvContent);
      setExportBanner(`Arquivo CSV/Excel gerado com ${payload.rows.length} registro(s) e registrado na auditoria.`);
      setShowPreviewModal(false);
      return;
    }

    setIsGeneratingPdf(true);
    try {
      const deptName =
        deptFilter === 'ALL'
          ? 'Todos os Departamentos'
          : departments.find(d => d.id === deptFilter)?.name || deptFilter;
      const filterSummary = `Departamento: ${deptName} • Período: ${startDate ? formatDatePtBr(startDate) : 'Início'} até ${endDate ? formatDatePtBr(endDate) : 'Atual'}`;

      const result = await generateReportPdf({
        church,
        reportTitle: REPORT_TITLES[reportType] || 'Relatório Oficial',
        headers: payload.headers,
        rows: payload.rows,
        filterSummary,
        generatedBy: currentUser.name,
        fileName: `relatorio_${reportType.toLowerCase()}_${safeName}.pdf`,
      });

      if (format === 'PDF_DOWNLOAD') {
        result.doc.save(result.fileName);
        URL.revokeObjectURL(result.blobUrl);
        setExportBanner(`PDF "${result.fileName}" gerado com logotipo da igreja e baixado com sucesso.`);
      } else {
        if (pdfPreview?.blobUrl) URL.revokeObjectURL(pdfPreview.blobUrl);
        setPdfPreview(result);
        setShowPreviewModal(false);
        setExportBanner(`PDF oficial gerado (${payload.rows.length} registro(s)) e pronto para visualizar ou imprimir.`);
      }
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleGenerateMemberPdf = async (downloadImmediately: boolean) => {
    if (!selectedMemberForPrint) return;
    setIsGeneratingPdf(true);
    try {
      syncEngine
        .logAudit({
          churchId: church.id,
          userId: currentUser.id,
          userName: currentUser.name,
          action: 'Geração de PDF da Ficha Individual A4',
          entityType: 'EXPORT',
          entityId: selectedMemberForPrint.id,
          details: `PDF da ficha cadastral gerado para: ${selectedMemberForPrint.fullName} (${selectedMemberForPrint.memberCode})`,
        })
        .catch(err => console.error('Failed to log member PDF audit:', err));

      const safeMember = selectedMemberForPrint.fullName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const result = await generateMemberSheetPdf({
        church,
        member: selectedMemberForPrint,
        departmentNames: memberDeptNames(selectedMemberForPrint),
        documentId,
        printFields,
        canViewPII,
        generatedBy: currentUser.name,
        fileName: `ficha_${selectedMemberForPrint.memberCode.toLowerCase()}_${safeMember}.pdf`,
      });

      if (downloadImmediately) {
        result.doc.save(result.fileName);
        URL.revokeObjectURL(result.blobUrl);
        setExportBanner(`Ficha PDF "${result.fileName}" baixada com foto e logotipo da igreja.`);
      } else {
        if (pdfPreview?.blobUrl) URL.revokeObjectURL(pdfPreview.blobUrl);
        setPdfPreview(result);
        setShowPrintModal(false);
        setExportBanner('PDF da ficha cadastral gerado com logotipo e fotografia para revisão antes da impressão.');
      }
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handlePrintAudit = () => {
    if (!selectedMemberForPrint) return;
    syncEngine
      .logAudit({
        churchId: church.id,
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'Impressão de Ficha Individual A4',
        entityType: 'EXPORT',
        entityId: selectedMemberForPrint.id,
        details: `Ficha emitida para: ${selectedMemberForPrint.fullName} (${selectedMemberForPrint.memberCode})`,
      })
      .catch(err => console.error('Failed to log print audit:', err));
    window.print();
  };

  const exportPayload = buildReportExportPayload();
  const memberDeptNames = (m: Member) =>
    (m.departmentIds || [])
      .map(id => departments.find(d => d.id === id)?.name)
      .filter(Boolean)
      .join(', ') || 'Nenhum departamento vinculado';

  const documentId = selectedMemberForPrint
    ? `DOC-${church.exclusiveCode || 'IG'}-${selectedMemberForPrint.memberCode}-${new Date().getFullYear()}`
    : '';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Relatórios, Impressão e Exportação</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Relatórios reais filtráveis, geração de PDF com logotipo da igreja e fichas cadastrais com foto da {church.name}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isSecretary ? (
            <button
              onClick={() => setShowPreviewModal(true)}
              className="flex items-center gap-2 rounded-xl church-btn-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition"
            >
              <Download className="w-4 h-4" />
              Exportar Relatório (PDF / Excel)
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200">
              <ShieldAlert className="w-4 h-4" />
              <span>Exportação restrita à Secretaria Geral</span>
            </div>
          )}
        </div>
      </div>

      {exportBanner && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-xs font-medium text-emerald-900 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-200 print:hidden">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{exportBanner}</span>
        </div>
      )}

      {/* Report Filters */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 bg-white p-4 rounded-2xl shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-800 print:hidden">
        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Tipo de Relatório</label>
          <select
            value={reportType}
            onChange={e => setReportType(e.target.value as any)}
            className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          >
            <option value="ACTIVE">Membros Ativos</option>
            <option value="INACTIVE">Membros Inativos</option>
            <option value="BY_DEPT">Membros por Departamento</option>
            <option value="BIRTHDAYS">Aniversariantes do Mês</option>
            <option value="NEW">Novos Membros</option>
            <option value="BAPTISMS">Batismos Registrados</option>
            <option value="TRANSFERS">Transferências Departamentais</option>
            <option value="HISTORY">Histórico de Alterações (Auditoria)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Departamento</label>
          <select
            value={deptFilter}
            onChange={e => setDeptFilter(e.target.value)}
            className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          >
            <option value="ALL">Todos os Departamentos</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Data Inicial</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Data Final</label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
        </div>

        <div className="flex items-end">
          <button
            onClick={() => setShowPreviewModal(true)}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-200 transition dark:bg-gray-800 dark:text-gray-200"
          >
            <Eye className="w-4 h-4" />
            Pré-visualizar ({exportPayload.rows.length})
          </button>
        </div>
      </div>

      {/* Live Preview Summary Table */}
      <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-800 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">
            Resultado Atual do Relatório ({exportPayload.rows.length} registro{exportPayload.rows.length === 1 ? '' : 's'})
          </h3>
          {isSecretary && (
            <button
              type="button"
              disabled={isGeneratingPdf}
              onClick={() => handleExport('PDF_PREVIEW')}
              className="flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition dark:bg-blue-950 dark:text-blue-300 disabled:opacity-50"
            >
              <FileText className="w-3.5 h-3.5" />
              Gerar PDF antes de Imprimir
            </button>
          )}
        </div>
        <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-xl max-h-72 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 sticky top-0">
              <tr>
                {exportPayload.headers.slice(0, 6).map(h => (
                  <th key={h} className="p-3 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {exportPayload.rows.map((row, idx) => (
                <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/40">
                  {row.slice(0, 6).map((cell, cIdx) => (
                    <td key={cIdx} className="p-3 text-gray-700 dark:text-gray-300">
                      {cell || '—'}
                    </td>
                  ))}
                </tr>
              ))}
              {exportPayload.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-gray-400">
                    Nenhum registro encontrado para os filtros aplicados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ficha Individual / Impressão Section */}
      <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-800 print:hidden">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Ficha Individual do Membro (PDF com Foto & Impressão A4)</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Selecione um membro autorizado, configure os campos e gere o PDF formatado com foto e logotipo da igreja antes de imprimir.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <select
              value={selectedMemberForPrint?.id || ''}
              onChange={e => {
                const found = scopedMembers.find(m => m.id === e.target.value);
                setSelectedMemberForPrint(found || null);
              }}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            >
              <option value="">Selecione um membro...</option>
              {scopedMembers.map(m => (
                <option key={m.id} value={m.id}>
                  {m.fullName} ({m.memberCode})
                </option>
              ))}
            </select>
          </div>
          <div>
            <button
              disabled={!selectedMemberForPrint}
              onClick={() => setShowPrintModal(true)}
              className="w-full flex items-center justify-center gap-2 rounded-xl church-btn-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:opacity-50"
            >
              <Printer className="w-4 h-4" />
              Preparar Ficha / PDF
            </button>
          </div>
        </div>
      </div>

      {/* Modal Pré-visualização Exportação */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm print:static print:bg-white print:p-0">
          <div className="w-full max-w-4xl rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-900 max-h-[88vh] overflow-y-auto print:max-h-none print:shadow-none print:rounded-none">
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 pb-3">
              <div className="flex items-center gap-3">
                {church.logoUrl ? (
                  <img src={church.logoUrl} alt={church.name} className="h-12 w-12 rounded-xl object-contain border border-gray-200 bg-white p-0.5" />
                ) : (
                  <div className="h-12 w-12 rounded-xl church-gradient-bg text-white flex items-center justify-center font-bold">
                    {church.name.charAt(0)}
                  </div>
                )}
                <div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                    {REPORT_TITLES[reportType] || `Relatório (${reportType})`}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Igreja: {church.name} • Total de registros: {exportPayload.rows.length} • Emitido em{' '}
                    {new Date().toLocaleString('pt-BR')}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 print:hidden"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 border border-gray-200 rounded-xl overflow-x-auto dark:border-gray-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                  <tr>
                    {exportPayload.headers.map(h => (
                      <th key={h} className="p-3 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {exportPayload.rows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="p-3">
                          {cell || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-gray-100 dark:border-gray-800 print:hidden">
              <button
                onClick={() => setShowPreviewModal(false)}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
              >
                Fechar
              </button>
              {isSecretary && (
                <div className="flex flex-wrap gap-2.5">
                  <button
                    onClick={() => handleExport('EXCEL')}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition"
                  >
                    Baixar Excel (.csv)
                  </button>
                  <button
                    disabled={isGeneratingPdf}
                    onClick={() => handleExport('PDF_DOWNLOAD')}
                    className="rounded-xl border border-blue-700 px-4 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 transition dark:border-blue-500 dark:text-blue-300 dark:hover:bg-blue-950 disabled:opacity-50"
                  >
                    Baixar PDF (.pdf)
                  </button>
                  <button
                    disabled={isGeneratingPdf}
                    onClick={() => handleExport('PDF_PREVIEW')}
                    className="flex items-center gap-1.5 rounded-xl church-btn-primary px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-50"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    {isGeneratingPdf ? 'Gerando PDF...' : 'Gerar PDF e Imprimir'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Impressão Ficha Individual A4 */}
      {showPrintModal && selectedMemberForPrint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm print:static print:bg-white print:p-0">
          <div className="w-full max-w-3xl rounded-3xl bg-white p-8 shadow-2xl dark:bg-gray-900 max-h-[90vh] overflow-y-auto space-y-6 print:max-h-none print:shadow-none print:rounded-none">
            {/* Field selector (hidden when printing) */}
            <div className="rounded-2xl bg-gray-50 dark:bg-gray-800 p-4 border border-gray-200 dark:border-gray-700 space-y-2 print:hidden">
              <p className="text-xs font-bold text-gray-700 dark:text-gray-200">
                Selecione os campos que aparecerão na Ficha A4 / PDF:
              </p>
              <div className="flex flex-wrap gap-3 text-xs">
                {[
                  { key: 'code', label: 'Código' },
                  { key: 'birthDate', label: 'Nascimento' },
                  { key: 'maritalStatus', label: 'Estado Civil' },
                  { key: 'churchRole', label: 'Cargo' },
                  { key: 'membershipDate', label: 'Data Entrada' },
                  { key: 'baptismDate', label: 'Batismo' },
                  { key: 'departments', label: 'Departamentos' },
                  ...(isSecretary
                    ? [
                        { key: 'address', label: 'Endereço (Restrito)' },
                        { key: 'phone', label: 'Telefone (Restrito)' },
                        { key: 'email', label: 'E-mail (Restrito)' },
                      ]
                    : []),
                ].map(opt => (
                  <label key={opt.key} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={(printFields as any)[opt.key]}
                      onChange={e =>
                        setPrintFields(prev => ({
                          ...prev,
                          [opt.key]: e.target.checked,
                        }))
                      }
                      className="rounded border-gray-300 text-blue-600"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pb-4 border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-center gap-3">
                {church.logoUrl ? (
                  <img src={church.logoUrl} alt={church.name} className="h-14 w-14 rounded-xl object-contain border border-gray-200 bg-white p-0.5" />
                ) : (
                  <div className="h-12 w-12 rounded-xl church-gradient-bg text-white flex items-center justify-center font-bold">
                    {church.name.charAt(0)}
                  </div>
                )}
                <div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">{church.name}</h2>
                  <p className="text-xs text-gray-500">
                    Ficha Cadastral Oficial de Membro • Documento Nº <span className="font-mono">{documentId}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowPrintModal(false)}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 print:hidden"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-sm text-gray-800 dark:text-gray-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50 p-4 rounded-xl dark:bg-gray-800">
                <div className="flex items-center gap-4">
                  {selectedMemberForPrint.photoUrl ? (
                    <img
                      src={selectedMemberForPrint.photoUrl}
                      alt={selectedMemberForPrint.fullName}
                      className="h-24 w-20 rounded-xl object-cover border border-gray-300 bg-white shadow-xs flex-shrink-0"
                    />
                  ) : (
                    <div className="h-24 w-20 rounded-xl border border-dashed border-gray-300 bg-white dark:bg-gray-900 dark:border-gray-700 flex flex-col items-center justify-center text-gray-400 flex-shrink-0">
                      <span className="text-lg font-bold">{selectedMemberForPrint.fullName.charAt(0)}</span>
                      <span className="text-[10px]">Sem Foto</span>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-gray-400 uppercase">Nome Completo</p>
                    <p className="text-lg font-bold">{selectedMemberForPrint.fullName}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Situação: {selectedMemberForPrint.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
                    </p>
                  </div>
                </div>
                {printFields.code && (
                  <div className="sm:text-right">
                    <p className="text-xs text-gray-400 uppercase">Código</p>
                    <p className="text-lg font-mono font-bold">{selectedMemberForPrint.memberCode}</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs">
                {printFields.birthDate && (
                  <div>
                    <strong>Data de Nascimento:</strong> {formatDatePtBr(selectedMemberForPrint.birthDate)}
                  </div>
                )}
                {printFields.maritalStatus && (
                  <div>
                    <strong>Estado Civil:</strong> {translateMaritalStatus(selectedMemberForPrint.maritalStatus)}
                  </div>
                )}
                {printFields.churchRole && (
                  <div>
                    <strong>Cargo / Função:</strong> {selectedMemberForPrint.churchRole || 'Membro'}
                  </div>
                )}
                {printFields.membershipDate && (
                  <div>
                    <strong>Membro Desde:</strong> {formatDatePtBr(selectedMemberForPrint.membershipDate)}
                  </div>
                )}
                {printFields.baptismDate && (
                  <div>
                    <strong>Data de Batismo:</strong> {formatDatePtBr(selectedMemberForPrint.baptismDate)}
                  </div>
                )}
                {printFields.departments && (
                  <div className="col-span-2">
                    <strong>Departamentos:</strong> {memberDeptNames(selectedMemberForPrint)}
                  </div>
                )}
                {printFields.phone && (
                  <div>
                    <strong>Telefone:</strong> {canViewPII ? selectedMemberForPrint.phone || 'Não informado' : '••••••••'}
                  </div>
                )}
                {printFields.email && (
                  <div>
                    <strong>E-mail:</strong> {canViewPII ? selectedMemberForPrint.email || 'Não informado' : '••••••••'}
                  </div>
                )}
                {printFields.address && (
                  <div className="col-span-2">
                    <strong>Endereço:</strong>{' '}
                    {canViewPII
                      ? `${selectedMemberForPrint.address?.street || ''}, ${selectedMemberForPrint.address?.number || ''} - ${selectedMemberForPrint.address?.neighborhood || ''} - ${selectedMemberForPrint.address?.city || ''}/${selectedMemberForPrint.address?.state || ''}`
                      : '•••••••• (Restrito)'}
                  </div>
                )}
              </div>

              <div className="pt-8 text-[11px] text-gray-400 flex justify-between border-t border-dashed border-gray-200 dark:border-gray-700">
                <span>Documento emitido em {new Date().toLocaleString('pt-BR')}</span>
                <span>Responsável: {currentUser.name}</span>
              </div>
            </div>

            <div className="pt-6 flex flex-wrap justify-end gap-2.5 border-t border-gray-200 dark:border-gray-800 print:hidden">
              <button
                onClick={() => setShowPrintModal(false)}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
              >
                Fechar
              </button>
              <button
                type="button"
                disabled={isGeneratingPdf}
                onClick={() => handleGenerateMemberPdf(true)}
                className="rounded-xl border border-blue-700 px-4 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 transition dark:border-blue-500 dark:text-blue-300 disabled:opacity-50"
              >
                Baixar PDF (.pdf)
              </button>
              <button
                type="button"
                disabled={isGeneratingPdf}
                onClick={() => handleGenerateMemberPdf(false)}
                className="flex items-center gap-1.5 rounded-xl bg-indigo-700 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-800 transition disabled:opacity-50"
              >
                <FileText className="w-3.5 h-3.5" />
                {isGeneratingPdf ? 'Gerando PDF...' : 'Gerar PDF antes de Imprimir'}
              </button>
              <button
                onClick={handlePrintAudit}
                className="rounded-xl church-btn-primary px-5 py-2 text-xs font-semibold text-white shadow-md transition"
              >
                Imprimir Documento A4
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Visualização de PDF Gerado antes da Impressão */}
      {pdfPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="flex h-[88vh] w-full max-w-4xl flex-col rounded-3xl bg-white p-5 shadow-2xl dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-200 pb-3 dark:border-gray-800">
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                  Pré-visualização do PDF Oficial
                </h3>
                <p className="text-xs text-gray-500 font-mono">{pdfPreview.fileName}</p>
              </div>
              <button
                onClick={closePdfPreview}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-950">
              <iframe
                ref={pdfIframeRef}
                src={pdfPreview.blobUrl}
                title={pdfPreview.fileName}
                className="h-full w-full"
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-gray-100 pt-3 dark:border-gray-800">
              <button
                type="button"
                onClick={closePdfPreview}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => pdfPreview.doc.save(pdfPreview.fileName)}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition"
              >
                <Download className="w-3.5 h-3.5" />
                Baixar PDF
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    pdfIframeRef.current?.contentWindow?.focus();
                    pdfIframeRef.current?.contentWindow?.print();
                  } catch {
                    window.print();
                  }
                }}
                className="flex items-center gap-1.5 rounded-xl church-btn-primary px-5 py-2 text-xs font-semibold text-white transition"
              >
                <Printer className="w-3.5 h-3.5" />
                Imprimir PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
