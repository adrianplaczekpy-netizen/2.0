/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserRole } from '../types';

export interface SidebarNavItemMeta {
  id: string;
  label: string;
  adminOnly?: boolean;
}

export const SIDEBAR_NAV_ITEMS: SidebarNavItemMeta[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'clientes', label: 'Clientes' },
  { id: 'medidores', label: 'Medidores' },
  { id: 'lecturas', label: 'Lecturas' },
  { id: 'trabajos', label: 'Otros Trabajos' },
  { id: 'mapa', label: 'Mapa' },
  { id: 'facturacion', label: 'Facturación' },
  { id: 'pagos', label: 'Pagos' },
  { id: 'cortes', label: 'Corte y Reconexión', adminOnly: true },
  { id: 'reportes', label: 'Reportes' },
  { id: 'usuarios', label: 'Usuarios', adminOnly: true },
];

export const MOBILE_PRIMARY_NAV_IDS = [
  'dashboard',
  'clientes',
  'medidores',
  'lecturas',
] as const;

export const MOBILE_MORE_NAV_ITEMS: SidebarNavItemMeta[] = [
  { id: 'trabajos', label: 'Otros Trabajos' },
  { id: 'mapa', label: 'Mapa' },
  { id: 'facturacion', label: 'Facturación' },
  { id: 'pagos', label: 'Pagos' },
  { id: 'cortes', label: 'Corte y Reconexión', adminOnly: true },
  { id: 'reportes', label: 'Reportes' },
  { id: 'usuarios', label: 'Usuarios', adminOnly: true },
  { id: '/admin/configuracion/tarifas', label: 'Configuración', adminOnly: true },
];

export function getVisibleSidebarNavItems(rol?: UserRole): SidebarNavItemMeta[] {
  return SIDEBAR_NAV_ITEMS.filter((item) => !item.adminOnly || rol === 'admin');
}

export function getMobilePrimaryNavItems(rol?: UserRole): SidebarNavItemMeta[] {
  const visible = getVisibleSidebarNavItems(rol);
  const byId = new Map(visible.map((item) => [item.id, item]));
  return MOBILE_PRIMARY_NAV_IDS.map((id) => byId.get(id)).filter(
    (item): item is SidebarNavItemMeta => Boolean(item)
  );
}

export function getMobileMoreNavItems(rol?: UserRole): SidebarNavItemMeta[] {
  return MOBILE_MORE_NAV_ITEMS.filter((item) => !item.adminOnly || rol === 'admin');
}
