/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';

// Lazy loading estricto de estilos CSS de Leaflet dentro del módulo de mapa
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

import {
  tileLayerOffline,
  downloadTile,
  saveTile,
  hasTile,
  getStorageLength,
  truncate,
  type TileLayerOffline,
} from 'leaflet.offline';

import { db } from '../services/database';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { validarNumeroMedidor } from '../services/billingRules';
import {
  GEO_ERR_PERMISSION_DENIED,
  isGeolocationPermissionDeniedInSession,
  solicitarUbicacionActual,
} from '../utils/geolocationHelper';
import { getMapTileLayersConfig } from '../utils/mapLayersHelper';
import {
  calcularBoundsZonaDescarga,
  calcularZoomsDescargaOffline,
  ejecutarDescargaTilesOffline,
  type OfflineTileDescriptor,
} from '../utils/mapOfflineHelper';
import {
  AGUATERIA_UBICACION,
  ZONAS_AGUATERIA_SECTOR,
  ZONA_AGUATERIA_DEFAULT,
} from '../config/aguateriaConfig';
import { EstadoMedidor } from '../types';
import {
  MapPin,
  Search,
  Plus,
  X,
  CheckCircle2,
  AlertCircle,
  Crosshair,
  LocateFixed,
  Loader2,
  Download,
  Trash2,
} from 'lucide-react';

interface MapaMedidoresViewProps {
  onSelectMedidorParaCobro?: (medidorId: string) => void;
  onSelectMedidorParaLectura?: (medidorNum: number) => void;
}

interface MedidorMapaItem {
  id: string;
  numero_medidor: number;
  latitud: number;
  longitud: number;
  estado: EstadoMedidor;
  direccion: string;
  zona: string;
  cliente_nombre: string;
  deuda: number;
  ultima_lectura: number;
}

