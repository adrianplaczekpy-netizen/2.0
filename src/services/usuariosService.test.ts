/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMobileMoreNavItems,
  getMobilePrimaryNavItems,
  getVisibleSidebarNavItems,
} from './navigationHelpers';
import {
  puedeGestionarUsuarios,
  validarNuevoUsuario,
  validarEdicionUsuario,
  extraerMensajeErrorEdgeFunction,
  listarUsuariosAsync,
  crearUsuarioAsync,
  actualizarUsuarioAsync,
} from './usuariosService';
import { UserRole } from '../types';

interface SimAuthUser {
  id: string;
  email: string;
  password: string;
  user_metadata: { nombre_completo: string };
  app_metadata: { rol: UserRole };
  ban_duration?: string;
  created_at: string;
}

interface SimUsuarioRow {
  id: string;
  email: string;
  nombre_completo: string;
  activo: boolean;
  fecha_creacion: string;
}

interface SimUserRoleRow {
  user_id: string;
  rol: UserRole;
  updated_at: string;
}

/**
 * Simula Supabase Auth + trigger handle_new_user + tablas public.usuarios/public.user_roles
 * + funciones SQL is_admin()/get_user_rol() + Edge Functions crear-usuario/actualizar-usuario.
 */
function createMockSupabaseEnvironment(initialAdminId = '11111111-1111-4111-8111-111111111111') {
  const now = '2026-11-18T10:00:00.000Z';
  const authUsers: SimAuthUser[] = [
    {
      id: initialAdminId,
      email: 'admin@aguateria.py',
      password: 'PasswordAdmin123',
      user_metadata: { nombre_completo: 'Carlos Administrador' },
      app_metadata: { rol: 'admin' },
      ban_duration: 'none',
      created_at: now,
    },
  ];
  const usuariosRows: SimUsuarioRow[] = [
    {
      id: initialAdminId,
      email: 'admin@aguateria.py',
      nombre_completo: 'Carlos Administrador',
      activo: true,
      fecha_creacion: now,
    },
  ];
  const userRolesRows: SimUserRoleRow[] = [
    {
      user_id: initialAdminId,
      rol: 'admin',
      updated_at: now,
    },
  ];

  let currentCallerId = initialAdminId;
  let seq = 2;

  const getUserRolSql = (userId: string): string => {
    const u = usuariosRows.find((row) => row.id === userId);
    if (u && u.activo === false) return 'inactivo';
    const r = userRolesRows.find((row) => row.user_id === userId);
    return r?.rol ?? 'lectura';
  };

  const isAdminSql = (userId: string): boolean => getUserRolSql(userId) === 'admin';

  // Simulación del trigger handle_new_user en auth.users
  const runHandleNewUserTrigger = (authUser: SimAuthUser) => {
    usuariosRows.push({
      id: authUser.id,
      email: authUser.email,
      nombre_completo: authUser.user_metadata.nombre_completo,
      activo: true,
      fecha_creacion: authUser.created_at,
    });
    userRolesRows.push({
      user_id: authUser.id,
      rol: authUser.app_metadata.rol,
      updated_at: authUser.created_at,
    });
  };

  const signInWithPassword = async (email: string, password: string) => {
    const cleanEmail = email.trim().toLowerCase();
    const found = authUsers.find((u) => u.email === cleanEmail);
    if (!found || found.password !== password) {
      return { data: { user: null }, error: { message: 'Invalid login credentials' } };
    }
    if (found.ban_duration && found.ban_duration !== 'none') {
      return { data: { user: null }, error: { message: 'User is banned' } };
    }
    const perfil = usuariosRows.find((u) => u.id === found.id);
    if (perfil && perfil.activo === false) {
      return { data: { user: null }, error: { message: 'Usuario inactivo' } };
    }
    return {
      data: {
        user: {
          id: found.id,
          email: found.email,
          rolActual: getUserRolSql(found.id),
        },
      },
      error: null,
    };
  };

  const client = {
    setCaller: (userId: string) => {
      currentCallerId = userId;
    },
    from: (table: string) => {
      return {
        select: (_cols: string) => {
          const execute = async () => {
            if (!isAdminSql(currentCallerId)) {
              // RLS: usuario normal solo ve su propio perfil/rol
              if (table === 'usuarios') {
                return {
                  data: usuariosRows.filter((u) => u.id === currentCallerId),
                  error: null,
                };
              }
              if (table === 'user_roles') {
                return {
                  data: userRolesRows.filter((r) => r.user_id === currentCallerId),
                  error: null,
                };
              }
            }
            if (table === 'usuarios') {
              return { data: usuariosRows.map((u) => ({ ...u })), error: null };
            }
            if (table === 'user_roles') {
              return { data: userRolesRows.map((r) => ({ ...r })), error: null };
            }
            return { data: [], error: null };
          };
          return {
            order: () => execute(),
            then: (resolve: any, reject: any) => execute().then(resolve, reject),
          };
        },
      };
    },
    functions: {
      invoke: async (fnName: string, options: { body: any }) => {
        // Verificar is_admin() como en Edge Function
        if (!isAdminSql(currentCallerId)) {
          return {
            data: null,
            error: {
              context: {
                json: async () => ({
                  error: 'Acceso denegado: solo los administradores pueden gestionar usuarios.',
                }),
              },
            },
          };
        }

        const body = options.body || {};

        if (fnName === 'crear-usuario') {
          const email = String(body.email || '').trim().toLowerCase();
          if (authUsers.some((u) => u.email === email)) {
            return {
              data: null,
              error: {
                context: {
                  json: async () => ({
                    error: `Ya existe un usuario registrado con el correo "${email}".`,
                  }),
                },
              },
            };
          }

          const newId = `22222222-2222-4222-8222-22222222220${seq++}`;
          const created: SimAuthUser = {
            id: newId,
            email,
            password: String(body.password),
            user_metadata: { nombre_completo: String(body.nombre_completo).trim() },
            app_metadata: { rol: body.rol as UserRole },
            ban_duration: 'none',
            created_at: '2026-11-18T11:00:00.000Z',
          };
          authUsers.push(created);
          runHandleNewUserTrigger(created);

          const perfil = usuariosRows.find((u) => u.id === newId)!;
          const rolRow = userRolesRows.find((r) => r.user_id === newId)!;
          return {
            data: {
              usuario: {
                id: perfil.id,
                email: perfil.email,
                nombre_completo: perfil.nombre_completo,
                rol: rolRow.rol,
                activo: perfil.activo,
                fecha_creacion: perfil.fecha_creacion,
              },
            },
            error: null,
          };
        }

        if (fnName === 'actualizar-usuario') {
          const targetId = String(body.user_id);
          const perfil = usuariosRows.find((u) => u.id === targetId);
          const rolRow = userRolesRows.find((r) => r.user_id === targetId);
          const authUser = authUsers.find((u) => u.id === targetId);
          if (!perfil || !rolRow || !authUser) {
            return {
              data: null,
              error: { context: { json: async () => ({ error: 'Usuario no encontrado.' }) } },
            };
          }

          if (targetId === currentCallerId) {
            if (body.rol !== undefined && body.rol !== rolRow.rol) {
              return {
                data: null,
                error: {
                  context: {
                    json: async () => ({ error: 'No podés cambiar tu propio rol de administrador.' }),
                  },
                },
              };
            }
            if (body.activo === false) {
              return {
                data: null,
                error: {
                  context: {
                    json: async () => ({ error: 'No podés desactivar tu propia cuenta.' }),
                  },
                },
              };
            }
          }

          const activosIds = new Set(usuariosRows.filter((u) => u.activo !== false).map((u) => u.id));
          const adminsActivos = userRolesRows.filter(
            (r) => r.rol === 'admin' && activosIds.has(r.user_id)
          );
          const pierdeAdmin =
            body.activo === false || (body.rol !== undefined && body.rol !== 'admin');
          if (rolRow.rol === 'admin' && perfil.activo && pierdeAdmin && adminsActivos.length <= 1) {
            return {
              data: null,
              error: {
                context: {
                  json: async () => ({
                    error:
                      'No se puede desactivar ni cambiar el rol del último administrador activo del sistema.',
                  }),
                },
              },
            };
          }

          if (body.nombre_completo !== undefined) {
            perfil.nombre_completo = String(body.nombre_completo).trim();
            authUser.user_metadata.nombre_completo = perfil.nombre_completo;
          }
          if (body.activo !== undefined) {
            perfil.activo = Boolean(body.activo);
            authUser.ban_duration = perfil.activo ? 'none' : '876000h';
          }
          if (body.rol !== undefined) {
            rolRow.rol = body.rol as UserRole;
            authUser.app_metadata.rol = rolRow.rol;
          }

          return {
            data: {
              usuario: {
                id: perfil.id,
                email: perfil.email,
                nombre_completo: perfil.nombre_completo,
                rol: rolRow.rol,
                activo: perfil.activo,
                fecha_creacion: perfil.fecha_creacion,
              },
            },
            error: null,
          };
        }

        return { data: null, error: { message: 'Unknown function' } };
      },
    },
  };

  return {
    client,
    authUsers,
    usuariosRows,
    userRolesRows,
    signInWithPassword,
    getUserRolSql,
    isAdminSql,
  };
}

