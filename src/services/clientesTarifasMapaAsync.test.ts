/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { db } from './database';
import {
  GEO_ERR_PERMISSION_DENIED,
  GEO_ERR_POSITION_UNAVAILABLE,
  GEO_ERR_TIMEOUT,
  GEO_ERR_UNSUPPORTED,
  GeolocationLike,
  resetGeolocationSessionState,
  solicitarUbicacionActual,
} from '../utils/geolocationHelper';
import {
  construirMensajeResumenErroresTarifa,
  seleccionarPrimerCampoConError,
} from '../utils/tarifaValidationHelper';
import {
  getMapTileLayersConfig,
  getMapboxSatelliteStreetsUrl,
  getMapboxSatelliteUrl,
  isMapboxTokenConfigured,
  MAP_DEFAULT_LAYER_NAME,
  MAP_TILE_LAYERS_CONFIG,
} from '../utils/mapLayersHelper';
import {
  calcularBoundsZonaDescarga,
  calcularZoomsDescargaOffline,
  deduplicarTilesOffline,
  ejecutarDescargaTilesOffline,
  OfflineTileDescriptor,
} from '../utils/mapOfflineHelper';
import {
  AGUATERIA_UBICACION,
  ZONAS_AGUATERIA_SECTOR,
  ZONA_AGUATERIA_DEFAULT,
  resolverZonaParaEdicion,
} from '../config/aguateriaConfig';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const COLUMNAS_CLIENTES = new Set([
  'id',
  'nombre_completo',
  'documento',
  'direccion',
  'telefono',
  'email',
  'fecha_alta',
  'created_at',
]);

const COLUMNAS_TARIFAS = new Set([
  'id',
  'precio_m3',
  'consumo_minimo_m3',
  'monto_minimo_consumo',
  'monto_mora_fijo',
  'monto_reconexion',
  'erssan_porcentaje',
  'dia_vencimiento_boletas_normales',
  'dia_vencimiento_tercera_boleta',
  'umbral_alerta_consumo',
  'texto_alerta_consumo',
  'max_numero_medidor',
  'vigente_desde',
  'creado_por',
  'fecha_creacion',
  'motivo_cambio',
  'cambios_auditados',
]);

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENTE_1_ID = '11111111-1111-4111-8111-111111111111';
const MEDIDOR_1_ID = '22222222-2222-4222-8222-222222222221';
const FACTURA_1_ID = '33333333-3333-4333-8333-333333333331';
const TARIFA_BASE_ID = '44444444-4444-4444-8444-444444444441';

