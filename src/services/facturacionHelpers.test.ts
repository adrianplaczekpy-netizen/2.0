/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ordenarYFiltrarDetalles,
  resolverPeriodoPorDefecto,
  formatearNumeroFactura,
  formatearNumeroFacturaSET,
  extraerSecuencialFacturaSET,
  calcularSiguienteSecuencialFactura,
  generarNumeroReciboSugerido,
  agruparOmitidosPorMotivo,
  formatearAvisoDesconexion,
  puedeAccederFacturacion,
  puedeGenerarFacturacionMensual,
  puedeAnularFactura,
  puedeRegistrarPago,
  formatearMensajePagoExitoso,
  calcularPeriodoFacturadoSugerido,
  validarSolicitudFacturaIndividual,
} from './facturacionHelpers';
import { DetalleFactura } from '../types';
import { formatGs } from './billingRules';
import { db } from './database';

test('1. ordenarYFiltrarDetalles ordena estrictamente conceptos 1..8 y oculta monto <= 0', () => {
  const desordenados: DetalleFactura[] = [
    { id: '8', factura_id: 'f1', concepto: 'erssan', descripcion: 'ERSSAN 2%', monto: 6220 },
    { id: '7', factura_id: 'f1', concepto: 'reconexion', descripcion: 'Reconexión', monto: 60000 },
    { id: '0', factura_id: 'f1', concepto: 'mora', descripcion: 'Mora cero', monto: 0 },
    { id: '4', factura_id: 'f1', concepto: 'otros_trabajos', descripcion: 'Cambio llave', monto: 35000 },
    { id: '1', factura_id: 'f1', concepto: 'consumo_agua', descripcion: 'Consumo 15 m³', monto: 60000 },
    { id: '6', factura_id: 'f1', concepto: 'perdida_financiada', descripcion: 'Pérdida cuota 1', monto: 25000 },
    { id: '3', factura_id: 'f1', concepto: 'mora', descripcion: 'Mora 2 boletas', monto: 6000 },
    { id: '5', factura_id: 'f1', concepto: 'cuota_conexion', descripcion: 'Cuota conexión 1', monto: 40000 },
    { id: '2', factura_id: 'f1', concepto: 'deuda_anterior', descripcion: 'Deuda anterior', monto: 85000 },
  ];

  const ordenados = ordenarYFiltrarDetalles(desordenados);
  assert.equal(ordenados.length, 8);
  assert.deepEqual(
    ordenados.map((d) => d.concepto),
    [
      'consumo_agua',
      'deuda_anterior',
      'mora',
      'otros_trabajos',
      'cuota_conexion',
      'perdida_financiada',
      'reconexion',
      'erssan',
    ]
  );
  assert.ok(ordenados.every((d) => d.monto > 0));
});

test('2. resolverPeriodoPorDefecto prioriza el último período con lecturas confirmadas y cae al mes actual', () => {
  const conConfirmadas = resolverPeriodoPorDefecto(
    [
      { periodo: '2026-09', estado: 'confirmada' },
      { periodo: '2026-11', estado: 'confirmada' },
      { periodo: '2026-12', estado: 'borrador' },
    ],
    new Date('2026-10-15T12:00:00Z')
  );
  assert.equal(conConfirmadas, '2026-11');

  const sinConfirmadas = resolverPeriodoPorDefecto(
    [{ periodo: '2026-12', estado: 'borrador' }],
    new Date('2026-11-05T12:00:00Z')
  );
  assert.equal(sinConfirmadas, '2026-11');
});

