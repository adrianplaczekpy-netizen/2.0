/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { db } from '../services/database';
import { EstadoMedidor, Medidor } from '../types';
import { formatGs, validarNumeroMedidor } from '../services/billingRules';
import {
  Droplets,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Eye,
  Camera,
  CreditCard,
  X,
  AlertTriangle,
  Scissors,
  CheckCircle2,
  Plus,
  Edit2,
  Trash2,
  AlertCircle,
  MapPin,
  User,
} from 'lucide-react';

interface MedidoresViewProps {
  onGoToLectura?: (medidorNum: number) => void;
  onGoToCaja?: (medidorId: string) => void;
  initialClienteIdFiltro?: string | null;
}

export const MedidoresView: React.FC<MedidoresViewProps> = ({
  onGoToLectura,
  onGoToCaja,
  initialClienteIdFiltro = null,
}) => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoMedidor | 'todos'>('todos');
  const [zonaFiltro, setZonaFiltro] = useState<string>('todas');
  const [clienteFiltroId, setClienteFiltroId] = useState<string>(initialClienteIdFiltro || 'todos');
  const [selectedMedidorId, setSelectedMedidorId] = useState<string | null>(null);

  // Modales
  const [showAddModal, setShowAddModal] = useState(false);
  const [medidorParaEditar, setMedidorParaEditar] = useState<Medidor | null>(null);
  const [medidorParaEliminar, setMedidorParaEliminar] = useState<
    (Medidor & { clienteNombre?: string }) | null
  >(null);

  // Formulario nuevo medidor
  const [nuevoNumero, setNuevoNumero] = useState('');
  const [nuevoClienteId, setNuevoClienteId] = useState('');
  const [nuevaDireccion, setNuevaDireccion] = useState('');
  const [nuevaZona, setNuevaZona] = useState('San José');
  const [nuevaLat, setNuevaLat] = useState('-25.3400');
  const [nuevaLng, setNuevaLng] = useState('-57.5100');
  const [nuevaFechaInst, setNuevaFechaInst] = useState(new Date().toISOString().split('T')[0]);

  // Formulario editar medidor
  const [editDireccion, setEditDireccion] = useState('');
  const [editZona, setEditZona] = useState('');
  const [editLat, setEditLat] = useState('');
  const [editLng, setEditLng] = useState('');
  const [editEstado, setEditEstado] = useState<EstadoMedidor>('activo');

  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

  // 50 registros por página
  const limit = 50;

  // Obtener clientes para filtros y asignaciones
  const clientesList = db.getClientes({ limit: 50 }).clientes;

  // Filtrado
  const data = db.getMedidores({
    page,
    limit,
    estado: estadoFiltro,
    zona: zonaFiltro,
    search: clienteFiltroId !== 'todos' ? '' : search,
  });

  // Si hay filtro por cliente específico, filtrar sobre los medidores
  let medidoresDisplay = data.medidores;
  let totalDisplay = data.total;
  let totalPagesDisplay = data.totalPages;

  if (clienteFiltroId !== 'todos') {
    const medidoresCliente = db.getMedidoresParaMapa().filter((m) => m.id && db.getMedidorDetalle(m.id)?.cliente?.id === clienteFiltroId);
    medidoresDisplay = data.medidores.filter((m) => m.cliente_id === clienteFiltroId);
    totalDisplay = medidoresCliente.length;
    totalPagesDisplay = Math.ceil(totalDisplay / limit) || 1;
  }

  const medidorDetalle = selectedMedidorId ? db.getMedidorDetalle(selectedMedidorId) : null;

  const handleAbrirCrear = () => {
    setNuevoNumero('');
    setNuevaDireccion('');
    setNuevaZona('San José');
    setNuevaLat('-25.3400');
    setNuevaLng('-57.5100');
    setNuevaFechaInst(new Date().toISOString().split('T')[0]);
    if (clientesList.length > 0) {
      setNuevoClienteId(clienteFiltroId !== 'todos' ? clienteFiltroId : clientesList[0].id);
    }
    setErrorModal(null);
    setShowAddModal(true);
  };

  const handleAbrirEditar = (m: Medidor) => {
    setMedidorParaEditar(m);
    setEditDireccion(m.direccion);
    setEditZona(m.zona);
    setEditLat(String(m.latitud));
    setEditLng(String(m.longitud));
    setEditEstado(m.estado);
    setErrorModal(null);
  };

  const handleCrearMedidor = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorModal(null);

    const tarifa = db.getTarifasVigentes();
    const medidoresTotal = db.getMedidoresParaMapa();
    const numerosExistentes = new Set(medidoresTotal.map((m) => m.numero_medidor));

    // Validación estricta con pure logic
    const validacion = validarNumeroMedidor(
      nuevoNumero,
      numerosExistentes,
      tarifa.max_numero_medidor,
      medidoresTotal.length
    );

    if (!validacion.valido || !validacion.numero) {
      setErrorModal(validacion.error || 'Número de medidor inválido');
      return;
    }

    if (!nuevoClienteId) {
      setErrorModal('El cliente debe estar creado previamente. Seleccione un cliente titular.');
      return;
    }

    if (!nuevaDireccion.trim()) {
      setErrorModal('Debe ingresar la dirección del terreno.');
      return;
    }

    try {
      db.agregarMedidor({
        cliente_id: nuevoClienteId,
        numero_medidor: validacion.numero,
        fecha_instalacion: nuevaFechaInst || new Date().toISOString().split('T')[0],
        direccion: nuevaDireccion.trim(),
        zona: nuevaZona,
        latitud: parseFloat(nuevaLat) || -25.34,
        longitud: parseFloat(nuevaLng) || -57.51,
        estado: 'activo',
      });

      setMensajeExito(`Medidor N° ${validacion.numero} asignado y registrado correctamente.`);
      setShowAddModal(false);
    } catch (err: any) {
      setErrorModal(err.message || 'Error al guardar el medidor.');
    }
  };

  const handleGuardarEdicion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!medidorParaEditar) return;
    setErrorModal(null);

    try {
      db.actualizarMedidor(medidorParaEditar.id, {
        direccion: editDireccion.trim(),
        zona: editZona,
        latitud: parseFloat(editLat) || medidorParaEditar.latitud,
        longitud: parseFloat(editLng) || medidorParaEditar.longitud,
        estado: editEstado,
      });

      setMensajeExito(`Medidor N° ${medidorParaEditar.numero_medidor} actualizado.`);
      setMedidorParaEditar(null);
    } catch (err: any) {
      setErrorModal(err.message || 'Error al actualizar el medidor.');
    }
  };

  const handleConfirmarEliminar = () => {
    if (!medidorParaEliminar) return;

    try {
      db.eliminarMedidor(medidorParaEliminar.id);
      setMensajeExito(`Medidor N° ${medidorParaEliminar.numero_medidor} eliminado del padrón.`);
      setMedidorParaEliminar(null);
      if (selectedMedidorId === medidorParaEliminar.id) {
        setSelectedMedidorId(null);
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">Listado de Medidores</h1>
          <p className="text-sm text-stone-600">
            {totalDisplay.toLocaleString('es-PY')} medidores registrados. Cada medidor es una unidad de negocio independiente con su propio ciclo y deuda.
          </p>
        </div>
        <button
          type="button"
          onClick={handleAbrirCrear}
          className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Registrar Nuevo Medidor</span>
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

      {/* Barra de Filtros y Búsqueda */}
      <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Buscar por N° Medidor, Titular o Terreno..."
              className="w-full pl-10 pr-4 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-900 focus:outline-hidden focus:border-blue-600 focus:bg-white"
            />
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
          </div>

          {/* Filtros por Cliente y Zona */}
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-bold text-stone-500">Cliente:</span>
              <select
                value={clienteFiltroId}
                onChange={(e) => {
                  setClienteFiltroId(e.target.value);
                  setPage(1);
                }}
                className="p-1.5 bg-stone-50 border border-stone-300 rounded-md text-xs font-semibold max-w-[160px] truncate"
              >
                <option value="todos">Todos los clientes</option>
                {clientesList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre_completo}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-bold text-stone-500">Zona:</span>
              <select
                value={zonaFiltro}
                onChange={(e) => {
                  setZonaFiltro(e.target.value);
                  setPage(1);
                }}
                className="p-1.5 bg-stone-50 border border-stone-300 rounded-md text-xs font-semibold"
              >
                <option value="todas">Todas las zonas</option>
                <option value="San José">San José</option>
                <option value="Lucerito">Lucerito</option>
                <option value="Reducto">Reducto</option>
                <option value="Barcequillo">Barcequillo</option>
                <option value="Laurelty">Laurelty</option>
                <option value="Centro">Centro</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-stone-600">
            <span>
              Pág. <b>{page}</b> de <b>{totalPagesDisplay}</b> ({totalDisplay} medidores)
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
              onClick={() => setPage((p) => Math.min(totalPagesDisplay, p + 1))}
              disabled={page >= totalPagesDisplay}
              className="p-1.5 bg-stone-100 hover:bg-stone-200 rounded-md disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Botones de Filtro por Estado */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-stone-100 text-xs">
          <span className="font-semibold text-stone-500 mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Estado:
          </span>
          {(['todos', 'activo', 'moroso', 'pendiente_corte', 'cortado', 'retirado'] as const).map(
            (est) => (
              <button
                key={est}
                type="button"
                onClick={() => {
                  setEstadoFiltro(est);
                  setPage(1);
                }}
                className={`px-2.5 py-1 rounded-md font-semibold capitalize transition-all ${
                  estadoFiltro === est
                    ? est === 'activo'
                      ? 'bg-emerald-600 text-white'
                      : est === 'moroso'
                      ? 'bg-amber-600 text-white'
                      : est === 'pendiente_corte' || est === 'cortado'
                      ? 'bg-red-600 text-white'
                      : 'bg-stone-900 text-white'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                {est.replace('_', ' ')}
              </button>
            )
          )}
        </div>
      </div>

      {/* Tabla de Medidores */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-bold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">N° Medidor</th>
                <th className="px-4 py-3">Titular / Cliente</th>
                <th className="px-4 py-3">Dirección del Terreno</th>
                <th className="px-4 py-3">Zona</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Deuda Pendiente</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {medidoresDisplay.map((m) => (
                <tr key={m.id} className="hover:bg-stone-50 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-stone-900 text-sm">
                    #{m.numero_medidor}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-stone-900 block">{m.clienteNombre}</span>
                    <span className="text-[10px] text-stone-500">CI: {m.clienteDoc}</span>
                  </td>
                  <td className="px-4 py-3 text-stone-600 max-w-xs truncate">{m.direccion}</td>
                  <td className="px-4 py-3 text-stone-600">{m.zona}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${
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
                      <span className="block text-[9px] text-red-600 mt-0.5">Mora congelada</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`font-black ${
                        m.deudaTotal > 0 ? 'text-red-600' : 'text-emerald-700'
                      }`}
                    >
                      {formatGs(m.deudaTotal)}
                    </span>
                    {m.facturasPendientes > 0 && (
                      <span className="block text-[10px] text-stone-500">
                        {m.facturasPendientes} {m.facturasPendientes === 1 ? 'boleta' : 'boletas'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedMedidorId(m.id)}
                        className="p-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-md"
                        title="Ver detalle del medidor"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleAbrirEditar(m)}
                        className="p-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-md"
                        title="Editar datos del medidor"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setMedidorParaEliminar(m)}
                        className="p-1.5 bg-stone-100 hover:bg-red-50 text-stone-500 hover:text-red-700 rounded-md"
                        title="Dar de baja / eliminar medidor"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>

                      {onGoToLectura && (
                        <button
                          type="button"
                          onClick={() => onGoToLectura(m.numero_medidor)}
                          className="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-md"
                          title="Cargar lectura a este medidor"
                        >
                          <Camera className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {onGoToCaja && (
                        <button
                          type="button"
                          onClick={() => onGoToCaja(m.id)}
                          className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-md"
                          title="Cobrar en caja"
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Registrar Nuevo Medidor */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCrearMedidor}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div>
                <span className="text-xs uppercase font-bold text-stone-500">Nueva Unidad</span>
                <h3 className="font-bold text-stone-900 text-base">Registrar Nuevo Medidor</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorModal && (
              <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-red-900 text-xs font-semibold flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorModal}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-stone-700 block mb-1">
                  N° de Medidor (1 a 1000) *
                </label>
                <input
                  type="text"
                  required
                  value={nuevoNumero}
                  onChange={(e) => setNuevoNumero(e.target.value)}
                  placeholder="Ej: 850 (sin ceros adelante, sin decimales)"
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-sm font-bold text-stone-900"
                />
                <span className="text-[10px] text-stone-500 block mt-0.5">
                  Entero único entre 1 y {db.getTarifasVigentes().max_numero_medidor}. No acepta '05' ni '12.5'.
                </span>
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">Cliente Titular Asignado *</label>
                <select
                  required
                  value={nuevoClienteId}
                  onChange={(e) => setNuevoClienteId(e.target.value)}
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold text-stone-900"
                >
                  <option value="">-- Seleccione un cliente registrado --</option>
                  {clientesList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre_completo} (CI: {c.documento})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">Dirección del Terreno / Inmueble *</label>
                <input
                  type="text"
                  required
                  value={nuevaDireccion}
                  onChange={(e) => setNuevaDireccion(e.target.value)}
                  placeholder="Ej: Barrio San José, Calle Los Laureles c/ 14 de Mayo"
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="font-bold text-stone-700 block mb-1">Zona</label>
                  <select
                    value={nuevaZona}
                    onChange={(e) => setNuevaZona(e.target.value)}
                    className="w-full p-2 bg-stone-50 border border-stone-300 rounded-lg text-xs"
                  >
                    <option value="San José">San José</option>
                    <option value="Lucerito">Lucerito</option>
                    <option value="Reducto">Reducto</option>
                    <option value="Barcequillo">Barcequillo</option>
                    <option value="Laurelty">Laurelty</option>
                    <option value="Centro">Centro</option>
                  </select>
                </div>
                <div>
                  <label className="font-bold text-stone-700 block mb-1">Latitud</label>
                  <input
                    type="text"
                    value={nuevaLat}
                    onChange={(e) => setNuevaLat(e.target.value)}
                    className="w-full p-2 bg-stone-50 border border-stone-300 rounded-lg text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="font-bold text-stone-700 block mb-1">Longitud</label>
                  <input
                    type="text"
                    value={nuevaLng}
                    onChange={(e) => setNuevaLng(e.target.value)}
                    className="w-full p-2 bg-stone-50 border border-stone-300 rounded-lg text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">Fecha Instalación</label>
                <input
                  type="date"
                  value={nuevaFechaInst}
                  onChange={(e) => setNuevaFechaInst(e.target.value)}
                  className="w-full p-2 bg-stone-50 border border-stone-300 rounded-lg text-xs"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-stone-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg font-semibold text-xs"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-bold text-xs"
              >
                Guardar Medidor
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Editar Medidor */}
      {medidorParaEditar && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleGuardarEdicion}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div>
                <span className="text-xs uppercase font-bold text-stone-500">Edición</span>
                <h3 className="font-bold text-stone-900 text-base">
                  Editar Medidor N° {medidorParaEditar.numero_medidor}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setMedidorParaEditar(null)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorModal && (
              <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-red-900 text-xs font-semibold flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorModal}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-stone-700 block mb-1">Dirección del Terreno *</label>
                <input
                  type="text"
                  required
                  value={editDireccion}
                  onChange={(e) => setEditDireccion(e.target.value)}
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-lg text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-stone-700 block mb-1">Zona</label>
                  <select
                    value={editZona}
                    onChange={(e) => setEditZona(e.target.value)}
                    className="w-full p-2 bg-stone-50 border border-stone-300 rounded-lg text-xs"
                  >
                    <option value="San José">San José</option>
                    <option value="Lucerito">Lucerito</option>
                    <option value="Reducto">Reducto</option>
                    <option value="Barcequillo">Barcequillo</option>
                    <option value="Laurelty">Laurelty</option>
                    <option value="Centro">Centro</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-stone-700 block mb-1">Estado</label>
                  <select
                    value={editEstado}
                    onChange={(e) => setEditEstado(e.target.value as EstadoMedidor)}
                    className="w-full p-2 bg-stone-50 border border-stone-300 rounded-lg text-xs font-bold"
                  >
                    <option value="activo">Activo</option>
                    <option value="moroso">Moroso</option>
                    <option value="pendiente_corte">Pendiente de corte</option>
                    <option value="cortado">Cortado</option>
                    <option value="retirado">Retirado</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-stone-700 block mb-1">Latitud</label>
                  <input
                    type="text"
                    value={editLat}
                    onChange={(e) => setEditLat(e.target.value)}
                    className="w-full p-2 bg-stone-50 border border-stone-300 rounded-lg text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="font-bold text-stone-700 block mb-1">Longitud</label>
                  <input
                    type="text"
                    value={editLng}
                    onChange={(e) => setEditLng(e.target.value)}
                    className="w-full p-2 bg-stone-50 border border-stone-300 rounded-lg text-xs font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-stone-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMedidorParaEditar(null)}
                className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg font-semibold text-xs"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-bold text-xs"
              >
                Guardar Cambios
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Confirmar Eliminar Medidor */}
      {medidorParaEliminar && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-2.5 text-red-600">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="font-bold text-stone-900 text-base">Dar de Baja Medidor</h3>
            </div>

            <p className="text-xs text-stone-600">
              ¿Está seguro de dar de baja o eliminar el <b>Medidor N° {medidorParaEliminar.numero_medidor}</b>?
              Esta unidad pertenece a <b>{medidorParaEliminar.clienteNombre}</b>.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-stone-200">
              <button
                type="button"
                onClick={() => setMedidorParaEliminar(null)}
                className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg font-semibold text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmarEliminar}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-xs"
              >
                Confirmar Baja
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Ficha Detallada del Medidor */}
      {medidorDetalle && medidorDetalle.medidor && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between border-b border-stone-200 pb-3">
              <div>
                <span className="text-xs uppercase font-bold text-stone-500">Detalle de Unidad</span>
                <h2 className="text-xl font-black text-stone-900">
                  Medidor N° {medidorDetalle.medidor.numero_medidor}
                </h2>
                <p className="text-xs text-stone-600">
                  Titular: <b>{medidorDetalle.cliente?.nombre_completo}</b> | C.I.: {medidorDetalle.cliente?.documento}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMedidorId(null)}
                className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Ficha técnica */}
            <div className="grid grid-cols-2 gap-3 text-xs bg-stone-50 p-3.5 rounded-xl border border-stone-200">
              <div>
                <span className="text-stone-500 block">Dirección Terreno:</span>
                <span className="font-semibold text-stone-800">{medidorDetalle.medidor.direccion}</span>
              </div>
              <div>
                <span className="text-stone-500 block">Zona de Red:</span>
                <span className="font-semibold text-stone-800">{medidorDetalle.medidor.zona}</span>
              </div>
              <div>
                <span className="text-stone-500 block">Coordenadas GPS:</span>
                <span className="font-mono text-stone-700">
                  {medidorDetalle.medidor.latitud}, {medidorDetalle.medidor.longitud}
                </span>
              </div>
              <div>
                <span className="text-stone-500 block">Fecha Instalación:</span>
                <span className="font-semibold text-stone-800">
                  {medidorDetalle.medidor.fecha_instalacion}
                </span>
              </div>
            </div>

            {/* Lecturas Históricas */}
            <div className="space-y-2">
              <h3 className="font-bold text-stone-900 text-sm">Historial de Lecturas Registradas</h3>
              <div className="bg-stone-50 rounded-xl border border-stone-200 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-stone-100 text-stone-600 font-bold uppercase">
                    <tr>
                      <th className="px-3 py-2">Periodo</th>
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2">Lectura Ant.</th>
                      <th className="px-3 py-2">Lectura Act.</th>
                      <th className="px-3 py-2">Consumo</th>
                      <th className="px-3 py-2 text-right">Foto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {medidorDetalle.lecturas.map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-2 font-bold">{l.periodo}</td>
                        <td className="px-3 py-2 text-stone-600">{l.fecha_lectura}</td>
                        <td className="px-3 py-2">{l.lectura_anterior} m³</td>
                        <td className="px-3 py-2 font-bold">{l.lectura_actual} m³</td>
                        <td className="px-3 py-2 font-black text-blue-700">{l.consumo_m3} m³</td>
                        <td className="px-3 py-2 text-right">
                          <a
                            href={l.foto_medidor_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-blue-600 hover:underline font-semibold"
                          >
                            Ver Foto
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Facturas */}
            <div className="space-y-2">
              <h3 className="font-bold text-stone-900 text-sm">Facturas del Medidor</h3>
              <div className="bg-stone-50 rounded-xl border border-stone-200 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-stone-100 text-stone-600 font-bold uppercase">
                    <tr>
                      <th className="px-3 py-2">Periodo</th>
                      <th className="px-3 py-2">Vencimiento</th>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {medidorDetalle.facturas.map((f) => (
                      <tr key={f.id}>
                        <td className="px-3 py-2 font-bold">{f.periodo_facturado}</td>
                        <td className="px-3 py-2 text-stone-600">{f.fecha_vencimiento}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-1.5 py-0.5 rounded-sm font-bold uppercase text-[9px] ${
                              f.estado === 'pagada'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {f.estado}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-black">{formatGs(f.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pt-3 border-t border-stone-200 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedMedidorId(null)}
                className="px-4 py-2 bg-stone-900 text-white font-semibold rounded-lg text-xs"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
