/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { db } from './database';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const COLUMNAS_MEDIDORES = new Set([
  'id',
  'cliente_id',
  'numero_medidor',
  'direccion',
  'zona',
  'latitud',
  'longitud',
  'fecha_instalacion',
  'estado',
  'fecha_corte',
  'mora_congelada',
  'created_at',
]);

const CLIENTE_ID = '11111111-1111-4111-8111-111111111111';
const MEDIDOR_1_ID = '22222222-2222-4222-8222-222222222221';
const FACTURA_1_ID = '33333333-3333-4333-8333-333333333331';

function createStatefulSupabaseMock(options?: { withFacturaForMedidor1?: boolean }) {
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
        nombre_completo: 'Carlos Benítez',
        documento: '4567890',
        direccion: 'Calle San José 123',
        telefono: '0981444555',
        email: 'carlos@example.com',
        fecha_alta: '2026-01-01',
      },
    ],
    medidores: [
      {
        id: MEDIDOR_1_ID,
        cliente_id: CLIENTE_ID,
        numero_medidor: 1,
        direccion: 'Calle San José 123',
        zona: 'San José',
        latitud: -25.34,
        longitud: -57.51,
        fecha_instalacion: '2026-01-05',
        estado: 'activo',
        fecha_corte: null,
        mora_congelada: 0,
      },
    ],
    contratos: [],
    lecturas: [],
    facturas: options?.withFacturaForMedidor1
      ? [
          {
            id: FACTURA_1_ID,
            medidor_id: MEDIDOR_1_ID,
            cliente_id: CLIENTE_ID,
            periodo_consumo: '2026-10',
            periodo_facturado: '2026-11',
            fecha_emision: '2026-11-01',
            fecha_vencimiento: '2026-11-30',
            estado: 'pendiente',
            total: 40800,
            saldo_pendiente: 40800,
            monto_pagado: 0,
            es_tercera_boleta: false,
            alerta_consumo_elevado: false,
            numero_boleta_medidor: 1,
            lectura_anterior: 0,
            lectura_actual: 10,
            consumo_m3: 10,
          },
        ]
      : [],
    detalle_factura: [],
    pagos: [],
    cargos_pendientes: [],
    planes_financiamiento: [],
    usuarios: [],
  };

  let failInsert: { message: string; code?: string } | null = null;
  let failUpdate: { message: string; code?: string } | null = null;
  let failDelete: { message: string; code?: string } | null = null;
  let throwNetworkOnInsert: Error | null = null;
  let throwNetworkOnDelete: Error | null = null;
  let rlsZeroRowsOnUpdate = false;

  const validateMedidorRow = (payload: Record<string, any>, isInsert: boolean) => {
    for (const key of Object.keys(payload)) {
      if (!COLUMNAS_MEDIDORES.has(key)) {
        return { message: `Could not find the '${key}' column of 'medidores'`, code: 'PGRST204' };
      }
    }
    if (isInsert) {
      if (!UUID_REGEX.test(payload.id) || !UUID_REGEX.test(payload.cliente_id)) {
        return { message: 'invalid input syntax for type uuid', code: '22P02' };
      }
      if (payload.numero_medidor < 1 || payload.numero_medidor > 1000) {
        return {
          message: 'new row for relation "medidores" violates check constraint "medidores_numero_medidor_check"',
          code: '23514',
        };
      }
      if (tables.medidores.some((m) => m.numero_medidor === payload.numero_medidor)) {
        return {
          message: 'duplicate key value violates unique constraint "medidores_numero_medidor_key"',
          code: '23505',
        };
      }
    }
    return null;
  };

  const makeBuilder = (tableName: string) => {
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: any = null;
    const filters: { col: string; val: any }[] = [];
    let limitCount: number | null = null;

    const execute = async () => {
      if (op === 'insert') {
        if (throwNetworkOnInsert) throw throwNetworkOnInsert;
        if (failInsert) return { data: null, error: failInsert };
        const rows = Array.isArray(payload) ? payload : [payload];
        for (const r of rows) {
          if (tableName === 'medidores') {
            const err = validateMedidorRow(r, true);
            if (err) return { data: null, error: err };
          }
          tables[tableName].push({ ...r });
        }
        return { data: rows, error: null };
      }

      if (op === 'update') {
        if (failUpdate) return { data: null, error: failUpdate };
        if (rlsZeroRowsOnUpdate) return { data: [], error: null };
        if (tableName === 'medidores') {
          const err = validateMedidorRow(payload, false);
          if (err) return { data: null, error: err };
        }
        const matched = tables[tableName].filter((row) =>
          filters.every((f) => row[f.col] === f.val)
        );
        for (const row of matched) {
          Object.assign(row, payload);
        }
        return { data: matched, error: null };
      }

      if (op === 'delete') {
        if (throwNetworkOnDelete) throw throwNetworkOnDelete;
        if (failDelete) return { data: null, error: failDelete };
        const matched = tables[tableName].filter((row) =>
          filters.every((f) => row[f.col] === f.val)
        );
        tables[tableName] = tables[tableName].filter(
          (row) => !filters.every((f) => row[f.col] === f.val)
        );
        return { data: matched, error: null };
      }

      let rows = [...(tables[tableName] || [])];
      if (filters.length > 0) {
        rows = rows.filter((row) => filters.every((f) => row[f.col] === f.val));
      }
      if (limitCount !== null) {
        rows = rows.slice(0, limitCount);
      }
      return { data: rows, error: null };
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
      delete() {
        op = 'delete';
        return builder;
      },
      eq(col: string, val: any) {
        filters.push({ col, val });
        return builder;
      },
      order() {
        return builder;
      },
      limit(n: number) {
        limitCount = n;
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
    setFailInsert(err: { message: string; code?: string } | null) {
      failInsert = err;
    },
    setFailUpdate(err: { message: string; code?: string } | null) {
      failUpdate = err;
    },
    setFailDelete(err: { message: string; code?: string } | null) {
      failDelete = err;
    },
    setThrowNetworkOnInsert(err: Error | null) {
      throwNetworkOnInsert = err;
    },
    setThrowNetworkOnDelete(err: Error | null) {
      throwNetworkOnDelete = err;
    },
    setRlsZeroRowsOnUpdate(v: boolean) {
      rlsZeroRowsOnUpdate = v;
    },
    client: {
      auth: {
        async getSession() {
          return {
            data: { session: { user: { id: 'admin-user-1', email: 'admin@example.com' } } },
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

test('1. Crear medidor exitoso espera INSERT en Supabase y persiste tras recargar', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  const nuevo = await db.agregarMedidorAsync(
    {
      cliente_id: CLIENTE_ID,
      numero_medidor: 85,
      fecha_instalacion: '2026-11-21',
      direccion: 'Calle Palma 450',
      zona: 'Centro',
      latitud: -25.3412,
      longitud: -57.5123,
      estado: 'activo',
    },
    { clientOverride: mock.client }
  );

  assert.match(nuevo.id, UUID_REGEX);
  assert.equal(nuevo.numero_medidor, 85);
  assert.equal(mock.tables.medidores.length, 2);

  // Recarga completa desde Supabase
  db.clearData();
  assert.equal(db.getMedidoresParaMapa().length, 0);
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  const medidorRecargado = db.getMedidorPorNumero(85);
  assert.ok(medidorRecargado);
  assert.equal(medidorRecargado!.id, nuevo.id);
  assert.equal(medidorRecargado!.direccion, 'Calle Palma 450');
  assert.equal(medidorRecargado!.zona, 'Centro');
});

test('2. Número de medidor duplicado rechaza con error claro y no muta estado local', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  // Caso A: duplicado detectado localmente
  await assert.rejects(
    () =>
      db.agregarMedidorAsync(
        {
          cliente_id: CLIENTE_ID,
          numero_medidor: 1,
          fecha_instalacion: '2026-11-21',
          direccion: 'Otra calle 999',
          zona: 'Centro',
          latitud: -25.34,
          longitud: -57.51,
          estado: 'activo',
        },
        { clientOverride: mock.client }
      ),
    /Ya existe un medidor con ese número/
  );
  assert.equal(db.getMedidoresParaMapa().length, 1);

  // Caso B: unique constraint 23505 devuelto por Supabase
  mock.setFailInsert({
    message: 'duplicate key value violates unique constraint "medidores_numero_medidor_key"',
    code: '23505',
  });
  await assert.rejects(
    () =>
      db.agregarMedidorAsync(
        {
          cliente_id: CLIENTE_ID,
          numero_medidor: 22,
          fecha_instalacion: '2026-11-21',
          direccion: 'Otra calle 999',
          zona: 'Centro',
          latitud: -25.34,
          longitud: -57.51,
          estado: 'activo',
        },
        { clientOverride: mock.client }
      ),
    /Ya existe un medidor con ese número/
  );
  assert.equal(db.getMedidoresParaMapa().length, 1);
});

test('3. Número fuera de rango (0 o 1001) rechaza con error de rango y no muta estado', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  for (const numInvalido of [0, 1001, -5]) {
    await assert.rejects(
      () =>
        db.agregarMedidorAsync(
          {
            cliente_id: CLIENTE_ID,
            numero_medidor: numInvalido,
            fecha_instalacion: '2026-11-21',
            direccion: 'Calle Sin Nombre',
            zona: 'Centro',
            latitud: -25.34,
            longitud: -57.51,
            estado: 'activo',
          },
          { clientOverride: mock.client }
        ),
      /El número de medidor debe estar entre 1 y 1000/
    );
  }
  assert.equal(mock.tables.medidores.length, 1);
  assert.equal(db.getMedidoresParaMapa().length, 1);
});

test('4. Número con decimales, letras o ceros a la izquierda rechaza y no muta estado', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  for (const entradaInvalida of ['12.5', 'MED-10', '05', 'abc']) {
    await assert.rejects(
      () =>
        db.agregarMedidorAsync(
          {
            cliente_id: CLIENTE_ID,
            numero_medidor: entradaInvalida,
            fecha_instalacion: '2026-11-21',
            direccion: 'Calle Prueba',
            zona: 'Centro',
            latitud: -25.34,
            longitud: -57.51,
            estado: 'activo',
          },
          { clientOverride: mock.client }
        ),
      /número entero|ceros a la izquierda/i
    );
  }
  assert.equal(mock.tables.medidores.length, 1);
  assert.equal(db.getMedidoresParaMapa().length, 1);
});

test('5. Editar medidor (actualizarMedidorAsync) persiste en Supabase y no muta estado si falla', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  // Fallo RLS o de red -> mantiene valores anteriores
  mock.setRlsZeroRowsOnUpdate(true);
  await assert.rejects(
    () =>
      db.actualizarMedidorAsync(
        MEDIDOR_1_ID,
        { direccion: 'Cambio rechazado', zona: 'Reducto', estado: 'retirado' },
        { clientOverride: mock.client }
      ),
    /No se pudo actualizar el medidor/
  );
  assert.equal(db.getMedidorPorNumero(1)?.direccion, 'Calle San José 123');
  assert.equal(db.getMedidorPorNumero(1)?.estado, 'activo');

  // Actualización exitosa -> persiste tras recargar
  mock.setRlsZeroRowsOnUpdate(false);
  const actualizado = await db.actualizarMedidorAsync(
    MEDIDOR_1_ID,
    {
      direccion: 'Av. Mcal. López 880',
      zona: 'Centro',
      latitud: -25.3455,
      longitud: -57.5188,
      estado: 'retirado',
    },
    { clientOverride: mock.client }
  );

  assert.equal(actualizado.direccion, 'Av. Mcal. López 880');
  assert.equal(actualizado.estado, 'retirado');

  db.clearData();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });
  const recargado = db.getMedidorPorNumero(1);
  assert.equal(recargado?.direccion, 'Av. Mcal. López 880');
  assert.equal(recargado?.zona, 'Centro');
  assert.equal(recargado?.estado, 'retirado');
});

