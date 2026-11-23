/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { getVisibleSidebarNavItems } from './navigationHelpers';
import { evaluarEstadoMedidorPorVencidas } from './billingRules';
import { db } from './database';
import { Factura } from '../types';

test('1. Navegación Sidebar: "Corte y Reconexión" aparece solo para rol admin', () => {
  const itemsAdmin = getVisibleSidebarNavItems('admin');
  const itemsCobrador = getVisibleSidebarNavItems('cobrador');
  const itemsLector = getVisibleSidebarNavItems('lectura');
  const itemsAnon = getVisibleSidebarNavItems(undefined);

  const corteAdmin = itemsAdmin.find((i) => i.id === 'cortes');
  assert.ok(corteAdmin, 'Admin debe ver Corte y Reconexión en el menú');
  assert.equal(corteAdmin?.label, 'Corte y Reconexión');
  assert.equal(corteAdmin?.adminOnly, true);

  assert.equal(
    itemsCobrador.some((i) => i.id === 'cortes'),
    false,
    'Cobrador NO debe ver Corte y Reconexión'
  );
  assert.equal(
    itemsLector.some((i) => i.id === 'cortes'),
    false,
    'Lector NO debe ver Corte y Reconexión'
  );
  assert.equal(
    itemsAnon.some((i) => i.id === 'cortes'),
    false,
    'Usuario sin rol NO debe ver Corte y Reconexión'
  );
});

test('2. evaluarEstadoMedidorPorVencidas: 0->activo, 1-2->moroso, 3+->pendiente_corte, cortado/retirado intactos', () => {
  const hoy = new Date('2026-11-17T12:00:00Z');
  const mkFac = (id: string, estado: Factura['estado'], venc: string): Factura => ({
    id,
    medidor_id: 'm1',
    cliente_id: 'c1',
    periodo_facturado: '2026-10',
    fecha_emision: '2026-10-01',
    fecha_vencimiento: venc,
    estado,
    total: 36720,
    saldo_pendiente: estado === 'pagada' || estado === 'anulada' ? 0 : 36720,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
  });

  // 0 vencidas (solo pagada, anulada o pendiente en fecha)
  assert.equal(
    evaluarEstadoMedidorPorVencidas(
      { estado: 'moroso' },
      [
        mkFac('f1', 'pagada', '2026-09-30'),
        mkFac('f2', 'anulada', '2026-10-31'),
        mkFac('f3', 'pendiente', '2026-11-30'),
      ],
      hoy
    ),
    'activo'
  );

  // 1 vencida -> moroso (caso Medidor 3)
  assert.equal(
    evaluarEstadoMedidorPorVencidas({ estado: 'activo' }, [mkFac('f1', 'vencida', '2026-10-31')], hoy),
    'moroso'
  );

  // 2 vencidas (1 marcada vencida + 1 pendiente con fecha ya pasada) -> moroso
  assert.equal(
    evaluarEstadoMedidorPorVencidas(
      { estado: 'activo' },
      [mkFac('f1', 'vencida', '2026-09-30'), mkFac('f2', 'pendiente', '2026-10-31')],
      hoy
    ),
    'moroso'
  );

  // 3 vencidas -> pendiente_corte
  assert.equal(
    evaluarEstadoMedidorPorVencidas(
      { estado: 'moroso' },
      [
        mkFac('f1', 'vencida', '2026-08-31'),
        mkFac('f2', 'vencida', '2026-09-30'),
        mkFac('f3', 'pendiente', '2026-11-11'),
      ],
      hoy
    ),
    'pendiente_corte'
  );

  // No tocar cortado ni retirado
  assert.equal(
    evaluarEstadoMedidorPorVencidas(
      { estado: 'cortado' },
      [mkFac('f1', 'vencida', '2026-08-31'), mkFac('f2', 'vencida', '2026-09-30'), mkFac('f3', 'vencida', '2026-10-31')],
      hoy
    ),
    'cortado'
  );
  assert.equal(
    evaluarEstadoMedidorPorVencidas({ estado: 'retirado' }, [mkFac('f1', 'vencida', '2026-08-31')], hoy),
    'retirado'
  );
});

