/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { db } from '../services/database';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { formatGs } from '../services/billingRules';
import { CargoPendiente, EstadoCargo } from '../types';
import { exportarCargosCSV } from '../utils/exportCsv';
import {
  Wrench,
  Plus,
  CheckCircle2,
  Clock,
  X,
  Search,
  Lock,
  Ban,
  AlertCircle,
  FileText,
  Filter,
  Download,
  Edit2,
  ChevronLeft,
  ChevronRight,
  Info,
  Calendar,
  DollarSign,
  AlertTriangle,
} from 'lucide-react';

type CargoEnriquecido = CargoPendiente & {
  numeroMedidor: number;
  medidorDireccion: string;
  clienteNombre: string;
  clienteDoc: string;
  registradoPorNombre: string;
};

export const OtrosTrabajosView: React.FC = () => {
  const { user } = useAuth();
  const periodoActualDefault = useMemo(() => new Date().toISOString().slice(0, 7), []);

  // Paginación y filtros en servidor (máximo 50 por página)
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [filtroEstado, setFiltroEstado] = useState<EstadoCargo | 'todos'>('todos');
  const [filtroPeriodo, setFiltroPeriodo] = useState<string>('todos');
  const [busqueda, setBusqueda] = useState<string>('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Modales
  const [showModalCrear, setShowModalCrear] = useState(false);
  const [cargoParaEditar, setCargoParaEditar] = useState<CargoEnriquecido | null>(null);
  const [cargoParaAnular, setCargoParaAnular] = useState<CargoEnriquecido | null>(null);
  const [cargoParaAuditoria, setCargoParaAuditoria] = useState<CargoEnriquecido | null>(null);

  // Formulario Crear Cargo
  const [crearNumMedidor, setCrearNumMedidor] = useState('');
  const [crearDescripcion, setCrearDescripcion] = useState('');
  const [crearMonto, setCrearMonto] = useState('');
  const [crearPeriodo, setCrearPeriodo] = useState(periodoActualDefault);
  const [crearFechaTrabajo, setCrearFechaTrabajo] = useState(new Date().toISOString().split('T')[0]);
  const [errorCrear, setErrorCrear] = useState<string | null>(null);
  const [guardandoCrear, setGuardandoCrear] = useState(false);

  // Formulario Editar Cargo
  const [editDescripcion, setEditDescripcion] = useState('');
  const [editMonto, setEditMonto] = useState('');
  const [editPeriodo, setEditPeriodo] = useState('');
  const [editFechaTrabajo, setEditFechaTrabajo] = useState('');
  const [errorEditar, setErrorEditar] = useState<string | null>(null);
  const [guardandoEditar, setGuardandoEditar] = useState(false);

  // Formulario Anular Cargo
  const [motivoAnulacion, setMotivoAnulacion] = useState('');
  const [errorAnular, setErrorAnular] = useState<string | null>(null);
  const [guardandoAnular, setGuardandoAnular] = useState(false);

  // Helper de búsqueda reactiva del medidor en el formulario de creación
  const medidorEncontradoCrear = useMemo(() => {
    const num = parseInt(crearNumMedidor, 10);
    if (isNaN(num) || num < 1) return null;
    const res = db.getMedidores({ search: String(num), limit: 50 });
    return res.medidores.find((m) => m.numero_medidor === num) || null;
  }, [crearNumMedidor]);

  // Verificar en tiempo real si el período ya fue emitido para el medidor seleccionado
  const conflictoFacturaCrear = useMemo(() => {
    if (!medidorEncontradoCrear || !crearPeriodo) return null;
    const resFacturas = db.getFacturas({ periodo: crearPeriodo, limit: 50 });
    return (
      resFacturas.facturas.find(
        (f) => f.medidor_id === medidorEncontradoCrear.id && f.estado !== 'anulada'
      ) || null
    );
  }, [medidorEncontradoCrear, crearPeriodo]);

  // Consulta paginada (máx 50 registros por página según principios de rendimiento)
  const { cargos, total, page, totalPages, resumen } = db.getCargos({
    page: currentPage,
    limit: 50,
    estado: filtroEstado,
    periodo: filtroPeriodo,
    search: busqueda,
  });

  // Lista dinámica de períodos disponibles para el filtro
  const periodosDisponibles = useMemo(() => {
    const todosLosCargos = db.getCargos({ limit: 50 }).cargos;
    const set = new Set<string>([periodoActualDefault]);
    for (const c of todosLosCargos) {
      if (c.periodo_facturacion) set.add(c.periodo_facturacion);
    }
    if (filtroPeriodo !== 'todos') {
      set.add(filtroPeriodo);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [cargos, filtroPeriodo, periodoActualDefault]);

  const mostrarExito = (texto: string) => {
    setErrorBanner(null);
    setMensaje(texto);
    setToast({ type: 'success', message: texto });
  };

  const mostrarError = (texto: string) => {
    setErrorBanner(texto);
    setToast({ type: 'error', message: texto });
  };

  const handleCrearCargo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guardandoCrear) return;
    setErrorCrear(null);
    setErrorBanner(null);

    const num = parseInt(crearNumMedidor, 10);
    const m = parseInt(crearMonto, 10);

    if (isNaN(num) || num < 1) {
      setErrorCrear('Ingrese un número de medidor válido.');
      return;
    }

    if (isNaN(m) || m <= 0) {
      setErrorCrear('El monto a cobrar debe ser un valor entero mayor a 0 Gs.');
      return;
    }

    if (!medidorEncontradoCrear) {
      setErrorCrear(`El Medidor N° ${num} no existe en el sistema.`);
      return;
    }

    if (conflictoFacturaCrear) {
      setErrorCrear(
        `NUNCA se agrega un cargo a una factura ya emitida. El período ${crearPeriodo} ya fue emitido para el Medidor N° ${num} (Factura #${conflictoFacturaCrear.id}). Debe facturarse en el período siguiente.`
      );
      return;
    }

    setGuardandoCrear(true);
    try {
      await db.agregarCargoPendienteAsync({
        medidor_id: medidorEncontradoCrear.id,
        cliente_id: medidorEncontradoCrear.cliente_id,
        fecha_trabajo: crearFechaTrabajo,
        descripcion: crearDescripcion.trim(),
        monto: m,
        periodo_facturacion: crearPeriodo,
        registrado_por: user?.id || 'admin',
      });

      if (isSupabaseConfigured) {
        const resSync = await db.loadFromSupabase({ force: true });
        if (!resSync.ok && resSync.error) {
          throw new Error(resSync.error);
        }
      }

      mostrarExito(
        `Cargo de ${formatGs(m)} para el Medidor N° ${num} registrado como pendiente para ${crearPeriodo}.`
      );
      setShowModalCrear(false);
      setCrearNumMedidor('');
      setCrearDescripcion('');
      setCrearMonto('');
      setErrorCrear(null);
    } catch (err: any) {
      const msg = err?.message || 'Error al registrar el cargo en Supabase.';
      setErrorCrear(msg);
      mostrarError(msg);
    } finally {
      setGuardandoCrear(false);
    }
  };

  const handleAbrirEditar = (c: CargoEnriquecido) => {
    if (c.estado === 'facturado') {
      mostrarError(
        'Un cargo facturado NO se puede editar ni borrar. Solo el administrador puede anular la factura completa con justificación.'
      );
      return;
    }
    if (c.estado === 'anulado') {
      mostrarError('No se puede editar un cargo anulado.');
      return;
    }

    setErrorBanner(null);
    setCargoParaEditar(c);
    setEditDescripcion(c.descripcion);
    setEditMonto(String(c.monto));
    setEditPeriodo(c.periodo_facturacion);
    setEditFechaTrabajo(c.fecha_trabajo);
    setErrorEditar(null);
  };

  const handleGuardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cargoParaEditar || guardandoEditar) return;
    setErrorEditar(null);
    setErrorBanner(null);

    const m = parseInt(editMonto, 10);
    if (isNaN(m) || m <= 0) {
      setErrorEditar('El monto debe ser un entero mayor a 0 Gs.');
      return;
    }

    setGuardandoEditar(true);
    try {
      const actor = user?.nombre || user?.email || 'admin';
      await db.actualizarCargoPendienteAsync(
        cargoParaEditar.id,
        {
          descripcion: editDescripcion.trim(),
          monto: m,
          periodo_facturacion: editPeriodo,
          fecha_trabajo: editFechaTrabajo,
        },
        actor
      );

      if (isSupabaseConfigured) {
        const resSync = await db.loadFromSupabase({ force: true });
        if (!resSync.ok && resSync.error) {
          throw new Error(resSync.error);
        }
      }

      mostrarExito(
        `Cargo del Medidor N° ${cargoParaEditar.numeroMedidor} actualizado correctamente (Período: ${editPeriodo}).`
      );
      setCargoParaEditar(null);
    } catch (err: any) {
      const msg = err?.message || 'Error al actualizar el cargo en Supabase.';
      setErrorEditar(msg);
      mostrarError(msg);
    } finally {
      setGuardandoEditar(false);
    }
  };

  const handleConfirmarAnulacion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cargoParaAnular || guardandoAnular) return;
    setErrorAnular(null);
    setErrorBanner(null);

    if (!motivoAnulacion || motivoAnulacion.trim().length < 5) {
      setErrorAnular('Debe especificar un motivo de anulación obligatorio (mínimo 5 caracteres para auditoría).');
      return;
    }

    setGuardandoAnular(true);
    try {
      const actor = user?.nombre || user?.email || 'admin';
      await db.anularCargoPendienteAsync(cargoParaAnular.id, motivoAnulacion.trim(), actor);

      if (isSupabaseConfigured) {
        const resSync = await db.loadFromSupabase({ force: true });
        if (!resSync.ok && resSync.error) {
          throw new Error(resSync.error);
        }
      }

      mostrarExito('Cargo anulado correctamente y registrado en la bitácora de auditoría.');
      setCargoParaAnular(null);
      setMotivoAnulacion('');
    } catch (err: any) {
      const msg = err?.message || 'Error al anular cargo en Supabase.';
      setErrorAnular(msg);
      mostrarError(msg);
    } finally {
      setGuardandoAnular(false);
    }
  };

  const handleExportarExcel = () => {
    exportarCargosCSV(cargos, `otros_trabajos_p${page}_${new Date().toISOString().split('T')[0]}.csv`);
  };

  return (
    <div className="space-y-6">
      {/* Toast flotante */}
      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          className={`fixed bottom-5 right-5 z-50 max-w-sm px-4 py-3 rounded-xl shadow-lg border text-xs font-semibold flex items-center gap-2.5 ${
            toast.type === 'error'
              ? 'bg-red-950 text-red-50 border-red-700'
              : 'bg-stone-900 text-white border-stone-700'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span className="flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="opacity-70 hover:opacity-100"
            aria-label="Cerrar notificación"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Encabezado Principal */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">
            Otros Trabajos y Cargos Pendientes
          </h1>
          <p className="text-sm text-stone-600">
            Reparaciones, materiales y trabajos por medidor. Se facturan en el período estipulado; nunca se alteran facturas ya emitidas.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={handleExportarExcel}
            className="px-3 py-2 bg-white hover:bg-stone-50 border border-stone-300 text-stone-700 font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 transition-colors"
            title="Exportar registros filtrados a archivo CSV compatible con Excel"
          >
            <Download className="w-4 h-4 text-stone-500" />
            <span>Exportar CSV</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setErrorCrear(null);
              setErrorBanner(null);
              setShowModalCrear(true);
            }}
            className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Registrar Nuevo Cargo</span>
          </button>
        </div>
      </div>

      {/* Banner de error inline */}
      {errorBanner && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-300 rounded-xl text-red-900 text-sm font-semibold flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-xs text-red-800 hover:underline shrink-0"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Alerta de notificación temporal */}
      {mensaje && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 text-sm font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{mensaje}</span>
          </div>
          <button
            type="button"
            onClick={() => setMensaje(null)}
            className="text-xs text-emerald-800 hover:underline"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Tarjetas de Resumen Global */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
          <span className="text-xs font-semibold text-stone-500 block">Total Trabajos</span>
          <div className="text-2xl font-black text-stone-900 mt-1">{resumen.totalCargos}</div>
          <span className="text-[11px] text-stone-400">En todo el histórico</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-xs bg-amber-50/20">
          <span className="text-xs font-bold text-amber-700 block flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> Pendientes de Facturar
          </span>
          <div className="text-2xl font-black text-amber-900 mt-1">{resumen.pendientesCount}</div>
          <span className="text-[11px] font-bold text-amber-800 block">
            {formatGs(resumen.pendientesMonto)} por emitir
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
          <span className="text-xs font-bold text-stone-700 block flex items-center gap-1">
            <Lock className="w-3.5 h-3.5 text-stone-500" /> Facturados en Boleta
          </span>
          <div className="text-2xl font-black text-stone-900 mt-1">{resumen.facturadosCount}</div>
          <span className="text-[11px] font-bold text-stone-600 block">
            {formatGs(resumen.facturadosMonto)} emitidos (inmutables)
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
          <span className="text-xs font-bold text-red-700 block flex items-center gap-1">
            <Ban className="w-3.5 h-3.5 text-red-500" /> Anulados (Auditoría)
          </span>
          <div className="text-2xl font-black text-stone-900 mt-1">{resumen.anuladosCount}</div>
          <span className="text-[11px] text-stone-400">Excluidos de facturación</span>
        </div>
      </div>

      {/* Barra de Filtros y Búsqueda */}
      <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Buscar por N° Medidor, Cliente, CI/RUC o Descripción..."
              className="w-full pl-10 pr-4 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-900 focus:outline-hidden focus:border-stone-900 focus:bg-white"
            />
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-semibold text-stone-500 flex items-center gap-1">
                <Filter className="w-3.5 h-3.5" /> Estado:
              </span>
              {(['todos', 'pendiente', 'facturado', 'anulado'] as const).map((est) => (
                <button
                  key={est}
                  type="button"
                  onClick={() => {
                    setFiltroEstado(est);
                    setCurrentPage(1);
                  }}
                  className={`px-3 py-1 rounded-md font-semibold capitalize transition-all ${
                    filtroEstado === est
                      ? est === 'pendiente'
                        ? 'bg-amber-600 text-white'
                        : est === 'facturado'
                        ? 'bg-stone-900 text-white'
                        : est === 'anulado'
                        ? 'bg-red-600 text-white'
                        : 'bg-stone-900 text-white'
                      : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                  }`}
                >
                  {est}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 text-xs pl-2 border-l border-stone-200">
              <span className="font-semibold text-stone-500">Período:</span>
              <select
                value={filtroPeriodo}
                onChange={(e) => {
                  setFiltroPeriodo(e.target.value);
                  setCurrentPage(1);
                }}
                className="p-1 bg-stone-50 border border-stone-300 rounded-md text-xs font-semibold text-stone-800"
              >
                <option value="todos">Todos los períodos</option>
                {periodosDisponibles.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Tabla Paginada de Cargos */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-stone-200 bg-stone-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-stone-700" />
            <h3 className="font-bold text-stone-900 text-sm">
              Listado de Trabajos y Materiales Asignados
            </h3>
          </div>
          <span className="text-xs text-stone-500">
            Mostrando {cargos.length} de {total} registros (Máx. 50 por página)
          </span>
        </div>

        <div className="divide-y divide-stone-100">
          {cargos.length === 0 ? (
            <div className="p-12 text-center text-sm text-stone-500 space-y-2">
              <Info className="w-8 h-8 text-stone-400 mx-auto" />
              <p className="font-medium">No se encontraron trabajos o cargos con los filtros seleccionados.</p>
              <p className="text-xs text-stone-400">Intente modificar el término de búsqueda o el filtro de estado.</p>
            </div>
          ) : (
            cargos.map((c) => (
              <div
                key={c.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50 transition-colors"
              >
                {/* Datos del Cargo y Medidor */}
                <div className="space-y-1 max-w-xl">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-sm text-stone-900">
                      Medidor N° {c.numeroMedidor}
                    </span>
                    <span className="text-xs font-semibold text-stone-700">
                      • {c.clienteNombre} ({c.clienteDoc})
                    </span>

                    {c.estado === 'pendiente' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-sm bg-amber-100 text-amber-800 font-bold flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>Pendiente para {c.periodo_facturacion}</span>
                      </span>
                    )}

                    {c.estado === 'facturado' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-sm bg-stone-100 text-stone-800 font-bold border border-stone-300 flex items-center gap-1">
                        <Lock className="w-3 h-3 text-stone-500" />
                        <span>Facturado en {c.periodo_facturacion} ({c.factura_id || 'Boleta'})</span>
                      </span>
                    )}

                    {c.estado === 'anulado' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-sm bg-red-100 text-red-800 font-bold flex items-center gap-1">
                        <Ban className="w-3 h-3" />
                        <span>Anulado</span>
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-stone-800 font-medium">{c.descripcion}</p>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500">
                    <span><b>Terreno:</b> {c.medidorDireccion}</span>
                    <span>•</span>
                    <span><b>Fecha de trabajo:</b> {c.fecha_trabajo}</span>
                    <span>•</span>
                    <span><b>Registrado por:</b> {c.registradoPorNombre}</span>
                    {c.fecha_edicion && (
                      <>
                        <span>•</span>
                        <span className="text-stone-400">
                          Editado por {c.editado_por} el {c.fecha_edicion.split('T')[0]}
                        </span>
                      </>
                    )}
                  </div>

                  {c.motivo_anulacion && (
                    <div className="text-[11px] text-red-700 bg-red-50 p-2 rounded-md border border-red-200 mt-1">
                      <b>Auditoría de Anulación:</b> {c.motivo_anulacion}
                    </div>
                  )}
                </div>

                {/* Monto y Botones de Acción */}
                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0">
                  <div className="text-right">
                    <div
                      className={`text-base font-black ${
                        c.estado === 'anulado' ? 'text-stone-400 line-through' : 'text-stone-900'
                      }`}
                    >
                      {formatGs(c.monto)}
                    </div>
                    <span className="text-[10px] text-stone-500">
                      {c.estado === 'facturado'
                        ? 'Incluido en factura'
                        : c.estado === 'pendiente'
                        ? 'Se incluirá en emisión'
                        : 'Excluido de cobro'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {c.estado === 'pendiente' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleAbrirEditar(c)}
                          className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-300 rounded-md text-[11px] font-bold flex items-center gap-1 transition-colors"
                        >
                          <Edit2 className="w-3 h-3 text-stone-600" />
                          <span>Editar</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setCargoParaAnular(c);
                            setMotivoAnulacion('');
                            setErrorAnular(null);
                          }}
                          className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-md text-[11px] font-bold transition-colors"
                        >
                          Anular
                        </button>
                      </>
                    )}

                    {c.estado === 'facturado' && (
                      <button
                        type="button"
                        onClick={() => setCargoParaAuditoria(c)}
                        className="px-2.5 py-1 bg-stone-50 hover:bg-stone-100 text-stone-600 border border-stone-200 rounded-md text-[11px] font-semibold flex items-center gap-1"
                        title="Ver detalle del cargo facturado"
                      >
                        <Lock className="w-3 h-3 text-stone-400" />
                        <span>Inmutable</span>
                      </button>
                    )}

                    {c.estado === 'anulado' && (
                      <button
                        type="button"
                        onClick={() => setCargoParaAuditoria(c)}
                        className="px-2.5 py-1 bg-stone-50 hover:bg-stone-100 text-stone-500 border border-stone-200 rounded-md text-[11px] font-semibold flex items-center gap-1"
                      >
                        <Info className="w-3 h-3 text-stone-400" />
                        <span>Auditoría</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Barra de Paginación */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-stone-200 bg-stone-50 flex items-center justify-between text-xs">
            <span className="text-stone-600">
              Página <b>{page}</b> de <b>{totalPages}</b> (Total: {total} cargos)
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 bg-white border border-stone-300 rounded-md font-semibold text-stone-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 hover:bg-stone-50"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Anterior
              </button>

              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 bg-white border border-stone-300 rounded-md font-semibold text-stone-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 hover:bg-stone-50"
              >
                Siguiente <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Registrar Nuevo Cargo */}
      {showModalCrear && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCrearCargo}
            className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div className="flex items-center gap-2">
                <Wrench className="w-5 h-5 text-stone-900" />
                <h3 className="font-bold text-stone-900 text-base">Registrar Cargo de Trabajo</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowModalCrear(false)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorCrear && (
              <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-red-800 text-xs font-semibold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorCrear}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              {/* Búsqueda de Medidor */}
              <div>
                <label className="font-bold text-stone-700 block mb-1">
                  N° de Medidor Asignado (1 a 1000) *
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={1000}
                  value={crearNumMedidor}
                  onChange={(e) => setCrearNumMedidor(e.target.value)}
                  placeholder="Ej: 18"
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-sm font-bold text-stone-900 focus:bg-white focus:outline-hidden focus:border-stone-900"
                />

                {medidorEncontradoCrear ? (
                  <div className="mt-2 p-2.5 bg-stone-50 border border-stone-200 rounded-lg space-y-1 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-stone-900">
                        {medidorEncontradoCrear.clienteNombre}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-sm font-bold uppercase text-[10px] ${
                          medidorEncontradoCrear.estado === 'cortado'
                            ? 'bg-red-100 text-red-800'
                            : medidorEncontradoCrear.estado === 'moroso'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {medidorEncontradoCrear.estado}
                      </span>
                    </div>
                    <div className="text-stone-600">
                      Dirección: {medidorEncontradoCrear.direccion}
                    </div>

                    {medidorEncontradoCrear.estado === 'cortado' && (
                      <div className="text-amber-800 font-semibold bg-amber-50 p-1.5 rounded-sm border border-amber-200 mt-1">
                        Aviso: El medidor está cortado. El cargo quedará pendiente y se incluirá automáticamente en la factura de regularización al momento de la reconexión.
                      </div>
                    )}
                  </div>
                ) : crearNumMedidor ? (
                  <p className="text-[11px] text-red-600 mt-1">
                    Medidor N° {crearNumMedidor} no encontrado en el sistema.
                  </p>
                ) : null}
              </div>

              {/* Descripción */}
              <div>
                <label className="font-bold text-stone-700 block mb-1">
                  Descripción del Trabajo / Materiales *
                </label>
                <textarea
                  required
                  rows={2}
                  value={crearDescripcion}
                  onChange={(e) => setCrearDescripcion(e.target.value)}
                  placeholder="Ej: Reparación de caño roto en vereda / Llave de paso 3/4"
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs focus:bg-white focus:outline-hidden focus:border-stone-900"
                />
              </div>

              {/* Monto y Período */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-stone-700 block mb-1">
                    Monto a Cobrar (Gs.) *
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={crearMonto}
                    onChange={(e) => setCrearMonto(e.target.value)}
                    placeholder="Ej: 45000"
                    className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-sm font-bold text-stone-900 focus:bg-white focus:outline-hidden focus:border-stone-900"
                  />
                </div>

                <div>
                  <label className="font-bold text-stone-700 block mb-1">
                    Período Facturación *
                  </label>
                  <input
                    type="month"
                    required
                    value={crearPeriodo}
                    onChange={(e) => setCrearPeriodo(e.target.value)}
                    className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold focus:bg-white focus:outline-hidden focus:border-stone-900"
                  />
                </div>
              </div>

              {/* Fecha Trabajo */}
              <div>
                <label className="font-bold text-stone-700 block mb-1">Fecha del Trabajo *</label>
                <input
                  type="date"
                  required
                  value={crearFechaTrabajo}
                  onChange={(e) => setCrearFechaTrabajo(e.target.value)}
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold"
                />
              </div>

              {/* Advertencia de colisión con factura emitida */}
              {conflictoFacturaCrear && (
                <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-red-800 text-[11px] font-semibold flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <b>REGLA DE ORO DE INMUTABILIDAD:</b> El período {crearPeriodo} ya tiene una factura emitida para este medidor (#{conflictoFacturaCrear.id}). NUNCA se altera una factura emitida. Si el cargo se cargó tarde, debe asignarse al período siguiente.
                  </div>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-stone-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowModalCrear(false)}
                className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg font-semibold text-xs"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!medidorEncontradoCrear || !!conflictoFacturaCrear || guardandoCrear}
                className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {guardandoCrear ? 'Guardando...' : 'Registrar Cargo'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Editar Cargo Pendiente */}
      {cargoParaEditar && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleGuardarEdicion}
            className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div className="flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-stone-900" />
                <h3 className="font-bold text-stone-900 text-base">
                  Editar Cargo Pendiente (Medidor N° {cargoParaEditar.numeroMedidor})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCargoParaEditar(null)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorEditar && (
              <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-red-800 text-xs font-semibold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorEditar}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div className="p-2.5 bg-stone-50 border border-stone-200 rounded-lg text-stone-700 text-[11px]">
                <b>Cliente:</b> {cargoParaEditar.clienteNombre} • <b>Dirección:</b> {cargoParaEditar.medidorDireccion}
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">Descripción del Trabajo *</label>
                <textarea
                  required
                  rows={2}
                  value={editDescripcion}
                  onChange={(e) => setEditDescripcion(e.target.value)}
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-stone-700 block mb-1">Monto a Cobrar (Gs.) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={editMonto}
                    onChange={(e) => setEditMonto(e.target.value)}
                    className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-sm font-bold text-stone-900"
                  />
                </div>

                <div>
                  <label className="font-bold text-stone-700 block mb-1">Período de Facturación *</label>
                  <input
                    type="month"
                    required
                    value={editPeriodo}
                    onChange={(e) => setEditPeriodo(e.target.value)}
                    className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">Fecha de Ejecución *</label>
                <input
                  type="date"
                  required
                  value={editFechaTrabajo}
                  onChange={(e) => setEditFechaTrabajo(e.target.value)}
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold"
                />
              </div>

              <p className="text-[11px] text-stone-500">
                Al guardar, se recalculará automáticamente la asignación para el período seleccionado. No es posible cambiar el período a uno que ya posea una factura emitida.
              </p>
            </div>

            <div className="pt-2 border-t border-stone-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCargoParaEditar(null)}
                className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg font-semibold text-xs"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={guardandoEditar}
                className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {guardandoEditar ? 'Guardando...' : 'Guardar Modificaciones'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Anular Cargo Pendiente */}
      {cargoParaAnular && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmarAnulacion}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <h3 className="font-bold text-stone-900 text-base flex items-center gap-2">
                <Ban className="w-5 h-5 text-red-600" />
                <span>Anulación de Cargo Pendiente</span>
              </h3>
              <button
                type="button"
                onClick={() => setCargoParaAnular(null)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorAnular && (
              <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-red-800 text-xs font-semibold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorAnular}</span>
              </div>
            )}

            <div className="text-xs space-y-2">
              <p className="text-stone-700">
                Está a punto de anular el cargo de <b>{formatGs(cargoParaAnular.monto)}</b> del{' '}
                <b>Medidor N° {cargoParaAnular.numeroMedidor}</b> ({cargoParaAnular.descripcion}).
              </p>
              <p className="text-stone-500">
                Este cargo no se incluirá en ninguna factura futura y quedará guardado permanentemente en la bitácora de auditoría.
              </p>

              <div>
                <label className="font-bold text-stone-800 block mb-1">
                  Motivo de anulación (Obligatorio para auditoría, mín. 5 caracteres) *
                </label>
                <textarea
                  required
                  rows={3}
                  value={motivoAnulacion}
                  onChange={(e) => setMotivoAnulacion(e.target.value)}
                  placeholder="Ej: Trabajo suspendido por el usuario / Materiales devueltos a depósito"
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-stone-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCargoParaAnular(null)}
                className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg font-semibold text-xs"
              >
                Volver
              </button>
              <button
                type="submit"
                disabled={guardandoAnular}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {guardandoAnular ? 'Anulando...' : 'Confirmar Anulación'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Ver Auditoría / Inmutabilidad */}
      {cargoParaAuditoria && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div className="flex items-center gap-2">
                <Info className="w-5 h-5 text-stone-900" />
                <h3 className="font-bold text-stone-900 text-base">Ficha de Auditoría de Cargo</h3>
              </div>
              <button
                type="button"
                onClick={() => setCargoParaAuditoria(null)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs space-y-2.5">
              <div className="p-3 bg-stone-50 rounded-xl space-y-1.5 border border-stone-200">
                <div className="flex justify-between">
                  <span className="text-stone-500">Medidor:</span>
                  <span className="font-bold text-stone-900">N° {cargoParaAuditoria.numeroMedidor}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Cliente:</span>
                  <span className="font-bold text-stone-900">{cargoParaAuditoria.clienteNombre}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Concepto:</span>
                  <span className="font-medium text-stone-800">{cargoParaAuditoria.descripcion}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Monto:</span>
                  <span className="font-bold text-stone-900">{formatGs(cargoParaAuditoria.monto)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Período Facturación:</span>
                  <span className="font-semibold text-stone-800">{cargoParaAuditoria.periodo_facturacion}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Estado:</span>
                  <span className="font-bold uppercase text-[11px] text-stone-900">{cargoParaAuditoria.estado}</span>
                </div>
              </div>

              {cargoParaAuditoria.factura_id && (
                <div className="p-3 bg-stone-100 rounded-xl border border-stone-300 space-y-1">
                  <span className="font-bold text-stone-900 block flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5 text-stone-600" /> Factura Asignada:
                  </span>
                  <p className="font-mono text-stone-800">{cargoParaAuditoria.factura_id}</p>
                  <p className="text-[11px] text-stone-500">
                    Este cargo ya fue emitido en una factura oficial y es inmutable. Solo un administrador puede anular la factura completa con su debida justificación.
                  </p>
                </div>
              )}

              {cargoParaAuditoria.motivo_anulacion && (
                <div className="p-3 bg-red-50 rounded-xl border border-red-200 space-y-1 text-red-800">
                  <span className="font-bold block flex items-center gap-1">
                    <Ban className="w-3.5 h-3.5 text-red-600" /> Registro de Anulación:
                  </span>
                  <p>{cargoParaAuditoria.motivo_anulacion}</p>
                </div>
              )}

              <div className="text-[11px] text-stone-400 space-y-0.5">
                <div>Registrado por: {cargoParaAuditoria.registradoPorNombre} el {cargoParaAuditoria.fecha_registro}</div>
                {cargoParaAuditoria.editado_por && (
                  <div>Última edición por: {cargoParaAuditoria.editado_por} el {cargoParaAuditoria.fecha_edicion}</div>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-stone-200 flex justify-end">
              <button
                type="button"
                onClick={() => setCargoParaAuditoria(null)}
                className="px-4 py-2 bg-stone-900 text-white rounded-lg font-bold text-xs"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
