/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import {
  Factura,
  Cliente,
  Medidor,
  DetalleFactura,
  Contrato,
  TarifaConfig,
  Pago,
  MetodoPago,
  TipoComprobantePago,
} from '../types';
import { formatGs } from './billingRules';
import {
  EMPRESA_LEGAL,
  calcularIva10Incluido,
  resolverNumeroComprobantePago,
  resolverNumeroFacturaParaMostrar,
} from './facturacionHelpers';
import { LOGO_PNG_DATA_URL, LOGO_ASPECT_RATIO } from '../assets/logoData';

/**
 * Dibuja un ícono vectorial estilo WhatsApp (burbuja verde + auricular blanco)
 * seguido del número de teléfono (ej. "0986 977 631") en Factura Legal y Recibo.
 */
function dibujarWhatsAppYTelefono(
  doc: jsPDF,
  x: number,
  y: number,
  options?: {
    align?: 'left' | 'right';
    fontSize?: number;
    telefono?: string;
  }
): void {
  const align = options?.align ?? 'left';
  const fontSize = options?.fontSize ?? 7.8;
  const telefono = options?.telefono ?? EMPRESA_LEGAL.whatsapp;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize);
  const textW = doc.getTextWidth(telefono);

  const r = 1.9;
  const gap = 1.4;
  const iconCx = align === 'right' ? x - textW - gap - r : x + r;
  const iconCy = y - fontSize * 0.11;

  // Burbuja circular verde WhatsApp (#25D366) + cola inferior izquierda
  doc.setFillColor(37, 211, 102);
  doc.setDrawColor(37, 211, 102);
  doc.setLineWidth(0.15);
  doc.circle(iconCx, iconCy, r, 'F');
  doc.triangle(
    iconCx - r * 0.85,
    iconCy + r * 0.35,
    iconCx - r * 1.12,
    iconCy + r * 1.05,
    iconCx - r * 0.18,
    iconCy + r * 0.82,
    'F'
  );

  // Auricular telefónico blanco vectorial dentro del círculo
  doc.setDrawColor(255, 255, 255);
  doc.setFillColor(255, 255, 255);
  doc.setLineWidth(0.46);
  doc.setLineCap('round');
  doc.setLineJoin('round');
  doc.lines(
    [[0.15, 0.82, 0.55, 1.22, 1.28, 1.38]],
    iconCx - 0.58,
    iconCy - 0.72,
    [1, 1],
    'S'
  );
  doc.circle(iconCx - 0.48, iconCy - 0.66, 0.31, 'F');
  doc.circle(iconCx + 0.66, iconCy + 0.62, 0.31, 'F');

  // Número de teléfono
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize);
  const textX = align === 'right' ? x : iconCx + r + gap;
  doc.text(telefono, textX, y, align === 'right' ? { align: 'right' } : undefined);
  doc.setLineCap('butt');
  doc.setLineJoin('miter');
}

/**
 * Limpia la descripción de un concepto eliminando paréntesis y su contenido
 * (ej. "Consumo de agua (12 m³)" -> "CONSUMO DE AGUA") y normaliza a MAYÚSCULAS.
 */
export function limpiarDescripcionConceptoPDF(texto: string): string {
  return (texto || '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Genera el documento PDF de la Boleta Oficial de Aguatería (Server-Side y Client-Side)
 * Estructura estricta según pliego:
 * - Una página (A4), blanco y negro con avisos en ROJO.
 * - Encabezado: Nombre de la aguatería, RUC, Boleta N° [numero_boleta_medidor]-[periodo_facturado], Fecha de emisión.
 * - Datos del cliente y medidor: nombre_completo, documento, numero_medidor, dirección del terreno, período facturado, fecha de vencimiento.
 * - Detalle de conceptos (solo los que tienen monto > 0):
 *   Orden: consumo de agua, deuda anterior, recargo por mora, otros trabajos (uno por línea si hay varios),
 *          cuota de conexión, pérdida financiada, reconexión.
 *   Subtotal, ERSSAN 2%, TOTAL A PAGAR (destacado en negrita, tamaño más grande).
 * - Avisos destacados (en ROJO, en bloque separado, negrita):
 *   1) Si es_tercera_boleta = true: "DESCONEXIÓN: [fecha_vencimiento]" + "Si no abona antes de esta fecha, se procederá al retiro del medidor."
 *   2) Si alerta_consumo_elevado = true: "CONSUMO ELEVADO" + "Su consumo de este mes es superior al habitual. Puede deberse a una pérdida en su propiedad. Por favor verifique."
 *   3) Si ambos aplican, mostrar ambos bloques uno debajo del otro, ambos visibles.
 * - Pie: Datos de pago + "Gracias por su pago."
 * - NUNCA incluye observaciones internas del lector.
 */
