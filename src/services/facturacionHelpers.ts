/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DetalleFactura, Factura, Lectura, Pago, TipoComprobantePago, UserRole } from '../types';
import type { MedidorOmitidoFacturacion } from './billingEngine';

export const ORDEN_CONCEPTOS_FACTURA: Record<DetalleFactura['concepto'], number> = {
  consumo_agua: 1,
  deuda_anterior: 2,
  mora: 3,
  otros_trabajos: 4,
  cuota_conexion: 5,
  perdida_financiada: 6,
  reconexion: 7,
  erssan: 8,
};

export const ETIQUETAS_CONCEPTO_FACTURA: Record<DetalleFactura['concepto'], string> = {
  consumo_agua: 'Consumo de agua',
  deuda_anterior: 'Deuda anterior',
  mora: 'Recargo por mora',
  otros_trabajos: 'Otros trabajos',
  cuota_conexion: 'Cuota de conexión',
  perdida_financiada: 'Pérdida financiada',
  reconexion: 'Reconexión',
  erssan: 'ERSSAN 2%',
};

export const ETIQUETAS_MOTIVO_OMISION: Record<string, string> = {
  cortado: 'Medidor cortado',
  retirado: 'Medidor retirado',
  pendiente_corte: 'Pendiente de corte',
  ya_facturado: 'Ya facturado en este período',
  sin_lectura_confirmada: 'Sin lectura confirmada',
};

/**
 * Ordena los conceptos en el orden estricto 1..8 y excluye cualquier concepto con monto <= 0.
 */
export function ordenarYFiltrarDetalles(detalles?: DetalleFactura[] | null): DetalleFactura[] {
  if (!detalles || detalles.length === 0) return [];
  return detalles
    .map((d, index) => ({ d, index }))
    .filter(({ d }) => Number(d.monto) > 0)
    .sort((a, b) => {
      const ordenA = ORDEN_CONCEPTOS_FACTURA[a.d.concepto] ?? 99;
      const ordenB = ORDEN_CONCEPTOS_FACTURA[b.d.concepto] ?? 99;
      if (ordenA !== ordenB) return ordenA - ordenB;
      return a.index - b.index;
    })
    .map(({ d }) => d);
}

/**
 * Resuelve el período por defecto (YYYY-MM) para la pantalla de generación mensual:
 * - Si existen lecturas confirmadas, usa el último período con lecturas confirmadas.
 * - Caso contrario, usa el mes/año actual.
 */
