/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { db } from './services/database';
import { isSupabaseConfigured } from './services/supabaseClient';
import { LoginView } from './components/LoginView';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { ClientesView } from './components/ClientesView';
import { MedidoresView } from './components/MedidoresView';
import { LecturasMobileView } from './components/LecturasMobileView';
import { OtrosTrabajosView } from './components/OtrosTrabajosView';
import { FacturacionView } from './components/FacturacionView';

// Lazy loading estricto del módulo de mapa (Leaflet + MarkerCluster solo al entrar)
const MapaMedidoresView = React.lazy(() =>
  import('./components/MapaMedidoresView').then((m) => ({ default: m.MapaMedidoresView }))
);

import { CajaCobranzasView } from './components/CajaCobranzasView';
import { ReportesView } from './components/ReportesView';
import { TarifasView } from './components/TarifasView';
import { CorteReconexionView } from './components/CorteReconexionView';
import { SupabaseSetupAssistant } from './components/SupabaseSetupAssistant';
import { ShieldAlert, AlertTriangle, CheckCircle2, RefreshCw, X } from 'lucide-react';

function isSchemaMissingError(msg: string | null): boolean {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return (
    lower.includes('pgrst205') ||
    lower.includes('does not exist') ||
    lower.includes('could not find the table') ||
    (lower.includes('relation') && lower.includes('no existe'))
  );
}