export function generarBoletaPDF(params: {
  factura: Factura;
  cliente: Cliente;
  medidor: Medidor;
  detalles?: DetalleFactura[];
  tipoComprobante?: TipoComprobantePago;
  numeroRecibo?: string;
  esConceptoPersonalizado?: boolean;
  conceptoPersonalizado?: string;
  montoPersonalizado?: number;
}): jsPDF {
  const { factura, cliente, medidor } = params;
  const tipoComprobante: TipoComprobantePago =
    params.tipoComprobante === 'recibo_sin_valor_fiscal'
      ? 'recibo_sin_valor_fiscal'
      : 'factura_legal';
  const esFacturaLegal = tipoComprobante === 'factura_legal';
  const conceptoPersonalizado = (params.conceptoPersonalizado || '').trim();
  const esConceptoPersonalizado = Boolean(params.esConceptoPersonalizado && conceptoPersonalizado);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  let y = 13;

  // Encabezado institucional con Logo (src/assets/logo.png)
  const logoW = 44; // ~4.4 cm de ancho (proporción original 725x251 -> ~15.23 mm alto)
  const logoH = Number((logoW / LOGO_ASPECT_RATIO).toFixed(2));
  doc.addImage(LOGO_PNG_DATA_URL, 'PNG', margin, y, logoW, logoH);

  // Solo Factura Legal muestra RUC, Timbrado y Vigencias; ambos incluyen WhatsApp + teléfono
  if (esFacturaLegal) {
    const xDatosLegales = margin + logoW + 3.5;
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(`RUC: ${EMPRESA_LEGAL.ruc}`, xDatosLegales, y + 2.2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(`TIMBRADO N°: ${EMPRESA_LEGAL.timbrado}`, xDatosLegales, y + 5.8);
    doc.text(`Inicio Vigencia: ${EMPRESA_LEGAL.inicioVigencia}`, xDatosLegales, y + 9.4);
    doc.text(`Fin Vigencia: ${EMPRESA_LEGAL.finVigencia}`, xDatosLegales, y + 13.0);
    dibujarWhatsAppYTelefono(doc, xDatosLegales, y + 17.5, { align: 'left', fontSize: 7.8 });
  } else {
    dibujarWhatsAppYTelefono(doc, margin + logoW + 4, y + 8.8, { align: 'left', fontSize: 8.5 });
  }

  // Recuadro derecho: 7 dígitos (Factura Legal) vs 4 dígitos (Recibo sin valor fiscal)
  const numeroComprobante = resolverNumeroComprobantePago({
    tipoComprobante,
    factura,
    numeroReciboActual: params.numeroRecibo,
  });
  const boxW = 74;
  const boxH = 21.5;
  const boxX = pageWidth - margin - boxW;
  const boxY = y - 1;

  doc.setDrawColor(30, 41, 59);
  doc.setLineWidth(0.35);
  doc.rect(boxX, boxY, boxW, boxH);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(
    `${esFacturaLegal ? 'Factura N°' : 'Recibo N°'}: ${numeroComprobante}`,
    boxX + 3.5,
    boxY + 5
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Emisión: ${factura.fecha_emision}`, boxX + 3.5, boxY + 9.8);
  doc.text(`Período Facturado: ${factura.periodo_facturado}`, boxX + 3.5, boxY + 14.1);
  doc.setFont('helvetica', 'bold');
  doc.text(`Vencimiento: ${factura.fecha_vencimiento}`, boxX + 3.5, boxY + 18.4);
  doc.setFont('helvetica', 'normal');

  y = boxY + boxH + 3.5;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  // Datos del Cliente y Medidor
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('DATOS DEL CLIENTE', margin, y);
  doc.text('DATOS DEL SUMINISTRO / MEDIDOR', margin + 95, y);

  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Cliente: ${cliente.nombre_completo}`, margin, y);
  doc.text(`N° Medidor: ${medidor.numero_medidor}`, margin + 95, y);

  y += 4.5;
  doc.text(`Documento (C.I. / RUC): ${cliente.documento}`, margin, y);
  doc.text(`Zona: ${medidor.zona}`, margin + 95, y);

  y += 4.5;
  const direccionClienteBoleta = (cliente.direccion || medidor.direccion || '--').trim();
  const dirClienteLines = doc.splitTextToSize(`Dirección: ${direccionClienteBoleta}`, 88);
  doc.text(dirClienteLines, margin, y);
  const textoPeriodo =
    factura.periodo_consumo && factura.periodo_consumo !== factura.periodo_facturado
      ? `Facturado: ${factura.periodo_facturado} (Consumo: ${factura.periodo_consumo})`
      : `Período facturado: ${factura.periodo_facturado}`;
  doc.text(textoPeriodo, margin + 95, y);

  y += Math.max(4.5, dirClienteLines.length * 4.2);
  if (medidor.direccion && medidor.direccion.trim() !== direccionClienteBoleta) {
    doc.text(`Terreno: ${medidor.direccion}`, margin, y, { maxWidth: 88 });
  }
  doc.setFont('helvetica', 'bold');
  doc.text(`Fecha de vencimiento: ${factura.fecha_vencimiento}`, margin + 95, y);
  doc.setFont('helvetica', 'normal');

  y += 7;
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  // Cuadro de Lectura y Consumo (sin observaciones internas del lector)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('MEDICIÓN DE CONSUMO DE AGUA', margin, y);
  y += 3.5;

  doc.rect(margin, y, contentWidth, 11);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Lectura Anterior:', margin + 4, y + 4.5);
  doc.setFont('helvetica', 'bold');
  doc.text(`${factura.lectura_anterior ?? '--'} m³`, margin + 33, y + 4.5);

  doc.setFont('helvetica', 'normal');
  doc.text('Lectura Actual:', margin + 65, y + 4.5);
  doc.setFont('helvetica', 'bold');
  doc.text(`${factura.lectura_actual ?? '--'} m³`, margin + 95, y + 4.5);

  doc.setFont('helvetica', 'normal');
  doc.text('Consumo Facturado:', margin + 125, y + 4.5);
  doc.setFont('helvetica', 'bold');
  doc.text(`${factura.consumo_m3 ?? 0} m³`, margin + 162, y + 4.5);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('(Consumo regulado por ERSSAN. Mínimo 9 m³. Excedente a 4.000 Gs./m³)', margin + 4, y + 8.5);

  y += 15;

  // AVISOS DESTACADOS EN ROJO (en bloque separado, negrita)
  // 1) Si es_tercera_boleta: bloque con "DESCONEXIÓN: [fecha_vencimiento]" + texto
  if (factura.es_tercera_boleta) {
    doc.setDrawColor(220, 38, 38); // Rojo
    doc.setLineWidth(0.6);
    doc.rect(margin, y, contentWidth, 13);

    doc.setTextColor(220, 38, 38); // Rojo
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(`DESCONEXIÓN: ${factura.fecha_vencimiento}`, margin + 4, y + 4.8);

    doc.setFontSize(8);
    doc.text(
      'Si no abona antes de esta fecha, se procederá al retiro del medidor.',
      margin + 4,
      y + 9
    );
    doc.setTextColor(0, 0, 0);
    y += 16;
  }

  // 2) Si alerta_consumo_elevado: bloque con "CONSUMO ELEVADO" + texto
  if (factura.alerta_consumo_elevado) {
    doc.setDrawColor(220, 38, 38); // Rojo
    doc.setLineWidth(0.6);
    doc.rect(margin, y, contentWidth, 13);

    doc.setTextColor(220, 38, 38); // Rojo
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('CONSUMO ELEVADO', margin + 4, y + 4.8);

    doc.setFontSize(8);
    doc.text(
      'Su consumo de este mes es superior al habitual. Puede deberse a una pérdida en su propiedad. Por favor verifique.',
      margin + 4,
      y + 9
    );
    doc.setTextColor(0, 0, 0);
    y += 16;
  }

  // DETALLE DE CONCEPTOS (solo los que tienen monto > 0)
  // Factura Legal estándar: muestra únicamente "PERÍODO DE CONSUMO: [mes]"
  // Recibo sin valor fiscal y Concepto Personalizado: sin título arriba de la tabla
  const periodoConsumoBoleta = factura.periodo_consumo || factura.periodo_facturado;
  if (esFacturaLegal && !esConceptoPersonalizado && periodoConsumoBoleta) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(`PERÍODO DE CONSUMO: ${periodoConsumoBoleta}`, margin, y);
    y += 4;
  }

  // Cabecera de la tabla de dos columnas: CONCEPTO | MONTO
  doc.setFillColor(245, 245, 245);
  doc.rect(margin, y, contentWidth, 6, 'FD');
  doc.setFontSize(8);
  doc.text('CONCEPTO', margin + 3, y + 4.2);
  doc.text('MONTO', pageWidth - margin - 3, y + 4.2, { align: 'right' });
  y += 10.5;

  const totalBoletaMostrar =
    esConceptoPersonalizado && params.montoPersonalizado !== undefined
      ? Math.round(params.montoPersonalizado)
      : factura.total;

  if (esConceptoPersonalizado) {
    // Concepto personalizado único (< 3 conceptos): sin líneas separadoras, sin ERSSAN 2% ni IVA 10%
    const descMayus = limpiarDescripcionConceptoPDF(conceptoPersonalizado);
    const descLines = doc.splitTextToSize(descMayus, contentWidth - 40);
    const extraH = Math.max(0, descLines.length - 1) * 4.5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(descLines, margin + 3, y);
    doc.text(formatGs(totalBoletaMostrar), pageWidth - margin - 3, y, { align: 'right' });

    y += extraH + 6.5;
  } else {
    const ordenJerarquia: Record<string, number> = {
      consumo_agua: 1,
      deuda_anterior: 2,
      mora: 3,
      otros_trabajos: 4,
      cuota_conexion: 5,
      perdida_financiada: 6,
      reconexion: 7,
    };

    const detalles =
      params.detalles && params.detalles.length > 0
        ? params.detalles
        : factura.detalles && factura.detalles.length > 0
          ? factura.detalles
          : [
              {
                id: '1',
                factura_id: factura.id,
                concepto: 'consumo_agua' as const,
                descripcion: `Consumo de agua potable (${factura.consumo_m3 || 0} m³)`,
                monto: Math.round(factura.total * 0.98),
              },
              {
                id: '2',
                factura_id: factura.id,
                concepto: 'erssan' as const,
                descripcion: 'Aporte Ley ERSSAN (2%)',
                monto: Math.round(factura.total * 0.02),
              },
            ];

    // Separar conceptos del detalle respetando el orden y filtrando monto > 0
    const conceptosSinErssan = detalles
      .filter((d) => d.concepto !== 'erssan' && d.monto > 0)
      .sort((a, b) => (ordenJerarquia[a.concepto] || 99) - (ordenJerarquia[b.concepto] || 99));

    const detalleErssan = detalles.find((d) => d.concepto === 'erssan' && d.monto > 0);

    // Imprimir cada concepto uno por línea (limpiando paréntesis con regex)
    doc.setFontSize(8.5);
    for (const item of conceptosSinErssan) {
      doc.setFont('helvetica', 'normal');
      doc.text(limpiarDescripcionConceptoPDF(item.descripcion), margin + 3, y);
      doc.setFont('helvetica', 'bold');
      doc.text(formatGs(item.monto), pageWidth - margin - 3, y, { align: 'right' });
      y += 5;
    }

    // Subtotal (suma de conceptos sin ERSSAN)
    const subtotal = conceptosSinErssan.reduce((acc, curr) => acc + curr.monto, 0);
    y += 1;
    doc.setLineWidth(0.2);
    doc.line(margin, y, pageWidth - margin, y);
    y += 4.5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('Subtotal:', margin + 3, y);
    doc.text(formatGs(subtotal), pageWidth - margin - 3, y, { align: 'right' });
    y += 5;

    // ERSSAN 2%
    const baseErssanFallback = subtotal;
    const montoErssan = detalleErssan ? detalleErssan.monto : Math.round(baseErssanFallback * 0.02);
    if (montoErssan > 0) {
      doc.setFont('helvetica', 'normal');
      doc.text('APORTE ERSSAN:', margin + 3, y);
      doc.setFont('helvetica', 'bold');
      doc.text(formatGs(montoErssan), pageWidth - margin - 3, y, { align: 'right' });
      y += 5.5;
    }
  }

  // Línea gruesa antes de Total
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5.5;

  // TOTAL A PAGAR (destacado en negrita, tamaño más grande)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('TOTAL A PAGAR:', margin + 3, y);
  doc.setFontSize(13);
  doc.text(formatGs(totalBoletaMostrar), pageWidth - margin - 3, y, { align: 'right' });

  // Concepto informativo IVA 10% solo en Factura Legal estándar
  if (esFacturaLegal && !esConceptoPersonalizado) {
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text('IVA 10%', margin + 3, y);
    doc.setFont('helvetica', 'bold');
    doc.text(formatGs(calcularIva10Incluido(totalBoletaMostrar)), pageWidth - margin - 3, y, {
      align: 'right',
    });
    doc.setTextColor(0, 0, 0);
  }

  y += 10;

  // Pie: Datos de pago + "Gracias por su pago."
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.2);
  doc.line(margin, y, pageWidth - margin, y);
  y += 4.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(90, 90, 90);
  doc.text(
    'Bocas de Pago: Ventanilla Central de la Aguatería, Bocas Infonet, Pago Express y Transferencias Bancarias (SIPAP / QR).',
    margin + 3,
    y
  );
  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.text('¡Gracias por su pago!', margin + 3, y);

  return doc;
}

