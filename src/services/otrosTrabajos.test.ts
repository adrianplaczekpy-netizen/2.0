/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './database';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const COLUMNAS_CARGOS_PENDIENTES = new Set([
  'id',
  'medidor_id',
  'cliente_id',
  'fecha_trabajo',
  'descripcion',
  'monto',
  'periodo_facturacion',
  'estado',
  'factura_id',
  'comprobante_url',
  'registrado_por',
  'fecha_registro',
  'motivo_anulacion',
]);

const CLIENTE_ID = '11111111-1111-4111-8111-111111111111';
const MEDIDOR_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_USER_ID = '33333333-3333-4333-8333-333333333333';
const FACTURA_EMITIDA_ID = '44444444-4444-4444-8444-444444444444';

function createStatefulSupabaseMock(options?: {
  failInsertError?: string | null;
  failUpdateError?: string | null;
  sessionUser?: { id: string; email: string } | null;
}) {
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
        documento: '3456789',
        direccion: 'Calle Palma 123',
        telefono: '0981123456',
        email: 'carlos@example.com',
        fecha_alta: '2026-01-05',
      },
    ],
    medidores: [
      {
        id: MEDIDOR_ID,
        numero_medidor: 3,
        cliente_id: CLIENTE_ID,
        direccion: 'Calle Palma 123',
        zona: 'Centro',
        estado: 'activo',
        lectura_inicial: 0,
        fecha_instalacion: '2026-01-05',
      },
    ],
    contratos: [],
    lecturas: [],
    facturas: [
      {
        id: FACTURA_EMITIDA_ID,
        medidor_id: MEDIDOR_ID,
        cliente_id: CLIENTE_ID,
        periodo_consumo: '2026-09',
        periodo_facturado: '2026-10',
        fecha_emision: '2026-10-01',
        fecha_vencimiento: '2026-10-31',
        estado: 'pagada',
        total: 36720,
        saldo_pendiente: 0,
        monto_pagado: 36720,
        es_tercera_boleta: false,
        alerta_consumo_elevado: false,
        numero_boleta_medidor: 1,
        lectura_anterior: 0,
        lectura_actual: 5,
        consumo_m3: 5,
      },
    ],
    detalle_factura: [],
    pagos: [],
    cargos_pendientes: [],
    planes_financiamiento: [],
    usuarios: [
      {
        id: ADMIN_USER_ID,
        nombre_completo: 'Administrador Principal',
        email: 'admin@aguasanjacinto.py',
        rol: 'admin',
      },
    ],
  };

  let mutableFailInsert = options?.failInsertError ?? null;
  let mutableFailUpdate = options?.failUpdateError ?? null;

  const validateCargoRow = (payload: Record<string, any>, isInsert: boolean) => {
    for (const key of Object.keys(payload)) {
      if (!COLUMNAS_CARGOS_PENDIENTES.has(key)) {
        return `Could not find the '${key}' column of 'cargos_pendientes' in the schema cache`;
      }
    }
    if (isInsert) {
      const notNullCols = [
        'id',
        'medidor_id',
        'cliente_id',
        'fecha_trabajo',
        'descripcion',
        'monto',
        'periodo_facturacion',
        'estado',
      ];
      for (const col of notNullCols) {
        if (payload[col] === undefined || payload[col] === null || payload[col] === '') {
          return `null value in column '${col}' of relation 'cargos_pendientes' violates not-null constraint`;
        }
      }
      if (!UUID_REGEX.test(payload.id)) {
        return `invalid input syntax for type uuid: "${payload.id}"`;
      }
      if (!UUID_REGEX.test(payload.medidor_id) || !UUID_REGEX.test(payload.cliente_id)) {
        return 'invalid input syntax for type uuid in foreign key';
      }
      if (payload.registrado_por && !UUID_REGEX.test(payload.registrado_por)) {
        return `invalid input syntax for type uuid: "${payload.registrado_por}"`;
      }
    }
    if (payload.monto !== undefined && Number(payload.monto) <= 0) {
      return 'new row for relation "cargos_pendientes" violates check constraint "cargos_pendientes_monto_check"';
    }
    return null;
  };

  const makeBuilder = (tableName: string) => {
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: any = null;
    const filters: { col: string; val: any }[] = [];

    const execute = async () => {
      if (op === 'insert') {
        if (mutableFailInsert) {
          return { data: null, error: { message: mutableFailInsert } };
        }
        const rows = Array.isArray(payload) ? payload : [payload];
        for (const r of rows) {
          if (tableName === 'cargos_pendientes') {
            const schemaErr = validateCargoRow(r, true);
            if (schemaErr) return { data: null, error: { message: schemaErr } };
          }
          tables[tableName].push({ ...r });
        }
        return { data: rows, error: null };
      }

      if (op === 'update') {
        if (mutableFailUpdate) {
          return { data: null, error: { message: mutableFailUpdate } };
        }
        if (tableName === 'cargos_pendientes') {
          const schemaErr = validateCargoRow(payload, false);
          if (schemaErr) return { data: null, error: { message: schemaErr } };
        }
        const matched = tables[tableName].filter((row) =>
          filters.every((f) => row[f.col] === f.val)
        );
        for (const row of matched) {
          Object.assign(row, payload);
        }
        return { data: matched, error: null };
      }

      let rows = [...(tables[tableName] || [])];
      if (filters.length > 0) {
        rows = rows.filter((row) => filters.every((f) => row[f.col] === f.val));
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
      then(resolve: (val: any) => void, reject?: (err: any) => void) {
        return execute().then(resolve, reject);
      },
    };
    return builder;
  };

  return {
    tables,
    setFailInsert(msg: string | null) {
      mutableFailInsert = msg;
    },
    setFailUpdate(msg: string | null) {
      mutableFailUpdate = msg;
    },
    client: {
      auth: {
        async getSession() {
          const user =
            options && 'sessionUser' in options
              ? options.sessionUser
              : { id: ADMIN_USER_ID, email: 'admin@aguasanjacinto.py' };
          return {
            data: { session: user ? { user } : null },
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

test('1. agregarCargoPendienteAsync inserta en public.cargos_pendientes con UUID válido y persiste tras recargar desde Supabase', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();

  const cargaInicial = await db.loadFromSupabase({
    clientOverride: mock.client,
    force: true,
    silentIfUnauthenticated: false,
  });
  assert.equal(cargaInicial.ok, true);

  const creado = await db.agregarCargoPendienteAsync(
    {
      medidor_id: MEDIDOR_ID,
      cliente_id: CLIENTE_ID,
      fecha_trabajo: '2026-11-10',
      descripcion: 'Cambio de llave de paso 3/4',
      monto: 45000,
      periodo_facturacion: '2026-11',
      registrado_por: 'Administración Técnica',
    },
    { clientOverride: mock.client }
  );

  assert.match(creado.id, UUID_REGEX);
  assert.equal(creado.estado, 'pendiente');
  assert.equal(creado.registrado_por, ADMIN_USER_ID);
  assert.equal(mock.tables.cargos_pendientes.length, 1);
  assert.equal(mock.tables.cargos_pendientes[0].id, creado.id);
  assert.equal(mock.tables.cargos_pendientes[0].registrado_por, ADMIN_USER_ID);

  // Simular F5 / recarga completa desde Supabase
  db.clearData();
  assert.equal(db.getCargos().total, 0);

  const recarga = await db.loadFromSupabase({
    clientOverride: mock.client,
    force: true,
    silentIfUnauthenticated: false,
  });
  assert.equal(recarga.ok, true);

  const listado = db.getCargos();
  assert.equal(listado.total, 1);
  assert.equal(listado.cargos[0].id, creado.id);
  assert.equal(listado.cargos[0].descripcion, 'Cambio de llave de paso 3/4');
  assert.equal(listado.cargos[0].monto, 45000);
  assert.equal(listado.cargos[0].periodo_facturacion, '2026-11');
  assert.equal(listado.cargos[0].registradoPorNombre, 'Administrador Principal');
});

test('2. actualizarCargoPendienteAsync actualiza el cargo en Supabase sin enviar columnas inexistentes y persiste tras recarga', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  const creado = await db.agregarCargoPendienteAsync(
    {
      medidor_id: MEDIDOR_ID,
      cliente_id: CLIENTE_ID,
      fecha_trabajo: '2026-11-10',
      descripcion: 'Reparación caño vereda',
      monto: 35000,
      periodo_facturacion: '2026-11',
      registrado_por: ADMIN_USER_ID,
    },
    { clientOverride: mock.client }
  );

  const actualizado = await db.actualizarCargoPendienteAsync(
    creado.id,
    {
      descripcion: 'Reparación caño vereda + codo PVC',
      monto: 52000,
      periodo_facturacion: '2026-12',
      fecha_trabajo: '2026-11-12',
    },
    'Administrador Principal',
    { clientOverride: mock.client }
  );

  assert.equal(actualizado.monto, 52000);
  assert.equal(actualizado.periodo_facturacion, '2026-12');
  assert.equal(mock.tables.cargos_pendientes[0].descripcion, 'Reparación caño vereda + codo PVC');
  assert.equal(mock.tables.cargos_pendientes[0].monto, 52000);

  // Intentar mover a período 2026-10 que ya tiene factura emitida debe fallar
  await assert.rejects(
    () =>
      db.actualizarCargoPendienteAsync(
        creado.id,
        { periodo_facturacion: '2026-10' },
        'Administrador Principal',
        { clientOverride: mock.client }
      ),
    /NUNCA se puede mover un cargo/
  );

  // Recargar desde Supabase y verificar que persiste la edición válida
  db.clearData();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });
  const listado = db.getCargos();
  assert.equal(listado.total, 1);
  assert.equal(listado.cargos[0].monto, 52000);
  assert.equal(listado.cargos[0].periodo_facturacion, '2026-12');
});

test('3. anularCargoPendienteAsync actualiza estado=anulado y motivo_anulacion en Supabase y persiste tras recarga', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  const creado = await db.agregarCargoPendienteAsync(
    {
      medidor_id: MEDIDOR_ID,
      cliente_id: CLIENTE_ID,
      fecha_trabajo: '2026-11-10',
      descripcion: 'Instalación caja protectora',
      monto: 80000,
      periodo_facturacion: '2026-11',
      registrado_por: ADMIN_USER_ID,
    },
    { clientOverride: mock.client }
  );

  const anulado = await db.anularCargoPendienteAsync(
    creado.id,
    'Trabajo cancelado por solicitud del cliente',
    'Administrador Principal',
    { clientOverride: mock.client }
  );

  assert.equal(anulado.estado, 'anulado');
  assert.ok(anulado.motivo_anulacion?.includes('Trabajo cancelado por solicitud del cliente'));
  assert.equal(mock.tables.cargos_pendientes[0].estado, 'anulado');

  // Recargar desde Supabase
  db.clearData();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });
  const listado = db.getCargos();
  assert.equal(listado.cargos[0].estado, 'anulado');
  assert.ok(listado.cargos[0].motivo_anulacion?.includes('Administrador Principal'));
});