test('3. formatearNumeroFactura, numeración SET 001-002-XXXXXXX y generarNumeroReciboSugerido producen formatos válidos y únicos', () => {
  assert.equal(
    formatearNumeroFactura({ id: 'uuid-1234', numero_boleta_medidor: 3, periodo_facturado: '2026-11' }),
    'N° 3-2026-11'
  );
  assert.equal(
    formatearNumeroFactura({
      id: 'uuid-1234',
      numero_boleta_medidor: 3,
      numero_factura: '001-002-0000015',
      periodo_facturado: '2026-11',
    }),
    '001-002-0000015'
  );
  assert.equal(formatearNumeroFacturaSET(1), '001-002-0000001');
  assert.equal(formatearNumeroFacturaSET(42), '001-002-0000042');
  assert.equal(extraerSecuencialFacturaSET('001-002-0000042'), 42);
  assert.equal(
    calcularSiguienteSecuencialFactura([
      { numero_factura: '001-002-0000001' },
      { numero_factura: '001-002-0000007' },
    ]),
    8
  );

  const now = new Date('2026-11-15T09:05:03');
  const rec1 = generarNumeroReciboSugerido(now, []);
  assert.equal(rec1, 'REC-20261115-090503');
  const rec2 = generarNumeroReciboSugerido(now, [rec1]);
  assert.equal(rec2, 'REC-20261115-090503-1');
  assert.ok(rec2.length <= 30);
});

test('4. agruparOmitidosPorMotivo agrupa en orden y ordena por número de medidor', () => {
  const grupos = agruparOmitidosPorMotivo([
    { medidor_id: 'm4', numero_medidor: 4, cliente_id: 'c4', motivo: 'sin_lectura_confirmada', detalle: 'Sin lectura' },
    { medidor_id: 'm2', numero_medidor: 2, cliente_id: 'c2', motivo: 'cortado', detalle: 'Cortado' },
    { medidor_id: 'm1', numero_medidor: 1, cliente_id: 'c1', motivo: 'sin_lectura_confirmada', detalle: 'Sin lectura' },
  ]);

  assert.equal(grupos.length, 2);
  assert.equal(grupos[0].motivo, 'cortado');
  assert.equal(grupos[0].cantidad, 1);
  assert.equal(grupos[1].motivo, 'sin_lectura_confirmada');
  assert.equal(grupos[1].cantidad, 2);
  assert.deepEqual(
    grupos[1].items.map((i) => i.numero_medidor),
    [1, 4]
  );
});

test('5. RBAC de Facturación: admin tiene acceso total, cobrador solo listado/pagos, lectura bloqueado', () => {
  assert.equal(puedeAccederFacturacion('admin'), true);
  assert.equal(puedeAccederFacturacion('cobrador'), true);
  assert.equal(puedeAccederFacturacion('lectura'), false);
  assert.equal(puedeAccederFacturacion(undefined), false);

  assert.equal(puedeGenerarFacturacionMensual('admin'), true);
  assert.equal(puedeGenerarFacturacionMensual('cobrador'), false);
  assert.equal(puedeGenerarFacturacionMensual('lectura'), false);

  assert.equal(puedeAnularFactura('admin'), true);
  assert.equal(puedeAnularFactura('cobrador'), false);
  assert.equal(puedeAnularFactura('lectura'), false);

  assert.equal(puedeRegistrarPago('admin'), true);
  assert.equal(puedeRegistrarPago('cobrador'), true);
  assert.equal(puedeRegistrarPago('lectura'), false);
});

test('6. formatearAvisoDesconexion y formatearMensajePagoExitoso', () => {
  assert.equal(formatearAvisoDesconexion('2026-11-11'), 'DESCONEXIÓN: 2026-11-11');
  const parcial = formatearMensajePagoExitoso(15000, formatGs);
  assert.equal(parcial.pagadaCompletamente, false);
  assert.equal(parcial.titulo, 'Pago registrado. Saldo restante: 15.000 Gs.');

  const total = formatearMensajePagoExitoso(0, formatGs);
  assert.equal(total.pagadaCompletamente, true);
  assert.equal(total.titulo, 'Factura pagada completamente');
});

