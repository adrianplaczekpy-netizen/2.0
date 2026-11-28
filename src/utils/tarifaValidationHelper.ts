/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const TARIFA_FIELD_ORDER = [
  'precio_m3',
  'consumo_minimo_m3',
  'monto_minimo_consumo',
  'monto_mora_fijo',
  'monto_reconexion',
  'erssan_porcentaje',
  'dia_vencimiento_boletas_normales',
  'dia_vencimiento_tercera_boleta',
  'umbral_alerta_consumo',
  'max_numero_medidor',
  'texto_alerta_consumo',
  'timbrado',
  'timbrado_inicio_vigencia',
  'timbrado_fin_vigencia',
  'vigente_desde',
] as const;

export function seleccionarPrimerCampoConError(
  errores: Record<string, string>
): string | null {
  for (const field of TARIFA_FIELD_ORDER) {
    if (errores[field]) {
      return field;
    }
  }
  const keys = Object.keys(errores);
  return keys.length > 0 ? keys[0] : null;
}

export function construirMensajeResumenErroresTarifa(
  errores: Record<string, string>
): string {
  const primerCampo = seleccionarPrimerCampoConError(errores);
  if (!primerCampo) {
    return 'Por favor corrija los campos con errores antes de guardar.';
  }
  const total = Object.keys(errores).length;
  const detalle = `Error en ${primerCampo}: ${errores[primerCampo]}`;
  return total > 1 ? `${detalle} (${total} campos con error)` : detalle;
}
