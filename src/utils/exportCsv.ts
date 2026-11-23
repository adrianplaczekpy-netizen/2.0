/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function exportarLecturasCSV(
  lecturas: Array<{
    id: string;
    numero_medidor: number;
    cliente_nombre: string;
    cliente_doc: string;
    direccion: string;
    periodo: string;
    fecha_lectura: string;
    lectura_anterior: number;
    lectura_actual: number;
    consumo_m3: number;
    estado: string;
    factura_estado?: string | null;
    registrado_por: string;
    observaciones?: string | null;
    editado_por?: string | null;
    fecha_edicion?: string | null;
    motivo_edicion?: string | null;
  }>,
  nombreArchivo = 'reporte_lecturas_aguateria.csv'
) {
  const headers = [
    'ID Lectura',
    'N° Medidor',
    'Cliente',
    'Documento CI/RUC',
    'Dirección Terreno',
    'Período',
    'Fecha Lectura',
    'Lectura Anterior (m³)',
    'Lectura Actual (m³)',
    'Consumo (m³)',
    'Estado Lectura',
    'Estado Factura',
    'Lector / Registrado Por',
    'Observaciones Internas',
    'Editado Por (Auditoría)',
    'Fecha Edición',
    'Motivo Edición',
  ];

  const rows = lecturas.map((l) => [
    `"${l.id}"`,
    l.numero_medidor,
    `"${(l.cliente_nombre || '').replace(/"/g, '""')}"`,
    `"${l.cliente_doc || ''}"`,
    `"${(l.direccion || '').replace(/"/g, '""')}"`,
    `"${l.periodo}"`,
    `"${l.fecha_lectura}"`,
    l.lectura_anterior,
    l.lectura_actual,
    l.consumo_m3,
    `"${l.estado}"`,
    `"${l.factura_estado || 'Sin factura'}"`,
    `"${(l.registrado_por || '').replace(/"/g, '""')}"`,
    `"${(l.observaciones || '').replace(/"/g, '""')}"`,
    `"${(l.editado_por || '').replace(/"/g, '""')}"`,
    `"${l.fecha_edicion || ''}"`,
    `"${(l.motivo_edicion || '').replace(/"/g, '""')}"`,
  ]);

  const csvContent =
    '\uFEFF' +
    [headers.join(';'), ...rows.map((row) => row.join(';'))].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', nombreArchivo);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportarCargosCSV(
  cargos: Array<{
    id: string;
    numeroMedidor: number;
    clienteNombre: string;
    clienteDoc: string;
    medidorDireccion: string;
    descripcion: string;
    monto: number;
    periodo_facturacion: string;
    fecha_trabajo: string;
    estado: string;
    factura_id?: string | null;
    registrado_por: string;
    motivo_anulacion?: string | null;
    editado_por?: string | null;
    fecha_edicion?: string | null;
  }>,
  nombreArchivo = 'reporte_otros_trabajos_aguateria.csv'
) {
  const headers = [
    'ID Cargo',
    'N° Medidor',
    'Cliente',
    'Documento CI/RUC',
    'Dirección Terreno',
    'Concepto / Descripción del Trabajo',
    'Monto (Gs.)',
    'Período Facturación',
    'Fecha Trabajo',
    'Estado',
    'N° Factura Asignada',
    'Registrado Por',
    'Motivo Anulación (Auditoría)',
    'Editado Por',
    'Fecha Edición',
  ];

  const rows = cargos.map((c) => [
    `"${c.id}"`,
    c.numeroMedidor,
    `"${(c.clienteNombre || '').replace(/"/g, '""')}"`,
    `"${c.clienteDoc || ''}"`,
    `"${(c.medidorDireccion || '').replace(/"/g, '""')}"`,
    `"${(c.descripcion || '').replace(/"/g, '""')}"`,
    c.monto,
    `"${c.periodo_facturacion}"`,
    `"${c.fecha_trabajo}"`,
    `"${c.estado}"`,
    `"${c.factura_id || 'Pendiente'}"`,
    `"${(c.registrado_por || '').replace(/"/g, '""')}"`,
    `"${(c.motivo_anulacion || '').replace(/"/g, '""')}"`,
    `"${(c.editado_por || '').replace(/"/g, '""')}"`,
    `"${c.fecha_edicion || ''}"`,
  ]);

  const csvContent =
    '\uFEFF' +
    [headers.join(';'), ...rows.map((row) => row.join(';'))].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', nombreArchivo);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportarFacturasCSV(
  facturas: Array<{
    id: string;
    numero_boleta_medidor?: number;
    periodo_facturado: string;
    clienteNombre: string;
    clienteDoc: string;
    numeroMedidor: number;
    fecha_emision: string;
    fecha_vencimiento: string;
    consumo_m3?: number;
    total: number;
    saldo_pendiente?: number;
    saldo?: number;
    estado: string;
    es_tercera_boleta: boolean;
    alerta_consumo_elevado: boolean;
    texto_alerta_consumo?: string | null;
  }>,
  nombreArchivo = 'facturas_aguateria.csv'
) {
  const headers = [
    'N° Factura',
    'Cliente',
    'Documento CI/RUC',
    'N° Medidor',
    'Período',
    'Fecha Emisión',
    'Fecha Vencimiento',
    'Consumo (m³)',
    'Total (Gs.)',
    'Saldo Pendiente (Gs.)',
    'Estado',
    'Tercera Boleta',
    'Consumo Elevado',
    'Detalle Alerta',
  ];

  const rows = facturas.map((f) => {
    const numFactura =
      f.numero_boleta_medidor && f.periodo_facturado
        ? `${f.numero_boleta_medidor}-${f.periodo_facturado}`
        : f.id.slice(0, 12);
    const saldo =
      f.estado === 'pagada' || f.estado === 'anulada' || f.estado === 'refinanciada'
        ? 0
        : f.saldo_pendiente !== undefined
          ? f.saldo_pendiente
          : f.saldo !== undefined
            ? f.saldo
            : f.total;

    return [
      `"${numFactura}"`,
      `"${(f.clienteNombre || '').replace(/"/g, '""')}"`,
      `"${f.clienteDoc || ''}"`,
      f.numeroMedidor,
      `"${f.periodo_facturado}"`,
      `"${f.fecha_emision}"`,
      `"${f.fecha_vencimiento}"`,
      f.consumo_m3 ?? 0,
      f.total,
      saldo,
      `"${f.estado}"`,
      `"${f.es_tercera_boleta ? 'Sí' : 'No'}"`,
      `"${f.alerta_consumo_elevado ? 'Sí' : 'No'}"`,
      `"${(f.texto_alerta_consumo || '').replace(/"/g, '""')}"`,
    ];
  });

  const csvContent =
    '\uFEFF' +
    [headers.join(';'), ...rows.map((row) => row.join(';'))].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', nombreArchivo);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}


