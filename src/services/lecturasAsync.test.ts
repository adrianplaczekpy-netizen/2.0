/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './database';
import {
  clearLecturasOfflineQueue,
  getDeleteMotivoFieldConfig,
  getLecturasOfflineQueue,
  resolveOfflineStatusUi,
  StorageLike,
} from './lecturasOfflineQueue';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthProvider } from '../context/AuthContext';
import { LecturasMobileView } from '../components/LecturasMobileView';
import {
  buildCameraConstraints,
  CAMERA_OPEN_ERROR_MESSAGE,
  requestRearFirstCameraStream,
  toggleCameraFacingMode,
  triggerNativeCameraInput,
} from '../utils/cameraHelper';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const COLUMNAS_LECTURAS = new Set([
  'id',
  'medidor_id',
  'periodo',
  'fecha_lectura',
  'lectura_anterior',
  'lectura_actual',
  'consumo_m3',
  'foto_medidor_url',
  'observaciones',
  'foto_observacion_url',
  'estado',
  'registrado_por',
  'fecha_registro',
  'editado_por',
  'fecha_edicion',
  'motivo_edicion',
]);

const CLIENTE_ID = '11111111-1111-4111-8111-111111111111';
const MEDIDOR_ID = '22222222-2222-4222-8222-222222222222';
const LECTOR_USER_ID = '33333333-3333-4333-8333-333333333333';
const ADMIN_USER_ID = '44444444-4444-4444-8444-444444444444';
const FACTURA_ID = '55555555-5555-4555-8555-555555555555';
const DET_CONSUMO_ID = '66666666-6666-4666-8666-666666666666';
const DET_ERSSAN_ID = '77777777-7777-4777-8777-777777777777';

function createMemoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

