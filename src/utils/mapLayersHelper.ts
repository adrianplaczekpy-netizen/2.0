/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type MapLayerName = 'Calles' | 'Satelital' | 'Satelital + Etiquetas';

export const MAP_DEFAULT_LAYER_NAME: MapLayerName = 'Calles';

export function getMapboxTokenFromEnv(): string {
  try {
    const metaEnv = (import.meta as any)?.env;
    if (metaEnv && typeof metaEnv.VITE_MAPBOX_TOKEN === 'string' && metaEnv.VITE_MAPBOX_TOKEN.trim()) {
      return metaEnv.VITE_MAPBOX_TOKEN.trim();
    }
  } catch {
    // Entorno sin import.meta.env
  }
  if (typeof process !== 'undefined' && process.env?.VITE_MAPBOX_TOKEN) {
    return String(process.env.VITE_MAPBOX_TOKEN).trim();
  }
  return '';
}

export function isMapboxTokenConfigured(token?: string): boolean {
  const val = (token ?? getMapboxTokenFromEnv()).trim();
  return Boolean(val && val !== 'your-mapbox-token' && !val.startsWith('REPLACE_'));
}

export function getMapboxSatelliteUrl(token: string): string {
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/256/{z}/{x}/{y}@2x?access_token=${encodeURIComponent(token.trim())}`;
}

export function getMapboxSatelliteStreetsUrl(token: string): string {
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${encodeURIComponent(token.trim())}`;
}

export const MAP_ESRIFALLBACK_URLS = {
  satelital:
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  etiquetas:
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
} as const;

export interface MapTileLayersResolvedConfig {
  provider: 'mapbox' | 'esri_fallback';
  calles: {
    label: MapLayerName;
    url: string;
    attribution: string;
    maxZoom: number;
  };
  satelital: {
    label: MapLayerName;
    url: string;
    attribution: string;
    maxZoom: number;
  };
  satelitalConEtiquetas: {
    label: MapLayerName;
    isCompositeEsri: boolean;
    url: string;
    overlayUrl?: string;
    attribution: string;
    maxZoom: number;
  };
}

export function getMapTileLayersConfig(tokenOverride?: string): MapTileLayersResolvedConfig {
  const token = (tokenOverride ?? getMapboxTokenFromEnv()).trim();
  const hasMapbox = isMapboxTokenConfigured(token);

  return {
    provider: hasMapbox ? 'mapbox' : 'esri_fallback',
    calles: {
      label: 'Calles',
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    },
    satelital: hasMapbox
      ? {
          label: 'Satelital',
          url: getMapboxSatelliteUrl(token),
          attribution: '© Mapbox © OpenStreetMap',
          maxZoom: 19,
        }
      : {
          label: 'Satelital',
          url: MAP_ESRIFALLBACK_URLS.satelital,
          attribution: 'Tiles © Esri',
          maxZoom: 19,
        },
    satelitalConEtiquetas: hasMapbox
      ? {
          label: 'Satelital + Etiquetas',
          isCompositeEsri: false,
          url: getMapboxSatelliteStreetsUrl(token),
          attribution: '© Mapbox © OpenStreetMap',
          maxZoom: 19,
        }
      : {
          label: 'Satelital + Etiquetas',
          isCompositeEsri: true,
          url: MAP_ESRIFALLBACK_URLS.satelital,
          overlayUrl: MAP_ESRIFALLBACK_URLS.etiquetas,
          attribution: 'Tiles © Esri',
          maxZoom: 19,
        },
  };
}

export const MAP_TILE_LAYERS_CONFIG = {
  calles: {
    label: 'Calles' as MapLayerName,
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  },
  satelital: {
    label: 'Satelital' as MapLayerName,
    url: MAP_ESRIFALLBACK_URLS.satelital,
    attribution: 'Tiles © Esri',
    maxZoom: 19,
  },
  etiquetas: {
    url: MAP_ESRIFALLBACK_URLS.etiquetas,
    attribution: 'Tiles © Esri',
    maxZoom: 19,
  },
  satelitalConEtiquetasLabel: 'Satelital + Etiquetas' as MapLayerName,
} as const;