test('7. db.getFacturas pagina 50 por página y filtra por período, estado, medidor, cliente y esTerceraBoleta', () => {
  db.clearData();

  const cli1 = db.agregarCliente({
    nombre_completo: 'Ana María Gómez',
    documento: '4455667',
    direccion: 'Calle Palma 123',
    telefono: '0981000111',
    email: 'ana@example.com',
  });
  const cli2 = db.agregarCliente({
    nombre_completo: 'Carlos Benítez',
    documento: '9988776',
    direccion: 'Ruta 2 Km 18',
    telefono: '0982000222',
    email: 'carlos@example.com',
  });

  const med1 = db.agregarMedidor({
    cliente_id: cli1.id,
    numero_medidor: 1,
    fecha_instalacion: '2026-01-01',
    direccion: 'Calle Palma 123',
    zona: 'Centro',
    latitud: -25.34,
    longitud: -57.51,
    estado: 'activo',
  });
  const med2 = db.agregarMedidor({
    cliente_id: cli2.id,
    numero_medidor: 2,
    fecha_instalacion: '2026-01-01',
    direccion: 'Ruta 2 Km 18',
    zona: 'Centro',
    latitud: -25.35,
    longitud: -57.5,
    estado: 'activo',
  });

  // Cargar lecturas confirmadas para 2026-11 (med1: 12 m³, med2: 5 m³ -> mínimo 36.000)
  db.registrarLectura({
    numeroMedidor: 1,
    lecturaActual: 12,
    fechaLectura: '2026-11-20',
    fotoUrl: 'https://example.com/m1.jpg',
    estado: 'confirmada',
  });
  db.registrarLectura({
    numeroMedidor: 2,
    lecturaActual: 5,
    fechaLectura: '2026-11-20',
    fotoUrl: 'https://example.com/m2.jpg',
    estado: 'confirmada',
  });

  const res = db.ejecutarFacturacionMensual('2026-11', '2026-11-01');
  assert.equal(res.totalGeneradas, 2);

  // Medidor 2 (5 m³) debe tener consumo mínimo 36.000 + ERSSAN 2% = 36.720
  const facMed2 = res.facturasGeneradas.find((f: any) => f.medidor_id === med2.id)!;
  assert.ok(facMed2);
  assert.equal((facMed2.detalles || []).find((d: any) => d.concepto === 'consumo_agua')?.monto, 36000);
  assert.equal(facMed2.total, 36720);

  // Filtros en getFacturas
  const soloMed2 = db.getFacturas({ medidor: '2', limit: 50 });
  assert.equal(soloMed2.total, 1);
  assert.equal(soloMed2.facturas[0].numeroMedidor, 2);

  const soloAna = db.getFacturas({ cliente: 'gómez', limit: 50 });
  assert.equal(soloAna.total, 1);
  assert.equal(soloAna.facturas[0].clienteNombre, 'Ana María Gómez');

  // Paginación 50 por página con > 50 facturas
  const data = db.getFullData();
  for (let i = 0; i < 55; i++) {
    data.facturas.push({
      id: `fac-extra-${i}`,
      medidor_id: med1.id,
      cliente_id: cli1.id,
      periodo_facturado: '2025-01',
      fecha_emision: '2025-01-01',
      fecha_vencimiento: '2025-01-31',
      estado: 'pendiente',
      total: 36720,
      saldo_pendiente: 36720,
      es_tercera_boleta: i === 0,
      alerta_consumo_elevado: false,
      numero_boleta_medidor: i + 10,
    });
  }

  const p1 = db.getFacturas({ page: 1, limit: 50 });
  assert.equal(p1.facturas.length, 50);
  assert.equal(p1.total, 57);
  assert.equal(p1.totalPages, 2);

  const p2 = db.getFacturas({ page: 2, limit: 50 });
  assert.equal(p2.facturas.length, 7);

  const terceras = db.getFacturasParaExportar({ esTerceraBoleta: 'si' });
  assert.equal(terceras.length, 1);
});