/**
 * Genera el documento PDF de CONTRATO privado (por cliente)
 * Estructura estricta según pliego:
 * - A4, blanco y negro. Una página si es posible (dos como máximo).
 * - Sin logos grandes ni marcas de agua decorativas.
 * - Encabezado: Nombre de la aguatería, RUC, "CONTRATO DE PRESTACIÓN DE SERVICIO DE AGUA POTABLE", Fecha de emisión.
 * - Partes: Prestador (nombre, RUC, dirección) y Usuario (nombre_completo, documento, dirección, teléfono, email).
 * - Objeto: Prestación del servicio de agua potable en el medidor [numero_medidor] ubicado en [dirección del terreno], con las condiciones establecidas.
 * - Condiciones: Consumo mínimo, precio m³, mora fija por boleta vencida, vencimiento boletas (fin de mes / día 11 3ra boleta),
 *                causales de corte (3 boletas impagas), reconexión, ERSSAN 2%. Tomados de tarifas vigentes.
 * - Firmas: Línea para firma del prestador, línea para firma del usuario, lugar y fecha.
 */
export function generarContratoPDF(params: {
  cliente: Cliente;
  contrato: Contrato;
  medidores?: Medidor[];
  tarifa: TarifaConfig;
}): jsPDF {
  const { cliente, contrato, medidores = [], tarifa } = params;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = 14;

  // Encabezado con Logo + datos legales
  const logoW = 42;
  const logoH = Number((logoW / LOGO_ASPECT_RATIO).toFixed(2));
  doc.addImage(LOGO_PNG_DATA_URL, 'PNG', margin, y, logoW, logoH);

  const xLeg = margin + logoW + 4;
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(`RUC: ${EMPRESA_LEGAL.ruc} — TIMBRADO N°: ${EMPRESA_LEGAL.timbrado}`, xLeg, y + 3.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Inicio Vigencia: ${EMPRESA_LEGAL.inicioVigencia} • Fin Vigencia: ${EMPRESA_LEGAL.finVigencia}`, xLeg, y + 7.8);
  doc.text(`${EMPRESA_LEGAL.ubicacion} — Regulado por ERSSAN`, xLeg, y + 12.1);

  y += logoH + 4;
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageWidth - margin, y);
  y += 7;

  // Título
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('CONTRATO DE PRESTACIÓN DE SERVICIO DE AGUA POTABLE', pageWidth / 2, y, {
    align: 'center',
  });

  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const fechaEmision = contrato.fecha_inicio || new Date().toISOString().split('T')[0];
  doc.text(`Fecha de Emisión: ${fechaEmision} • Contrato N°: ${contrato.id.toUpperCase()}`, pageWidth / 2, y, {
    align: 'center',
  });

  y += 8;

  // 1. PARTES
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('1. PARTES INTERVINIENTES', margin, y);
  y += 4.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const textoPrestador =
    `PRESTADOR: ${EMPRESA_LEGAL.nombre} (${EMPRESA_LEGAL.titular}), con RUC ${EMPRESA_LEGAL.ruc}, ubicado en ${EMPRESA_LEGAL.ubicacion}, República del Paraguay.`;
  const linesPrestador = doc.splitTextToSize(textoPrestador, contentWidth);
  doc.text(linesPrestador, margin, y);
  y += linesPrestador.length * 4.2 + 2;

  const textoUsuario = `USUARIO: ${cliente.nombre_completo}, con Documento de Identidad N° ${cliente.documento}, con domicilio real en ${cliente.direccion}, Teléfono: ${cliente.telefono}, Correo Electrónico: ${cliente.email}.`;
  const linesUsuario = doc.splitTextToSize(textoUsuario, contentWidth);
  doc.text(linesUsuario, margin, y);
  y += linesUsuario.length * 4.2 + 4;

  // 2. OBJETO
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('2. OBJETO DEL CONTRATO', margin, y);
  y += 4.5;

  const medidorPrincipal = medidores[0];
  const numMedidorTexto = medidorPrincipal ? `N° ${medidorPrincipal.numero_medidor}` : 'a ser asignado';
  const direccionTerreno = medidorPrincipal ? medidorPrincipal.direccion : cliente.direccion;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const textoObjeto = `Constituye objeto del presente contrato la prestación continua del servicio de agua potable en el medidor ${numMedidorTexto} ubicado en ${direccionTerreno}, bajo las condiciones y tarifas reglamentarias aprobadas por el Ente Regulador de Servicios Sanitarios (ERSSAN).`;
  const linesObjeto = doc.splitTextToSize(textoObjeto, contentWidth);
  doc.text(linesObjeto, margin, y);
  y += linesObjeto.length * 4.2 + 4;

  // 3. CONDICIONES DEL SERVICIO (Valores tomados de tarifas vigentes)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('3. CONDICIONES Y PLIEGO TARIFARIO VIGENTE', margin, y);
  y += 4.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);

  const clausulas = [
    `• Consumo mínimo: ${formatGs(tarifa.monto_minimo_consumo)} para consumos hasta ${tarifa.consumo_minimo_m3} m³ mensuales.`,
    `• Precio por m³ excedente: ${formatGs(tarifa.precio_m3)} por cada metro cúbico por encima del mínimo.`,
    `• Mora por boleta vencida: ${formatGs(tarifa.monto_mora_fijo)} (monto fijo por medidor por cada boleta vencida impaga; no se calcula en porcentaje).`,
    `• Vencimiento de boletas: Último día del mes (1ra y 2da boleta); día ${tarifa.dia_vencimiento_tercera_boleta} del mes (3ra boleta).`,
    `• Causales de corte: 3 boletas impagas no regularizadas tras el día ${tarifa.dia_vencimiento_tercera_boleta}. Durante la suspensión física la mora permanece congelada.`,
    `• Reconexión: Tasa reglamentaria de ${formatGs(tarifa.monto_reconexion)} más regularización de deuda acumulada.`,
    `• Canon regulatorio ERSSAN: ${tarifa.erssan_porcentaje}% sobre la suma de los conceptos facturados.`,
    `• Obligaciones del Usuario: Custodiar el medidor instalado y no manipular ni alterar las conexiones de la red distribuidora.`,
  ];

  for (const c of clausulas) {
    const linesC = doc.splitTextToSize(c, contentWidth);
    doc.text(linesC, margin, y);
    y += linesC.length * 4.2;
  }

  y += 18;

  // FIRMAS
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Lugar y Fecha: Mboi'y, Itauguá, Paraguay — ${fechaEmision}`, margin, y);
  y += 24;

  // Líneas de firma
  const anchoFirma = 65;
  const xFirma1 = margin + 5;
  const xFirma2 = pageWidth - margin - anchoFirma - 5;

  doc.setLineWidth(0.3);
  doc.line(xFirma1, y, xFirma1 + anchoFirma, y);
  doc.line(xFirma2, y, xFirma2 + anchoFirma, y);

  y += 4.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('POR EL PRESTADOR', xFirma1 + anchoFirma / 2, y, { align: 'center' });
  doc.text('POR EL USUARIO', xFirma2 + anchoFirma / 2, y, { align: 'center' });

  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('POZO ARTESIANO SAN GABRIEL', xFirma1 + anchoFirma / 2, y, { align: 'center' });
  doc.text(cliente.nombre_completo, xFirma2 + anchoFirma / 2, y, { align: 'center' });

  y += 3.5;
  doc.text(`RUC: ${EMPRESA_LEGAL.ruc} • Firma Autorizada`, xFirma1 + anchoFirma / 2, y, { align: 'center' });
  doc.text(`Doc: ${cliente.documento}`, xFirma2 + anchoFirma / 2, y, { align: 'center' });

  return doc;
}

