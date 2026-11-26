/**
 * Supabase Edge Function: factura-pdf
 * Genera el PDF de la boleta oficial en el entorno serverless Deno de Supabase.
 * Despliegue: supabase functions deploy factura-pdf
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
import { jsPDF } from "https://esm.sh/jspdf@4.2.1";
import { LOGO_PNG_DATA_URL, LOGO_ASPECT_RATIO } from "./logoData.ts";

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
    let y = 13;

    // Encabezado con Logo + datos legales reales de la empresa
    const logoW = 44;
    const logoH = Number((logoW / LOGO_ASPECT_RATIO).toFixed(2));
    doc.addImage(LOGO_PNG_DATA_URL, "PNG", margin, y, logoW, logoH);

    const xDatosLegales = margin + logoW + 3.5;
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("RUC: 3950638-0", xDatosLegales, y + 2.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text("TIMBRADO N°: 19148339", xDatosLegales, y + 6.3);
    doc.text("Inicio Vigencia: 01/10/2026", xDatosLegales, y + 10.1);
    doc.text("Fin Vigencia: 31/10/2027", xDatosLegales, y + 13.9);

    // Recuadro derecho: Número de Factura SET (001-002-XXXXXXX) + Emisión, Período Facturado y Vencimiento
    const numeroFacturaSET =
      (factura.numero_factura && String(factura.numero_factura).trim()) ||
      `001-002-${String(Math.max(1, Number(factura.numero_boleta_medidor) || 1)).padStart(7, "0")}`;

    const boxW = 74;
    const boxH = 21.5;
    const boxX = pageWidth - margin - boxW;
    const boxY = y - 1;

    doc.setDrawColor(30, 41, 59);
    doc.setLineWidth(0.35);
    doc.rect(boxX, boxY, boxW, boxH);

    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text(`Factura N°: ${numeroFacturaSET}`, boxX + 3.5, boxY + 5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Emisión: ${factura.fecha_emision}`, boxX + 3.5, boxY + 9.8);
    doc.text(`Período Facturado: ${factura.periodo_facturado}`, boxX + 3.5, boxY + 14.1);
    doc.setFont("helvetica", "bold");
    doc.text(`Vencimiento: ${factura.fecha_vencimiento}`, boxX + 3.5, boxY + 18.4);
    doc.setFont("helvetica", "normal");

    y = boxY + boxH + 3.5;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
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

    const baseErssanFallback = subtotal;
    const montoErssan = detErssan ? detErssan.monto : Math.round(baseErssanFallback * 0.02);
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
        "Content-Disposition": `inline; filename="Factura_${numeroFacturaSET}_${factura.periodo_facturado}.pdf"`,
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Error interno generando PDF" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
