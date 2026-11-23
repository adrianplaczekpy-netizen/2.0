/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularFacturaIndividual,
  calcularFechaVencimiento,
  get_tarifa_vigente_param,
  ResumenFacturacionMensual,
} from './billingEngine';
import { TARIFAS_DEFAULT, calcularConsumoAgua, calcularMoraMedidor } from './billingRules';
import { Medidor, Factura, CargoPendiente, PlanFinanciamiento, Lectura, TarifaConfig } from '../types';
import { db } from './database';

const medidorBase: Medidor = {
  id: 'med-test-01',
  cliente_id: 'cli-test-01',
  numero_medidor: 101,
  fecha_instalacion: '2024-01-01',
  direccion: 'Av. Defensores del Chaco 1234',
  zona: 'Centro',
  latitud: -25.34,
  longitud: -57.51,
  estado: 'activo',
  fecha_corte: null,
  mora_congelada: null,
};

test('1. Consumo 5 m³ → cobra 36.000 (mínimo)', () => {
  // Fórmula: consumo_m3 = 5 <= consumo_minimo_m3 (9) -> max(5 * 4.000, 36.000) = 36.000 Gs.
  const calc = calcularConsumoAgua(5, TARIFAS_DEFAULT);
  assert.equal(calc.consumoM3, 5);
  assert.equal(calc.montoAgua, 36000);
  assert.equal(calc.aplicoMinimo, true);

  // Verificación en factura individual completa
  const res = calcularFacturaIndividual({
    medidor: medidorBase,
    clienteId: 'cli-test-01',
    periodo: '2026-11',
    lecturaMes: {
      id: 'lec-1',
      medidor_id: medidorBase.id,
      periodo: '2026-11',
      fecha_lectura: '2026-11-20',
      lectura_actual: 105,
      lectura_anterior: 100, // 5 m3
      consumo_m3: 5,
      foto_medidor_url: '',
      estado: 'confirmada',
      registrado_por: 'user-1',
      fecha_registro: '2026-11-20',
    },
    facturasImpagasAnteriores: [],
    cargosPendientes: [],
    planesFinanciamiento: [],
    correlativoPorMedidor: 1,
  });

  const detalleAgua = res.detalles.find((d) => d.concepto === 'consumo_agua');
  assert.ok(detalleAgua, 'Debe incluir concepto consumo_agua');
  assert.equal(detalleAgua?.monto, 36000);
  assert.equal(detalleAgua?.descripcion, 'Consumo de agua (mínimo 9 m³)');
});

test('2. Consumo 12 m³ → cobra 48.000', () => {
  // Fórmula: consumo_m3 = 12 > consumo_minimo_m3 (9) -> 12 * 4.000 = 48.000 Gs.
  const calc = calcularConsumoAgua(12, TARIFAS_DEFAULT);
  assert.equal(calc.consumoM3, 12);
  assert.equal(calc.montoAgua, 48000);
  assert.equal(calc.aplicoMinimo, false);

  const res = calcularFacturaIndividual({
    medidor: medidorBase,
    clienteId: 'cli-test-01',
    periodo: '2026-11',
    lecturaMes: {
      id: 'lec-2',
      medidor_id: medidorBase.id,
      periodo: '2026-11',
      fecha_lectura: '2026-11-20',
      lectura_actual: 112,
      lectura_anterior: 100, // 12 m3
      consumo_m3: 12,
      foto_medidor_url: '',
      estado: 'confirmada',
      registrado_por: 'user-1',
      fecha_registro: '2026-11-20',
    },
    facturasImpagasAnteriores: [],
    cargosPendientes: [],
    planesFinanciamiento: [],
    correlativoPorMedidor: 2,
  });

  const detalleAgua = res.detalles.find((d) => d.concepto === 'consumo_agua');
  assert.ok(detalleAgua, 'Debe incluir concepto consumo_agua');
  assert.equal(detalleAgua?.monto, 48000);
  assert.equal(detalleAgua?.descripcion, 'Consumo de agua (12 m³)');
});

test('3. Mora de 1 boleta vencida → 3.000', () => {
  const facVencida1: Factura = {
    id: 'fac-v-1',
    medidor_id: medidorBase.id,
    cliente_id: 'cli-test-01',
    periodo_facturado: '2026-10',
    fecha_emision: '2026-10-01',
    fecha_vencimiento: '2026-10-31',
    estado: 'vencida',
    total: 36720,
    saldo: 36720,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
  };

  const moraCalc = calcularMoraMedidor([facVencida1], 3000, new Date('2026-11-05'));
  assert.equal(moraCalc.cantidadVencidas, 1);
  assert.equal(moraCalc.moraTotal, 3000);

  const res = calcularFacturaIndividual({
    medidor: medidorBase,
    clienteId: 'cli-test-01',
    periodo: '2026-11',
    lecturaMes: {
      id: 'lec-3',
      medidor_id: medidorBase.id,
      periodo: '2026-11',
      fecha_lectura: '2026-11-20',
      lectura_actual: 100,
      lectura_anterior: 100,
      consumo_m3: 0,
      foto_medidor_url: '',
      estado: 'confirmada',
      registrado_por: 'user-1',
      fecha_registro: '2026-11-20',
    },
    facturasImpagasAnteriores: [facVencida1],
    cargosPendientes: [],
    planesFinanciamiento: [],
    correlativoPorMedidor: 2,
    fechaReferencia: new Date('2026-11-05'),
  });

  const detalleMora = res.detalles.find((d) => d.concepto === 'mora');
  assert.ok(detalleMora, 'Debe incluir concepto mora');
  assert.equal(detalleMora?.monto, 3000);
  assert.equal(detalleMora?.descripcion, 'Recargo por mora (1 boleta × 3.000)');
});

test('4. Mora acumulada de 3 boletas vencidas (N-1 con mora=6.000 + nueva 3.000) → 9.000', () => {
  const facVencida1: Factura = {
    id: 'fac-v-1',
    medidor_id: medidorBase.id,
    cliente_id: 'cli-test-01',
    periodo_facturado: '2026-08',
    fecha_emision: '2026-08-01',
    fecha_vencimiento: '2026-08-31',
    estado: 'refinanciada',
    total: 36720,
    saldo_pendiente: 0,
    saldo: 0,
    motivo: 'Consolidada en factura 2026-09',
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
  };

  const facVencida2: Factura = {
    ...facVencida1,
    id: 'fac-v-2',
    periodo_facturado: '2026-09',
    fecha_vencimiento: '2026-09-30',
    motivo: 'Consolidada en factura 2026-10',
  };

  const facVencida3: Factura = {
    id: 'fac-v-3',
    medidor_id: medidorBase.id,
    cliente_id: 'cli-test-01',
    periodo_facturado: '2026-10',
    fecha_emision: '2026-10-01',
    fecha_vencimiento: '2026-10-11',
    estado: 'vencida',
    total: 118000,
    saldo_pendiente: 118000,
    saldo: 118000,
    es_tercera_boleta: true,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 3,
    detalles: [
      {
        id: 'd-v3-mora',
        factura_id: 'fac-v-3',
        concepto: 'mora',
        descripcion: 'Recargo por mora (2 boletas × 3.000)',
        monto: 6000,
      },
    ],
  };

  const res = calcularFacturaIndividual({
    medidor: medidorBase,
    clienteId: 'cli-test-01',
    periodo: '2026-11',
    lecturaMes: {
      id: 'lec-4',
      medidor_id: medidorBase.id,
      periodo: '2026-11',
      fecha_lectura: '2026-11-20',
      lectura_actual: 100,
      lectura_anterior: 100,
      consumo_m3: 0,
      foto_medidor_url: '',
      estado: 'confirmada',
      registrado_por: 'user-1',
      fecha_registro: '2026-11-20',
    },
    facturasImpagasAnteriores: [facVencida1, facVencida2, facVencida3],
    cargosPendientes: [],
    planesFinanciamiento: [],
    correlativoPorMedidor: 4,
    fechaReferencia: new Date('2026-11-05'),
  });

  const detalleMora = res.detalles.find((d) => d.concepto === 'mora');
  const detalleDeuda = res.detalles.find((d) => d.concepto === 'deuda_anterior');
  assert.ok(detalleMora, 'Debe incluir concepto mora');
  assert.equal(detalleMora?.monto, 9000);
  assert.equal(detalleMora?.descripcion, 'Recargo por mora (3 boletas × 3.000)');
  assert.equal(detalleDeuda?.monto, 112000, 'Debe restar la mora (6.000) de N-1 (118.000)');
});

test('5. 3ra boleta → fecha de vencimiento día 11', () => {
  // Medidor con 2 facturas vencidas impagas anteriores: la nueva emitida es la 3ra boleta
  const facV1: Factura = {
    id: 'fac-v-1',
    medidor_id: medidorBase.id,
    cliente_id: 'cli-test-01',
    periodo_facturado: '2026-09',
    fecha_emision: '2026-09-01',
    fecha_vencimiento: '2026-09-30',
    estado: 'vencida',
    total: 36720,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
  };

  const facV2: Factura = {
    ...facV1,
    id: 'fac-v-2',
    periodo_facturado: '2026-10',
    fecha_vencimiento: '2026-10-31',
  };

  const res = calcularFacturaIndividual({
    medidor: medidorBase,
    clienteId: 'cli-test-01',
    periodo: '2026-11',
    lecturaMes: {
      id: 'lec-5',
      medidor_id: medidorBase.id,
      periodo: '2026-11',
      fecha_lectura: '2026-11-20',
      lectura_actual: 100,
      lectura_anterior: 100,
      consumo_m3: 0,
      foto_medidor_url: '',
      estado: 'confirmada',
      registrado_por: 'user-1',
      fecha_registro: '2026-11-20',
    },
    facturasImpagasAnteriores: [facV1, facV2], // 2 vencidas previas
    cargosPendientes: [],
    planesFinanciamiento: [],
    correlativoPorMedidor: 3,
    fechaReferencia: new Date('2026-11-05'),
  });

  // Debe ser marcada como 3ra boleta
  assert.equal(res.factura.es_tercera_boleta, true);
  // Fecha de vencimiento debe ser exactamente el día 11 del mes del período (2026-11-11)
  assert.equal(res.factura.fecha_vencimiento, '2026-11-11');
});

