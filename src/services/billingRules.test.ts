/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularConsumoAgua,
  calcularMoraMedidor,
  verificarAlertaConsumo,
  calcularErssanBaseCompleta,
  formatFechaDesconexion,
  validarNumeroMedidor,
  calcularFacturaMedidor,
  generarFacturaRegularizacion,
  liquidarReconexion,
  resolverPeriodoRegularizacion,
  validarLecturaIngreso,
  validarEdicionLectura,
  validarRegistroCargo,
  validarEdicionCargo,
  validarAnulacionCargo,
  TARIFAS_DEFAULT,
} from './billingRules';
import { Factura, Medidor, CargoPendiente } from '../types';
import { db } from './database';

db.loadTestData();

test('1. Consumo mínimo: cumple con la fórmula exacta del pliego técnico', () => {
  // Medidor A: 5 m³ -> monto_bruto = 20.000 <= 9 -> max(20.000, 36.000) = 36.000 Gs
  const mA = calcularConsumoAgua(5);
  assert.equal(mA.montoAgua, 36000);
  assert.equal(mA.aplicoMinimo, true);

  // 9 m³ (justo el umbral) -> 9 * 4.000 = 36.000 -> max(36.000, 36.000) = 36.000 Gs
  const m9 = calcularConsumoAgua(9);
  assert.equal(m9.montoAgua, 36000);

  // Medidor B: 12 m³ -> > 9 -> monto_consumo = 12 × 4.000 = 48.000 Gs
  const mB = calcularConsumoAgua(12);
  assert.equal(mB.montoAgua, 48000);
  assert.equal(mB.aplicoMinimo, false);

  // Medidor C: 45 m³ -> > 9 -> monto_consumo = 45 × 4.000 = 180.000 Gs
  const mC = calcularConsumoAgua(45);
  assert.equal(mC.montoAgua, 180000);
  assert.equal(mC.aplicoMinimo, false);
});

test('2. Mora: monto fijo por medidor según cantidad de boletas vencidas impagas', () => {
  const fVencida1: Factura = {
    id: 'f1',
    medidor_id: 'm1',
    cliente_id: 'c1',
    periodo_facturado: '2025-01',
    fecha_emision: '2025-01-05',
    fecha_vencimiento: '2025-01-31',
    estado: 'vencida',
    total: 36720,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
  };

  const fVencida2: Factura = {
    ...fVencida1,
    id: 'f2',
    periodo_facturado: '2025-02',
    fecha_vencimiento: '2025-02-28',
    total: 48960,
  };

  const f3raVencidaDia11: Factura = {
    ...fVencida1,
    id: 'f3',
    periodo_facturado: '2025-03',
    fecha_vencimiento: '2025-03-11',
    es_tercera_boleta: true,
    total: 120000,
  };

  // 1 boleta vencida: 3.000 Gs
  assert.equal(calcularMoraMedidor([fVencida1]).moraTotal, 3000);

  // 2 boletas vencidas al emitir 3ra: 6.000 Gs
  assert.equal(calcularMoraMedidor([fVencida1, fVencida2]).moraTotal, 6000);

  // 3ra no pagada tras el día 11: 3 * 3.000 = 9.000 Gs
  assert.equal(calcularMoraMedidor([fVencida1, fVencida2, f3raVencidaDia11]).moraTotal, 9000);
});

test('3. Aviso destacado de desconexión: genera el texto exacto con fecha y mes en mayúsculas', () => {
  const texto = formatFechaDesconexion('2025-11-11');
  assert.equal(texto, 'DESCONEXIÓN: 11 DE NOVIEMBRE');
});

test('4. Alerta de consumo elevado: promedio de últimos 3 meses de ESE medidor', () => {
  // Historial últimos 3 meses: [10, 12, 8] -> promedio = 10 m³
  // Umbral 3x -> límite = 30 m³
  const historial3Meses = [10, 12, 8];

  // Consumo 28 m³ (<= 30) -> no se activa
  const normal = verificarAlertaConsumo(28, historial3Meses, 3);
  assert.equal(normal.esElevado, false);

  // Consumo 35 m³ (> 30) -> se activa
  const elevado = verificarAlertaConsumo(35, historial3Meses, 3);
  assert.equal(elevado.esElevado, true);
  assert.equal(elevado.promedio, 10);
});

test('5. ERSSAN 2%: se calcula sobre la suma de los conceptos 1 al 7 incluidos', () => {
  // Conceptos 1 al 7 suman 100.000 Gs -> ERSSAN 2% = 2.000 Gs
  const erssan = calcularErssanBaseCompleta(100000, 2);
  assert.equal(erssan, 2000);

  // Base 0 -> 0 Gs
  assert.equal(calcularErssanBaseCompleta(0, 2), 0);
});

test('6. Facturación dinámica: solo incluye conceptos cuyo monto sea > 0', () => {
  const medidor: Medidor = {
    id: 'med-sin-deuda',
    cliente_id: 'cli-01',
    numero_medidor: 5,
    fecha_instalacion: '2024-01-01',
    direccion: 'Barrio San José',
    zona: 'San José',
    latitud: -25.33,
    longitud: -57.50,
    estado: 'activo',
    fecha_corte: null,
    mora_congelada: null,
  };

  const res = calcularFacturaMedidor({
    medidor,
    clienteId: 'cli-01',
    periodo: '2025-04',
    lecturaActual: 105,
    lecturaAnterior: 100, // 5 m³ -> 36.000 Gs tarifa mínima
    historialUltimosMeses: [5, 5, 5],
    facturasImpagasAnteriores: [],
    cargosPendientes: [],
    correlativoPorMedidor: 1,
  });

  // Base conceptos 1-7: solo agua (36.000 Gs). No hay deuda, no hay mora, no hay otros trabajos.
  // ERSSAN 2% de 36.000 = 720 Gs
  // Total: 36.720 Gs
  assert.equal(res.factura.total, 36720);
  assert.equal(res.detalles.length, 2); // Solo concepto 1 (consumo_agua) y concepto 8 (erssan)
  assert.equal(res.detalles[0].concepto, 'consumo_agua');
  assert.equal(res.detalles[1].concepto, 'erssan');
});

