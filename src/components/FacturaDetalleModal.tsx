/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { db } from '../services/database';
import { formatGs } from '../services/billingRules';
import { descargarBoletaServer, imprimirBoletaServer } from '../services/apiPdfService';
import {
  descargarPdfDocumento,
  generarComprobantePagoPDF,
  pdfDocToValidBlob,
} from '../services/pdfService';
import {
  ordenarYFiltrarDetalles,
  formatearNumeroFactura,
  formatearAvisoDesconexion,
  formatearMensajePagoExitoso,
  puedeAnularFactura,
  puedeRegistrarPago,
  ETIQUETAS_CONCEPTO_FACTURA,
} from '../services/facturacionHelpers';
import { useAuth } from '../context/AuthContext';
import { MetodoPago, TipoComprobantePago } from '../types';
import {
  X,
  ShieldAlert,
  AlertTriangle,
  CreditCard,
  FileDown,
  Printer,
  Ban,
  Loader2,
  CheckCircle2,
  Receipt,
} from 'lucide-react';

interface FacturaDetalleModalProps {
  facturaId: string;
  onClose: () => void;
  onNotify: (toast: { type: 'success' | 'error'; message: string }) => void;
}

const ESTADO_LABELS: Record<string, { label: string; className: string }> = {
  pendiente: { label: 'Pendiente', className: 'bg-amber-50 text-amber-800 border-amber-300' },
  pagada: { label: 'Pagada', className: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  vencida: { label: 'Vencida', className: 'bg-red-50 text-red-800 border-red-300' },
  anulada: { label: 'Anulada', className: 'bg-stone-100 text-stone-600 border-stone-300' },
  refinanciada: { label: 'Refinanciada', className: 'bg-indigo-50 text-indigo-800 border-indigo-300' },
};

const METODO_LABELS: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
};

