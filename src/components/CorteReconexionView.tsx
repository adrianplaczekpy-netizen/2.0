/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { db } from '../services/database';
import { formatGs } from '../services/billingRules';
import {
  Scissors,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  MapPin,
  FileText,
  DollarSign,
  User,
  Wrench,
} from 'lucide-react';

export const CorteReconexionView: React.FC = () => {
  const [tab, setTab] = useState<'a_cortar' | 'cortados'>('a_cortar');
  const [mensaje, setMensaje] = useState<string | null>(null);

  const medidoresACortar = db.getListadoParaCortar();
  const medidoresCortados = db.getListadoParaReconectar();

  const handleConfirmarCorte = (medidorId: number, idStr: string) => {
    if (
      !confirm(
        `¿Confirmar que la cuadrilla retiró físicamente el Medidor N° ${medidorId}? Su mora quedará congelada y no se emitirán más facturas de consumo.`
      )
    ) {
      return;
    }

    try {
      db.confirmarCorteFisico(idStr);
      setMensaje(`Medidor N° ${medidorId} marcado como CORTADO. Mora congelada registrada.`);
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  };

  const handleReconectar = (medidorId: number, idStr: string, total: number) => {
    if (
      !confirm(
        `¿Confirmar cobro de liquidación (${formatGs(total)}) y reinstalación del Medidor N° ${medidorId}?`
      )
    ) {
      return;
    }

    try {
      const { facturaRegularizacion } = db.confirmarReconexion(idStr);
      setMensaje(`Medidor N° ${medidorId} reconectado y restituido a ACTIVO con éxito. Factura de regularización ${facturaRegularizacion.id} emitida y pagada.`);
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">
            Control Operativo de Cortes y Reconexiones
          </h1>
          <p className="text-sm text-stone-600">
            Gestión en terreno de retiro físico de medidores por mora e inspección de reconexiones
          </p>
        </div>
      </div>

      {mensaje && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 text-sm font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
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

      {/* Tabs Operativos */}
      <div className="flex border-b border-stone-200 space-x-4">
        <button
          type="button"
          onClick={() => setTab('a_cortar')}
          className={`py-3 px-4 font-bold text-sm border-b-2 flex items-center gap-2 transition-colors ${
            tab === 'a_cortar'
              ? 'border-red-600 text-red-600'
              : 'border-transparent text-stone-500 hover:text-stone-800'
          }`}
        >
          <Scissors className="w-4 h-4" />
          <span>Medidores a Cortar ({medidoresACortar.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('cortados')}
          className={`py-3 px-4 font-bold text-sm border-b-2 flex items-center gap-2 transition-colors ${
            tab === 'cortados'
              ? 'border-stone-900 text-stone-900'
              : 'border-transparent text-stone-500 hover:text-stone-800'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          <span>Medidores Cortados y Reconexión ({medidoresCortados.length})</span>
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
                Medidores que acumulan 3 o más boletas impagas y superaron el plazo de vencimiento impostergable (día 11).
                Al retirar el medidor, confírmelo aquí para congelar la mora y suspender la facturación mensual.
              </span>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-xs">
            <div className="divide-y divide-stone-100">
              {medidoresACortar.length === 0 ? (
                <div className="p-8 text-center text-sm text-stone-500">
                  No hay medidores con orden de corte pendiente actualmente.
                </div>
              ) : (
                medidoresACortar.map((m) => (
                  <div key={m.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-base text-stone-900">
                          Medidor N° {m.numero_medidor}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-sm bg-red-100 text-red-800 font-bold border border-red-300">
                          Orden de Corte
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
                        {m.facturasVencidas.length} boletas vencidas impagas ({m.facturasVencidas.map(f => f.periodo_facturado).join(', ')})
                      </div>
                    </div>

                    <div className="flex items-center sm:flex-col sm:items-end justify-between gap-2">
                      <div className="text-left sm:text-right">
                        <div className="text-xs text-stone-500">Deuda Total Acumulada:</div>
                        <div className="text-base font-black text-red-600">{formatGs(m.totalDeuda)}</div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleConfirmarCorte(m.numero_medidor, m.id)}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5"
                      >
                        <Scissors className="w-4 h-4" />
                        <span>Confirmar Retiro Físico</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Contenido: Tab Cortados y Reconexión */}
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
                <div className="p-8 text-center text-sm text-stone-500">
                  No hay medidores cortados en el sistema actualmente.
                </div>
              ) : (
                medidoresCortados.map((m) => (
                  <div key={m.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-base text-stone-900">
                          Medidor N° {m.numero_medidor}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-sm bg-stone-200 text-stone-800 font-bold">
                          CORTADO (Físicamente retirado)
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
                        onClick={() => handleReconectar(m.numero_medidor, m.id, m.liquidacion.totalPagar)}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-4 h-4" />
                        <span>Cobrar y Reconectar</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
