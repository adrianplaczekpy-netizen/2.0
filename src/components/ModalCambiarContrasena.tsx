/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '../services/supabaseClient';
import {
  cambiarContrasenaUsuario,
  MIN_PASSWORD_LENGTH,
} from '../services/passwordChange';
import { X, KeyRound, AlertTriangle, Eye, EyeOff, Loader2, Check } from 'lucide-react';

interface ModalCambiarContrasenaProps {
  isOpen: boolean;
  userEmail?: string | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export const ModalCambiarContrasena: React.FC<ModalCambiarContrasenaProps> = ({
  isOpen,
  userEmail,
  onClose,
  onSuccess,
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowCurrent(false);
      setShowNew(false);
      setShowConfirm(false);
      setSaving(false);
      setErrorMsg(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setErrorMsg(null);
    setSaving(true);

    try {
      const authClient = isSupabaseConfigured && supabase ? supabase.auth : null;
      const res = await cambiarContrasenaUsuario({
        email: userEmail,
        currentPassword,
        newPassword,
        confirmPassword,
        authClient,
      });

      if (!res.ok) {
        setErrorMsg(res.error || 'No se pudo actualizar la contraseña.');
        return;
      }

      onSuccess('Contraseña actualizada correctamente');
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error inesperado al actualizar la contraseña.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-cambiar-contrasena-titulo"
      className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-stone-200">
        {/* Cabecera */}
        <div className="bg-stone-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 bg-white/10 rounded-lg shrink-0">
              <KeyRound className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h2
                id="modal-cambiar-contrasena-titulo"
                className="text-sm font-bold tracking-tight"
              >
                Cambiar contraseña
              </h2>
              {userEmail && (
                <p className="text-[11px] text-stone-300 truncate">{userEmail}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Cerrar modal de cambio de contraseña"
            className="p-1.5 text-stone-400 hover:text-white rounded-lg hover:bg-stone-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {errorMsg && (
            <div
              role="alert"
              className="p-3 bg-red-50 border border-red-300 rounded-lg text-red-800 text-xs font-semibold flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div>
            <label
              htmlFor="pwd-current"
              className="block text-xs font-bold text-stone-700 mb-1"
            >
              Contraseña actual
            </label>
            <div className="relative">
              <input
                id="pwd-current"
                type={showCurrent ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Ingresá tu contraseña actual"
                disabled={saving}
                required
                className="w-full px-3 py-2.5 pr-10 bg-stone-50 border border-stone-300 rounded-lg text-xs font-medium text-stone-900 focus:outline-hidden focus:border-blue-600 focus:bg-white disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                aria-label={showCurrent ? 'Ocultar contraseña actual' : 'Mostrar contraseña actual'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="pwd-new"
              className="block text-xs font-bold text-stone-700 mb-1"
            >
              Contraseña nueva
            </label>
            <div className="relative">
              <input
                id="pwd-new"
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                placeholder={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`}
                minLength={MIN_PASSWORD_LENGTH}
                disabled={saving}
                required
                className="w-full px-3 py-2.5 pr-10 bg-stone-50 border border-stone-300 rounded-lg text-xs font-medium text-stone-900 focus:outline-hidden focus:border-blue-600 focus:bg-white disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? 'Ocultar contraseña nueva' : 'Mostrar contraseña nueva'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-stone-500 mt-1">
              Mínimo {MIN_PASSWORD_LENGTH} caracteres.
            </p>
          </div>

          <div>
            <label
              htmlFor="pwd-confirm"
              className="block text-xs font-bold text-stone-700 mb-1"
            >
              Confirmar contraseña nueva
            </label>
            <div className="relative">
              <input
                id="pwd-confirm"
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Repetí la contraseña nueva"
                minLength={MIN_PASSWORD_LENGTH}
                disabled={saving}
                required
                className="w-full px-3 py-2.5 pr-10 bg-stone-50 border border-stone-300 rounded-lg text-xs font-medium text-stone-900 focus:outline-hidden focus:border-blue-600 focus:bg-white disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                aria-label={
                  showConfirm
                    ? 'Ocultar confirmación de contraseña'
                    : 'Mostrar confirmación de contraseña'
                }
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-stone-200">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-xs font-bold text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-stone-900 hover:bg-stone-800 active:bg-stone-950 disabled:opacity-60 text-white text-xs font-bold rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Guardando...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Guardar</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