test('7. Flujo de reconexión: genera factura de regularización completa', () => {
  const medidorCortado: Medidor = {
    id: 'med-cortado-1',
    cliente_id: 'cli-02',
    numero_medidor: 99,
    fecha_instalacion: '2023-01-01',
    direccion: 'Reducto',
    zona: 'Reducto',
    latitud: -25.36,
    longitud: -57.51,
    estado: 'cortado',
    fecha_corte: '2025-02-15',
    mora_congelada: 9000,
  };

  const facturasImpagas: Factura[] = [
    {
      id: 'f-imp-1',
      medidor_id: 'med-cortado-1',
      cliente_id: 'cli-02',
      periodo_facturado: '2025-01',
      fecha_emision: '2025-01-05',
      fecha_vencimiento: '2025-01-31',
      estado: 'vencida',
      total: 40000,
      es_tercera_boleta: false,
      alerta_consumo_elevado: false,
      numero_boleta_medidor: 1,
    },
  ];

  const reg = generarFacturaRegularizacion({
    medidor: medidorCortado,
    clienteId: 'cli-02',
    facturasImpagas,
    cargosPendientes: [{ id: 'cg-1', descripcion: 'Llave de paso', monto: 15000 }],
    correlativoPorMedidor: 2,
  });

  // Deuda anterior: 40.000
  // Mora congelada: 9.000
  // Otros trabajos: 15.000
  // Reconexión: 60.000
  // Base ERSSAN (todos los conceptos): 40.000 + 9.000 + 15.000 + 60.000 = 124.000 Gs.
  // ERSSAN 2%: 124.000 * 2% = 2.480 Gs.
  // Total: 124.000 + 2.480 = 126.480 Gs.
  assert.equal(reg.factura.total, 126480);
  assert.equal(reg.detalles.find((d) => d.concepto === 'erssan')?.monto, 2480);
  assert.ok(reg.detalles.some((d) => d.concepto === 'deuda_anterior'));
  assert.ok(reg.detalles.some((d) => d.concepto === 'mora'));
  assert.ok(reg.detalles.some((d) => d.concepto === 'otros_trabajos'));
  assert.ok(reg.detalles.some((d) => d.concepto === 'reconexion'));
  assert.ok(reg.detalles.some((d) => d.concepto === 'erssan'));
});

test('8. Alerta de consumo elevado: sin 3 meses de historial en ese medidor NO se activa', () => {
  // Con solo 2 meses de historial (p.ej. medidor nuevo)
  const res2Meses = verificarAlertaConsumo(40, [10, 10], 3);
  assert.equal(res2Meses.esElevado, false);
  assert.equal(res2Meses.tieneHistorialSuficiente, false);

  // Con 0 meses de historial
  const res0Meses = verificarAlertaConsumo(40, [], 3);
  assert.equal(res0Meses.esElevado, false);
  assert.equal(res0Meses.tieneHistorialSuficiente, false);

  // Con 3 meses de historial completos -> se activa si supera el umbral
  const res3Meses = verificarAlertaConsumo(40, [10, 10, 10], 3);
  assert.equal(res3Meses.esElevado, true);
  assert.equal(res3Meses.tieneHistorialSuficiente, true);
  assert.equal(res3Meses.promedio, 10);
});

test('9. Validaciones de numero_medidor: formato entero, ceros a la izquierda, duplicados y límites', () => {
  const existentes = new Set([1, 2, 50, 100]);

  // Rechazar cero a la izquierda
  const vCeroIzq = validarNumeroMedidor('05', existentes, 1000, 4);
  assert.equal(vCeroIzq.valido, false);
  assert.match(vCeroIzq.error!, /ceros a la izquierda/);

  // Rechazar decimales
  const vDecimal = validarNumeroMedidor('12.5', existentes, 1000, 4);
  assert.equal(vDecimal.valido, false);

  // Rechazar letras y símbolos
  const vLetras = validarNumeroMedidor('MED-45', existentes, 1000, 4);
  assert.equal(vLetras.valido, false);

  // Rechazar fuera de rango (< 1 o > max)
  const vMenor = validarNumeroMedidor(0, existentes, 1000, 4);
  assert.equal(vMenor.valido, false);
  assert.equal(vMenor.error, 'El número de medidor debe estar entre 1 y 1000');

  const vMayor = validarNumeroMedidor(1001, existentes, 1000, 4);
  assert.equal(vMayor.valido, false);
  assert.equal(vMayor.error, 'El número de medidor debe estar entre 1 y 1000');

  // Rechazar duplicados
  const vDup = validarNumeroMedidor(50, existentes, 1000, 4);
  assert.equal(vDup.valido, false);
  assert.equal(vDup.error, 'Ya existe un medidor con ese número');

  // Rechazar si se alcanzó el tope configurado
  const vTope = validarNumeroMedidor(200, existentes, 1000, 1000);
  assert.equal(vTope.valido, false);
  assert.equal(vTope.error, 'Se alcanzó el máximo de medidores configurado. Amplíe el rango en configuración.');

  // Válido
  const vOk = validarNumeroMedidor('850', existentes, 1000, 4);
  assert.equal(vOk.valido, true);
  assert.equal(vOk.numero, 850);
});

test('10. Validaciones de ingreso de lectura: no negativo, entero, lectura_actual >= anterior salvo admin con motivo', () => {
  // Decimal rechazado
  const vDec = validarLecturaIngreso({ lecturaActual: 105.5, lecturaAnterior: 100, esAdmin: false });
  assert.equal(vDec.valida, false);

  // Negativo rechazado
  const vNeg = validarLecturaIngreso({ lecturaActual: -5, lecturaAnterior: 100, esAdmin: false });
  assert.equal(vNeg.valida, false);

  // Menor que anterior sin ser admin -> bloqueado
  const vMenorLector = validarLecturaIngreso({ lecturaActual: 80, lecturaAnterior: 100, esAdmin: false });
  assert.equal(vMenorLector.valida, false);
  assert.equal(vMenorLector.requiereJustificacionAdmin, true);

  // Menor que anterior como admin sin justificación -> bloqueado
  const vMenorAdminSinMotivo = validarLecturaIngreso({
    lecturaActual: 80,
    lecturaAnterior: 100,
    esAdmin: true,
    justificacionAdmin: '   ',
  });
  assert.equal(vMenorAdminSinMotivo.valida, false);

  // Menor que anterior como admin con justificación válida -> permitido
  const vMenorAdminOk = validarLecturaIngreso({
    lecturaActual: 80,
    lecturaAnterior: 100,
    esAdmin: true,
    justificacionAdmin: 'Cambio de medidor por reloj trabado en campo',
  });
  assert.equal(vMenorAdminOk.valida, true);

  // Normal mayor o igual -> permitido
  const vOk = validarLecturaIngreso({ lecturaActual: 115, lecturaAnterior: 100, esAdmin: false });
  assert.equal(vOk.valida, true);
});

