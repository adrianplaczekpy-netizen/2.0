/**
 * Supabase Edge Function: actualizar-usuario
 * Actualiza nombre_completo, rol y/o estado activo de un usuario existente.
 * Solo accesible para usuarios autenticados con rol 'admin' (validado vía public.is_admin()).
 * Despliegue: supabase functions deploy actualizar-usuario
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, PATCH, OPTIONS",
};

const ROLES_VALIDOS = new Set(["admin", "cobrador", "lectura"]);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  if (req.method !== "POST" && req.method !== "PATCH") {
    return jsonResponse({ error: "Método no permitido. Utilice POST o PATCH." }, 405);
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

    const jwtToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    // 1. Verificar JWT del solicitante y validar is_admin()
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const {
      data: { user: callerUser },
      error: callerErr,
    } = await supabaseUser.auth.getUser(jwtToken);

    if (callerErr || !callerUser) {
      return jsonResponse({ error: "Sesión inválida o expirada." }, 401);
    }

    const { data: isAdmin, error: adminErr } = await supabaseUser.rpc("is_admin");
    if (adminErr || isAdmin !== true) {
      return jsonResponse(
        { error: "Acceso denegado: solo los administradores pueden modificar usuarios." },
        403
      );
    }

    // 2. Validar payload
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonResponse({ error: "Cuerpo JSON inválido." }, 400);
    }

    const userId = String(body.user_id ?? "").trim();
    if (!UUID_REGEX.test(userId)) {
      return jsonResponse({ error: "El parámetro 'user_id' debe ser un UUID válido." }, 400);
    }

    const tieneNombre = body.nombre_completo !== undefined;
    const tieneRol = body.rol !== undefined;
    const tieneActivo = body.activo !== undefined;

    if (!tieneNombre && !tieneRol && !tieneActivo) {
      return jsonResponse({ error: "No se enviaron campos para actualizar." }, 400);
    }

    const nuevoNombre = tieneNombre ? String(body.nombre_completo).trim() : undefined;
    const nuevoRol = tieneRol ? String(body.rol).trim() : undefined;
    const nuevoActivo = tieneActivo ? Boolean(body.activo) : undefined;

    if (nuevoNombre !== undefined && nuevoNombre.length < 2) {
      return jsonResponse(
        { error: "El nombre completo debe tener al menos 2 caracteres." },
        400
      );
    }

    if (nuevoRol !== undefined && !ROLES_VALIDOS.has(nuevoRol)) {
      return jsonResponse(
        { error: "Rol inválido. Debe ser 'admin', 'cobrador' o 'lectura'." },
        400
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 3. Cargar usuario objetivo + admins activos para reglas de seguridad
    const [{ data: targetUsuario, error: targetErr }, { data: allUsuarios }, { data: allRoles }] =
      await Promise.all([
        supabaseAdmin
          .from("usuarios")
          .select("id, email, nombre_completo, activo, fecha_creacion")
          .eq("id", userId)
          .maybeSingle(),
        supabaseAdmin.from("usuarios").select("id, activo"),
        supabaseAdmin.from("user_roles").select("user_id, rol"),
      ]);

    if (targetErr || !targetUsuario) {
      return jsonResponse({ error: "Usuario no encontrado." }, 404);
    }

    const rolActual =
      allRoles?.find((r: { user_id: string; rol: string }) => r.user_id === userId)?.rol ??
      "lectura";

    // Regla: El admin actual no puede cambiar su propio rol ni auto-desactivarse
    if (userId.toLowerCase() === callerUser.id.toLowerCase()) {
      if (nuevoRol !== undefined && nuevoRol !== rolActual) {
        return jsonResponse(
          { error: "No podés cambiar tu propio rol de administrador." },
          400
        );
      }
      if (nuevoActivo === false) {
        return jsonResponse(
          { error: "No podés desactivar tu propia cuenta." },
          400
        );
      }
    }

    // Regla: No desactivar ni degradar al último administrador activo
    const activosIds = new Set(
      (allUsuarios ?? [])
        .filter((u: { id: string; activo: boolean | null }) => u.activo !== false)
        .map((u: { id: string }) => u.id)
    );
    const adminsActivos = (allRoles ?? []).filter(
      (r: { user_id: string; rol: string }) => r.rol === "admin" && activosIds.has(r.user_id)
    );

    const esAdminActivoObjetivo = rolActual === "admin" && targetUsuario.activo !== false;
    const pierdePrivilegioAdmin =
      nuevoActivo === false || (nuevoRol !== undefined && nuevoRol !== "admin");

    if (esAdminActivoObjetivo && pierdePrivilegioAdmin && adminsActivos.length <= 1) {
      return jsonResponse(
        {
          error:
            "No se puede desactivar ni cambiar el rol del último administrador activo del sistema.",
        },
        400
      );
    }

    // 4. Actualizar public.usuarios
    if (nuevoNombre !== undefined || nuevoActivo !== undefined) {
      const updatePerfil: Record<string, unknown> = {};
      if (nuevoNombre !== undefined) updatePerfil.nombre_completo = nuevoNombre;
      if (nuevoActivo !== undefined) updatePerfil.activo = nuevoActivo;

      const { error: updPerfilErr } = await supabaseAdmin
        .from("usuarios")
        .update(updatePerfil)
        .eq("id", userId);

      if (updPerfilErr) {
        return jsonResponse(
          { error: "Error actualizando perfil de usuario: " + updPerfilErr.message },
          400
        );
      }
    }

    // 5. Actualizar public.user_roles
    if (nuevoRol !== undefined) {
      const { error: updRolErr } = await supabaseAdmin.from("user_roles").upsert(
        {
          user_id: userId,
          rol: nuevoRol,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      if (updRolErr) {
        return jsonResponse(
          { error: "Error actualizando rol en user_roles: " + updRolErr.message },
          400
        );
      }
    }

    // 6. Sincronizar metadata y bloqueo/desbloqueo en auth.users
    const authAttrs: Record<string, unknown> = {};
    if (nuevoNombre !== undefined) {
      authAttrs.user_metadata = { nombre_completo: nuevoNombre };
    }
    if (nuevoRol !== undefined) {
      authAttrs.app_metadata = { rol: nuevoRol };
    }
    if (nuevoActivo !== undefined) {
      authAttrs.ban_duration = nuevoActivo ? "none" : "876000h";
    }

    if (Object.keys(authAttrs).length > 0) {
      const { error: authUpdErr } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        authAttrs
      );
      if (authUpdErr) {
        return jsonResponse(
          { error: "Error sincronizando usuario en Auth: " + authUpdErr.message },
          400
        );
      }
    }

    const [{ data: perfilFinal }, { data: rolFinal }] = await Promise.all([
      supabaseAdmin
        .from("usuarios")
        .select("id, email, nombre_completo, activo, fecha_creacion")
        .eq("id", userId)
        .single(),
      supabaseAdmin
        .from("user_roles")
        .select("rol")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    return jsonResponse(
      {
        usuario: {
          id: perfilFinal.id,
          email: perfilFinal.email,
          nombre_completo: perfilFinal.nombre_completo,
          rol: rolFinal?.rol ?? nuevoRol ?? rolActual,
          activo: perfilFinal.activo !== false,
          fecha_creacion: perfilFinal.fecha_creacion,
        },
      },
      200
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error inesperado al actualizar usuario.";
    return jsonResponse({ error: msg }, 500);
  }
});
