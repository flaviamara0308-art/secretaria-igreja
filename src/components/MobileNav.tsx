import React from 'react';
import { 
  LayoutDashboard, 
  Users, 
  FolderGit2, 
  Settings, 
  LifeBuoy, 
  Shield, 
  Building2, 
  Activity 
} from 'lucide-react';
import { User } from '../types';

interface MobileNavProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  currentUser?: User;
}

export const MobileNav: React.FC<MobileNavProps> = ({ currentTab, onSelectTab, currentUser }) => {
  const isPlatformStaff = currentUser?.role === 'PLATFORM_ADMIN' || currentUser?.role === 'PLATFORM_ASSISTANT_ADMIN';

  const churchNavItems = [
    { id: 'dashboard', label: 'Painel', icon: LayoutDashboard },
    { id: 'members', label: 'Membros', icon: Users },
    { id: 'departments', label: 'Depts', icon: FolderGit2 },
    { id: 'support', label: 'Ajuda', icon: LifeBuoy },
    { id: 'settings', label: 'Ajustes', icon: Settings },
  ];

  const platformNavItems = [
    { id: 'platform-admin', label: 'Painel', icon: Shield },
    { id: 'platform-churches', label: 'Igrejas', icon: Building2 },
    { id: 'platform-users', label: 'Usuários', icon: Users },
    { id: 'platform-support', label: 'Suporte', icon: LifeBuoy },
    { id: 'platform-monitoring', label: 'Sistema', icon: Activity },
  ];

  const navItems = isPlatformStaff ? platformNavItems : churchNavItems;

  return (
    <div className={`fixed bottom-0 left-0 right-0 z-40 border-t backdrop-blur-md lg:hidden ${
      isPlatformStaff
        ? 'border-indigo-900 bg-slate-900/95 text-white'
        : 'border-gray-200 bg-white/95 dark:border-gray-800 dark:bg-gray-900/95'
    }`}>
      <div className="grid h-16 grid-cols-5">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`flex flex-col items-center justify-center gap-1 transition ${
                isActive
                  ? isPlatformStaff
                    ? 'text-indigo-400 font-bold'
                    : 'text-blue-700 dark:text-blue-400 font-bold'
                  : isPlatformStaff
                    ? 'text-indigo-300/70 hover:text-white'
                    : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px]">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