function createStatefulSupabaseMock(options?: {
  sessionUser?: { id: string; email: string } | null;
  withUnpaidFactura?: boolean;
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
        nombre_completo: 'María Elena Gómez',
        documento: '4123456',
        direccion: 'Calle San José 450',
        telefono: '0981555444',
        email: 'maria@example.com',
        fecha_alta: '2026-01-05',
      },
    ],
    medidores: [
      {
        id: MEDIDOR_ID,
        numero_medidor: 12,
        cliente_id: CLIENTE_ID,
        direccion: 'Calle San José 450',
        zona: 'Centro',
        estado: 'activo',
        lectura_inicial: 0,
        fecha_instalacion: '2026-01-05',
      },
    ],
    contratos: [],
    lecturas: [],
    facturas: options?.withUnpaidFactura
      ? [
          {
            id: FACTURA_ID,
            medidor_id: MEDIDOR_ID,
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
            lectura_anterior: 100,
            lectura_actual: 110,
            consumo_m3: 10,
          },
        ]
      : [],
    detalle_factura: options?.withUnpaidFactura
      ? [
          {
            id: DET_CONSUMO_ID,
            factura_id: FACTURA_ID,
            concepto: 'consumo_agua',
            descripcion: 'Consumo de agua (10 m³)',
            monto: 40000,
          },
          {
            id: DET_ERSSAN_ID,
            factura_id: FACTURA_ID,
            concepto: 'erssan',
            descripcion: 'Tasa ERSSAN 2%',
            monto: 800,
          },
        ]
      : [],
    pagos: [],
    cargos_pendientes: [],
    planes_financiamiento: [],
    usuarios: [
      {
        id: LECTOR_USER_ID,
        nombre_completo: 'Lector de Campo',
        email: 'lector@aguasanjacinto.py',
        rol: 'lectura',
      },
      {
        id: ADMIN_USER_ID,
        nombre_completo: 'Administrador Principal',
        email: 'admin@aguasanjacinto.py',
        rol: 'admin',
      },
    ],
  };

  let failInsert: { message: string; code?: string } | null = null;
  let failUpdate: { message: string; code?: string } | null = null;
  let failDelete: { message: string; code?: string } | null = null;
  let throwNetworkOnInsert: Error | null = null;

  const validateLecturaRow = (payload: Record<string, any>, isInsert: boolean) => {
    for (const key of Object.keys(payload)) {
      if (!COLUMNAS_LECTURAS.has(key)) {
        return { message: `Could not find the '${key}' column of 'lecturas'`, code: 'PGRST204' };
      }
    }
    if (isInsert) {
      const notNullCols = [
        'id',
        'medidor_id',
        'periodo',
        'fecha_lectura',
        'lectura_anterior',
        'lectura_actual',
        'consumo_m3',
        'foto_medidor_url',
        'estado',
      ];
      for (const col of notNullCols) {
        if (payload[col] === undefined || payload[col] === null || payload[col] === '') {
          return {
            message: `null value in column '${col}' of relation 'lecturas' violates not-null constraint`,
            code: '23502',
          };
        }
      }
      if (!UUID_REGEX.test(payload.id) || !UUID_REGEX.test(payload.medidor_id)) {
        return { message: 'invalid input syntax for type uuid', code: '22P02' };
      }
      if (payload.registrado_por && !UUID_REGEX.test(payload.registrado_por)) {
        return {
          message: `invalid input syntax for type uuid: "${payload.registrado_por}"`,
          code: '22P02',
        };
      }
      const dup = tables.lecturas.find(
        (l) => l.medidor_id === payload.medidor_id && l.periodo === payload.periodo
      );
      if (dup) {
        return {
          message: 'duplicate key value violates unique constraint "uq_medidor_periodo"',
          code: '23505',
        };
      }
    }
    if (payload.editado_por && !UUID_REGEX.test(payload.editado_por)) {
      return {
        message: `invalid input syntax for type uuid: "${payload.editado_por}"`,
        code: '22P02',
      };
    }
    return null;
  };

  const makeBuilder = (tableName: string) => {
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: any = null;
    const filters: { col: string; val: any }[] = [];

    const execute = async () => {
      if (op === 'insert') {
        if (throwNetworkOnInsert) {
          throw throwNetworkOnInsert;
        }
        if (failInsert) {
          return { data: null, error: failInsert };
        }
        const rows = Array.isArray(payload) ? payload : [payload];
        for (const r of rows) {
          if (tableName === 'lecturas') {
            const err = validateLecturaRow(r, true);
            if (err) return { data: null, error: err };
          }
          tables[tableName].push({ ...r });
        }
        return { data: rows, error: null };
      }

      if (op === 'update') {
        if (failUpdate) {
          return { data: null, error: failUpdate };
        }
        if (tableName === 'lecturas') {
          const err = validateLecturaRow(payload, false);
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
        if (failDelete) {
          return { data: null, error: failDelete };
        }
        const matched = tables[tableName].filter((row) =>
          filters.every((f) => row[f.col] === f.val)
        );
        tables[tableName] = tables[tableName].filter(
          (row) => !filters.every((f) => row[f.col] === f.val)
        );
        return { data: matched, count: matched.length, error: null };
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
    client: {
      auth: {
        async getSession() {
          const user =
            options && 'sessionUser' in options
              ? options.sessionUser
              : { id: LECTOR_USER_ID, email: 'lector@aguasanjacinto.py' };
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

test('1. Registro exitoso de lectura espera INSERT en Supabase, guarda UUID de registrado_por y persiste tras recargar', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  const resultado = await db.registrarLecturaAsync(
    {
      numeroMedidor: 12,
      lecturaActual: 125,
      fechaLectura: '2026-10-15',
      fotoUrl: 'data:image/jpeg;base64,/9j/demo',
      observaciones: 'Lectura sin novedades',
      estado: 'confirmada',
      registradoPor: 'Lector de Campo',
      registradoPorId: LECTOR_USER_ID,
    },
    { clientOverride: mock.client }
  );

  assert.match(resultado.lectura.id, UUID_REGEX);
  assert.equal(resultado.consumoM3, 125);
  assert.equal(mock.tables.lecturas.length, 1);
  assert.equal(mock.tables.lecturas[0].registrado_por, LECTOR_USER_ID);
  assert.equal(mock.tables.lecturas[0].lectura_actual, 125);
  assert.equal(mock.tables.lecturas[0].periodo, '2026-10');

  // Simular recarga completa desde Supabase
  db.clearData();
  assert.equal(db.getLecturas({}).total, 0);
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  const historial = db.getLecturas({ numeroMedidor: 12 });
  assert.equal(historial.total, 1);
  assert.equal(historial.lecturas[0].id, resultado.lectura.id);
  assert.equal(historial.lecturas[0].lectura_actual, 125);
  assert.equal(historial.lecturas[0].registrado_por_nombre, 'Lector de Campo');
});

test('2. Fallo en INSERT de Supabase lanza error claro, NO muta estado local y NO encola offline si es error RLS/DB', async () => {
  db.clearData();
  const storage = createMemoryStorage();
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  mock.setFailInsert({
    message: 'new row violates row-level security policy for table "lecturas"',
    code: '42501',
  });

  await assert.rejects(
    () =>
      db.registrarLecturaAsync(
        {
          numeroMedidor: 12,
          lecturaActual: 140,
          fechaLectura: '2026-10-15',
          fotoUrl: 'data:image/jpeg;base64,/9j/demo',
          estado: 'confirmada',
          registradoPor: 'Lector de Campo',
          registradoPorId: LECTOR_USER_ID,
        },
        { clientOverride: mock.client, storageOverride: storage }
      ),
    /No se pudo guardar la lectura: .*row-level security/
  );

  assert.equal(db.getLecturas({}).total, 0, 'No debe guardar en memoria si falla Supabase');
  assert.equal(mock.tables.lecturas.length, 0);
  assert.equal(
    getLecturasOfflineQueue(storage).length,
    0,
    'Un error RLS/BD no debe disfrazarse en cola offline'
  );
});

test('3. actualizarLecturaAsync persiste cambios en Supabase, recalcula factura impaga y no muta estado si falla', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock({ withUnpaidFactura: true });
  mock.tables.lecturas.push({
    id: '88888888-8888-4888-8888-888888888888',
    medidor_id: MEDIDOR_ID,
    periodo: '2026-10',
    fecha_lectura: '2026-10-15',
    lectura_anterior: 100,
    lectura_actual: 110,
    consumo_m3: 10,
    foto_medidor_url: 'data:image/jpeg;base64,/9j/demo',
    observaciones: 'Inicial',
    foto_observacion_url: null,
    estado: 'confirmada',
    registrado_por: LECTOR_USER_ID,
    fecha_registro: '2026-10-15T12:00:00Z',
    editado_por: null,
    fecha_edicion: null,
    motivo_edicion: null,
  });

  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  // Vincular lectura_id en factura para recálculo
  mock.tables.facturas[0].lectura_id = '88888888-8888-4888-8888-888888888888';
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  // Si falla UPDATE, NO debe mutar estado local
  mock.setFailUpdate({ message: 'permission denied for table lecturas', code: '42501' });
  await assert.rejects(
    () =>
      db.actualizarLecturaAsync(
        '88888888-8888-4888-8888-888888888888',
        { lecturaActual: 120, observaciones: 'No debe aplicarse' },
        { id: ADMIN_USER_ID, rol: 'admin', nombre: 'Administrador Principal' },
        { clientOverride: mock.client }
      ),
    /No se pudo actualizar la lectura/
  );
  assert.equal(db.getLecturas({}).lecturas[0].lectura_actual, 110);

  // UPDATE exitoso (consumo pasa de 10 a 20 m³ -> 80.000 + 2% = 81.600 Gs.)
  mock.setFailUpdate(null);
  const editada = await db.actualizarLecturaAsync(
    '88888888-8888-4888-8888-888888888888',
    { lecturaActual: 120, observaciones: 'Corrección de dígito' },
    { id: ADMIN_USER_ID, rol: 'admin', nombre: 'Administrador Principal' },
    { clientOverride: mock.client }
  );

  assert.equal(editada.lectura_actual, 120);
  assert.equal(editada.consumo_m3, 20);
  assert.equal(mock.tables.lecturas[0].editado_por, ADMIN_USER_ID);
  assert.equal(mock.tables.facturas[0].total, 81600);
  assert.equal(mock.tables.facturas[0].saldo_pendiente, 81600);

  // Verificar tras recarga completa
  db.clearData();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });
  const trasRecarga = db.getLecturas({}).lecturas[0];
  assert.equal(trasRecarga.lectura_actual, 120);
  assert.equal(trasRecarga.observaciones, 'Corrección de dígito');
  assert.equal(trasRecarga.editado_por_nombre, 'Administrador Principal');
});

test('4. eliminarLecturaAsync borra en Supabase, persiste tras recarga y no elimina localmente si falla', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  const lecturaId = '99999999-9999-4999-8999-999999999999';
  mock.tables.lecturas.push({
    id: lecturaId,
    medidor_id: MEDIDOR_ID,
    periodo: '2026-10',
    fecha_lectura: '2026-10-15',
    lectura_anterior: 0,
    lectura_actual: 15,
    consumo_m3: 15,
    foto_medidor_url: 'data:image/jpeg;base64,/9j/demo',
    observaciones: null,
    foto_observacion_url: null,
    estado: 'borrador',
    registrado_por: LECTOR_USER_ID,
    fecha_registro: '2026-10-15T12:00:00Z',
  });

  await db.loadFromSupabase({ clientOverride: mock.client, force: true });
  assert.equal(db.getLecturas({}).total, 1);

  // Fallo en DELETE -> mantiene lectura en memoria y en Supabase
  mock.setFailDelete({ message: 'violates foreign key constraint', code: '23503' });
  await assert.rejects(
    () =>
      db.eliminarLecturaAsync(
        lecturaId,
        { id: LECTOR_USER_ID, rol: 'lectura', nombre: 'Lector de Campo' },
        undefined,
        { clientOverride: mock.client }
      ),
    /No se pudo eliminar la lectura/
  );
  assert.equal(db.getLecturas({}).total, 1);

  // DELETE exitoso
  mock.setFailDelete(null);
  const ok = await db.eliminarLecturaAsync(
    lecturaId,
    { id: LECTOR_USER_ID, rol: 'lectura', nombre: 'Lector de Campo' },
    undefined,
    { clientOverride: mock.client }
  );
  assert.equal(ok, true);
  assert.equal(db.getLecturas({}).total, 0);
  assert.equal(mock.tables.lecturas.length, 0);

  // Recargar confirma que no vuelve a aparecer
  db.clearData();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });
  assert.equal(db.getLecturas({}).total, 0);
});