function MainApp() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [currentTab, setCurrentTab] = useState<string>(() => {
    if (typeof window !== 'undefined' && window.location.pathname === '/admin/configuracion/tarifas') {
      return '/admin/configuracion/tarifas';
    }
    return 'dashboard';
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [, setDbVersion] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncToast, setSyncToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [dbState, setDbState] = useState(() => ({
    status: db.getConnectionStatus(),
    error: db.getDbError(),
    url: db.getSupabaseUrl(),
  }));

  useEffect(() => {
    return db.subscribe(() => {
      setDbState({
        status: db.getConnectionStatus(),
        error: db.getDbError(),
        url: db.getSupabaseUrl(),
      });
      setDbVersion((v) => v + 1);
    });
  }, []);

  // Garantizar sincronización al iniciar sesión o restaurar usuario autenticado
  useEffect(() => {
    if (isAuthenticated && user?.id && isSupabaseConfigured) {
      db.loadFromSupabase();
    }
  }, [isAuthenticated, user?.id]);

  // Auto-cerrar toast después de 6 segundos
  useEffect(() => {
    if (!syncToast) return;
    const timer = setTimeout(() => setSyncToast(null), 6000);
    return () => clearTimeout(timer);
  }, [syncToast]);

  // Sincronización bidireccional de URL con currentTab para ruta oculta /admin/configuracion/tarifas
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (currentTab === '/admin/configuracion/tarifas') {
      if (window.location.pathname !== '/admin/configuracion/tarifas') {
        window.history.pushState(null, '', '/admin/configuracion/tarifas');
      }
    } else if (window.location.pathname === '/admin/configuracion/tarifas') {
      window.history.pushState(null, '', '/');
    }
  }, [currentTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      if (window.location.pathname === '/admin/configuracion/tarifas') {
        setCurrentTab('/admin/configuracion/tarifas');
      } else {
        setCurrentTab('dashboard');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Filtros contextuales cruzados
  const [filtroClienteParaMedidores, setFiltroClienteParaMedidores] = useState<string | null>(null);

  const handleSyncData = useCallback(async () => {
    setIsSyncing(true);
    try {
      const res = await db.loadFromSupabase({ force: true });
      if (res.ok) {
        setSyncToast({
          type: 'success',
          message: `${res.clientesCount} clientes cargados`,
        });
      } else {
        setSyncToast({
          type: 'error',
          message: `Error: ${res.error || 'No se pudo sincronizar con Supabase'}`,
        });
      }
    } catch (err: any) {
      setSyncToast({
        type: 'error',
        message: `Error: ${err?.message || 'Error inesperado al sincronizar'}`,
      });
    } finally {
      setIsSyncing(false);
    }
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center text-xs font-bold text-stone-600">
        Cargando sistema AguateríaPY...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginView />;
  }

  const handleResetDemo = () => {
    handleSyncData();
  };

  const handleGoToLectura = (medidorNum: number) => {
    setCurrentTab('lecturas');
  };

  const handleGoToCaja = (medidorId: string) => {
    setCurrentTab('pagos');
  };

  const handleAgregarOtroTrabajo = (clienteId: string, medidorId?: string) => {
    setCurrentTab('trabajos');
  };

  const handleAgregarMedidorParaCliente = (clienteId: string) => {
    setFiltroClienteParaMedidores(clienteId);
    setCurrentTab('medidores');
  };

  const showSchemaAssistant = Boolean(dbState.error && isSchemaMissingError(dbState.error));

  return (
    <div className="min-h-screen bg-stone-100 flex text-stone-900 font-sans">
      {/* Sidebar Minimalista */}
      <Sidebar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        isOpenMobile={mobileMenuOpen}
        setIsOpenMobile={setMobileMenuOpen}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header con botón Sincronizar datos, usuario y logout */}
        <Header
          onToggleMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)}
          onResetDemo={handleResetDemo}
          onNavigate={setCurrentTab}
          onSyncData={handleSyncData}
          isSyncing={isSyncing}
        />

        {/* Toast de Sincronización */}
        {syncToast && (
          <div
            role={syncToast.type === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={`fixed bottom-4 right-4 z-50 max-w-sm w-[calc(100%-2rem)] sm:w-auto px-4 py-3 rounded-xl shadow-lg border flex items-start gap-2.5 text-xs font-semibold ${
              syncToast.type === 'success'
                ? 'bg-emerald-900 text-white border-emerald-700'
                : 'bg-red-900 text-white border-red-700'
            }`}
          >
            {syncToast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-300 shrink-0 mt-0.5" />
            )}
            <span className="flex-1 break-words">{syncToast.message}</span>
            <button
              type="button"
              onClick={() => setSyncToast(null)}
              aria-label="Cerrar notificación"
              className="p-0.5 rounded hover:bg-white/15 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Contenido Principal */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {/* ASISTENTE DE ESQUEMA SUPABASE (solo si faltan tablas) O ALERTA DE ERROR EXPLÍCITA */}
          {showSchemaAssistant ? (
            <SupabaseSetupAssistant
              errorMessage={dbState.error}
              onSuccess={() => setDbVersion((v) => v + 1)}
            />
          ) : dbState.error ? (
            <div
              role="alert"
              className="mb-6 p-4 bg-red-50 border border-red-300 rounded-xl text-red-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Error de conexión con Supabase</p>
                  <p className="text-red-800 mt-0.5">{dbState.error}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSyncData}
                disabled={isSyncing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-700 hover:bg-red-800 text-white font-bold rounded-lg text-xs shrink-0 self-start sm:self-auto disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>Reintentar</span>
              </button>
            </div>
          ) : null}

          {currentTab === 'dashboard' && <DashboardView onNavigate={setCurrentTab} />}

          {currentTab === 'clientes' && (
            <ClientesView
              onAgregarOtroTrabajo={handleAgregarOtroTrabajo}
              onAgregarMedidorParaCliente={handleAgregarMedidorParaCliente}
              onSyncData={handleSyncData}
              isSyncing={isSyncing}
            />
          )}

          {currentTab === 'medidores' && (
            <MedidoresView
              onGoToLectura={handleGoToLectura}
              onGoToCaja={handleGoToCaja}
              initialClienteIdFiltro={filtroClienteParaMedidores}
            />
          )}

          {currentTab === 'lecturas' && <LecturasMobileView />}

          {currentTab === 'trabajos' && <OtrosTrabajosView />}

          {currentTab === 'mapa' && (
            <React.Suspense
              fallback={
                <div className="flex flex-col items-center justify-center p-16 bg-white rounded-xl border border-stone-200">
                  <div className="w-8 h-8 border-3 border-stone-300 border-t-blue-600 rounded-full animate-spin mb-3"></div>
                  <p className="text-sm font-semibold text-stone-700">Cargando módulo de mapa espacial...</p>
                  <p className="text-xs text-stone-500 mt-1">Carga diferida de Leaflet y 1.000 medidores</p>
                </div>
              }
            >
              <MapaMedidoresView
                onSelectMedidorParaCobro={handleGoToCaja}
                onSelectMedidorParaLectura={handleGoToLectura}
              />
            </React.Suspense>
          )}

          {currentTab === 'facturacion' && <FacturacionView />}

          {currentTab === 'pagos' && <CajaCobranzasView />}

          {currentTab === 'reportes' && <ReportesView />}

          {/* Ruta oculta /admin/configuracion/tarifas — Solo accesible para admin */}
          {currentTab === '/admin/configuracion/tarifas' && (
            user?.rol === 'admin' ? (
              <TarifasView />
            ) : (
              <div className="p-8 bg-red-50 border border-red-300 rounded-xl text-red-900 max-w-lg mx-auto text-center space-y-3">
                <ShieldAlert className="w-10 h-10 text-red-600 mx-auto" />
                <h2 className="text-base font-black">Acceso denegado</h2>
                <p className="text-xs">
                  La configuración de tarifas del pliego de ERSSAN solo puede ser gestionada por usuarios con rol de Administrador.
                </p>
                <button
                  type="button"
                  onClick={() => setCurrentTab('dashboard')}
                  className="px-4 py-2 bg-stone-900 text-white font-bold text-xs rounded-lg cursor-pointer"
                >
                  Volver al Panel
                </button>
              </div>
            )
          )}
        </main>

        <footer className="bg-white border-t border-stone-200 py-3 text-center text-[11px] text-stone-500">
          AguateríaPY — Sistema Operativo de Gestión de Agua Potable • Diseñado conforme a normativas de ERSSAN (Paraguay)
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