export interface ComprobantePagoPDFParams {
  factura?: Partial<Factura> | null;
  cliente: Cliente;
  medidor: Medidor;
  pago?: Partial<Pago> & { cobradorNombre?: string };
  detalles?: DetalleFactura[];
  numeroRecibo?: string;
  fechaPago?: string;
  horaPago?: string;
  montoAbonado?: number;
  metodoPago?: MetodoPago | string;
  cobradorNombre?: string;
  saldoRestante?: number;
  tipoComprobante?: TipoComprobantePago;
  esConceptoPersonalizado?: boolean;
  conceptoPersonalizado?: string;
}

/**
 * Genera el Comprobante de Pago en formato A5 vertical (148mm x 210mm).
 * Soporta:
 * - Factura Legal: Logo + RUC, Timbrado, Vigencias y WhatsApp; número 001-002-XXXXXXX (7 dígitos); IVA 10%.
 * - Recibo sin valor fiscal: Logo + WhatsApp (SIN RUC, Timbrado, Vigencias ni texto "SIN VALOR FISCAL"); número 001-002-XXXX (4 dígitos); SIN IVA 10%.
 * - Concepto Personalizado: muestra únicamente el concepto manual en MAYÚSCULAS con línea sólida/lisa,
 *   SIN ERSSAN 2% y SIN IVA 10%, siendo el total exacto el monto abonado e independiente de la boleta de agua.
 */
