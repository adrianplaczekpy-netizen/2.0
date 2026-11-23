/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './database';

const CLIENTE_ID = '11111111-1111-4111-8111-111111111111';
const MEDIDOR_ID = '22222222-2222-4222-8222-222222222222';
const CAJERO_ID = '33333333-3333-4333-8333-333333333333';
const FACTURA_ID = '44444444-4444-4444-8444-444444444444';

function createCajaSupabaseMock(options?: {
  failPagoInsert?: string | null;
  medidorEstadoInicial?: 'activo' | 'moroso' | 'pendiente_corte' | 'cortado';
  facturaEstadoInicial?: 'pendiente' | 'vencida';
  facturaTotal?: number;
}) {
  const totalInicial = options?.facturaTotal ?? 55080;
  let failPagoInsert = options?.failPagoInsert ?? null;

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
        id: CLIENTE_ID,
        nombre_completo: 'María González',
        documento: '4567890',
        direccion: 'Av. Mariscal López 450',
        telefono: '0981222333',
        email: 'maria@example.com',
        fecha_alta: '2026-01-05',
      },
    ],
    medidores: [
      {
        id: MEDIDOR_ID,
        numero_medidor: 1,
        cliente_id: CLIENTE_ID,
        direccion: 'Av. Mariscal López 450',
        zona: 'Centro',
        estado: options?.medidorEstadoInicial ?? 'moroso',
        lectura_inicial: 0,
        fecha_instalacion: '2026-01-05',
      },
    ],
    contratos: [],
    lecturas: [],
    facturas: [
      {
        id: FACTURA_ID,
        medidor_id: MEDIDOR_ID,
        cliente_id: CLIENTE_ID,
        periodo_consumo: '2026-10',
        periodo_facturado: '2026-11',
        fecha_emision: '2026-11-01',
        fecha_vencimiento: '2026-11-30',
        estado: options?.facturaEstadoInicial ?? 'vencida',
        total: totalInicial,
        saldo_pendiente: totalInicial,
        monto_pagado: 0,
        es_tercera_boleta: false,
        alerta_consumo_elevado: false,
        numero_boleta_medidor: 1,
        lectura_anterior: 0,
        lectura_actual: 12,
        consumo_m3: 12,
      },
    ],
    detalle_factura: [],
    pagos: [],
    cargos_pendientes: [],
    planes_financiamiento: [],
    usuarios: [
      {
        id: CAJERO_ID,
        nombre_completo: 'Lic. Ramona Benítez',
        email: 'cobrador@aguateria.py',
        rol: 'cobrador',
      },
    ],
  };

  // Simula el trigger PostgreSQL procesar_pago_factura()
  const aplicarTriggerProcesarPago = (facturaId: string, fechaPago: string) => {
    const factura = tables.facturas.find((f) => f.id === facturaId);
    if (!factura) return;

    const totalPagado = tables.pagos
      .filter((p) => p.factura_id === facturaId)
      .reduce((acc, p) => acc + Number(p.monto), 0);

    const saldoRestante = Math.max(0, Number(factura.total) - totalPagado);
    factura.monto_pagado = totalPagado;
    factura.saldo_pendiente = saldoRestante;

    if (saldoRestante === 0) {
      factura.estado = 'pagada';
      factura.fecha_pago = fechaPago;
    } else if (factura.estado === 'vencida' || factura.estado === 'pendiente') {
      factura.estado = 'pendiente';
    }

    const medidor = tables.medidores.find((m) => m.id === factura.medidor_id);
    if (medidor && medidor.estado !== 'cortado' && medidor.estado !== 'retirado') {
      const vencidas = tables.facturas.filter(
        (f) => f.medidor_id === medidor.id && f.estado === 'vencida'
      ).length;
      medidor.estado = vencidas === 0 ? 'activo' : vencidas >= 3 ? 'pendiente_corte' : 'moroso';
    }
  };

  const makeBuilder = (tableName: string) => {
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: any = null;
    let isSingle = false;
    const filters: { col: string; val: any }[] = [];

    const execute = async () => {
      if (op === 'insert') {
        if (tableName === 'pagos' && failPagoInsert) {
          return { data: null, error: { message: failPagoInsert } };
        }
        const rows = Array.isArray(payload) ? payload : [payload];
        for (const r of rows) {
          tables[tableName].push({ ...r });
          if (tableName === 'pagos') {
            aplicarTriggerProcesarPago(r.factura_id, r.fecha_pago);
          }
        }
        return { data: isSingle ? rows[0] : rows, error: null };
      }

      if (op === 'update') {
        const matched = tables[tableName].filter((row) =>
          filters.every((f) => row[f.col] === f.val)
        );
        for (const row of matched) {
          Object.assign(row, payload);
        }
        return { data: isSingle ? matched[0] ?? null : matched, error: null };
      }

      let rows = [...(tables[tableName] || [])];
      if (filters.length > 0) {
        rows = rows.filter((row) => filters.every((f) => row[f.col] === f.val));
      }
      return { data: isSingle ? rows[0] ?? null : rows, error: null };
    };

    const builder: any = {
      select() {
        return builder;
      },
      insert(data: any) {
        op = 'insert';
        payload = data;
        return builder;
      },
      update(data: any) {
        op = 'update';
        payload = data;
        return builder;
      },
      eq(col: string, val: any) {
        filters.push({ col, val });
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        isSingle = true;
        return builder;
      },
      then(resolve: (val: any) => void, reject?: (err: any) => void) {
        return execute().then(resolve, reject);
      },
    };
    return builder;
  };

  return {
    tables,
    setFailPagoInsert(msg: string | null) {
      failPagoInsert = msg;
    },
    client: {
      auth: {
        async getSession() {
          return {
            data: {
              session: { user: { id: CAJERO_ID, email: 'cobrador@aguateria.py' } },
            },
            error: null,
          };
        },
      },
      from(tableName: string) {
        return makeBuilder(tableName);
      },
    },
  };
}

