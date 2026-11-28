/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { db } from '../services/database';
import { formatGs } from '../services/billingRules';
import { exportarFacturasCSV } from '../utils/exportCsv';
import {
  resolverPeriodoPorDefecto,
  formatearNumeroFactura,
  puedeAccederFacturacion,
  puedeGenerarFacturacionMensual,
} from '../services/facturacionHelpers';
import { useAuth } from '../context/AuthContext';
import { FacturacionBatchPanel } from './FacturacionBatchPanel';
import { FacturaDetalleModal } from './FacturaDetalleModal';
import {
  descargarPdfDocumento,
  generarComprobantePagoPDF,
} from '../services/pdfService';
import { EstadoFactura } from '../types';
import {
  FileText,
  Calendar,
  Search,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  X,
  Receipt,
  FileDown,
} from 'lucide-react';

type FacturacionSubTab = 'listado' | 'pagos' | 'generar';

const ESTADO_BADGE_MAP: Record<string, string> = {
  pendiente: 'bg-amber-50 text-amber-800 border-amber-300',
  pagada: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  vencida: 'bg-red-50 text-red-800 border-red-300',
  anulada: 'bg-stone-100 text-stone-600 border-stone-300',
  refinanciada: 'bg-indigo-50 text-indigo-800 border-indigo-300',
};

const ESTADO_TEXT_MAP: Record<string, string> = {
  pendiente: 'Pendiente',
  pagada: 'Pagada',
  vencida: 'Vencida',
  anulada: 'Anulada',
  refinanciada: 'Refinanciada',
};