test('5. Modo offline guarda la lectura en cola local (localStorage) y sincronizarLecturasOfflineAsync la envía cuando vuelve la señal', async () => {
  db.clearData();
  const storage = createMemoryStorage();
  clearLecturasOfflineQueue(storage);

  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  // Simular falla de red (TypeError: Failed to fetch) durante toma de lectura
  mock.setThrowNetworkOnInsert(new TypeError('Failed to fetch'));

  await assert.rejects(
    () =>
      db.registrarLecturaAsync(
        {
          numeroMedidor: 12,
          lecturaActual: 55,
          fechaLectura: '2026-11-05',
          fotoUrl: 'data:image/jpeg;base64,/9j/demo',
          observaciones: 'Tomada sin señal en zona rural',
          estado: 'confirmada',
          registradoPor: 'Lector de Campo',
          registradoPorId: LECTOR_USER_ID,
        },
        { clientOverride: mock.client, storageOverride: storage }
      ),
    (err: any) => err?.queuedOffline === true && /cola local/.test(err.message)
  );

  // Debe quedar 1 en cola local y 0 en Supabase/estado confirmado
  assert.equal(getLecturasOfflineQueue(storage).length, 1);
  assert.equal(mock.tables.lecturas.length, 0);
  assert.equal(db.getLecturas({}).total, 0);

  // Vuelve la señal: sincronizar cola
  mock.setThrowNetworkOnInsert(null);
  const syncRes = await db.sincronizarLecturasOfflineAsync({
    clientOverride: mock.client,
    storageOverride: storage,
  });

  assert.equal(syncRes.total, 1);
  assert.equal(syncRes.syncedCount, 1);
  assert.equal(syncRes.remainingCount, 0);
  assert.equal(syncRes.errors.length, 0);
  assert.equal(getLecturasOfflineQueue(storage).length, 0);
  assert.equal(mock.tables.lecturas.length, 1);
  assert.equal(mock.tables.lecturas[0].lectura_actual, 55);
  assert.equal(mock.tables.lecturas[0].registrado_por, LECTOR_USER_ID);
});