test('11. Reglas de edición y eliminación de lecturas: borrador libre, impaga editable, pagada solo admin con auditoría', () => {
  const lecturaBorrador: any = { id: 'l1', estado: 'borrador', factura_id: null };
  const lecturaConfirmada: any = { id: 'l2', estado: 'confirmada', factura_id: 'f1' };

  // Borrador: libremente editable por cualquier rol sin motivo
  const rBorrador = validarEdicionLectura({
    lectura: lecturaBorrador,
    usuarioRol: 'lectura',
  });
  assert.equal(rBorrador.permitida, true);

  // Confirmada con factura pendiente o vencida (no pagada): editable por operario/cobrador
  const facturaImpaga: any = { id: 'f1', estado: 'pendiente' };
  const rImpaga = validarEdicionLectura({
    lectura: lecturaConfirmada,
    factura: facturaImpaga,
    usuarioRol: 'cobrador',
  });
  assert.equal(rImpaga.permitida, true);

  // Confirmada con factura pagada: cobrador o lectura NO pueden
  const facturaPagada: any = { id: 'f1', estado: 'pagada' };
  const rPagadaNoAdmin = validarEdicionLectura({
    lectura: lecturaConfirmada,
    factura: facturaPagada,
    usuarioRol: 'cobrador',
  });
  assert.equal(rPagadaNoAdmin.permitida, false);
  assert.match(rPagadaNoAdmin.error!, /Solo un Administrador/);

  // Confirmada con factura pagada: admin sin motivo NO puede
  const rPagadaAdminSinMotivo = validarEdicionLectura({
    lectura: lecturaConfirmada,
    factura: facturaPagada,
    usuarioRol: 'admin',
    motivoEdicion: 'err',
  });
  assert.equal(rPagadaAdminSinMotivo.permitida, false);

  // Confirmada con factura pagada: admin con motivo válido SI puede
  const rPagadaAdminOk = validarEdicionLectura({
    lectura: lecturaConfirmada,
    factura: facturaPagada,
    usuarioRol: 'admin',
    motivoEdicion: 'Corrección autorizada por gerencia según acta Nro 104',
  });
  assert.equal(rPagadaAdminOk.permitida, true);
});

test('12. Otros Trabajos: Múltiples cargos al mismo medidor y período se muestran en líneas separadas y suman a la base ERSSAN', () => {
  const medidorA: Medidor = {
    id: 'med-A',
    cliente_id: 'cli-01',
    numero_medidor: 10,
    fecha_instalacion: '2024-01-01',
    direccion: 'Calle 1',
    zona: 'Centro',
    latitud: -25.33,
    longitud: -57.50,
    estado: 'activo',
    fecha_corte: null,
    mora_congelada: null,
  };

  const cargosMedidorA = [
    { id: 'cg-1', descripcion: 'Reparación de llave de paso', monto: 35000 },
    { id: 'cg-2', descripcion: 'Manguera y acople 3/4', monto: 15000 },
  ];

  const res = calcularFacturaMedidor({
    medidor: medidorA,
    clienteId: 'cli-01',
    periodo: '2025-11',
    lecturaActual: 100,
    lecturaAnterior: 100, // 0 m³ -> 36.000 Gs tarifa mínima
    historialUltimosMeses: [10, 10, 10],
    facturasImpagasAnteriores: [],
    cargosPendientes: cargosMedidorA,
    correlativoPorMedidor: 1,
  });

  // Base conceptos 1-7:
  // 1. Agua: 36.000 Gs
  // 4. Otros trabajos: 35.000 + 15.000 = 50.000 Gs
  // Base ERSSAN = 36.000 + 50.000 = 86.000 Gs
  // ERSSAN 2% de 86.000 = 1.720 Gs
  // Total boleta = 86.000 + 1.720 = 87.720 Gs
  assert.equal(res.factura.total, 87720);

  // Verificar que existen 2 líneas separadas para otros trabajos
  const detallesOtros = res.detalles.filter((d) => d.concepto === 'otros_trabajos');
  assert.equal(detallesOtros.length, 2);
  assert.equal(detallesOtros[0].descripcion, 'Reparación de llave de paso');
  assert.equal(detallesOtros[0].monto, 35000);
  assert.equal(detallesOtros[1].descripcion, 'Manguera y acople 3/4');
  assert.equal(detallesOtros[1].monto, 15000);
});

test('13. Otros Trabajos: Aislamiento estricto por medidor (cargo de Medidor A nunca aparece en boleta de Medidor B)', () => {
  const medidorB: Medidor = {
    id: 'med-B',
    cliente_id: 'cli-01', // Mismo cliente
    numero_medidor: 20,
    fecha_instalacion: '2024-01-01',
    direccion: 'Calle 2',
    zona: 'Centro',
    latitud: -25.33,
    longitud: -57.50,
    estado: 'activo',
    fecha_corte: null,
    mora_congelada: null,
  };

  // Medidor B no tiene cargos pendientes
  const resB = calcularFacturaMedidor({
    medidor: medidorB,
    clienteId: 'cli-01',
    periodo: '2025-11',
    lecturaActual: 100,
    lecturaAnterior: 100,
    historialUltimosMeses: [10, 10, 10],
    facturasImpagasAnteriores: [],
    cargosPendientes: [], // Ningún cargo para Medidor B
    correlativoPorMedidor: 1,
  });

  const detallesOtrosB = resB.detalles.filter((d) => d.concepto === 'otros_trabajos');
  assert.equal(detallesOtrosB.length, 0);
  assert.equal(resB.factura.total, 36720); // Solo consumo mínimo 36.000 + ERSSAN 720
});

test('14. Regla de Oro: NUNCA se agrega un cargo a una factura ya emitida', () => {
  const facturaYaEmitida: Factura = {
    id: 'FAC-10-2025-10',
    medidor_id: 'med-A',
    cliente_id: 'cli-01',
    periodo_facturado: '2025-10',
    fecha_emision: '2025-10-05',
    fecha_vencimiento: '2025-10-31',
    estado: 'pendiente',
    total: 36720,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
  };

  // Intentar registrar cargo en período '2025-10' para med-A -> debe ser rechazado
  const resRechazo = validarRegistroCargo({
    monto: 50000,
    periodoFacturacion: '2025-10',
    medidorId: 'med-A',
    numeroMedidor: 10,
    facturasExistentesMedidor: [facturaYaEmitida],
  });

  assert.equal(resRechazo.valido, false);
  assert.match(resRechazo.error!, /NUNCA se agrega un cargo a una factura ya emitida/);
  assert.match(resRechazo.error!, /período 2025-10 ya fue emitido/);

  // Registrar para un período futuro aún no emitido '2025-11' -> permitido
  const resAceptado = validarRegistroCargo({
    monto: 50000,
    periodoFacturacion: '2025-11',
    medidorId: 'med-A',
    numeroMedidor: 10,
    facturasExistentesMedidor: [facturaYaEmitida],
  });

  assert.equal(resAceptado.valido, true);
});

