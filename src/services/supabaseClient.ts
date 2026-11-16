/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { UserRole } from '../types';

const getEnvVar = (key: string): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  return '';
};

export const supabaseUrl = getEnvVar('VITE_SUPABASE_URL');
export const supabaseAnonKey = getEnvVar('VITE_SUPABASE_ANON_KEY');

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseUrl.startsWith('https://') &&
    supabaseAnonKey &&
    supabaseAnonKey !== 'your-anon-key'
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export interface AppUser {
  id: string;
  email: string;
  nombre: string;
  rol: UserRole;
  cargo: string;
}

export const USUARIOS_DEMO: Record<string, AppUser> = {
  'admin@aguateria.py': {
    id: 'usr-admin-1',
    email: 'admin@aguateria.py',
    nombre: 'Ing. Carlos Mendoza',
    rol: 'admin',
    cargo: 'Administrador General',
  },
  'cobrador@aguateria.py': {
    id: 'usr-cobrador-1',
    email: 'cobrador@aguateria.py',
    nombre: 'Lic. Ramona Benítez',
    rol: 'cobrador',
    cargo: 'Cajera y Recaudación',
  },
  'lectura@aguateria.py': {
    id: 'usr-lectura-1',
    email: 'lectura@aguateria.py',
    nombre: 'Operario José Giménez',
    rol: 'lectura',
    cargo: 'Lector de Medidores en Ruta',
  },
};