test('6. Búsqueda exacta getMedidorPorNumero (1 -> 2) no confunde medidores y modo offline guarda numeroMedidor = 2', async () => {
  db.clearData();
  const storage = createMemoryStorage();
  clearLecturasOfflineQueue(storage);

  const mock = createStatefulSupabaseMock();
  const MEDIDOR_1_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
  const MEDIDOR_2_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
  const CLI_1_ID = 'cccccccc-1111-4111-8111-111111111111';
  const CLI_2_ID = 'dddddddd-2222-4222-8222-222222222222';

  // Medidor 1 tiene "2" en su documento y dirección (caso real que rompía getMedidores({ search: "2", limit: 1 }))
  mock.tables.clientes = [
    {
      id: CLI_1_ID,
      nombre_completo: 'Juan Carlos Pérez',
      documento: '2345678',
      direccion: 'Ruta 2 Km 15',
      telefono: '0981111111',
      email: 'juan@example.com',
      fecha_alta: '2026-01-01',
    },
    {
      id: CLI_2_ID,
      nombre_completo: 'Ana María López',
      documento: '5555555',
      direccion: 'Calle Palma 99',
      telefono: '0981222222',
      email: 'ana@example.com',
      fecha_alta: '2026-01-01',
    },
  ];
  mock.tables.medidores = [
    {
      id: MEDIDOR_1_ID,
      numero_medidor: 1,
      cliente_id: CLI_1_ID,
      direccion: 'Ruta 2 Km 15',
      zona: 'Centro',
      estado: 'activo',
      lectura_inicial: 0,
      fecha_instalacion: '2026-01-01',
    },
    {
      id: MEDIDOR_2_ID,
      numero_medidor: 2,
      cliente_id: CLI_2_ID,
      direccion: 'Calle Palma 99',
      zona: 'Norte',
      estado: 'activo',
      lectura_inicial: 0,
      fecha_instalacion: '2026-01-01',
    },
  ];

  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  // El buscador antiguo con limit=1 devolvía Medidor 1 cuando se buscaba "2"; getMedidorPorNumero(2) debe devolver estrictamente Medidor 2
  const medidor2 = db.getMedidorPorNumero(2);
  assert.ok(medidor2);
  assert.equal(medidor2!.numero_medidor, 2);
  assert.equal(medidor2!.id, MEDIDOR_2_ID);
  assert.equal(medidor2!.clienteNombre, 'Ana María López');

  // Guardar lectura en modo offline para el medidor seleccionado (2)
  await assert.rejects(
    () =>
      db.registrarLecturaAsync(
        {
          numeroMedidor: medidor2!.numero_medidor,
          lecturaActual: 35,
          fechaLectura: '2026-11-21',
          fotoUrl: 'data:image/jpeg;base64,/9j/demo',
          estado: 'confirmada',
          registradoPor: 'Lector de Campo',
          registradoPorId: LECTOR_USER_ID,
        },
        { clientOverride: mock.client, storageOverride: storage, forceOffline: true }
      ),
    (err: any) => err?.queuedOffline === true
  );

  const cola = getLecturasOfflineQueue(storage);
  assert.equal(cola.length, 1);
  assert.equal(cola[0].payload.numeroMedidor, 2);

  // Sincronizar al volver la señal -> debe insertar en MEDIDOR_2_ID, nunca MEDIDOR_1_ID
  const syncRes = await db.sincronizarLecturasOfflineAsync({
    clientOverride: mock.client,
    storageOverride: storage,
  });
  assert.equal(syncRes.syncedCount, 1);
  assert.equal(mock.tables.lecturas.length, 1);
  assert.equal(mock.tables.lecturas[0].medidor_id, MEDIDOR_2_ID);
  assert.equal(mock.tables.lecturas[0].lectura_actual, 35);
});