test('6. Eliminar medidor SIN facturas persiste en Supabase y falla limpio si cae la red', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock({ withFacturaForMedidor1: false });
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  // Red caída -> error y NO elimina localmente
  mock.setThrowNetworkOnDelete(new TypeError('Failed to fetch'));
  await assert.rejects(
    () => db.eliminarMedidorAsync(MEDIDOR_1_ID, { clientOverride: mock.client }),
    /No se pudo eliminar el medidor: .*Failed to fetch/
  );
  assert.equal(db.getMedidoresParaMapa().length, 1);
  assert.equal(mock.tables.medidores.length, 1);

  // Red OK -> elimina en Supabase y tras recarga sigue eliminado
  mock.setThrowNetworkOnDelete(null);
  const ok = await db.eliminarMedidorAsync(MEDIDOR_1_ID, { clientOverride: mock.client });
  assert.equal(ok, true);
  assert.equal(db.getMedidoresParaMapa().length, 0);
  assert.equal(mock.tables.medidores.length, 0);

  db.clearData();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });
  assert.equal(db.getMedidoresParaMapa().length, 0);
});

test('7. Eliminar medidor CON facturas asociadas bloquea con mensaje exacto y conserva el medidor', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock({ withFacturaForMedidor1: true });
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  await assert.rejects(
    () => db.eliminarMedidorAsync(MEDIDOR_1_ID, { clientOverride: mock.client }),
    /No se puede eliminar un medidor con facturas\. Cambialo a estado 'retirado' en su lugar\./
  );
  assert.equal(db.getMedidoresParaMapa().length, 1);
  assert.equal(mock.tables.medidores.length, 1);

  // También si facturas no estuviera en memoria local pero sí en Supabase
  db.clearData();
  const mockSinFacturaLocal = createStatefulSupabaseMock({ withFacturaForMedidor1: false });
  await db.loadFromSupabase({ clientOverride: mockSinFacturaLocal.client, force: true });
  await assert.rejects(
    () => db.eliminarMedidorAsync(MEDIDOR_1_ID, { clientOverride: mock.client }),
    /No se puede eliminar un medidor con facturas\. Cambialo a estado 'retirado' en su lugar\./
  );
  assert.equal(mock.tables.medidores.length, 1);
});

