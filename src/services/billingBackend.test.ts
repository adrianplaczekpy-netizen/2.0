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
import {
  TARIFAS_DEFAULT,
  calcularConsumoAgua,
  calcularMoraMedidor,
  generarFacturaRegularizacion,
  liquidarReconexion,
  calcularPeriodoSiguiente,
} from './billingRules';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Medidor, Factura, CargoPendiente, PlanFinanciamiento, Lectura, TarifaConfig } from '../types';
import { db } from './database';
import { AuthProvider } from '../context/AuthContext';
import fs from 'node:fs';
import { ModalRegistrarReconexion } from '../components/ModalRegistrarReconexion';
import { FacturaDetalleModal } from '../components/FacturaDetalleModal';
import { CajaCobranzasView } from '../components/CajaCobranzasView';
import { FacturacionView } from '../components/FacturacionView';
import {
  generarBoletaPDF,
  generarComprobantePagoPDF,
  limpiarDescripcionConceptoPDF,
} from './pdfService';
import { LOGO_PNG_BASE64 } from '../assets/logoData';
import {
  calcularIva10Incluido,
  generarSiguienteNumeroRecibo4Digitos,
} from './facturacionHelpers';

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

test('6. ERSSAN 2% calculado sobre todos los conceptos incluidos (incluyendo deuda_anterior)', () => {
  // Conceptos:
  // Agua: 36.000 Gs.
  // Deuda anterior: 40.000 Gs.
  // Mora: 3.000 Gs.
  // Otros trabajos: 20.000 Gs.
  // Cuota de conexión: 10.000 Gs.
  // Base ERSSAN = 40.000 + 36.000 + 3.000 + 20.000 + 10.000 = 109.000 Gs.
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

test('11. Integración completa 7 conceptos: Base ERSSAN=266.000 (deuda N-1 sin mora=40.000, mora=6.000), ERSSAN=5.320, Total=271.320', () => {
  // Escenario exacto completo con consolidación y separación de mora en N-1:
  // 1) consumo 15 m³ (15 * 4.000 = 60.000)
  // 2) deuda anterior = saldo_pendiente_N-1 (43.000) - mora_N-1 (3.000) = 40.000
  // 3) mora = mora_N-1 (3.000) + mora nueva N-1 vencida (3.000) = 6.000
  // 4) otros trabajos (35.000)
  // 5) cuota conexión (40.000)
  // 6) pérdida financiada (25.000)
  // 7) reconexión (60.000)
  // Base ERSSAN (todos los conceptos 1-7) = 40.000 + 60.000 + 6.000 + 35.000 + 40.000 + 25.000 + 60.000 = 266.000
  // ERSSAN 2% = 5.320
  // Total = 266.000 + 5.320 = 271.320
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
  assert.equal(baseSinErssan, 266000, 'La suma de conceptos 1-7 debe ser exactamente 266.000');
  assert.equal(erssan, 5320, 'ERSSAN 2% sobre 266.000 (todos los conceptos) debe ser exactamente 5.320');
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

test('20. Regresión Medidor 103 con separación de mora y ERSSAN completo: 2026-09 refinanciada y 2026-10 impaga (77.234 con mora 3.000) -> 2026-11 deuda=74.234, mora=6.000, ERSSAN=2.325, Total=118.559', async () => {
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
  assert.equal(detErssan?.monto, 2325, 'ERSSAN 2% de (74.234 + 36.000 + 6.000 = 116.234) = 2.325');
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
  assert.equal(cobro.factura?.estado, 'pagada');
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

test('30. Base ERSSAN 2%: incluye TODOS los conceptos (incluyendo deuda_anterior) en factura normal, con mora/deuda, Medidor 132, regularización y edición de lectura', async () => {
  // 1) Factura normal con solo consumo (sin deuda anterior): ERSSAN = 2% de consumo
  const resSoloConsumo = calcularFacturaIndividual({
    medidor: medidorBase,
    clienteId: 'cli-test-01',
    periodo: '2026-11',
    lecturaMes: {
      id: 'lec-30-1',
      medidor_id: medidorBase.id,
      periodo: '2026-10',
      fecha_lectura: '2026-10-25',
      lectura_anterior: 100,
      lectura_actual: 112, // 12 m³ -> 48.000
      consumo_m3: 12,
      foto_medidor_url: '',
      estado: 'confirmada',
      registrado_por: 'user-1',
      fecha_registro: '2026-10-25',
    },
    facturasImpagasAnteriores: [],
    cargosPendientes: [],
    planesFinanciamiento: [],
    correlativoPorMedidor: 1,
    fechaReferencia: new Date('2026-11-01T12:00:00Z'),
    fechaEmision: '2026-11-01',
  });
  assert.equal(resSoloConsumo.detalles.find((d) => d.concepto === 'consumo_agua')?.monto, 48000);
  assert.equal(resSoloConsumo.detalles.find((d) => d.concepto === 'erssan')?.monto, 960);
  assert.equal(resSoloConsumo.factura.total, 48960);

  // 2) Factura con deuda_anterior (50.000) + consumo (40.000) + mora (6.000): Base 96.000 -> ERSSAN = 1.920 -> Total = 97.920
  const facPrev30: Factura = {
    id: 'fac-30-prev',
    medidor_id: 'med-30-2',
    cliente_id: 'cli-test-01',
    periodo_consumo: '2026-09',
    periodo_facturado: '2026-10',
    fecha_emision: '2026-10-01',
    fecha_vencimiento: '2026-10-31',
    estado: 'vencida',
    total: 53000,
    saldo_pendiente: 53000,
    saldo: 53000,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
    detalles: [{ id: 'd-30-m', factura_id: 'fac-30-prev', concepto: 'mora', descripcion: 'Mora', monto: 3000 }],
  };
  const resDeudaMora = calcularFacturaIndividual({
    medidor: { ...medidorBase, id: 'med-30-2', numero_medidor: 202 },
    clienteId: 'cli-test-01',
    periodo: '2026-11',
    lecturaMes: {
      id: 'lec-30-2',
      medidor_id: 'med-30-2',
      periodo: '2026-10',
      fecha_lectura: '2026-10-25',
      lectura_anterior: 200,
      lectura_actual: 210, // 10 m³ -> 40.000
      consumo_m3: 10,
      foto_medidor_url: '',
      estado: 'confirmada',
      registrado_por: 'user-1',
      fecha_registro: '2026-10-25',
    },
    facturasImpagasAnteriores: [facPrev30],
    cargosPendientes: [],
    planesFinanciamiento: [],
    correlativoPorMedidor: 2,
    fechaReferencia: new Date('2026-11-01T12:00:00Z'),
    fechaEmision: '2026-11-01',
  });
  assert.equal(resDeudaMora.detalles.find((d) => d.concepto === 'deuda_anterior')?.monto, 50000);
  assert.equal(resDeudaMora.detalles.find((d) => d.concepto === 'consumo_agua')?.monto, 40000);
  assert.equal(resDeudaMora.detalles.find((d) => d.concepto === 'mora')?.monto, 6000);
  assert.equal(resDeudaMora.detalles.find((d) => d.concepto === 'erssan')?.monto, 1920);
  assert.equal(resDeudaMora.factura.total, 97920);

  // 3) Caso exacto Medidor 132: deuda_anterior = 82.394, consumo = 36.000, mora = 6.000 -> base = 124.394 -> ERSSAN = 2.488, Total = 126.882
  const fac132Oct: Factura = {
    id: 'fac-30-132-10',
    medidor_id: 'med-132-erssan',
    cliente_id: 'cli-test-01',
    periodo_consumo: '2026-09',
    periodo_facturado: '2026-10',
    fecha_emision: '2026-10-01',
    fecha_vencimiento: '2026-10-31',
    estado: 'vencida',
    total: 85394,
    saldo_pendiente: 85394,
    saldo: 85394,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 2,
    detalles: [{ id: 'd-30-132-m', factura_id: 'fac-30-132-10', concepto: 'mora', descripcion: 'Mora', monto: 3000 }],
  };
  const res132 = calcularFacturaIndividual({
    medidor: { ...medidorBase, id: 'med-132-erssan', numero_medidor: 132 },
    clienteId: 'cli-test-01',
    periodo: '2026-11',
    lecturaMes: {
      id: 'lec-30-132',
      medidor_id: 'med-132-erssan',
      periodo: '2026-10',
      fecha_lectura: '2026-10-25',
      lectura_anterior: 300,
      lectura_actual: 306, // 6 m³ -> 36.000
      consumo_m3: 6,
      foto_medidor_url: '',
      estado: 'confirmada',
      registrado_por: 'user-1',
      fecha_registro: '2026-10-25',
    },
    facturasImpagasAnteriores: [fac132Oct],
    cargosPendientes: [],
    planesFinanciamiento: [],
    correlativoPorMedidor: 3,
    fechaReferencia: new Date('2026-11-01T12:00:00Z'),
    fechaEmision: '2026-11-01',
  });
  assert.equal(res132.detalles.find((d) => d.concepto === 'deuda_anterior')?.monto, 82394);
  assert.equal(res132.detalles.find((d) => d.concepto === 'consumo_agua')?.monto, 36000);
  assert.equal(res132.detalles.find((d) => d.concepto === 'mora')?.monto, 6000);
  assert.equal(res132.detalles.find((d) => d.concepto === 'erssan')?.monto, 2488);
  assert.equal(res132.factura.total, 126882);

  // 4) Factura de regularización (reconexión): incluye deuda_anterior en base ERSSAN
  // deuda_anterior = 85.394, mora_congelada = 6.000, cargos = 14.000, reconexión = 60.000
  // Base ERSSAN = 85.394 + 6.000 + 14.000 + 60.000 = 165.394 -> ERSSAN = 3.308 -> Total = 168.702
  const reg = generarFacturaRegularizacion({
    medidor: { ...medidorBase, id: 'med-132-reg', estado: 'cortado', mora_congelada: 6000 },
    clienteId: 'cli-test-01',
    facturasImpagas: [fac132Oct],
    cargosPendientes: [{ id: 'cg-reg-1', descripcion: 'Llave de paso', monto: 14000 }],
    fechaEmision: '2026-11-20',
    correlativoPorMedidor: 4,
  });
  assert.equal(reg.detalles.find((d) => d.concepto === 'deuda_anterior')?.monto, 85394);
  assert.equal(reg.detalles.find((d) => d.concepto === 'erssan')?.monto, 3308);
  assert.equal(reg.factura.total, 168702);

  // 5) Recálculo de ERSSAN al editar una lectura con factura impaga asociada (incluye deuda_anterior)
  db.clearData();
  const cli = db.agregarCliente({
    nombre_completo: 'Cliente Edicion ERSSAN',
    documento: '2030203',
    direccion: 'San Gabriel',
    telefono: '0981203203',
    email: 'ed203@example.com',
  });
  const med = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 203,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 203',
    zona: 'SAN GABRIEL',
    latitud: -25.39,
    longitud: -57.38,
    estado: 'moroso',
  });
  const data = db.getFullData();
  data.facturas.push({
    id: 'fac-203-10',
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
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
    detalles: [{ id: 'd-203-m', factura_id: 'fac-203-10', concepto: 'mora', descripcion: 'Mora', monto: 3000 }],
  });
  const lec = db.registrarLectura({
    numeroMedidor: 203,
    lecturaActual: 105,
    fechaLectura: '2026-10-25',
    fotoUrl: 'https://example.com/203.jpg',
    registradoPor: 'lector-1',
    estado: 'confirmada',
  }).lectura;
  lec.lectura_anterior = 100;
  lec.consumo_m3 = 5;

  const gen203 = await db.generarFacturaIndividualAsync({
    numeroMedidor: 203,
    periodoConsumo: '2026-10',
    periodoFacturado: '2026-11',
    fechaEmision: '2026-11-01',
  });
  assert.equal(gen203.detalles.find((d) => d.concepto === 'erssan')?.monto, 2488);
  assert.equal(gen203.factura.total, 126882);

  // Editar lectura a 115 (15 m³ -> consumo 60.000): Base ERSSAN = 82.394 + 60.000 + 6.000 = 148.394 -> ERSSAN = 2.968, Total = 148.394 + 2.968 = 151.362
  await db.actualizarLecturaAsync(
    lec.id,
    { lecturaActual: 115, motivoEdicion: 'Corrección de dígito en foto de medidor' },
    { id: 'admin-1', rol: 'admin', nombre: 'Admin' }
  );
  const fac203Actualizada = db.getFullData().facturas.find((f) => f.id === gen203.factura.id)!;
  assert.equal(fac203Actualizada.detalles?.find((d) => d.concepto === 'consumo_agua')?.monto, 60000);
  assert.equal(fac203Actualizada.detalles?.find((d) => d.concepto === 'erssan')?.monto, 2968);
  assert.equal(fac203Actualizada.total, 151362);
});

test('31. Reconexión con checkbox marcado (incluirReconexion=true): cobra reconexión en regularización y NO crea cargo pendiente', async () => {
  db.clearData();
  const cli = db.agregarCliente({
    nombre_completo: 'Cliente Reconexión Incluida',
    documento: '3103101',
    direccion: 'San José',
    telefono: '0981310310',
    email: 'rec1@example.com',
  });
  const med = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 310,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 310',
    zona: 'SAN JOSE',
    latitud: -25.39,
    longitud: -57.38,
    estado: 'cortado',
  });
  med.mora_congelada = 6000;
  med.fecha_corte = '2026-11-05';

  db.getFullData().facturas.push({
    id: 'fac-310-10',
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
  });

  // Base = 85.394 + 6.000 + 60.000 = 151.394 -> ERSSAN = 3.028 -> Total = 154.422
  const res = await db.confirmarReconexionAsync(med.id, {
    cobradorId: 'admin-1',
    metodoPago: 'efectivo',
    fechaReconexion: '2026-11-20',
    incluirReconexion: true,
  });

  assert.equal(res.medidor.estado, 'activo');
  assert.equal(res.facturaRegularizacion.detalles?.find((d) => d.concepto === 'reconexion')?.monto, 60000);
  assert.equal(res.facturaRegularizacion.detalles?.find((d) => d.concepto === 'erssan')?.monto, 3028);
  assert.equal(res.facturaRegularizacion.total, 154422);
  assert.equal(res.cargoReconexionDiferida, null);
  assert.equal(db.getFullData().cargos_pendientes.length, 0);
});

test('32. Reconexión con checkbox desmarcado (incluirReconexion=false): excluye reconexión de regularización y crea cargo_pendiente "RECONEXIÓN" para próximo mes', async () => {
  assert.equal(calcularPeriodoSiguiente('2026-11'), '2026-12');
  assert.equal(calcularPeriodoSiguiente('2026-12'), '2027-01');

  db.clearData();
  const cli = db.agregarCliente({
    nombre_completo: 'Cliente Reconexión Diferida',
    documento: '3203202',
    direccion: 'Centro',
    telefono: '0981320320',
    email: 'rec2@example.com',
  });
  const med = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 320,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 320',
    zona: 'Centro',
    latitud: -25.39,
    longitud: -57.38,
    estado: 'cortado',
  });
  med.mora_congelada = 6000;
  med.fecha_corte = '2026-11-05';

  db.getFullData().facturas.push({
    id: 'fac-320-10',
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
  });

  // Verificar liquidación previa sin reconexión: base = 85.394 + 6.000 = 91.394 -> ERSSAN = 1.828 -> Total = 93.222
  const liqSinRec = liquidarReconexion(med, db.getFullData().facturas, TARIFAS_DEFAULT, [], false);
  assert.equal(liqSinRec.montoReconexion, 0);
  assert.equal(liqSinRec.montoErssan, 1828);
  assert.equal(liqSinRec.totalPagar, 93222);

  const insertedTables: Array<{ table: string; payload: any }> = [];
  const fakeSb: any = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: '00000000-0000-4000-8000-000000000123' } } },
      }),
    },
    from: (table: string) => ({
      insert: async (payload: any) => {
        insertedTables.push({ table, payload });
        return { error: null };
      },
      update: () => ({
        eq: async () => ({ error: null }),
        in: async () => ({ error: null }),
      }),
    }),
  };

  const res = await db.confirmarReconexionAsync(
    med.id,
    {
      cobradorId: '00000000-0000-4000-8000-000000000123',
      registradoPor: '00000000-0000-4000-8000-000000000123',
      metodoPago: 'efectivo',
      fechaReconexion: '2026-11-20',
      lecturaInicial: 250,
      incluirReconexion: false,
    },
    { clientOverride: fakeSb }
  );

  // Regularización sin concepto 'reconexion'
  assert.equal(res.medidor.estado, 'activo');
  assert.equal(res.facturaRegularizacion.detalles?.some((d) => d.concepto === 'reconexion'), false);
  assert.equal(res.facturaRegularizacion.detalles?.find((d) => d.concepto === 'erssan')?.monto, 1828);
  assert.equal(res.facturaRegularizacion.total, 93222);

  // Cargo pendiente creado en memoria y en Supabase
  const cargo = res.cargoReconexionDiferida;
  assert.ok(cargo, 'Debe crear el cargo pendiente diferido');
  assert.equal(cargo?.medidor_id, med.id);
  assert.equal(cargo?.cliente_id, cli.id);
  assert.equal(cargo?.descripcion, 'RECONEXIÓN');
  assert.equal(cargo?.monto, 60000);
  assert.equal(cargo?.periodo_facturacion, '2026-12');
  assert.equal(cargo?.estado, 'pendiente');
  assert.equal(cargo?.fecha_trabajo, '2026-11-20');
  assert.equal(cargo?.registrado_por, '00000000-0000-4000-8000-000000000123');

  const cargoEnDb = db.getFullData().cargos_pendientes.find((c) => c.id === cargo?.id);
  assert.ok(cargoEnDb);
  assert.equal(cargoEnDb?.estado, 'pendiente');

  const insertCargoSb = insertedTables.find((t) => t.table === 'cargos_pendientes');
  assert.ok(insertCargoSb, 'Debe insertar cargo_pendiente en Supabase');
  assert.equal(insertCargoSb?.payload.descripcion, 'RECONEXIÓN');
  assert.equal(insertCargoSb?.payload.periodo_facturacion, '2026-12');
  assert.equal(insertCargoSb?.payload.monto, 60000);
});

