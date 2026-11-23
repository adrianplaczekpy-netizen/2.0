/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const AGUATERIA_UBICACION = {
  lat: -25.3913319,
  lng: -57.3848892,
  zoom: 15,
  nombre: 'Aguatería',
} as const;

export const ZONAS_AGUATERIA_SECTOR = [
  'SAN GABRIEL',
  'SAN JOSE',
  'LAS ROSAS',
  'RESIDENCIAL',
  'DON FELIX',
  'MBOKAJATY DEL SUR',
] as const;

export type ZonaAguateriaSector = (typeof ZONAS_AGUATERIA_SECTOR)[number];

export const ZONA_AGUATERIA_DEFAULT: ZonaAguateriaSector = ZONAS_AGUATERIA_SECTOR[0];

function quitarAcentosYMayusculas(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

/**
 * Resuelve un valor de zona guardado previamente a una de las 6 zonas oficiales del sector.
 * Si el valor pertenece a una zona eliminada o vacía, devuelve ZONA_AGUATERIA_DEFAULT.
 */
export function resolverZonaParaEdicion(zonaActual?: string | null): ZonaAguateriaSector {
  if (!zonaActual) return ZONA_AGUATERIA_DEFAULT;
  const normalizada = quitarAcentosYMayusculas(zonaActual);
  const encontrada = ZONAS_AGUATERIA_SECTOR.find(
    (z) => quitarAcentosYMayusculas(z) === normalizada
  );
  return encontrada ?? ZONA_AGUATERIA_DEFAULT;
}

