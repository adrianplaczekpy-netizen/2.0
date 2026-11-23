/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface OfflineTileDescriptor {
  key: string;
  url: string;
  urlTemplate: string;
  x: number;
  y: number;
  z: number;
  createdAt: number;
}

export interface OfflineBoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface OfflineDownloadProgress {
  loaded: number;
  total: number;
  saved: number;
  skipped: number;
  failed: number;
}

export interface OfflineDownloadResult extends OfflineDownloadProgress {
  storagesize: number;
}

export interface OfflineStorageOps {
  hasTile: (key: string) => Promise<boolean>;
  downloadTile: (url: string) => Promise<Blob>;
  saveTile: (tileInfo: OfflineTileDescriptor, blob: Blob) => Promise<unknown>;
  getStorageLength: () => Promise<number>;
}

export const OFFLINE_MIN_ZOOM = 14;
export const OFFLINE_MAX_ZOOM = 17;

/**
 * Devuelve los niveles de zoom a cachear para la zona (siempre acotados a [14..17]
 * para garantizar nitidez de calles/lotes sin descargar demasiados tiles).
 */
export function calcularZoomsDescargaOffline(currentZoom: number): number[] {
  const minZ = OFFLINE_MIN_ZOOM;
  const maxZ = Math.min(OFFLINE_MAX_ZOOM, Math.max(OFFLINE_MIN_ZOOM + 1, Math.round(currentZoom) + 1));
  const zooms: number[] = [];
  for (let z = minZ; z <= Math.max(OFFLINE_MAX_ZOOM, maxZ); z += 1) {
    if (z <= OFFLINE_MAX_ZOOM) {
      zooms.push(z);
    }
  }
  return zooms.length > 0 ? zooms : [14, 15, 16, 17];
}

/**
 * Acota el área de descarga alrededor del centro actual (~2.5 km x 2.5 km máximo)
 * para evitar descargas masivas si el mapa está muy alejado.
 */
export function calcularBoundsZonaDescarga(params: {
  viewportBounds: OfflineBoundingBox;
  center: { lat: number; lng: number };
  currentZoom: number;
}): OfflineBoundingBox {
  const { viewportBounds, center, currentZoom } = params;
  const maxHalfSpan = 0.015; // ~1.6 km desde el centro en cada dirección

  if (currentZoom < OFFLINE_MIN_ZOOM) {
    return {
      north: center.lat + 0.012,
      south: center.lat - 0.012,
      east: center.lng + 0.012,
      west: center.lng - 0.012,
    };
  }

  const halfLat = Math.min(maxHalfSpan, Math.abs(viewportBounds.north - viewportBounds.south) / 2);
  const halfLng = Math.min(maxHalfSpan, Math.abs(viewportBounds.east - viewportBounds.west) / 2);

  return {
    north: center.lat + Math.max(0.004, halfLat),
    south: center.lat - Math.max(0.004, halfLat),
    east: center.lng + Math.max(0.004, halfLng),
    west: center.lng - Math.max(0.004, halfLng),
  };
}

/**
 * Elimina tiles duplicados por `key` preservando orden.
 */
export function deduplicarTilesOffline(tiles: OfflineTileDescriptor[]): OfflineTileDescriptor[] {
  const vistos = new Set<string>();
  const unicos: OfflineTileDescriptor[] = [];
  for (const tile of tiles) {
    if (!tile?.key || vistos.has(tile.key)) continue;
    vistos.add(tile.key);
    unicos.push(tile);
  }
  return unicos;
}

/**
 * Descarga y persiste en IndexedDB los tiles de la zona (omitiendo los ya cacheados).
 */
export async function ejecutarDescargaTilesOffline(params: {
  tiles: OfflineTileDescriptor[];
  storageOps: OfflineStorageOps;
  concurrency?: number;
  onProgress?: (progress: OfflineDownloadProgress) => void;
}): Promise<OfflineDownloadResult> {
  const unicos = deduplicarTilesOffline(params.tiles);
  const total = unicos.length;
  const progress: OfflineDownloadProgress = {
    loaded: 0,
    total,
    saved: 0,
    skipped: 0,
    failed: 0,
  };

  if (total === 0) {
    const storagesize = await params.storageOps.getStorageLength().catch(() => 0);
    return { ...progress, storagesize };
  }

  const cola = [...unicos];
  const concurrency = Math.max(1, Math.min(params.concurrency ?? 8, cola.length));

  const worker = async (): Promise<void> => {
    while (cola.length > 0) {
      const tile = cola.shift();
      if (!tile) break;
      try {
        const yaExiste = await params.storageOps.hasTile(tile.key);
        if (yaExiste) {
          progress.skipped += 1;
        } else {
          const blob = await params.storageOps.downloadTile(tile.url);
          await params.storageOps.saveTile(tile, blob);
          progress.saved += 1;
        }
      } catch {
        progress.failed += 1;
      } finally {
        progress.loaded += 1;
        params.onProgress?.({ ...progress });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const storagesize = await params.storageOps.getStorageLength().catch(() => 0);

  return {
    ...progress,
    storagesize,
  };
}