test('7. editar lectura con motivo "prueba" guarda motivo_edicion="prueba" en Supabase y persiste tras recarga', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  const lecturaId = '77777777-7777-4777-8777-777777777771';
  mock.tables.lecturas.push({
    id: lecturaId,
    medidor_id: MEDIDOR_ID,
    periodo: '2026-11',
    fecha_lectura: '2026-11-10',
    lectura_anterior: 50,
    lectura_actual: 60,
    consumo_m3: 10,
    foto_medidor_url: 'data:image/jpeg;base64,/9j/demo',
    observaciones: null,
    foto_observacion_url: null,
    estado: 'confirmada',
    registrado_por: LECTOR_USER_ID,
    fecha_registro: '2026-11-10T12:00:00Z',
    editado_por: null,
    fecha_edicion: null,
    motivo_edicion: null,
  });

  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  const editada = await db.actualizarLecturaAsync(
    lecturaId,
    {
      lecturaActual: 65,
      observaciones: 'Ajuste verificado',
      motivoEdicion: 'prueba',
    },
    { id: ADMIN_USER_ID, rol: 'admin', nombre: 'Administrador Principal' },
    { clientOverride: mock.client }
  );

  assert.equal(editada.motivo_edicion, 'prueba');
  assert.equal(mock.tables.lecturas[0].motivo_edicion, 'prueba');
  assert.equal(mock.tables.lecturas[0].lectura_actual, 65);

  // Recargar desde Supabase y verificar que motivo_edicion sigue siendo "prueba"
  db.clearData();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });
  const historial = db.getLecturas({});
  assert.equal(historial.total, 1);
  assert.equal(historial.lecturas[0].motivo_edicion, 'prueba');
});