test('3. db.recalcularEstadosMedidoresAsync: Medidor 3 con 1 factura vencida pasa de activo a moroso y respeta cortado/retirado', async () => {
  db.clearData();

  const cli = db.agregarCliente({
    nombre_completo: 'Carlos Benítez',
    documento: '3456789',
    direccion: 'Ruta 2 Km 18',
    telefono: '0983333444',
    email: 'carlos@example.com',
  });

  const med1 = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 1,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 1',
    zona: 'Centro',
    latitud: -25.34,
    longitud: -57.51,
    estado: 'activo',
  });

  const med3 = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 3,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 3',
    zona: 'Centro',
    latitud: -25.34,
    longitud: -57.51,
    estado: 'activo',
  });

  const medCortado = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 4,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 4',
    zona: 'Centro',
    latitud: -25.34,
    longitud: -57.51,
    estado: 'cortado',
  });

  const data = db.getFullData();
  // Medidor 3 tiene 1 factura vencida pero seguía en 'activo'
  data.facturas.push({
    id: 'fac-med3-v1',
    medidor_id: med3.id,
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

  // Medidor 1 tiene factura pendiente cuya fecha de vencimiento ya pasó
  data.facturas.push({
    id: 'fac-med1-p1',
    medidor_id: med1.id,
    cliente_id: cli.id,
    periodo_consumo: '2026-09',
    periodo_facturado: '2026-10',
    fecha_emision: '2026-10-01',
    fecha_vencimiento: '2026-10-31',
    estado: 'pendiente',
    total: 36720,
    saldo_pendiente: 36720,
    saldo: 36720,
    monto_pagado: 0,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
  });

  const res = await db.recalcularEstadosMedidoresAsync({
    fechaReferencia: new Date('2026-11-17T12:00:00Z'),
  });

  assert.equal(res.facturasVencidasMarcadas, 1);
  assert.equal(res.actualizados, 2);

  const med3Act = db.getMedidores().medidores.find((m) => m.id === med3.id)!;
  const med1Act = db.getMedidores().medidores.find((m) => m.id === med1.id)!;
  const med4Act = db.getMedidores().medidores.find((m) => m.id === medCortado.id)!;

  assert.equal(med3Act.estado, 'moroso', 'Medidor 3 con 1 factura vencida debe pasar automáticamente a moroso');
  assert.equal(med1Act.estado, 'moroso', 'Medidor 1 con factura vencida por paso del tiempo debe pasar a moroso');
  assert.equal(med4Act.estado, 'cortado', 'Medidor cortado no debe alterarse');
});

test('4. ejecutarFacturacionMensualAsync actualiza estados por vencimiento previo antes de emitir nuevas boletas', async () => {
  db.clearData();

  const cli = db.agregarCliente({
    nombre_completo: 'Lucía Duarte',
    documento: '9988776',
    direccion: 'Barrio San José',
    telefono: '0984444555',
    email: 'lucia@example.com',
  });

  const med = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 15,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 15',
    zona: 'San José',
    latitud: -25.33,
    longitud: -57.5,
    estado: 'activo',
  });

  // 3 facturas pendientes ya vencidas respecto al 2026-12-01, aunque el medidor seguía 'activo'
  const data = db.getFullData();
  ['2026-09', '2026-10', '2026-11'].forEach((per, idx) => {
    data.facturas.push({
      id: `fac-m15-${idx + 1}`,
      medidor_id: med.id,
      cliente_id: cli.id,
      periodo_consumo: per,
      periodo_facturado: per,
      fecha_emision: `${per}-01`,
      fecha_vencimiento: `${per}-20`,
      estado: 'pendiente',
      total: 36720,
      saldo_pendiente: 36720,
      saldo: 36720,
      monto_pagado: 0,
      es_tercera_boleta: idx === 2,
      alerta_consumo_elevado: false,
      numero_boleta_medidor: idx + 1,
    });
  });

  db.registrarLectura({
    numeroMedidor: med.numero_medidor,
    lecturaActual: 120,
    fechaLectura: '2026-11-28',
    fotoUrl: 'https://example.com/15.jpg',
    registradoPor: 'Lector',
    estado: 'confirmada',
  });

  const resumen = await db.ejecutarFacturacionMensualAsync('2026-12', '2026-12-01');
  assert.equal(resumen.totalGeneradas, 0);
  assert.equal(resumen.totalOmitidos, 1);
  assert.equal(resumen.medidoresOmitidos[0].motivo, 'pendiente_corte');

  const medActualizado = db.getMedidores().medidores.find((m) => m.id === med.id)!;
  assert.equal(medActualizado.estado, 'pendiente_corte');
});

test('5. Ciclo completo Corte y Reconexión: pendiente_corte -> confirmarCorteFisicoAsync -> cortado -> confirmarReconexion -> activo', async () => {
  db.clearData();

  const cli = db.agregarCliente({
    nombre_completo: 'Juan Pérez',
    documento: '1234567',
    direccion: 'Av. San José 100',
    telefono: '0981111222',
    email: 'juan@example.com',
  });

  const med = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 7,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 7',
    zona: 'Centro',
    latitud: -25.34,
    longitud: -57.51,
    estado: 'pendiente_corte',
  });

  db.getFullData().facturas.push({
    id: 'fac-corte-1',
    medidor_id: med.id,
    cliente_id: cli.id,
    periodo_consumo: '2026-08',
    periodo_facturado: '2026-09',
    fecha_emision: '2026-09-01',
    fecha_vencimiento: '2026-09-30',
    estado: 'vencida',
    total: 36720,
    saldo_pendiente: 36720,
    saldo: 36720,
    monto_pagado: 0,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
  });

  assert.equal(db.getListadoParaCortar().length, 1);
  assert.equal(db.getListadoParaReconectar().length, 0);

  const cortado = await db.confirmarCorteFisicoAsync(med.id);
  assert.equal(cortado.estado, 'cortado');
  assert.equal(cortado.mora_congelada, 3000);
  assert.equal(db.getListadoParaCortar().length, 0);
  assert.equal(db.getListadoParaReconectar().length, 1);

  const resRec = db.confirmarReconexion(med.id, {
    cobradorId: 'admin',
    metodoPago: 'efectivo',
    tipoReinstalacion: 'mismo_medidor',
    lecturaInicial: 0,
    fechaReconexion: '2026-11-17',
    operario: 'Cuadrilla 1',
  });

  assert.equal(resRec.medidor.estado, 'activo');
  assert.equal(db.getListadoParaCortar().length, 0);
  assert.equal(db.getListadoParaReconectar().length, 0);
});