test('6. ERSSAN 2% calculado sobre conceptos incluidos', () => {
  // Conceptos:
  // Agua: 36.000 Gs.
  // Deuda anterior: 40.000 Gs.
  // Mora: 3.000 Gs.
  // Otros trabajos: 20.000 Gs.
  // Cuota de conexión: 10.000 Gs.
  // Base imponible = 36.000 + 40.000 + 3.000 + 20.000 + 10.000 = 109.000 Gs.
  // ERSSAN 2% = round(109.000 * 0.02) = 2.180 Gs.
  // Total factura = 109.000 + 2.180 = 111.180 Gs.

  const cargo: CargoPendiente = {
    id: 'cg-10',
    medidor_id: medidorBase.id,
    cliente_id: 'cli-test-01',
    fecha_trabajo: '2026-11-02',
    descripcion: 'Cambio de junta',
    monto: 20000,
    periodo_facturacion: '2026-11',
    estado: 'pendiente',
    registrado_por: 'admin',
    fecha_registro: '2026-11-02',
  };

  const plan: PlanFinanciamiento = {
    id: 'plan-1',
    medidor_id: medidorBase.id,
    cliente_id: 'cli-test-01',
    tipo: 'cuota_conexion',
    monto_total: 60000,
    cantidad_cuotas: 6,
    monto_cuota: 10000,
    periodo_inicio: '2026-10',
    cuotas_pagadas: 1,
    estado: 'activo',
    registrado_por: 'admin',
    fecha_registro: '2026-10-01',
  };

  const facPrevia: Factura = {
    id: 'fac-p-1',
    medidor_id: medidorBase.id,
    cliente_id: 'cli-test-01',
    periodo_facturado: '2026-10',
    fecha_emision: '2026-10-01',
    fecha_vencimiento: '2026-10-31',
    estado: 'vencida',
    total: 40000,
    saldo: 40000,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
  };

  const res = calcularFacturaIndividual({
    medidor: medidorBase,
    clienteId: 'cli-test-01',
    periodo: '2026-11',
    lecturaMes: {
      id: 'lec-6',
      medidor_id: medidorBase.id,
      periodo: '2026-11',
      fecha_lectura: '2026-11-20',
      lectura_actual: 100,
      lectura_anterior: 100, // 0 m3 -> minimo 36.000
      consumo_m3: 0,
      foto_medidor_url: '',
      estado: 'confirmada',
      registrado_por: 'user-1',
      fecha_registro: '2026-11-20',
    },
    facturasImpagasAnteriores: [facPrevia],
    cargosPendientes: [cargo],
    planesFinanciamiento: [plan],
    correlativoPorMedidor: 2,
    fechaReferencia: new Date('2026-11-05'),
  });

  const detalleErssan = res.detalles.find((d) => d.concepto === 'erssan');
  assert.ok(detalleErssan, 'Debe incluir concepto ERSSAN');
  assert.equal(detalleErssan?.monto, 2180);
  assert.equal(detalleErssan?.descripcion, 'ERSSAN 2%');
  assert.equal(res.factura.total, 111180);
});

test('7. Conceptos con monto 0 no se incluyen en detalles', () => {
  // Medidor sin deuda anterior, sin mora, sin cargos, sin planes, sin reconexión
  // Solo tiene consumo mínimo (36.000) y ERSSAN 2% (720)
  const res = calcularFacturaIndividual({
    medidor: medidorBase,
    clienteId: 'cli-test-01',
    periodo: '2026-11',
    lecturaMes: {
      id: 'lec-7',
      medidor_id: medidorBase.id,
      periodo: '2026-11',
      fecha_lectura: '2026-11-20',
      lectura_actual: 100,
      lectura_anterior: 100,
      consumo_m3: 0,
      foto_medidor_url: '',
      estado: 'confirmada',
      registrado_por: 'user-1',
      fecha_registro: '2026-11-20',
    },
    facturasImpagasAnteriores: [],
    cargosPendientes: [],
    planesFinanciamiento: [],
    correlativoPorMedidor: 1,
  });

  // Verificar que NINGÚN concepto con monto 0 existe en detalles
  for (const det of res.detalles) {
    assert.ok(det.monto > 0, `El concepto ${det.concepto} tiene monto <= 0`);
  }

  // Verificar conceptos ausentes porque eran 0
  assert.equal(res.detalles.some((d) => d.concepto === 'deuda_anterior'), false);
  assert.equal(res.detalles.some((d) => d.concepto === 'mora'), false);
  assert.equal(res.detalles.some((d) => d.concepto === 'otros_trabajos'), false);
  assert.equal(res.detalles.some((d) => d.concepto === 'cuota_conexion'), false);
  assert.equal(res.detalles.some((d) => d.concepto === 'perdida_financiada'), false);
  assert.equal(res.detalles.some((d) => d.concepto === 'reconexion'), false);

  // Solo consumo_agua (36.000) y erssan (720)
  assert.equal(res.detalles.length, 2);
});

test('8. Cargo pendiente del período se incluye y pasa a "facturado"', () => {
  // Limpiar/sembrar datos en db
  db.loadTestData();

  const medidor = db.getMedidores().medidores[0];
  assert.ok(medidor);

  // Agregar un cargo pendiente para el período 2027-01
  const nuevoCargo = db.agregarCargoPendiente({
    medidor_id: medidor.id,
    cliente_id: medidor.cliente_id,
    fecha_trabajo: '2027-01-05',
    descripcion: 'Reparación de válvula esférica 1/2',
    monto: 45000,
    periodo_facturacion: '2027-01',
    registrado_por: 'admin',
  });

  assert.equal(nuevoCargo.estado, 'pendiente');
  assert.equal(nuevoCargo.factura_id ?? null, null);

  // Registrar lectura confirmada para 2027-01
  const ultLec = db.getLecturas({ medidorId: medidor.id, limit: 1 }).lecturas[0];
  const lecturaNueva = (ultLec?.lectura_actual || 100) + 10;

  db.registrarLectura({
    numeroMedidor: medidor.numero_medidor,
    lecturaActual: lecturaNueva,
    fechaLectura: '2027-01-25',
    fotoUrl: 'https://example.com/foto.jpg',
    registradoPor: 'Lector',
    estado: 'confirmada',
  });

  // Ejecutar facturación mensual
  const resumen = db.ejecutarFacturacionMensual('2027-01');
  assert.ok(resumen.totalGeneradas > 0);

  // Buscar el cargo en la base de datos
  const cargoActualizado = db.getCargos({ medidorId: medidor.id }).cargos.find((c) => c.id === nuevoCargo.id);
  assert.ok(cargoActualizado);
  assert.equal(cargoActualizado?.estado, 'facturado');
  assert.ok(cargoActualizado?.factura_id, 'Debe tener factura_id asignada');

  // Verificar que la factura del período contiene el cargo
  const fac = db.getFacturaPorId(cargoActualizado!.factura_id!);
  assert.ok(fac);
  const detCargo = fac.factura.detalles?.find((d) => d.cargo_pendiente_id === nuevoCargo.id);
  assert.ok(detCargo);
  assert.equal(detCargo?.monto, 45000);
  assert.equal(detCargo?.descripcion, 'Reparación de válvula esférica 1/2');
});

test('9. Plan de cuota de conexión se incluye si está activo (y no se incrementa cuotas_pagadas hasta el pago)', () => {
  db.loadTestData();

  const medidor = db.getMedidores().medidores[1];
  assert.ok(medidor);

  const plan = db.agregarPlanFinanciamiento({
    medidor_id: medidor.id,
    cliente_id: medidor.cliente_id,
    tipo: 'cuota_conexion',
    descripcion: 'Financiamiento acometida nueva',
    monto_total: 120000,
    cantidad_cuotas: 4,
    monto_cuota: 30000,
    periodo_inicio: '2027-02',
    registrado_por: 'admin',
  });

  assert.equal(plan.estado, 'activo');
  assert.equal(plan.cuotas_pagadas, 0);

  // Lectura para 2027-02 respetando que sea >= lectura_anterior
  const ultLec = db.getLecturas({ medidorId: medidor.id, limit: 1 }).lecturas[0];
  const lecturaNueva = (ultLec?.lectura_actual || 200) + 15;

  db.registrarLectura({
    numeroMedidor: medidor.numero_medidor,
    lecturaActual: lecturaNueva,
    fechaLectura: '2027-02-25',
    fotoUrl: 'https://example.com/foto.jpg',
    registradoPor: 'Lector',
    estado: 'confirmada',
  });

  // Ejecutar facturación
  const res = db.ejecutarFacturacionMensual('2027-02');
  assert.ok(res.totalGeneradas > 0);

  const fac = res.facturasGeneradas.find((f) => f.medidor_id === medidor.id);
  assert.ok(fac, 'Factura debe haberse generado');

  const detPlan = fac?.detalles?.find((d) => d.concepto === 'cuota_conexion');
  assert.ok(detPlan, 'Debe incluir concepto cuota_conexion');
  assert.equal(detPlan?.monto, 30000);
  assert.equal(detPlan?.descripcion, 'Cuota de conexión (cuota 1 de 4)');

  // Regla crítica: Las cuotas_pagadas NO aumentan al emitir la factura
  assert.equal(plan.cuotas_pagadas, 0);

  // Pagar la factura
  db.registrarCobro({
    facturaId: fac!.id,
    monto: fac!.total,
    metodoPago: 'efectivo',
  });

  // Al pagar la factura, ahora sí aumentan las cuotas pagadas
  assert.equal(plan.cuotas_pagadas, 1);
  assert.equal(plan.estado, 'activo');
});

test('10. Medidor cortado no recibe factura mensual', () => {
  db.loadTestData();

  // Tomar un medidor y cortarlo a través de db.actualizarMedidor
  const medidores = db.getMedidores().medidores;
  const medidorTarget = medidores.find((m) => m.estado === 'activo') || medidores[0];

  db.actualizarMedidor(medidorTarget.id, {
    estado: 'cortado',
    fecha_corte: '2027-02-01',
    mora_congelada: 6000,
  });

  // Registrar lectura para 2027-03
  const ultLec = db.getLecturas({ medidorId: medidorTarget.id, limit: 1 }).lecturas[0];
  const lecturaNueva = (ultLec?.lectura_actual || 100) + 10;

  db.registrarLectura({
    numeroMedidor: medidorTarget.numero_medidor,
    lecturaActual: lecturaNueva,
    fechaLectura: '2027-03-25',
    fotoUrl: 'https://example.com/foto.jpg',
    registradoPor: 'Lector',
    estado: 'confirmada',
  });

  // Ejecutar facturación del período 2027-03
  const resumen = db.ejecutarFacturacionMensual('2027-03');

  // El medidor cortado no debe tener ninguna factura generada en 2027-03
  const facturaCortado = resumen.facturasGeneradas.find((f) => f.medidor_id === medidorTarget.id);
  assert.equal(facturaCortado, undefined, 'Medidor cortado NO debe recibir factura');

  // Debe aparecer explícitamente en la lista de omitidos con motivo 'cortado'
  const omitido = resumen.medidoresOmitidos.find((o) => o.medidor_id === medidorTarget.id);
  assert.ok(omitido, 'El medidor cortado debe reportarse como omitido en el resumen');
  assert.equal(omitido?.motivo, 'cortado');
});

