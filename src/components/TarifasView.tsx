/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/database';
import { isSupabaseConfigured, supabase } from '../services/supabaseClient';
import { TarifaConfig } from '../types';
import { useAuth } from '../context/AuthContext';
import {
  EMPRESA_LEGAL,
  fechaTimbradoASortKey,
  normalizarFechaTimbradoDDMMYYYY,
} from '../services/facturacionHelpers';
import {
  construirMensajeResumenErroresTarifa,
  seleccionarPrimerCampoConError,
} from '../utils/tarifaValidationHelper';
import {
  CheckCircle2,
  AlertTriangle,
  History,
  ShieldAlert,
  AlertCircle,
  Loader2,
  X,
} from 'lucide-react';

export const TarifasView: React.FC = () => {
  const { user } = useAuth();

  // Estados principales
  const [tarifasVigentes, setTarifasVigentes] = useState<TarifaConfig>(() => db.getTarifasVigentes());
  const [historial, setHistorial] = useState<TarifaConfig[]>(() => db.getHistorialTarifas());
  const [tieneTarifasGuardadas, setTieneTarifasGuardadas] = useState<boolean>(() => db.hasTarifasIniciales());

  // Formulario editable para los 11 parámetros
  const [precioM3, setPrecioM3] = useState<string>(String(tarifasVigentes.precio_m3));
  const [consumoMinimoM3, setConsumoMinimoM3] = useState<string>(String(tarifasVigentes.consumo_minimo_m3));
  const [montoMinimoConsumo, setMontoMinimoConsumo] = useState<string>(String(tarifasVigentes.monto_minimo_consumo));
  const [montoMoraFijo, setMontoMoraFijo] = useState<string>(String(tarifasVigentes.monto_mora_fijo));
  const [montoReconexion, setMontoReconexion] = useState<string>(String(tarifasVigentes.monto_reconexion));
  const [erssanPorcentaje, setErssanPorcentaje] = useState<string>(String(tarifasVigentes.erssan_porcentaje));
  const [tipoDiaNormal, setTipoDiaNormal] = useState<'ultimo_dia_mes' | 'numero'>(
    tarifasVigentes.dia_vencimiento_boletas_normales === 'ultimo_dia_mes' ? 'ultimo_dia_mes' : 'numero'
  );
  const [diaNormalNumero, setDiaNormalNumero] = useState<string>(
    typeof tarifasVigentes.dia_vencimiento_boletas_normales === 'number'
      ? String(tarifasVigentes.dia_vencimiento_boletas_normales)
      : '28'
  );
  const [diaVenc3ra, setDiaVenc3ra] = useState<string>(String(tarifasVigentes.dia_vencimiento_tercera_boleta));
  const [umbralAlerta, setUmbralAlerta] = useState<string>(String(tarifasVigentes.umbral_alerta_consumo));
  const [textoAlerta, setTextoAlerta] = useState<string>(tarifasVigentes.texto_alerta_consumo);
  const [maxNumeroMedidor, setMaxNumeroMedidor] = useState<string>(String(tarifasVigentes.max_numero_medidor));
  const [timbrado, setTimbrado] = useState<string>(
    String(tarifasVigentes.timbrado || EMPRESA_LEGAL.timbrado)
  );
  const [timbradoInicioVigencia, setTimbradoInicioVigencia] = useState<string>(
    String(tarifasVigentes.timbrado_inicio_vigencia || EMPRESA_LEGAL.inicioVigencia)
  );
  const [timbradoFinVigencia, setTimbradoFinVigencia] = useState<string>(
    String(tarifasVigentes.timbrado_fin_vigencia || EMPRESA_LEGAL.finVigencia)
  );

  // Metadatos de la nueva versión
  const [vigenteDesde, setVigenteDesde] = useState<string>(new Date().toISOString().split('T')[0]);
  const [motivoCambio, setMotivoCambio] = useState<string>('Actualización de pliego tarifario regulado');

  // Estado de mensajes y errores por campo
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [mensajeErrorGlobal, setMensajeErrorGlobal] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<boolean>(false);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tipo: 'success' | 'error'; texto: string } | null>(null);
  const [usuariosNombresMap, setUsuariosNombresMap] = useState<Record<string, string>>({});

  const errorBannerRef = useRef<HTMLDivElement | null>(null);
  const fieldRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});
  const setFieldRef = (campo: string) => (el: HTMLInputElement | HTMLTextAreaElement | null) => {
    fieldRefs.current[campo] = el;
  };

  const modalOpenOrSavingRef = useRef(false);
  modalOpenOrSavingRef.current = showConfirmModal || guardando;

  const sincronizarDesdeTarifa = (tarifa: TarifaConfig) => {
    setTarifasVigentes(tarifa);
    setPrecioM3(String(tarifa.precio_m3));
    setConsumoMinimoM3(String(tarifa.consumo_minimo_m3));
    setMontoMinimoConsumo(String(tarifa.monto_minimo_consumo));
    setMontoMoraFijo(String(tarifa.monto_mora_fijo));
    setMontoReconexion(String(tarifa.monto_reconexion));
    setErssanPorcentaje(String(tarifa.erssan_porcentaje));
    if (tarifa.dia_vencimiento_boletas_normales === 'ultimo_dia_mes') {
      setTipoDiaNormal('ultimo_dia_mes');
    } else {
      setTipoDiaNormal('numero');
      setDiaNormalNumero(String(tarifa.dia_vencimiento_boletas_normales));
    }
    setDiaVenc3ra(String(tarifa.dia_vencimiento_tercera_boleta));
    setUmbralAlerta(String(tarifa.umbral_alerta_consumo));
    setTextoAlerta(tarifa.texto_alerta_consumo);
    setMaxNumeroMedidor(String(tarifa.max_numero_medidor));
    setTimbrado(String(tarifa.timbrado || EMPRESA_LEGAL.timbrado));
    setTimbradoInicioVigencia(String(tarifa.timbrado_inicio_vigencia || EMPRESA_LEGAL.inicioVigencia));
    setTimbradoFinVigencia(String(tarifa.timbrado_fin_vigencia || EMPRESA_LEGAL.finVigencia));
    setHistorial(db.getHistorialTarifas());
    setTieneTarifasGuardadas(db.hasTarifasIniciales());
  };

  useEffect(() => {
    const unsub = db.subscribe(() => {
      if (modalOpenOrSavingRef.current) return;
      sincronizarDesdeTarifa(db.getTarifasVigentes());
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let cancelado = false;
    supabase
      .from('usuarios')
      .select('id, nombre_completo, email')
      .limit(500)
      .then(({ data, error }) => {
        if (cancelado || error || !Array.isArray(data)) return;
        const map: Record<string, string> = {};
        for (const u of data) {
          if (u?.id) {
            map[u.id] = u.nombre_completo || u.email || u.id;
          }
        }
        setUsuariosNombresMap(map);
      });
    return () => {
      cancelado = true;
    };
  }, [historial.length]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const mostrarToast = (tipo: 'success' | 'error', texto: string) => {
    setToast({ tipo, texto });
  };

  // Si un no-admin intenta acceder, mostrar "Acceso denegado"
  if (user?.rol !== 'admin') {
    return (
      <div className="max-w-md mx-auto my-12 p-8 bg-white border border-stone-200 rounded-xl text-center space-y-4 shadow-xs">
        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-stone-900 tracking-tight">Acceso denegado</h2>
        <p className="text-xs text-stone-600 leading-relaxed">
          Este módulo es exclusivo para administradores del sistema. No tenés permisos para ver ni modificar la configuración de tarifas.
        </p>
      </div>
    );
  }

  // Carga de valores iniciales cuando la tabla está vacía
  const handleCargarValoresIniciales = async () => {
    if (guardando) return;
    setMensajeErrorGlobal(null);
    setMensajeExito(null);
    setGuardando(true);
    try {
      const tarifaCargada = await db.cargarValoresIniciales(
        user?.nombre || user?.email || 'admin',
        new Date().toISOString().split('T')[0]
      );
      if (isSupabaseConfigured) {
        await db.loadFromSupabase({ force: true });
      }
      sincronizarDesdeTarifa(db.getTarifasVigentes() || tarifaCargada);
      const okMsg = 'Valores iniciales regulados cargados exitosamente con fecha de vigencia de hoy.';
      setMensajeExito(okMsg);
      mostrarToast('success', okMsg);
    } catch (err: any) {
      setMensajeErrorGlobal(err?.message || 'Error al cargar valores iniciales');
    } finally {
      setGuardando(false);
    }
  };

  // Validación campo por campo según Sección 6
  const validarCampos = (): { valido: boolean; errores: Record<string, string> } => {
    const errs: Record<string, string> = {};

    // 1. precio_m3 >= 1
    const pM3 = Number(precioM3);
    if (isNaN(pM3) || pM3 < 1) {
      errs.precio_m3 = 'Debe ser un número entero mayor o igual a 1 Gs.';
    }

    // 2. consumo_minimo_m3 >= 1
    const cMin = Number(consumoMinimoM3);
    if (isNaN(cMin) || cMin < 1) {
      errs.consumo_minimo_m3 = 'Debe ser un número entero mayor o igual a 1 m³.';
    }

    // 3. monto_minimo_consumo >= 1
    const mMin = Number(montoMinimoConsumo);
    if (isNaN(mMin) || mMin < 1) {
      errs.monto_minimo_consumo = 'Debe ser un número entero mayor o igual a 1 Gs.';
    }

    // 4. monto_mora_fijo >= 0
    const mMora = Number(montoMoraFijo);
    if (isNaN(mMora) || mMora < 0) {
      errs.monto_mora_fijo = 'No puede ser negativo (mínimo 0 Gs.).';
    }

    // 5. monto_reconexion >= 0
    const mRec = Number(montoReconexion);
    if (isNaN(mRec) || mRec < 0) {
      errs.monto_reconexion = 'No puede ser negativo (mínimo 0 Gs.).';
    }

    // 6. erssan_porcentaje entre 0 y 100
    const erssan = Number(erssanPorcentaje);
    if (isNaN(erssan) || erssan < 0 || erssan > 100) {
      errs.erssan_porcentaje = 'El porcentaje debe estar entre 0 y 100 %.';
    }

    // 7. dia_vencimiento_boletas_normales: "ultimo_dia_mes" o número 1-28
    if (tipoDiaNormal === 'numero') {
      const dNorm = Number(diaNormalNumero);
      if (isNaN(dNorm) || dNorm < 1 || dNorm > 28) {
        errs.dia_vencimiento_boletas_normales = 'Debe ser entre el día 1 y el día 28 del mes.';
      }
    }

    // 8. dia_vencimiento_tercera_boleta entre 1 y 28
    const d3ra = Number(diaVenc3ra);
    if (isNaN(d3ra) || d3ra < 1 || d3ra > 28) {
      errs.dia_vencimiento_tercera_boleta = 'Debe ser un número entero entre 1 y 28.';
    }

    // 9. umbral_alerta_consumo >= 1
    const umbral = Number(umbralAlerta);
    if (isNaN(umbral) || umbral < 1) {
      errs.umbral_alerta_consumo = 'El multiplicador debe ser mayor o igual a 1.';
    }

    // 10. texto_alerta_consumo no puede estar vacío
    if (!textoAlerta || !textoAlerta.trim()) {
      errs.texto_alerta_consumo = 'El texto de alerta no puede estar vacío.';
    }

    // 11. max_numero_medidor >= 1
    const maxMed = Number(maxNumeroMedidor);
    if (isNaN(maxMed) || maxMed < 1) {
      errs.max_numero_medidor = 'La capacidad debe ser mayor o igual a 1.';
    }

    // 12. Datos fiscales Factura Legal (Timbrado SET)
    const timbradoTrim = timbrado.trim();
    if (!/^\d{4,15}$/.test(timbradoTrim)) {
      errs.timbrado = 'Debe ingresar un número de timbrado numérico válido (4 a 15 dígitos, ej: 19148339).';
    }

    const inicioNorm = normalizarFechaTimbradoDDMMYYYY(timbradoInicioVigencia);
    if (!inicioNorm) {
      errs.timbrado_inicio_vigencia = 'Ingrese una fecha válida en formato DD/MM/AAAA (ej: 01/10/2026).';
    }

    const finNorm = normalizarFechaTimbradoDDMMYYYY(timbradoFinVigencia);
    if (!finNorm) {
      errs.timbrado_fin_vigencia = 'Ingrese una fecha válida en formato DD/MM/AAAA (ej: 31/10/2027).';
    } else if (inicioNorm) {
      const kIni = fechaTimbradoASortKey(inicioNorm);
      const kFin = fechaTimbradoASortKey(finNorm);
      if (kIni && kFin && kFin < kIni) {
        errs.timbrado_fin_vigencia = 'El fin de vigencia no puede ser anterior al inicio de vigencia.';
      }
    }

    // Fecha de vigencia
    if (!vigenteDesde || !/^\d{4}-\d{2}-\d{2}$/.test(vigenteDesde)) {
      errs.vigente_desde = 'Debe especificar una fecha válida (YYYY-MM-DD).';
    }

    return {
      valido: Object.keys(errs).length === 0,
      errores: errs,
    };
  };

  const construirPayloadTarifa = () => {
    const diaNormalFinal: 'ultimo_dia_mes' | number =
      tipoDiaNormal === 'ultimo_dia_mes' ? 'ultimo_dia_mes' : Math.round(Number(diaNormalNumero));

    return {
      precio_m3: Math.round(Number(precioM3)),
      consumo_minimo_m3: Math.round(Number(consumoMinimoM3)),
      monto_minimo_consumo: Math.round(Number(montoMinimoConsumo)),
      monto_mora_fijo: Math.round(Number(montoMoraFijo)),
      monto_reconexion: Math.round(Number(montoReconexion)),
      erssan_porcentaje: Number(erssanPorcentaje),
      dia_vencimiento_boletas_normales: diaNormalFinal,
      dia_vencimiento_tercera_boleta: Math.round(Number(diaVenc3ra)),
      umbral_alerta_consumo: Number(umbralAlerta),
      texto_alerta_consumo: textoAlerta.trim(),
      max_numero_medidor: Math.round(Number(maxNumeroMedidor)),
      timbrado: timbrado.trim(),
      timbrado_inicio_vigencia:
        normalizarFechaTimbradoDDMMYYYY(timbradoInicioVigencia) || timbradoInicioVigencia.trim(),
      timbrado_fin_vigencia:
        normalizarFechaTimbradoDDMMYYYY(timbradoFinVigencia) || timbradoFinVigencia.trim(),
    };
  };

  const enfocarPrimerError = (errs: Record<string, string>) => {
    const primerCampo = seleccionarPrimerCampoConError(errs);
    setTimeout(() => {
      const targetEl = primerCampo ? fieldRefs.current[primerCampo] : null;
      if (targetEl && typeof targetEl.scrollIntoView === 'function') {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (typeof targetEl.focus === 'function') {
          targetEl.focus({ preventScroll: true });
        }
      } else if (errorBannerRef.current && typeof errorBannerRef.current.scrollIntoView === 'function') {
        errorBannerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 0);
  };

  const handleGuardar = (e: React.FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    setMensajeErrorGlobal(null);
    setMensajeExito(null);
    setErrorModal(null);

    const check = validarCampos();
    setErrores(check.errores);

    if (!check.valido) {
      const msgResumen = construirMensajeResumenErroresTarifa(check.errores);
      setMensajeErrorGlobal(msgResumen);
      mostrarToast('error', msgResumen);
      enfocarPrimerError(check.errores);
      return;
    }

    const payload = construirPayloadTarifa();
    const fallbacksComparacion: Partial<Record<keyof typeof payload, string>> = {
      timbrado: EMPRESA_LEGAL.timbrado,
      timbrado_inicio_vigencia: EMPRESA_LEGAL.inicioVigencia,
      timbrado_fin_vigencia: EMPRESA_LEGAL.finVigencia,
    };
    const hayCambios = (Object.keys(payload) as Array<keyof typeof payload>).some(
      (k) => String(payload[k]) !== String(tarifasVigentes[k] ?? fallbacksComparacion[k] ?? '')
    );
    if (!hayCambios) {
      const msgSinCambios = 'No se detectaron cambios en los parámetros respecto a la versión actual.';
      setMensajeErrorGlobal(msgSinCambios);
      mostrarToast('error', msgSinCambios);
      setTimeout(() => {
        errorBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
      return;
    }

    setShowConfirmModal(true);
  };

  const handleConfirmarGuardarTarifa = async () => {
    if (guardando) return;
    setErrorModal(null);
    setMensajeErrorGlobal(null);
    setGuardando(true);

    try {
      const payload = construirPayloadTarifa();
      const res = await db.actualizarTarifasAsync(
        payload,
        user?.nombre || user?.email || 'admin',
        motivoCambio.trim() || 'Ajuste de pliego tarifario regulado',
        vigenteDesde
      );

      if (isSupabaseConfigured) {
        await db.loadFromSupabase({ force: true });
      }

      const tarifaActualizada = db.getTarifasVigentes() || res;
      sincronizarDesdeTarifa(tarifaActualizada);
      setShowConfirmModal(false);

      const okMsg = `Nueva versión registrada con éxito con vigencia desde ${res.vigente_desde}. Se registraron ${res.cambiosAuditados?.length || 0} cambios en el historial. Las facturas anteriores permanecen inmutables.`;
      setMensajeExito(okMsg);
      mostrarToast('success', `Nueva versión tarifaria vigente desde ${res.vigente_desde}.`);
    } catch (err: any) {
      // Fallo en Supabase: NO cerrar modal, mostrar error inline, NO actualizar estado local
      setErrorModal(err?.message || 'Error al guardar los cambios en la tarifa.');
    } finally {
      setGuardando(false);
    }
  };

  const resolverCreadorTarifa = (t: TarifaConfig): string => {
    const rawId = t.creado_por;
    if (rawId && usuariosNombresMap[rawId]) {
      return usuariosNombresMap[rawId];
    }
    if (user?.id && rawId === user.id) {
      return user.nombre || user.email || 'admin';
    }
    if (t.creado_por_nombre && !t.creado_por_nombre.startsWith('Usuario eliminado')) {
      return t.creado_por_nombre;
    }
    return db.resolverNombreUsuario(rawId);
  };

  // Extraer todos los cambios históricos para la tabla al pie
  const filasHistorial: {
    concepto: string;
    valor_anterior: string | number;
    valor_nuevo: string | number;
    fecha: string;
    usuario: string;
    motivo: string;
  }[] = [];

  for (const t of historial) {
    if (t.auditoria?.cambios && t.auditoria.cambios.length > 0) {
      const usuarioResuelto = resolverCreadorTarifa(t);
      for (const c of t.auditoria.cambios) {
        filasHistorial.push({
          concepto: c.etiqueta || c.parametro,
          valor_anterior: c.valor_anterior,
          valor_nuevo: c.valor_nuevo,
          fecha: t.vigente_desde || t.fecha_creacion?.split('T')[0] || '-',
          usuario: usuarioResuelto,
          motivo: t.motivo_cambio || t.auditoria.motivo || 'Actualización de tarifa',
        });
      }
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
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

      {/* Encabezado */}
      <div className="border-b border-stone-200 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">
              Configuración de tarifas
            </h1>
            <p className="text-xs text-stone-600 mt-1">
              Pliego regulatorio de agua potable. Cada guardado crea una nueva versión histórica con fecha de vigencia sin alterar facturas anteriores.
            </p>
          </div>
          <span className="px-2.5 py-1 bg-stone-100 border border-stone-200 text-stone-700 text-xs font-semibold rounded-md">
            Solo Administrador
          </span>
        </div>
      </div>

      {/* Banner de valores iniciales si la tabla está vacía */}
      {!tieneTarifasGuardadas && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xs font-bold text-amber-900 uppercase tracking-wide">
              Tabla de tarifas sin valores iniciales
            </h2>
            <p className="text-xs text-amber-800 mt-0.5">
              La base de datos aún no tiene una tarifa base guardada. Cargue los valores por defecto del pliego ERSSAN para iniciar.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCargarValoresIniciales}
            disabled={guardando}
            className="px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold rounded-md transition-colors whitespace-nowrap cursor-pointer shadow-xs disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {guardando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{guardando ? 'Cargando...' : 'Cargar valores iniciales'}</span>
          </button>
        </div>
      )}

      {/* Mensajes de confirmación y error global */}
      {mensajeExito && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-lg text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{mensajeExito}</span>
        </div>
      )}

      {mensajeErrorGlobal && (
        <div
          ref={errorBannerRef}
          role="alert"
          className="p-3 bg-red-50 border border-red-300 text-red-900 rounded-lg text-xs font-semibold flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{mensajeErrorGlobal}</span>
        </div>
      )}

      {/* Formulario de parámetros */}
      <form noValidate onSubmit={handleGuardar} className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 shadow-xs space-y-5">
        <div className="border-b border-stone-100 pb-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-stone-500">
            Parámetros configurables del pliego
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* 1. precio_m3 */}
          <div>
            <label className="block text-xs font-bold text-stone-800 mb-1">
              precio_m3 (Gs. por m³)
            </label>
            <p className="text-[11px] text-stone-500 mb-1.5">
              Precio unitario cobrado por m³ excedente de consumo de agua potable.
            </p>
            <div className="relative">
              <input
                ref={setFieldRef('precio_m3')}
                type="number"
                min="1"
                step="1"
                value={precioM3}
                onChange={(e) => setPrecioM3(e.target.value)}
                className={`w-full px-3 py-2 text-xs border rounded-md font-mono ${
                  errores.precio_m3 ? 'border-red-500 bg-red-50' : 'border-stone-300'
                }`}
              />
            </div>
            {errores.precio_m3 ? (
              <p role="alert" className="text-[11px] text-red-600 mt-1 font-semibold">{errores.precio_m3}</p>
            ) : (
              <p className="text-[10px] text-stone-400 mt-0.5">Por defecto: 4000</p>
            )}
          </div>

          {/* 2. consumo_minimo_m3 */}
          <div>
            <label className="block text-xs font-bold text-stone-800 mb-1">
              consumo_minimo_m3 (m³)
            </label>
            <p className="text-[11px] text-stone-500 mb-1.5">
              Volumen mínimo básico mensual cubierto por la tarifa mínima.
            </p>
            <input
              ref={setFieldRef('consumo_minimo_m3')}
              type="number"
              min="1"
              step="1"
              value={consumoMinimoM3}
              onChange={(e) => setConsumoMinimoM3(e.target.value)}
              className={`w-full px-3 py-2 text-xs border rounded-md font-mono ${
                errores.consumo_minimo_m3 ? 'border-red-500 bg-red-50' : 'border-stone-300'
              }`}
            />
            {errores.consumo_minimo_m3 ? (
              <p role="alert" className="text-[11px] text-red-600 mt-1 font-semibold">{errores.consumo_minimo_m3}</p>
            ) : (
              <p className="text-[10px] text-stone-400 mt-0.5">Por defecto: 9</p>
            )}
          </div>

          {/* 3. monto_minimo_consumo */}
          <div>
            <label className="block text-xs font-bold text-stone-800 mb-1">
              monto_minimo_consumo (Gs.)
            </label>
            <p className="text-[11px] text-stone-500 mb-1.5">
              Importe mínimo facturado si el consumo del mes es menor o igual al mínimo.
            </p>
            <input
              ref={setFieldRef('monto_minimo_consumo')}
              type="number"
              min="1"
              step="1"
              value={montoMinimoConsumo}
              onChange={(e) => setMontoMinimoConsumo(e.target.value)}
              className={`w-full px-3 py-2 text-xs border rounded-md font-mono ${
                errores.monto_minimo_consumo ? 'border-red-500 bg-red-50' : 'border-stone-300'
              }`}
            />
            {errores.monto_minimo_consumo ? (
              <p role="alert" className="text-[11px] text-red-600 mt-1 font-semibold">{errores.monto_minimo_consumo}</p>
            ) : (
              <p className="text-[10px] text-stone-400 mt-0.5">Por defecto: 36000</p>
            )}
          </div>

          {/* 4. monto_mora_fijo */}
          <div>
            <label className="block text-xs font-bold text-stone-800 mb-1">
              monto_mora_fijo (Gs. por boleta vencida)
            </label>
            <p className="text-[11px] text-stone-500 mb-1.5">
              Recargo fijo por cada boleta vencida impaga perteneciente al medidor.
            </p>
            <input
              ref={setFieldRef('monto_mora_fijo')}
              type="number"
              min="0"
              step="1"
              value={montoMoraFijo}
              onChange={(e) => setMontoMoraFijo(e.target.value)}
              className={`w-full px-3 py-2 text-xs border rounded-md font-mono ${
                errores.monto_mora_fijo ? 'border-red-500 bg-red-50' : 'border-stone-300'
              }`}
            />
            {errores.monto_mora_fijo ? (
              <p role="alert" className="text-[11px] text-red-600 mt-1 font-semibold">{errores.monto_mora_fijo}</p>
            ) : (
              <p className="text-[10px] text-stone-400 mt-0.5">Por defecto: 3000</p>
            )}
          </div>

          {/* 5. monto_reconexion */}
          <div>
            <label className="block text-xs font-bold text-stone-800 mb-1">
              monto_reconexion (Gs.)
            </label>
            <p className="text-[11px] text-stone-500 mb-1.5">
              Tasa administrativa por reactivación tras corte físico del medidor.
            </p>
            <input
              ref={setFieldRef('monto_reconexion')}
              type="number"
              min="0"
              step="1"
              value={montoReconexion}
              onChange={(e) => setMontoReconexion(e.target.value)}
              className={`w-full px-3 py-2 text-xs border rounded-md font-mono ${
                errores.monto_reconexion ? 'border-red-500 bg-red-50' : 'border-stone-300'
              }`}
            />
            {errores.monto_reconexion ? (
              <p role="alert" className="text-[11px] text-red-600 mt-1 font-semibold">{errores.monto_reconexion}</p>
            ) : (
              <p className="text-[10px] text-stone-400 mt-0.5">Por defecto: 60000</p>
            )}
          </div>

          {/* 6. erssan_porcentaje */}
          <div>
            <label className="block text-xs font-bold text-stone-800 mb-1">
              erssan_porcentaje (%)
            </label>
            <p className="text-[11px] text-stone-500 mb-1.5">
              Porcentaje regulatorio ERSSAN aplicado sobre la suma de conceptos 1 al 7.
            </p>
            <input
              ref={setFieldRef('erssan_porcentaje')}
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={erssanPorcentaje}
              onChange={(e) => setErssanPorcentaje(e.target.value)}
              className={`w-full px-3 py-2 text-xs border rounded-md font-mono ${
                errores.erssan_porcentaje ? 'border-red-500 bg-red-50' : 'border-stone-300'
              }`}
            />
            {errores.erssan_porcentaje ? (
              <p role="alert" className="text-[11px] text-red-600 mt-1 font-semibold">{errores.erssan_porcentaje}</p>
            ) : (
              <p className="text-[10px] text-stone-400 mt-0.5">Por defecto: 2</p>
            )}
          </div>

          {/* 7. dia_vencimiento_boletas_normales */}
          <div>
            <label className="block text-xs font-bold text-stone-800 mb-1">
              dia_vencimiento_boletas_normales
            </label>
            <p className="text-[11px] text-stone-500 mb-1.5">
              Vencimiento habitual de las facturas regulares (1ra y 2da boleta).
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-4 text-xs text-stone-700">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="tipoDiaNormal"
                    checked={tipoDiaNormal === 'ultimo_dia_mes'}
                    onChange={() => setTipoDiaNormal('ultimo_dia_mes')}
                  />
                  <span>Último día del mes</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="tipoDiaNormal"
                    checked={tipoDiaNormal === 'numero'}
                    onChange={() => setTipoDiaNormal('numero')}
                  />
                  <span>Día específico (1 al 28)</span>
                </label>
              </div>

              {tipoDiaNormal === 'numero' && (
                <input
                  ref={setFieldRef('dia_vencimiento_boletas_normales')}
                  type="number"
                  min="1"
                  max="28"
                  value={diaNormalNumero}
                  onChange={(e) => setDiaNormalNumero(e.target.value)}
                  placeholder="Ej: 28"
                  className={`w-full px-3 py-2 text-xs border rounded-md font-mono ${
                    errores.dia_vencimiento_boletas_normales ? 'border-red-500 bg-red-50' : 'border-stone-300'
                  }`}
                />
              )}
            </div>
            {errores.dia_vencimiento_boletas_normales ? (
              <p role="alert" className="text-[11px] text-red-600 mt-1 font-semibold">{errores.dia_vencimiento_boletas_normales}</p>
            ) : (
              <p className="text-[10px] text-stone-400 mt-0.5">Por defecto: &quot;ultimo_dia_mes&quot;</p>
            )}
          </div>

          {/* 8. dia_vencimiento_tercera_boleta */}
          <div>
            <label className="block text-xs font-bold text-stone-800 mb-1">
              dia_vencimiento_tercera_boleta (día 1 al 28)
            </label>
            <p className="text-[11px] text-stone-500 mb-1.5">
              Día del mes en que vence la 3ra boleta acumulada antes de pasar a corte.
            </p>
            <input
              ref={setFieldRef('dia_vencimiento_tercera_boleta')}
              type="number"
              min="1"
              max="28"
              step="1"
              value={diaVenc3ra}
              onChange={(e) => setDiaVenc3ra(e.target.value)}
              className={`w-full px-3 py-2 text-xs border rounded-md font-mono ${
                errores.dia_vencimiento_tercera_boleta ? 'border-red-500 bg-red-50' : 'border-stone-300'
              }`}
            />
            {errores.dia_vencimiento_tercera_boleta ? (
              <p role="alert" className="text-[11px] text-red-600 mt-1 font-semibold">{errores.dia_vencimiento_tercera_boleta}</p>
            ) : (
              <p className="text-[10px] text-stone-400 mt-0.5">Por defecto: 11</p>
            )}
          </div>

          {/* 9. umbral_alerta_consumo */}
          <div>
            <label className="block text-xs font-bold text-stone-800 mb-1">
              umbral_alerta_consumo (multiplicador)
            </label>
            <p className="text-[11px] text-stone-500 mb-1.5">
              Factor sobre el promedio de los últimos 3 meses para disparar aviso de pérdida.
            </p>
            <input
              ref={setFieldRef('umbral_alerta_consumo')}
              type="number"
              min="1"
              step="0.1"
              value={umbralAlerta}
              onChange={(e) => setUmbralAlerta(e.target.value)}
              className={`w-full px-3 py-2 text-xs border rounded-md font-mono ${
                errores.umbral_alerta_consumo ? 'border-red-500 bg-red-50' : 'border-stone-300'
              }`}
            />
            {errores.umbral_alerta_consumo ? (
              <p role="alert" className="text-[11px] text-red-600 mt-1 font-semibold">{errores.umbral_alerta_consumo}</p>
            ) : (
              <p className="text-[10px] text-stone-400 mt-0.5">Por defecto: 3</p>
            )}
          </div>

          {/* 11. max_numero_medidor */}
          <div>
            <label className="block text-xs font-bold text-stone-800 mb-1">
              max_numero_medidor (entero)
            </label>
            <p className="text-[11px] text-stone-500 mb-1.5">
              Capacidad máxima numérica de medidores autorizados en el padrón.
            </p>
            <input
              ref={setFieldRef('max_numero_medidor')}
              type="number"
              min="1"
              step="1"
              value={maxNumeroMedidor}
              onChange={(e) => setMaxNumeroMedidor(e.target.value)}
              className={`w-full px-3 py-2 text-xs border rounded-md font-mono ${
                errores.max_numero_medidor ? 'border-red-500 bg-red-50' : 'border-stone-300'
              }`}
            />
            {errores.max_numero_medidor ? (
              <p role="alert" className="text-[11px] text-red-600 mt-1 font-semibold">{errores.max_numero_medidor}</p>
            ) : (
              <p className="text-[10px] text-stone-400 mt-0.5">Por defecto: 1000</p>
            )}
          </div>
        </div>

        {/* 10. texto_alerta_consumo */}
        <div>
          <label className="block text-xs font-bold text-stone-800 mb-1">
            texto_alerta_consumo (texto impreso en boleta)
          </label>
          <p className="text-[11px] text-stone-500 mb-1.5">
            Mensaje preventivo impreso en la factura cuando el consumo supera el umbral.
          </p>
          <textarea
            ref={setFieldRef('texto_alerta_consumo')}
            rows={2}
            value={textoAlerta}
            onChange={(e) => setTextoAlerta(e.target.value)}
            className={`w-full px-3 py-2 text-xs border rounded-md ${
              errores.texto_alerta_consumo ? 'border-red-500 bg-red-50' : 'border-stone-300'
            }`}
          />
          {errores.texto_alerta_consumo ? (
            <p role="alert" className="text-[11px] text-red-600 mt-1 font-semibold">{errores.texto_alerta_consumo}</p>
          ) : (
            <p className="text-[10px] text-stone-400 mt-0.5">
              Por defecto: &quot;CONSUMO ELEVADO — Su consumo de este mes es superior al habitual. Puede deberse a una pérdida en su propiedad. Por favor verifique.&quot;
            </p>
          )}
        </div>

        {/* 12. Datos Fiscales de Factura Legal (Timbrado SET) */}
        <div className="pt-4 border-t border-stone-100 space-y-4">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500">
              Datos fiscales de Factura Legal (Timbrado SET)
            </h3>
            <p className="text-[11px] text-stone-500 mt-0.5">
              Estos datos aparecen en el encabezado de las Facturas Legales (boletas, recibos oficiales y contratos). No se muestran en los Recibos sin valor fiscal.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Número de Timbrado */}
            <div>
              <label htmlFor="tarifa-timbrado" className="block text-xs font-bold text-stone-800 mb-1">
                Número de Timbrado
              </label>
              <p className="text-[11px] text-stone-500 mb-1.5">
                Código numérico vigente habilitado por la SET/DNIT.
              </p>
              <input
                id="tarifa-timbrado"
                ref={setFieldRef('timbrado')}
                type="text"
                inputMode="numeric"
                maxLength={15}
                value={timbrado}
                onChange={(e) => setTimbrado(e.target.value)}
                placeholder="19148339"
                className={`w-full px-3 py-2 text-xs border rounded-md font-mono ${
                  errores.timbrado ? 'border-red-500 bg-red-50' : 'border-stone-300'
                }`}
              />
              {errores.timbrado ? (
                <p role="alert" className="text-[11px] text-red-600 mt-1 font-semibold">{errores.timbrado}</p>
              ) : (
                <p className="text-[10px] text-stone-400 mt-0.5">Por defecto: {EMPRESA_LEGAL.timbrado}</p>
              )}
            </div>

            {/* Inicio de Vigencia */}
            <div>
              <label htmlFor="tarifa-timbrado-inicio" className="block text-xs font-bold text-stone-800 mb-1">
                Inicio de Vigencia (DD/MM/AAAA)
              </label>
              <p className="text-[11px] text-stone-500 mb-1.5">
                Fecha de inicio impresa en la Factura Legal.
              </p>
              <input
                id="tarifa-timbrado-inicio"
                ref={setFieldRef('timbrado_inicio_vigencia')}
                type="text"
                maxLength={10}
                value={timbradoInicioVigencia}
                onChange={(e) => setTimbradoInicioVigencia(e.target.value)}
                placeholder="01/10/2026"
                className={`w-full px-3 py-2 text-xs border rounded-md font-mono ${
                  errores.timbrado_inicio_vigencia ? 'border-red-500 bg-red-50' : 'border-stone-300'
                }`}
              />
              {errores.timbrado_inicio_vigencia ? (
                <p role="alert" className="text-[11px] text-red-600 mt-1 font-semibold">{errores.timbrado_inicio_vigencia}</p>
              ) : (
                <p className="text-[10px] text-stone-400 mt-0.5">Por defecto: {EMPRESA_LEGAL.inicioVigencia}</p>
              )}
            </div>

            {/* Fin de Vigencia */}
            <div>
              <label htmlFor="tarifa-timbrado-fin" className="block text-xs font-bold text-stone-800 mb-1">
                Fin de Vigencia (DD/MM/AAAA)
              </label>
              <p className="text-[11px] text-stone-500 mb-1.5">
                Fecha de vencimiento del timbrado en Factura Legal.
              </p>
              <input
                id="tarifa-timbrado-fin"
                ref={setFieldRef('timbrado_fin_vigencia')}
                type="text"
                maxLength={10}
                value={timbradoFinVigencia}
                onChange={(e) => setTimbradoFinVigencia(e.target.value)}
                placeholder="31/10/2027"
                className={`w-full px-3 py-2 text-xs border rounded-md font-mono ${
                  errores.timbrado_fin_vigencia ? 'border-red-500 bg-red-50' : 'border-stone-300'
                }`}
              />
              {errores.timbrado_fin_vigencia ? (
                <p role="alert" className="text-[11px] text-red-600 mt-1 font-semibold">{errores.timbrado_fin_vigencia}</p>
              ) : (
                <p className="text-[10px] text-stone-400 mt-0.5">Por defecto: {EMPRESA_LEGAL.finVigencia}</p>
              )}
            </div>
          </div>
        </div>

        {/* Datos de la nueva versión: Fecha de vigencia y Motivo */}
        <div className="pt-4 border-t border-stone-100 grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-bold text-stone-800 mb-1">
              Fecha de vigencia (vigente_desde)
            </label>
            <p className="text-[11px] text-stone-500 mb-1.5">
              Fecha a partir de la cual las nuevas facturas adoptarán este pliego.
            </p>
            <input
              ref={setFieldRef('vigente_desde')}
              type="date"
              value={vigenteDesde}
              onChange={(e) => setVigenteDesde(e.target.value)}
              className={`w-full px-3 py-2 text-xs border rounded-md ${
                errores.vigente_desde ? 'border-red-500 bg-red-50' : 'border-stone-300'
              }`}
            />
            {errores.vigente_desde && (
              <p role="alert" className="text-[11px] text-red-600 mt-1 font-semibold">{errores.vigente_desde}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-800 mb-1">
              Motivo o Justificación del cambio
            </label>
            <p className="text-[11px] text-stone-500 mb-1.5">
              Descripción archivada en la auditoría del cambio.
            </p>
            <input
              type="text"
              value={motivoCambio}
              onChange={(e) => setMotivoCambio(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-md"
            />
          </div>
        </div>

        {/* Aviso inline junto al botón si hay errores de validación */}
        {Object.keys(errores).length > 0 && mensajeErrorGlobal && (
          <div
            role="alert"
            className="p-3 bg-red-50 border border-red-300 text-red-900 rounded-lg text-xs font-semibold flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{mensajeErrorGlobal}</span>
          </div>
        )}

        {/* Botón de guardado grande */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={guardando}
            className="w-full py-3 px-4 bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {guardando && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{guardando ? 'Guardando nueva versión...' : 'Guardar cambios'}</span>
          </button>
        </div>
      </form>

      {/* Modal de confirmación para registrar nueva versión tarifaria */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <h3 className="font-bold text-stone-900 text-base">Confirmar Nueva Versión Tarifaria</h3>
              <button
                type="button"
                disabled={guardando}
                onClick={() => {
                  setErrorModal(null);
                  setShowConfirmModal(false);
                }}
                className="text-stone-400 hover:text-stone-700 disabled:opacity-40"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs text-stone-600 space-y-2">
              <p>
                Se registrará una nueva versión en el historial con fecha de vigencia{' '}
                <b className="text-stone-900">{vigenteDesde}</b>.
              </p>
              <p className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 font-medium">
                Las facturas ya emitidas conservarán sus montos históricos y no serán modificadas.
              </p>
            </div>

            {errorModal && (
              <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-red-800 text-xs font-semibold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorModal}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-stone-200">
              <button
                type="button"
                disabled={guardando}
                onClick={() => {
                  setErrorModal(null);
                  setShowConfirmModal(false);
                }}
                className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg font-semibold text-xs disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={guardando}
                onClick={handleConfirmarGuardarTarifa}
                className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-bold text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {guardando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{guardando ? 'Guardando...' : 'Confirmar y Guardar'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Historial de cambios al pie de pantalla */}
      <div className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-stone-100 pb-3">
          <div>
            <h2 className="text-sm font-bold text-stone-900 tracking-tight flex items-center gap-2">
              <History className="w-4 h-4 text-stone-600" />
              Historial de cambios
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">
              Registro inmutable de versiones tarifarias y parámetros modificados.
            </p>
          </div>
          <span className="text-xs font-semibold text-stone-500">
            {historial.length} {historial.length === 1 ? 'versión registrada' : 'versiones registradas'}
          </span>
        </div>

        {/* Tabla detallada de auditoría */}
        {filasHistorial.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-stone-700 font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-2.5 px-3">Fecha</th>
                  <th className="py-2.5 px-3">Concepto</th>
                  <th className="py-2.5 px-3">Valor anterior</th>
                  <th className="py-2.5 px-3">Valor nuevo</th>
                  <th className="py-2.5 px-3">Usuario</th>
                  <th className="py-2.5 px-3">Motivo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 font-mono text-[11px]">
                {filasHistorial.map((f, i) => (
                  <tr key={i} className="hover:bg-stone-50">
                    <td className="py-2.5 px-3 text-stone-600 font-sans">{f.fecha}</td>
                    <td className="py-2.5 px-3 font-semibold text-stone-900 font-sans">{f.concepto}</td>
                    <td className="py-2.5 px-3 text-stone-500">{String(f.valor_anterior)}</td>
                    <td className="py-2.5 px-3 font-bold text-emerald-700">{String(f.valor_nuevo)}</td>
                    <td className="py-2.5 px-3 text-stone-600 font-sans">{f.usuario}</td>
                    <td className="py-2.5 px-3 text-stone-500 font-sans">{f.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-stone-500 border border-dashed border-stone-200 rounded-lg">
            No se han registrado modificaciones de parámetros aún. Las modificaciones que guardes aparecerán listadas aquí con fecha, usuario y valores anterior/nuevo.
          </div>
        )}
      </div>
    </div>
  );
};