test('1. Navegación y control de acceso: "Usuarios" visible y habilitado exclusivamente para rol admin', () => {
  const adminNav = getVisibleSidebarNavItems('admin');
  const cobradorNav = getVisibleSidebarNavItems('cobrador');
  const lecturaNav = getVisibleSidebarNavItems('lectura');
  const anonNav = getVisibleSidebarNavItems(undefined);

  const usuariosAdmin = adminNav.find((i) => i.id === 'usuarios');
  assert.ok(usuariosAdmin, 'Admin debe ver Usuarios en Sidebar / Más');
  assert.equal(usuariosAdmin?.label, 'Usuarios');
  assert.equal(usuariosAdmin?.adminOnly, true);

  assert.equal(cobradorNav.some((i) => i.id === 'usuarios'), false);
  assert.equal(lecturaNav.some((i) => i.id === 'usuarios'), false);
  assert.equal(anonNav.some((i) => i.id === 'usuarios'), false);

  assert.equal(puedeGestionarUsuarios('admin'), true);
  assert.equal(puedeGestionarUsuarios('cobrador'), false);
  assert.equal(puedeGestionarUsuarios('lectura'), false);
  assert.equal(puedeGestionarUsuarios(undefined), false);
});

test('2. Crear usuario cobrador crea filas en auth.users, public.usuarios y public.user_roles, y rechaza emails duplicados', async () => {
  const env = createMockSupabaseEnvironment();

  const creado = await crearUsuarioAsync(
    {
      email: 'Cobrador.Nuevo@aguateria.py ',
      password: 'ClaveSegura2026',
      nombre_completo: 'Ramona Benítez',
      rol: 'cobrador',
      callerRol: 'admin',
    },
    { clientOverride: env.client }
  );

  assert.equal(creado.email, 'cobrador.nuevo@aguateria.py');
  assert.equal(creado.nombre_completo, 'Ramona Benítez');
  assert.equal(creado.rol, 'cobrador');
  assert.equal(creado.activo, true);

  // Verificar persistencia sincronizada en las 3 tablas/estructuras
  assert.equal(env.authUsers.length, 2);
  assert.equal(env.usuariosRows.length, 2);
  assert.equal(env.userRolesRows.length, 2);
  assert.equal(env.userRolesRows.find((r) => r.user_id === creado.id)?.rol, 'cobrador');

  const listado = await listarUsuariosAsync({
    callerRol: 'admin',
    clientOverride: env.client,
  });
  assert.equal(listado.length, 2);

  // Email duplicado retorna error claro
  await assert.rejects(
    () =>
      crearUsuarioAsync(
        {
          email: 'cobrador.nuevo@aguateria.py',
          password: 'OtraClave2026',
          nombre_completo: 'Duplicada',
          rol: 'cobrador',
          callerRol: 'admin',
        },
        { clientOverride: env.client }
      ),
    /Ya existe un usuario registrado/
  );
});