test('15. Inmutabilidad y Auditoría: cargo facturado no se puede editar ni borrar; cargo pendiente puede editar período', () => {
  const cargoFacturado: CargoPendiente = {
    id: 'cg-fac',
    medidor_id: 'med-A',
    cliente_id: 'cli-01',
    fecha_trabajo: '2025-10-01',
    descripcion: 'Cambio de válvula',
    monto: 40000,
    periodo_facturacion: '2025-10',
    estado: 'facturado',
    factura_id: 'FAC-10-2025-10',
    registrado_por: 'Admin',
    fecha_registro: '2025-10-01T10:00:00Z',
  };

  const cargoPendiente: CargoPendiente = {
    ...cargoFacturado,
    id: 'cg-pend',
    estado: 'pendiente',
    factura_id: undefined,
  };

  // Edición de cargo facturado -> bloqueada
  const edicionFacturado = validarEdicionCargo({
    cargo: cargoFacturado,
    nuevoMonto: 45000,
  });
  assert.equal(edicionFacturado.permitida, false);
  assert.match(edicionFacturado.error!, /Un cargo facturado NO se puede editar ni borrar/);

  // Anulación de cargo facturado -> bloqueada
  const anulacionFacturado = validarAnulacionCargo({
    cargo: cargoFacturado,
    motivo: 'Error de digitación',
  });
  assert.equal(anulacionFacturado.permitida, false);
  assert.match(anulacionFacturado.error!, /Un cargo facturado NO se puede editar ni borrar/);

  // Anulación de cargo pendiente con motivo válido -> permitida
  const anulacionPendienteOk = validarAnulacionCargo({
    cargo: cargoPendiente,
    motivo: 'El cliente canceló la instalación del grifo adicional',
  });
  assert.equal(anulacionPendienteOk.permitida, true);

  // Anulación de cargo pendiente sin motivo suficiente -> bloqueada
  const anulacionPendienteSinMotivo = validarAnulacionCargo({
    cargo: cargoPendiente,
    motivo: 'no',
  });
  assert.equal(anulacionPendienteSinMotivo.permitida, false);
  assert.match(anulacionPendienteSinMotivo.error!, /mínimo 5 caracteres/);

  // Cambio de período de cargo pendiente a un período sin factura emitida -> permitido
  const cambioPeriodoOk = validarEdicionCargo({
    cargo: cargoPendiente,
    nuevoPeriodo: '2025-12',
    facturasExistentesMedidor: [],
  });
  assert.equal(cambioPeriodoOk.permitida, true);
});

test('16. Configuración de tarifas: creación de nueva versión con vigente_desde y auditoría completa', async () => {
  const { db } = await import('./database');

  const tarifaInicial = db.getTarifasVigentes();
  const totalVersionesInicial = db.getHistorialTarifas().length;

  // Modificar precio_m3 (de 4000 a 4500) y monto_mora_fijo (de 3000 a 3500)
  const res = db.actualizarTarifas(
    {
      precio_m3: 4500,
      monto_mora_fijo: 3500,
    },
    'admin-juan',
    'Aprobado por Resolución ERSSAN 02/2026'
  );

  assert.equal(res.precio_m3, 4500);
  assert.equal(res.monto_mora_fijo, 3500);
  assert.equal(res.creado_por, 'admin-juan');
  assert.ok(res.vigente_desde);

  // Verificar que el histórico conserva la versión anterior y ahora tiene 1 versión más
  const historial = db.getHistorialTarifas();
  assert.equal(historial.length, totalVersionesInicial + 1);

  // La versión inicial sigue existiendo y conserva sus valores
  const versionAnterior = historial[historial.length - 1];
  assert.equal(versionAnterior.precio_m3, tarifaInicial.precio_m3);
  assert.equal(versionAnterior.monto_mora_fijo, tarifaInicial.monto_mora_fijo);

  // Verificar registro de auditoría
  assert.ok(res.auditoria);
  assert.equal(res.auditoria.usuario, 'admin-juan');
  assert.equal(res.auditoria.motivo, 'Aprobado por Resolución ERSSAN 02/2026');
  assert.equal(res.auditoria.cambios.length, 2);

  const cambioPrecio = res.auditoria.cambios.find((c) => c.parametro === 'precio_m3');
  assert.ok(cambioPrecio);
  assert.equal(cambioPrecio.valor_anterior, 4000);
  assert.equal(cambioPrecio.valor_nuevo, 4500);

  const cambioMora = res.auditoria.cambios.find((c) => c.parametro === 'monto_mora_fijo');
  assert.ok(cambioMora);
  assert.equal(cambioMora.valor_anterior, 3000);
  assert.equal(cambioMora.valor_nuevo, 3500);
});

test('17. Configuración de tarifas: validaciones de parámetros (límites, tipos, capacidad)', async () => {
  const { db } = await import('./database');

  // Error al pasar precio negativo o cero
  assert.throws(
    () => db.actualizarTarifas({ precio_m3: 0 }),
    /El precio por m³ debe ser un valor positivo mayor a 0/
  );

  // Error al pasar porcentaje ERSSAN fuera de 0-100
  assert.throws(
    () => db.actualizarTarifas({ erssan_porcentaje: 150 }),
    /El aporte ERSSAN debe estar entre 0% y 100%/
  );

  // Error si no hay ningún cambio
  assert.throws(
    () => db.actualizarTarifas({}),
    /No se detectaron cambios en los parámetros respecto a la versión actual/
  );

  // Error si capacidad máxima es menor a la cantidad de medidores instalados
  assert.throws(
    () => db.actualizarTarifas({ max_numero_medidor: 5 }),
    /La capacidad máxima/
  );
});

test('18. Configuración de tarifas: inmutabilidad de facturas ya emitidas', async () => {
  const { db } = await import('./database');

  // Verificar inmutabilidad formal
  const testInmutabilidad = db.verificarInmutabilidadFacturas();
  assert.equal(testInmutabilidad.esInmutable, true);
  assert.equal(testInmutabilidad.facturasModificadas, 0);
  assert.ok(testInmutabilidad.totalFacturas > 0);
});

test('19. Configuración de tarifas: control de PIN de seguridad administrativo', async () => {
  const { db } = await import('./database');

  // PIN por defecto '1234'
  assert.equal(db.verificarSecurityPin('1234'), true);
  assert.equal(db.verificarSecurityPin('9999'), false);

  // Actualizar PIN a '5678'
  db.actualizarSecurityPin('5678', true);
  assert.equal(db.verificarSecurityPin('5678'), true);
  assert.equal(db.verificarSecurityPin('1234'), false);

  // Restaurar PIN por defecto
  db.actualizarSecurityPin('1234', true);
});

