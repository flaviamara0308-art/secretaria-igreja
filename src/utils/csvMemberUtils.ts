import { Member } from '../types';

export interface ParsedMemberRow {
  rowIndex: number;
  member: Member;
  isValid: boolean;
  isDuplicateCode: boolean;
  isDuplicateName: boolean;
  errors: string[];
}

export interface CsvParseSummary {
  rows: ParsedMemberRow[];
  validCount: number;
  duplicateCount: number;
  errorCount: number;
  detectedDelimiter: string;
}

function normalizeHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Converts DD/MM/YYYY or DD-MM-YYYY to ISO YYYY-MM-DD when possible.
 * Preserves already-valid YYYY-MM-DD strings.
 */
export function normalizeDateValue(raw?: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const brMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (brMatch) {
    const day = brMatch[1].padStart(2, '0');
    const month = brMatch[2].padStart(2, '0');
    const year = brMatch[3];
    return `${year}-${month}-${day}`;
  }

  return trimmed;
}

function detectDelimiter(headerLine: string): string {
  const semiCount = (headerLine.match(/;/g) || []).length;
  const commaCount = (headerLine.match(/,/g) || []).length;
  const tabCount = (headerLine.match(/\t/g) || []).length;
  if (tabCount > semiCount && tabCount > commaCount) return '\t';
  return semiCount >= commaCount ? ';' : ',';
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function mapGender(raw?: string): 'MALE' | 'FEMALE' {
  const val = normalizeHeader(raw || '');
  if (val.startsWith('f') || val === 'mulher') return 'FEMALE';
  return 'MALE';
}

function mapMaritalStatus(raw?: string): 'SINGLE' | 'MARRIED' | 'WIDOWED' | 'DIVORCED' {
  const val = normalizeHeader(raw || '');
  if (val.includes('casad') || val === 'married') return 'MARRIED';
  if (val.includes('viuv') || val === 'widowed') return 'WIDOWED';
  if (val.includes('divor') || val.includes('separad') || val === 'divorced') return 'DIVORCED';
  return 'SINGLE';
}

function mapStatus(raw?: string): 'ACTIVE' | 'INACTIVE' {
  const val = normalizeHeader(raw || '');
  if (val.includes('inativ') || val === 'inactive' || val === 'desligado' || val === 'transferido') {
    return 'INACTIVE';
  }
  return 'ACTIVE';
}

export function parseMembersCsv(
  csvText: string,
  churchId: string,
  existingMembers: Member[],
  defaultCity = '',
  defaultState = 'SP'
): CsvParseSummary {
  const cleaned = csvText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = cleaned.split('\n').filter(l => l.trim().length > 0);

  if (rawLines.length < 2) {
    return {
      rows: [],
      validCount: 0,
      duplicateCount: 0,
      errorCount: 0,
      detectedDelimiter: ';',
    };
  }

  const delimiter = detectDelimiter(rawLines[0]);
  const headers = parseCsvLine(rawLines[0], delimiter).map(normalizeHeader);

  const colIndex = (...aliases: string[]): number => {
    for (const alias of aliases) {
      const idx = headers.findIndex(h => h === alias || h.includes(alias));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const idxName = colIndex('nomecompleto', 'fullname', 'nome', 'membro');
  const idxCode = colIndex('codigodomembro', 'codigo', 'membercode', 'matricula');
  const idxBirth = colIndex('datadenascimento', 'nascimento', 'birthdate', 'dtnasc');
  const idxGender = colIndex('sexo', 'genero', 'gender');
  const idxMarital = colIndex('estadocivil', 'maritalstatus');
  const idxSpouse = colIndex('conjuge', 'spouse');
  const idxMother = colIndex('nomedamae', 'mae', 'mothername');
  const idxFather = colIndex('nomedopai', 'pai', 'fathername');
  const idxBirthplace = colIndex('naturalidade', 'birthplace');
  const idxNationality = colIndex('nacionalidade', 'nationality');
  const idxProfession = colIndex('profissao', 'profession');
  const idxEducation = colIndex('escolaridade', 'educationlevel');
  const idxPhone = colIndex('telefone', 'whatsapp', 'celular', 'fone', 'phone');
  const idxEmail = colIndex('email', 'correioeletronico');
  const idxStreet = colIndex('rua', 'logradouro', 'endereco', 'street');
  const idxNumber = colIndex('numero', 'num', 'number');
  const idxComplement = colIndex('complemento', 'complement');
  const idxNeighborhood = colIndex('bairro', 'neighborhood');
  const idxCity = colIndex('cidade', 'municipio', 'city');
  const idxState = colIndex('estado', 'uf', 'state');
  const idxZip = colIndex('cep', 'zipcode');
  const idxMembership = colIndex('datadeentrada', 'entrada', 'membresia', 'membershipdate');
  const idxBaptism = colIndex('datadebatismo', 'batismo', 'baptismdate');
  const idxRole = colIndex('cargo', 'funcao', 'churchrole');
  const idxStatus = colIndex('situacao', 'status');
  const idxNotes = colIndex('observacoes', 'obs', 'notes');

  const existingCodes = new Set(
    existingMembers.filter(m => m.churchId === churchId).map(m => m.memberCode.trim().toLowerCase())
  );
  const existingNames = new Set(
    existingMembers.filter(m => m.churchId === churchId).map(m => m.fullName.trim().toLowerCase())
  );

  const seenCodesInFile = new Set<string>();
  const seenNamesInFile = new Set<string>();
  const baseTimestamp = Date.now();
  const rows: ParsedMemberRow[] = [];

  for (let i = 1; i < rawLines.length; i++) {
    const cells = parseCsvLine(rawLines[i], delimiter);
    const getCell = (idx: number) => (idx >= 0 && idx < cells.length ? cells[idx].trim() : '');

    const fullName = getCell(idxName);
    const rawCode = getCell(idxCode);
    const generatedCode = rawCode || `MEM-${String(existingMembers.length + i).padStart(4, '0')}`;
    const errors: string[] = [];

    if (!fullName || fullName.length < 2) {
      errors.push('Nome completo obrigatório (mín. 2 caracteres)');
    }

    const codeLower = generatedCode.toLowerCase();
    const nameLower = fullName.toLowerCase();

    const isDuplicateCode =
      Boolean(rawCode) && (existingCodes.has(codeLower) || seenCodesInFile.has(codeLower));
    if (isDuplicateCode) {
      errors.push(`Código "${generatedCode}" já cadastrado`);
    }

    const isDuplicateName =
      Boolean(fullName) && (existingNames.has(nameLower) || seenNamesInFile.has(nameLower));

    if (rawCode) seenCodesInFile.add(codeLower);
    if (fullName) seenNamesInFile.add(nameLower);

    const member: Member = {
      id: `mem-${baseTimestamp}-${i}`,
      churchId,
      fullName,
      memberCode: generatedCode,
      birthDate: normalizeDateValue(getCell(idxBirth)),
      gender: mapGender(getCell(idxGender)),
      maritalStatus: mapMaritalStatus(getCell(idxMarital)),
      spouse: getCell(idxSpouse),
      motherName: getCell(idxMother),
      fatherName: getCell(idxFather),
      birthplace: getCell(idxBirthplace),
      nationality: getCell(idxNationality) || 'Brasileira',
      profession: getCell(idxProfession),
      educationLevel: getCell(idxEducation),
      address: {
        street: getCell(idxStreet),
        number: getCell(idxNumber),
        complement: getCell(idxComplement),
        neighborhood: getCell(idxNeighborhood),
        city: getCell(idxCity) || defaultCity,
        state: getCell(idxState) || defaultState,
        zipCode: getCell(idxZip),
      },
      phone: getCell(idxPhone),
      email: getCell(idxEmail),
      membershipDate: normalizeDateValue(getCell(idxMembership)) || new Date().toISOString().split('T')[0],
      baptismDate: normalizeDateValue(getCell(idxBaptism)),
      churchRole: getCell(idxRole) || 'Membro',
      departmentIds: [],
      notes: getCell(idxNotes),
      status: mapStatus(getCell(idxStatus)),
      history: [
        {
          date: new Date().toLocaleDateString('pt-BR'),
          action: 'Importação via Planilha CSV',
          author: 'Secretaria',
        },
      ],
      updatedAt: new Date().toISOString(),
    };

    rows.push({
      rowIndex: i + 1,
      member,
      isValid: errors.length === 0,
      isDuplicateCode,
      isDuplicateName,
      errors,
    });
  }

  return {
    rows,
    validCount: rows.filter(r => r.isValid).length,
    duplicateCount: rows.filter(r => r.isDuplicateCode || r.isDuplicateName).length,
    errorCount: rows.filter(r => !r.isValid).length,
    detectedDelimiter: delimiter,
  };
}

export function generateMembersTemplateCsv(): string {
  const headers = [
    'Nome Completo',
    'Codigo',
    'Data de Nascimento',
    'Sexo',
    'Estado Civil',
    'Conjuge',
    'Nome da Mae',
    'Nome do Pai',
    'Naturalidade',
    'Nacionalidade',
    'Profissao',
    'Escolaridade',
    'Telefone',
    'E-mail',
    'Rua',
    'Numero',
    'Complemento',
    'Bairro',
    'Cidade',
    'Estado',
    'CEP',
    'Data de Entrada',
    'Data de Batismo',
    'Cargo',
    'Situacao',
    'Observacoes',
  ];
  const exampleHint = [
    'Exemplo: Maria da Silva',
    'MEM-1001',
    '15/05/1990',
    'Feminino',
    'Casada',
    'João da Silva',
    'Ana da Silva',
    'José da Silva',
    'São Paulo - SP',
    'Brasileira',
    'Professora',
    'Ensino Superior',
    '(11) 99999-0000',
    'maria@exemplo.org',
    'Rua Exemplo',
    '100',
    'Casa',
    'Centro',
    'São Paulo',
    'SP',
    '01000-000',
    '10/01/2020',
    '12/06/2018',
    'Membro',
    'Ativo',
    'Substitua esta linha pelos dados reais da sua igreja',
  ];
  return '\uFEFF' + headers.join(';') + '\n' + exampleHint.join(';') + '\n';
}

function escapeCsvCell(value: string | number | undefined | null): string {
  const str = value === undefined || value === null ? '' : String(value);
  if (str.includes(';') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateReportCsv(headers: string[], rows: Array<Array<string | number | undefined | null>>): string {
  const headerLine = headers.map(escapeCsvCell).join(';');
  const bodyLines = rows.map(r => r.map(escapeCsvCell).join(';'));
  return '\uFEFF' + [headerLine, ...bodyLines].join('\n');
}

export function triggerCsvDownload(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
