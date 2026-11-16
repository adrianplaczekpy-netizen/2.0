/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { db } from '../services/database';
import { formatGs } from '../services/billingRules';
import {
  Users,
  CheckCircle2,
  Clock,
  Scissors,
  AlertTriangle,
  CreditCard,
  FileText,
  Wrench,
  Gauge,
  ArrowRight,
} from 'lucide-react';

interface DashboardViewProps {
  onNavigate: (tab: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const stats = db.getDashboardStats();
  const pendientesCorte = db.getListadoParaCortar().slice(0, 6);
  const tarifas = db.getTarifasVigentes();

  return (
    <div className="space-y-6">
      {/* Title & Period Indicator */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">Dashboard Operativo</h1>
          <p className="text-sm text-stone-600">
            Resumen en tiempo real del estado de clientes, medidores y recaudación — Período {stats.periodoActual}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-700 bg-white px-3 py-1 rounded-md border border-stone-200 font-semibold">
            Tarifa: {formatGs(tarifas.precio_m3)}/m³ (Mín. {tarifas.consumo_minimo_m3} m³)
          </span>
          <span className="text-xs text-stone-700 bg-white px-3 py-1 rounded-md border border-stone-200 font-semibold">
            ERSSAN: {tarifas.erssan_porcentaje}%
          </span>
        </div>
      </div>

      {/* CONTADORES SIMPLES (SIN GRÁFICOS PESADOS NI ANIMACIONES) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* 1. Clientes Totales */}
        <div
          onClick={() => onNavigate('clientes')}
          className="bg-white p-4 rounded-xl border border-stone-200 hover:border-stone-400 cursor-pointer shadow-xs transition-colors"
        >
          <div className="flex items-center justify-between text-stone-500 text-xs font-semibold">
            <span>Clientes Totales</span>
            <Users className="w-4 h-4 text-stone-600" />
          </div>
          <div className="text-2xl font-black text-stone-900 mt-2">
            {stats.totalClientes.toLocaleString('es-PY')}
          </div>
          <p className="text-[11px] text-stone-500 mt-1">Titulares en padrón</p>
        </div>

        {/* 2. Medidores Activos */}
        <div
          onClick={() => onNavigate('medidores')}
          className="bg-white p-4 rounded-xl border border-stone-200 hover:border-stone-400 cursor-pointer shadow-xs transition-colors"
        >
          <div className="flex items-center justify-between text-stone-500 text-xs font-semibold">
            <span>Med. Activos</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-stone-900 mt-2">
            {stats.activos.toLocaleString('es-PY')}
          </div>
          <p className="text-[11px] text-emerald-700 font-semibold mt-1">Al día sin mora</p>
        </div>

        {/* 3. Medidores Morosos */}
        <div
          onClick={() => onNavigate('medidores')}
          className="bg-white p-4 rounded-xl border border-stone-200 hover:border-stone-400 cursor-pointer shadow-xs transition-colors"
        >
          <div className="flex items-center justify-between text-stone-500 text-xs font-semibold">
            <span>Med. Morosos</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-black text-amber-700 mt-2">
            {stats.morosos.toLocaleString('es-PY')}
          </div>
          <p className="text-[11px] text-stone-500 mt-1">1 o 2 boletas vencidas</p>
        </div>

        {/* 4. Medidores Cortados */}
        <div
          onClick={() => onNavigate('medidores')}
          className="bg-white p-4 rounded-xl border border-stone-200 hover:border-stone-400 cursor-pointer shadow-xs transition-colors"
        >
          <div className="flex items-center justify-between text-stone-500 text-xs font-semibold">
            <span>Med. Cortados</span>
            <AlertTriangle className="w-4 h-4 text-stone-500" />
          </div>
          <div className="text-2xl font-black text-stone-700 mt-2">
            {stats.cortados.toLocaleString('es-PY')}
          </div>
          <p className="text-[11px] text-stone-500 mt-1">Mora congelada</p>
        </div>

        {/* 5. Medidores a Cortar (DESTACADO EN ROJO SI > 0) */}
        <div
          onClick={() => onNavigate('reportes')}
          className={`p-4 rounded-xl border cursor-pointer shadow-xs transition-colors ${
            stats.pendientesCorte > 0
              ? 'bg-red-50 border-red-300 hover:border-red-500'
              : 'bg-white border-stone-200 hover:border-stone-400'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold">
            <span className={stats.pendientesCorte > 0 ? 'text-red-800' : 'text-stone-500'}>
              Medidores a Cortar
            </span>
            <Scissors className={`w-4 h-4 ${stats.pendientesCorte > 0 ? 'text-red-600' : 'text-stone-400'}`} />
          </div>
          <div
            className={`text-2xl font-black mt-2 ${
              stats.pendientesCorte > 0 ? 'text-red-700' : 'text-stone-900'
            }`}
          >
            {stats.pendientesCorte.toLocaleString('es-PY')}
          </div>
          <p className={`text-[11px] font-bold mt-1 ${stats.pendientesCorte > 0 ? 'text-red-800' : 'text-stone-500'}`}>
            {stats.pendientesCorte > 0 ? 'Venció día 11 (Urgente)' : 'Sin cortes pendientes'}
          </p>
        </div>

        {/* 6. Retirados */}
        <div
          onClick={() => onNavigate('medidores')}
          className="bg-white p-4 rounded-xl border border-stone-200 hover:border-stone-400 cursor-pointer shadow-xs transition-colors"
        >
          <div className="flex items-center justify-between text-stone-500 text-xs font-semibold">
            <span>Retirados</span>
            <Gauge className="w-4 h-4 text-stone-400" />
          </div>
          <div className="text-2xl font-black text-stone-700 mt-2">
            {stats.retirados.toLocaleString('es-PY')}
          </div>
          <p className="text-[11px] text-stone-500 mt-1">Por recambio/baja</p>
        </div>
      </div>

      {/* CONTADORES FINANCIEROS Y CARGOS DEL MES */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Recaudación del Mes */}
        <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs font-bold text-stone-600 uppercase tracking-wider">
            <span>Recaudación del Mes</span>
            <CreditCard className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-700 mt-2">
            {formatGs(stats.totalRecaudadoMes)}
          </div>
          <p className="text-xs text-stone-500">Cobros registrados en caja durante {stats.periodoActual}</p>
        </div>

        {/* Facturas Pendientes del Mes */}
        <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs font-bold text-stone-600 uppercase tracking-wider">
            <span>Facturas Pendientes del Mes</span>
            <FileText className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-black text-stone-900 mt-2">
            {stats.facturasPendientesMes.toLocaleString('es-PY')}
          </div>
          <p className="text-xs text-stone-500">Boletas emitidas en el ciclo actual pendientes de pago</p>
        </div>

        {/* Cargos Pendientes de Facturar este Mes */}
        <div
          onClick={() => onNavigate('trabajos')}
          className="bg-white p-5 rounded-xl border border-stone-200 hover:border-stone-400 cursor-pointer shadow-xs space-y-1 transition-colors"
        >
          <div className="flex items-center justify-between text-xs font-bold text-stone-600 uppercase tracking-wider">
            <span>Cargos Pendientes de Facturar</span>
            <Wrench className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-black text-stone-900 mt-2">
            {stats.cargosPendientesCount} <span className="text-xs font-normal text-stone-500">({formatGs(stats.cargosPendientesMonto)})</span>
          </div>
          <p className="text-xs text-stone-500">Trabajos en terreno cargados a incluir en la próxima emisión</p>
        </div>
      </div>

      {/* LISTA PRIORITARIA: Medidores a Cortar (Destacado) */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse"></span>
            <h2 className="font-bold text-stone-900 text-base">
              Medidores Pendientes de Corte Físico ({stats.pendientesCorte})
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('reportes')}
            className="text-xs text-red-600 hover:text-red-700 font-bold flex items-center gap-1 self-start sm:self-auto"
          >
            <span>Ver listado completo para cuadrilla</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-stone-100">
          {pendientesCorte.length === 0 ? (
            <div className="p-6 text-center text-xs text-stone-500">
              No hay medidores con orden de corte activa en este momento.
            </div>
          ) : (
            pendientesCorte.map((m) => (
              <div
                key={m.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50 transition-colors"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm text-stone-900">
                      Medidor N° {m.numero_medidor}
                    </span>
                    <span className="text-xs font-semibold text-stone-700">({m.clienteNombre})</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-sm bg-red-100 text-red-800 font-bold border border-red-200">
                      3 boletas vencidas
                    </span>
                  </div>
                  <p className="text-xs text-stone-600">{m.direccion} — Zona: {m.zona}</p>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4">
                  <div className="text-right">
                    <div className="text-sm font-black text-red-600">{formatGs(m.totalDeuda)}</div>
                    <span className="text-[10px] text-stone-400">Deuda total exigible</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('medidores')}
                    className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-semibold"
                  >
                    Ficha Medidor
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