test('33. Mes siguiente incluye cargo diferido RECONEXIÓN con concepto reconexion y suma a ERSSAN; pago e impago en ciclo siguiente', async () => {
  db.clearData();
  const cli = db.agregarCliente({
    nombre_completo: 'Cliente Mes Siguiente Reconexión',
    documento: '3303303',
    direccion: 'San Gabriel',
    telefono: '0981330330',
    email: 'rec3@example.com',
  });
  const med = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 330,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 330',
    zona: 'SAN GABRIEL',
    latitud: -25.39,
    longitud: -57.38,
    estado: 'cortado',
  });
  med.mora_congelada = 3000;
  med.fecha_corte = '2026-11-05';

  db.getFullData().facturas.push({
    id: 'fac-330-10',
    medidor_id: med.id,
    cliente_id: cli.id,
    periodo_consumo: '2026-09',
    periodo_facturado: '2026-10',
    fecha_emision: '2026-10-01',
    fecha_vencimiento: '2026-10-31',
    estado: 'vencida',
    total: 36720,
    saldo_pendiente: 36720,
    saldo: 36720,
    monto_pagado: 0,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
  });

  // Reconexión en 2026-11 con diferimiento a 2026-12 y lectura inicial 100 m³
  const rec = await db.confirmarReconexionAsync(med.id, {
    cobradorId: 'admin',
    metodoPago: 'efectivo',
    fechaReconexion: '2026-11-18',
    lecturaInicial: 100,
    incluirReconexion: false,
  });
  assert.equal(rec.cargoReconexionDiferida?.periodo_facturacion, '2026-12');

  // Lectura confirmada de consumo de noviembre (para facturar 2026-12): 105 m³ (consumo 5 m³ -> mínimo 36.000)
  db.getFullData().lecturas.push({
    id: 'lec-330-nov',
    medidor_id: med.id,
    periodo: '2026-11',
    fecha_lectura: '2026-11-28',
    lectura_anterior: 100,
    lectura_actual: 105,
    consumo_m3: 5,
    foto_medidor_url: 'https://example.com/330-nov.jpg',
    estado: 'confirmada',
    registrado_por: 'lector-1',
    fecha_registro: '2026-11-28',
  });

  // Facturar 2026-12: consumo 36.000 + RECONEXIÓN 60.000 = base 96.000 -> ERSSAN 1.920 -> Total 97.920
  const genDic = await db.generarFacturaIndividualAsync({
    numeroMedidor: 330,
    periodoConsumo: '2026-11',
    periodoFacturado: '2026-12',
    fechaEmision: '2026-12-01',
  });

  const detRec = genDic.detalles.find((d) => d.concepto === 'reconexion');
  assert.ok(detRec, 'Debe aparecer concepto reconexion en la boleta de 2026-12');
  assert.equal(detRec?.descripcion, 'RECONEXIÓN');
  assert.equal(detRec?.monto, 60000);
  assert.equal(detRec?.cargo_pendiente_id, rec.cargoReconexionDiferida?.id);
  assert.equal(
    genDic.detalles.some((d) => d.concepto === 'otros_trabajos'),
    false,
    'NO debe aparecer como Otros trabajos'
  );
  assert.equal(genDic.detalles.find((d) => d.concepto === 'erssan')?.monto, 1920);
  assert.equal(genDic.factura.total, 97920);

  // El cargo_pendiente pasa a 'facturado'
  const cargoFacturado = db
    .getFullData()
    .cargos_pendientes.find((c) => c.id === rec.cargoReconexionDiferida?.id);
  assert.equal(cargoFacturado?.estado, 'facturado');
  assert.equal(cargoFacturado?.factura_id, genDic.factura.id);

  // Caso A: Si no paga 2026-12 y vence, al facturar 2027-01 los 60.000 quedan en deuda_anterior
  const facDic = db.getFullData().facturas.find((f) => f.id === genDic.factura.id)!;
  facDic.estado = 'vencida';
  facDic.fecha_vencimiento = '2026-12-31';

  db.getFullData().lecturas.push({
    id: 'lec-330-dic',
    medidor_id: med.id,
    periodo: '2026-12',
    fecha_lectura: '2026-12-28',
    lectura_anterior: 105,
    lectura_actual: 110,
    consumo_m3: 5,
    foto_medidor_url: 'https://example.com/330-dic.jpg',
    estado: 'confirmada',
    registrado_por: 'lector-1',
    fecha_registro: '2026-12-28',
  });

  const genEne = await db.generarFacturaIndividualAsync({
    numeroMedidor: 330,
    periodoConsumo: '2026-12',
    periodoFacturado: '2027-01',
    fechaEmision: '2027-01-01',
  });
  // deuda_anterior = 97.920 (incluye consumo 36k + reconexión 60k + erssan 1.920), consumo = 36.000, mora = 3.000
  // base ERSSAN = 97.920 + 36.000 + 3.000 = 136.920 -> ERSSAN = 2.738 -> Total = 139.658
  assert.equal(genEne.detalles.find((d) => d.concepto === 'deuda_anterior')?.monto, 97920);
  assert.equal(genEne.detalles.find((d) => d.concepto === 'mora')?.monto, 3000);
  assert.equal(genEne.detalles.find((d) => d.concepto === 'erssan')?.monto, 2738);
  assert.equal(genEne.factura.total, 139658);

  // Caso B: Pago directo de la factura del mes siguiente (otro medidor) que incluye reconexión diferida
  const medPagoDirecto = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 331,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 331',
    zona: 'SAN GABRIEL',
    latitud: -25.39,
    longitud: -57.38,
    estado: 'cortado',
  });
  medPagoDirecto.mora_congelada = 0;

  const rec331 = await db.confirmarReconexionAsync(medPagoDirecto.id, {
    cobradorId: 'admin',
    metodoPago: 'efectivo',
    fechaReconexion: '2026-11-18',
    lecturaInicial: 0,
    incluirReconexion: false,
  });
  assert.equal(rec331.cargoReconexionDiferida?.periodo_facturacion, '2026-12');

  db.getFullData().lecturas.push({
    id: 'lec-331-nov',
    medidor_id: medPagoDirecto.id,
    periodo: '2026-11',
    fecha_lectura: '2026-11-28',
    lectura_anterior: 0,
    lectura_actual: 4,
    consumo_m3: 4,
    foto_medidor_url: 'https://example.com/331-nov.jpg',
    estado: 'confirmada',
    registrado_por: 'lector-1',
    fecha_registro: '2026-11-28',
  });

  const gen331Dic = await db.generarFacturaIndividualAsync({
    numeroMedidor: 331,
    periodoConsumo: '2026-11',
    periodoFacturado: '2026-12',
    fechaEmision: '2026-12-01',
  });
  assert.equal(gen331Dic.factura.total, 97920);
  const cobro331 = db.registrarCobro({
    facturaId: gen331Dic.factura.id,
    monto: 97920,
    metodoPago: 'efectivo',
  });
  assert.equal(cobro331.factura?.estado, 'pagada');
  assert.equal(cobro331.estadoMedidorActualizado, 'activo');
  assert.equal(db.getMedidorDetalle(medPagoDirecto.id)?.totalDeuda, 0);
});