test('11. Integración completa 7 conceptos: Base=266.000 (deuda N-1 sin mora=40.000, mora=6.000), ERSSAN=5.320, Total=271.320', () => {
  // Escenario exacto completo con consolidación y separación de mora en N-1:
  // 1) consumo 15 m³ (15 * 4.000 = 60.000)
  // 2) deuda anterior = saldo_pendiente_N-1 (43.000) - mora_N-1 (3.000) = 40.000
  // 3) mora = mora_N-1 (3.000) + mora nueva N-1 vencida (3.000) = 6.000
  // 4) otros trabajos (35.000)
  // 5) cuota conexión (40.000)
  // 6) pérdida financiada (25.000)
  // 7) reconexión (60.000)
  // Base = 60.000 + 40.000 + 6.000 + 35.000 + 40.000 + 25.000 + 60.000 = 266.000
  // ERSSAN 2% = 5.320
  // Total = 271.320
  const medidorEscenario: Medidor = {
    ...medidorBase,
    id: 'med-int-07',
    numero_medidor: 77,
    estado: 'moroso',
  };

  const facVencida1: Factura = {
    id: 'fac-int-1',
    medidor_id: medidorEscenario.id,
    cliente_id: 'cli-test-01',
    periodo_facturado: '2026-09',
    fecha_emision: '2026-09-01',
    fecha_vencimiento: '2026-09-30',
    estado: 'refinanciada',
    total: 45000,
    saldo_pendiente: 0,
    saldo: 0,
    motivo: 'Consolidada en factura 2026-10',
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
  };

  const facVencida2: Factura = {
    id: 'fac-int-2',
    medidor_id: medidorEscenario.id,
    cliente_id: 'cli-test-01',
    periodo_facturado: '2026-10',
    fecha_emision: '2026-10-01',
    fecha_vencimiento: '2026-10-31',
    estado: 'vencida',
    total: 43000,
    saldo_pendiente: 43000,
    saldo: 43000,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 2,
    detalles: [
      {
        id: 'd-int-2-mora',
        factura_id: 'fac-int-2',
        concepto: 'mora',
        descripcion: 'Recargo por mora (1 boleta × 3.000)',
        monto: 3000,
      },
    ],
  };

  const cargoOtros: CargoPendiente = {
    id: 'cg-int-35k',
    medidor_id: medidorEscenario.id,
    cliente_id: 'cli-test-01',
    fecha_trabajo: '2026-10-20',
    descripcion: 'Cambio de llave maestra',
    monto: 35000,
    periodo_facturacion: '2026-11',
    estado: 'pendiente',
    registrado_por: 'admin',
    fecha_registro: '2026-10-20',
  };

  const planConexion: PlanFinanciamiento = {
    id: 'plan-int-con',
    medidor_id: medidorEscenario.id,
    cliente_id: 'cli-test-01',
    tipo: 'cuota_conexion',
    monto_total: 240000,
    cantidad_cuotas: 6,
    monto_cuota: 40000,
    periodo_inicio: '2026-09',
    cuotas_pagadas: 2,
    estado: 'activo',
    registrado_por: 'admin',
    fecha_registro: '2026-09-01',
  };

  const planPerdida: PlanFinanciamiento = {
    id: 'plan-int-perd',
    medidor_id: medidorEscenario.id,
    cliente_id: 'cli-test-01',
    tipo: 'perdida_financiada',
    monto_total: 100000,
    cantidad_cuotas: 4,
    monto_cuota: 25000,
    periodo_inicio: '2026-10',
    cuotas_pagadas: 1,
    estado: 'activo',
    registrado_por: 'admin',
    fecha_registro: '2026-10-01',
  };

  const res = calcularFacturaIndividual({
    medidor: medidorEscenario,
    clienteId: 'cli-test-01',
    periodo: '2026-11',
    lecturaMes: {
      id: 'lec-int-15',
      medidor_id: medidorEscenario.id,
      periodo: '2026-11',
      fecha_lectura: '2026-10-28',
      lectura_anterior: 120,
      lectura_actual: 135, // 15 m³
      consumo_m3: 15,
      foto_medidor_url: 'https://example.com/med77.jpg',
      estado: 'confirmada',
      registrado_por: 'lector-1',
      fecha_registro: '2026-10-28',
    },
    lecturasAnteriores: [],
    facturasImpagasAnteriores: [facVencida1, facVencida2],
    cargosPendientes: [cargoOtros],
    planesFinanciamiento: [planConexion, planPerdida],
    montoReconexion: 60000,
    correlativoPorMedidor: 3,
    fechaReferencia: new Date('2026-11-01'),
    fechaEmision: '2026-11-01',
  });

  const detDeuda = res.detalles.find((d) => d.concepto === 'deuda_anterior');
  const detMora = res.detalles.find((d) => d.concepto === 'mora');
  const baseSinErssan = res.detalles
    .filter((d) => d.concepto !== 'erssan')
    .reduce((acc, d) => acc + d.monto, 0);
  const erssan = res.detalles.find((d) => d.concepto === 'erssan')?.monto ?? 0;
  const sumaDetalles = res.detalles.reduce((acc, d) => acc + d.monto, 0);

  assert.equal(detDeuda?.monto, 40000, 'La deuda anterior debe ser exclusivamente la de N-1 (2026-10 = 40.000)');
  assert.equal(detMora?.monto, 6000, 'La mora debe mantenerse en 3.000 x 2 boletas vencidas = 6.000');
  assert.equal(baseSinErssan, 266000, 'La base imponible (conceptos 1-7) debe ser exactamente 266.000');
  assert.equal(erssan, 5320, 'ERSSAN 2% sobre 266.000 debe ser exactamente 5.320');
  assert.equal(res.factura.total, 271320, 'El total de la factura debe ser exactamente 271.320');
  assert.equal(sumaDetalles, 271320, 'La suma de los 8 detalles debe cuadrar exactamente en 271.320');
  assert.equal(res.detalles.length, 8, 'Deben existir exactamente 8 conceptos en detalle_factura');
  assert.equal(res.factura.numero_boleta_medidor, 3);
  assert.equal(res.factura.es_tercera_boleta, true);
  assert.equal(res.factura.fecha_vencimiento, '2026-11-11');
  assert.equal(res.nuevoEstadoMedidor, 'pendiente_corte');
});

test('12. Anular factura revierte cargo_pendiente asociado a estado "pendiente" y factura_id = null', () => {
  db.loadTestData();

  const medidor = db.getMedidores().medidores.find((m) => m.estado === 'activo')!;
  assert.ok(medidor);

  const cargo = db.agregarCargoPendiente({
    medidor_id: medidor.id,
    cliente_id: medidor.cliente_id,
    fecha_trabajo: '2027-04-05',
    descripcion: 'Instalación de caja protectora',
    monto: 55000,
    periodo_facturacion: '2027-04',
    registrado_por: 'admin',
  });

  const ultLec = db.getLecturas({ medidorId: medidor.id, limit: 1 }).lecturas[0];
  db.registrarLectura({
    numeroMedidor: medidor.numero_medidor,
    lecturaActual: (ultLec?.lectura_actual || 100) + 10,
    fechaLectura: '2027-04-20',
    fotoUrl: 'https://example.com/foto-anular.jpg',
    registradoPor: 'Lector',
    estado: 'confirmada',
  });

  const resumen1 = db.ejecutarFacturacionMensual('2027-04');
  const fac = resumen1.facturasGeneradas.find((f) => f.medidor_id === medidor.id)!;
  assert.ok(fac);

  // Confirmar que pasó a facturado antes de anular
  const cargoFacturado = db.getCargos({ medidorId: medidor.id }).cargos.find((c) => c.id === cargo.id);
  assert.equal(cargoFacturado?.estado, 'facturado');
  assert.equal(cargoFacturado?.factura_id, fac.id);

  // Anular factura emitida por error
  const anulacion = db.anularFactura(fac.id, 'Lectura tomada en medidor incorrecto');
  assert.equal(anulacion.factura.estado, 'anulada');
  assert.equal(anulacion.factura.saldo_pendiente, 0);
  assert.ok(anulacion.cargosRevertidosIds.includes(cargo.id));

  // Verificar que el cargo volvió a 'pendiente' y factura_id = null
  const cargoRevertido = db.getCargos({ medidorId: medidor.id }).cargos.find((c) => c.id === cargo.id);
  assert.equal(cargoRevertido?.estado, 'pendiente');
  assert.equal(cargoRevertido?.factura_id, null);

  // Al refacturar el mismo período, el cargo revertido vuelve a incluirse y el correlativo es MAX + 1
  const maxCorrelativoAntes = fac.numero_boleta_medidor ?? 0;
  assert.ok(maxCorrelativoAntes > 0);
  const resumen2 = db.ejecutarFacturacionMensual('2027-04');
  const facRefacturada = resumen2.facturasGeneradas.find((f) => f.medidor_id === medidor.id)!;
  assert.ok(facRefacturada, 'Debe poder refacturarse tras anular la factura errónea');
  assert.equal(facRefacturada.numero_boleta_medidor, maxCorrelativoAntes + 1, 'El correlativo debe seguir MAX + 1');
  assert.ok(
    facRefacturada.detalles?.some((d) => d.cargo_pendiente_id === cargo.id),
    'El cargo revertido debe volver a incluirse en la nueva factura'
  );
});

test('13. Transición de estado de medidor: 2 vencidas → 3ra boleta consolida N-1 y pasa a pendiente_corte → al pagar vuelve a moroso o activo', () => {
  db.loadTestData();

  const medidor = db.getMedidores().medidores.find((m) => m.estado === 'activo')!;
  assert.ok(medidor);

  // Dejar un escenario limpio para este medidor con 2 boletas vencidas impagas (con mora en N-1)
  const data = db.getFullData();
  data.facturas = data.facturas.filter((f) => f.medidor_id !== medidor.id);
  data.lecturas = data.lecturas.filter((l) => l.medidor_id !== medidor.id);

  const facV1: Factura = {
    id: 'fac-tr-1',
    medidor_id: medidor.id,
    cliente_id: medidor.cliente_id,
    periodo_facturado: '2027-05',
    fecha_emision: '2027-05-01',
    fecha_vencimiento: '2027-05-31',
    estado: 'vencida',
    total: 36720,
    saldo_pendiente: 36720,
    saldo: 36720,
    monto_pagado: 0,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 10,
  };
  const facV2: Factura = {
    id: 'fac-tr-2',
    medidor_id: medidor.id,
    cliente_id: medidor.cliente_id,
    periodo_facturado: '2027-06',
    fecha_emision: '2027-06-01',
    fecha_vencimiento: '2027-06-30',
    estado: 'vencida',
    total: 77234,
    saldo_pendiente: 77234,
    saldo: 77234,
    monto_pagado: 0,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 11,
    detalles: [
      {
        id: 'd-tr-2-mora',
        factura_id: 'fac-tr-2',
        concepto: 'mora',
        descripcion: 'Recargo por mora (1 boleta × 3.000)',
        monto: 3000,
      },
    ],
  };

  data.facturas.push(facV1, facV2);
  db.actualizarMedidor(medidor.id, { estado: 'moroso' });

  // Registrar lectura confirmada para 2027-07 (se facturará la 3ra boleta consolidada)
  db.registrarLectura({
    numeroMedidor: medidor.numero_medidor,
    lecturaActual: 150,
    fechaLectura: '2027-07-01',
    fotoUrl: 'https://example.com/foto-tr.jpg',
    registradoPor: 'Lector',
    estado: 'confirmada',
  });

  const resumen = db.ejecutarFacturacionMensual('2027-07', '2027-07-01');
  const fac3 = resumen.facturasGeneradas.find((f) => f.medidor_id === medidor.id)!;
  assert.ok(fac3, 'Debe generarse la 3ra factura');
  assert.equal(fac3.es_tercera_boleta, true);
  assert.equal(fac3.fecha_vencimiento, '2027-07-11');
  assert.equal(fac3.numero_boleta_medidor, 12, 'Debe respetar correlativo MAX(11) + 1 = 12');

  // N-1 (facV2) pasó a 'refinanciada' con saldo 0 al consolidarse en fac3
  assert.equal(facV2.estado, 'refinanciada');
  assert.equal(facV2.saldo_pendiente, 0);
  assert.equal(facV2.motivo, 'Consolidada en factura 2027-07');

  // No debe permitirse cobrar directamente una factura refinanciada
  assert.throws(
    () =>
      db.registrarCobro({
        facturaId: facV2.id,
        monto: 1000,
        metodoPago: 'efectivo',
      }),
    /refinanciada/i
  );

  // El medidor debe haber pasado automáticamente a 'pendiente_corte'
  const medLuegoFacturar = db.getMedidores().medidores.find((m) => m.id === medidor.id)!;
  assert.equal(
    medLuegoFacturar.estado,
    'pendiente_corte',
    'Medidor con 2 boletas acumuladas debe pasar a pendiente_corte al facturar la 3ra boleta'
  );

  // Caso A: Si paga la boleta consolidada (fac3), queda solamente facV1 vencida → baja a 'moroso'
  const cobro3 = db.registrarCobro({
    facturaId: fac3.id,
    monto: fac3.total,
    metodoPago: 'efectivo',
  });
  assert.equal(fac3.estado, 'pagada');
  assert.equal(facV2.estado, 'refinanciada', 'facV2 debe seguir refinanciada con saldo 0');
  assert.equal(cobro3.estadoMedidorActualizado, 'moroso');

  // Caso B: Al pagar también facV1, ya no quedan facturas impagas → pasa a 'activo'
  const cobro1 = db.registrarCobro({
    facturaId: facV1.id,
    monto: facV1.total,
    metodoPago: 'efectivo',
  });
  assert.equal(
    cobro1.estadoMedidorActualizado,
    'activo',
    'Al pagar todas las facturas activas impagas, el medidor debe volver automáticamente a activo'
  );
  assert.equal(cobro1.medidorPasoAActivo, true);
});