test('8. Crear medidor desde Mapa con fallo de red NO agrega pin al mapa y mantiene modal abierto con error', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  const pinsAntes = db.getMedidoresParaMapa().length;
  mock.setThrowNetworkOnInsert(new TypeError('Failed to fetch'));

  await assert.rejects(
    () =>
      db.agregarMedidorAsync(
        {
          cliente_id: CLIENTE_ID,
          numero_medidor: 99,
          fecha_instalacion: '2026-11-21',
          direccion: 'Lote 14 - Mapa',
          zona: 'San José',
          latitud: -25.342211,
          longitud: -57.511122,
          estado: 'activo',
        },
        { clientOverride: mock.client }
      ),
    /No se pudo registrar el medidor: .*Failed to fetch/
  );

  // El pin NO se agrega a getMedidoresParaMapa ni a la base
  assert.equal(db.getMedidoresParaMapa().length, pinsAntes);
  assert.equal(db.getMedidorPorNumero(99), null);
  assert.equal(mock.tables.medidores.length, pinsAntes);

  // Verificar que MapaMedidoresView y MedidoresView usan *Async y ClientesView ya no usa alert()
  const mapaSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/MapaMedidoresView.tsx'), 'utf8');
  const medidoresSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/MedidoresView.tsx'), 'utf8');
  const clientesSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/ClientesView.tsx'), 'utf8');

  assert.match(mapaSrc, /await db\.agregarMedidorAsync\(/);
  assert.equal(/db\.agregarMedidor\(/.test(mapaSrc), false);
  assert.match(medidoresSrc, /await db\.agregarMedidorAsync\(/);
  assert.match(medidoresSrc, /await db\.actualizarMedidorAsync\(/);
  assert.match(medidoresSrc, /await db\.eliminarMedidorAsync\(/);
  assert.equal(/\balert\(/.test(clientesSrc), false);
});