test('1. Cobro total exitoso en Caja → factura pagada en Supabase, medidor activo y saldo 0', async () => {
  db.clearData();
  const mock = createCajaSupabaseMock({
    facturaTotal: 55080,
    facturaEstadoInicial: 'vencida',
    medidorEstadoInicial: 'moroso',
  });
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  const res = await db.registrarCobroAsync({
    facturaId: FACTURA_ID,
    monto: 55080,
    metodoPago: 'efectivo',
    cobradorId: CAJERO_ID,
    cobradorNombre: 'Lic. Ramona Benítez',
    clientOverride: mock.client,
  });

  assert.equal(res.saldoRestante, 0);
  assert.equal(res.factura.estado, 'pagada');
  assert.equal(res.factura.monto_pagado, 55080);
  assert.equal(res.medidorPasoAActivo, true);
  assert.equal(res.estadoMedidorActualizado, 'activo');

  // Verificar estado persistido en Supabase
  assert.equal(mock.tables.pagos.length, 1);
  assert.equal(mock.tables.pagos[0].monto, 55080);
  assert.equal(mock.tables.facturas[0].estado, 'pagada');
  assert.equal(mock.tables.facturas[0].saldo_pendiente, 0);
  assert.equal(mock.tables.facturas[0].monto_pagado, 55080);
  assert.equal(mock.tables.medidores[0].estado, 'activo');
});

test('2. Cobro parcial en Caja → factura pendiente con saldo_pendiente actualizado en Supabase', async () => {
  db.clearData();
  const mock = createCajaSupabaseMock({
    facturaTotal: 36720,
    facturaEstadoInicial: 'pendiente',
    medidorEstadoInicial: 'activo',
  });
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  const res = await db.registrarCobroAsync({
    facturaId: FACTURA_ID,
    monto: 20000,
    metodoPago: 'transferencia',
    cobradorId: CAJERO_ID,
    cobradorNombre: 'Lic. Ramona Benítez',
    clientOverride: mock.client,
  });

  assert.equal(res.saldoRestante, 16720);
  assert.equal(res.factura.estado, 'pendiente');
  assert.equal(res.factura.monto_pagado, 20000);
  assert.equal(mock.tables.facturas[0].estado, 'pendiente');
  assert.equal(mock.tables.facturas[0].saldo_pendiente, 16720);
  assert.equal(mock.tables.facturas[0].monto_pagado, 20000);
});

test('3. Fallo en registrarCobroAsync → lanza error y NO modifica factura, medidor ni pagos en memoria', async () => {
  db.clearData();
  const mock = createCajaSupabaseMock({
    facturaTotal: 55080,
    facturaEstadoInicial: 'vencida',
    medidorEstadoInicial: 'moroso',
    failPagoInsert: 'new row violates row-level security policy for table "pagos"',
  });
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  await assert.rejects(
    () =>
      db.registrarCobroAsync({
        facturaId: FACTURA_ID,
        monto: 55080,
        metodoPago: 'efectivo',
        cobradorId: CAJERO_ID,
        clientOverride: mock.client,
      }),
    /Error registrando pago en Supabase/
  );

  // Estado local en memoria NO debe haberse tocado
  const detalle = db.getMedidorDetalle(MEDIDOR_ID);
  assert.ok(detalle && detalle.medidor);
  assert.equal(detalle.medidor.estado, 'moroso');
  assert.equal(detalle.facturas[0].estado, 'vencida');
  assert.equal(detalle.facturas[0].saldo_pendiente, 55080);
  assert.equal(detalle.facturas[0].monto_pagado, 0);
  assert.equal(db.getFullData().pagos.length, 0);
  assert.equal(mock.tables.pagos.length, 0);
});

test('4. Recargar la app después de un cobro (clearData + loadFromSupabase) → el cobro persiste', async () => {
  db.clearData();
  const mock = createCajaSupabaseMock({
    facturaTotal: 55080,
    facturaEstadoInicial: 'vencida',
    medidorEstadoInicial: 'moroso',
  });
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  await db.registrarCobroAsync({
    facturaId: FACTURA_ID,
    monto: 25000,
    metodoPago: 'cheque',
    cobradorId: CAJERO_ID,
    cobradorNombre: 'Lic. Ramona Benítez',
    clientOverride: mock.client,
  });

  // Simular F5 / recarga completa desde Supabase
  db.clearData();
  assert.equal(db.getFullData().pagos.length, 0);

  const recarga = await db.loadFromSupabase({ clientOverride: mock.client, force: true });
  assert.equal(recarga.ok, true);

  const detalle = db.getMedidorDetalle(MEDIDOR_ID);
  assert.ok(detalle);
  assert.equal(detalle.facturas[0].estado, 'pendiente');
  assert.equal(detalle.facturas[0].monto_pagado, 25000);
  assert.equal(detalle.facturas[0].saldo_pendiente, 30080);
  assert.equal(db.getPagosPorFactura(FACTURA_ID).length, 1);
  assert.equal(db.getPagosPorFactura(FACTURA_ID)[0].monto, 25000);
});
