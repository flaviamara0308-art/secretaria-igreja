import { describe, it, expect } from 'vitest';
import {
  parseMembersCsv,
  normalizeDateValue,
  generateMembersTemplateCsv,
  generateReportCsv,
} from '../src/utils/csvMemberUtils';
import type { Member } from '../src/types';

const existingMembers: Member[] = [
  {
    id: 'mem-1',
    churchId: 'church-1',
    fullName: 'Maria Fernanda Costa',
    memberCode: 'MEM-001',
    email: 'maria@igreja.org',
    phone: '(11) 98888-1111',
    membershipDate: '2020-01-15',
    status: 'ACTIVE',
    departmentIds: [],
    address: {
      street: 'Rua das Flores',
      number: '10',
      neighborhood: 'Centro',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01000-000',
    },
  },
];

describe('Real CSV Member Parser & Exporter', () => {
  it('normalizes Brazilian DD/MM/YYYY dates to ISO YYYY-MM-DD', () => {
    expect(normalizeDateValue('15/05/1990')).toBe('1990-05-15');
    expect(normalizeDateValue('5-2-2018')).toBe('2018-02-05');
    expect(normalizeDateValue('2024-11-10')).toBe('2024-11-10');
  });

  it('parses semicolon-delimited CSV with UTF-8 BOM and detects valid, duplicate, and invalid rows', () => {
    const csv = [
      '\uFEFFNome Completo;Codigo;Data de Nascimento;Sexo;Estado Civil;Telefone;E-mail;Cidade;Estado;Data de Entrada;Data de Batismo;Situacao',
      'João Pedro Almeida;MEM-101;12/03/1988;Masculino;Casado;(11) 97777-2222;joao@igreja.org;Campinas;SP;10/01/2021;05/08/2019;Ativo',
      'Maria Fernanda Costa;MEM-001;01/01/1980;Feminino;Solteira;(11) 96666-3333;dup@igreja.org;São Paulo;SP;10/01/2020;;Ativo',
      ';MEM-999;10/10/1995;Masculino;Solteiro;;;;;;;Ativo',
    ].join('\n');

    const result = parseMembersCsv(csv, 'church-1', existingMembers, 'São Paulo', 'SP');

    expect(result.detectedDelimiter).toBe(';');
    expect(result.rows).toHaveLength(3);

    // Row 1: completely valid real entry
    expect(result.rows[0].isValid).toBe(true);
    expect(result.rows[0].member.fullName).toBe('João Pedro Almeida');
    expect(result.rows[0].member.birthDate).toBe('1988-03-12');
    expect(result.rows[0].member.baptismDate).toBe('2019-08-05');
    expect(result.rows[0].member.gender).toBe('MALE');
    expect(result.rows[0].member.maritalStatus).toBe('MARRIED');

    // Row 2: duplicate code & duplicate name
    expect(result.rows[1].isValid).toBe(false);
    expect(result.rows[1].isDuplicateCode).toBe(true);
    expect(result.rows[1].isDuplicateName).toBe(true);

    // Row 3: missing required fullName
    expect(result.rows[2].isValid).toBe(false);
    expect(result.errorCount).toBe(2);
    expect(result.validCount).toBe(1);
  });

  it('parses comma-delimited CSV with quoted values', () => {
    const csv = [
      'Nome Completo,Telefone,Rua,Cidade,Estado',
      '"Ana Beatriz, Souza","(21) 99999-0000","Av. Central, 400",Niterói,RJ',
    ].join('\n');

    const result = parseMembersCsv(csv, 'church-2', [], 'Rio de Janeiro', 'RJ');
    expect(result.detectedDelimiter).toBe(',');
    expect(result.validCount).toBe(1);
    expect(result.rows[0].member.fullName).toBe('Ana Beatriz, Souza');
    expect(result.rows[0].member.address.street).toBe('Av. Central, 400');
    expect(result.rows[0].member.address.city).toBe('Niterói');
  });

  it('generates UTF-8 BOM Excel-compatible template and escaped report CSV', () => {
    const template = generateMembersTemplateCsv();
    expect(template.startsWith('\uFEFF')).toBe(true);
    expect(template).toContain('Nome Completo;Codigo;Data de Nascimento');

    const reportCsv = generateReportCsv(
      ['Código', 'Nome', 'Observação'],
      [['MEM-001', 'Lucas "Lider"', 'Ativo; Louvor']]
    );
    expect(reportCsv).toContain('\uFEFFCódigo;Nome;Observação');
    expect(reportCsv).toContain('"Lucas ""Lider"""');
    expect(reportCsv).toContain('"Ativo; Louvor"');
  });
});