test('3. Login con usuario creado funciona; al desactivar (activo = false) queda bloqueado y get_user_rol retorna inactivo', async () => {
  const env = createMockSupabaseEnvironment();

  const creado = await crearUsuarioAsync(
    {
      email: 'cajero@aguateria.py',
      password: 'ClaveCajero2026',
      nombre_completo: 'Lucía Cáceres',
      rol: 'cobrador',
      callerRol: 'admin',
    },
    { clientOverride: env.client }
  );

  // Login funciona mientras está activo
  const loginOk = await env.signInWithPassword('cajero@aguateria.py', 'ClaveCajero2026');
  assert.equal(loginOk.error, null);
  assert.equal(loginOk.data.user?.id, creado.id);
  assert.equal(env.getUserRolSql(creado.id), 'cobrador');

  // Desactivar usuario
  const listadoAntes = await listarUsuariosAsync({
    callerRol: 'admin',
    clientOverride: env.client,
  });
  const desactivado = await actualizarUsuarioAsync(
    {
      targetUser: creado,
      currentAdminId: env.authUsers[0].id,
      allUsers: listadoAntes,
      callerRol: 'admin',
      cambios: { activo: false },
    },
    { clientOverride: env.client }
  );

  assert.equal(desactivado.activo, false);
  assert.equal(env.authUsers.find((u) => u.id === creado.id)?.ban_duration, '876000h');
  // Trigger/función SQL get_user_rol retorna 'inactivo' -> sin permisos RLS
  assert.equal(env.getUserRolSql(creado.id), 'inactivo');
  assert.equal(env.isAdminSql(creado.id), false);

  // Login queda bloqueado
  const loginBloqueado = await env.signInWithPassword('cajero@aguateria.py', 'ClaveCajero2026');
  assert.equal(loginBloqueado.data.user, null);
  assert.ok(loginBloqueado.error?.message.includes('banned'));
});

