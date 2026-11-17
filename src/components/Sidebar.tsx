import React from 'react';
import {
  LayoutDashboard,
  Users,
  FolderGit2,
  Shield,
  Calendar,
  TrendingUp,
  Settings,
  LogOut,
  Building2,
  LifeBuoy,
  Activity,
  X,
} from 'lucide-react';
import { Church, User } from '../types';

interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  church: Church;
  currentUser: User;
  onLogout: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  church,
  currentUser,
  onLogout,
  isMobileOpen = false,
  onCloseMobile,
}) => {
  const isPlatformStaff =
    currentUser.role === 'PLATFORM_ADMIN' || currentUser.role === 'PLATFORM_ASSISTANT_ADMIN';
  const isLeader = currentUser.role === 'DEPARTMENT_LEADER';

  // Menu items based on role
  const churchMenuItems = [
    { id: 'dashboard', label: 'Painel (Dashboard)', icon: LayoutDashboard },
    { id: 'members', label: 'Membros', icon: Users },
    { id: 'departments', label: 'Departamentos', icon: FolderGit2 },
    ...(!isLeader ? [{ id: 'users', label: 'Usuários e Permissões', icon: Shield }] : []),
    { id: 'agenda', label: 'Agenda', icon: Calendar },
    { id: 'reports', label: 'Relatórios', icon: TrendingUp },
    { id: 'support', label: 'Central de Ajuda', icon: LifeBuoy },
    { id: 'settings', label: 'Configurações', icon: Settings },
  ];

  const platformMenuItems = [
    { id: 'platform-admin', label: 'Visão Geral', icon: Shield },
    { id: 'platform-churches', label: 'Congregações / Igrejas', icon: Building2 },
    { id: 'platform-users', label: 'Usuários e Autorizações', icon: Users },
    { id: 'platform-support', label: 'Central de Suporte', icon: LifeBuoy },
    { id: 'platform-monitoring', label: 'Monitoramento Técnico', icon: Activity },
  ];

  const menuItems = isPlatformStaff ? platformMenuItems : churchMenuItems;

  const handleSelect = (tabId: string) => {
    onSelectTab(tabId);
    onCloseMobile?.();
  };

  const renderSidebarPanel = (showMobileClose: boolean) => (
    <div
      className={`flex w-60 lg:w-64 flex-col border-r transition h-full ${
        isPlatformStaff
          ? 'border-indigo-900 bg-slate-900 text-white'
          : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'
      }`}
    >
      {/* Brand / Context Header */}
      <div
        className={`flex h-16 items-center justify-between gap-2 px-5 border-b ${
          isPlatformStaff
            ? 'border-indigo-800/80 bg-slate-950/60'
            : 'border-gray-200 dark:border-gray-800'
        }`}
        style={
          !isPlatformStaff
            ? {
                background:
                  'linear-gradient(135deg, rgba(var(--church-primary-rgb), 0.08) 0%, rgba(var(--church-secondary-rgb), 0.04) 100%)',
              }
            : undefined
        }
      >
        <div className="flex items-center gap-3 overflow-hidden">
          {isPlatformStaff ? (
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl font-bold bg-indigo-600 text-white shadow-md shadow-indigo-600/30">
              <Shield className="w-5 h-5" />
            </div>
          ) : church.logoUrl ? (
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white p-1 shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <img
                src={church.logoUrl}
                alt={church.name}
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl font-bold church-gradient-bg">
              <Building2 className="w-5 h-5" />
            </div>
          )}
          <div className="overflow-hidden">
            <h2 className="text-sm font-bold tracking-tight truncate">
              {isPlatformStaff ? 'ADMIN PLATAFORMA' : 'SECRETARIA'}
            </h2>
            <p
              className={`text-xs font-semibold truncate ${
                isPlatformStaff ? 'text-indigo-300' : 'church-accent-text'
              }`}
            >
              {isPlatformStaff ? 'Multi-tenant Eclesiástico' : church.name}
            </p>
          </div>
        </div>
        {showMobileClose && onCloseMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Fechar menu lateral"
            className={`rounded-lg p-1.5 transition ${
              isPlatformStaff
                ? 'text-indigo-200 hover:bg-slate-800 hover:text-white'
                : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 space-y-1.5 px-3.5 py-5 overflow-y-auto">
        {menuItems.map(item => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleSelect(item.id)}
              className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${
                isActive
                  ? isPlatformStaff
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-bold'
                    : 'church-gradient-bg font-bold'
                  : isPlatformStaff
                    ? 'text-indigo-200 hover:bg-slate-800 hover:text-white'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
            >
              <Icon
                className={`w-4 h-4 flex-shrink-0 ${
                  isActive
                    ? 'text-white'
                    : isPlatformStaff
                    ? 'text-indigo-400'
                    : 'text-gray-400'
                }`}
              />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Logout */}
      <div
        className={`p-4 border-t ${
          isPlatformStaff ? 'border-indigo-900/60' : 'border-gray-200 dark:border-gray-800'
        }`}
      >
        <button
          onClick={() => {
            onCloseMobile?.();
            onLogout();
          }}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-xs font-semibold text-rose-500 hover:bg-rose-500/10 transition"
        >
          <LogOut className="w-4 h-4" />
          <span>{isPlatformStaff ? 'Sair da Plataforma' : 'Trocar Igreja / Sair'}</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Persistent Left Sidebar (Tablet md+ and Desktop) */}
      <aside className="hidden md:flex md:flex-shrink-0">
        {renderSidebarPanel(false)}
      </aside>

      {/* Mobile Left Drawer */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <aside className="relative z-10 flex h-full max-w-[82vw] flex-shrink-0 shadow-2xl">
            {renderSidebarPanel(true)}
          </aside>
        </div>
      )}
    </>
  );
};
