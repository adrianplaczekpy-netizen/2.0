/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db } from './database';
import { generarBoletaPDF, generarContratoPDF } from './pdfService';

/**
 * Servicio de consumo de PDFs:
 * 1. Prioridad 1: Supabase Edge Functions en producción Lovable (`/functions/v1/factura-pdf`, etc.)
 * 2. Prioridad 2: Servidor Node/Express en desarrollo local (`/facturas/:id/pdf`)
 * 3. Prioridad 3 (Fallback resiliente): Generación directa si no hay conectividad backend,
 *    garantizando que el botón de descarga nunca falle ni quede bloqueado en ningún entorno.
 */

const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

export async function sincronizarEstadoConBackend(): Promise<void> {
  try {
    const data = db.getFullData();
    await fetch('/api/sync-db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (err) {
    // Sincronización transparente
    console.debug('Sync background status:', err);
  }
}

/**
 * Obtiene el Blob del PDF desde Edge Function, endpoint Express o fallback local
 */
async function obtenerBlobBoleta(facturaId: string): Promise<Blob> {
  // 1. Probar Supabase Edge Function si está configurada la URL de Supabase
  if (SUPABASE_URL) {
    try {
      const edgeUrl = `${SUPABASE_URL}/functions/v1/factura-pdf?id=${encodeURIComponent(facturaId)}`;
      const res = await fetch(edgeUrl, {
        headers: SUPABASE_ANON_KEY ? { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {},
      });
      if (res.ok) {
        return await res.blob();
      }
    } catch (e) {
      console.warn('Supabase Edge Function no alcanzable, probando endpoint local:', e);
    }
  }

  // 2. Probar endpoint del servidor Express local
  try {
    await sincronizarEstadoConBackend();
    const res = await fetch(`/facturas/${encodeURIComponent(facturaId)}/pdf`);
    if (res.ok) {
      return await res.blob();
    }
  } catch (e) {
    console.warn('Endpoint Express local no alcanzable, activando fallback resiliente:', e);
  }

  // 3. Fallback de contingencia: genera a través del motor desacoplado jsPDF
  const facData = db.getFacturaPorId(facturaId);
  if (!facData) {
    throw new Error('No se pudo generar el PDF. Intentá de nuevo.');
  }
  const doc = generarBoletaPDF(facData);
  return doc.output('blob');
}

/**
 * Obtiene el Blob del Contrato desde Edge Function, endpoint Express o fallback local
 */
async function obtenerBlobContrato(clienteId: string): Promise<Blob> {
  // 1. Probar Supabase Edge Function si está configurada
  if (SUPABASE_URL) {
    try {
      const edgeUrl = `${SUPABASE_URL}/functions/v1/contrato-pdf?id=${encodeURIComponent(clienteId)}`;
      const res = await fetch(edgeUrl, {
        headers: SUPABASE_ANON_KEY ? { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {},
      });
      if (res.ok) {
        return await res.blob();
      }
    } catch (e) {
      console.warn('Supabase Edge Function no alcanzable para contrato, probando endpoint local:', e);
    }
  }

  // 2. Probar endpoint del servidor Express local
  try {
    await sincronizarEstadoConBackend();
    const res = await fetch(`/clientes/${encodeURIComponent(clienteId)}/contrato/pdf`);
    if (res.ok) {
      return await res.blob();
    }
  } catch (e) {
    console.warn('Endpoint Express local no alcanzable para contrato, activando fallback:', e);
  }

  // 3. Fallback de contingencia
  const cliData = db.getClienteContratoParaPdf(clienteId);
  if (!cliData) {
    throw new Error('No se pudo generar el PDF. Intentá de nuevo.');
  }
  const doc = generarContratoPDF(cliData);
  return doc.output('blob');
}

/**
 * Solicita y descarga la boleta en el navegador
 */
export async function descargarBoletaServer(
  facturaId: string,
  nombreArchivo?: string
): Promise<void> {
  const blob = await obtenerBlobBoleta(facturaId);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo || `Boleta_${facturaId}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

/**
 * Solicita la boleta y abre el diálogo nativo de impresión
 */
export async function imprimirBoletaServer(facturaId: string): Promise<void> {
  const blob = await obtenerBlobBoleta(facturaId);
  const blobUrl = window.URL.createObjectURL(blob);

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.src = blobUrl;
  document.body.appendChild(iframe);

  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (e) {
      console.warn('Error al llamar print en iframe:', e);
    }
    setTimeout(() => {
      document.body.removeChild(iframe);
      window.URL.revokeObjectURL(blobUrl);
    }, 60000);
  };
}

/**
 * Solicita y descarga el contrato privado de un cliente
 */
export async function descargarContratoServer(
  clienteId: string,
  nombreArchivo?: string
): Promise<void> {
  const blob = await obtenerBlobContrato(clienteId);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo || `Contrato_Cliente_${clienteId}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