test('8. registrarCobroAsync actualiza saldo parcial, completo y getPagosPorFactura; anularFacturaAsync bloquea si tiene pagos', async () => {
  db.clearData();

  const cli = db.agregarCliente({
    nombre_completo: 'Pedro Villalba',
    documento: '1122334',
    direccion: 'San Lorenzo 500',
    telefono: '0981555666',
    email: 'pedro@example.com',
  });
  const med = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 3,
    fecha_instalacion: '2026-01-01',
    direccion: 'San Lorenzo 500',
    zona: 'Centro',
    latitud: -25.34,
    longitud: -57.51,
    estado: 'activo',
  });

  db.registrarLectura({
    numeroMedidor: 3,
    lecturaActual: 10,
    fechaLectura: '2026-11-20',
    fotoUrl: 'https://example.com/m3.jpg',
    estado: 'confirmada',
  });

  const res = db.ejecutarFacturacionMensual('2026-11', '2026-11-01');
  const fac = res.facturasGeneradas[0];
  assert.equal(fac.total, 40800); // 10 * 4.000 = 40.000 + 2% = 40.800

  // Pago parcial
  const cobro1 = await db.registrarCobroAsync({
    facturaId: fac.id,
    monto: 20000,
    metodoPago: 'transferencia',
    fechaPago: '2026-11-22',
    numeroRecibo: 'REC-TEST-001',
    cobradorId: 'usr-cobrador-1',
    cobradorNombre: 'Cobrador Turno Tarde',
  });
  assert.equal(cobro1.saldoRestante, 20800);
  assert.equal(cobro1.factura?.estado, 'pendiente');

  // No permite anular factura con pago parcial registrado
  await assert.rejects(
    () => db.anularFacturaAsync(fac.id, 'Intento indebido'),
    /ya tiene pagos registrados/
  );

  // Pago restante completo
  const cobro2 = await db.registrarCobroAsync({
    facturaId: fac.id,
    monto: 20800,
    metodoPago: 'efectivo',
    fechaPago: '2026-11-23',
    numeroRecibo: 'REC-TEST-002',
    cobradorId: 'usr-cobrador-1',
    cobradorNombre: 'Cobrador Turno Tarde',
  });
  assert.equal(cobro2.saldoRestante, 0);
  assert.equal(cobro2.factura?.estado, 'pagada');

  const pagos = db.getPagosPorFactura(fac.id);
  assert.equal(pagos.length, 2);
  assert.equal(pagos[0].cobradorNombre, 'Cobrador Turno Tarde');
  assert.equal(pagos[0].numero_recibo, 'REC-TEST-002');
});

