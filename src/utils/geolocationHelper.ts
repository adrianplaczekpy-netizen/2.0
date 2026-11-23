/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const GEO_ERR_UNSUPPORTED = 'Tu navegador no soporta geolocalización.';
export const GEO_ERR_PERMISSION_DENIED =
  'Habilitá la ubicación desde el candado 🔒 al lado de la URL en tu navegador.';
export const GEO_ERR_POSITION_UNAVAILABLE =
  'No se pudo determinar tu ubicación. Verificá el GPS de tu dispositivo.';
export const GEO_ERR_TIMEOUT = 'La ubicación tardó demasiado. Reintentá.';
export const GEOLOCATION_ERROR_MESSAGE = GEO_ERR_PERMISSION_DENIED;

export class GeolocationLookupError extends Error {
  public readonly code: number;

  constructor(message: string, code: number) {
    super(message);
    this.name = 'GeolocationLookupError';
    this.code = code;
  }
}

export interface CoordenadasUbicacion {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface GeolocationLike {
  getCurrentPosition: (
    successCallback: (position: {
      coords: { latitude: number; longitude: number; accuracy?: number };
    }) => void,
    errorCallback?: (error: { code?: number; message?: string }) => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number }
  ) => void;
}

let permisoDenegadoEnSesion = false;

export function isGeolocationPermissionDeniedInSession(): boolean {
  return permisoDenegadoEnSesion;
}

export function resetGeolocationSessionState(): void {
  permisoDenegadoEnSesion = false;
}

export function mapearErrorGeolocalizacion(code?: number): GeolocationLookupError {
  if (code === 1) {
    return new GeolocationLookupError(GEO_ERR_PERMISSION_DENIED, 1);
  }
  if (code === 2) {
    return new GeolocationLookupError(GEO_ERR_POSITION_UNAVAILABLE, 2);
  }
  if (code === 3) {
    return new GeolocationLookupError(GEO_ERR_TIMEOUT, 3);
  }
  return new GeolocationLookupError(GEO_ERR_POSITION_UNAVAILABLE, code ?? 0);
}

export function solicitarUbicacionActual(
  geolocation?: GeolocationLike | null,
  options?: { permissionAlreadyDenied?: boolean }
): Promise<CoordenadasUbicacion> {
  const geo =
    geolocation !== undefined
      ? geolocation
      : typeof navigator !== 'undefined'
      ? (navigator.geolocation as GeolocationLike | undefined)
      : undefined;

  if (!geo || typeof geo.getCurrentPosition !== 'function') {
    return Promise.reject(new GeolocationLookupError(GEO_ERR_UNSUPPORTED, 0));
  }

  if (options?.permissionAlreadyDenied || (geolocation === undefined && permisoDenegadoEnSesion)) {
    return Promise.reject(new GeolocationLookupError(GEO_ERR_PERMISSION_DENIED, 1));
  }

  return new Promise((resolve, reject) => {
    try {
      geo.getCurrentPosition(
        (pos) => {
          const lat = pos?.coords?.latitude;
          const lng = pos?.coords?.longitude;
          if (
            typeof lat !== 'number' ||
            typeof lng !== 'number' ||
            !Number.isFinite(lat) ||
            !Number.isFinite(lng)
          ) {
            reject(new GeolocationLookupError(GEO_ERR_POSITION_UNAVAILABLE, 2));
            return;
          }
          resolve({
            lat,
            lng,
            accuracy: pos?.coords?.accuracy,
          });
        },
        (geoErr) => {
          if (geoErr?.code === 1 && geolocation === undefined) {
            permisoDenegadoEnSesion = true;
          }
          reject(mapearErrorGeolocalizacion(geoErr?.code));
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 30000,
        }
      );
    } catch {
      reject(new GeolocationLookupError(GEO_ERR_POSITION_UNAVAILABLE, 2));
    }
  });
}