test('4. Cambiar rol de usuario se refleja en public.user_roles, auth app_metadata y get_user_rol', async () => {
  const env = createMockSupabaseEnvironment();

  const creado = await crearUsuarioAsync(
    {
      email: 'operario@aguateria.py',
      password: 'ClaveOperario2026',
      nombre_completo: 'Mateo Vera',
      rol: 'lectura',
      callerRol: 'admin',
    },
    { clientOverride: env.client }
  );

  const listado = await listarUsuariosAsync({
    callerRol: 'admin',
    clientOverride: env.client,
  });

  const promovido = await actualizarUsuarioAsync(
    {
      targetUser: creado,
      currentAdminId: env.authUsers[0].id,
      allUsers: listado,
      callerRol: 'admin',
      cambios: { nombre_completo: 'Mateo Vera (Caja)', rol: 'cobrador' },
    },
    { clientOverride: env.client }
  );

  assert.equal(promovido.rol, 'cobrador');
  assert.equal(promovido.nombre_completo, 'Mateo Vera (Caja)');
  assert.equal(env.userRolesRows.find((r) => r.user_id === creado.id)?.rol, 'cobrador');
  assert.equal(env.authUsers.find((u) => u.id === creado.id)?.app_metadata.rol, 'cobrador');
  assert.equal(env.getUserRolSql(creado.id), 'cobrador');
});

test('5. Reglas de seguridad: no-admin rechazado, último admin protegido y admin actual no puede auto-degradarse', async () => {
  const env = createMockSupabaseEnvironment();
  const adminId = env.authUsers[0].id;

  const cobrador = await crearUsuarioAsync(
    {
      email: 'cobrador2@aguateria.py',
      password: 'Password2026',
      nombre_completo: 'Pedro Cobrador',
      rol: 'cobrador',
      callerRol: 'admin',
    },
    { clientOverride: env.client }
  );

  const todos = await listarUsuariosAsync({
    callerRol: 'admin',
    clientOverride: env.client,
  });
  const adminPerfil = todos.find((u) => u.id === adminId)!;

  // No se puede desactivar el último admin activo ni cambiar su propio rol
  const checkSelfRole = validarEdicionUsuario({
    targetUser: adminPerfil,
    currentAdminId: adminId,
    allUsers: todos,
    cambios: { rol: 'cobrador' },
  });
  assert.equal(checkSelfRole.ok, false);

  await assert.rejects(
    () =>
      actualizarUsuarioAsync(
        {
          targetUser: adminPerfil,
          currentAdminId: adminId,
          allUsers: todos,
          callerRol: 'admin',
          cambios: { activo: false },
        },
        { clientOverride: env.client }
      ),
    /No podés desactivar tu propia cuenta/
  );

  // Otro admin tampoco puede desactivar al último administrador activo
  const otroAdminId = '99999999-9999-4999-8999-999999999999';
  const checkUltimoAdmin = validarEdicionUsuario({
    targetUser: adminPerfil,
    currentAdminId: otroAdminId,
    allUsers: todos,
    cambios: { activo: false },
  });
  assert.equal(checkUltimoAdmin.ok, false);
  if (checkUltimoAdmin.ok === false) {
    assert.match(checkUltimoAdmin.error, /último administrador activo/);
  }

  // Cobrador no puede invocar crear/listar/actualizar ni en servicio ni en backend
  await assert.rejects(
    () =>
      listarUsuariosAsync({
        callerRol: 'cobrador',
        clientOverride: env.client,
      }),
    /Acceso denegado/
  );

  await assert.rejects(
    () =>
      crearUsuarioAsync(
        {
          email: 'x@aguateria.py',
          password: 'Password2026',
          nombre_completo: 'Test',
          rol: 'lectura',
          callerRol: 'lectura',
        },
        { clientOverride: env.client }
      ),
    /Acceso denegado/
  );

  // Even bypassing callerRol check, backend is_admin() rejects cobrador caller
  env.client.setCaller(cobrador.id);
  const { error: backendDenied } = await env.client.functions.invoke('crear-usuario', {
    body: {
      email: 'intruso@aguateria.py',
      password: 'Password2026',
      nombre_completo: 'Intruso',
      rol: 'admin',
    },
  });
  const msg = await extraerMensajeErrorEdgeFunction(backendDenied, 'fallback');
  assert.match(msg, /Acceso denegado/);
});

