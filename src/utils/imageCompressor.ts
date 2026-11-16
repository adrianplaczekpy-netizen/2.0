/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Compresión de fotos en el cliente antes de subir.
 * Target: ~300 KB para lecturas y observaciones de medidores.
 */
export async function comprimirFotoLectura(file: File | Blob, targetKb = 300): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        // Limitar dimensiones máximas a 1280px para lecturas de medidor
        const MAX_DIM = 1280;
        if (width > height && width > MAX_DIM) {
          height = Math.round((height * MAX_DIM) / width);
          width = MAX_DIM;
        } else if (height > MAX_DIM) {
          width = Math.round((width * MAX_DIM) / height);
          height = MAX_DIM;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return resolve(event.target?.result as string);
        }

        ctx.drawImage(img, 0, 0, width, height);

        // Estimar calidad inicial
        let quality = 0.75;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);

        // Si supera targetKb, reducir calidad gradualmente
        const getKb = (str: string) => Math.round((str.length * 3) / 4 / 1024);
        if (getKb(dataUrl) > targetKb && quality > 0.4) {
          quality = 0.55;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = event.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Genera un placeholder SVG comprimido para demostración rápida de medidores
 */
export function generarFotoPlaceholder(numeroMedidor: number, lectura: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
    <rect width="600" height="400" fill="#1e293b"/>
    <rect x="50" y="50" width="500" height="300" rx="15" fill="#334155" stroke="#64748b" stroke-width="4"/>
    <circle cx="300" cy="180" r="100" fill="#0f172a" stroke="#0284c7" stroke-width="6"/>
    <rect x="230" y="150" width="140" height="50" fill="#020617" stroke="#38bdf8" stroke-width="2"/>
    <text x="300" y="185" font-family="monospace" font-size="28" font-weight="bold" fill="#38bdf8" text-anchor="middle">${String(lectura).padStart(6, '0')}</text>
    <text x="300" y="225" font-family="sans-serif" font-size="14" fill="#94a3b8" text-anchor="middle">m³</text>
    <text x="300" y="320" font-family="sans-serif" font-size="18" font-weight="bold" fill="#f8fafc" text-anchor="middle">MEDIDOR N° ${numeroMedidor}</text>
    <text x="300" y="340" font-family="sans-serif" font-size="12" fill="#64748b" text-anchor="middle">FOTO CERTIFICADA DE LECTURA</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
