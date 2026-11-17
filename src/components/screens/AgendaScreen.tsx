import React, { useState } from 'react';
import { Church, ChurchEvent, User, AppNotification } from '../../types';
import { StorageService } from '../../services/storage';
import { SecurityPolicy } from '../../services/securityPolicy';
import { Calendar as CalendarIcon, Clock, MapPin, Plus, Bell, Mail, Smartphone, CheckCircle2, AlertTriangle, Edit3 } from 'lucide-react';

interface AgendaScreenProps {
  church: Church;
  events: ChurchEvent[];
  currentUser: User;
  onSaveEvent: (event: ChurchEvent) => void;
}

export const AgendaScreen: React.FC<AgendaScreenProps> = ({ church, events, currentUser, onSaveEvent }) => {
  const [viewMode, setViewMode] = useState<'MONTH' | 'WEEK' | 'DAY'>('MONTH');
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ChurchEvent | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<'CULT' | 'REUNION' | 'BAPTISM' | 'SPECIAL' | 'DEPARTMENT' | 'ADMIN'>('CULT');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 16));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 16));
  const [location, setLocation] = useState('Templo Principal');
  const [organizer, setOrganizer] = useState(currentUser.name);
  const [reminderMinutesBefore, setReminderMinutesBefore] = useState(60);

  const isSecretary = SecurityPolicy.canManageAgenda(currentUser, church.id);

  const handleOpenNew = () => {
    setEditingEvent(null);
    setTitle('');
    setDescription('');
    setCategory('CULT');
    setStartDate(new Date().toISOString().slice(0, 16));
    setEndDate(new Date().toISOString().slice(0, 16));
    setLocation('Templo Principal');
    setOrganizer(currentUser.name);
    setShowEventModal(true);
  };

  const handleOpenEdit = (ev: ChurchEvent) => {
    setEditingEvent(ev);
    setTitle(ev.title);
    setDescription(ev.description);
    setCategory(ev.category);
    setStartDate(ev.startDate);
    setEndDate(ev.endDate);
    setLocation(ev.location);
    setOrganizer(ev.organizer);
    setReminderMinutesBefore(ev.reminderMinutesBefore || 60);
    setShowEventModal(true);
  };

  const handleSaveEventSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title) return;

    const eventToSave: ChurchEvent = {
      id: editingEvent ? editingEvent.id : `ev-${Date.now()}`,
      churchId: church.id,
      title,
      description,
      category,
      startDate,
      endDate,
      location,
      organizer,
      reminderMinutesBefore,
      status: 'SCHEDULED',
    };

    onSaveEvent(eventToSave);

    // Automatically notify users
    const notification: AppNotification = {
      id: `notif-${Date.now()}`,
      churchId: church.id,
      userId: 'all',
      title: editingEvent ? `Evento Atualizado: ${title}` : `Novo Evento: ${title}`,
      message: `Data: ${new Date(startDate).toLocaleString('pt-BR')} | Local: ${location}`,
      date: new Date().toLocaleString('pt-BR'),
      read: false,
      type: 'EVENT',
    };
    StorageService.saveNotification(notification);

    setShowEventModal(false);
  };

  const handleCancelEvent = (ev: ChurchEvent) => {
    const cancelledEvent: ChurchEvent = {
      ...ev,
      status: 'CANCELLED',
    };
    onSaveEvent(cancelledEvent);

    const notification: AppNotification = {
      id: `notif-${Date.now()}`,
      churchId: church.id,
      userId: 'all',
      title: `⚠️ Evento Cancelado: ${ev.title}`,
      message: `O evento agendado para ${new Date(ev.startDate).toLocaleString('pt-BR')} foi cancelado.`,
      date: new Date().toLocaleString('pt-BR'),
      read: false,
      type: 'EVENT',
    };
    StorageService.saveNotification(notification);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Agenda e Eventos da Igreja</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Calendário oficial de cultos, reuniões e atividades da {church.name}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
            <button
              onClick={() => setViewMode('MONTH')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${viewMode === 'MONTH' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white' : 'text-gray-500'}`}
            >
              Mês
            </button>
            <button
              onClick={() => setViewMode('WEEK')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${viewMode === 'WEEK' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white' : 'text-gray-500'}`}
            >
              Semana
            </button>
            <button
              onClick={() => setViewMode('DAY')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${viewMode === 'DAY' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white' : 'text-gray-500'}`}
            >
              Dia
            </button>
          </div>

          {isSecretary && (
            <button
              onClick={handleOpenNew}
              className="flex items-center gap-2 rounded-xl church-btn-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition"
            >
              <Plus className="w-4 h-4" />
              Novo Evento
            </button>
          )}
        </div>
      </div>

      {/* Events Grid / Calendar View */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {events.map(ev => (
          <div 
            key={ev.id}
            className={`rounded-2xl bg-white p-5 shadow-sm border transition flex flex-col justify-between dark:bg-gray-900 ${
              ev.status === 'CANCELLED' ? 'border-rose-200 bg-rose-50/20 opacity-70 dark:border-rose-900' : 'border-gray-100 dark:border-gray-800 hover:shadow-md'
            }`}
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  {ev.category}
                </span>
                {ev.status === 'CANCELLED' && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                    Cancelado
                  </span>
                )}
              </div>

              <h3 className="mt-3 font-bold text-gray-900 dark:text-white text-base">{ev.title}</h3>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{ev.description}</p>

              <div className="mt-4 space-y-2 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 pt-4 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gray-400" />
                  <span>{new Date(ev.startDate).toLocaleString('pt-BR')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-gray-400" />
                  <span>{ev.location}</span>
                </div>
              </div>
            </div>

            {isSecretary && ev.status !== 'CANCELLED' && (
              <div className="mt-5 pt-3 border-t border-gray-100 dark:border-gray-800 flex justify-between items-center">
                <button
                  onClick={() => handleOpenEdit(ev)}
                  className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Editar
                </button>
                <button
                  onClick={() => handleCancelEvent(ev)}
                  className="text-xs font-semibold text-rose-600 hover:underline"
                >
                  Cancelar Evento
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Modal Cadastro / Edição de Evento */}
      {showEventModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-900 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">
              {editingEvent ? 'Editar Evento' : 'Novo Evento na Agenda'}
            </h3>
            <p className="text-xs text-gray-500 mt-1">Cadastre culto, reunião ou evento especial. Notificações automáticas serão enviadas.</p>

            <form onSubmit={handleSaveEventSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Título do Evento *</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Ex: Culto de Celebração"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Descrição</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Detalhes sobre a programação..."
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Categoria</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value as any)}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  >
                    <option value="CULT">Culto</option>
                    <option value="REUNION">Reunião</option>
                    <option value="BAPTISM">Batismo</option>
                    <option value="SPECIAL">Especial</option>
                    <option value="DEPARTMENT">Departamento</option>
                    <option value="ADMIN">Administrativo</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Local</label>
                  <input
                    type="text"
                    value={location}
                    onChange={e => setLocation(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Início</label>
                  <input
                    type="datetime-local"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Término</label>
                  <input
                    type="datetime-local"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Configurar Lembrete (minutos antes)</label>
                <select
                  value={reminderMinutesBefore}
                  onChange={e => setReminderMinutesBefore(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                >
                  <option value={30}>30 minutos antes</option>
                  <option value={60}>1 hora antes</option>
                  <option value={1440}>1 dia antes</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowEventModal(false)}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl church-btn-primary px-5 py-2 text-xs font-semibold text-white transition"
                >
                  Salvar e Notificar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
