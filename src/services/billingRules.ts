/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Factura, Lectura, Medidor, TarifaConfig, DetalleFactura, EstadoMedidor, CargoPendiente } from '../types';

export const TARIFAS_DEFAULT: TarifaConfig = {
  id: 'tarifa-v1-py',
  precio_m3: 4000,
  consumo_minimo_m3: 9,
  monto_minimo_consumo: 36000,
  monto_mora_fijo: 3000,
  monto_reconexion: 60000,
  erssan_porcentaje: 2,
  dia_vencimiento_boletas_normales: 'ultimo_dia_mes',
  dia_vencimiento_tercera_boleta: 11,
  umbral_alerta_consumo: 3,
  texto_alerta_consumo:
    'CONSUMO ELEVADO — Su consumo de este mes es superior al habitual. Puede deberse a una pérdida en su propiedad. Por favor verifique.',
  max_numero_medidor: 1000,
  vigente_desde: '2025-01-01',
  creado_por: 'admin-sistema',
  fecha_creacion: '2025-01-01T00:00:00Z',
};

/**
 * 1. Consumo mínimo (por medidor):
 *
 * consumo_m3 = max(0, lectura_actual - lectura_anterior)
 * monto_bruto = consumo_m3 × precio_m3
 *
 * Si consumo_m3 <= consumo_minimo_m3:
 *   monto_consumo = max(monto_bruto, monto_minimo_consumo)
 * Sino:
 *   monto_consumo = monto_bruto
 *
 * Ejemplo (precio 4.000, mínimo 36.000, umbral 9 m³):
 * - Medidor A: 5 m³ → 36.000.
 * - Medidor B: 12 m³ → 48.000.
 * - Medidor C: 45 m³ → 180.000.
 */
export function calcularConsumoAgua(
  consumoM3: number,
  tarifa: TarifaConfig = TARIFAS_DEFAULT
): { montoAgua: number; consumoM3: number; montoBruto: number; aplicoMinimo: boolean } {
  const m3 = Math.max(0, Math.round(consumoM3));
  const montoBruto = m3 * tarifa.precio_m3;

  if (m3 <= tarifa.consumo_minimo_m3) {
    const montoAgua = Math.max(montoBruto, tarifa.monto_minimo_consumo);
    return {
      montoAgua,
      consumoM3: m3,
      montoBruto,
      aplicoMinimo: true,
    };
  }

  return {
    montoAgua: montoBruto,
    consumoM3: m3,
    montoBruto,
    aplicoMinimo: false,
  };
}

/**
 * 2. Mora (monto fijo por medidor):
 * mora_total_medidor = monto_mora_fijo × cantidad_boletas_vencidas_impagas_del_medidor
 *
 * - monto_mora_fijo = 3.000 Gs.
 * - La 3ra boleta vence el día 11 del mes de emisión. Genera mora desde el día 12.
 * - Si el cliente paga la 3ra antes del día 11, no se cobra la mora de esa 3ra.
 * - Mientras el medidor está cortado, la mora se congela en mora_congelada.
 */
export function esFacturaVencida(
  factura: Pick<Factura, 'estado' | 'fecha_vencimiento'>,
  fechaReferencia: Date = new Date()
): boolean {
  if (
    factura.estado === 'pagada' ||
    factura.estado === 'anulada' ||
    factura.estado === 'refinanciada'
  ) {
    return false;
  }
  if (factura.estado === 'vencida') return true;
  if (!factura.fecha_vencimiento) return false;

  const hoyIso = fechaReferencia.toISOString().slice(0, 10);
  const vencIso = String(factura.fecha_vencimiento).slice(0, 10);
  return vencIso < hoyIso;
}

export function calcularMoraMedidor(
  facturasImpagas: Factura[],
  moraFijaPorFactura: number = TARIFAS_DEFAULT.monto_mora_fijo,
  fechaReferencia: Date = new Date()
): { cantidadVencidas: number; moraTotal: number } {
  const facturasVencidas = facturasImpagas.filter((f) =>
    esFacturaVencida(f, fechaReferencia)
  );

  const cantidadVencidas = facturasVencidas.length;
  const moraTotal = cantidadVencidas * moraFijaPorFactura;

  return {
    cantidadVencidas,
    moraTotal,
  };
}

/**
 * 3. Alerta de consumo elevado (por medidor):
 * Si el medidor tiene al menos 3 meses de historial:
 *   promedio = promedio de los últimos 3 meses de consumo_m3 de ESE medidor
 *   Si consumo_actual > umbral_alerta_consumo × promedio:
 *     activar alerta_consumo_elevado = true en la factura de ese medidor
 *     guardar texto_alerta_consumo en la factura
 */
export function verificarAlertaConsumo(
  consumoActual: number,
  historialUltimosMeses: number[], // Consumos m3 de este medidor
  umbral: number = TARIFAS_DEFAULT.umbral_alerta_consumo
): { esElevado: boolean; promedio: number; razon: number; tieneHistorialSuficiente: boolean } {
  if (consumoActual <= 0) {
    return { esElevado: false, promedio: 0, razon: 0, tieneHistorialSuficiente: false };
  }

  // Tomar los últimos 3 meses de historial del medidor
  const ultimos3 = historialUltimosMeses.filter((c) => c !== undefined && c !== null && c >= 0).slice(0, 3);
  const tieneHistorialSuficiente = ultimos3.length >= 3;

  // "Sin 3 meses de historial en ese medidor, no se activa."
  if (!tieneHistorialSuficiente) {
    return {
      esElevado: false,
      promedio: 0,
      razon: 0,
      tieneHistorialSuficiente: false,
    };
  }

  const suma = ultimos3.reduce((acc, curr) => acc + curr, 0);
  const promedio = suma / ultimos3.length;
  const razon = promedio > 0 ? +(consumoActual / promedio).toFixed(1) : 0;
  const esElevado = consumoActual > umbral * promedio;

  return {
    esElevado,
    promedio: Math.round(promedio),
    razon,
    tieneHistorialSuficiente: true,
  };
}