test('20. Pagos: registro de pago total o parcial por factura, cálculo exacto de saldo restante', async () => {
  const { db } = await import('./database');

  // Buscar una factura pendiente de un medidor moroso
  const medidoresMorosos = db.getMedidores({ estado: 'moroso', limit: 5 }).medidores;
  assert.ok(medidoresMorosos.length > 0, 'Debe haber medidores morosos');
  const detalleMoroso = db.getMedidorDetalle(medidoresMorosos[0].id);
  const facturasImpagas = detalleMoroso?.facturas.filter((f) => f.estado !== 'pagada') || [];
  assert.ok(facturasImpagas.length > 0, 'Debe haber facturas impagas');

  const facturaTest = facturasImpagas[0];
  const saldoInicial = facturaTest.saldo !== undefined ? facturaTest.saldo : facturaTest.total;
  assert.ok(saldoInicial > 10000, 'El saldo inicial debe permitir pago parcial');

  // 1. Pago parcial: pagamos la mitad
  const montoParcial = Math.round(saldoInicial / 2);
  const resParcial = db.registrarCobro({
    facturaId: facturaTest.id,
    monto: montoParcial,
    metodoPago: 'efectivo',
    cobradorId: 'tester',
  });

  assert.equal(resParcial.saldoRestante, saldoInicial - montoParcial);
  assert.equal(resParcial.factura.saldo, saldoInicial - montoParcial);
  assert.notEqual(resParcial.factura.estado, 'pagada'); // No está pagada aún

  // 2. Pago restante total
  const resTotal = db.registrarCobro({
    facturaId: facturaTest.id,
    monto: resParcial.saldoRestante,
    metodoPago: 'transferencia',
    cobradorId: 'tester',
  });

  assert.equal(resTotal.saldoRestante, 0);
  assert.equal(resTotal.factura.saldo, 0);
  assert.equal(resTotal.factura.estado, 'pagada');
  assert.ok(resTotal.factura.fecha_pago);
});

test('21. Pagos: Si un medidor tiene todas sus facturas pagadas, pasa de moroso o pendiente_corte a activo automáticamente', async () => {
  const { db } = await import('./database');

  // Buscar un medidor moroso o con facturas impagas
  const medidoresMorosos = db.getMedidores({ estado: 'moroso', limit: 10 }).medidores;
  assert.ok(medidoresMorosos.length > 0, 'Debe haber medidores morosos para la prueba');

  const medidorId = medidoresMorosos[0].id;
  const medidorDetalle = db.getMedidorDetalle(medidorId);
  assert.ok(medidorDetalle);

  const facturasImpagas = medidorDetalle.facturas.filter((f) => f.estado !== 'pagada');
  assert.ok(facturasImpagas.length > 0);

  // Pagar cada una de sus facturas pendientes hasta liquidar
  for (const fac of facturasImpagas) {
    const saldo = fac.saldo !== undefined ? fac.saldo : fac.total;
    if (saldo > 0) {
      db.registrarCobro({
        facturaId: fac.id,
        monto: saldo,
        metodoPago: 'efectivo',
      });
    }
  }

  // Verificar que el medidor ahora pasó a ACTIVO automáticamente
  const medidorActualizado = db.getMedidorDetalle(medidorId);
  assert.ok(medidorActualizado);
  assert.equal(medidorActualizado.medidor?.estado, 'activo');
  assert.equal(medidorActualizado.totalDeuda, 0);
});

test('22. Facturación mensual: Medidores cortados, retirados y pendiente_corte NO reciben nueva factura mensual', async () => {
  const { db } = await import('./database');

  const nuevoPeriodo = '2026-05';

  // Obtener conteo previo de medidores en pendiente_corte, cortado y retirado
  const pendientesCorte = db.getMedidores({ estado: 'pendiente_corte', limit: 100 }).medidores;
  const cortados = db.getMedidores({ estado: 'cortado', limit: 100 }).medidores;
  const retirados = db.getMedidores({ estado: 'retirado', limit: 100 }).medidores;

  assert.ok(pendientesCorte.length > 0, 'Debe haber medidores en pendiente_corte para verificar');

  // Ejecutar facturación masiva del nuevo periodo
  db.ejecutarFacturacionMensual(nuevoPeriodo);

  // Ninguno de los medidores en pendiente_corte, cortado o retirado debe tener factura en nuevoPeriodo
  const todasFacturasPeriodo = db.getFacturas({ periodo: nuevoPeriodo, limit: 1000 }).facturas;

  for (const m of pendientesCorte) {
    const tieneFac = todasFacturasPeriodo.some((f: any) => f.medidor_id === m.id);
    assert.equal(tieneFac, false, `El medidor pendiente_corte #${m.numero_medidor} no debe recibir nueva factura`);
  }

  for (const m of cortados) {
    const tieneFac = todasFacturasPeriodo.some((f: any) => f.medidor_id === m.id);
    assert.equal(tieneFac, false, `El medidor cortado #${m.numero_medidor} no debe recibir nueva factura`);
  }

  for (const m of retirados) {
    const tieneFac = todasFacturasPeriodo.some((f: any) => f.medidor_id === m.id);
    assert.equal(tieneFac, false, `El medidor retirado #${m.numero_medidor} no debe recibir nueva factura`);
  }
});

test('23. Reglas de Mora Fija por medidor: 3.000, 6.000, 9.000 tras día 11, pago previo al día 11 y congelamiento en corte', () => {
  const fVencida1: Factura = {
    id: 'f-v1',
    medidor_id: 'med-mora-test',
    cliente_id: 'cli-mora-test',
    periodo_facturado: '2025-01',
    fecha_emision: '2025-01-05',
    fecha_vencimiento: '2025-01-28',
    estado: 'vencida',
    total: 36720,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
  };

  const fVencida2: Factura = {
    ...fVencida1,
    id: 'f-v2',
    periodo_facturado: '2025-02',
    fecha_vencimiento: '2025-02-28',
    total: 500000, // Monto muy alto para verificar que la mora NUNCA se calcula como porcentaje
  };

  const f3raBoleta: Factura = {
    ...fVencida1,
    id: 'f-v3',
    periodo_facturado: '2025-03',
    fecha_emision: '2025-03-05',
    fecha_vencimiento: '2025-03-11',
    estado: 'pendiente',
    es_tercera_boleta: true,
    total: 200000,
  };

  // 1 boleta vencida: mora = 3.000 Gs
  const mora1 = calcularMoraMedidor([fVencida1], 3000, new Date('2025-03-01'));
  assert.equal(mora1.moraTotal, 3000);

  // 2 boletas vencidas al emitir 3ra: mora = 6.000 Gs (incluso con factura de 500.000 Gs, NUNCA es porcentaje)
  const mora2 = calcularMoraMedidor([fVencida1, fVencida2], 3000, new Date('2025-03-01'));
  assert.equal(mora2.moraTotal, 6000);

  // Pagar la 3ra antes del día 11 (ej: día 10 de marzo): la 3ra aún no está vencida -> solo mora 6.000 Gs y no hay corte
  const moraAntesDia11 = calcularMoraMedidor(
    [fVencida1, fVencida2, f3raBoleta],
    3000,
    new Date('2025-03-10T12:00:00Z')
  );
  assert.equal(moraAntesDia11.moraTotal, 6000);

  // 3ra no pagada tras el día 11 (ej: día 12 de marzo en adelante): genera mora -> mora = 9.000 Gs
  const moraTrasDia11 = calcularMoraMedidor(
    [fVencida1, fVencida2, f3raBoleta],
    3000,
    new Date('2025-03-12T12:00:00Z')
  );
  assert.equal(moraTrasDia11.moraTotal, 9000);
});