test('8. eliminarLecturaAsync borra la única lectura (count=0) y detecta bloqueo RLS de 0 filas', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  const lecturaId = '88888888-8888-4888-8888-888888888881';
  mock.tables.lecturas.push({
    id: lecturaId,
    medidor_id: MEDIDOR_ID,
    periodo: '2026-11',
    fecha_lectura: '2026-11-15',
    lectura_anterior: 0,
    lectura_actual: 22,
    consumo_m3: 22,
    foto_medidor_url: 'data:image/jpeg;base64,/9j/demo',
    observaciones: null,
    foto_observacion_url: null,
    estado: 'confirmada',
    registrado_por: LECTOR_USER_ID,
    fecha_registro: '2026-11-15T12:00:00Z',
  });

  await db.loadFromSupabase({ clientOverride: mock.client, force: true });
  assert.equal(mock.tables.lecturas.length, 1);

  // Si RLS devuelve 0 filas eliminadas (sin error explícito), debe lanzar error y NO quitar del estado local
  const clientRlsCeroFilas = {
    auth: mock.client.auth,
    from: () => ({
      delete: () => ({
        eq: () => ({
          select: async () => ({ data: [], error: null }),
        }),
      }),
    }),
  };

  await assert.rejects(
    () =>
      db.eliminarLecturaAsync(
        lecturaId,
        { id: LECTOR_USER_ID, rol: 'lectura', nombre: 'Lector' },
        'prueba',
        { clientOverride: clientRlsCeroFilas }
      ),
    /permisos RLS/
  );
  assert.equal(db.getLecturas({}).total, 1);

  // Eliminación válida por admin -> count = 0 en Supabase y tras recarga
  const ok = await db.eliminarLecturaAsync(
    lecturaId,
    { id: ADMIN_USER_ID, rol: 'admin', nombre: 'Administrador Principal' },
    'prueba',
    { clientOverride: mock.client }
  );
  assert.equal(ok, true);
  assert.equal(mock.tables.lecturas.length, 0);

  db.clearData();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });
  assert.equal(db.getLecturas({}).total, 0);
});