export const MapaMedidoresView: React.FC<MapaMedidoresViewProps> = ({
  onSelectMedidorParaCobro,
  onSelectMedidorParaLectura,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersMapRef = useRef<Map<number, L.Marker>>(new Map());
  const tempMarkerRef = useRef<L.Marker | null>(null);
  const userLocationMarkerRef = useRef<L.CircleMarker | null>(null);
  const offlineLayersRef = useRef<TileLayerOffline[]>([]);

  // Estados de filtros
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoMedidor | 'todos'>('todos');
  const [zonaFiltro, setZonaFiltro] = useState<string>('todas');
  const [search, setSearch] = useState<string>('');
  const [searchResults, setSearchResults] = useState<MedidorMapaItem[]>([]);
  const [showSearchDropdown, setShowSearchDropdown] = useState<boolean>(false);

  // Modo ubicación / alta desde mapa
  const [isPlacementMode, setIsPlacementMode] = useState<boolean>(false);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [clickedLatLng, setClickedLatLng] = useState<{ lat: number; lng: number } | null>(null);

  // Formulario nuevo medidor en terreno
  const [nuevoNumero, setNuevoNumero] = useState<string>('');
  const [nuevoClienteId, setNuevoClienteId] = useState<string>('');
  const [clienteSearchQuery, setClienteSearchQuery] = useState<string>('');
  const [nuevaDireccion, setNuevaDireccion] = useState<string>('');
  const [nuevaZona, setNuevaZona] = useState<string>(ZONA_AGUATERIA_DEFAULT);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<boolean>(false);
  const [toast, setToast] = useState<{ tipo: 'success' | 'error'; texto: string } | null>(null);
  const [locatingUser, setLocatingUser] = useState<boolean>(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [gpsPermisoDenegado, setGpsPermisoDenegado] = useState<boolean>(() =>
    isGeolocationPermissionDeniedInSession()
  );

  // Descarga y caché offline de tiles
  const [descargandoOffline, setDescargandoOffline] = useState<boolean>(false);
  const [progresoOffline, setProgresoOffline] = useState<{ loaded: number; total: number } | null>(null);
  const [tilesOfflineGuardados, setTilesOfflineGuardados] = useState<number>(0);
  const [limpiandoCache, setLimpiandoCache] = useState<boolean>(false);

  // Recarga de datos
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [mapLoaded, setMapLoaded] = useState<boolean>(false);
  const [totalVisible, setTotalVisible] = useState<number>(0);

  useEffect(() => {
    const unsubscribe = db.subscribe(() => {
      setRefreshKey((k) => k + 1);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    getStorageLength()
      .then((count) => setTilesOfflineGuardados(count))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const mostrarToast = (tipo: 'success' | 'error', texto: string) => {
    setToast({ tipo, texto });
  };

  // Lista completa de medidores para mapa
  const medidores = useMemo(() => {
    return db.getMedidoresParaMapa();
  }, [refreshKey]);

  // Lista oficial de zonas del sector para el filtro combinado
  const zonasDisponibles = ZONAS_AGUATERIA_SECTOR;

  // Lista de clientes existentes (necesarios para asignar nuevo medidor)
  const clientesExistentes = useMemo(() => {
    return db.getClientes({ limit: 50 }).clientes;
  }, [refreshKey]);

  // Filtrado de clientes para autocompletado en modal
  const clientesFiltrados = useMemo(() => {
    if (!clienteSearchQuery.trim()) return clientesExistentes.slice(0, 10);
    const q = clienteSearchQuery.toLowerCase();
    return clientesExistentes
      .filter((c) => c.nombre_completo.toLowerCase().includes(q) || c.documento.includes(q))
      .slice(0, 10);
  }, [clientesExistentes, clienteSearchQuery]);

  // Helper para generar el HTML del popup mínimo requerido
  const createMinimalPopupHtml = (m: MedidorMapaItem) => {
    let estadoLabel = m.estado.replace('_', ' ');
    let badgeBg = '#ecfdf5';
    let badgeText = '#065f46';
    let badgeBorder = '#a7f3d0';

    if (m.estado === 'moroso') {
      badgeBg = '#fffbeb';
      badgeText = '#92400e';
      badgeBorder = '#fde68a';
    } else if (m.estado === 'pendiente_corte') {
      badgeBg = '#fff7ed';
      badgeText = '#9a3412';
      badgeBorder = '#fed7aa';
    } else if (m.estado === 'cortado') {
      badgeBg = '#fef2f2';
      badgeText = '#991b1b';
      badgeBorder = '#fecaca';
    } else if (m.estado === 'retirado') {
      badgeBg = '#f3f4f6';
      badgeText = '#374151';
      badgeBorder = '#e5e7eb';
    }

    return `
      <div style="font-family: system-ui, -apple-system, sans-serif; min-width: 210px; padding: 4px; color: #1c1917;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px;">
          <span style="font-size: 13px; font-weight: 800; color: #0c0a09; letter-spacing: -0.02em;">
            Medidor N° ${m.numero_medidor}
          </span>
          <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; background: ${badgeBg}; color: ${badgeText}; border: 1px solid ${badgeBorder};">
            ${estadoLabel}
          </span>
        </div>
        
        <div style="font-size: 12px; font-weight: 600; color: #292524; margin-bottom: 2px; line-height: 1.3;">
          ${m.cliente_nombre || 'Sin titular asignado'}
        </div>
        
        <div style="font-size: 11px; color: #78716c; margin-bottom: 6px; line-height: 1.2;">
          ${m.direccion}${m.zona ? ` • ${m.zona}` : ''}
        </div>
        
        <div style="padding-top: 6px; border-top: 1px solid #e7e5e4; display: flex; align-items: center; justify-content: space-between;">
          <span style="font-size: 11px; color: #57534e; font-weight: 500;">
            Última lectura: <b style="color: #0c0a09;">${m.ultima_lectura} m³</b>
          </span>
        </div>
      </div>
    `;
  };

  // 1. Inicialización del Mapa Leaflet
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Coordenadas centrales de la aguatería
    const map = L.map(mapContainerRef.current, {
      center: [AGUATERIA_UBICACION.lat, AGUATERIA_UBICACION.lng],
      zoom: AGUATERIA_UBICACION.zoom,
      zoomControl: true,
      maxZoom: 19,
      minZoom: 10,
    });

    // Capas base con soporte offline (IndexedDB vía leaflet.offline):
    // Calles (OpenStreetMap estándar) siempre por defecto, Satelital via Mapbox (o fallback Esri sin token)
    const layersCfg = getMapTileLayersConfig();

    const capaCalles = tileLayerOffline(layersCfg.calles.url, {
      attribution: layersCfg.calles.attribution,
      maxZoom: layersCfg.calles.maxZoom,
      subdomains: 'abc',
    });

    const capaSatelital = tileLayerOffline(layersCfg.satelital.url, {
      attribution: layersCfg.satelital.attribution,
      maxZoom: layersCfg.satelital.maxZoom,
      subdomains: 'abc',
    });

    let capaSatelitalConEtiquetas: L.Layer;
    if (!layersCfg.satelitalConEtiquetas.isCompositeEsri) {
      const capaSatelitalEtiquetasTile = tileLayerOffline(layersCfg.satelitalConEtiquetas.url, {
        attribution: layersCfg.satelitalConEtiquetas.attribution,
        maxZoom: layersCfg.satelitalConEtiquetas.maxZoom,
        subdomains: 'abc',
      });
      capaSatelitalConEtiquetas = capaSatelitalEtiquetasTile;
      offlineLayersRef.current = [capaCalles, capaSatelital, capaSatelitalEtiquetasTile];
    } else {
      const capaSatelitalBase = tileLayerOffline(layersCfg.satelital.url, {
        attribution: layersCfg.satelital.attribution,
        maxZoom: layersCfg.satelital.maxZoom,
        subdomains: 'abc',
        zIndex: 1,
      });

      const capaEtiquetas = tileLayerOffline(
        layersCfg.satelitalConEtiquetas.overlayUrl || layersCfg.satelital.url,
        {
          attribution: layersCfg.satelitalConEtiquetas.attribution,
          maxZoom: layersCfg.satelitalConEtiquetas.maxZoom,
          subdomains: 'abc',
          zIndex: 2,
        }
      );

      capaSatelitalConEtiquetas = L.layerGroup([capaSatelitalBase, capaEtiquetas]);
      offlineLayersRef.current = [capaCalles, capaSatelital, capaEtiquetas];
    }

    capaCalles.addTo(map);

    L.control
      .layers(
        {
          [layersCfg.calles.label]: capaCalles,
          [layersCfg.satelital.label]: capaSatelital,
          [layersCfg.satelitalConEtiquetas.label]: capaSatelitalConEtiquetas,
        },
        {},
        { position: 'topright', collapsed: false }
      )
      .addTo(map);

    // MarkerClusterGroup con chunked loading para rendimiento fluido con 1.000+ marcadores
    const cluster = L.markerClusterGroup({
      chunkedLoading: true,
      chunkInterval: 60,
      chunkDelay: 15,
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      disableClusteringAtZoom: 17,
    });

    map.addLayer(cluster);

    mapInstanceRef.current = map;
    clusterGroupRef.current = cluster;
    (window as any).__aguateriaMap = map;
    setMapLoaded(true);

    // Click handler en el mapa para ubicar nuevo medidor
    map.on('click', (e: L.LeafletMouseEvent) => {
      // Solo si está activado el modo ubicación
      if (document.body.getAttribute('data-placement-active') === 'true') {
        const { lat, lng } = e.latlng;
        setClickedLatLng({ lat, lng });

        // Marcar visualmente el punto clickeado
        if (tempMarkerRef.current) {
          map.removeLayer(tempMarkerRef.current);
        }

        const tempIcon = L.divIcon({
          className: 'temp-marker-pin',
          html: `
            <div style="background-color: #2563eb; width: 26px; height: 26px; border-radius: 50%; border: 3px solid #ffffff; box-shadow: 0 0 0 4px rgba(37,99,235,0.4); display: flex; align-items: center; justify-content: center; color: white; font-size: 14px; font-weight: bold;">
              +
            </div>
          `,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });

        const tempMarker = L.marker([lat, lng], { icon: tempIcon }).addTo(map);
        tempMarkerRef.current = tempMarker;

        // Abrir formulario
        setNuevaDireccion('');
        setNuevaZona(ZONA_AGUATERIA_DEFAULT);
        setNuevoNumero('');
        setErrorModal(null);
        setShowAddModal(true);
      }
    });

    return () => {
      map.remove();
      delete (window as any).__aguateriaMap;
      mapInstanceRef.current = null;
      clusterGroupRef.current = null;
      userLocationMarkerRef.current = null;
      offlineLayersRef.current = [];
      markersMapRef.current.clear();
    };
  }, []);

  // Sincronizar atributo global para evento de click
  useEffect(() => {
    if (isPlacementMode) {
      document.body.setAttribute('data-placement-active', 'true');
    } else {
      document.body.removeAttribute('data-placement-active');
      if (tempMarkerRef.current && mapInstanceRef.current) {
        mapInstanceRef.current.removeLayer(tempMarkerRef.current);
        tempMarkerRef.current = null;
      }
    }
  }, [isPlacementMode]);

  // 2. Cargar y filtrar marcadores en el Cluster
  useEffect(() => {
    if (!clusterGroupRef.current || !mapInstanceRef.current || !mapLoaded) return;

    const cluster = clusterGroupRef.current;
    cluster.clearLayers();
    markersMapRef.current.clear();

    const query = search.trim().toLowerCase();

    // Filtros combinados de estado y zona
    const filtrados = medidores.filter((m) => {
      if (estadoFiltro !== 'todos' && m.estado !== estadoFiltro) return false;
      if (zonaFiltro !== 'todas' && m.zona !== zonaFiltro) return false;
      if (query) {
        const numQuery = parseInt(query, 10);
        if (!isNaN(numQuery) && m.numero_medidor === numQuery) return true;
        return (
          m.cliente_nombre.toLowerCase().includes(query) ||
          m.direccion.toLowerCase().includes(query) ||
          m.zona.toLowerCase().includes(query)
        );
      }
      return true;
    });

    setTotalVisible(filtrados.length);

    // Generar marcadores
    const markers: L.Marker[] = [];

    filtrados.forEach((m) => {
      let pinColor = '#10b981'; // Activo -> verde
      if (m.estado === 'moroso') pinColor = '#f59e0b'; // Moroso -> amarillo/ámbar
      else if (m.estado === 'pendiente_corte') pinColor = '#ea580c'; // Pendiente corte -> naranja
      else if (m.estado === 'cortado') pinColor = '#dc2626'; // Cortado -> rojo
      else if (m.estado === 'retirado') pinColor = '#6b7280'; // Retirado -> gris

      const customIcon = L.divIcon({
        className: 'custom-meter-marker',
        html: `
          <div style="background-color: ${pinColor}; width: 22px; height: 22px; border-radius: 50%; border: 2.5px solid #ffffff; box-shadow: 0 2px 5px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-size: 9px; font-weight: 800; font-family: system-ui, sans-serif;">
            ${m.numero_medidor > 999 ? '•' : m.numero_medidor}
          </div>
        `,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        popupAnchor: [0, -12],
      });

      const marker = L.marker([m.latitud, m.longitud], { icon: customIcon });
      marker.bindPopup(createMinimalPopupHtml(m), {
        maxWidth: 260,
        className: 'minimal-meter-popup',
      });

      markers.push(marker);
      markersMapRef.current.set(m.numero_medidor, marker);
    });

    cluster.addLayers(markers);
  }, [mapLoaded, medidores, estadoFiltro, zonaFiltro, search]);

  // 3. Manejo de búsqueda y autocompletado para centrar mapa
  useEffect(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      setSearchResults([]);
      setShowSearchDropdown(false);
      return;
    }

    const numQuery = parseInt(q, 10);
    const matches = medidores
      .filter((m) => {
        if (!isNaN(numQuery) && m.numero_medidor === numQuery) return true;
        return (
          m.cliente_nombre.toLowerCase().includes(q) ||
          m.numero_medidor.toString().startsWith(q) ||
          m.direccion.toLowerCase().includes(q)
        );
      })
      .slice(0, 6);

    setSearchResults(matches);
    setShowSearchDropdown(matches.length > 0);
  }, [search, medidores]);

  // Centrar mapa en un medidor específico y abrir su popup
  const centrarEnMedidor = (medidor: MedidorMapaItem) => {
    if (!mapInstanceRef.current || !clusterGroupRef.current) return;

    setShowSearchDropdown(false);

    // Asegurarse de que el medidor no esté oculto por filtros
    if (estadoFiltro !== 'todos' && medidor.estado !== estadoFiltro) {
      setEstadoFiltro('todos');
    }
    if (zonaFiltro !== 'todas' && medidor.zona !== zonaFiltro) {
      setZonaFiltro('todas');
    }

    setTimeout(() => {
      const marker = markersMapRef.current.get(medidor.numero_medidor);
      if (marker && clusterGroupRef.current && mapInstanceRef.current) {
        clusterGroupRef.current.zoomToShowLayer(marker, () => {
          marker.openPopup();
        });
      } else if (mapInstanceRef.current) {
        mapInstanceRef.current.setView([medidor.latitud, medidor.longitud], 17);
      }
    }, 100);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchResults.length > 0) {
      centrarEnMedidor(searchResults[0]);
    }
  };

  // 4. Guardar nuevo medidor creado desde el mapa (espera confirmación Supabase antes de mostrar pin/cerrar modal)
  const handleGuardarNuevoMedidor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    setErrorModal(null);

    if (!clickedLatLng) {
      setErrorModal('Debe hacer clic en el mapa para ubicar las coordenadas del medidor.');
      return;
    }

    // Regla estricta: Requiere cliente existente
    if (!nuevoClienteId) {
      setErrorModal('El cliente titular debe estar creado previamente. Seleccione un cliente existente.');
      return;
    }

    const tarifa = db.getTarifasVigentes();
    const todosMedidores = db.getMedidoresParaMapa();
    const numerosExistentes = new Set(todosMedidores.map((m) => m.numero_medidor));

    // Validación estricta con pure logic
    const validacion = validarNumeroMedidor(
      nuevoNumero,
      numerosExistentes,
      tarifa.max_numero_medidor,
      todosMedidores.length
    );

    if (!validacion.valido || !validacion.numero) {
      setErrorModal(validacion.error || 'Número de medidor inválido');
      return;
    }

    if (!nuevaDireccion.trim()) {
      setErrorModal('Debe ingresar la dirección del terreno.');
      return;
    }

    setGuardando(true);
    try {
      await db.agregarMedidorAsync({
        cliente_id: nuevoClienteId,
        numero_medidor: validacion.numero,
        fecha_instalacion: new Date().toISOString().split('T')[0],
        direccion: nuevaDireccion.trim(),
        zona: nuevaZona,
        latitud: +(clickedLatLng.lat.toFixed(6)),
        longitud: +(clickedLatLng.lng.toFixed(6)),
        estado: 'activo',
      });

      if (isSupabaseConfigured) {
        await db.loadFromSupabase({ force: true });
      }

      // Solo tras confirmar persistencia: limpiar marcador temporal, cerrar modal y mostrar pin confirmado
      if (tempMarkerRef.current && mapInstanceRef.current) {
        mapInstanceRef.current.removeLayer(tempMarkerRef.current);
        tempMarkerRef.current = null;
      }

      const okMsg = `Medidor N° ${validacion.numero} creado y ubicado con éxito en el mapa.`;
      setShowAddModal(false);
      setIsPlacementMode(false);
      setMensajeExito(okMsg);
      mostrarToast('success', okMsg);
      setRefreshKey((k) => k + 1);

      // Centrar mapa en el nuevo medidor recién persistido
      setTimeout(() => {
        const nuevoEnLista = db.getMedidoresParaMapa().find((m) => m.numero_medidor === validacion.numero);
        if (nuevoEnLista) {
          centrarEnMedidor(nuevoEnLista);
        }
      }, 200);
    } catch (err: any) {
      // Fallo de persistencia: mantener modal ABIERTO con error inline, NO mostrar pin ni cerrar mapa
      setErrorModal(err?.message || 'Error al guardar el medidor.');
    } finally {
      setGuardando(false);
    }
  };

  const handleCancelarModoUbicacion = () => {
    if (guardando) return;
    setIsPlacementMode(false);
    setShowAddModal(false);
    setErrorModal(null);
    if (tempMarkerRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(tempMarkerRef.current);
      tempMarkerRef.current = null;
    }
  };

  const handleCentrarEnMiUbicacion = async () => {
    if (locatingUser) return;
    if (gpsPermisoDenegado) {
      setGeoError(GEO_ERR_PERMISSION_DENIED);
      return;
    }

    setGeoError(null);
    setLocatingUser(true);

    try {
      const coords = await solicitarUbicacionActual();
      const map = mapInstanceRef.current;
      if (map) {
        map.setView([coords.lat, coords.lng], 16, { animate: true });
        if (userLocationMarkerRef.current) {
          map.removeLayer(userLocationMarkerRef.current);
        }
        const marker = L.circleMarker([coords.lat, coords.lng], {
          radius: 9,
          color: '#ffffff',
          weight: 3,
          fillColor: '#2563eb',
          fillOpacity: 1,
        })
          .bindPopup('<b>Tu ubicación actual</b>')
          .addTo(map);
        userLocationMarkerRef.current = marker;
      }
      mostrarToast('success', 'Mapa centrado en tu ubicación actual.');
    } catch (err: any) {
      const msg = err?.message || GEO_ERR_PERMISSION_DENIED;
      if (err?.code === 1) {
        setGpsPermisoDenegado(true);
      }
      setGeoError(msg);
      mostrarToast('error', msg);
    } finally {
      setLocatingUser(false);
    }
  };

  const handleDescargarMapaOffline = async () => {
    const map = mapInstanceRef.current;
    const layers = offlineLayersRef.current;
    if (!map || layers.length === 0 || descargandoOffline) return;

    setDescargandoOffline(true);
    setProgresoOffline({ loaded: 0, total: 0 });

    try {
      const currentZoom = map.getZoom();
      const b = map.getBounds();
      const center = map.getCenter();
      const zooms = calcularZoomsDescargaOffline(currentZoom);
      const zona = calcularBoundsZonaDescarga({
        viewportBounds: {
          north: b.getNorth(),
          south: b.getSouth(),
          east: b.getEast(),
          west: b.getWest(),
        },
        center: { lat: center.lat, lng: center.lng },
        currentZoom,
      });

      const latLngBounds = L.latLngBounds([zona.south, zona.west], [zona.north, zona.east]);
      const tiles: OfflineTileDescriptor[] = [];

      for (const z of zooms) {
        const area = L.bounds(
          map.project(latLngBounds.getNorthWest(), z),
          map.project(latLngBounds.getSouthEast(), z)
        );
        for (const layer of layers) {
          const layerTiles = layer.getTileUrls(area, z);
          for (const tile of layerTiles) {
            tiles.push(tile);
          }
        }
      }

      const resultado = await ejecutarDescargaTilesOffline({
        tiles,
        storageOps: {
          hasTile,
          downloadTile,
          saveTile,
          getStorageLength,
        },
        onProgress: (p) => {
          setProgresoOffline({ loaded: p.loaded, total: p.total });
        },
      });

      setTilesOfflineGuardados(resultado.storagesize);

      if (resultado.saved === 0 && resultado.skipped === 0 && resultado.failed > 0) {
        mostrarToast(
          'error',
          'No se pudieron descargar los tiles del mapa. Verificá tu conexión a internet.'
        );
      } else {
        const msg = `Mapa de tu zona guardado offline: ${resultado.saved} tiles nuevos (${resultado.storagesize} en caché, Calles y Satelital).`;
        setMensajeExito(msg);
        mostrarToast('success', msg);
      }
    } catch (err: any) {
      mostrarToast('error', err?.message || 'Error al descargar el mapa offline.');
    } finally {
      setDescargandoOffline(false);
      setProgresoOffline(null);
    }
  };

  const handleLimpiarCacheOffline = async () => {
    if (descargandoOffline || limpiandoCache) return;
    setLimpiandoCache(true);
    try {
      await truncate();
      setTilesOfflineGuardados(0);
      mostrarToast('success', 'Caché offline del mapa limpiada.');
    } catch (err: any) {
      mostrarToast('error', err?.message || 'No se pudo limpiar la caché del mapa.');
    } finally {
      setLimpiandoCache(false);
    }
  };

  return (
    <div className="space-y-4">
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

      {/* Mensaje de confirmación temporal */}
      {mensajeExito && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center justify-between text-xs text-emerald-800 animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{mensajeExito}</span>
          </div>
          <button
            type="button"
            onClick={() => setMensajeExito(null)}
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Banner de Modo Ubicación Activo */}
      {isPlacementMode && (
        <div className="p-3 bg-blue-600 text-white rounded-xl shadow-md flex items-center justify-between gap-3 animate-pulse">
          <div className="flex items-center gap-2">
            <Crosshair className="w-5 h-5 shrink-0" />
            <div className="text-xs">
              <span className="font-bold uppercase tracking-wider block">Modo Ubicación Activo:</span>
              <span>Haga clic directamente en el mapa sobre el terreno donde desea instalar el medidor.</span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancelarModoUbicacion}
            className="px-3 py-1.5 bg-white text-blue-700 text-xs font-bold rounded-lg hover:bg-blue-50 transition-all shrink-0"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Error de geolocalización inline */}
      {geoError && (
        <div
          role="alert"
          className="p-3 bg-red-50 border border-red-300 rounded-xl flex items-center justify-between text-xs text-red-800 font-semibold"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{geoError}</span>
          </div>
          <button
            type="button"
            onClick={() => setGeoError(null)}
            aria-label="Cerrar error de ubicación"
            className="text-red-700 hover:text-red-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header Principal */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-stone-200 pb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <MapPin className="w-6 h-6 text-blue-600" />
            Mapa Espacial de Medidores
          </h1>
          <p className="text-xs text-stone-500 mt-0.5">
            Agrupamiento dinámico (MarkerCluster) para 1.000+ medidores independientes con filtros combinados
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDescargarMapaOffline}
            disabled={descargandoOffline || !mapLoaded}
            className="px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-60"
            title="Precargar tiles de Calles y Satelital de esta zona para usar el mapa sin conexión"
          >
            {descargandoOffline ? (
              <Loader2 className="w-4 h-4 animate-spin text-emerald-100" />
            ) : (
              <Download className="w-4 h-4 text-emerald-100" />
            )}
            <span>
              {descargandoOffline
                ? progresoOffline && progresoOffline.total > 0
                  ? `Descargando ${progresoOffline.loaded}/${progresoOffline.total}...`
                  : 'Preparando descarga...'
                : 'Descargar mapa de mi zona'}
            </span>
          </button>

          {tilesOfflineGuardados > 0 && (
            <button
              type="button"
              onClick={handleLimpiarCacheOffline}
              disabled={descargandoOffline || limpiandoCache}
              className="px-2.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs bg-white border border-stone-300 text-stone-700 hover:bg-stone-50 disabled:opacity-50"
              title="Vaciar tiles cacheados del mapa offline"
            >
              <Trash2 className="w-3.5 h-3.5 text-stone-500" />
              <span>Caché ({tilesOfflineGuardados})</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCentrarEnMiUbicacion}
            disabled={locatingUser}
            className="px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs bg-white border border-stone-300 text-stone-800 hover:bg-stone-50 disabled:opacity-50"
            title="Centrar mapa en mi ubicación GPS actual"
          >
            {locatingUser ? (
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            ) : (
              <LocateFixed className="w-4 h-4 text-blue-600" />
            )}
            <span>{locatingUser ? 'Ubicando...' : 'Centrar en mi ubicación'}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsPlacementMode(!isPlacementMode)}
            className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs ${
              isPlacementMode
                ? 'bg-amber-600 text-white hover:bg-amber-700 ring-2 ring-amber-400 ring-offset-2'
                : 'bg-stone-900 text-white hover:bg-stone-800'
            }`}
          >
            <Plus className="w-4 h-4" />
            {isPlacementMode ? 'Cancelar ubicación' : 'Ubicar nuevo medidor'}
          </button>
        </div>
      </div>

      {/* Controles de Búsqueda y Filtros Combinados */}
      <div className="bg-white p-3.5 rounded-xl border border-stone-200 shadow-xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          {/* Búsqueda por numero_medidor o cliente con centrado inmediato */}
          <div className="md:col-span-5 relative">
            <form onSubmit={handleSearchSubmit} className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => {
                  if (searchResults.length > 0) setShowSearchDropdown(true);
                }}
                placeholder="Buscar por N° medidor o titular..."
                className="w-full pl-8 pr-16 py-1.5 bg-stone-50 border border-stone-300 rounded-lg text-xs focus:ring-1 focus:ring-stone-400 focus:bg-white"
              />
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-2.5" />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setShowSearchDropdown(false);
                  }}
                  className="absolute right-12 top-2 text-stone-400 hover:text-stone-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="submit"
                className="absolute right-1.5 top-1 px-2 py-0.5 bg-stone-900 text-white text-[10px] font-bold rounded hover:bg-stone-800"
              >
                Centrar
              </button>
            </form>

            {/* Dropdown de resultados de búsqueda para centrar en un clic */}
            {showSearchDropdown && searchResults.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-stone-200 rounded-xl shadow-lg divide-y divide-stone-100 max-h-60 overflow-y-auto">
                {searchResults.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => centrarEnMedidor(m)}
                    className="w-full px-3 py-2 text-left hover:bg-blue-50/70 flex items-center justify-between transition-colors text-xs"
                  >
                    <div>
                      <span className="font-bold text-stone-900">Medidor N° {m.numero_medidor}</span>
                      <span className="text-stone-500 ml-2">• {m.cliente_nombre}</span>
                      <p className="text-[10px] text-stone-400 leading-tight">{m.direccion}</p>
                    </div>
                    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-stone-100 text-stone-600 shrink-0">
                      {m.estado.replace('_', ' ')}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Filtro combinado: Estado */}
          <div className="md:col-span-4 flex items-center gap-1 overflow-x-auto pb-1 md:pb-0">
            <span className="text-[11px] font-bold text-stone-500 mr-1 shrink-0">Estado:</span>
            {(['todos', 'activo', 'moroso', 'pendiente_corte', 'cortado', 'retirado'] as const).map(
              (est) => (
                <button
                  key={est}
                  type="button"
                  onClick={() => setEstadoFiltro(est)}
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold capitalize shrink-0 transition-all ${
                    estadoFiltro === est
                      ? 'bg-stone-900 text-white'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                  }`}
                >
                  {est.replace('_', ' ')}
                </button>
              )
            )}
          </div>

          {/* Filtro combinado: Zona */}
          <div className="md:col-span-3 flex items-center gap-2">
            <span className="text-[11px] font-bold text-stone-500 shrink-0">Zona:</span>
            <select
              value={zonaFiltro}
              onChange={(e) => setZonaFiltro(e.target.value)}
              className="w-full py-1.5 px-2 bg-stone-50 border border-stone-300 rounded-lg text-xs font-medium focus:ring-1 focus:ring-stone-400"
            >
              <option value="todas">Todas las zonas ({zonasDisponibles.length})</option>
              {zonasDisponibles.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Barra de estado y leyenda */}
        <div className="pt-2 border-t border-stone-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-stone-600">
          <div className="font-semibold">
            Mostrando: <b className="text-stone-900">{totalVisible}</b> de {medidores.length} medidores
            {(estadoFiltro !== 'todos' || zonaFiltro !== 'todas' || search) && (
              <button
                type="button"
                onClick={() => {
                  setEstadoFiltro('todos');
                  setZonaFiltro('todas');
                  setSearch('');
                }}
                className="ml-2 text-blue-600 hover:underline font-bold"
              >
                (Limpiar filtros)
              </button>
            )}
          </div>

          {/* Leyenda con colores institucionales */}
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Activo
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span> Moroso
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-orange-600"></span> Pend. Corte
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600"></span> Cortado
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-stone-500"></span> Retirado
            </span>
          </div>
        </div>
      </div>

      {/* Contenedor del Mapa Leaflet */}
      <div
        className={`relative w-full h-[620px] rounded-2xl overflow-hidden border-2 shadow-xs bg-stone-100 ${
          isPlacementMode ? 'cursor-crosshair border-blue-500 ring-2 ring-blue-300' : 'border-stone-200'
        }`}
      >
        <div ref={mapContainerRef} className="w-full h-full z-0" />

        {/* Guía en pantalla durante modo de colocación */}
        {isPlacementMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-stone-900/90 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-lg backdrop-blur-xs flex items-center gap-2 pointer-events-none">
            <Crosshair className="w-4 h-4 text-blue-400 animate-spin" />
            Haga clic en la posición exacta del terreno para fijar el medidor
          </div>
        )}
      </div>

      {/* MODAL: Crear Medidor desde Mapa (Requiere Cliente Existente) */}
      {showAddModal && clickedLatLng && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div>
                <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-blue-600" />
                  Instalar Nuevo Medidor en Terreno
                </h3>
                <p className="text-xs text-stone-500">
                  Ubicación fijada por geolocalización en el mapa
                </p>
              </div>
              <button
                type="button"
                disabled={guardando}
                onClick={handleCancelarModoUbicacion}
                className="text-stone-400 hover:text-stone-600 disabled:opacity-40"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorModal && (
              <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-xs text-red-800 font-semibold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorModal}</span>
              </div>
            )}

            <form noValidate onSubmit={handleGuardarNuevoMedidor} className="space-y-4">
              {/* Coordenadas GPS fijadas desde el mapa */}
              <div className="p-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs grid grid-cols-2 gap-2 text-stone-600">
                <div>
                  <span className="font-semibold block text-[10px] uppercase text-stone-400">Latitud</span>
                  <span className="font-mono text-stone-800">{clickedLatLng.lat.toFixed(6)}</span>
                </div>
                <div>
                  <span className="font-semibold block text-[10px] uppercase text-stone-400">Longitud</span>
                  <span className="font-mono text-stone-800">{clickedLatLng.lng.toFixed(6)}</span>
                </div>
              </div>

              {/* Cliente Existente Obligatorio */}
              <div>
                <label className="block text-xs font-bold text-stone-700 mb-1">
                  Cliente Titular * <span className="font-normal text-stone-500">(Debe existir previamente)</span>
                </label>
                <input
                  type="text"
                  value={clienteSearchQuery}
                  onChange={(e) => setClienteSearchQuery(e.target.value)}
                  placeholder="Filtrar por nombre o CI/RUC..."
                  className="w-full p-2 bg-stone-50 border border-stone-300 rounded-lg text-xs mb-1.5 focus:bg-white"
                />
                <select
                  value={nuevoClienteId}
                  onChange={(e) => setNuevoClienteId(e.target.value)}
                  required
                  className="w-full p-2 bg-stone-50 border border-stone-300 rounded-lg text-xs font-medium focus:bg-white"
                >
                  <option value="">-- Seleccione un cliente titular existente --</option>
                  {clientesFiltrados.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre_completo} (Doc: {c.documento})
                    </option>
                  ))}
                </select>
                {!nuevoClienteId && (
                  <p className="text-[11px] text-amber-700 mt-1 font-medium">
                    ⚠️ Obligatorio: Todo medidor debe pertenecer a un cliente registrado en la aguatería.
                  </p>
                )}
              </div>

              {/* Número de Medidor con Validación Estricta */}
              <div>
                <label className="block text-xs font-bold text-stone-700 mb-1">
                  Número de Medidor (1..1000) *
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={nuevoNumero}
                  onChange={(e) => setNuevoNumero(e.target.value)}
                  placeholder="Ej: 85"
                  required
                  className="w-full p-2 bg-stone-50 border border-stone-300 rounded-lg text-xs font-mono font-bold focus:bg-white"
                />
                <p className="text-[11px] text-stone-500 mt-1">
                  Entero único entre 1 y 1.000. Sin ceros a la izquierda ni duplicados.
                </p>
              </div>

              {/* Dirección del Terreno */}
              <div>
                <label className="block text-xs font-bold text-stone-700 mb-1">
                  Dirección del Terreno / Lote *
                </label>
                <input
                  type="text"
                  value={nuevaDireccion}
                  onChange={(e) => setNuevaDireccion(e.target.value)}
                  placeholder="Ej: Calle San Martín casi Curupayty - Lote 14"
                  required
                  className="w-full p-2 bg-stone-50 border border-stone-300 rounded-lg text-xs focus:bg-white"
                />
              </div>

              {/* Zona */}
              <div>
                <label className="block text-xs font-bold text-stone-700 mb-1">Zona</label>
                <select
                  value={nuevaZona}
                  onChange={(e) => setNuevaZona(e.target.value)}
                  className="w-full p-2 bg-stone-50 border border-stone-300 rounded-lg text-xs focus:bg-white"
                >
                  {ZONAS_AGUATERIA_SECTOR.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-200">
                <button
                  type="button"
                  disabled={guardando}
                  onClick={handleCancelarModoUbicacion}
                  className="px-4 py-2 border border-stone-300 text-stone-700 font-bold text-xs rounded-xl hover:bg-stone-50 disabled:opacity-40"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardando || !nuevoClienteId || !nuevoNumero}
                  className="px-4 py-2 bg-blue-600 text-white font-bold text-xs rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-all shadow-xs flex items-center gap-1.5"
                >
                  {guardando ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <MapPin className="w-4 h-4" />
                  )}
                  <span>{guardando ? 'Guardando...' : 'Guardar y Ubicar Medidor'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
