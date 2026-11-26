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
} from '../types';
import { formatGs } from './billingRules';
import { EMPRESA_LEGAL, resolverNumeroFacturaParaMostrar } from './facturacionHelpers';
import { LOGO_PNG_DATA_URL, LOGO_ASPECT_RATIO } from '../assets/logoData';

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
}): jsPDF {
  const { factura, cliente, medidor } = params;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  let y = 13;

  // Encabezado institucional con Logo (src/assets/logo.png) + datos legales a la izquierda
  const logoW = 44; // ~4.4 cm de ancho (proporción original 725x251 -> ~15.23 mm alto)
  const logoH = Number((logoW / LOGO_ASPECT_RATIO).toFixed(2));
  doc.addImage(LOGO_PNG_DATA_URL, 'PNG', margin, y, logoW, logoH);

  const xDatosLegales = margin + logoW + 3.5;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(`RUC: ${EMPRESA_LEGAL.ruc}`, xDatosLegales, y + 2.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`TIMBRADO N°: ${EMPRESA_LEGAL.timbrado}`, xDatosLegales, y + 6.3);
  doc.text(`Inicio Vigencia: ${EMPRESA_LEGAL.inicioVigencia}`, xDatosLegales, y + 10.1);
  doc.text(`Fin Vigencia: ${EMPRESA_LEGAL.finVigencia}`, xDatosLegales, y + 13.9);

  // Recuadro derecho: Número de Factura SET (001-002-XXXXXXX), Emisión, Período Facturado y Vencimiento
  const numeroFacturaSET = resolverNumeroFacturaParaMostrar(factura);
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
  doc.text(`Factura N°: ${numeroFacturaSET}`, boxX + 3.5, boxY + 5);

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
  doc.text(`Dirección del terreno: ${medidor.direccion}`, margin, y, { maxWidth: 90 });
  const textoPeriodo =
    factura.periodo_consumo && factura.periodo_consumo !== factura.periodo_facturado
      ? `Facturado: ${factura.periodo_facturado} (Consumo: ${factura.periodo_consumo})`
      : `Período facturado: ${factura.periodo_facturado}`;
  doc.text(textoPeriodo, margin + 95, y);

  y += 4.5;
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
  // Orden estricto: consumo de agua, deuda anterior, recargo por mora, otros trabajos (uno por línea si hay varios),
  //                 cuota de conexión, pérdida financiada, reconexión.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text('DETALLE DE CONCEPTOS', margin, y);
  y += 4;

  // Cabecera de la tabla de dos columnas: CONCEPTO | MONTO
  doc.setFillColor(245, 245, 245);
  doc.rect(margin, y, contentWidth, 6, 'FD');
  doc.setFontSize(8);
  doc.text('CONCEPTO', margin + 3, y + 4.2);
  doc.text('MONTO', pageWidth - margin - 3, y + 4.2, { align: 'right' });
  y += 8;

  const ordenJerarquia: Record<string, number> = {
    consumo_agua: 1,
    deuda_anterior: 2,
    mora: 3,
    otros_trabajos: 4,
    cuota_conexion: 5,
    perdida_financiada: 6,
    reconexion: 7,
  };

  const detalles = factura.detalles && factura.detalles.length > 0
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

  // Imprimir cada concepto uno por línea
  doc.setFontSize(8.5);
  for (const item of conceptosSinErssan) {
    doc.setFont('helvetica', 'normal');
    doc.text(item.descripcion, margin + 3, y);
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
    doc.text('Aporte ERSSAN (2%):', margin + 3, y);
    doc.setFont('helvetica', 'bold');
    doc.text(formatGs(montoErssan), pageWidth - margin - 3, y, { align: 'right' });
    y += 5.5;
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
  doc.text(formatGs(factura.total), pageWidth - margin - 3, y, { align: 'right' });

  y += 12;

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
  factura: Factura;
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
}

/**
 * Genera el Comprobante de Pago / Recibo de Caja en formato A5 vertical (148mm x 210mm).
 * Diseñado para impresoras térmicas o de recibos:
 * - Márgenes amplios (12mm), tipografía base legible (10pt-11pt) y TOTAL ABONADO destacado (15pt).
 * - Sin marca de agua gigante superpuesta: usa un sello compacto en la esquina superior derecha.
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

  const rawFecha =
    params.fechaPago ||
    pago?.fecha_pago ||
    factura.fecha_pago ||
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

  const montoAbonado =
    params.montoAbonado !== undefined
      ? params.montoAbonado
      : pago?.monto !== undefined
        ? pago.monto
        : factura.monto_pagado && factura.monto_pagado > 0
          ? factura.monto_pagado
          : factura.total;

  const saldoActual =
    params.saldoRestante !== undefined
      ? params.saldoRestante
      : factura.saldo_pendiente !== undefined
        ? factura.saldo_pendiente
        : Math.max(0, factura.total - montoAbonado);

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

  const numeroFacturaSET = resolverNumeroFacturaParaMostrar(factura);
  const periodoConsumoTexto = factura.periodo_consumo || factura.periodo_facturado;

  let y = 10;

  // 1) Logo centrado más grande en la parte superior (5.4 cm x 1.87 cm aprox., x = 47..101 mm)
  const logoW = 54;
  const logoH = Number((logoW / LOGO_ASPECT_RATIO).toFixed(2));
  const logoX = Number(((pageWidth - logoW) / 2).toFixed(2));
  doc.addImage(LOGO_PNG_DATA_URL, 'PNG', logoX, y, logoW, logoH);

  // 2) Sello compacto verde "PAGADO" (sin fecha debajo) en esquina superior izquierda
  const esPagoParcial = saldoActual > 0;
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

  // Datos legales alineados a la derecha
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.text(`RUC: ${EMPRESA_LEGAL.ruc}`, xRight, y + 3.2, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.9);
  doc.setTextColor(51, 65, 85);
  doc.text(`TIMBRADO N°: ${EMPRESA_LEGAL.timbrado}`, xRight, y + 7.0, { align: 'right' });
  doc.text(`Inicio Vigencia: ${EMPRESA_LEGAL.inicioVigencia}`, xRight, y + 10.8, { align: 'right' });
  doc.text(`Fin Vigencia: ${EMPRESA_LEGAL.finVigencia}`, xRight, y + 14.6, { align: 'right' });

  y += Math.max(logoH, badgeH + 2, 16) + 3.5;
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.4);
  doc.line(margin, y, xRight, y);
  y += 6;

  // 3) Título único bien destacado
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('COMPROBANTE OFICIAL DE PAGO', pageWidth / 2, y, { align: 'center' });

  y += 4.5;

  // 4) Recuadro estructurado: solo Factura N° (y Fecha/hora) a la izquierda; solo Emisión y Vencimiento a la derecha
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.35);
  doc.roundedRect(margin, y, contentWidth, 14, 1.5, 1.5, 'FD');

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(`Factura N°: ${numeroFacturaSET}`, margin + 3.5, y + 5.4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.8);
  doc.text(`Fecha y hora: ${fechaHoraTexto}`, margin + 3.5, y + 10.6);

  doc.setFontSize(8.8);
  doc.setTextColor(51, 65, 85);
  doc.text(`Emisión: ${factura.fecha_emision}`, xRight - 3.5, y + 5.4, { align: 'right' });
  doc.text(`Vencimiento: ${factura.fecha_vencimiento}`, xRight - 3.5, y + 10.6, { align: 'right' });

  y += 19.5; // 14mm caja + 5.5mm separación

  // 5) Datos del Cliente y Medidor
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
  doc.text(`Medidor N°: ${medidor.numero_medidor}`, margin, y);
  doc.text(`Período de Consumo: ${periodoConsumoTexto}`, xRight, y, { align: 'right' });
  y += 6;

  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.line(margin, y, xRight, y);
  y += 6;

  // 6) Detalle de conceptos en MAYÚSCULAS y líneas inferiores intercaladas estilo Excel
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text('DETALLE DE CONCEPTOS', margin, y);
  y += 4;

  // Cabecera de tabla
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.rect(margin, y, contentWidth, 7, 'FD');
  doc.setFontSize(10);
  doc.text('CONCEPTO', margin + 3, y + 4.9);
  doc.text('MONTO', xRight - 3, y + 4.9, { align: 'right' });
  y += 11;

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

  const detallesFuente =
    (params.detalles && params.detalles.length > 0
      ? params.detalles
      : factura.detalles && factura.detalles.length > 0
        ? factura.detalles
        : [
            {
              id: '1',
              factura_id: factura.id,
              concepto: 'consumo_agua' as const,
              descripcion: `Consumo de agua potable (${factura.consumo_m3 ?? 0} m³)`,
              monto: factura.total,
            },
          ]
    )
      .filter((d) => d.monto > 0)
      .sort((a, b) => (ordenConceptos[a.concepto] || 99) - (ordenConceptos[b.concepto] || 99));

  const conceptoMaxWidth = contentWidth - 34; // Reserva espacio para montos alineados a la derecha

  for (let idx = 0; idx < detallesFuente.length; idx++) {
    const item = detallesFuente[idx];
    const conceptoMayuscula = (item.descripcion || '').toUpperCase();
    const descLines = doc.splitTextToSize(conceptoMayuscula, conceptoMaxWidth);
    const extraLinesHeight = Math.max(0, descLines.length - 1) * 4.8;
    const borderY = y + extraLinesHeight + 2.0;
    const rowAdvance = extraLinesHeight + 6.8;

    if (y + rowAdvance > pageHeight - 52) {
      doc.addPage('a5', 'portrait');
      y = margin + 4;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.8);
    doc.setTextColor(30, 41, 59);
    doc.text(descLines, margin + 3, y);

    doc.setFont('helvetica', 'bold');
    doc.text(formatGs(item.monto), xRight - 3, y, { align: 'right' });

    // Líneas inferiores intercaladas tipo Excel:
    // 1° concepto (idx=0): sin línea, 2° (idx=1): con línea, 3° (idx=2): sin línea, 4° (idx=3): con línea...
    if (idx % 2 === 1) {
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
    doc.text(formatGs(factura.total), xRight - 3, y, { align: 'right' });
    y += 5.5;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 83, 9);
    doc.text('Saldo pendiente:', margin + 3, y);
    doc.text(formatGs(saldoActual), xRight - 3, y, { align: 'right' });
    y += 3;
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

  // Pie del comprobante
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
  doc.text(`Pozo Artesiano San Gabriel (${EMPRESA_LEGAL.titular}) • RUC: ${EMPRESA_LEGAL.ruc}`, pageWidth / 2, y, {
    align: 'center',
  });

  y += 4.5;
  doc.text(`${EMPRESA_LEGAL.ubicacion} • Regulado por ERSSAN`, pageWidth / 2, y, {
    align: 'center',
  });

  return doc;
}