test('34. UI ModalRegistrarReconexion: header sticky compacto, contenedor scrolleable max-h-[90vh], y checkbox visible debajo de Paso 3 antes de Confirmar', () => {
  db.clearData();
  const cli = db.agregarCliente({
    nombre_completo: 'Cliente Modal UI',
    documento: '3403404',
    direccion: 'Centro',
    telefono: '0981340340',
    email: 'modal34@example.com',
  });
  const med = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 340,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 340',
    zona: 'Centro',
    latitud: -25.39,
    longitud: -57.38,
    estado: 'cortado',
  });
  med.mora_congelada = 3000;

  const html = renderToStaticMarkup(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(ModalRegistrarReconexion, {
        medidorId: med.id,
        isOpen: true,
        onClose: () => {},
        onSuccess: () => {},
      })
    )
  );

  // 1) Contenedor acotado a max-h-[90vh] + flex-col + header sticky compacto + scroll interno
  assert.ok(html.includes('max-h-[90vh]'), 'El modal debe limitar altura a max-h-[90vh]');
  assert.ok(html.includes('sticky top-0 z-10'), 'El header debe ser sticky top-0 z-10');
  assert.ok(html.includes('p-3 sm:p-5'), 'El header debe ser compacto en mobile (p-3 sm:p-5)');
  assert.ok(html.includes('overflow-y-auto flex-1'), 'El cuerpo del modal debe tener scroll interno');
  assert.ok(
    html.includes('p-4 pt-5 sm:p-6 sm:pt-6'),
    'El formulario debe tener padding compacto en mobile y espacio superior sobre el primer paso'
  );

  // 2) Checkbox contrastado, scroll-mt-20 y texto text-sm
  assert.ok(html.includes('scroll-mt-20'), 'El checkbox debe incluir scroll-mt-20');
  assert.ok(
    html.includes('bg-emerald-50 border-2 border-emerald-400'),
    'El checkbox debe tener fondo contrastado bg-emerald-50 border-2 border-emerald-400'
  );
  assert.ok(
    html.includes('text-sm font-bold'),
    'El label del checkbox debe usar text-sm'
  );

  // 3) Orden visual exacto: Header -> Paso 1 -> Paso 2 -> Paso 3 -> Checkbox -> Botón Confirmar
  const idxHeader = html.indexOf('Registrar Reconexión de Medidor');
  const idxPaso1 = html.indexOf('Factura de Regularización del Medidor');
  const idxPaso2 = html.indexOf('Registro de Cobranza del Pago');
  const idxPaso3 = html.indexOf('Reinstalación de Medidor (o nuevo medidor)');
  const idxCheckbox = html.indexOf('id="incluir-reconexion-checkbox"');
  const idxConfirmar = html.indexOf('Confirmar Pago, Regularización y Reconexión');

  assert.ok(idxHeader >= 0 && idxPaso1 > idxHeader);
  assert.ok(idxPaso2 > idxPaso1);
  assert.ok(idxPaso3 > idxPaso2);
  assert.ok(idxCheckbox > idxPaso3, 'El checkbox debe ir después del Paso 3');
  assert.ok(idxConfirmar > idxCheckbox, 'El checkbox debe ir antes del botón Confirmar');
});

