/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import { db } from './src/services/database.js';
import {
  generarBoletaPDF,
  generarContratoPDF,
  sanitizarNombreArchivoPdf,
} from './src/services/pdfService.js';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '15mb' }));

// Sincronización de estado desde el frontend (opcional pero asegura paridad total con localStorage)
app.post('/api/sync-db', (req, res) => {
  try {
    if (req.body && typeof req.body === 'object') {
      db.importFullData(req.body);
      return res.json({
        success: true,
        totalFacturas: db.getFullData().facturas.length,
        totalClientes: db.getFullData().clientes.length,
      });
    }
    return res.status(400).json({ error: 'Payload inválido' });
  } catch (error: any) {
    console.error('Error sincronizando DB:', error);
    return res.status(500).json({ error: error.message || 'Error interno' });
  }
});

// Endpoint Server-Side: GET /facturas/:id/pdf (y /api/facturas/:id/pdf)
const handleFacturaPdf = (req: express.Request, res: express.Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'ID de factura requerido' });
    }

    const data = db.getFacturaPorId(id);
    if (!data) {
      return res.status(404).json({ error: `Factura ${id} no encontrada` });
    }

    const doc = generarBoletaPDF(data);
    const arrayBuffer = doc.output('arraybuffer');
    const buffer = Buffer.from(arrayBuffer);

    const numTag = data.factura.numero_factura || `${data.factura.numero_boleta_medidor || 1}`;
    const filename = sanitizarNombreArchivoPdf(
      `Factura_${numTag}_${data.factura.periodo_facturado}.pdf`
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    res.setHeader('Cache-Control', 'no-store');

    return res.end(buffer);
  } catch (error: any) {
    console.error('Error generando PDF de factura:', error);
    return res.status(500).json({ error: 'No se pudo generar el PDF. Intentá de nuevo.' });
  }
};

app.get('/facturas/:id/pdf', handleFacturaPdf);
app.get('/api/facturas/:id/pdf', handleFacturaPdf);

// Endpoint Server-Side: GET /clientes/:id/contrato/pdf (y /api/clientes/:id/contrato/pdf)
const handleContratoPdf = (req: express.Request, res: express.Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'ID de cliente requerido' });
    }

    const data = db.getClienteContratoParaPdf(id);
    if (!data) {
      return res.status(404).json({ error: `Cliente o contrato no encontrado para ${id}` });
    }

    const doc = generarContratoPDF(data);
    const arrayBuffer = doc.output('arraybuffer');
    const buffer = Buffer.from(arrayBuffer);

    const filename = sanitizarNombreArchivoPdf(`Contrato_${data.cliente.documento}.pdf`);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    res.setHeader('Cache-Control', 'no-store');

    return res.end(buffer);
  } catch (error: any) {
    console.error('Error generando PDF de contrato:', error);
    return res.status(500).json({ error: 'No se pudo generar el PDF. Intentá de nuevo.' });
  }
};

app.get('/clientes/:id/contrato/pdf', handleContratoPdf);
app.get('/api/clientes/:id/contrato/pdf', handleContratoPdf);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    totalFacturas: db.getFullData().facturas.length,
    timestamp: new Date().toISOString(),
  });
});

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static('dist'));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve('dist/index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[AguateríaPY Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
