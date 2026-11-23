/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserRole, UsuarioPerfil } from '../types';
import { supabase, isSupabaseConfigured, USUARIOS_DEMO } from './supabaseClient';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES_VALIDOS = new Set<UserRole>(['admin', 'cobrador', 'lectura']);

export function puedeGestionarUsuarios(rol?: UserRole): boolean {
  return rol === 'admin';
}

export function validarNuevoUsuario(params: {
  email: string;
  password: string;
  nombre_completo: string;
  rol: UserRole;
}): { ok: true; email: string; nombre_completo: string; rol: UserRole } | { ok: false; error: string } {
  const email = (params.email || '').trim().toLowerCase();
  const password = params.password || '';
  const nombre_completo = (params.nombre_completo || '').trim();
  const rol = params.rol;

  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, error: 'Ingresá un correo electrónico válido.' };
  }
  if (password.length < 8) {
    return {
      ok: false,
      error: 'La contraseña inicial debe tener al menos 8 caracteres.',
    };
  }
  if (nombre_completo.length < 2) {
    return {
      ok: false,
      error: 'El nombre completo debe tener al menos 2 caracteres.',
    };
  }
  if (!ROLES_VALIDOS.has(rol)) {
    return { ok: false, error: 'Seleccioná un rol válido (admin, cobrador o lectura).' };
  }

  return { ok: true, email, nombre_completo, rol };
}

export function validarEdicionUsuario(params: {
  targetUser: UsuarioPerfil;
  currentAdminId?: string;
  allUsers: UsuarioPerfil[];
  cambios: {
    nombre_completo?: string;
    rol?: UserRole;
    activo?: boolean;
  };
}): { ok: true } | { ok: false; error: string } {
  const { targetUser, currentAdminId, allUsers, cambios } = params;

  if (cambios.nombre_completo !== undefined && cambios.nombre_completo.trim().length < 2) {
    return {
      ok: false,
      error: 'El nombre completo debe tener al menos 2 caracteres.',
    };
  }

  if (cambios.rol !== undefined && !ROLES_VALIDOS.has(cambios.rol)) {
    return { ok: false, error: 'Rol inválido.' };
  }

  // El administrador actual no puede cambiar su propio rol ni auto-desactivarse
  const esMismoUsuario = Boolean(
    currentAdminId &&
      targetUser.id &&
      targetUser.id.trim().toLowerCase() === currentAdminId.trim().toLowerCase()
  );
  if (esMismoUsuario) {
    if (cambios.rol !== undefined && cambios.rol !== targetUser.rol) {
      return {
        ok: false,
        error: 'No podés cambiar tu propio rol de administrador.',
      };
    }
    if (cambios.activo === false) {
      return {
        ok: false,
        error: 'No podés desactivar tu propia cuenta.',
      };
    }
  }

  // Protección del último administrador activo del sistema
  const adminsActivos = allUsers.filter(
    (u) => u.rol === 'admin' && u.activo !== false
  );
  const esTargetAdminActivo =
    targetUser.rol === 'admin' && targetUser.activo !== false;
  const pierdeAdmin =
    cambios.activo === false ||
    (cambios.rol !== undefined && cambios.rol !== 'admin');

  if (esTargetAdminActivo && pierdeAdmin && adminsActivos.length <= 1) {
    return {
      ok: false,
      error:
        'No se puede desactivar ni cambiar el rol del último administrador activo del sistema.',
    };
  }

  return { ok: true };
}