test('35. generarComprobantePagoPDF genera recibo A5 vertical (148x210mm), sin marca de agua gigante y sin alterar generarBoletaPDF (A4)', () => {
  const cli = {
    id: 'cli-pdf-35',
    nombre_completo: 'María Fernanda González de Benítez',
    documento: '4.567.890',
    direccion: 'Av. Mariscal López 450',
    telefono: '0981222333',
    email: 'maria@example.com',
    fecha_alta: '2026-01-01',
  };
  const med: Medidor = {
    ...medidorBase,
    id: 'med-pdf-35',
    cliente_id: cli.id,
    numero_medidor: 132,
  };
  const fac: Factura = {
    id: 'fac-pdf-35',
    medidor_id: med.id,
    cliente_id: cli.id,
    periodo_consumo: '2026-10',
    periodo_facturado: '2026-11',
    fecha_emision: '2026-11-01',
    fecha_vencimiento: '2026-11-30',
    fecha_pago: '2026-11-25',
    estado: 'pagada',
    total: 126882,
    saldo_pendiente: 0,
    saldo: 0,
    monto_pagado: 126882,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 7,
    consumo_m3: 6,
    detalles: [
      { id: 'd1', factura_id: 'fac-pdf-35', concepto: 'consumo_agua', descripcion: 'Consumo mínimo hasta 9 m³ (6 m³)', monto: 36000 },
      { id: 'd2', factura_id: 'fac-pdf-35', concepto: 'deuda_anterior', descripcion: 'Deuda anterior período 2026-10', monto: 82394 },
      { id: 'd3', factura_id: 'fac-pdf-35', concepto: 'mora', descripcion: 'Recargo por mora (2 boletas vencidas)', monto: 6000 },
      { id: 'd4', factura_id: 'fac-pdf-35', concepto: 'erssan', descripcion: 'Aporte Ley ERSSAN (2%)', monto: 2488 },
    ],
  };

  // 1) Recibo de pago total en A5 vertical
  const docRecibo = generarComprobantePagoPDF({
    factura: fac,
    cliente: cli,
    medidor: med,
    numeroRecibo: 'REC-20261125-0001',
    fechaPago: '2026-11-25',
    horaPago: '10:42',
    montoAbonado: 126882,
    metodoPago: 'transferencia',
    cobradorNombre: 'Ramona Benítez',
    saldoRestante: 0,
  });

  const widthA5 = Math.round(docRecibo.internal.pageSize.getWidth());
  const heightA5 = Math.round(docRecibo.internal.pageSize.getHeight());
  assert.equal(widthA5, 148, 'El comprobante debe ser A5 ancho 148mm');
  assert.equal(heightA5, 210, 'El comprobante debe ser A5 alto 210mm');
  assert.equal(docRecibo.getNumberOfPages(), 1, 'Debe caber en 1 página A5');

  const pdfText = docRecibo.output('datauristring') + '\n' + docRecibo.output();
  assert.ok(!pdfText.includes('PAGADA'), 'No debe incluir la marca de agua gigante PAGADA');
  assert.ok(!pdfText.includes('AGUATER'), 'No debe incluir el texto viejo de AGUATERÍA POTABLE PARAGUAY S.A.');
  assert.ok(!pdfText.includes('RECIBO DE CAJA'), 'No debe incluir el título eliminado RECIBO DE CAJA');
  assert.ok(!pdfText.includes('Recibo N'), 'No debe incluir la línea Recibo N°');
  assert.ok(!pdfText.includes('REC-20261125-0001'), 'No debe mostrar el número de recibo eliminado');
  assert.ok(!pdfText.includes('Per\\355odo Facturado') && !pdfText.includes('Período Facturado'), 'No debe incluir Período Facturado en el recuadro de fechas');
  assert.ok(pdfText.includes('PAGADO'), 'Debe incluir el sello compacto PAGADO');
  assert.ok(pdfText.includes('COMPROBANTE OFICIAL DE PAGO'), 'Debe incluir el título único COMPROBANTE OFICIAL DE PAGO');
  assert.ok(pdfText.includes('3950638-0'), 'Debe incluir el RUC real');
  assert.ok(pdfText.includes('19148339'), 'Debe incluir el Timbrado real');
  assert.ok(pdfText.includes('01/10/2026'), 'Debe incluir Inicio Vigencia');
  assert.ok(pdfText.includes('31/10/2027'), 'Debe incluir Fin Vigencia');
  assert.ok(pdfText.includes('001-002-0000007'), 'Debe incluir el número de factura formato SET');
  assert.ok(pdfText.includes('2026-11-25 10:42'), 'Debe incluir fecha y hora del pago');
  assert.ok(pdfText.includes('2026-11-01'), 'Debe incluir fecha de emisión');
  assert.ok(pdfText.includes('2026-11-30'), 'Debe incluir fecha de vencimiento');
  assert.ok(!pdfText.includes('Per\\355odo de Consumo:') && !pdfText.includes('Período de Consumo:'), 'Debe quitar Período de Consumo del lado derecho del Medidor');
  assert.ok(!pdfText.includes('DETALLE DE CONCEPTOS'), 'Debe reemplazar DETALLE DE CONCEPTOS por período de consumo');
  assert.ok(pdfText.includes('DE CONSUMO: 2026-10'), 'Título de tabla debe incluir PERÍODO DE CONSUMO');
  assert.ok(!pdfText.includes('| EMISI'), 'Factura Legal no debe mostrar | EMISIÓN en el título de la tabla');
  assert.ok(pdfText.includes('DEUDA ANTERIOR'), 'Concepto DEUDA ANTERIOR debe estar en MAYÚSCULAS');
  assert.ok(pdfText.includes('RECARGO POR MORA'), 'Concepto RECARGO POR MORA debe estar en MAYÚSCULAS');
  assert.ok(pdfText.includes('APORTE LEY ERSSAN'), 'Concepto ERSSAN debe estar en MAYÚSCULAS');
  assert.ok(!pdfText.includes('(2%)') && !pdfText.includes('(6 m'), 'Debe eliminar paréntesis y su contenido en conceptos');
  assert.ok(!pdfText.includes('Deuda anterior'), 'No debe quedar concepto en minúsculas');
  assert.ok(!pdfText.includes('Recargo por mora'), 'No debe quedar concepto en minúsculas');
  // Verificar que los 4 conceptos generaron exactamente 2 líneas horizontales intercaladas (idx 1 y idx 3) en la tabla
  const rawStream = docRecibo.output();
  const fullWidthLines = rawStream.split(/\r?\n/).filter((l) => l.includes('385.511811') && l.endsWith(' l'));
  assert.ok(fullWidthLines.length >= 5, 'Debe incluir líneas divisoras y las líneas horizontales intercaladas de conceptos');
  // Verificar la distancia entre la línea del concepto 2 (idx=1) y concepto 4 (idx=3): ~38.55pt (2 filas)
  const yCoords = fullWidthLines.map((l) => Number(l.split(' ')[1]));
  const hasAlternatingSpacing = yCoords.some((y1, i) =>
    yCoords.some((y2, j) => j !== i && Math.abs(Math.abs(y1 - y2) - 38.55) < 1.5)
  );
  assert.ok(hasAlternatingSpacing, 'Las líneas de conceptos deben estar intercaladas (fila 2 y fila 4)');
  assert.ok(pdfText.includes('TOTAL ABONADO:'));
  assert.ok(pdfText.includes('126.882 Gs.'));
  assert.ok(pdfText.includes('Transferencia Bancaria'));
  assert.ok(pdfText.includes('Gracias por su pago!'));
  // Fuente TOTAL ABONADO 15pt presente en stream PDF (/F2 15 Tf)
  assert.ok(pdfText.includes('15 Tf'), 'El total abonado debe renderizarse en 15pt');

  // 2) Pago parcial muestra PAGO PARCIAL y saldo pendiente
  const docParcial = generarComprobantePagoPDF({
    factura: { ...fac, estado: 'pendiente', saldo_pendiente: 50000, monto_pagado: 76882 },
    cliente: cli,
    medidor: med,
    numeroRecibo: 'REC-20261125-0002',
    fechaPago: '2026-11-25',
    horaPago: '11:05',
    montoAbonado: 76882,
    metodoPago: 'efectivo',
    cobradorNombre: 'Caja Central',
    saldoRestante: 50000,
  });
  const parcialRaw = docParcial.output();
  assert.ok(parcialRaw.includes('PAGO PARCIAL'));
  assert.ok(parcialRaw.includes('Saldo pendiente:'));
  assert.ok(parcialRaw.includes('50.000 Gs.'));

  // 3) La factura mensual (generarBoletaPDF) permanece en A4 (210x297mm), SIN marca PAGADA, CON logo y datos legales + SET
  const docBoleta = generarBoletaPDF({
    factura: { ...fac, numero_factura: '001-002-0000009' },
    cliente: cli,
    medidor: med,
  });
  assert.equal(Math.round(docBoleta.internal.pageSize.getWidth()), 210);
  assert.equal(Math.round(docBoleta.internal.pageSize.getHeight()), 297);
  const boletaRaw = docBoleta.output();
  assert.ok(!boletaRaw.includes('PAGADA'), 'generarBoletaPDF no debe contener la vieja marca de agua gigante PAGADA');
  assert.ok(!boletaRaw.includes('Boleta N'), 'No debe mostrar el formato viejo Boleta N°');
  assert.ok(!boletaRaw.includes('AGUATER'), 'No debe incluir el texto viejo AGUATERÍA POTABLE PARAGUAY S.A.');
  assert.ok(boletaRaw.includes('3950638-0'), 'La boleta A4 debe incluir el RUC real');
  assert.ok(boletaRaw.includes('19148339'), 'La boleta A4 debe incluir el Timbrado real');
  assert.ok(boletaRaw.includes('01/10/2026'), 'La boleta A4 debe incluir Inicio Vigencia');
  assert.ok(boletaRaw.includes('31/10/2027'), 'La boleta A4 debe incluir Fin Vigencia');
  assert.ok(boletaRaw.includes('001-002-0000009'), 'La boleta A4 debe incluir el número de factura SET');
  assert.ok(boletaRaw.includes('/XObject'), 'La boleta A4 debe embeber la imagen del logo');

  // Verificar que logoData coincide exactamente con src/assets/logo.png
  const logoDiskBase64 = fs.readFileSync('src/assets/logo.png').toString('base64');
  assert.equal(LOGO_PNG_BASE64, logoDiskBase64, 'logoData debe coincidir exactamente con src/assets/logo.png');

  // 4) El modal de detalle de factura pagada NO tiene botón duplicado "Recibo A5" y el botón original dice "Recibo de Pago"
  const cliModal = db.agregarCliente({
    nombre_completo: 'María Fernanda Modal',
    documento: '4.999.888',
    direccion: 'Av. Mariscal López 450',
    telefono: '0981222333',
    email: 'maria-modal@example.com',
  });
  const medModal = db.agregarMedidor({
    cliente_id: cliModal.id,
    numero_medidor: 935,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 935',
    zona: 'Centro',
    latitud: -25.39,
    longitud: -57.38,
    estado: 'activo',
  });
  const facModal: Factura = {
    ...fac,
    id: 'fac-modal-35',
    medidor_id: medModal.id,
    cliente_id: cliModal.id,
  };
  db.getFullData().facturas.push(facModal);
  db.getFullData().pagos.push({
    id: 'pago-modal-35',
    factura_id: facModal.id,
    fecha_pago: '2026-11-25',
    monto: 126882,
    metodo_pago: 'transferencia',
    cobrador_id: 'usr-admin',
    numero_recibo: 'REC-20261125-0935',
  });

  const modalHtml = renderToStaticMarkup(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(FacturaDetalleModal, {
        facturaId: facModal.id,
        onClose: () => {},
        onNotify: () => {},
      })
    )
  );
  assert.ok(!modalHtml.includes('Recibo A5'), 'No debe existir el botón duplicado Recibo A5');
  assert.ok(modalHtml.includes('Recibo de Pago'), 'El botón original debe mostrar Recibo de Pago para facturas pagadas');
});

