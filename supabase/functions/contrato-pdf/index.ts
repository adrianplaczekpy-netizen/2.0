/**
 * Supabase Edge Function: contrato-pdf
 * Genera el PDF del contrato de servicio en el entorno serverless Deno de Supabase.
 * Despliegue: supabase functions deploy contrato-pdf
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
    const clienteId = url.searchParams.get("id") || url.pathname.split("/").pop();

    if (!clienteId) {
      return new Response(JSON.stringify({ error: "Parámetro 'id' requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: cliente, error: errCli } = await supabase
      .from("clientes")
      .select("*, contratos(*), medidores(*)")
      .or(`id.eq.${clienteId},documento.eq.${clienteId}`)
      .single();

    if (errCli || !cliente) {
      return new Response(JSON.stringify({ error: `Cliente ${clienteId} no encontrado` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: tarifaVigente } = await supabase
      .from("tarifas")
      .select("timbrado, timbrado_inicio_vigencia, timbrado_fin_vigencia")
      .order("vigente_desde", { ascending: false })
      .order("fecha_creacion", { ascending: false })
      .limit(1)
      .maybeSingle();

    const timbradoActual = String(tarifaVigente?.timbrado || "").trim() || "19148339";
    const inicioVigActual = String(tarifaVigente?.timbrado_inicio_vigencia || "").trim() || "01/10/2026";
    const finVigActual = String(tarifaVigente?.timbrado_fin_vigencia || "").trim() || "31/10/2027";

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = 210;
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;
    let y = 14;

    const logoW = 42;
    const logoH = Number((logoW / LOGO_ASPECT_RATIO).toFixed(2));
    doc.addImage(LOGO_PNG_DATA_URL, "PNG", margin, y, logoW, logoH);

    const xLeg = margin + logoW + 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text(`RUC: 3950638-0 — TIMBRADO N°: ${timbradoActual}`, xLeg, y + 3.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Inicio Vigencia: ${inicioVigActual} • Fin Vigencia: ${finVigActual}`, xLeg, y + 7.8);
    doc.text("Fracción San Gabriel • Mboi'y - Itauguá — Regulado por ERSSAN", xLeg, y + 12.1);

    y += logoH + 4;
    doc.setLineWidth(0.4);
    doc.line(margin, y, pageWidth - margin, y);
    y += 7;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("CONTRATO DE PRESTACIÓN DE SERVICIO DE AGUA POTABLE", pageWidth / 2, y, { align: "center" });
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const fecha = cliente.fecha_alta || new Date().toISOString().split("T")[0];
    doc.text(`Fecha de Emisión: ${fecha} • Contrato N°: CON-${cliente.documento}`, pageWidth / 2, y, { align: "center" });

    y += 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("1. PARTES INTERVINIENTES", margin, y);
    y += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const line1 = doc.splitTextToSize("PRESTADOR: SERVICIO DE AGUA POTABLE - POZO ARTESIANO SAN GABRIEL (de LEO PLACZEK e HIJA), con RUC 3950638-0, ubicado en Fracción San Gabriel, Mboi'y - Itauguá, Paraguay.", contentWidth);
    doc.text(line1, margin, y);
    y += line1.length * 4.2 + 2;

    const line2 = doc.splitTextToSize(`USUARIO: ${cliente.nombre_completo}, C.I. N° ${cliente.documento}, domicilio en ${cliente.direccion}, Tel: ${cliente.telefono || "--"}, Email: ${cliente.email || "--"}.`, contentWidth);
    doc.text(line2, margin, y);
    y += line2.length * 4.2 + 4;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("2. OBJETO DEL CONTRATO", margin, y);
    y += 4.5;
    const med = (cliente.medidores || [])[0];
    const line3 = doc.splitTextToSize(`Prestación continua del servicio de agua potable en el medidor N° ${med?.numero_medidor || "a ser asignado"} ubicado en ${med?.direccion || cliente.direccion}, bajo normas ERSSAN.`, contentWidth);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(line3, margin, y);
    y += line3.length * 4.2 + 4;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("3. CONDICIONES TARIFARIAS VIGENTES (ERSSAN)", margin, y);
    y += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const clausulas = [
      "• Consumo mínimo: 36.000 Gs. por hasta 9 m³ mensuales.",
      "• Precio m³ excedente: 4.000 Gs. por cada metro cúbico sobre el mínimo.",
      "• Recargo por mora: 3.000 Gs. fijo por boleta vencida impaga (no es porcentaje).",
      "• Vencimiento de boletas: Último día del mes (1ra y 2da boleta); día 11 (3ra boleta).",
      "• Corte de servicio: 3 boletas vencidas impagas tras el día 11. Mora congelada en el corte.",
      "• Tasa de reconexión: 60.000 Gs. más regularización de deuda acumulada.",
      "• Canon ERSSAN: 2% sobre los conceptos facturados.",
    ];
    for (const c of clausulas) {
      doc.text(c, margin, y);
      y += 4.5;
    }

    y += 18;
    doc.text(`Lugar y Fecha: Mboi'y, Itauguá, Paraguay — ${fecha}`, margin, y);
    y += 24;

    const anchoFirma = 65;
    doc.setLineWidth(0.3);
    doc.line(margin + 5, y, margin + 5 + anchoFirma, y);
    doc.line(pageWidth - margin - anchoFirma - 5, y, pageWidth - margin - 5, y);
    y += 4.5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("POR EL PRESTADOR", margin + 5 + anchoFirma / 2, y, { align: "center" });
    doc.text("POR EL USUARIO", pageWidth - margin - anchoFirma / 2 - 5, y, { align: "center" });

    const pdfBuffer = doc.output("arraybuffer");
    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Contrato_${cliente.documento}.pdf"`,
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Error interno generando contrato" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
