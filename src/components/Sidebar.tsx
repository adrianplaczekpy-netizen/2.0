/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types';
import {
  getMobileMoreNavItems,
  getMobilePrimaryNavItems,
  getVisibleSidebarNavItems,
} from '../services/navigationHelpers';
import {
  LayoutDashboard,
  Users,
  Gauge,
  Camera,
  Wrench,
  MapPin,
  FileText,
  CreditCard,
  BarChart3,
  Scissors,
  UserCog,
  Droplets,
  ShieldAlert,
  Settings,
  MoreHorizontal,
  X,
} from 'lucide-react';

interface SidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
}

export interface SidebarMenuItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const ICON_BY_TAB_ID: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  clientes: Users,
  medidores: Gauge,
  lecturas: Camera,
  trabajos: Wrench,
  mapa: MapPin,
  facturacion: FileText,
  pagos: CreditCard,
  cortes: Scissors,
  reportes: BarChart3,
  usuarios: UserCog,
  '/admin/configuracion/tarifas': Settings,
};

export function getSidebarMenuItems(rol?: UserRole): SidebarMenuItem[] {
  return getVisibleSidebarNavItems(rol).map((item) => ({
    ...item,
    icon: ICON_BY_TAB_ID[item.id] || LayoutDashboard,
  }));
}

export function getMobilePrimaryMenuItems(rol?: UserRole): SidebarMenuItem[] {
  return getMobilePrimaryNavItems(rol).map((item) => ({
    ...item,
    icon: ICON_BY_TAB_ID[item.id] || LayoutDashboard,
  }));
}

export function getMobileMoreMenuItems(rol?: UserRole): SidebarMenuItem[] {
  return getMobileMoreNavItems(rol).map((item) => ({
    ...item,
    icon: ICON_BY_TAB_ID[item.id] || LayoutDashboard,
  }));
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, setCurrentTab }) => {
  const { user } = useAuth();
  const [masOpen, setMasOpen] = useState(false);

  const menuItems = getSidebarMenuItems(user?.rol);
  const mobilePrimaryItems = getMobilePrimaryMenuItems(user?.rol);
  const mobileMoreItems = getMobileMoreMenuItems(user?.rol);
  const isMoreActive = mobileMoreItems.some((item) => item.id === currentTab);

  const handleSelectTab = (tabId: string) => {
    setCurrentTab(tabId);
    setMasOpen(false);
  };

  return (
    <>
      {/* Sheet de "Más" en móvil (< 768px) */}
      {masOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex flex-col justify-end">
          <div
            className="fixed inset-0 bg-black/40"
            onClick={() => setMasOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Más módulos"
            className="relative bg-white rounded-t-2xl border-t border-stone-200 shadow-2xl p-4 pb-6 space-y-3"
          >
            <div className="flex items-center justify-between border-b border-stone-100 pb-2.5">
              <span className="text-xs font-black uppercase tracking-wider text-stone-700">
                Más módulos
              </span>
              <button
                type="button"
                onClick={() => setMasOpen(false)}
                aria-label="Cerrar menú Más"
                className="p-1.5 text-stone-500 hover:text-stone-900 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {mobileMoreItems.map((item) => {
                const Icon = item.icon;
                const isActive = currentTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectTab(item.id)}
                    className={`flex items-center gap-2.5 px-3 py-3 rounded-xl text-xs font-bold border text-left transition-colors ${
                      isActive
                        ? 'bg-stone-900 text-white border-stone-900'
                        : 'bg-stone-50 text-stone-800 border-stone-200 hover:bg-stone-100'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-white' : 'text-stone-600'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Sidebar lateral exclusivo de desktop (>= 768px) */}
      <aside className="hidden md:flex md:flex-col w-64 shrink-0 bg-white border-r border-stone-200">
        {/* Brand */}
        <div className="p-4 border-b border-stone-200 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0">
            <Droplets className="w-5 h-5" />
          </div>
          <div>
            <span className="font-black text-stone-900 text-base tracking-tight block leading-tight">
              AguateríaPY
            </span>
            <span className="text-[10px] text-stone-500 font-bold uppercase tracking-wider block">
              Sistema Interno
            </span>
          </div>
        </div>

        {/* Navigation List */}
        <nav aria-label="Navegación lateral" className="flex-1 overflow-y-auto p-3 space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-colors text-left cursor-pointer ${
                  isActive
                    ? 'bg-stone-900 text-white font-bold shadow-xs'
                    : 'text-stone-700 hover:bg-stone-100 hover:text-stone-900'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-stone-500'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer info & hidden admin link indication */}
        <div className="p-3 border-t border-stone-200 bg-stone-50 text-[11px] text-stone-500 space-y-1">
          <div className="flex items-center justify-between">
            <span>Escala:</span>
            <span className="font-bold text-stone-700">1.000 Medidores</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Marco:</span>
            <span className="font-semibold text-stone-700">Normativa ERSSAN</span>
          </div>
          {user?.rol === 'admin' && (
            <div className="pt-2 border-t border-stone-200">
              <button
                type="button"
                onClick={() => handleSelectTab('/admin/configuracion/tarifas')}
                className="text-[10px] text-stone-400 hover:text-stone-700 flex items-center gap-1"
                title="Ruta oculta de tarifas (solo admin)"
              >
                <ShieldAlert className="w-3 h-3 text-stone-400" />
                <span>/admin/configuracion/tarifas</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Única navegación en móvil (< 768px): barra inferior de exactamente 5 items */}
      <nav
        aria-label="Navegación móvil"
        className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-stone-200 md:hidden grid grid-cols-5 h-16 px-1 shadow-xs"
      >
        {mobilePrimaryItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelectTab(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
                isActive ? 'text-stone-900 font-bold' : 'text-stone-500 hover:text-stone-900'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate max-w-full px-1">{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setMasOpen((prev) => !prev)}
          aria-expanded={masOpen}
          className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
            masOpen || isMoreActive ? 'text-stone-900 font-bold' : 'text-stone-500 hover:text-stone-900'
          }`}
        >
          <MoreHorizontal className="w-4 h-4 shrink-0" />
          <span>Más</span>
        </button>
      </nav>
    </>
  );
};