function createStatefulSupabaseMock(options?: {
  withMedidorForCliente1?: boolean;
  withFacturaEmitida?: boolean;
}) {
  const tables: Record<string, any[]> = {
    tarifas: [
      {
        id: TARIFA_BASE_ID,
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
        fecha_creacion: '2026-01-01T00:00:00.000Z',
        motivo_cambio: 'Tarifa inicial',
        cambios_auditados: [],
      },
    ],
    clientes: [
      {
        id: CLIENTE_1_ID,
        nombre_completo: 'Carlos Benítez',
        documento: '4567890',
        direccion: 'Calle San José 123',
        telefono: '0981444555',
        email: 'carlos@example.com',
        fecha_alta: '2026-01-01',
      },
    ],
    medidores: options?.withMedidorForCliente1
      ? [
          {
            id: MEDIDOR_1_ID,
            cliente_id: CLIENTE_1_ID,
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
        ]
      : [],
    contratos: [
      {
        id: '55555555-5555-4555-8555-555555555551',
        cliente_id: CLIENTE_1_ID,
        fecha_inicio: '2026-01-01',
        fecha_fin: null,
        condiciones: 'Suministro de agua potable conforme a normativas de ERSSAN.',
        estado: 'vigente',
      },
    ],
    lecturas: [],
    facturas: options?.withFacturaEmitida
      ? [
          {
            id: FACTURA_1_ID,
            medidor_id: MEDIDOR_1_ID,
            cliente_id: CLIENTE_1_ID,
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
    detalle_factura: options?.withFacturaEmitida
      ? [
          {
            id: '66666666-6666-4666-8666-666666666661',
            factura_id: FACTURA_1_ID,
            concepto: 'consumo_agua',
            descripcion: 'Consumo de agua (10 m³)',
            monto: 40000,
          },
          {
            id: '66666666-6666-4666-8666-666666666662',
            factura_id: FACTURA_1_ID,
            concepto: 'erssan',
            descripcion: 'Tasa ERSSAN 2%',
            monto: 800,
          },
        ]
      : [],
    pagos: [],
    cargos_pendientes: [],
    planes_financiamiento: [],
    usuarios: [],
  };

  let failInsertTable: Record<string, { message: string; code?: string } | null> = {};
  let failUpdateTable: Record<string, { message: string; code?: string } | null> = {};
  let failDeleteTable: Record<string, { message: string; code?: string } | null> = {};
  let throwNetworkOnDelete = false;
  let throwNetworkOnInsert = false;
  let rlsZeroRowsOnUpdate = false;

  const validateClienteRow = (payload: Record<string, any>, isInsert: boolean) => {
    for (const key of Object.keys(payload)) {
      if (!COLUMNAS_CLIENTES.has(key)) {
        return { message: `Could not find the '${key}' column of 'clientes'`, code: 'PGRST204' };
      }
    }
    if (isInsert) {
      if (!UUID_REGEX.test(payload.id)) {
        return { message: 'invalid input syntax for type uuid', code: '22P02' };
      }
      if (tables.clientes.some((c) => c.documento === payload.documento)) {
        return {
          message: 'duplicate key value violates unique constraint "clientes_documento_key"',
          code: '23505',
        };
      }
    }
    return null;
  };

  const validateTarifaRow = (payload: Record<string, any>) => {
    for (const key of Object.keys(payload)) {
      if (!COLUMNAS_TARIFAS.has(key)) {
        return { message: `Could not find the '${key}' column of 'tarifas'`, code: 'PGRST204' };
      }
    }
    if (!UUID_REGEX.test(payload.id)) {
      return { message: 'invalid input syntax for type uuid', code: '22P02' };
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
        if (throwNetworkOnInsert) throw new TypeError('Failed to fetch');
        if (failInsertTable[tableName]) return { data: null, error: failInsertTable[tableName] };
        const rows = Array.isArray(payload) ? payload : [payload];
        for (const r of rows) {
          if (tableName === 'clientes') {
            const err = validateClienteRow(r, true);
            if (err) return { data: null, error: err };
          } else if (tableName === 'tarifas') {
            const err = validateTarifaRow(r);
            if (err) return { data: null, error: err };
          }
          tables[tableName].push({
            ...r,
            ...(tableName === 'tarifas' && !r.fecha_creacion
              ? { fecha_creacion: new Date().toISOString() }
              : {}),
          });
        }
        return { data: rows, error: null };
      }

      if (op === 'update') {
        if (failUpdateTable[tableName]) return { data: null, error: failUpdateTable[tableName] };
        if (rlsZeroRowsOnUpdate) return { data: [], error: null };
        if (tableName === 'clientes') {
          const err = validateClienteRow(payload, false);
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
        if (throwNetworkOnDelete) throw new TypeError('Failed to fetch');
        if (failDeleteTable[tableName]) return { data: null, error: failDeleteTable[tableName] };
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
    setFailInsert(table: string, err: { message: string; code?: string } | null) {
      failInsertTable[table] = err;
    },
    setFailUpdate(table: string, err: { message: string; code?: string } | null) {
      failUpdateTable[table] = err;
    },
    setFailDelete(table: string, err: { message: string; code?: string } | null) {
      failDeleteTable[table] = err;
    },
    setThrowNetworkOnDelete(v: boolean) {
      throwNetworkOnDelete = v;
    },
    setThrowNetworkOnInsert(v: boolean) {
      throwNetworkOnInsert = v;
    },
    setRlsZeroRowsOnUpdate(v: boolean) {
      rlsZeroRowsOnUpdate = v;
    },
    client: {
      auth: {
        async getSession() {
          return {
            data: { session: { user: { id: ADMIN_ID, email: 'admin@example.com' } } },
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

// =====================================================================
// CLIENTES
// =====================================================================

test('1. Clientes: Crear cliente exitoso persiste en public.clientes y tras recarga', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  const nuevo = await db.agregarClienteAsync(
    {
      nombre_completo: 'María Auxiliadora López',
      documento: '3912450',
      direccion: 'Av. del Agrónomo 520',
      telefono: '0982111222',
      email: 'maria.lopez@example.com',
    },
    { clientOverride: mock.client }
  );

  assert.match(nuevo.id, UUID_REGEX);
  assert.equal(mock.tables.clientes.length, 2);
  assert.equal(mock.tables.contratos.length, 2);

  db.clearData();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });
  const recargado = db.getClientes({ search: '3912450' });
  assert.equal(recargado.total, 1);
  assert.equal(recargado.clientes[0].id, nuevo.id);
  assert.equal(recargado.clientes[0].nombre_completo, 'María Auxiliadora López');
});

test('2. Clientes: Documento duplicado rechaza con error inline claro y no crea ni muta estado local', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  // Caso A: duplicado en memoria
  await assert.rejects(
    () =>
      db.agregarClienteAsync(
        {
          nombre_completo: 'Otro Titular',
          documento: '4567890',
          direccion: 'Calle X 100',
          telefono: '',
          email: '',
        },
        { clientOverride: mock.client }
      ),
    /Ya existe un cliente con ese documento/
  );
  assert.equal(db.getClientes({ limit: 50 }).total, 1);
  assert.equal(mock.tables.clientes.length, 1);

  // Caso B: código 23505 devuelto por Supabase
  mock.setFailInsert('clientes', {
    message: 'duplicate key value violates unique constraint "clientes_documento_key"',
    code: '23505',
  });
  await assert.rejects(
    () =>
      db.agregarClienteAsync(
        {
          nombre_completo: 'Titular Duplicado Remoto',
          documento: '9998887',
          direccion: 'Calle Y 200',
          telefono: '',
          email: '',
        },
        { clientOverride: mock.client }
      ),
    /Ya existe un cliente con ese documento/
  );
  assert.equal(db.getClientes({ limit: 50 }).total, 1);
  assert.equal(mock.tables.clientes.length, 1);
});

test('3. Clientes: Crear cliente sin nombre rechaza con "El nombre es obligatorio"', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  await assert.rejects(
    () =>
      db.agregarClienteAsync(
        {
          nombre_completo: '   ',
          documento: '5551112',
          direccion: 'Av. Principal 10',
          telefono: '',
          email: '',
        },
        { clientOverride: mock.client }
      ),
    /El nombre es obligatorio/
  );
  assert.equal(mock.tables.clientes.length, 1);
  assert.equal(db.getClientes({ limit: 50 }).total, 1);
});

test('4. Clientes: Editar cliente persiste en Supabase y no muta estado si falla RLS/red', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  mock.setRlsZeroRowsOnUpdate(true);
  await assert.rejects(
    () =>
      db.actualizarClienteAsync(
        CLIENTE_1_ID,
        { nombre_completo: 'Nombre Rechazado', telefono: '0999000000' },
        { clientOverride: mock.client }
      ),
    /No se pudo actualizar el cliente/
  );
  assert.equal(db.getClienteDetalle(CLIENTE_1_ID)?.cliente?.nombre_completo, 'Carlos Benítez');

  mock.setRlsZeroRowsOnUpdate(false);
  const editado = await db.actualizarClienteAsync(
    CLIENTE_1_ID,
    {
      nombre_completo: 'Carlos Benítez Actualizado',
      direccion: 'Nueva Dirección 777',
      telefono: '0981999888',
    },
    { clientOverride: mock.client }
  );
  assert.equal(editado.nombre_completo, 'Carlos Benítez Actualizado');

  db.clearData();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });
  const recargado = db.getClienteDetalle(CLIENTE_1_ID)?.cliente;
  assert.equal(recargado?.nombre_completo, 'Carlos Benítez Actualizado');
  assert.equal(recargado?.direccion, 'Nueva Dirección 777');
  assert.equal(recargado?.telefono, '0981999888');
});

test('5. Clientes: Eliminar cliente SIN medidores persiste y falla limpio si cae la red', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock({ withMedidorForCliente1: false });
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  mock.setThrowNetworkOnDelete(true);
  await assert.rejects(
    () => db.eliminarClienteAsync(CLIENTE_1_ID, { clientOverride: mock.client }),
    /No se pudo eliminar el cliente: .*Failed to fetch/
  );
  assert.equal(db.getClientes({ limit: 50 }).total, 1);
  assert.equal(mock.tables.clientes.length, 1);

  mock.setThrowNetworkOnDelete(false);
  const ok = await db.eliminarClienteAsync(CLIENTE_1_ID, { clientOverride: mock.client });
  assert.equal(ok, true);
  assert.equal(db.getClientes({ limit: 50 }).total, 0);
  assert.equal(mock.tables.clientes.length, 0);

  db.clearData();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });
  assert.equal(db.getClientes({ limit: 50 }).total, 0);
});

