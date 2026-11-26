/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = 'admin' | 'cobrador' | 'lectura';

export type EstadoMedidor = 'activo' | 'moroso' | 'pendiente_corte' | 'cortado' | 'retirado';

export type EstadoLectura = 'borrador' | 'confirmada';

export type EstadoFactura = 'pendiente' | 'pagada' | 'vencida' | 'anulada' | 'refinanciada';

export type EstadoCargo = 'pendiente' | 'facturado' | 'anulado';

export type MetodoPago = 'efectivo' | 'transferencia' | 'cheque';

export interface Cliente {
  id: string;
  nombre_completo: string;
  documento: string; // C.I. o RUC
  direccion: string;
  telefono: string;
  email: string;
  fecha_alta: string; // YYYY-MM-DD
}

export interface Contrato {
  id: string;
  cliente_id: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  condiciones: string;
  estado: 'vigente' | 'finalizado';
}

export interface Medidor {
  id: string;
  cliente_id: string;
  numero_medidor: number; // 1 to 1000
  fecha_instalacion: string;
  direccion: string;
  zona: string;
  latitud: number;
  longitud: number;
  estado: EstadoMedidor;
  fecha_corte: string | null;
  mora_congelada: number | null; // Se llena al pasar a cortado
  fecha_reconexion?: string | null;
  numero_medidor_anterior?: number | null;
  lectura_inicial_reconexion?: number | null;
  observaciones_reconexion?: string | null;
}

export interface OpcionesReconexion {
  cobradorId?: string;
  metodoPago?: MetodoPago;
  montoAbonado?: number;
  tipoReinstalacion?: 'mismo_medidor' | 'nuevo_medidor';
  nuevoNumeroMedidor?: number;
  lecturaInicial?: number;
  fechaReconexion?: string;
  operario?: string;
  observaciones?: string;
  incluirReconexion?: boolean;
  registradoPor?: string;
}

export interface Lectura {
  id: string;
  medidor_id: string;
  periodo: string; // YYYY-MM
  fecha_lectura: string;
  lectura_actual: number;
  lectura_anterior: number;
  consumo_m3: number;
  foto_medidor_url: string;
  observaciones?: string | null; // INTERNO, no se imprime en boleta
  foto_observacion_url?: string | null;
  estado: EstadoLectura;
  factura_id?: string | null;
  registrado_por: string;
  fecha_registro: string;
  editado_por?: string | null;
  fecha_edicion?: string | null;
  motivo_edicion?: string | null;
}

export interface AuditoriaCambioParametro {
  parametro: string;
  etiqueta: string;
  valor_anterior: number | string;
  valor_nuevo: number | string;
}

export interface RegistroAuditoriaTarifa {
  id: string;
  tarifa_id: string;
  usuario: string; // Nombre o identificador del usuario que realizó la modificación
  fecha: string; // ISO timestamp
  cambios: AuditoriaCambioParametro[];
  motivo?: string;
}

export interface TarifaConfig {
  id: string;
  precio_m3: number; // Ej: 4000 Gs.
  consumo_minimo_m3: number; // Ej: 9 m3
  monto_minimo_consumo: number; // Ej: 36000 Gs.
  monto_mora_fijo: number; // Ej: 3000 Gs. por factura vencida
  monto_reconexion: number; // Ej: 60000 Gs.
  erssan_porcentaje: number; // Ej: 2 %
  dia_vencimiento_boletas_normales: number | 'ultimo_dia_mes'; // 'ultimo_dia_mes' o 1-28
  dia_vencimiento_tercera_boleta: number; // Ej: 11 (1-28)
  umbral_alerta_consumo: number; // Ej: 3x sobre el promedio
  texto_alerta_consumo: string;
  max_numero_medidor: number; // Ej: 1000
  vigente_desde: string; // YYYY-MM-DD
  creado_por: string;
  creado_por_nombre?: string;
  fecha_creacion: string;
  motivo_cambio?: string;
  auditoria?: RegistroAuditoriaTarifa;
  cambios_auditados?: AuditoriaCambioParametro[];
}

