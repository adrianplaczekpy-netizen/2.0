/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Factura,
  DetalleFactura,
  Medidor,
  Lectura,
  CargoPendiente,
  PlanFinanciamiento,
  TarifaConfig,
  EstadoMedidor,
} from '../types';
import {
  TARIFAS_DEFAULT,
  esFacturaVencida,
  calcularDeudaYMoraConsolidadaPeriodoN,
} from './billingRules';
import { formatearNumeroFacturaSET } from './facturacionHelpers';

export interface MedidorOmitidoFacturacion {
  medidor_id: string;
  numero_medidor: number;
  cliente_id: string;
  motivo: 'cortado' | 'retirado' | 'pendiente_corte' | 'ya_facturado' | 'sin_lectura_confirmada' | string;
  detalle: string;
}

export interface ErrorFacturacionMedidor {
  medidor_id: string;
  numero_medidor?: number;
  error: string;
}

export interface ResumenFacturacionMensual {
  periodo: string;
  fechaEjecucion: string;
  totalMedidoresEvaluados: number;
  totalGeneradas: number;
  totalOmitidos: number;
  totalErrores: number;
  totalImporte: number;
  alertasConsumoCount: number;
  tercerasBoletasCount: number;
  facturasGeneradas: Factura[];
  medidoresOmitidos: MedidorOmitidoFacturacion[];
  errores: ErrorFacturacionMedidor[];
}

export interface CalculoFacturaParams {
  medidor: Medidor;
  clienteId: string;
  periodo: string; // YYYY-MM
  lecturaMes?: Lectura | null; // Lectura confirmada del período actual
  lecturasAnteriores?: Lectura[]; // Historial de lecturas previas confirmadas
  facturasImpagasAnteriores: Factura[]; // Facturas del medidor con estado !== 'pagada' y periodo !== actual
  cargosPendientes: CargoPendiente[]; // Cargos del período en estado 'pendiente'
  planesFinanciamiento: PlanFinanciamiento[]; // Planes activos del medidor
  montoReconexion?: number; // Si aplica reconexión en este período
  tarifa?: TarifaConfig;
  fechaEmision?: string; // YYYY-MM-DD
  correlativoPorMedidor: number;
  numeroFactura?: string; // Formato oficial SET: 001-002-0000001
  fechaReferencia?: Date; // Para evaluar vencimiento de facturas pasadas
  facturaId?: string; // UUID opcional pregenerado
}

export interface CalculoFacturaResultado {
  factura: Factura;
  detalles: DetalleFactura[];
  cargosFacturadosIds: string[];
  nuevoEstadoMedidor: EstadoMedidor;
  facturaAnteriorARefinanciar?: {
    id: string;
    periodo_facturado: string;
    motivo: string;
  } | null;
}

/**
 * 8. Función auxiliar: get_tarifa_vigente(concepto, fecha)
 * Devuelve el valor del parámetro tarifario más reciente con vigente_desde <= fecha.
 */
export function get_tarifa_vigente_param<K extends keyof TarifaConfig>(
  concepto: K,
  fecha?: string,
  tarifasDisponibles: TarifaConfig[] = [TARIFAS_DEFAULT]
): TarifaConfig[K] {
  if (!tarifasDisponibles || tarifasDisponibles.length === 0) {
    return TARIFAS_DEFAULT[concepto];
  }

  const fechaRef = fecha ? fecha.split('T')[0] : new Date().toISOString().split('T')[0];
  const ordenadas = [...tarifasDisponibles].sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde));
  const tarifaVigente = ordenadas.find((t) => t.vigente_desde <= fechaRef) || ordenadas[ordenadas.length - 1];

  return tarifaVigente[concepto];
}

/**
 * Helper para generar UUIDs seguros
 */
export function generarUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Cálculo de fecha de vencimiento según período y si es 3ra boleta
 */
