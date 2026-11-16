/**
 * Supabase Edge Function: factura-pdf
 * Genera el PDF de la boleta oficial en el entorno serverless Deno de Supabase.
 * Despliegue: supabase functions deploy factura-pdf
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
import { jsPDF } from "https://esm.sh/jspdf@4.2.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const facturaId = url.searchParams.get("id") || url.pathname.split("/").pop();

    if (!facturaId) {
      return new Response(JSON.stringify({ error: "Parámetro 'id' requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cliente Supabase conectado a la base de producción
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Obtener factura, cliente y medidor desde Supabase
    const { data: factura, error: errFac } = await supabase
      .from("facturas")
      .select("*, medidor:medidores(*), cliente:clientes(*), detalles:detalle_factura(*)")
      .eq("id", facturaId)
      .single();

    if (errFac || !factura) {
      return new Response(JSON.stringify({ error: `Factura ${facturaId} no encontrada` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generar PDF usando jsPDF en Deno
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = 210;
    const margin = 18;
    const contentWidth = pageWidth - margin * 2;
    let y = 18;

    if (factura.estado === "pagada") {
      doc.setTextColor(225, 225, 225);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(55);
      doc.text("PAGADA", pageWidth / 2, 130, { align: "center", angle: 30 });
      doc.setTextColor(0, 0, 0);
    }

    // Encabezado
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("AGUATERÍA POTABLE PARAGUAY S.A.", margin, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text("RUC: 80045921-3 — Ente Regulador: ERSSAN (Ley N° 1614/2000)", margin, y + 4.5);
    doc.text("San Lorenzo - Gran Asunción, Paraguay — Tel: (021) 580-000", margin, y + 8.5);

    // Identificador
    const identificador = `Boleta N° ${factura.numero_boleta_medidor || 1}-${factura.periodo_facturado}`;
    doc.setLineWidth(0.3);
    doc.rect(pageWidth - margin - 65, y - 4, 65, 17);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text(identificador, pageWidth - margin - 61, y + 2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Emisión: ${factura.fecha_emision}`, pageWidth - margin - 61, y + 6.5);
    doc.text(`Período: ${factura.periodo_facturado}`, pageWidth - margin - 61, y + 10.5);

    y += 20;
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    // Datos Cliente & Medidor
    const cliente = factura.cliente || {};
    const medidor = factura.medidor || {};
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("DATOS DEL CLIENTE", margin, y);
    doc.text("DATOS DEL SUMINISTRO / MEDIDOR", margin + 95, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(`Cliente: ${cliente.nombre_completo || "Cliente"}`, margin, y);
    doc.text(`N° Medidor: ${medidor.numero_medidor || "--"}`, margin + 95, y);
    y += 4.5;
    doc.text(`Documento (C.I. / RUC): ${cliente.documento || "--"}`, margin, y);
    doc.text(`Zona: ${medidor.zona || "General"}`, margin + 95, y);
    y += 4.5;
    doc.text(`Dirección del terreno: ${medidor.direccion || cliente.direccion || ""}`, margin, y, { maxWidth: 90 });
    doc.text(`Período facturado: ${factura.periodo_facturado}`, margin + 95, y);
    y += 4.5;
    doc.setFont("helvetica", "bold");
    doc.text(`Fecha de vencimiento: ${factura.fecha_vencimiento}`, margin + 95, y);

    y += 7;
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    // Avisos en Rojo
    if (factura.es_tercera_boleta) {
      doc.setDrawColor(220, 38, 38);
      doc.setLineWidth(0.6);
      doc.rect(margin, y, contentWidth, 13);
      doc.setTextColor(220, 38, 38);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.text(`DESCONEXIÓN: ${factura.fecha_vencimiento}`, margin + 4, y + 4.8);
      doc.setFontSize(8);
      doc.text("Si no abona antes de esta fecha, se procederá al retiro del medidor.", margin + 4, y + 9);
      doc.setTextColor(0, 0, 0);
      y += 16;
    }

    if (factura.alerta_consumo_elevado) {
      doc.setDrawColor(220, 38, 38);
      doc.setLineWidth(0.6);
      doc.rect(margin, y, contentWidth, 13);
      doc.setTextColor(220, 38, 38);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.text("CONSUMO ELEVADO", margin + 4, y + 4.8);
      doc.setFontSize(8);
      doc.text("Su consumo de este mes es superior al habitual. Puede deberse a una pérdida en su propiedad. Por favor verifique.", margin + 4, y + 9);
      doc.setTextColor(0, 0, 0);
      y += 16;
    }

    // Detalle de conceptos
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("DETALLE DE CONCEPTOS", margin, y);
    y += 4;
    doc.setFillColor(245, 245, 245);
    doc.rect(margin, y, contentWidth, 6, "FD");
    doc.setFontSize(8);
    doc.text("CONCEPTO", margin + 3, y + 4.2);
    doc.text("MONTO", pageWidth - margin - 3, y + 4.2, { align: "right" });
    y += 8;

    const detalles = (factura.detalles || []).filter((d: any) => d.monto > 0 && d.concepto !== "erssan");
    const detErssan = (factura.detalles || []).find((d: any) => d.concepto === "erssan" && d.monto > 0);

    doc.setFontSize(8.5);
    let subtotal = 0;
    for (const d of detalles) {
      subtotal += d.monto;
      doc.setFont("helvetica", "normal");
      doc.text(d.descripcion, margin + 3, y);
      doc.setFont("helvetica", "bold");
      doc.text(`${Math.round(d.monto).toLocaleString("es-PY")} Gs.`, pageWidth - margin - 3, y, { align: "right" });
      y += 5;
    }

    y += 1;
    doc.line(margin, y, pageWidth - margin, y);
    y += 4.5;
    doc.text("Subtotal:", margin + 3, y);
    doc.text(`${Math.round(subtotal).toLocaleString("es-PY")} Gs.`, pageWidth - margin - 3, y, { align: "right" });
    y += 5;

    const montoErssan = detErssan ? detErssan.monto : Math.round(subtotal * 0.02);
    if (montoErssan > 0) {
      doc.setFont("helvetica", "normal");
      doc.text("Aporte ERSSAN (2%):", margin + 3, y);
      doc.setFont("helvetica", "bold");
      doc.text(`${Math.round(montoErssan).toLocaleString("es-PY")} Gs.`, pageWidth - margin - 3, y, { align: "right" });
      y += 5.5;
    }

    doc.setLineWidth(0.4);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5.5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("TOTAL A PAGAR:", margin + 3, y);
    doc.setFontSize(13);
    doc.text(`${Math.round(factura.total).toLocaleString("es-PY")} Gs.`, pageWidth - margin - 3, y, { align: "right" });

    const pdfBuffer = doc.output("arraybuffer");
    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Boleta_${factura.numero_boleta_medidor || 1}_${factura.periodo_facturado}.pdf"`,
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Error interno generando PDF" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