/**
 * 4. Validación del numero_medidor:
 * - Entero entre 1 y max_numero_medidor (default 1000, configurable, ampliable).
 * - No se aceptan decimales, letras, símbolos ni ceros a la izquierda.
 * - Único en todo el sistema.
 * - Error claro si está fuera de rango: "El número de medidor debe estar entre 1 y [max]".
 * - Error claro si está duplicado: "Ya existe un medidor con ese número".
 * - Si se llega al máximo configurado: aviso al admin "Se alcanzó el máximo de medidores configurado. Amplíe el rango en configuración."
 */
export function validarNumeroMedidor(
  rawInput: string | number,
  numerosExistentes: Set<number> | number[],
  maxNumeroMedidor: number = TARIFAS_DEFAULT.max_numero_medidor,
  totalMedidoresActuales?: number
): { valido: boolean; error?: string; numero?: number } {
  const str = String(rawInput).trim();

  // No se aceptan ceros a la izquierda (ej: '05', '007')
  if (/^0\d+/.test(str)) {
    return {
      valido: false,
      error: 'El número de medidor no puede tener ceros a la izquierda.',
    };
  }

  // No se aceptan decimales, letras ni símbolos
  if (!/^-?\d+$/.test(str)) {
    return {
      valido: false,
      error: 'El número de medidor debe ser un número entero sin decimales, letras ni símbolos.',
    };
  }

  const numero = parseInt(str, 10);

  // Rango: Entero entre 1 y max_numero_medidor
  if (numero < 1 || numero > maxNumeroMedidor) {
    return {
      valido: false,
      error: `El número de medidor debe estar entre 1 y ${maxNumeroMedidor}`,
    };
  }

  // Unicidad
  const setExistentes = numerosExistentes instanceof Set ? numerosExistentes : new Set(numerosExistentes);
  if (setExistentes.has(numero)) {
    return {
      valido: false,
      error: 'Ya existe un medidor con ese número',
    };
  }

  // Aviso de tope alcanzado
  const count = totalMedidoresActuales ?? (Array.isArray(numerosExistentes) ? numerosExistentes.length : numerosExistentes.size);
  if (count >= maxNumeroMedidor) {
    return {
      valido: false,
      error: 'Se alcanzó el máximo de medidores configurado. Amplíe el rango en configuración.',
    };
  }

  return {
    valido: true,
    numero,
  };
}

/**
 * 4. ERSSAN 2% (sobre la suma de los conceptos 1 al 7 incluidos, solo si la base > 0):
 * Base = consumo_agua + deuda_anterior + mora + otros_trabajos + cuota_conexion + perdida_financiada + reconexion
 */
export function calcularErssanBaseCompleta(
  sumaConceptos1a7: number,
  porcentaje: number = TARIFAS_DEFAULT.erssan_porcentaje
): number {
  if (sumaConceptos1a7 <= 0 || porcentaje <= 0) return 0;
  return Math.round((sumaConceptos1a7 * porcentaje) / 100);
}

/**
 * 5. Evaluación de estado del medidor según boletas impagas y fecha de vencimiento:
 * - activo: 0 facturas vencidas impagas.
 * - moroso: 1 o 2 facturas vencidas impagas.
 * - pendiente_corte: no pagó la 3ra antes de su vencimiento (día 11).
 * - cortado: medidor retirado físicamente.
 * - retirado: retirado por otros motivos.
 */
export function evaluarEstadoMedidorPorVencidas(
  medidorActual: Pick<Medidor, 'estado'>,
  facturasMedidor: Pick<
    Factura,
    'estado' | 'fecha_vencimiento' | 'detalles' | 'es_tercera_boleta' | 'periodo_facturado'
  >[],
  fechaHoy: Date = new Date(),
  moraFijaPorFactura: number = TARIFAS_DEFAULT.monto_mora_fijo
): EstadoMedidor {
  if (medidorActual.estado === 'cortado') return 'cortado';
  if (medidorActual.estado === 'retirado') return 'retirado';

  const activasImpagas = (facturasMedidor || []).filter(
    (f) => f.estado !== 'pagada' && f.estado !== 'anulada' && f.estado !== 'refinanciada'
  );
  if (activasImpagas.length === 0) return 'activo';

  const cantidadVencidas = activasImpagas.filter((f) => esFacturaVencida(f, fechaHoy)).length;
  const maxMoraConsolidada = Math.max(0, ...activasImpagas.map((f) => obtenerMoraDeFactura(f)));
  const periodosMoraConsolidada =
    moraFijaPorFactura > 0 ? Math.floor(maxMoraConsolidada / moraFijaPorFactura) : 0;

  const tieneTerceraBoletaActiva = activasImpagas.some((f) => Boolean(f.es_tercera_boleta));
  const terceraBoletaVencida = activasImpagas.some(
    (f) => Boolean(f.es_tercera_boleta) && esFacturaVencida(f, fechaHoy)
  );

  if (
    cantidadVencidas >= 3 ||
    periodosMoraConsolidada >= 3 ||
    (tieneTerceraBoletaActiva &&
      (periodosMoraConsolidada >= 2 ||
        cantidadVencidas >= 2 ||
        terceraBoletaVencida ||
        medidorActual.estado === 'pendiente_corte'))
  ) {
    return 'pendiente_corte';
  }

  if (cantidadVencidas >= 1 || periodosMoraConsolidada >= 1) {
    return 'moroso';
  }

  return 'activo';
}