export function calcularFechaVencimiento(
  periodo: string,
  esTerceraBoleta: boolean,
  tarifa: TarifaConfig = TARIFAS_DEFAULT
): string {
  const [yearStr, monthStr] = periodo.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  if (esTerceraBoleta) {
    // Si es 3ra boleta: día configurado (default 11) del mes del período
    const dia3ra = Math.min(Math.max(1, Number(tarifa.dia_vencimiento_tercera_boleta) || 11), 28);
    return `${year}-${String(month).padStart(2, '0')}-${String(dia3ra).padStart(2, '0')}`;
  }

  // Boleta normal: último día del mes del período o día configurado
  const diasEnMes = new Date(year, month, 0).getDate();
  const diaConfig = tarifa.dia_vencimiento_boletas_normales;

  let diaNormal = diasEnMes;
  if (diaConfig !== 'ultimo_dia_mes') {
    const diaNum = Number(diaConfig);
    if (!isNaN(diaNum) && diaNum >= 1 && diaNum <= 28) {
      diaNormal = Math.min(diaNum, diasEnMes);
    }
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(diaNormal).padStart(2, '0')}`;
}

/**
 * Determina si una lectura confirmada ya está asociada a una factura activa (estado !== 'anulada').
 * Ignora explícitamente facturas anuladas para permitir regenerar/refacturar lecturas liberadas.
 */
export function lecturaTieneFacturaActiva(lectura: Lectura, facturas: Factura[]): boolean {
  return facturas.some((f) => {
    if (f.estado === 'anulada') return false;
    if (f.medidor_id !== lectura.medidor_id) return false;

    const esFacturaSinLecturaNiConsumo =
      !f.lectura_id &&
      f.lectura_anterior === undefined &&
      f.lectura_actual === undefined &&
      (f.consumo_m3 === 0 || f.consumo_m3 === undefined) &&
      !(f.detalles || []).some((d) => d.concepto === 'consumo_agua');
    if (esFacturaSinLecturaNiConsumo) return false;

    // 1. Vínculo directo por lectura_id (criterio principal y más limpio)
    if (f.lectura_id) {
      return f.lectura_id === lectura.id;
    }

    // 2. Respaldo por factura_id en memoria
    if (lectura.factura_id && f.id === lectura.factura_id) {
      return true;
    }

    // 3. Vínculo por periodo_consumo explícito
    if (f.periodo_consumo) {
      return f.periodo_consumo === lectura.periodo;
    }

    // 4. Respaldo para facturas históricas anteriores a Opción B (sin lectura_id ni periodo_consumo):
    //    solo se considera coincidencia si coincide período facturado y valores de lectura (si existen)
    if (f.periodo_facturado !== lectura.periodo) return false;
    if (f.lectura_anterior !== undefined && f.lectura_actual !== undefined) {
      return (
        f.lectura_anterior === lectura.lectura_anterior &&
        f.lectura_actual === lectura.lectura_actual
      );
    }
    return true;
  });
}

/**
 * Opción B: Busca la lectura más reciente en estado 'confirmada' de un medidor
 * que NO tenga ninguna factura activa asociada (estado !== 'anulada').
 */
export function buscarLecturaConfirmadaPendienteDeFacturar(
  medidorId: string,
  lecturas: Lectura[],
  facturas: Factura[]
): Lectura | null {
  const candidatas = lecturas
    .filter(
      (l) =>
        l.medidor_id === medidorId &&
        l.estado === 'confirmada' &&
        !lecturaTieneFacturaActiva(l, facturas)
    )
    .sort((a, b) => {
      const cmpPeriodo = (b.periodo || '').localeCompare(a.periodo || '');
      if (cmpPeriodo !== 0) return cmpPeriodo;
      const cmpFecha = (b.fecha_lectura || '').localeCompare(a.fecha_lectura || '');
      if (cmpFecha !== 0) return cmpFecha;
      return (b.fecha_registro || '').localeCompare(a.fecha_registro || '');
    });

  return candidatas[0] || null;
}

/**
 * Orden estricto de cálculo de factura por medidor:
 * a) Consumo de agua (con mínimo aplicado)
 * b) Deuda anterior (saldos de boletas previas pendientes o vencidas)
 * c) Recargo por mora (monto_mora_fijo × cantidad de boletas vencidas impagas)
 * d) Otros trabajos (cargos pendientes del período en estado pendiente)
 * e) Cuota de conexión (planes_financiamiento tipo cuota_conexion activos)
 * f) Pérdida financiada (planes_financiamiento tipo perdida_financiada activos)
 * g) Reconexión (si aplica reconexión en el período)
 * h) ERSSAN 2% (sobre la suma de TODOS los conceptos incluidos: a, b, c, d, e, f, g con monto > 0)
 *
 * NOTA: Solo incluir conceptos con monto > 0. NO crear filas en cero.
 */
export function calcularFacturaIndividual(params: CalculoFacturaParams): CalculoFacturaResultado {
  const tarifa = params.tarifa || TARIFAS_DEFAULT;
  const fechaRef = params.fechaReferencia || new Date();
  const facturaId = params.facturaId || generarUUID();
  const detalles: DetalleFactura[] = [];
  const cargosFacturadosIds: string[] = [];

  // Fechas del período
  const [yearStr, monthStr] = params.periodo.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const fechaEmision = params.fechaEmision || `${year}-${String(month).padStart(2, '0')}-01`;

  // -------------------------------------------------------------------------
  // b y c previas: Consolidación de deuda anterior y mora del período N-1
  // 1) deuda_anterior = saldo_pendiente_N-1 - mora_de_N-1
  // 2) mora_N = mora_de_N-1 + (monto_mora_fijo si N-1 está vencida)
  // 3) factura N-1 pasa a estado = 'refinanciada', saldo_pendiente = 0
  // -------------------------------------------------------------------------
  const {
    deudaAnteriorMonto,
    montoMora,
    cantMorasAcumuladas,
    facturaAnterior,
    facturaAnteriorARefinanciar,
  } = calcularDeudaYMoraConsolidadaPeriodoN({
    facturas: params.facturasImpagasAnteriores,
    periodoActual: params.periodo,
    tarifa,
    fechaReferencia: fechaRef,
    moraCongelada: params.medidor.mora_congelada,
  });

  // -------------------------------------------------------------------------
  // 5. Detección de 3ra boleta (por cantidad de vencidas o moras acumuladas)
  // -------------------------------------------------------------------------
  const facturasVencidasImpagas = params.facturasImpagasAnteriores.filter((f) =>
    esFacturaVencida(f, fechaRef)
  );

  const cantVencidasImpagas = facturasVencidasImpagas.length;
  // Si tiene 2 o más vencidas/moras acumuladas anteriores, la nueva factura es la 3ra (o superior)
  const esTerceraBoleta = Math.max(cantVencidasImpagas, cantMorasAcumuladas) >= 2;

  // Fecha de vencimiento
  const fechaVencimiento = calcularFechaVencimiento(params.periodo, esTerceraBoleta, tarifa);

  // -------------------------------------------------------------------------
  // a) Consumo de agua
  // -------------------------------------------------------------------------
  let lecturaActual = 0;
  let lecturaAnterior = 0;
  let consumoM3 = 0;
  let montoConsumo = 0;
  let aplicoMinimo = false;

  if (params.lecturaMes && params.lecturaMes.estado === 'confirmada') {
    lecturaActual = params.lecturaMes.lectura_actual;
    lecturaAnterior = params.lecturaMes.lectura_anterior;
    consumoM3 = Math.max(0, lecturaActual - lecturaAnterior);

    const montoBruto = consumoM3 * tarifa.precio_m3;
    if (consumoM3 <= tarifa.consumo_minimo_m3) {
      montoConsumo = Math.max(montoBruto, tarifa.monto_minimo_consumo);
      aplicoMinimo = true;
    } else {
      montoConsumo = montoBruto;
      aplicoMinimo = false;
    }

    if (montoConsumo > 0) {
      const descripcionConsumo = aplicoMinimo
        ? `Consumo de agua (mínimo ${tarifa.consumo_minimo_m3} m³)`
        : `Consumo de agua (${consumoM3} m³)`;

      detalles.push({
        id: generarUUID(),
        factura_id: facturaId,
        concepto: 'consumo_agua',
        descripcion: descripcionConsumo,
        monto: montoConsumo,
      });
    }
  }

  // -------------------------------------------------------------------------
  // b) Deuda anterior
  // Debe ser EXCLUSIVAMENTE el saldo_pendiente de la factura del período N-1
  // MENOS la mora incluida en esa factura (nunca duplicar mora ni sumar todas).
  // -------------------------------------------------------------------------
  if (deudaAnteriorMonto > 0 && facturaAnterior) {
    const descripcionDeuda = `Deuda anterior (período ${facturaAnterior.periodo_facturado})`;

    detalles.push({
      id: generarUUID(),
      factura_id: facturaId,
      concepto: 'deuda_anterior',
      descripcion: descripcionDeuda,
      monto: deudaAnteriorMonto,
    });
  }

  // -------------------------------------------------------------------------
  // c) Recargo por mora
  // mora_N = mora_de_N-1 + (monto_mora_fijo si N-1 está vencida), salvo mora_congelada
  // -------------------------------------------------------------------------
  if (montoMora > 0) {
    const boletasMora = Math.max(1, cantMorasAcumuladas);
    const descripcionMora =
      tarifa.monto_mora_fijo > 0 && montoMora % tarifa.monto_mora_fijo === 0
        ? `Recargo por mora (${boletasMora} boleta${
            boletasMora > 1 ? 's' : ''
          } × ${tarifa.monto_mora_fijo.toLocaleString('es-PY')})`
        : 'Recargo por mora acumulada';

    detalles.push({
      id: generarUUID(),
      factura_id: facturaId,
      concepto: 'mora',
      descripcion: descripcionMora,
      monto: montoMora,
    });
  }

  // -------------------------------------------------------------------------
  // d) Otros trabajos (excluyendo cargos diferidos de RECONEXIÓN que van en g)
  // Cargos pendientes del medidor en estado 'pendiente' para este período
  // -------------------------------------------------------------------------
  const esCargoReconexion = (descripcion: string): boolean => {
    const normalizada = (descripcion || '')
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    return normalizada === 'RECONEXION';
  };

  const cargosPeriodo = (params.cargosPendientes || []).filter(
    (c) =>
      c.medidor_id === params.medidor.id &&
      c.periodo_facturacion === params.periodo &&
      c.estado === 'pendiente' &&
      c.monto > 0
  );

  const cargosReconexion = cargosPeriodo.filter((c) => esCargoReconexion(c.descripcion));
  const cargosOtrosTrabajos = cargosPeriodo.filter((c) => !esCargoReconexion(c.descripcion));

  let montoOtrosTrabajos = 0;
  for (const cargo of cargosOtrosTrabajos) {
    montoOtrosTrabajos += cargo.monto;
    cargosFacturadosIds.push(cargo.id);
    detalles.push({
      id: generarUUID(),
      factura_id: facturaId,
      concepto: 'otros_trabajos',
      descripcion: cargo.descripcion,
      monto: cargo.monto,
      cargo_pendiente_id: cargo.id,
    });
  }

  // -------------------------------------------------------------------------
  // e) Cuota de conexión
  // Buscar planes activos con tipo = 'cuota_conexion' y periodo_inicio <= periodo actual
  // NO incrementar cuotas_pagadas todavía (se hace al pagar la factura)
  // -------------------------------------------------------------------------
  const planConexion = (params.planesFinanciamiento || []).find(
    (p) =>
      p.medidor_id === params.medidor.id &&
      p.tipo === 'cuota_conexion' &&
      p.estado === 'activo' &&
      p.periodo_inicio <= params.periodo &&
      p.cuotas_pagadas < p.cantidad_cuotas &&
      p.monto_cuota > 0
  );

  let montoCuotaConexion = 0;
  if (planConexion) {
    montoCuotaConexion = planConexion.monto_cuota;
    const cuotaX = planConexion.cuotas_pagadas + 1;
    const totalY = planConexion.cantidad_cuotas;

    detalles.push({
      id: generarUUID(),
      factura_id: facturaId,
      concepto: 'cuota_conexion',
      descripcion: `Cuota de conexión (cuota ${cuotaX} de ${totalY})`,
      monto: montoCuotaConexion,
    });
  }

  // -------------------------------------------------------------------------
  // f) Pérdida financiada
  // Buscar planes activos con tipo = 'perdida_financiada' y periodo_inicio <= periodo actual
  // NO incrementar cuotas_pagadas todavía
  // -------------------------------------------------------------------------
  const planPerdida = (params.planesFinanciamiento || []).find(
    (p) =>
      p.medidor_id === params.medidor.id &&
      p.tipo === 'perdida_financiada' &&
      p.estado === 'activo' &&
      p.periodo_inicio <= params.periodo &&
      p.cuotas_pagadas < p.cantidad_cuotas &&
      p.monto_cuota > 0
  );

  let montoPerdidaFinanciada = 0;
  if (planPerdida) {
    montoPerdidaFinanciada = planPerdida.monto_cuota;
    const cuotaX = planPerdida.cuotas_pagadas + 1;
    const totalY = planPerdida.cantidad_cuotas;

    detalles.push({
      id: generarUUID(),
      factura_id: facturaId,
      concepto: 'perdida_financiada',
      descripcion: `Pérdida financiada (cuota ${cuotaX} de ${totalY})`,
      monto: montoPerdidaFinanciada,
    });
  }

  // -------------------------------------------------------------------------
  // g) Reconexión
  // Incluye cargos pendientes diferidos de RECONEXIÓN del período o montoReconexion directo
  // -------------------------------------------------------------------------
  let montoReconexion = 0;
  for (const cargoRec of cargosReconexion) {
    montoReconexion += cargoRec.monto;
    cargosFacturadosIds.push(cargoRec.id);
    detalles.push({
      id: generarUUID(),
      factura_id: facturaId,
      concepto: 'reconexion',
      descripcion: cargoRec.descripcion,
      monto: cargoRec.monto,
      cargo_pendiente_id: cargoRec.id,
    });
  }

  const montoReconexionDirecto =
    params.montoReconexion && params.montoReconexion > 0 ? params.montoReconexion : 0;
  if (montoReconexionDirecto > 0) {
    montoReconexion += montoReconexionDirecto;
    detalles.push({
      id: generarUUID(),
      factura_id: facturaId,
      concepto: 'reconexion',
      descripcion: 'Reconexión',
      monto: montoReconexionDirecto,
    });
  }

  // -------------------------------------------------------------------------
  // h) ERSSAN 2%
  // Base ERSSAN = deuda_anterior + consumo_agua + mora + otros_trabajos + cuota_conexion + perdida_financiada + reconexion
  // erssan = Math.round(baseErssan * erssan_porcentaje / 100)
  // Solo incluir si erssan > 0
  // -------------------------------------------------------------------------
  const baseErssan =
    deudaAnteriorMonto +
    montoConsumo +
    montoMora +
    montoOtrosTrabajos +
    montoCuotaConexion +
    montoPerdidaFinanciada +
    montoReconexion;

  let montoErssan = 0;
  if (baseErssan > 0 && tarifa.erssan_porcentaje > 0) {
    montoErssan = Math.round((baseErssan * tarifa.erssan_porcentaje) / 100);
    if (montoErssan > 0) {
      detalles.push({
        id: generarUUID(),
        factura_id: facturaId,
        concepto: 'erssan',
        descripcion: `ERSSAN ${tarifa.erssan_porcentaje}%`,
        monto: montoErssan,
      });
    }
  }

  // Total de la factura (todos los conceptos incluidos + ERSSAN)
  const total = baseErssan + montoErssan;

  // -------------------------------------------------------------------------
  // 6. Alerta de consumo elevado
  // Al menos 3 meses de historial de lecturas confirmadas previas al consumo actual
  // -------------------------------------------------------------------------
  let alertaConsumoElevado = false;
  let textoAlertaConsumo: string | null = null;

  const lecturaIdActual = params.lecturaMes?.id;
  const periodoConsumoActual = params.lecturaMes?.periodo || params.periodo;

  const lecturasPrevias = (params.lecturasAnteriores || [])
    .filter(
      (l) =>
        l.medidor_id === params.medidor.id &&
        l.estado === 'confirmada' &&
        (!lecturaIdActual || l.id !== lecturaIdActual) &&
        l.periodo < periodoConsumoActual
    )
    .sort((a, b) => b.periodo.localeCompare(a.periodo) || b.fecha_lectura.localeCompare(a.fecha_lectura));

  if (consumoM3 > 0 && lecturasPrevias.length >= 3) {
    const ultimos3Consumos = lecturasPrevias.slice(0, 3).map((l) => l.consumo_m3);
    const suma = ultimos3Consumos.reduce((acc, c) => acc + c, 0);
    const promedio = suma / ultimos3Consumos.length;

    if (consumoM3 > tarifa.umbral_alerta_consumo * promedio) {
      alertaConsumoElevado = true;
      textoAlertaConsumo = tarifa.texto_alerta_consumo;
    }
  }

  // -------------------------------------------------------------------------
  // Factura construida
  // -------------------------------------------------------------------------
  const factura: Factura = {
    id: facturaId,
    medidor_id: params.medidor.id,
    cliente_id: params.clienteId,
    periodo_facturado: params.periodo,
    periodo_consumo: params.lecturaMes ? params.lecturaMes.periodo : null,
    lectura_id: params.lecturaMes ? params.lecturaMes.id : null,
    fecha_emision: fechaEmision,
    fecha_vencimiento: fechaVencimiento,
    estado: 'pendiente',
    total,
    saldo_pendiente: total,
    saldo: total,
    monto_pagado: 0,
    es_tercera_boleta: esTerceraBoleta,
    alerta_consumo_elevado: alertaConsumoElevado,
    texto_alerta_consumo: textoAlertaConsumo,
    numero_boleta_medidor: params.correlativoPorMedidor,
    numero_factura: params.numeroFactura || formatearNumeroFacturaSET(params.correlativoPorMedidor),
    detalles,
    lectura_anterior: lecturaAnterior,
    lectura_actual: lecturaActual,
    consumo_m3: consumoM3,
  };

  // -------------------------------------------------------------------------
  // 7. Actualización de estado del medidor
  // - Si tenía 2 o más vencidas/moras acumuladas y se factura la 3ra (esTerceraBoleta = true): 'pendiente_corte'
  // - Si tenía 1 vencida/mora acumulada: 'moroso'
  // - Si 0 vencidas/moras: 'activo'
  // -------------------------------------------------------------------------
  let nuevoEstadoMedidor: EstadoMedidor = params.medidor.estado;
  if (params.medidor.estado !== 'cortado' && params.medidor.estado !== 'retirado') {
    if (esTerceraBoleta || cantVencidasImpagas >= 3 || cantMorasAcumuladas >= 3) {
      nuevoEstadoMedidor = 'pendiente_corte';
    } else if (cantVencidasImpagas >= 1 || cantMorasAcumuladas >= 1) {
      nuevoEstadoMedidor = 'moroso';
    } else {
      nuevoEstadoMedidor = 'activo';
    }
  }

  return {
    factura,
    detalles,
    cargosFacturadosIds,
    nuevoEstadoMedidor,
    facturaAnteriorARefinanciar,
  };
}
