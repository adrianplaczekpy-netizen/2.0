/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserRole } from '../types';

export interface ValidacionCambioContrasenaInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ValidacionCambioContrasenaResult {
  valido: boolean;
  error?: string;
}

export interface SupabaseAuthPasswordClient {
  signInWithPassword: (credentials: {
    email: string;
    password: string;
  }) => Promise<{ data?: any; error: { message?: string } | null }>;
  updateUser: (attributes: {
    password: string;
  }) => Promise<{ data?: any; error: { message?: string } | null }>;
}

export const MIN_PASSWORD_LENGTH = 8;

export function puedeCambiarPropiaContrasena(rol?: UserRole | null): boolean {
  return rol === 'admin' || rol === 'cobrador' || rol === 'lectura';
}

export function validarCambioContrasena(
  input: ValidacionCambioContrasenaInput
): ValidacionCambioContrasenaResult {
  if (!input.currentPassword || input.currentPassword.length === 0) {
    return {
      valido: false,
      error: 'Ingresá tu contraseña actual.',
    };
  }

  if (!input.newPassword || input.newPassword.length < MIN_PASSWORD_LENGTH) {
    return {
      valido: false,
      error: `La contraseña nueva debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    };
  }

  if (input.newPassword !== input.confirmPassword) {
    return {
      valido: false,
      error: 'La confirmación no coincide con la contraseña nueva.',
    };
  }

  return { valido: true };
}

function traducirErrorAuthPassword(rawMessage?: string): string {
  const msg = (rawMessage || '').trim();
  const lower = msg.toLowerCase();

  if (
    lower.includes('invalid login credentials') ||
    lower.includes('invalid_credentials') ||
    lower.includes('wrong password')
  ) {
    return 'La contraseña actual es incorrecta.';
  }

  if (lower.includes('same password') || lower.includes('different from the old password')) {
    return 'La contraseña nueva debe ser diferente a la contraseña actual.';
  }

  if (lower.includes('at least') || lower.includes('weak') || lower.includes('short')) {
    return `La contraseña nueva debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }

  if (lower.includes('session') || lower.includes('not authenticated') || lower.includes('jwt')) {
    return 'Tu sesión expiró. Volvé a iniciar sesión e intentá nuevamente.';
  }

  return msg || 'No se pudo actualizar la contraseña.';
}

export async function cambiarContrasenaUsuario(params: {
  email?: string | null;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  authClient: SupabaseAuthPasswordClient | null;
}): Promise<{ ok: boolean; error?: string }> {
  const validacion = validarCambioContrasena({
    currentPassword: params.currentPassword,
    newPassword: params.newPassword,
    confirmPassword: params.confirmPassword,
  });

  if (!validacion.valido) {
    return { ok: false, error: validacion.error };
  }

  const email = (params.email || '').trim().toLowerCase();
  if (!email) {
    return {
      ok: false,
      error: 'No se encontró el correo del usuario autenticado.',
    };
  }

  if (!params.authClient) {
    return {
      ok: false,
      error: 'El cambio de contraseña requiere conexión activa con Supabase Auth.',
    };
  }

  // 1. Verificar contraseña actual con signInWithPassword
  const verifyRes = await params.authClient.signInWithPassword({
    email,
    password: params.currentPassword,
  });

  if (verifyRes?.error) {
    return {
      ok: false,
      error: traducirErrorAuthPassword(verifyRes.error.message),
    };
  }

  // 2. Si es correcta, actualizar contraseña con updateUser
  const updateRes = await params.authClient.updateUser({
    password: params.newPassword,
  });

  if (updateRes?.error) {
    return {
      ok: false,
      error: traducirErrorAuthPassword(updateRes.error.message),
    };
  }

  return { ok: true };
}
