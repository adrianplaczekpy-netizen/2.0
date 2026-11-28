/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { db } from '../services/database';
import {
  formatGs,
  liquidarReconexion,
  calcularPeriodoSiguiente,
} from '../services/billingRules';
import { Medidor, Factura, Pago, MetodoPago, CargoPendiente } from '../types';
import {
  descargarPdfDocumento,
  generarComprobantePagoPDF,
  pdfDocToValidBlob,
} from '../services/pdfService';
import { useAuth } from '../context/AuthContext';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Printer,
  Download,
  Wrench,
  ShieldCheck,
  Info,
} from 'lucide-react';

interface Props {
  medidorId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (resultado: {
    medidor: Medidor;
    facturaRegularizacion: Factura;
    pago: Pago;
    cargoReconexionDiferida?: CargoPendiente | null;
  }) => void;
}

export const ModalRegistrarReconexion: React.FC<Props> = ({
  medidorId,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { user } = useAuth();

  // Estados del formulario de reconexión y reinstalación
  const [incluirReconexion, setIncluirReconexion] = useState<boolean>(true);
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
  const [procesando, setProcesando] = useState<boolean>(false);

  // Estado una vez completada la reconexión con éxito
  const [resultadoReconexion, setResultadoReconexion] = useState<{
    medidor: Medidor;
    facturaRegularizacion: Factura;
    pago: Pago;
    cargoReconexionDiferida?: CargoPendiente | null;
  } | null>(null);

  const medidorDetalle = isOpen ? db.getMedidorDetalle(medidorId) : null;
  const tarifas = db.getTarifasVigentes();

  const facturasImpagas = useMemo(() => {
    if (!medidorDetalle) return [];
    return medidorDetalle.facturas.filter(
      (f) => f.estado !== 'pagada' && f.estado !== 'anulada' && f.estado !== 'refinanciada'
    );
  }, [medidorDetalle]);

  const liquidacionActual = useMemo(() => {
    if (!medidorDetalle?.medidor) return null;
    return liquidarReconexion(
      medidorDetalle.medidor,
      facturasImpagas,
      tarifas,
      medidorDetalle.cargosPendientes,
      incluirReconexion
    );
  }, [medidorDetalle, facturasImpagas, tarifas, incluirReconexion]);

  if (!isOpen) return null;

  if (!medidorDetalle || !medidorDetalle.medidor || !medidorDetalle.cliente || !liquidacionActual) {
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

  const { medidor, cliente } = medidorDetalle;
  const periodoSiguiente = calcularPeriodoSiguiente(
    (fechaReconexion || new Date().toISOString().split('T')[0]).slice(0, 7)
  );

  const handleConfirmar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (procesando) return;
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

    setProcesando(true);
    try {
      const res = await db.confirmarReconexionAsync(medidor.id, {
        cobradorId: user?.id || operario || 'Caja Central',
        registradoPor: user?.id || user?.nombre || operario,
        metodoPago,
        tipoReinstalacion,
        nuevoNumeroMedidor: numeroNuevoParsed,
        lecturaInicial: lecturaNum,
        fechaReconexion,
        operario,
        observaciones,
        incluirReconexion,
      });

      setResultadoReconexion(res);
      onSuccess(res);
    } catch (err: any) {
      setErrorValidacion(err?.message || 'Error al procesar reconexión.');
    } finally {
      setProcesando(false);
    }
  };

  const handleDescargarPDF = () => {
    if (!resultadoReconexion) return;
    const doc = generarComprobantePagoPDF({
      factura: resultadoReconexion.facturaRegularizacion,
      cliente,
      medidor: resultadoReconexion.medidor,
      pago: resultadoReconexion.pago,
      detalles: resultadoReconexion.facturaRegularizacion.detalles,
      tarifa: db.getTarifasVigentes(),
      cobradorNombre: user?.nombre || operario || 'Caja Central',
      saldoRestante: 0,
    });
    descargarPdfDocumento(
      doc,
      `Recibo_Reconexion_${resultadoReconexion.pago.numero_recibo}_Med_${resultadoReconexion.medidor.numero_medidor}.pdf`
    );
  };

  const handleImprimirComprobante = () => {
    if (!resultadoReconexion) return;
    const doc = generarComprobantePagoPDF({
      factura: resultadoReconexion.facturaRegularizacion,
      cliente,
      medidor: resultadoReconexion.medidor,
      pago: resultadoReconexion.pago,
      detalles: resultadoReconexion.facturaRegularizacion.detalles,
      tarifa: db.getTarifasVigentes(),
      cobradorNombre: user?.nombre || operario || 'Caja Central',
      saldoRestante: 0,
    });
    try {
      const blob = pdfDocToValidBlob(doc);
      const blobUrl = window.URL.createObjectURL(blob);
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.src = blobUrl;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          window.print();
        }
        setTimeout(() => {
          document.body.removeChild(iframe);
          window.URL.revokeObjectURL(blobUrl);
        }, 60000);
      };
    } catch {
      window.print();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-stone-200">
        {/* Cabecera fija del Modal */}
        <div className="sticky top-0 z-10 shrink-0 bg-stone-900 text-white p-3 sm:p-5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="p-1.5 sm:p-2 bg-emerald-500/20 text-emerald-400 rounded-lg shrink-0">
              <Layers className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold tracking-tight truncate">
                Registrar Reconexión de Medidor
              </h2>
              <p className="text-[11px] sm:text-xs text-stone-300 truncate">
                Medidor N° {medidor.numero_medidor} • Titular: {cliente.nombre_completo}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal"
            className="p-1.5 text-stone-400 hover:text-white rounded-lg hover:bg-stone-800 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contenido scrolleable */}
        <div className="overflow-y-auto flex-1">
          {/* Pantalla de Éxito / Comprobante */}
          {resultadoReconexion ? (
            <div className="p-4 pt-5 sm:p-6 sm:pt-6 space-y-4 sm:space-y-5">
            <div className="p-5 bg-emerald-50 border border-emerald-300 rounded-xl space-y-2 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
              <h3 className="text-base font-bold text-emerald-950">
                ¡Reconexión y Pago Registrados con Éxito!
              </h3>
              <p className="text-xs text-emerald-800 max-w-md mx-auto">
                El medidor pasa a estado <span className="font-bold underline">ACTIVO</span> con mora congelada en 0 Gs.
                {resultadoReconexion.cargoReconexionDiferida
                  ? ` La tasa de reconexión (${formatGs(resultadoReconexion.cargoReconexionDiferida.monto)}) quedó diferida como cargo pendiente para el período ${resultadoReconexion.cargoReconexionDiferida.periodo_facturacion}.`
                  : ' En el siguiente período mensual recibirá su factura ordinaria de forma normal.'}
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
              {resultadoReconexion.cargoReconexionDiferida && (
                <div className="flex justify-between border-b border-stone-200 pb-2 text-amber-800">
                  <span className="font-bold">
                    Cargo Diferido ({resultadoReconexion.cargoReconexionDiferida.periodo_facturacion}):
                  </span>
                  <span className="font-bold">
                    {resultadoReconexion.cargoReconexionDiferida.descripcion} —{' '}
                    {formatGs(resultadoReconexion.cargoReconexionDiferida.monto)}
                  </span>
                </div>
              )}
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
                <span>Descargar Recibo de Pago</span>
              </button>
              <button
                type="button"
                onClick={handleImprimirComprobante}
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
          <form onSubmit={handleConfirmar} className="p-4 pt-5 sm:p-6 sm:pt-6 space-y-4 sm:space-y-5">
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

              <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 sm:p-3.5 space-y-2 text-xs">
                <div className="flex justify-between items-center text-stone-700">
                  <span>1. Deuda anterior (última boleta impaga de {facturasImpagas.length} pendientes):</span>
                  <span className="font-semibold text-stone-900">
                    {formatGs(liquidacionActual.subtotalFacturas)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-stone-700">
                  <span>2. Mora congelada (fija al momento del corte):</span>
                  <span className="font-semibold text-stone-900">
                    {formatGs(liquidacionActual.mora)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-stone-700">
                  <span>3. Tasa de Reconexión (pliego tarifario):</span>
                  {incluirReconexion ? (
                    <span className="font-semibold text-stone-900">
                      {formatGs(liquidacionActual.montoReconexion)}
                    </span>
                  ) : (
                    <span className="font-semibold text-amber-700">
                      0 Gs. (Diferida a {periodoSiguiente})
                    </span>
                  )}
                </div>
                {liquidacionActual.subtotalCargos > 0 && (
                  <div className="flex justify-between items-center text-stone-700">
                    <span>4. Otros trabajos pendientes del medidor:</span>
                    <span className="font-semibold text-stone-900">
                      {formatGs(liquidacionActual.subtotalCargos)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center text-stone-600 border-t border-stone-200 pt-1.5">
                  <span>
                    Aporte Regulador ERSSAN ({tarifas.erssan_porcentaje}% sobre todos los conceptos):
                  </span>
                  <span className="font-semibold text-stone-900">
                    {formatGs(liquidacionActual.montoErssan)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm font-black text-stone-900 border-t-2 border-stone-300 pt-2">
                  <span>TOTAL LIQUIDACIÓN A COBRAR:</span>
                  <span className="text-emerald-700 text-base">
                    {formatGs(liquidacionActual.totalPagar)}
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

            {/* Checkbox: Incluir o diferir tasa de reconexión (justo antes de Confirmar) */}
            <label
              htmlFor="incluir-reconexion-checkbox"
              className={`scroll-mt-20 flex items-start gap-3 p-3.5 sm:p-4 rounded-xl cursor-pointer transition-colors ${
                incluirReconexion
                  ? 'bg-emerald-50 border-2 border-emerald-400 text-stone-900'
                  : 'bg-amber-50 border-2 border-amber-400 text-amber-950'
              }`}
            >
              <input
                id="incluir-reconexion-checkbox"
                type="checkbox"
                checked={incluirReconexion}
                onChange={(e) => setIncluirReconexion(e.target.checked)}
                className="mt-0.5 h-5 w-5 rounded border-stone-400 text-emerald-600 focus:ring-emerald-500 cursor-pointer shrink-0"
              />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-start gap-1.5">
                  {incluirReconexion ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  <span className="text-sm font-bold leading-snug block">
                    Incluir reconexión en la factura de regularización ({formatGs(tarifas.monto_reconexion)})
                  </span>
                </div>
                <p className="text-xs text-stone-700 leading-snug">
                  {incluirReconexion
                    ? `Total a cobrar ahora: ${formatGs(liquidacionActual.totalPagar)}. Desmarque para diferir al mes ${periodoSiguiente}.`
                    : `Diferida a ${periodoSiguiente} como cargo pendiente "RECONEXIÓN". Total a cobrar ahora: ${formatGs(liquidacionActual.totalPagar)}.`}
                </p>
              </div>
            </label>

            {/* Botones de acción */}
            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 sm:gap-3 pt-3 border-t border-stone-200">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 text-stone-600 hover:text-stone-900 text-xs font-bold cursor-pointer text-center"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={procesando}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-60 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-colors"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  {procesando
                    ? 'Procesando reconexión...'
                    : 'Confirmar Pago, Regularización y Reconexión'}
                </span>
              </button>
            </div>
          </form>
        )}
        </div>
      </div>
    </div>
  );
};