export async function extraerMensajeErrorEdgeFunction(
  error: any,
  fallback: string
): Promise<string> {
  if (!error) return fallback;

  try {
    if (error.context && typeof error.context.json === 'function') {
      const payload = await error.context.json();
      if (payload && typeof payload.error === 'string' && payload.error.trim()) {
        return payload.error;
      }
    }
  } catch {
    // Continuar con fallback de texto o error.message
  }

  try {
    if (error.context && typeof error.context.text === 'function') {
      const text = await error.context.text();
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
          return parsed.error;
        }
      }
    }
  } catch {
    // Ignorar error de parseo
  }

  if (typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

const DEMO_USUARIOS_FALLBACK: UsuarioPerfil[] = Object.values(USUARIOS_DEMO).map((u) => ({
  id: u.id,
  email: u.email,
  nombre_completo: u.nombre,
  rol: u.rol,
  activo: true,
  fecha_creacion: '2026-01-01T00:00:00.000Z',
}));

export async function listarUsuariosAsync(params: {
  callerRol?: UserRole;
  clientOverride?: any;
}): Promise<UsuarioPerfil[]> {
  if (!puedeGestionarUsuarios(params.callerRol)) {
    throw new Error('Acceso denegado: solo los administradores pueden consultar la lista de usuarios.');
  }

  const sb = params.clientOverride ?? (isSupabaseConfigured ? supabase : null);
  if (!sb) {
    return DEMO_USUARIOS_FALLBACK.map((u) => ({ ...u }));
  }

  const [{ data: usuariosData, error: usrErr }, { data: rolesData, error: rolErr }] =
    await Promise.all([
      sb
        .from('usuarios')
        .select('id, email, nombre_completo, activo, fecha_creacion')
        .order('fecha_creacion', { ascending: false }),
      sb.from('user_roles').select('user_id, rol'),
    ]);

  if (usrErr) {
    throw new Error(`Error al cargar usuarios desde Supabase: ${usrErr.message}`);
  }
  if (rolErr) {
    throw new Error(`Error al cargar roles de usuario desde Supabase: ${rolErr.message}`);
  }

  const rolPorUsuario = new Map<string, UserRole>();
  for (const r of rolesData || []) {
    if (r?.user_id && r?.rol) {
      rolPorUsuario.set(r.user_id, r.rol as UserRole);
    }
  }

  return (usuariosData || []).map((u: any) => ({
    id: u.id,
    email: u.email,
    nombre_completo: u.nombre_completo,
    rol: rolPorUsuario.get(u.id) || 'lectura',
    activo: u.activo !== false,
    fecha_creacion: u.fecha_creacion,
  }));
}

export async function crearUsuarioAsync(
  params: {
    email: string;
    password: string;
    nombre_completo: string;
    rol: UserRole;
    callerRol?: UserRole;
  },
  options?: { clientOverride?: any }
): Promise<UsuarioPerfil> {
  if (!puedeGestionarUsuarios(params.callerRol)) {
    throw new Error('Acceso denegado: solo los administradores pueden crear usuarios.');
  }

  const valid = validarNuevoUsuario({
    email: params.email,
    password: params.password,
    nombre_completo: params.nombre_completo,
    rol: params.rol,
  });

  if (valid.ok === false) {
    throw new Error(valid.error);
  }

  const sb = options?.clientOverride ?? (isSupabaseConfigured ? supabase : null);
  if (!sb) {
    throw new Error(
      'La creación de usuarios requiere Supabase configurado y la Edge Function crear-usuario desplegada.'
    );
  }

  const { data, error } = await sb.functions.invoke('crear-usuario', {
    body: {
      email: valid.email,
      password: params.password,
      nombre_completo: valid.nombre_completo,
      rol: valid.rol,
    },
  });

  if (error) {
    const msg = await extraerMensajeErrorEdgeFunction(
      error,
      'No se pudo crear el usuario en Supabase.'
    );
    throw new Error(msg);
  }

  if (data?.error) {
    throw new Error(String(data.error));
  }

  if (!data?.usuario) {
    throw new Error('Respuesta inesperada de crear-usuario: no se recibió el perfil creado.');
  }

  return data.usuario as UsuarioPerfil;
}

export async function actualizarUsuarioAsync(
  params: {
    targetUser: UsuarioPerfil;
    currentAdminId?: string;
    allUsers: UsuarioPerfil[];
    callerRol?: UserRole;
    cambios: {
      nombre_completo?: string;
      rol?: UserRole;
      activo?: boolean;
    };
  },
  options?: { clientOverride?: any }
): Promise<UsuarioPerfil> {
  if (!puedeGestionarUsuarios(params.callerRol)) {
    throw new Error('Acceso denegado: solo los administradores pueden modificar usuarios.');
  }

  const valid = validarEdicionUsuario({
    targetUser: params.targetUser,
    currentAdminId: params.currentAdminId,
    allUsers: params.allUsers,
    cambios: params.cambios,
  });

  if (valid.ok === false) {
    throw new Error(valid.error);
  }

  const sb = options?.clientOverride ?? (isSupabaseConfigured ? supabase : null);
  if (!sb) {
    throw new Error(
      'La actualización de usuarios requiere Supabase configurado y la Edge Function actualizar-usuario desplegada.'
    );
  }

  const targetUserId = (params.targetUser?.id || '').trim();
  if (!targetUserId) {
    throw new Error('Falta el identificador del usuario a actualizar.');
  }

  const body: Record<string, unknown> = {
    user_id: targetUserId,
  };
  if (params.cambios.nombre_completo !== undefined) {
    body.nombre_completo = params.cambios.nombre_completo.trim();
  }
  if (params.cambios.rol !== undefined) {
    body.rol = params.cambios.rol;
  }
  if (params.cambios.activo !== undefined) {
    body.activo = params.cambios.activo;
  }

  const { data, error } = await sb.functions.invoke('actualizar-usuario', {
    body,
  });

  if (error) {
    const msg = await extraerMensajeErrorEdgeFunction(
      error,
      'No se pudo actualizar el usuario en Supabase.'
    );
    throw new Error(msg);
  }

  if (data?.error) {
    throw new Error(String(data.error));
  }

  if (!data?.usuario) {
    throw new Error('Respuesta inesperada de actualizar-usuario.');
  }

  return data.usuario as UsuarioPerfil;
}
