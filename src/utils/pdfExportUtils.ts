import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Church, Member } from '../types';

export interface GeneratedPdfResult {
  doc: jsPDF;
  blobUrl: string;
  fileName: string;
}

export interface MemberPrintFields {
  code: boolean;
  birthDate: boolean;
  maritalStatus: boolean;
  address: boolean;
  phone: boolean;
  email: boolean;
  membershipDate: boolean;
  baptismDate: boolean;
  churchRole: boolean;
  departments: boolean;
}

export function formatDatePtBr(dateStr?: string): string {
  if (!dateStr) return 'Não informada';
  const clean = dateStr.trim().slice(0, 10);
  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateStr;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function translateMaritalStatus(status?: Member['maritalStatus']): string {
  switch (status) {
    case 'SINGLE':
      return 'Solteiro(a)';
    case 'MARRIED':
      return 'Casado(a)';
    case 'WIDOWED':
      return 'Viúvo(a)';
    case 'DIVORCED':
      return 'Divorciado(a)';
    default:
      return 'Não informado';
  }
}

export function translateGender(gender?: Member['gender']): string {
  if (gender === 'MALE') return 'Masculino';
  if (gender === 'FEMALE') return 'Feminino';
  return 'Não informado';
}

export async function normalizeImageForPdf(src?: string): Promise<string | null> {
  if (!src || typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  const trimmed = src.trim();
  if (!trimmed) return null;

  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timeout = window.setTimeout(() => resolve(null), 4000);

    img.onload = () => {
      window.clearTimeout(timeout);
      try {
        const maxDim = 480;
        const width = img.naturalWidth || img.width || 200;
        const height = img.naturalHeight || img.height || 200;
        const scale = Math.min(maxDim / width, maxDim / height, 1);

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => {
      window.clearTimeout(timeout);
      resolve(null);
    };

    img.src = trimmed;
  });
}

function drawHeaderMonogram(doc: jsPDF, churchName: string, x: number, y: number, size: number) {
  doc.setFillColor(30, 58, 138);
  doc.roundedRect(x, y, size, size, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  const initial = (churchName || 'I').trim().charAt(0).toUpperCase();
  doc.text(initial, x + size / 2, y + size / 2 + 2.2, { align: 'center' });
}

function applyPageFooters(doc: jsPDF, churchName: string, generatedBy: string) {
  const totalPages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const timestamp = new Date().toLocaleString('pt-BR');

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.line(14, pageHeight - 13, pageWidth - 14, pageHeight - 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`${churchName} • Emitido em ${timestamp} por ${generatedBy}`, 14, pageHeight - 8);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
  }
}

export async function generateReportPdf(params: {
  church: Church;
  reportTitle: string;
  headers: string[];
  rows: string[][];
  filterSummary?: string;
  generatedBy: string;
  fileName: string;
}): Promise<GeneratedPdfResult> {
  const { church, reportTitle, headers, rows, filterSummary, generatedBy, fileName } = params;
  const isLandscape = headers.length > 6;
  const doc = new jsPDF({
    orientation: isLandscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const logoDataUrl = await normalizeImageForPdf(church.logoUrl);

  // Institutional header background
  doc.setFillColor(248, 250, 252);
  doc.rect(0, 0, pageWidth, 36, 'F');
  doc.setDrawColor(30, 58, 138);
  doc.setLineWidth(0.6);
  doc.line(14, 36, pageWidth - 14, 36);

  if (logoDataUrl) {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(14, 7, 22, 22, 2.5, 2.5, 'FD');
    doc.addImage(logoDataUrl, 'PNG', 15, 8, 20, 20);
  } else {
    drawHeaderMonogram(doc, church.name, 14, 8, 20);
  }

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(church.name, 40, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  const churchMeta = [
    church.denomination,
    church.cnpj ? `CNPJ: ${church.cnpj}` : '',
    church.city ? `${church.city}${church.state ? `/${church.state}` : ''}` : '',
  ]
    .filter(Boolean)
    .join(' • ');
  doc.text(churchMeta || 'Secretaria Eclesiástica Oficial', 40, 19.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(30, 58, 138);
  doc.text(reportTitle, 40, 26);

  if (filterSummary) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(filterSummary, 40, 31.5);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  doc.text(`Total: ${rows.length} registro(s)`, pageWidth - 14, 14, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Código: ${church.exclusiveCode || 'IG'}`, pageWidth - 14, 19.5, { align: 'right' });

  autoTable(doc, {
    startY: 42,
    head: [headers],
    body: rows.length > 0 ? rows : [[...headers.map((_, idx) => (idx === 0 ? 'Nenhum registro encontrado.' : ''))]],
    theme: 'grid',
    margin: { left: 14, right: 14, bottom: 18 },
    headStyles: {
      fillColor: [30, 58, 138],
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      cellPadding: 2.5,
    },
    bodyStyles: {
      fontSize: 7.8,
      textColor: [30, 41, 59],
      cellPadding: 2.3,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
  });

  applyPageFooters(doc, church.name, generatedBy);

  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);

  return { doc, blobUrl, fileName };
}

export async function generateMemberSheetPdf(params: {
  church: Church;
  member: Member;
  departmentNames: string;
  documentId: string;
  printFields: MemberPrintFields;
  canViewPII: boolean;
  generatedBy: string;
  fileName: string;
}): Promise<GeneratedPdfResult> {
  const { church, member, departmentNames, documentId, printFields, canViewPII, generatedBy, fileName } = params;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const [logoDataUrl, memberPhotoUrl] = await Promise.all([
    normalizeImageForPdf(church.logoUrl),
    normalizeImageForPdf(member.photoUrl),
  ]);

  // 1. Institutional Header with Church Logo
  doc.setFillColor(248, 250, 252);
  doc.rect(0, 0, pageWidth, 38, 'F');
  doc.setDrawColor(30, 58, 138);
  doc.setLineWidth(0.7);
  doc.line(14, 38, pageWidth - 14, 38);

  if (logoDataUrl) {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(14, 7, 24, 24, 2.5, 2.5, 'FD');
    doc.addImage(logoDataUrl, 'PNG', 15, 8, 22, 22);
  } else {
    drawHeaderMonogram(doc, church.name, 14, 8, 22);
  }

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(church.name, 43, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  const metaLine = [
    church.denomination,
    church.cnpj ? `CNPJ: ${church.cnpj}` : '',
    church.city ? `${church.city}${church.state ? `/${church.state}` : ''}` : '',
  ]
    .filter(Boolean)
    .join(' • ');
  doc.text(metaLine || 'Administração Eclesiástica', 43, 19.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(30, 58, 138);
  doc.text('FICHA CADASTRAL OFICIAL DE MEMBRO', 43, 26.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Documento Nº: ${documentId}`, 43, 32);

  // 2. Member Identity Card + Photo Frame
  const cardTop = 44;
  const photoBoxW = 30;
  const photoBoxH = 36;
  const photoX = pageWidth - 14 - photoBoxW;

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.35);
  doc.roundedRect(14, cardTop, pageWidth - 28 - photoBoxW - 5, photoBoxH, 2.5, 2.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('NOME COMPLETO', 19, cardTop + 7);

  doc.setFontSize(13.5);
  doc.setTextColor(15, 23, 42);
  doc.text(member.fullName, 19, cardTop + 14.5, { maxWidth: pageWidth - 74 });

  if (printFields.code) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(30, 58, 138);
    doc.text(`Código: ${member.memberCode}`, 19, cardTop + 23);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  const statusLabel = member.status === 'ACTIVE' ? 'Ativo' : 'Inativo';
  doc.text(
    `Situação: ${statusLabel}${printFields.churchRole ? `   •   Cargo: ${member.churchRole || 'Membro'}` : ''}`,
    19,
    cardTop + 30
  );

  // Member photo box
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(148, 163, 184);
  doc.roundedRect(photoX, cardTop, photoBoxW, photoBoxH, 2, 2, 'FD');
  if (memberPhotoUrl) {
    doc.addImage(memberPhotoUrl, 'PNG', photoX + 1, cardTop + 1, photoBoxW - 2, photoBoxH - 2);
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(148, 163, 184);
    doc.text((member.fullName || 'M').charAt(0).toUpperCase(), photoX + photoBoxW / 2, cardTop + 17, {
      align: 'center',
    });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('Sem Foto', photoX + photoBoxW / 2, cardTop + 25, { align: 'center' });
  }

  // 3. Structured Member Details Table via jspdf-autotable
  const personalRows: [string, string][] = [];

  if (printFields.birthDate) {
    personalRows.push(['Data de Nascimento', formatDatePtBr(member.birthDate)]);
  }
  personalRows.push(['Sexo', translateGender(member.gender)]);
  if (printFields.maritalStatus) {
    personalRows.push(['Estado Civil', translateMaritalStatus(member.maritalStatus)]);
  }
  if (member.spouse) {
    personalRows.push(['Cônjuge', member.spouse]);
  }
  if (canViewPII && (member.motherName || member.fatherName)) {
    personalRows.push([
      'Filiação',
      [member.motherName ? `Mãe: ${member.motherName}` : '', member.fatherName ? `Pai: ${member.fatherName}` : '']
        .filter(Boolean)
        .join(' | '),
    ]);
  }
  if (member.birthplace) {
    personalRows.push(['Naturalidade', member.birthplace]);
  }
  if (member.profession) {
    personalRows.push(['Profissão', member.profession]);
  }
  if (printFields.churchRole) {
    personalRows.push(['Cargo / Função Eclesiástica', member.churchRole || 'Membro']);
  }
  if (printFields.membershipDate) {
    personalRows.push(['Membro Desde', formatDatePtBr(member.membershipDate)]);
  }
  if (printFields.baptismDate) {
    personalRows.push(['Data de Batismo', formatDatePtBr(member.baptismDate)]);
  }
  if (printFields.departments) {
    personalRows.push(['Departamentos Vinculados', departmentNames]);
  }

  autoTable(doc, {
    startY: cardTop + photoBoxH + 8,
    head: [['Dados Pessoais e Eclesiásticos', 'Informação Cadastral']],
    body: personalRows,
    theme: 'grid',
    margin: { left: 14, right: 14 },
    columnStyles: {
      0: { cellWidth: 62, fontStyle: 'bold', textColor: [51, 65, 85] },
      1: { textColor: [15, 23, 42] },
    },
    headStyles: {
      fillColor: [30, 58, 138],
      textColor: [255, 255, 255],
      fontSize: 9,
      cellPadding: 2.8,
    },
    bodyStyles: {
      fontSize: 8.5,
      cellPadding: 2.5,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
  });

  const contactRows: [string, string][] = [];
  if (printFields.phone) {
    contactRows.push(['Telefone / WhatsApp', canViewPII ? member.phone || 'Não informado' : '•••••••• (Restrito)']);
  }
  if (printFields.email) {
    contactRows.push(['E-mail', canViewPII ? member.email || 'Não informado' : '•••••••• (Restrito)']);
  }
  if (printFields.address) {
    const formattedAddress = [
      [member.address?.street, member.address?.number].filter(Boolean).join(', '),
      member.address?.complement,
      member.address?.neighborhood,
      [member.address?.city, member.address?.state].filter(Boolean).join('/'),
      member.address?.zipCode ? `CEP ${member.address.zipCode}` : '',
    ]
      .filter(Boolean)
      .join(' - ');

    contactRows.push([
      'Endereço Residencial',
      canViewPII ? formattedAddress || 'Não informado' : '•••••••• (Restrito)',
    ]);
  }

  if (contactRows.length > 0) {
    const lastY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 170;
    autoTable(doc, {
      startY: lastY + 6,
      head: [['Contato e Endereço', 'Registro']],
      body: contactRows,
      theme: 'grid',
      margin: { left: 14, right: 14 },
      columnStyles: {
        0: { cellWidth: 62, fontStyle: 'bold', textColor: [51, 65, 85] },
        1: { textColor: [15, 23, 42] },
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontSize: 9,
        cellPadding: 2.8,
      },
      bodyStyles: {
        fontSize: 8.5,
        cellPadding: 2.5,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
    });
  }

  if (canViewPII && member.notes) {
    const lastY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 210;
    autoTable(doc, {
      startY: lastY + 6,
      head: [['Observações da Secretaria']],
      body: [[member.notes]],
      theme: 'grid',
      margin: { left: 14, right: 14, bottom: 42 },
      headStyles: {
        fillColor: [71, 85, 105],
        textColor: [255, 255, 255],
        fontSize: 8.5,
        cellPadding: 2.5,
      },
      bodyStyles: {
        fontSize: 8.5,
        cellPadding: 2.8,
      },
    });
  }

  // Signature block at bottom of page
  const pageHeight = doc.internal.pageSize.getHeight();
  const sigY = pageHeight - 30;
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.35);
  doc.line(20, sigY, 92, sigY);
  doc.line(pageWidth - 92, sigY, pageWidth - 20, sigY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('Secretaria Geral', 56, sigY + 4.5, { align: 'center' });
  doc.text(
    `Pastor Responsável: ${church.pastorName?.trim() || '________________________'}`,
    pageWidth - 56,
    sigY + 4.5,
    { align: 'center' }
  );

  applyPageFooters(doc, church.name, generatedBy);

  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);

  return { doc, blobUrl, fileName };
}
