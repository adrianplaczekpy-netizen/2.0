/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './database';

function createMockSupabaseClient(options: {
  sessionUser?: { id: string; email: string } | null;
  sessionError?: { message: string } | null;
  tables?: Record<string, { data?: any[]; error?: { message: string } | null }>;
}) {
  const queryLog: string[] = [];

  const makeBuilder = (tableName: string) => {
    const result = options.tables?.[tableName] ?? { data: [], error: null };
    const builder: any = {
      select() {
        queryLog.push(tableName);
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      then(resolve: (val: any) => void, reject?: (err: any) => void) {
        return Promise.resolve({
          data: result.data ?? [],
          error: result.error ?? null,
        }).then(resolve, reject);
      },
    };
    return builder;
  };

  return {
    queryLog,
    client: {
      auth: {
        async getSession() {
          if (options.sessionError) {
            return { data: { session: null }, error: options.sessionError };
          }
          return {
            data: {
              session: options.sessionUser ? { user: options.sessionUser } : null,
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

test('1. Sin sesión autenticada en Supabase, loadFromSupabase NO consulta tablas como anon ni marca conectado', async () => {
  db.clearData();
  const mock = createMockSupabaseClient({ sessionUser: null });

  const res = await db.loadFromSupabase({
    clientOverride: mock.client,
    silentIfUnauthenticated: false,
    force: true,
  });

  assert.equal(res.ok, false);
  assert.equal(res.clientesCount, 0);
  assert.ok(res.error && res.error.includes('sesión autenticada'));
  assert.equal(mock.queryLog.length, 0, 'No debe consultar tablas RLS sin sesión autenticada');
  assert.equal(db.getConnectionStatus(), 'error');
  assert.equal(db.getClientes({ page: 1, limit: 50 }).total, 0);
});

test('2. Con sesión autenticada, loadFromSupabase carga los 3 clientes y 4 medidores reales desde Supabase', async () => {
  db.clearData();
  const mock = createMockSupabaseClient({
    sessionUser: { id: 'usr-admin-silver', email: 'silverplack@gmail.com' },
    tables: {
      tarifas: {
        data: [
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
      },
      clientes: {
        data: [
          {
            id: 'cli-1',
            nombre_completo: 'Juan Pérez',
            documento: '1234567',
            direccion: 'Av. San José 100',
            telefono: '0981111222',
            email: 'juan@example.com',
            fecha_alta: '2026-01-10',
          },
          {
            id: 'cli-2',
            nombre_completo: 'María López',
            documento: '2345678',
            direccion: 'Calle Palma 200',
            telefono: null,
            email: null,
            fecha_alta: '2026-02-15',
          },
          {
            id: 'cli-3',
            nombre_completo: 'Carlos Benítez',
            documento: '3456789',
            direccion: 'Ruta 2 Km 18',
            telefono: '0983333444',
            email: 'carlos@example.com',
            fecha_alta: '2026-03-01',
          },
        ],
      },
      medidores: {
        data: [
          { id: 'med-1', cliente_id: 'cli-1', numero_medidor: 1, direccion: 'Dir 1', zona: 'Centro', latitud: -25.3, longitud: -57.5, fecha_instalacion: '2026-01-10', estado: 'activo' },
          { id: 'med-2', cliente_id: 'cli-2', numero_medidor: 2, direccion: 'Dir 2', zona: 'Centro', latitud: -25.3, longitud: -57.5, fecha_instalacion: '2026-02-15', estado: 'activo' },
          { id: 'med-3', cliente_id: 'cli-3', numero_medidor: 3, direccion: 'Dir 3', zona: 'Centro', latitud: -25.3, longitud: -57.5, fecha_instalacion: '2026-03-01', estado: 'activo' },
          { id: 'med-4', cliente_id: 'cli-3', numero_medidor: 4, direccion: 'Dir 4', zona: 'Centro', latitud: -25.3, longitud: -57.5, fecha_instalacion: '2026-03-05', estado: 'moroso' },
        ],
      },
    },
  });

  const res = await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  assert.equal(res.ok, true);
  assert.equal(res.clientesCount, 3);
  assert.equal(res.medidoresCount, 4);
  assert.equal(db.getConnectionStatus(), 'connected');
  assert.equal(db.getDbError(), null);

  const lista = db.getClientes({ page: 1, limit: 50 });
  assert.equal(lista.total, 3);
  assert.equal(lista.clientes[0].nombre_completo, 'Juan Pérez');
  assert.equal(lista.clientes[2].medidoresCount, 2);

  // Búsqueda con campos nulos en registro no debe fallar
  const buscado = db.getClientes({ page: 1, limit: 50, search: 'maría' });
  assert.equal(buscado.total, 1);
  assert.equal(buscado.clientes[0].id, 'cli-2');
});

test('3. Si una consulta de tabla falla en Supabase, NO traga el error ni cae en localStorage', async () => {
  db.clearData();
  const mock = createMockSupabaseClient({
    sessionUser: { id: 'usr-admin-silver', email: 'silverplack@gmail.com' },
    tables: {
      clientes: {
        data: [],
        error: { message: 'permission denied for table clientes' },
      },
    },
  });

  const res = await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  assert.equal(res.ok, false);
  assert.equal(res.clientesCount, 0);
  assert.ok(res.error && res.error.includes('clientes'));
  assert.ok(res.error && res.error.includes('permission denied'));
  assert.equal(db.getConnectionStatus(), 'error');
  assert.equal(db.getDbError(), res.error);
  assert.equal(db.getClientes({ page: 1, limit: 50 }).total, 0);
});

test('4. clearData limpia los datos en memoria al cerrar sesión', () => {
  db.clearData();
  assert.equal(db.getClientes({ page: 1, limit: 50 }).total, 0);
  assert.equal(db.getMedidores({ page: 1, limit: 50 }).total, 0);
  assert.equal(db.getConnectionStatus(), 'connecting');
  assert.equal(db.getDbError(), null);
});