test('9. Cámara solicita lente TRASERA por defecto (facingMode: environment), permite fallback y cambio manual', async () => {
  const exactConstraints = buildCameraConstraints('environment', true) as any;
  assert.deepEqual(exactConstraints.video.facingMode, { exact: 'environment' });

  const calls: any[] = [];
  const fakeRearStream = {
    getVideoTracks: () => [{ getSettings: () => ({ facingMode: 'environment' }), stop: () => {} }],
    getTracks: () => [],
  } as unknown as MediaStream;

  const resRear = await requestRearFirstCameraStream({
    getUserMedia: async (constraints) => {
      calls.push(constraints);
      return fakeRearStream;
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].video.facingMode, { exact: 'environment' });
  assert.equal(resRear.activeFacingMode, 'environment');
  assert.equal(resRear.usedFallback, false);

  // Dispositivo sin cámara trasera -> fallback progresivo a frontal disponible
  const fallbackCalls: any[] = [];
  const fakeFrontStream = {
    getVideoTracks: () => [{ getSettings: () => ({ facingMode: 'user' }), stop: () => {} }],
    getTracks: () => [],
  } as unknown as MediaStream;

  const resFallback = await requestRearFirstCameraStream({
    getUserMedia: async (constraints: any) => {
      fallbackCalls.push(constraints);
      if (constraints?.video?.facingMode) {
        const err = new Error('Overconstrained');
        err.name = 'OverconstrainedError';
        throw err;
      }
      return fakeFrontStream;
    },
  });
  assert.equal(fallbackCalls.length, 3);
  assert.equal(resFallback.usedFallback, true);
  assert.equal(resFallback.activeFacingMode, 'user');

  // Cambio manual Trasera <-> Frontal
  assert.equal(toggleCameraFacingMode('environment'), 'user');
  assert.equal(toggleCameraFacingMode('user'), 'environment');
});

test('10. Banners "Sin conexión" (superior e inferior) desaparecen por completo tras sincronizar la cola offline', async () => {
  db.clearData();
  const storage = createMemoryStorage();
  clearLecturasOfflineQueue(storage);
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  // Guardar offline -> ambos avisos visibles
  let queuedMsg = '';
  await assert.rejects(
    () =>
      db.registrarLecturaAsync(
        {
          numeroMedidor: 12,
          lecturaActual: 88,
          fechaLectura: '2026-11-22',
          fotoUrl: 'data:image/jpeg;base64,/9j/demo',
          estado: 'confirmada',
          registradoPor: 'Lector de Campo',
          registradoPorId: LECTOR_USER_ID,
        },
        { clientOverride: mock.client, storageOverride: storage, forceOffline: true }
      ),
    (err: any) => {
      queuedMsg = err.message;
      return err?.queuedOffline === true;
    }
  );

  const uiOffline = resolveOfflineStatusUi({
    isOnline: false,
    colaOfflineCount: getLecturasOfflineQueue(storage).length,
    offlineQueuedMessage: queuedMsg,
  });
  assert.equal(uiOffline.showTopBanner, true);
  assert.equal(uiOffline.showQueuedNotice, true);

  // Vuelve internet y se sincroniza la cola
  const syncRes = await db.sincronizarLecturasOfflineAsync({
    clientOverride: mock.client,
    storageOverride: storage,
  });
  assert.equal(syncRes.remainingCount, 0);

  // Incluso si offlineQueuedMessage no se hubiera limpiado aparte, la fuente única (cola === 0) apaga el aviso inferior
  const uiOnlineSynced = resolveOfflineStatusUi({
    isOnline: true,
    colaOfflineCount: syncRes.remainingCount,
    offlineQueuedMessage: queuedMsg,
  });
  assert.equal(uiOnlineSynced.showTopBanner, false);
  assert.equal(uiOnlineSynced.showQueuedNotice, false);
  assert.equal(uiOnlineSynced.queuedNoticeText, null);
});

test('11. Eliminar lectura SIN factura pagada muestra campo de motivo como OPCIONAL', async () => {
  const config = getDeleteMotivoFieldConfig(false);
  assert.equal(config.visible, true);
  assert.equal(config.required, false);
  assert.match(config.label, /Opcional/i);

  db.clearData();
  const mock = createStatefulSupabaseMock();
  const lecturaId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  mock.tables.lecturas.push({
    id: lecturaId,
    medidor_id: MEDIDOR_ID,
    periodo: '2026-11',
    fecha_lectura: '2026-11-18',
    lectura_anterior: 0,
    lectura_actual: 12,
    consumo_m3: 12,
    foto_medidor_url: 'data:image/jpeg;base64,/9j/demo',
    observaciones: null,
    foto_observacion_url: null,
    estado: 'borrador',
    registrado_por: LECTOR_USER_ID,
    fecha_registro: '2026-11-18T10:00:00Z',
  });
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  // Debe permitir eliminar tanto sin motivo como con motivo opcional
  const ok = await db.eliminarLecturaAsync(
    lecturaId,
    { id: ADMIN_USER_ID, rol: 'admin', nombre: 'Admin' },
    'Lectura duplicada de prueba',
    { clientOverride: mock.client }
  );
  assert.equal(ok, true);
  assert.equal(mock.tables.lecturas.length, 0);
});

test('12. Eliminar lectura CON factura pagada muestra campo de motivo como OBLIGATORIO', async () => {
  const config = getDeleteMotivoFieldConfig(true);
  assert.equal(config.visible, true);
  assert.equal(config.required, true);
  assert.match(config.label, /Obligatorio/i);

  db.clearData();
  const mock = createStatefulSupabaseMock({ withUnpaidFactura: true });
  const lecturaId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  mock.tables.facturas[0].estado = 'pagada';
  mock.tables.facturas[0].lectura_id = lecturaId;
  mock.tables.lecturas.push({
    id: lecturaId,
    medidor_id: MEDIDOR_ID,
    periodo: '2026-10',
    fecha_lectura: '2026-10-18',
    lectura_anterior: 100,
    lectura_actual: 110,
    consumo_m3: 10,
    foto_medidor_url: 'data:image/jpeg;base64,/9j/demo',
    observaciones: null,
    foto_observacion_url: null,
    estado: 'confirmada',
    registrado_por: LECTOR_USER_ID,
    fecha_registro: '2026-10-18T10:00:00Z',
  });
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  // Sin motivo -> rechaza
  await assert.rejects(
    () =>
      db.eliminarLecturaAsync(
        lecturaId,
        { id: ADMIN_USER_ID, rol: 'admin', nombre: 'Admin' },
        undefined,
        { clientOverride: mock.client }
      ),
    /justificación|motivo/i
  );

  // Con motivo válido (>= 5 chars) -> elimina
  const ok = await db.eliminarLecturaAsync(
    lecturaId,
    { id: ADMIN_USER_ID, rol: 'admin', nombre: 'Admin' },
    'Anulación autorizada por auditoría',
    { clientOverride: mock.client }
  );
  assert.equal(ok, true);
  assert.equal(mock.tables.lecturas.length, 0);
});

test('13. HTML generado incluye <input type="file" capture="environment"> para medidor y observación', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  // Asegurar que exista el Medidor N° 1 (seleccionado por defecto en Toma Móvil)
  mock.tables.medidores[0].numero_medidor = 1;
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  const html = renderToStaticMarkup(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(LecturasMobileView)
    )
  );

  // Ambos inputs nativos de cámara (medidor y observación) deben tener capture="environment"
  assert.match(
    html,
    /<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*capture="environment"[^>]*data-camera-target="medidor"[^>]*>/
  );
  assert.match(
    html,
    /<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*capture="environment"[^>]*data-camera-target="observacion"[^>]*>/
  );
  assert.match(html, /Tomar Foto Cámara/);
  assert.match(html, /Adjuntar foto de observación \(opcional\)/);
});