test('6. Validaciones de entrada para nuevo usuario', () => {
  assert.equal(
    validarNuevoUsuario({
      email: 'invalido',
      password: 'Password123',
      nombre_completo: 'Ana',
      rol: 'cobrador',
    }).ok,
    false
  );
  assert.equal(
    validarNuevoUsuario({
      email: 'ana@aguateria.py',
      password: '123',
      nombre_completo: 'Ana',
      rol: 'cobrador',
    }).ok,
    false
  );
  assert.equal(
    validarNuevoUsuario({
      email: 'ana@aguateria.py',
      password: 'Password123',
      nombre_completo: 'A',
      rol: 'cobrador',
    }).ok,
    false
  );
});

test('7. Regresión: admin desactiva a otro usuario (rol lectura) sin confundir IDs', async () => {
  const env = createMockSupabaseEnvironment('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  const adminId = env.authUsers[0].id;

  const lector = await crearUsuarioAsync(
    {
      email: 'adannsilvero@gmail.com',
      password: 'ClaveLector2026',
      nombre_completo: 'Adann Silvero',
      rol: 'lectura',
      callerRol: 'admin',
    },
    { clientOverride: env.client }
  );

  const todos = await listarUsuariosAsync({
    callerRol: 'admin',
    clientOverride: env.client,
  });

  // Solo bloquea si targetUser.id === adminId (incluso con distinta capitalización)
  const autoCheck = validarEdicionUsuario({
    targetUser: todos.find((u) => u.id === adminId)!,
    currentAdminId: adminId.toUpperCase(),
    allUsers: todos,
    cambios: { activo: false },
  });
  assert.equal(autoCheck.ok, false);

  // Para otro usuario (lector) sí permite desactivar y envía el ID del lector
  let sentUserId = '';
  const spyClient = {
    from: env.client.from,
    functions: {
      invoke: async (fnName: string, opts: { body: any }) => {
        sentUserId = opts.body.user_id;
        return env.client.functions.invoke(fnName, opts);
      },
    },
  };

  const res = await actualizarUsuarioAsync(
    {
      targetUser: lector,
      currentAdminId: adminId,
      allUsers: todos,
      callerRol: 'admin',
      cambios: { activo: false },
    },
    { clientOverride: spyClient }
  );

  assert.equal(sentUserId, lector.id);
  assert.notEqual(sentUserId, adminId);
  assert.equal(res.activo, false);
});

test('8. Trigger proteger_campos_usuario: admin y service_role pueden cambiar activo, no-admin no puede auto-desactivarse ni cambiar email', () => {
  // Réplica fiel de la lógica SQL de public.proteger_campos_usuario():
  // IF NEW.id = auth.uid() AND NOT public.is_admin() THEN ...
  const simularTriggerProtegerCamposUsuario = (params: {
    authUid: string | null; // NULL cuando ejecuta service_role
    isAdmin: boolean;
    oldRow: { id: string; activo: boolean; email: string };
    newRow: { id: string; activo: boolean; email: string };
  }) => {
    const { authUid, isAdmin, oldRow, newRow } = params;
    // En SQL: NULL = UUID evalúa NULL (falsy)
    const esAutoEdicionNoAdmin = authUid !== null && newRow.id === authUid && !isAdmin;
    if (esAutoEdicionNoAdmin) {
      if (newRow.activo !== oldRow.activo) {
        throw new Error('Operación denegada: No podés cambiar tu estado activo');
      }
      if (newRow.email !== oldRow.email) {
        throw new Error('Operación denegada: No podés cambiar tu email directamente');
      }
    }
    return newRow;
  };

  const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const cobradorRow = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    activo: true,
    email: 'cobrador@aguateria.py',
  };

  // A. Admin desactiva a otro usuario -> permitido
  const porAdmin = simularTriggerProtegerCamposUsuario({
    authUid: adminId,
    isAdmin: true,
    oldRow: cobradorRow,
    newRow: { ...cobradorRow, activo: false },
  });
  assert.equal(porAdmin.activo, false);

  // B. Usuario NO-admin intenta cambiar su propio activo -> bloqueado
  assert.throws(
    () =>
      simularTriggerProtegerCamposUsuario({
        authUid: cobradorRow.id,
        isAdmin: false,
        oldRow: cobradorRow,
        newRow: { ...cobradorRow, activo: false },
      }),
    /No podés cambiar tu estado activo/
  );

  // B2. Usuario NO-admin intenta cambiar su propio email -> bloqueado
  assert.throws(
    () =>
      simularTriggerProtegerCamposUsuario({
        authUid: cobradorRow.id,
        isAdmin: false,
        oldRow: cobradorRow,
        newRow: { ...cobradorRow, email: 'otro@aguateria.py' },
      }),
    /No podés cambiar tu email directamente/
  );

  // C. service_role (auth.uid() = NULL) cambia activo de cualquier usuario -> permitido
  const porServiceRole = simularTriggerProtegerCamposUsuario({
    authUid: null,
    isAdmin: false,
    oldRow: cobradorRow,
    newRow: { ...cobradorRow, activo: false },
  });
  assert.equal(porServiceRole.activo, false);
});

