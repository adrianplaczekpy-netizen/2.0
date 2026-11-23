/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  puedeCambiarPropiaContrasena,
  validarCambioContrasena,
  cambiarContrasenaUsuario,
  SupabaseAuthPasswordClient,
} from './passwordChange';

test('1. Visibilidad: admin, cobrador y lectura pueden acceder a Cambiar contraseña', () => {
  assert.equal(puedeCambiarPropiaContrasena('admin'), true);
  assert.equal(puedeCambiarPropiaContrasena('cobrador'), true);
  assert.equal(puedeCambiarPropiaContrasena('lectura'), true);
  assert.equal(puedeCambiarPropiaContrasena(null), false);
  assert.equal(puedeCambiarPropiaContrasena(undefined), false);
});

test('2. Validación: exige contraseña actual, mínimo 8 caracteres y coincidencia en confirmación', () => {
  const sinActual = validarCambioContrasena({
    currentPassword: '',
    newPassword: 'Password123',
    confirmPassword: 'Password123',
  });
  assert.equal(sinActual.valido, false);

  const corta = validarCambioContrasena({
    currentPassword: 'OldPassword1',
    newPassword: '1234567',
    confirmPassword: '1234567',
  });
  assert.equal(corta.valido, false);
  assert.match(corta.error || '', /8 caracteres/);

  const distinta = validarCambioContrasena({
    currentPassword: 'OldPassword1',
    newPassword: 'NewPassword1',
    confirmPassword: 'NewPassword2',
  });
  assert.equal(distinta.valido, false);
  assert.match(distinta.error || '', /no coincide/);

  const ok = validarCambioContrasena({
    currentPassword: 'OldPassword1',
    newPassword: 'NewPassword1',
    confirmPassword: 'NewPassword1',
  });
  assert.equal(ok.valido, true);
});

test('3. Contraseña actual incorrecta: signInWithPassword falla y NO llama a updateUser', async () => {
  let updateCalled = false;
  const mockAuth: SupabaseAuthPasswordClient = {
    signInWithPassword: async () => ({
      error: { message: 'Invalid login credentials' },
    }),
    updateUser: async () => {
      updateCalled = true;
      return { error: null };
    },
  };

  const res = await cambiarContrasenaUsuario({
    email: 'admin@aguateria.py',
    currentPassword: 'WrongPassword',
    newPassword: 'NuevaPassword123',
    confirmPassword: 'NuevaPassword123',
    authClient: mockAuth,
  });

  assert.equal(res.ok, false);
  assert.equal(res.error, 'La contraseña actual es incorrecta.');
  assert.equal(updateCalled, false);
});

test('4. Error en updateUser: devuelve mensaje de error sin reportar éxito', async () => {
  const mockAuth: SupabaseAuthPasswordClient = {
    signInWithPassword: async () => ({ error: null }),
    updateUser: async () => ({
      error: { message: 'New password should be different from the old password.' },
    }),
  };

  const res = await cambiarContrasenaUsuario({
    email: 'cobrador@aguateria.py',
    currentPassword: 'Password123',
    newPassword: 'Password123',
    confirmPassword: 'Password123',
    authClient: mockAuth,
  });

  assert.equal(res.ok, false);
  assert.match(res.error || '', /diferente/);
});

test('5. Flujo exitoso para admin, cobrador y lectura: verifica contraseña actual y luego ejecuta updateUser', async () => {
  for (const email of ['admin@aguateria.py', 'cobrador@aguateria.py', 'lectura@aguateria.py']) {
    const calls: string[] = [];
    const mockAuth: SupabaseAuthPasswordClient = {
      signInWithPassword: async (creds) => {
        calls.push(`signIn:${creds.email}`);
        return { error: null };
      },
      updateUser: async (attrs) => {
        calls.push(`update:${attrs.password}`);
        return { error: null };
      },
    };

    const res = await cambiarContrasenaUsuario({
      email,
      currentPassword: 'ActualPassword1',
      newPassword: 'NuevaPassword99',
      confirmPassword: 'NuevaPassword99',
      authClient: mockAuth,
    });

    assert.equal(res.ok, true);
    assert.deepEqual(calls, [`signIn:${email}`, 'update:NuevaPassword99']);
  }
});