test('36. Numeración secuencial SET (001-002-XXXXXXX) es única e incremental en facturación mensual, individual y reconexión', async () => {
  db.clearData();

  const cli1 = db.agregarCliente({
    nombre_completo: 'Cliente Secuencia Uno',
    documento: '5.111.111',
    direccion: 'San Gabriel 1',
    telefono: '0981111111',
    email: 'uno@example.com',
  });
  const cli2 = db.agregarCliente({
    nombre_completo: 'Cliente Secuencia Dos',
    documento: '5.222.222',
    direccion: 'San Gabriel 2',
    telefono: '0981222222',
    email: 'dos@example.com',
  });

  const med1 = db.agregarMedidor({
    cliente_id: cli1.id,
    numero_medidor: 1,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 1',
    zona: 'San Gabriel',
    latitud: -25.4,
    longitud: -57.3,
    estado: 'activo',
  });
  const med2 = db.agregarMedidor({
    cliente_id: cli2.id,
    numero_medidor: 2,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 2',
    zona: 'San Gabriel',
    latitud: -25.4,
    longitud: -57.3,
    estado: 'activo',
  });
  const medCortado = db.agregarMedidor({
    cliente_id: cli2.id,
    numero_medidor: 3,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 3',
    zona: 'San Gabriel',
    latitud: -25.4,
    longitud: -57.3,
    estado: 'cortado',
  });
  medCortado.mora_congelada = 3000;

  // Lecturas confirmadas para med1 y med2 en 2026-10
  db.getFullData().lecturas.push(
    {
      id: 'lec-seq-1',
      medidor_id: med1.id,
      periodo: '2026-10',
      fecha_lectura: '2026-10-28',
      lectura_anterior: 0,
      lectura_actual: 10,
      consumo_m3: 10,
      foto_medidor_url: 'https://example.com/1.jpg',
      estado: 'confirmada',
      registrado_por: 'lec-1',
      fecha_registro: '2026-10-28',
    },
    {
      id: 'lec-seq-2',
      medidor_id: med2.id,
      periodo: '2026-10',
      fecha_lectura: '2026-10-28',
      lectura_anterior: 0,
      lectura_actual: 8,
      consumo_m3: 8,
      foto_medidor_url: 'https://example.com/2.jpg',
      estado: 'confirmada',
      registrado_por: 'lec-1',
      fecha_registro: '2026-10-28',
    }
  );

  // 1) Corrida mensual: med1 -> 001-002-0000001, med2 -> 001-002-0000002
  const resumen = db.ejecutarFacturacionMensual('2026-11', '2026-11-01');
  assert.equal(resumen.totalGeneradas, 2);
  assert.equal(resumen.facturasGeneradas[0].numero_factura, '001-002-0000001');
  assert.equal(resumen.facturasGeneradas[1].numero_factura, '001-002-0000002');

  // 2) Factura individual en período siguiente -> 001-002-0000003
  db.getFullData().lecturas.push({
    id: 'lec-seq-1-nov',
    medidor_id: med1.id,
    periodo: '2026-11',
    fecha_lectura: '2026-11-28',
    lectura_anterior: 10,
    lectura_actual: 18,
    consumo_m3: 8,
    foto_medidor_url: 'https://example.com/1b.jpg',
    estado: 'confirmada',
    registrado_por: 'lec-1',
    fecha_registro: '2026-11-28',
  });
  const ind = await db.generarFacturaIndividualAsync({
    numeroMedidor: 1,
    periodoConsumo: '2026-11',
    periodoFacturado: '2026-12',
    fechaEmision: '2026-12-01',
  });
  assert.equal(ind.factura.numero_factura, '001-002-0000003');

  // 3) Factura de regularización por reconexión -> 001-002-0000004
  const reg = db.confirmarReconexion(medCortado.id, {
    metodoPago: 'efectivo',
    lecturaInicial: 15,
    fechaReconexion: '2026-12-05',
  });
  assert.equal(reg.facturaRegularizacion.numero_factura, '001-002-0000004');
});