test('14. Tarifas: getTarifasVigentes respeta vigencia y orden independiente de DESC/ASC, y facturación usa tarifa de fechaEmision', () => {
  db.loadTestData();
  const data = db.getFullData();
  const tarifasOrig = [...data.tarifas];

  try {
    // Simular array cargado en orden DESC desde Supabase + tarifa futura 2099
    const t2024: TarifaConfig = { ...TARIFAS_DEFAULT, id: 't-2024', precio_m3: 3500, vigente_desde: '2024-01-01', fecha_creacion: '2024-01-01T00:00:00Z' };
    const t2025: TarifaConfig = { ...TARIFAS_DEFAULT, id: 't-2025', precio_m3: 4000, vigente_desde: '2025-06-01', fecha_creacion: '2025-06-01T00:00:00Z' };
    const tFutura: TarifaConfig = { ...TARIFAS_DEFAULT, id: 't-2099', precio_m3: 5500, vigente_desde: '2099-01-01', fecha_creacion: '2026-11-01T00:00:00Z' };

    data.tarifas = [tFutura, t2025, t2024];

    assert.equal(db.getTarifasVigentes().id, 't-2025', 'Debe elegir la tarifa vigente hoy más reciente');
    assert.equal(db.getTarifasVigentes().precio_m3, 4000);
    assert.equal(db.getTarifaParaFecha('2024-08-01').id, 't-2024');
    assert.equal(db.getTarifaParaFecha('2099-02-01').precio_m3, 5500);
    assert.equal(db.getHistorialTarifas()[0].id, 't-2099');
    assert.equal(db.getHistorialTarifas()[2].id, 't-2024');
  } finally {
    data.tarifas = tarifasOrig;
  }
});

test('15. Backend UI readiness: ejecutarFacturacionMensual valida formato YYYY-MM y ejecutarFacturacionMensualAsync resuelve ResumenFacturacionMensual', async () => {
  db.loadTestData();

  assert.throws(
    () => db.ejecutarFacturacionMensual('2026-13'),
    /formato válido YYYY-MM/
  );
  assert.throws(
    () => db.ejecutarFacturacionMensual(''),
    /formato válido YYYY-MM/
  );

  const medidor = db.getMedidores().medidores.find((m) => m.estado === 'activo')!;
  const ultLec = db.getLecturas({ medidorId: medidor.id, limit: 1 }).lecturas[0];
  db.registrarLectura({
    numeroMedidor: medidor.numero_medidor,
    lecturaActual: (ultLec?.lectura_actual || 100) + 12,
    fechaLectura: '2027-08-20',
    fotoUrl: 'https://example.com/foto-async.jpg',
    registradoPor: 'Lector',
    estado: 'confirmada',
  });

  const resumen = await db.ejecutarFacturacionMensualAsync('2027-08', '2027-08-01');
  assert.equal(resumen.periodo, '2027-08');
  assert.ok(resumen.totalGeneradas > 0);
  assert.ok(resumen.facturasGeneradas.some((f) => f.medidor_id === medidor.id));
});

test('16. Opción B: lectura de "2026-10" → facturar "2026-11" genera factura con periodo_consumo "2026-10" y periodo_facturado "2026-11", ignorando facturas anuladas', async () => {
  db.clearData();

  const cli = db.agregarCliente({
    nombre_completo: 'María González',
    documento: '4567890',
    direccion: 'Av. San José 100',
    telefono: '0981111222',
    email: 'maria@example.com',
  });

  const medidores = [1, 2, 3, 4].map((num) =>
    db.agregarMedidor({
      cliente_id: cli.id,
      numero_medidor: num,
      fecha_instalacion: '2026-01-01',
      direccion: `Lote ${num}`,
      zona: 'Centro',
      latitud: -25.34,
      longitud: -57.51,
      estado: 'activo',
    })
  );

  // Registrar 4 lecturas confirmadas en octubre (2026-10)
  const lecturasOct = medidores.map((med, idx) =>
    db.registrarLectura({
      numeroMedidor: med.numero_medidor,
      lecturaActual: 100 + (idx + 1) * 10,
      fechaLectura: '2026-10-25',
      fotoUrl: `https://example.com/oct-${med.numero_medidor}.jpg`,
      registradoPor: 'Lector',
      estado: 'confirmada',
    }).lectura
  );

  // Simular 4 facturas viejas ANULADAS (tanto vinculadas a 2026-11 como a las lecturas de 2026-10)
  const data = db.getFullData();
  medidores.forEach((med, idx) => {
    data.facturas.push({
      id: `fac-anulada-${idx + 1}`,
      medidor_id: med.id,
      cliente_id: cli.id,
      periodo_facturado: '2026-11',
      periodo_consumo: '2026-10',
      lectura_id: lecturasOct[idx].id,
      fecha_emision: '2026-11-01',
      fecha_vencimiento: '2026-11-30',
      estado: 'anulada',
      total: 40800,
      saldo_pendiente: 0,
      saldo: 0,
      es_tercera_boleta: false,
      alerta_consumo_elevado: false,
      numero_boleta_medidor: 1,
      motivo_anulacion: 'Regeneración con Opción B',
    });
  });

  // Facturar 2026-11: debe ignorar las 4 facturas anuladas y regenerar las 4 facturas usando lecturas 2026-10
  const resumen = await db.ejecutarFacturacionMensualAsync('2026-11');

  assert.equal(resumen.totalGeneradas, 4, 'Debe regenerar las 4 facturas de los 4 medidores');
  assert.equal(resumen.totalOmitidos, 0);
  assert.equal(resumen.periodo, '2026-11');

  resumen.facturasGeneradas.forEach((fac, idx) => {
    assert.equal(fac.periodo_consumo, '2026-10');
    assert.equal(fac.periodo_facturado, '2026-11');
    assert.equal(fac.lectura_id, lecturasOct[idx].id);
    assert.equal(fac.fecha_emision, '2026-11-01');
    assert.equal(fac.fecha_vencimiento, '2026-11-30');
    assert.equal(fac.numero_boleta_medidor, 2, 'Debe respetar correlativo MAX(1)+1 = 2');
  });
});

test('17. Opción B: facturar "2026-11" dos veces → la segunda omite los medidores con motivo "ya_facturado" (no "sin_lectura_confirmada")', async () => {
  db.clearData();

  const cli = db.agregarCliente({
    nombre_completo: 'Carlos Benítez',
    documento: '3344556',
    direccion: 'Calle Palma 200',
    telefono: '0982222333',
    email: 'carlos@example.com',
  });
  const med = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 10,
    fecha_instalacion: '2026-01-01',
    direccion: 'Calle Palma 200',
    zona: 'Centro',
    latitud: -25.34,
    longitud: -57.51,
    estado: 'activo',
  });

  db.registrarLectura({
    numeroMedidor: med.numero_medidor,
    lecturaActual: 112,
    fechaLectura: '2026-10-28',
    fotoUrl: 'https://example.com/oct-10.jpg',
    registradoPor: 'Lector',
    estado: 'confirmada',
  });

  const primera = await db.ejecutarFacturacionMensualAsync('2026-11');
  assert.equal(primera.totalGeneradas, 1);

  const segunda = await db.ejecutarFacturacionMensualAsync('2026-11');
  assert.equal(segunda.totalGeneradas, 0);
  assert.equal(segunda.totalOmitidos, 1);
  assert.equal(segunda.medidoresOmitidos[0].medidor_id, med.id);
  assert.equal(segunda.medidoresOmitidos[0].motivo, 'ya_facturado');
});

test('18. Opción B: lectura "2026-10" ya facturada + nueva lectura "2026-11" → facturar "2026-12" usa "2026-11" y medidor sin lectura pendiente omite con mensaje correcto', async () => {
  db.clearData();

  const cli = db.agregarCliente({
    nombre_completo: 'Juan Pérez',
    documento: '1122001',
    direccion: 'Ruta 2 Km 18',
    telefono: '0983333444',
    email: 'juan@example.com',
  });

  const medConNuevaLectura = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 21,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote A',
    zona: 'Centro',
    latitud: -25.34,
    longitud: -57.51,
    estado: 'activo',
  });

  const medSinLecturaNueva = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 22,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote B',
    zona: 'Centro',
    latitud: -25.35,
    longitud: -57.52,
    estado: 'activo',
  });

  // Ambos medidores tienen lectura en 2026-10
  db.registrarLectura({
    numeroMedidor: medConNuevaLectura.numero_medidor,
    lecturaActual: 110,
    fechaLectura: '2026-10-25',
    fotoUrl: 'https://example.com/21-oct.jpg',
    registradoPor: 'Lector',
    estado: 'confirmada',
  });
  db.registrarLectura({
    numeroMedidor: medSinLecturaNueva.numero_medidor,
    lecturaActual: 205,
    fechaLectura: '2026-10-25',
    fotoUrl: 'https://example.com/22-oct.jpg',
    registradoPor: 'Lector',
    estado: 'confirmada',
  });

  // Facturar 2026-11 → consume ambas lecturas de 2026-10
  const loteNov = await db.ejecutarFacturacionMensualAsync('2026-11');
  assert.equal(loteNov.totalGeneradas, 2);

  // Solo el medidor 21 recibe nueva lectura confirmada en 2026-11 (consumo 15 m³: 110 -> 125)
  const lecNov21 = db.registrarLectura({
    numeroMedidor: medConNuevaLectura.numero_medidor,
    lecturaActual: 125,
    fechaLectura: '2026-11-25',
    fotoUrl: 'https://example.com/21-nov.jpg',
    registradoPor: 'Lector',
    estado: 'confirmada',
  }).lectura;

  // Facturar 2026-12:
  // - Medidor 21 debe usar lectura 2026-11 (NO la 2026-10 ya facturada)
  // - Medidor 22 no tiene lectura sin facturar → omitir con "sin_lectura_confirmada" y mensaje esperado
  const loteDic = await db.ejecutarFacturacionMensualAsync('2026-12');
  assert.equal(loteDic.totalGeneradas, 1);
  assert.equal(loteDic.totalOmitidos, 1);

  const facDic21 = loteDic.facturasGeneradas[0];
  assert.equal(facDic21.medidor_id, medConNuevaLectura.id);
  assert.equal(facDic21.lectura_id, lecNov21.id);
  assert.equal(facDic21.periodo_consumo, '2026-11');
  assert.equal(facDic21.periodo_facturado, '2026-12');
  assert.equal(facDic21.consumo_m3, 15);
  assert.equal(facDic21.fecha_emision, '2026-12-01');
  assert.equal(facDic21.fecha_vencimiento, '2026-12-31');

  const omitido22 = loteDic.medidoresOmitidos[0];
  assert.equal(omitido22.medidor_id, medSinLecturaNueva.id);
  assert.equal(omitido22.motivo, 'sin_lectura_confirmada');
  assert.equal(omitido22.detalle, 'No posee lectura confirmada pendiente de facturar.');
});

