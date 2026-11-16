/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { db } from '../services/database';
import { formatGs } from '../services/billingRules';
import { Medidor, Factura, Pago, MetodoPago } from '../types';
import { generarBoletaPDF } from '../services/pdfService';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Printer,
  Download,
  Wrench,
  ShieldCheck,
  Calendar,
  User,
  Hash,
} from 'lucide-react';

interface Props {
  medidorId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (resultado: { medidor: Medidor; facturaRegularizacion: Factura; pago: Pago }) => void;
}

export const ModalRegistrarReconexion: React.FC<Props> = ({
  medidorId,
  isOpen,
  onClose,
  onSuccess,
}) => {
  if (!isOpen) return null;

  const medidorDetalle = db.getMedidorDetalle(medidorId);
  const tarifas = db.getTarifasVigentes();

  // Estados del formulario de reconexión y reinstalación
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('efectivo');
  const [operario, setOperario] = useState<string>('Operario Cuadrilla');
  const [fechaReconexion, setFechaReconexion] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [tipoReinstalacion, setTipoReinstalacion] = useState<'mismo_medidor' | 'nuevo_medidor'>(
    'mismo_medidor'
  );
  const [nuevoNumeroMedidor, setNuevoNumeroMedidor] = useState<string>('');
  const [lecturaInicial, setLecturaInicial] = useState<string>('0');
  const [observaciones, setObservaciones] = useState<string>('');
  const [errorValidacion, setErrorValidacion] = useState<string | null>(null);

  // Estado una vez completada la reconexión con éxito
  const [resultadoReconexion, setResultadoReconexion] = useState<{
    medidor: Medidor;
    facturaRegularizacion: Factura;
    pago: Pago;
  } | null>(null);

  if (!medidorDetalle || !medidorDetalle.medidor || !medidorDetalle.cliente) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-xl max-w-md w-full text-center space-y-4">
          <p className="text-sm text-stone-600">Medidor no encontrado.</p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-stone-200 text-stone-800 rounded-lg text-xs font-bold"
          >
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  const { medidor, cliente, liquidacionReconexion, facturas } = medidorDetalle;
  const facturasImpagas = facturas.filter((f) => f.estado !== 'pagada');

  const handleConfirmar = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorValidacion(null);

    // Validar tipo de reinstalación
    let numeroNuevoParsed: number | undefined;
    if (tipoReinstalacion === 'nuevo_medidor') {
      const trimmed = nuevoNumeroMedidor.trim();
      if (!trimmed) {
        setErrorValidacion('Debe ingresar el nuevo número de medidor asignado.');
        return;
      }
      if (/^0\d+/.test(trimmed)) {
        setErrorValidacion('El número de medidor no puede tener ceros a la izquierda.');
        return;
      }
      if (!/^\d+$/.test(trimmed)) {
        setErrorValidacion('El número de medidor debe ser un número entero sin símbolos.');
        return;
      }
      numeroNuevoParsed = parseInt(trimmed, 10);
      if (numeroNuevoParsed < 1 || numeroNuevoParsed > tarifas.max_numero_medidor) {
        setErrorValidacion(`El número de medidor debe estar entre 1 y ${tarifas.max_numero_medidor}.`);
        return;
      }
    }

    const lecturaNum = parseInt(lecturaInicial.trim(), 10);
    if (isNaN(lecturaNum) || lecturaNum < 0) {
      setErrorValidacion('La lectura inicial debe ser un número entero mayor o igual a 0 m³.');
      return;
    }

    try {
      const res = db.confirmarReconexion(medidor.id, {
        cobradorId: operario || 'Caja Central',
        metodoPago,
        tipoReinstalacion,
        nuevoNumeroMedidor: numeroNuevoParsed,
        lecturaInicial: lecturaNum,
        fechaReconexion,
        operario,
        observaciones,
      });

      setResultadoReconexion(res);
      onSuccess(res);
    } catch (err: any) {
      setErrorValidacion(err.message || 'Error al procesar reconexión.');
    }
  };

  const handleDescargarPDF = () => {
    if (!resultadoReconexion) return;
    const doc = generarBoletaPDF({
      factura: resultadoReconexion.facturaRegularizacion,
      cliente,
      medidor: resultadoReconexion.medidor,
      detalles: resultadoReconexion.facturaRegularizacion.detalles,
    });
    doc.save(
      `Factura_Regularizacion_Med_${resultadoReconexion.medidor.numero_medidor}_${resultadoReconexion.facturaRegularizacion.periodo_facturado}.pdf`
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden border border-stone-200 my-8">
        {/* Cabecera del Modal */}
        <div className="bg-stone-900 text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">
                Registrar Reconexión de Medidor
              </h2>
              <p className="text-xs text-stone-300">
                Medidor N° {medidor.numero_medidor} • Titular: {cliente.nombre_completo}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-white rounded-lg hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Pantalla de Éxito / Comprobante */}
        {resultadoReconexion ? (
          <div className="p-6 space-y-5">
            <div className="p-5 bg-emerald-50 border border-emerald-300 rounded-xl space-y-2 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
              <h3 className="text-base font-bold text-emerald-950">
                ¡Reconexión y Pago Registrados con Éxito!
              </h3>
              <p className="text-xs text-emerald-800 max-w-md mx-auto">
                El medidor pasa a estado <span className="font-bold underline">ACTIVO</span> con mora congelada en 0 Gs. En el siguiente período mensual recibirá su factura ordinaria de forma normal.
              </p>
            </div>

            {/* Ficha Resumen de la Factura de Regularización */}
            <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 space-y-3 text-xs">
              <div className="flex justify-between border-b border-stone-200 pb-2">
                <span className="font-bold text-stone-700">Factura de Regularización:</span>
                <span className="font-mono font-bold text-stone-900">{resultadoReconexion.facturaRegularizacion.id}</span>
              </div>
              <div className="flex justify-between border-b border-stone-200 pb-2">
                <span className="font-bold text-stone-700">N° de Recibo de Caja:</span>
                <span className="font-mono font-bold text-emerald-700">{resultadoReconexion.pago.numero_recibo}</span>
              </div>
              <div className="flex justify-between border-b border-stone-200 pb-2">
                <span className="font-bold text-stone-700">Medidor Activo:</span>
                <span className="font-bold text-stone-900">
                  N° {resultadoReconexion.medidor.numero_medidor}
                  {resultadoReconexion.medidor.numero_medidor_anterior && (
                    <span className="text-stone-500 font-normal ml-1">
                      (Anterior: N° {resultadoReconexion.medidor.numero_medidor_anterior})
                    </span>
                  )}
                </span>
              </div>
              <div className="flex justify-between border-b border-stone-200 pb-2">
                <span className="font-bold text-stone-700">Lectura Inicial de Reconexión:</span>
                <span className="font-bold text-stone-900">{resultadoReconexion.medidor.lectura_inicial_reconexion} m³</span>
              </div>
              <div className="flex justify-between pt-1 text-sm font-black text-stone-900">
                <span>Total Abonado (100% Cancelado):</span>
                <span>{formatGs(resultadoReconexion.facturaRegularizacion.total)}</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={handleDescargarPDF}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Download className="w-4 h-4" />
                <span>Descargar Factura PDF</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer border border-stone-200"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir Comprobante</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="py-2.5 px-4 bg-stone-800 hover:bg-stone-900 text-white rounded-lg text-xs font-bold cursor-pointer"
              >
                Finalizar
              </button>
            </div>
          </div>
        ) : (
          /* Formulario de Reconexión en 3 Pasos */
          <form onSubmit={handleConfirmar} className="p-6 space-y-5">
            {errorValidacion && (
              <div className="p-3 bg-red-50 border border-red-300 rounded-lg text-red-800 text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{errorValidacion}</span>
              </div>
            )}

            {/* Paso 1: Factura de Regularización generada por el sistema */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-stone-700 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-stone-900 text-white text-[10px] flex items-center justify-center font-bold">
                    1
                  </span>
                  <span>Factura de Regularización del Medidor</span>
                </span>
                <span className="text-[10px] text-stone-500 font-medium">Regulado por ERSSAN</span>
              </div>

              <div className="bg-stone-50 border border-stone-200 rounded-xl p-3.5 space-y-2 text-xs">
                <div className="flex justify-between items-center text-stone-700">
                  <span>1. Deuda anterior acumulada ({facturasImpagas.length} boletas impagas):</span>
                  <span className="font-semibold text-stone-900">
                    {formatGs(liquidacionReconexion.subtotalFacturas)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-stone-700">
                  <span>2. Mora congelada (fija al momento del corte):</span>
                  <span className="font-semibold text-stone-900">
                    {formatGs(liquidacionReconexion.mora)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-stone-700">
                  <span>3. Tasa de Reconexión (pliego tarifario):</span>
                  <span className="font-semibold text-stone-900">
                    {formatGs(liquidacionReconexion.montoReconexion)}
                  </span>
                </div>
                {liquidacionReconexion.subtotalCargos > 0 && (
                  <div className="flex justify-between items-center text-stone-700">
                    <span>4. Otros trabajos pendientes del medidor:</span>
                    <span className="font-semibold text-stone-900">
                      {formatGs(liquidacionReconexion.subtotalCargos)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center text-stone-600 border-t border-stone-200 pt-1.5">
                  <span>Aporte Regulador ERSSAN (2% sobre conceptos):</span>
                  <span className="font-semibold text-stone-900">
                    {formatGs(liquidacionReconexion.erssan)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm font-black text-stone-900 border-t-2 border-stone-300 pt-2">
                  <span>TOTAL LIQUIDACIÓN A COBRAR:</span>
                  <span className="text-emerald-700 text-base">
                    {formatGs(liquidacionReconexion.totalPagar)}
                  </span>
                </div>
              </div>
            </div>

            {/* Paso 2: Registro del Pago */}
            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-stone-700 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-stone-900 text-white text-[10px] flex items-center justify-center font-bold">
                  2
                </span>
                <span>Registro de Cobranza del Pago</span>
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-stone-600 block mb-1">
                    Método de Pago:
                  </label>
                  <select
                    value={metodoPago}
                    onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}
                    className="w-full text-xs p-2 bg-stone-50 border border-stone-300 rounded-lg font-semibold text-stone-900"
                  >
                    <option value="efectivo">Efectivo en Caja / Cuadrilla</option>
                    <option value="transferencia">Transferencia Bancaria (SIPAP / QR)</option>
                    <option value="cheque">Cheque al Día</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-stone-600 block mb-1">
                    Operario / Cobrador Responsable:
                  </label>
                  <input
                    type="text"
                    value={operario}
                    onChange={(e) => setOperario(e.target.value)}
                    placeholder="Ej: Cuadrilla Central, Carlos Gómez"
                    className="w-full text-xs p-2 bg-stone-50 border border-stone-300 rounded-lg font-semibold text-stone-900"
                  />
                </div>
              </div>
            </div>

            {/* Paso 3: Reinstalación del medidor (o nuevo medidor) */}
            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-stone-700 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-stone-900 text-white text-[10px] flex items-center justify-center font-bold">
                  3
                </span>
                <span>Reinstalación de Medidor (o nuevo medidor)</span>
              </span>

              <div className="bg-stone-50 border border-stone-200 rounded-xl p-3.5 space-y-3">
                {/* Selector de modalidad */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTipoReinstalacion('mismo_medidor');
                      setErrorValidacion(null);
                    }}
                    className={`p-2.5 rounded-lg border text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                      tipoReinstalacion === 'mismo_medidor'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-100'
                    }`}
                  >
                    <Wrench className="w-4 h-4 shrink-0" />
                    <span className="text-left">
                      Reinstalar mismo medidor (N° {medidor.numero_medidor})
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setTipoReinstalacion('nuevo_medidor');
                      setErrorValidacion(null);
                    }}
                    className={`p-2.5 rounded-lg border text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                      tipoReinstalacion === 'nuevo_medidor'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-100'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span className="text-left">Instalar nuevo medidor (Recambio)</span>
                  </button>
                </div>

                {/* Si es nuevo medidor, campo de nuevo número */}
                {tipoReinstalacion === 'nuevo_medidor' && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-1.5">
                    <label className="text-xs font-bold text-blue-950 block">
                      Nuevo N° de Medidor (Rango 1 a {tarifas.max_numero_medidor}):
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={tarifas.max_numero_medidor}
                      value={nuevoNumeroMedidor}
                      onChange={(e) => setNuevoNumeroMedidor(e.target.value)}
                      placeholder="Ej: 145"
                      className="w-full text-xs p-2 bg-white border border-blue-300 rounded-lg font-mono font-bold text-stone-900"
                      required
                    />
                    <p className="text-[10px] text-blue-700">
                      Se validará que el número sea entero y no esté asignado a otro punto de suministro.
                    </p>
                  </div>
                )}

                {/* Lectura inicial y Fecha */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-stone-600 block mb-1">
                      Lectura Inicial de Reinstalación (m³):
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={lecturaInicial}
                      onChange={(e) => setLecturaInicial(e.target.value)}
                      placeholder="0"
                      className="w-full text-xs p-2 bg-white border border-stone-300 rounded-lg font-mono font-bold text-stone-900"
                      required
                    />
                    <span className="text-[10px] text-stone-500 block mt-0.5">
                      Punto de partida para el consumo del siguiente mes.
                    </span>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-stone-600 block mb-1">
                      Fecha de Reconexión:
                    </label>
                    <input
                      type="date"
                      value={fechaReconexion}
                      onChange={(e) => setFechaReconexion(e.target.value)}
                      className="w-full text-xs p-2 bg-white border border-stone-300 rounded-lg font-semibold text-stone-900"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-stone-600 block mb-1">
                    Observaciones técnicas de la reconexión (opcional):
                  </label>
                  <input
                    type="text"
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                    placeholder="Ej: Precinto N° 45892 colocado, llave de paso verificada"
                    className="w-full text-xs p-2 bg-white border border-stone-300 rounded-lg text-stone-800"
                  />
                </div>
              </div>
            </div>

            {/* Botones de acción */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-stone-200">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 text-stone-600 hover:text-stone-900 text-xs font-bold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirmar Pago, Regularización y Reconexión</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
