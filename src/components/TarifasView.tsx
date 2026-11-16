/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { db } from '../services/database';
import { TarifaConfig, AuditoriaCambioParametro } from '../types';
import { useAuth } from '../context/AuthContext';
import {
  Settings,
  CheckCircle2,
  AlertTriangle,
  History,
  Save,
  Download,
  RotateCcw,
  ShieldAlert,
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

  // Metadatos de la nueva versión
  const [vigenteDesde, setVigenteDesde] = useState<string>(new Date().toISOString().split('T')[0]);
  const [motivoCambio, setMotivoCambio] = useState<string>('Actualización de pliego tarifario regulado');

  // Estado de mensajes y errores por campo
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [mensajeErrorGlobal, setMensajeErrorGlobal] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

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
    setHistorial(db.getHistorialTarifas());
    setTieneTarifasGuardadas(db.hasTarifasIniciales());
  };

  useEffect(() => {
    const unsub = db.subscribe(() => {
      sincronizarDesdeTarifa(db.getTarifasVigentes());
    });
    return unsub;
  }, []);

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
    setMensajeErrorGlobal(null);
    setMensajeExito(null);
    setIsSaving(true);
    try {
      const tarifaCargada = await db.cargarValoresIniciales(
        user?.nombre || user?.email || 'admin',
        new Date().toISOString().split('T')[0]
      );
      sincronizarDesdeTarifa(tarifaCargada);
      setMensajeExito(
        'Valores iniciales regulados cargados exitosamente con fecha de vigencia de hoy.'
      );
    } catch (err: any) {
      setMensajeErrorGlobal(err.message || 'Error al cargar valores iniciales');
    } finally {
      setIsSaving(false);
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

    // Fecha de vigencia
    if (!vigenteDesde || !/^\d{4}-\d{2}-\d{2}$/.test(vigenteDesde)) {
      errs.vigente_desde = 'Debe especificar una fecha válida (YYYY-MM-DD).';
    }

    return {
      valido: Object.keys(errs).length === 0,
      errores: errs,
    };
  };

  const handleGuardar = (e: React.FormEvent) => {
    e.preventDefault();
    setMensajeErrorGlobal(null);
    setMensajeExito(null);

    const check = validarCampos();
    setErrores(check.errores);

    if (!check.valido) {
      setMensajeErrorGlobal('Por favor corrija los campos con errores antes de guardar.');
      return;
    }

    setIsSaving(true);
    try {
      const diaNormalFinal = tipoDiaNormal === 'ultimo_dia_mes' ? 'ultimo_dia_mes' : Number(diaNormalNumero);

      const res = db.actualizarTarifas(
        {
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
        },
        user?.nombre || user?.email || 'admin',
        motivoCambio.trim() || 'Ajuste de pliego tarifario regulado',
        vigenteDesde
      );

      sincronizarDesdeTarifa(res);
      setMensajeExito(
        `Nueva versión registrada con éxito con vigencia desde ${res.vigente_desde}. Se registraron ${res.cambiosAuditados?.length || 0} cambios en el historial. Las facturas anteriores permanecen inmutables.`
      );
    } catch (err: any) {
      setMensajeErrorGlobal(err.message || 'Error al guardar los cambios en la tarifa.');
    } finally {
      setIsSaving(false);
    }
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
      for (const c of t.auditoria.cambios) {
        filasHistorial.push({
          concepto: c.etiqueta || c.parametro,
          valor_anterior: c.valor_anterior,
          valor_nuevo: c.valor_nuevo,
          fecha: t.vigente_desde || t.fecha_creacion?.split('T')[0] || '-',
          usuario: t.creado_por || 'admin',
          motivo: t.motivo_cambio || t.auditoria.motivo || 'Actualización de tarifa',
        });
      }
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
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
            disabled={isSaving}
            className="px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold rounded-md transition-colors whitespace-nowrap cursor-pointer shadow-xs disabled:opacity-50"
          >
            Cargar valores iniciales
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
        <div className="p-3 bg-red-50 border border-red-300 text-red-900 rounded-lg text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{mensajeErrorGlobal}</span>
        </div>
      )}

      {/* Formulario de parámetros */}
      <form onSubmit={handleGuardar} className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 shadow-xs space-y-5">
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
              <p className="text-[11px] text-red-600 mt-1 font-semibold">{errores.precio_m3}</p>
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
              <p className="text-[11px] text-red-600 mt-1 font-semibold">{errores.consumo_minimo_m3}</p>
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
              <p className="text-[11px] text-red-600 mt-1 font-semibold">{errores.monto_minimo_consumo}</p>
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
              <p className="text-[11px] text-red-600 mt-1 font-semibold">{errores.monto_mora_fijo}</p>
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
              <p className="text-[11px] text-red-600 mt-1 font-semibold">{errores.monto_reconexion}</p>
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
              <p className="text-[11px] text-red-600 mt-1 font-semibold">{errores.erssan_porcentaje}</p>
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
              <p className="text-[11px] text-red-600 mt-1 font-semibold">{errores.dia_vencimiento_boletas_normales}</p>
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
              <p className="text-[11px] text-red-600 mt-1 font-semibold">{errores.dia_vencimiento_tercera_boleta}</p>
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
              <p className="text-[11px] text-red-600 mt-1 font-semibold">{errores.umbral_alerta_consumo}</p>
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
              <p className="text-[11px] text-red-600 mt-1 font-semibold">{errores.max_numero_medidor}</p>
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
            rows={2}
            value={textoAlerta}
            onChange={(e) => setTextoAlerta(e.target.value)}
            className={`w-full px-3 py-2 text-xs border rounded-md ${
              errores.texto_alerta_consumo ? 'border-red-500 bg-red-50' : 'border-stone-300'
            }`}
          />
          {errores.texto_alerta_consumo ? (
            <p className="text-[11px] text-red-600 mt-1 font-semibold">{errores.texto_alerta_consumo}</p>
          ) : (
            <p className="text-[10px] text-stone-400 mt-0.5">
              Por defecto: &quot;CONSUMO ELEVADO — Su consumo de este mes es superior al habitual. Puede deberse a una pérdida en su propiedad. Por favor verifique.&quot;
            </p>
          )}
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
              type="date"
              value={vigenteDesde}
              onChange={(e) => setVigenteDesde(e.target.value)}
              className={`w-full px-3 py-2 text-xs border rounded-md ${
                errores.vigente_desde ? 'border-red-500 bg-red-50' : 'border-stone-300'
              }`}
            />
            {errores.vigente_desde && (
              <p className="text-[11px] text-red-600 mt-1 font-semibold">{errores.vigente_desde}</p>
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

        {/* Botón de guardado grande */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-3 px-4 bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
          >
            {isSaving ? 'Guardando nueva versión...' : 'Guardar cambios'}
          </button>
        </div>
      </form>

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