test('6. Clientes: Eliminar cliente CON medidores asociados bloquea con mensaje exacto', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock({ withMedidorForCliente1: true });
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  await assert.rejects(
    () => db.eliminarClienteAsync(CLIENTE_1_ID, { clientOverride: mock.client }),
    /No se puede eliminar un cliente con medidores\. Eliminá primero los medidores o desactivalo\./
  );
  assert.equal(mock.tables.clientes.length, 1);

  // También cuando los medidores no están en memoria local pero sí en Supabase
  db.clearData();
  const mockSoloCliente = createStatefulSupabaseMock({ withMedidorForCliente1: false });
  await db.loadFromSupabase({ clientOverride: mockSoloCliente.client, force: true });

  await assert.rejects(
    () => db.eliminarClienteAsync(CLIENTE_1_ID, { clientOverride: mock.client }),
    /No se puede eliminar un cliente con medidores\. Eliminá primero los medidores o desactivalo\./
  );
  assert.equal(mock.tables.clientes.length, 1);
});

// =====================================================================
// TARIFAS
// =====================================================================

test('7. Tarifas: Cambiar precio_m3 crea nueva versión con vigente_desde = hoy y conserva la anterior', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  const hoy = new Date().toISOString().split('T')[0];

  // Si falla el INSERT en Supabase -> error y NO muta estado local ni historial
  mock.setFailInsert('tarifas', { message: 'permission denied for table tarifas', code: '42501' });
  await assert.rejects(
    () =>
      db.actualizarTarifasAsync(
        { precio_m3: 4500 },
        ADMIN_ID,
        'Ajuste anual',
        hoy,
        { clientOverride: mock.client }
      ),
    /No se pudo guardar la nueva tarifa/
  );
  assert.equal(db.getTarifasVigentes().precio_m3, 4000);
  assert.equal(db.getHistorialTarifas().length, 1);
  assert.equal(mock.tables.tarifas.length, 1);

  // Éxito -> crea nueva fila con vigente_desde = hoy y mantiene versión anterior
  mock.setFailInsert('tarifas', null);
  const nueva = await db.actualizarTarifasAsync(
    { precio_m3: 4500 },
    ADMIN_ID,
    'Ajuste tarifario ERSSAN',
    hoy,
    { clientOverride: mock.client }
  );

  assert.equal(nueva.precio_m3, 4500);
  assert.equal(nueva.vigente_desde, hoy);
  assert.equal(mock.tables.tarifas.length, 2);

  db.clearData();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });
  const historial = db.getHistorialTarifas();
  assert.equal(historial.length, 2);
  assert.equal(db.getTarifasVigentes().precio_m3, 4500);
  const anterior = historial.find((t) => t.id === TARIFA_BASE_ID);
  assert.ok(anterior);
  assert.equal(anterior!.precio_m3, 4000);
  assert.equal(anterior!.vigente_desde, '2026-01-01');
});