export const FacturaDetalleModal: React.FC<FacturaDetalleModalProps> = ({
  facturaId,
  onClose,
  onNotify,
}) => {
  const { user } = useAuth();
  const data = db.getFacturaPorId(facturaId);
  const pagos = db.getPagosPorFactura(facturaId);

  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Estado formulario de pago inline
  const [showPagoForm, setShowPagoForm] = useState(false);
  const [montoPago, setMontoPago] = useState<string>('');
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('efectivo');
  const [fechaPago, setFechaPago] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [numeroRecibo, setNumeroRecibo] = useState<string>('');
  const [tipoComprobante, setTipoComprobante] = useState<TipoComprobantePago>('factura_legal');
  const [esConceptoPersonalizado, setEsConceptoPersonalizado] = useState(false);
  const [conceptoPersonalizado, setConceptoPersonalizado] = useState('');
  const [montoPersonalizado, setMontoPersonalizado] = useState('');
  const [savingPago, setSavingPago] = useState(false);

  // Estado formulario de anulación (solo admin)
  const [showAnularForm, setShowAnularForm] = useState(false);
  const [motivoAnulacion, setMotivoAnulacion] = useState('');
  const [anulando, setAnulando] = useState(false);

  const factura = data?.factura;
  const cliente = data?.cliente;
  const medidor = data?.medidor;

  const saldoPendiente = factura
    ? factura.estado === 'pagada' || factura.estado === 'anulada' || factura.estado === 'refinanciada'
      ? 0
      : factura.saldo_pendiente !== undefined && factura.saldo_pendiente !== null
        ? factura.saldo_pendiente
        : factura.saldo !== undefined && factura.saldo !== null
          ? factura.saldo
          : factura.total
    : 0;

  const montoPagado = factura
    ? factura.estado === 'anulada' || factura.estado === 'refinanciada'
      ? 0
      : factura.monto_pagado !== undefined && factura.monto_pagado !== null
        ? factura.monto_pagado
        : Math.max(0, factura.total - saldoPendiente)
    : 0;

  useEffect(() => {
    setLocalError(null);
    setShowPagoForm(false);
    setShowAnularForm(false);
    setMotivoAnulacion('');
  }, [facturaId]);

  if (!data || !factura || !cliente || !medidor) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      >
        <div className="bg-white rounded-xl max-w-md w-full p-6 border border-stone-200 space-y-4 text-center">
          <p className="text-sm font-bold text-stone-900">Factura no encontrada</p>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 bg-stone-900 text-white text-xs font-bold rounded-lg cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  const detallesOrdenados = ordenarYFiltrarDetalles(data.detalles);
  const numFacturaLegible = formatearNumeroFactura(factura);
  const estadoInfo = ESTADO_LABELS[factura.estado] || {
    label: factura.estado,
    className: 'bg-stone-100 text-stone-700 border-stone-300',
  };

  const puedePagar =
    puedeRegistrarPago(user?.rol) &&
    saldoPendiente > 0 &&
    factura.estado !== 'pagada' &&
    factura.estado !== 'anulada' &&
    factura.estado !== 'refinanciada';

  const puedeAnular =
    puedeAnularFactura(user?.rol) &&
    factura.estado !== 'anulada' &&
    factura.estado !== 'pagada' &&
    factura.estado !== 'refinanciada' &&
    montoPagado === 0 &&
    pagos.length === 0;

  const handleAbrirFormularioPago = () => {
    setLocalError(null);
    setShowAnularForm(false);
    setMontoPago(String(saldoPendiente));
    setMetodoPago('efectivo');
    setFechaPago(new Date().toISOString().split('T')[0]);
    setTipoComprobante('factura_legal');
    setEsConceptoPersonalizado(false);
    setConceptoPersonalizado('');
    setMontoPersonalizado('');
    setNumeroRecibo(db.getNumeroFacturaParaCobro(factura.id));
    setShowPagoForm(true);
  };

  const handleCambiarTipoComprobante = (nuevoTipo: TipoComprobantePago) => {
    setTipoComprobante(nuevoTipo);
    if (nuevoTipo === 'recibo_sin_valor_fiscal') {
      setNumeroRecibo(db.getSiguienteNumeroReciboSinValorFiscal());
    } else {
      setNumeroRecibo(db.getNumeroFacturaParaCobro(factura.id, esConceptoPersonalizado));
    }
  };

  const handleGuardarPago = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    let montoNum: number;
    if (esConceptoPersonalizado) {
      if (!conceptoPersonalizado.trim()) {
        setLocalError('Ingresá la descripción del concepto personalizado.');
        return;
      }
      montoNum = Number(montoPersonalizado);
      if (!Number.isFinite(montoNum) || montoNum <= 0) {
        setLocalError('Ingresá un monto válido mayor a 0 Gs. para el concepto personalizado.');
        return;
      }
    } else {
      montoNum = Number(montoPago);
      if (!Number.isFinite(montoNum) || montoNum <= 0) {
        setLocalError('Ingresá un monto válido mayor a 0 Gs.');
        return;
      }
      if (Math.round(montoNum) > saldoPendiente) {
        setLocalError(`El monto no puede superar el saldo pendiente (${formatGs(saldoPendiente)}).`);
        return;
      }
    }

    if (!numeroRecibo.trim()) {
      setLocalError('El número de comprobante es obligatorio.');
      return;
    }

    setSavingPago(true);
    try {
      const res = await db.registrarCobroAsync({
        facturaId: esConceptoPersonalizado ? undefined : factura.id,
        clienteId: cliente.id,
        medidorId: medidor.id,
        monto: Math.round(montoNum),
        metodoPago,
        fechaPago,
        numeroRecibo: numeroRecibo.trim(),
        cobradorId: user?.id,
        cobradorNombre: user?.nombre,
        tipoComprobante,
        esConceptoPersonalizado,
        conceptoPersonalizado: esConceptoPersonalizado ? conceptoPersonalizado.trim() : undefined,
      });

      if (esConceptoPersonalizado) {
        onNotify({
          type: 'success',
          message: `Cobro personalizado (${conceptoPersonalizado.trim().toUpperCase()}) registrado por ${formatGs(Math.round(montoNum))}. No modificó el saldo de la boleta.`,
        });
      } else {
        const msgInfo = formatearMensajePagoExitoso(res.saldoRestante, formatGs);
        onNotify({ type: 'success', message: msgInfo.titulo });
      }
      setShowPagoForm(false);
    } catch (err: any) {
      const msg = err?.message || 'No se pudo registrar el pago.';
      setLocalError(msg);
      onNotify({ type: 'error', message: msg });
    } finally {
      setSavingPago(false);
    }
  };

  const handleConfirmarAnulacion = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!puedeAnularFactura(user?.rol)) {
      setLocalError('Acceso denegado: solo administradores pueden anular facturas.');
      return;
    }
    if (motivoAnulacion.trim().length < 3) {
      setLocalError('Ingresá un motivo de anulación válido (mínimo 3 caracteres).');
      return;
    }

    setAnulando(true);
    try {
      await db.anularFacturaAsync(factura.id, motivoAnulacion.trim());
      onNotify({
        type: 'success',
        message: `Factura ${numFacturaLegible} anulada correctamente.`,
      });
      setShowAnularForm(false);
    } catch (err: any) {
      const msg = err?.message || 'No se pudo anular la factura.';
      setLocalError(msg);
      onNotify({ type: 'error', message: msg });
    } finally {
      setAnulando(false);
    }
  };

  const pagosMedidor = db.getPagosPorMedidor(medidor.id);
  const pagosPersonalizadosMedidor = pagosMedidor.filter((p) => p.esPersonalizado);

  const construirDocPersonalizado = (pagoPers: (typeof pagosPersonalizadosMedidor)[number]) =>
    generarComprobantePagoPDF({
      factura: null,
      cliente,
      medidor,
      pago: pagoPers,
      tarifa: db.getTarifasVigentes(),
      numeroRecibo: pagoPers.numero_recibo,
      fechaPago: pagoPers.fecha_pago,
      montoAbonado: pagoPers.monto,
      metodoPago: pagoPers.metodo_pago,
      cobradorNombre: pagoPers.cobradorNombre || user?.nombre || 'Caja Central',
      saldoRestante: 0,
      tipoComprobante: pagoPers.tipo_comprobante,
      esConceptoPersonalizado: true,
      conceptoPersonalizado:
        pagoPers.concepto_personalizado || pagoPers.descripcionConcepto || 'COBRO PERSONALIZADO',
    });

  const obtenerUltimoPagoParaComprobante = () => {
    const pagosFac = db
      .getPagosPorFactura(factura.id)
      .slice()
      .sort((a, b) => (b.fecha_pago || '').localeCompare(a.fecha_pago || ''));
    return pagosFac[0];
  };

  const handleDescargarPDF = async () => {
    setGeneratingPdf(true);
    setLocalError(null);
    try {
      if (factura.estado === 'pagada') {
        const ultimoPago = obtenerUltimoPagoParaComprobante();
        const doc = generarComprobantePagoPDF({
          factura,
          cliente,
          medidor,
          pago: ultimoPago,
          detalles: factura.detalles,
          tarifa: db.getTarifasVigentes(),
          cobradorNombre: ultimoPago?.cobradorNombre || user?.nombre || 'Caja Central',
          saldoRestante: 0,
          tipoComprobante: ultimoPago?.tipo_comprobante,
          esConceptoPersonalizado: ultimoPago?.es_concepto_personalizado,
          conceptoPersonalizado: ultimoPago?.concepto_personalizado || undefined,
        });
        const recTag = ultimoPago?.numero_recibo || factura.periodo_facturado;
        descargarPdfDocumento(doc, `Recibo_${recTag}_Med_${medidor.numero_medidor}.pdf`);
      } else {
        const filename = `Boleta_${factura.periodo_facturado}_Med_${medidor.numero_medidor}.pdf`;
        await descargarBoletaServer(factura.id, filename);
      }
    } catch (err: any) {
      setLocalError(err?.message || 'No se pudo generar el PDF.');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleImprimir = async () => {
    setGeneratingPdf(true);
    setLocalError(null);
    try {
      if (factura.estado === 'pagada') {
        const ultimoPago = obtenerUltimoPagoParaComprobante();
        const doc = generarComprobantePagoPDF({
          factura,
          cliente,
          medidor,
          pago: ultimoPago,
          detalles: factura.detalles,
          tarifa: db.getTarifasVigentes(),
          cobradorNombre: ultimoPago?.cobradorNombre || user?.nombre || 'Caja Central',
          saldoRestante: 0,
          tipoComprobante: ultimoPago?.tipo_comprobante,
          esConceptoPersonalizado: ultimoPago?.es_concepto_personalizado,
          conceptoPersonalizado: ultimoPago?.concepto_personalizado || undefined,
        });
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
      } else {
        await imprimirBoletaServer(factura.id);
      }
    } catch (err: any) {
      setLocalError(err?.message || 'No se pudo imprimir la boleta.');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const textoAlertaConsumo = (factura.texto_alerta_consumo || '').trim();
  const mensajeConsumoElevado = textoAlertaConsumo
    ? textoAlertaConsumo.toUpperCase().startsWith('CONSUMO ELEVADO')
      ? textoAlertaConsumo
      : `CONSUMO ELEVADO — ${textoAlertaConsumo}`
    : 'CONSUMO ELEVADO — Su consumo de este mes es superior al habitual. Puede deberse a una pérdida en su propiedad. Por favor verifique.';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ficha-factura-title"
      className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto"
    >
      <div className="bg-white rounded-xl max-w-2xl w-full border border-stone-200 shadow-xl overflow-hidden my-2 sm:my-6">
        {/* Encabezado de Ficha */}
        <div className="px-4 py-3.5 sm:px-6 bg-stone-900 text-white flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="ficha-factura-title" className="font-bold text-sm sm:text-base tracking-tight">
                Factura {numFacturaLegible}
              </h3>
              <span
                className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded border ${estadoInfo.className}`}
              >
                {estadoInfo.label}
              </span>
            </div>
            <p className="text-xs text-stone-300 mt-0.5">
              Medidor N° #{medidor.numero_medidor} · Período facturado {factura.periodo_facturado}
              {factura.periodo_consumo && factura.periodo_consumo !== factura.periodo_facturado
                ? ` · Consumo ${factura.periodo_consumo}`
                : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ficha de factura"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-stone-300 hover:text-white rounded-lg cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-5 text-xs text-stone-800 max-h-[82vh] overflow-y-auto">
          {localError && (
            <div
              role="alert"
              className="p-3 bg-red-50 border border-red-300 rounded-lg text-red-800 font-semibold flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{localError}</span>
            </div>
          )}

          {/* Avisos destacados en ROJO (si aplican ambos, se muestran uno debajo del otro) */}
          {(factura.es_tercera_boleta || factura.alerta_consumo_elevado) && (
            <div className="space-y-2.5">
              {factura.es_tercera_boleta && (
                <div
                  data-testid="alerta-tercera-boleta"
                  className="p-3.5 bg-red-50 border-2 border-red-600 rounded-lg space-y-1 text-red-800"
                >
                  <div className="flex items-center gap-2 font-black text-sm text-red-700 uppercase">
                    <ShieldAlert className="w-5 h-5 shrink-0" />
                    <span>{formatearAvisoDesconexion(factura.fecha_vencimiento)}</span>
                  </div>
                  <p className="font-semibold text-xs text-red-700">
                    AVISO DE CORTE — Tercera boleta impaga. Si no abona antes del {factura.fecha_vencimiento}, se
                    procederá a la desconexión del servicio.
                  </p>
                </div>
              )}

              {factura.alerta_consumo_elevado && (
                <div
                  data-testid="alerta-consumo-elevado"
                  className="p-3.5 bg-red-50 border-2 border-red-600 rounded-lg text-red-800 flex items-start gap-2.5"
                >
                  <AlertTriangle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
                  <p className="font-bold text-xs sm:text-sm text-red-700 leading-snug">
                    {mensajeConsumoElevado}
                  </p>
                </div>
              )}
            </div>
          )}

          {factura.estado === 'anulada' && factura.motivo_anulacion && (
            <div className="p-3 bg-stone-100 border border-stone-300 rounded-lg text-stone-700">
              <span className="font-bold text-stone-900">Motivo de anulación:</span> {factura.motivo_anulacion}
            </div>
          )}

          {factura.estado === 'refinanciada' && (
            <div className="p-3 bg-indigo-50 border border-indigo-300 rounded-lg text-indigo-900">
              <span className="font-bold">Factura refinanciada / consolidada:</span>{' '}
              {factura.motivo || 'Consolidada en una factura posterior.'} El saldo pendiente de esta boleta es 0 Gs. y su deuda se cobra dentro de la factura consolidada.
            </div>
          )}

          {/* Metadatos completos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-stone-50 p-3.5 rounded-lg border border-stone-200">
            <div>
              <span className="text-stone-500 block">Cliente</span>
              <span className="font-bold text-stone-900 text-sm block">{cliente.nombre_completo}</span>
              <span className="text-stone-600">Doc / C.I.: {cliente.documento}</span>
            </div>
            <div>
              <span className="text-stone-500 block">Medidor / Suministro</span>
              <span className="font-bold text-stone-900 text-sm font-mono block">
                Medidor N° #{medidor.numero_medidor}
              </span>
              <span className="text-stone-600">{medidor.direccion}</span>
            </div>
            <div>
              <span className="text-stone-500 block">Fecha de emisión</span>
              <span className="font-semibold text-stone-900 tabular-nums">{factura.fecha_emision}</span>
            </div>
            <div>
              <span className="text-stone-500 block">Fecha de vencimiento</span>
              <span
                className={`font-bold tabular-nums ${
                  factura.es_tercera_boleta ? 'text-red-700' : 'text-stone-900'
                }`}
              >
                {factura.fecha_vencimiento}
              </span>
            </div>
            {factura.fecha_pago && (
              <div>
                <span className="text-stone-500 block">Fecha de pago</span>
                <span className="font-semibold text-emerald-700 tabular-nums">{factura.fecha_pago}</span>
              </div>
            )}
          </div>

          {/* Medición de Consumo */}
          <div className="grid grid-cols-3 gap-2 p-3 bg-stone-50 rounded-lg border border-stone-200">
            <div>
              <span className="text-stone-500 block text-[11px]">Lectura Anterior</span>
              <span className="font-bold text-stone-900 tabular-nums">{factura.lectura_anterior ?? '--'} m³</span>
            </div>
            <div>
              <span className="text-stone-500 block text-[11px]">Lectura Actual</span>
              <span className="font-bold text-stone-900 tabular-nums">{factura.lectura_actual ?? '--'} m³</span>
            </div>
            <div className="text-right">
              <span className="text-stone-500 block text-[11px]">Consumo</span>
              <span className="font-bold text-blue-700 text-sm tabular-nums">{factura.consumo_m3 ?? 0} m³</span>
            </div>
          </div>

          {/* Tabla de Conceptos en orden estricto 1..8 (solo monto > 0) */}
          <div className="space-y-2">
            <h4 className="font-bold text-stone-800 uppercase tracking-wider text-[11px]">
              Detalle de Conceptos Facturados
            </h4>
            <div className="border border-stone-200 rounded-lg overflow-hidden">
              {detallesOrdenados.length > 0 ? (
                <table className="w-full text-xs">
                  <thead className="bg-stone-50 text-stone-600 border-b border-stone-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-bold">Concepto</th>
                      <th className="px-3 py-2 text-right font-bold">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {detallesOrdenados.map((d, idx) => {
                      const etiqueta = ETIQUETAS_CONCEPTO_FACTURA[d.concepto] || d.concepto;
                      const mostrarEtiqueta = !d.descripcion
                        .toLowerCase()
                        .startsWith(etiqueta.toLowerCase());
                      return (
                        <tr key={d.id || idx}>
                          <td className="px-3 py-2.5">
                            <span className="font-semibold text-stone-900 block">{d.descripcion}</span>
                            {mostrarEtiqueta && (
                              <span className="text-[10px] text-stone-500">{etiqueta}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-bold text-stone-900 tabular-nums whitespace-nowrap">
                            {formatGs(d.monto)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="p-3 text-stone-500">Sin conceptos detallados disponibles.</div>
              )}
            </div>
          </div>

          {/* Totales y Saldo Pendiente */}
          <div className="bg-stone-100 p-4 rounded-lg border border-stone-300 space-y-1.5">
            <div className="flex justify-between items-center text-sm font-black text-stone-900 border-b border-stone-200 pb-2">
              <span>TOTAL FACTURA</span>
              <span className="text-base tabular-nums">{formatGs(factura.total)}</span>
            </div>
            <div className="flex justify-between items-center text-xs text-stone-700 pt-1">
              <span>Pagado a la fecha</span>
              <span className="font-bold text-emerald-700 tabular-nums">{formatGs(montoPagado)}</span>
            </div>
            <div className="flex justify-between items-center text-xs font-bold text-stone-900">
              <span>Saldo pendiente</span>
              <span
                className={`text-sm tabular-nums ${
                  saldoPendiente === 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {formatGs(saldoPendiente)}
              </span>
            </div>
          </div>

          {/* Formulario de Pago Inline (dentro de la ficha de factura) */}
          {showPagoForm && puedePagar && (
            <form
              onSubmit={handleGuardarPago}
              className="bg-emerald-50 border border-emerald-300 rounded-lg p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-emerald-950 text-sm flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-emerald-700" />
                  <span>Registrar pago de factura</span>
                </h4>
                <button
                  type="button"
                  onClick={() => setShowPagoForm(false)}
                  className="text-xs font-semibold text-stone-600 hover:text-stone-900 cursor-pointer"
                >
                  Cancelar
                </button>
              </div>

              {/* Checkbox: Cobro con Concepto Personalizado */}
              <label className="flex items-center gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs font-bold text-amber-950 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={esConceptoPersonalizado}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setEsConceptoPersonalizado(checked);
                    setLocalError(null);
                    if (tipoComprobante === 'factura_legal') {
                      setNumeroRecibo(db.getNumeroFacturaParaCobro(factura.id, checked));
                    }
                  }}
                  className="w-4 h-4 rounded-sm border-amber-400 text-amber-600 focus:ring-amber-500"
                />
                <span>Cobro con Concepto Personalizado</span>
              </label>

              {esConceptoPersonalizado ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-white border border-stone-200 rounded-lg">
                  <div>
                    <label htmlFor="pago-concepto-pers" className="text-xs font-bold text-stone-700 block mb-1">
                      Descripción del Concepto *
                    </label>
                    <input
                      id="pago-concepto-pers"
                      type="text"
                      required
                      value={conceptoPersonalizado}
                      onChange={(e) => setConceptoPersonalizado(e.target.value)}
                      placeholder="Ej: Reparación de cañería"
                      className="w-full min-h-[44px] px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm font-semibold text-stone-900 focus:outline-hidden focus:border-emerald-600"
                    />
                  </div>
                  <div>
                    <label htmlFor="pago-monto-pers" className="text-xs font-bold text-stone-700 block mb-1">
                      Monto (Gs.) *
                    </label>
                    <input
                      id="pago-monto-pers"
                      type="number"
                      min={1}
                      step={1}
                      required
                      value={montoPersonalizado}
                      onChange={(e) => setMontoPersonalizado(e.target.value)}
                      placeholder="Ej: 150000"
                      className="w-full min-h-[44px] px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm font-bold text-stone-900 tabular-nums focus:outline-hidden focus:border-emerald-600"
                    />
                  </div>
                  <span className="sm:col-span-2 text-[11px] text-stone-600">
                    Cobro independiente: NO modificará el saldo de esta factura. Sin ERSSAN 2% ni IVA 10%.
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="pago-monto" className="text-xs font-bold text-stone-700 block mb-1">
                      Monto a cobrar (Gs.) *
                    </label>
                    <input
                      id="pago-monto"
                      type="number"
                      min={1}
                      max={saldoPendiente}
                      step={1}
                      required
                      value={montoPago}
                      onChange={(e) => setMontoPago(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm font-bold text-stone-900 tabular-nums focus:outline-hidden focus:border-emerald-600"
                    />
                    <span className="text-[11px] text-stone-600 block mt-0.5 tabular-nums">
                      Saldo pendiente máximo: {formatGs(saldoPendiente)}
                    </span>
                  </div>

                  <div>
                    <label htmlFor="pago-metodo" className="text-xs font-bold text-stone-700 block mb-1">
                      Método de pago *
                    </label>
                    <select
                      id="pago-metodo"
                      value={metodoPago}
                      onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}
                      className="w-full min-h-[44px] px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm font-semibold text-stone-900 focus:outline-hidden focus:border-emerald-600"
                    >
                      <option value="efectivo">Efectivo</option>
                      <option value="transferencia">Transferencia</option>
                      <option value="cheque">Cheque</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {esConceptoPersonalizado && (
                  <div>
                    <label htmlFor="pago-metodo-pers" className="text-xs font-bold text-stone-700 block mb-1">
                      Método de pago *
                    </label>
                    <select
                      id="pago-metodo-pers"
                      value={metodoPago}
                      onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}
                      className="w-full min-h-[44px] px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm font-semibold text-stone-900 focus:outline-hidden focus:border-emerald-600"
                    >
                      <option value="efectivo">Efectivo</option>
                      <option value="transferencia">Transferencia</option>
                      <option value="cheque">Cheque</option>
                    </select>
                  </div>
                )}

                <div>
                  <label htmlFor="pago-fecha" className="text-xs font-bold text-stone-700 block mb-1">
                    Fecha de pago *
                  </label>
                  <input
                    id="pago-fecha"
                    type="date"
                    required
                    value={fechaPago}
                    onChange={(e) => setFechaPago(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm font-semibold text-stone-900 tabular-nums focus:outline-hidden focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label htmlFor="pago-recibo" className="text-xs font-bold text-stone-700 block mb-1">
                    Número de comprobante *
                  </label>
                  <input
                    id="pago-recibo"
                    type="text"
                    required
                    maxLength={30}
                    value={numeroRecibo}
                    onChange={(e) => setNumeroRecibo(e.target.value)}
                    placeholder="001-002-0000001"
                    className="w-full min-h-[44px] px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm font-mono font-semibold text-stone-900 focus:outline-hidden focus:border-emerald-600"
                  />
                </div>
              </div>

              {/* Selector de Tipo de Comprobante (antes de Confirmar pago) */}
              <div className="space-y-1.5">
                <span className="text-xs font-bold text-stone-700 block">Tipo de Comprobante:</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label
                    className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer ${
                      tipoComprobante === 'factura_legal'
                        ? 'bg-white border-emerald-600 text-emerald-950'
                        : 'bg-emerald-50/40 border-stone-200 text-stone-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="detalleTipoComprobante"
                      checked={tipoComprobante === 'factura_legal'}
                      onChange={() => handleCambiarTipoComprobante('factura_legal')}
                      className="text-emerald-600"
                    />
                    <span className="text-xs font-bold">FACTURA LEGAL</span>
                  </label>
                  <label
                    className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer ${
                      tipoComprobante === 'recibo_sin_valor_fiscal'
                        ? 'bg-white border-blue-600 text-blue-950'
                        : 'bg-emerald-50/40 border-stone-200 text-stone-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="detalleTipoComprobante"
                      checked={tipoComprobante === 'recibo_sin_valor_fiscal'}
                      onChange={() => handleCambiarTipoComprobante('recibo_sin_valor_fiscal')}
                      className="text-blue-600"
                    />
                    <span className="text-xs font-bold">RECIBO SIN VALOR FISCAL</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="submit"
                  disabled={savingPago}
                  className="min-h-[44px] w-full sm:w-auto px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {savingPago ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Registrando pago...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Confirmar pago</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Formulario de Anulación Inline (solo admin) */}
          {showAnularForm && puedeAnular && (
            <form
              onSubmit={handleConfirmarAnulacion}
              className="bg-red-50 border border-red-300 rounded-lg p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-red-900 text-sm flex items-center gap-2">
                  <Ban className="w-4 h-4 text-red-600" />
                  <span>Anular factura {numFacturaLegible}</span>
                </h4>
                <button
                  type="button"
                  onClick={() => setShowAnularForm(false)}
                  className="text-xs font-semibold text-stone-600 hover:text-stone-900 cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
              <p className="text-xs text-red-800">
                Esta acción marcará la factura como anulada y revertirá los cargos pendientes asociados para que puedan
                facturarse nuevamente.
              </p>
              <div>
                <label htmlFor="motivo-anulacion" className="text-xs font-bold text-red-900 block mb-1">
                  Motivo de anulación *
                </label>
                <input
                  id="motivo-anulacion"
                  type="text"
                  required
                  minLength={3}
                  value={motivoAnulacion}
                  onChange={(e) => setMotivoAnulacion(e.target.value)}
                  placeholder="Ej: Lectura corregida o error en carga de período"
                  className="w-full min-h-[44px] px-3 py-2 bg-white border border-red-300 rounded-lg text-xs text-stone-900 focus:outline-hidden focus:border-red-600"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={anulando}
                  className="min-h-[44px] w-full sm:w-auto px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-xs font-bold rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {anulando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                  <span>{anulando ? 'Anulando...' : 'Confirmar anulación'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Sección de Pagos realizados */}
          {pagos.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-bold text-stone-800 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Pagos realizados ({pagos.length})</span>
                </h4>
                <span className="text-[11px] font-bold text-emerald-700 tabular-nums">
                  Total pagado: {formatGs(montoPagado)}
                </span>
              </div>
              <div className="border border-stone-200 rounded-lg overflow-hidden divide-y divide-stone-100">
                {pagos.map((p) => (
                  <div
                    key={p.id}
                    className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 bg-white"
                  >
                    <div className="space-y-0.5">
                      <div className="font-semibold text-stone-900 flex flex-wrap items-center gap-2">
                        <span className="tabular-nums">{p.fecha_pago}</span>
                        <span>·</span>
                        <span>{METODO_LABELS[p.metodo_pago] || p.metodo_pago}</span>
                        {p.numero_recibo && (
                          <>
                            <span>·</span>
                            <span className="font-mono text-[11px] text-stone-600">{p.numero_recibo}</span>
                          </>
                        )}
                      </div>
                      <span className="text-[11px] text-stone-500 block">
                        Cobrador: {p.cobradorNombre}
                      </span>
                    </div>
                    <span className="font-bold text-emerald-700 text-sm tabular-nums">
                      {formatGs(p.monto)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Sección de Cobros Independientes (Concepto Personalizado) del Medidor */}
          {pagosPersonalizadosMedidor.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-bold text-amber-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5 text-amber-600" />
                  <span>Cobros con Concepto Personalizado del Medidor ({pagosPersonalizadosMedidor.length})</span>
                </h4>
              </div>
              <div className="border border-amber-200 bg-amber-50/40 rounded-lg overflow-hidden divide-y divide-amber-100">
                {pagosPersonalizadosMedidor.map((p) => (
                  <div
                    key={p.id}
                    className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="space-y-0.5">
                      <div className="font-bold text-stone-900 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 uppercase">
                          Concepto Personalizado
                        </span>
                        <span>{p.descripcionConcepto}</span>
                      </div>
                      <div className="text-[11px] text-stone-600 flex flex-wrap items-center gap-2">
                        <span className="tabular-nums">{p.fecha_pago}</span>
                        <span>·</span>
                        <span>{METODO_LABELS[p.metodo_pago] || p.metodo_pago}</span>
                        {p.numero_recibo && (
                          <>
                            <span>·</span>
                            <span className="font-mono font-semibold text-stone-800">{p.numero_recibo}</span>
                          </>
                        )}
                        <span>·</span>
                        <span>Cobrador: {p.cobradorNombre}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-bold text-emerald-700 text-sm tabular-nums">
                        {formatGs(p.monto)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const doc = construirDocPersonalizado(p);
                          descargarPdfDocumento(
                            doc,
                            `Recibo_Personalizado_${p.numero_recibo || p.fecha_pago}_Med_${medidor.numero_medidor}.pdf`
                          );
                        }}
                        className="px-2.5 py-1.5 bg-white hover:bg-stone-100 text-stone-800 border border-stone-300 rounded-md text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                        <span>PDF</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Barra de acciones al pie */}
        <div className="p-4 bg-stone-50 border-t border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {puedePagar && !showPagoForm && (
              <button
                type="button"
                onClick={handleAbrirFormularioPago}
                className="min-h-[44px] flex-1 sm:flex-none px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <CreditCard className="w-4 h-4" />
                <span>Registrar pago</span>
              </button>
            )}

            {puedeAnular && !showAnularForm && (
              <button
                type="button"
                onClick={() => {
                  setShowPagoForm(false);
                  setShowAnularForm(true);
                }}
                className="min-h-[44px] flex-1 sm:flex-none px-3.5 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-300 text-xs font-bold rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Ban className="w-4 h-4" />
                <span>Anular factura</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={generatingPdf}
              onClick={handleImprimir}
              className="min-h-[44px] flex-1 sm:flex-none px-3.5 py-2 bg-stone-800 hover:bg-stone-900 text-white text-xs font-bold rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {generatingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              <span>Imprimir</span>
            </button>

            <button
              type="button"
              disabled={generatingPdf}
              onClick={handleDescargarPDF}
              className="min-h-[44px] flex-1 sm:flex-none px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {generatingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
              <span>
                {generatingPdf
                  ? 'Generando...'
                  : factura.estado === 'pagada'
                    ? 'Recibo de Pago'
                    : 'Descargar PDF'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