export function generarComprobantePagoPDF(params: ComprobantePagoPDFParams): jsPDF {
  const { factura, cliente, medidor, pago } = params;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a5',
  });

  const pageWidth = 148;
  const pageHeight = 210;
  const margin = 12;
  const contentWidth = pageWidth - margin * 2; // 124mm
  const xRight = pageWidth - margin;

  const numeroReciboRef = (params.numeroRecibo || pago?.numero_recibo || '').trim();
  const tipoComprobante: TipoComprobantePago =
    params.tipoComprobante ||
    pago?.tipo_comprobante ||
    (/^001-002-\d{4}$/.test(numeroReciboRef) ? 'recibo_sin_valor_fiscal' : 'factura_legal');
  const esFacturaLegal = tipoComprobante === 'factura_legal';

  const conceptoPersonalizadoTexto = (
    params.conceptoPersonalizado ??
    pago?.concepto_personalizado ??
    ''
  ).trim();
  const esConceptoPersonalizado = Boolean(
    (params.esConceptoPersonalizado ?? pago?.es_concepto_personalizado) &&
      conceptoPersonalizadoTexto
  );

  const rawFecha =
    params.fechaPago ||
    pago?.fecha_pago ||
    factura?.fecha_pago ||
    new Date().toISOString().split('T')[0];
  const fechaBase = rawFecha.includes('T')
    ? rawFecha.split('T')[0]
    : rawFecha.split(' ')[0];
  const horaExtraida = rawFecha.includes('T')
    ? rawFecha.split('T')[1]?.slice(0, 5)
    : rawFecha.includes(' ')
      ? rawFecha.split(' ')[1]?.slice(0, 5)
      : '';
  const horaTexto =
    params.horaPago || horaExtraida || new Date().toTimeString().slice(0, 5);
  const fechaHoraTexto = `${fechaBase} ${horaTexto}`.trim();

  const totalFacturaRef = Number(factura?.total ?? 0);
  const montoAbonado =
    params.montoAbonado !== undefined
      ? params.montoAbonado
      : pago?.monto !== undefined
        ? pago.monto
        : factura?.monto_pagado && factura.monto_pagado > 0
          ? factura.monto_pagado
          : totalFacturaRef;

  const saldoActual =
    esConceptoPersonalizado
      ? 0
      : params.saldoRestante !== undefined
        ? params.saldoRestante
        : factura?.saldo_pendiente !== undefined
          ? factura.saldo_pendiente
          : Math.max(0, totalFacturaRef - montoAbonado);

  const metodoRaw = (params.metodoPago || pago?.metodo_pago || 'efectivo').toLowerCase();
  const metodoLabels: Record<string, string> = {
    efectivo: 'Efectivo',
    transferencia: 'Transferencia Bancaria',
    cheque: 'Cheque',
  };
  const metodoTexto = metodoLabels[metodoRaw] || metodoRaw.toUpperCase();

  const cobradorTexto =
    params.cobradorNombre ||
    pago?.cobradorNombre ||
    pago?.cobrador_id ||
    'Caja Central';

  const numeroComprobante = resolverNumeroComprobantePago({
    tipoComprobante,
    factura: factura
      ? {
          numero_factura: factura.numero_factura,
          numero_boleta_medidor: factura.numero_boleta_medidor,
        }
      : null,
    numeroReciboActual: numeroReciboRef,
    esConceptoPersonalizado,
  });
  const periodoConsumoTexto = factura?.periodo_consumo || factura?.periodo_facturado;

  let y = 10;

  // 1) Logo centrado más grande en la parte superior
  const logoW = 54;
  const logoH = Number((logoW / LOGO_ASPECT_RATIO).toFixed(2));
  const logoX = Number(((pageWidth - logoW) / 2).toFixed(2));
  doc.addImage(LOGO_PNG_DATA_URL, 'PNG', logoX, y, logoW, logoH);

  // 2) Sello compacto verde "PAGADO" (sin fecha debajo) en esquina superior izquierda
  const esPagoParcial = !esConceptoPersonalizado && saldoActual > 0;
  const badgeW = esPagoParcial ? 29 : 25;
  const badgeH = 8.5;
  const badgeX = margin;
  const badgeY = y + Number(((logoH - badgeH) / 2).toFixed(2));

  if (esPagoParcial) {
    doc.setFillColor(254, 243, 199); // Ámbar suave
    doc.setDrawColor(217, 119, 6);
  } else {
    doc.setFillColor(240, 253, 244); // Verde suave
    doc.setDrawColor(22, 163, 74);
  }
  doc.setLineWidth(0.5);
  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(esPagoParcial ? 180 : 21, esPagoParcial ? 83 : 128, esPagoParcial ? 9 : 61);
  doc.text(esPagoParcial ? 'PAGO PARCIAL' : 'PAGADO', badgeX + badgeW / 2, badgeY + badgeH / 2 + 1.2, {
    align: 'center',
  });

  // Datos legales alineados a la derecha SOLO en Factura Legal; WhatsApp + teléfono en AMBOS
  if (esFacturaLegal) {
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.text(`RUC: ${EMPRESA_LEGAL.ruc}`, xRight, y + 2.6, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(51, 65, 85);
    doc.text(`TIMBRADO N°: ${EMPRESA_LEGAL.timbrado}`, xRight, y + 6.2, { align: 'right' });
    doc.text(`Inicio Vigencia: ${EMPRESA_LEGAL.inicioVigencia}`, xRight, y + 9.8, { align: 'right' });
    doc.text(`Fin Vigencia: ${EMPRESA_LEGAL.finVigencia}`, xRight, y + 13.4, { align: 'right' });
    dibujarWhatsAppYTelefono(doc, xRight, y + 17.8, { align: 'right', fontSize: 7.4 });
  } else {
    dibujarWhatsAppYTelefono(doc, xRight, y + 9.4, { align: 'right', fontSize: 8.1 });
  }

  y += Math.max(logoH, badgeH + 2, 19.5) + 3.5;
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.4);
  doc.line(margin, y, xRight, y);
  y += 6;

  // 3) Título destacado
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(
    esFacturaLegal ? 'COMPROBANTE OFICIAL DE PAGO' : 'COMPROBANTE DE PAGO',
    pageWidth / 2,
    y,
    { align: 'center' }
  );

  y += 4.5;

  // 4) Recuadro estructurado:
  //    - Factura Legal estándar: número + fecha/hora a la izquierda, Emisión/Vencimiento a la derecha
  //    - Recibo sin valor fiscal y Concepto Personalizado: lado derecho TOTALMENTE VACÍO
  const direccionClienteMostrar = (cliente.direccion || medidor.direccion || '--').trim();
  const fechaEmisionMostrar = factura?.fecha_emision ? factura.fecha_emision : fechaBase;
  const metaBoxH = 14;

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.35);
  doc.roundedRect(margin, y, contentWidth, metaBoxH, 1.5, 1.5, 'FD');

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(
    `${esFacturaLegal ? 'Factura N°' : 'Recibo N°'}: ${numeroComprobante}`,
    margin + 3.5,
    y + 5.4
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.8);
  doc.text(`Fecha y hora: ${fechaHoraTexto}`, margin + 3.5, y + 10.6);

  if (esFacturaLegal && !esConceptoPersonalizado) {
    doc.setFontSize(8.8);
    doc.setTextColor(51, 65, 85);
    doc.text(`Emisión: ${fechaEmisionMostrar}`, xRight - 3.5, y + 5.4, { align: 'right' });
    if (factura?.fecha_vencimiento) {
      doc.text(`Vencimiento: ${factura.fecha_vencimiento}`, xRight - 3.5, y + 10.6, { align: 'right' });
    }
  }

  y += metaBoxH + 5.5;

  // 5) Datos del Cliente y Medidor (dirección únicamente aquí; lado derecho del medidor libre)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text('DATOS DEL CLIENTE Y MEDIDOR', margin, y);
  y += 5.5;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Cliente:', margin, y);
  doc.setFont('helvetica', 'normal');
  const clienteLines = doc.splitTextToSize(cliente.nombre_completo, contentWidth - 22);
  doc.text(clienteLines, margin + 22, y);
  y += Math.max(5.5, clienteLines.length * 4.8 + 0.8);

  doc.setFont('helvetica', 'bold');
  doc.text('Documento:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(cliente.documento || '--', margin + 26, y);
  y += 5.5;

  doc.setFont('helvetica', 'bold');
  doc.text('Dirección:', margin, y);
  doc.setFont('helvetica', 'normal');
  const direccionLines = doc.splitTextToSize(direccionClienteMostrar, contentWidth - 24);
  doc.text(direccionLines, margin + 24, y);
  y += Math.max(5.5, direccionLines.length * 4.8 + 0.8);

  doc.setFont('helvetica', 'bold');
  doc.text(`Medidor N°: ${medidor.numero_medidor}`, margin, y);
  y += 6;

  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.line(margin, y, xRight, y);
  y += 6;

  // 6) Título de tabla de conceptos:
  //    - Factura Legal estándar: muestra ÚNICAMENTE "PERÍODO DE CONSUMO: [mes]"
  //    - Recibo sin valor fiscal y Concepto Personalizado: sin título arriba de la tabla
  if (esFacturaLegal && !esConceptoPersonalizado && periodoConsumoTexto) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`PERÍODO DE CONSUMO: ${periodoConsumoTexto}`, margin, y);
    y += 4;
  }

  // Cabecera de tabla
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.rect(margin, y, contentWidth, 7, 'FD');
  doc.setFontSize(10);
  doc.text('CONCEPTO', margin + 3, y + 4.9);
  doc.text('MONTO', xRight - 3, y + 4.9, { align: 'right' });
  y += 11;

  const conceptoMaxWidth = contentWidth - 34; // Reserva espacio para montos alineados a la derecha

  if (esConceptoPersonalizado) {
    // MODO CONCEPTO PERSONALIZADO (1 solo concepto -> sin líneas divisorias):
    // Limpia paréntesis con regex y muestra en MAYÚSCULAS; NO calcula ERSSAN 2% ni IVA 10%.
    const conceptoMayuscula = limpiarDescripcionConceptoPDF(conceptoPersonalizadoTexto);
    const descLines = doc.splitTextToSize(conceptoMayuscula, conceptoMaxWidth);
    const extraLinesHeight = Math.max(0, descLines.length - 1) * 4.8;
    const rowAdvance = extraLinesHeight + 7.5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.8);
    doc.setTextColor(30, 41, 59);
    doc.text(descLines, margin + 3, y);
    doc.text(formatGs(montoAbonado), xRight - 3, y, { align: 'right' });

    y += rowAdvance;
  } else {
    const ordenConceptos: Record<string, number> = {
      consumo_agua: 1,
      deuda_anterior: 2,
      mora: 3,
      otros_trabajos: 4,
      cuota_conexion: 5,
      perdida_financiada: 6,
      reconexion: 7,
      erssan: 8,
    };

    const detallesFuente = (
      params.detalles && params.detalles.length > 0
        ? params.detalles
        : factura?.detalles && factura.detalles.length > 0
          ? factura.detalles
          : [
              {
                id: '1',
                factura_id: factura?.id || 'sin-factura',
                concepto: 'consumo_agua' as const,
                descripcion: `Consumo de agua potable (${factura?.consumo_m3 ?? 0} m³)`,
                monto: totalFacturaRef,
              },
            ]
    )
      .filter((d) => d.monto > 0)
      .sort((a, b) => (ordenConceptos[a.concepto] || 99) - (ordenConceptos[b.concepto] || 99));

    const conceptosFilas: Array<{ descripcion: string; monto: number; esInformativoIva?: boolean }> =
      detallesFuente.map((d) => ({
        descripcion: limpiarDescripcionConceptoPDF(d.descripcion || ''),
        monto: d.monto,
      }));

    // Factura Legal estándar incluye al final el concepto informativo "IVA 10%" = Total / 11
    if (esFacturaLegal) {
      const totalBaseIva = montoAbonado > 0 ? montoAbonado : totalFacturaRef;
      conceptosFilas.push({
        descripcion: 'IVA 10%',
        monto: calcularIva10Incluido(totalBaseIva),
        esInformativoIva: true,
      });
    }

    // Solo dibujar líneas divisorias cuando existan 3 o más conceptos
    const debeDibujarLineas = conceptosFilas.length >= 3;

    for (let idx = 0; idx < conceptosFilas.length; idx++) {
      const item = conceptosFilas[idx];
      const descLines = doc.splitTextToSize(item.descripcion, conceptoMaxWidth);
      const extraLinesHeight = Math.max(0, descLines.length - 1) * 4.8;
      const borderY = y + extraLinesHeight + 2.0;
      const rowAdvance = extraLinesHeight + 6.8;

      if (y + rowAdvance > pageHeight - 52) {
        doc.addPage('a5', 'portrait');
        y = margin + 4;
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(item.esInformativoIva ? 9.0 : 9.8);
      if (item.esInformativoIva) {
        doc.setTextColor(71, 85, 105);
      } else {
        doc.setTextColor(30, 41, 59);
      }
      doc.text(descLines, margin + 3, y);

      doc.setFont('helvetica', 'bold');
      doc.text(formatGs(item.monto), xRight - 3, y, { align: 'right' });

      // Líneas inferiores intercaladas tipo Excel: solo si hay 3 o más conceptos
      if (debeDibujarLineas && idx % 2 === 1) {
        doc.setDrawColor(148, 163, 184);
        doc.setLineWidth(0.3);
        doc.line(margin, borderY, xRight, borderY);
      }

      y += rowAdvance;
    }

    if (esPagoParcial) {
      y += 1.5;
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y, xRight, y);
      y += 5;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text('Total factura:', margin + 3, y);
      doc.text(formatGs(totalFacturaRef), xRight - 3, y, { align: 'right' });
      y += 5.5;
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(180, 83, 9);
      doc.text('Saldo pendiente:', margin + 3, y);
      doc.text(formatGs(saldoActual), xRight - 3, y, { align: 'right' });
      y += 3;
    }
  }

  y += 3;
  if (y + 42 > pageHeight - margin) {
    doc.addPage('a5', 'portrait');
    y = margin + 4;
  }

  // Bloque destacado: TOTAL ABONADO (15pt)
  doc.setFillColor(236, 253, 245);
  doc.setDrawColor(22, 163, 74);
  doc.setLineWidth(0.5);
  doc.roundedRect(margin, y, contentWidth, 14, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(20, 83, 45);
  doc.text('TOTAL ABONADO:', margin + 4, y + 9);

  doc.setFontSize(15);
  doc.setTextColor(21, 128, 61);
  doc.text(formatGs(montoAbonado), xRight - 4, y + 9.2, { align: 'right' });

  y += 20; // 14mm bloque + 6mm separación

  // Método de pago y Cobrador / Cajero
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.text('Método de pago:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(metodoTexto, margin + 35, y);

  y += 5.8;
  doc.setFont('helvetica', 'bold');
  doc.text('Cobrador / Cajero:', margin, y);
  doc.setFont('helvetica', 'normal');
  const cobradorLines = doc.splitTextToSize(cobradorTexto, contentWidth - 38);
  doc.text(cobradorLines, margin + 38, y);
  y += Math.max(7, cobradorLines.length * 4.8 + 3);

  // Pie del comprobante (omite RUC cuando es Recibo sin valor fiscal)
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.line(margin, y, xRight, y);
  y += 5.5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('¡Gracias por su pago!', pageWidth / 2, y, { align: 'center' });

  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const lineaPieEmpresa = esFacturaLegal
    ? `Pozo Artesiano San Gabriel (${EMPRESA_LEGAL.titular}) • RUC: ${EMPRESA_LEGAL.ruc}`
    : `Pozo Artesiano San Gabriel (${EMPRESA_LEGAL.titular})`;
  doc.text(lineaPieEmpresa, pageWidth / 2, y, {
    align: 'center',
  });

  y += 4.5;
  doc.text(`${EMPRESA_LEGAL.ubicacion} • Regulado por ERSSAN`, pageWidth / 2, y, {
    align: 'center',
  });

  return doc;
}