test('19. Persistencia Supabase: buildFacturaInsertPayload incluye periodo_consumo y todos los NOT NULL, y el retry por lectura_id/monto_pagado ausente NO elimina periodo_consumo', async () => {
  const insertedPayloads: Record<string, any>[] = [];
  let updatedMedidorEstado: string | null = null;

  const mockSupabase = {
    from(table: string) {
      if (table === 'facturas') {
        return {
          async insert(payload: Record<string, any>) {
            insertedPayloads.push({ ...payload });
            if ('lectura_id' in payload) {
              return {
                error: {
                  message: "Could not find the 'lectura_id' column of 'facturas' in the schema cache",
                },
              };
            }
            if ('monto_pagado' in payload) {
              return {
                error: {
                  message: "Could not find the 'monto_pagado' column of 'facturas' in the schema cache",
                },
              };
            }
            // Simular restricción NOT NULL real de Postgres sobre periodo_consumo
            if (!payload.periodo_consumo) {
              return {
                error: {
                  message: 'null value in column "periodo_consumo" of relation "facturas" violates not-null constraint',
                },
              };
            }
            return { error: null };
          },
        };
      }
      if (table === 'detalle_factura') {
        return {
          async insert() {
            return { error: null };
          },
        };
      }
      if (table === 'cargos_pendientes') {
        return {
          update() {
            return {
              async in() {
                return { error: null };
              },
            };
          },
        };
      }
      if (table === 'medidores') {
        return {
          update(vals: { estado: string }) {
            updatedMedidorEstado = vals.estado;
            return {
              async eq() {
                return { error: null };
              },
            };
          },
        };
      }
      throw new Error(`Tabla inesperada: ${table}`);
    },
  };

  const facturaDemo: Factura = {
    id: '4b45a8b2-8c4f-48f4-a4d2-0dc23f5c88f8',
    medidor_id: 'med-1',
    cliente_id: 'cli-1',
    periodo_consumo: '2026-10',
    periodo_facturado: '2026-11',
    lectura_id: 'lec-1',
    fecha_emision: '2026-11-01',
    fecha_vencimiento: '2026-11-30',
    estado: 'pendiente',
    total: 40800,
    saldo_pendiente: 40800,
    saldo: 40800,
    monto_pagado: 0,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    texto_alerta_consumo: null,
    numero_boleta_medidor: 1,
    lectura_anterior: 100,
    lectura_actual: 110,
    consumo_m3: 10,
  };

  const payload = db.buildFacturaInsertPayload(facturaDemo);
  assert.equal(payload.periodo_consumo, '2026-10');
  assert.equal(payload.periodo_facturado, '2026-11');
  assert.equal(payload.saldo_pendiente, 40800);
  assert.equal(payload.monto_pagado, 0);
  assert.equal(payload.numero_boleta_medidor, 1);

  const errMsg = await db.persistirFacturaGeneradaSupabase({
    factura: facturaDemo,
    detalles: [
      {
        id: 'det-1',
        factura_id: facturaDemo.id,
        concepto: 'consumo_agua',
        descripcion: 'Consumo de agua (10 m³)',
        monto: 40000,
      },
    ],
    cargosFacturadosIds: [],
    medidorId: 'med-1',
    estadoMedidor: 'activo',
    clientOverride: mockSupabase,
  });

  assert.equal(errMsg, null, `No debe fallar la persistencia: ${errMsg}`);
  assert.equal(insertedPayloads.length, 3);
  // Todos los reintentos deben conservar periodo_consumo
  insertedPayloads.forEach((attempt) => {
    assert.equal(attempt.periodo_consumo, '2026-10');
    assert.equal(attempt.periodo_facturado, '2026-11');
  });
  assert.equal('lectura_id' in insertedPayloads[2], false);
  assert.equal('monto_pagado' in insertedPayloads[2], false);
  assert.equal(updatedMedidorEstado, 'activo');
});

test('20. Regresión Medidor 103 con separación de mora: 2026-09 refinanciada y 2026-10 impaga (77.234 con mora 3.000) -> 2026-11 deuda=74.234, mora=6.000, ERSSAN=2.325, Total=118.559', async () => {
  // 1) Verificación unitaria pura con calcularFacturaIndividual
  const medidor103: Medidor = {
    ...medidorBase,
    id: 'med-103-unit',
    numero_medidor: 103,
    estado: 'moroso',
  };

  const fac202609: Factura = {
    id: 'fac-103-202609',
    medidor_id: medidor103.id,
    cliente_id: 'cli-test-01',
    periodo_consumo: '2026-08',
    periodo_facturado: '2026-09',
    fecha_emision: '2026-09-01',
    fecha_vencimiento: '2026-09-30',
    estado: 'refinanciada',
    total: 36720,
    saldo_pendiente: 0,
    saldo: 0,
    monto_pagado: 0,
    motivo: 'Consolidada en factura 2026-10',
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
  };

  const fac202610: Factura = {
    id: 'fac-103-202610',
    medidor_id: medidor103.id,
    cliente_id: 'cli-test-01',
    periodo_consumo: '2026-09',
    periodo_facturado: '2026-10',
    fecha_emision: '2026-10-01',
    fecha_vencimiento: '2026-10-31',
    estado: 'vencida',
    total: 77234,
    saldo_pendiente: 77234,
    saldo: 77234,
    monto_pagado: 0,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 2,
    detalles: [
      { id: 'd-103-1', factura_id: 'fac-103-202610', concepto: 'consumo_agua', descripcion: 'Consumo mínimo', monto: 36000 },
      { id: 'd-103-2', factura_id: 'fac-103-202610', concepto: 'deuda_anterior', descripcion: 'Deuda anterior', monto: 36720 },
      { id: 'd-103-3', factura_id: 'fac-103-202610', concepto: 'mora', descripcion: 'Recargo por mora (1 boleta × 3.000)', monto: 3000 },
      { id: 'd-103-4', factura_id: 'fac-103-202610', concepto: 'erssan', descripcion: 'ERSSAN 2%', monto: 1514 },
    ],
  };

  const resUnit = calcularFacturaIndividual({
    medidor: medidor103,
    clienteId: 'cli-test-01',
    periodo: '2026-11',
    lecturaMes: {
      id: 'lec-103-202610',
      medidor_id: medidor103.id,
      periodo: '2026-10',
      fecha_lectura: '2026-10-28',
      lectura_anterior: 500,
      lectura_actual: 505, // 5 m³ -> consumo mínimo 36.000
      consumo_m3: 5,
      foto_medidor_url: 'https://example.com/med103.jpg',
      estado: 'confirmada',
      registrado_por: 'lector-1',
      fecha_registro: '2026-10-28',
    },
    lecturasAnteriores: [],
    facturasImpagasAnteriores: [fac202609, fac202610],
    cargosPendientes: [],
    planesFinanciamiento: [],
    correlativoPorMedidor: 3,
    fechaReferencia: new Date('2026-11-01T12:00:00Z'),
    fechaEmision: '2026-11-01',
  });

  const detAgua = resUnit.detalles.find((d) => d.concepto === 'consumo_agua');
  const detDeuda = resUnit.detalles.find((d) => d.concepto === 'deuda_anterior');
  const detMora = resUnit.detalles.find((d) => d.concepto === 'mora');
  const detErssan = resUnit.detalles.find((d) => d.concepto === 'erssan');

  assert.equal(detAgua?.monto, 36000);
  assert.equal(detDeuda?.monto, 74234, 'Debe restar la mora (3.000) de N-1 (77.234) -> 74.234');
  assert.equal(detMora?.monto, 6000, 'Mora acumulada = 3.000 (de 2026-09) + 3.000 (de 2026-10) = 6.000');
  assert.equal(detErssan?.monto, 2325, 'ERSSAN 2% de (74.234 + 6.000 + 36.000 = 116.234) = 2.325');
  assert.equal(resUnit.factura.total, 118559);
  assert.equal(resUnit.facturaAnteriorARefinanciar?.id, fac202610.id);

  // 2) Verificación integral con db.generarFacturaIndividualAsync
  db.clearData();
  const cli = db.agregarCliente({
    nombre_completo: 'Cliente Medidor 103',
    documento: '1030103',
    direccion: 'San Gabriel',
    telefono: '0981103103',
    email: 'med103@example.com',
  });
  const med103Db = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 103,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 103',
    zona: 'SAN GABRIEL',
    latitud: -25.39,
    longitud: -57.38,
    estado: 'moroso',
  });

  const data = db.getFullData();
  data.facturas.push(
    {
      ...fac202609,
      medidor_id: med103Db.id,
      cliente_id: cli.id,
    },
    {
      ...fac202610,
      medidor_id: med103Db.id,
      cliente_id: cli.id,
    }
  );
  data.lecturas.push({
    id: 'lec-103-db-oct',
    medidor_id: med103Db.id,
    periodo: '2026-10',
    fecha_lectura: '2026-10-28',
    lectura_anterior: 500,
    lectura_actual: 506,
    consumo_m3: 6,
    foto_medidor_url: 'https://example.com/103-oct.jpg',
    estado: 'confirmada',
    registrado_por: 'lector-1',
    fecha_registro: '2026-10-28',
  });

  const regen = await db.generarFacturaIndividualAsync({
    numeroMedidor: 103,
    periodoConsumo: '2026-10',
    periodoFacturado: '2026-11',
    fechaEmision: '2026-11-01',
  });

  assert.equal(regen.detalles.find((d) => d.concepto === 'deuda_anterior')?.monto, 74234);
  assert.equal(regen.detalles.find((d) => d.concepto === 'mora')?.monto, 6000);
  assert.equal(regen.detalles.find((d) => d.concepto === 'consumo_agua')?.monto, 36000);
  assert.equal(regen.detalles.find((d) => d.concepto === 'erssan')?.monto, 2325);
  assert.equal(regen.factura.total, 118559);
  const fac10EnDb = db.getFullData().facturas.find((f) => f.id === fac202610.id);
  assert.equal(fac10EnDb?.estado, 'refinanciada');
  assert.equal(fac10EnDb?.saldo_pendiente, 0);
});

