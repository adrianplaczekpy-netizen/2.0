/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const LECTURAS_OFFLINE_QUEUE_KEY = 'aguateria_lecturas_offline_queue';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface LecturaOfflineQueueItem {
  queueId: string;
  queuedAt: string;
  payload: {
    numeroMedidor: number;
    lecturaActual: number;
    fechaLectura: string;
    fotoUrl: string;
    observaciones?: string;
    fotoObservacionUrl?: string;
    estado: 'borrador' | 'confirmada';
    registradoPor?: string;
    registradoPorId?: string;
    esAdmin?: boolean;
    justificacionAdmin?: string;
  };
}

function resolveStorage(storageOverride?: StorageLike | null): StorageLike | null {
  if (storageOverride) return storageOverride;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

/**
 * Distingue fallas de red/conectividad (que ameritan encolar offline)
 * de errores propios de Postgres/RLS/validación (que deben mostrarse al usuario).
 */
export function isOfflineOrNetworkError(
  error: unknown,
  isNavigatorOffline?: boolean
): boolean {
  if (isNavigatorOffline === true) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }

  const errObj = error as { message?: string; code?: string; name?: string } | null;
  const code = (errObj?.code || '').toUpperCase();
  const msg = (
    typeof error === 'string'
      ? error
      : errObj?.message || ''
  ).toLowerCase();

  // Errores explícitos de PostgreSQL / PostgREST (constraint, RLS, syntax, UUID, etc.) NO son offline
  if (
    code.startsWith('22') ||
    code.startsWith('23') ||
    code.startsWith('42') ||
    code.startsWith('PGRST')
  ) {
    return false;
  }

  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('err_internet_disconnected') ||
    msg.includes('err_network') ||
    msg.includes('fetcherror') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('timeout') ||
    msg.includes('sin conexión') ||
    msg.includes('offline')
  );
}

export function getLecturasOfflineQueue(
  storageOverride?: StorageLike | null
): LecturaOfflineQueueItem[] {
  const storage = resolveStorage(storageOverride);
  if (!storage) return [];

  try {
    const raw = storage.getItem(LECTURAS_OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLecturasOfflineQueue(
  items: LecturaOfflineQueueItem[],
  storageOverride?: StorageLike | null
): void {
  const storage = resolveStorage(storageOverride);
  if (!storage) return;

  try {
    if (items.length === 0 && storage.removeItem) {
      storage.removeItem(LECTURAS_OFFLINE_QUEUE_KEY);
    } else {
      storage.setItem(LECTURAS_OFFLINE_QUEUE_KEY, JSON.stringify(items));
    }
  } catch (err) {
    console.warn('[LecturasOfflineQueue] No se pudo persistir cola offline:', err);
  }
}

export function enqueueLecturaOffline(
  payload: LecturaOfflineQueueItem['payload'],
  storageOverride?: StorageLike | null
): LecturaOfflineQueueItem {
  const queue = getLecturasOfflineQueue(storageOverride);
  const periodoPayload = payload.fechaLectura.slice(0, 7);

  // Deduplicar por medidor + período para evitar duplicados al reintentar el mismo mes
  const existingIdx = queue.findIndex(
    (q) =>
      q.payload.numeroMedidor === payload.numeroMedidor &&
      q.payload.fechaLectura.slice(0, 7) === periodoPayload
  );

  const item: LecturaOfflineQueueItem = {
    queueId:
      existingIdx >= 0
        ? queue[existingIdx].queueId
        : `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: new Date().toISOString(),
    payload: {
      ...payload,
    },
  };

  if (existingIdx >= 0) {
    queue[existingIdx] = item;
  } else {
    queue.push(item);
  }

  saveLecturasOfflineQueue(queue, storageOverride);
  return item;
}

export function removeLecturaOffline(
  queueId: string,
  storageOverride?: StorageLike | null
): void {
  const queue = getLecturasOfflineQueue(storageOverride);
  const next = queue.filter((q) => q.queueId !== queueId);
  saveLecturasOfflineQueue(next, storageOverride);
}

export function clearLecturasOfflineQueue(
  storageOverride?: StorageLike | null
): void {
  saveLecturasOfflineQueue([], storageOverride);
}

/**
 * Fuente única de verdad para banners de estado offline/cola local en UI.
 * Garantiza que al vaciarse la cola (colaOfflineCount === 0) y volver la red,
 * todos los avisos de "sin conexión" y "cola local" desaparecen.
 */
export function resolveOfflineStatusUi(params: {
  isOnline: boolean;
  colaOfflineCount: number;
  offlineQueuedMessage?: string | null;
}): {
  showTopBanner: boolean;
  showQueuedNotice: boolean;
  queuedNoticeText: string | null;
} {
  const showTopBanner = !params.isOnline || params.colaOfflineCount > 0;
  const showQueuedNotice =
    params.colaOfflineCount > 0 && Boolean(params.offlineQueuedMessage);

  return {
    showTopBanner,
    showQueuedNotice,
    queuedNoticeText: showQueuedNotice ? params.offlineQueuedMessage || null : null,
  };
}

/**
 * Configuración del campo de motivo al eliminar una lectura:
 * siempre visible (obligatorio si la factura ya está pagada, opcional si no).
 */
export function getDeleteMotivoFieldConfig(facturaPagada: boolean): {
  visible: boolean;
  required: boolean;
  label: string;
  placeholder: string;
} {
  return {
    visible: true,
    required: Boolean(facturaPagada),
    label: facturaPagada
      ? 'Motivo de Auditoría (Obligatorio) *'
      : 'Motivo de Eliminación (Opcional)',
    placeholder: facturaPagada
      ? 'Motivo de eliminación para auditoría (mínimo 5 caracteres)...'
      : 'Ingrese el motivo de la eliminación (opcional)...',
  };
}

