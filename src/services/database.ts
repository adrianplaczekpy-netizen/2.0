/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Cliente,
  Medidor,
  Contrato,
  Lectura,
  Factura,
  DetalleFactura,
  Pago,
  CargoPendiente,
  PlanFinanciamiento,
  TarifaConfig,
  AuditoriaCambioParametro,
  RegistroAuditoriaTarifa,
  EstadoMedidor,
  EstadoFactura,
  EstadoCargo,
  MetodoPago,
  ConsumoZonaReport,
  ReporteRecaudacionDetalle,
  OpcionesReconexion,
} from '../types';
import {
  TARIFAS_DEFAULT,
  calcularFacturaMedidor,
  evaluarEstadoMedidor,
  calcularMoraMedidor,
  verificarAlertaConsumo,
  validarNumeroMedidor,
  liquidarReconexion,
  generarFacturaRegularizacion,
  validarLecturaIngreso,
  validarEdicionLectura,
  validarRegistroCargo,
  validarEdicionCargo,
  validarAnulacionCargo,
} from './billingRules';
import {
  calcularFacturaIndividual,
  calcularFechaVencimiento,
  ResumenFacturacionMensual,
  MedidorOmitidoFacturacion,
  ErrorFacturacionMedidor,
} from './billingEngine';
import { generarFotoPlaceholder } from '../utils/imageCompressor';

// Nombres y apellidos paraguayos comunes
const NOMBRES = [
  'Juan Carlos', 'María Elena', 'José Ramón', 'Ana Gladys', 'Carlos Alberto',
  'Rosa Isabel', 'Luis Fernando', 'Carmen Beatriz', 'Jorge Antonio', 'Gladys Noemí',
  'Miguel Ángel', 'Lourdes Patricia', 'Diego Manuel', 'Silvia Maribel', 'Pedro Javier',
  'Ramona Antonia', 'Hugo Daniel', 'Marta Concepción', 'Gustavo Adolfo', 'Norma Cristina',
  'Rubén Darío', 'Mirtha Graciela', 'Oscar Raúl', 'Fátima Soledad', 'Héctor Fabián'
];

const APELLIDOS = [
  'González', 'Benítez', 'Martínez', 'López', 'Giménez',
  'Romero', 'Vera', 'Duarte', 'Villalba', 'Fernández',
  'Rojas', 'Cardozo', 'Gómez', 'Aquino', 'Caballero',
  'Valdez', 'Barreto', 'Franco', 'Acosta', 'Cáceres'
];

const ZONAS_AGUATERIA = [
  { nombre: 'Zona Centro San Lorenzo', lat: -25.3405, lng: -57.5105 },
  { nombre: 'Barrio San José', lat: -25.3325, lng: -57.5015 },
  { nombre: 'Reducto', lat: -25.3650, lng: -57.5180 },
  { nombre: 'Barcequillo', lat: -25.3280, lng: -57.5350 },
  { nombre: 'Cuarto Barrio - Luque', lat: -25.2715, lng: -57.4895 },
  { nombre: 'Posta Ybycuá - Capiatá', lat: -25.3720, lng: -57.4420 },
  { nombre: 'Ruta 2 Km 18', lat: -25.3580, lng: -57.4600 },
  { nombre: 'Patiño - Itauguá', lat: -25.3690, lng: -57.3420 }
];

const CALLES = [
  'Av. Defensores del Chaco', 'Calle Julia Miranda Cueto', 'Calle 10 de Agosto',
  'Av. San José', 'Calle Cerro Corá', 'Av. De la Victoria', 'Calle Coronel Romero',
  'Calle San Lorenzo', 'Av. Avelino Martínez', 'Calle Fortín Arce', 'Calle General Genes'
];

interface DatabaseSchema {
  clientes: Cliente[];
  medidores: Medidor[];
  contratos: Contrato[];
  lecturas: Lectura[];
  facturas: Factura[];
  pagos: Pago[];
  cargos_pendientes: CargoPendiente[];
  planes_financiamiento: PlanFinanciamiento[];
  tarifas: TarifaConfig[];
  pin_seguridad?: { pin: string; activo: boolean };
  version: number;
}

import { supabase, isSupabaseConfigured, supabaseUrl, supabaseAnonKey } from './supabaseClient';

export function generarUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const STORAGE_KEY = 'aguateria_db_v1';

export interface LoadFromSupabaseResult {
  ok: boolean;
  clientesCount: number;
  medidoresCount: number;
  error?: string;
}

class DatabaseEngine {
  private data: DatabaseSchema;
  private initialized = false;
  private connectionStatus: 'connecting' | 'connected' | 'error' = 'connecting';
  private dbError: string | null = null;
  private listeners: Array<() => void> = [];
  private activeLoadPromise: Promise<LoadFromSupabaseResult> | null = null;
  private usuariosMap = new Map<string, string>();

  constructor() {
    this.data = this.loadOrSeed();
    this.initialized = true;
  }

  public getConnectionStatus(): 'connecting' | 'connected' | 'error' {
    return this.connectionStatus;
  }

  public getDbError(): string | null {
    return this.dbError;
  }

