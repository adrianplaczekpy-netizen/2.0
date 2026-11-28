/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../services/database';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { formatGs } from '../services/billingRules';
import { Factura, MetodoPago, TipoComprobantePago } from '../types';
import {
  descargarPdfDocumento,
  generarBoletaPDF,
  generarComprobantePagoPDF,
  pdfDocToValidBlob,
} from '../services/pdfService';
import {
  CreditCard,
  Search,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  FileDown,
  Printer,
  DollarSign,
  User,
  MapPin,
  RefreshCw,
  X,
  Sparkles,
} from 'lucide-react';
import { ModalRegistrarReconexion } from './ModalRegistrarReconexion';

export const CajaCobranzasView: React.FC = () => {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMedidorId, setSelectedMedidorId] = useState<string | null>(null);
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('efectivo');

  // Modal para cobro total, parcial o concepto personalizado
  const [modalCobroFactura, setModalCobroFactura] = useState<Factura | null>(null);
  const [modalReconexionOpen, setModalReconexionOpen] = useState(false);
  const [montoACobrarInput, setMontoACobrarInput] = useState<string>('');
  const [tipoComprobante, setTipoComprobante] = useState<TipoComprobantePago>('factura_legal');
  const [esConceptoPersonalizado, setEsConceptoPersonalizado] = useState(false);
  const [conceptoPersonalizado, setConceptoPersonalizado] = useState('');
  const [montoPersonalizadoInput, setMontoPersonalizadoInput] = useState('');
  const [imprimirReciboAlConfirmar, setImprimirReciboAlConfirmar] = useState(false);
  const [guardandoCobro, setGuardandoCobro] = useState(false);
  const [procesandoReconexion, setProcesandoReconexion] = useState(false);
  const [errorCobro, setErrorCobro] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const [comprobantePago, setComprobantePago] = useState<{
    recibo: string;
    monto: number;
    metodo: string;
    facturaId: string | null;
    clienteId: string;
    medidorId: string;
    medidorNum: number;
    clienteNombre: string;
    saldoRestante: number;
    medidorPasoAActivo: boolean;
    salioDePendienteCorte?: boolean;
    nuevoEstado?: string;
    fechaPago?: string;
    cobradorNombre?: string;
    tipoComprobante?: TipoComprobantePago;
    esConceptoPersonalizado?: boolean;
    conceptoPersonalizado?: string;
  } | null>(null);

  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

  const obtenerSaldoFactura = (factura: Factura): number =>
    factura.estado === 'pagada' || factura.estado === 'anulada' || factura.estado === 'refinanciada'
      ? 0
      : factura.saldo_pendiente ?? (factura.saldo !== undefined ? factura.saldo : factura.total);

  // Buscar medidores / clientes
  const medidoresRes = db.getMedidores({ search: searchTerm, limit: 15 });
  const medidorActual = selectedMedidorId
    ? db.getMedidorDetalle(selectedMedidorId)
    : medidoresRes.medidores.length > 0
    ? db.getMedidorDetalle(medidoresRes.medidores[0].id)
    : null;
  const historialPagosMedidor = medidorActual?.medidor
    ? db.getPagosPorMedidor(medidorActual.medidor.id)
    : [];

  const abrirModalCobro = (factura: Factura) => {
    const saldo = obtenerSaldoFactura(factura);
    setModalCobroFactura(factura);
    setMontoACobrarInput(String(saldo));
    setTipoComprobante('factura_legal');
    setEsConceptoPersonalizado(false);
    setConceptoPersonalizado('');
    setMontoPersonalizadoInput('');
    setImprimirReciboAlConfirmar(false);
    setErrorCobro(null);
  };

  const handleConfirmarCobro = async () => {
    if (
      guardandoCobro ||
      !modalCobroFactura ||
      !medidorActual?.medidor ||
      !medidorActual?.cliente
    ) {
      return;
    }

    setErrorCobro(null);
    const saldo = obtenerSaldoFactura(modalCobroFactura);
    let montoNum: number;

    if (esConceptoPersonalizado) {
      if (!conceptoPersonalizado.trim()) {
        setErrorCobro('Debe ingresar la descripción del concepto personalizado.');
        return;
      }
      montoNum = parseInt(montoPersonalizadoInput.replace(/\D/g, ''), 10);
      if (isNaN(montoNum) || montoNum <= 0) {
        setErrorCobro('El monto del concepto personalizado debe ser mayor a 0 Gs.');
        return;
      }
    } else {
      montoNum = parseInt(montoACobrarInput.replace(/\D/g, ''), 10);
      if (isNaN(montoNum) || montoNum <= 0) {
        setErrorCobro('El monto a cobrar debe ser mayor a 0 Gs.');
        return;
      }
      if (montoNum > saldo) {
        setErrorCobro(
          `El monto (${formatGs(montoNum)}) no puede superar el saldo pendiente (${formatGs(saldo)}).`
        );
        return;
      }
    }

    const debeImprimir = imprimirReciboAlConfirmar;
    const medidorIdActual = medidorActual.medidor.id;
    const clienteIdActual = medidorActual.cliente.id;
    const medidorNumActual = medidorActual.medidor.numero_medidor;
    const clienteNombreActual = medidorActual.cliente.nombre_completo;
    const tipoComprobanteSeleccionado = tipoComprobante;
    const esPersSeleccionado = esConceptoPersonalizado;
    const conceptoPersSeleccionado = esConceptoPersonalizado ? conceptoPersonalizado.trim() : undefined;

    setGuardandoCobro(true);
    try {
      const res = await db.registrarCobroAsync({
        facturaId: esPersSeleccionado ? undefined : modalCobroFactura.id,
        clienteId: clienteIdActual,
        medidorId: medidorIdActual,
        monto: montoNum,
        metodoPago,
        cobradorId: user?.id,
        cobradorNombre: user?.nombre || user?.email || 'Cobrador de Caja',
        tipoComprobante: tipoComprobanteSeleccionado,
        esConceptoPersonalizado: esPersSeleccionado,
        conceptoPersonalizado: conceptoPersSeleccionado,
      });

      setComprobantePago({
        recibo: res.pago.numero_recibo || '001-002-0001',
        monto: res.pago.monto,
        metodo: metodoPago,
        facturaId: esPersSeleccionado ? null : modalCobroFactura.id,
        clienteId: clienteIdActual,
        medidorId: medidorIdActual,
        medidorNum: medidorNumActual,
        clienteNombre: clienteNombreActual,
        saldoRestante: esPersSeleccionado ? saldo : res.saldoRestante,
        medidorPasoAActivo: res.medidorPasoAActivo,
        salioDePendienteCorte: res.salioDePendienteCorte,
        nuevoEstado: res.estadoMedidorActualizado,
        fechaPago: res.pago.fecha_pago,
        cobradorNombre: user?.nombre || user?.email || 'Cobrador de Caja',
        tipoComprobante: res.pago.tipo_comprobante || tipoComprobanteSeleccionado,
        esConceptoPersonalizado: res.pago.es_concepto_personalizado ?? esPersSeleccionado,
        conceptoPersonalizado: res.pago.concepto_personalizado || conceptoPersSeleccionado,
      });

      const esPagoTotal = res.saldoRestante === 0;
      const etiquetaTipo =
        tipoComprobanteSeleccionado === 'recibo_sin_valor_fiscal'
          ? 'Recibo sin valor fiscal'
          : 'Factura legal';
      const toastMsg = esPersSeleccionado
        ? `${etiquetaTipo} (${conceptoPersSeleccionado?.toUpperCase()}) registrado por ${formatGs(montoNum)} sin modificar deuda de agua.`
        : esPagoTotal
          ? `Factura pagada completamente (${formatGs(montoNum)}).`
          : `Cobro registrado (${formatGs(montoNum)}). Saldo restante: ${formatGs(res.saldoRestante)}.`;

      let msg = esPersSeleccionado
        ? `Cobro independiente "${conceptoPersSeleccionado}" de ${formatGs(montoNum)} registrado con éxito (${etiquetaTipo} N° ${res.pago.numero_recibo}). La deuda de agua del medidor permanece intacta.`
        : `Cobro de ${formatGs(montoNum)} registrado con éxito (${esPagoTotal ? 'Factura pagada completamente' : `Pago Parcial - Saldo restante: ${formatGs(res.saldoRestante)}`}).`;

      if (!esPersSeleccionado && res.medidorPasoAActivo) {
        msg += ` ¡Todas las facturas están saldadas! El Medidor N° ${medidorNumActual} pasa a estado ACTIVO automáticamente.`;
      } else if (!esPersSeleccionado && res.salioDePendienteCorte) {
        msg += ` Se abonó la 3ra boleta que originó el aviso de corte. El Medidor N° ${medidorNumActual} deja de estar en pendiente de corte (estado actualizado a ${res.estadoMedidorActualizado.toUpperCase()}).`;
      }

      setModalCobroFactura(null);
      setMensajeExito(msg);
      setToast({ type: 'success', message: toastMsg });
      setSelectedMedidorId(medidorIdActual);

      if (isSupabaseConfigured) {
        await db.loadFromSupabase({ force: true });
      }

      if (debeImprimir && typeof window !== 'undefined' && typeof window.print === 'function') {
        setTimeout(() => window.print(), 150);
      }
    } catch (e: any) {
      const errMsg = e?.message || 'Error al registrar el cobro en Supabase.';
      setErrorCobro(errMsg);
      setToast({ type: 'error', message: errMsg });
    } finally {
      setGuardandoCobro(false);
    }
  };

  const handleDescargarBoleta = (factura: Factura) => {
    if (!medidorActual || !medidorActual.cliente || !medidorActual.medidor) return;
    if (factura.estado === 'pagada') {
      const pagosFactura = db
        .getFullData()
        .pagos.filter((p) => p.factura_id === factura.id)
        .sort((a, b) => (b.fecha_pago || '').localeCompare(a.fecha_pago || ''));
      const ultimoPago = pagosFactura[0];
      const doc = generarComprobantePagoPDF({
        factura,
        cliente: medidorActual.cliente,
        medidor: medidorActual.medidor,
        pago: ultimoPago,
        detalles: factura.detalles,
        tarifa: db.getTarifasVigentes(),
        cobradorNombre:
          user?.nombre || user?.email || ultimoPago?.cobrador_id || 'Caja Central',
        saldoRestante: 0,
        tipoComprobante: ultimoPago?.tipo_comprobante,
        esConceptoPersonalizado: ultimoPago?.es_concepto_personalizado,
        conceptoPersonalizado: ultimoPago?.concepto_personalizado || undefined,
      });
      const recTag = ultimoPago?.numero_recibo || factura.periodo_facturado;
      descargarPdfDocumento(doc, `Recibo_${recTag}_Med_${medidorActual.medidor.numero_medidor}.pdf`);
      return;
    }

    const doc = generarBoletaPDF({
      factura,
      cliente: medidorActual.cliente,
      medidor: medidorActual.medidor,
      detalles: factura.detalles,
      tarifa: db.getTarifasVigentes(),
    });
    descargarPdfDocumento(
      doc,
      `Boleta_${factura.periodo_facturado}_Med_${medidorActual.medidor.numero_medidor}.pdf`
    );
  };

  const construirDocComprobanteActual = () => {
    if (!comprobantePago) return null;
    const facBundle = comprobantePago.facturaId
      ? db.getFacturaPorId(comprobantePago.facturaId)
      : null;
    const medDetalle = db.getMedidorDetalle(comprobantePago.medidorId);
    const cliente = facBundle?.cliente || medDetalle?.cliente || medidorActual?.cliente;
    const medidor = facBundle?.medidor || medDetalle?.medidor || medidorActual?.medidor;
    const factura = comprobantePago.esConceptoPersonalizado
      ? null
      : facBundle?.factura ||
        medidorActual?.facturas.find((f) => f.id === comprobantePago.facturaId) ||
        null;

    if (!cliente || !medidor) return null;
    if (!comprobantePago.esConceptoPersonalizado && !factura) return null;

    return generarComprobantePagoPDF({
      factura,
      cliente,
      medidor,
      detalles: facBundle?.detalles || factura?.detalles,
      tarifa: db.getTarifasVigentes(),
      numeroRecibo: comprobantePago.recibo,
      fechaPago: comprobantePago.fechaPago,
      montoAbonado: comprobantePago.monto,
      metodoPago: comprobantePago.metodo,
      cobradorNombre:
        comprobantePago.cobradorNombre || user?.nombre || user?.email || 'Caja Central',
      saldoRestante: comprobantePago.saldoRestante,
      tipoComprobante: comprobantePago.tipoComprobante,
      esConceptoPersonalizado: comprobantePago.esConceptoPersonalizado,
      conceptoPersonalizado: comprobantePago.conceptoPersonalizado,
    });
  };

  const handleDescargarComprobanteActual = () => {
    if (!comprobantePago) return;
    const doc = construirDocComprobanteActual();
    if (!doc) return;
    const prefix =
      comprobantePago.tipoComprobante === 'recibo_sin_valor_fiscal' ? 'Recibo' : 'Factura';
    descargarPdfDocumento(
      doc,
      `${prefix}_${comprobantePago.recibo}_Med_${comprobantePago.medidorNum}.pdf`
    );
  };

  const handleImprimirComprobante = () => {
    const doc = construirDocComprobanteActual();
    if (!doc) {
      window.print();
      return;
    }
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

  const handleCobrarReconexion = async () => {
    if (
      procesandoReconexion ||
      !medidorActual ||
      !medidorActual.medidor ||
      !medidorActual.cliente ||
      !medidorActual.liquidacionReconexion
    ) {
      return;
    }

    const medidorIdActual = medidorActual.medidor.id;
    const medidorNumActual = medidorActual.medidor.numero_medidor;
    const clienteNombreActual = medidorActual.cliente.nombre_completo;

    setErrorCobro(null);
    setProcesandoReconexion(true);
    try {
      const { facturaRegularizacion, pago } = await db.confirmarReconexionAsync(
        medidorIdActual,
        {
          cobradorId: user?.id || 'Caja Central',
          metodoPago,
          operario: user?.nombre || user?.email || 'Caja Central',
        }
      );

      if (isSupabaseConfigured) {
        await db.loadFromSupabase({ force: true });
      }

      setComprobantePago({
        recibo: pago.numero_recibo || `REC-REG-${Date.now().toString().slice(-5)}`,
        monto: facturaRegularizacion.total,
        metodo: metodoPago,
        facturaId: facturaRegularizacion.id,
        clienteId: medidorActual.cliente.id,
        medidorId: medidorIdActual,
        medidorNum: medidorNumActual,
        clienteNombre: clienteNombreActual,
        saldoRestante: 0,
        medidorPasoAActivo: true,
        fechaPago: pago.fecha_pago,
        cobradorNombre: user?.nombre || user?.email || 'Caja Central',
      });

      const msg = `Medidor N° ${medidorNumActual} regularizado y reconectado exitosamente. Pasa a estado ACTIVO. Total cobrado: ${formatGs(facturaRegularizacion.total)}.`;
      setMensajeExito(msg);
      setToast({
        type: 'success',
        message: `Factura de regularización pagada completamente (${formatGs(facturaRegularizacion.total)}).`,
      });
      setSelectedMedidorId(medidorIdActual);
    } catch (e: any) {
      const errMsg = `Error en reconexión: ${e?.message || 'Error inesperado'}`;
      setErrorCobro(errMsg);
      setToast({ type: 'error', message: errMsg });
    } finally {
      setProcesandoReconexion(false);
    }
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
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span className="flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="opacity-70 hover:opacity-100 cursor-pointer"
            aria-label="Cerrar notificación"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">Módulo de Caja y Cobranzas</h1>
          <p className="text-sm text-stone-600">
            Cobro en ventanilla de pagos totales o parciales, emisión de recibos y activación automática de medidores saldados
          </p>
        </div>
      </div>

      {/* Buscador de cliente / medidor */}
      <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
        <label className="text-xs font-bold text-stone-700 uppercase tracking-wider block mb-1.5">
          Buscar por N° de Medidor, Documento (C.I.) o Nombre de Cliente
        </label>
        <div className="relative">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Ej: 15, 1420500, o González..."
            className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-900 focus:outline-hidden focus:border-blue-600 focus:bg-white"
          />
          <Search className="w-5 h-5 text-stone-400 absolute left-3 top-3" />
        </div>

        {/* Resultados rápidos de búsqueda */}
        {medidoresRes.medidores.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 pt-2 border-t border-stone-100">
            {medidoresRes.medidores.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setSelectedMedidorId(m.id);
                  setMensajeExito(null);
                  setComprobantePago(null);
                }}
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all text-left flex items-center gap-1.5 cursor-pointer ${
                  medidorActual?.medidor?.id === m.id
                    ? 'bg-stone-900 text-white border-stone-900'
                    : 'bg-white text-stone-800 border-stone-200 hover:bg-stone-50'
                }`}
              >
                <span className="font-bold">Med. #{m.numero_medidor}</span>
                <span className="opacity-80">({m.clienteNombre.split(' ')[0]})</span>
                {m.deudaTotal > 0 && (
                  <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-sm bg-red-100 text-red-800 font-bold">
                    {formatGs(m.deudaTotal)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {mensajeExito && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 text-sm font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{mensajeExito}</span>
          </div>
          <button
            type="button"
            onClick={() => setMensajeExito(null)}
            className="text-xs text-emerald-800 hover:underline cursor-pointer ml-3 shrink-0"
          >
            Cerrar
          </button>
        </div>
      )}

      {!modalCobroFactura && errorCobro && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-300 rounded-xl text-red-900 text-sm font-semibold flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <span>{errorCobro}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorCobro(null)}
            className="text-xs text-red-800 hover:underline cursor-pointer ml-3 shrink-0"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Comprobante de Cobro Reciente */}
      {comprobantePago && (
        <div className="bg-white border-2 border-emerald-500 rounded-2xl p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-stone-100 pb-2">
            <div className="flex items-center gap-2 text-emerald-800 font-bold">
              <Receipt className="w-5 h-5 text-emerald-600" />
              <span>RECIBO OFICIAL DE COBRANZA</span>
            </div>
            <span className="font-mono text-xs font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-sm">
              N° {comprobantePago.recibo}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-stone-500 block">Cliente</span>
              <span className="font-bold text-stone-900">{comprobantePago.clienteNombre}</span>
            </div>
            <div>
              <span className="text-stone-500 block">Medidor Pagado</span>
              <span className="font-bold text-stone-900">N° {comprobantePago.medidorNum}</span>
            </div>
            <div>
              <span className="text-stone-500 block">Método de Cobro</span>
              <span className="font-bold uppercase text-stone-900">{comprobantePago.metodo}</span>
            </div>
            <div>
              <span className="text-stone-500 block">Monto Percibido</span>
              <span className="font-black text-emerald-700 text-base">{formatGs(comprobantePago.monto)}</span>
            </div>
          </div>

          {comprobantePago.esConceptoPersonalizado ? (
            <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-xs font-semibold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
              <span>
                Cobro independiente ({comprobantePago.conceptoPersonalizado?.toUpperCase()}). No modifica el saldo pendiente de las facturas de agua.
              </span>
            </div>
          ) : comprobantePago.saldoRestante > 0 ? (
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs font-semibold flex items-center justify-between">
              <span>Pago parcial registrado. Saldo pendiente en esta boleta:</span>
              <span className="font-black">{formatGs(comprobantePago.saldoRestante)}</span>
            </div>
          ) : (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs font-semibold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Factura completamente saldada (Saldo 0 Gs.).</span>
            </div>
          )}

          {comprobantePago.medidorPasoAActivo && (
            <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-xs font-bold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
              <span>
                Todas las boletas del Medidor N° {comprobantePago.medidorNum} han sido liquidadas. El medidor pasa a estado ACTIVO automáticamente.
              </span>
            </div>
          )}

          {comprobantePago.salioDePendienteCorte && !comprobantePago.medidorPasoAActivo && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                3ra boleta cancelada. El Medidor N° {comprobantePago.medidorNum} ya no está pendiente de corte (estado actualizado a {comprobantePago.nuevoEstado?.toUpperCase()}).
              </span>
            </div>
          )}

          <div className="pt-2 flex flex-wrap justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={handleDescargarComprobanteActual}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <FileDown className="w-4 h-4" />
              <span>Descargar PDF</span>
            </button>
            <button
              type="button"
              onClick={handleImprimirComprobante}
              className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimir Recibo</span>
            </button>
          </div>
        </div>
      )}

      {/* Detalle del Medidor Seleccionado y sus Boletas Independientes */}
      {medidorActual && medidorActual.medidor && medidorActual.cliente ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Tarjeta lateral: Datos del Cliente y Medidor */}
          <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-4 h-fit">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div>
                <span className="text-xs font-bold uppercase text-stone-500">Unidad de Medición</span>
                <h2 className="text-xl font-black text-stone-900">
                  Medidor N° {medidorActual.medidor.numero_medidor}
                </h2>
              </div>
              <span
                className={`text-xs px-2.5 py-1 rounded-full font-bold uppercase ${
                  medidorActual.medidor.estado === 'activo'
                    ? 'bg-emerald-100 text-emerald-800'
                    : medidorActual.medidor.estado === 'moroso'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-red-100 text-red-800'
                }`}
              >
                {medidorActual.medidor.estado.replace('_', ' ')}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <span className="text-stone-500 block">Titular del Contrato</span>
                <span className="font-bold text-stone-900 text-sm">
                  {medidorActual.cliente.nombre_completo}
                </span>
                <span className="text-stone-600 block">C.I. / RUC: {medidorActual.cliente.documento}</span>
              </div>

              <div>
                <span className="text-stone-500 block">Dirección del Medidor</span>
                <span className="text-stone-800">{medidorActual.medidor.direccion}</span>
                <span className="text-stone-500 block">Zona: {medidorActual.medidor.zona}</span>
              </div>

              <div className="pt-2 border-t border-stone-100">
                <span className="text-stone-500 block">Teléfono de Contacto</span>
                <span className="text-stone-800">{medidorActual.cliente.telefono}</span>
              </div>
            </div>

            {/* Resumen de Deuda */}
            <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-2">
              <div className="flex justify-between text-xs text-stone-600">
                <span>Boletas pendientes:</span>
                <span className="font-bold text-stone-900">
                  {
                    medidorActual.facturas.filter(
                      (f) => f.estado !== 'pagada' && f.estado !== 'anulada' && f.estado !== 'refinanciada'
                    ).length
                  }
                </span>
              </div>

              <div className="flex justify-between text-xs text-stone-600">
                <span>Mora acumulada:</span>
                <span className="font-bold text-stone-900">{formatGs(medidorActual.moraCalculada)}</span>
              </div>

              <div className="pt-2 border-t border-stone-200 flex justify-between items-baseline">
                <span className="text-sm font-bold text-stone-900">Deuda Total:</span>
                <span
                  className={`text-lg font-black ${
                    medidorActual.totalDeuda > 0 ? 'text-red-600' : 'text-emerald-600'
                  }`}
                >
                  {formatGs(medidorActual.totalDeuda)}
                </span>
              </div>
            </div>

            {/* Botón de Reconexión si está cortado */}
            {medidorActual.medidor.estado === 'cortado' && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-2">
                <div className="text-xs font-bold text-red-800">MEDIDOR CORTADO</div>
                <p className="text-xs text-red-700">
                  Para restablecer el servicio debe cobrar el total de boletas + mora congelada + tasa de reconexión (60.000 Gs) + ERSSAN (2%).
                </p>
                <div className="text-sm font-bold text-stone-900">
                  Total Liquidación: {formatGs(medidorActual.liquidacionReconexion.totalPagar)}
                </div>
                <button
                  type="button"
                  disabled={procesandoReconexion || guardandoCobro}
                  onClick={() => setModalReconexionOpen(true)}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg shadow-xs cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{procesandoReconexion ? 'Procesando...' : 'Registrar reconexión'}</span>
                </button>
              </div>
            )}
          </div>

          {/* Listado de Facturas del Medidor */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                <h3 className="font-bold text-stone-900 text-base">
                  Boletas del Medidor N° {medidorActual.medidor.numero_medidor}
                </h3>
                {/* Selector de Método de Pago */}
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-stone-500 font-medium">Método de cobro:</span>
                  <select
                    value={metodoPago}
                    onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}
                    className="p-1.5 bg-stone-50 border border-stone-300 rounded-md font-semibold text-stone-800"
                  >
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia Bancaria</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>
              </div>

              {medidorActual.facturas.length === 0 ? (
                <div className="p-8 text-center text-sm text-stone-500">
                  No hay facturas emitidas para este medidor.
                </div>
              ) : (
                <div className="divide-y divide-stone-100">
                  {medidorActual.facturas.map((f) => {
                    const saldo = obtenerSaldoFactura(f);
                    const montoPagado = f.monto_pagado || (f.estado === 'pagada' ? f.total : 0);
                    const esParcial = saldo > 0 && montoPagado > 0;

                    return (
                      <div key={f.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-stone-900">
                              Periodo {f.periodo_facturado}
                            </span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                f.estado === 'pagada'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : f.estado === 'refinanciada'
                                    ? 'bg-indigo-100 text-indigo-800'
                                    : esParcial
                                      ? 'bg-amber-100 text-amber-800'
                                      : f.estado === 'vencida'
                                        ? 'bg-red-100 text-red-800'
                                        : 'bg-stone-100 text-stone-800'
                              }`}
                            >
                              {f.estado === 'pagada'
                                ? 'PAGADA'
                                : f.estado === 'refinanciada'
                                  ? 'REFINANCIADA'
                                  : esParcial
                                    ? 'PAGO PARCIAL'
                                    : f.estado}
                            </span>
                            {f.es_tercera_boleta && f.estado !== 'refinanciada' && (
                              <span className="text-[10px] px-2 py-0.5 rounded-sm bg-red-600 text-white font-bold">
                                3ra Boleta (Corte día 11)
                              </span>
                            )}
                            {f.alerta_consumo_elevado && (
                              <span className="text-[10px] px-2 py-0.5 rounded-sm bg-red-100 text-red-700 font-bold border border-red-300">
                                Consumo Elevado
                              </span>
                            )}
                          </div>

                          <div className="text-xs text-stone-500 flex flex-wrap gap-x-4">
                            <span>Emisión: {f.fecha_emision}</span>
                            <span className="font-semibold text-stone-700">Vencimiento: {f.fecha_vencimiento}</span>
                            {f.consumo_m3 !== undefined && <span>Consumo: {f.consumo_m3} m³</span>}
                          </div>
                          {f.estado === 'refinanciada' && f.motivo && (
                            <div className="text-[11px] font-semibold text-indigo-700">
                              {f.motivo}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="text-right text-xs">
                            <div className="text-stone-500">
                              Total: <span className="font-bold text-stone-800">{formatGs(f.total)}</span>
                            </div>
                            <div className="text-sm font-black text-stone-900">
                              Saldo:{' '}
                              <span
                                className={
                                  f.estado === 'refinanciada' || f.estado === 'anulada'
                                    ? 'text-stone-500'
                                    : saldo > 0
                                      ? 'text-red-700'
                                      : 'text-emerald-700'
                                }
                              >
                                {formatGs(saldo)}
                              </span>
                            </div>
                            {f.estado === 'pagada' && f.fecha_pago && (
                              <div className="text-[10px] text-emerald-600 font-medium">
                                Cancelada el {f.fecha_pago}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            {/* Botón Descargar Boleta / Recibo de Pago PDF */}
                            <button
                              type="button"
                              onClick={() => handleDescargarBoleta(f)}
                              title={
                                f.estado === 'pagada'
                                  ? 'Descargar Recibo de Pago PDF'
                                  : 'Descargar boleta oficial PDF'
                              }
                              className="p-2 text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg border border-stone-200 cursor-pointer"
                            >
                              <FileDown className="w-4 h-4" />
                            </button>

                            {/* Botón Cobrar en Caja (Total o Parcial) */}
                            {f.estado !== 'pagada' && f.estado !== 'anulada' && f.estado !== 'refinanciada' && (
                              <button
                                type="button"
                                disabled={guardandoCobro || procesandoReconexion}
                                onClick={() => abrirModalCobro(f)}
                                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                <DollarSign className="w-4 h-4" />
                                <span>Cobrar</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Historial de Pagos del Medidor (incluye facturas de agua y Concepto Personalizado con factura_id = null) */}
            <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                <h3 className="font-bold text-stone-900 text-base flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-emerald-600" />
                  <span>Historial de Pagos — Medidor N° {medidorActual.medidor.numero_medidor}</span>
                </h3>
                <span className="text-xs font-bold text-stone-500 tabular-nums">
                  {historialPagosMedidor.length} {historialPagosMedidor.length === 1 ? 'pago' : 'pagos'}
                </span>
              </div>

              {historialPagosMedidor.length === 0 ? (
                <div className="p-6 text-center text-xs text-stone-500">
                  Este medidor aún no registra pagos ni cobros independientes.
                </div>
              ) : (
                <div className="divide-y divide-stone-100">
                  {historialPagosMedidor.map((p) => {
                    const handleDescargarPagoMedidor = () => {
                      if (!medidorActual?.cliente || !medidorActual?.medidor) return;
                      const doc = generarComprobantePagoPDF({
                        factura: p.esPersonalizado ? null : p.factura,
                        cliente: medidorActual.cliente,
                        medidor: medidorActual.medidor,
                        pago: p,
                        detalles: p.esPersonalizado ? undefined : p.factura?.detalles,
                        tarifa: db.getTarifasVigentes(),
                        numeroRecibo: p.numero_recibo,
                        fechaPago: p.fecha_pago,
                        montoAbonado: p.monto,
                        metodoPago: p.metodo_pago,
                        cobradorNombre: p.cobradorNombre || user?.nombre || user?.email || 'Caja Central',
                        saldoRestante: p.esPersonalizado ? 0 : (p.factura?.saldo_pendiente ?? 0),
                        tipoComprobante: p.tipo_comprobante,
                        esConceptoPersonalizado: p.esPersonalizado,
                        conceptoPersonalizado: p.esPersonalizado ? p.descripcionConcepto : undefined,
                      });
                      const prefix = p.esPersonalizado ? 'Recibo_Personalizado' : 'Recibo';
                      descargarPdfDocumento(
                        doc,
                        `${prefix}_${p.numero_recibo || p.fecha_pago}_Med_${medidorActual.medidor.numero_medidor}.pdf`
                      );
                    };

                    return (
                      <div
                        key={p.id}
                        className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono font-bold text-stone-900">
                              {p.numero_recibo || '--'}
                            </span>
                            {p.esPersonalizado ? (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-bold uppercase">
                                Concepto Personalizado
                              </span>
                            ) : (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold uppercase">
                                Factura de Agua
                              </span>
                            )}
                            <span className="font-semibold text-stone-800">{p.descripcionConcepto}</span>
                          </div>
                          <div className="text-[11px] text-stone-500 flex flex-wrap gap-x-3">
                            <span>Fecha: {p.fecha_pago}</span>
                            <span className="uppercase">Método: {p.metodo_pago}</span>
                            <span>Cobrador: {p.cobradorNombre}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 self-end sm:self-auto">
                          <span className="font-black text-emerald-700 text-sm tabular-nums">
                            {formatGs(p.monto)}
                          </span>
                          <button
                            type="button"
                            onClick={handleDescargarPagoMedidor}
                            title="Descargar Comprobante PDF"
                            className="p-2 text-stone-700 hover:text-stone-900 hover:bg-stone-100 rounded-lg border border-stone-200 cursor-pointer"
                          >
                            <FileDown className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-12 text-center text-stone-500 bg-white rounded-xl border border-stone-200">
          Seleccione o busque un medidor o cliente para gestionar cobranzas.
        </div>
      )}

      {/* Modal de Registro de Cobro (Total, Parcial o Concepto Personalizado) */}
      {modalCobroFactura && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] flex flex-col border border-stone-200 shadow-xl overflow-hidden">
            <div className="p-4 bg-stone-900 text-white flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-bold text-sm">Registrar Pago en Caja</h3>
                <p className="text-xs text-stone-400">
                  Boleta #{modalCobroFactura.id.slice(0, 18)} • Periodo {modalCobroFactura.periodo_facturado}
                </p>
              </div>
              <button
                type="button"
                disabled={guardandoCobro}
                onClick={() => setModalCobroFactura(null)}
                className="text-stone-400 hover:text-white disabled:opacity-40 p-1 rounded-lg cursor-pointer"
                aria-label="Cerrar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs text-stone-800 overflow-y-auto">
              {errorCobro && (
                <div
                  role="alert"
                  className="p-3 bg-red-50 border border-red-300 text-red-800 rounded-xl font-semibold flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{errorCobro}</span>
                </div>
              )}

              {/* Checkbox: Cobro con Concepto Personalizado */}
              <label className="flex items-center gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs font-bold text-amber-950 cursor-pointer select-none">
                <input
                  type="checkbox"
                  disabled={guardandoCobro}
                  checked={esConceptoPersonalizado}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setEsConceptoPersonalizado(checked);
                    setErrorCobro(null);
                  }}
                  className="w-4 h-4 rounded-sm border-amber-400 text-amber-600 focus:ring-amber-500"
                />
                <span>Cobro con Concepto Personalizado</span>
              </label>

              {esConceptoPersonalizado ? (
                <div className="p-3.5 bg-stone-50 rounded-xl border border-stone-200 space-y-3">
                  <div>
                    <label
                      htmlFor="concepto-personalizado-desc"
                      className="text-[11px] font-bold text-stone-700 block mb-1 uppercase tracking-wider"
                    >
                      Descripción del Concepto *
                    </label>
                    <input
                      id="concepto-personalizado-desc"
                      type="text"
                      disabled={guardandoCobro}
                      value={conceptoPersonalizado}
                      onChange={(e) => setConceptoPersonalizado(e.target.value)}
                      placeholder="Ej: Reparación de cañería"
                      className="w-full px-3 py-2.5 bg-white border border-stone-300 rounded-lg text-sm font-semibold text-stone-900 focus:border-blue-600 focus:outline-hidden disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="concepto-personalizado-monto"
                      className="text-[11px] font-bold text-stone-700 block mb-1 uppercase tracking-wider"
                    >
                      Monto (Gs.) *
                    </label>
                    <input
                      id="concepto-personalizado-monto"
                      type="number"
                      min={1}
                      disabled={guardandoCobro}
                      value={montoPersonalizadoInput}
                      onChange={(e) => setMontoPersonalizadoInput(e.target.value)}
                      placeholder="Ingrese monto exacto en Gs."
                      className="w-full px-3 py-2.5 bg-white border border-stone-300 rounded-lg text-base font-bold text-stone-900 focus:border-blue-600 focus:outline-hidden disabled:opacity-60"
                    />
                  </div>
                  <p className="text-[11px] text-stone-600">
                    Cobro independiente: NO modificará el saldo de la boleta de agua. Sin ERSSAN 2% ni IVA 10%.
                  </p>
                </div>
              ) : (
                <>
                  {/* Resumen de Importes estándar */}
                  <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-stone-500">Importe total boleta:</span>
                      <span className="font-bold text-stone-900">{formatGs(modalCobroFactura.total)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500">Monto pagado previamente:</span>
                      <span className="font-bold text-emerald-700">
                        {formatGs(modalCobroFactura.monto_pagado || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-stone-200 text-sm font-black">
                      <span>Saldo adeudado:</span>
                      <span className="text-red-700">
                        {formatGs(obtenerSaldoFactura(modalCobroFactura))}
                      </span>
                    </div>
                  </div>

                  {/* Botones de acción rápida: Pago Total o Parcial */}
                  <div>
                    <label className="text-[11px] font-bold text-stone-600 block mb-1 uppercase tracking-wider">
                      Monto a Pagar (Gs.):
                    </label>
                    <div className="flex gap-2 mb-2">
                      <button
                        type="button"
                        disabled={guardandoCobro}
                        onClick={() => {
                          const saldo = obtenerSaldoFactura(modalCobroFactura);
                          setMontoACobrarInput(String(saldo));
                        }}
                        className="flex-1 py-1.5 bg-emerald-100 hover:bg-emerald-200 disabled:opacity-40 text-emerald-900 text-xs font-bold rounded-lg border border-emerald-300 cursor-pointer"
                      >
                        Pago Total
                      </button>
                      <button
                        type="button"
                        disabled={guardandoCobro}
                        onClick={() => {
                          const saldo = obtenerSaldoFactura(modalCobroFactura);
                          setMontoACobrarInput(String(Math.round(saldo / 2)));
                        }}
                        className="flex-1 py-1.5 bg-stone-100 hover:bg-stone-200 disabled:opacity-40 text-stone-800 text-xs font-semibold rounded-lg border border-stone-300 cursor-pointer"
                      >
                        50% Parcial
                      </button>
                    </div>
                    <input
                      type="number"
                      disabled={guardandoCobro}
                      value={montoACobrarInput}
                      onChange={(e) => setMontoACobrarInput(e.target.value)}
                      className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 rounded-lg text-base font-bold text-stone-900 focus:bg-white focus:border-blue-600 focus:outline-hidden disabled:opacity-60"
                      placeholder="Ingrese monto a cobrar..."
                    />
                  </div>
                </>
              )}

              {/* Selector de Método de Pago */}
              <div>
                <label className="text-[11px] font-bold text-stone-600 block mb-1 uppercase tracking-wider">
                  Forma de Cobro:
                </label>
                <select
                  disabled={guardandoCobro}
                  value={metodoPago}
                  onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg font-bold text-stone-900 focus:bg-white disabled:opacity-60"
                >
                  <option value="efectivo">Efectivo en Ventanilla</option>
                  <option value="transferencia">Transferencia Bancaria (SIPAP)</option>
                  <option value="cheque">Cheque al Día</option>
                </select>
              </div>

              {/* Selector de Tipo de Comprobante (antes del botón Confirmar Pago) */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-stone-600 block uppercase tracking-wider">
                  Tipo de Comprobante:
                </span>
                <div className="grid grid-cols-1 gap-2">
                  <label
                    className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                      tipoComprobante === 'factura_legal'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-950'
                        : 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100'
                    }`}
                  >
                    <input
                      type="radio"
                      name="tipoComprobante"
                      value="factura_legal"
                      disabled={guardandoCobro}
                      checked={tipoComprobante === 'factura_legal'}
                      onChange={() => setTipoComprobante('factura_legal')}
                      className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div className="flex-1">
                      <div className="font-bold text-xs">FACTURA LEGAL</div>
                      <div className="text-[11px] text-stone-600 font-mono">
                        N° {db.getNumeroFacturaParaCobro(modalCobroFactura.id, esConceptoPersonalizado)} • Con Timbrado{!esConceptoPersonalizado ? ' e IVA 10%' : ''}
                      </div>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                      tipoComprobante === 'recibo_sin_valor_fiscal'
                        ? 'bg-blue-50 border-blue-500 text-blue-950'
                        : 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100'
                    }`}
                  >
                    <input
                      type="radio"
                      name="tipoComprobante"
                      value="recibo_sin_valor_fiscal"
                      disabled={guardandoCobro}
                      checked={tipoComprobante === 'recibo_sin_valor_fiscal'}
                      onChange={() => setTipoComprobante('recibo_sin_valor_fiscal')}
                      className="mt-0.5 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <div className="font-bold text-xs">RECIBO SIN VALOR FISCAL</div>
                      <div className="text-[11px] text-stone-600 font-mono">
                        N° {db.getSiguienteNumeroReciboSinValorFiscal()} • Sin RUC, Timbrado ni IVA
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Opción de imprimir recibo al confirmar */}
              <label className="flex items-center gap-2 pt-1 text-xs font-medium text-stone-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  disabled={guardandoCobro}
                  checked={imprimirReciboAlConfirmar}
                  onChange={(e) => setImprimirReciboAlConfirmar(e.target.checked)}
                  className="w-4 h-4 rounded-sm border-stone-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Imprimir recibo automáticamente al confirmar</span>
              </label>
            </div>

            <div className="p-4 bg-stone-50 border-t border-stone-200 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                disabled={guardandoCobro}
                onClick={() => setModalCobroFactura(null)}
                className="px-4 py-2 bg-stone-200 hover:bg-stone-300 disabled:opacity-40 disabled:cursor-not-allowed text-stone-800 text-xs font-bold rounded-lg cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={guardandoCobro}
                onClick={handleConfirmarCobro}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <DollarSign className="w-4 h-4" />
                <span>{guardandoCobro ? 'Procesando cobro...' : 'Confirmar Pago'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal de Reconexión Integral */}
      {modalReconexionOpen && medidorActual?.medidor && (
        <ModalRegistrarReconexion
          medidorId={medidorActual.medidor.id}
          isOpen={modalReconexionOpen}
          onClose={() => setModalReconexionOpen(false)}
          onSuccess={async (res) => {
            if (isSupabaseConfigured) {
              await db.loadFromSupabase({ force: true });
            }
            const msg = `Medidor N° ${res.medidor.numero_medidor} regularizado y reconectado exitosamente. Pasa a estado ACTIVO.`;
            setMensajeExito(msg);
            setToast({
              type: 'success',
              message: `Reconexión registrada (${formatGs(res.facturaRegularizacion.total)}).`,
            });
            setModalReconexionOpen(false);
            setSelectedMedidorId(res.medidor.id);
          }}
        />
      )}
    </div>
  );
};