test('9. Control estricto de monto_pagado, saldo_pendiente y estado en pago total y pago parcial en dos cuotas (36.720 = 20.000 + 16.720)', async () => {
  db.clearData();

  const cli = db.agregarCliente({
    nombre_completo: 'Lucía Benítez',
    documento: '5566778',
    direccion: 'Av. Mariscal López 900',
    telefono: '0981777888',
    email: 'lucia@example.com',
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
  const med2 = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 2,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 2',
    zona: 'Centro',
    latitud: -25.35,
    longitud: -57.52,
    estado: 'activo',
  });

  // Medidor 1: 13.5 -> 14 m³ = 54.000 + 2% = 55.080 Gs. (o 13 m³? 13.5 no es entero: 55.080 = 54.000 * 1.02)
  // Usamos lectura que genere consumo 13 m³ (52.000) o directamente 55.080/36.720 vía facturas reales del período:
  // Medidor 2: consumo <= 9 m³ -> mínimo 36.000 + 2% ERSSAN = 36.720 Gs.
  db.registrarLectura({
    numeroMedidor: 1,
    lecturaActual: 14, // 14 * 4.000 = 56.000 + 2% = 57.120 Gs. (pago total completo)
    fechaLectura: '2026-10-25',
    fotoUrl: 'https://example.com/m1-oct.jpg',
    estado: 'confirmada',
  });
  db.registrarLectura({
    numeroMedidor: 2,
    lecturaActual: 5, // mínimo 36.000 + 2% ERSSAN = 36.720 Gs.
    fechaLectura: '2026-10-25',
    fotoUrl: 'https://example.com/m2-oct.jpg',
    estado: 'confirmada',
  });

  const lote = await db.ejecutarFacturacionMensualAsync('2026-11', '2026-11-01');
  assert.equal(lote.totalGeneradas, 2);

  const fac1 = lote.facturasGeneradas.find((f) => f.medidor_id === med1.id)!;
  const fac2 = lote.facturasGeneradas.find((f) => f.medidor_id === med2.id)!;
  assert.equal(fac2.total, 36720);
  assert.equal(fac1.monto_pagado, 0);
  assert.equal(fac2.monto_pagado, 0);

  // 1) Pago total de Factura 1 → monto_pagado = total, saldo_pendiente = 0, estado = 'pagada'
  const resTotal = await db.registrarCobroAsync({
    facturaId: fac1.id,
    monto: fac1.total,
    metodoPago: 'efectivo',
    fechaPago: '2026-11-10',
    numeroRecibo: 'REC-PAGO-TOTAL-1',
  });
  assert.equal(resTotal.factura?.monto_pagado, fac1.total);
  assert.equal(resTotal.factura?.saldo_pendiente, 0);
  assert.equal(resTotal.factura?.estado, 'pagada');

  // 2) Pago parcial de 20.000 sobre Factura 2 (36.720) → monto_pagado = 20.000, saldo_pendiente = 16.720, estado = 'pendiente'
  const resParcial1 = await db.registrarCobroAsync({
    facturaId: fac2.id,
    monto: 20000,
    metodoPago: 'transferencia',
    fechaPago: '2026-11-12',
    numeroRecibo: 'REC-PAGO-PARCIAL-1',
  });
  assert.equal(resParcial1.factura?.monto_pagado, 20000);
  assert.equal(resParcial1.factura?.saldo_pendiente, 16720);
  assert.equal(resParcial1.factura?.estado, 'pendiente');

  // 3) Segundo pago de 16.720 sobre Factura 2 → monto_pagado = 36.720, saldo_pendiente = 0, estado = 'pagada'
  const resParcial2 = await db.registrarCobroAsync({
    facturaId: fac2.id,
    monto: 16720,
    metodoPago: 'efectivo',
    fechaPago: '2026-11-15',
    numeroRecibo: 'REC-PAGO-PARCIAL-2',
  });
  assert.equal(resParcial2.factura?.monto_pagado, 36720);
  assert.equal(resParcial2.factura?.saldo_pendiente, 0);
  assert.equal(resParcial2.factura?.estado, 'pagada');
});

test('10. Helpers de facturación individual validan medidor, período de consumo y sugieren mes de boleta', () => {
  assert.equal(calcularPeriodoFacturadoSugerido('2026-09'), '2026-10');
  assert.equal(calcularPeriodoFacturadoSugerido('2026-12'), '2027-01');

  assert.equal(validarSolicitudFacturaIndividual({ numeroMedidor: '0', periodoConsumo: '2026-09' }).valido, false);
  assert.equal(validarSolicitudFacturaIndividual({ numeroMedidor: '10', periodoConsumo: '2026-13' }).valido, false);

  const ok = validarSolicitudFacturaIndividual({ numeroMedidor: '10', periodoConsumo: '2026-09' });
  assert.equal(ok.valido, true);
  assert.equal(ok.numeroMedidor, 10);
  assert.equal(ok.periodoConsumo, '2026-09');
  assert.equal(ok.periodoFacturado, '2026-10');
});

