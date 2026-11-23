/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { db } from '../services/database';
import { formatGs } from '../services/billingRules';
import { ModalRegistrarReconexion } from './ModalRegistrarReconexion';
import {
  Scissors,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  MapPin,
  Wrench,
  RefreshCw,
} from 'lucide-react';

export const CorteReconexionView: React.FC = () => {
  const [tab, setTab] = useState<'a_cortar' | 'cortados'>('a_cortar');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmandoCorteId, setConfirmandoCorteId] = useState<string | null>(null);
  const [procesandoCorteId, setProcesandoCorteId] = useState<string | null>(null);
  const [recalculando, setRecalculando] = useState(false);
  const [medidorReconexionId, setMedidorReconexionId] = useState<string | null>(null);

  const medidoresACortar = db.getListadoParaCortar();
  const medidoresCortados = db.getListadoParaReconectar();

  const handleRecalcularEstados = async () => {
    setErrorMsg(null);
    setMensaje(null);
    setRecalculando(true);
    try {
      const res = await db.recalcularEstadosMedidoresAsync();
      if (res.actualizados === 0 && res.facturasVencidasMarcadas === 0) {
        setMensaje(
          `Estados verificados (${res.totalEvaluados} medidores evaluados). Todos los estados ya estaban actualizados.`
        );
      } else {
        const detalleCambios = res.cambios
          .slice(0, 5)
          .map((c) => `Med. N° ${c.numeroMedidor}: ${c.anterior} → ${c.nuevo}`)
          .join(', ');
        setMensaje(
          `Recálculo completado: ${res.actualizados} medidor(es) actualizado(s) y ${res.facturasVencidasMarcadas} factura(s) vencida(s) marcada(s).${
            detalleCambios ? ` (${detalleCambios})` : ''
          }`
        );
      }
    } catch (e: any) {
      setErrorMsg(e?.message || 'Error al recalcular estados de medidores.');
    } finally {
      setRecalculando(false);
    }
  };

  const handleConfirmarCorte = async (numeroMedidor: number, idStr: string) => {
    setErrorMsg(null);
    setProcesandoCorteId(idStr);
    try {
      await db.confirmarCorteFisicoAsync(idStr);
      setConfirmandoCorteId(null);
      setMensaje(`Medidor N° ${numeroMedidor} marcado como CORTADO. Mora congelada registrada.`);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Error al registrar el retiro físico.');
    } finally {
      setProcesandoCorteId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">
            Corte y Reconexión
          </h1>
          <p className="text-sm text-stone-600">
            Gestión en terreno de retiro físico de medidores por mora e inspección de reconexiones
          </p>
        </div>
        <button
          type="button"
          onClick={handleRecalcularEstados}
          disabled={recalculando}
          className="px-4 py-2 bg-stone-900 hover:bg-stone-800 disabled:opacity-60 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${recalculando ? 'animate-spin' : ''}`} />
          <span>{recalculando ? 'Recalculando...' : 'Recalcular estados'}</span>
        </button>
      </div>

      {mensaje && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 text-sm font-semibold flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{mensaje}</span>
          </div>
          <button
            type="button"
            onClick={() => setMensaje(null)}
            className="text-xs text-emerald-800 hover:underline shrink-0 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 bg-red-50 border border-red-300 rounded-xl text-red-900 text-sm font-semibold flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-xs text-red-800 hover:underline shrink-0 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Tabs Operativos */}
      <div className="flex border-b border-stone-200 space-x-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setTab('a_cortar')}
          className={`py-3 px-4 font-bold text-sm border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer ${
            tab === 'a_cortar'
              ? 'border-red-600 text-red-600'
              : 'border-transparent text-stone-500 hover:text-stone-800'
          }`}
        >
          <Scissors className="w-4 h-4" />
          <span>Medidores a cortar ({medidoresACortar.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('cortados')}
          className={`py-3 px-4 font-bold text-sm border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer ${
            tab === 'cortados'
              ? 'border-stone-900 text-stone-900'
              : 'border-transparent text-stone-500 hover:text-stone-800'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          <span>Medidores cortados ({medidoresCortados.length})</span>
        </button>
      </div>

      {/* Contenido: Tab A Cortar */}
      {tab === 'a_cortar' && (
        <div className="space-y-4">
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-900 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block text-sm">
                Criterio de Inclusión en Orden de Corte:
              </span>
              <span>
                Medidores en estado pendiente de corte (3 o más boletas vencidas o 3ra boleta impaga tras el día 11).
                Al retirar el medidor, registre el retiro para congelar la mora y suspender la facturación mensual.
              </span>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-xs">
            <div className="divide-y divide-stone-100">
              {medidoresACortar.length === 0 ? (
                <div className="p-8 text-center text-sm text-stone-500 font-medium">
                  No hay medidores en este estado
                </div>
              ) : (
                medidoresACortar.map((m) => (
                  <div key={m.id} className="p-4 space-y-3 hover:bg-stone-50">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-bold text-base text-stone-900">
                            Medidor N° {m.numero_medidor}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-sm bg-red-100 text-red-800 font-bold border border-red-300 uppercase">
                            Pendiente de Corte
                          </span>
                          <span className="text-xs text-stone-500">Zona: {m.zona}</span>
                        </div>

                        <div className="text-xs text-stone-700">
                          Titular: <span className="font-semibold text-stone-900">{m.clienteNombre}</span> (CI: {m.clienteDoc})
                        </div>

                        <div className="text-xs text-stone-500 flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 shrink-0" />
                          <span>{m.direccion}</span>
                        </div>

                        <div className="text-[11px] text-stone-500 pt-1">
                          {m.facturasVencidas.length} boletas impagas ({m.facturasVencidas.map((f) => f.periodo_facturado).join(', ')})
                        </div>
                      </div>

                      <div className="flex items-center sm:flex-col sm:items-end justify-between gap-2">
                        <div className="text-left sm:text-right">
                          <div className="text-xs text-stone-500">Deuda Total Acumulada:</div>
                          <div className="text-base font-black text-red-600">{formatGs(m.totalDeuda)}</div>
                        </div>

                        {confirmandoCorteId !== m.id && (
                          <button
                            type="button"
                            onClick={() => setConfirmandoCorteId(m.id)}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer"
                          >
                            <Scissors className="w-4 h-4" />
                            <span>Registrar retiro</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {confirmandoCorteId === m.id && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <span className="text-red-900 font-semibold">
                          ¿Confirmar retiro físico del Medidor N° {m.numero_medidor}? Su mora quedará congelada y no se emitirán nuevas facturas mensuales.
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => setConfirmandoCorteId(null)}
                            disabled={procesandoCorteId === m.id}
                            className="px-3 py-1.5 bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 rounded-md font-semibold cursor-pointer"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleConfirmarCorte(m.numero_medidor, m.id)}
                            disabled={procesandoCorteId === m.id}
                            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md font-bold cursor-pointer disabled:opacity-60"
                          >
                            {procesandoCorteId === m.id ? 'Registrando...' : 'Confirmar retiro'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Contenido: Tab Cortados */}
      {tab === 'cortados' && (
        <div className="space-y-4">
          <div className="p-4 bg-stone-100 border border-stone-200 rounded-xl text-xs text-stone-700 flex items-start gap-3">
            <Wrench className="w-5 h-5 text-stone-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block text-sm text-stone-900">
                Proceso de Reconexión de Medidores Cortados:
              </span>
              <span>
                Para restablecer el servicio, el titular debe cancelar: 1) Todas las facturas pendientes + 2) Mora congelada + 3) Tasa obligatoria de reconexión (60.000 Gs.).
                Una vez confirmado, el medidor volverá al estado ACTIVO.
              </span>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-xs">
            <div className="divide-y divide-stone-100">
              {medidoresCortados.length === 0 ? (
                <div className="p-8 text-center text-sm text-stone-500 font-medium">
                  No hay medidores en este estado
                </div>
              ) : (
                medidoresCortados.map((m) => (
                  <div key={m.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold text-base text-stone-900">
                          Medidor N° {m.numero_medidor}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-sm bg-red-100 text-red-800 border border-red-300 font-bold uppercase">
                          CORTADO
                        </span>
                        {m.fecha_corte && (
                          <span className="text-xs text-stone-500">Cortado el {m.fecha_corte}</span>
                        )}
                      </div>

                      <div className="text-xs text-stone-700">
                        Titular: <span className="font-semibold text-stone-900">{m.clienteNombre}</span> (CI: {m.clienteDoc})
                      </div>

                      <div className="text-xs text-stone-500 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 shrink-0" />
                        <span>{m.direccion}</span>
                      </div>

                      {/* Desglose de Liquidación */}
                      <div className="text-[11px] text-stone-600 flex flex-wrap gap-x-3 pt-1">
                        <span>Facturas: {formatGs(m.liquidacion.subtotalFacturas)}</span>
                        <span>Mora congelada: {formatGs(m.liquidacion.mora)}</span>
                        <span>Reconexión: {formatGs(m.liquidacion.montoReconexion)}</span>
                        {m.liquidacion.subtotalCargos > 0 && (
                          <span>Otros cargos: {formatGs(m.liquidacion.subtotalCargos)}</span>
                        )}
                        <span>ERSSAN 2%: {formatGs(m.liquidacion.montoErssan)}</span>
                      </div>
                    </div>

                    <div className="flex items-center sm:flex-col sm:items-end justify-between gap-2">
                      <div className="text-left sm:text-right">
                        <div className="text-xs text-stone-500">Total Liquidación Reconexión:</div>
                        <div className="text-base font-black text-stone-900">
                          {formatGs(m.liquidacion.totalPagar)}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setMedidorReconexionId(m.id)}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <RotateCcw className="w-4 h-4" />
                        <span>Registrar reconexión</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {medidorReconexionId && (
        <ModalRegistrarReconexion
          medidorId={medidorReconexionId}
          isOpen={Boolean(medidorReconexionId)}
          onClose={() => setMedidorReconexionId(null)}
          onSuccess={(resultado) => {
            setMensaje(
              `Medidor N° ${resultado.medidor.numero_medidor} reconectado y restituido a ACTIVO con éxito. Factura de regularización ${resultado.facturaRegularizacion.id} emitida y pagada.`
            );
          }}
        />
      )}
    </div>
  );
};