test('37. Numeración independiente 4 dígitos vs 7 dígitos y Concepto Personalizado totalmente independiente (factura_id = null, sin tocar deuda de agua)', async () => {
  db.clearData();

  // La secuencia de 4 dígitos ignora facturas/recibos de 7 dígitos
  const seqInicial = generarSiguienteNumeroRecibo4Digitos([
    { numero_recibo: '001-002-0000040', tipo_comprobante: 'factura_legal' },
  ]);
  assert.equal(seqInicial, '001-002-0001');

  const cli = db.agregarCliente({
    nombre_completo: 'Carlos Recibo Fiscal',
    documento: '3.222.111',
    direccion: 'Calle Palma 120',
    telefono: '0981444555',
    email: 'carlos@example.com',
  });
  const med = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 501,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 501',
    zona: 'San Gabriel',
    latitud: -25.39,
    longitud: -57.38,
    estado: 'moroso',
  });

  const fac1: Factura = {
    id: 'fac-37-1',
    medidor_id: med.id,
    cliente_id: cli.id,
    periodo_consumo: '2026-10',
    periodo_facturado: '2026-11',
    fecha_emision: '2026-11-01',
    fecha_vencimiento: '2026-11-30',
    estado: 'pendiente',
    total: 36720,
    saldo_pendiente: 36720,
    saldo: 36720,
    monto_pagado: 0,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
    numero_factura: '001-002-0000045',
    consumo_m3: 8,
  };
  const fac2: Factura = {
    ...fac1,
    id: 'fac-37-2',
    periodo_consumo: '2026-11',
    periodo_facturado: '2026-12',
    estado: 'vencida',
    numero_boleta_medidor: 2,
    numero_factura: '001-002-0000046',
  };
  db.getFullData().facturas.push(fac1, fac2);

  // 1) Cobro estándar con RECIBO SIN VALOR FISCAL -> 001-002-0001 (4 dígitos) sí cancela fac1
  const pagoRecibo1 = await db.registrarCobroAsync({
    facturaId: fac1.id,
    monto: 36720,
    metodoPago: 'efectivo',
    tipoComprobante: 'recibo_sin_valor_fiscal',
  });
  assert.equal(pagoRecibo1.pago.tipo_comprobante, 'recibo_sin_valor_fiscal');
  assert.equal(pagoRecibo1.pago.numero_recibo, '001-002-0001');
  assert.equal(pagoRecibo1.pago.factura_id, fac1.id);
  assert.equal(fac1.estado, 'pagada');
  assert.equal(fac1.saldo_pendiente, 0);
  assert.equal(db.getSiguienteNumeroReciboSinValorFiscal(), '001-002-0002');

  // 2) Concepto Personalizado con FACTURA LEGAL -> TOTALMENTE INDEPENDIENTE
  //    - factura_id = null
  //    - cliente_id = cli.id, medidor_id = med.id
  //    - NO toca fac2.saldo_pendiente (sigue en 36.720 Gs.), ni fac2.monto_pagado (0), ni fac2.estado ('vencida'), ni med.estado ('moroso')
  //    - Usa un correlativo propio de 7 dígitos (001-002-0000047) sin quemar el 001-002-0000046 de fac2
  const pagoFacturaPers = await db.registrarCobroAsync({
    facturaId: fac2.id,
    clienteId: cli.id,
    medidorId: med.id,
    monto: 150000,
    metodoPago: 'transferencia',
    tipoComprobante: 'factura_legal',
    esConceptoPersonalizado: true,
    conceptoPersonalizado: 'Reparación de cañería principal',
  });
  assert.equal(pagoFacturaPers.pago.tipo_comprobante, 'factura_legal');
  assert.equal(pagoFacturaPers.pago.factura_id, null, 'Concepto personalizado debe guardar factura_id = null');
  assert.equal(pagoFacturaPers.pago.cliente_id, cli.id);
  assert.equal(pagoFacturaPers.pago.medidor_id, med.id);
  assert.equal(pagoFacturaPers.pago.numero_recibo, '001-002-0000047');
  assert.equal(pagoFacturaPers.pago.es_concepto_personalizado, true);
  assert.equal(pagoFacturaPers.pago.concepto_personalizado, 'Reparación de cañería principal');
  assert.equal(pagoFacturaPers.pago.monto, 150000);
  assert.equal(fac2.saldo_pendiente, 36720, 'La deuda pendiente de fac2 NO debe modificarse');
  assert.equal(fac2.monto_pagado, 0, 'El monto pagado de fac2 debe seguir en 0');
  assert.equal(fac2.estado, 'vencida', 'El estado de fac2 debe seguir intacto');
  assert.equal(med.estado, 'moroso', 'El estado del medidor no debe alterarse');
  assert.equal(db.getPagosPorFactura(fac2.id).length, 0, 'fac2 no debe mostrar el cobro personalizado en su historial');

  // 3) Otro RECIBO SIN VALOR FISCAL con Concepto Personalizado sin pasar facturaId -> 001-002-0002
  const pagoRecibo2 = await db.registrarCobroAsync({
    clienteId: cli.id,
    medidorId: med.id,
    monto: 85000,
    metodoPago: 'efectivo',
    tipoComprobante: 'recibo_sin_valor_fiscal',
    esConceptoPersonalizado: true,
    conceptoPersonalizado: 'Cambio de llave de paso',
  });
  assert.equal(pagoRecibo2.pago.factura_id, null);
  assert.equal(pagoRecibo2.pago.cliente_id, cli.id);
  assert.equal(pagoRecibo2.pago.medidor_id, med.id);
  assert.equal(pagoRecibo2.pago.numero_recibo, '001-002-0002');
  assert.equal(pagoRecibo2.pago.monto, 85000);
  assert.equal(fac2.saldo_pendiente, 36720);

  // 4) Verificar payload enviado a Supabase en cobro personalizado independiente
  const insertedPayloads: any[] = [];
  const sbMock: any = {
    auth: {
      async getSession() {
        return { data: { session: { user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } } }, error: null };
      },
    },
    from(table: string) {
      return {
        insert: async (payload: any) => {
          if (table === 'pagos') insertedPayloads.push(payload);
          return { error: null };
        },
      };
    },
  };
  await db.registrarCobroAsync({
    clienteId: cli.id,
    medidorId: med.id,
    monto: 95000,
    metodoPago: 'efectivo',
    tipoComprobante: 'recibo_sin_valor_fiscal',
    esConceptoPersonalizado: true,
    conceptoPersonalizado: 'Traslado de medidor',
    clientOverride: sbMock,
  });
  assert.equal(insertedPayloads.length, 1);
  assert.equal(insertedPayloads[0].factura_id, null);
  assert.equal(insertedPayloads[0].cliente_id, cli.id);
  assert.equal(insertedPayloads[0].medidor_id, med.id);
  assert.equal(insertedPayloads[0].es_concepto_personalizado, true);
  assert.equal(insertedPayloads[0].concepto_personalizado, 'Traslado de medidor');
  assert.equal(fac2.saldo_pendiente, 36720);
});