export function evaluarEstadoMedidor(
  medidorActual: Medidor,
  facturasImpagas: Factura[],
  fechaHoy: Date = new Date(),
  moraFijaPorFactura: number = TARIFAS_DEFAULT.monto_mora_fijo
): EstadoMedidor {
  if (medidorActual.estado === 'cortado') return 'cortado';
  if (medidorActual.estado === 'retirado') return 'retirado';

  const facturasActivasImpagas = (facturasImpagas || []).filter(
    (f) => f.estado !== 'pagada' && f.estado !== 'anulada' && f.estado !== 'refinanciada'
  );

  if (facturasActivasImpagas.length === 0) {
    return 'activo';
  }

  const facturasVencidas = facturasActivasImpagas.filter((f) =>
    esFacturaVencida(f, fechaHoy)
  );
  const maxMoraConsolidada = Math.max(
    0,
    ...facturasActivasImpagas.map((f) => obtenerMoraDeFactura(f))
  );
  const periodosMoraConsolidada =
    moraFijaPorFactura > 0 ? Math.floor(maxMoraConsolidada / moraFijaPorFactura) : 0;

  if (facturasVencidas.length === 0 && periodosMoraConsolidada === 0) {
    return 'activo';
  }

  const tieneTerceraBoleta =
    facturasVencidas.length >= 3 ||
    periodosMoraConsolidada >= 3 ||
    facturasActivasImpagas.some((f) => Boolean(f.es_tercera_boleta));

  if (tieneTerceraBoleta) {
    const terceraBoleta =
      facturasActivasImpagas.find((f) => f.es_tercera_boleta) || facturasVencidas[2];
    if (terceraBoleta) {
      const hoyIso = fechaHoy.toISOString().slice(0, 10);
      const venc3raIso = String(terceraBoleta.fecha_vencimiento || '').slice(0, 10);
      if (
        (venc3raIso && venc3raIso < hoyIso) ||
        facturasVencidas.length >= 3 ||
        periodosMoraConsolidada >= 2 ||
        medidorActual.estado === 'pendiente_corte'
      ) {
        return 'pendiente_corte';
      }
    }
    return 'moroso';
  }

  return 'moroso';
}

/**
 * 6. Formateador de texto de desconexión en mayúsculas:
 * "DESCONEXIÓN: 11 DE NOVIEMBRE"
 */
export function formatFechaDesconexion(fechaIso: string): string {
  if (!fechaIso) return 'DESCONEXIÓN INMEDIATA';
  const parts = fechaIso.split('-');
  if (parts.length < 3) return `DESCONEXIÓN: ${fechaIso}`;

  const mesNum = parseInt(parts[1], 10);
  const diaNum = parseInt(parts[2], 10);
  const meses = [
    'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
    'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
  ];
  const mesNombre = meses[mesNum - 1] || 'MES';
  return `DESCONEXIÓN: ${diaNum} DE ${mesNombre}`;
}

/**
 * Calcula el período inmediatamente anterior (N - 1 mes) en formato YYYY-MM.
 */
export function calcularPeriodoAnterior(periodo: string): string | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec((periodo || '').trim());
  if (!match) return null;
  let year = parseInt(match[1], 10);
  let month = parseInt(match[2], 10) - 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Devuelve el monto de mora incluido en una factura a partir de sus detalles.
 */
export function obtenerMoraDeFactura(factura?: Pick<Factura, 'detalles'> | null): number {
  if (!factura || !Array.isArray(factura.detalles)) return 0;
  return Math.max(
    0,
    factura.detalles
      .filter((d) => d.concepto === 'mora')
      .reduce((acc, d) => acc + Math.max(0, Number(d.monto) || 0), 0)
  );
}

/**
 * Devuelve el saldo pendiente efectivo de una factura activa impaga.
 * Las facturas pagadas, anuladas o refinanciadas tienen saldo 0.
 */
export function obtenerSaldoPendienteFactura(factura: Factura): number {
  if (
    !factura ||
    factura.estado === 'pagada' ||
    factura.estado === 'anulada' ||
    factura.estado === 'refinanciada'
  ) {
    return 0;
  }
  const saldo =
    typeof factura.saldo_pendiente === 'number'
      ? factura.saldo_pendiente
      : typeof factura.saldo === 'number'
        ? factura.saldo
        : factura.total || 0;
  return Math.max(0, saldo);
}

export interface ResultadoDeudaYMoraConsolidada {
  deudaAnteriorMonto: number;
  montoMora: number;
  moraAnterior: number;
  moraNueva: number;
  cantMorasAcumuladas: number;
  saldoPendienteAnterior: number;
  facturaAnterior: Factura | null;
  periodoAnterior: string | null;
  facturaAnteriorARefinanciar: {
    id: string;
    periodo_facturado: string;
    motivo: string;
  } | null;
}

/**
 * Reglas exactas de Deuda Anterior y Mora Consolidada al facturar período N:
 * 1. Deuda anterior = saldo_pendiente de N-1 MENOS la mora incluida en N-1.
 *    Si N-1 no existe, está pagada, anulada o refinanciada -> deuda_anterior = 0.
 * 2. Mora al facturar N = mora_de_N-1 + monto_mora_fijo (si N-1 está vencida).
 *    Si N-1 no existe, está pagada, anulada o refinanciada -> mora_N = 0 (salvo mora_congelada).
 * 3. N-1 queda marcada para pasar a estado = 'refinanciada', saldo_pendiente = 0, motivo = 'Consolidada en factura N'.
 */