test('24. Ciclo completo de 3ra boleta, corte físico, mora congelada y regularización / reconexión', async () => {
  const { db } = await import('./database');

  // Obtener un medidor pendiente de corte
  const listadoCortar = db.getListadoParaCortar();
  assert.ok(listadoCortar.length > 0, 'Debe haber medidores a cortar');
  const medidorId = listadoCortar[0].id;
  const numMedidor = listadoCortar[0].numero_medidor;

  // 1. Confirmar retiro físico por cuadrilla
  const tarifaVigente = db.getTarifasVigentes();
  const moraEsperada = listadoCortar[0].facturasVencidas.length * tarifaVigente.monto_mora_fijo;
  const medidorCortado = db.confirmarCorteFisico(medidorId);
  assert.equal(medidorCortado.estado, 'cortado');
  assert.ok(medidorCortado.fecha_corte);
  // Mora congelada debe ser monto fijo por cantidad de boletas vencidas
  assert.equal(medidorCortado.mora_congelada, moraEsperada);

  // 2. Medidor cortado: mora congelada, no aumenta con el paso del tiempo
  const detCortado = db.getMedidorDetalle(medidorId);
  assert.equal(detCortado?.moraCalculada, moraEsperada);

  // 3. Reconexión: pagar liquidación (deuda + mora congelada + reconexión 60.000 + cargos + ERSSAN)
  const resReconexion = db.confirmarReconexion(medidorId, 'Tester');
  assert.equal(resReconexion.medidor.estado, 'activo');
  assert.equal(resReconexion.medidor.fecha_corte, null);
  assert.equal(resReconexion.medidor.mora_congelada, null); // mora del medidor vuelve a 0

  // Verificar que la factura de regularización fue emitida y pagada
  assert.equal(resReconexion.facturaRegularizacion.estado, 'pagada');
  assert.ok(resReconexion.facturaRegularizacion.detalles?.some((d) => d.concepto === 'reconexion' && d.monto === 60000));
  assert.ok(resReconexion.facturaRegularizacion.detalles?.some((d) => d.concepto === 'erssan'));

  // 4. Pago de 3ra boleta en medidor pendiente_corte actualiza su estado
  const listadoCortar2 = db.getListadoParaCortar();
  if (listadoCortar2.length > 0) {
    const medidorPC = listadoCortar2[0];
    const fac3ra = medidorPC.facturasVencidas.find((f) => f.es_tercera_boleta) || medidorPC.facturasVencidas[0];
    const saldo = fac3ra.saldo !== undefined ? fac3ra.saldo : fac3ra.total;

    // Pagar la 3ra boleta
    const resCobro3ra = db.registrarCobro({
      facturaId: fac3ra.id,
      monto: saldo,
      metodoPago: 'efectivo',
    });

    assert.equal(resCobro3ra.factura.estado, 'pagada');
    // El medidor ya no debe estar en pendiente_corte
    assert.notEqual(resCobro3ra.estadoMedidorActualizado, 'pendiente_corte');
    assert.ok(resCobro3ra.salioDePendienteCorte);
  }
});

test('25. Flujo integral de reconexión por medidor: búsqueda, regularización, pago, paso a activo, reinstalación y facturación normal siguiente período sin afectar otros medidores', () => {
  // 1. Operario busca medidor cortado
  const cortados = db.getListadoParaReconectar();
  assert.ok(cortados.length > 0, 'Debe haber al menos un medidor cortado');
  const target = cortados[0];
  const medidorId = target.id;
  const numAnterior = target.numero_medidor;

  // 2. Sistema genera factura de regularización con deuda + mora congelada + reconexión + cargos + ERSSAN
  const moraCongelada = target.liquidacion.mora;
  const totalEsperado = target.liquidacion.totalPagar;
  assert.ok(moraCongelada >= 0);
  assert.equal(target.liquidacion.montoReconexion, 60000);

  // 3 & 4 & 5. Operario registra reconexión con instalación de nuevo medidor
  db.actualizarTarifas({ max_numero_medidor: 1500 });
  const nuevoNumMedidor = 1001; // número libre dentro del nuevo límite
  const res = db.confirmarReconexion(medidorId, {
    cobradorId: 'Cuadrilla 1',
    metodoPago: 'efectivo',
    tipoReinstalacion: 'nuevo_medidor',
    nuevoNumeroMedidor: nuevoNumMedidor,
    lecturaInicial: 0,
    fechaReconexion: '2025-04-01',
    operario: 'Técnico Juan',
    observaciones: 'Instalación de nuevo medidor por recambio técnico',
  });

  // 4. Medidor pasa a activo
  assert.equal(res.medidor.estado, 'activo');
  assert.equal(res.medidor.fecha_corte, null);
  assert.equal(res.medidor.mora_congelada, null);
  assert.equal(res.medidor.numero_medidor, nuevoNumMedidor);
  assert.equal(res.medidor.numero_medidor_anterior, numAnterior);
  assert.equal(res.medidor.lectura_inicial_reconexion, 0);

  // Factura de regularización emitida y pagada
  assert.equal(res.facturaRegularizacion.estado, 'pagada');
  assert.equal(res.facturaRegularizacion.total, totalEsperado);
  assert.ok(res.facturaRegularizacion.detalles?.some((d) => d.concepto === 'reconexion' && d.monto === 60000));
  assert.ok(res.facturaRegularizacion.detalles?.some((d) => d.concepto === 'erssan'));

  // Pago registrado
  assert.equal(res.pago.monto, totalEsperado);
  assert.equal(res.pago.metodo_pago, 'efectivo');

  // 6. Siguiente período: medidor recibe factura normal. Los otros medidores del cliente no se ven afectados.
  db.registrarLectura({
    numeroMedidor: nuevoNumMedidor,
    lecturaActual: 12,
    fechaLectura: '2025-05-25',
    fotoUrl: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=400',
    registradoPor: 'Lecturista',
    estado: 'confirmada',
  });

  const loteMayo = db.ejecutarFacturacionMensual('2025-05');
  assert.ok(loteMayo.totalGeneradas > 0);

  const detalleMed = db.getMedidorDetalle(res.medidor.id);
  const facMayo = detalleMed?.facturas.find((f) => f.periodo_facturado === '2025-05');
  assert.ok(facMayo, 'El medidor reconectado debe recibir factura normal en el siguiente período');
  assert.equal(facMayo?.lectura_anterior, 0);
  assert.equal(facMayo?.lectura_actual, 12);
  assert.equal(facMayo?.consumo_m3, 12);
  assert.ok((facMayo?.total || 0) > 0);
});