test('38. PDF Factura Legal vs Recibo sin Valor Fiscal vs Concepto Personalizado (sin paréntesis, sin dirección arriba, título período|emisión, líneas solo con 3+ conceptos)', () => {
  // Verificar regex de limpieza de paréntesis en nombres de conceptos
  assert.equal(limpiarDescripcionConceptoPDF('CONSUMO DE AGUA (12 M³)'), 'CONSUMO DE AGUA');
  assert.equal(limpiarDescripcionConceptoPDF('DEUDA ANTERIOR (PERÍODO 2026-10)'), 'DEUDA ANTERIOR');
  assert.equal(limpiarDescripcionConceptoPDF('RECARGO POR MORA (1 BOLETA × 3.000)'), 'RECARGO POR MORA');

  const cli = {
    id: 'cli-pdf-38',
    nombre_completo: 'Lucía Ramírez',
    documento: '2.987.654',
    direccion: 'Fracción San Gabriel Mboi y',
    telefono: '0981555666',
    email: 'lucia@example.com',
    fecha_alta: '2026-01-01',
  };
  const med: Medidor = {
    ...medidorBase,
    id: 'med-pdf-38',
    cliente_id: cli.id,
    numero_medidor: 380,
  };
  const fac: Factura = {
    id: 'fac-pdf-38',
    medidor_id: med.id,
    cliente_id: cli.id,
    periodo_consumo: '2026-10',
    periodo_facturado: '2026-11',
    fecha_emision: '2026-11-01',
    fecha_vencimiento: '2026-11-30',
    fecha_pago: '2026-11-26',
    estado: 'pagada',
    total: 110000,
    saldo_pendiente: 0,
    saldo: 0,
    monto_pagado: 110000,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 21,
    numero_factura: '001-002-0000021',
    consumo_m3: 25,
    detalles: [
      { id: 'd1', factura_id: 'fac-pdf-38', concepto: 'consumo_agua', descripcion: 'Consumo de agua (25 m³)', monto: 107843 },
      { id: 'd2', factura_id: 'fac-pdf-38', concepto: 'erssan', descripcion: 'Aporte Ley ERSSAN (2%)', monto: 2157 },
    ],
  };

  assert.equal(calcularIva10Incluido(110000), 10000);
  const contarLineasTablaFullWidth = (rawPdf: string) =>
    rawPdf.split(/\r?\n/).filter((l) => l.includes('385.511811') && l.endsWith(' l')).length;

  // A) FACTURA LEGAL (3 conceptos: CONSUMO DE AGUA, APORTE LEY ERSSAN, IVA 10% -> >= 3 conceptos, dibuja 1 línea divisoria + 3 estructurales = 4)
  const docFactura = generarComprobantePagoPDF({
    factura: fac,
    cliente: cli,
    medidor: med,
    tipoComprobante: 'factura_legal',
    montoAbonado: 110000,
    metodoPago: 'efectivo',
    saldoRestante: 0,
  });
  const rawFactura = docFactura.output();
  assert.ok(rawFactura.includes('/XObject'), 'Factura Legal debe embeber logo');
  assert.ok(rawFactura.includes('3950638-0'), 'Factura Legal debe mostrar RUC');
  assert.ok(rawFactura.includes('19148339'), 'Factura Legal debe mostrar Timbrado');
  assert.ok(rawFactura.includes('01/10/2026'), 'Factura Legal debe mostrar Inicio Vigencia');
  assert.ok(rawFactura.includes('31/10/2027'), 'Factura Legal debe mostrar Fin Vigencia');
  assert.ok(rawFactura.includes('0986 977 631'), 'Factura Legal debe mostrar el teléfono WhatsApp 0986 977 631');
  assert.ok(/0\.15\d*\s+0\.83\d*\s+0\.4\d*\s+rg/i.test(rawFactura), 'Factura Legal debe dibujar el ícono verde de WhatsApp');
  assert.ok(rawFactura.includes('001-002-0000021'), 'Factura Legal debe mostrar número de 7 dígitos');
  assert.ok(rawFactura.includes(cli.direccion), 'Factura Legal debe mostrar la dirección en DATOS DEL CLIENTE Y MEDIDOR');
  assert.ok(!rawFactura.includes('(25 m') && !rawFactura.includes('(2%)'), 'Debe eliminar paréntesis de los conceptos');
  assert.ok(rawFactura.includes('CONSUMO DE AGUA'), 'Concepto sin paréntesis');
  assert.ok(!rawFactura.includes('DETALLE DE CONCEPTOS'), 'Debe reemplazar DETALLE DE CONCEPTOS');
  assert.ok(rawFactura.includes('DE CONSUMO: 2026-10'), 'Factura Legal debe mostrar PERÍODO DE CONSUMO: 2026-10');
  assert.ok(!rawFactura.includes('| EMISI'), 'Factura Legal NO debe mostrar | EMISIÓN en el título de la tabla');
  assert.ok((rawFactura.includes('Emisión: 2026-11-01') || rawFactura.includes('Emisi\\363n: 2026-11-01')) && rawFactura.includes('Vencimiento: 2026-11-30'), 'Factura Legal mantiene Emisión y Vencimiento en el recuadro superior derecho');
  assert.ok(!rawFactura.includes('Per\\355odo de Consumo:'), 'Debe quitar Período de Consumo de la línea del medidor');
  assert.ok(rawFactura.includes('IVA 10%'), 'Factura Legal debe mostrar concepto IVA 10%');
  assert.ok(!rawFactura.includes('(INCLUIDO)'), 'Factura Legal debe decir "IVA 10%" y no "IVA 10% (INCLUIDO)"');
  assert.ok(rawFactura.includes('10.000 Gs.'), 'IVA 10% debe calcularse como Total / 11');
  assert.ok(!rawFactura.includes('SIN VALOR FISCAL'), 'No debe mostrar texto SIN VALOR FISCAL');
  assert.equal(contarLineasTablaFullWidth(rawFactura), 6, 'Con 3 conceptos debe dibujar línea separadora en la tabla (5 base + 1 separadora)');

  // B) RECIBO SIN VALOR FISCAL (2 conceptos: CONSUMO DE AGUA + APORTE LEY ERSSAN -> < 3 conceptos, NO debe dibujar líneas separadoras entre ellos)
  const docRecibo = generarComprobantePagoPDF({
    factura: fac,
    cliente: cli,
    medidor: med,
    tipoComprobante: 'recibo_sin_valor_fiscal',
    numeroRecibo: '001-002-0001',
    montoAbonado: 110000,
    metodoPago: 'efectivo',
    saldoRestante: 0,
  });
  const rawRecibo = docRecibo.output();
  const textRecibo = rawRecibo.split(/\r?\n/).filter((l) => l.includes('Tj')).join('\n');
  assert.ok(rawRecibo.includes('/XObject'), 'Recibo debe mantener el logo');
  assert.ok(textRecibo.includes('0986 977 631'), 'Recibo debe mostrar el teléfono WhatsApp 0986 977 631');
  assert.ok(/0\.15\d*\s+0\.83\d*\s+0\.4\d*\s+rg/i.test(rawRecibo), 'Recibo debe dibujar el ícono verde de WhatsApp');
  assert.ok(textRecibo.includes('San Gabriel Mboi y'), 'Recibo debe mostrar la dirección del cliente');
  assert.ok(!textRecibo.includes('SIN VALOR FISCAL'), 'Recibo NO debe mostrar el texto SIN VALOR FISCAL');
  assert.ok(textRecibo.includes('001-002-0001'), 'Recibo debe usar formato 4 dígitos');
  assert.ok(!textRecibo.includes('Emisi') && !textRecibo.includes('EMISI'), 'Recibo debe dejar vacío el lado derecho del recuadro superior y sin título EMISIÓN arriba de la tabla');
  assert.ok(!textRecibo.includes('Vencimiento:'), 'Recibo no debe mostrar Vencimiento en el recuadro superior');
  assert.ok(!textRecibo.includes('DE CONSUMO:'), 'Recibo no debe mostrar título arriba de la tabla de conceptos');
  assert.ok(!textRecibo.includes('001-002-0000021'), 'Recibo no debe mostrar número de 7 dígitos');
  assert.ok(!textRecibo.includes('3950638-0'), 'Recibo NO debe mostrar RUC');
  assert.ok(!textRecibo.includes('19148339'), 'Recibo NO debe mostrar Timbrado');
  assert.ok(!textRecibo.includes('01/10/2026'), 'Recibo NO debe mostrar Inicio Vigencia');
  assert.ok(!textRecibo.includes('31/10/2027'), 'Recibo NO debe mostrar Fin Vigencia');
  assert.ok(!textRecibo.includes('IVA 10%'), 'Recibo NO debe incluir IVA 10%');
  assert.equal(contarLineasTablaFullWidth(rawRecibo), 5, 'Con 2 conceptos NO debe dibujar líneas separadoras en la tabla (solo 5 líneas base)');

  // C) CONCEPTO PERSONALIZADO independiente (1 concepto -> sin líneas separadoras; recuadro derecho vacío y sin título arriba de la tabla)
  const docPers = generarComprobantePagoPDF({
    factura: null,
    cliente: cli,
    medidor: med,
    tipoComprobante: 'factura_legal',
    numeroRecibo: '001-002-0000099',
    esConceptoPersonalizado: true,
    conceptoPersonalizado: 'Reparacion de caneria matriz (Tramo Norte)',
    montoAbonado: 150000,
    metodoPago: 'transferencia',
    fechaPago: '2026-11-27',
  });
  const rawPers = docPers.output();
  const textPers = rawPers.split(/\r?\n/).filter((l) => l.includes('Tj')).join('\n');
  assert.ok(textPers.includes('0986 977 631'), 'Comprobante personalizado debe mostrar teléfono WhatsApp');
  assert.ok(textPers.includes('001-002-0000099'), 'Debe mostrar el comprobante asignado');
  assert.ok(textPers.includes('REPARACION DE CANERIA MATRIZ'), 'Concepto personalizado debe renderizarse en MAYÚSCULAS');
  assert.ok(!textPers.includes('Tramo Norte') && !textPers.includes('TRAMO NORTE'), 'Debe limpiar paréntesis en concepto personalizado');
  assert.ok(textPers.includes('150.000 Gs.'), 'Debe mostrar el monto exacto ingresado');
  const ocurrenciasDireccion = textPers.split('San Gabriel Mboi y').length - 1;
  assert.equal(ocurrenciasDireccion, 1, 'La dirección debe aparecer únicamente en DATOS DEL CLIENTE Y MEDIDOR, nunca en el recuadro superior');
  assert.ok(!textPers.includes('Emisi') && !textPers.includes('EMISI'), 'Concepto personalizado debe dejar el recuadro derecho vacío y sin título EMISIÓN arriba de la tabla');
  assert.ok(!textPers.includes('DE CONSUMO:'), 'Concepto personalizado no debe mostrar título arriba de la tabla');
  assert.ok(!textPers.includes('Cobro Independiente'), 'Concepto personalizado NO debe mostrar "Cobro Independiente"');
  assert.ok(!textPers.includes('ERSSAN 2%') && !textPers.includes('APORTE LEY ERSSAN') && !textPers.includes('2.157 Gs.'), 'Concepto personalizado NO debe calcular ni mostrar ERSSAN 2%');
  assert.ok(!textPers.includes('IVA 10%'), 'Concepto personalizado NO debe calcular ni mostrar IVA 10%');
  assert.ok(!textPers.includes('CONSUMO DE AGUA'), 'Concepto personalizado debe ocultar conceptos estándar');
  assert.equal(contarLineasTablaFullWidth(rawPers), 5, 'Con 1 concepto NO debe dibujar líneas separadoras en la tabla (solo 5 líneas base)');

  // D) generarBoletaPDF Factura Legal muestra solo PERÍODO DE CONSUMO: 2026-10 (sin | EMISIÓN) y Recibo omite título arriba de la tabla
  const docBoletaFactura = generarBoletaPDF({
    factura: fac,
    cliente: cli,
    medidor: med,
    tipoComprobante: 'factura_legal',
  });
  const textBoletaFactura = docBoletaFactura.output().split(/\r?\n/).filter((l) => l.includes('Tj')).join('\n');
  assert.ok(textBoletaFactura.includes('DE CONSUMO: 2026-10') && !textBoletaFactura.includes('| EMISI'));

  const docBoletaRecibo = generarBoletaPDF({
    factura: fac,
    cliente: cli,
    medidor: med,
    tipoComprobante: 'recibo_sin_valor_fiscal',
    numeroRecibo: '001-002-0005',
  });
  const rawBoletaRecibo = docBoletaRecibo.output();
  const textBoletaRecibo = rawBoletaRecibo
    .split(/\r?\n/)
    .filter((l) => l.includes('Tj'))
    .join('\n');
  assert.ok(textBoletaRecibo.includes('001-002-0005'));
  assert.ok(textBoletaRecibo.includes('0986 977 631'));
  assert.ok(textBoletaRecibo.includes('San Gabriel Mboi y'));
  assert.ok(!textBoletaRecibo.includes('DETALLE DE CONCEPTOS'));
  assert.ok(!textBoletaRecibo.includes('DE CONSUMO:'), 'Recibo sin valor fiscal en generarBoletaPDF no debe mostrar título arriba de la tabla');
  assert.ok(textBoletaRecibo.includes('(CONSUMO DE AGUA) Tj'));
  assert.ok(textBoletaRecibo.includes('(APORTE ERSSAN:) Tj'));
  assert.ok(!textBoletaRecibo.includes('\\(25 m') && !textBoletaRecibo.includes('\\(2%'));
  assert.ok(!textBoletaRecibo.includes('SIN VALOR FISCAL'));
  assert.ok(!textBoletaRecibo.includes('3950638-0'));
  assert.ok(!textBoletaRecibo.includes('19148339'));
  assert.ok(!textBoletaRecibo.includes('IVA 10%'));
});