export function calcularDeudaYMoraConsolidadaPeriodoN(params: {
  facturas: Factura[];
  periodoActual: string;
  tarifa?: TarifaConfig;
  fechaReferencia?: Date;
  moraCongelada?: number | null;
}): ResultadoDeudaYMoraConsolidada {
  const tarifa = params.tarifa || TARIFAS_DEFAULT;
  const fechaRef = params.fechaReferencia || new Date();
  const periodoAnterior = calcularPeriodoAnterior(params.periodoActual);
  const tieneMoraCongelada =
    params.moraCongelada !== null && params.moraCongelada !== undefined;

  if (!periodoAnterior) {
    const moraBase = tieneMoraCongelada ? Number(params.moraCongelada) : 0;
    return {
      deudaAnteriorMonto: 0,
      montoMora: moraBase,
      moraAnterior: 0,
      moraNueva: 0,
      cantMorasAcumuladas:
        tarifa.monto_mora_fijo > 0 ? Math.round(moraBase / tarifa.monto_mora_fijo) : 0,
      saldoPendienteAnterior: 0,
      facturaAnterior: null,
      periodoAnterior: null,
      facturaAnteriorARefinanciar: null,
    };
  }

  const candidatas = (params.facturas || [])
    .filter((f) => f.periodo_facturado === periodoAnterior && f.estado !== 'anulada')
    .sort((a, b) => {
      const numDiff = (Number(b.numero_boleta_medidor) || 0) - (Number(a.numero_boleta_medidor) || 0);
      if (numDiff !== 0) return numDiff;
      return (b.fecha_emision || '').localeCompare(a.fecha_emision || '');
    });

  const facturaAnterior = candidatas[0] || null;
  if (
    !facturaAnterior ||
    facturaAnterior.estado === 'pagada' ||
    facturaAnterior.estado === 'refinanciada'
  ) {
    const moraBase = tieneMoraCongelada ? Number(params.moraCongelada) : 0;
    return {
      deudaAnteriorMonto: 0,
      montoMora: moraBase,
      moraAnterior: 0,
      moraNueva: 0,
      cantMorasAcumuladas:
        tarifa.monto_mora_fijo > 0 ? Math.round(moraBase / tarifa.monto_mora_fijo) : 0,
      saldoPendienteAnterior: 0,
      facturaAnterior: null,
      periodoAnterior,
      facturaAnteriorARefinanciar: null,
    };
  }

  const saldoPendienteAnterior = obtenerSaldoPendienteFactura(facturaAnterior);
  if (saldoPendienteAnterior <= 0) {
    const moraBase = tieneMoraCongelada ? Number(params.moraCongelada) : 0;
    return {
      deudaAnteriorMonto: 0,
      montoMora: moraBase,
      moraAnterior: 0,
      moraNueva: 0,
      cantMorasAcumuladas:
        tarifa.monto_mora_fijo > 0 ? Math.round(moraBase / tarifa.monto_mora_fijo) : 0,
      saldoPendienteAnterior: 0,
      facturaAnterior: null,
      periodoAnterior,
      facturaAnteriorARefinanciar: null,
    };
  }

  const moraAnterior = obtenerMoraDeFactura(facturaAnterior);
  const deudaAnteriorMonto = Math.max(0, saldoPendienteAnterior - moraAnterior);
  const moraNueva = esFacturaVencida(facturaAnterior, fechaRef) ? tarifa.monto_mora_fijo : 0;
  const montoMora = tieneMoraCongelada ? Number(params.moraCongelada) : moraAnterior + moraNueva;
  const cantMorasAcumuladas =
    tarifa.monto_mora_fijo > 0 ? Math.round(montoMora / tarifa.monto_mora_fijo) : 0;

  return {
    deudaAnteriorMonto,
    montoMora,
    moraAnterior,
    moraNueva,
    cantMorasAcumuladas,
    saldoPendienteAnterior,
    facturaAnterior,
    periodoAnterior,
    facturaAnteriorARefinanciar: {
      id: facturaAnterior.id,
      periodo_facturado: facturaAnterior.periodo_facturado,
      motivo: `Consolidada en factura ${params.periodoActual}`,
    },
  };
}

/**
 * Regla de Deuda Anterior al facturar el período N:
 * - Busca la factura del medidor con periodo_facturado = (N - 1 mes) y estado != 'anulada'.
 * - Si existe y saldo_pendiente > 0 (y no está pagada ni refinanciada):
 *   deuda_anterior = max(0, saldo_pendiente - mora_de_N-1).
 * - Si está pagada, anulada, refinanciada o no existe -> deuda_anterior = 0.
 */
export function obtenerDeudaAnteriorPeriodoNMenos1(
  facturas: Factura[],
  periodoActual: string
): {
  deudaAnteriorMonto: number;
  facturaAnterior: Factura | null;
  periodoAnterior: string | null;
} {
  const res = calcularDeudaYMoraConsolidadaPeriodoN({
    facturas,
    periodoActual,
  });
  return {
    deudaAnteriorMonto: res.deudaAnteriorMonto,
    facturaAnterior: res.facturaAnterior,
    periodoAnterior: res.periodoAnterior,
  };
}

/**
 * Regla de Deuda en Regularización / Reconexión:
 * Toma el saldo_pendiente de la última factura impaga (la más reciente no anulada ni refinanciada),
 * evitando sumar facturas anteriores cuyo saldo ya fue arrastrado.
 */
export function obtenerDeudaUltimaFacturaImpaga(facturas: Factura[]): {
  deudaAnteriorMonto: number;
  facturaReciente: Factura | null;
  cantidadImpagas: number;
} {
  const candidatas = (facturas || [])
    .filter(
      (f) =>
        f.estado !== 'anulada' &&
        f.estado !== 'pagada' &&
        f.estado !== 'refinanciada' &&
        obtenerSaldoPendienteFactura(f) > 0
    )
    .sort((a, b) => {
      const cmpPeriodo = (b.periodo_facturado || '').localeCompare(a.periodo_facturado || '');
      if (cmpPeriodo !== 0) return cmpPeriodo;
      const numDiff = (Number(b.numero_boleta_medidor) || 0) - (Number(a.numero_boleta_medidor) || 0);
      if (numDiff !== 0) return numDiff;
      return (b.fecha_emision || '').localeCompare(a.fecha_emision || '');
    });

  const facturaReciente = candidatas[0] || null;
  const deudaAnteriorMonto = facturaReciente ? obtenerSaldoPendienteFactura(facturaReciente) : 0;

  return {
    deudaAnteriorMonto,
    facturaReciente,
    cantidadImpagas: candidatas.length,
  };
}

