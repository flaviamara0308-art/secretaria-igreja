import React, { useEffect, useMemo, useState } from 'react';
import { Church, SystemReport, User, Member, Department, ChurchEvent } from '../../types';
import {
  Users,
  FolderGit2,
  Calendar,
  TrendingUp,
  HeartHandshake,
  Award,
  Cake,
  Pencil,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  ArrowUpRight,
} from 'lucide-react';
import { SecurityPolicy } from '../../services/securityPolicy';
import { syncEngine } from '../../services/syncEngine';
import {
  DashboardPanelPrefs,
  loadDashboardPrefs,
} from '../../utils/dashboardPrefs';
import {
  EVENT_CATEGORY_META,
  buildMonthCalendarGrid,
  extractEventDateKey,
  formatEventTime,
  formatMonthYearLabel,
  formatSelectedDateHeading,
  getEventsForMonth,
  getWeekdayHeaders,
  groupActiveEventsByDate,
  toLocalDateKey,
} from '../../utils/calendarUtils';

interface DashboardProps {
  church: Church;
  report: SystemReport;
  currentUser: User;
  members: Member[];
  departments: Department[];
  events?: ChurchEvent[];
  onNavigate: (tab: string) => void;
  onUpdateChurch?: (church: Church) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  church,
  report,
  currentUser,
  members,
  departments,
  events = [],
  onNavigate,
  onUpdateChurch,
}) => {
  const [birthdayFilter, setBirthdayFilter] = useState<'TODAY' | 'WEEK' | 'MONTH'>('MONTH');
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<string>('ALL');
  const [isEditingPastor, setIsEditingPastor] = useState(false);
  const [pastorInput, setPastorInput] = useState(church.pastorName || '');
  const [pastorSavedMsg, setPastorSavedMsg] = useState<string | null>(null);

  // Calendar state
  const nowDate = useMemo(() => new Date(), []);
  const [calendarCursor, setCalendarCursor] = useState<{ year: number; month: number }>({
    year: nowDate.getFullYear(),
    month: nowDate.getMonth(),
  });
  const [selectedDateKey, setSelectedDateKey] = useState<string>(toLocalDateKey(nowDate));

  // Panel visibility preferences configured in Settings
  const [cardPrefs, setCardPrefs] = useState<DashboardPanelPrefs>(() =>
    loadDashboardPrefs(church.id, currentUser.id)
  );

  useEffect(() => {
    const syncPrefs = () => {
      setCardPrefs(loadDashboardPrefs(church.id, currentUser.id));
    };
    syncPrefs();
    window.addEventListener('dashboard-prefs-updated', syncPrefs);
    window.addEventListener('storage', syncPrefs);
    return () => {
      window.removeEventListener('dashboard-prefs-updated', syncPrefs);
      window.removeEventListener('storage', syncPrefs);
    };
  }, [church.id, currentUser.id]);

  const isLeader = currentUser.role === 'DEPARTMENT_LEADER';
  const canEditChurchInfo = SecurityPolicy.canManageSettingsAndBackups(currentUser, church.id);
  const canManageAgenda = SecurityPolicy.canManageAgenda(currentUser, church.id);

  const handleSavePastorName = () => {
    const trimmed = pastorInput.trim();
    if (!trimmed || !onUpdateChurch) return;
    const previousPastor = church.pastorName || 'Não informado';
    onUpdateChurch({
      ...church,
      pastorName: trimmed,
    });
    if (trimmed !== previousPastor) {
      syncEngine.logAudit({
        churchId: church.id,
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'Alteração de Pastor Responsável',
        entityType: 'SETTINGS',
        entityId: church.id,
        details: `Pastor responsável alterado de "${previousPastor}" para "${trimmed}" por ${currentUser.name}.`,
      });
    }
    setIsEditingPastor(false);
    setPastorSavedMsg('Pastor responsável atualizado!');
    setTimeout(() => setPastorSavedMsg(null), 3000);
  };

  // Filtered departments & members according to tenant + leader permissions
  const activeDepartments = SecurityPolicy.filterVisibleDepartments(currentUser, church.id, departments);
  const visibleMembers = SecurityPolicy.filterVisibleMembers(currentUser, church.id, members);

  // Calendar grid & church agenda grouping (visible to ALL church users)
  const weekdayHeaders = useMemo(() => getWeekdayHeaders(), []);
  const calendarCells = useMemo(
    () => buildMonthCalendarGrid(calendarCursor.year, calendarCursor.month, nowDate),
    [calendarCursor.year, calendarCursor.month, nowDate]
  );
  const eventsByDate = useMemo(() => groupActiveEventsByDate(events), [events]);
  const monthEvents = useMemo(
    () => getEventsForMonth(events, calendarCursor.year, calendarCursor.month),
    [events, calendarCursor.year, calendarCursor.month]
  );
  const selectedDayEvents = eventsByDate[selectedDateKey] || [];

  const handlePrevMonth = () => {
    setCalendarCursor(prev => {
      const nextDate = new Date(prev.year, prev.month - 1, 1);
      return { year: nextDate.getFullYear(), month: nextDate.getMonth() };
    });
  };

  const handleNextMonth = () => {
    setCalendarCursor(prev => {
      const nextDate = new Date(prev.year, prev.month + 1, 1);
      return { year: nextDate.getFullYear(), month: nextDate.getMonth() };
    });
  };

  const handleJumpToday = () => {
    const current = new Date();
    setCalendarCursor({ year: current.getFullYear(), month: current.getMonth() });
    setSelectedDateKey(toLocalDateKey(current));
  };

  // Birthday calculation
  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();

  const getBirthdayCategory = (birthDateStr?: string) => {
    if (!birthDateStr) return null;
    const parts = birthDateStr.split('-');
    if (parts.length < 3) return null;
    const bMonth = parseInt(parts[1], 10);
    const bDay = parseInt(parts[2], 10);

    if (bMonth === currentMonth && bDay === currentDay) return 'TODAY';
    if (bMonth === currentMonth && Math.abs(bDay - currentDay) <= 7) return 'WEEK';
    if (bMonth === currentMonth) return 'MONTH';
    return null;
  };

  const birthdayMembers = visibleMembers.filter(m => {
    if (m.status !== 'ACTIVE') return false;
    if (selectedDeptFilter !== 'ALL' && !m.departmentIds?.includes(selectedDeptFilter)) return false;
    const cat = getBirthdayCategory(m.birthDate);
    if (birthdayFilter === 'TODAY') return cat === 'TODAY';
    if (birthdayFilter === 'WEEK') return cat === 'TODAY' || cat === 'WEEK';
    return cat !== null;
  });

  const pastorControl = (
    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
      <span className="font-semibold text-gray-500 dark:text-gray-400">Pastor Responsável:</span>
      {isEditingPastor ? (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={pastorInput}
            onChange={e => setPastorInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSavePastorName();
              } else if (e.key === 'Escape') {
                setIsEditingPastor(false);
              }
            }}
            placeholder="Nome do pastor responsável"
            className="rounded-lg border border-blue-500 bg-white px-2.5 py-1 text-xs font-semibold text-gray-900 focus:outline-none dark:bg-gray-800 dark:text-white"
            autoFocus
          />
          <button
            type="button"
            onClick={handleSavePastorName}
            className="rounded-lg bg-emerald-600 p-1.5 text-white hover:bg-emerald-700 transition"
            title="Salvar pastor responsável"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setIsEditingPastor(false);
              setPastorInput(church.pastorName || '');
            }}
            className="rounded-lg border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 transition"
            title="Cancelar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <>
          <span className="font-semibold text-gray-900 dark:text-white">
            {church.pastorName?.trim() || 'Não informado'}
          </span>
          {canEditChurchInfo && onUpdateChurch && (
            <button
              type="button"
              onClick={() => {
                setPastorInput(church.pastorName || '');
                setIsEditingPastor(true);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-100 transition dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              title="Editar nome do pastor responsável"
            >
              <Pencil className="w-3 h-3" />
              <span>Editar</span>
            </button>
          )}
          {pastorSavedMsg && (
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              {pastorSavedMsg}
            </span>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Quick Action Cards (Top of Page) */}
      {cardPrefs.showQuickActions && !isLeader ? (
        <div
          className="rounded-3xl bg-white p-5 sm:p-6 shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-800 overflow-hidden relative"
          style={{
            borderTop: '4px solid var(--church-primary)',
          }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              {church.logoUrl && (
                <img
                  src={church.logoUrl}
                  alt={church.name}
                  className="hidden sm:block h-11 w-11 rounded-xl object-contain bg-white p-1 border border-gray-200 dark:border-gray-700 shadow-xs"
                />
              )}
              <div>
                <h2 className="text-base font-extrabold text-gray-900 dark:text-white">
                  Acesso Rápido
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Acesse rapidamente as funções mais utilizadas no dia a dia da secretaria.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {pastorControl}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <button
              onClick={() => onNavigate('members')}
              className="group flex items-center gap-4 rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-gray-50/80 p-4 text-left shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all dark:border-gray-700 dark:from-gray-800/80 dark:to-gray-900"
              style={{
                borderColor: 'rgba(var(--church-primary-rgb), 0.28)',
              }}
            >
              <div
                className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl text-white shadow-lg transition-transform duration-200 group-hover:scale-105"
                style={{
                  background: 'linear-gradient(135deg, var(--church-primary) 0%, var(--church-secondary) 100%)',
                  boxShadow: '0 10px 20px -6px rgba(var(--church-primary-rgb), 0.55)',
                }}
              >
                <Users className="w-7 h-7" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-gray-900 dark:text-white text-sm">Gerenciar Membros</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Rol e cadastros</p>
              </div>
            </button>

            <button
              onClick={() => onNavigate('departments')}
              className="group flex items-center gap-4 rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-white to-indigo-50/40 p-4 text-left shadow-xs hover:border-indigo-400 hover:shadow-md hover:-translate-y-0.5 transition-all dark:border-gray-700 dark:from-gray-800/80 dark:to-gray-900"
            >
              <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-500 text-white shadow-lg shadow-indigo-600/35 transition-transform duration-200 group-hover:scale-105">
                <FolderGit2 className="w-7 h-7" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-gray-900 dark:text-white text-sm">Departamentos</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Equipes e transferências</p>
              </div>
            </button>

            <button
              onClick={() => onNavigate('agenda')}
              className="group flex items-center gap-4 rounded-2xl border border-amber-200/80 bg-gradient-to-br from-white to-amber-50/40 p-4 text-left shadow-xs hover:border-amber-400 hover:shadow-md hover:-translate-y-0.5 transition-all dark:border-gray-700 dark:from-gray-800/80 dark:to-gray-900"
            >
              <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/35 transition-transform duration-200 group-hover:scale-105">
                <Calendar className="w-7 h-7" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-gray-900 dark:text-white text-sm">Agenda da Igreja</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Cultos e programações</p>
              </div>
            </button>

            <button
              onClick={() => onNavigate('reports')}
              className="group flex items-center gap-4 rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-white to-emerald-50/40 p-4 text-left shadow-xs hover:border-emerald-400 hover:shadow-md hover:-translate-y-0.5 transition-all dark:border-gray-700 dark:from-gray-800/80 dark:to-gray-900"
            >
              <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-500 text-white shadow-lg shadow-emerald-600/35 transition-transform duration-200 group-hover:scale-105">
                <TrendingUp className="w-7 h-7" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-gray-900 dark:text-white text-sm">Relatórios Oficiais</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Estatísticas e dados</p>
              </div>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-5 py-3 shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-800">
          {pastorControl}
        </div>
      )}

      {/* Stats Grid */}
      {cardPrefs.showStats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div
            onClick={() => onNavigate('members')}
            className="cursor-pointer rounded-2xl bg-white p-6 shadow-sm border border-gray-100 hover:shadow-md transition dark:bg-gray-900 dark:border-gray-800"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Membros Ativos</p>
                <h3 className="mt-2 text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{report.activeMembers}</h3>
              </div>
              <div className="rounded-xl p-3 border church-soft-badge">
                <Users className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs church-accent-text font-medium">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Rol geral atualizado</span>
            </div>
          </div>

          <div
            onClick={() => onNavigate('departments')}
            className="cursor-pointer rounded-2xl bg-white p-6 shadow-sm border border-gray-100 hover:shadow-md transition dark:bg-gray-900 dark:border-gray-800"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Departamentos</p>
                <h3 className="mt-2 text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{activeDepartments.length}</h3>
              </div>
              <div className="rounded-xl bg-indigo-50 p-3 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
                <FolderGit2 className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400 font-medium">
              <HeartHandshake className="w-3.5 h-3.5" />
              <span>Ministérios e equipes</span>
            </div>
          </div>

          <div
            onClick={() => onNavigate('agenda')}
            className="cursor-pointer rounded-2xl bg-white p-6 shadow-sm border border-gray-100 hover:shadow-md transition dark:bg-gray-900 dark:border-gray-800"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Eventos do Mês</p>
                <h3 className="mt-2 text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{report.totalEventsThisMonth}</h3>
              </div>
              <div className="rounded-xl bg-emerald-50 p-3 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                <Calendar className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              <span>Cultos e programações</span>
            </div>
          </div>

          <div
            onClick={() => onNavigate('reports')}
            className="cursor-pointer rounded-2xl bg-white p-6 shadow-sm border border-gray-100 hover:shadow-md transition dark:bg-gray-900 dark:border-gray-800"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Batismos no Ano</p>
                <h3 className="mt-2 text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{report.baptismsThisYear}</h3>
              </div>
              <div className="rounded-xl bg-amber-50 p-3 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
                <Award className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 font-medium">
              <span>Vidas reconciliadas</span>
            </div>
          </div>
        </div>
      )}

      {/* Calendário da Agenda da Igreja (Visível para todos os usuários da igreja) */}
      {cardPrefs.showCalendar && (
        <section
          aria-label="Calendário da Agenda da Igreja"
          className="rounded-2xl bg-white p-5 sm:p-6 shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-800"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-5 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-3">
              <div className="rounded-xl p-3 border church-soft-badge">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                  Agenda e Calendário da Igreja
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Cultos, reuniões e programações abertas para visualização de toda a equipe e membros.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center rounded-xl border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-800">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  aria-label="Mês anterior"
                  className="rounded-lg p-1.5 text-gray-600 hover:bg-white hover:text-gray-900 transition dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-3 text-xs font-bold text-gray-800 dark:text-gray-100 whitespace-nowrap tabular-nums min-w-[132px] text-center">
                  {formatMonthYearLabel(calendarCursor.year, calendarCursor.month)}
                </span>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  aria-label="Próximo mês"
                  className="rounded-lg p-1.5 text-gray-600 hover:bg-white hover:text-gray-900 transition dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleJumpToday}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition whitespace-nowrap dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                Hoje
              </button>

              <button
                type="button"
                onClick={() => onNavigate('agenda')}
                className="inline-flex items-center gap-1.5 rounded-xl church-btn-primary px-3.5 py-2 text-xs font-semibold text-white transition whitespace-nowrap"
              >
                <span>Ver Agenda Completa</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Grade Mensal Interativa */}
            <div className="lg:col-span-7">
              <div className="grid grid-cols-7 gap-1.5 text-center mb-2">
                {weekdayHeaders.map(dayLabel => (
                  <div
                    key={dayLabel}
                    className="py-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400"
                  >
                    {dayLabel}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {calendarCells.map(cell => {
                  const dayEvents = eventsByDate[cell.dateKey] || [];
                  const isSelected = cell.dateKey === selectedDateKey;
                  const visibleDots = dayEvents.slice(0, 3);
                  const extraCount = dayEvents.length - visibleDots.length;

                  return (
                    <button
                      key={cell.dateKey}
                      type="button"
                      onClick={() => {
                        setSelectedDateKey(cell.dateKey);
                        if (!cell.inCurrentMonth) {
                          const [yStr, mStr] = cell.dateKey.split('-');
                          setCalendarCursor({
                            year: Number(yStr),
                            month: Number(mStr) - 1,
                          });
                        }
                      }}
                      aria-label={`${cell.dayNumber} — ${dayEvents.length} evento${dayEvents.length === 1 ? '' : 's'}`}
                      aria-pressed={isSelected}
                      className={`group relative flex min-h-[54px] sm:min-h-[64px] flex-col items-start justify-between rounded-xl border p-2 text-left transition ${
                        isSelected
                          ? 'shadow-xs'
                          : cell.inCurrentMonth
                          ? 'border-gray-200/80 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800/70'
                          : 'border-transparent bg-gray-50/60 text-gray-400 hover:bg-gray-100/70 dark:bg-gray-950/40 dark:text-gray-600 dark:hover:bg-gray-800/40'
                      }`}
                      style={
                        isSelected
                          ? {
                              backgroundColor: 'var(--church-soft-bg)',
                              borderColor: 'var(--church-primary)',
                            }
                          : undefined
                      }
                    >
                      <div className="flex w-full items-center justify-between">
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold tabular-nums ${
                            cell.isToday
                              ? 'church-gradient-bg text-white'
                              : isSelected
                              ? 'church-accent-text'
                              : cell.inCurrentMonth
                              ? 'text-gray-800 dark:text-gray-200'
                              : 'text-gray-400 dark:text-gray-600'
                          }`}
                        >
                          {cell.dayNumber}
                        </span>
                        {dayEvents.length > 0 && (
                          <span className="text-[10px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">
                            {dayEvents.length}
                          </span>
                        )}
                      </div>

                      {dayEvents.length > 0 && (
                        <div className="mt-1 flex w-full items-center gap-1">
                          {visibleDots.map(ev => {
                            const meta = EVENT_CATEGORY_META[ev.category] || EVENT_CATEGORY_META.CULT;
                            return (
                              <span
                                key={ev.id}
                                className="h-1.5 flex-1 rounded-full max-w-[14px]"
                                style={{ backgroundColor: meta.dotColor }}
                                title={ev.title}
                              />
                            );
                          })}
                          {extraCount > 0 && (
                            <span className="text-[9px] font-bold tabular-nums text-gray-500 dark:text-gray-400">
                              +{extraCount}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Painel do Dia Selecionado & Próximos Eventos do Mês */}
            <div className="lg:col-span-5 flex flex-col justify-between gap-5 lg:border-l lg:border-gray-100 lg:pl-6 dark:lg:border-gray-800">
              <div>
                <div className="flex items-baseline justify-between gap-2 pb-3 border-b border-gray-100 dark:border-gray-800">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                    {formatSelectedDateHeading(selectedDateKey)}
                  </h3>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">
                    {selectedDayEvents.length === 0
                      ? 'Sem eventos'
                      : `${selectedDayEvents.length} evento${selectedDayEvents.length === 1 ? '' : 's'}`}
                  </span>
                </div>

                {selectedDayEvents.length > 0 ? (
                  <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
                    {selectedDayEvents.map(ev => {
                      const meta = EVENT_CATEGORY_META[ev.category] || EVENT_CATEGORY_META.CULT;
                      const timeStr = formatEventTime(ev.startDate);
                      return (
                        <li key={ev.id} className="py-3 first:pt-1 last:pb-1">
                          <div className="flex items-start gap-2.5">
                            <span
                              className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full"
                              style={{ backgroundColor: meta.dotColor }}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold text-gray-900 dark:text-white truncate">
                                {ev.title}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                                <span>{meta.label}</span>
                                {timeStr && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="inline-flex items-center gap-1 tabular-nums">
                                      <Clock className="w-3 h-3" />
                                      {timeStr}
                                    </span>
                                  </>
                                )}
                                {ev.location && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="inline-flex items-center gap-1 truncate">
                                      <MapPin className="w-3 h-3 flex-shrink-0" />
                                      {ev.location}
                                    </span>
                                  </>
                                )}
                              </div>
                              {ev.description && (
                                <p className="mt-1 text-xs text-gray-600 dark:text-gray-300 line-clamp-2">
                                  {ev.description}
                                </p>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="mt-3 py-4 text-xs text-gray-500 dark:text-gray-400">
                    Nenhuma programação cadastrada para esta data.
                  </div>
                )}
              </div>

              {/* Resumo dos Eventos do Mês */}
              <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300">
                    Programação de {formatMonthYearLabel(calendarCursor.year, calendarCursor.month)}
                  </h4>
                  <span className="text-[11px] font-mono tabular-nums text-gray-500 dark:text-gray-400">
                    {monthEvents.length} no mês
                  </span>
                </div>

                {monthEvents.length > 0 ? (
                  <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                    {monthEvents.slice(0, 6).map(ev => {
                      const evKey = extractEventDateKey(ev.startDate) || '';
                      const dayNum = evKey ? evKey.slice(8, 10) : '--';
                      const monthNum = evKey ? evKey.slice(5, 7) : '--';
                      const timeStr = formatEventTime(ev.startDate);
                      const meta = EVENT_CATEGORY_META[ev.category] || EVENT_CATEGORY_META.CULT;

                      return (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={() => evKey && setSelectedDateKey(evKey)}
                          className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs transition ${
                            evKey === selectedDateKey
                              ? 'church-soft-badge'
                              : 'hover:bg-gray-50 text-gray-700 dark:text-gray-300 dark:hover:bg-gray-800/70'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="font-mono text-[11px] font-bold tabular-nums text-gray-500 dark:text-gray-400 flex-shrink-0">
                              {dayNum}/{monthNum}
                            </span>
                            <span
                              className="h-2 w-2 flex-shrink-0 rounded-full"
                              style={{ backgroundColor: meta.dotColor }}
                            />
                            <span className="font-semibold text-gray-900 dark:text-white truncate">
                              {ev.title}
                            </span>
                          </div>
                          <span className="font-mono text-[11px] tabular-nums text-gray-500 dark:text-gray-400 flex-shrink-0">
                            {timeStr || meta.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-3 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between gap-2">
                    <span>Sem eventos registrados neste mês.</span>
                    {canManageAgenda && (
                      <button
                        type="button"
                        onClick={() => onNavigate('agenda')}
                        className="font-semibold church-accent-text hover:underline whitespace-nowrap"
                      >
                        Cadastrar Evento
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Módulo de Aniversariantes */}
      {cardPrefs.showBirthdays && (
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-800">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-pink-50 p-3 text-pink-600 dark:bg-pink-950 dark:text-pink-400">
                <Cake className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Aniversariantes</h2>
                <p className="text-xs text-gray-500">Parabenize os irmãos que celebram nova idade.</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <select
                value={selectedDeptFilter}
                onChange={e => setSelectedDeptFilter(e.target.value)}
                className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              >
                <option value="ALL">Todos os Departamentos</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>

              <div className="flex rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
                <button
                  onClick={() => setBirthdayFilter('TODAY')}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${birthdayFilter === 'TODAY' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white' : 'text-gray-500'}`}
                >
                  Hoje
                </button>
                <button
                  onClick={() => setBirthdayFilter('WEEK')}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${birthdayFilter === 'WEEK' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white' : 'text-gray-500'}`}
                >
                  Esta Semana
                </button>
                <button
                  onClick={() => setBirthdayFilter('MONTH')}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${birthdayFilter === 'MONTH' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white' : 'text-gray-500'}`}
                >
                  Este Mês
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {birthdayMembers.map(m => (
              <div key={m.id} className="flex items-center justify-between p-4 rounded-xl border border-gray-100 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-800/50">
                <div>
                  <h4 className="font-bold text-gray-900 dark:text-white text-sm">{m.fullName}</h4>
                  <p className="text-xs text-gray-500 mt-0.5">Nascimento: {m.birthDate || 'Data não informada'}</p>
                </div>
                <span className="rounded-full bg-pink-100 px-2.5 py-1 text-[10px] font-semibold text-pink-700 dark:bg-pink-950 dark:text-pink-300">
                  🎂 Aniversário
                </span>
              </div>
            ))}
            {birthdayMembers.length === 0 && (
              <p className="col-span-full text-center text-xs text-gray-400 py-8">Nenhum aniversariante encontrado para o período selecionado.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
