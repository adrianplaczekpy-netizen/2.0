/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UserRole } from '../types';
import { supabase, isSupabaseConfigured, AppUser, USUARIOS_DEMO } from '../services/supabaseClient';
import { db } from '../services/database';

interface AuthContextType {
  user: AppUser | null;
  role: UserRole;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  switchDemoRole: (role: UserRole) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LEGACY_AUTH_STORAGE_KEY = 'aguateria_py_session';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const resolveSupabaseAppUser = useCallback(async (sessionUser: any): Promise<AppUser | null> => {
    if (!supabase || !sessionUser) return null;

    const [profileRes, roleRes] = await Promise.all([
      supabase
        .from('usuarios')
        .select('id, email, nombre_completo, activo')
        .eq('id', sessionUser.id)
        .maybeSingle(),
      supabase.from('user_roles').select('rol').eq('user_id', sessionUser.id).maybeSingle(),
    ]);

    const profile = profileRes.data;
    if (profile && profile.activo === false) {
      await supabase.auth.signOut();
      return null;
    }

    const rol = (roleRes.data?.rol as UserRole) || 'lectura';
    const fallbackName =
      sessionUser.user_metadata?.nombre_completo ||
      sessionUser.user_metadata?.nombre ||
      (sessionUser.email ? sessionUser.email.split('@')[0] : 'Usuario');

    return {
      id: sessionUser.id,
      email: profile?.email || sessionUser.email || '',
      nombre: profile?.nombre_completo || fallbackName,
      rol,
      cargo: rol === 'admin' ? 'Administrador' : rol === 'cobrador' ? 'Cobrador' : 'Lector',
    };
  }, []);

  useEffect(() => {
    // Eliminar cualquier sesión residual almacenada en localStorage
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
      } catch {
        // Ignorar
      }
    }

    let isMounted = true;

    const checkSession = async () => {
      try {
        if (isSupabaseConfigured && supabase) {
          const {
            data: { session },
            error,
          } = await supabase.auth.getSession();

          if (error) {
            console.warn('Error al consultar sesión en Supabase:', error.message);
            if (isMounted) {
              setUser(null);
              db.clearData();
            }
            return;
          }

          if (session?.user) {
            const appUser = await resolveSupabaseAppUser(session.user);
            if (isMounted) {
              if (appUser) {
                setUser(appUser);
                await db.loadFromSupabase();
              } else {
                setUser(null);
                db.clearData();
              }
            }
            return;
          }

          // Sin sesión activa en Supabase: mostrar LoginView (sin fallback a localStorage ni demo)
          if (isMounted) {
            setUser(null);
            db.clearData();
          }
          return;
        }

        // Modo sin credenciales Supabase configuradas (preview local sin .env): iniciar sin sesión en localStorage
        if (isMounted) {
          setUser(null);
        }
      } catch (err) {
        console.warn('Advertencia al inicializar sesión:', err);
        if (isMounted) {
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    checkSession();

    let authSubscription: { unsubscribe: () => void } | null = null;
    if (isSupabaseConfigured && supabase) {
      const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!isMounted) return;
        if (event === 'SIGNED_OUT' || !session?.user) {
          setUser(null);
          db.clearData();
          return;
        }
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          const appUser = await resolveSupabaseAppUser(session.user);
          if (!isMounted) return;
          if (appUser) {
            setUser(appUser);
            await db.loadFromSupabase();
          } else {
            setUser(null);
            db.clearData();
          }
        }
      });
      authSubscription = data.subscription;
    }

    return () => {
      isMounted = false;
      if (authSubscription) {
        authSubscription.unsubscribe();
      }
    };
  }, [resolveSupabaseAppUser]);

  const login = async (email: string, password = ''): Promise<{ success: boolean; error?: string }> => {
    const cleanEmail = email.trim().toLowerCase();

    // 1. Si Supabase está configurado, autenticar exclusivamente contra Supabase Auth (sin fallback a localStorage/demo)
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

        if (error) {
          const msgLower = error.message.toLowerCase();
          if (msgLower.includes('banned') || msgLower.includes('disabled')) {
            return {
              success: false,
              error: 'Tu cuenta está inactiva o deshabilitada. Contactá al administrador.',
            };
          }
          return { success: false, error: error.message };
        }

        if (!data.user) {
          return { success: false, error: 'No se recibió una sesión válida desde Supabase.' };
        }

        const appUser = await resolveSupabaseAppUser(data.user);
        if (!appUser) {
          return {
            success: false,
            error: 'Tu cuenta está inactiva o no tiene acceso habilitado. Contactá al administrador.',
          };
        }

        setUser(appUser);
        await db.loadFromSupabase({ force: true });
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message || 'Error al autenticar con Supabase' };
      }
    }

    // 2. Solo cuando Supabase NO está configurado en el entorno (preview sin .env): usuarios demo en memoria
    const demoUser = USUARIOS_DEMO[cleanEmail];
    if (demoUser) {
      setUser(demoUser);
      return { success: true };
    }

    const inferredRole: UserRole = cleanEmail.includes('cobrador')
      ? 'cobrador'
      : cleanEmail.includes('lectura')
      ? 'lectura'
      : 'admin';

    const customUser: AppUser = {
      id: `usr-${Date.now()}`,
      email: cleanEmail,
      nombre: cleanEmail.split('@')[0].replace('.', ' ').toUpperCase(),
      rol: inferredRole,
      cargo: inferredRole === 'admin' ? 'Administrador' : inferredRole === 'cobrador' ? 'Cajero' : 'Lector',
    };

    setUser(customUser);
    return { success: true };
  };

  const logout = async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
      } catch {
        // Ignorar
      }
    }
    db.clearData();
    setUser(null);
  };

  const switchDemoRole = (targetRole: UserRole) => {
    if (isSupabaseConfigured) return;
    const emailByRole: Record<UserRole, string> = {
      admin: 'admin@aguateria.py',
      cobrador: 'cobrador@aguateria.py',
      lectura: 'lectura@aguateria.py',
    };
    const targetUser = USUARIOS_DEMO[emailByRole[targetRole]];
    if (targetUser) {
      setUser(targetUser);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        role: user?.rol || 'lectura',
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        switchDemoRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe ser utilizado dentro de un AuthProvider');
  }
  return context;
};