/**
 * 6. Generación de Factura mensual por medidor (dinámica, solo conceptos > 0):
 *
 * Orden estricto de conceptos:
 * 1. Consumo de agua del medidor (con mínimo aplicado).
 * 2. Deuda anterior del medidor (solo saldo_pendiente de la factura del período N-1 no anulada).
 * 3. Recargo por mora del medidor.
 * 4. Otros trabajos del medidor (cargos pendientes del período).
 * 5. Cuota de conexión (si aplica al medidor).
 * 6. Pérdida financiada (si aplica al medidor).
 * 7. Reconexión (solo si el medidor está cortado y se registró la reconexión).
 * 8. ERSSAN 2% (sobre la suma de los conceptos 1 al 7 incluidos, solo si la base > 0).
 */
export function calcularFacturaMedidor(params: {
  medidor: Medidor;
  clienteId: string;
  periodo: string; // YYYY-MM
  lecturaActual: number;
  lecturaAnterior: number;
  historialUltimosMeses: number[];
  facturasImpagasAnteriores: Factura[];
  cargosPendientes: { id: string; descripcion: string; monto: number }[];
  cuotaConexion?: number;
  perdidaFinanciada?: number;
  montoReconexion?: number;
  tarifa?: TarifaConfig;
  fechaEmision?: string;
  correlativoPorMedidor: number;
  fechaReferencia?: Date;
}): { factura: Factura; detalles: DetalleFactura[] } {
  const tarifa = params.tarifa || TARIFAS_DEFAULT;
  const fechaRef = params.fechaReferencia || new Date();
  const consumoM3 = Math.max(0, params.lecturaActual - params.lecturaAnterior);

  // 1. Consumo de agua (con mínimo aplicado)
  const calculoAgua = calcularConsumoAgua(consumoM3, tarifa);

  // 2 y 3. Deuda anterior (N-1 sin su mora) y Mora consolidada (mora_N-1 + mora nueva si N-1 vencida)
  const {
    deudaAnteriorMonto,
    montoMora,
    cantMorasAcumuladas,
    facturaAnterior,
  } = calcularDeudaYMoraConsolidadaPeriodoN({
    facturas: params.facturasImpagasAnteriores,
    periodoActual: params.periodo,
    tarifa,
    fechaReferencia: fechaRef,
    moraCongelada: params.medidor.mora_congelada,
  });

  const cantVencidasDirectas = params.facturasImpagasAnteriores.filter((f) =>
    esFacturaVencida(f, fechaRef)
  ).length;

  // 4. Otros trabajos del medidor
  const montoOtrosTrabajos = params.cargosPendientes.reduce((acc, c) => acc + c.monto, 0);

  // 5. Cuota de conexión
  const cuotaConexion = params.cuotaConexion || 0;

  // 6. Pérdida financiada
  const perdidaFinanciada = params.perdidaFinanciada || 0;

  // 7. Reconexión
  const montoReconexion = params.montoReconexion || 0;

  // Base imponible ERSSAN: suma de conceptos 1 al 7
  const baseErssan =
    calculoAgua.montoAgua +
    deudaAnteriorMonto +
    montoMora +
    montoOtrosTrabajos +
    cuotaConexion +
    perdidaFinanciada +
    montoReconexion;

  // 8. ERSSAN 2% (sobre la suma de los conceptos 1 al 7 incluidos)
  const montoErssan = calcularErssanBaseCompleta(baseErssan, tarifa.erssan_porcentaje);

  // Alerta de consumo elevado (últimos 3 meses)
  const alertaConsumo = verificarAlertaConsumo(
    consumoM3,
    params.historialUltimosMeses,
    tarifa.umbral_alerta_consumo
  );

  // Tercera boleta: cuando ya tiene 2 vencidas/moras acumuladas anteriores
  const esTerceraBoleta = Math.max(cantVencidasDirectas, cantMorasAcumuladas) >= 2;

  // Fechas de emisión y vencimiento
  const [yearStr, monthStr] = params.periodo.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  const fechaEmision =
    params.fechaEmision || `${year}-${String(month).padStart(2, '0')}-01`;

  let fechaVencimiento: string;
  if (esTerceraBoleta) {
    const dia3ra = Math.min(Math.max(1, Number(tarifa.dia_vencimiento_tercera_boleta) || 11), 28);
    fechaVencimiento = `${year}-${String(month).padStart(2, '0')}-${String(dia3ra).padStart(2, '0')}`;
  } else {
    const diasEnMes = new Date(year, month, 0).getDate();
    const diaConfig = tarifa.dia_vencimiento_boletas_normales;
    let diaNormal = diasEnMes;
    if (diaConfig !== 'ultimo_dia_mes') {
      const diaNum = Number(diaConfig);
      if (!isNaN(diaNum) && diaNum >= 1 && diaNum <= 28) {
        diaNormal = Math.min(diaNum, diasEnMes);
      }
    }
    fechaVencimiento = `${year}-${String(month).padStart(2, '0')}-${String(diaNormal).padStart(2, '0')}`;
  }

  // Total
  const total = baseErssan + montoErssan;

  const facturaId = (params as any).facturaId || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  }));
  const detalles: DetalleFactura[] = [];

  const nuevoDetalleId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  }));

  // Solo incluir conceptos cuyo monto sea > 0
  // 1. Consumo de agua
  if (calculoAgua.montoAgua > 0) {
    detalles.push({
      id: nuevoDetalleId(),
      factura_id: facturaId,
      concepto: 'consumo_agua',
      descripcion: calculoAgua.aplicoMinimo
        ? `Consumo de agua (mínimo ${tarifa.consumo_minimo_m3} m³)`
        : `Consumo de agua (${consumoM3} m³)`,
      monto: calculoAgua.montoAgua,
    });
  }

  // 2. Deuda anterior (solo período N-1)
  if (deudaAnteriorMonto > 0 && facturaAnterior) {
    detalles.push({
      id: nuevoDetalleId(),
      factura_id: facturaId,
      concepto: 'deuda_anterior',
      descripcion: `Deuda anterior (período ${facturaAnterior.periodo_facturado})`,
      monto: deudaAnteriorMonto,
    });
  }

  // 3. Recargo por mora
  if (montoMora > 0) {
    const boletasMora = Math.max(1, cantMorasAcumuladas);
    const descripcionMora =
      tarifa.monto_mora_fijo > 0 && montoMora % tarifa.monto_mora_fijo === 0
        ? `Recargo por mora (${boletasMora} boleta${boletasMora > 1 ? 's' : ''} × ${tarifa.monto_mora_fijo.toLocaleString('es-PY')})`
        : 'Recargo por mora acumulada';
    detalles.push({
      id: nuevoDetalleId(),
      factura_id: facturaId,
      concepto: 'mora',
      descripcion: descripcionMora,
      monto: montoMora,
    });
  }

  // 4. Otros trabajos
  params.cargosPendientes.forEach((c) => {
    if (c.monto > 0) {
      detalles.push({
        id: nuevoDetalleId(),
        factura_id: facturaId,
        concepto: 'otros_trabajos',
        descripcion: c.descripcion,
        monto: c.monto,
        cargo_pendiente_id: c.id,
      });
    }
  });

  // 5. Cuota de conexión
  if (cuotaConexion > 0) {
    const cuotaX = (params as any).cuotaConexionNumero || 1;
    const totalY = (params as any).cuotaConexionTotal || 1;
    detalles.push({
      id: nuevoDetalleId(),
      factura_id: facturaId,
      concepto: 'cuota_conexion',
      descripcion: (params as any).cuotaConexionDescripcion || `Cuota de conexión (cuota ${cuotaX} de ${totalY})`,
      monto: cuotaConexion,
    });
  }

  // 6. Pérdida financiada
  if (perdidaFinanciada > 0) {
    const cuotaX = (params as any).perdidaFinanciadaNumero || 1;
    const totalY = (params as any).perdidaFinanciadaTotal || 1;
    detalles.push({
      id: nuevoDetalleId(),
      factura_id: facturaId,
      concepto: 'perdida_financiada',
      descripcion: (params as any).perdidaFinanciadaDescripcion || `Pérdida financiada (cuota ${cuotaX} de ${totalY})`,
      monto: perdidaFinanciada,
    });
  }

  // 7. Reconexión
  if (montoReconexion > 0) {
    detalles.push({
      id: nuevoDetalleId(),
      factura_id: facturaId,
      concepto: 'reconexion',
      descripcion: 'Reconexión',
      monto: montoReconexion,
    });
  }

  // 8. ERSSAN 2%
  if (montoErssan > 0) {
    detalles.push({
      id: nuevoDetalleId(),
      factura_id: facturaId,
      concepto: 'erssan',
      descripcion: `ERSSAN ${tarifa.erssan_porcentaje}%`,
      monto: montoErssan,
    });
  }

  const factura: Factura = {
    id: facturaId,
    medidor_id: params.medidor.id,
    cliente_id: params.clienteId,
    periodo_facturado: params.periodo,
    fecha_emision: fechaEmision,
    fecha_vencimiento: fechaVencimiento,
    estado: 'pendiente',
    total,
    saldo: total,
    monto_pagado: 0,
    es_tercera_boleta: esTerceraBoleta,
    alerta_consumo_elevado: alertaConsumo.esElevado,
    texto_alerta_consumo: alertaConsumo.esElevado ? tarifa.texto_alerta_consumo : null,
    numero_boleta_medidor: params.correlativoPorMedidor,
    detalles,
    lectura_anterior: params.lecturaAnterior,
    lectura_actual: params.lecturaActual,
    consumo_m3: consumoM3,
  };

  return { factura, detalles };
}