export const FacturacionView: React.FC = () => {
  const { user } = useAuth();
  const [subTab, setSubTab] = useState<FacturacionSubTab>('listado');

  // Filtros del listado
  const [filtroPeriodo, setFiltroPeriodo] = useState<string>('todos');
  const [filtroEstado, setFiltroEstado] = useState<EstadoFactura | 'todas'>('todas');
  const [filtroMedidor, setFiltroMedidor] = useState<string>('');
  const [filtroCliente, setFiltroCliente] = useState<string>('');
  const [filtroTerceraBoleta, setFiltroTerceraBoleta] = useState<'todos' | 'si' | 'no'>('todos');
  const [page, setPage] = useState<number>(1);

  // Ficha de factura individual
  const [selectedFacturaId, setSelectedFacturaId] = useState<string | null>(null);
  const [showMobileFilters, setShowMobileFilters] = useState<boolean>(false);

  // Filtros del historial de pagos (incluye factura_id = null)
  const [searchPagos, setSearchPagos] = useState<string>('');
  const [filtroTipoPago, setFiltroTipoPago] = useState<'todos' | 'facturas' | 'personalizados'>('todos');
  const [pagePagos, setPagePagos] = useState<number>(1);

  // Toast global del módulo
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Guard RBAC: Lectores no tienen acceso al módulo de Facturación
  if (!puedeAccederFacturacion(user?.rol)) {
    return (
      <div
        role="alert"
        className="bg-red-50 border border-red-300 rounded-xl p-8 max-w-lg mx-auto text-center space-y-3 my-6"
      >
        <ShieldAlert className="w-10 h-10 text-red-600 mx-auto" />
        <h1 className="text-lg font-black text-red-900">Acceso denegado</h1>
        <p className="text-xs text-red-800">
          El módulo de Facturación solo está disponible para usuarios con rol de Administrador o Cobrador.
        </p>
      </div>
    );
  }

  const lecturas = db.getFullData().lecturas;
  const periodoLecturas = resolverPeriodoPorDefecto(lecturas);
  const now = new Date();
  const mesActual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const defaultPeriodoBatch = mesActual > periodoLecturas ? mesActual : periodoLecturas;
  const { periodosDisponibles } = db.getPeriodosFacturacion();

  const limit = 50;
  const facturasData = db.getFacturas({
    page,
    limit,
    periodo: filtroPeriodo,
    estado: filtroEstado,
    medidor: filtroMedidor,
    cliente: filtroCliente,
    esTerceraBoleta: filtroTerceraBoleta,
  });

  const historialPagosData = db.getHistorialPagos({
    search: searchPagos,
    tipoFiltro: filtroTipoPago,
    page: pagePagos,
    limit: 50,
  });

  const activeFiltersCount =
    (filtroPeriodo !== 'todos' ? 1 : 0) +
    (filtroEstado !== 'todas' ? 1 : 0) +
    (filtroMedidor.trim() !== '' ? 1 : 0) +
    (filtroCliente.trim() !== '' ? 1 : 0) +
    (filtroTerceraBoleta !== 'todos' ? 1 : 0);

  const hayFiltrosActivos = activeFiltersCount > 0;

  const handleLimpiarFiltros = () => {
    setFiltroPeriodo('todos');
    setFiltroEstado('todas');
    setFiltroMedidor('');
    setFiltroCliente('');
    setFiltroTerceraBoleta('todos');
    setPage(1);
  };

  const handleExportarExcel = () => {
    const todasFiltradas = db.getFacturasParaExportar({
      periodo: filtroPeriodo,
      estado: filtroEstado,
      medidor: filtroMedidor,
      cliente: filtroCliente,
      esTerceraBoleta: filtroTerceraBoleta,
    });

    if (todasFiltradas.length === 0) {
      setToast({
        type: 'error',
        message: 'No hay facturas que coincidan con los filtros para exportar.',
      });
      return;
    }

    const sufijoPeriodo = filtroPeriodo !== 'todos' ? filtroPeriodo : 'todos';
    exportarFacturasCSV(todasFiltradas, `facturas_${sufijoPeriodo}.csv`);
    setToast({
      type: 'success',
      message: `${todasFiltradas.length} factura${todasFiltradas.length === 1 ? '' : 's'} exportada${todasFiltradas.length === 1 ? '' : 's'} a Excel.`,
    });
  };

  const handleVerFacturasGeneradas = (periodoGenerado: string) => {
    setFiltroPeriodo(periodoGenerado);
    setFiltroEstado('todas');
    setFiltroMedidor('');
    setFiltroCliente('');
    setFiltroTerceraBoleta('todos');
    setPage(1);
    setSubTab('listado');
  };

  return (
    <div className="space-y-5">
      {/* Encabezado y Pestañas del Módulo */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">Facturación</h1>
          <p className="text-xs sm:text-sm text-stone-600">
            Emisión mensual automatizada, consulta de boletas, avisos ERSSAN y registro de pagos
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 bg-stone-100 p-1 rounded-lg border border-stone-200 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setSubTab('listado')}
            className={`min-h-[40px] px-3.5 py-2 rounded-md text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
              subTab === 'listado'
                ? 'bg-stone-900 text-white shadow-xs'
                : 'text-stone-700 hover:bg-white'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Listado de facturas</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('pagos')}
            className={`min-h-[40px] px-3.5 py-2 rounded-md text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
              subTab === 'pagos'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-stone-700 hover:bg-white'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Historial de pagos</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('generar')}
            className={`min-h-[40px] px-3.5 py-2 rounded-md text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
              subTab === 'generar'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-stone-700 hover:bg-white'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Generar facturas del mes</span>
          </button>
        </div>
      </div>

      {/* Sub-pantalla 1: Generar facturas del mes (Solo Admin; Cobrador ve "Acceso denegado") */}
      {subTab === 'generar' && (
        <FacturacionBatchPanel
          defaultPeriodo={defaultPeriodoBatch}
          onVerFacturasGeneradas={handleVerFacturasGeneradas}
        />
      )}

      {/* Sub-pantalla 2: Historial de pagos (incluye factura_id = null / Concepto Personalizado) */}
      {subTab === 'pagos' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-stone-200 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="filtro-pagos-search" className="text-[11px] font-bold text-stone-600 block mb-1">
                  Buscar pago (Cliente, C.I., N° Medidor, N° Comprobante o Concepto)
                </label>
                <div className="relative">
                  <input
                    id="filtro-pagos-search"
                    type="text"
                    value={searchPagos}
                    onChange={(e) => {
                      setSearchPagos(e.target.value);
                      setPagePagos(1);
                    }}
                    placeholder="Ej: Reparación de cañería, Juan, 001-002-..."
                    className="w-full min-h-[44px] pl-8 pr-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold text-stone-900 focus:outline-hidden focus:border-emerald-600 focus:bg-white"
                  />
                  <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-3.5" />
                </div>
              </div>

              <div>
                <label htmlFor="filtro-pagos-tipo" className="text-[11px] font-bold text-stone-600 block mb-1">
                  Tipo de Cobro
                </label>
                <select
                  id="filtro-pagos-tipo"
                  value={filtroTipoPago}
                  onChange={(e) => {
                    setFiltroTipoPago(e.target.value as 'todos' | 'facturas' | 'personalizados');
                    setPagePagos(1);
                  }}
                  className="w-full min-h-[44px] px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold text-stone-900 focus:outline-hidden focus:border-emerald-600"
                >
                  <option value="todos">Todos los pagos</option>
                  <option value="personalizados">Solo Concepto Personalizado</option>
                  <option value="facturas">Solo Facturas de Agua</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-stone-100 text-xs text-stone-600">
              <span className="font-semibold text-stone-800 tabular-nums">
                {historialPagosData.total} {historialPagosData.total === 1 ? 'pago registrado' : 'pagos registrados'}
              </span>
              <div className="flex items-center gap-1.5 text-xs text-stone-700">
                <span className="tabular-nums px-1">
                  Pág. <b>{historialPagosData.page}</b> / <b>{historialPagosData.totalPages}</b>
                </span>
                <button
                  type="button"
                  onClick={() => setPagePagos((p) => Math.max(1, p - 1))}
                  disabled={historialPagosData.page <= 1}
                  aria-label="Página anterior de pagos"
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center bg-stone-100 hover:bg-stone-200 rounded-lg disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPagePagos((p) => Math.min(historialPagosData.totalPages, p + 1))}
                  disabled={historialPagosData.page >= historialPagosData.totalPages}
                  aria-label="Página siguiente de pagos"
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center bg-stone-100 hover:bg-stone-200 rounded-lg disabled:opacity-40 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {historialPagosData.pagos.length === 0 ? (
            <div className="bg-white rounded-xl border border-stone-200 p-8 text-center space-y-2">
              <Receipt className="w-10 h-10 text-stone-400 mx-auto" />
              <p className="text-sm font-bold text-stone-900">No hay pagos registrados con esos filtros</p>
              <p className="text-xs text-stone-500">
                Aquí aparecen tanto los cobros de facturas de agua como los cobros con Concepto Personalizado.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-stone-50 text-stone-600 font-bold uppercase tracking-wider border-b border-stone-200">
                    <tr>
                      <th className="px-3 py-3 whitespace-nowrap">Comprobante</th>
                      <th className="px-3 py-3 whitespace-nowrap">Fecha</th>
                      <th className="px-3 py-3">Cliente</th>
                      <th className="px-3 py-3 whitespace-nowrap">Medidor</th>
                      <th className="px-3 py-3">Descripción / Concepto</th>
                      <th className="px-3 py-3 whitespace-nowrap">Método</th>
                      <th className="px-3 py-3 text-right whitespace-nowrap">Monto</th>
                      <th className="px-3 py-3 text-center whitespace-nowrap">Recibo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {historialPagosData.pagos.map((p) => {
                      const handleDescargarPagoFila = () => {
                        if (!p.cliente || !p.medidor) {
                          setToast({
                            type: 'error',
                            message: 'Este pago no tiene cliente/medidor asociado para generar el PDF.',
                          });
                          return;
                        }
                        const doc = generarComprobantePagoPDF({
                          factura: p.esPersonalizado ? null : p.factura,
                          cliente: p.cliente,
                          medidor: p.medidor,
                          pago: p,
                          detalles: p.esPersonalizado ? undefined : p.factura?.detalles,
                          numeroRecibo: p.numero_recibo,
                          fechaPago: p.fecha_pago,
                          montoAbonado: p.monto,
                          metodoPago: p.metodo_pago,
                          cobradorNombre: p.cobradorNombre,
                          saldoRestante: p.esPersonalizado ? 0 : (p.factura?.saldo_pendiente ?? 0),
                          tipoComprobante: p.tipo_comprobante,
                          esConceptoPersonalizado: p.esPersonalizado,
                          conceptoPersonalizado: p.esPersonalizado ? p.descripcionConcepto : undefined,
                        });
                        const prefix = p.esPersonalizado ? 'Recibo_Personalizado' : 'Recibo';
                        descargarPdfDocumento(
                          doc,
                          `${prefix}_${p.numero_recibo || p.fecha_pago}_Med_${p.numeroMedidor || 0}.pdf`
                        );
                      };

                      return (
                        <tr key={p.id} className="hover:bg-stone-50">
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className="font-mono font-bold text-stone-900 block">
                              {p.numero_recibo || '--'}
                            </span>
                            <span className="text-[10px] text-stone-500">
                              {p.tipo_comprobante === 'recibo_sin_valor_fiscal' ? 'Recibo' : 'Factura Legal'}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-stone-700 whitespace-nowrap tabular-nums">
                            {p.fecha_pago}
                          </td>
                          <td className="px-3 py-3">
                            <span className="font-semibold text-stone-900 block">{p.clienteNombre}</span>
                            {p.clienteDoc && (
                              <span className="text-[11px] text-stone-500 tabular-nums">{p.clienteDoc}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 font-mono font-bold text-stone-900 whitespace-nowrap">
                            {p.numeroMedidor > 0 ? `#${p.numeroMedidor}` : '—'}
                          </td>
                          <td className="px-3 py-3">
                            {p.esPersonalizado ? (
                              <div className="space-y-0.5">
                                <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold uppercase">
                                  Concepto Personalizado
                                </span>
                                <span className="font-bold text-stone-900 block">{p.descripcionConcepto}</span>
                              </div>
                            ) : (
                              <span className="font-medium text-stone-800">{p.descripcionConcepto}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 uppercase text-[11px] font-semibold text-stone-700 whitespace-nowrap">
                            {p.metodo_pago}
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-emerald-700 whitespace-nowrap tabular-nums">
                            {formatGs(p.monto)}
                          </td>
                          <td className="px-3 py-3 text-center whitespace-nowrap">
                            <button
                              type="button"
                              onClick={handleDescargarPagoFila}
                              className="px-2.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-md text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <FileDown className="w-3.5 h-3.5" />
                              <span>PDF</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sub-pantalla 2: Listado de facturas (50 por página + 5 filtros + Excel) */}
      {subTab === 'listado' && (
        <div className="space-y-4">
          {/* Panel de Filtros y Exportación */}
          <div className="bg-white p-4 rounded-xl border border-stone-200 space-y-3">
            {/* Barra compacta para abrir/cerrar filtros en móvil */}
            <div className="flex sm:hidden items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowMobileFilters((v) => !v)}
                aria-expanded={showMobileFilters}
                className="min-h-[44px] flex-1 px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-xs font-bold text-stone-800 flex items-center justify-between cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5 text-stone-500" />
                  <span>
                    {showMobileFilters
                      ? 'Ocultar filtros'
                      : activeFiltersCount > 0
                        ? `Filtros (${activeFiltersCount} activo${activeFiltersCount === 1 ? '' : 's'})`
                        : 'Filtrar facturas'}
                  </span>
                </span>
                <span className="text-[11px] text-blue-700 font-bold">
                  {showMobileFilters ? 'Cerrar' : 'Abrir'}
                </span>
              </button>
            </div>

            <div className={`${showMobileFilters ? 'grid' : 'hidden'} sm:grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3`}>
              {/* Filtro Período */}
              <div>
                <label htmlFor="filtro-periodo" className="text-[11px] font-bold text-stone-600 block mb-1">
                  Período (YYYY-MM)
                </label>
                <select
                  id="filtro-periodo"
                  value={filtroPeriodo}
                  onChange={(e) => {
                    setFiltroPeriodo(e.target.value);
                    setPage(1);
                  }}
                  className="w-full min-h-[44px] px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold text-stone-900 focus:outline-hidden focus:border-blue-600"
                >
                  <option value="todos">Todos los períodos</option>
                  {periodosDisponibles.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                  {filtroPeriodo !== 'todos' && !periodosDisponibles.includes(filtroPeriodo) && (
                    <option value={filtroPeriodo}>{filtroPeriodo}</option>
                  )}
                </select>
              </div>

              {/* Filtro Estado */}
              <div>
                <label htmlFor="filtro-estado" className="text-[11px] font-bold text-stone-600 block mb-1">
                  Estado
                </label>
                <select
                  id="filtro-estado"
                  value={filtroEstado}
                  onChange={(e) => {
                    setFiltroEstado(e.target.value as EstadoFactura | 'todas');
                    setPage(1);
                  }}
                  className="w-full min-h-[44px] px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold text-stone-900 focus:outline-hidden focus:border-blue-600"
                >
                  <option value="todas">Todos los estados</option>
                  <option value="pendiente">Pendiente</option>
                  <option value="pagada">Pagada</option>
                  <option value="vencida">Vencida</option>
                  <option value="refinanciada">Refinanciada</option>
                  <option value="anulada">Anulada</option>
                </select>
              </div>

              {/* Filtro Medidor */}
              <div>
                <label htmlFor="filtro-medidor" className="text-[11px] font-bold text-stone-600 block mb-1">
                  Medidor (N°)
                </label>
                <div className="relative">
                  <input
                    id="filtro-medidor"
                    type="text"
                    inputMode="numeric"
                    value={filtroMedidor}
                    onChange={(e) => {
                      setFiltroMedidor(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Ej: 2"
                    className="w-full min-h-[44px] pl-8 pr-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-xs font-mono font-semibold text-stone-900 focus:outline-hidden focus:border-blue-600 focus:bg-white"
                  />
                  <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-3.5" />
                </div>
              </div>

              {/* Filtro Cliente */}
              <div>
                <label htmlFor="filtro-cliente" className="text-[11px] font-bold text-stone-600 block mb-1">
                  Cliente (Nombre / Doc)
                </label>
                <div className="relative">
                  <input
                    id="filtro-cliente"
                    type="text"
                    value={filtroCliente}
                    onChange={(e) => {
                      setFiltroCliente(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Nombre o CI/RUC..."
                    className="w-full min-h-[44px] pl-8 pr-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold text-stone-900 focus:outline-hidden focus:border-blue-600 focus:bg-white"
                  />
                  <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-3.5" />
                </div>
              </div>

              {/* Filtro 3ra Boleta */}
              <div>
                <label htmlFor="filtro-tercera" className="text-[11px] font-bold text-stone-600 block mb-1">
                  Tercera boleta (Aviso corte)
                </label>
                <select
                  id="filtro-tercera"
                  value={filtroTerceraBoleta}
                  onChange={(e) => {
                    setFiltroTerceraBoleta(e.target.value as 'todos' | 'si' | 'no');
                    setPage(1);
                  }}
                  className="w-full min-h-[44px] px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold text-stone-900 focus:outline-hidden focus:border-blue-600"
                >
                  <option value="todos">Todas</option>
                  <option value="si">Sí (Solo 3ra boleta)</option>
                  <option value="no">No (Normales)</option>
                </select>
              </div>
            </div>

            {/* Barra de acciones, resumen y paginación */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-stone-100">
              <div className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
                <span className="font-semibold text-stone-800 tabular-nums">
                  {facturasData.total} {facturasData.total === 1 ? 'factura encontrada' : 'facturas encontradas'}
                </span>
                <span>·</span>
                <span>50 por página</span>
                {hayFiltrosActivos && (
                  <button
                    type="button"
                    onClick={handleLimpiarFiltros}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-md cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Limpiar filtros</span>
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2">
                <button
                  type="button"
                  onClick={handleExportarExcel}
                  className="min-h-[40px] px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Exportar a Excel</span>
                </button>

                <div className="flex items-center gap-1.5 text-xs text-stone-700">
                  <span className="tabular-nums px-1">
                    Pág. <b>{facturasData.page}</b> / <b>{facturasData.totalPages}</b>
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={facturasData.page <= 1}
                    aria-label="Página anterior"
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center bg-stone-100 hover:bg-stone-200 rounded-lg disabled:opacity-40 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(facturasData.totalPages, p + 1))}
                    disabled={facturasData.page >= facturasData.totalPages}
                    aria-label="Página siguiente"
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center bg-stone-100 hover:bg-stone-200 rounded-lg disabled:opacity-40 cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Estado vacío */}
          {facturasData.facturas.length === 0 ? (
            <div className="bg-white rounded-xl border border-stone-200 p-8 text-center space-y-3">
              <FileText className="w-10 h-10 text-stone-400 mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-stone-900">
                  {hayFiltrosActivos
                    ? 'No hay facturas que coincidan con los filtros aplicados'
                    : 'Todavía no hay facturas emitidas'}
                </p>
                <p className="text-xs text-stone-500">
                  {hayFiltrosActivos
                    ? 'Probá ajustando o limpiando los filtros de búsqueda.'
                    : 'Cuando ejecutes la facturación mensual, todas las boletas generadas aparecerán aquí.'}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                {hayFiltrosActivos && (
                  <button
                    type="button"
                    onClick={handleLimpiarFiltros}
                    className="min-h-[44px] px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-bold rounded-lg cursor-pointer"
                  >
                    Limpiar filtros
                  </button>
                )}
                {puedeGenerarFacturacionMensual(user?.rol) && (
                  <button
                    type="button"
                    onClick={() => setSubTab('generar')}
                    className="min-h-[44px] px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg cursor-pointer"
                  >
                    Ir a Generar facturas del mes
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Desktop Data Grid (oculto en móvil < 768px) */}
              <div className="hidden md:block bg-white rounded-xl border border-stone-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-stone-50 text-stone-600 font-bold uppercase tracking-wider border-b border-stone-200">
                      <tr>
                        <th className="px-3 py-3 whitespace-nowrap">N° Factura</th>
                        <th className="px-3 py-3">Cliente</th>
                        <th className="px-3 py-3 whitespace-nowrap">Medidor</th>
                        <th className="px-3 py-3 whitespace-nowrap">Período</th>
                        <th className="px-3 py-3 whitespace-nowrap">Emisión</th>
                        <th className="px-3 py-3 whitespace-nowrap">Vencimiento</th>
                        <th className="px-3 py-3 text-right whitespace-nowrap">Total</th>
                        <th className="px-3 py-3 text-right whitespace-nowrap">Saldo Pendiente</th>
                        <th className="px-3 py-3 whitespace-nowrap">Estado</th>
                        <th className="px-3 py-3">Alertas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {facturasData.facturas.map((f: any) => {
                        const tieneAlertaRoja = Boolean(f.es_tercera_boleta || f.alerta_consumo_elevado);
                        const numFactura = formatearNumeroFactura(f);
                        const saldo = f.saldo_pendiente ?? 0;

                        return (
                          <tr
                            key={f.id}
                            onClick={() => setSelectedFacturaId(f.id)}
                            className={`cursor-pointer transition-colors ${
                              tieneAlertaRoja
                                ? 'bg-red-50/40 hover:bg-red-50'
                                : 'hover:bg-stone-50'
                            }`}
                          >
                            <td className="px-3 py-3 font-mono font-bold text-stone-900 whitespace-nowrap tabular-nums">
                              {numFactura}
                            </td>
                            <td className="px-3 py-3">
                              <span className="font-semibold text-stone-900 block">{f.clienteNombre}</span>
                              {f.clienteDoc && (
                                <span className="text-[11px] text-stone-500 tabular-nums">{f.clienteDoc}</span>
                              )}
                            </td>
                            <td className="px-3 py-3 font-mono font-bold text-stone-900 whitespace-nowrap tabular-nums">
                              #{f.numeroMedidor}
                            </td>
                            <td className="px-3 py-3 font-medium text-stone-700 whitespace-nowrap tabular-nums">
                              <span>{f.periodo_facturado}</span>
                              {f.periodo_consumo && f.periodo_consumo !== f.periodo_facturado && (
                                <span className="block text-[10px] text-stone-500">
                                  Consumo {f.periodo_consumo}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-stone-600 whitespace-nowrap tabular-nums">
                              {f.fecha_emision}
                            </td>
                            <td
                              className={`px-3 py-3 whitespace-nowrap tabular-nums font-semibold ${
                                f.es_tercera_boleta ? 'text-red-700 font-bold' : 'text-stone-700'
                              }`}
                            >
                              {f.fecha_vencimiento}
                            </td>
                            <td className="px-3 py-3 text-right font-bold text-stone-900 whitespace-nowrap tabular-nums">
                              {formatGs(f.total)}
                            </td>
                            <td
                              className={`px-3 py-3 text-right font-bold whitespace-nowrap tabular-nums ${
                                f.estado === 'anulada' || f.estado === 'refinanciada'
                                  ? 'text-stone-400'
                                  : saldo === 0
                                    ? 'text-emerald-700'
                                    : 'text-red-700'
                              }`}
                            >
                              {formatGs(saldo)}
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              <span
                                className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded border ${
                                  ESTADO_BADGE_MAP[f.estado] || 'bg-stone-100 text-stone-700 border-stone-300'
                                }`}
                              >
                                {ESTADO_TEXT_MAP[f.estado] || f.estado}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex flex-col gap-1 items-start">
                                {f.es_tercera_boleta && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-600 text-white font-bold whitespace-nowrap">
                                    3ra Boleta
                                  </span>
                                )}
                                {f.alerta_consumo_elevado && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-300 font-bold whitespace-nowrap">
                                    Consumo elevado
                                  </span>
                                )}
                                {!f.es_tercera_boleta && !f.alerta_consumo_elevado && (
                                  <span className="text-[11px] text-stone-400">—</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile Stacked Cards (< 768px) */}
              <div className="md:hidden space-y-3">
                {facturasData.facturas.map((f: any) => {
                  const tieneAlertaRoja = Boolean(f.es_tercera_boleta || f.alerta_consumo_elevado);
                  const numFactura = formatearNumeroFactura(f);
                  const saldo = f.saldo_pendiente ?? 0;

                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSelectedFacturaId(f.id)}
                      className={`w-full text-left rounded-xl border p-4 space-y-2.5 cursor-pointer transition-colors ${
                        tieneAlertaRoja
                          ? 'bg-red-50/40 border-red-300 active:bg-red-50'
                          : 'bg-white border-stone-200 active:bg-stone-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-mono font-bold text-xs text-stone-900 block">
                            {numFactura} · Medidor #{f.numeroMedidor}
                          </span>
                          <span className="text-sm font-bold text-stone-900 block truncate">
                            {f.clienteNombre}
                          </span>
                        </div>
                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded border shrink-0 ${
                            ESTADO_BADGE_MAP[f.estado] || 'bg-stone-100 text-stone-700 border-stone-300'
                          }`}
                        >
                          {ESTADO_TEXT_MAP[f.estado] || f.estado}
                        </span>
                      </div>

                      {(f.es_tercera_boleta || f.alerta_consumo_elevado) && (
                        <div className="flex flex-wrap gap-1.5">
                          {f.es_tercera_boleta && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-red-600 text-white font-bold">
                              3ra Boleta — Desconexión {f.fecha_vencimiento}
                            </span>
                          )}
                          {f.alerta_consumo_elevado && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-700 border border-red-300 font-bold">
                              Consumo elevado
                            </span>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-stone-100 text-xs">
                        <div>
                          <span className="text-[11px] text-stone-500 block">Período / Vencimiento</span>
                          <span className="font-semibold text-stone-800 tabular-nums">
                            {f.periodo_facturado}
                            {f.periodo_consumo && f.periodo_consumo !== f.periodo_facturado
                              ? ` (Consumo ${f.periodo_consumo})`
                              : ''}{' '}
                            · {f.fecha_vencimiento}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[11px] text-stone-500 block">Total / Saldo</span>
                          <span className="font-bold text-stone-900 tabular-nums block">
                            {formatGs(f.total)}
                          </span>
                          <span
                            className={`text-[11px] font-bold tabular-nums ${
                              f.estado === 'anulada' || f.estado === 'refinanciada'
                                ? 'text-stone-400'
                                : saldo === 0
                                  ? 'text-emerald-700'
                                  : 'text-red-700'
                            }`}
                          >
                            Saldo: {formatGs(saldo)}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Modal de Ficha Individual de Factura */}
      {selectedFacturaId && (
        <FacturaDetalleModal
          facturaId={selectedFacturaId}
          onClose={() => setSelectedFacturaId(null)}
          onNotify={setToast}
        />
      )}

      {/* Toast Feedback */}
      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={`fixed bottom-4 right-4 z-50 max-w-sm w-[calc(100%-2rem)] sm:w-auto px-4 py-3 rounded-xl shadow-lg border flex items-start gap-2.5 text-xs font-semibold ${
            toast.type === 'success'
              ? 'bg-emerald-900 text-white border-emerald-700'
              : 'bg-red-900 text-white border-red-700'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-300 shrink-0 mt-0.5" />
          )}
          <span className="flex-1 break-words">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Cerrar notificación"
            className="p-0.5 rounded hover:bg-white/15 shrink-0 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