export interface DetalleFactura {
  id: string;
  factura_id: string;
  concepto:
    | 'consumo_agua'
    | 'deuda_anterior'
    | 'mora'
    | 'otros_trabajos'
    | 'cuota_conexion'
    | 'perdida_financiada'
    | 'reconexion'
    | 'erssan';
  descripcion: string;
  monto: number;
  cargo_pendiente_id?: string | null;
}

export interface Factura {
  id: string;
  medidor_id: string;
  cliente_id: string;
  periodo_facturado: string; // YYYY-MM (mes de emisión/vencimiento)
  periodo_consumo?: string | null; // YYYY-MM (período de la lectura consumida, ej: 2026-10)
  lectura_id?: string | null; // FK a lecturas.id
  fecha_emision: string;
  fecha_vencimiento: string;
  estado: EstadoFactura;
  total: number;
  es_tercera_boleta: boolean;
  alerta_consumo_elevado: boolean;
  texto_alerta_consumo?: string | null;
  saldo_pendiente?: number; // Columna real en Supabase
  saldo?: number; // Alias en memoria para UI
  monto_pagado?: number; // Calculado en memoria: total - saldo_pendiente
  numero_boleta_medidor?: number; // Correlativo por medidor
  numero_factura?: string | null; // Numeración oficial SET (ej: 001-002-0000001)
  detalles?: DetalleFactura[];
  // Campos desnormalizados para visualización rápida
  lectura_anterior?: number;
  lectura_actual?: number;
  consumo_m3?: number;
  fecha_pago?: string | null;
  motivo_anulacion?: string | null;
  motivo?: string | null;
}

export interface ConsumoZonaReport {
  zona: string;
  totalMedidores: number;
  activos: number;
  morosos: number;
  cortados: number;
  pendientesCorte: number;
  totalConsumoM3: number;
  promedioM3PorMedidor: number;
  facturacionTotal: number;
}

export interface ReporteRecaudacionDetalle {
  totalRecaudado: number;
  porMetodo: Record<MetodoPago, number>;
  aporteErssanEstimado: number;
  cantidadPagos: number;
}

export interface Pago {
  id: string;
  factura_id: string;
  fecha_pago: string;
  monto: number;
  metodo_pago: MetodoPago;
  numero_recibo?: string;
  cobrador_id: string;
}

export interface CargoPendiente {
  id: string;
  medidor_id: string;
  cliente_id: string;
  fecha_trabajo: string;
  descripcion: string;
  monto: number;
  periodo_facturacion: string; // YYYY-MM
  estado: EstadoCargo;
  factura_id?: string | null;
  comprobante_url?: string | null;
  registrado_por: string;
  fecha_registro: string;
  motivo_anulacion?: string | null;
  editado_por?: string | null;
  fecha_edicion?: string | null;
}

export interface ResumenMedidor {
  medidor: Medidor;
  cliente: Cliente;
  ultimaLectura?: Lectura;
  facturasPendientes: Factura[];
  totalDeuda: number;
  totalMora: number;
  boletasImpagasCount: number;
  esTerceraBoleta: boolean;
}

export type TipoPlanFinanciamiento = 'cuota_conexion' | 'perdida_financiada';
export type EstadoPlanFinanciamiento = 'activo' | 'completado' | 'anulado';

export interface PlanFinanciamiento {
  id: string; // UUID PK
  medidor_id: string; // UUID FK medidores
  cliente_id: string; // UUID FK clientes
  tipo: TipoPlanFinanciamiento;
  descripcion?: string | null;
  monto_total: number;
  cantidad_cuotas: number;
  monto_cuota: number;
  periodo_inicio: string; // YYYY-MM
  cuotas_pagadas: number;
  estado: EstadoPlanFinanciamiento;
  registrado_por: string; // UUID
  fecha_registro: string;
  motivo_anulacion?: string | null;
}

export interface UserRoleRecord {
  id: string;
  user_id: string;
  rol: UserRole;
  created_at?: string;
  updated_at?: string;
}

export interface UsuarioPerfil {
  id: string;
  email: string;
  nombre_completo: string;
  rol?: UserRole;
  activo: boolean;
  fecha_creacion?: string;
}