test('21. Deuda anterior con 2026-10 PAGADA -> facturar 2026-11 da deuda_anterior = 0 (incluso con 2026-09 vencida)', () => {
  const medidor: Medidor = {
    ...medidorBase,
    id: 'med-n1-pagada',
    numero_medidor: 104,
    estado: 'moroso',
  };

  const fac202609Impaga: Factura = {
    id: 'fac-104-09',
    medidor_id: medidor.id,
    cliente_id: 'cli-test-01',
    periodo_facturado: '2026-09',
    fecha_emision: '2026-09-01',
    fecha_vencimiento: '2026-09-30',
    estado: 'vencida',
    total: 36720,
    saldo_pendiente: 36720,
    saldo: 36720,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
  };

  const fac202610Pagada: Factura = {
    id: 'fac-104-10',
    medidor_id: medidor.id,
    cliente_id: 'cli-test-01',
    periodo_facturado: '2026-10',
    fecha_emision: '2026-10-01',
    fecha_vencimiento: '2026-10-31',
    estado: 'pagada',
    total: 77234,
    saldo_pendiente: 0,
    saldo: 0,
    monto_pagado: 77234,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 2,
  };

  const res = calcularFacturaIndividual({
    medidor,
    clienteId: 'cli-test-01',
    periodo: '2026-11',
    lecturaMes: {
      id: 'lec-104-11',
      medidor_id: medidor.id,
      periodo: '2026-10',
      fecha_lectura: '2026-10-28',
      lectura_anterior: 100,
      lectura_actual: 105,
      consumo_m3: 5,
      foto_medidor_url: 'https://example.com/104.jpg',
      estado: 'confirmada',
      registrado_por: 'lector-1',
      fecha_registro: '2026-10-28',
    },
    lecturasAnteriores: [],
    facturasImpagasAnteriores: [fac202609Impaga, fac202610Pagada],
    cargosPendientes: [],
    planesFinanciamiento: [],
    correlativoPorMedidor: 3,
    fechaReferencia: new Date('2026-11-01T12:00:00Z'),
    fechaEmision: '2026-11-01',
  });

  const detDeuda = res.detalles.find((d) => d.concepto === 'deuda_anterior');
  assert.equal(detDeuda, undefined, 'Si 2026-10 está pagada, deuda_anterior debe ser 0 y no incluirse en detalles');
});

test('22. Medidor sin facturas anteriores -> deuda_anterior = 0 (no aparece en detalles)', () => {
  const medidor: Medidor = {
    ...medidorBase,
    id: 'med-sin-facturas',
    numero_medidor: 105,
    estado: 'activo',
  };

  const res = calcularFacturaIndividual({
    medidor,
    clienteId: 'cli-test-01',
    periodo: '2026-11',
    lecturaMes: {
      id: 'lec-105-11',
      medidor_id: medidor.id,
      periodo: '2026-10',
      fecha_lectura: '2026-10-28',
      lectura_anterior: 0,
      lectura_actual: 8,
      consumo_m3: 8,
      foto_medidor_url: 'https://example.com/105.jpg',
      estado: 'confirmada',
      registrado_por: 'lector-1',
      fecha_registro: '2026-10-28',
    },
    lecturasAnteriores: [],
    facturasImpagasAnteriores: [],
    cargosPendientes: [],
    planesFinanciamiento: [],
    correlativoPorMedidor: 1,
    fechaReferencia: new Date('2026-11-01T12:00:00Z'),
    fechaEmision: '2026-11-01',
  });

  assert.equal(res.detalles.some((d) => d.concepto === 'deuda_anterior'), false);
  assert.equal(res.detalles.find((d) => d.concepto === 'consumo_agua')?.monto, 36000);
  assert.equal(res.detalles.find((d) => d.concepto === 'erssan')?.monto, 720);
  assert.equal(res.factura.total, 36720);
});

test('23. Medidor con 2026-10 ANULADA -> deuda_anterior = 0; cambio de año 2025-12 -> 2026-01 resuelve N-1 correctamente', async () => {
  const medidor: Medidor = {
    ...medidorBase,
    id: 'med-n1-anulada',
    numero_medidor: 106,
    estado: 'activo',
  };

  const fac202610Anulada: Factura = {
    id: 'fac-106-10-anu',
    medidor_id: medidor.id,
    cliente_id: 'cli-test-01',
    periodo_facturado: '2026-10',
    fecha_emision: '2026-10-01',
    fecha_vencimiento: '2026-10-31',
    estado: 'anulada',
    total: 77234,
    saldo_pendiente: 77234,
    saldo: 77234,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
  };

  const resAnulada = calcularFacturaIndividual({
    medidor,
    clienteId: 'cli-test-01',
    periodo: '2026-11',
    lecturaMes: {
      id: 'lec-106-11',
      medidor_id: medidor.id,
      periodo: '2026-10',
      fecha_lectura: '2026-10-28',
      lectura_anterior: 10,
      lectura_actual: 15,
      consumo_m3: 5,
      foto_medidor_url: 'https://example.com/106.jpg',
      estado: 'confirmada',
      registrado_por: 'lector-1',
      fecha_registro: '2026-10-28',
    },
    lecturasAnteriores: [],
    facturasImpagasAnteriores: [fac202610Anulada],
    cargosPendientes: [],
    planesFinanciamiento: [],
    correlativoPorMedidor: 2,
    fechaReferencia: new Date('2026-11-01T12:00:00Z'),
    fechaEmision: '2026-11-01',
  });

  assert.equal(
    resAnulada.detalles.some((d) => d.concepto === 'deuda_anterior'),
    false,
    'Si 2026-10 está anulada, deuda_anterior debe ser 0'
  );

  // Cambio de año: facturar 2026-01 debe buscar 2025-12 como N-1
  const fac202512: Factura = {
    id: 'fac-106-202512',
    medidor_id: medidor.id,
    cliente_id: 'cli-test-01',
    periodo_facturado: '2025-12',
    fecha_emision: '2025-12-01',
    fecha_vencimiento: '2025-12-31',
    estado: 'vencida',
    total: 50000,
    saldo_pendiente: 50000,
    saldo: 50000,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 3,
  };

  const resEnero = calcularFacturaIndividual({
    medidor,
    clienteId: 'cli-test-01',
    periodo: '2026-01',
    lecturaMes: {
      id: 'lec-106-202601',
      medidor_id: medidor.id,
      periodo: '2025-12',
      fecha_lectura: '2025-12-28',
      lectura_anterior: 15,
      lectura_actual: 20,
      consumo_m3: 5,
      foto_medidor_url: 'https://example.com/106-ene.jpg',
      estado: 'confirmada',
      registrado_por: 'lector-1',
      fecha_registro: '2025-12-28',
    },
    lecturasAnteriores: [],
    facturasImpagasAnteriores: [fac202512],
    cargosPendientes: [],
    planesFinanciamiento: [],
    correlativoPorMedidor: 4,
    fechaReferencia: new Date('2026-01-01T12:00:00Z'),
    fechaEmision: '2026-01-01',
  });

  assert.equal(resEnero.detalles.find((d) => d.concepto === 'deuda_anterior')?.monto, 50000);
});