/**
 * Resuelve un período válido YYYY-MM (7 chars) para la factura de regularización
 * sin colisionar con facturas no anuladas ya emitidas para el mismo medidor.
 */
export function resolverPeriodoRegularizacion(
  fechaEmision: string,
  periodosOcupados: Iterable<string> = []
): string {
  const fechaValida = /^\d{4}-\d{2}/.test(fechaEmision || '')
    ? fechaEmision
    : new Date().toISOString().slice(0, 10);
  const base = fechaValida.slice(0, 7);
  const ocupados = new Set(periodosOcupados);
  if (!ocupados.has(base)) return base;

  const [yearStr, monthStr] = base.split('-');
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10);

  for (let i = 0; i < 240; i++) {
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    const candidato = `${year}-${String(month).padStart(2, '0')}`;
    if (!ocupados.has(candidato)) {
      return candidato;
    }
  }
  return base;
}

/**
 * 7. Generación de Factura de Regularización por Reconexión:
 * Deuda anterior (usando saldo_pendiente) + mora congelada + reconexión (60.000 Gs) + cargos pendientes + ERSSAN 2%
 */
export function generarFacturaRegularizacion(params: {
  medidor: Medidor;
  clienteId: string;
  facturasImpagas: Factura[];
  cargosPendientes?: { id: string; descripcion: string; monto: number }[];
  tarifa?: TarifaConfig;
  fechaEmision?: string;
  periodo?: string;
  correlativoPorMedidor: number;
}): { factura: Factura; detalles: DetalleFactura[] } {
  const tarifa = params.tarifa || TARIFAS_DEFAULT;
  const facturasPendientes = params.facturasImpagas.filter(
    (f) => f.estado !== 'pagada' && f.estado !== 'anulada' && f.estado !== 'refinanciada'
  );
  const { deudaAnteriorMonto, facturaReciente } = obtenerDeudaUltimaFacturaImpaga(facturasPendientes);

  const moraCongelada =
    params.medidor.mora_congelada !== null && params.medidor.mora_congelada !== undefined
      ? params.medidor.mora_congelada
      : facturasPendientes.length * tarifa.monto_mora_fijo;

  const montoReconexion = tarifa.monto_reconexion;
  const cargos = params.cargosPendientes || [];
  const montoCargos = cargos.reduce((acc, c) => acc + Math.max(0, c.monto || 0), 0);

  const baseErssan = deudaAnteriorMonto + moraCongelada + montoReconexion + montoCargos;
  const montoErssan = calcularErssanBaseCompleta(baseErssan, tarifa.erssan_porcentaje);
  const total = baseErssan + montoErssan;

  const ahora = new Date().toISOString().split('T')[0];
  const facturaId = (params as any).facturaId || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  }));
  const detalles: DetalleFactura[] = [];

  const nuevoDetalleId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  }));

  if (deudaAnteriorMonto > 0) {
    detalles.push({
      id: nuevoDetalleId(),
      factura_id: facturaId,
      concepto: 'deuda_anterior',
      descripcion: facturaReciente
        ? `Factura de regularización - Deuda anterior (período ${facturaReciente.periodo_facturado})`
        : 'Factura de regularización - Deuda anterior',
      monto: deudaAnteriorMonto,
    });
  }

  if (moraCongelada > 0) {
    detalles.push({
      id: nuevoDetalleId(),
      factura_id: facturaId,
      concepto: 'mora',
      descripcion: `Factura de regularización - Mora congelada del medidor cortado`,
      monto: moraCongelada,
    });
  }

  cargos.forEach((c) => {
    if (c.monto > 0) {
      detalles.push({
        id: nuevoDetalleId(),
        factura_id: facturaId,
        concepto: 'otros_trabajos',
        descripcion: c.descripcion,
        monto: c.monto,
        cargo_pendiente_id: c.id,
      });
    }
  });

  if (montoReconexion > 0) {
    detalles.push({
      id: nuevoDetalleId(),
      factura_id: facturaId,
      concepto: 'reconexion',
      descripcion: `Factura de regularización - Tasa de reconexión y reinstalación de medidor`,
      monto: montoReconexion,
    });
  }

  if (montoErssan > 0) {
    detalles.push({
      id: nuevoDetalleId(),
      factura_id: facturaId,
      concepto: 'erssan',
      descripcion: `Aporte Ley ERSSAN (2% sobre liquidación de regularización)`,
      monto: montoErssan,
    });
  }

  const fechaEmisionReg = params.fechaEmision || ahora;
  const periodoNormalizado =
    params.periodo && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.periodo)
      ? params.periodo
      : fechaEmisionReg.slice(0, 7);

  const factura: Factura = {
    id: facturaId,
    medidor_id: params.medidor.id,
    cliente_id: params.clienteId,
    periodo_facturado: periodoNormalizado,
    periodo_consumo: periodoNormalizado,
    fecha_emision: fechaEmisionReg,
    fecha_vencimiento: fechaEmisionReg,
    estado: 'pendiente',
    total,
    saldo_pendiente: total,
    saldo: total,
    monto_pagado: 0,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: params.correlativoPorMedidor,
    detalles,
    consumo_m3: 0,
  };

  return { factura, detalles };
}

