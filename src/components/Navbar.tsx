/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { UserRole } from '../types';
import {
  Droplets,
  Users,
  Gauge,
  Camera,
  CreditCard,
  FileText,
  Scissors,
  MapPin,
  Settings,
  Wrench,
  ShieldAlert,
  RotateCcw,
  UserCog,
} from 'lucide-react';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  role: UserRole;
  setRole: (role: UserRole) => void;
  onResetDemo: () => void;
  totalMedidores: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  role,
  setRole,
  onResetDemo,
  totalMedidores,
}) => {
  return (
    <header className="bg-white border-b border-stone-200 sticky top-0 z-40 shadow-xs">
      {/* Top Banner / System Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xs">
              <Droplets className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-stone-900 text-lg tracking-tight">AguateríaPY</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-sm bg-blue-50 text-blue-800 border border-blue-200">
                  Interno
                </span>
                <span className="text-xs text-stone-600 hidden sm:inline">
                  | {totalMedidores.toLocaleString('es-PY')} Medidores
                </span>
              </div>
              <p className="text-xs text-stone-600">Sistema de Gestión de Agua Potable (Paraguay)</p>
            </div>
          </div>

          {/* Role Switcher & Reset Button */}
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-stone-100 p-1 rounded-md border border-stone-200">
              <span className="text-xs font-medium text-stone-600 px-2 hidden md:inline">Rol:</span>
              <button
                type="button"
                onClick={() => setRole('admin')}
                className={`text-xs px-2.5 py-1.5 rounded-sm font-medium transition-all ${
                  role === 'admin'
                    ? 'bg-white text-stone-900 shadow-xs font-semibold'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
                title="Administrador con acceso a todo el sistema"
              >
                Admin
              </button>
              <button
                type="button"
                onClick={() => setRole('cobrador')}
                className={`text-xs px-2.5 py-1.5 rounded-sm font-medium transition-all ${
                  role === 'cobrador'
                    ? 'bg-white text-stone-900 shadow-xs font-semibold'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
                title="Personal de caja y cobradores"
              >
                Cobrador
              </button>
              <button
                type="button"
                onClick={() => setRole('lectura')}
                className={`text-xs px-2.5 py-1.5 rounded-sm font-medium transition-all ${
                  role === 'lectura'
                    ? 'bg-white text-stone-900 shadow-xs font-semibold'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
                title="Operario lector de medidores en calle"
              >
                Lector
              </button>
            </div>

            <button
              type="button"
              onClick={onResetDemo}
              title="Restablecer datos demo de 1.000 medidores"
              aria-label="Restablecer datos demo"
              className="p-2 text-stone-600 hover:text-stone-800 hover:bg-stone-100 rounded-md transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs (solo desktop >= 768px; en móvil la navegación es únicamente la barra inferior + Más) */}
        <nav className="hidden md:flex space-x-1 overflow-x-auto pb-2 scrollbar-none text-sm font-medium border-t border-stone-100 pt-1">
          {/* Dashboard */}
          <button
            type="button"
            onClick={() => setCurrentTab('dashboard')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap transition-colors ${
              currentTab === 'dashboard'
                ? 'bg-stone-900 text-white font-medium'
                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
            }`}
          >
            <Gauge className="w-4 h-4" />
            <span>Panel</span>
          </button>

          {/* Lector Móvil - Prioritario si rol es lectura */}
          <button
            type="button"
            onClick={() => setCurrentTab('lecturas')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap transition-colors ${
              currentTab === 'lecturas'
                ? 'bg-blue-600 text-white font-semibold'
                : role === 'lectura'
                ? 'text-blue-700 bg-blue-50 hover:bg-blue-100 font-semibold'
                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
            }`}
          >
            <Camera className="w-4 h-4" />
            <span>Toma de Lecturas</span>
          </button>

          {/* Caja / Cobranzas */}
          <button
            type="button"
            onClick={() => setCurrentTab('caja')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap transition-colors ${
              currentTab === 'caja'
                ? 'bg-stone-900 text-white font-medium'
                : role === 'cobrador'
                ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 font-semibold'
                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span>Caja y Cobros</span>
          </button>

          {/* Clientes */}
          <button
            type="button"
            onClick={() => setCurrentTab('clientes')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap transition-colors ${
              currentTab === 'clientes'
                ? 'bg-stone-900 text-white font-medium'
                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Clientes</span>
          </button>

          {/* Medidores */}
          <button
            type="button"
            onClick={() => setCurrentTab('medidores')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap transition-colors ${
              currentTab === 'medidores'
                ? 'bg-stone-900 text-white font-medium'
                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
            }`}
          >
            <Droplets className="w-4 h-4" />
            <span>Medidores</span>
          </button>

          {/* Facturación Mensual */}
          <button
            type="button"
            onClick={() => setCurrentTab('facturacion')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap transition-colors ${
              currentTab === 'facturacion'
                ? 'bg-stone-900 text-white font-medium'
                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Facturación</span>
          </button>

          {/* Corte y Reconexión (Solo Admin) */}
          {role === 'admin' && (
            <button
              type="button"
              onClick={() => setCurrentTab('cortes')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap transition-colors ${
                currentTab === 'cortes'
                  ? 'bg-stone-900 text-white font-medium'
                  : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
              }`}
            >
              <Scissors className="w-4 h-4 text-red-600" />
              <span>Corte y Reconexión</span>
            </button>
          )}

          {/* Mapa de Medidores */}
          <button
            type="button"
            onClick={() => setCurrentTab('mapa')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap transition-colors ${
              currentTab === 'mapa'
                ? 'bg-stone-900 text-white font-medium'
                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
            }`}
          >
            <MapPin className="w-4 h-4" />
            <span>Mapa Medidores</span>
          </button>

          {/* Otros Trabajos */}
          <button
            type="button"
            onClick={() => setCurrentTab('trabajos')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap transition-colors ${
              currentTab === 'trabajos'
                ? 'bg-stone-900 text-white font-medium'
                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
            }`}
          >
            <Wrench className="w-4 h-4" />
            <span>Otros Trabajos</span>
          </button>

          {/* Usuarios (Solo Admin) */}
          {role === 'admin' && (
            <button
              type="button"
              onClick={() => setCurrentTab('usuarios')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap transition-colors ${
                currentTab === 'usuarios'
                  ? 'bg-stone-900 text-white font-medium'
                  : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
              }`}
            >
              <UserCog className="w-4 h-4" />
              <span>Usuarios</span>
            </button>
          )}

          {/* Tarifas */}
          {role === 'admin' && (
            <button
              type="button"
              onClick={() => setCurrentTab('tarifas')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap transition-colors ${
                currentTab === 'tarifas'
                  ? 'bg-stone-900 text-white font-medium'
                  : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>Tarifas</span>
            </button>
          )}
        </nav>
      </div>
    </header>
  );
};
