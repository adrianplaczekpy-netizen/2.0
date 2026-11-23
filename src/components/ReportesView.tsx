/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { db } from '../services/database';
import { formatGs } from '../services/billingRules';
import {
  BarChart3,
  AlertTriangle,
  Scissors,
  CheckCircle2,
  Calendar,
  Layers,
  MapPin,
  Printer,
  Download,
  Filter,
  Search,
  ShieldAlert,
  Droplets,
  CreditCard,
} from 'lucide-react';
import { ModalRegistrarReconexion } from './ModalRegistrarReconexion';

export const ReportesView: React.FC = () => {
  const [tabReporte, setTabReporte] = useState<
    'a_cortar' | 'morosos' | 'cortados' | 'recaudacion' | 'consumos_zona' | 'cargos'
  >('a_cortar');

  const [periodoFiltro, setPeriodoFiltro] = useState<string>('todos');
  const [search, setSearch] = useState('');
  const [searchCortados, setSearchCortados] = useState('');
  const [medidorAReconectarId, setMedidorAReconectarId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mensajeOperacion, setMensajeOperacion] = useState<string | null>(null);
  const [errorOperacion, setErrorOperacion] = useState<string | null>(null);

  const stats = db.getDashboardStats();
  const listadoCortar = db.getListadoParaCortar();
  const listadoReconectar = db.getListadoParaReconectar();

  const listadoReconectarFiltrado = listadoReconectar.filter((m) => {
    if (!searchCortados.trim()) return true;
    const term = searchCortados.trim().toLowerCase();
    return (
      String(m.numero_medidor).includes(term) ||
      m.clienteNombre.toLowerCase().includes(term) ||
      m.direccion.toLowerCase().includes(term)
    );
  });

  // Medidores morosos (1 o 2 boletas)
  const medidoresMorosos = db.getMedidores({ estado: 'moroso', limit: 50 }).medidores;

  // Cargos pendientes de facturar
  const cargosPendientes = db.getCargos({ estado: 'pendiente', limit: 50 }).cargos;

  // Reporte de consumos por zona geográfica
  const consumosPorZona = db.getReporteConsumosPorZona(periodoFiltro);

  // Reporte detallado de recaudación
  const recaudacionDetalle = db.getReporteRecaudacionDetallado(periodoFiltro);

  const handleConfirmarCorte = async (medidorId: string, numeroMedidor: number) => {
    setErrorOperacion(null);
    try {
      const med = await db.confirmarCorteFisicoAsync(medidorId);
      setMensajeOperacion(
        `Corte físico confirmado para Medidor N° ${numeroMedidor}. El medidor pasa a estado CORTADO con mora congelada en ${formatGs(med.mora_congelada || 0)}. No recibirá facturas mensuales.`
      );
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      setErrorOperacion(`Error al registrar corte: ${e?.message || 'Error inesperado'}`);
    }
  };

  const handleCobrarReconexion = async (medidorId: string, numeroMedidor: number, totalPagar: number) => {
    setErrorOperacion(null);
    try {
      await db.confirmarReconexionAsync(medidorId, 'Caja Operativa');
      setMensajeOperacion(
        `Medidor N° ${numeroMedidor} regularizado y reconectado con éxito. Se emitió factura de regularización por ${formatGs(totalPagar)} y el medidor vuelve a estado ACTIVO (mora vuelve a 0 Gs.).`
      );
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      setErrorOperacion(`Error en reconexión: ${e?.message || 'Error inesperado'}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">
            Reportes Operativos y Financieros
          </h1>
          <p className="text-sm text-stone-600">
            Auditoría de cortes pendientes, morosidad acumulada, consumos por zona geográfica y recaudación regulada por ERSSAN
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer border border-stone-200"
          >
            <Printer className="w-4 h-4" />
            <span>Imprimir Reporte</span>
          </button>
        </div>
      </div>

      {mensajeOperacion && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 text-sm font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{mensajeOperacion}</span>
          </div>
          <button
            type="button"
            onClick={() => setMensajeOperacion(null)}
            className="text-xs text-emerald-800 hover:underline cursor-pointer ml-3 shrink-0 font-bold"
          >
            Cerrar
          </button>
        </div>
      )}

      {errorOperacion && (
        <div className="p-4 bg-red-50 border border-red-300 rounded-xl text-red-900 text-sm font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <span>{errorOperacion}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorOperacion(null)}
            className="text-xs text-red-800 hover:underline cursor-pointer ml-3 shrink-0 font-bold"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Selector de tipo de reporte (Pestañas limpias y directas) */}
      <div className="flex flex-wrap gap-2 border-b border-stone-200 pb-2 text-xs">
        <button
          type="button"
          onClick={() => setTabReporte('a_cortar')}
          className={`px-3 py-2 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            tabReporte === 'a_cortar'
              ? 'bg-red-600 text-white shadow-xs'
              : 'bg-white text-stone-700 hover:bg-stone-100 border border-stone-200'
          }`}
        >
          <Scissors className="w-4 h-4" />
          <span>Medidores a Cortar ({listadoCortar.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setTabReporte('morosos')}
          className={`px-3 py-2 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            tabReporte === 'morosos'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'bg-white text-stone-700 hover:bg-stone-100 border border-stone-200'
          }`}
        >
          <AlertTriangle className="w-4 h-4" />
          <span>Medidores Morosos ({stats.morosos})</span>
        </button>

        <button
          type="button"
          onClick={() => setTabReporte('cortados')}
          className={`px-3 py-2 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            tabReporte === 'cortados'
              ? 'bg-stone-900 text-white shadow-xs'
              : 'bg-white text-stone-700 hover:bg-stone-100 border border-stone-200'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Cortados a Reconectar ({listadoReconectar.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setTabReporte('consumos_zona')}
          className={`px-3 py-2 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            tabReporte === 'consumos_zona'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'bg-white text-stone-700 hover:bg-stone-100 border border-stone-200'
          }`}
        >
          <MapPin className="w-4 h-4" />
          <span>Consumos por Zona ({consumosPorZona.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setTabReporte('recaudacion')}
          className={`px-3 py-2 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            tabReporte === 'recaudacion'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'bg-white text-stone-700 hover:bg-stone-100 border border-stone-200'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Recaudación del Mes</span>
        </button>

        <button
          type="button"
          onClick={() => setTabReporte('cargos')}
          className={`px-3 py-2 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            tabReporte === 'cargos'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-white text-stone-700 hover:bg-stone-100 border border-stone-200'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Cargos a Facturar ({cargosPendientes.length})</span>
        </button>
      </div>

      {/* 1. Medidores a Cortar (pendiente_corte con cliente, dirección, numero_medidor, monto adeudado, fecha de vencimiento) */}
      {tabReporte === 'a_cortar' && (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-xs space-y-3 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-stone-100 pb-3 gap-2">
            <div>
              <h2 className="font-bold text-stone-900 text-base flex items-center gap-2">
                <Scissors className="w-5 h-5 text-red-600" />
                <span>Medidores a Cortar (Estado: pendiente_corte)</span>
              </h2>
              <p className="text-xs text-stone-500">
                Medidores con 3ra boleta vencida impaga. No reciben nueva factura mensual y quedan listados para corte físico por cuadrilla.
              </p>
            </div>
            <span className="text-xs px-2.5 py-1 bg-red-100 text-red-800 font-bold rounded-lg border border-red-300 w-fit">
              {listadoCortar.length} medidores a cortar
            </span>
          </div>

          {listadoCortar.length === 0 ? (
            <div className="p-8 text-center text-xs text-stone-500">
              No hay medidores en estado pendiente de corte.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-bold uppercase">
                  <tr>
                    <th className="px-3 py-2.5">N° Medidor</th>
                    <th className="px-3 py-2.5">Titular / Cliente</th>
                    <th className="px-3 py-2.5">Dirección del Terreno</th>
                    <th className="px-3 py-2.5">Zona</th>
                    <th className="px-3 py-2.5 text-center">Boletas Impagas</th>
                    <th className="px-3 py-2.5">Vencimiento 3ra Boleta</th>
                    <th className="px-3 py-2.5 text-right">Monto Adeudado</th>
                    <th className="px-3 py-2.5 text-center">Acción Cuadrilla</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {listadoCortar.map((m) => {
                    const terceraBoleta = m.facturasVencidas.find((f) => f.es_tercera_boleta) || m.facturasVencidas[m.facturasVencidas.length - 1];
                    const fechaVenc = terceraBoleta?.fecha_vencimiento || '--';

                    return (
                      <tr key={m.id} className="hover:bg-red-50/40">
                        <td className="px-3 py-2.5 font-mono font-bold text-stone-900">#{m.numero_medidor}</td>
                        <td className="px-3 py-2.5">
                          <span className="font-semibold text-stone-900 block">{m.clienteNombre}</span>
                          <span className="text-[10px] text-stone-500">CI: {m.clienteDoc}</span>
                        </td>
                        <td className="px-3 py-2.5 text-stone-700 max-w-xs truncate">{m.direccion}</td>
                        <td className="px-3 py-2.5 text-stone-600">{m.zona}</td>
                        <td className="px-3 py-2.5 text-center font-bold text-red-700">
                          {m.facturasVencidas.length} boletas
                        </td>
                        <td className="px-3 py-2.5 font-bold text-red-600">
                          {fechaVenc}
                        </td>
                        <td className="px-3 py-2.5 text-right font-black text-red-600 text-sm">
                          {formatGs(m.totalDeuda)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleConfirmarCorte(m.id, m.numero_medidor)}
                            className="px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-[11px] font-bold flex items-center gap-1 mx-auto cursor-pointer shadow-xs transition-colors"
                            title="Confirmar retiro físico del medidor por cuadrilla"
                          >
                            <Scissors className="w-3.5 h-3.5" />
                            <span>Confirmar Retiro</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 2. Medidores Morosos */}
      {tabReporte === 'morosos' && (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-xs space-y-3 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-stone-100 pb-3 gap-2">
            <div>
              <h2 className="font-bold text-stone-900 text-base flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                <span>Padrón de Medidores Morosos (1 o 2 Boletas Vencidas)</span>
              </h2>
              <p className="text-xs text-stone-500">
                Medidores con facturas impagas y recargo fijo de mora (3.000 Gs. por factura). Aún no alcanzan ciclo de corte.
              </p>
            </div>
            <span className="text-xs px-2.5 py-1 bg-amber-100 text-amber-800 font-bold rounded-lg border border-amber-300 w-fit">
              {stats.morosos} medidores morosos
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-bold uppercase">
                <tr>
                  <th className="px-3 py-2.5">N° Medidor</th>
                  <th className="px-3 py-2.5">Titular</th>
                  <th className="px-3 py-2.5">Dirección</th>
                  <th className="px-3 py-2.5">Zona</th>
                  <th className="px-3 py-2.5 text-center">Boletas Impagas</th>
                  <th className="px-3 py-2.5 text-right">Saldo Impago</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {medidoresMorosos.map((m) => (
                  <tr key={m.id} className="hover:bg-amber-50/40">
                    <td className="px-3 py-2.5 font-mono font-bold text-stone-900">#{m.numero_medidor}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-semibold text-stone-900 block">{m.clienteNombre}</span>
                      <span className="text-[10px] text-stone-500">CI: {m.clienteDoc}</span>
                    </td>
                    <td className="px-3 py-2.5 text-stone-700 max-w-xs truncate">{m.direccion}</td>
                    <td className="px-3 py-2.5 text-stone-600">{m.zona}</td>
                    <td className="px-3 py-2.5 text-center font-bold text-amber-800">
                      {m.facturasPendientes} boleta/s
                    </td>
                    <td className="px-3 py-2.5 text-right font-black text-amber-700">
                      {formatGs(m.deudaTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. Medidores Cortados Pendientes de Reconexión */}
      {tabReporte === 'cortados' && (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-xs space-y-3 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-stone-100 pb-3 gap-2">
            <div>
              <h2 className="font-bold text-stone-900 text-base flex items-center gap-2">
                <Layers className="w-5 h-5 text-stone-800" />
                <span>Medidores Cortados Pendientes de Reconexión</span>
              </h2>
              <p className="text-xs text-stone-500">
                Servicio suspendido físicamente. La mora se encuentra congelada. Requiere abono de deuda + reconexión (60.000 Gs) + ERSSAN (2%).
              </p>
            </div>
            <span className="text-xs px-2.5 py-1 bg-stone-100 text-stone-800 font-bold rounded-lg border border-stone-300 w-fit">
              {listadoReconectar.length} medidores cortados
            </span>
          </div>

          {/* Buscador de medidor cortado */}
          <div className="relative">
            <input
              type="text"
              value={searchCortados}
              onChange={(e) => setSearchCortados(e.target.value)}
              placeholder="Buscar medidor cortado por N°, titular o dirección..."
              className="w-full pl-9 pr-4 py-2 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold text-stone-900 focus:outline-hidden focus:bg-white"
            />
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-bold uppercase">
                <tr>
                  <th className="px-3 py-2.5">N° Medidor</th>
                  <th className="px-3 py-2.5">Titular</th>
                  <th className="px-3 py-2.5">Fecha de Corte</th>
                  <th className="px-3 py-2.5 text-right">Facturas Vencidas</th>
                  <th className="px-3 py-2.5 text-right">Mora Congelada</th>
                  <th className="px-3 py-2.5 text-right">Tasa Reconexión</th>
                  <th className="px-3 py-2.5 text-right">Liquidación Total</th>
                  <th className="px-3 py-2.5 text-center">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {listadoReconectarFiltrado.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-stone-500 text-xs">
                      No se encontraron medidores cortados que coincidan con la búsqueda.
                    </td>
                  </tr>
                ) : (
                  listadoReconectarFiltrado.map((m) => (
                    <tr key={m.id} className="hover:bg-stone-50">
                      <td className="px-3 py-2.5 font-mono font-bold text-stone-900">#{m.numero_medidor}</td>
                      <td className="px-3 py-2.5">
                        <span className="font-semibold text-stone-900 block">{m.clienteNombre}</span>
                        <span className="text-[10px] text-stone-500">{m.direccion}</span>
                      </td>
                      <td className="px-3 py-2.5 text-stone-600 font-medium">{m.fecha_corte || '2025-03-01'}</td>
                      <td className="px-3 py-2.5 text-right font-medium">
                        {formatGs(m.liquidacion.subtotalFacturas)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-stone-600 font-medium">
                        {formatGs(m.liquidacion.mora)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-stone-600 font-medium">
                        {formatGs(m.liquidacion.montoReconexion)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-black text-stone-900 text-sm">
                        {formatGs(m.liquidacion.totalPagar)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => setMedidorAReconectarId(m.id)}
                          className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-[11px] font-bold flex items-center gap-1 mx-auto cursor-pointer shadow-xs transition-colors"
                          title="Registrar reconexión, liquidación y reinstalación"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Registrar reconexión</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. Consumos por Zona Geográfica */}
      {tabReporte === 'consumos_zona' && (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-xs space-y-4 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-stone-100 pb-3 gap-3">
            <div>
              <h2 className="font-bold text-stone-900 text-base flex items-center gap-2">
                <MapPin className="w-5 h-5 text-blue-600" />
                <span>Reporte de Consumos y Facturación por Zona</span>
              </h2>
              <p className="text-xs text-stone-500">
                Métricas agregadas de agua potable: volumen consumido (m³), promedio por medidor e importes facturados por sector geográfico.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-stone-500 font-semibold">Filtrar período:</span>
              <select
                value={periodoFiltro}
                onChange={(e) => setPeriodoFiltro(e.target.value)}
                className="text-xs p-2 bg-stone-50 border border-stone-300 rounded-lg font-semibold text-stone-800"
              >
                <option value="todos">Todos los períodos</option>
                <option value="2025-01">2025-01</option>
                <option value="2025-02">2025-02</option>
                <option value="2025-03">2025-03</option>
                <option value="2025-04">2025-04</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-bold uppercase">
                <tr>
                  <th className="px-3 py-3">Zona Geográfica</th>
                  <th className="px-3 py-3 text-center">Medidores</th>
                  <th className="px-3 py-3 text-center">Activos</th>
                  <th className="px-3 py-3 text-center">Morosos</th>
                  <th className="px-3 py-3 text-center">A Cortar</th>
                  <th className="px-3 py-3 text-center">Cortados</th>
                  <th className="px-3 py-3 text-right">Consumo Total</th>
                  <th className="px-3 py-3 text-right">Promedio / Medidor</th>
                  <th className="px-3 py-3 text-right">Facturación Zona</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {consumosPorZona.map((z) => (
                  <tr key={z.zona} className="hover:bg-blue-50/30">
                    <td className="px-3 py-3 font-bold text-stone-900 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <span>{z.zona}</span>
                    </td>
                    <td className="px-3 py-3 text-center font-bold text-stone-900">{z.totalMedidores}</td>
                    <td className="px-3 py-3 text-center text-emerald-700 font-semibold">{z.activos}</td>
                    <td className="px-3 py-3 text-center text-amber-700 font-semibold">{z.morosos}</td>
                    <td className="px-3 py-3 text-center text-red-600 font-bold">{z.pendientesCorte}</td>
                    <td className="px-3 py-3 text-center text-stone-600">{z.cortados}</td>
                    <td className="px-3 py-3 text-right font-black text-blue-800">
                      {z.totalConsumoM3.toLocaleString('es-PY')} m³
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-stone-700">
                      {z.promedioM3PorMedidor} m³
                    </td>
                    <td className="px-3 py-3 text-right font-black text-stone-900">
                      {formatGs(z.facturacionTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. Recaudación del Mes y Desglose de Métodos */}
      {tabReporte === 'recaudacion' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-xs space-y-2">
              <span className="text-xs font-bold text-stone-500 uppercase tracking-wider block">
                Recaudación Total Registrada
              </span>
              <div className="text-2xl font-black text-emerald-700">
                {formatGs(recaudacionDetalle.totalRecaudado || stats.totalRecaudadoMes)}
              </div>
              <p className="text-xs text-stone-500">
                Total cobrado en ventanilla y cuentas ({recaudacionDetalle.cantidadPagos} recibos emitidos)
              </p>
            </div>

            <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-xs space-y-2">
              <span className="text-xs font-bold text-stone-500 uppercase tracking-wider block">
                Deuda Exigible en la Red
              </span>
              <div className="text-2xl font-black text-red-600">{formatGs(stats.totalDeudaAcumulada)}</div>
              <p className="text-xs text-stone-500">Suma total de facturas pendientes y mora congelada</p>
            </div>

            <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-xs space-y-2">
              <span className="text-xs font-bold text-stone-500 uppercase tracking-wider block">
                Aporte Regulador ERSSAN (2%)
              </span>
              <div className="text-2xl font-black text-blue-700">
                {formatGs(recaudacionDetalle.aporteErssanEstimado)}
              </div>
              <p className="text-xs text-stone-500">Canon regulatorio del 2% calculado sobre lo percibido</p>
            </div>
          </div>

          {/* Desglose por Método de Pago */}
          <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-xs space-y-3">
            <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-stone-700" />
              <span>Desglose de Cobranza por Medio de Pago</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-1">
                <span className="text-xs text-stone-500 block uppercase font-bold">Efectivo en Caja</span>
                <span className="text-lg font-black text-stone-900">
                  {formatGs(recaudacionDetalle.porMetodo.efectivo)}
                </span>
                <span className="text-[10px] text-stone-500 block">Cobranza directa en mostrador</span>
              </div>

              <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-1">
                <span className="text-xs text-stone-500 block uppercase font-bold">Transferencias Bancarias</span>
                <span className="text-lg font-black text-blue-700">
                  {formatGs(recaudacionDetalle.porMetodo.transferencia)}
                </span>
                <span className="text-[10px] text-stone-500 block">Pagos electrónicos SIPAP / QR</span>
              </div>

              <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-1">
                <span className="text-xs text-stone-500 block uppercase font-bold">Cheques al Día</span>
                <span className="text-lg font-black text-stone-900">
                  {formatGs(recaudacionDetalle.porMetodo.cheque)}
                </span>
                <span className="text-[10px] text-stone-500 block">Comprobantes bancarios</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. Cargos Pendientes por Facturar */}
      {tabReporte === 'cargos' && (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-xs p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-stone-100 pb-3 gap-2">
            <div>
              <h2 className="font-bold text-stone-900 text-base">Otros Trabajos Pendientes de Facturación</h2>
              <p className="text-xs text-stone-500">
                Cargos por reparaciones o materiales cargados a un medidor específico con período futuro. Se incorporarán automáticamente al emitir dicho período.
              </p>
            </div>
            <span className="text-xs px-2.5 py-1 bg-indigo-100 text-indigo-800 font-bold rounded-lg border border-indigo-300 w-fit">
              {cargosPendientes.length} trabajos pendientes
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-bold uppercase">
                <tr>
                  <th className="px-3 py-2.5">Medidor</th>
                  <th className="px-3 py-2.5">Titular</th>
                  <th className="px-3 py-2.5">Concepto / Trabajo Realizado</th>
                  <th className="px-3 py-2.5">Fecha Trabajo</th>
                  <th className="px-3 py-2.5">Período Destino</th>
                  <th className="px-3 py-2.5 text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {cargosPendientes.map((c) => (
                  <tr key={c.id} className="hover:bg-indigo-50/30">
                    <td className="px-3 py-2.5 font-mono font-bold text-stone-900">#{c.numeroMedidor}</td>
                    <td className="px-3 py-2.5 font-semibold text-stone-900">{c.clienteNombre}</td>
                    <td className="px-3 py-2.5 text-stone-800">{c.descripcion}</td>
                    <td className="px-3 py-2.5 text-stone-600">{c.fecha_trabajo}</td>
                    <td className="px-3 py-2.5 font-bold text-indigo-700">{c.periodo_facturacion}</td>
                    <td className="px-3 py-2.5 text-right font-black text-stone-900 text-sm">
                      {formatGs(c.monto)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de Reconexión de Medidor */}
      {medidorAReconectarId && (
        <ModalRegistrarReconexion
          medidorId={medidorAReconectarId}
          isOpen={!!medidorAReconectarId}
          onClose={() => setMedidorAReconectarId(null)}
          onSuccess={(res) => {
            setMensajeOperacion(
              `Medidor N° ${res.medidor.numero_medidor} regularizado y reconectado con éxito. Estado actualizado a ACTIVO (mora vuelve a 0 Gs.).`
            );
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
};
