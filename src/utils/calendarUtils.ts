import type { ChurchEvent } from '../types';

export interface CalendarDayCell {
  dateKey: string; // YYYY-MM-DD
  dayNumber: number;
  inCurrentMonth: boolean;
  isToday: boolean;
}

const MONTH_NAMES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

const WEEKDAY_NAMES_SHORT_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WEEKDAY_NAMES_LONG_PT = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
];

export const EVENT_CATEGORY_META: Record<
  ChurchEvent['category'],
  { label: string; dotColor: string }
> = {
  CULT: { label: 'Culto', dotColor: '#2563eb' },
  REUNION: { label: 'Reunião', dotColor: '#7c3aed' },
  BAPTISM: { label: 'Batismo', dotColor: '#059669' },
  SPECIAL: { label: 'Especial', dotColor: '#d97706' },
  DEPARTMENT: { label: 'Departamento', dotColor: '#0891b2' },
  ADMIN: { label: 'Administrativo', dotColor: '#475569' },
};

export function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Extracts a consistent YYYY-MM-DD local date key from an event's startDate.
 * Strings formatted as "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (without Z/offset)
 * preserve their literal calendar date without timezone shift.
 */
export function extractEventDateKey(startDate?: string): string | null {
  if (!startDate || typeof startDate !== 'string') return null;
  const trimmed = startDate.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return toLocalDateKey(parsed);
}

export function formatEventTime(startDate?: string): string {
  if (!startDate) return '';
  const match = startDate.match(/T(\d{2}:\d{2})/);
  if (match && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(startDate)) {
    return match[1];
  }
  const parsed = new Date(startDate);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function formatMonthYearLabel(year: number, monthIndex: number): string {
  const monthName = MONTH_NAMES_PT[((monthIndex % 12) + 12) % 12] || '';
  return `${monthName} de ${year}`;
}

export function formatSelectedDateHeading(dateKey: string): string {
  const [yStr, mStr, dStr] = dateKey.split('-');
  const y = Number(yStr);
  const m = Number(mStr) - 1;
  const d = Number(dStr);
  if (!y || Number.isNaN(m) || !d) return dateKey;
  const dt = new Date(y, m, d);
  const weekday = WEEKDAY_NAMES_LONG_PT[dt.getDay()] || '';
  const month = MONTH_NAMES_PT[m] || '';
  return `${weekday}, ${d} de ${month}`;
}

export function getWeekdayHeaders(): string[] {
  return WEEKDAY_NAMES_SHORT_PT;
}

export function buildMonthCalendarGrid(
  year: number,
  monthIndex: number,
  referenceToday: Date = new Date()
): CalendarDayCell[] {
  const firstDayOfMonth = new Date(year, monthIndex, 1);
  const startWeekday = firstDayOfMonth.getDay(); // 0 (Sun) - 6 (Sat)
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const totalSlots = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
  const todayKey = toLocalDateKey(referenceToday);

  const cells: CalendarDayCell[] = [];
  for (let i = 0; i < totalSlots; i++) {
    const cellDate = new Date(year, monthIndex, 1 - startWeekday + i);
    const key = toLocalDateKey(cellDate);
    cells.push({
      dateKey: key,
      dayNumber: cellDate.getDate(),
      inCurrentMonth: cellDate.getMonth() === monthIndex && cellDate.getFullYear() === year,
      isToday: key === todayKey,
    });
  }
  return cells;
}

export function groupActiveEventsByDate(events: ChurchEvent[]): Record<string, ChurchEvent[]> {
  const map: Record<string, ChurchEvent[]> = {};
  const sorted = [...events]
    .filter(ev => ev.status !== 'CANCELLED')
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

  for (const ev of sorted) {
    const key = extractEventDateKey(ev.startDate);
    if (!key) continue;
    if (!map[key]) {
      map[key] = [];
    }
    map[key].push(ev);
  }
  return map;
}

export function getEventsForMonth(
  events: ChurchEvent[],
  year: number,
  monthIndex: number
): ChurchEvent[] {
  const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  return [...events]
    .filter(ev => {
      if (ev.status === 'CANCELLED') return false;
      const key = extractEventDateKey(ev.startDate);
      return Boolean(key && key.startsWith(prefix));
    })
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
}