test('8. Tarifas: Cambiar erssan_porcentaje a 150 arroja error de validación y no inserta', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  await assert.rejects(
    () =>
      db.actualizarTarifasAsync(
        { erssan_porcentaje: 150 },
        ADMIN_ID,
        'Prueba inválida',
        undefined,
        { clientOverride: mock.client }
      ),
    /ERSSAN debe estar entre 0% y 100%/
  );
  assert.equal(mock.tables.tarifas.length, 1);
  assert.equal(db.getTarifasVigentes().erssan_porcentaje, 2);
});

test('9. Tarifas: Cambiar texto_alerta_consumo vacío arroja error de validación y no inserta', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  await assert.rejects(
    () =>
      db.actualizarTarifasAsync(
        { texto_alerta_consumo: '   ' },
        ADMIN_ID,
        'Texto vacío inválido',
        undefined,
        { clientOverride: mock.client }
      ),
    /texto de alerta de consumo no puede estar vacío/i
  );
  assert.equal(mock.tables.tarifas.length, 1);
});

test('10. Tarifas: Facturas ya emitidas NO cambian sus montos tras actualizar tarifa', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock({
    withMedidorForCliente1: true,
    withFacturaEmitida: true,
  });
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  const facturaAntes = db.getFacturaPorId(FACTURA_1_ID)?.factura;
  assert.ok(facturaAntes);
  assert.equal(facturaAntes!.total, 40800);
  assert.equal(facturaAntes!.saldo_pendiente, 40800);

  const hoy = new Date().toISOString().split('T')[0];
  await db.actualizarTarifasAsync(
    {
      precio_m3: 8000,
      monto_minimo_consumo: 72000,
      erssan_porcentaje: 5,
    },
    ADMIN_ID,
    'Cambio fuerte de tarifa',
    hoy,
    { clientOverride: mock.client }
  );

  // Verificar en memoria inmediata y tras recarga completa
  const facturaDespuesMemoria = db.getFacturaPorId(FACTURA_1_ID)?.factura;
  assert.ok(facturaDespuesMemoria);
  assert.equal(facturaDespuesMemoria!.total, 40800);
  assert.equal(facturaDespuesMemoria!.saldo_pendiente, 40800);
  assert.equal((facturaDespuesMemoria!.detalles || []).reduce((s, d) => s + d.monto, 0), 40800);

  db.clearData();
  await db.loadFromSupabase({ clientOverride: mock.client, force: true });
  const facturaTrasRecarga = db.getFacturaPorId(FACTURA_1_ID)?.factura;
  assert.ok(facturaTrasRecarga);
  assert.equal(facturaTrasRecarga!.total, 40800);
  assert.equal(facturaTrasRecarga!.saldo_pendiente, 40800);
  assert.equal(db.verificarInmutabilidadFacturas().totalMontoHistorico, 40800);
});

// =====================================================================
// MAPA Y GEOLOCALIZACIÓN
// =====================================================================