test('24. Regresión Medidor 132: deuda_anterior = 82.394 (85.394 - 3.000), mora = 6.000, consumo = 36.000, ERSSAN = 2.488, Total = 126.882 y 2026-10 refinanciada con saldo 0', async () => {
  const medidor132: Medidor = {
    ...medidorBase,
    id: 'med-132-test',
    numero_medidor: 132,
    estado: 'moroso',
  };

  const fac202609Ref: Factura = {
    id: 'fac-132-202609',
    medidor_id: medidor132.id,
    cliente_id: 'cli-test-01',
    periodo_consumo: '2026-08',
    periodo_facturado: '2026-09',
    fecha_emision: '2026-09-01',
    fecha_vencimiento: '2026-09-30',
    estado: 'refinanciada',
    total: 36720,
    saldo_pendiente: 0,
    saldo: 0,
    monto_pagado: 0,
    motivo: 'Consolidada en factura 2026-10',
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
  };

  // Factura 2026-10: consumo 44.000 + deuda 36.720 + mora 3.000 + ERSSAN 1.674 = 85.394
  const fac202610Vencida: Factura = {
    id: 'fac-132-202610',
    medidor_id: medidor132.id,
    cliente_id: 'cli-test-01',
    periodo_consumo: '2026-09',
    periodo_facturado: '2026-10',
    fecha_emision: '2026-10-01',
    fecha_vencimiento: '2026-10-31',
    estado: 'vencida',
    total: 85394,
    saldo_pendiente: 85394,
    saldo: 85394,
    monto_pagado: 0,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 2,
    detalles: [
      { id: 'd-132-10-agua', factura_id: 'fac-132-202610', concepto: 'consumo_agua', descripcion: 'Consumo de agua (11 m³ × 4.000)', monto: 44000 },
      { id: 'd-132-10-deuda', factura_id: 'fac-132-202610', concepto: 'deuda_anterior', descripcion: 'Deuda anterior (período 2026-09)', monto: 36720 },
      { id: 'd-132-10-mora', factura_id: 'fac-132-202610', concepto: 'mora', descripcion: 'Recargo por mora (1 boleta × 3.000)', monto: 3000 },
      { id: 'd-132-10-erssan', factura_id: 'fac-132-202610', concepto: 'erssan', descripcion: 'ERSSAN (2%)', monto: 1674 },
    ],
  };

  // 1) Verificación unitaria pura con calcularFacturaIndividual
  const resUnit = calcularFacturaIndividual({
    medidor: medidor132,
    clienteId: 'cli-test-01',
    periodo: '2026-11',
    lecturaMes: {
      id: 'lec-132-202610',
      medidor_id: medidor132.id,
      periodo: '2026-10',
      fecha_lectura: '2026-10-28',
      lectura_anterior: 200,
      lectura_actual: 206, // 6 m³ -> mínimo 36.000
      consumo_m3: 6,
      foto_medidor_url: 'https://example.com/132.jpg',
      estado: 'confirmada',
      registrado_por: 'lector-1',
      fecha_registro: '2026-10-28',
    },
    lecturasAnteriores: [],
    facturasImpagasAnteriores: [fac202609Ref, fac202610Vencida],
    cargosPendientes: [],
    planesFinanciamiento: [],
    correlativoPorMedidor: 3,
    fechaReferencia: new Date('2026-11-01T12:00:00Z'),
    fechaEmision: '2026-11-01',
  });

  assert.equal(resUnit.detalles.find((d) => d.concepto === 'deuda_anterior')?.monto, 82394);
  assert.equal(resUnit.detalles.find((d) => d.concepto === 'consumo_agua')?.monto, 36000);
  assert.equal(resUnit.detalles.find((d) => d.concepto === 'mora')?.monto, 6000);
  assert.equal(resUnit.detalles.find((d) => d.concepto === 'erssan')?.monto, 2488);
  assert.equal(resUnit.factura.total, 126882);
  assert.equal(resUnit.factura.es_tercera_boleta, true);
  assert.equal(resUnit.facturaAnteriorARefinanciar?.id, fac202610Vencida.id);
  assert.equal(resUnit.facturaAnteriorARefinanciar?.motivo, 'Consolidada en factura 2026-11');

  // 2) Verificación integral completa en DatabaseEngine + persistencia simulada Supabase + cobro de 2026-11
  db.clearData();
  const cli = db.agregarCliente({
    nombre_completo: 'Cliente Medidor 132',
    documento: '1320132',
    direccion: 'San Gabriel',
    telefono: '0981132132',
    email: 'med132@example.com',
  });
  const medDb = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 132,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 132',
    zona: 'SAN GABRIEL',
    latitud: -25.39,
    longitud: -57.38,
    estado: 'moroso',
  });

  const data = db.getFullData();
  data.facturas.push(
    { ...fac202609Ref, medidor_id: medDb.id, cliente_id: cli.id },
    { ...fac202610Vencida, medidor_id: medDb.id, cliente_id: cli.id }
  );
  data.lecturas.push({
    id: 'lec-132-db-oct',
    medidor_id: medDb.id,
    periodo: '2026-10',
    fecha_lectura: '2026-10-28',
    lectura_anterior: 200,
    lectura_actual: 206,
    consumo_m3: 6,
    foto_medidor_url: 'https://example.com/132-oct.jpg',
    estado: 'confirmada',
    registrado_por: 'lector-1',
    fecha_registro: '2026-10-28',
  });

  // Mock Supabase que registra actualización a refinanciada en N-1
  const supabaseUpdates: Array<{ table: string; payload: any; id: string }> = [];
  const fakeClient: any = {
    from: (table: string) => ({
      insert: async () => ({ error: null }),
      update: (payload: any) => ({
        eq: async (_col: string, id: string) => {
          supabaseUpdates.push({ table, payload, id });
          return { error: null };
        },
        in: async () => ({ error: null }),
      }),
    }),
  };

  const gen = await db.generarFacturaIndividualAsync({
    numeroMedidor: 132,
    periodoConsumo: '2026-10',
    periodoFacturado: '2026-11',
    fechaEmision: '2026-11-01',
    clientOverride: fakeClient,
  });

  assert.equal(gen.detalles.find((d) => d.concepto === 'deuda_anterior')?.monto, 82394);
  assert.equal(gen.detalles.find((d) => d.concepto === 'mora')?.monto, 6000);
  assert.equal(gen.detalles.find((d) => d.concepto === 'consumo_agua')?.monto, 36000);
  assert.equal(gen.detalles.find((d) => d.concepto === 'erssan')?.monto, 2488);
  assert.equal(gen.factura.total, 126882);

  // Verificar que 2026-10 pasó a refinanciada con saldo 0 en memoria y en Supabase
  const fac10Despues = db.getFullData().facturas.find((f) => f.id === fac202610Vencida.id)!;
  assert.equal(fac10Despues.estado, 'refinanciada');
  assert.equal(fac10Despues.saldo_pendiente, 0);
  assert.equal(fac10Despues.saldo, 0);
  assert.equal(fac10Despues.motivo, 'Consolidada en factura 2026-11');

  const refUpdateSb = supabaseUpdates.find((u) => u.table === 'facturas' && u.id === fac202610Vencida.id);
  assert.ok(refUpdateSb, 'Debe persistir el estado refinanciada en Supabase para la factura N-1');
  assert.deepEqual(refUpdateSb?.payload, {
    estado: 'refinanciada',
    saldo_pendiente: 0,
    motivo: 'Consolidada en factura 2026-11',
  });

  // Deuda total del cliente debe ser exclusivamente 126.882 (no suma 2026-09 ni 2026-10)
  const medDetalle = db.getMedidorDetalle(medDb.id);
  assert.equal(medDetalle?.totalDeuda, 126882);
  assert.equal(medDetalle?.moraCalculada, 6000);

  // Regla 4: al pagar 2026-11, solo 2026-11 pasa a 'pagada'; las refinanciadas quedan en 'refinanciada' con saldo 0
  const cobro = db.registrarCobro({
    facturaId: gen.factura.id,
    monto: 126882,
    metodoPago: 'efectivo',
  });
  assert.equal(cobro.factura.estado, 'pagada');
  assert.equal(cobro.estadoMedidorActualizado, 'activo');
  assert.equal(db.getFullData().facturas.find((f) => f.id === fac202609Ref.id)?.estado, 'refinanciada');
  assert.equal(db.getFullData().facturas.find((f) => f.id === fac202609Ref.id)?.saldo_pendiente, 0);
  assert.equal(db.getFullData().facturas.find((f) => f.id === fac202610Vencida.id)?.estado, 'refinanciada');
  assert.equal(db.getFullData().facturas.find((f) => f.id === fac202610Vencida.id)?.saldo_pendiente, 0);
  assert.equal(db.getMedidorDetalle(medDb.id)?.totalDeuda, 0);
});

test('25. Con 2026-10 PAGADA y sin facturas anteriores -> deuda = 0 y mora = 0', () => {
  const medidor: Medidor = {
    ...medidorBase,
    id: 'med-pagada-mora-0',
    numero_medidor: 133,
    estado: 'activo',
  };

  const fac202610Pagada: Factura = {
    id: 'fac-133-10',
    medidor_id: medidor.id,
    cliente_id: 'cli-test-01',
    periodo_facturado: '2026-10',
    fecha_emision: '2026-10-01',
    fecha_vencimiento: '2026-10-31',
    estado: 'pagada',
    total: 85394,
    saldo_pendiente: 0,
    saldo: 0,
    monto_pagado: 85394,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 2,
    detalles: [
      { id: 'd-133-m', factura_id: 'fac-133-10', concepto: 'mora', descripcion: 'Mora', monto: 3000 },
    ],
  };

  const resPagada = calcularFacturaIndividual({
    medidor,
    clienteId: 'cli-test-01',
    periodo: '2026-11',
    lecturaMes: {
      id: 'lec-133-1',
      medidor_id: medidor.id,
      periodo: '2026-10',
      fecha_lectura: '2026-10-28',
      lectura_anterior: 10,
      lectura_actual: 15,
      consumo_m3: 5,
      foto_medidor_url: 'https://example.com/133.jpg',
      estado: 'confirmada',
      registrado_por: 'lector-1',
      fecha_registro: '2026-10-28',
    },
    lecturasAnteriores: [],
    facturasImpagasAnteriores: [fac202610Pagada],
    cargosPendientes: [],
    planesFinanciamiento: [],
    correlativoPorMedidor: 3,
    fechaReferencia: new Date('2026-11-01T12:00:00Z'),
    fechaEmision: '2026-11-01',
  });

  assert.equal(resPagada.detalles.some((d) => d.concepto === 'deuda_anterior'), false);
  assert.equal(resPagada.detalles.some((d) => d.concepto === 'mora'), false);
  assert.equal(resPagada.facturaAnteriorARefinanciar, null);
  assert.equal(resPagada.factura.total, 36720);

  const resSinFacturas = calcularFacturaIndividual({
    medidor,
    clienteId: 'cli-test-01',
    periodo: '2026-11',
    lecturaMes: {
      id: 'lec-133-2',
      medidor_id: medidor.id,
      periodo: '2026-10',
      fecha_lectura: '2026-10-28',
      lectura_anterior: 0,
      lectura_actual: 5,
      consumo_m3: 5,
      foto_medidor_url: 'https://example.com/133b.jpg',
      estado: 'confirmada',
      registrado_por: 'lector-1',
      fecha_registro: '2026-10-28',
    },
    lecturasAnteriores: [],
    facturasImpagasAnteriores: [],
    cargosPendientes: [],
    planesFinanciamiento: [],
    correlativoPorMedidor: 1,
    fechaReferencia: new Date('2026-11-01T12:00:00Z'),
    fechaEmision: '2026-11-01',
  });

  assert.equal(resSinFacturas.detalles.some((d) => d.concepto === 'deuda_anterior'), false);
  assert.equal(resSinFacturas.detalles.some((d) => d.concepto === 'mora'), false);
  assert.equal(resSinFacturas.factura.total, 36720);
});

test('26. Anular factura consolidada N restaura N-1 desde refinanciada a su estado/saldo original; no permite anular ni cobrar directamente una refinanciada', async () => {
  db.clearData();
  const cli = db.agregarCliente({
    nombre_completo: 'Cliente Restauracion',
    documento: '1340134',
    direccion: 'San Jose',
    telefono: '0981134134',
    email: 'rest134@example.com',
  });
  const med = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 134,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 134',
    zona: 'SAN JOSE',
    latitud: -25.39,
    longitud: -57.38,
    estado: 'moroso',
  });

  const data = db.getFullData();
  const fac10: Factura = {
    id: 'fac-134-202610',
    medidor_id: med.id,
    cliente_id: cli.id,
    periodo_consumo: '2026-09',
    periodo_facturado: '2026-10',
    fecha_emision: '2026-10-01',
    fecha_vencimiento: '2026-10-31',
    estado: 'vencida',
    total: 85394,
    saldo_pendiente: 85394,
    saldo: 85394,
    monto_pagado: 0,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
    detalles: [
      { id: 'd-134-1', factura_id: 'fac-134-202610', concepto: 'consumo_agua', descripcion: 'Consumo', monto: 44000 },
      { id: 'd-134-2', factura_id: 'fac-134-202610', concepto: 'deuda_anterior', descripcion: 'Deuda', monto: 36720 },
      { id: 'd-134-3', factura_id: 'fac-134-202610', concepto: 'mora', descripcion: 'Mora', monto: 3000 },
      { id: 'd-134-4', factura_id: 'fac-134-202610', concepto: 'erssan', descripcion: 'ERSSAN', monto: 1674 },
    ],
  };
  data.facturas.push(fac10);
  data.lecturas.push({
    id: 'lec-134-oct',
    medidor_id: med.id,
    periodo: '2026-10',
    fecha_lectura: '2026-10-28',
    lectura_anterior: 100,
    lectura_actual: 105,
    consumo_m3: 5,
    foto_medidor_url: 'https://example.com/134.jpg',
    estado: 'confirmada',
    registrado_por: 'lector-1',
    fecha_registro: '2026-10-28',
  });

  const gen11 = await db.generarFacturaIndividualAsync({
    numeroMedidor: 134,
    periodoConsumo: '2026-10',
    periodoFacturado: '2026-11',
    fechaEmision: '2026-11-01',
  });

  assert.equal(fac10.estado, 'refinanciada');
  assert.equal(fac10.saldo_pendiente, 0);

  // Intentar cobrar o anular directamente fac10 refinanciada debe arrojar error
  await assert.rejects(
    db.registrarCobroAsync({ facturaId: fac10.id, monto: 1000, metodoPago: 'efectivo' }),
    /refinanciada/i
  );
  await assert.rejects(
    db.anularFacturaAsync(fac10.id, 'Intento inválido sobre refinanciada'),
    /refinanciada/i
  );

  // Anular gen11 debe restaurar fac10 a 'vencida' con saldo 85.394
  await db.anularFacturaAsync(gen11.factura.id, 'Regenerar tras corrección');
  assert.equal(gen11.factura.estado, 'anulada');
  assert.equal(fac10.estado, 'vencida');
  assert.equal(fac10.saldo_pendiente, 85394);
  assert.equal(fac10.motivo, null);
  assert.equal(db.getMedidorDetalle(med.id)?.totalDeuda, 85394);
});