test('26. Planes de Financiamiento: Cuota de conexión y Pérdida financiada se integran a la facturación y avanzan cuotas', () => {
  const medidor = db.getMedidores().medidores[15];
  assert.ok(medidor);

  // Registrar un plan de cuota de conexión de 3 cuotas de 50.000 Gs.
  const planConexion = db.agregarPlanFinanciamiento({
    medidor_id: medidor.id,
    cliente_id: medidor.cliente_id,
    tipo: 'cuota_conexion',
    descripcion: 'Conexión a red nueva financiada',
    monto_total: 150000,
    cantidad_cuotas: 3,
    monto_cuota: 50000,
    periodo_inicio: '2026-12',
    registrado_por: 'admin',
  });

  assert.equal(planConexion.estado, 'activo');
  assert.equal(planConexion.cuotas_pagadas, 0);

  // Registrar un plan de pérdida financiada de 2 cuotas de 80.000 Gs.
  const planPerdida = db.agregarPlanFinanciamiento({
    medidor_id: medidor.id,
    cliente_id: medidor.cliente_id,
    tipo: 'perdida_financiada',
    descripcion: 'Pérdida en cañería interna convenida en cuotas',
    monto_total: 160000,
    cantidad_cuotas: 2,
    monto_cuota: 80000,
    periodo_inicio: '2026-12',
    registrado_por: 'admin',
  });

  // Registrar lectura confirmada para el período 2026-12
  const ultLec = db.getLecturas({ medidorId: medidor.id, limit: 1 }).lecturas[0];
  const lecturaNueva = (ultLec?.lectura_actual || 471) + 12;

  db.registrarLectura({
    numeroMedidor: medidor.numero_medidor,
    lecturaActual: lecturaNueva,
    fechaLectura: '2026-12-25',
    fotoUrl: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=400',
    registradoPor: 'Lecturista',
    estado: 'confirmada',
  });

  // Ejecutar facturación del periodo 2026-12
  const resumen = db.ejecutarFacturacionMensual('2026-12');
  assert.ok(resumen.totalGeneradas > 0);

  const detalleMedidor = db.getMedidorDetalle(medidor.id);
  const fac = detalleMedidor?.facturas.find((f) => f.periodo_facturado === '2026-12');
  assert.ok(fac, 'Factura del periodo 2026-12 debe haber sido generada');

  const detalleConexion = fac?.detalles?.find((d) => d.concepto === 'cuota_conexion');
  const detallePerdida = fac?.detalles?.find((d) => d.concepto === 'perdida_financiada');

  assert.ok(detalleConexion, 'Debe incluir concepto cuota_conexion');
  assert.equal(detalleConexion?.monto, 50000);
  assert.match(detalleConexion?.descripcion || '', /Cuota de conexión \(cuota 1 de 3\)/);

  assert.ok(detallePerdida, 'Debe incluir concepto perdida_financiada');
  assert.equal(detallePerdida?.monto, 80000);
  assert.match(detallePerdida?.descripcion || '', /Pérdida financiada \(cuota 1 de 2\)/);

  // Las cuotas NO avanzan al emitir la factura (se avanzan al pagar)
  assert.equal(planConexion.cuotas_pagadas, 0);
  assert.equal(planPerdida.cuotas_pagadas, 0);

  // Registrar pago de la factura
  db.registrarCobro({
    facturaId: fac.id,
    monto: fac.total,
    metodoPago: 'efectivo',
  });

  // Al pagar la factura, ahora sí avanzan las cuotas pagadas
  assert.equal(planConexion.cuotas_pagadas, 1);
  assert.equal(planConexion.estado, 'activo');

  assert.equal(planPerdida.cuotas_pagadas, 1);
  assert.equal(planPerdida.estado, 'activo');
});

