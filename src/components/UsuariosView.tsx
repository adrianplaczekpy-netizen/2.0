/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../services/database';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { UserRole, UsuarioPerfil } from '../types';
import {
  puedeGestionarUsuarios,
  validarEdicionUsuario,
  listarUsuariosAsync,
  crearUsuarioAsync,
  actualizarUsuarioAsync,
} from '../services/usuariosService';
import {
  UserCog,
  Plus,
  Search,
  RefreshCw,
  Edit2,
  Power,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  X,
  Eye,
  EyeOff,
  Lock,
} from 'lucide-react';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  cobrador: 'Cobrador',
  lectura: 'Lector',
};

const ROLE_BADGE_CLASSES: Record<UserRole, string> = {
  admin: 'bg-stone-900 text-white border-stone-900',
  cobrador: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  lectura: 'bg-blue-50 text-blue-800 border-blue-200',
};

export const UsuariosView: React.FC = () => {
  const { user } = useAuth();
  const esAdmin = puedeGestionarUsuarios(user?.rol);

  const [usuarios, setUsuarios] = useState<UsuarioPerfil[]>([]);
  const [cargando, setCargando] = useState<boolean>(true);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Filtros
  const [busqueda, setBusqueda] = useState('');
  const [filtroRol, setFiltroRol] = useState<UserRole | 'todos'>('todos');
  const [filtroActivo, setFiltroActivo] = useState<'todos' | 'activos' | 'inactivos'>('todos');

  // Modal Crear Usuario
  const [modalCrearOpen, setModalCrearOpen] = useState(false);
  const [nuevoEmail, setNuevoEmail] = useState('');
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoPassword, setNuevoPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [nuevoRol, setNuevoRol] = useState<UserRole>('cobrador');
  const [errorCrear, setErrorCrear] = useState<string | null>(null);
  const [guardandoCrear, setGuardandoCrear] = useState(false);

  // Modal Editar Usuario
  const [usuarioEditar, setUsuarioEditar] = useState<UsuarioPerfil | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [editRol, setEditRol] = useState<UserRole>('cobrador');
  const [editActivo, setEditActivo] = useState(true);
  const [errorEditar, setErrorEditar] = useState<string | null>(null);
  const [guardandoEditar, setGuardandoEditar] = useState(false);

  // Toggle estado activo rápido
  const [procesandoId, setProcesandoId] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const cargarUsuarios = useCallback(async () => {
    if (!esAdmin) {
      setCargando(false);
      return;
    }
    setCargando(true);
    setErrorGeneral(null);
    try {
      const lista = await listarUsuariosAsync({ callerRol: user?.rol });
      setUsuarios(lista);
    } catch (err: any) {
      const msg = err?.message || 'No se pudo cargar el listado de usuarios.';
      setErrorGeneral(msg);
    } finally {
      setCargando(false);
    }
  }, [esAdmin, user?.rol]);

  useEffect(() => {
    cargarUsuarios();
  }, [cargarUsuarios]);

  const adminsActivosCount = useMemo(
    () => usuarios.filter((u) => u.rol === 'admin' && u.activo !== false).length,
    [usuarios]
  );

  const usuariosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return usuarios.filter((u) => {
      if (filtroRol !== 'todos' && u.rol !== filtroRol) return false;
      if (filtroActivo === 'activos' && u.activo === false) return false;
      if (filtroActivo === 'inactivos' && u.activo !== false) return false;
      if (q) {
        const matchNombre = (u.nombre_completo || '').toLowerCase().includes(q);
        const matchEmail = (u.email || '').toLowerCase().includes(q);
        if (!matchNombre && !matchEmail) return false;
      }
      return true;
    });
  }, [usuarios, busqueda, filtroRol, filtroActivo]);

  if (!esAdmin) {
    return (
      <div className="p-8 bg-red-50 border border-red-300 rounded-xl text-red-900 max-w-lg mx-auto text-center space-y-3">
        <ShieldAlert className="w-10 h-10 text-red-600 mx-auto" />
        <h2 className="text-base font-black">Acceso denegado</h2>
        <p className="text-xs">
          El módulo de gestión de Usuarios es de acceso exclusivo para usuarios con rol de Administrador.
        </p>
      </div>
    );
  }

  const formatearFecha = (iso?: string) => {
    if (!iso) return '—';
    try {
      return iso.split('T')[0];
    } catch {
      return iso;
    }
  };

  const abrirModalCrear = () => {
    setErrorCrear(null);
    setErrorGeneral(null);
    setNuevoEmail('');
    setNuevoNombre('');
    setNuevoPassword('');
    setVerPassword(false);
    setNuevoRol('cobrador');
    setModalCrearOpen(true);
  };

  const handleCrearUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guardandoCrear) return;
    setErrorCrear(null);
    setErrorGeneral(null);

    setGuardandoCrear(true);
    try {
      const creado = await crearUsuarioAsync({
        email: nuevoEmail,
        password: nuevoPassword,
        nombre_completo: nuevoNombre,
        rol: nuevoRol,
        callerRol: user?.rol,
      });

      setModalCrearOpen(false);
      await cargarUsuarios();
      if (isSupabaseConfigured) {
        await db.loadFromSupabase({ force: true });
      }
      setToast({
        type: 'success',
        message: `Usuario ${creado.nombre_completo} (${creado.email}) creado con rol ${ROLE_LABELS[creado.rol || nuevoRol]}.`,
      });
    } catch (err: any) {
      const msg = err?.message || 'No se pudo crear el usuario.';
      setErrorCrear(msg);
      setToast({ type: 'error', message: msg });
    } finally {
      setGuardandoCrear(false);
    }
  };

  const abrirModalEditar = (u: UsuarioPerfil) => {
    setErrorEditar(null);
    setErrorGeneral(null);
    setUsuarioEditar(u);
    setEditNombre(u.nombre_completo);
    setEditRol(u.rol || 'lectura');
    setEditActivo(u.activo !== false);
  };

  const handleGuardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuarioEditar || guardandoEditar) return;
    setErrorEditar(null);
    setErrorGeneral(null);

    setGuardandoEditar(true);
    try {
      const actualizado = await actualizarUsuarioAsync({
        targetUser: usuarioEditar,
        currentAdminId: user?.id,
        allUsers: usuarios,
        callerRol: user?.rol,
        cambios: {
          nombre_completo: editNombre,
          rol: editRol,
          activo: editActivo,
        },
      });

      setUsuarioEditar(null);
      await cargarUsuarios();
      if (isSupabaseConfigured) {
        await db.loadFromSupabase({ force: true });
      }
      setToast({
        type: 'success',
        message: `Usuario ${actualizado.nombre_completo} actualizado correctamente.`,
      });
    } catch (err: any) {
      const msg = err?.message || 'No se pudo actualizar el usuario.';
      setErrorEditar(msg);
      setToast({ type: 'error', message: msg });
    } finally {
      setGuardandoEditar(false);
    }
  };

  const handleToggleActivo = async (targetUser: UsuarioPerfil) => {
    if (procesandoId) return;
    const nuevoEstado = targetUser.activo === false;
    setErrorGeneral(null);

    const valid = validarEdicionUsuario({
      targetUser,
      currentAdminId: user?.id,
      allUsers: usuarios,
      cambios: { activo: nuevoEstado },
    });

    if (valid.ok === false) {
      setErrorGeneral(valid.error);
      setToast({ type: 'error', message: valid.error });
      return;
    }

    setProcesandoId(targetUser.id);
    try {
      await actualizarUsuarioAsync({
        targetUser,
        currentAdminId: user?.id,
        allUsers: usuarios,
        callerRol: user?.rol,
        cambios: { activo: nuevoEstado },
      });

      await cargarUsuarios();
      if (isSupabaseConfigured) {
        await db.loadFromSupabase({ force: true });
      }
      setToast({
        type: 'success',
        message: nuevoEstado
          ? `Usuario ${targetUser.nombre_completo} reactivado.`
          : `Usuario ${targetUser.nombre_completo} desactivado. Ya no podrá iniciar sesión.`,
      });
    } catch (err: any) {
      const msg = err?.message || 'No se pudo cambiar el estado del usuario.';
      const detalle = `${msg} (usuario: ${targetUser.email})`;
      setErrorGeneral(detalle);
      setToast({ type: 'error', message: detalle });
    } finally {
      setProcesandoId(null);
    }
  };

  const mismoUsuarioId = (idA?: string | null, idB?: string | null) =>
    Boolean(idA && idB && idA.trim().toLowerCase() === idB.trim().toLowerCase());

  const esUltimoAdminObjetivo = (u: UsuarioPerfil) =>
    u.rol === 'admin' && u.activo !== false && adminsActivosCount <= 1;

  const esAdminActual = (u: UsuarioPerfil) => mismoUsuarioId(u.id, user?.id);

  return (
    <div className="space-y-6">
      {/* Toast flotante */}
      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          className={`fixed bottom-5 right-5 z-50 max-w-sm px-4 py-3 rounded-xl shadow-lg border text-xs font-semibold flex items-center gap-2.5 ${
            toast.type === 'error'
              ? 'bg-red-950 text-red-50 border-red-700'
              : 'bg-stone-900 text-white border-stone-700'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span className="flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="opacity-70 hover:opacity-100 cursor-pointer"
            aria-label="Cerrar notificación"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <UserCog className="w-6 h-6 text-stone-800" />
            <span>Gestión de Usuarios y Roles</span>
          </h1>
          <p className="text-sm text-stone-600">
            Administración de cuentas operativas, asignación de roles y habilitación de acceso al sistema.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={cargarUsuarios}
            disabled={cargando}
            className="px-3 py-2 bg-white hover:bg-stone-50 border border-stone-300 text-stone-700 font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-stone-500 ${cargando ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>

          <button
            type="button"
            onClick={abrirModalCrear}
            className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo usuario</span>
          </button>
        </div>
      </div>

      {/* Banner de error inline */}
      {errorGeneral && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-300 rounded-xl text-red-900 text-sm font-semibold flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <span>{errorGeneral}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorGeneral(null)}
            className="text-xs text-red-800 hover:underline shrink-0 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Métricas rápidas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
          <span className="text-xs font-semibold text-stone-500 block">Total Usuarios</span>
          <div className="text-2xl font-black text-stone-900 mt-1">{usuarios.length}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
          <span className="text-xs font-semibold text-stone-500 block">Cuentas Activas</span>
          <div className="text-2xl font-black text-emerald-700 mt-1">
            {usuarios.filter((u) => u.activo !== false).length}
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
          <span className="text-xs font-semibold text-stone-500 block">Administradores</span>
          <div className="text-2xl font-black text-stone-900 mt-1">{adminsActivosCount}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
          <span className="text-xs font-semibold text-stone-500 block">Cobradores y Lectores</span>
          <div className="text-2xl font-black text-blue-700 mt-1">
            {usuarios.filter((u) => u.rol !== 'admin' && u.activo !== false).length}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="relative flex-1">
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o correo electrónico..."
            className="w-full pl-10 pr-4 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-900 focus:outline-hidden focus:border-stone-900 focus:bg-white"
          />
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={filtroRol}
            onChange={(e) => setFiltroRol(e.target.value as UserRole | 'todos')}
            aria-label="Filtrar por rol"
            className="px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg font-semibold text-stone-800"
          >
            <option value="todos">Todos los roles</option>
            <option value="admin">Administrador</option>
            <option value="cobrador">Cobrador</option>
            <option value="lectura">Lector</option>
          </select>

          <select
            value={filtroActivo}
            onChange={(e) => setFiltroActivo(e.target.value as 'todos' | 'activos' | 'inactivos')}
            aria-label="Filtrar por estado"
            className="px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg font-semibold text-stone-800"
          >
            <option value="todos">Todos los estados</option>
            <option value="activos">Activos</option>
            <option value="inactivos">Inactivos</option>
          </select>
        </div>
      </div>

      {/* Tabla de Usuarios */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-stone-200 bg-stone-50/50 flex items-center justify-between">
          <h3 className="font-bold text-stone-900 text-sm">Padrón de Personal Habilitado</h3>
          <span className="text-xs text-stone-500">{usuariosFiltrados.length} usuarios</span>
        </div>

        {cargando ? (
          <div className="p-10 text-center text-xs font-semibold text-stone-500">
            Cargando usuarios desde Supabase...
          </div>
        ) : usuariosFiltrados.length === 0 ? (
          <div className="p-10 text-center text-xs text-stone-500">
            No se encontraron usuarios con los filtros seleccionados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200 text-stone-600 uppercase text-[11px] tracking-wider">
                  <th className="py-3 px-4 font-bold">Nombre</th>
                  <th className="py-3 px-4 font-bold">Email</th>
                  <th className="py-3 px-4 font-bold">Rol</th>
                  <th className="py-3 px-4 font-bold">Estado</th>
                  <th className="py-3 px-4 font-bold">Fecha de Creación</th>
                  <th className="py-3 px-4 font-bold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {usuariosFiltrados.map((u) => {
                  const rolUsuario = (u.rol || 'lectura') as UserRole;
                  const estaActivo = u.activo !== false;
                  const esYo = esAdminActual(u);
                  const esUltimo = esUltimoAdminObjetivo(u);
                  const bloqueoDesactivar = estaActivo && (esYo || esUltimo);

                  return (
                    <tr key={u.id} className="hover:bg-stone-50/70 transition-colors">
                      <td className="py-3 px-4 font-bold text-stone-900">
                        <div className="flex items-center gap-2">
                          <span>{u.nombre_completo}</span>
                          {esYo && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-stone-100 text-stone-600 border border-stone-200 font-semibold">
                              Vos
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-stone-700">{u.email}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-sm border font-bold text-[10px] uppercase tracking-wider ${ROLE_BADGE_CLASSES[rolUsuario]}`}
                        >
                          {ROLE_LABELS[rolUsuario]}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {estaActivo ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-emerald-100 text-emerald-800 font-bold text-[10px] uppercase">
                            Activo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-red-100 text-red-800 font-bold text-[10px] uppercase">
                            Inactivo
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-stone-600">
                        {formatearFecha(u.fecha_creacion)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            data-user-id={u.id}
                            aria-label={`Editar ${u.email}`}
                            onClick={() => abrirModalEditar(u)}
                            className="px-2.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-300 rounded-md font-bold text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Edit2 className="w-3 h-3" />
                            <span>Editar</span>
                          </button>

                          <button
                            type="button"
                            data-user-id={u.id}
                            aria-label={`${estaActivo ? 'Desactivar' : 'Activar'} ${u.email}`}
                            disabled={bloqueoDesactivar || procesandoId === u.id}
                            onClick={() => handleToggleActivo(u)}
                            title={
                              esYo
                                ? 'No podés desactivar tu propia cuenta'
                                : esUltimo
                                ? 'No se puede desactivar al último administrador activo'
                                : estaActivo
                                ? `Desactivar acceso de ${u.email}`
                                : `Reactivar acceso de ${u.email}`
                            }
                            className={`px-2.5 py-1.5 rounded-md font-bold text-[11px] border flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                              estaActivo
                                ? 'bg-red-50 hover:bg-red-100 text-red-700 border-red-200'
                                : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                            }`}
                          >
                            <Power className="w-3 h-3" />
                            <span>
                              {procesandoId === u.id
                                ? 'Guardando...'
                                : estaActivo
                                ? 'Desactivar'
                                : 'Activar'}
                            </span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Nuevo Usuario */}
      {modalCrearOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Nuevo usuario"
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleCrearUsuario}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4 border border-stone-200"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div className="flex items-center gap-2">
                <UserCog className="w-5 h-5 text-stone-900" />
                <h3 className="font-bold text-stone-900 text-base">Nuevo Usuario</h3>
              </div>
              <button
                type="button"
                disabled={guardandoCrear}
                onClick={() => setModalCrearOpen(false)}
                className="text-stone-400 hover:text-stone-700 disabled:opacity-40 cursor-pointer"
                aria-label="Cerrar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorCrear && (
              <div
                role="alert"
                className="p-3 bg-red-50 border border-red-300 rounded-xl text-red-800 text-xs font-semibold flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorCrear}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-stone-700 block mb-1">
                  Nombre completo *
                </label>
                <input
                  type="text"
                  required
                  value={nuevoNombre}
                  onChange={(e) => setNuevoNombre(e.target.value)}
                  placeholder="Ej: Ramona Benítez"
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold text-stone-900 focus:bg-white focus:border-stone-900 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">
                  Correo electrónico *
                </label>
                <input
                  type="email"
                  required
                  value={nuevoEmail}
                  onChange={(e) => setNuevoEmail(e.target.value)}
                  placeholder="usuario@aguateria.py"
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold text-stone-900 focus:bg-white focus:border-stone-900 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">
                  Contraseña inicial (mínimo 8 caracteres) *
                </label>
                <div className="relative">
                  <input
                    type={verPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={nuevoPassword}
                    onChange={(e) => setNuevoPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    className="w-full p-2.5 pr-10 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold text-stone-900 focus:bg-white focus:border-stone-900 focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={() => setVerPassword((v) => !v)}
                    className="absolute right-2.5 top-2.5 text-stone-400 hover:text-stone-700 cursor-pointer"
                    aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {verPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">Rol asignado *</label>
                <select
                  value={nuevoRol}
                  onChange={(e) => setNuevoRol(e.target.value as UserRole)}
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs font-bold text-stone-900 focus:bg-white focus:border-stone-900"
                >
                  <option value="cobrador">Cobrador (Caja, clientes y facturas)</option>
                  <option value="lectura">Lector (Toma de lecturas en calle)</option>
                  <option value="admin">Administrador (Control total del sistema)</option>
                </select>
              </div>
            </div>

            <div className="pt-2 border-t border-stone-200 flex justify-end gap-2">
              <button
                type="button"
                disabled={guardandoCrear}
                onClick={() => setModalCrearOpen(false)}
                className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg font-semibold text-xs cursor-pointer disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={guardandoCrear}
                className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-bold text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {guardandoCrear ? 'Creando usuario...' : 'Crear usuario'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Editar Usuario */}
      {usuarioEditar && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Editar usuario"
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleGuardarEdicion}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4 border border-stone-200"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div className="flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-stone-900" />
                <div>
                  <h3 className="font-bold text-stone-900 text-base">Editar Usuario</h3>
                  <p className="text-[11px] font-mono text-stone-500">{usuarioEditar.email}</p>
                </div>
              </div>
              <button
                type="button"
                disabled={guardandoEditar}
                onClick={() => setUsuarioEditar(null)}
                className="text-stone-400 hover:text-stone-700 disabled:opacity-40 cursor-pointer"
                aria-label="Cerrar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorEditar && (
              <div
                role="alert"
                className="p-3 bg-red-50 border border-red-300 rounded-xl text-red-800 text-xs font-semibold flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorEditar}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-stone-700 block mb-1">
                  Nombre completo *
                </label>
                <input
                  type="text"
                  required
                  value={editNombre}
                  onChange={(e) => setEditNombre(e.target.value)}
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold text-stone-900 focus:bg-white focus:border-stone-900 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">Rol asignado *</label>
                <select
                  value={editRol}
                  disabled={
                    guardandoEditar ||
                    esAdminActual(usuarioEditar) ||
                    esUltimoAdminObjetivo(usuarioEditar)
                  }
                  onChange={(e) => setEditRol(e.target.value as UserRole)}
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs font-bold text-stone-900 disabled:opacity-60"
                >
                  <option value="cobrador">Cobrador</option>
                  <option value="lectura">Lector</option>
                  <option value="admin">Administrador</option>
                </select>
                {(esAdminActual(usuarioEditar) || esUltimoAdminObjetivo(usuarioEditar)) && (
                  <p className="text-[11px] text-amber-700 mt-1 flex items-center gap-1">
                    <Lock className="w-3 h-3 shrink-0" />
                    <span>
                      {esAdminActual(usuarioEditar)
                        ? 'No podés cambiar tu propio rol de administrador.'
                        : 'No se puede cambiar el rol del último administrador activo.'}
                    </span>
                  </p>
                )}
              </div>

              <label className="flex items-center gap-2 pt-1 font-semibold text-stone-800 cursor-pointer select-none">
                <input
                  type="checkbox"
                  disabled={
                    guardandoEditar ||
                    esAdminActual(usuarioEditar) ||
                    esUltimoAdminObjetivo(usuarioEditar)
                  }
                  checked={editActivo}
                  onChange={(e) => setEditActivo(e.target.checked)}
                  className="w-4 h-4 rounded-sm border-stone-300 text-stone-900"
                />
                <span>Cuenta habilitada (usuario activo)</span>
              </label>
            </div>

            <div className="pt-2 border-t border-stone-200 flex justify-end gap-2">
              <button
                type="button"
                disabled={guardandoEditar}
                onClick={() => setUsuarioEditar(null)}
                className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg font-semibold text-xs cursor-pointer disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={guardandoEditar}
                className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-bold text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {guardandoEditar ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