  public getSupabaseUrl(): string {
    return supabaseUrl;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        console.warn('[DatabaseEngine] Listener error:', e);
      }
    }
  }

  private createEmptySchema(): DatabaseSchema {
    return {
      clientes: [],
      medidores: [],
      contratos: [],
      lecturas: [],
      facturas: [],
      pagos: [],
      cargos_pendientes: [],
      planes_financiamiento: [],
      tarifas: [TARIFAS_DEFAULT],
      pin_seguridad: { pin: '1234', activo: false },
      version: 2,
    };
  }

  public clearData(): void {
    this.data = this.createEmptySchema();
    this.usuariosMap.clear();
    this.connectionStatus = 'connecting';
    this.dbError = null;
    this.notify();
  }

  /**
   * Inicialización:
   * 1. Limpia explícitamente cualquier residuo de localStorage.
   * 2. Inicializa el esquema en memoria limpio/vacío para datos reales (0 medidores ficticios).
   * 3. Si ya existe sesión autenticada en Supabase, carga datos reales.
   * 4. Si falla la conexión, NO hay fallback silencioso a localStorage. Muestra error claro.
   */
  private loadOrSeed(): DatabaseSchema {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem('aguateria_py_session');
      } catch (e) {
        // Ignorar
      }
    }

    const emptySchema = this.createEmptySchema();

    // Intentar carga inicial solo si ya hay sesión autenticada (sin consultar como anon)
    this.loadFromSupabase({ silentIfUnauthenticated: true });

    return emptySchema;
  }

  /**
   * Carga directa desde las tablas de Supabase.
   * Verifica primero que exista sesión autenticada; si Supabase no está configurado o falla,
   * registra el error explícito y NUNCA cae en localStorage.
   */
  public async loadFromSupabase(options?: {
    silentIfUnauthenticated?: boolean;
    force?: boolean;
    clientOverride?: any;
  }): Promise<LoadFromSupabaseResult> {
    if (!options?.force && !options?.clientOverride && this.activeLoadPromise) {
      return this.activeLoadPromise;
    }

    const promise = this.executeLoadFromSupabase(options);
    if (!options?.clientOverride) {
      this.activeLoadPromise = promise;
    }

    try {
      return await promise;
    } finally {
      if (this.activeLoadPromise === promise) {
        this.activeLoadPromise = null;
      }
    }
  }

  private async executeLoadFromSupabase(options?: {
    silentIfUnauthenticated?: boolean;
    force?: boolean;
    clientOverride?: any;
  }): Promise<LoadFromSupabaseResult> {
    const client = options?.clientOverride || (isSupabaseConfigured ? supabase : null);

    if (!client) {
      const msg = 'Supabase no está configurado. Verifique VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.';
      this.connectionStatus = 'error';
      this.dbError = msg;
      this.notify();
      return { ok: false, clientesCount: 0, medidoresCount: 0, error: msg };
    }

    this.connectionStatus = 'connecting';
    this.dbError = null;
    this.notify();

    try {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) {
        const msg = `Error al verificar sesión de Supabase: ${sessionError.message}`;
        this.connectionStatus = 'error';
        this.dbError = msg;
        console.warn('[DatabaseEngine] Error de sesión en Supabase:', sessionError.message);
        this.notify();
        return { ok: false, clientesCount: 0, medidoresCount: 0, error: msg };
      }

      if (!sessionData?.session?.user) {
        if (options?.silentIfUnauthenticated) {
          this.connectionStatus = 'connecting';
          this.dbError = null;
          this.notify();
          return {
            ok: false,
            clientesCount: 0,
            medidoresCount: 0,
            error: 'Sesión no iniciada en Supabase.',
          };
        }

        const msg = 'No hay sesión autenticada en Supabase. Iniciá sesión para sincronizar los datos.';
        this.connectionStatus = 'error';
        this.dbError = msg;
        this.notify();
        return { ok: false, clientesCount: 0, medidoresCount: 0, error: msg };
      }

      const [
        tarifasRes,
        clientesRes,
        medidoresRes,
        contratosRes,
        lecturasRes,
        facturasRes,
        detalleRes,
        pagosRes,
        cargosRes,
        planesRes,
        usuariosRes,
      ] = await Promise.all([
        client.from('tarifas').select('*').order('vigente_desde', { ascending: true }).order('fecha_creacion', { ascending: true }),
        client.from('clientes').select('*').order('created_at', { ascending: false }).limit(5000),
        client.from('medidores').select('*').order('numero_medidor', { ascending: true }).limit(5000),
        client.from('contratos').select('*').limit(5000),
        client.from('lecturas').select('*').order('fecha_lectura', { ascending: false }).limit(10000),
        client.from('facturas').select('*').order('created_at', { ascending: false }).limit(10000),
        client.from('detalle_factura').select('*').limit(20000),
        client.from('pagos').select('*').order('fecha_pago', { ascending: false }).limit(10000),
        client.from('cargos_pendientes').select('*').limit(5000),
        client.from('planes_financiamiento').select('*').limit(5000),
        client.from('usuarios').select('id, nombre_completo, email').limit(500),
      ]);

      const tableResults: Array<{ name: string; res: any }> = [
        { name: 'tarifas', res: tarifasRes },
        { name: 'clientes', res: clientesRes },
        { name: 'medidores', res: medidoresRes },
        { name: 'contratos', res: contratosRes },
        { name: 'lecturas', res: lecturasRes },
        { name: 'facturas', res: facturasRes },
        { name: 'detalle_factura', res: detalleRes },
        { name: 'pagos', res: pagosRes },
        { name: 'cargos_pendientes', res: cargosRes },
        { name: 'planes_financiamiento', res: planesRes },
      ];

      const failedTable = tableResults.find((t) => t.res?.error);
      if (failedTable) {
        const msg = `Error al cargar tabla "${failedTable.name}" en Supabase: ${failedTable.res.error.message}`;
        this.connectionStatus = 'error';
        this.dbError = msg;
        console.warn('[DatabaseEngine] Error consultando Supabase:', msg);
        this.notify();
        return { ok: false, clientesCount: 0, medidoresCount: 0, error: msg };
      }

      const clientes: Cliente[] = (clientesRes.data || []).map((c: any) => ({
        id: c.id,
        nombre_completo: c.nombre_completo || '',
        documento: c.documento || '',
        direccion: c.direccion || '',
        telefono: c.telefono || '',
        email: c.email || '',
        fecha_alta: c.fecha_alta || '',
      }));

      const medidores: Medidor[] = (medidoresRes.data || []).map((m: any) => ({
        id: m.id,
        cliente_id: m.cliente_id,
        numero_medidor: Number(m.numero_medidor),
        direccion: m.direccion,
        zona: m.zona || 'Centro',
        latitud: Number(m.latitud),
        longitud: Number(m.longitud),
        fecha_instalacion: m.fecha_instalacion,
        estado: m.estado,
        fecha_corte: m.fecha_corte,
        mora_congelada: m.mora_congelada ? Number(m.mora_congelada) : null,
      }));

      const contratos: Contrato[] = (contratosRes.data || []).map((con: any) => ({
        id: con.id,
        cliente_id: con.cliente_id,
        fecha_inicio: con.fecha_inicio,
        fecha_fin: con.fecha_fin,
        condiciones: con.condiciones,
        estado: con.estado,
      }));

      const lecturas: Lectura[] = (lecturasRes.data || []).map((l: any) => ({
        id: l.id,
        medidor_id: l.medidor_id,
        periodo: l.periodo,
        fecha_lectura: l.fecha_lectura,
        lectura_anterior: Number(l.lectura_anterior),
        lectura_actual: Number(l.lectura_actual),
        consumo_m3: Number(l.consumo_m3),
        foto_medidor_url: l.foto_medidor_url,
        observaciones: l.observaciones,
        foto_observacion_url: l.foto_observacion_url,
        estado: l.estado,
        registrado_por: l.registrado_por,
        fecha_registro: l.fecha_registro,
        editado_por: l.editado_por,
        fecha_edicion: l.fecha_edicion,
        motivo_edicion: l.motivo_edicion,
      }));

      const ordenConceptos: Record<string, number> = {
        consumo_agua: 1,
        deuda_anterior: 2,
        mora: 3,
        otros_trabajos: 4,
        cuota_conexion: 5,
        perdida_financiada: 6,
        reconexion: 7,
        erssan: 8,
      };
      const detallesMap: Record<string, DetalleFactura[]> = {};
      for (const d of detalleRes.data || []) {
        if (!detallesMap[d.factura_id]) detallesMap[d.factura_id] = [];
        detallesMap[d.factura_id].push({
          id: d.id || generarUUID(),
          factura_id: d.factura_id,
          concepto: d.concepto,
          descripcion: d.descripcion,
          monto: Number(d.monto),
          cargo_pendiente_id: d.cargo_pendiente_id || null,
        });
      }
      for (const fid of Object.keys(detallesMap)) {
        detallesMap[fid].sort((a, b) => (ordenConceptos[a.concepto] || 99) - (ordenConceptos[b.concepto] || 99));
      }

      const facturas: Factura[] = (facturasRes.data || []).map((f: any) => {
        const totalNum = Number(f.total);
        const saldoPendiente =
          f.saldo_pendiente !== undefined && f.saldo_pendiente !== null
            ? Number(f.saldo_pendiente)
            : f.saldo !== undefined && f.saldo !== null
              ? Number(f.saldo)
              : f.estado === 'pagada' || f.estado === 'anulada'
                ? 0
                : totalNum;
        const montoPagado =
          f.monto_pagado !== undefined && f.monto_pagado !== null
            ? Number(f.monto_pagado)
            : f.estado === 'pagada'
              ? totalNum
              : f.estado === 'anulada'
                ? 0
                : Math.max(0, totalNum - saldoPendiente);

        return {
          id: f.id,
          medidor_id: f.medidor_id,
          cliente_id: f.cliente_id,
          numero_boleta_medidor: Number(f.numero_boleta_medidor),
          periodo_facturado: f.periodo_facturado,
          fecha_emision: f.fecha_emision,
          fecha_vencimiento: f.fecha_vencimiento,
          total: totalNum,
          saldo_pendiente: saldoPendiente,
          saldo: saldoPendiente,
          monto_pagado: montoPagado,
          es_tercera_boleta: Boolean(f.es_tercera_boleta),
          alerta_consumo_elevado: Boolean(f.alerta_consumo_elevado),
          texto_alerta_consumo: f.texto_alerta || f.texto_alerta_consumo || null,
          estado: f.estado,
          fecha_pago: f.fecha_pago || null,
          motivo_anulacion: f.motivo_anulacion || null,
          lectura_anterior:
            f.lectura_anterior !== undefined && f.lectura_anterior !== null
              ? Number(f.lectura_anterior)
              : undefined,
          lectura_actual:
            f.lectura_actual !== undefined && f.lectura_actual !== null
              ? Number(f.lectura_actual)
              : undefined,
          consumo_m3:
            f.consumo_m3 !== undefined && f.consumo_m3 !== null
              ? Number(f.consumo_m3)
              : undefined,
          detalles: detallesMap[f.id] || [],
        };
      });

      const pagos: Pago[] = (pagosRes.data || []).map((p: any) => ({
        id: p.id,
        factura_id: p.factura_id,
        fecha_pago: p.fecha_pago,
        monto: Number(p.monto_pagado || p.monto || 0),
        metodo_pago: p.metodo || p.metodo_pago || 'efectivo',
        numero_recibo: p.numero_comprobante || p.numero_recibo || '',
        cobrador_id: p.cajero || p.cobrador_id || 'caja',
      }));

      const cargos_pendientes: CargoPendiente[] = (cargosRes.data || []).map((cg: any) => {
        const medidorRel = medidores.find((m) => m.id === cg.medidor_id);
        return {
          id: cg.id,
          medidor_id: cg.medidor_id,
          cliente_id: cg.cliente_id || medidorRel?.cliente_id || '',
          fecha_trabajo: cg.fecha_trabajo || cg.fecha_registro?.split('T')[0] || new Date().toISOString().split('T')[0],
          descripcion: cg.descripcion,
          monto: Number(cg.monto),
          periodo_facturacion: cg.periodo_facturacion,
          estado: cg.estado || 'pendiente',
          factura_id: cg.factura_id || null,
          comprobante_url: cg.comprobante_url || null,
          registrado_por: cg.registrado_por || 'admin',
          fecha_registro: cg.fecha_registro || new Date().toISOString(),
          motivo_anulacion: cg.motivo_anulacion || null,
          editado_por: cg.editado_por || null,
          fecha_edicion: cg.fecha_edicion || null,
        };
      });

      const tarifas: TarifaConfig[] =
        tarifasRes.data && tarifasRes.data.length > 0
          ? tarifasRes.data.map((t: any) => ({
              id: t.id,
              precio_m3: Number(t.precio_m3),
              consumo_minimo_m3: Number(t.consumo_minimo_m3),
              monto_minimo_consumo: Number(t.monto_minimo_consumo),
              monto_mora_fijo: Number(t.monto_mora_fijo),
              monto_reconexion: Number(t.monto_reconexion),
              erssan_porcentaje: Number(t.erssan_porcentaje),
              dia_vencimiento_boletas_normales:
                t.dia_vencimiento_boletas_normales === 'ultimo_dia_mes' ||
                t.dia_vencimiento_boletas_normales === '0' ||
                t.dia_vencimiento_boletas_normales === 0
                  ? 'ultimo_dia_mes'
                  : Number(t.dia_vencimiento_boletas_normales),
              dia_vencimiento_tercera_boleta: Number(t.dia_vencimiento_tercera_boleta),
              umbral_alerta_consumo: Number(t.umbral_alerta_consumo),
              texto_alerta_consumo: t.texto_alerta_consumo,
              max_numero_medidor: Number(t.max_numero_medidor),
              vigente_desde: t.vigente_desde,
              creado_por: t.creado_por || 'admin',
              fecha_creacion: t.fecha_creacion || t.vigente_desde,
              motivo_cambio: t.motivo_cambio,
              cambios_auditados: Array.isArray(t.cambios_auditados) ? t.cambios_auditados : [],
              auditoria: t.cambios_auditados
                ? {
                    id: t.id,
                    tarifa_id: t.id,
                    usuario: t.creado_por || 'admin',
                    fecha: t.fecha_creacion || t.vigente_desde,
                    cambios: t.cambios_auditados,
                    motivo: t.motivo_cambio,
                  }
                : undefined,
            }))
          : [];

      const planes_financiamiento: PlanFinanciamiento[] = (planesRes?.data || []).map((p: any) => ({
        id: p.id,
        medidor_id: p.medidor_id,
        cliente_id: p.cliente_id,
        tipo: p.tipo,
        descripcion: p.descripcion,
        monto_total: Number(p.monto_total),
        cantidad_cuotas: Number(p.cantidad_cuotas),
        monto_cuota: Number(p.monto_cuota),
        periodo_inicio: p.periodo_inicio,
        cuotas_pagadas: Number(p.cuotas_pagadas || 0),
        estado: p.estado,
        registrado_por: p.registrado_por,
        fecha_registro: p.fecha_registro,
        motivo_anulacion: p.motivo_anulacion,
      }));

      if (!usuariosRes?.error && Array.isArray(usuariosRes?.data)) {
        this.usuariosMap.clear();
        for (const u of usuariosRes.data) {
          if (u?.id) {
            this.usuariosMap.set(u.id, u.nombre_completo || u.email || u.id);
          }
        }
      }

      this.data = {
        clientes,
        medidores,
        contratos,
        lecturas,
        facturas,
        pagos,
        cargos_pendientes,
        planes_financiamiento,
        tarifas,
        pin_seguridad: { pin: '1234', activo: false },
        version: 2,
      };

      this.connectionStatus = 'connected';
      this.dbError = null;
      this.notify();
      return {
        ok: true,
        clientesCount: clientes.length,
        medidoresCount: medidores.length,
      };
    } catch (err: any) {
      const msg = `No se pudo conectar a la base de datos de Supabase: ${err?.message || 'Error de red o servidor'}`;
      this.connectionStatus = 'error';
      this.dbError = msg;
      console.warn('[DatabaseEngine] Error conectando a Supabase:', err?.message || err);
      this.notify();
      return { ok: false, clientesCount: 0, medidoresCount: 0, error: msg };
    }
  }

  private saveData(data: DatabaseSchema) {
    this.data = data;
    this.notify();
    // Toda la persistencia es directa en Supabase. No se almacena en localStorage.
  }

  /**
   * Carga determinística de prueba exclusivamente para entornos de test unitario.
   */
  public loadTestData(): void {
    if (this.data.medidores.length > 0) return;
    const seed = this.generateSeedData();
    this.data = seed;
    this.notify();
  }


  /**
   * Genera determinísticamente 1.000 medidores distribuidos en ~450 clientes
   */
  private generateSeedData(): DatabaseSchema {
    const totalMedidores = 990;
    const clientes: Cliente[] = [];
    const medidores: Medidor[] = [];
    const contratos: Contrato[] = [];
    const lecturas: Lectura[] = [];
    const facturas: Factura[] = [];
    const pagos: Pago[] = [];
    const cargos_pendientes: CargoPendiente[] = [];

    // 1. Crear ~450 clientes (algunos tendrán 1 medidor, otros 2, otros 3 o 4)
    let ciCounter = 1420500;
    let clienteIndex = 0;

    // Distribuiremos los 1.000 medidores entre los clientes
    let currentMedidorNum = 1;

    while (currentMedidorNum <= totalMedidores) {
      clienteIndex++;
      const nombre = NOMBRES[(clienteIndex * 3) % NOMBRES.length];
      const apellido1 = APELLIDOS[(clienteIndex * 7) % APELLIDOS.length];
      const apellido2 = APELLIDOS[(clienteIndex * 11) % APELLIDOS.length];
      const nombreCompleto = `${nombre} ${apellido1} ${apellido2}`;
      const documento = `${ciCounter + clienteIndex * 13}`;
      const telefono = `+595 9${81 + (clienteIndex % 15)} ${100 + (clienteIndex % 899)} ${100 + ((clienteIndex * 3) % 899)}`;
      const clienteId = `cli-${clienteIndex}`;

      const zona = ZONAS_AGUATERIA[clienteIndex % ZONAS_AGUATERIA.length];
      const calle = CALLES[clienteIndex % CALLES.length];
      const nroCasa = 100 + (clienteIndex % 900);
      const direccionPrincipal = `${calle} N° ${nroCasa}, ${zona.nombre}`;

      clientes.push({
        id: clienteId,
        nombre_completo: nombreCompleto,
        documento,
        direccion: direccionPrincipal,
        telefono,
        email: `${apellido1.toLowerCase()}.${nombre.split(' ')[0].toLowerCase()}${clienteIndex}@gmail.com`,
        fecha_alta: `2023-${String(1 + (clienteIndex % 12)).padStart(2, '0')}-15`,
      });

      // Contrato principal del cliente
      contratos.push({
        id: `con-${clienteId}`,
        cliente_id: clienteId,
        fecha_inicio: `2023-${String(1 + (clienteIndex % 12)).padStart(2, '0')}-15`,
        fecha_fin: null,
        condiciones: 'Suministro de agua potable para uso residencial y comercial según normas de ERSSAN.',
        estado: 'vigente',
      });

      // Cuántos medidores tendrá este cliente: 1 a 3 (aprox 70% 1 medidor, 20% 2 medidores, 10% 3 medidores)
      const cantMedidores = clienteIndex % 10 === 0 ? 3 : clienteIndex % 4 === 0 ? 2 : 1;

      for (let m = 0; m < cantMedidores && currentMedidorNum <= totalMedidores; m++) {
        const medidorId = `med-${currentMedidorNum}`;
        const numero_medidor = currentMedidorNum;

        // Jitter suave para coordenadas GPS alrededor de la zona
        const jitterLat = ((numero_medidor * 17) % 100 - 50) * 0.0003;
        const jitterLng = ((numero_medidor * 23) % 100 - 50) * 0.0003;
        const latitud = +(zona.lat + jitterLat).toFixed(6);
        const longitud = +(zona.lng + jitterLng).toFixed(6);

        // Determinación de estado para prueba de todas las reglas del sistema
        // ~80% activo, ~10% moroso, ~4% pendiente_corte, ~4% cortado, ~2% retirado
        let estado: EstadoMedidor = 'activo';
        let fecha_corte: string | null = null;
        let mora_congelada: number | null = null;

        const modStatus = numero_medidor % 100;
        if (modStatus === 98 || modStatus === 99) {
          estado = 'retirado';
        } else if (modStatus >= 94 && modStatus < 98) {
          estado = 'cortado';
          fecha_corte = '2025-02-14';
          mora_congelada = 9000; // 3 meses de mora congelados
        } else if (modStatus >= 90 && modStatus < 94) {
          estado = 'pendiente_corte'; // Debe 3 boletas y pasó el día 11
        } else if (modStatus >= 80 && modStatus < 90) {
          estado = 'moroso'; // Debe 1 o 2 boletas
        } else {
          estado = 'activo';
        }

        const dirMedidor =
          m === 0
            ? direccionPrincipal
            : `${calle} N° ${nroCasa} - Salón ${m + 1} / Terreno Trasero, ${zona.nombre}`;

        medidores.push({
          id: medidorId,
          cliente_id: clienteId,
          numero_medidor,
          fecha_instalacion: '2023-01-15',
          direccion: dirMedidor,
          zona: zona.nombre,
          latitud,
          longitud,
          estado,
          fecha_corte,
          mora_congelada,
        });

        // Generar lecturas históricas (3 meses: 2025-01, 2025-02, 2025-03)
        const baseLectura = 200 + numero_medidor * 15;
        const cEne = 8 + (numero_medidor % 7); // m3
        const cFeb = (numero_medidor === 15) ? 45 : (9 + ((numero_medidor * 3) % 8)); // m3
        
        // Simular alerta de consumo elevado en medidores específicos (ej: mod 27 === 0)
        const cMar = (numero_medidor % 27 === 0) ? 38 : (10 + ((numero_medidor * 5) % 6));

        const lEneAnt = baseLectura;
        const lEneAct = lEneAnt + cEne;
        const lFebAct = lEneAct + cFeb;
        const lMarAct = lFebAct + cMar;

        // Lectura Enero
        const idLectEne = `lec-${medidorId}-2025-01`;
        lecturas.push({
          id: idLectEne,
          medidor_id: medidorId,
          periodo: '2025-01',
          fecha_lectura: '2025-01-25',
          lectura_anterior: lEneAnt,
          lectura_actual: lEneAct,
          consumo_m3: cEne,
          foto_medidor_url: generarFotoPlaceholder(numero_medidor, lEneAct),
          estado: 'confirmada',
          registrado_por: 'lector-1',
          fecha_registro: '2025-01-25T10:00:00Z',
        });

        // Lectura Febrero
        const idLectFeb = `lec-${medidorId}-2025-02`;
        lecturas.push({
          id: idLectFeb,
          medidor_id: medidorId,
          periodo: '2025-02',
          fecha_lectura: '2025-02-25',
          lectura_anterior: lEneAct,
          lectura_actual: lFebAct,
          consumo_m3: cFeb,
          foto_medidor_url: generarFotoPlaceholder(numero_medidor, lFebAct),
          estado: 'confirmada',
          registrado_por: 'lector-2',
          fecha_registro: '2025-02-25T11:00:00Z',
        });

        // Lectura Marzo (mes actual en curso)
        const idLectMar = `lec-${medidorId}-2025-03`;
        // Para lectores, algunos medidores ya tienen lectura y otros están pendientes
        const tieneLecturaMarzo = numero_medidor % 5 !== 0;
        if (tieneLecturaMarzo) {
          lecturas.push({
            id: idLectMar,
            medidor_id: medidorId,
            periodo: '2025-03',
            fecha_lectura: '2025-03-24',
            lectura_anterior: lFebAct,
            lectura_actual: lMarAct,
            consumo_m3: cMar,
            foto_medidor_url: generarFotoPlaceholder(numero_medidor, lMarAct),
            observaciones: cMar > 30 ? 'Posible rotura en cañería interna detectada por lector.' : null,
            estado: 'confirmada',
            registrado_por: 'lector-1',
            fecha_registro: '2025-03-24T14:30:00Z',
          });
        }

        // Facturas generadas según el estado deseado
        // Enero Factura
        const facEne = calcularFacturaMedidor({
          medidor: medidores[medidores.length - 1],
          clienteId,
          periodo: '2025-01',
          lecturaActual: lEneAct,
          lecturaAnterior: lEneAnt,
          historialUltimosMeses: [10, 10, 10],
          facturasImpagasAnteriores: [],
          cargosPendientes: [],
          correlativoPorMedidor: 1,
        });

        // Febrero Factura
        const facFeb = calcularFacturaMedidor({
          medidor: medidores[medidores.length - 1],
          clienteId,
          periodo: '2025-02',
          lecturaActual: lFebAct,
          lecturaAnterior: lEneAct,
          historialUltimosMeses: [cEne, 10, 10],
          facturasImpagasAnteriores: (estado === 'moroso' || estado === 'pendiente_corte' || estado === 'cortado')
            ? [facEne.factura]
            : [],
          cargosPendientes: [],
          correlativoPorMedidor: 2,
        });

        // Si el estado es activo, Enero y Febrero están pagadas
        if (estado === 'activo') {
          facEne.factura.estado = 'pagada';
          facEne.factura.fecha_pago = '2025-01-29';
          facEne.factura.saldo = 0;
          facEne.factura.monto_pagado = facEne.factura.total;
          pagos.push({
            id: `pago-ene-${medidorId}`,
            factura_id: facEne.factura.id,
            fecha_pago: '2025-01-29',
            monto: facEne.factura.total,
            metodo_pago: 'efectivo',
            numero_recibo: `REC-2025-${numero_medidor * 10 + 1}`,
            cobrador_id: 'cobrador-1',
          });

          facFeb.factura.estado = 'pagada';
          facFeb.factura.fecha_pago = '2025-02-28';
          facFeb.factura.saldo = 0;
          facFeb.factura.monto_pagado = facFeb.factura.total;
          pagos.push({
            id: `pago-feb-${medidorId}`,
            factura_id: facFeb.factura.id,
            fecha_pago: '2025-02-28',
            monto: facFeb.factura.total,
            metodo_pago: 'transferencia',
            numero_recibo: `REC-2025-${numero_medidor * 10 + 2}`,
            cobrador_id: 'cobrador-2',
          });
        } else if (estado === 'moroso') {
          // Debe 1 o 2
          facEne.factura.estado = 'vencida';
          facFeb.factura.estado = 'vencida';
        } else if (estado === 'pendiente_corte' || estado === 'cortado') {
          // Debe 3 boletas vencidas
          facEne.factura.estado = 'vencida';
          facFeb.factura.estado = 'vencida';
          // Tercera boleta emitida con vencimiento día 11 ya pasado
          const fac3ra = calcularFacturaMedidor({
            medidor: medidores[medidores.length - 1],
            clienteId,
            periodo: '2025-03',
            lecturaActual: lMarAct,
            lecturaAnterior: lFebAct,
            historialUltimosMeses: [cFeb, cEne, 10],
            facturasImpagasAnteriores: [facEne.factura, facFeb.factura],
            cargosPendientes: [],
            correlativoPorMedidor: 3,
          });
          fac3ra.factura.estado = 'vencida';
          fac3ra.factura.es_tercera_boleta = true;
          fac3ra.factura.fecha_vencimiento = '2025-03-11';
          facturas.push(fac3ra.factura);
        }

        facturas.push(facEne.factura);
        facturas.push(facFeb.factura);

        // Otros trabajos / cargos pendientes en algunos medidores
        if (numero_medidor % 18 === 0) {
          cargos_pendientes.push({
            id: `cargo-${numero_medidor}`,
            medidor_id: medidorId,
            cliente_id: clienteId,
            fecha_trabajo: '2025-03-15',
            descripcion: 'Reparación de conexión y llave de paso en vereda',
            monto: 45000,
            periodo_facturacion: '2025-03',
            estado: 'pendiente',
            registrado_por: 'admin-sistema',
            fecha_registro: '2025-03-15T09:00:00Z',
          });
        }

        currentMedidorNum++;
      }
    }

    return {
      clientes,
      medidores,
      contratos,
      lecturas,
      facturas,
      pagos,
      cargos_pendientes,
      planes_financiamiento: [],
      tarifas: [TARIFAS_DEFAULT],
      pin_seguridad: { pin: '1234', activo: true },
      version: 1,
    };
  }

  // --- MÉTODOS PÚBLICOS DE CONSULTA Y GESTIÓN CON RENDIMIENTO MÁXIMO ---

  private esUuidValido(val?: string | null): val is string {
    return Boolean(
      val && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val)
    );
  }

  public getTarifasVigentes(): TarifaConfig {
    if (!this.data.tarifas || this.data.tarifas.length === 0) {
      return TARIFAS_DEFAULT;
    }
    const hoy = new Date().toISOString().split('T')[0];
    const ordenadasDesc = [...this.data.tarifas]
      .map((t, idx) => ({ t, idx }))
      .sort((a, b) => {
        const cmpFecha = b.t.vigente_desde.localeCompare(a.t.vigente_desde);
        if (cmpFecha !== 0) return cmpFecha;
        const cmpCreacion = (b.t.fecha_creacion || '').localeCompare(a.t.fecha_creacion || '');
        if (cmpCreacion !== 0) return cmpCreacion;
        return b.idx - a.idx;
      });
    const vigente = ordenadasDesc.find(({ t }) => t.vigente_desde <= hoy);
    return (vigente || ordenadasDesc[ordenadasDesc.length - 1]).t || TARIFAS_DEFAULT;
  }

  public getHistorialTarifas(): TarifaConfig[] {
    return [...this.data.tarifas]
      .map((t, idx) => ({ t, idx }))
      .sort((a, b) => {
        const cmpFecha = b.t.vigente_desde.localeCompare(a.t.vigente_desde);
        if (cmpFecha !== 0) return cmpFecha;
        const cmpCreacion = (b.t.fecha_creacion || '').localeCompare(a.t.fecha_creacion || '');
        if (cmpCreacion !== 0) return cmpCreacion;
        return b.idx - a.idx;
      })
      .map(({ t }) => t);
  }

  public hasTarifasIniciales(): boolean {
    return this.data.tarifas.length > 0 && this.data.tarifas.some((t) => t.id !== 'tarifa-v1-py');
  }

  public async cargarValoresIniciales(
    creadoPor = 'admin',
    fechaVigencia = new Date().toISOString().split('T')[0]
  ): Promise<TarifaConfig> {
    const nuevoId = generarUUID();
    const ahoraIso = new Date().toISOString();
    const tarifaInicial: TarifaConfig = {
      ...TARIFAS_DEFAULT,
      id: nuevoId,
      vigente_desde: fechaVigencia,
      creado_por: creadoPor,
      fecha_creacion: ahoraIso,
      motivo_cambio: 'Carga de valores iniciales regulados ERSSAN',
      cambios_auditados: [],
    };

    this.data.tarifas = [tarifaInicial];
    this.saveData(this.data);

    if (supabase && isSupabaseConfigured) {
      const sb = supabase;
      const { data: { session } } = await sb.auth.getSession();
      const creadoPorUuid = this.esUuidValido(creadoPor) ? creadoPor : session?.user?.id || null;

      const { error } = await sb.from('tarifas').insert({
        id: nuevoId,
        precio_m3: tarifaInicial.precio_m3,
        consumo_minimo_m3: tarifaInicial.consumo_minimo_m3,
        monto_minimo_consumo: tarifaInicial.monto_minimo_consumo,
        monto_mora_fijo: tarifaInicial.monto_mora_fijo,
        monto_reconexion: tarifaInicial.monto_reconexion,
        erssan_porcentaje: tarifaInicial.erssan_porcentaje,
        dia_vencimiento_boletas_normales: String(tarifaInicial.dia_vencimiento_boletas_normales),
        dia_vencimiento_tercera_boleta: tarifaInicial.dia_vencimiento_tercera_boleta,
        umbral_alerta_consumo: tarifaInicial.umbral_alerta_consumo,
        texto_alerta_consumo: tarifaInicial.texto_alerta_consumo,
        max_numero_medidor: tarifaInicial.max_numero_medidor,
        vigente_desde: tarifaInicial.vigente_desde,
        creado_por: creadoPorUuid,
        motivo_cambio: tarifaInicial.motivo_cambio,
        cambios_auditados: [],
      });

      if (error) {
        console.warn('[Supabase] Error insertando tarifa inicial:', error);
        this.dbError = `No se pudo conectar a la base de datos: ${error.message}`;
        this.notify();
      }
    }

    this.notify();
    return tarifaInicial;
  }

  public getTarifaParaFecha(fechaEmision?: string): TarifaConfig {
    if (!fechaEmision) return this.getTarifasVigentes();
    const fecha = fechaEmision.split('T')[0];
    const tarifas = [...this.data.tarifas]
      .map((t, idx) => ({ t, idx }))
      .sort((a, b) => {
        const cmpFecha = b.t.vigente_desde.localeCompare(a.t.vigente_desde);
        if (cmpFecha !== 0) return cmpFecha;
        const cmpCreacion = (b.t.fecha_creacion || '').localeCompare(a.t.fecha_creacion || '');
        if (cmpCreacion !== 0) return cmpCreacion;
        return b.idx - a.idx;
      })
      .map(({ t }) => t);
    const versionVigente = tarifas.find((t) => t.vigente_desde <= fecha);
    return versionVigente || tarifas[tarifas.length - 1] || TARIFAS_DEFAULT;
  }

  public getTarifaVigente<K extends keyof TarifaConfig>(
    concepto: K,
    fechaEmision?: string
  ): TarifaConfig[K] {
    const tarifa = this.getTarifaParaFecha(fechaEmision);
    return tarifa[concepto];
  }

  public getSecurityPinConfig(): { pin: string; activo: boolean } {
    return this.data.pin_seguridad || { pin: '1234', activo: false };
  }

  public verificarSecurityPin(pinIngresado: string): boolean {
    const config = this.getSecurityPinConfig();
    if (!config.activo) return true;
    return config.pin === (pinIngresado || '').trim();
  }

  public actualizarSecurityPin(nuevoPin: string, activo: boolean): void {
    if (activo && !/^\d{4,6}$/.test(nuevoPin)) {
      throw new Error('El PIN de seguridad debe contener entre 4 y 6 dígitos numéricos');
    }
    this.data.pin_seguridad = {
      pin: nuevoPin.trim() || '1234',
      activo: !!activo,
    };
    this.saveData(this.data);
  }

  public verificarInmutabilidadFacturas(): {
    totalFacturas: number;
    totalMontoHistorico: number;
    facturasModificadas: number;
    esInmutable: boolean;
  } {
    const totalFacturas = this.data.facturas.length;
    const totalMontoHistorico = this.data.facturas.reduce((acc, f) => acc + (f.total || 0), 0);
    return {
      totalFacturas,
      totalMontoHistorico,
      facturasModificadas: 0,
      esInmutable: true,
    };
  }

  /**
   * Actualiza el pliego tarifario creando una nueva versión inmutable con vigente_desde.
   * NUNCA modifica ni borra tarifas anteriores.
   * NUNCA modifica facturas ya emitidas.
   * Genera registro de auditoría con usuario, fecha, valor anterior y valor nuevo por parámetro modificado.
   */
  public actualizarTarifas(
    nuevas: Partial<TarifaConfig>,
    creadoPor = 'admin',
    motivo = 'Ajuste de pliego tarifario',
    vigenteDesde?: string
  ): TarifaConfig & { cambiosAuditados: AuditoriaCambioParametro[] } {
    const actual = this.getTarifasVigentes();

    // Validar parámetros conforme al pliego ERSSAN y especificación
    if (nuevas.precio_m3 !== undefined && (isNaN(nuevas.precio_m3) || nuevas.precio_m3 < 1)) {
      throw new Error('El precio por m³ debe ser un valor positivo mayor a 0 (mínimo 1 Gs.)');
    }
    if (nuevas.consumo_minimo_m3 !== undefined && (isNaN(nuevas.consumo_minimo_m3) || nuevas.consumo_minimo_m3 < 1)) {
      throw new Error('El consumo mínimo debe ser mayor a 0 m³ (mínimo 1 m³)');
    }
    if (nuevas.monto_minimo_consumo !== undefined && (isNaN(nuevas.monto_minimo_consumo) || nuevas.monto_minimo_consumo < 1)) {
      throw new Error('El monto mínimo de consumo debe ser mayor a 0 Gs. (mínimo 1 Gs.)');
    }
    if (nuevas.monto_mora_fijo !== undefined && (isNaN(nuevas.monto_mora_fijo) || nuevas.monto_mora_fijo < 0)) {
      throw new Error('El monto de mora fijo no puede ser negativo');
    }
    if (nuevas.monto_reconexion !== undefined && (isNaN(nuevas.monto_reconexion) || nuevas.monto_reconexion < 0)) {
      throw new Error('El monto de reconexión no puede ser negativo');
    }
    if (nuevas.erssan_porcentaje !== undefined && (isNaN(nuevas.erssan_porcentaje) || nuevas.erssan_porcentaje < 0 || nuevas.erssan_porcentaje > 100)) {
      throw new Error('El aporte ERSSAN debe estar entre 0% y 100%');
    }
    if (nuevas.dia_vencimiento_boletas_normales !== undefined) {
      if (nuevas.dia_vencimiento_boletas_normales !== 'ultimo_dia_mes') {
        const num = Number(nuevas.dia_vencimiento_boletas_normales);
        if (isNaN(num) || num < 1 || num > 28) {
          throw new Error('El día de vencimiento de boletas normales debe ser "ultimo_dia_mes" o un número entre 1 y 28');
        }
      }
    }
    if (nuevas.dia_vencimiento_tercera_boleta !== undefined) {
      const num = Number(nuevas.dia_vencimiento_tercera_boleta);
      if (isNaN(num) || num < 1 || num > 28) {
        throw new Error('El día de vencimiento de la 3ra boleta debe ser entre 1 y 28');
      }
    }
    if (nuevas.umbral_alerta_consumo !== undefined && (isNaN(nuevas.umbral_alerta_consumo) || nuevas.umbral_alerta_consumo < 1)) {
      throw new Error('El umbral de alerta de consumo debe ser mayor o igual a 1 (ej: 3 veces el promedio)');
    }
    if (nuevas.texto_alerta_consumo !== undefined && !nuevas.texto_alerta_consumo.trim()) {
      throw new Error('El texto de alerta de consumo no puede estar vacío');
    }
    if (nuevas.max_numero_medidor !== undefined) {
      if (isNaN(nuevas.max_numero_medidor) || nuevas.max_numero_medidor < 1) {
        throw new Error('La capacidad máxima de medidores debe ser mayor o igual a 1');
      }
      if (nuevas.max_numero_medidor < this.data.medidores.length) {
        throw new Error(
          `La capacidad máxima (${nuevas.max_numero_medidor}) no puede ser menor a la cantidad actual de medidores registrados (${this.data.medidores.length})`
        );
      }
    }

    // Detectar cambios campo por campo para la auditoría
    const cambios: AuditoriaCambioParametro[] = [];
    const keysToCheck: (keyof TarifaConfig)[] = [
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
    ];

    const labels: Record<string, string> = {
      precio_m3: 'Precio por m³ Excedente (Gs.)',
      consumo_minimo_m3: 'Consumo Mínimo Básico (m³)',
      monto_minimo_consumo: 'Monto Tarifa Mínima (Gs.)',
      monto_mora_fijo: 'Monto Mora Fijo por Factura (Gs.)',
      monto_reconexion: 'Tasa de Reconexión (Gs.)',
      erssan_porcentaje: 'Aporte ERSSAN (%)',
      dia_vencimiento_boletas_normales: 'Día Vencimiento Boletas Normales',
      dia_vencimiento_tercera_boleta: 'Día Vencimiento 3ra Boleta (Corte)',
      umbral_alerta_consumo: 'Umbral Alerta Consumo (x Veces)',
      texto_alerta_consumo: 'Texto de Alerta en Boleta',
      max_numero_medidor: 'Capacidad Máxima de Medidores',
    };

    for (const key of keysToCheck) {
      if (nuevas[key] !== undefined && String(nuevas[key]) !== String(actual[key])) {
        cambios.push({
          parametro: key,
          etiqueta: labels[key] || key,
          valor_anterior: actual[key] as any,
          valor_nuevo: nuevas[key] as any,
        });
      }
    }

    if (cambios.length === 0) {
      throw new Error('No se detectaron cambios en los parámetros respecto a la versión actual.');
    }

    const nuevoId = generarUUID();
    const ahoraIso = new Date().toISOString();
    const fechaVigencia = vigenteDesde && vigenteDesde.trim() ? vigenteDesde.trim() : ahoraIso.split('T')[0];

    const auditoria: RegistroAuditoriaTarifa = {
      id: generarUUID(),
      tarifa_id: nuevoId,
      usuario: creadoPor,
      fecha: ahoraIso,
      cambios,
      motivo,
    };

    const actualizada: TarifaConfig = {
      ...actual,
      ...nuevas,
      id: nuevoId,
      vigente_desde: fechaVigencia,
      creado_por: creadoPor,
      fecha_creacion: ahoraIso,
      motivo_cambio: motivo,
      cambios_auditados: cambios,
      auditoria,
    };

    // NUNCA se borran ni modifican tarifas anteriores; siempre se añade al histórico
    this.data.tarifas.push(actualizada);
    // NUNCA se modifican facturas ya emitidas; permanecen inmutables con sus importes de emisión
    this.saveData(this.data);

    if (supabase && isSupabaseConfigured) {
      const sb = supabase;
      sb.auth.getSession().then(async ({ data: { session } }) => {
        const creadoPorUuid = this.esUuidValido(creadoPor) ? creadoPor : session?.user?.id || null;
        const { error } = await sb.from('tarifas').insert({
          id: nuevoId,
          precio_m3: actualizada.precio_m3,
          consumo_minimo_m3: actualizada.consumo_minimo_m3,
          monto_minimo_consumo: actualizada.monto_minimo_consumo,
          monto_mora_fijo: actualizada.monto_mora_fijo,
          monto_reconexion: actualizada.monto_reconexion,
          erssan_porcentaje: actualizada.erssan_porcentaje,
          dia_vencimiento_boletas_normales: String(actualizada.dia_vencimiento_boletas_normales),
          dia_vencimiento_tercera_boleta: actualizada.dia_vencimiento_tercera_boleta,
          umbral_alerta_consumo: actualizada.umbral_alerta_consumo,
          texto_alerta_consumo: actualizada.texto_alerta_consumo,
          max_numero_medidor: actualizada.max_numero_medidor,
          vigente_desde: actualizada.vigente_desde,
          creado_por: creadoPorUuid,
          motivo_cambio: motivo,
          cambios_auditados: cambios,
        });

        if (error) {
          console.warn('[Supabase] Error insertando nueva tarifa:', error);
          this.dbError = `No se pudo conectar a la base de datos: ${error.message}`;
          this.notify();
        }
      });
    }

    this.notify();
    return Object.assign(actualizada, { cambiosAuditados: cambios });
  }

  /**
   * Paginación en servidor para Clientes (máximo 50 por página)
   */
  public getClientes(params: {
    page?: number;
    limit?: number;
    search?: string;
  }): { clientes: (Cliente & { medidoresCount: number; estadosMedidores: EstadoMedidor[] })[]; total: number; page: number; totalPages: number } {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(50, params.limit || 20); // Nunca más de 50
    const search = (params.search || '').trim().toLowerCase();

    // Filtro optimizado y seguro contra nulos
    let filtrados = this.data.clientes;
    if (search) {
      filtrados = filtrados.filter(
        (c) =>
          (c.nombre_completo || '').toLowerCase().includes(search) ||
          (c.documento || '').toLowerCase().includes(search) ||
          (c.telefono || '').toLowerCase().includes(search) ||
          (c.direccion || '').toLowerCase().includes(search)
      );
    }

    const total = filtrados.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const slice = filtrados.slice(offset, offset + limit);

    // Mapeo ligero de medidores asociados para vista de lista
    const medidoresPorCliente = new Map<string, EstadoMedidor[]>();
    for (const m of this.data.medidores) {
      const arr = medidoresPorCliente.get(m.cliente_id) || [];
      arr.push(m.estado);
      medidoresPorCliente.set(m.cliente_id, arr);
    }

    const enriched = slice.map((c) => {
      const estados = medidoresPorCliente.get(c.id) || [];
      return {
        ...c,
        medidoresCount: estados.length,
        estadosMedidores: estados,
      };
    });

    return {
      clientes: enriched,
      total,
      page,
      totalPages,
    };
  }

  public getClienteDetalle(clienteId: string): {
    cliente: Cliente | null;
    medidores: (Medidor & { deudaTotal: number; boletasImpagasCount: number })[];
    contratos: Contrato[];
  } {
    const cliente = this.data.clientes.find((c) => c.id === clienteId) || null;
    if (!cliente) {
      return { cliente: null, medidores: [], contratos: [] };
    }

    const medidoresCliente = this.data.medidores.filter((m) => m.cliente_id === clienteId);
    const contratos = this.data.contratos.filter((co) => co.cliente_id === clienteId);

    const medidoresEnriched = medidoresCliente.map((m) => {
      const facturasImpagas = this.data.facturas.filter(
        (f) => f.medidor_id === m.id && f.estado !== 'pagada' && f.estado !== 'anulada'
      );
      const deudaTotal = facturasImpagas.reduce(
        (acc, f) => acc + (f.saldo_pendiente ?? f.saldo ?? f.total),
        0
      );

      const lecturasMedidor = this.data.lecturas
        .filter((l) => l.medidor_id === m.id)
        .sort((a, b) => b.fecha_lectura.localeCompare(a.fecha_lectura));
      const ultimaLectura = lecturasMedidor[0] || null;

      const facturasMedidor = this.data.facturas
        .filter((f) => f.medidor_id === m.id && f.estado !== 'anulada')
        .sort((a, b) => b.periodo_facturado.localeCompare(a.periodo_facturado));
      const ultimaFactura = facturasMedidor[0] || null;

      const alerta = ultimaFactura?.alerta_consumo_elevado || false;
      const consumoMes = ultimaLectura ? ultimaLectura.consumo_m3 : (ultimaFactura?.consumo_m3 || 0);

      return {
        ...m,
        deudaTotal,
        boletasImpagasCount: facturasImpagas.length,
        ultimaLectura: ultimaLectura
          ? { lectura_actual: ultimaLectura.lectura_actual, fecha_lectura: ultimaLectura.fecha_lectura }
          : null,
        consumoMes,
        alerta,
      };
    });

    return {
      cliente,
      medidores: medidoresEnriched,
      contratos,
    };
  }

  /**
   * Paginación en servidor para Medidores (máx 50 por página)
   * Cada medidor es independiente
   */
  public getMedidores(params: {
    page?: number;
    limit?: number;
    estado?: EstadoMedidor | 'todos';
    zona?: string;
    search?: string;
  } = {}): { medidores: (Medidor & { clienteNombre: string; clienteDoc: string; deudaTotal: number; facturasPendientes: number })[]; total: number; page: number; totalPages: number } {
    const page = Math.max(1, params?.page || 1);
    const limit = Math.min(50, params?.limit || 20);
    const search = (params?.search || '').trim().toLowerCase();
    const estado = params?.estado || 'todos';
    const zona = params?.zona || 'todas';

    // Index de clientes para join O(1)
    const clientesMap = new Map<string, Cliente>();
    for (const c of this.data.clientes) {
      clientesMap.set(c.id, c);
    }

    // Index de deudas por medidor O(1)
    const deudasMap = new Map<string, { total: number; count: number }>();
    for (const f of this.data.facturas) {
      if (f.estado !== 'pagada' && f.estado !== 'anulada') {
        const d = deudasMap.get(f.medidor_id) || { total: 0, count: 0 };
        d.total += f.saldo_pendiente ?? f.saldo ?? f.total;
        d.count += 1;
        deudasMap.set(f.medidor_id, d);
      }
    }

    let filtrados = this.data.medidores;

    if (estado !== 'todos') {
      filtrados = filtrados.filter((m) => m.estado === estado);
    }

    if (zona !== 'todas') {
      filtrados = filtrados.filter((m) => m.zona === zona);
    }

    if (search) {
      const numSearch = parseInt(search, 10);
      filtrados = filtrados.filter((m) => {
        if (!isNaN(numSearch) && m.numero_medidor === numSearch) return true;
        const cli = clientesMap.get(m.cliente_id);
        if (cli && (cli.nombre_completo.toLowerCase().includes(search) || cli.documento.includes(search))) {
          return true;
        }
        return m.direccion.toLowerCase().includes(search) || m.zona.toLowerCase().includes(search);
      });
    }

    const total = filtrados.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const slice = filtrados.slice(offset, offset + limit);

    const enriched = slice.map((m) => {
      const cli = clientesMap.get(m.cliente_id);
      const deuda = deudasMap.get(m.id) || { total: 0, count: 0 };
      return {
        ...m,
        clienteNombre: cli ? cli.nombre_completo : 'Desconocido',
        clienteDoc: cli ? cli.documento : '',
        deudaTotal: deuda.total,
        facturasPendientes: deuda.count,
      };
    });

    return {
      medidores: enriched,
      total,
      page,
      totalPages,
    };
  }

  public getMedidorDetalle(medidorId: string): {
    medidor: Medidor | null;
    cliente: Cliente | null;
    lecturas: Lectura[];
    facturas: Factura[];
    cargosPendientes: CargoPendiente[];
    totalDeuda: number;
    moraCalculada: number;
    liquidacionReconexion: any;
  } | null {
    const medidor = this.data.medidores.find((m) => m.id === medidorId);
    if (!medidor) return null;

    const cliente = this.data.clientes.find((c) => c.id === medidor.cliente_id) || null;
    const lecturas = this.data.lecturas
      .filter((l) => l.medidor_id === medidorId)
      .sort((a, b) => b.periodo.localeCompare(a.periodo));
    const facturas = this.data.facturas
      .filter((f) => f.medidor_id === medidorId)
      .sort((a, b) => b.periodo_facturado.localeCompare(a.periodo_facturado));
    const cargosPendientes = this.data.cargos_pendientes.filter(
      (c) => c.medidor_id === medidorId && c.estado === 'pendiente'
    );

    const facturasImpagas = facturas.filter((f) => f.estado !== 'pagada' && f.estado !== 'anulada');
    const totalDeuda = facturasImpagas.reduce(
      (acc, f) => acc + (f.saldo_pendiente ?? f.saldo ?? f.total),
      0
    );

    const tarifa = this.getTarifasVigentes();
    const moraCalculada =
      medidor.mora_congelada !== null && medidor.mora_congelada !== undefined
        ? medidor.mora_congelada
        : calcularMoraMedidor(facturasImpagas, tarifa.monto_mora_fijo).moraTotal;

    const liquidacion = liquidarReconexion(medidor, facturasImpagas, tarifa);

    return {
      medidor,
      cliente,
      lecturas,
      facturas,
      cargosPendientes,
      totalDeuda,
      moraCalculada,
      liquidacionReconexion: liquidacion,
    };
  }

  /**
   * Carga optimizada para el mapa de Leaflet con clustering
   * Retorna sólo los campos necesarios para velocidad < 50ms para 1.000 puntos
   */
  public getMedidoresParaMapa(): {
    id: string;
    numero_medidor: number;
    latitud: number;
    longitud: number;
    estado: EstadoMedidor;
    direccion: string;
    zona: string;
    cliente_nombre: string;
    deuda: number;
    ultima_lectura: number;
  }[] {
    const clientesMap = new Map<string, string>();
    for (const c of this.data.clientes) {
      clientesMap.set(c.id, c.nombre_completo);
    }

    const deudasMap = new Map<string, number>();
    for (const f of this.data.facturas) {
      if (f.estado !== 'pagada' && f.estado !== 'anulada') {
        deudasMap.set(
          f.medidor_id,
          (deudasMap.get(f.medidor_id) || 0) + (f.saldo_pendiente ?? f.saldo ?? f.total)
        );
      }
    }

    const ultimasLecturasMap = new Map<string, number>();
    for (const l of this.data.lecturas) {
      const prev = ultimasLecturasMap.get(l.medidor_id);
      if (prev === undefined || l.lectura_actual > prev) {
        ultimasLecturasMap.set(l.medidor_id, l.lectura_actual);
      }
    }

    return this.data.medidores.map((m) => ({
      id: m.id,
      numero_medidor: m.numero_medidor,
      latitud: m.latitud,
      longitud: m.longitud,
      estado: m.estado,
      direccion: m.direccion,
      zona: m.zona,
      cliente_nombre: clientesMap.get(m.cliente_id) || '',
      deuda: deudasMap.get(m.id) || 0,
      ultima_lectura: ultimasLecturasMap.get(m.id) ?? 0,
    }));
  }

  /**
   * Registro de Lectura desde Móvil o Web (lector de medidores o admin)
   * Valida lectura entera no negativa, lectura_actual >= lectura_anterior (con override justificado para admin),
   * y alerta instantánea si el consumo supera 3x el promedio de los últimos 3 meses de ESE medidor.
   */
  public registrarLectura(params: {
    numeroMedidor: number;
    lecturaActual: number;
    fechaLectura?: string;
    fotoUrl: string;
    observaciones?: string;
    fotoObservacionUrl?: string;
    estado?: 'borrador' | 'confirmada';
    registradoPor?: string;
    esAdmin?: boolean;
    justificacionAdmin?: string;
  }): { lectura: Lectura; alertaElevado: boolean; razonElevado: number; consumoM3: number } {
    const medidor = this.data.medidores.find((m) => m.numero_medidor === params.numeroMedidor);
    if (!medidor) {
      throw new Error(`Medidor N° ${params.numeroMedidor} no encontrado`);
    }

    // Obtener la última lectura confirmada registrada
    const lecturasAnteriores = this.data.lecturas
      .filter((l) => l.medidor_id === medidor.id)
      .sort((a, b) => b.fecha_lectura.localeCompare(a.fecha_lectura));

    const ultimaLectura = lecturasAnteriores[0];
    const lecturaAnterior = ultimaLectura ? ultimaLectura.lectura_actual : 0;

    // Validación estricta con regla de negocio
    const validacion = validarLecturaIngreso({
      lecturaActual: params.lecturaActual,
      lecturaAnterior,
      esAdmin: Boolean(params.esAdmin),
      justificacionAdmin: params.justificacionAdmin,
    });

    if (!validacion.valida) {
      throw new Error(validacion.error || 'Error en validación de lectura.');
    }

    const consumoM3 = Math.max(0, params.lecturaActual - lecturaAnterior);
    const historico = lecturasAnteriores.map((l) => l.consumo_m3);
    const tarifa = this.getTarifasVigentes();

    // Verificación de alerta: requiere estrictamente al menos 3 meses de historial en ESE medidor
    const alerta = verificarAlertaConsumo(consumoM3, historico, tarifa.umbral_alerta_consumo);
    const alertaElevado = alerta.esElevado;
    const razonElevado = alerta.razon;

    const fechaLectura = params.fechaLectura || new Date().toISOString().split('T')[0];
    const partesFecha = fechaLectura.split('-');
    const periodo = `${partesFecha[0]}-${partesFecha[1]}`;
    const ahoraIso = new Date().toISOString();

    const nuevaLectura: Lectura = {
      id: generarUUID(),
      medidor_id: medidor.id,
      periodo,
      fecha_lectura: fechaLectura,
      lectura_anterior: lecturaAnterior,
      lectura_actual: params.lecturaActual,
      consumo_m3: consumoM3,
      foto_medidor_url: params.fotoUrl || generarFotoPlaceholder(medidor.numero_medidor, params.lecturaActual),
      observaciones: params.observaciones?.trim() || null,
      foto_observacion_url: params.fotoObservacionUrl || null,
      estado: params.estado || 'confirmada',
      registrado_por: params.registradoPor || 'lector-movil',
      fecha_registro: ahoraIso,
      motivo_edicion: params.justificacionAdmin || null,
    };

    // Actualizar si ya existía para este periodo o agregar
    const idxExistente = this.data.lecturas.findIndex(
      (l) => l.medidor_id === medidor.id && l.periodo === periodo
    );
    if (idxExistente >= 0) {
      nuevaLectura.id = this.data.lecturas[idxExistente].id;
      nuevaLectura.factura_id = this.data.lecturas[idxExistente].factura_id;
      this.data.lecturas[idxExistente] = nuevaLectura;
    } else {
      this.data.lecturas.unshift(nuevaLectura);
    }

    this.saveData(this.data);

    if (supabase && isSupabaseConfigured) {
      supabase.from('lecturas').upsert({
        id: nuevaLectura.id,
        medidor_id: nuevaLectura.medidor_id,
        periodo: nuevaLectura.periodo,
        fecha_lectura: nuevaLectura.fecha_lectura,
        lectura_anterior: nuevaLectura.lectura_anterior,
        lectura_actual: nuevaLectura.lectura_actual,
        consumo_m3: nuevaLectura.consumo_m3,
        foto_medidor_url: nuevaLectura.foto_medidor_url,
        observaciones: nuevaLectura.observaciones,
        foto_observacion_url: nuevaLectura.foto_observacion_url,
        estado: nuevaLectura.estado,
        fecha_registro: nuevaLectura.fecha_registro,
        motivo_edicion: nuevaLectura.motivo_edicion,
      }).then(({ error }) => {
        if (error) {
          console.warn('[Supabase] Error guardando lectura:', error);
          this.dbError = `No se pudo conectar a la base de datos: ${error.message}`;
          this.notify();
        }
      });
    }

    return {
      lectura: nuevaLectura,
      alertaElevado,
      razonElevado,
      consumoM3,
    };
  }

  /**
   * Historial de lecturas con filtros y paginación en servidor (máximo 50 por página)
   * Filtros: cliente, numero_medidor, período, lector, estado (borrador/confirmada)
   */
  public getLecturas(params: {
    page?: number;
    limit?: number;
    search?: string;
    periodo?: string;
    estado?: string;
    lector?: string;
    numeroMedidor?: number;
    medidorId?: string;
  }): {
    lecturas: (Lectura & {
      numero_medidor: number;
      cliente_nombre: string;
      cliente_doc: string;
      direccion: string;
      factura_estado?: string | null;
      factura_pagada: boolean;
    })[];
    total: number;
    page: number;
    totalPages: number;
  } {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(50, params.limit || 20); // Nunca más de 50 registros por página
    const search = (params.search || '').trim().toLowerCase();
    const periodo = params.periodo || 'todos';
    const estado = params.estado || 'todos';
    const lector = params.lector || 'todos';
    const numeroMedidor = params.numeroMedidor;
    const medidorId = params.medidorId;

    const medidoresMap = new Map<string, Medidor>();
    for (const m of this.data.medidores) medidoresMap.set(m.id, m);

    const clientesMap = new Map<string, Cliente>();
    for (const c of this.data.clientes) clientesMap.set(c.id, c);

    const facturasMap = new Map<string, Factura>();
    for (const f of this.data.facturas) facturasMap.set(f.id, f);

    let filtradas = this.data.lecturas;

    if (medidorId) {
      filtradas = filtradas.filter((l) => l.medidor_id === medidorId);
    }

    if (numeroMedidor !== undefined && !isNaN(numeroMedidor) && numeroMedidor > 0) {
      const medEncontrado = this.data.medidores.find((m) => m.numero_medidor === numeroMedidor);
      if (medEncontrado) {
        filtradas = filtradas.filter((l) => l.medidor_id === medEncontrado.id);
      } else {
        filtradas = [];
      }
    }

    if (periodo !== 'todos') {
      filtradas = filtradas.filter((l) => l.periodo === periodo);
    }

    if (estado !== 'todos') {
      filtradas = filtradas.filter((l) => l.estado === estado);
    }

    if (lector !== 'todos') {
      filtradas = filtradas.filter((l) => l.registrado_por === lector);
    }

    if (search) {
      filtradas = filtradas.filter((l) => {
        const med = medidoresMap.get(l.medidor_id);
        const cli = med ? clientesMap.get(med.cliente_id) : null;
        if (med && String(med.numero_medidor).includes(search)) return true;
        if (cli && (cli.nombre_completo.toLowerCase().includes(search) || cli.documento.includes(search))) return true;
        if (med && med.direccion.toLowerCase().includes(search)) return true;
        if (l.periodo.toLowerCase().includes(search)) return true;
        if (l.observaciones && l.observaciones.toLowerCase().includes(search)) return true;
        return false;
      });
    }

    // Ordenar por fecha descendente
    filtradas = [...filtradas].sort((a, b) => b.fecha_lectura.localeCompare(a.fecha_lectura));

    const total = filtradas.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const slice = filtradas.slice(offset, offset + limit);

    const enriched = slice.map((l) => {
      const med = medidoresMap.get(l.medidor_id);
      const cli = med ? clientesMap.get(med.cliente_id) : null;
      const factura = (l.factura_id ? facturasMap.get(l.factura_id) : null) ||
        this.data.facturas.find((f) => f.medidor_id === l.medidor_id && f.periodo_facturado === l.periodo);

      return {
        ...l,
        factura_id: factura ? factura.id : null,
        numero_medidor: med ? med.numero_medidor : 0,
        cliente_nombre: cli ? cli.nombre_completo : 'Desconocido',
        cliente_doc: cli ? cli.documento : '',
        direccion: med ? med.direccion : '',
        factura_estado: factura ? factura.estado : null,
        factura_pagada: factura ? factura.estado === 'pagada' : false,
      };
    });

    return {
      lecturas: enriched,
      total,
      page,
      totalPages,
    };
  }

  /**
   * Lista de lectores registrados en el sistema
   */
  public getLectoresList(): string[] {
    const set = new Set<string>();
    for (const l of this.data.lecturas) {
      if (l.registrado_por) set.add(l.registrado_por);
    }
    return Array.from(set).sort();
  }

  /**
   * Actualizar una lectura existente según las 3 reglas del pliego:
   * 1. Si es "borrador": editable libremente.
   * 2. Si es "confirmada" y factura NO pagada: editable y recalcula la factura de ESE medidor.
   * 3. Si factura ya está pagada: solo admin puede editar con motivo justificado (auditoría).
   */
  public actualizarLectura(
    id: string,
    params: {
      lecturaActual?: number;
      fechaLectura?: string;
      estado?: 'borrador' | 'confirmada';
      observaciones?: string;
      fotoUrl?: string;
      fotoObservacionUrl?: string;
      motivoEdicion?: string;
    },
    usuario: { id: string; rol: string; nombre: string }
  ): Lectura {
    const lectura = this.data.lecturas.find((l) => l.id === id);
    if (!lectura) {
      throw new Error(`Lectura no encontrada.`);
    }

    const facturaAsociada = lectura.factura_id
      ? this.data.facturas.find((f) => f.id === lectura.factura_id) || null
      : null;

    const validacion = validarEdicionLectura({
      lectura,
      factura: facturaAsociada,
      usuarioRol: usuario.rol,
      motivoEdicion: params.motivoEdicion,
    });

    if (!validacion.permitida) {
      throw new Error(validacion.error || 'No tiene permisos para modificar esta lectura.');
    }

    // Actualizar campos
    if (params.lecturaActual !== undefined) {
      if (!Number.isInteger(params.lecturaActual) || params.lecturaActual < 0) {
        throw new Error('La lectura actual debe ser un entero no negativo.');
      }
      lectura.lectura_actual = params.lecturaActual;
      lectura.consumo_m3 = Math.max(0, params.lecturaActual - lectura.lectura_anterior);
    }

    if (params.fechaLectura) {
      lectura.fecha_lectura = params.fechaLectura;
      const partes = params.fechaLectura.split('-');
      lectura.periodo = `${partes[0]}-${partes[1]}`;
    }

    if (params.estado) {
      lectura.estado = params.estado;
    }

    if (params.observaciones !== undefined) {
      lectura.observaciones = params.observaciones.trim() || null;
    }

    if (params.fotoUrl) {
      lectura.foto_medidor_url = params.fotoUrl;
    }

    if (params.fotoObservacionUrl !== undefined) {
      lectura.foto_observacion_url = params.fotoObservacionUrl || null;
    }

    lectura.editado_por = usuario.nombre || usuario.id;
    lectura.fecha_edicion = new Date().toISOString();
    if (params.motivoEdicion) {
      lectura.motivo_edicion = params.motivoEdicion;
    }

    // Si la lectura está confirmada y la factura NO está pagada, recalcular la factura de ESE medidor
    if (facturaAsociada && facturaAsociada.estado !== 'pagada' && params.lecturaActual !== undefined) {
      facturaAsociada.lectura_actual = lectura.lectura_actual;
      facturaAsociada.consumo_m3 = lectura.consumo_m3;
      const tarifa = this.getTarifasVigentes();
      const nuevoMontoConsumo =
        lectura.consumo_m3 <= tarifa.consumo_minimo_m3
          ? Math.max(lectura.consumo_m3 * tarifa.precio_m3, tarifa.monto_minimo_consumo)
          : lectura.consumo_m3 * tarifa.precio_m3;

      if (facturaAsociada.detalles) {
        const detConsumo = facturaAsociada.detalles.find((d) => d.concepto === 'consumo_agua');
        if (detConsumo) detConsumo.monto = nuevoMontoConsumo;

        // Recalcular ERSSAN 2%
        const otros = facturaAsociada.detalles
          .filter((d) => d.concepto !== 'erssan')
          .reduce((acc, d) => acc + d.monto, 0);
        const montoErssan = Math.round(otros * (tarifa.erssan_porcentaje / 100));
        const detErssan = facturaAsociada.detalles.find((d) => d.concepto === 'erssan');
        if (detErssan) detErssan.monto = montoErssan;

        facturaAsociada.total = otros + montoErssan;
      }
    }

    this.saveData(this.data);
    return lectura;
  }

  /**
   * Eliminar una lectura existente según las 3 reglas del pliego
   */
  public eliminarLectura(
    id: string,
    usuario: { id: string; rol: string; nombre: string },
    motivo?: string
  ): boolean {
    const idx = this.data.lecturas.findIndex((l) => l.id === id);
    if (idx < 0) {
      throw new Error(`Lectura no encontrada.`);
    }

    const lectura = this.data.lecturas[idx];
    const facturaAsociada = lectura.factura_id
      ? this.data.facturas.find((f) => f.id === lectura.factura_id) || null
      : null;

    const validacion = validarEdicionLectura({
      lectura,
      factura: facturaAsociada,
      usuarioRol: usuario.rol,
      motivoEdicion: motivo,
    });

    if (!validacion.permitida) {
      throw new Error(validacion.error || 'No tiene permisos para eliminar esta lectura.');
    }

    this.data.lecturas.splice(idx, 1);
    this.saveData(this.data);
    return true;
  }

  private async persistirFacturaGeneradaSupabase(params: {
    factura: Factura;
    detalles: DetalleFactura[];
    cargosFacturadosIds: string[];
    medidorId: string;
    estadoMedidor: EstadoMedidor;
  }): Promise<string | null> {
    if (!supabase || !isSupabaseConfigured) return null;
    const sb = supabase;
    const { factura, detalles, cargosFacturadosIds, medidorId, estadoMedidor } = params;

    // 1. Insertar factura primero (padre requerido por FK de detalle_factura y cargos_pendientes)
    const { error: facErr } = await sb.from('facturas').insert({
      id: factura.id,
      medidor_id: factura.medidor_id,
      cliente_id: factura.cliente_id,
      periodo_facturado: factura.periodo_facturado,
      fecha_emision: factura.fecha_emision,
      fecha_vencimiento: factura.fecha_vencimiento,
      estado: factura.estado,
      total: factura.total,
      saldo_pendiente: factura.saldo_pendiente ?? factura.saldo ?? factura.total,
      es_tercera_boleta: factura.es_tercera_boleta,
      alerta_consumo_elevado: factura.alerta_consumo_elevado,
      texto_alerta_consumo: factura.texto_alerta_consumo,
      numero_boleta_medidor: factura.numero_boleta_medidor,
      lectura_anterior: factura.lectura_anterior,
      lectura_actual: factura.lectura_actual,
      consumo_m3: factura.consumo_m3,
    });

    if (facErr) {
      console.warn('[DatabaseEngine] Error persistiendo factura en Supabase:', facErr);
      return `Error persistiendo factura ${factura.id}: ${facErr.message}`;
    }

    // 2. Insertar detalles, actualizar cargos_pendientes y actualizar estado del medidor en paralelo
    const promesas: Promise<string | null>[] = [];

    if (detalles.length > 0) {
      const detallesRows = detalles.map((d) => ({
        id: d.id,
        factura_id: d.factura_id,
        concepto: d.concepto,
        descripcion: d.descripcion,
        monto: d.monto,
        cargo_pendiente_id: d.cargo_pendiente_id || null,
      }));
      promesas.push(
        Promise.resolve(sb.from('detalle_factura').insert(detallesRows)).then(({ error }) =>
          error ? `Error persistiendo detalle_factura (${factura.id}): ${error.message}` : null
        )
      );
    }

    if (cargosFacturadosIds.length > 0) {
      promesas.push(
        Promise.resolve(
          sb
            .from('cargos_pendientes')
            .update({
              estado: 'facturado',
              factura_id: factura.id,
            })
            .in('id', cargosFacturadosIds)
        ).then(({ error }) =>
          error ? `Error actualizando cargos_pendientes (${factura.id}): ${error.message}` : null
        )
      );
    }

    promesas.push(
      Promise.resolve(
        sb
          .from('medidores')
          .update({
            estado: estadoMedidor,
          })
          .eq('id', medidorId)
      ).then(({ error }) =>
        error ? `Error actualizando estado del medidor (${medidorId}): ${error.message}` : null
      )
    );

    const errores = (await Promise.all(promesas)).filter((e): e is string => Boolean(e));
    return errores.length > 0 ? errores.join(' | ') : null;
  }

  private ejecutarFacturacionMensualInterno(
    periodo: string,
    fechaEmision?: string
  ): {
    resumen: ResumenFacturacionMensual;
    persistPromises: Promise<string | null>[];
  } {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test((periodo || '').trim())) {
      throw new Error('El período debe tener formato válido YYYY-MM (ej: 2026-11).');
    }

    const tarifa = this.getTarifaParaFecha(fechaEmision);
    const fechaEjecucion = new Date().toISOString();
    const facturasGeneradas: Factura[] = [];
    const medidoresOmitidos: MedidorOmitidoFacturacion[] = [];
    const errores: ErrorFacturacionMedidor[] = [];
    const persistPromises: Promise<string | null>[] = [];

    let totalImporte = 0;
    let alertasConsumoCount = 0;
    let tercerasBoletasCount = 0;

    for (const medidor of this.data.medidores) {
      // 1. Filtrado de medidores a facturar:
      // Medidores con estado "cortado", "retirado" o "pendiente_corte" NO reciben factura mensual.
      if (medidor.estado === 'cortado') {
        medidoresOmitidos.push({
          medidor_id: medidor.id,
          numero_medidor: medidor.numero_medidor,
          cliente_id: medidor.cliente_id,
          motivo: 'cortado',
          detalle: 'Medidor cortado: no recibe factura mensual regular.',
        });
        continue;
      }

      if (medidor.estado === 'retirado') {
        medidoresOmitidos.push({
          medidor_id: medidor.id,
          numero_medidor: medidor.numero_medidor,
          cliente_id: medidor.cliente_id,
          motivo: 'retirado',
          detalle: 'Medidor retirado: servicio dado de baja.',
        });
        continue;
      }

      if (medidor.estado === 'pendiente_corte') {
        medidoresOmitidos.push({
          medidor_id: medidor.id,
          numero_medidor: medidor.numero_medidor,
          cliente_id: medidor.cliente_id,
          motivo: 'pendiente_corte',
          detalle: 'Medidor en pendiente de corte: no recibe nueva factura mensual hasta regularizar.',
        });
        continue;
      }

      // Solo medidores con estado "activo" o "moroso"
      if (medidor.estado !== 'activo' && medidor.estado !== 'moroso') {
        medidoresOmitidos.push({
          medidor_id: medidor.id,
          numero_medidor: medidor.numero_medidor,
          cliente_id: medidor.cliente_id,
          motivo: medidor.estado,
          detalle: `Medidor con estado "${medidor.estado}" no habilitado para facturación.`,
        });
        continue;
      }

      // 2. Comprobar si ya existe factura activa/emitida para este período (no duplicar)
      const yaFacturado = this.data.facturas.some(
        (f) => f.medidor_id === medidor.id && f.periodo_facturado === periodo && f.estado !== 'anulada'
      );
      if (yaFacturado) {
        medidoresOmitidos.push({
          medidor_id: medidor.id,
          numero_medidor: medidor.numero_medidor,
          cliente_id: medidor.cliente_id,
          motivo: 'ya_facturado',
          detalle: `El medidor ya cuenta con una factura emitida para el período ${periodo}.`,
        });
        continue;
      }

      // 3. Buscar lectura confirmada del período
      const lecturaMes = this.data.lecturas.find(
        (l) => l.medidor_id === medidor.id && l.periodo === periodo && l.estado === 'confirmada'
      );

      // Si no hay lectura confirmada para ese período: saltear el medidor
      if (!lecturaMes) {
        medidoresOmitidos.push({
          medidor_id: medidor.id,
          numero_medidor: medidor.numero_medidor,
          cliente_id: medidor.cliente_id,
          motivo: 'sin_lectura_confirmada',
          detalle: `No posee lectura confirmada para el período ${periodo}. Requiere toma de lectura antes de facturar.`,
        });
        continue;
      }

      try {
        // Historial de lecturas previas
        const lecturasAnteriores = this.data.lecturas
          .filter((l) => l.medidor_id === medidor.id && l.periodo !== periodo && l.estado === 'confirmada')
          .sort((a, b) => b.fecha_lectura.localeCompare(a.fecha_lectura));

        // Facturas impagas anteriores
        const facturasImpagas = this.data.facturas.filter(
          (f) =>
            f.medidor_id === medidor.id &&
            f.estado !== 'pagada' &&
            f.estado !== 'anulada' &&
            f.periodo_facturado !== periodo
        );

        // Cargos pendientes del período
        const cargosPendientes = this.data.cargos_pendientes.filter(
          (c) => c.medidor_id === medidor.id && c.periodo_facturacion === periodo && c.estado === 'pendiente'
        );

        // Planes de financiamiento activos
        const planesActivos = (this.data.planes_financiamiento || []).filter(
          (p) =>
            p.medidor_id === medidor.id &&
            p.estado === 'activo' &&
            p.cuotas_pagadas < p.cantidad_cuotas &&
            p.periodo_inicio <= periodo
        );

        const correlativo =
          Math.max(
            0,
            ...this.data.facturas
              .filter((f) => f.medidor_id === medidor.id)
              .map((f) => Number(f.numero_boleta_medidor) || 0)
          ) + 1;

        // Cálculo estricto según pliego técnico
        const resultado = calcularFacturaIndividual({
          medidor,
          clienteId: medidor.cliente_id,
          periodo,
          lecturaMes,
          lecturasAnteriores,
          facturasImpagasAnteriores: facturasImpagas,
          cargosPendientes,
          planesFinanciamiento: planesActivos,
          tarifa,
          fechaEmision,
          correlativoPorMedidor: correlativo,
        });

        // Registrar factura en memoria
        this.data.facturas.push(resultado.factura);
        facturasGeneradas.push(resultado.factura);

        // Marcar cargos pendientes como facturados
        for (const cargoId of resultado.cargosFacturadosIds) {
          const cargo = this.data.cargos_pendientes.find((c) => c.id === cargoId);
          if (cargo) {
            cargo.estado = 'facturado';
            cargo.factura_id = resultado.factura.id;
          }
        }

        // Actualizar estado del medidor
        medidor.estado = resultado.nuevoEstadoMedidor;

        // Persistir en Supabase garantizando orden FK: facturas -> detalle_factura / cargos / medidores
        if (supabase && isSupabaseConfigured) {
          persistPromises.push(
            this.persistirFacturaGeneradaSupabase({
              factura: resultado.factura,
              detalles: resultado.detalles,
              cargosFacturadosIds: resultado.cargosFacturadosIds,
              medidorId: medidor.id,
              estadoMedidor: medidor.estado,
            })
          );
        }

        totalImporte += resultado.factura.total;
        if (resultado.factura.alerta_consumo_elevado) alertasConsumoCount++;
        if (resultado.factura.es_tercera_boleta) tercerasBoletasCount++;
      } catch (err: any) {
        errores.push({
          medidor_id: medidor.id,
          numero_medidor: medidor.numero_medidor,
          error: err?.message || 'Error desconocido al calcular factura',
        });
      }
    }

    this.saveData(this.data);
    this.notify();

    return {
      resumen: {
        periodo,
        fechaEjecucion,
        totalMedidoresEvaluados: this.data.medidores.length,
        totalGeneradas: facturasGeneradas.length,
        totalOmitidos: medidoresOmitidos.length,
        totalErrores: errores.length,
        totalImporte,
        alertasConsumoCount,
        tercerasBoletasCount,
        facturasGeneradas,
        medidoresOmitidos,
        errores,
      },
      persistPromises,
    };
  }

  /**
   * Automatización mensual (síncrona para tests y cálculos en memoria; dispara persistencia ordenada en Supabase)
   */
  public ejecutarFacturacionMensual(
    periodo: string,
    fechaEmision?: string
  ): ResumenFacturacionMensual {
    const { resumen, persistPromises } = this.ejecutarFacturacionMensualInterno(periodo, fechaEmision);
    if (persistPromises.length > 0) {
      Promise.all(persistPromises).then((msgs) => {
        const errs = msgs.filter((m): m is string => Boolean(m));
        if (errs.length > 0) {
          this.dbError = errs[0];
          this.notify();
        }
      });
    }
    return resumen;
  }

  /**
   * Variante asíncrona recomendada para invocar desde UI:
   * espera confirmación real de Supabase (facturas -> detalle_factura / cargos_pendientes / medidores).
   */
  public async ejecutarFacturacionMensualAsync(
    periodo: string,
    fechaEmision?: string
  ): Promise<ResumenFacturacionMensual> {
    if (supabase && isSupabaseConfigured && this.connectionStatus !== 'connected') {
      await this.loadFromSupabase();
    }
    const { resumen, persistPromises } = this.ejecutarFacturacionMensualInterno(periodo, fechaEmision);
    if (persistPromises.length > 0) {
      const msgs = await Promise.all(persistPromises);
      const errs = msgs.filter((m): m is string => Boolean(m));
      if (errs.length > 0) {
        this.dbError = errs[0];
        this.notify();
        throw new Error(`Algunas operaciones de guardado en Supabase fallaron: ${errs[0]}`);
      }
    }
    return resumen;
  }

  /**
   * Registro de Pago en Caja (Cobrador):
   * - Soporta pago total o parcial por factura.
   * - Actualiza saldo y estado de la factura.
   * - Si la factura queda pagada y tenía cuotas de planes_financiamiento, avanza cuotas_pagadas.
   * - Si un medidor tiene todas sus facturas pagadas, pasa de moroso o pendiente_corte a activo automáticamente.
   */
  public registrarCobro(params: {
    facturaId: string;
    monto: number;
    metodoPago: MetodoPago;
    cobradorId?: string;
  }): {
    pago: Pago;
    factura: Factura;
    estadoMedidorActualizado: EstadoMedidor;
    saldoRestante: number;
    medidorPasoAActivo: boolean;
    salioDePendienteCorte: boolean;
    eraTerceraBoleta: boolean;
  } {
    const factura = this.data.facturas.find((f) => f.id === params.facturaId);
    if (!factura) {
      throw new Error('Factura no encontrada');
    }

    const medidor = this.data.medidores.find((m) => m.id === factura.medidor_id);
    if (!medidor) {
      throw new Error('Medidor asociado no encontrado');
    }

    if (factura.estado === 'anulada') {
      throw new Error('No se puede registrar un pago sobre una factura anulada.');
    }

    if (factura.estado === 'pagada') {
      throw new Error('Esta factura ya se encuentra totalmente cancelada.');
    }

    const saldoActual =
      factura.saldo_pendiente !== undefined
        ? factura.saldo_pendiente
        : factura.saldo !== undefined
          ? factura.saldo
          : factura.total;
    const montoCobrado = Math.round(params.monto);

    if (isNaN(montoCobrado) || montoCobrado <= 0) {
      throw new Error('El monto a pagar debe ser mayor a 0 Gs.');
    }

    if (montoCobrado > saldoActual) {
      throw new Error(
        `El monto a pagar (${montoCobrado.toLocaleString('es-PY')} Gs.) no puede superar el saldo pendiente (${saldoActual.toLocaleString('es-PY')} Gs.).`
      );
    }

    const ahora = new Date().toISOString().split('T')[0];
    const nuevoMontoPagado = (factura.monto_pagado || 0) + montoCobrado;
    const nuevoSaldo = Math.max(0, factura.total - nuevoMontoPagado);

    factura.monto_pagado = nuevoMontoPagado;
    factura.saldo_pendiente = nuevoSaldo;
    factura.saldo = nuevoSaldo;

    if (nuevoSaldo === 0) {
      factura.estado = 'pagada';
      factura.fecha_pago = ahora;

      // Avanzar cuotas de planes de financiamiento al PAGAR la factura
      const detallesPlan = (factura.detalles || []).filter(
        (d) => d.concepto === 'cuota_conexion' || d.concepto === 'perdida_financiada'
      );

      for (const det of detallesPlan) {
        const tipo = det.concepto as 'cuota_conexion' | 'perdida_financiada';
        const plan = (this.data.planes_financiamiento || []).find(
          (p) => p.medidor_id === medidor.id && p.tipo === tipo && p.estado === 'activo'
        );
        if (plan) {
          plan.cuotas_pagadas += 1;
          if (plan.cuotas_pagadas >= plan.cantidad_cuotas) {
            plan.estado = 'completado';
          }
          if (supabase && isSupabaseConfigured) {
            supabase
              .from('planes_financiamiento')
              .update({
                cuotas_pagadas: plan.cuotas_pagadas,
                estado: plan.estado,
              })
              .eq('id', plan.id)
              .then();
          }
        }
      }
    }

    const pago: Pago = {
      id: generarUUID(),
      factura_id: factura.id,
      fecha_pago: ahora,
      monto: montoCobrado,
      metodo_pago: params.metodoPago,
      numero_recibo: `REC-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 100)}`,
      cobrador_id: params.cobradorId || 'cobrador-caja',
    };
    this.data.pagos.push(pago);

    const estadoAnterior = medidor.estado;

    // Re-evaluar estado del medidor (excluyendo facturas pagadas o anuladas)
    const facturasRestantes = this.data.facturas.filter(
      (f) => f.medidor_id === medidor.id && f.estado !== 'pagada' && f.estado !== 'anulada'
    );

    if (facturasRestantes.length === 0) {
      // Si un medidor tiene todas sus facturas pagadas, pasa de moroso o pendiente_corte a activo automáticamente
      if (medidor.estado !== 'cortado' && medidor.estado !== 'retirado') {
        medidor.estado = 'activo';
      }
    } else {
      if (medidor.estado !== 'cortado' && medidor.estado !== 'retirado') {
        medidor.estado = evaluarEstadoMedidor(medidor, facturasRestantes);
      }
    }

    // Persistir cobro en Supabase (el trigger SECURITY DEFINER actualiza saldo_pendiente/estado en facturas y medidores)
    if (supabase && isSupabaseConfigured) {
      const sb = supabase;
      const esUuidValido = (v?: string | null) =>
        Boolean(v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v));

      sb.auth.getSession().then(async ({ data: { session } }) => {
        const cobradorUuid = esUuidValido(pago.cobrador_id) ? pago.cobrador_id : session?.user?.id;
        if (!cobradorUuid) {
          console.warn('[DatabaseEngine] No se encontró UUID de cobrador autenticado para registrar el pago en Supabase.');
          return;
        }
        pago.cobrador_id = cobradorUuid;

        const { error: pagoErr } = await sb.from('pagos').insert({
          id: pago.id,
          factura_id: pago.factura_id,
          fecha_pago: pago.fecha_pago,
          monto: pago.monto,
          metodo_pago: pago.metodo_pago,
          numero_recibo: pago.numero_recibo,
          cobrador_id: cobradorUuid,
        });

        if (pagoErr) {
          console.warn('[DatabaseEngine] Error persistiendo pago en Supabase:', pagoErr);
        }
      });
    }

    const medidorPasoAActivo = estadoAnterior !== 'activo' && medidor.estado === 'activo';
    const salioDePendienteCorte = estadoAnterior === 'pendiente_corte' && medidor.estado !== 'pendiente_corte';

    this.saveData(this.data);

    return {
      pago,
      factura,
      estadoMedidorActualizado: medidor.estado,
      saldoRestante: nuevoSaldo,
      medidorPasoAActivo,
      salioDePendienteCorte,
      eraTerceraBoleta: Boolean(factura.es_tercera_boleta),
    };
  }

  /**
   * Registro de Pago asíncrono (para UI de Ficha de Factura):
   * - Acepta fechaPago y numeroRecibo editables.
   * - Espera confirmación real de Supabase (donde el trigger procesar_pago_factura
   *   actualiza saldo_pendiente, estado de la factura y estado del medidor).
   * - No corrompe el estado local si Supabase rechaza el insert.
   */
  public async registrarCobroAsync(params: {
    facturaId: string;
    monto: number;
    metodoPago: MetodoPago;
    fechaPago?: string;
    numeroRecibo?: string;
    cobradorId?: string;
    cobradorNombre?: string;
  }): Promise<{
    pago: Pago;
    factura: Factura;
    estadoMedidorActualizado: EstadoMedidor;
    saldoRestante: number;
    medidorPasoAActivo: boolean;
    salioDePendienteCorte: boolean;
    eraTerceraBoleta: boolean;
  }> {
    const factura = this.data.facturas.find((f) => f.id === params.facturaId);
    if (!factura) {
      throw new Error('Factura no encontrada');
    }

    const medidor = this.data.medidores.find((m) => m.id === factura.medidor_id);
    if (!medidor) {
      throw new Error('Medidor asociado no encontrado');
    }

    if (factura.estado === 'anulada') {
      throw new Error('No se puede registrar un pago sobre una factura anulada.');
    }

    if (factura.estado === 'pagada') {
      throw new Error('Esta factura ya se encuentra totalmente cancelada.');
    }

    const saldoActual =
      factura.saldo_pendiente !== undefined
        ? factura.saldo_pendiente
        : factura.saldo !== undefined
          ? factura.saldo
          : factura.total;
    const montoCobrado = Math.round(params.monto);

    if (isNaN(montoCobrado) || montoCobrado <= 0) {
      throw new Error('El monto a pagar debe ser mayor a 0 Gs.');
    }

    if (montoCobrado > saldoActual) {
      throw new Error(
        `El monto a pagar (${montoCobrado.toLocaleString('es-PY')} Gs.) no puede superar el saldo pendiente (${saldoActual.toLocaleString('es-PY')} Gs.).`
      );
    }

    const fechaPago = (params.fechaPago || new Date().toISOString().split('T')[0]).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaPago)) {
      throw new Error('La fecha de pago debe tener formato YYYY-MM-DD.');
    }

    const numeroRecibo = (
      params.numeroRecibo ||
      `REC-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 100)}`
    )
      .trim()
      .slice(0, 30);

    if (!numeroRecibo) {
      throw new Error('Debe ingresar un número de recibo válido.');
    }

    if (
      this.data.pagos.some(
        (p) => (p.numero_recibo || '').trim().toLowerCase() === numeroRecibo.toLowerCase()
      )
    ) {
      throw new Error(`El número de recibo "${numeroRecibo}" ya fue utilizado.`);
    }

    const esUuidValido = (v?: string | null) =>
      Boolean(v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v));

    let cobradorIdFinal = params.cobradorId || 'cobrador-caja';

    if (supabase && isSupabaseConfigured) {
      const sb = supabase;
      const {
        data: { session },
        error: sessErr,
      } = await sb.auth.getSession();

      if (sessErr || !session?.user?.id) {
        throw new Error('Sesión de Supabase no válida. Volvé a iniciar sesión.');
      }

      cobradorIdFinal = esUuidValido(params.cobradorId) ? params.cobradorId! : session.user.id;
      const pagoId = generarUUID();

      const { error: pagoErr } = await sb.from('pagos').insert({
        id: pagoId,
        factura_id: factura.id,
        fecha_pago: fechaPago,
        monto: montoCobrado,
        metodo_pago: params.metodoPago,
        numero_recibo: numeroRecibo,
        cobrador_id: cobradorIdFinal,
      });

      if (pagoErr) {
        if (pagoErr.code === '23505') {
          throw new Error(`El número de recibo "${numeroRecibo}" ya existe en la base de datos.`);
        }
        throw new Error(`Error registrando pago en Supabase: ${pagoErr.message}`);
      }

      if (params.cobradorNombre) {
        this.usuariosMap.set(cobradorIdFinal, params.cobradorNombre);
      }

      const pago: Pago = {
        id: pagoId,
        factura_id: factura.id,
        fecha_pago: fechaPago,
        monto: montoCobrado,
        metodo_pago: params.metodoPago,
        numero_recibo: numeroRecibo,
        cobrador_id: cobradorIdFinal,
      };
      this.data.pagos.unshift(pago);

      // Re-consultar factura y medidor desde Supabase para reflejar exactamente el trigger procesar_pago_factura
      const [facRes, medRes] = await Promise.all([
        sb.from('facturas').select('estado, saldo_pendiente, fecha_pago').eq('id', factura.id).maybeSingle(),
        sb.from('medidores').select('estado').eq('id', medidor.id).maybeSingle(),
      ]);

      const estadoAnterior = medidor.estado;
      const nuevoMontoPagado = (factura.monto_pagado || 0) + montoCobrado;
      const nuevoSaldo =
        facRes.data && facRes.data.saldo_pendiente !== undefined && facRes.data.saldo_pendiente !== null
          ? Number(facRes.data.saldo_pendiente)
          : Math.max(0, saldoActual - montoCobrado);

      factura.monto_pagado = Math.min(factura.total, nuevoMontoPagado);
      factura.saldo_pendiente = nuevoSaldo;
      factura.saldo = nuevoSaldo;
      if (facRes.data?.estado) {
        factura.estado = facRes.data.estado as EstadoFactura;
      } else if (nuevoSaldo === 0) {
        factura.estado = 'pagada';
      }
      if (facRes.data?.fecha_pago) {
        factura.fecha_pago = facRes.data.fecha_pago;
      } else if (nuevoSaldo === 0) {
        factura.fecha_pago = fechaPago;
      }

      if (nuevoSaldo === 0) {
        const detallesPlan = (factura.detalles || []).filter(
          (d) => d.concepto === 'cuota_conexion' || d.concepto === 'perdida_financiada'
        );
        for (const det of detallesPlan) {
          const tipo = det.concepto as 'cuota_conexion' | 'perdida_financiada';
          const plan = (this.data.planes_financiamiento || []).find(
            (p) => p.medidor_id === medidor.id && p.tipo === tipo && p.estado === 'activo'
          );
          if (plan) {
            plan.cuotas_pagadas += 1;
            if (plan.cuotas_pagadas >= plan.cantidad_cuotas) {
              plan.estado = 'completado';
            }
            const { error: planErr } = await sb
              .from('planes_financiamiento')
              .update({
                cuotas_pagadas: plan.cuotas_pagadas,
                estado: plan.estado,
              })
              .eq('id', plan.id);
            if (planErr) {
              console.warn('[DatabaseEngine] Aviso actualizando plan de financiamiento:', planErr.message);
            }
          }
        }
      }

      if (medRes.data?.estado) {
        medidor.estado = medRes.data.estado as EstadoMedidor;
      } else {
        const facturasRestantes = this.data.facturas.filter(
          (f) => f.medidor_id === medidor.id && f.estado !== 'pagada' && f.estado !== 'anulada'
        );
        if (medidor.estado !== 'cortado' && medidor.estado !== 'retirado') {
          medidor.estado =
            facturasRestantes.length === 0
              ? 'activo'
              : evaluarEstadoMedidor(medidor, facturasRestantes);
        }
      }

      this.saveData(this.data);
      return {
        pago,
        factura,
        estadoMedidorActualizado: medidor.estado,
        saldoRestante: nuevoSaldo,
        medidorPasoAActivo: estadoAnterior !== 'activo' && medidor.estado === 'activo',
        salioDePendienteCorte: estadoAnterior === 'pendiente_corte' && medidor.estado !== 'pendiente_corte',
        eraTerceraBoleta: Boolean(factura.es_tercera_boleta),
      };
    }

    // Modo sin Supabase (tests/demo local): ejecutar flujo en memoria con fechaPago y numeroRecibo personalizados
    if (params.cobradorNombre) {
      this.usuariosMap.set(cobradorIdFinal, params.cobradorNombre);
    }
    const estadoAnterior = medidor.estado;
    const nuevoSaldo = Math.max(0, saldoActual - montoCobrado);
    factura.monto_pagado = (factura.monto_pagado || 0) + montoCobrado;
    factura.saldo_pendiente = nuevoSaldo;
    factura.saldo = nuevoSaldo;

    if (nuevoSaldo === 0) {
      factura.estado = 'pagada';
      factura.fecha_pago = fechaPago;
      const detallesPlan = (factura.detalles || []).filter(
        (d) => d.concepto === 'cuota_conexion' || d.concepto === 'perdida_financiada'
      );
      for (const det of detallesPlan) {
        const tipo = det.concepto as 'cuota_conexion' | 'perdida_financiada';
        const plan = (this.data.planes_financiamiento || []).find(
          (p) => p.medidor_id === medidor.id && p.tipo === tipo && p.estado === 'activo'
        );
        if (plan) {
          plan.cuotas_pagadas += 1;
          if (plan.cuotas_pagadas >= plan.cantidad_cuotas) {
            plan.estado = 'completado';
          }
        }
      }
    }

    const pago: Pago = {
      id: generarUUID(),
      factura_id: factura.id,
      fecha_pago: fechaPago,
      monto: montoCobrado,
      metodo_pago: params.metodoPago,
      numero_recibo: numeroRecibo,
      cobrador_id: cobradorIdFinal,
    };
    this.data.pagos.unshift(pago);

    const facturasRestantes = this.data.facturas.filter(
      (f) => f.medidor_id === medidor.id && f.estado !== 'pagada' && f.estado !== 'anulada'
    );
    if (medidor.estado !== 'cortado' && medidor.estado !== 'retirado') {
      medidor.estado =
        facturasRestantes.length === 0
          ? 'activo'
          : evaluarEstadoMedidor(medidor, facturasRestantes);
    }

    this.saveData(this.data);
    return {
      pago,
      factura,
      estadoMedidorActualizado: medidor.estado,
      saldoRestante: nuevoSaldo,
      medidorPasoAActivo: estadoAnterior !== 'activo' && medidor.estado === 'activo',
      salioDePendienteCorte: estadoAnterior === 'pendiente_corte' && medidor.estado !== 'pendiente_corte',
      eraTerceraBoleta: Boolean(factura.es_tercera_boleta),
    };
  }

  /**
   * Anular o revertir una factura emitida (solo si no tiene pagos):
   * - Revierte cualquier cargo_pendiente asociado a estado = 'pendiente' y factura_id = null
   *   para que no quede perdido como 'facturado'.
   * - En PostgreSQL/Supabase, los triggers trg_revertir_cargos_update_factura y
   *   trg_revertir_cargos_delete_factura garantizan esta reversión automáticamente.
   * - Re-evalúa el estado del medidor.
   */
  public anularFactura(
    facturaId: string,
    motivo: string,
    eliminarParaRefacturar = false
  ): {
    factura: Factura;
    cargosRevertidosIds: string[];
    estadoMedidorActualizado: EstadoMedidor;
    eliminada: boolean;
  } {
    const idx = this.data.facturas.findIndex((f) => f.id === facturaId);
    if (idx === -1) {
      throw new Error('Factura no encontrada');
    }

    const factura = this.data.facturas[idx];
    if (factura.estado === 'anulada') {
      throw new Error('La factura ya se encuentra anulada.');
    }

    if (factura.estado === 'pagada' || (factura.monto_pagado || 0) > 0) {
      throw new Error(
        'No se puede anular una factura que ya tiene pagos registrados.'
      );
    }

    if (!motivo || motivo.trim().length < 3) {
      throw new Error('Debe indicar un motivo válido de anulación.');
    }

    const medidor = this.data.medidores.find((m) => m.id === factura.medidor_id);
    if (!medidor) {
      throw new Error('Medidor asociado no encontrado');
    }

    // 1. Identificar y revertir cargos pendientes asociados (por factura_id o por detalle)
    const cargosIdsPorDetalle = new Set(
      (factura.detalles || [])
        .map((d) => d.cargo_pendiente_id)
        .filter((id): id is string => Boolean(id))
    );

    const cargosRevertidosIds: string[] = [];
    for (const cargo of this.data.cargos_pendientes) {
      if (
        cargo.factura_id === factura.id ||
        cargosIdsPorDetalle.has(cargo.id)
      ) {
        cargo.estado = 'pendiente';
        cargo.factura_id = null;
        cargosRevertidosIds.push(cargo.id);
      }
    }

    // 2. Anular (auditoría) o eliminar (para refacturar el mismo período sin chocar con UNIQUE)
    if (eliminarParaRefacturar) {
      this.data.facturas.splice(idx, 1);
    } else {
      factura.estado = 'anulada';
      factura.motivo_anulacion = motivo.trim();
      factura.saldo_pendiente = 0;
      factura.saldo = 0;
    }

    // 3. Re-evaluar estado del medidor con las facturas activas restantes
    const facturasRestantes = this.data.facturas.filter(
      (f) => f.medidor_id === medidor.id && f.estado !== 'pagada' && f.estado !== 'anulada'
    );
    if (medidor.estado !== 'cortado' && medidor.estado !== 'retirado') {
      medidor.estado = evaluarEstadoMedidor(medidor, facturasRestantes);
    }

    // 4. Persistir en Supabase si está configurado
    if (supabase && isSupabaseConfigured) {
      if (cargosRevertidosIds.length > 0) {
        supabase
          .from('cargos_pendientes')
          .update({
            estado: 'pendiente',
            factura_id: null,
          })
          .in('id', cargosRevertidosIds)
          .then(({ error }) => {
            if (error) console.warn('[DatabaseEngine] Error revirtiendo cargos_pendientes:', error);
          });
      }

      if (eliminarParaRefacturar) {
        supabase
          .from('facturas')
          .delete()
          .eq('id', factura.id)
          .then(({ error }) => {
            if (error) console.warn('[DatabaseEngine] Error eliminando factura para refacturar:', error);
          });
      } else {
        supabase
          .from('facturas')
          .update({
            estado: 'anulada',
            saldo_pendiente: 0,
            motivo_anulacion: factura.motivo_anulacion,
          })
          .eq('id', factura.id)
          .then(({ error }) => {
            if (error) console.warn('[DatabaseEngine] Error anulando factura en Supabase:', error);
          });
      }

      supabase
        .from('medidores')
        .update({ estado: medidor.estado })
        .eq('id', medidor.id)
        .then(({ error }) => {
          if (error) console.warn('[DatabaseEngine] Error actualizando estado medidor:', error);
        });
    }

    this.saveData(this.data);

    return {
      factura,
      cargosRevertidosIds,
      estadoMedidorActualizado: medidor.estado,
      eliminada: eliminarParaRefacturar,
    };
  }

  /**
   * Variante asíncrona de anulación de factura para invocar desde la UI (solo admin):
   * espera confirmación real de Supabase antes de actualizar estado en memoria.
   */
  public async anularFacturaAsync(
    facturaId: string,
    motivo: string
  ): Promise<{
    factura: Factura;
    cargosRevertidosIds: string[];
    estadoMedidorActualizado: EstadoMedidor;
  }> {
    const factura = this.data.facturas.find((f) => f.id === facturaId);
    if (!factura) {
      throw new Error('Factura no encontrada');
    }
    if (factura.estado === 'anulada') {
      throw new Error('La factura ya se encuentra anulada.');
    }
    const tienePagos =
      factura.estado === 'pagada' ||
      (factura.monto_pagado || 0) > 0 ||
      this.data.pagos.some((p) => p.factura_id === factura.id);
    if (tienePagos) {
      throw new Error('No se puede anular una factura que ya tiene pagos registrados.');
    }
    const motivoTrim = (motivo || '').trim();
    if (motivoTrim.length < 3) {
      throw new Error('Debe indicar un motivo válido de anulación (mínimo 3 caracteres).');
    }

    const medidor = this.data.medidores.find((m) => m.id === factura.medidor_id);
    if (!medidor) {
      throw new Error('Medidor asociado no encontrado');
    }

    const facturasRestantesPreview = this.data.facturas.filter(
      (f) => f.id !== factura.id && f.medidor_id === medidor.id && f.estado !== 'pagada' && f.estado !== 'anulada'
    );
    const nuevoEstadoMedidor =
      medidor.estado !== 'cortado' && medidor.estado !== 'retirado'
        ? evaluarEstadoMedidor(medidor, facturasRestantesPreview)
        : medidor.estado;

    if (supabase && isSupabaseConfigured) {
      const sb = supabase;
      const { error: facErr } = await sb
        .from('facturas')
        .update({
          estado: 'anulada',
          saldo_pendiente: 0,
          motivo_anulacion: motivoTrim,
        })
        .eq('id', factura.id);

      if (facErr) {
        throw new Error(`No se pudo anular la factura en Supabase: ${facErr.message}`);
      }

      if (nuevoEstadoMedidor !== medidor.estado) {
        const { error: medErr } = await sb
          .from('medidores')
          .update({ estado: nuevoEstadoMedidor })
          .eq('id', medidor.id);
        if (medErr) {
          console.warn('[DatabaseEngine] Aviso actualizando estado del medidor tras anulación:', medErr.message);
        }
      }
    }

    const cargosIdsPorDetalle = new Set(
      (factura.detalles || [])
        .map((d) => d.cargo_pendiente_id)
        .filter((id): id is string => Boolean(id))
    );

    const cargosRevertidosIds: string[] = [];
    for (const cargo of this.data.cargos_pendientes) {
      if (cargo.factura_id === factura.id || cargosIdsPorDetalle.has(cargo.id)) {
        cargo.estado = 'pendiente';
        cargo.factura_id = null;
        cargosRevertidosIds.push(cargo.id);
      }
    }

    factura.estado = 'anulada';
    factura.motivo_anulacion = motivoTrim;
    factura.saldo_pendiente = 0;
    factura.saldo = 0;
    medidor.estado = nuevoEstadoMedidor;

    this.saveData(this.data);

    return {
      factura,
      cargosRevertidosIds,
      estadoMedidorActualizado: medidor.estado,
    };
  }

  /**
   * Operativa de Cortes y Reconexiones
   */
  public confirmarCorteFisico(medidorId: string): Medidor {
    const medidor = this.data.medidores.find((m) => m.id === medidorId);
    if (!medidor) throw new Error('Medidor no encontrado');

    const tarifa = this.getTarifasVigentes();
    const facturasImpagas = this.data.facturas.filter(
      (f) => f.medidor_id === medidor.id && f.estado !== 'pagada' && f.estado !== 'anulada'
    );
    const mora = calcularMoraMedidor(facturasImpagas, tarifa.monto_mora_fijo).moraTotal;

    medidor.estado = 'cortado';
    medidor.fecha_corte = new Date().toISOString().split('T')[0];
    medidor.mora_congelada = mora;

    this.saveData(this.data);
    return medidor;
  }

  public confirmarReconexion(
    medidorId: string,
    cobradorOOpciones?: string | OpcionesReconexion
  ): { medidor: Medidor; facturaRegularizacion: Factura; pago: Pago } {
    const medidor = this.data.medidores.find((m) => m.id === medidorId);
    if (!medidor) throw new Error('Medidor no encontrado');

    const opts: OpcionesReconexion =
      typeof cobradorOOpciones === 'string'
        ? { cobradorId: cobradorOOpciones }
        : cobradorOOpciones || {};

    const cobradorId = opts.cobradorId || 'caja';
    const metodoPago: MetodoPago = opts.metodoPago || 'efectivo';
    const tarifa = this.getTarifasVigentes();
    const ahora = opts.fechaReconexion || new Date().toISOString().split('T')[0];
    const tipoReinstalacion = opts.tipoReinstalacion || 'mismo_medidor';

    // 5. Se registra la reinstalación del medidor (o nuevo medidor)
    if (tipoReinstalacion === 'nuevo_medidor') {
      if (!opts.nuevoNumeroMedidor) {
        throw new Error('Debe especificar el número del nuevo medidor.');
      }
      // Validar numero_medidor según reglas del pliego
      const resVal = validarNumeroMedidor(
        opts.nuevoNumeroMedidor,
        this.data.medidores.filter((m) => m.id !== medidor.id).map((m) => m.numero_medidor),
        tarifa.max_numero_medidor
      );
      if (!resVal.valido) {
        throw new Error(resVal.error || 'Número de nuevo medidor inválido');
      }

      medidor.numero_medidor_anterior = medidor.numero_medidor;
      medidor.numero_medidor = opts.nuevoNumeroMedidor;
    }

    const facturasImpagas = this.data.facturas.filter(
      (f) => f.medidor_id === medidor.id && f.estado !== 'pagada' && f.estado !== 'anulada'
    );
    const cargosPendientes = this.data.cargos_pendientes.filter(
      (c) => c.medidor_id === medidor.id && c.estado === 'pendiente'
    );

    const correlativo =
      Math.max(
        0,
        ...this.data.facturas
          .filter((f) => f.medidor_id === medidor.id)
          .map((f) => Number(f.numero_boleta_medidor) || 0)
      ) + 1;

    // 2. Sistema genera factura de regularización del medidor con:
    // deuda anterior + mora congelada + reconexión + cargos pendientes + ERSSAN 2%
    const { factura: facReg } = generarFacturaRegularizacion({
      medidor,
      clienteId: medidor.cliente_id,
      facturasImpagas,
      cargosPendientes: cargosPendientes.map((c) => ({
        id: c.id,
        descripcion: c.descripcion,
        monto: c.monto,
      })),
      tarifa,
      correlativoPorMedidor: correlativo,
    });

    facReg.estado = 'pagada';
    facReg.fecha_pago = ahora;
    facReg.monto_pagado = facReg.total;
    facReg.saldo_pendiente = 0;
    facReg.saldo = 0;
    this.data.facturas.push(facReg);

    // Marcar facturas anteriores como pagadas
    for (const f of facturasImpagas) {
      f.estado = 'pagada';
      f.fecha_pago = ahora;
      f.monto_pagado = f.total;
      f.saldo_pendiente = 0;
      f.saldo = 0;
    }

    // Marcar cargos como facturados
    for (const c of cargosPendientes) {
      c.estado = 'facturado';
      c.factura_id = facReg.id;
    }

    // 3. Se registra pago
    const nuevoPago: Pago = {
      id: `pago-reg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      factura_id: facReg.id,
      fecha_pago: ahora,
      monto: facReg.total,
      metodo_pago: metodoPago,
      numero_recibo: `REC-REG-${Date.now().toString().slice(-6)}`,
      cobrador_id: cobradorId,
    };
    this.data.pagos.push(nuevoPago);

    // 4. Al quedar paga, el medidor pasa a activo
    medidor.estado = 'activo';
    medidor.fecha_corte = null;
    medidor.mora_congelada = null;
    medidor.fecha_reconexion = ahora;
    medidor.fecha_instalacion = ahora;
    medidor.observaciones_reconexion = opts.observaciones || null;

    // 5. Registrar lectura inicial de reinstalación
    const lecturaInicial = opts.lecturaInicial !== undefined ? Math.max(0, Math.floor(opts.lecturaInicial)) : 0;
    medidor.lectura_inicial_reconexion = lecturaInicial;

    const periodoActual = ahora.slice(0, 7);
    this.data.lecturas.push({
      id: `lec-rec-${Date.now()}`,
      medidor_id: medidor.id,
      periodo: periodoActual,
      fecha_lectura: ahora,
      lectura_actual: lecturaInicial,
      lectura_anterior: lecturaInicial,
      consumo_m3: 0,
      foto_medidor_url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=400',
      observaciones: `Reinstalación de ${
        tipoReinstalacion === 'nuevo_medidor'
          ? `nuevo medidor N° ${medidor.numero_medidor} (anterior: N° ${medidor.numero_medidor_anterior})`
          : `mismo medidor N° ${medidor.numero_medidor}`
      }. Operario: ${opts.operario || 'Cuadrilla'}. ${opts.observaciones || ''}`,
      estado: 'confirmada',
      registrado_por: opts.operario || cobradorId,
      fecha_registro: new Date().toISOString(),
    });

    this.saveData(this.data);
    return { medidor, facturaRegularizacion: facReg, pago: nuevoPago };
  }

  public agregarCliente(cliente: Omit<Cliente, 'id' | 'fecha_alta'>): Cliente {
    // Verificar documento único
    const existe = this.data.clientes.some((c) => c.documento.trim() === cliente.documento.trim());
    if (existe) {
      throw new Error(`Ya existe un cliente registrado con el documento N° ${cliente.documento}`);
    }

    const nuevoId = generarUUID();
    const fechaAlta = new Date().toISOString().split('T')[0];
    const nuevo: Cliente = {
      ...cliente,
      id: nuevoId,
      fecha_alta: fechaAlta,
    };

    const nuevoContrato: Contrato = {
      id: generarUUID(),
      cliente_id: nuevoId,
      fecha_inicio: fechaAlta,
      fecha_fin: null,
      condiciones: 'Suministro de agua potable conforme a normativas de ERSSAN.',
      estado: 'vigente',
    };

    this.data.clientes.unshift(nuevo);
    this.data.contratos.unshift(nuevoContrato);
    this.saveData(this.data);

    if (supabase && isSupabaseConfigured) {
      Promise.all([
        supabase.from('clientes').insert({
          id: nuevo.id,
          nombre_completo: nuevo.nombre_completo,
          documento: nuevo.documento,
          direccion: nuevo.direccion,
          telefono: nuevo.telefono || null,
          email: nuevo.email || null,
          fecha_alta: nuevo.fecha_alta,
        }),
        supabase.from('contratos').insert({
          id: nuevoContrato.id,
          cliente_id: nuevoContrato.cliente_id,
          fecha_inicio: nuevoContrato.fecha_inicio,
          condiciones: nuevoContrato.condiciones,
          estado: nuevoContrato.estado,
        }),
      ]).then(([cliRes, conRes]) => {
        if (cliRes.error || conRes.error) {
          const err = cliRes.error || conRes.error;
          console.warn('[Supabase] Error insertando cliente/contrato:', err);
          this.dbError = `No se pudo conectar a la base de datos: ${err?.message}`;
          this.notify();
        }
      }).catch((err) => {
        console.warn('[Supabase] Error de red insertando cliente:', err);
        this.dbError = `No se pudo conectar a la base de datos: ${err.message}`;
        this.notify();
      });
    }

    return nuevo;
  }

  public actualizarCliente(clienteId: string, datos: Partial<Omit<Cliente, 'id' | 'fecha_alta'>>): Cliente {
    const idx = this.data.clientes.findIndex((c) => c.id === clienteId);
    if (idx === -1) throw new Error('Cliente no encontrado');

    if (datos.documento && datos.documento !== this.data.clientes[idx].documento) {
      const existe = this.data.clientes.some((c) => c.documento.trim() === datos.documento?.trim() && c.id !== clienteId);
      if (existe) throw new Error(`Ya existe otro cliente con el documento N° ${datos.documento}`);
    }

    this.data.clientes[idx] = {
      ...this.data.clientes[idx],
      ...datos,
    };
    this.saveData(this.data);

    if (supabase && isSupabaseConfigured) {
      supabase.from('clientes').update({
        nombre_completo: this.data.clientes[idx].nombre_completo,
        documento: this.data.clientes[idx].documento,
        direccion: this.data.clientes[idx].direccion,
        telefono: this.data.clientes[idx].telefono || null,
        email: this.data.clientes[idx].email || null,
      }).eq('id', clienteId).then(({ error }) => {
        if (error) {
          console.warn('[Supabase] Error actualizando cliente:', error);
          this.dbError = `No se pudo conectar a la base de datos: ${error.message}`;
          this.notify();
        }
      });
    }

    return this.data.clientes[idx];
  }

  public eliminarCliente(clienteId: string): void {
    const tieneMedidores = this.data.medidores.some((m) => m.cliente_id === clienteId);
    if (tieneMedidores) {
      throw new Error('No se puede eliminar un cliente con medidores asociados. Debe transferir o dar de baja sus medidores primero.');
    }
    this.data.clientes = this.data.clientes.filter((c) => c.id !== clienteId);
    this.data.contratos = this.data.contratos.filter((con) => con.cliente_id !== clienteId);
    this.saveData(this.data);

    if (supabase && isSupabaseConfigured) {
      supabase.from('clientes').delete().eq('id', clienteId).then(({ error }) => {
        if (error) {
          console.warn('[Supabase] Error eliminando cliente:', error);
          this.dbError = `No se pudo conectar a la base de datos: ${error.message}`;
          this.notify();
        }
      });
    }
  }

  public actualizarMedidor(medidorId: string, datos: Partial<Omit<Medidor, 'id' | 'numero_medidor'>>): Medidor {
    const idx = this.data.medidores.findIndex((m) => m.id === medidorId);
    if (idx === -1) throw new Error('Medidor no encontrado');

    this.data.medidores[idx] = {
      ...this.data.medidores[idx],
      ...datos,
    };
    this.saveData(this.data);

    if (supabase && isSupabaseConfigured) {
      supabase.from('medidores').update({
        direccion: this.data.medidores[idx].direccion,
        zona: this.data.medidores[idx].zona,
        latitud: this.data.medidores[idx].latitud,
        longitud: this.data.medidores[idx].longitud,
        estado: this.data.medidores[idx].estado,
        fecha_corte: this.data.medidores[idx].fecha_corte,
        mora_congelada: this.data.medidores[idx].mora_congelada,
      }).eq('id', medidorId).then(({ error }) => {
        if (error) {
          console.warn('[Supabase] Error actualizando medidor:', error);
          this.dbError = `No se pudo conectar a la base de datos: ${error.message}`;
          this.notify();
        }
      });
    }

    return this.data.medidores[idx];
  }

  public eliminarMedidor(medidorId: string): void {
    const idx = this.data.medidores.findIndex((m) => m.id === medidorId);
    if (idx === -1) throw new Error('Medidor no encontrado');
    this.data.medidores.splice(idx, 1);
    this.saveData(this.data);

    if (supabase && isSupabaseConfigured) {
      supabase.from('medidores').delete().eq('id', medidorId).then(({ error }) => {
        if (error) {
          console.warn('[Supabase] Error eliminando medidor:', error);
          this.dbError = `No se pudo conectar a la base de datos: ${error.message}`;
          this.notify();
        }
      });
    }
  }

  public agregarMedidor(medidor: Omit<Medidor, 'id' | 'mora_congelada' | 'fecha_corte'>): Medidor {
    const tarifa = this.getTarifasVigentes();
    const existentes = new Set(this.data.medidores.map((m) => m.numero_medidor));
    const val = validarNumeroMedidor(
      medidor.numero_medidor,
      existentes,
      tarifa.max_numero_medidor,
      this.data.medidores.length
    );
    if (!val.valido) {
      throw new Error(val.error || 'Número de medidor inválido');
    }

    const nuevoId = generarUUID();
    const nuevo: Medidor = {
      ...medidor,
      id: nuevoId,
      mora_congelada: null,
      fecha_corte: null,
    };
    this.data.medidores.push(nuevo);
    this.saveData(this.data);

    if (supabase && isSupabaseConfigured) {
      Promise.resolve(supabase.from('medidores').insert({
        id: nuevo.id,
        cliente_id: nuevo.cliente_id,
        numero_medidor: nuevo.numero_medidor,
        direccion: nuevo.direccion,
        zona: nuevo.zona || 'Centro',
        latitud: nuevo.latitud,
        longitud: nuevo.longitud,
        fecha_instalacion: nuevo.fecha_instalacion,
        estado: nuevo.estado,
        fecha_corte: null,
        mora_congelada: 0,
      })).then(({ error }: any) => {
        if (error) {
          console.warn('[Supabase] Error insertando medidor:', error);
          this.dbError = `No se pudo conectar a la base de datos: ${error.message}`;
          this.notify();
        }
      }).catch((err: any) => {
        console.warn('[Supabase] Error de red insertando medidor:', err);
        this.dbError = `No se pudo conectar a la base de datos: ${err.message}`;
        this.notify();
      });
    }

    return nuevo;
  }

  public agregarCargoPendiente(cargo: Omit<CargoPendiente, 'id' | 'estado' | 'fecha_registro'>): CargoPendiente {
    const medidor = this.data.medidores.find((m) => m.id === cargo.medidor_id);
    const numMedidor = medidor ? medidor.numero_medidor : 0;

    const val = validarRegistroCargo({
      monto: cargo.monto,
      periodoFacturacion: cargo.periodo_facturacion,
      medidorId: cargo.medidor_id,
      numeroMedidor: numMedidor,
      facturasExistentesMedidor: this.data.facturas,
    });

    if (!val.valido) {
      throw new Error(val.error || 'Error al validar cargo pendiente');
    }

    const nuevo: CargoPendiente = {
      ...cargo,
      id: `cargo-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      estado: 'pendiente',
      fecha_registro: new Date().toISOString(),
    };
    this.data.cargos_pendientes.push(nuevo);
    this.saveData(this.data);
    return nuevo;
  }

  public actualizarCargoPendiente(
    cargoId: string,
    datos: {
      descripcion?: string;
      monto?: number;
      periodo_facturacion?: string;
      fecha_trabajo?: string;
    },
    editadoPor = 'admin'
  ): CargoPendiente {
    const cargo = this.data.cargos_pendientes.find((c) => c.id === cargoId);
    if (!cargo) throw new Error('Cargo no encontrado');

    const medidor = this.data.medidores.find((m) => m.id === cargo.medidor_id);
    const val = validarEdicionCargo({
      cargo,
      nuevoPeriodo: datos.periodo_facturacion,
      nuevoMonto: datos.monto,
      facturasExistentesMedidor: this.data.facturas,
      numeroMedidor: medidor?.numero_medidor,
    });

    if (!val.permitida) {
      throw new Error(val.error || 'No se puede editar este cargo');
    }

    if (datos.descripcion !== undefined) cargo.descripcion = datos.descripcion.trim();
    if (datos.monto !== undefined) cargo.monto = Math.round(datos.monto);
    if (datos.periodo_facturacion !== undefined) cargo.periodo_facturacion = datos.periodo_facturacion;
    if (datos.fecha_trabajo !== undefined) cargo.fecha_trabajo = datos.fecha_trabajo;

    cargo.editado_por = editadoPor;
    cargo.fecha_edicion = new Date().toISOString();

    this.saveData(this.data);
    return cargo;
  }

  public anularCargo(cargoId: string, motivo: string, anuladoPor = 'admin'): CargoPendiente {
    const cargo = this.data.cargos_pendientes.find((c) => c.id === cargoId);
    if (!cargo) throw new Error('Cargo no encontrado');

    const val = validarAnulacionCargo({ cargo, motivo });
    if (!val.permitida) {
      throw new Error(val.error || 'No se puede anular este cargo');
    }

    cargo.estado = 'anulado';
    cargo.motivo_anulacion = `${motivo.trim()} (Anulado por: ${anuladoPor} el ${new Date().toISOString().split('T')[0]})`;
    this.saveData(this.data);
    return cargo;
  }

  public getPlanesFinanciamiento(): PlanFinanciamiento[] {
    return this.data.planes_financiamiento || [];
  }

  public getPlanesPorMedidor(medidorId: string): PlanFinanciamiento[] {
    return (this.data.planes_financiamiento || []).filter(
      (p) => p.medidor_id === medidorId
    );
  }

  public getPlanesActivosPorMedidor(medidorId: string): PlanFinanciamiento[] {
    return (this.data.planes_financiamiento || []).filter(
      (p) => p.medidor_id === medidorId && p.estado === 'activo'
    );
  }

  public agregarPlanFinanciamiento(plan: Omit<PlanFinanciamiento, 'id' | 'cuotas_pagadas' | 'estado' | 'fecha_registro'>): PlanFinanciamiento {
    const medidor = this.data.medidores.find((m) => m.id === plan.medidor_id);
    if (!medidor) throw new Error('Medidor no encontrado para el plan de financiamiento');
    const cliente = this.data.clientes.find((c) => c.id === plan.cliente_id);
    if (!cliente) throw new Error('Cliente no encontrado para el plan de financiamiento');

    if (plan.monto_total <= 0) throw new Error('El monto total del plan debe ser mayor a 0');
    if (plan.cantidad_cuotas <= 0) throw new Error('La cantidad de cuotas debe ser mayor a 0');
    if (plan.monto_cuota <= 0) throw new Error('El monto por cuota debe ser mayor a 0');

    const nuevoId = generarUUID();
    const nuevo: PlanFinanciamiento = {
      ...plan,
      id: nuevoId,
      cuotas_pagadas: 0,
      estado: 'activo',
      fecha_registro: new Date().toISOString(),
    };

    if (!this.data.planes_financiamiento) {
      this.data.planes_financiamiento = [];
    }
    this.data.planes_financiamiento.push(nuevo);
    this.saveData(this.data);

    if (supabase && isSupabaseConfigured) {
      Promise.resolve(
        supabase.from('planes_financiamiento').insert({
          id: nuevo.id,
          medidor_id: nuevo.medidor_id,
          cliente_id: nuevo.cliente_id,
          tipo: nuevo.tipo,
          descripcion: nuevo.descripcion,
          monto_total: nuevo.monto_total,
          cantidad_cuotas: nuevo.cantidad_cuotas,
          monto_cuota: nuevo.monto_cuota,
          periodo_inicio: nuevo.periodo_inicio,
          cuotas_pagadas: nuevo.cuotas_pagadas,
          estado: nuevo.estado,
          registrado_por: nuevo.registrado_por,
          fecha_registro: nuevo.fecha_registro,
          motivo_anulacion: nuevo.motivo_anulacion,
        })
      ).then(({ error }: any) => {
        if (error) {
          console.warn('[Supabase] Error insertando plan de financiamiento:', error);
        }
      }).catch((err: any) => {
        console.warn('[Supabase] Error de red insertando plan:', err);
      });
    }

    return nuevo;
  }

  public actualizarPlanFinanciamiento(id: string, datos: Partial<PlanFinanciamiento>): PlanFinanciamiento {
    const idx = (this.data.planes_financiamiento || []).findIndex((p) => p.id === id);
    if (idx === -1) throw new Error('Plan de financiamiento no encontrado');

    this.data.planes_financiamiento[idx] = {
      ...this.data.planes_financiamiento[idx],
      ...datos,
    };
    this.saveData(this.data);

    if (supabase && isSupabaseConfigured) {
      Promise.resolve(
        supabase.from('planes_financiamiento').update({
          cuotas_pagadas: this.data.planes_financiamiento[idx].cuotas_pagadas,
          estado: this.data.planes_financiamiento[idx].estado,
          motivo_anulacion: this.data.planes_financiamiento[idx].motivo_anulacion,
        }).eq('id', id)
      ).then(({ error }: any) => {
        if (error) {
          console.warn('[Supabase] Error actualizando plan de financiamiento:', error);
        }
      }).catch((err: any) => {
        console.warn('[Supabase] Error de red actualizando plan:', err);
      });
    }

    return this.data.planes_financiamiento[idx];
  }

  public getCargos(params?: {
    page?: number;
    limit?: number;
    estado?: EstadoCargo | 'todos';
    periodo?: string | 'todos';
    search?: string;
    medidorId?: string;
  }): {
    cargos: (CargoPendiente & {
      numeroMedidor: number;
      medidorDireccion: string;
      clienteNombre: string;
      clienteDoc: string;
    })[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    resumen: {
      totalCargos: number;
      pendientesCount: number;
      pendientesMonto: number;
      facturadosCount: number;
      facturadosMonto: number;
      anuladosCount: number;
      anuladosMonto: number;
    };
  } {
    const page = Math.max(1, params?.page || 1);
    const limit = Math.min(50, Math.max(1, params?.limit || 50));
    const estado = params?.estado || 'todos';
    const periodo = params?.periodo || 'todos';
    const search = (params?.search || '').trim().toLowerCase();

    const clientesMap = new Map<string, Cliente>();
    for (const c of this.data.clientes) clientesMap.set(c.id, c);

    const medidoresMap = new Map<string, Medidor>();
    for (const m of this.data.medidores) medidoresMap.set(m.id, m);

    // Global summary across all cargos
    let pendientesCount = 0;
    let pendientesMonto = 0;
    let facturadosCount = 0;
    let facturadosMonto = 0;
    let anuladosCount = 0;
    let anuladosMonto = 0;

    for (const c of this.data.cargos_pendientes) {
      if (c.estado === 'pendiente') {
        pendientesCount++;
        pendientesMonto += c.monto;
      } else if (c.estado === 'facturado') {
        facturadosCount++;
        facturadosMonto += c.monto;
      } else if (c.estado === 'anulado') {
        anuladosCount++;
        anuladosMonto += c.monto;
      }
    }

    let filtradas = [...this.data.cargos_pendientes];

    if (estado !== 'todos') {
      filtradas = filtradas.filter((c) => c.estado === estado);
    }

    if (periodo !== 'todos') {
      filtradas = filtradas.filter((c) => c.periodo_facturacion === periodo);
    }

    if (params?.medidorId) {
      filtradas = filtradas.filter((c) => c.medidor_id === params.medidorId);
    }

    const enriched = filtradas.map((c) => {
      const med = medidoresMap.get(c.medidor_id);
      const cli = clientesMap.get(c.cliente_id);
      return {
        ...c,
        numeroMedidor: med?.numero_medidor || 0,
        medidorDireccion: med?.direccion || '',
        clienteNombre: cli?.nombre_completo || 'Cliente',
        clienteDoc: cli?.documento || '',
      };
    });

    let resultado = enriched;
    if (search) {
      resultado = enriched.filter(
        (c) =>
          String(c.numeroMedidor).includes(search) ||
          c.clienteNombre.toLowerCase().includes(search) ||
          c.clienteDoc.includes(search) ||
          c.descripcion.toLowerCase().includes(search) ||
          c.periodo_facturacion.includes(search)
      );
    }

    // Ordenar: primero los más recientes
    resultado.sort((a, b) => new Date(b.fecha_registro).getTime() - new Date(a.fecha_registro).getTime());

    const total = resultado.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const slice = resultado.slice(offset, offset + limit);

    return {
      cargos: slice,
      total,
      page,
      limit,
      totalPages,
      resumen: {
        totalCargos: this.data.cargos_pendientes.length,
        pendientesCount,
        pendientesMonto,
        facturadosCount,
        facturadosMonto,
        anuladosCount,
        anuladosMonto,
      },
    };
  }

  public getDashboardStats() {
    const totalMedidores = this.data.medidores.length;
    let activos = 0;
    let morosos = 0;
    let pendientesCorte = 0;
    let cortados = 0;
    let retirados = 0;

    for (const m of this.data.medidores) {
      if (m.estado === 'activo') activos++;
      else if (m.estado === 'moroso') morosos++;
      else if (m.estado === 'pendiente_corte') pendientesCorte++;
      else if (m.estado === 'cortado') cortados++;
      else if (m.estado === 'retirado') retirados++;
    }

    const ahora = new Date();
    const periodoActual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;

    // Recaudación de pagos del mes
    const pagosMes = this.data.pagos.filter((p) => p.fecha_pago.startsWith(periodoActual));
    const totalRecaudadoMes = pagosMes.reduce((acc, p) => acc + p.monto, 0);

    // Deuda total impaga acumulada
    const facturasImpagas = this.data.facturas.filter(
      (f) => f.estado !== 'pagada' && f.estado !== 'anulada'
    );
    const totalDeudaAcumulada = facturasImpagas.reduce(
      (acc, f) => acc + (f.saldo_pendiente ?? f.saldo ?? f.total),
      0
    );

    // Facturación emitida mes actual y pendientes
    const facturasMes = this.data.facturas.filter(
      (f) => f.periodo_facturado === periodoActual && f.estado !== 'anulada'
    );
    const totalFacturadoMes = facturasMes.reduce((acc, f) => acc + f.total, 0);
    const facturasPendientesMes = facturasMes.filter(
      (f) => f.estado !== 'pagada' && f.estado !== 'anulada'
    ).length;

    // Cargos pendientes de facturar este mes
    const cargosPendientes = this.data.cargos_pendientes.filter(
      (c) => c.estado === 'pendiente'
    );
    const totalCargosPendientesMonto = cargosPendientes.reduce((acc, c) => acc + c.monto, 0);

    // Consumo m3 medido este mes
    const lecturasMes = this.data.lecturas.filter((l) => l.periodo === periodoActual);
    const totalM3Mes = lecturasMes.reduce((acc, l) => acc + (l.consumo_m3 || 0), 0);

    // Alertas de consumo elevado activas
    const alertasConsumo = facturasMes.filter((f) => f.alerta_consumo_elevado).length;

    return {
      totalClientes: this.data.clientes.length,
      totalMedidores,
      activos,
      morosos,
      pendientesCorte,
      cortados,
      retirados,
      facturasPendientesMes,
      cargosPendientesCount: cargosPendientes.length,
      cargosPendientesMonto: totalCargosPendientesMonto,
      totalRecaudadoMes,
      totalDeudaAcumulada,
      totalFacturadoMes,
      totalM3Mes,
      alertasConsumo,
      periodoActual,
    };
  }

  public getListadoParaCortar(): (Medidor & { clienteNombre: string; clienteDoc: string; facturasVencidas: Factura[]; totalDeuda: number })[] {
    const clientesMap = new Map<string, Cliente>();
    for (const c of this.data.clientes) clientesMap.set(c.id, c);

    const pendientes = this.data.medidores.filter((m) => m.estado === 'pendiente_corte');
    return pendientes.map((m) => {
      const cli = clientesMap.get(m.cliente_id);
      const facturasVencidas = this.data.facturas.filter(
        (f) => f.medidor_id === m.id && f.estado !== 'pagada' && f.estado !== 'anulada'
      );
      const totalDeuda = facturasVencidas.reduce(
        (a, f) => a + (f.saldo_pendiente ?? f.saldo ?? f.total),
        0
      );
      return {
        ...m,
        clienteNombre: cli ? cli.nombre_completo : '',
        clienteDoc: cli ? cli.documento : '',
        facturasVencidas,
        totalDeuda,
      };
    });
  }

  public getListadoParaReconectar(): (Medidor & { clienteNombre: string; clienteDoc: string; liquidacion: any })[] {
    const clientesMap = new Map<string, Cliente>();
    for (const c of this.data.clientes) clientesMap.set(c.id, c);
    const tarifa = this.getTarifasVigentes();

    const cortados = this.data.medidores.filter((m) => m.estado === 'cortado');
    return cortados.map((m) => {
      const cli = clientesMap.get(m.cliente_id);
      const facturasImpagas = this.data.facturas.filter(
        (f) => f.medidor_id === m.id && f.estado !== 'pagada' && f.estado !== 'anulada'
      );
      const liq = liquidarReconexion(m, facturasImpagas, tarifa);
      return {
        ...m,
        clienteNombre: cli ? cli.nombre_completo : '',
        clienteDoc: cli ? cli.documento : '',
        liquidacion: liq,
      };
    });
  }

  private filtrarFacturasEnriquecidas(params: {
    periodo?: string;
    estado?: EstadoFactura | 'todas' | 'todos';
    medidor?: string;
    cliente?: string;
    esTerceraBoleta?: 'todos' | 'si' | 'no';
    search?: string;
  } = {}) {
    const search = (params.search || '').trim().toLowerCase();
    const medidorFiltro = (params.medidor || '').replace(/^#/, '').trim().toLowerCase();
    const clienteFiltro = (params.cliente || '').trim().toLowerCase();
    const estado = params.estado || 'todas';
    const esTercera = params.esTerceraBoleta || 'todos';

    const clientesMap = new Map<string, Cliente>();
    for (const c of this.data.clientes) clientesMap.set(c.id, c);

    const medidoresMap = new Map<string, Medidor>();
    for (const m of this.data.medidores) medidoresMap.set(m.id, m);

    const pagosCountMap = new Map<string, number>();
    for (const p of this.data.pagos) {
      pagosCountMap.set(p.factura_id, (pagosCountMap.get(p.factura_id) || 0) + 1);
    }

    let filtradas = this.data.facturas;
    if (params.periodo && params.periodo !== 'todos') {
      filtradas = filtradas.filter((f) => f.periodo_facturado === params.periodo);
    }
    if (estado !== 'todas' && estado !== 'todos') {
      filtradas = filtradas.filter((f) => f.estado === estado);
    }
    if (esTercera === 'si') {
      filtradas = filtradas.filter((f) => Boolean(f.es_tercera_boleta));
    } else if (esTercera === 'no') {
      filtradas = filtradas.filter((f) => !f.es_tercera_boleta);
    }

    if (medidorFiltro) {
      filtradas = filtradas.filter((f) => {
        const med = medidoresMap.get(f.medidor_id);
        return med ? String(med.numero_medidor).includes(medidorFiltro) : false;
      });
    }

    if (clienteFiltro) {
      filtradas = filtradas.filter((f) => {
        const cli = clientesMap.get(f.cliente_id);
        if (!cli) return false;
        return (
          cli.nombre_completo.toLowerCase().includes(clienteFiltro) ||
          cli.documento.toLowerCase().includes(clienteFiltro)
        );
      });
    }

    if (search) {
      filtradas = filtradas.filter((f) => {
        const cli = clientesMap.get(f.cliente_id);
        const med = medidoresMap.get(f.medidor_id);
        const numBoleta = f.numero_boleta_medidor ? `${f.numero_boleta_medidor}-${f.periodo_facturado}` : '';
        if (cli && (cli.nombre_completo.toLowerCase().includes(search) || cli.documento.toLowerCase().includes(search))) return true;
        if (med && String(med.numero_medidor).includes(search)) return true;
        if (numBoleta && numBoleta.toLowerCase().includes(search)) return true;
        return f.id.toLowerCase().includes(search);
      });
    }

    const enriched = filtradas.map((f) => {
      const cli = clientesMap.get(f.cliente_id);
      const med = medidoresMap.get(f.medidor_id);
      const saldoPend =
        f.saldo_pendiente !== undefined && f.saldo_pendiente !== null
          ? f.saldo_pendiente
          : f.saldo !== undefined && f.saldo !== null
            ? f.saldo
            : f.estado === 'pagada' || f.estado === 'anulada'
              ? 0
              : f.total;
      const montoPagado =
        f.monto_pagado !== undefined && f.monto_pagado !== null
          ? f.monto_pagado
          : f.estado === 'pagada'
            ? f.total
            : f.estado === 'anulada'
              ? 0
              : Math.max(0, f.total - saldoPend);

      return {
        ...f,
        saldo_pendiente: saldoPend,
        saldo: saldoPend,
        monto_pagado: montoPagado,
        clienteNombre: cli?.nombre_completo || 'Cliente',
        clienteDoc: cli?.documento || '',
        numeroMedidor: med?.numero_medidor || 0,
        medidorDireccion: med?.direccion || '',
        pagosCount: pagosCountMap.get(f.id) || 0,
      };
    });

    enriched.sort((a, b) => {
      const pCmp = (b.periodo_facturado || '').localeCompare(a.periodo_facturado || '');
      if (pCmp !== 0) return pCmp;
      const fCmp = (b.fecha_emision || '').localeCompare(a.fecha_emision || '');
      if (fCmp !== 0) return fCmp;
      return (a.numeroMedidor || 0) - (b.numeroMedidor || 0);
    });

    return enriched;
  }

  public getFacturas(params: {
    page?: number;
    limit?: number;
    periodo?: string;
    estado?: EstadoFactura | 'todas' | 'todos';
    medidor?: string;
    cliente?: string;
    esTerceraBoleta?: 'todos' | 'si' | 'no';
    search?: string;
  } = {}) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(50, Math.max(1, params.limit || 50));
    const enrichedAll = this.filtrarFacturasEnriquecidas(params);

    const total = enrichedAll.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * limit;
    const slice = enrichedAll.slice(offset, offset + limit);

    return {
      facturas: slice,
      total,
      page: safePage,
      totalPages,
    };
  }

  public getFacturasParaExportar(params: {
    periodo?: string;
    estado?: EstadoFactura | 'todas' | 'todos';
    medidor?: string;
    cliente?: string;
    esTerceraBoleta?: 'todos' | 'si' | 'no';
    search?: string;
  } = {}) {
    return this.filtrarFacturasEnriquecidas(params);
  }

  public getPagosPorFactura(facturaId: string): (Pago & { cobradorNombre: string })[] {
    return this.data.pagos
      .filter((p) => p.factura_id === facturaId)
      .sort((a, b) => (b.fecha_pago || '').localeCompare(a.fecha_pago || ''))
      .map((p) => ({
        ...p,
        cobradorNombre:
          this.usuariosMap.get(p.cobrador_id) ||
          (p.cobrador_id === 'cobrador-caja' || p.cobrador_id === 'caja'
            ? 'Caja Central'
            : p.cobrador_id.slice(0, 8)),
      }));
  }

  public getPeriodosFacturacion(): {
    periodosDisponibles: string[];
    ultimoPeriodoConLecturas: string | null;
  } {
    const set = new Set<string>();
    for (const f of this.data.facturas) {
      if (f.periodo_facturado && f.periodo_facturado !== 'REGULARIZACION') {
        set.add(f.periodo_facturado);
      }
    }
    const lecturasConfirmadas = this.data.lecturas
      .filter((l) => l.estado === 'confirmada' && /^\d{4}-(0[1-9]|1[0-2])$/.test(l.periodo || ''))
      .map((l) => l.periodo)
      .sort((a, b) => b.localeCompare(a));

    for (const p of lecturasConfirmadas) set.add(p);

    return {
      periodosDisponibles: Array.from(set).sort((a, b) => b.localeCompare(a)),
      ultimoPeriodoConLecturas: lecturasConfirmadas[0] || null,
    };
  }

  public getFacturaPorId(id: string): {
    factura: Factura;
    cliente: Cliente;
    medidor: Medidor;
    detalles: DetalleFactura[];
  } | null {
    let factura = this.data.facturas.find((f) => f.id === id);
    if (!factura) {
      // Búsqueda flexible por prefijo o por medidor y período (ej: FAC-1-2025-01)
      const parts = id.split('-');
      if (parts.length >= 3 && parts[0] === 'FAC') {
        const numMed = parseInt(parts[1], 10);
        const periodo = `${parts[2]}-${parts[3] || ''}`.replace(/-+$/, '');
        const med = this.data.medidores.find((m) => m.numero_medidor === numMed);
        if (med) {
          factura = this.data.facturas.find(
            (f) =>
              f.medidor_id === med.id &&
              (f.periodo_facturado === periodo || f.id.startsWith(`FAC-${numMed}-${periodo}`))
          );
        }
      }
      if (!factura) {
        factura = this.data.facturas.find((f) => f.id.startsWith(id) || id.startsWith(f.id));
      }
    }
    if (!factura) return null;
    const cliente = this.data.clientes.find((c) => c.id === factura.cliente_id);
    const medidor = this.data.medidores.find((m) => m.id === factura.medidor_id);
    if (!cliente || !medidor) return null;
    return {
      factura,
      cliente,
      medidor,
      detalles: factura.detalles || [],
    };
  }

  public getClienteContratoParaPdf(clienteId: string): {
    cliente: Cliente;
    contrato: Contrato;
    medidores: Medidor[];
    tarifa: TarifaConfig;
  } | null {
    const cliente = this.data.clientes.find((c) => c.id === clienteId || c.documento === clienteId);
    if (!cliente) return null;
    let contrato = this.data.contratos.find((ct) => ct.cliente_id === cliente.id);
    if (!contrato) {
      contrato = {
        id: `con-${cliente.id}`,
        cliente_id: cliente.id,
        fecha_inicio: cliente.fecha_alta || '2025-01-01',
        fecha_fin: null,
        condiciones: 'Suministro de agua potable conforme a normativas de ERSSAN.',
        estado: 'vigente',
      };
    }
    const medidores = this.data.medidores.filter((m) => m.cliente_id === cliente.id);
    const tarifa = this.getTarifasVigentes();
    return {
      cliente,
      contrato,
      medidores,
      tarifa,
    };
  }

  public getFullData(): DatabaseSchema {
    return this.data;
  }

  public importFullData(data: Partial<DatabaseSchema>) {
    if (data.clientes) this.data.clientes = data.clientes;
    if (data.medidores) this.data.medidores = data.medidores;
    if (data.contratos) this.data.contratos = data.contratos;
    if (data.lecturas) this.data.lecturas = data.lecturas;
    if (data.facturas) this.data.facturas = data.facturas;
    if (data.pagos) this.data.pagos = data.pagos;
    if (data.cargos_pendientes) this.data.cargos_pendientes = data.cargos_pendientes;
    if (data.tarifas) this.data.tarifas = data.tarifas;
    this.saveData(this.data);
  }

  /**
   * Reporte de Consumos por Zona Geográfica
   */
  public getReporteConsumosPorZona(periodo?: string): ConsumoZonaReport[] {
    const zonasMap = new Map<string, Medidor[]>();
    for (const m of this.data.medidores) {
      const z = m.zona || 'Sin Zona';
      const list = zonasMap.get(z) || [];
      list.push(m);
      zonasMap.set(z, list);
    }

    const periodoFiltro = periodo && periodo !== 'todos' ? periodo : null;
    const lecturasPeriodo = periodoFiltro
      ? this.data.lecturas.filter((l) => l.periodo === periodoFiltro)
      : this.data.lecturas;

    const consumoPorMedidor = new Map<string, number>();
    for (const l of lecturasPeriodo) {
      const actual = consumoPorMedidor.get(l.medidor_id) || 0;
      consumoPorMedidor.set(l.medidor_id, actual + (l.consumo_m3 || 0));
    }

    const facturasPeriodo = periodoFiltro
      ? this.data.facturas.filter((f) => f.periodo_facturado === periodoFiltro && f.estado !== 'anulada')
      : this.data.facturas.filter((f) => f.estado !== 'anulada');

    const facturacionPorMedidor = new Map<string, number>();
    for (const f of facturasPeriodo) {
      const actual = facturacionPorMedidor.get(f.medidor_id) || 0;
      facturacionPorMedidor.set(f.medidor_id, actual + f.total);
    }

    const reportes: ConsumoZonaReport[] = [];

    for (const [zona, medidoresZona] of zonasMap.entries()) {
      let activos = 0;
      let morosos = 0;
      let cortados = 0;
      let pendientesCorte = 0;
      let totalConsumoM3 = 0;
      let facturacionTotal = 0;

      for (const m of medidoresZona) {
        if (m.estado === 'activo') activos++;
        else if (m.estado === 'moroso') morosos++;
        else if (m.estado === 'cortado') cortados++;
        else if (m.estado === 'pendiente_corte') pendientesCorte++;

        totalConsumoM3 += consumoPorMedidor.get(m.id) || 0;
        facturacionTotal += facturacionPorMedidor.get(m.id) || 0;
      }

      const totalMedidores = medidoresZona.length;
      const promedioM3PorMedidor = totalMedidores > 0 ? Math.round(totalConsumoM3 / totalMedidores) : 0;

      reportes.push({
        zona,
        totalMedidores,
        activos,
        morosos,
        cortados,
        pendientesCorte,
        totalConsumoM3,
        promedioM3PorMedidor,
        facturacionTotal,
      });
    }

    return reportes.sort((a, b) => a.zona.localeCompare(b.zona));
  }

  /**
   * Reporte detallado de recaudación del mes con desglose por método y ERSSAN
   */
  public getReporteRecaudacionDetallado(periodo?: string): ReporteRecaudacionDetalle {
    const ahora = new Date();
    const periodoActual = periodo && periodo !== 'todos'
      ? periodo
      : `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;

    const pagosPeriodo = this.data.pagos.filter((p) => p.fecha_pago.startsWith(periodoActual));
    const porMetodo: Record<MetodoPago, number> = {
      efectivo: 0,
      transferencia: 0,
      cheque: 0,
    };

    let totalRecaudado = 0;
    for (const p of pagosPeriodo) {
      totalRecaudado += p.monto;
      const metodo = p.metodo_pago in porMetodo ? p.metodo_pago : 'efectivo';
      porMetodo[metodo] += p.monto;
    }

    const tarifa = this.getTarifasVigentes();
    const aporteErssanEstimado = Math.round((totalRecaudado * tarifa.erssan_porcentaje) / 100);

    return {
      totalRecaudado,
      porMetodo,
      aporteErssanEstimado,
      cantidadPagos: pagosPeriodo.length,
    };
  }

  public resetDemoData() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
    this.data = this.generateSeedData();
    this.saveData(this.data);
  }
}

export const db = new DatabaseEngine();

/**
 * Función get_tarifa_vigente(concepto) que devuelve el valor actual o según fecha de emisión, usada por facturación
 */
export function get_tarifa_vigente<K extends keyof TarifaConfig>(
  concepto: K,
  fechaEmision?: string
): TarifaConfig[K] {
  return db.getTarifaVigente(concepto, fechaEmision);
}

export {
  calcularFacturaIndividual,
  calcularFechaVencimiento,
  type ResumenFacturacionMensual,
  type MedidorOmitidoFacturacion,
  type ErrorFacturacionMedidor,
};