test('27. loadFromSupabase pagina detalle_factura más allá de 1000 filas usando .range() para no perder detalles de mora', async () => {
  db.clearData();

  const totalDetalles = 1250;
  const targetFacId = 'fac-132-202610-pag';
  const allDetalles = Array.from({ length: totalDetalles }, (_, idx) => {
    if (idx === 1199) {
      return {
        id: `det-mora-pag-${idx}`,
        factura_id: targetFacId,
        concepto: 'mora',
        descripcion: 'Recargo por mora (1 boleta × 3.000)',
        monto: 3000,
      };
    }
    return {
      id: `det-${String(idx).padStart(4, '0')}`,
      factura_id: idx === 1198 ? targetFacId : `fac-otro-${idx % 400}`,
      concepto: 'consumo_agua',
      descripcion: 'Consumo',
      monto: 36000,
    };
  });

  const rangesSolicitados: Array<[number, number]> = [];
  const tables: Record<string, any[]> = {
    tarifas: [
      {
        id: 'tar-1',
        precio_m3: 4000,
        consumo_minimo_m3: 9,
        monto_minimo_consumo: 36000,
        monto_mora_fijo: 3000,
        monto_reconexion: 60000,
        erssan_porcentaje: 2,
        dia_vencimiento_boletas_normales: 'ultimo_dia_mes',
        dia_vencimiento_tercera_boleta: 11,
        umbral_alerta_consumo: 3,
        texto_alerta_consumo: 'CONSUMO ELEVADO',
        max_numero_medidor: 1000,
        vigente_desde: '2026-01-01',
      },
    ],
    clientes: [
      {
        id: 'cli-132',
        nombre_completo: 'Titular 132',
        documento: '1320000',
        direccion: 'San Gabriel',
        telefono: '0981132132',
        email: 'tit132@example.com',
        fecha_alta: '2026-01-01',
      },
    ],
    medidores: [
      {
        id: 'med-132',
        cliente_id: 'cli-132',
        numero_medidor: 132,
        direccion: 'Lote 132',
        zona: 'SAN GABRIEL',
        latitud: -25.39,
        longitud: -57.38,
        fecha_instalacion: '2026-01-01',
        estado: 'moroso',
        mora_congelada: 0,
      },
    ],
    facturas: [
      {
        id: targetFacId,
        medidor_id: 'med-132',
        cliente_id: 'cli-132',
        periodo_facturado: '2026-10',
        periodo_consumo: '2026-09',
        fecha_emision: '2026-10-01',
        fecha_vencimiento: '2026-10-31',
        estado: 'vencida',
        total: 85394,
        saldo_pendiente: 85394,
        monto_pagado: 0,
        es_tercera_boleta: false,
        alerta_consumo_elevado: false,
        numero_boleta_medidor: 2,
      },
    ],
    detalle_factura: allDetalles,
  };

  const makePaginatedClient = {
    auth: {
      async getSession() {
        return { data: { session: { user: { id: 'usr-admin', email: 'admin@example.com' } } }, error: null };
      },
    },
    from(table: string) {
      const rows = tables[table] || [];
      let sliceRange: [number, number] | null = null;
      const builder: any = {
        select() {
          return builder;
        },
        order() {
          return builder;
        },
        limit(n: number) {
          sliceRange = [0, Math.min(n - 1, 999)];
          return builder;
        },
        range(from: number, to: number) {
          if (table === 'detalle_factura') rangesSolicitados.push([from, to]);
          sliceRange = [from, to];
          return builder;
        },
        then(resolve: (val: any) => void, reject?: (err: any) => void) {
          const data = sliceRange
            ? rows.slice(sliceRange[0], sliceRange[1] + 1)
            : rows.slice(0, 1000);
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };

  const loadRes = await db.loadFromSupabase({ clientOverride: makePaginatedClient, force: true });
  assert.equal(loadRes.ok, true);
  assert.deepEqual(rangesSolicitados, [
    [0, 999],
    [1000, 1999],
  ]);

  const facCargada = db.getFullData().facturas.find((f) => f.id === targetFacId)!;
  assert.ok(facCargada.detalles && facCargada.detalles.length === 2, 'Debe adjuntar detalles más allá de la fila 1000');
  assert.equal(
    facCargada.detalles!.find((d) => d.concepto === 'mora')?.monto,
    3000,
    'La mora cargada más allá de la fila 1000 debe conservarse en Factura.detalles'
  );
});

test('28. generarFacturaIndividualAsync consulta detalle_factura on-demand si N-1 llegó sin detalles en memoria y separa 82.394 + 6.000', async () => {
  db.clearData();
  const cli = db.agregarCliente({
    nombre_completo: 'Medidor 132 OnDemand',
    documento: '1329999',
    direccion: 'San Gabriel',
    telefono: '0981132999',
    email: 'm132od@example.com',
  });
  const med = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 132,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 132',
    zona: 'SAN GABRIEL',
    latitud: -25.39,
    longitud: -57.38,
    estado: 'moroso',
  });

  const data = db.getFullData();
  // Simulamos factura 2026-10 en memoria CON detalles vacíos (ej. cargada sin detalles)
  data.facturas.push({
    id: 'fac-132-202610-nodet',
    medidor_id: med.id,
    cliente_id: cli.id,
    periodo_consumo: '2026-09',
    periodo_facturado: '2026-10',
    fecha_emision: '2026-10-01',
    fecha_vencimiento: '2026-10-31',
    estado: 'vencida',
    total: 85394,
    saldo_pendiente: 85394,
    saldo: 85394,
    monto_pagado: 0,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 2,
    detalles: [],
  });
  data.lecturas.push({
    id: 'lec-132-od-oct',
    medidor_id: med.id,
    periodo: '2026-10',
    fecha_lectura: '2026-10-28',
    lectura_anterior: 200,
    lectura_actual: 205,
    consumo_m3: 5,
    foto_medidor_url: 'https://example.com/132-od.jpg',
    estado: 'confirmada',
    registrado_por: 'lector-1',
    fecha_registro: '2026-10-28',
  });

  let queriedOnDemand = false;
  const updates: any[] = [];
  const sbClient: any = {
    from(table: string) {
      return {
        select() {
          return {
            in: async (_col: string, ids: string[]) => {
              if (table === 'detalle_factura' && ids.includes('fac-132-202610-nodet')) {
                queriedOnDemand = true;
                return {
                  data: [
                    { id: 'd1', factura_id: 'fac-132-202610-nodet', concepto: 'consumo_agua', descripcion: 'Consumo', monto: 44000 },
                    { id: 'd2', factura_id: 'fac-132-202610-nodet', concepto: 'deuda_anterior', descripcion: 'Deuda', monto: 36720 },
                    { id: 'd3', factura_id: 'fac-132-202610-nodet', concepto: 'mora', descripcion: 'Mora', monto: 3000 },
                    { id: 'd4', factura_id: 'fac-132-202610-nodet', concepto: 'erssan', descripcion: 'ERSSAN', monto: 1674 },
                  ],
                  error: null,
                };
              }
              return { data: [], error: null };
            },
          };
        },
        insert: async () => ({ error: null }),
        update: (payload: any) => ({
          eq: async (_col: string, id: string) => {
            updates.push({ table, payload, id });
            return { error: null };
          },
          in: async () => ({ error: null }),
        }),
        delete: () => ({ eq: async () => ({ error: null }) }),
      };
    },
  };

  const gen = await db.generarFacturaIndividualAsync({
    numeroMedidor: 132,
    periodoConsumo: '2026-10',
    periodoFacturado: '2026-11',
    fechaEmision: '2026-11-01',
    clientOverride: sbClient,
  });

  assert.equal(queriedOnDemand, true, 'Debe consultar detalle_factura on-demand si N-1 tenía detalles vacíos');
  assert.equal(gen.detalles.find((d) => d.concepto === 'deuda_anterior')?.monto, 82394);
  assert.equal(gen.detalles.find((d) => d.concepto === 'mora')?.monto, 6000);
  assert.equal(gen.detalles.find((d) => d.concepto === 'erssan')?.monto, 2488);
  assert.equal(gen.factura.total, 126882);
  assert.equal(
    updates.some((u) => u.id === 'fac-132-202610-nodet' && u.payload.estado === 'refinanciada'),
    true
  );
});

test('29. Si Supabase rechaza estado refinanciada (falta migración facturas_estado_check), revierte la factura nueva huérfana y arroja error claro', async () => {
  db.clearData();
  const cli = db.agregarCliente({
    nombre_completo: 'Test Rollback',
    documento: '9998887',
    direccion: 'San José',
    telefono: '0981999888',
    email: 'rb@example.com',
  });
  const med = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 135,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 135',
    zona: 'SAN JOSE',
    latitud: -25.39,
    longitud: -57.38,
    estado: 'moroso',
  });

  const data = db.getFullData();
  data.facturas.push({
    id: 'fac-135-10',
    medidor_id: med.id,
    cliente_id: cli.id,
    periodo_consumo: '2026-09',
    periodo_facturado: '2026-10',
    fecha_emision: '2026-10-01',
    fecha_vencimiento: '2026-10-31',
    estado: 'vencida',
    total: 85394,
    saldo_pendiente: 85394,
    saldo: 85394,
    monto_pagado: 0,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
    detalles: [{ id: 'd-135-m', factura_id: 'fac-135-10', concepto: 'mora', descripcion: 'Mora', monto: 3000 }],
  });
  data.lecturas.push({
    id: 'lec-135-oct',
    medidor_id: med.id,
    periodo: '2026-10',
    fecha_lectura: '2026-10-28',
    lectura_anterior: 100,
    lectura_actual: 105,
    consumo_m3: 5,
    foto_medidor_url: 'https://example.com/135.jpg',
    estado: 'confirmada',
    registrado_por: 'lector-1',
    fecha_registro: '2026-10-28',
  });

  const deletedIds: string[] = [];
  const sbConstraintError: any = {
    from(table: string) {
      return {
        insert: async () => ({ error: null }),
        update: (payload: any) => ({
          eq: async () => {
            if (table === 'facturas' && payload.estado === 'refinanciada') {
              return { error: { message: 'new row for relation "facturas" violates check constraint "facturas_estado_check"' } };
            }
            return { error: null };
          },
          in: async () => ({ error: null }),
        }),
        delete: () => ({
          eq: async (_col: string, id: string) => {
            if (table === 'facturas') deletedIds.push(id);
            return { error: null };
          },
        }),
      };
    },
  };

  await assert.rejects(
    db.generarFacturaIndividualAsync({
      numeroMedidor: 135,
      periodoConsumo: '2026-10',
      periodoFacturado: '2026-11',
      fechaEmision: '2026-11-01',
      clientOverride: sbConstraintError,
    }),
    /facturas_estado_check/
  );

  assert.equal(deletedIds.length, 1, 'Debe hacer rollback eliminando la factura 2026-11 recién insertada');
  assert.equal(
    db.getFullData().facturas.some((f) => f.periodo_facturado === '2026-11'),
    false,
    'No debe quedar la factura 2026-11 en memoria tras el error'
  );
});