test('11. Mapa y Vistas: Botón "Centrar en mi ubicación" existe y ClientesView/TarifasView usan *Async sin alert()', () => {
  const mapaSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/MapaMedidoresView.tsx'), 'utf8');
  const clientesSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/ClientesView.tsx'), 'utf8');
  const tarifasSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/TarifasView.tsx'), 'utf8');

  assert.match(mapaSrc, /Centrar en mi ubicación/);
  assert.match(mapaSrc, /LocateFixed/);
  assert.match(mapaSrc, /solicitarUbicacionActual/);
  assert.match(mapaSrc, /setView\(\[coords\.lat, coords\.lng\]/);

  assert.match(clientesSrc, /await db\.agregarClienteAsync\(/);
  assert.match(clientesSrc, /await db\.actualizarClienteAsync\(/);
  assert.match(clientesSrc, /await db\.eliminarClienteAsync\(/);
  assert.match(clientesSrc, /await db\.loadFromSupabase\(\{\s*force:\s*true\s*\}\)/);
  assert.equal(/db\.(agregarCliente|actualizarCliente|eliminarCliente)\(/.test(clientesSrc), false);
  assert.equal(/\balert\(/.test(clientesSrc), false);

  assert.match(tarifasSrc, /await db\.actualizarTarifasAsync\(/);
  assert.match(tarifasSrc, /await db\.loadFromSupabase\(\{\s*force:\s*true\s*\}\)/);
  assert.equal(/db\.actualizarTarifas\(/.test(tarifasSrc), false);
});

test('12. Mapa: solicitarUbicacionActual retorna coordenadas reales cuando hay permiso', async () => {
  const geoMock: GeolocationLike = {
    getCurrentPosition(success) {
      success({
        coords: {
          latitude: -25.337215,
          longitude: -57.508912,
          accuracy: 12,
        },
      });
    },
  };

  const coords = await solicitarUbicacionActual(geoMock);
  assert.equal(coords.lat, -25.337215);
  assert.equal(coords.lng, -57.508912);
  assert.equal(coords.accuracy, 12);
});

test('13. Mapa: errores de geolocalización por código (1=permiso, 2=GPS, 3=timeout, sin soporte) y bloqueo de reintentos tras denegación', async () => {
  resetGeolocationSessionState();

  // Código 1: PERMISSION_DENIED -> mensaje con instrucción de candado 🔒
  const geoDenegadoMock: GeolocationLike = {
    getCurrentPosition(_success, error) {
      error?.({ code: 1, message: 'User denied Geolocation' });
    },
  };
  await assert.rejects(
    () => solicitarUbicacionActual(geoDenegadoMock),
    (err: any) => {
      assert.equal(err.code, 1);
      assert.equal(err.message, GEO_ERR_PERMISSION_DENIED);
      assert.equal(
        err.message,
        'Habilitá la ubicación desde el candado 🔒 al lado de la URL en tu navegador.'
      );
      return true;
    }
  );

  // Si permissionAlreadyDenied es true, NO vuelve a llamar a getCurrentPosition
  let llamadasDespuesDeDenegar = 0;
  const geoSpyDenegado: GeolocationLike = {
    getCurrentPosition() {
      llamadasDespuesDeDenegar += 1;
    },
  };
  await assert.rejects(
    () => solicitarUbicacionActual(geoSpyDenegado, { permissionAlreadyDenied: true }),
    (err: any) => {
      assert.equal(err.code, 1);
      assert.equal(err.message, GEO_ERR_PERMISSION_DENIED);
      return true;
    }
  );
  assert.equal(llamadasDespuesDeDenegar, 0);

  // Código 2: POSITION_UNAVAILABLE -> verificar GPS
  const geoUnavailableMock: GeolocationLike = {
    getCurrentPosition(_success, error) {
      error?.({ code: 2, message: 'Position unavailable' });
    },
  };
  await assert.rejects(
    () => solicitarUbicacionActual(geoUnavailableMock),
    (err: any) => {
      assert.equal(err.code, 2);
      assert.equal(err.message, GEO_ERR_POSITION_UNAVAILABLE);
      assert.equal(
        err.message,
        'No se pudo determinar tu ubicación. Verificá el GPS de tu dispositivo.'
      );
      return true;
    }
  );

  // Código 3: TIMEOUT -> tardó demasiado
  const geoTimeoutMock: GeolocationLike = {
    getCurrentPosition(_success, error) {
      error?.({ code: 3, message: 'Timeout' });
    },
  };
  await assert.rejects(
    () => solicitarUbicacionActual(geoTimeoutMock),
    (err: any) => {
      assert.equal(err.code, 3);
      assert.equal(err.message, GEO_ERR_TIMEOUT);
      assert.equal(err.message, 'La ubicación tardó demasiado. Reintentá.');
      return true;
    }
  );

  // Navegador sin soporte de geolocalización
  await assert.rejects(
    () => solicitarUbicacionActual(null),
    (err: any) => {
      assert.equal(err.code, 0);
      assert.equal(err.message, GEO_ERR_UNSUPPORTED);
      assert.equal(err.message, 'Tu navegador no soporta geolocalización.');
      return true;
    }
  );
});

test('14. Tarifas: creado_por resuelve UUID a nombre_completo desde public.usuarios y maneja usuario eliminado', async () => {
  db.clearData();
  const mock = createStatefulSupabaseMock();
  mock.tables.usuarios.push({
    id: ADMIN_ID,
    nombre_completo: 'silverplack',
    email: 'silverplack@gmail.com',
  });
  mock.tables.tarifas.push({
    id: '44444444-4444-4444-8444-444444444442',
    precio_m3: 4500,
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
    vigente_desde: '2026-06-01',
    creado_por: ADMIN_ID,
    fecha_creacion: '2026-06-01T10:00:00.000Z',
    motivo_cambio: 'Ajuste de prueba',
    cambios_auditados: [
      {
        parametro: 'precio_m3',
        etiqueta: 'Precio por m³ (Gs.)',
        valor_anterior: 4000,
        valor_nuevo: 4500,
      },
    ],
  });

  await db.loadFromSupabase({ clientOverride: mock.client, force: true });

  const historial = db.getHistorialTarifas();
  const versionNueva = historial.find((t) => t.id === '44444444-4444-4444-8444-444444444442');
  assert.ok(versionNueva);
  assert.equal(versionNueva!.creado_por, ADMIN_ID);
  assert.equal(versionNueva!.creado_por_nombre, 'silverplack');
  assert.equal(versionNueva!.auditoria?.usuario, 'silverplack');
  assert.equal(db.resolverNombreUsuario(ADMIN_ID), 'silverplack');

  // UUID que no existe en public.usuarios -> Usuario eliminado (8 chars)
  const uuidInexistente = '99999999-9999-4999-8999-999999999999';
  assert.equal(db.resolverNombreUsuario(uuidInexistente), 'Usuario eliminado (99999999)');

  const tarifasSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/TarifasView.tsx'), 'utf8');
  assert.match(tarifasSrc, /resolverCreadorTarifa/);
  assert.match(tarifasSrc, /db\.resolverNombreUsuario/);
  assert.match(tarifasSrc, /from\('usuarios'\)\s*\.select\('id, nombre_completo, email'\)/);
});

test('15. Tarifas: errores de validación hacen scroll, focus al primer campo inválido y muestran toast + alerta junto al botón', () => {
  const errores = {
    texto_alerta_consumo: 'El texto de alerta no puede estar vacío.',
    erssan_porcentaje: 'El porcentaje debe estar entre 0 y 100 %.',
  };

  assert.equal(seleccionarPrimerCampoConError(errores), 'erssan_porcentaje');
  assert.equal(
    construirMensajeResumenErroresTarifa({
      erssan_porcentaje: 'El porcentaje debe estar entre 0 y 100 %.',
    }),
    'Error en erssan_porcentaje: El porcentaje debe estar entre 0 y 100 %.'
  );
  assert.equal(
    construirMensajeResumenErroresTarifa(errores),
    'Error en erssan_porcentaje: El porcentaje debe estar entre 0 y 100 %. (2 campos con error)'
  );

  const tarifasSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/TarifasView.tsx'), 'utf8');
  assert.match(tarifasSrc, /enfocarPrimerError/);
  assert.match(tarifasSrc, /scrollIntoView\(/);
  assert.match(tarifasSrc, /\.focus\(\{\s*preventScroll:\s*true\s*\}\)/);
  assert.match(tarifasSrc, /mostrarToast\('error',\s*msgResumen\)/);
  assert.match(tarifasSrc, /Aviso inline junto al botón si hay errores de validación/);
});

test('16. Mapa: MapaMedidoresView bloquea reintentos tras denegación de GPS y muestra banner inline role="alert"', () => {
  const mapaSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/MapaMedidoresView.tsx'), 'utf8');
  assert.match(mapaSrc, /gpsPermisoDenegado/);
  assert.match(mapaSrc, /if\s*\(gpsPermisoDenegado\)/);
  assert.match(mapaSrc, /if\s*\(err\?\.code === 1\)/);
  assert.match(mapaSrc, /role="alert"/);
  assert.match(mapaSrc, /geoError/);
});

test('17. Mapa: abre siempre en Calles (OpenStreetMap) por defecto y ofrece selector topright para Satelital y Satelital + Etiquetas sin persistir', () => {
  assert.equal(MAP_DEFAULT_LAYER_NAME, 'Calles');
  assert.equal(MAP_TILE_LAYERS_CONFIG.calles.label, 'Calles');
  assert.equal(
    MAP_TILE_LAYERS_CONFIG.calles.url,
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  );
  assert.equal(MAP_TILE_LAYERS_CONFIG.satelital.label, 'Satelital');
  assert.equal(
    MAP_TILE_LAYERS_CONFIG.satelital.url,
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
  );
  assert.equal(
    MAP_TILE_LAYERS_CONFIG.etiquetas.url,
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
  );
  assert.equal(MAP_TILE_LAYERS_CONFIG.satelitalConEtiquetasLabel, 'Satelital + Etiquetas');

  const mapaSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/MapaMedidoresView.tsx'), 'utf8');
  assert.match(mapaSrc, /capaCalles\.addTo\(map\)/);
  assert.equal(/capaSatelital\.addTo\(map\)|capaSatelitalConEtiquetas\.addTo\(map\)/.test(mapaSrc), false);
  assert.match(mapaSrc, /L\.control\s*\.\s*layers\(/);
  assert.match(mapaSrc, /position:\s*'topright',\s*collapsed:\s*false/);
  assert.equal(/localStorage/.test(mapaSrc), false);
});

test('18. Mapa: centrado inicial usa AGUATERIA_UBICACION (-25.3913319, -57.3848892, zoom 15)', () => {
  assert.equal(AGUATERIA_UBICACION.lat, -25.3913319);
  assert.equal(AGUATERIA_UBICACION.lng, -57.3848892);
  assert.equal(AGUATERIA_UBICACION.zoom, 15);
  assert.equal(AGUATERIA_UBICACION.nombre, 'Aguatería');

  const mapaSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/MapaMedidoresView.tsx'), 'utf8');
  assert.match(mapaSrc, /center:\s*\[AGUATERIA_UBICACION\.lat,\s*AGUATERIA_UBICACION\.lng\]/);
  assert.match(mapaSrc, /zoom:\s*AGUATERIA_UBICACION\.zoom/);
  assert.equal(/-25\.3405|-57\.5105/.test(mapaSrc), false);
});

test('19. Mapa: funcionalidades existentes (GPS, MarkerCluster, alta por clic, filtros estado/zona y buscador) siguen intactas', () => {
  const mapaSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/MapaMedidoresView.tsx'), 'utf8');

  // 1. Botón "Centrar en mi ubicación"
  assert.match(mapaSrc, /handleCentrarEnMiUbicacion/);
  assert.match(mapaSrc, /Centrar en mi ubicación/);

  // 2. Clustering de marcadores
  assert.match(mapaSrc, /L\.markerClusterGroup\(/);
  assert.match(mapaSrc, /map\.addLayer\(cluster\)/);
  assert.match(mapaSrc, /cluster\.addLayers\(markers\)/);

  // 3. Alta de medidor desde el mapa (clic -> lat/lng -> agregarMedidorAsync)
  assert.match(mapaSrc, /map\.on\('click'/);
  assert.match(mapaSrc, /setClickedLatLng\(\{\s*lat,\s*lng\s*\}\)/);
  assert.match(mapaSrc, /clickedLatLng\.lat\.toFixed\(6\)/);
  assert.match(mapaSrc, /clickedLatLng\.lng\.toFixed\(6\)/);
  assert.match(mapaSrc, /await db\.agregarMedidorAsync\(/);

  // 4. Filtros por estado y zona
  assert.match(mapaSrc, /estadoFiltro !== 'todos' && m\.estado !== estadoFiltro/);
  assert.match(mapaSrc, /zonaFiltro !== 'todas' && m\.zona !== zonaFiltro/);

  // 5. Buscador por número de medidor o cliente
  assert.match(mapaSrc, /centrarEnMedidor/);
  assert.match(mapaSrc, /zoomToShowLayer\(marker/);
});

test('20. Mapa: getMapTileLayersConfig usa Mapbox Satellite con token y cae a Esri sin token manteniendo Calles por defecto', () => {
  assert.equal(isMapboxTokenConfigured(''), false);
  assert.equal(isMapboxTokenConfigured('your-mapbox-token'), false);
  assert.equal(isMapboxTokenConfigured('pk.eyJ1IjoidGVzdCJ9.demo'), true);

  const sinToken = getMapTileLayersConfig('');
  assert.equal(sinToken.provider, 'esri_fallback');
  assert.equal(sinToken.calles.label, 'Calles');
  assert.equal(sinToken.calles.url, 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(sinToken.satelital.label, 'Satelital');
  assert.match(sinToken.satelital.url, /arcgisonline\.com/);
  assert.equal(sinToken.satelitalConEtiquetas.isCompositeEsri, true);
  assert.match(sinToken.satelitalConEtiquetas.overlayUrl || '', /World_Boundaries_and_Places/);

  const token = 'pk.eyJ1IjoiYWd1YXRlcmlhIiwiYSI6ImRlbW8ifQ.123';
  const conToken = getMapTileLayersConfig(token);
  assert.equal(conToken.provider, 'mapbox');
  assert.equal(conToken.calles.url, 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(conToken.satelital.url, getMapboxSatelliteUrl(token));
  assert.match(conToken.satelital.url, /api\.mapbox\.com\/styles\/v1\/mapbox\/satellite-v9\/tiles\/256\/\{z\}\/\{x\}\/\{y\}@2x/);
  assert.equal(conToken.satelitalConEtiquetas.isCompositeEsri, false);
  assert.equal(conToken.satelitalConEtiquetas.url, getMapboxSatelliteStreetsUrl(token));
  assert.match(
    conToken.satelitalConEtiquetas.url,
    /api\.mapbox\.com\/styles\/v1\/mapbox\/satellite-streets-v12\/tiles\/256\/\{z\}\/\{x\}\/\{y\}@2x/
  );
});

test('21. Mapa Offline: mapOfflineHelper acota zona/zooms, deduplica y guarda Calles + Satelital omitiendo tiles cacheados', async () => {
  assert.deepEqual(calcularZoomsDescargaOffline(15), [14, 15, 16, 17]);
  assert.deepEqual(calcularZoomsDescargaOffline(11), [14, 15, 16, 17]);

  const zonaAcotada = calcularBoundsZonaDescarga({
    viewportBounds: { north: -25.0, south: -26.0, east: -57.0, west: -58.0 },
    center: { lat: AGUATERIA_UBICACION.lat, lng: AGUATERIA_UBICACION.lng },
    currentZoom: 12,
  });
  assert.ok(zonaAcotada.north - zonaAcotada.south < 0.05);
  assert.ok(zonaAcotada.east - zonaAcotada.west < 0.05);

  const tilesEntrada: OfflineTileDescriptor[] = [
    {
      key: 'https://a.tile.openstreetmap.org/15/111/222.png',
      url: 'https://a.tile.openstreetmap.org/15/111/222.png',
      urlTemplate: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      x: 111,
      y: 222,
      z: 15,
      createdAt: 1,
    },
    {
      key: 'https://a.tile.openstreetmap.org/15/111/222.png', // duplicado
      url: 'https://a.tile.openstreetmap.org/15/111/222.png',
      urlTemplate: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      x: 111,
      y: 222,
      z: 15,
      createdAt: 2,
    },
    {
      key: 'https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/256/15/111/222@2x?access_token=pk.test',
      url: 'https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/256/15/111/222@2x?access_token=pk.test',
      urlTemplate:
        'https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/256/{z}/{x}/{y}@2x?access_token=pk.test',
      x: 111,
      y: 222,
      z: 15,
      createdAt: 3,
    },
    {
      key: 'https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/15/111/222@2x?access_token=pk.test',
      url: 'https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/15/111/222@2x?access_token=pk.test',
      urlTemplate:
        'https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=pk.test',
      x: 111,
      y: 222,
      z: 15,
      createdAt: 4,
    },
  ];

  const dedup = deduplicarTilesOffline(tilesEntrada);
  assert.equal(dedup.length, 3);

  // Simular IndexedDB: el tile de Calles ya existe; los 2 satelitales son nuevos (1 descarga OK, 1 fallo simulado)
  const store = new Map<string, Blob>([[tilesEntrada[0].key, new Blob(['osm'])]]);
  const downloadedUrls: string[] = [];
  const progresos: number[] = [];

  const res = await ejecutarDescargaTilesOffline({
    tiles: tilesEntrada,
    storageOps: {
      hasTile: async (key) => store.has(key),
      downloadTile: async (url) => {
        downloadedUrls.push(url);
        if (url.includes('satellite-streets-v12')) {
          throw new Error('Network error');
        }
        return new Blob(['sat-tile']);
      },
      saveTile: async (tile, blob) => {
        store.set(tile.key, blob);
        return tile.key;
      },
      getStorageLength: async () => store.size,
    },
    onProgress: (p) => progresos.push(p.loaded),
  });

  assert.equal(res.total, 3);
  assert.equal(res.skipped, 1);
  assert.equal(res.saved, 1);
  assert.equal(res.failed, 1);
  assert.equal(res.loaded, 3);
  assert.equal(res.storagesize, 2);
  assert.equal(downloadedUrls.length, 2);
  assert.equal(progresos.length, 3);
});

test('22. Mapa: MapaMedidoresView integra leaflet.offline, getMapTileLayersConfig y botón "Descargar mapa de mi zona"', () => {
  const mapaSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/MapaMedidoresView.tsx'), 'utf8');
  const envExampleSrc = fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf8');

  assert.match(envExampleSrc, /VITE_MAPBOX_TOKEN=/);
  assert.match(mapaSrc, /from 'leaflet\.offline'/);
  assert.match(mapaSrc, /tileLayerOffline\(/);
  assert.match(mapaSrc, /getMapTileLayersConfig\(\)/);
  assert.match(mapaSrc, /capaCalles\.addTo\(map\)/);
  assert.match(mapaSrc, /L\.control\s*\.\s*layers\(/);
  assert.match(mapaSrc, /handleDescargarMapaOffline/);
  assert.match(mapaSrc, /Descargar mapa de mi zona/);
  assert.match(mapaSrc, /offlineLayersRef\.current/);
  assert.match(mapaSrc, /getTileUrls\(/);
});

test('23. Zonas del sector: solo existen las 6 zonas oficiales en config, MedidoresView, MapaMedidoresView y database seed', () => {
  assert.deepEqual([...ZONAS_AGUATERIA_SECTOR], [
    'SAN GABRIEL',
    'SAN JOSE',
    'LAS ROSAS',
    'RESIDENCIAL',
    'DON FELIX',
    'MBOKAJATY DEL SUR',
  ]);
  assert.equal(ZONA_AGUATERIA_DEFAULT, 'SAN GABRIEL');

  // Normalización de valores previos o eliminados al editar medidor
  assert.equal(resolverZonaParaEdicion('SAN JOSE'), 'SAN JOSE');
  assert.equal(resolverZonaParaEdicion('San José'), 'SAN JOSE');
  assert.equal(resolverZonaParaEdicion('don félix'), 'DON FELIX');
  assert.equal(resolverZonaParaEdicion('mbokajaty del sur'), 'MBOKAJATY DEL SUR');
  assert.equal(resolverZonaParaEdicion('Barcequillo'), 'SAN GABRIEL');
  assert.equal(resolverZonaParaEdicion('Reducto'), 'SAN GABRIEL');
  assert.equal(resolverZonaParaEdicion(''), 'SAN GABRIEL');

  const medidoresSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/MedidoresView.tsx'), 'utf8');
  const mapaSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/MapaMedidoresView.tsx'), 'utf8');
  const dbSrc = fs.readFileSync(path.join(process.cwd(), 'src/services/database.ts'), 'utf8');

  assert.match(medidoresSrc, /ZONAS_AGUATERIA_SECTOR\.map/);
  assert.match(medidoresSrc, /resolverZonaParaEdicion\(m\.zona\)/);
  assert.match(mapaSrc, /ZONAS_AGUATERIA_SECTOR\.map/);
  assert.match(mapaSrc, /const zonasDisponibles = ZONAS_AGUATERIA_SECTOR/);

  const zonasEliminadasRegex =
    /<option[^>]*>(San José|San Lorenzo Centro|Lucerito|Reducto|Barcequillo|Laurelty|Centro|Luque|Capiatá|Ruta 2|Patiño)<\/option>/;
  assert.equal(zonasEliminadasRegex.test(medidoresSrc), false);
  assert.equal(zonasEliminadasRegex.test(mapaSrc), false);

  assert.equal(/Barcequillo|Cuarto Barrio|Posta Ybycuá|Patiño|Zona Centro San Lorenzo/.test(dbSrc), false);
  for (const zona of ZONAS_AGUATERIA_SECTOR) {
    assert.ok(dbSrc.includes(`nombre: '${zona}'`), `Falta zona seed: ${zona}`);
  }
});