/**
 * 8. Liquidación para Reconexión de un medidor cortado:
 */
export function liquidarReconexion(
  medidor: Medidor,
  facturasImpagas: Factura[],
  tarifa: TarifaConfig = TARIFAS_DEFAULT,
  cargosPendientes: { monto: number }[] = []
): {
  totalPagar: number;
  subtotalFacturas: number;
  mora: number;
  subtotalCargos: number;
  montoReconexion: number;
  montoErssan: number;
  habilitadoParaReconexion: boolean;
} {
  const facturasPendientes = facturasImpagas.filter(
    (f) => f.estado !== 'pagada' && f.estado !== 'anulada' && f.estado !== 'refinanciada'
  );
  const { deudaAnteriorMonto: subtotalFacturas } = obtenerDeudaUltimaFacturaImpaga(facturasPendientes);
  const subtotalCargos = cargosPendientes.reduce(
    (acc, c) => acc + Math.max(0, Number(c.monto) || 0),
    0
  );
  const mora =
    medidor.mora_congelada !== null && medidor.mora_congelada !== undefined
      ? medidor.mora_congelada
      : facturasPendientes.length * tarifa.monto_mora_fijo;
  const montoReconexion = tarifa.monto_reconexion;

  const baseErssan = subtotalFacturas + mora + subtotalCargos + montoReconexion;
  const montoErssan = calcularErssanBaseCompleta(baseErssan, tarifa.erssan_porcentaje);
  const totalPagar = baseErssan + montoErssan;

  return {
    totalPagar,
    subtotalFacturas,
    mora,
    subtotalCargos,
    montoReconexion,
    montoErssan,
    habilitadoParaReconexion: medidor.estado === 'cortado' || medidor.estado === 'pendiente_corte',
  };
}

/**
 * Formateador de moneda de Paraguay (Guaraníes)
 */
export function formatGs(monto: number): string {
  if (isNaN(monto) || monto === null || monto === undefined) return '0 Gs.';
  return `${Math.round(monto).toLocaleString('es-PY')} Gs.`;
}

/**
 * 9. Validación estricta para el ingreso de lecturas:
 * - Entero sin decimales
 * - No negativo
 * - lectura_actual >= lectura_anterior (bloqueante salvo admin con justificación registrada)
 */
export function validarLecturaIngreso(params: {
  lecturaActual: number;
  lecturaAnterior: number;
  esAdmin: boolean;
  justificacionAdmin?: string;
}): { valida: boolean; error?: string; requiereJustificacionAdmin?: boolean } {
  if (typeof params.lecturaActual !== 'number' || isNaN(params.lecturaActual)) {
    return { valida: false, error: 'Debe ingresar un valor numérico para la lectura actual.' };
  }

  if (!Number.isInteger(params.lecturaActual)) {
    return { valida: false, error: 'La lectura actual debe ser un número entero sin decimales.' };
  }

  if (params.lecturaActual < 0) {
    return { valida: false, error: 'La lectura actual no puede ser un número negativo.' };
  }

  if (params.lecturaActual < params.lecturaAnterior) {
    if (!params.esAdmin) {
      return {
        valida: false,
        error: `La lectura actual (${params.lecturaActual}) no puede ser menor a la lectura anterior (${params.lecturaAnterior}). Solo un Administrador puede autorizar lectura menor con justificación de cambio de reloj o reinicio de contador.`,
        requiereJustificacionAdmin: true,
      };
    }
    if (!params.justificacionAdmin || params.justificacionAdmin.trim().length < 5) {
      return {
        valida: false,
        error: `Lectura actual menor a la anterior (${params.lecturaActual} < ${params.lecturaAnterior}). Requiere justificación de auditoría del Administrador (mínimo 5 caracteres).`,
        requiereJustificacionAdmin: true,
      };
    }
  }

  return { valida: true };
}

