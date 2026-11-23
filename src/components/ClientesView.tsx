/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { db } from '../services/database';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { Cliente, EstadoMedidor } from '../types';
import { formatGs } from '../services/billingRules';
import {
  Users,
  Search,
  Plus,
  ChevronLeft,
  ChevronRight,
  Eye,
  Phone,
  MapPin,
  FileCheck,
  X,
  Droplets,
  Edit2,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Wrench,
  AlertCircle,
  Loader2,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { descargarContratoServer } from '../services/apiPdfService';

interface ClientesViewProps {
  onSelectMedidor?: (medidorId: string) => void;
  onAgregarOtroTrabajo?: (clienteId: string, medidorId?: string) => void;
  onAgregarMedidorParaCliente?: (clienteId: string) => void;
  onSyncData?: () => void;
  isSyncing?: boolean;
}

export const ClientesView: React.FC<ClientesViewProps> = ({
  onSelectMedidor,
  onAgregarOtroTrabajo,
  onAgregarMedidorParaCliente,
  onSyncData,
  isSyncing = false,
}) => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selectedClienteId, setSelectedClienteId] = useState<string | null>(null);
  const [, setRefreshKey] = useState(0);

  // Modales
  const [showAddModal, setShowAddModal] = useState(false);
  const [clienteParaEditar, setClienteParaEditar] = useState<Cliente | null>(null);
  const [clienteParaEliminar, setClienteParaEliminar] = useState<Cliente | null>(null);

  // Estados de generación de contrato PDF
  const [generatingContratoId, setGeneratingContratoId] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Formulario nuevo / edición cliente
  const [nombre, setNombre] = useState('');
  const [documento, setDocumento] = useState('');
  const [direccion, setDireccion] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');

  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [errorEliminarModal, setErrorEliminarModal] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [toast, setToast] = useState<{ tipo: 'success' | 'error'; texto: string } | null>(null);

  useEffect(() => {
    const unsubscribe = db.subscribe(() => {
      setRefreshKey((k) => k + 1);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const mostrarToast = (tipo: 'success' | 'error', texto: string) => {
    setToast({ tipo, texto });
  };

  const handleDescargarContrato = async (clienteId: string, clienteDoc?: string) => {
    setGeneratingContratoId(clienteId);
    setPdfError(null);
    try {
      const filename = `Contrato_Cliente_${clienteDoc || clienteId}.pdf`;
      await descargarContratoServer(clienteId, filename);
    } catch (err: any) {
      setPdfError(err.message || 'No se pudo generar el PDF. Intentá de nuevo.');
    } finally {
      setGeneratingContratoId(null);
    }
  };

  // Paginación estricta de 50 registros por página según requisitos
  const limit = 50;
  const data = db.getClientes({ page, limit, search });

  const clienteDetalle = selectedClienteId ? db.getClienteDetalle(selectedClienteId) : null;

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setPage(1);
  };

  const handleAbrirCrear = () => {
    setNombre('');
    setDocumento('');
    setDireccion('');
    setTelefono('');
    setEmail('');
    setErrorModal(null);
    setShowAddModal(true);
  };

  const handleAbrirEditar = (cli: Cliente) => {
    setClienteParaEditar(cli);
    setNombre(cli.nombre_completo);
    setDocumento(cli.documento);
    setDireccion(cli.direccion);
    setTelefono(cli.telefono);
    setEmail(cli.email);
    setErrorModal(null);
  };

  const handleGuardarNuevoCliente = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    setErrorModal(null);

    if (!nombre.trim()) {
      setErrorModal('El nombre es obligatorio');
      return;
    }
    if (!documento.trim()) {
      setErrorModal('El documento (C.I./RUC) es obligatorio');
      return;
    }
    if (!direccion.trim()) {
      setErrorModal('La dirección es obligatoria');
      return;
    }

    setGuardando(true);
    try {
      const nuevo = await db.agregarClienteAsync({
        nombre_completo: nombre.trim(),
        documento: documento.trim(),
        direccion: direccion.trim(),
        telefono: telefono.trim(),
        email: email.trim() || `${documento.trim()}@aguateria.py`,
      });

      if (isSupabaseConfigured) {
        await db.loadFromSupabase({ force: true });
      }

      const okMsg = `Cliente ${nuevo.nombre_completo} (CI: ${nuevo.documento}) registrado correctamente.`;
      setMensajeExito(okMsg);
      mostrarToast('success', okMsg);
      setShowAddModal(false);
    } catch (err: any) {
      setErrorModal(err?.message || 'Error al crear el cliente.');
    } finally {
      setGuardando(false);
    }
  };

  const handleGuardarEdicionCliente = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clienteParaEditar || guardando) return;
    setErrorModal(null);

    if (!nombre.trim()) {
      setErrorModal('El nombre es obligatorio');
      return;
    }
    if (!documento.trim()) {
      setErrorModal('El documento (C.I./RUC) es obligatorio');
      return;
    }
    if (!direccion.trim()) {
      setErrorModal('La dirección es obligatoria');
      return;
    }

    setGuardando(true);
    try {
      await db.actualizarClienteAsync(clienteParaEditar.id, {
        nombre_completo: nombre.trim(),
        documento: documento.trim(),
        direccion: direccion.trim(),
        telefono: telefono.trim(),
        email: email.trim(),
      });

      if (isSupabaseConfigured) {
        await db.loadFromSupabase({ force: true });
      }

      const okMsg = `Datos del cliente ${nombre.trim()} actualizados.`;
      setMensajeExito(okMsg);
      mostrarToast('success', okMsg);
      setClienteParaEditar(null);
    } catch (err: any) {
      setErrorModal(err?.message || 'Error al actualizar el cliente.');
    } finally {
      setGuardando(false);
    }
  };

  const handleConfirmarEliminar = async () => {
    if (!clienteParaEliminar || eliminando) return;
    setErrorEliminarModal(null);
    setEliminando(true);

    try {
      await db.eliminarClienteAsync(clienteParaEliminar.id);

      if (isSupabaseConfigured) {
        await db.loadFromSupabase({ force: true });
      }

      const okMsg = `Cliente ${clienteParaEliminar.nombre_completo} eliminado del sistema.`;
      setMensajeExito(okMsg);
      mostrarToast('success', okMsg);
      if (selectedClienteId === clienteParaEliminar.id) {
        setSelectedClienteId(null);
      }
      setClienteParaEliminar(null);
    } catch (err: any) {
      setErrorEliminarModal(err?.message || 'No se pudo eliminar el cliente.');
    } finally {
      setEliminando(false);
    }
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-50 max-w-sm px-4 py-3 rounded-xl shadow-lg border text-xs font-bold flex items-center gap-2.5 ${
            toast.tipo === 'success'
              ? 'bg-emerald-900 text-white border-emerald-700'
              : 'bg-red-900 text-white border-red-700'
          }`}
        >
          {toast.tipo === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-300 shrink-0" />
          )}
          <span className="flex-1">{toast.texto}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Cerrar notificación"
            className="opacity-75 hover:opacity-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">Padrón de Clientes</h1>
          <p className="text-sm text-stone-600">
            {data.total.toLocaleString('es-PY')} clientes registrados. Cada cliente puede tener uno o más medidores como unidades de negocio independientes.
          </p>
        </div>
        <button
          type="button"
          onClick={handleAbrirCrear}
          className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Nuevo Cliente</span>
        </button>
      </div>

      {mensajeExito && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 text-sm font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{mensajeExito}</span>
          </div>
          <button
            type="button"
            onClick={() => setMensajeExito(null)}
            className="text-xs text-emerald-800 hover:underline"
          >
            Cerrar
          </button>
        </div>
      )}

      {pdfError && (
        <div className="p-3.5 bg-red-50 border border-red-300 rounded-xl text-red-800 text-xs font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{pdfError}</span>
          </div>
          <button
            type="button"
            onClick={() => setPdfError(null)}
            className="text-red-700 hover:underline font-bold"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Buscador & Paginación (50 por página) */}
      <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-96">
          <input
            type="text"
            value={search}
            onChange={handleSearchChange}
            placeholder="Buscar por Nombre, C.I., Teléfono o Dirección..."
            className="w-full pl-10 pr-4 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-900 focus:outline-hidden focus:border-blue-600 focus:bg-white"
          />
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
        </div>

        <div className="flex items-center gap-2 text-xs text-stone-600">
          <span>
            Pág. <b>{data.page}</b> de <b>{data.totalPages}</b> (50 por pág. — {data.total} clientes)
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="p-1.5 bg-stone-100 hover:bg-stone-200 rounded-md disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            disabled={page >= data.totalPages}
            className="p-1.5 bg-stone-100 hover:bg-stone-200 rounded-md disabled:opacity-40"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabla de Clientes con Medidores Independientes */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-xs">
        {data.clientes.length === 0 ? (
          <div className="px-4 py-10 text-center text-stone-500">
            <div className="flex flex-col items-center gap-2 max-w-md mx-auto">
              <Users className="w-8 h-8 text-stone-300" />
              <p className="text-sm font-bold text-stone-700">
                {search.trim()
                  ? 'No se encontraron clientes con ese criterio de búsqueda.'
                  : 'No hay clientes cargados todavía.'}
              </p>
              <p className="text-xs text-stone-500">
                {search.trim()
                  ? 'Intentá limpiar el filtro de búsqueda.'
                  : 'Presioná "Sincronizar datos" para recargar desde Supabase o registrá un nuevo cliente.'}
              </p>
              {!search.trim() && onSyncData && (
                <button
                  type="button"
                  onClick={onSyncData}
                  disabled={isSyncing}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar datos'}</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Doc / C.I.</th>
                  <th className="px-4 py-3">Dirección Principal</th>
                  <th className="px-4 py-3">Teléfono</th>
                  <th className="px-4 py-3">Medidores Asignados</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.clientes.map((c) => (
                  <tr key={c.id} className="hover:bg-stone-50 transition-colors">
                    <td className="px-4 py-3 font-bold text-stone-900">{c.nombre_completo}</td>
                    <td className="px-4 py-3 font-mono text-stone-700">{c.documento}</td>
                    <td className="px-4 py-3 text-stone-600 max-w-xs truncate">{c.direccion}</td>
                    <td className="px-4 py-3 text-stone-600">{c.telefono}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-stone-800">
                          {c.medidoresCount} {c.medidoresCount === 1 ? 'medidor' : 'medidores'}
                        </span>
                        {c.estadosMedidores.map((est, idx) => (
                          <span
                            key={idx}
                            className={`text-[9px] px-1.5 py-0.2 rounded-sm font-bold uppercase ${
                              est === 'activo'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : est === 'moroso'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-red-50 text-red-700 border border-red-200'
                            }`}
                          >
                            {est.replace('_', ' ')}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedClienteId(c.id)}
                          className="px-2 py-1 bg-stone-100 hover:bg-stone-200 text-stone-800 font-semibold rounded-md text-xs inline-flex items-center gap-1"
                          title="Ver ficha completa"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Ficha</span>
                        </button>

                        {/* Generar contrato PDF rápido */}
                        <button
                          type="button"
                          disabled={generatingContratoId === c.id}
                          onClick={() => handleDescargarContrato(c.id, c.documento)}
                          className="px-2 py-1 bg-stone-100 hover:bg-stone-200 text-stone-800 font-semibold rounded-md text-xs inline-flex items-center gap-1 disabled:opacity-50"
                          title="Generar contrato privado en PDF"
                        >
                          {generatingContratoId === c.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                          ) : (
                            <FileText className="w-3.5 h-3.5" />
                          )}
                          <span>{generatingContratoId === c.id ? '...' : 'Contrato'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleAbrirEditar(c)}
                          className="p-1 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-md"
                          title="Editar cliente"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setErrorEliminarModal(null);
                            setClienteParaEliminar(c);
                          }}
                          disabled={c.medidoresCount > 0}
                          className="p-1 bg-stone-100 hover:bg-red-50 text-stone-500 hover:text-red-700 rounded-md disabled:opacity-30 disabled:hover:bg-stone-100 disabled:hover:text-stone-500"
                          title={
                            c.medidoresCount > 0
                              ? 'No se puede eliminar: tiene medidores asignados'
                              : 'Eliminar cliente'
                          }
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Ficha Detallada del Cliente con Tabla Completa de Medidores */}
      {clienteDetalle && clienteDetalle.cliente && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] overflow-y-auto p-6 shadow-xl space-y-5">
            <div className="flex items-start justify-between border-b border-stone-200 pb-3">
              <div>
                <span className="text-xs uppercase font-bold text-stone-500">Ficha del Cliente</span>
                <h2 className="text-xl font-black text-stone-900">
                  {clienteDetalle.cliente.nombre_completo}
                </h2>
                <p className="text-xs text-stone-500">
                  Doc: {clienteDetalle.cliente.documento} | Alta: {clienteDetalle.cliente.fecha_alta}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={generatingContratoId === clienteDetalle.cliente?.id}
                  onClick={() => {
                    if (clienteDetalle.cliente) {
                      handleDescargarContrato(clienteDetalle.cliente.id, clienteDetalle.cliente.documento);
                    }
                  }}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors disabled:opacity-50"
                  title="Generar contrato privado en PDF con condiciones vigentes"
                >
                  {generatingContratoId === clienteDetalle.cliente.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                  ) : (
                    <FileText className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {generatingContratoId === clienteDetalle.cliente.id
                      ? 'Generando...'
                      : 'Generar contrato PDF'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedClienteId(null)}
                  className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Datos Personales */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-stone-50 p-3.5 rounded-xl border border-stone-200">
              <div>
                <span className="text-stone-500 block">Dirección Principal:</span>
                <span className="font-semibold text-stone-800">{clienteDetalle.cliente.direccion}</span>
              </div>
              <div>
                <span className="text-stone-500 block">Teléfono:</span>
                <span className="font-semibold text-stone-800">{clienteDetalle.cliente.telefono}</span>
              </div>
              <div>
                <span className="text-stone-500 block">Email:</span>
                <span className="font-semibold text-stone-800 truncate block">{clienteDetalle.cliente.email}</span>
              </div>
              <div>
                <span className="text-stone-500 block">Contrato Vigente:</span>
                <span className="font-semibold text-emerald-700 flex items-center gap-1">
                  <FileCheck className="w-3.5 h-3.5" />
                  {clienteDetalle.contratos[0]?.id || 'Vigente'}
                </span>
              </div>
            </div>

            {/* TABLA DE MEDIDORES DEL CLIENTE (Columnas requeridas) */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
                    <Droplets className="w-4 h-4 text-blue-600" />
                    <span>Medidores Asignados ({clienteDetalle.medidores.length})</span>
                  </h3>
                  <span className="text-xs text-stone-500">
                    Cada medidor es una unidad de negocio independiente con su propio ciclo y deuda
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {onAgregarMedidorParaCliente && (
                    <button
                      type="button"
                      onClick={() => {
                        onAgregarMedidorParaCliente(clienteDetalle.cliente!.id);
                      }}
                      className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-bold rounded-lg flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Asignar Medidor</span>
                    </button>
                  )}

                  {onAgregarOtroTrabajo && (
                    <button
                      type="button"
                      onClick={() => {
                        onAgregarOtroTrabajo(clienteDetalle.cliente!.id);
                      }}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg flex items-center gap-1 shadow-xs"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      <span>Agregar otro trabajo</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-bold uppercase">
                    <tr>
                      <th className="px-3 py-2.5">N° Medidor</th>
                      <th className="px-3 py-2.5">Dirección del Terreno</th>
                      <th className="px-3 py-2.5">Estado</th>
                      <th className="px-3 py-2.5">Última Lectura</th>
                      <th className="px-3 py-2.5 text-center">Consumo Mes</th>
                      <th className="px-3 py-2.5 text-center">Alerta</th>
                      <th className="px-3 py-2.5 text-right">Deuda Medidor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {clienteDetalle.medidores.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-stone-500 text-xs">
                          Este cliente no tiene medidores asociados actualmente.
                        </td>
                      </tr>
                    ) : (
                      clienteDetalle.medidores.map((m: any) => (
                        <tr key={m.id} className="hover:bg-stone-50">
                          <td className="px-3 py-2.5 font-mono font-bold text-stone-900">
                            #{m.numero_medidor}
                          </td>
                          <td className="px-3 py-2.5 text-stone-700 max-w-xs truncate">
                            {m.direccion}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                m.estado === 'activo'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : m.estado === 'moroso'
                                  ? 'bg-amber-100 text-amber-800'
                                  : m.estado === 'pendiente_corte'
                                  ? 'bg-red-100 text-red-800 border border-red-300'
                                  : m.estado === 'cortado'
                                  ? 'bg-red-50 text-red-700'
                                  : 'bg-stone-100 text-stone-600'
                              }`}
                            >
                              {m.estado.replace('_', ' ')}
                            </span>
                            {m.mora_congelada !== null && m.mora_congelada > 0 && (
                              <span className="block text-[8px] text-red-600 font-bold">Mora congelada</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {m.ultimaLectura ? (
                              <div>
                                <span className="font-bold text-stone-800">{m.ultimaLectura.lectura_actual} m³</span>
                                <span className="text-[10px] text-stone-500 block">{m.ultimaLectura.fecha_lectura}</span>
                              </div>
                            ) : (
                              <span className="text-stone-400">Sin lecturas</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center font-bold text-stone-800">
                            {m.consumoMes !== undefined ? `${m.consumoMes} m³` : '--'}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {m.alerta ? (
                              <span className="inline-block px-1.5 py-0.5 bg-red-100 text-red-800 border border-red-300 rounded-sm font-black text-[9px] uppercase">
                                Consumo Elevado
                              </span>
                            ) : (
                              <span className="text-[10px] text-stone-400">Normal</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <span className={`font-black ${m.deudaTotal > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                              {formatGs(m.deudaTotal)}
                            </span>
                            {m.boletasImpagasCount > 0 && (
                              <span className="text-[10px] text-stone-500 block">
                                {m.boletasImpagasCount} boleta/s
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pt-3 border-t border-stone-200 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedClienteId(null)}
                className="px-4 py-2 bg-stone-900 text-white font-semibold rounded-lg text-xs"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Agregar Nuevo Cliente */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form
            noValidate
            onSubmit={handleGuardarNuevoCliente}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <h3 className="font-bold text-stone-900 text-base">Registrar Nuevo Cliente</h3>
              <button
                type="button"
                disabled={guardando}
                onClick={() => setShowAddModal(false)}
                className="text-stone-400 hover:text-stone-700 disabled:opacity-40"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorModal && (
              <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-red-800 text-xs font-semibold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorModal}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-stone-700 block mb-1">Nombre Completo *</label>
                <input
                  type="text"
                  required
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej: Mario Gómez Vera"
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs"
                />
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">C.I. / RUC (Único) *</label>
                <input
                  type="text"
                  required
                  value={documento}
                  onChange={(e) => setDocumento(e.target.value)}
                  placeholder="Ej: 3820194"
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs"
                />
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">Dirección Principal *</label>
                <input
                  type="text"
                  required
                  value={direccion}
                  onChange={(e) => setDireccion(e.target.value)}
                  placeholder="Ej: Av. San José 840, San Lorenzo"
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs"
                />
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">Teléfono</label>
                <input
                  type="text"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  placeholder="Ej: +595 981 445 120"
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs"
                />
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="mario.gomez@gmail.com"
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-stone-200 flex justify-end gap-2">
              <button
                type="button"
                disabled={guardando}
                onClick={() => setShowAddModal(false)}
                className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg font-semibold text-xs disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={guardando}
                className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-bold text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {guardando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{guardando ? 'Guardando...' : 'Guardar Cliente'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Editar Cliente */}
      {clienteParaEditar && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form
            noValidate
            onSubmit={handleGuardarEdicionCliente}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <h3 className="font-bold text-stone-900 text-base">Editar Cliente</h3>
              <button
                type="button"
                disabled={guardando}
                onClick={() => setClienteParaEditar(null)}
                className="text-stone-400 hover:text-stone-700 disabled:opacity-40"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorModal && (
              <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-red-800 text-xs font-semibold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorModal}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-stone-700 block mb-1">Nombre Completo *</label>
                <input
                  type="text"
                  required
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs"
                />
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">C.I. / RUC *</label>
                <input
                  type="text"
                  required
                  value={documento}
                  onChange={(e) => setDocumento(e.target.value)}
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs"
                />
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">Dirección Principal *</label>
                <input
                  type="text"
                  required
                  value={direccion}
                  onChange={(e) => setDireccion(e.target.value)}
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs"
                />
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">Teléfono</label>
                <input
                  type="text"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs"
                />
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-stone-200 flex justify-end gap-2">
              <button
                type="button"
                disabled={guardando}
                onClick={() => setClienteParaEditar(null)}
                className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg font-semibold text-xs disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={guardando}
                className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-bold text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {guardando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{guardando ? 'Guardando...' : 'Guardar Cambios'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Confirmar Eliminar Cliente */}
      {clienteParaEliminar && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-2.5 text-red-600">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="font-bold text-stone-900 text-base">Eliminar Cliente</h3>
            </div>

            <p className="text-xs text-stone-600">
              ¿Está seguro de eliminar al cliente <b>{clienteParaEliminar.nombre_completo}</b> (CI: {clienteParaEliminar.documento})?
              Esta acción no se puede deshacer.
            </p>

            {errorEliminarModal && (
              <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-red-800 text-xs font-semibold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorEliminarModal}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-stone-200">
              <button
                type="button"
                disabled={eliminando}
                onClick={() => {
                  setErrorEliminarModal(null);
                  setClienteParaEliminar(null);
                }}
                className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg font-semibold text-xs disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={eliminando}
                onClick={handleConfirmarEliminar}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {eliminando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{eliminando ? 'Eliminando...' : 'Eliminar Cliente'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
