/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db } from './database';
import {
  esBufferPdfValido,
  generarBoletaPDF,
  generarContratoPDF,
  pdfDocToValidBlob,
  sanitizarNombreArchivoPdf,
} from './pdfService';

/**
 * Servicio de consumo y descarga segura de PDFs:
 * 1. Si los datos completos de la boleta/contrato ya están cargados en el cliente, genera el PDF
 *    directamente en ArrayBuffer binario con el diseño vigente, verificando firma `%PDF-` y cierre `%%EOF`
 *    (evita descargar HTML del SPA fallback o versiones desactualizadas de Edge Functions).
 * 2. Para consultas remotas (`/facturas/:id/pdf` o Supabase Edge Function), valida estrictamente
 *    que la respuesta NO sea `text/html`/`application/json` y que los bytes comiencen con `%PDF-`.
 * 3. Normaliza siempre a `Blob` con tipo `application/pdf` y nombre sanitizado para PC.
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
    console.debug('Sync background status:', err);
  }
}

/**
 * Extrae y valida un Blob binario `application/pdf` desde una respuesta HTTP.
 * Rechaza respuestas `200 OK` que contengan HTML (SPA index.html), JSON o texto plano.
 */
export async function extraerBlobPdfDeResponse(res: Response): Promise<Blob | null> {
  if (!res.ok) return null;

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (
    contentType.includes('text/html') ||
    contentType.includes('application/json') ||
    contentType.includes('text/plain')
  ) {
    return null;
  }

  const arrayBuffer = await res.arrayBuffer();
  if (!esBufferPdfValido(arrayBuffer)) {
    return null;
  }

  return new Blob([arrayBuffer], { type: 'application/pdf' });
}

function dispararDescargaBlobPdf(blob: Blob, nombreArchivo: string): void {
  const safeName = sanitizarNombreArchivoPdf(nombreArchivo);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = safeName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => window.URL.revokeObjectURL(url), 15000);
}

/**
 * Obtiene el Blob binario `application/pdf` verificado para una boleta.
 */
export async function obtenerBlobBoleta(
  facturaId: string,
  options?: {
    fetchImpl?: typeof fetch;
    localLookup?: typeof db.getFacturaPorId;
    supabaseUrl?: string;
    supabaseAnonKey?: string;
  }
): Promise<Blob> {
  const localLookup = options?.localLookup ?? ((id: string) => db.getFacturaPorId(id));
  const fetchFn = options?.fetchImpl ?? fetch;
  const sbUrl = options?.supabaseUrl ?? SUPABASE_URL;
  const sbAnon = options?.supabaseAnonKey ?? SUPABASE_ANON_KEY;

  // 1. Generación binaria directa si la boleta ya está en memoria (diseño 100% actualizado y libre de HTML SPA)
  const facData = localLookup(facturaId);
  if (facData) {
    const doc = generarBoletaPDF(facData);
    return pdfDocToValidBlob(doc);
  }

  // 2. Endpoint Express local (`/facturas/:id/pdf`) con validación estricta %PDF-
  try {
    const res = await fetchFn(`/facturas/${encodeURIComponent(facturaId)}/pdf`);
    const validBlob = await extraerBlobPdfDeResponse(res);
    if (validBlob) {
      return validBlob;
    }
  } catch (e) {
    console.warn('Endpoint Express local no disponible para boleta:', e);
  }

  // 3. Supabase Edge Function con validación estricta %PDF-
  if (sbUrl) {
    try {
      const edgeUrl = `${sbUrl}/functions/v1/factura-pdf?id=${encodeURIComponent(facturaId)}`;
      const res = await fetchFn(edgeUrl, {
        headers: sbAnon ? { Authorization: `Bearer ${sbAnon}` } : {},
      });
      const validBlob = await extraerBlobPdfDeResponse(res);
      if (validBlob) {
        return validBlob;
      }
    } catch (e) {
      console.warn('Supabase Edge Function no alcanzó un PDF válido:', e);
    }
  }

  throw new Error('No se pudo generar un archivo PDF válido para la boleta. Intentá de nuevo.');
}

/**
 * Obtiene el Blob binario `application/pdf` verificado para un contrato.
 */
export async function obtenerBlobContrato(
  clienteId: string,
  options?: {
    fetchImpl?: typeof fetch;
    localLookup?: typeof db.getClienteContratoParaPdf;
    supabaseUrl?: string;
    supabaseAnonKey?: string;
  }
): Promise<Blob> {
  const localLookup = options?.localLookup ?? ((id: string) => db.getClienteContratoParaPdf(id));
  const fetchFn = options?.fetchImpl ?? fetch;
  const sbUrl = options?.supabaseUrl ?? SUPABASE_URL;
  const sbAnon = options?.supabaseAnonKey ?? SUPABASE_ANON_KEY;

  // 1. Generación binaria directa si los datos están en memoria
  const cliData = localLookup(clienteId);
  if (cliData) {
    const doc = generarContratoPDF(cliData);
    return pdfDocToValidBlob(doc);
  }

  // 2. Endpoint Express local con validación estricta %PDF-
  try {
    const res = await fetchFn(`/clientes/${encodeURIComponent(clienteId)}/contrato/pdf`);
    const validBlob = await extraerBlobPdfDeResponse(res);
    if (validBlob) {
      return validBlob;
    }
  } catch (e) {
    console.warn('Endpoint Express local no disponible para contrato:', e);
  }

  // 3. Supabase Edge Function con validación estricta %PDF-
  if (sbUrl) {
    try {
      const edgeUrl = `${sbUrl}/functions/v1/contrato-pdf?id=${encodeURIComponent(clienteId)}`;
      const res = await fetchFn(edgeUrl, {
        headers: sbAnon ? { Authorization: `Bearer ${sbAnon}` } : {},
      });
      const validBlob = await extraerBlobPdfDeResponse(res);
      if (validBlob) {
        return validBlob;
      }
    } catch (e) {
      console.warn('Supabase Edge Function no alcanzó un PDF válido para contrato:', e);
    }
  }

  throw new Error('No se pudo generar un archivo PDF válido para el contrato. Intentá de nuevo.');
}

/**
 * Solicita y descarga la boleta en el navegador asegurando codificación binaria PDF válida
 */
export async function descargarBoletaServer(
  facturaId: string,
  nombreArchivo?: string
): Promise<void> {
  const blob = await obtenerBlobBoleta(facturaId);
  dispararDescargaBlobPdf(blob, nombreArchivo || `Boleta_${facturaId}.pdf`);
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
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
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
  dispararDescargaBlobPdf(blob, nombreArchivo || `Contrato_Cliente_${clienteId}.pdf`);
}