/**
 * 10. Reglas de edición y eliminación de lecturas:
 * - Si estado es "borrador": editable y eliminable libremente.
 * - Si estado es "confirmada" y factura NO pagada: editable/eliminable, recalcula la factura de ESE medidor.
 * - Si factura ya está pagada: solo admin puede editar/eliminar con motivo justificado (auditoría).
 */
export function validarEdicionLectura(params: {
  lectura: Lectura;
  factura?: Factura | null;
  usuarioRol: string;
  motivoEdicion?: string;
}): { permitida: boolean; error?: string } {
  if (params.lectura.estado === 'borrador') {
    return { permitida: true };
  }

  // Si no hay factura o la factura NO está pagada
  if (!params.factura || params.factura.estado !== 'pagada') {
    return { permitida: true };
  }

  // Si la factura ya está pagada
  if (params.usuarioRol !== 'admin') {
    return {
      permitida: false,
      error: 'La lectura corresponde a una factura ya pagada. Solo un Administrador puede modificarla o eliminarla con justificación de auditoría.',
    };
  }

  if (!params.motivoEdicion || params.motivoEdicion.trim().length < 5) {
    return {
      permitida: false,
      error: 'Debe ingresar un motivo o justificación de auditoría obligatorio (mínimo 5 caracteres).',
    };
  }

  return { permitida: true };
}

/**
 * 11. Reglas para Otros Trabajos (por medidor):
 * - NUNCA se agrega un cargo a una factura ya emitida.
 * - Si el cargo se cargó tarde, debe facturarse en el período siguiente.
 * - Un cargo facturado NO se puede editar ni borrar (solo admin anula la factura completa).
 * - Un cargo anulado no se factura y queda en auditoría con motivo.
 * - Cambiar período de cargo pendiente: permitido solo si el medidor no tiene factura emitida en el nuevo período.
 */
export function validarRegistroCargo(params: {
  monto: number;
  periodoFacturacion: string;
  medidorId: string;
  numeroMedidor: number;
  facturasExistentesMedidor: Factura[];
}): { valido: boolean; error?: string } {
  if (isNaN(params.monto) || params.monto <= 0) {
    return { valido: false, error: 'El monto a cobrar debe ser mayor a 0 Gs.' };
  }

  if (!/^\d{4}-\d{2}$/.test(params.periodoFacturacion)) {
    return { valido: false, error: 'Formato de período de facturación inválido (debe ser YYYY-MM).' };
  }

  // NUNCA se agrega un cargo a una factura ya emitida (salvo si fue anulada)
  const facturaEmitida = params.facturasExistentesMedidor.find(
    (f) =>
      f.medidor_id === params.medidorId &&
      f.periodo_facturado === params.periodoFacturacion &&
      f.estado !== 'anulada'
  );

  if (facturaEmitida) {
    return {
      valido: false,
      error: `NUNCA se agrega un cargo a una factura ya emitida. El período ${params.periodoFacturacion} ya fue emitido para el Medidor N° ${params.numeroMedidor} (Factura #${facturaEmitida.id}). Si el cargo se cargó tarde, debe facturarse en el período siguiente.`,
    };
  }

  return { valido: true };
}

export function validarEdicionCargo(params: {
  cargo: CargoPendiente;
  nuevoPeriodo?: string;
  nuevoMonto?: number;
  facturasExistentesMedidor?: Factura[];
  numeroMedidor?: number;
}): { permitida: boolean; error?: string } {
  if (params.cargo.estado === 'facturado') {
    return {
      permitida: false,
      error: 'Un cargo facturado NO se puede editar ni borrar. Solo el administrador puede anular la factura completa con justificación.',
    };
  }

  if (params.cargo.estado === 'anulado') {
    return {
      permitida: false,
      error: 'No se puede editar un cargo que ha sido anulado.',
    };
  }

  if (params.nuevoMonto !== undefined && (isNaN(params.nuevoMonto) || params.nuevoMonto <= 0)) {
    return {
      permitida: false,
      error: 'El monto a cobrar debe ser mayor a 0 Gs.',
    };
  }

  if (params.nuevoPeriodo && params.facturasExistentesMedidor) {
    const facturaEmitida = params.facturasExistentesMedidor.find(
      (f) =>
        f.medidor_id === params.cargo.medidor_id &&
        f.periodo_facturado === params.nuevoPeriodo &&
        f.estado !== 'anulada'
    );
    if (facturaEmitida) {
      return {
        permitida: false,
        error: `NUNCA se puede mover un cargo a un período con factura ya emitida. El período ${params.nuevoPeriodo} ya fue emitido para el Medidor N° ${params.numeroMedidor ?? ''} (Factura #${facturaEmitida.id}).`,
      };
    }
  }

  return { permitida: true };
}

export function validarAnulacionCargo(params: {
  cargo: CargoPendiente;
  motivo: string;
}): { permitida: boolean; error?: string } {
  if (params.cargo.estado === 'facturado') {
    return {
      permitida: false,
      error: 'Un cargo facturado NO se puede editar ni borrar. Solo el administrador puede anular la factura completa con justificación.',
    };
  }

  if (params.cargo.estado === 'anulado') {
    return {
      permitida: false,
      error: 'El cargo ya se encuentra anulado.',
    };
  }

  if (!params.motivo || params.motivo.trim().length < 5) {
    return {
      permitida: false,
      error: 'Debe especificar un motivo de anulación obligatorio para auditoría (mínimo 5 caracteres).',
    };
  }

  return { permitida: true };
}