test('4. Si Supabase falla en INSERT o UPDATE, lanza error y NO modifica el estado local en memoria', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  // Falla INSERT
  mock.setFailInsert('new row violates row-level security policy for table "cargos_pendientes"');
  await assert.rejects(
    () =>
      db.agregarCargoPendienteAsync(
        {
          medidor_id: MEDIDOR_ID,
          cliente_id: CLIENTE_ID,
          fecha_trabajo: '2026-11-10',
          descripcion: 'Cargo que debe fallar',
          monto: 25000,
          periodo_facturacion: '2026-11',
          registrado_por: ADMIN_USER_ID,
        },
        { clientOverride: mock.client }
      ),
    /Error al registrar cargo en Supabase/
  );
  assert.equal(db.getCargos().total, 0, 'No debe agregar el cargo en memoria si Supabase falla');

  // Insert exitoso para probar fallo de UPDATE y ANULAR
  mock.setFailInsert(null);
  const creado = await db.agregarCargoPendienteAsync(
    {
      medidor_id: MEDIDOR_ID,
      cliente_id: CLIENTE_ID,
      fecha_trabajo: '2026-11-10',
      descripcion: 'Cargo válido inicial',
      monto: 30000,
      periodo_facturacion: '2026-11',
      registrado_por: ADMIN_USER_ID,
    },
    { clientOverride: mock.client }
  );

  mock.setFailUpdate('permission denied for table cargos_pendientes');
  await assert.rejects(
    () =>
      db.actualizarCargoPendienteAsync(
        creado.id,
        { monto: 99000, descripcion: 'No debe aplicarse localmente' },
        'admin',
        { clientOverride: mock.client }
      ),
    /Error al actualizar cargo en Supabase/
  );
  assert.equal(db.getCargos().cargos[0].monto, 30000);
  assert.equal(db.getCargos().cargos[0].descripcion, 'Cargo válido inicial');

  await assert.rejects(
    () =>
      db.anularCargoPendienteAsync(creado.id, 'Motivo cualquiera válido', 'admin', {
        clientOverride: mock.client,
      }),
    /Error al anular cargo en Supabase/
  );
  assert.equal(db.getCargos().cargos[0].estado, 'pendiente');
});
