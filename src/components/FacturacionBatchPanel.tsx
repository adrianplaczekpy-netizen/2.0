/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { db, type ResumenFacturacionMensual } from '../services/database';
import { formatGs } from '../services/billingRules';
import { agruparOmitidosPorMotivo, puedeGenerarFacturacionMensual } from '../services/facturacionHelpers';
import { useAuth } from '../context/AuthContext';
import {
  Calendar,
  Play,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';

interface FacturacionBatchPanelProps {
  defaultPeriodo: string;
  onVerFacturasGeneradas: (periodo: string) => void;
}

export const FacturacionBatchPanel: React.FC<FacturacionBatchPanelProps> = ({
  defaultPeriodo,
  onVerFacturasGeneradas,
}) => {
  const { user } = useAuth();
  const [periodo, setPeriodo] = useState(defaultPeriodo);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resumen, setResumen] = useState<ResumenFacturacionMensual | null>(null);
  const [expandOmitidos, setExpandOmitidos] = useState(true);

  if (!puedeGenerarFacturacionMensual(user?.rol)) {
    return (
      <div
        role="alert"
        className="bg-red-50 border border-red-300 rounded-xl p-8 max-w-lg mx-auto text-center space-y-3"
      >
        <ShieldAlert className="w-10 h-10 text-red-600 mx-auto" />
        <h2 className="text-base font-black text-red-900">Acceso denegado</h2>
        <p className="text-xs text-red-800">
          La generación masiva de facturas del mes está restringida exclusivamente al rol de Administrador.
        </p>
      </div>
    );
  }

  const handleSolicitarGeneracion = () => {
    setErrorMsg(null);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test((periodo || '').trim())) {
      setErrorMsg('Seleccioná un período válido con formato YYYY-MM.');
      return;
    }
    setShowConfirmModal(true);
  };

  const handleConfirmarGeneracion = async () => {
    setShowConfirmModal(false);
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      const res = await db.ejecutarFacturacionMensualAsync(periodo);
      setResumen(res);
      setExpandOmitidos(res.totalOmitidos > 0);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Ocurrió un error al generar las facturas del período.');
    } finally {
      setIsProcessing(false);
    }
  };

  const gruposOmitidos = resumen ? agruparOmitidosPorMotivo(resumen.medidoresOmitidos) : [];

  return (
    <div className="space-y-5">
      {/* Tarjeta de configuración de corrida mensual */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 sm:p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-stone-900">
              <Calendar className="w-5 h-5 text-blue-600 shrink-0" />
              <h2 className="text-lg font-bold tracking-tight">Generar facturas del mes</h2>
            </div>
            <p className="text-xs text-stone-600 max-w-2xl leading-relaxed">
              Procesa todos los medidores en estado <span className="font-semibold text-stone-800">activo</span> o{' '}
              <span className="font-semibold text-stone-800">moroso</span> que cuenten con una lectura confirmada
              pendiente de facturar (toma la lectura confirmada más reciente sin factura activa y usa su período como{' '}
              <span className="font-semibold text-stone-800">período de consumo</span>), calculando consumo mínimo,
              deuda anterior, mora, cargos pendientes, cuotas de financiamiento y ERSSAN 2%.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3 shrink-0">
            <div>
              <label
                htmlFor="batch-periodo-input"
                className="text-xs font-semibold text-stone-700 block mb-1"
              >
                Período a facturar (Mes / Año)
              </label>
              <input
                id="batch-periodo-input"
                type="month"
                value={periodo}
                onChange={(e) => setPeriodo(e.target.value)}
                disabled={isProcessing}
                className="w-full sm:w-44 min-h-[44px] px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm font-bold text-stone-900 tabular-nums focus:outline-hidden focus:border-blue-600 focus:bg-white"
              />
            </div>

            <button
              type="button"
              onClick={handleSolicitarGeneracion}
              disabled={isProcessing}
              className="min-h-[44px] px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 text-white font-bold text-sm rounded-lg flex items-center justify-center gap-2 cursor-pointer transition-colors whitespace-nowrap"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>Generando facturas...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current shrink-0" />
                  <span>Generar facturas del mes</span>
                </>
              )}
            </button>
          </div>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="p-3.5 bg-red-50 border border-red-300 rounded-lg text-red-800 text-xs font-semibold flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* Estado de carga explícito */}
      {isProcessing && (
        <div
          role="status"
          className="bg-white rounded-xl border border-stone-200 p-8 flex flex-col items-center justify-center gap-3 text-center"
        >
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <p className="text-sm font-bold text-stone-900">
            Procesando facturación mensual para {periodo}...
          </p>
          <p className="text-xs text-stone-500">
            Calculando conceptos ERSSAN y guardando boletas en la base de datos.
          </p>
        </div>
      )}

      {/* ResumenFacturacionMensual completo */}
      {resumen && !isProcessing && (
        <div className="bg-white rounded-xl border border-stone-200 p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-200 pb-4">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
              <div>
                <h3 className="text-base font-bold text-stone-900">
                  Resumen de Facturación — Período {resumen.periodo}
                </h3>
                <p className="text-xs text-stone-500">
                  Ejecución finalizada el {new Date(resumen.fechaEjecucion).toLocaleString('es-PY')}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onVerFacturasGeneradas(resumen.periodo)}
              className="min-h-[44px] px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer transition-colors whitespace-nowrap"
            >
              <span>Ver facturas generadas</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Métricas numéricas tabulares */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg">
              <span className="text-[11px] font-semibold text-stone-500 block">Evaluados</span>
              <span className="text-xl font-black text-stone-900 tabular-nums mt-0.5 block">
                {resumen.totalMedidoresEvaluados}
              </span>
            </div>

            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
              <span className="text-[11px] font-semibold text-emerald-800 block">Generadas</span>
              <span className="text-xl font-black text-emerald-700 tabular-nums mt-0.5 block">
                {resumen.totalGeneradas}
              </span>
            </div>

            <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg">
              <span className="text-[11px] font-semibold text-stone-500 block">Omitidos</span>
              <span className="text-xl font-black text-stone-900 tabular-nums mt-0.5 block">
                {resumen.totalOmitidos}
              </span>
            </div>

            <div
              className={`p-3 rounded-lg border ${
                resumen.totalErrores > 0
                  ? 'bg-red-50 border-red-300'
                  : 'bg-stone-50 border-stone-200'
              }`}
            >
              <span
                className={`text-[11px] font-semibold block ${
                  resumen.totalErrores > 0 ? 'text-red-800' : 'text-stone-500'
                }`}
              >
                Errores
              </span>
              <span
                className={`text-xl font-black tabular-nums mt-0.5 block ${
                  resumen.totalErrores > 0 ? 'text-red-700' : 'text-stone-900'
                }`}
              >
                {resumen.totalErrores}
              </span>
            </div>

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg col-span-2 sm:col-span-1 lg:col-span-1">
              <span className="text-[11px] font-semibold text-blue-800 block">Total Facturado</span>
              <span className="text-lg font-black text-blue-900 tabular-nums mt-0.5 block">
                {formatGs(resumen.totalImporte)}
              </span>
            </div>

            <div
              className={`p-3 rounded-lg border ${
                resumen.alertasConsumoCount > 0
                  ? 'bg-red-50 border-red-300'
                  : 'bg-stone-50 border-stone-200'
              }`}
            >
              <span
                className={`text-[11px] font-semibold block ${
                  resumen.alertasConsumoCount > 0 ? 'text-red-800' : 'text-stone-500'
                }`}
              >
                Consumo Elevado
              </span>
              <span
                className={`text-xl font-black tabular-nums mt-0.5 block ${
                  resumen.alertasConsumoCount > 0 ? 'text-red-700' : 'text-stone-900'
                }`}
              >
                {resumen.alertasConsumoCount}
              </span>
            </div>

            <div
              className={`p-3 rounded-lg border ${
                resumen.tercerasBoletasCount > 0
                  ? 'bg-red-50 border-red-300'
                  : 'bg-stone-50 border-stone-200'
              }`}
            >
              <span
                className={`text-[11px] font-semibold block ${
                  resumen.tercerasBoletasCount > 0 ? 'text-red-800' : 'text-stone-500'
                }`}
              >
                3ras Boletas
              </span>
              <span
                className={`text-xl font-black tabular-nums mt-0.5 block ${
                  resumen.tercerasBoletasCount > 0 ? 'text-red-700' : 'text-stone-900'
                }`}
              >
                {resumen.tercerasBoletasCount}
              </span>
            </div>
          </div>

          {/* Lista de medidores omitidos agrupados por motivo */}
          {resumen.totalOmitidos > 0 && (
            <div className="border border-stone-200 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandOmitidos((v) => !v)}
                className="w-full px-4 py-3 bg-stone-50 hover:bg-stone-100 flex items-center justify-between text-xs font-bold text-stone-800 cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-stone-500" />
                  <span>Detalle de medidores omitidos ({resumen.totalOmitidos})</span>
                </span>
                {expandOmitidos ? (
                  <ChevronUp className="w-4 h-4 text-stone-500" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-stone-500" />
                )}
              </button>

              {expandOmitidos && (
                <div className="divide-y divide-stone-100">
                  {gruposOmitidos.map((grupo) => (
                    <div key={grupo.motivo} className="p-3.5 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-stone-900">
                          {grupo.etiqueta} ({grupo.motivo})
                        </span>
                        <span className="font-mono font-bold text-stone-700 tabular-nums">
                          {grupo.cantidad} {grupo.cantidad === 1 ? 'medidor' : 'medidores'}
                        </span>
                      </div>
                      <ul className="space-y-1 text-stone-600">
                        {grupo.items.map((item) => (
                          <li key={`${grupo.motivo}-${item.medidor_id}`} className="flex items-start gap-2">
                            <span className="font-mono font-bold text-stone-800 shrink-0">
                              #{item.numero_medidor}
                            </span>
                            <span>— {item.detalle}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Lista de errores si hubo */}
          {resumen.errores.length > 0 && (
            <div className="border border-red-300 bg-red-50 rounded-lg p-4 space-y-2 text-xs">
              <div className="font-bold text-red-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <span>Errores durante el procesamiento ({resumen.errores.length})</span>
              </div>
              <ul className="space-y-1 text-red-800">
                {resumen.errores.map((err, idx) => (
                  <li key={`${err.medidor_id}-${idx}`}>
                    <span className="font-mono font-bold">
                      {err.numero_medidor ? `Medidor #${err.numero_medidor}` : err.medidor_id}:
                    </span>{' '}
                    {err.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Modal de Confirmación Previa */}
      {showConfirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-batch-title"
          className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-xl max-w-md w-full border border-stone-200 shadow-xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <Calendar className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <h3 id="confirm-batch-title" className="text-base font-bold text-stone-900">
                  Confirmar generación mensual
                </h3>
                <p className="text-xs text-stone-700 leading-relaxed">
                  ¿Generar facturas del período <span className="font-bold text-stone-900">{periodo}</span>? Se
                  procesarán todos los medidores activos y morosos.
                </p>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="min-h-[44px] px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-bold rounded-lg cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmarGeneracion}
                className="min-h-[44px] px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Sí, generar facturas
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