export function resolverPeriodoPorDefecto(
  lecturas: Pick<Lectura, 'periodo' | 'estado'>[],
  now: Date = new Date()
): string {
  const periodosConfirmados = lecturas
    .filter((l) => l.estado === 'confirmada' && /^\d{4}-(0[1-9]|1[0-2])$/.test(l.periodo || ''))
    .map((l) => l.periodo)
    .sort((a, b) => b.localeCompare(a));

  if (periodosConfirmados.length > 0) {
    return periodosConfirmados[0];
  }

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export const EMPRESA_LEGAL = {
  nombre: 'SERVICIO DE AGUA POTABLE - POZO ARTESIANO SAN GABRIEL',
  titular: 'de LEO PLACZEK e HIJA',
  ubicacion: "Fracción San Gabriel • Mboi'y - Itauguá",
  ruc: '3950638-0',
  timbrado: '19148339',
  inicioVigencia: '01/10/2026',
  finVigencia: '31/10/2027',
  prefijoFactura: '001-002-',
  whatsapp: '0986 977 631',
} as const;

/**
 * Formatea un número secuencial al formato oficial SET de Paraguay: 001-002-0000001.
 */
export function formatearNumeroFacturaSET(secuencial: number): string {
  const n = Math.max(1, Math.floor(Number(secuencial) || 1));
  return `${EMPRESA_LEGAL.prefijoFactura}${String(n).padStart(7, '0')}`;
}

/**
 * Extrae el contador numérico de un número de factura SET (ej: '001-002-0000042' -> 42).
 */
export function extraerSecuencialFacturaSET(numeroFactura?: string | null): number {
  if (!numeroFactura) return 0;
  const match = /^001-002-(\d+)$/.exec(numeroFactura.trim());
  if (!match) return 0;
  const parsed = parseInt(match[1], 10);
  return isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

/**
 * Calcula el próximo número secuencial global único e incremental a partir de todas las facturas emitidas.
 */
export function calcularSiguienteSecuencialFactura(
  facturasExistentes: Array<Pick<Factura, 'numero_factura'>>
): number {
  let maxSec = 0;
  for (const f of facturasExistentes) {
    const sec = extraerSecuencialFacturaSET(f.numero_factura);
    if (sec > maxSec) maxSec = sec;
  }
  return maxSec + 1;
}

/**
 * Resuelve el número oficial de factura para PDFs y vistas (siempre en formato 001-002-XXXXXXX).
 */
export function resolverNumeroFacturaParaMostrar(
  factura: Pick<Factura, 'numero_factura' | 'numero_boleta_medidor'>
): string {
  if (factura.numero_factura && factura.numero_factura.trim()) {
    return factura.numero_factura.trim();
  }
  return formatearNumeroFacturaSET(Number(factura.numero_boleta_medidor) || 1);
}

/**
 * Formatea un número secuencial de 4 dígitos para Recibos sin valor fiscal: 001-002-0001.
 */
export function formatearNumeroRecibo4Digitos(secuencial: number): string {
  const n = Math.max(1, Math.floor(Number(secuencial) || 1));
  return `${EMPRESA_LEGAL.prefijoFactura}${String(n).padStart(4, '0')}`;
}

/**
 * Extrae el contador numérico de un recibo sin valor fiscal (formato estricto de 4 dígitos: 001-002-0001 -> 1).
 * No colisiona con las facturas legales de 7 dígitos (001-002-0000001).
 */
export function extraerSecuencialRecibo4Digitos(numeroRecibo?: string | null): number {
  if (!numeroRecibo) return 0;
  const match = /^001-002-(\d{4})$/.exec(numeroRecibo.trim());
  if (!match) return 0;
  const parsed = parseInt(match[1], 10);
  return isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

/**
 * Calcula el siguiente número secuencial para recibos sin valor fiscal (4 dígitos).
 */
export function calcularSiguienteSecuencialRecibo4Digitos(
  pagosExistentes: Array<Pick<Pago, 'numero_recibo' | 'tipo_comprobante'>>
): number {
  let maxSec = 0;
  for (const p of pagosExistentes) {
    const sec = extraerSecuencialRecibo4Digitos(p.numero_recibo);
    if (sec > maxSec) maxSec = sec;
  }
  return maxSec + 1;
}

/**
 * Genera el próximo número de recibo de 4 dígitos único (001-002-XXXX).
 */
export function generarSiguienteNumeroRecibo4Digitos(
  pagosExistentes: Array<Pick<Pago, 'numero_recibo' | 'tipo_comprobante'>>
): string {
  const existingSet = new Set(
    pagosExistentes.map((p) => (p.numero_recibo || '').trim().toUpperCase()).filter(Boolean)
  );
  let seq = calcularSiguienteSecuencialRecibo4Digitos(pagosExistentes);
  let candidate = formatearNumeroRecibo4Digitos(seq);
  while (existingSet.has(candidate.toUpperCase())) {
    seq += 1;
    candidate = formatearNumeroRecibo4Digitos(seq);
  }
  return candidate;
}

/**
 * Extrae el contador numérico de 7 dígitos (formato estricto: 001-002-0000001 -> 1).
 */
export function extraerSecuencial7Digitos(numero?: string | null): number {
  if (!numero) return 0;
  const match = /^001-002-(\d{7})(?:-P\d+)?$/.exec(numero.trim());
  if (!match) return 0;
  const parsed = parseInt(match[1], 10);
  return isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

/**
 * Genera el próximo número de Factura Legal de 7 dígitos (001-002-XXXXXXX)
 * considerando tanto facturas emitidas como pagos independientes previos para evitar colisiones.
 */
export function generarSiguienteNumeroFacturaLegal7Digitos(
  facturasExistentes: Array<Pick<Factura, 'numero_factura'>>,
  pagosExistentes: Array<Pick<Pago, 'numero_recibo'>> = []
): string {
  const existingSet = new Set<string>();
  let maxSec = 0;

  for (const f of facturasExistentes) {
    const raw = (f.numero_factura || '').trim();
    if (raw) existingSet.add(raw.toUpperCase());
    const sec = extraerSecuencialFacturaSET(raw);
    if (sec > maxSec) maxSec = sec;
  }

  for (const p of pagosExistentes) {
    const raw = (p.numero_recibo || '').trim();
    if (raw) existingSet.add(raw.toUpperCase());
    const sec = extraerSecuencial7Digitos(raw);
    if (sec > maxSec) maxSec = sec;
  }

  let seq = maxSec + 1;
  let candidate = formatearNumeroFacturaSET(seq);
  while (existingSet.has(candidate.toUpperCase())) {
    seq += 1;
    candidate = formatearNumeroFacturaSET(seq);
  }
  return candidate;
}

/**
 * Resuelve el número a imprimir en el comprobante según tipo:
 * - factura_legal -> 7 dígitos (001-002-XXXXXXX)
 * - recibo_sin_valor_fiscal -> 4 dígitos (001-002-XXXX)
 */
export function resolverNumeroComprobantePago(params: {
  tipoComprobante: TipoComprobantePago;
  factura?: Pick<Factura, 'numero_factura' | 'numero_boleta_medidor'> | null;
  facturasExistentes?: Array<Pick<Factura, 'numero_factura'>>;
  pagosExistentes?: Array<Pick<Pago, 'numero_recibo' | 'tipo_comprobante'>>;
  numeroReciboActual?: string | null;
  esConceptoPersonalizado?: boolean;
}): string {
  if (params.tipoComprobante === 'recibo_sin_valor_fiscal') {
    if (params.numeroReciboActual && /^001-002-\d{4}$/.test(params.numeroReciboActual.trim())) {
      return params.numeroReciboActual.trim();
    }
    return generarSiguienteNumeroRecibo4Digitos(params.pagosExistentes || []);
  }
  if (params.numeroReciboActual && /^001-002-\d{7}/.test(params.numeroReciboActual.trim())) {
    return params.numeroReciboActual.trim();
  }
  if (params.esConceptoPersonalizado || !params.factura) {
    return generarSiguienteNumeroFacturaLegal7Digitos(
      params.facturasExistentes || [],
      params.pagosExistentes || []
    );
  }
  return resolverNumeroFacturaParaMostrar(params.factura);
}

/**
 * Calcula el IVA 10% incluido en un monto total (Total / 11 redondeado a guaraníes enteros).
 */
export function calcularIva10Incluido(totalGs: number): number {
  const val = Number(totalGs) || 0;
  if (val <= 0) return 0;
  return Math.round(val / 11);
}

/**
 * Formatea el identificador legible de la factura para listados, fichas y exportación.
 */
export function formatearNumeroFactura(
  factura: Pick<Factura, 'id' | 'numero_boleta_medidor' | 'periodo_facturado' | 'numero_factura'>
): string {
  if (factura.numero_factura && factura.numero_factura.trim()) {
    return factura.numero_factura.trim();
  }
  const corr = Number(factura.numero_boleta_medidor);
  if (!isNaN(corr) && corr > 0 && factura.periodo_facturado) {
    return `N° ${corr}-${factura.periodo_facturado}`;
  }
  return factura.id.slice(0, 12).toUpperCase();
}

/**
 * Genera un número de recibo sugerido único (máx 30 caracteres para schema PostgreSQL).
 */
export function generarNumeroReciboSugerido(
  now: Date = new Date(),
  recibosExistentes: string[] = []
): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const existingSet = new Set(recibosExistentes.map((r) => r.trim().toUpperCase()));

  const baseSeq =
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');

  let candidate = `REC-${y}${m}${d}-${baseSeq}`;
  let counter = 1;
  while (existingSet.has(candidate.toUpperCase()) && counter < 999) {
    candidate = `REC-${y}${m}${d}-${baseSeq}-${counter}`;
    counter++;
  }
  return candidate.slice(0, 30);
}

/**
 * Agrupa medidores omitidos por motivo para mostrar el resumen estructurado de la corrida mensual.
 */
export function agruparOmitidosPorMotivo(omitidos: MedidorOmitidoFacturacion[]): Array<{
  motivo: string;
  etiqueta: string;
  cantidad: number;
  items: MedidorOmitidoFacturacion[];
}> {
  const mapa = new Map<string, MedidorOmitidoFacturacion[]>();
  const ordenPrioritario = ['cortado', 'retirado', 'pendiente_corte', 'ya_facturado', 'sin_lectura_confirmada'];

  for (const item of omitidos) {
    const lista = mapa.get(item.motivo) || [];
    lista.push(item);
    mapa.set(item.motivo, lista);
  }

  const keys = Array.from(mapa.keys()).sort((a, b) => {
    const idxA = ordenPrioritario.indexOf(a);
    const idxB = ordenPrioritario.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  return keys.map((motivo) => ({
    motivo,
    etiqueta: ETIQUETAS_MOTIVO_OMISION[motivo] || motivo,
    cantidad: mapa.get(motivo)!.length,
    items: [...mapa.get(motivo)!].sort((a, b) => a.numero_medidor - b.numero_medidor),
  }));
}

/**
 * Formatea el mensaje de aviso de desconexión para 3ra boleta.
 */
export function formatearAvisoDesconexion(fechaVencimiento: string): string {
  if (!fechaVencimiento) return 'DESCONEXIÓN';
  return `DESCONEXIÓN: ${fechaVencimiento}`;
}

/**
 * Reglas de control de acceso (RBAC) del módulo de Facturación.
 */
export function puedeAccederFacturacion(rol?: UserRole): boolean {
  return rol === 'admin' || rol === 'cobrador';
}

export function puedeGenerarFacturacionMensual(rol?: UserRole): boolean {
  return rol === 'admin';
}

export function puedeAnularFactura(rol?: UserRole): boolean {
  return rol === 'admin';
}

export function puedeRegistrarPago(rol?: UserRole): boolean {
  return rol === 'admin' || rol === 'cobrador';
}

/**
 * Calcula mensaje de feedback tras registrar un pago.
 */
export function formatearMensajePagoExitoso(
  saldoRestante: number,
  formatMonto: (monto: number) => string
): { titulo: string; pagadaCompletamente: boolean } {
  if (saldoRestante <= 0) {
    return {
      titulo: 'Factura pagada completamente',
      pagadaCompletamente: true,
    };
  }
  return {
    titulo: `Pago registrado. Saldo restante: ${formatMonto(saldoRestante)}`,
    pagadaCompletamente: false,
  };
}

/**
 * Dado un período de consumo YYYY-MM (ej: '2026-09'), devuelve el mes siguiente (ej: '2026-10')
 * como período de facturación sugerido.
 */
export function calcularPeriodoFacturadoSugerido(periodoConsumo: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec((periodoConsumo || '').trim());
  if (!match) return '';
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (month === 12) {
    return `${year + 1}-01`;
  }
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * Valida parámetros de entrada para emitir una factura individual para un medidor y período de consumo.
 */
export function validarSolicitudFacturaIndividual(params: {
  numeroMedidor: number | string;
  periodoConsumo: string;
  periodoFacturado?: string;
}): { valido: boolean; numeroMedidor?: number; periodoConsumo?: string; periodoFacturado?: string; error?: string } {
  const numStr = String(params.numeroMedidor ?? '').trim();
  if (!/^\d+$/.test(numStr)) {
    return { valido: false, error: 'Ingresá un número de medidor entero válido.' };
  }
  const numero = parseInt(numStr, 10);
  if (numero < 1) {
    return { valido: false, error: 'El número de medidor debe ser mayor o igual a 1.' };
  }

  const periodoConsumo = (params.periodoConsumo || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodoConsumo)) {
    return { valido: false, error: 'El período de consumo debe tener formato YYYY-MM (ej: 2026-09).' };
  }

  const periodoFacturado = (params.periodoFacturado || calcularPeriodoFacturadoSugerido(periodoConsumo)).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodoFacturado)) {
    return { valido: false, error: 'El período de facturación debe tener formato YYYY-MM.' };
  }

  return {
    valido: true,
    numeroMedidor: numero,
    periodoConsumo,
    periodoFacturado,
  };
}

