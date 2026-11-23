/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type CameraFacingMode = 'environment' | 'user';

export const CAMERA_OPEN_ERROR_MESSAGE =
  'No se pudo abrir la cámara. Probá subir la foto desde la galería o verificar los permisos del navegador.';

export interface NativeInputLike {
  click?: () => void;
  disabled?: boolean;
}

/**
 * Dispara el <input type="file" capture="environment" /> nativo en un solo toque.
 * Si el navegador/WebView bloquea el selector o el elemento no está disponible,
 * retorna el mensaje de error claro para ofrecer la galería o fallback.
 */
export function triggerNativeCameraInput(
  inputEl: NativeInputLike | null | undefined
): { ok: boolean; errorMessage: string | null } {
  if (!inputEl || inputEl.disabled || typeof inputEl.click !== 'function') {
    return {
      ok: false,
      errorMessage: CAMERA_OPEN_ERROR_MESSAGE,
    };
  }

  try {
    inputEl.click();
    return {
      ok: true,
      errorMessage: null,
    };
  } catch {
    return {
      ok: false,
      errorMessage: CAMERA_OPEN_ERROR_MESSAGE,
    };
  }
}

export interface MediaDevicesLike {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

export function buildCameraConstraints(
  facingMode: CameraFacingMode = 'environment',
  exact = false
): MediaStreamConstraints {
  return {
    video: {
      facingMode: exact ? { exact: facingMode } : { ideal: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  };
}

export function toggleCameraFacingMode(current: CameraFacingMode): CameraFacingMode {
  return current === 'environment' ? 'user' : 'environment';
}

export function getCameraFacingLabel(facingMode: CameraFacingMode): string {
  return facingMode === 'environment' ? 'Cámara Trasera' : 'Cámara Frontal (Selfie)';
}

/**
 * Solicita acceso a la cámara priorizando SIEMPRE la cámara trasera ('environment') por defecto.
 * Si el dispositivo no soporta la restricción exacta (ej: notebook sin cámara trasera),
 * hace fallback progresivo a ideal y luego a cualquier cámara disponible.
 */
export async function requestRearFirstCameraStream(
  mediaDevices: MediaDevicesLike | undefined | null,
  preferredFacing: CameraFacingMode = 'environment'
): Promise<{
  stream: MediaStream;
  activeFacingMode: CameraFacingMode;
  usedFallback: boolean;
}> {
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
    throw new Error('Este navegador no soporta acceso directo a la cámara (getUserMedia).');
  }

  let stream: MediaStream | null = null;
  let usedFallback = false;
  let activeFacingMode: CameraFacingMode = preferredFacing;

  // 1. Intentar restricción exacta para forzar lente trasera en celulares Android/iOS
  try {
    stream = await mediaDevices.getUserMedia(buildCameraConstraints(preferredFacing, true));
  } catch (errExact: any) {
    const errName = errExact?.name || '';
    // Si el usuario denegó permiso explícitamente, no reintentar
    if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
      throw errExact;
    }

    // 2. Fallback a facingMode ideal
    try {
      stream = await mediaDevices.getUserMedia(buildCameraConstraints(preferredFacing, false));
      usedFallback = true;
    } catch (errIdeal: any) {
      const idealName = errIdeal?.name || '';
      if (idealName === 'NotAllowedError' || idealName === 'PermissionDeniedError') {
        throw errIdeal;
      }

      // 3. Fallback final a cámara disponible (ej. cámara frontal en PC)
      stream = await mediaDevices.getUserMedia({ video: true, audio: false });
      usedFallback = true;
      activeFacingMode = preferredFacing === 'environment' ? 'user' : preferredFacing;
    }
  }

  const videoTrack = stream.getVideoTracks?.()[0];
  const reportedFacing = videoTrack?.getSettings?.()?.facingMode;
  if (reportedFacing === 'environment' || reportedFacing === 'user') {
    activeFacingMode = reportedFacing;
  }

  return {
    stream,
    activeFacingMode,
    usedFallback,
  };
}
