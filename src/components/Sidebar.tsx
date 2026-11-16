/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useAuth } from '../context/AuthContext';
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
  Droplets,
  ShieldAlert,
} from 'lucide-react';

interface SidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  isOpenMobile: boolean;
  setIsOpenMobile: (open: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  setCurrentTab,
  isOpenMobile,
  setIsOpenMobile,
}) => {
  const { user } = useAuth();

  // Menu items: Dashboard, Clientes, Medidores, Lecturas, Otros Trabajos, Mapa, Facturación, Pagos, Reportes
  // NOTA: Configuración de tarifas NO está en el menú según especificación estricta.
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'clientes', label: 'Clientes', icon: Users },
    { id: 'medidores', label: 'Medidores', icon: Gauge },
    { id: 'lecturas', label: 'Lecturas', icon: Camera },
    { id: 'trabajos', label: 'Otros Trabajos', icon: Wrench },
    { id: 'mapa', label: 'Mapa', icon: MapPin },
    { id: 'facturacion', label: 'Facturación', icon: FileText },
    { id: 'pagos', label: 'Pagos', icon: CreditCard },
    { id: 'reportes', label: 'Reportes', icon: BarChart3 },
  ];

  const handleSelectTab = (tabId: string) => {
    setCurrentTab(tabId);
    setIsOpenMobile(false);
  };

  return (
    <>
      {/* Overlay para móvil */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setIsOpenMobile(false)}
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 w-64 bg-white border-r border-stone-200 flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
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
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-colors text-left ${
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
    </>
  );
};