test('39. CajaCobranzasView renderiza sin errores con soporte de Selector de Comprobante y Concepto Personalizado', () => {
  const html = renderToStaticMarkup(
    React.createElement(AuthProvider, null, React.createElement(CajaCobranzasView))
  );
  assert.ok(html.includes('Módulo de Caja y Cobranzas'));
});

test('40. Historial de Pagos incluye factura_id = null y getUltimoPagoPorMedidor detecta cobro personalizado para descarga en Facturación', () => {
  const data = db.getFullData();
  const cli = {
    id: 'cli-hist-40',
    nombre_completo: 'Carlos Benítez',
    documento: '3.456.789',
    direccion: 'Fracción San Gabriel Sector Norte',
    telefono: '0982111222',
    email: 'carlos@example.com',
    fecha_alta: '2026-01-01',
  };
  const med: Medidor = {
    ...medidorBase,
    id: 'med-hist-40',
    cliente_id: cli.id,
    numero_medidor: 404,
    estado: 'activo',
  };
  const fac: Factura = {
    id: 'fac-hist-40',
    medidor_id: med.id,
    cliente_id: cli.id,
    periodo_consumo: '2026-10',
    periodo_facturado: '2026-11',
    fecha_emision: '2026-11-01',
    fecha_vencimiento: '2026-11-30',
    fecha_pago: null,
    estado: 'pendiente',
    total: 40000,
    saldo_pendiente: 40000,
    saldo: 40000,
    monto_pagado: 0,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
    numero_factura: '001-002-0000404',
    consumo_m3: 10,
  };
  data.clientes.push(cli);
  data.medidores.push(med);
  data.facturas.push(fac);

  // Registrar cobro con concepto personalizado (factura_id = null) teniendo boleta de agua pendiente
  const resPers = db.registrarCobro({
    facturaId: fac.id,
    clienteId: cli.id,
    medidorId: med.id,
    monto: 120000,
    metodoPago: 'efectivo',
    tipoComprobante: 'recibo_sin_valor_fiscal',
    esConceptoPersonalizado: true,
    conceptoPersonalizado: 'Instalación de llave maestra',
  });

  assert.equal(resPers.pago.factura_id, null);
  assert.equal(fac.estado, 'pendiente', 'La factura de agua permanece pendiente');
  assert.equal(fac.saldo_pendiente, 40000, 'El saldo de agua no se toca');

  // Historial global debe incluir el cobro personalizado aunque factura_id sea null
  const histTodos = db.getHistorialPagos({ search: 'Instalación de llave maestra' });
  assert.equal(histTodos.total, 1);
  assert.equal(histTodos.pagos[0].esPersonalizado, true);
  assert.equal(histTodos.pagos[0].clienteNombre, 'Carlos Benítez');
  assert.equal(histTodos.pagos[0].numeroMedidor, 404);
  assert.equal(histTodos.pagos[0].descripcionConcepto, 'INSTALACIÓN DE LLAVE MAESTRA');

  // Filtro solo personalizados
  const histPers = db.getHistorialPagos({ tipoFiltro: 'personalizados', search: '404' });
  assert.equal(histPers.total, 1);
  assert.equal(histPers.pagos[0].id, resPers.pago.id);

  // Historial del medidor y último pago del medidor (usado por FacturaDetalleModal para descargar el recibo personalizado)
  const pagosMedidor = db.getPagosPorMedidor(med.id);
  assert.equal(pagosMedidor.length, 1);
  assert.equal(pagosMedidor[0].esPersonalizado, true);

  const ultimoPago = db.getUltimoPagoPorMedidor(med.id);
  assert.ok(ultimoPago);
  assert.equal(ultimoPago.id, resPers.pago.id);
  assert.equal(ultimoPago.esPersonalizado, true);

  // FacturacionView renderiza limpio (sin sesión activa en SSR aplica RBAC)
  const htmlFact = renderToStaticMarkup(
    React.createElement(AuthProvider, null, React.createElement(FacturacionView))
  );
  assert.ok(htmlFact.includes('Acceso denegado'));

  // FacturaDetalleModal: botón azul grande SIEMPRE para la boleta de agua ("Descargar PDF"),
  // mientras el recuadro inferior mantiene el botón pequeño para descargar el Concepto Personalizado
  const htmlModal = renderToStaticMarkup(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(FacturaDetalleModal, {
        facturaId: fac.id,
        onClose: () => {},
        onNotify: () => {},
      })
    )
  );
  assert.ok(htmlModal.includes('Descargar PDF'), 'El botón azul grande debe mantenerse exclusivo para la factura de agua');
  assert.ok(!htmlModal.includes('Recibo Personalizado'), 'El botón azul grande NO debe cambiar a Recibo Personalizado');
  assert.ok(htmlModal.includes('Cobros con Concepto Personalizado del Medidor'));
  assert.ok(htmlModal.includes('INSTALACIÓN DE LLAVE MAESTRA'));
});