test('27. Factura de regularización: usa saldo_pendiente de última boleta impaga (206.550) + mora 9.000 + reconexión 60.000 + ERSSAN 2% sobre todos los conceptos (5.511) = 281.061 (excluye anuladas y usa YYYY-MM)', () => {
  const medidorCortado: Medidor = {
    id: 'med-reg-3',
    cliente_id: 'cli-03',
    numero_medidor: 3,
    direccion: 'Barrio Centro',
    zona: 'Centro',
    latitud: -25.3,
    longitud: -57.5,
    fecha_instalacion: '2026-01-01',
    estado: 'cortado',
    fecha_corte: '2026-11-01',
    mora_congelada: 9000,
  };

  const facturas: Factura[] = [
    {
      id: 'f-v1',
      medidor_id: 'med-reg-3',
      cliente_id: 'cli-03',
      periodo_facturado: '2026-08',
      fecha_emision: '2026-08-01',
      fecha_vencimiento: '2026-08-31',
      estado: 'vencida',
      total: 36720,
      saldo_pendiente: 36720,
      es_tercera_boleta: false,
      alerta_consumo_elevado: false,
      numero_boleta_medidor: 1,
    },
    {
      id: 'f-v2',
      medidor_id: 'med-reg-3',
      cliente_id: 'cli-03',
      periodo_facturado: '2026-09',
      fecha_emision: '2026-09-01',
      fecha_vencimiento: '2026-09-30',
      estado: 'vencida',
      total: 120000,
      saldo_pendiente: 120000,
      es_tercera_boleta: false,
      alerta_consumo_elevado: false,
      numero_boleta_medidor: 2,
    },
    {
      id: 'f-v3',
      medidor_id: 'med-reg-3',
      cliente_id: 'cli-03',
      periodo_facturado: '2026-10',
      fecha_emision: '2026-10-01',
      fecha_vencimiento: '2026-10-11',
      estado: 'vencida',
      total: 206550,
      saldo_pendiente: 206550,
      es_tercera_boleta: true,
      alerta_consumo_elevado: false,
      numero_boleta_medidor: 3,
    },
    // Facturas anuladas NO deben tomarse ni siquiera si tienen período posterior
    {
      id: 'f-anu-1',
      medidor_id: 'med-reg-3',
      cliente_id: 'cli-03',
      periodo_facturado: '2026-11',
      fecha_emision: '2026-11-01',
      fecha_vencimiento: '2026-11-11',
      estado: 'anulada',
      total: 300000,
      saldo_pendiente: 300000,
      es_tercera_boleta: false,
      alerta_consumo_elevado: false,
      numero_boleta_medidor: 4,
    },
  ];

  // Liquidación previa (para modal): deuda = 206.550 + mora 9.000 + reconexión 60.000
  // Base ERSSAN = 206.550 + 9.000 + 60.000 = 275.550 -> ERSSAN 2% = 5.511 -> Total = 281.061
  const liq = liquidarReconexion(medidorCortado, facturas);
  assert.equal(liq.subtotalFacturas, 206550);
  assert.equal(liq.mora, 9000);
  assert.equal(liq.montoReconexion, 60000);
  assert.equal(liq.montoErssan, 5511);
  assert.equal(liq.totalPagar, 281061);

  // Generación de factura de regularización
  const reg = generarFacturaRegularizacion({
    medidor: medidorCortado,
    clienteId: 'cli-03',
    facturasImpagas: facturas,
    fechaEmision: '2026-11-17',
    correlativoPorMedidor: 5,
  });

  // Período YYYY-MM (7 caracteres max, sin 'REGULARIZACION')
  assert.match(reg.factura.periodo_facturado, /^\d{4}-\d{2}$/);
  assert.equal(reg.factura.periodo_facturado, '2026-11');
  assert.equal(reg.factura.periodo_facturado.length, 7);

  const detDeuda = reg.detalles.find((d) => d.concepto === 'deuda_anterior');
  const detMora = reg.detalles.find((d) => d.concepto === 'mora');
  const detReconexion = reg.detalles.find((d) => d.concepto === 'reconexion');
  const detErssan = reg.detalles.find((d) => d.concepto === 'erssan');

  assert.ok(detDeuda, 'Debe incluir deuda_anterior');
  assert.equal(detDeuda?.monto, 206550);
  assert.match(detDeuda?.descripcion || '', /2026-10/);

  assert.ok(detMora, 'Debe incluir mora');
  assert.equal(detMora?.monto, 9000);

  assert.ok(detReconexion, 'Debe incluir reconexion');
  assert.equal(detReconexion?.monto, 60000);

  assert.ok(detErssan, 'Debe incluir erssan');
  assert.equal(detErssan?.monto, 5511);

  assert.equal(reg.factura.total, 281061);
});

test('28. Regularización usa saldo_pendiente en pagos parciales, evita colisiones YYYY-MM y propaga errores en confirmarReconexionAsync', async () => {
  const medidor: Medidor = {
    id: 'med-reg-parcial',
    cliente_id: 'cli-04',
    numero_medidor: 44,
    direccion: 'Lote 44',
    zona: 'Norte',
    latitud: -25.3,
    longitud: -57.5,
    fecha_instalacion: '2026-01-01',
    estado: 'cortado',
    fecha_corte: '2026-11-01',
    mora_congelada: 3000,
  };

  const facParcial: Factura = {
    id: 'f-parc-1',
    medidor_id: 'med-reg-parcial',
    cliente_id: 'cli-04',
    periodo_facturado: '2026-10',
    fecha_emision: '2026-10-01',
    fecha_vencimiento: '2026-10-31',
    estado: 'vencida',
    total: 100000,
    monto_pagado: 60000,
    saldo_pendiente: 40000,
    saldo: 40000,
    es_tercera_boleta: false,
    alerta_consumo_elevado: false,
    numero_boleta_medidor: 1,
  };

  const liq = liquidarReconexion(medidor, [facParcial], undefined, [
    { monto: 10000 },
  ]);
  assert.equal(liq.subtotalFacturas, 40000);
  assert.equal(liq.subtotalCargos, 10000);
  // Base ERSSAN (todos los conceptos) = 40.000 + 3.000 + 10.000 + 60.000 = 113.000 -> ERSSAN 2% = 2.260 -> Total = 115.260
  assert.equal(liq.montoErssan, 2260);
  assert.equal(liq.totalPagar, 115260);

  const reg = generarFacturaRegularizacion({
    medidor,
    clienteId: 'cli-04',
    facturasImpagas: [facParcial],
    cargosPendientes: [{ id: 'c1', descripcion: 'Cambio de llave', monto: 10000 }],
    fechaEmision: '2026-11-17',
    correlativoPorMedidor: 2,
  });
  assert.equal(reg.factura.total, 115260);
  assert.equal(reg.detalles.find((d) => d.concepto === 'erssan')?.monto, 2260);
  assert.equal(
    reg.detalles.find((d) => d.concepto === 'deuda_anterior')?.monto,
    40000
  );

  // Resolución de período YYYY-MM sin colisionar con facturas no anuladas
  assert.equal(
    resolverPeriodoRegularizacion('2026-11-17', ['2026-09', '2026-10']),
    '2026-11'
  );
  assert.equal(
    resolverPeriodoRegularizacion('2026-11-17', ['2026-11', '2026-10']),
    '2026-09'
  );

  // confirmarReconexionAsync propaga errores de Supabase sin mutar estado en memoria
  db.clearData();
  const cli = db.agregarCliente({
    nombre_completo: 'María López',
    documento: '9876543',
    direccion: 'Centro',
    telefono: '0981999888',
    email: 'maria@example.com',
  });
  const med = db.agregarMedidor({
    cliente_id: cli.id,
    numero_medidor: 99,
    fecha_instalacion: '2026-01-01',
    direccion: 'Lote 99',
    zona: 'Centro',
    latitud: -25.3,
    longitud: -57.5,
    estado: 'cortado',
  });
  med.mora_congelada = 9000;
  med.fecha_corte = '2026-11-01';

  const failingSupabaseMock = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: '00000000-0000-4000-8000-000000000001' } } } }),
    },
    from: (table: string) => ({
      update: () => ({
        eq: async () => ({ error: null }),
        in: async () => ({ error: null }),
      }),
      insert: async () =>
        table === 'facturas'
          ? { error: { message: 'simulated db constraint failure' } }
          : { error: null },
    }),
  };

  await assert.rejects(
    async () => {
      await db.confirmarReconexionAsync(med.id, { cobradorId: 'admin' }, { clientOverride: failingSupabaseMock });
    },
    /simulated db constraint failure/
  );

  // El medidor NO debe haber cambiado a 'activo' si falló Supabase
  const medTrasError = db.getMedidores().medidores.find((m) => m.id === med.id);
  assert.equal(medTrasError?.estado, 'cortado');
});





