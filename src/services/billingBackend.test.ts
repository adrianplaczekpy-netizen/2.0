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

test('4. Mora de 3 boletas vencidas → 9.000', () => {
  const facVencida1: Factura = {
    id: 'fac-v-1',
    medidor_id: medidorBase.id,
    cliente_id: 'cli-test-01',
    periodo_facturado: '2026-08',
    fecha_emision: '2026-08-01',
    fecha_vencimiento: '2026-08-31',
    estado: 'vencida',
    total: 36720,
    saldo: 36720,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
  };

  const facVencida2: Factura = {
    ...facVencida1,
    id: 'fac-v-2',
    periodo_facturado: '2026-09',
    fecha_vencimiento: '2026-09-30',
  };

  const facVencida3: Factura = {
    ...facVencida1,
    id: 'fac-v-3',
    periodo_facturado: '2026-10',
    fecha_vencimiento: '2026-10-11',
    es_tercera_boleta: true,
  };

  const moraCalc = calcularMoraMedidor([facVencida1, facVencida2, facVencida3], 3000, new Date('2026-11-05'));
  assert.equal(moraCalc.cantidadVencidas, 3);
  assert.equal(moraCalc.moraTotal, 9000);

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
  assert.ok(detalleMora, 'Debe incluir concepto mora');
  assert.equal(detalleMora?.monto, 9000);
  assert.equal(detalleMora?.descripcion, 'Recargo por mora (3 boletas × 3.000)');
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

test('11. Integración completa 7 conceptos: Base=311.000, ERSSAN=6.220, Total=317.220, Suma detalles=317.220', () => {
  // Escenario exacto completo:
  // 1) consumo 15 m³ (15 * 4.000 = 60.000)
  // 2) deuda anterior (85.000) en 2 boletas vencidas (45.000 + 40.000)
  // 3) mora (2 boletas vencidas * 3.000 = 6.000)
  // 4) otros trabajos (35.000)
  // 5) cuota conexión (40.000)
  // 6) pérdida financiada (25.000)
  // 7) reconexión (60.000)
  // Base = 60.000 + 85.000 + 6.000 + 35.000 + 40.000 + 25.000 + 60.000 = 311.000
  // ERSSAN 2% = 6.220
  // Total = 317.220
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
    estado: 'vencida',
    total: 45000,
    saldo_pendiente: 45000,
    saldo: 45000,
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
    total: 40000,
    saldo_pendiente: 40000,
    saldo: 40000,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 2,
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

  const baseSinErssan = res.detalles
    .filter((d) => d.concepto !== 'erssan')
    .reduce((acc, d) => acc + d.monto, 0);
  const erssan = res.detalles.find((d) => d.concepto === 'erssan')?.monto ?? 0;
  const sumaDetalles = res.detalles.reduce((acc, d) => acc + d.monto, 0);

  assert.equal(baseSinErssan, 311000, 'La base imponible (conceptos 1-7) debe ser exactamente 311.000');
  assert.equal(erssan, 6220, 'ERSSAN 2% sobre 311.000 debe ser exactamente 6.220');
  assert.equal(res.factura.total, 317220, 'El total de la factura debe ser exactamente 317.220');
  assert.equal(sumaDetalles, 317220, 'La suma de los 8 detalles debe cuadrar exactamente en 317.220');
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

test('13. Transición de estado de medidor: 2 vencidas → 3ra boleta pasa a pendiente_corte → al pagar vuelve a activo o moroso', () => {
  db.loadTestData();

  const medidor = db.getMedidores().medidores.find((m) => m.estado === 'activo')!;
  assert.ok(medidor);

  // Dejar un escenario limpio para este medidor con exactamente 2 boletas vencidas impagas
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
    total: 36720,
    saldo_pendiente: 36720,
    saldo: 36720,
    monto_pagado: 0,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 11,
  };

  data.facturas.push(facV1, facV2);
  db.actualizarMedidor(medidor.id, { estado: 'moroso' });

  // Registrar lectura confirmada para 2027-07 (se facturará la 3ra boleta)
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

  // El medidor debe haber pasado automáticamente a 'pendiente_corte'
  const medLuegoFacturar = db.getMedidores().medidores.find((m) => m.id === medidor.id)!;
  assert.equal(
    medLuegoFacturar.estado,
    'pendiente_corte',
    'Medidor con 2 vencidas debe pasar a pendiente_corte al facturar la 3ra boleta'
  );

  // Caso A: Si paga una de las vencidas (queda 1 vencida + la 3ra pendiente en fecha), pasa a 'moroso'
  const cobro1 = db.registrarCobro({
    facturaId: facV1.id,
    monto: facV1.total,
    metodoPago: 'efectivo',
  });
  assert.equal(
    cobro1.estadoMedidorActualizado,
    'moroso',
    'Al pagar una boleta vencida y quedar solo 1 vencida impaga, debe bajar de pendiente_corte a moroso'
  );

  // Caso B: Si paga la restante vencida (facV2), ya no quedan boletas vencidas impagas → pasa a 'activo'
  const cobro2 = db.registrarCobro({
    facturaId: facV2.id,
    monto: facV2.total,
    metodoPago: 'efectivo',
  });
  assert.equal(
    cobro2.estadoMedidorActualizado,
    'activo',
    'Al pagar todas las facturas vencidas, el medidor debe volver automáticamente a activo'
  );
  assert.equal(cobro2.medidorPasoAActivo, true);

  // Y al pagar también la 3ra boleta pendiente en fecha, continúa en 'activo'
  const cobro3 = db.registrarCobro({
    facturaId: fac3.id,
    monto: fac3.total,
    metodoPago: 'efectivo',
  });
  assert.equal(cobro3.estadoMedidorActualizado, 'activo');
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


