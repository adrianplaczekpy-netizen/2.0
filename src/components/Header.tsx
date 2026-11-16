/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { Menu, LogOut, Settings, RefreshCw } from 'lucide-react';
import { UserRole } from '../types';

interface HeaderProps {
  onToggleMobileMenu: () => void;
  onResetDemo?: () => void;
  onNavigate?: (tab: string) => void;
  onSyncData?: () => void;
  isSyncing?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleMobileMenu,
  onNavigate,
  onSyncData,
  isSyncing = false,
}) => {
  const { user, logout, switchDemoRole } = useAuth();

  const getRoleBadge = (rol?: UserRole) => {
    switch (rol) {
      case 'admin':
        return (
          <span className="bg-stone-900 text-white text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
            Admin
          </span>
        );
      case 'cobrador':
        return (
          <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
            Cobrador
          </span>
        );
      case 'lectura':
        return (
          <span className="bg-blue-100 text-blue-800 border border-blue-300 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
            Lectura
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <header className="bg-white border-b border-stone-200 px-3 sm:px-6 py-2.5 flex items-center justify-between gap-2 shadow-xs sticky top-0 z-30">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          type="button"
          onClick={onToggleMobileMenu}
          className="p-1.5 rounded-lg text-stone-600 hover:text-stone-900 hover:bg-stone-100 lg:hidden shrink-0"
          aria-label="Abrir menú"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="hidden sm:block truncate">
          <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
            Aguatería — Gestión Operativa
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {onSyncData && (
          <button
            type="button"
            onClick={onSyncData}
            disabled={isSyncing}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-xs transition-colors disabled:opacity-60 cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar datos'}</span>
          </button>
        )}

        {/* Switcher de roles demo solo cuando Supabase NO está configurado */}
        {!isSupabaseConfigured && (
          <div className="hidden md:flex items-center bg-stone-100 p-0.5 rounded-lg border border-stone-200 text-xs">
            <span className="text-[10px] font-bold text-stone-500 px-2 uppercase">Rol:</span>
            {(['admin', 'cobrador', 'lectura'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => switchDemoRole(r)}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold capitalize transition-all ${
                  user?.rol === r
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        )}

        {user?.rol === 'admin' && onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate('/admin/configuracion/tarifas')}
            className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 text-xs font-semibold text-stone-700 hover:text-stone-900 bg-stone-50 hover:bg-stone-100 rounded-lg border border-stone-200 transition-colors"
            title="Configuración de Tarifas"
            aria-label="Configuración"
          >
            <Settings className="w-3.5 h-3.5 text-stone-500" />
            <span className="hidden sm:inline">Configuración</span>
          </button>
        )}

        {/* User Profile & Logout */}
        <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-3 border-l border-stone-200">
          <div className="text-right hidden sm:block">
            <div className="flex items-center gap-1.5 justify-end">
              <span className="text-xs font-bold text-stone-900 block leading-tight">
                {user?.nombre || 'Usuario'}
              </span>
              {getRoleBadge(user?.rol)}
            </div>
            <span className="text-[10px] text-stone-500 block leading-tight">
              {user?.email}
            </span>
          </div>

          <button
            type="button"
            onClick={() => logout()}
            className="p-1.5 text-stone-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-1 text-xs font-semibold"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </div>
    </header>
  );
};