test('11. generarFacturaIndividualAsync emite SOLO 1 factura para medidor 10 y período consumo 2026-09 sin mutar si falla Supabase', async () => {
  db.clearData();

  const cli = db.agregarCliente({
    nombre_completo: 'Titular Medidor 10',
    documento: '7778889',
    direccion: 'SAN GABRIEL - Lote 10',
    telefono: '0981111222',
    email: 'm10@example.com',
  });
  const med10 = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 10,
    fecha_instalacion: '2026-01-01',
    direccion: 'SAN GABRIEL - Lote 10',
    zona: 'SAN GABRIEL',
    latitud: -25.391,
    longitud: -57.384,
    estado: 'activo',
  });
  db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 20,
    fecha_instalacion: '2026-01-01',
    direccion: 'SAN JOSE - Lote 20',
    zona: 'SAN JOSE',
    latitud: -25.388,
    longitud: -57.381,
    estado: 'activo',
  });

  // Lectura septiembre 2026 (12 m³ -> 48.000 + 2% = 48.960) y octubre 2026 para medidor 10, más lectura para medidor 20
  const lec10Sep = db.registrarLectura({
    numeroMedidor: 10,
    lecturaActual: 12,
    fechaLectura: '2026-09-25',
    fotoUrl: 'https://example.com/m10-sep.jpg',
    estado: 'confirmada',
  });
  db.registrarLectura({
    numeroMedidor: 10,
    lecturaActual: 25,
    fechaLectura: '2026-10-25',
    fotoUrl: 'https://example.com/m10-oct.jpg',
    estado: 'confirmada',
  });
  db.registrarLectura({
    numeroMedidor: 20,
    lecturaActual: 15,
    fechaLectura: '2026-09-25',
    fotoUrl: 'https://example.com/m20-sep.jpg',
    estado: 'confirmada',
  });

  // Simular fallo en Supabase: NO debe crear factura en memoria
  const mockFalla = {
    from() {
      return {
        insert: async () => ({ error: { message: 'RLS denied test' } }),
      };
    },
  };
  await assert.rejects(
    () =>
      db.generarFacturaIndividualAsync({
        numeroMedidor: 10,
        periodoConsumo: '2026-09',
        periodoFacturado: '2026-10',
        clientOverride: mockFalla,
      }),
    /RLS denied test/
  );
  assert.equal(db.getFullData().facturas.length, 0);

  // Éxito en Supabase: crea exactamente 1 factura para medidor 10 y lectura 2026-09
  const inserts: Record<string, any[]> = { facturas: [], detalle_factura: [] };
  const mockOk = {
    from(table: string) {
      return {
        insert: async (payload: any) => {
          if (table === 'facturas') inserts.facturas.push(payload);
          if (table === 'detalle_factura') inserts.detalle_factura.push(...payload);
          return { error: null };
        },
        update: () => ({
          eq: async () => ({ error: null }),
          in: async () => ({ error: null }),
        }),
      };
    },
  };

  const res = await db.generarFacturaIndividualAsync({
    numeroMedidor: 10,
    periodoConsumo: '2026-09',
    periodoFacturado: '2026-10',
    clientOverride: mockOk,
  });

  assert.equal(res.numeroMedidor, 10);
  assert.equal(res.factura.medidor_id, med10.id);
  assert.equal(res.factura.periodo_consumo, '2026-09');
  assert.equal(res.factura.periodo_facturado, '2026-10');
  assert.equal(res.factura.lectura_id, lec10Sep.lectura.id);
  assert.equal(res.factura.consumo_m3, 12);
  assert.equal(res.factura.total, 48960);
  assert.equal(db.getFullData().facturas.length, 1);
  assert.equal(inserts.facturas.length, 1);
  assert.equal(inserts.detalle_factura.length, 2); // consumo_agua + erssan

  // No permite duplicar la misma lectura ni el mismo período de boleta mientras esté activa
  await assert.rejects(
    () =>
      db.generarFacturaIndividualAsync({
        numeroMedidor: 10,
        periodoConsumo: '2026-09',
        periodoFacturado: '2026-11',
        clientOverride: mockOk,
      }),
    /ya tiene una factura activa/
  );

  // Verificar que FacturacionBatchPanel.tsx expone la UI de facturación individual
  const panelSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/FacturacionBatchPanel.tsx'), 'utf8');
  assert.match(panelSrc, /Facturar un solo medidor/);
  assert.match(panelSrc, /generarFacturaIndividualAsync/);
  assert.match(panelSrc, /ind-periodo-consumo/);
});



