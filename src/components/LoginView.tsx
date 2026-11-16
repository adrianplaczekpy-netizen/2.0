/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { Droplets, KeyRound, Mail, ArrowRight, ShieldCheck, UserCheck, AlertCircle } from 'lucide-react';

export const LoginView: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState(isSupabaseConfigured ? '' : 'admin@aguateria.py');
  const [password, setPassword] = useState(isSupabaseConfigured ? '' : 'admin123');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await login(email, password);
      if (!res.success) {
        setError(res.error || 'Credenciales no válidas.');
      }
    } catch (err: any) {
      setError(err.message || 'Error al iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectQuickRole = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col justify-center items-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-stone-200 shadow-sm p-8 space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mx-auto text-white shadow-xs">
            <Droplets className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-stone-900">AguateríaPY</h1>
            <p className="text-xs text-stone-600 uppercase font-bold tracking-wider">
              Sistema Interno de Gestión de Agua Potable
            </p>
          </div>
          <p className="text-xs text-stone-500">
            Acceso exclusivo para personal operativo: Administradores, Cobradores y Lectores
          </p>
        </div>

        {/* Supabase Status Indicator */}
        <div className="text-[11px] px-3 py-1.5 rounded-lg flex items-center justify-between bg-stone-50 border border-stone-200 text-stone-600">
          <span>Backend / Base de Datos:</span>
          {isSupabaseConfigured ? (
            <span className="font-bold text-emerald-700 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              Supabase PostgreSQL Conectado
            </span>
          ) : (
            <span className="font-semibold text-blue-700 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              Motor Interno Activo (Demo 1.000 Medidores)
            </span>
          )}
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-red-800 text-xs font-semibold flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="font-bold text-stone-700 block mb-1">Correo Electrónico Corporativo</label>
            <div className="relative">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@aguateria.py"
                className="w-full pl-9 pr-3 py-2.5 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-900 focus:outline-hidden focus:border-blue-600 focus:bg-white"
              />
              <Mail className="w-4 h-4 text-stone-400 absolute left-3 top-3" />
            </div>
          </div>

          <div>
            <label className="font-bold text-stone-700 block mb-1">Contraseña de Acceso</label>
            <div className="relative">
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-3 py-2.5 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-900 focus:outline-hidden focus:border-blue-600 focus:bg-white"
              />
              <KeyRound className="w-4 h-4 text-stone-400 absolute left-3 top-3" />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-stone-900 hover:bg-stone-800 active:bg-black text-white font-bold rounded-lg text-sm flex items-center justify-center gap-2 shadow-xs transition-colors disabled:opacity-50"
          >
            <span>{loading ? 'Verificando...' : 'Iniciar Sesión'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Quick Demo Credentials (solo si Supabase no está configurado) */}
        {!isSupabaseConfigured && (
          <div className="pt-3 border-t border-stone-200 space-y-2">
            <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wider block text-center">
              Acceso Rápido por Rol (Para Evaluación):
            </span>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleSelectQuickRole('admin@aguateria.py', 'admin123')}
                className={`p-2 rounded-lg border text-left transition-all text-[11px] ${
                  email === 'admin@aguateria.py'
                    ? 'border-blue-600 bg-blue-50 font-bold text-blue-900'
                    : 'border-stone-200 hover:bg-stone-50 text-stone-700'
                }`}
              >
                <div className="font-bold flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                  <span>Admin</span>
                </div>
                <span className="text-[10px] text-stone-500 block">Acceso total</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectQuickRole('cobrador@aguateria.py', 'cobrador123')}
                className={`p-2 rounded-lg border text-left transition-all text-[11px] ${
                  email === 'cobrador@aguateria.py'
                    ? 'border-emerald-600 bg-emerald-50 font-bold text-emerald-900'
                    : 'border-stone-200 hover:bg-stone-50 text-stone-700'
                }`}
              >
                <div className="font-bold flex items-center gap-1">
                  <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Cobrador</span>
                </div>
                <span className="text-[10px] text-stone-500 block">Caja y cobros</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectQuickRole('lectura@aguateria.py', 'lectura123')}
                className={`p-2 rounded-lg border text-left transition-all text-[11px] ${
                  email === 'lectura@aguateria.py'
                    ? 'border-amber-600 bg-amber-50 font-bold text-amber-900'
                    : 'border-stone-200 hover:bg-stone-50 text-stone-700'
                }`}
              >
                <div className="font-bold flex items-center gap-1">
                  <Droplets className="w-3.5 h-3.5 text-amber-600" />
                  <span>Lector</span>
                </div>
                <span className="text-[10px] text-stone-500 block">Ruta móvil</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
