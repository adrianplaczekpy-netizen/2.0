/**
 * Supabase Edge Function: crear-usuario
 * Crea un nuevo usuario operativo en auth.users usando SUPABASE_SERVICE_ROLE_KEY.
 * Solo accesible para usuarios autenticados con rol 'admin' (validado vía public.is_admin()).
 * Despliegue: supabase functions deploy crear-usuario
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROLES_VALIDOS = new Set(["admin", "cobrador", "lectura"]);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido. Utilice POST." }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "No autorizado: falta el token de sesión." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return jsonResponse(
        { error: "Configuración incompleta de variables de entorno en Supabase." },
        500
      );
    }

    // 1. Verificar JWT del solicitante y validar is_admin()
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const {
      data: { user: callerUser },
      error: callerErr,
    } = await supabaseUser.auth.getUser();

    if (callerErr || !callerUser) {
      return jsonResponse({ error: "Sesión inválida o expirada." }, 401);
    }

    const { data: isAdmin, error: adminErr } = await supabaseUser.rpc("is_admin");
    if (adminErr || isAdmin !== true) {
      return jsonResponse(
        { error: "Acceso denegado: solo los administradores pueden crear usuarios." },
        403
      );
    }

    // 2. Validar payload
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonResponse({ error: "Cuerpo JSON inválido." }, 400);
    }

    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const nombreCompleto = String(body.nombre_completo ?? "").trim();
    const rol = String(body.rol ?? "").trim();

    if (!EMAIL_REGEX.test(email)) {
      return jsonResponse({ error: "Ingresá un correo electrónico válido." }, 400);
    }
    if (password.length < 8) {
      return jsonResponse(
        { error: "La contraseña inicial debe tener al menos 8 caracteres." },
        400
      );
    }
    if (nombreCompleto.length < 2) {
      return jsonResponse(
        { error: "El nombre completo debe tener al menos 2 caracteres." },
        400
      );
    }
    if (!ROLES_VALIDOS.has(rol)) {
      return jsonResponse(
        { error: "Rol inválido. Debe ser 'admin', 'cobrador' o 'lectura'." },
        400
      );
    }

    // 3. Crear usuario en auth.users con Service Role (dispara handle_new_user)
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: createdData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre_completo: nombreCompleto },
      app_metadata: { rol },
    });

    if (createErr || !createdData?.user) {
      const msgLower = (createErr?.message || "").toLowerCase();
      if (
        msgLower.includes("already been registered") ||
        msgLower.includes("already exists") ||
        msgLower.includes("email_exists") ||
        msgLower.includes("duplicate")
      ) {
        return jsonResponse(
          { error: 'Ya existe un usuario registrado con el correo "' + email + '".' },
          400
        );
      }
      return jsonResponse(
        { error: createErr?.message || "No se pudo crear el usuario en Auth." },
        400
      );
    }

    const newUserId = createdData.user.id;

    // 4. Verificar/consultar perfil creado por el trigger handle_new_user en public.usuarios y public.user_roles
    const [{ data: perfil }, { data: rolRow }] = await Promise.all([
      supabaseAdmin
        .from("usuarios")
        .select("id, email, nombre_completo, activo, fecha_creacion")
        .eq("id", newUserId)
        .maybeSingle(),
      supabaseAdmin
        .from("user_roles")
        .select("rol")
        .eq("user_id", newUserId)
        .maybeSingle(),
    ]);

    return jsonResponse(
      {
        usuario: {
          id: newUserId,
          email: perfil?.email ?? email,
          nombre_completo: perfil?.nombre_completo ?? nombreCompleto,
          rol: rolRow?.rol ?? rol,
          activo: perfil?.activo ?? true,
          fecha_creacion: perfil?.fecha_creacion ?? createdData.user.created_at,
        },
      },
      200
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error inesperado al crear usuario.";
    return jsonResponse({ error: msg }, 500);
  }
});
