/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import { Factura, Cliente, Medidor, DetalleFactura, Contrato, TarifaConfig } from '../types';
import { formatGs } from './billingRules';

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
 * - Marca de agua "PAGADA" si la factura está pagada (en gris claro).
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
  let y = 18;

  // Marca de agua si está pagada (en gris claro)
  if (factura.estado === 'pagada') {
    doc.setTextColor(225, 225, 225);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(55);
    // Texto centrado en diagonal suave
    doc.text('PAGADA', pageWidth / 2, 130, { align: 'center', angle: 30 });
    doc.setTextColor(0, 0, 0);
  }

  // Encabezado institucional (texto sin logo grande)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  doc.text('AGUATERÍA POTABLE PARAGUAY S.A.', margin, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('RUC: 80045921-3 — Ente Regulador: ERSSAN (Ley N° 1614/2000)', margin, y + 4.5);
  doc.text('San Lorenzo - Gran Asunción, Paraguay — Tel: (021) 580-000', margin, y + 8.5);

  // Recuadro derecho: Boleta N° [numero_boleta_medidor]-[periodo_facturado] y Fecha de Emisión
  const numeroBoleta = factura.numero_boleta_medidor || 1;
  const identificadorBoleta = `Boleta N° ${numeroBoleta}-${factura.periodo_facturado}`;

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.rect(pageWidth - margin - 65, y - 4, 65, 17);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(identificadorBoleta, pageWidth - margin - 61, y + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Emisión: ${factura.fecha_emision}`, pageWidth - margin - 61, y + 6.5);
  doc.text(`Período: ${factura.periodo_facturado}`, pageWidth - margin - 61, y + 10.5);

  y += 20;
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
  doc.text(`Período facturado: ${factura.periodo_facturado}`, margin + 95, y);

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
  const montoErssan = detalleErssan ? detalleErssan.monto : Math.round(subtotal * 0.02);
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
  let y = 20;

  // Encabezado
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  doc.text('AGUATERÍA POTABLE PARAGUAY S.A.', margin, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('RUC: 80045921-3 — Permisionario Regulado por ERSSAN (Ley N° 1614/2000)', margin, y + 4.5);

  y += 12;
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
    'PRESTADOR: AGUATERÍA POTABLE PARAGUAY S.A., con RUC 80045921-3, con domicilio legal en Calle 10 de Agosto N° 450, San Lorenzo, República del Paraguay.';
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
  doc.text(`Lugar y Fecha: San Lorenzo, Paraguay — ${fechaEmision}`, margin, y);
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
  doc.text('AGUATERÍA POTABLE PARAGUAY S.A.', xFirma1 + anchoFirma / 2, y, { align: 'center' });
  doc.text(cliente.nombre_completo, xFirma2 + anchoFirma / 2, y, { align: 'center' });

  y += 3.5;
  doc.text('Firma y Sello Autorizado', xFirma1 + anchoFirma / 2, y, { align: 'center' });
  doc.text(`Doc: ${cliente.documento}`, xFirma2 + anchoFirma / 2, y, { align: 'center' });

  return doc;
}
