/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { db } from '../services/database';
import { SCHEMA_SQL } from '../services/schemaSql';
import { Database, Check, Copy, ExternalLink, RefreshCw, AlertTriangle, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';

interface SupabaseSetupAssistantProps {
  errorMessage?: string | null;
  onSuccess?: () => void;
}

export const SupabaseSetupAssistant: React.FC<SupabaseSetupAssistantProps> = ({ errorMessage, onSuccess }) => {
  const [copied, setCopied] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<string | null>(null);

  const supabaseUrl = db.getSupabaseUrl();
  // Extract project ref from URL: https://woskxezivcdukhxcfpov.supabase.co -> woskxezivcdukhxcfpov
  const projectRef = supabaseUrl ? supabaseUrl.replace('https://', '').split('.')[0] : 'woskxezivcdukhxcfpov';
  const sqlEditorUrl = `https://supabase.com/dashboard/project/${projectRef}/sql/new`;

  const handleCopySql = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(SCHEMA_SQL);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = SCHEMA_SQL;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopied(false);
    }
  };

  const handleVerify = async () => {
    setIsVerifying(true);
    setVerifyStatus('Verificando conexión y esquema...');
    try {
      await db.loadFromSupabase();
      const currentError = db.getDbError();
      if (!currentError) {
        setVerifyStatus('¡Conectado exitosamente con Supabase!');
        if (onSuccess) onSuccess();
      } else {
        setVerifyStatus(`Aún no se detectaron las tablas: ${currentError}`);
      }
    } catch (err: any) {
      setVerifyStatus(`Error: ${err.message || 'No se pudo conectar'}`);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="mb-8 bg-white border-2 border-stone-800 rounded-xl shadow-lg overflow-hidden">
      {/* Barra superior distintiva */}
      <div className="bg-stone-900 text-stone-100 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-stone-800 rounded-lg text-emerald-400 border border-stone-700">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight uppercase flex items-center gap-2">
              Inicialización de Tablas en Supabase
              <span className="text-[10px] bg-amber-500/20 text-amber-300 font-mono px-2 py-0.5 rounded border border-amber-500/30">
                Paso Requerido
              </span>
            </h2>
            <p className="text-xs text-stone-400 font-mono mt-0.5">
              Proyecto: {projectRef} &bull; {supabaseUrl}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleVerify}
            disabled={isVerifying}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
            {isVerifying ? 'Verificando...' : 'Verificar y Conectar'}
          </button>
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-5 bg-stone-50/50">
        {/* Explicación de estado */}
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-950">
              Las credenciales de Supabase están activas, pero las tablas aún no han sido creadas en tu proyecto.
            </p>
            <p className="text-amber-800 leading-relaxed">
              {errorMessage || 'Error PGRST205: Las tablas requeridas (tarifas, clientes, medidores, facturas, lecturas) no existen todavía en la base de datos de PostgreSQL.'}
            </p>
            <p className="text-[11px] text-amber-700 mt-1 font-medium">
              Nota de seguridad: El sistema opera 100% en tiempo real contra Supabase (sin fallback silencioso a localStorage), garantizando integridad y persistencia total.
            </p>
          </div>
        </div>

        {/* Pasos rápidos para activar */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-4 rounded-lg border border-stone-200 shadow-sm flex flex-col justify-between">
            <div>
              <div className="w-6 h-6 rounded-full bg-stone-900 text-white flex items-center justify-center text-xs font-bold mb-2">
                1
              </div>
              <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wide">
                Copiar Script SQL
              </h3>
              <p className="text-xs text-stone-600 mt-1">
                Contiene el esquema completo (12 tablas, índices, reglas ERSSAN, roles segregados y políticas RLS).
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopySql}
              className={`mt-4 w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                copied
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                  : 'bg-stone-900 hover:bg-stone-800 text-white border-transparent'
              }`}
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-600" />
                  ¡Script SQL Copiado!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copiar Script SQL
                </>
              )}
            </button>
          </div>

          <div className="bg-white p-4 rounded-lg border border-stone-200 shadow-sm flex flex-col justify-between">
            <div>
              <div className="w-6 h-6 rounded-full bg-stone-900 text-white flex items-center justify-center text-xs font-bold mb-2">
                2
              </div>
              <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wide">
                Abrir SQL Editor
              </h3>
              <p className="text-xs text-stone-600 mt-1">
                Abre la pestaña SQL Editor en tu dashboard de Supabase para pegar y presionar &quot;Run&quot;.
              </p>
            </div>
            <a
              href={sqlEditorUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-bold rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 transition-colors cursor-pointer text-center"
            >
              <ExternalLink className="w-4 h-4 text-stone-600" />
              Abrir SQL Editor Supabase
            </a>
          </div>

          <div className="bg-white p-4 rounded-lg border border-stone-200 shadow-sm flex flex-col justify-between">
            <div>
              <div className="w-6 h-6 rounded-full bg-stone-900 text-white flex items-center justify-center text-xs font-bold mb-2">
                3
              </div>
              <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wide">
                Sincronizar y Listo
              </h3>
              <p className="text-xs text-stone-600 mt-1">
                Una vez ejecutado el SQL, haz clic en verificar para cargar la base de datos limpia y comenzar a operar.
              </p>
            </div>
            <button
              type="button"
              onClick={handleVerify}
              disabled={isVerifying}
              className="mt-4 w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white transition-colors disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              {isVerifying ? 'Verificando...' : 'Verificar y Conectar'}
            </button>
          </div>
        </div>

        {/* Feedback de verificación */}
        {verifyStatus && (
          <div className="p-3 bg-stone-100 border border-stone-300 rounded-lg text-xs font-mono text-stone-800">
            {verifyStatus}
          </div>
        )}

        {/* Visualizador de Script SQL colapsable */}
        <div className="border border-stone-200 rounded-lg bg-white overflow-hidden">
          <button
            type="button"
            onClick={() => setShowSql(!showSql)}
            className="w-full px-4 py-2.5 bg-stone-100 hover:bg-stone-200/70 flex items-center justify-between text-xs font-semibold text-stone-700 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-stone-500">supabase/schema.sql</span>
              &bull; Vista previa del script SQL ({SCHEMA_SQL.split('\n').length} líneas)
            </span>
            {showSql ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showSql && (
            <div className="p-4 bg-stone-900 text-stone-100 font-mono text-[11px] leading-relaxed max-h-96 overflow-y-auto">
              <pre className="whitespace-pre">{SCHEMA_SQL}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
