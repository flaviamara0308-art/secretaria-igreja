import React, { useState } from 'react';
import { Church, User, SupportTicket, TicketMessage, TicketCategory, TicketPriority, TicketStatus } from '../../types';
import { StorageService } from '../../services/storage';
import { FirebaseService } from '../../services/firebase';
import { syncEngine } from '../../services/syncEngine';
import { SecurityPolicy } from '../../services/securityPolicy';
import { 
  LifeBuoy, 
  PlusCircle, 
  MessageSquare, 
  Send, 
  Paperclip, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  X, 
  HelpCircle, 
  ShieldCheck, 
  Ban,
  ArrowLeft,
  Calendar,
  User as UserIcon
} from 'lucide-react';

interface ChurchSupportScreenProps {
  church: Church;
  currentUser: User;
}

export const ChurchSupportScreen: React.FC<ChurchSupportScreenProps> = ({ church, currentUser }) => {
  const [tickets, setTickets] = useState<SupportTicket[]>(StorageService.getSupportTickets(church.id));
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // New ticket form
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<TicketCategory>('DUVIDA');
  const [priority, setPriority] = useState<TicketPriority>('MEDIA');
  const [description, setDescription] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');

  // Reply in chat
  const [replyText, setReplyText] = useState('');
  const [replyAttachmentName, setReplyAttachmentName] = useState('');
  const [replyAttachmentUrl, setReplyAttachmentUrl] = useState('');

  const isSecretary = SecurityPolicy.canOpenSupportTicket(currentUser, church.id);

  const handleOpenTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSecretary) {
      alert('Acesso negado: Somente a Secretaria Geral pode abrir chamados de suporte técnico.');
      return;
    }

    const newTicket: SupportTicket = {
      id: `ticket-${Date.now()}`,
      churchId: church.id,
      churchName: church.name,
      subject,
      category,
      description,
      priority,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      createdBy: currentUser.name,
      createdById: currentUser.id,
      updatedAt: new Date().toISOString(),
      attachments: attachmentName ? [{ name: attachmentName, url: attachmentUrl, type: 'file', size: '1 MB' }] : [],
      messages: [
        {
          id: `msg-${Date.now()}`,
          ticketId: `ticket-${Date.now()}`,
          senderId: currentUser.id,
          senderName: currentUser.name,
          senderRole: currentUser.role,
          isStaff: false,
          content: description,
          createdAt: new Date().toISOString(),
          attachments: attachmentName ? [{ name: attachmentName, url: attachmentUrl, type: 'file', size: '1 MB' }] : [],
        }
      ]
    };

    StorageService.saveSupportTicket(newTicket);
    try {
      await FirebaseService.saveSupportTicket(newTicket);
    } catch (e) {
      console.warn('Saved ticket locally:', e);
    }

    await syncEngine.logAudit({
      churchId: church.id,
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'Abertura de Chamado de Suporte',
      entityType: 'SUPPORT',
      entityId: newTicket.id,
      details: `Chamado "${subject}" (${category} - Prioridade ${priority}) aberto pela Secretaria.`,
    });

    const updated = [newTicket, ...tickets];
    setTickets(updated);
    setSelectedTicket(newTicket);
    setShowNewModal(false);
    setSubject('');
    setDescription('');
    setAttachmentName('');
    setAttachmentUrl('');
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !replyText.trim()) return;

    const newMessage: TicketMessage = {
      id: `msg-${Date.now()}`,
      ticketId: selectedTicket.id,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderRole: currentUser.role,
      isStaff: false,
      content: replyText.trim(),
      createdAt: new Date().toISOString(),
      attachments: replyAttachmentName ? [{ name: replyAttachmentName, url: replyAttachmentUrl, type: 'file', size: '1 MB' }] : [],
    };

    const updatedTicket: SupportTicket = {
      ...selectedTicket,
      updatedAt: new Date().toISOString(),
      // When church replies to in_progress or waiting_response, keep active
      status: selectedTicket.status === 'WAITING_RESPONSE' ? 'IN_PROGRESS' : selectedTicket.status,
      messages: [...selectedTicket.messages, newMessage]
    };

    StorageService.saveSupportTicket(updatedTicket);
    try {
      await FirebaseService.saveSupportTicket(updatedTicket);
    } catch (e) {
      console.warn('Saved message locally:', e);
    }

    const updatedList = tickets.map(t => t.id === updatedTicket.id ? updatedTicket : t);
    setTickets(updatedList);
    setSelectedTicket(updatedTicket);
    setReplyText('');
    setReplyAttachmentName('');
    setReplyAttachmentUrl('');
  };

  const handleCancelTicket = async () => {
    if (!selectedTicket || !isSecretary) return;
    if (!confirm('Deseja realmente cancelar este chamado?')) return;

    const updatedTicket: SupportTicket = {
      ...selectedTicket,
      status: 'CANCELLED',
      updatedAt: new Date().toISOString(),
    };

    StorageService.saveSupportTicket(updatedTicket);
    try {
      await FirebaseService.saveSupportTicket(updatedTicket);
    } catch (e) {
      console.warn('Updated ticket locally:', e);
    }

    await syncEngine.logAudit({
      churchId: church.id,
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'Cancelamento de Chamado de Suporte',
      entityType: 'SUPPORT',
      entityId: selectedTicket.id,
      details: `Chamado "${selectedTicket.subject}" cancelado pela Secretaria Geral.`,
    });

    const updatedList = tickets.map(t => t.id === updatedTicket.id ? updatedTicket : t);
    setTickets(updatedList);
    setSelectedTicket(updatedTicket);
  };

  const filteredTickets = tickets.filter(t => {
    if (statusFilter === 'ALL') return true;
    return t.status === statusFilter;
  });

  const getStatusBadge = (status: TicketStatus) => {
    switch (status) {
      case 'OPEN':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">Aberto</span>;
      case 'IN_PROGRESS':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">Em Atendimento</span>;
      case 'WAITING_RESPONSE':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">Aguardando Resposta</span>;
      case 'RESOLVED':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Concluído</span>;
      case 'CANCELLED':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">Cancelado</span>;
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Central de Ajuda & Suporte Técnico</h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200">
              {church.name}
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Comunicação oficial e atendimento direto com a equipe técnica da plataforma.
          </p>
        </div>

        {isSecretary && (
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl church-btn-primary text-white font-semibold text-xs shadow-md transition"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Abrir Novo Chamado</span>
          </button>
        )}
      </div>

      {/* Privacy Notice Banner */}
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 dark:border-indigo-900/60 dark:bg-indigo-950/40 p-4 text-xs text-indigo-950 dark:text-indigo-200 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">Privacidade & Sigilo dos Dados da Igreja:</span> A equipe de suporte da plataforma atende exclusivamente a dúvidas de operação, configurações e problemas do sistema. O suporte não possui acesso aos cadastros pessoais completos dos membros da sua igreja.
        </div>
      </div>

      {/* Main View: List or Ticket Detail */}
      {selectedTicket ? (
        /* DETAIL VIEW */
        <div className="rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 overflow-hidden">
          
          {/* Ticket Header */}
          <div className="border-b border-gray-200 dark:border-gray-800 p-6 bg-gray-50/60 dark:bg-gray-950/40">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedTicket(null)}
                  className="rounded-xl p-2 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-800 transition"
                  title="Voltar à lista"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gray-500">{selectedTicket.id}</span>
                    {getStatusBadge(selectedTicket.status)}
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                      {selectedTicket.category}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      selectedTicket.priority === 'URGENTE' || selectedTicket.priority === 'ALTA'
                        ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                    }`}>
                      Prioridade: {selectedTicket.priority}
                    </span>
                  </div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white mt-1">
                    {selectedTicket.subject}
                  </h2>
                  <div className="flex items-center gap-4 text-[11px] text-gray-500 mt-1">
                    <span>Aberto por: {selectedTicket.createdBy}</span>
                    <span>Criado em: {new Date(selectedTicket.createdAt).toLocaleString('pt-BR')}</span>
                    {selectedTicket.assignedAdminName && (
                      <span className="font-semibold text-blue-600 dark:text-blue-400">
                        Atendente: {selectedTicket.assignedAdminName}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {isSecretary && selectedTicket.status !== 'RESOLVED' && selectedTicket.status !== 'CANCELLED' && (
                <button
                  onClick={handleCancelTicket}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-300 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                >
                  <Ban className="w-3.5 h-3.5 text-rose-500" />
                  <span>Cancelar Chamado</span>
                </button>
              )}
            </div>
          </div>

          {/* Messages Thread */}
          <div className="p-6 space-y-4 max-h-[500px] overflow-y-auto bg-gray-50/30 dark:bg-gray-950/20">
            {selectedTicket.messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.isStaff ? 'items-start' : 'items-end'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">
                    {msg.senderName}
                  </span>
                  {msg.isStaff ? (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                      Suporte Plataforma
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      Secretaria da Igreja
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400">
                    {new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <div
                  className={`rounded-2xl p-4 max-w-lg text-xs leading-relaxed ${
                    msg.isStaff
                      ? 'bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-900 text-gray-900 dark:text-white shadow-sm'
                      : 'church-gradient-bg text-white shadow-md'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>

                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-white/20 dark:border-gray-700 flex flex-col gap-1">
                      {msg.attachments.map((att, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-[11px] opacity-90">
                          <Paperclip className="w-3.5 h-3.5" />
                          <span>{att.name} ({att.size})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Reply Form */}
          {selectedTicket.status !== 'RESOLVED' && selectedTicket.status !== 'CANCELLED' ? (
            <form onSubmit={handleSendMessage} className="border-t border-gray-200 dark:border-gray-800 p-4 bg-white dark:bg-gray-900">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Escreva sua resposta para o suporte técnico..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  className="flex-1 rounded-2xl border border-gray-300 dark:border-gray-700 p-3 text-xs dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <button
                  type="submit"
                  disabled={!replyText.trim()}
                  className="flex items-center gap-2 px-5 py-3 rounded-2xl church-btn-primary text-white font-semibold text-xs transition disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  <span>Enviar</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="p-4 text-center text-xs text-gray-500 bg-gray-50 dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800">
              Este chamado encontra-se {selectedTicket.status === 'RESOLVED' ? 'concluído' : 'cancelado'}. Para novas solicitações, abra um novo chamado.
            </div>
          )}

        </div>
      ) : (
        /* LIST VIEW */
        <div className="space-y-4">
          
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'ALL', label: 'Todos os Status' },
              { id: 'OPEN', label: 'Abertos' },
              { id: 'IN_PROGRESS', label: 'Em Atendimento' },
              { id: 'WAITING_RESPONSE', label: 'Aguardando Resposta' },
              { id: 'RESOLVED', label: 'Concluídos' },
              { id: 'CANCELLED', label: 'Cancelados' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                  statusFilter === tab.id
                    ? 'church-btn-primary text-white shadow-sm'
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 border border-gray-200 dark:border-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tickets List */}
          {filteredTickets.length === 0 ? (
            <div className="rounded-3xl border border-gray-200 bg-white p-12 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900 space-y-3">
              <LifeBuoy className="w-12 h-12 text-gray-400 mx-auto" />
              <h3 className="font-bold text-gray-800 dark:text-white">Nenhum chamado encontrado</h3>
              <p className="text-xs text-gray-500 max-w-sm mx-auto">
                Você não possui chamados com o filtro selecionado. Use o botão acima para abrir uma nova solicitação se precisar de ajuda técnica.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filteredTickets.map(ticket => (
                <div
                  key={ticket.id}
                  onClick={() => setSelectedTicket(ticket)}
                  className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900 hover:border-blue-300 dark:hover:border-blue-800 transition cursor-pointer flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-gray-500">{ticket.id}</span>
                      {getStatusBadge(ticket.status)}
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                        {ticket.category}
                      </span>
                    </div>
                    <h3 className="font-bold text-sm text-gray-900 dark:text-white">
                      {ticket.subject}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                      {ticket.description}
                    </p>
                    <div className="flex items-center gap-4 text-[11px] text-gray-400">
                      <span>Aberto em {new Date(ticket.createdAt).toLocaleDateString('pt-BR')}</span>
                      <span>{ticket.messages.length} mensagens na conversa</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1">
                      <MessageSquare className="w-4 h-4" />
                      <span>Ver Conversa</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      )}

      {/* MODAL: NOVO CHAMADO */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 space-y-4">
            
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
              <div className="flex items-center gap-2">
                <LifeBuoy className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-base text-gray-900 dark:text-white">Abrir Chamado de Suporte</h3>
              </div>
              <button onClick={() => setShowNewModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleOpenTicket} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                  Assunto do Chamado *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Dúvida sobre impressão de ficha de membro"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                    Categoria *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                  >
                    <option value="DUVIDA">Dúvida Operacional</option>
                    <option value="TECNICO">Problema Técnico / Erro</option>
                    <option value="FINANCEIRO">Financeiro / Pagamento</option>
                    <option value="SUGESTAO">Sugestão de Melhoria</option>
                    <option value="OUTRO">Outro Assunto</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                    Prioridade *
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as any)}
                    className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                  >
                    <option value="BAIXA">Baixa</option>
                    <option value="MEDIA">Média</option>
                    <option value="ALTA">Alta</option>
                    <option value="URGENTE">Urgente</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                  Descrição Detalhada *
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="Descreva com detalhes o que está acontecendo..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 p-2.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-1">
                  Anexo de Imagem ou Documento (Opcional)
                </label>
                <input
                  type="file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setAttachmentName(file.name);
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        setAttachmentUrl(reader.result as string);
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                  className="w-full text-xs text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>

              <div className="pt-2 flex justify-end gap-3 border-t border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 dark:text-gray-400"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl church-btn-primary text-white font-semibold text-xs shadow-md transition"
                >
                  Abrir Chamado
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
};