test('14. HTML generado mantiene botón e inputs "Subir desde galería" SIN atributo capture como alternativa', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  mock.tables.medidores[0].numero_medidor = 1;
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  const html = renderToStaticMarkup(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(LecturasMobileView)
    )
  );

  // Botón visible "Subir desde galería" (medidor y observación)
  const matches = html.match(/Subir desde galería/g) || [];
  assert.ok(matches.length >= 2, 'Debe mostrar Subir desde galería tanto para medidor como para observación');

  // Los inputs de galería NO deben forzar capture
  const medidorGalleryInput = html.match(/<input[^>]*data-gallery-target="medidor"[^>]*>/)?.[0];
  const obsGalleryInput = html.match(/<input[^>]*data-gallery-target="observacion"[^>]*>/)?.[0];
  assert.ok(medidorGalleryInput, 'Debe existir input de galería para medidor');
  assert.ok(obsGalleryInput, 'Debe existir input de galería para observación');
  assert.equal(/capture=/.test(medidorGalleryInput!), false);
  assert.equal(/capture=/.test(obsGalleryInput!), false);
});

test('15. Si el input nativo de cámara falla al abrir, retorna el mensaje claro para usar galería o revisar permisos', () => {
  // Caso 1: Input disponible ejecuta click() directo sin error
  let clicked = false;
  const okRes = triggerNativeCameraInput({
    click: () => {
      clicked = true;
    },
  });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.errorMessage, null);
  assert.equal(clicked, true);

  // Caso 2: Input lanza excepción al intentar abrir cámara del sistema
  const throwRes = triggerNativeCameraInput({
    click: () => {
      throw new Error('Blocked by browser permissions policy');
    },
  });
  assert.equal(throwRes.ok, false);
  assert.equal(
    throwRes.errorMessage,
    'No se pudo abrir la cámara. Probá subir la foto desde la galería o verificar los permisos del navegador.'
  );
  assert.equal(throwRes.errorMessage, CAMERA_OPEN_ERROR_MESSAGE);

  // Caso 3: Ref nulo / deshabilitado
  const nullRes = triggerNativeCameraInput(null);
  assert.equal(nullRes.ok, false);
  assert.equal(nullRes.errorMessage, CAMERA_OPEN_ERROR_MESSAGE);
});



