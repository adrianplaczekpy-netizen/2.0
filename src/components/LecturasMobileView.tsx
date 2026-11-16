/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../services/database';
import { comprimirFotoLectura, generarFotoPlaceholder } from '../utils/imageCompressor';
import { exportarLecturasCSV } from '../utils/exportCsv';
import {
  verificarAlertaConsumo,
  validarLecturaIngreso,
  validarEdicionLectura,
} from '../services/billingRules';
import { Lectura } from '../types';
import {
  Camera,
  Search,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  Upload,
  Calendar,
  FileSpreadsheet,
  Smartphone,
  History,
  Edit2,
  Trash2,
  Eye,
  X,
  MapPin,
  Save,
  ShieldCheck,
  ShieldAlert,
  FileText,
  User,
  Filter,
  Loader2,
  FileDown,
} from 'lucide-react';
import { descargarBoletaServer } from '../services/apiPdfService';

export const LecturasMobileView: React.FC = () => {
  const { user } = useAuth();
  const esAdmin = user?.rol === 'admin';

  // Subpestañas del módulo
  const [subTab, setSubTab] = useState<'toma' | 'historial'>('toma');

  // Estados de generación server-side de PDF
  const [generatingBoletaId, setGeneratingBoletaId] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // --- ESTADOS PARA TOMA DE LECTURAS MÓVIL ---
  const [numeroMedidorInput, setNumeroMedidorInput] = useState<string>('1');
  const [selectedMedidorNum, setSelectedMedidorNum] = useState<number>(1);
  const [fechaLectura, setFechaLectura] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [lecturaActualInput, setLecturaActualInput] = useState<string>('');
  const [fotoUrl, setFotoUrl] = useState<string>('');
  const [fotoKb, setFotoKb] = useState<number>(0);
  const [observaciones, setObservaciones] = useState<string>('');
  const [fotoObsUrl, setFotoObsUrl] = useState<string>('');
  const [isCompressing, setIsCompressing] = useState<boolean>(false);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [errorValidacion, setErrorValidacion] = useState<string | null>(null);

  // Override admin para lectura menor
  const [permitirLecturaMenorAdmin, setPermitirLecturaMenorAdmin] = useState<boolean>(false);
  const [justificacionAdminMenor, setJustificacionAdminMenor] = useState<string>('');

  // Modal de advertencia antes de confirmar consumo elevado
  const [showWarningModal, setShowWarningModal] = useState<boolean>(false);
  const [accionPendienteConfirmacion, setAccionPendienteConfirmacion] = useState<
    'confirmada' | 'borrador'
  >('confirmada');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileObsInputRef = useRef<HTMLInputElement>(null);

  // --- ESTADOS PARA HISTORIAL DE LECTURAS ---
  const [historialPage, setHistorialPage] = useState<number>(1);
  const [filtroSearch, setFiltroSearch] = useState<string>('');
  const [filtroPeriodo, setFiltroPeriodo] = useState<string>('todos');
  const [filtroEstado, setFiltroEstado] = useState<string>('todos');
  const [filtroLector, setFiltroLector] = useState<string>('todos');
  const [filtroNumMedidor, setFiltroNumMedidor] = useState<string>('');
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  // Modales de Historial
  const [fotoModalUrl, setFotoModalUrl] = useState<{
    url: string;
    titulo: string;
    lectura?: number;
    medidorNum?: number;
    obs?: string | null;
  } | null>(null);

  const [lecturaParaEditar, setLecturaParaEditar] = useState<any | null>(null);
  const [editLecturaActual, setEditLecturaActual] = useState<string>('');
  const [editFechaLectura, setEditFechaLectura] = useState<string>('');
  const [editObservaciones, setEditObservaciones] = useState<string>('');
  const [editEstado, setEditEstado] = useState<'borrador' | 'confirmada'>('confirmada');
  const [editMotivoAuditoria, setEditMotivoAuditoria] = useState<string>('');
  const [editError, setEditError] = useState<string | null>(null);

  const [lecturaParaEliminar, setLecturaParaEliminar] = useState<any | null>(null);
  const [deleteMotivoAuditoria, setDeleteMotivoAuditoria] = useState<string>('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDescargarBoleta = async (facturaId: string, medidorNum: number, periodo: string) => {
    setGeneratingBoletaId(facturaId);
    setPdfError(null);
    try {
      const filename = `Boleta_${periodo}_Med_${medidorNum}.pdf`;
      await descargarBoletaServer(facturaId, filename);
    } catch (err: any) {
      setPdfError(err.message || 'No se pudo generar el PDF. Intentá de nuevo.');
    } finally {
      setGeneratingBoletaId(null);
    }
  };

  // Obtener datos del medidor seleccionado para Toma Móvil
  const medidoresRes = db.getMedidores({ search: String(selectedMedidorNum), limit: 1 });
  const medidorActual =
    medidoresRes.medidores.find((m) => m.numero_medidor === selectedMedidorNum) ||
    medidoresRes.medidores[0];
  const medidorDetalle = medidorActual ? db.getMedidorDetalle(medidorActual.id) : null;

  const ultimaLectura = medidorDetalle?.lecturas[0];
  const lecturaAnterior = ultimaLectura ? ultimaLectura.lectura_actual : 0;

  // Historial de consumo de ESE medidor para promedio
  const historialConsumos = medidorDetalle?.lecturas.map((l) => l.consumo_m3) || [];
  const tarifa = db.getTarifasVigentes();

  const lecturaActualNum = parseInt(lecturaActualInput, 10);
  const tieneLecturaValida = !isNaN(lecturaActualNum);
  const consumoCalculado = tieneLecturaValida ? lecturaActualNum - lecturaAnterior : 0;
  const esLecturaMenor = tieneLecturaValida && lecturaActualNum < lecturaAnterior;

  // Verificación estricta: requiere al menos 3 meses de historial en ESE medidor
  const alertaConsumo =
    tieneLecturaValida && !esLecturaMenor
      ? verificarAlertaConsumo(consumoCalculado, historialConsumos, tarifa.umbral_alerta_consumo)
      : { esElevado: false, promedio: 0, razon: 0, tieneHistorialSuficiente: false };

  // Manejar compresión de foto de medidor (target ~300 KB)
  const handleFotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsCompressing(true);
      const compressedDataUrl = await comprimirFotoLectura(file, 300);
      setFotoUrl(compressedDataUrl);
      const kb = Math.round((compressedDataUrl.length * 3) / 4 / 1024);
      setFotoKb(kb);
    } catch (err) {
      console.warn('Error al comprimir foto:', err);
    } finally {
      setIsCompressing(false);
    }
  };

  // Manejar compresión de foto de observación
  const handleFotoObsUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const compressed = await comprimirFotoLectura(file, 300);
      setFotoObsUrl(compressed);
    } catch (err) {
      console.warn('Error al comprimir foto observación:', err);
    }
  };

  const handleUsarFotoDemo = () => {
    const lecturaTarget = tieneLecturaValida ? lecturaActualNum : lecturaAnterior + 10;
    const demoUrl = generarFotoPlaceholder(selectedMedidorNum, lecturaTarget);
    setFotoUrl(demoUrl);
    setFotoKb(240);
  };

  const handleBuscarMedidor = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(numeroMedidorInput, 10);
    if (!isNaN(num) && num >= 1 && num <= tarifa.max_numero_medidor) {
      setSelectedMedidorNum(num);
      resetFormCampos();
    }
  };

  const handleNumpadPress = (digit: string) => {
    setLecturaActualInput((prev) => `${prev}${digit}`);
  };

  const handleNumpadClear = () => {
    setLecturaActualInput('');
  };

  const handleNumpadBackspace = () => {
    setLecturaActualInput((prev) => prev.slice(0, -1));
  };

  const resetFormCampos = () => {
    setLecturaActualInput('');
    setFotoUrl('');
    setFotoKb(0);
    setObservaciones('');
    setFotoObsUrl('');
    setPermitirLecturaMenorAdmin(false);
    setJustificacionAdminMenor('');
    setMensajeExito(null);
    setErrorValidacion(null);
    setShowWarningModal(false);
  };

  const handleSiguienteMedidor = () => {
    if (selectedMedidorNum < tarifa.max_numero_medidor) {
      const next = selectedMedidorNum + 1;
      setSelectedMedidorNum(next);
      setNumeroMedidorInput(String(next));
      resetFormCampos();
    }
  };

  const handleAnteriorMedidor = () => {
    if (selectedMedidorNum > 1) {
      const prev = selectedMedidorNum - 1;
      setSelectedMedidorNum(prev);
      setNumeroMedidorInput(String(prev));
      resetFormCampos();
    }
  };

  const handleClickGuardar = (modo: 'confirmada' | 'borrador') => {
    setErrorValidacion(null);
    setMensajeExito(null);

    const validacion = validarLecturaIngreso({
      lecturaActual: lecturaActualNum,
      lecturaAnterior,
      esAdmin: Boolean(esAdmin),
      justificacionAdmin: justificacionAdminMenor,
    });

    if (!validacion.valida) {
      setErrorValidacion(validacion.error || 'Lectura inválida.');
      return;
    }

    if (!fotoUrl) {
      setErrorValidacion('La foto del medidor es obligatoria.');
      return;
    }

    // Si tiene consumo elevado (> 3x promedio) y va a guardar como confirmada, alertar y pedir confirmación
    if (alertaConsumo.esElevado && modo === 'confirmada') {
      setAccionPendienteConfirmacion(modo);
      setShowWarningModal(true);
      return;
    }

    ejecutarRegistroFinal(modo);
  };

  const ejecutarRegistroFinal = (modo: 'confirmada' | 'borrador') => {
    setShowWarningModal(false);
    const finalFoto = fotoUrl || generarFotoPlaceholder(selectedMedidorNum, lecturaActualNum);

    try {
      const res = db.registrarLectura({
        numeroMedidor: selectedMedidorNum,
        lecturaActual: lecturaActualNum,
        fechaLectura,
        fotoUrl: finalFoto,
        observaciones: observaciones.trim() || undefined,
        fotoObservacionUrl: fotoObsUrl || undefined,
        estado: modo,
        registradoPor: user?.nombre || user?.email || 'Lector Móvil',
        esAdmin,
        justificacionAdmin: esLecturaMenor ? justificacionAdminMenor : undefined,
      });

      setMensajeExito(
        `Lectura guardada como ${modo.toUpperCase()} con éxito (${res.consumoM3} m³ para Medidor N° ${selectedMedidorNum}).`
      );
      setRefreshTrigger((k) => k + 1);

      // Auto avanzar tras 1.4s si fue confirmada
      if (modo === 'confirmada') {
        setTimeout(() => {
          handleSiguienteMedidor();
        }, 1400);
      }
    } catch (err: any) {
      setErrorValidacion(err.message || 'Error al guardar la lectura.');
    }
  };

  // --- DATOS DEL HISTORIAL DE LECTURAS ---
  const numMedidorFiltroParsed = parseInt(filtroNumMedidor, 10);
  const historialRes = db.getLecturas({
    page: historialPage,
    limit: 50, // Paginación estricta de 50 registros por página
    search: filtroSearch,
    periodo: filtroPeriodo,
    estado: filtroEstado,
    lector: filtroLector,
    numeroMedidor: !isNaN(numMedidorFiltroParsed) ? numMedidorFiltroParsed : undefined,
  });

  const listaLectores = db.getLectoresList();

  const handleExportarExcel = () => {
    // Exporta todo el conjunto filtrado (no solo la página actual)
    const exportData = db.getLecturas({
      page: 1,
      limit: 50,
      search: filtroSearch,
      periodo: filtroPeriodo,
      estado: filtroEstado,
      lector: filtroLector,
      numeroMedidor: !isNaN(numMedidorFiltroParsed) ? numMedidorFiltroParsed : undefined,
    });

    exportarLecturasCSV(
      exportData.lecturas,
      `lecturas_aguateria_${filtroPeriodo !== 'todos' ? filtroPeriodo : 'general'}.csv`
    );
  };

  // Abrir modal de edición
  const handleAbrirEditar = (lectura: any) => {
    setLecturaParaEditar(lectura);
    setEditLecturaActual(String(lectura.lectura_actual));
    setEditFechaLectura(lectura.fecha_lectura);
    setEditObservaciones(lectura.observaciones || '');
    setEditEstado(lectura.estado);
    setEditMotivoAuditoria('');
    setEditError(null);
  };

  // Confirmar edición
  const handleGuardarEdicion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lecturaParaEditar) return;
    setEditError(null);

    const nuevaActual = parseInt(editLecturaActual, 10);
    if (isNaN(nuevaActual) || nuevaActual < 0) {
      setEditError('La lectura actual debe ser un número entero mayor o igual a 0.');
      return;
    }

    try {
      db.actualizarLectura(
        lecturaParaEditar.id,
        {
          lecturaActual: nuevaActual,
          fechaLectura: editFechaLectura,
          estado: editEstado,
          observaciones: editObservaciones,
          motivoEdicion: editMotivoAuditoria.trim() || undefined,
        },
        {
          id: user?.id || 'admin',
          rol: user?.rol || 'lectura',
          nombre: user?.nombre || 'Usuario',
        }
      );

      setLecturaParaEditar(null);
      setRefreshTrigger((k) => k + 1);
    } catch (err: any) {
      setEditError(err.message || 'Error al actualizar lectura.');
    }
  };

  // Abrir modal de eliminación
  const handleAbrirEliminar = (lectura: any) => {
    setLecturaParaEliminar(lectura);
    setDeleteMotivoAuditoria('');
    setDeleteError(null);
  };

  // Confirmar eliminación
  const handleConfirmarEliminar = () => {
    if (!lecturaParaEliminar) return;
    setDeleteError(null);

    try {
      db.eliminarLectura(
        lecturaParaEliminar.id,
        {
          id: user?.id || 'admin',
          rol: user?.rol || 'lectura',
          nombre: user?.nombre || 'Usuario',
        },
        deleteMotivoAuditoria.trim() || undefined
      );

      setLecturaParaEliminar(null);
      setRefreshTrigger((k) => k + 1);
    } catch (err: any) {
      setDeleteError(err.message || 'Error al eliminar lectura.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Selector de Subpestañas Superior: Toma Móvil vs Historial */}
      <div className="bg-white border border-stone-200 rounded-xl p-1.5 flex gap-1 shadow-xs max-w-xl mx-auto">
        <button
          type="button"
          onClick={() => setSubTab('toma')}
          className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-colors ${
            subTab === 'toma'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
          }`}
        >
          <Smartphone className="w-4 h-4" />
          <span>Toma de Lecturas Móvil</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('historial')}
          className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-colors ${
            subTab === 'historial'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Historial de Lecturas ({historialRes.total})</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* VISTA 1: TOMA DE LECTURAS MÓVIL (Operario en Campo)                        */}
      {/* ========================================================================= */}
      {subTab === 'toma' && (
        <div className="max-w-xl mx-auto space-y-4">
          {/* Header Operativo Móvil */}
          <div className="bg-stone-900 text-white p-4 rounded-2xl shadow-xs flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-blue-400">
                Ruta de Lectura en Terreno
              </div>
              <h1 className="text-lg font-black text-white">Ingreso de Lectura de Medidor</h1>
            </div>
            <div className="text-right">
              <span className="inline-block bg-stone-800 text-stone-200 text-xs px-2.5 py-1 rounded-md font-mono font-bold border border-stone-700">
                Lector: {user?.nombre?.split(' ')[0] || 'Campo'}
              </span>
            </div>
          </div>

          {/* Buscador de Medidor & Selector Rápido */}
          <form onSubmit={handleBuscarMedidor} className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                value={numeroMedidorInput}
                onChange={(e) => setNumeroMedidorInput(e.target.value)}
                placeholder="N° Medidor (1-1000)"
                className="w-full pl-10 pr-4 py-3 bg-white border-2 border-stone-300 rounded-xl text-base font-bold text-stone-900 focus:outline-hidden focus:border-blue-600 transition-colors shadow-xs"
              />
              <Search className="w-5 h-5 text-stone-400 absolute left-3.5 top-3.5" />
            </div>
            <button
              type="submit"
              className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm shadow-xs transition-colors"
            >
              Buscar
            </button>
          </form>

          {/* Navegación Siguiente / Anterior con botones táctiles grandes */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleAnteriorMedidor}
              disabled={selectedMedidorNum <= 1}
              className="py-2.5 px-3 bg-white border border-stone-200 rounded-xl text-stone-700 font-semibold text-xs flex items-center justify-center gap-1.5 active:bg-stone-100 disabled:opacity-40 shadow-xs"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Anterior ({selectedMedidorNum > 1 ? selectedMedidorNum - 1 : 1})</span>
            </button>

            <button
              type="button"
              onClick={handleSiguienteMedidor}
              disabled={selectedMedidorNum >= tarifa.max_numero_medidor}
              className="py-2.5 px-3 bg-white border border-stone-200 rounded-xl text-stone-700 font-semibold text-xs flex items-center justify-center gap-1.5 active:bg-stone-100 disabled:opacity-40 shadow-xs"
            >
              <span>
                Siguiente ({selectedMedidorNum < tarifa.max_numero_medidor ? selectedMedidorNum + 1 : tarifa.max_numero_medidor})
              </span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Tarjeta del Medidor Actual (Unidad Independiente) */}
          {medidorActual && (
            <div className="bg-white border-2 border-stone-200 rounded-2xl p-5 shadow-xs space-y-4">
              {/* Información del Medidor y Cliente */}
              <div className="flex items-start justify-between border-b border-stone-100 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-black text-stone-900">
                      Medidor N° {medidorActual.numero_medidor}
                    </span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                        medidorActual.estado === 'activo'
                          ? 'bg-emerald-100 text-emerald-800'
                          : medidorActual.estado === 'moroso'
                          ? 'bg-amber-100 text-amber-800'
                          : medidorActual.estado === 'pendiente_corte'
                          ? 'bg-red-100 text-red-800 font-black animate-pulse'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {medidorActual.estado.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-stone-800 mt-1">
                    {medidorActual.clienteNombre}
                  </p>
                  <p className="text-xs text-stone-500 flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    <span>{medidorActual.direccion}</span>
                  </p>
                </div>
              </div>

              {/* Fecha de Lectura (Default Hoy, Ajustable) */}
              <div className="bg-stone-50 p-3 rounded-xl border border-stone-200 flex items-center justify-between">
                <label className="text-xs font-bold text-stone-700 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-blue-600" />
                  <span>Fecha de Toma de Lectura</span>
                </label>
                <input
                  type="date"
                  value={fechaLectura}
                  onChange={(e) => setFechaLectura(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-stone-300 rounded-lg text-xs font-semibold text-stone-800 focus:outline-hidden focus:border-blue-600"
                />
              </div>

              {/* Comparativa de Lecturas con Cálculo Automático */}
              <div className="grid grid-cols-2 gap-3 bg-stone-50 p-3.5 rounded-xl border border-stone-200">
                <div>
                  <span className="text-[11px] font-semibold text-stone-500 uppercase block">
                    Lectura Anterior
                  </span>
                  <div className="text-2xl font-mono font-bold text-stone-800 mt-0.5">
                    {lecturaAnterior}{' '}
                    <span className="text-sm font-sans font-normal text-stone-500">m³</span>
                  </div>
                  <span className="text-[11px] text-stone-500">
                    {ultimaLectura ? `Registrada: ${ultimaLectura.fecha_lectura}` : 'Inicial'}
                  </span>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-blue-700 uppercase block">
                    Consumo Calculado
                  </span>
                  <div
                    className={`text-2xl font-mono font-black mt-0.5 ${
                      esLecturaMenor
                        ? 'text-red-600'
                        : alertaConsumo.esElevado
                        ? 'text-red-600'
                        : 'text-blue-600'
                    }`}
                  >
                    {tieneLecturaValida
                      ? esLecturaMenor
                        ? 'NEGATIVO'
                        : `+${consumoCalculado}`
                      : '--'}{' '}
                    <span className="text-sm font-sans font-normal text-stone-500">m³</span>
                  </div>
                  <span className="text-[11px] text-stone-500">
                    {alertaConsumo.tieneHistorialSuficiente
                      ? `Promedio (3m): ~${alertaConsumo.promedio} m³`
                      : 'Historial < 3 meses (alerta inactiva)'}
                  </span>
                </div>
              </div>

              {/* ALERTA DE CONSUMO ELEVADO IN SITU */}
              {alertaConsumo.esElevado && (
                <div className="bg-red-50 border-2 border-red-500 p-3.5 rounded-xl flex items-start gap-3 text-red-900">
                  <AlertTriangle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <div className="font-black text-red-700 text-sm">
                      ¡ALERTA DE CONSUMO ELEVADO DETECTADA!
                    </div>
                    <p>
                      El consumo de este mes ({consumoCalculado} m³) supera en{' '}
                      <b>{alertaConsumo.razon}x</b> el promedio de los últimos 3 meses de este
                      medidor ({alertaConsumo.promedio} m³).
                    </p>
                    <p className="text-[11px] text-red-700 font-semibold">
                      En la boleta impresa se imprimirá un aviso destacado en rojo y negrita si se
                      confirma.
                    </p>
                  </div>
                </div>
              )}

              {/* ERROR O ADVERTENCIA DE LECTURA MENOR */}
              {esLecturaMenor && (
                <div className="bg-red-50 border-2 border-red-500 p-3.5 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-red-800 text-xs font-bold">
                    <AlertTriangle className="w-5 h-5 shrink-0 text-red-600" />
                    <span>
                      La lectura actual ({lecturaActualNum}) es menor a la anterior ({lecturaAnterior}{' '}
                      m³).
                    </span>
                  </div>
                  {!esAdmin ? (
                    <p className="text-[11px] text-red-700">
                      Registro bloqueado para operadores de campo. Solo un Administrador puede autorizar
                      una lectura menor con justificación de auditoría.
                    </p>
                  ) : (
                    <div className="pt-2 border-t border-red-200 space-y-2">
                      <label className="flex items-center gap-2 text-xs font-bold text-red-900 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={permitirLecturaMenorAdmin}
                          onChange={(e) => setPermitirLecturaMenorAdmin(e.target.checked)}
                          className="rounded text-red-600 focus:ring-red-500"
                        />
                        <span>Autorizar como Administrador (reloj reiniciado o cambio de medidor)</span>
                      </label>
                      {permitirLecturaMenorAdmin && (
                        <input
                          type="text"
                          value={justificacionAdminMenor}
                          onChange={(e) => setJustificacionAdminMenor(e.target.value)}
                          placeholder="Motivo de auditoría obligatorio (ej: Medidor nuevo tras rotura)"
                          className="w-full px-3 py-2 bg-white border border-red-300 rounded-lg text-xs font-medium text-stone-900 focus:outline-hidden"
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Campo de Entrada de Lectura Actual con Números Grandes */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-800 flex items-center justify-between">
                  <span>Lectura Actual (Reloj del Medidor)</span>
                  <span className="text-[11px] font-normal text-stone-500">
                    Entero sin decimales
                  </span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={lecturaActualInput}
                    onChange={(e) => setLecturaActualInput(e.target.value)}
                    placeholder={`Ej: ${lecturaAnterior + 10}`}
                    className="w-full px-4 py-3.5 text-2xl font-mono font-black text-stone-900 bg-white border-2 border-stone-300 rounded-xl focus:border-blue-600 focus:outline-hidden tracking-wider shadow-inner"
                  />
                  {lecturaActualInput && (
                    <button
                      type="button"
                      onClick={handleNumpadClear}
                      className="absolute right-3 top-3.5 p-1 text-stone-400 hover:text-stone-600"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Teclado Táctil Rápido para Operarios en Campo */}
              <div className="bg-stone-100 p-2.5 rounded-xl border border-stone-200">
                <div className="text-[10px] font-bold uppercase text-stone-500 mb-1.5 tracking-wider">
                  Teclado Táctil de Campo
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-stone-800 font-bold">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      onClick={() => handleNumpadPress(digit)}
                      className="py-2.5 bg-white border border-stone-200 rounded-lg text-base font-mono hover:bg-stone-50 active:bg-blue-50 active:border-blue-400 shadow-2xs"
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={handleNumpadClear}
                    className="py-2.5 bg-stone-200 border border-stone-300 rounded-lg text-xs font-semibold hover:bg-stone-300"
                  >
                    Borrar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNumpadPress('0')}
                    className="py-2.5 bg-white border border-stone-200 rounded-lg text-base font-mono hover:bg-stone-50 active:bg-blue-50 active:border-blue-400 shadow-2xs"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={handleNumpadBackspace}
                    className="py-2.5 bg-stone-200 border border-stone-300 rounded-lg text-xs font-semibold hover:bg-stone-300"
                  >
                    ⌫
                  </button>
                </div>
              </div>

              {/* Foto Obligatoria del Medidor (con compresión target ~300 KB) */}
              <div className="space-y-2 pt-2 border-t border-stone-100">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-stone-800 flex items-center gap-1.5 uppercase tracking-wider">
                    <Camera className="w-4 h-4 text-blue-600" />
                    <span>Foto del Medidor (Obligatoria)</span>
                  </label>
                  {fotoKb > 0 && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-sm bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Comprimida: {fotoKb} KB (Target ~300 KB)
                    </span>
                  )}
                </div>

                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  ref={fileInputRef}
                  onChange={handleFotoUpload}
                  className="hidden"
                />

                {fotoUrl ? (
                  <div className="relative rounded-xl overflow-hidden border border-stone-300 bg-stone-900 group">
                    <img src={fotoUrl} alt="Foto Medidor" className="w-full h-44 object-cover" />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1.5 bg-white text-stone-900 font-bold rounded-lg text-xs shadow-xs"
                      >
                        Cambiar Foto
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setFotoModalUrl({
                            url: fotoUrl,
                            titulo: `Medidor N° ${selectedMedidorNum}`,
                            lectura: lecturaActualNum,
                            medidorNum: selectedMedidorNum,
                          })
                        }
                        className="px-3 py-1.5 bg-stone-900 text-white font-bold rounded-lg text-xs shadow-xs"
                      >
                        Ver Completa
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isCompressing}
                      className="py-3 px-3 bg-stone-100 hover:bg-stone-200 border-2 border-dashed border-stone-300 rounded-xl flex flex-col items-center justify-center gap-1 text-stone-700 font-bold text-xs active:bg-stone-200"
                    >
                      <Camera className="w-5 h-5 text-blue-600" />
                      <span>{isCompressing ? 'Comprimiendo...' : 'Tomar Foto Cámara'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleUsarFotoDemo}
                      className="py-3 px-3 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl flex flex-col items-center justify-center gap-1 text-blue-900 font-semibold text-xs text-center"
                    >
                      <Upload className="w-5 h-5 text-blue-700" />
                      <span>Cargar Foto Certificada Demo</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Observaciones Internas (NO se imprimen en boleta) + Foto de Observación */}
              <div className="space-y-2 pt-2 border-t border-stone-100">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-stone-500" />
                    <span>Observaciones (USO INTERNO - No se imprime en boleta)</span>
                  </label>
                  <span className="text-[11px] text-stone-400 font-medium">Opcional</span>
                </div>
                <textarea
                  rows={2}
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Ej: Perro suelto en patio, llave rota, vidrio empañado, fuga visible..."
                  className="w-full p-2.5 bg-white border border-stone-300 rounded-xl text-xs text-stone-800 focus:outline-hidden focus:border-stone-500"
                />

                {/* Foto opcional de observación */}
                <input
                  type="file"
                  accept="image/*"
                  ref={fileObsInputRef}
                  onChange={handleFotoObsUpload}
                  className="hidden"
                />
                <div className="flex items-center justify-between">
                  {fotoObsUrl ? (
                    <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" /> Foto de observación adjunta
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileObsInputRef.current?.click()}
                      className="text-xs text-stone-600 hover:text-stone-900 font-semibold flex items-center gap-1.5 underline"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Adjuntar foto de observación (opcional)</span>
                    </button>
                  )}
                  {fotoObsUrl && (
                    <button
                      type="button"
                      onClick={() => setFotoObsUrl('')}
                      className="text-xs text-red-600 font-semibold hover:underline"
                    >
                      Quitar
                    </button>
                  )}
                </div>
              </div>

              {/* Mensajes de Validación y Éxito */}
              {errorValidacion && (
                <div className="p-3 bg-red-100 border border-red-300 text-red-900 rounded-xl text-xs font-bold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{errorValidacion}</span>
                </div>
              )}

              {mensajeExito && (
                <div className="p-3 bg-emerald-100 border border-emerald-300 text-emerald-900 rounded-xl text-xs font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span>{mensajeExito}</span>
                </div>
              )}

              {/* Botones de Acción: Confirmar vs Guardar como Borrador */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleClickGuardar('confirmada')}
                  disabled={!tieneLecturaValida || (esLecturaMenor && (!esAdmin || !permitirLecturaMenorAdmin))}
                  className="py-3.5 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 text-white font-black text-sm rounded-xl shadow-md flex items-center justify-center gap-2 transition-transform active:scale-98"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  <span>CONFIRMAR LECTURA</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleClickGuardar('borrador')}
                  disabled={!tieneLecturaValida}
                  className="py-3.5 px-4 bg-stone-100 hover:bg-stone-200 active:bg-stone-300 disabled:opacity-40 text-stone-800 font-bold text-sm rounded-xl border border-stone-300 flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4 text-stone-600" />
                  <span>Guardar como Borrador</span>
                </button>
              </div>
            </div>
          )}

          {/* Modal de Advertencia de Consumo Elevado antes de Confirmar */}
          {showWarningModal && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border-2 border-red-500">
                <div className="flex items-center gap-3 text-red-600">
                  <div className="p-2.5 bg-red-100 rounded-xl">
                    <AlertTriangle className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="font-black text-lg text-stone-900">
                      Advertencia: Consumo Elevado
                    </h3>
                    <span className="text-xs text-red-600 font-bold uppercase">
                      Verificación de Medidor Requerida
                    </span>
                  </div>
                </div>

                <div className="space-y-2 text-xs text-stone-700 bg-stone-50 p-3.5 rounded-xl border border-stone-200">
                  <p>
                    El consumo calculado para el <b>Medidor N° {selectedMedidorNum}</b> es de{' '}
                    <span className="text-red-600 font-black text-sm">{consumoCalculado} m³</span>.
                  </p>
                  <p>
                    El promedio de los últimos 3 meses de este medidor es de{' '}
                    <b>{alertaConsumo.promedio} m³</b> (superado en {alertaConsumo.razon} veces).
                  </p>
                  <div className="pt-2 border-t border-stone-200 font-bold text-stone-900">
                    Por favor, verifique el reloj del medidor en el terreno antes de confirmar para
                    descartar error de tipeo o fuga en la instalación del usuario.
                  </div>
                </div>

                <div className="pt-2 flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => setShowWarningModal(false)}
                    className="flex-1 py-3 px-4 bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold text-xs rounded-xl"
                  >
                    Revisar Lectura
                  </button>
                  <button
                    type="button"
                    onClick={() => ejecutarRegistroFinal(accionPendienteConfirmacion)}
                    className="flex-1 py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-extrabold text-xs rounded-xl shadow-md"
                  >
                    Confirmar de todos modos
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* VISTA 2: HISTORIAL DE LECTURAS (Con filtros, Excel y Reglas de Edición)   */}
      {/* ========================================================================= */}
      {subTab === 'historial' && (
        <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-stone-100 pb-4">
            <div>
              <h2 className="text-lg font-black text-stone-900">Historial y Auditoría de Lecturas</h2>
              <p className="text-xs text-stone-500">
                Paginación optimizada a 50 registros por página • Edición y anulación controladas por
                estado de factura
              </p>
            </div>

            <button
              type="button"
              onClick={handleExportarExcel}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-xs transition-colors shrink-0"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Exportar a Excel (CSV)</span>
            </button>
          </div>

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

          {/* Barra de Filtros */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 bg-stone-50 p-3 rounded-xl border border-stone-200">
            {/* Buscador general */}
            <div className="relative">
              <input
                type="text"
                value={filtroSearch}
                onChange={(e) => {
                  setFiltroSearch(e.target.value);
                  setHistorialPage(1);
                }}
                placeholder="Cliente, C.I., dirección..."
                className="w-full pl-8 pr-3 py-2 bg-white border border-stone-300 rounded-lg text-xs font-medium text-stone-800 focus:outline-hidden focus:border-blue-600"
              />
              <Search className="w-4 h-4 text-stone-400 absolute left-2.5 top-2.5" />
            </div>

            {/* Filtro por N° Medidor */}
            <div>
              <input
                type="number"
                value={filtroNumMedidor}
                onChange={(e) => {
                  setFiltroNumMedidor(e.target.value);
                  setHistorialPage(1);
                }}
                placeholder="Filtrar por N° Medidor"
                className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-xs font-medium text-stone-800 focus:outline-hidden focus:border-blue-600"
              />
            </div>

            {/* Filtro Período */}
            <div>
              <select
                value={filtroPeriodo}
                onChange={(e) => {
                  setFiltroPeriodo(e.target.value);
                  setHistorialPage(1);
                }}
                className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-xs font-semibold text-stone-800 focus:outline-hidden focus:border-blue-600"
              >
                <option value="todos">Todos los períodos</option>
                <option value="2025-03">2025-03 (Marzo)</option>
                <option value="2025-02">2025-02 (Febrero)</option>
                <option value="2025-01">2025-01 (Enero)</option>
                <option value="2024-12">2024-12 (Diciembre)</option>
              </select>
            </div>

            {/* Filtro Estado de Lectura */}
            <div>
              <select
                value={filtroEstado}
                onChange={(e) => {
                  setFiltroEstado(e.target.value);
                  setHistorialPage(1);
                }}
                className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-xs font-semibold text-stone-800 focus:outline-hidden focus:border-blue-600"
              >
                <option value="todos">Todos los estados</option>
                <option value="confirmada">Confirmada</option>
                <option value="borrador">Borrador</option>
              </select>
            </div>

            {/* Filtro Lector */}
            <div>
              <select
                value={filtroLector}
                onChange={(e) => {
                  setFiltroLector(e.target.value);
                  setHistorialPage(1);
                }}
                className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-xs font-semibold text-stone-800 focus:outline-hidden focus:border-blue-600"
              >
                <option value="todos">Todos los lectores</option>
                {listaLectores.map((lector) => (
                  <option key={lector} value={lector}>
                    {lector}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Tabla de Lecturas */}
          <div className="overflow-x-auto border border-stone-200 rounded-xl">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-stone-100 text-stone-700 font-bold border-b border-stone-200 uppercase tracking-wider text-[11px]">
                  <th className="p-3">Medidor & Cliente</th>
                  <th className="p-3">Período / Fecha</th>
                  <th className="p-3 text-right">Lectura Ant. → Act.</th>
                  <th className="p-3 text-right">Consumo m³</th>
                  <th className="p-3 text-center">Foto</th>
                  <th className="p-3">Estado Lectura</th>
                  <th className="p-3">Factura Asoc.</th>
                  <th className="p-3">Lector / Auditoría</th>
                  <th className="p-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200 bg-white">
                {historialRes.lecturas.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-stone-500 font-semibold">
                      No se encontraron lecturas que coincidan con los filtros aplicados.
                    </td>
                  </tr>
                ) : (
                  historialRes.lecturas.map((lec) => {
                    return (
                      <tr key={lec.id} className="hover:bg-stone-50 transition-colors">
                        <td className="p-3">
                          <div className="font-black text-stone-900 text-sm">
                            Medidor N° {lec.numero_medidor}
                          </div>
                          <div className="text-stone-700 font-semibold">{lec.cliente_nombre}</div>
                          <div className="text-[11px] text-stone-500">{lec.direccion}</div>
                        </td>

                        <td className="p-3">
                          <span className="font-mono font-bold text-stone-800 block">
                            {lec.periodo}
                          </span>
                          <span className="text-[11px] text-stone-500">{lec.fecha_lectura}</span>
                        </td>

                        <td className="p-3 text-right font-mono">
                          <span className="text-stone-500">{lec.lectura_anterior}</span>
                          <span className="text-stone-400 mx-1">→</span>
                          <span className="font-bold text-stone-900">{lec.lectura_actual}</span>
                        </td>

                        <td className="p-3 text-right">
                          <span className="font-mono font-black text-sm text-stone-900">
                            {lec.consumo_m3} m³
                          </span>
                        </td>

                        <td className="p-3 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              setFotoModalUrl({
                                url: lec.foto_medidor_url,
                                titulo: `Medidor N° ${lec.numero_medidor} (${lec.periodo})`,
                                lectura: lec.lectura_actual,
                                medidorNum: lec.numero_medidor,
                                obs: lec.observaciones,
                              })
                            }
                            className="p-1 hover:bg-stone-100 rounded-md border border-stone-200 inline-block transition-colors"
                            title="Ver Foto del Medidor"
                          >
                            <img
                              src={lec.foto_medidor_url}
                              alt="Foto"
                              className="w-9 h-7 object-cover rounded-xs"
                            />
                          </button>
                        </td>

                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold text-[10px] uppercase ${
                              lec.estado === 'confirmada'
                                ? 'bg-stone-100 text-stone-800 border border-stone-300'
                                : 'bg-amber-100 text-amber-900 border border-amber-300'
                            }`}
                          >
                            {lec.estado}
                          </span>
                          {lec.observaciones && (
                            <span
                              className="block text-[10px] text-stone-500 truncate max-w-36 mt-0.5"
                              title={lec.observaciones}
                            >
                              Obs: {lec.observaciones}
                            </span>
                          )}
                        </td>

                        <td className="p-3">
                          {lec.factura_estado ? (
                            <div className="space-y-1">
                              <span
                                className={`px-2 py-0.5 rounded-sm font-bold text-[10px] uppercase inline-block ${
                                  lec.factura_pagada
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                Factura {lec.factura_estado}
                              </span>
                              {lec.factura_id && (
                                <button
                                  type="button"
                                  disabled={generatingBoletaId === lec.factura_id}
                                  onClick={() => handleDescargarBoleta(lec.factura_id!, lec.numero_medidor, lec.periodo)}
                                  className="flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer disabled:opacity-50"
                                  title="Ver y descargar boleta oficial en PDF"
                                >
                                  {generatingBoletaId === lec.factura_id ? (
                                    <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                                  ) : (
                                    <FileDown className="w-3 h-3" />
                                  )}
                                  <span>{generatingBoletaId === lec.factura_id ? 'Generando...' : 'Ver boleta'}</span>
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-stone-400 text-[11px]">Sin factura</span>
                          )}
                        </td>

                        <td className="p-3 text-[11px] text-stone-600">
                          <div>Por: {lec.registrado_por}</div>
                          {lec.editado_por && (
                            <div className="text-[10px] text-amber-700 font-semibold mt-0.5">
                              Editado por {lec.editado_por}
                            </div>
                          )}
                        </td>

                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleAbrirEditar(lec)}
                              className="p-1.5 text-stone-600 hover:text-blue-600 hover:bg-stone-100 rounded-md transition-colors"
                              title="Editar Lectura"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAbrirEliminar(lec)}
                              className="p-1.5 text-stone-600 hover:text-red-600 hover:bg-stone-100 rounded-md transition-colors"
                              title="Eliminar Lectura"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Paginación estricta a 50 registros por página */}
          <div className="flex items-center justify-between text-xs text-stone-600 pt-2">
            <div>
              Mostrando página <b>{historialRes.page}</b> de <b>{historialRes.totalPages}</b> (Total:{' '}
              {historialRes.total} lecturas • 50 por página)
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setHistorialPage((p) => Math.max(1, p - 1))}
                disabled={historialPage <= 1}
                className="px-3 py-1.5 bg-white border border-stone-300 rounded-lg font-bold disabled:opacity-40 hover:bg-stone-50"
              >
                Anterior
              </button>
              <button
                type="button"
                onClick={() => setHistorialPage((p) => Math.min(historialRes.totalPages, p + 1))}
                disabled={historialPage >= historialRes.totalPages}
                className="px-3 py-1.5 bg-white border border-stone-300 rounded-lg font-bold disabled:opacity-40 hover:bg-stone-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: VISOR DE FOTO CERTIFICADA DEL MEDIDOR                            */}
      {/* ========================================================================= */}
      {fotoModalUrl && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl space-y-3">
            <div className="p-4 bg-stone-900 text-white flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm">{fotoModalUrl.titulo}</h3>
                <span className="text-[11px] text-stone-400">
                  Lectura registrada: {fotoModalUrl.lectura} m³
                </span>
              </div>
              <button
                type="button"
                onClick={() => setFotoModalUrl(null)}
                className="p-1 hover:bg-stone-800 rounded-lg text-stone-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="rounded-xl overflow-hidden border border-stone-200 bg-stone-950 flex items-center justify-center">
                <img
                  src={fotoModalUrl.url}
                  alt="Foto Grande Medidor"
                  className="max-h-80 w-auto object-contain"
                />
              </div>

              {fotoModalUrl.obs && (
                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-xs text-stone-700">
                  <span className="font-bold block text-stone-900">Observaciones Internas:</span>
                  {fotoModalUrl.obs}
                </div>
              )}
            </div>

            <div className="p-3 bg-stone-50 border-t border-stone-200 text-right">
              <button
                type="button"
                onClick={() => setFotoModalUrl(null)}
                className="px-4 py-2 bg-stone-900 text-white font-bold text-xs rounded-lg"
              >
                Cerrar Visor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: EDICIÓN DE LECTURA (Reglas de Auditoría y Recálculo de Factura)  */}
      {/* ========================================================================= */}
      {lecturaParaEditar && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleGuardarEdicion}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-start justify-between border-b border-stone-100 pb-3">
              <div>
                <h3 className="font-black text-lg text-stone-900">Modificar Lectura</h3>
                <p className="text-xs text-stone-500">
                  Medidor N° {lecturaParaEditar.numero_medidor} • Período {lecturaParaEditar.periodo}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLecturaParaEditar(null)}
                className="p-1 text-stone-400 hover:text-stone-600 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Advertencia si la factura ya está pagada */}
            {lecturaParaEditar.factura_pagada && (
              <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl space-y-1">
                <div className="flex items-center gap-1.5 text-amber-900 font-bold text-xs">
                  <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>Atención: Factura Pagada</span>
                </div>
                <p className="text-[11px] text-amber-800">
                  Esta lectura pertenece a una factura ya saldada. Solo un Administrador puede editarla
                  y debe ingresar obligatoriamente una justificación de auditoría.
                </p>
              </div>
            )}

            {/* Aviso si la factura está impaga y se va a recalcular */}
            {lecturaParaEditar.factura_estado && !lecturaParaEditar.factura_pagada && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-[11px] text-blue-900">
                Al guardar, el sistema recalculará automáticamente el importe de agua y ERSSAN de la
                factura impaga de este medidor.
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-stone-700 block mb-1">Lectura Actual (m³)</label>
                <input
                  type="number"
                  value={editLecturaActual}
                  onChange={(e) => setEditLecturaActual(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg font-mono font-bold text-base text-stone-900 focus:outline-hidden focus:border-blue-600"
                />
                <span className="text-[11px] text-stone-500 mt-0.5 block">
                  Lectura anterior: {lecturaParaEditar.lectura_anterior} m³
                </span>
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">Fecha de Lectura</label>
                <input
                  type="date"
                  value={editFechaLectura}
                  onChange={(e) => setEditFechaLectura(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-stone-900 focus:outline-hidden focus:border-blue-600"
                />
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">Estado de la Lectura</label>
                <select
                  value={editEstado}
                  onChange={(e) => setEditEstado(e.target.value as any)}
                  className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-stone-900 focus:outline-hidden focus:border-blue-600"
                >
                  <option value="confirmada">Confirmada</option>
                  <option value="borrador">Borrador</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-stone-700 block mb-1">Observaciones Internas</label>
                <textarea
                  rows={2}
                  value={editObservaciones}
                  onChange={(e) => setEditObservaciones(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-stone-900 focus:outline-hidden focus:border-blue-600"
                />
              </div>

              {/* Justificación obligatoria para facturas pagadas */}
              {lecturaParaEditar.factura_pagada && (
                <div>
                  <label className="font-bold text-red-700 block mb-1">
                    Motivo de Auditoría (Obligatorio) *
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={editMotivoAuditoria}
                    onChange={(e) => setEditMotivoAuditoria(e.target.value)}
                    placeholder="Detalle el motivo del cambio (mínimo 5 caracteres)"
                    className="w-full px-3 py-2 bg-red-50/50 border border-red-300 rounded-lg text-stone-900 focus:outline-hidden focus:border-red-600"
                  />
                </div>
              )}
            </div>

            {editError && (
              <div className="p-3 bg-red-100 border border-red-300 text-red-900 rounded-xl text-xs font-bold">
                {editError}
              </div>
            )}

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setLecturaParaEditar(null)}
                className="flex-1 py-2.5 px-4 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-xs rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs"
              >
                Guardar Cambios
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: ELIMINAR LECTURA (Reglas de Auditoría)                          */}
      {/* ========================================================================= */}
      {lecturaParaEliminar && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <div className="p-2.5 bg-red-100 rounded-xl">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-black text-lg text-stone-900">¿Eliminar Lectura?</h3>
                <span className="text-xs text-stone-500">
                  Medidor N° {lecturaParaEliminar.numero_medidor} ({lecturaParaEliminar.periodo})
                </span>
              </div>
            </div>

            <p className="text-xs text-stone-700">
              Esta acción eliminará el registro de lectura ({lecturaParaEliminar.lectura_actual} m³).
            </p>

            {lecturaParaEliminar.factura_pagada && (
              <div className="p-3.5 bg-red-50 border border-red-300 rounded-xl space-y-2 text-xs">
                <span className="font-bold text-red-900 block">
                  ADVERTENCIA: Factura ya pagada
                </span>
                <p className="text-red-800 text-[11px]">
                  Solo un Administrador puede eliminar lecturas de facturas ya saldadas. Debe ingresar
                  una justificación de auditoría obligatoria.
                </p>
                <textarea
                  rows={2}
                  value={deleteMotivoAuditoria}
                  onChange={(e) => setDeleteMotivoAuditoria(e.target.value)}
                  placeholder="Motivo de eliminación para auditoría..."
                  className="w-full p-2 bg-white border border-red-300 rounded-lg text-xs"
                />
              </div>
            )}

            {deleteError && (
              <div className="p-3 bg-red-100 border border-red-300 text-red-900 rounded-xl text-xs font-bold">
                {deleteError}
              </div>
            )}

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setLecturaParaEliminar(null)}
                className="flex-1 py-2.5 px-4 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-xs rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmarEliminar}
                className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white font-black text-xs rounded-xl shadow-xs"
              >
                Confirmar Eliminación
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