test('9. Navegación móvil única: barra inferior tiene 4 primarios + Más (5 items) y Más filtra módulos adminOnly según rol', () => {
  for (const rol of ['admin', 'cobrador', 'lectura'] as const) {
    const primarios = getMobilePrimaryNavItems(rol);
    assert.equal(primarios.length, 4);
    assert.deepEqual(
      primarios.map((i) => i.label),
      ['Dashboard', 'Clientes', 'Medidores', 'Lecturas']
    );
  }

  const masAdmin = getMobileMoreNavItems('admin');
  assert.deepEqual(
    masAdmin.map((i) => i.label),
    [
      'Otros Trabajos',
      'Mapa',
      'Facturación',
      'Pagos',
      'Corte y Reconexión',
      'Reportes',
      'Usuarios',
      'Configuración',
    ]
  );

  for (const rolNoAdmin of ['cobrador', 'lectura', undefined] as const) {
    const mas = getMobileMoreNavItems(rolNoAdmin);
    assert.deepEqual(
      mas.map((i) => i.label),
      ['Otros Trabajos', 'Mapa', 'Facturación', 'Pagos', 'Reportes']
    );
    assert.equal(mas.some((i) => i.adminOnly), false);
    assert.equal(mas.some((i) => i.id === 'cortes' || i.id === 'usuarios' || i.id === '/admin/configuracion/tarifas'), false);
  }
});

test('10. Sin navegación duplicada: elimina hamburguesa y drawer móvil, sidebar exclusivo md:flex y barra inferior md:hidden', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');

  const sidebarSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/Sidebar.tsx'), 'utf8');
  const headerSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/Header.tsx'), 'utf8');
  const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
  const navbarSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/Navbar.tsx'), 'utf8');

  // Sidebar: desktop >= 768px (hidden md:flex) y móvil < 768px (md:hidden grid grid-cols-5), sin drawer
  assert.match(sidebarSrc, /<aside className="hidden md:flex md:flex-col/);
  assert.match(sidebarSrc, /aria-label="Navegación móvil"[\s\S]*md:hidden grid grid-cols-5/);
  assert.equal(/isOpenMobile|setIsOpenMobile|-translate-x-full/.test(sidebarSrc), false);

  // Header: sin botón hamburguesa, mantiene nombre + rol + cambiar contraseña + cerrar sesión
  assert.equal(/onToggleMobileMenu|Abrir menú|<Menu\b/.test(headerSrc), false);
  assert.match(headerSrc, /getRoleBadge\(user\?\.rol\)/);
  assert.match(headerSrc, /Cambiar contraseña/);
  assert.match(headerSrc, /Cerrar sesión/);

  // App: sin estado de drawer móvil
  assert.equal(/mobileMenuOpen|setMobileMenuOpen|onToggleMobileMenu|isOpenMobile/.test(appSrc), false);

  // Navbar: nav restringido a desktop (>= 768px)
  assert.match(navbarSrc, /<nav className="hidden md:flex/);
});
