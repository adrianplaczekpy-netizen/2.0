-- =====================================================================
-- AGUATERÍAPY — SCHEMA COMPLETO DE BASE DE DATOS (SUPABASE / POSTGRESQL)
-- Sistema Interno de Gestión de Agua Potable (Paraguay)
-- Conforme a normativas de ERSSAN (Ente Regulador de Servicios Sanitarios)
-- =====================================================================

-- Extensión para generación de UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------
-- 1. TABLA DE PERFILES DE USUARIO
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usuarios (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    nombre_completo TEXT NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- Asegurar que la columna rol quede definitivamente eliminada de usuarios
-- La única fuente de verdad para permisos y roles es public.user_roles
ALTER TABLE public.usuarios DROP COLUMN IF EXISTS rol;

-- ---------------------------------------------------------------------
-- 1.1 TABLA SEGURA DE ROLES DE USUARIO (Separada para evitar escalada de privilegios)
-- Un usuario común NO puede modificar su rol; solo administradores tienen permiso.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    rol VARCHAR(20) NOT NULL CHECK (rol IN ('admin', 'cobrador', 'lectura')),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);

-- Función SECURITY DEFINER para obtener el rol del usuario autenticado sin recursión
-- Si el usuario fue desactivado (activo = FALSE), retorna 'inactivo' y pierde acceso a todas las políticas RLS.
CREATE OR REPLACE FUNCTION public.get_user_rol(user_uuid UUID DEFAULT auth.uid())
RETURNS VARCHAR(20)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rol VARCHAR(20);
    v_activo BOOLEAN;
BEGIN
    SELECT activo INTO v_activo
    FROM public.usuarios
    WHERE id = user_uuid;

    IF v_activo IS FALSE THEN
        RETURN 'inactivo';
    END IF;

    SELECT rol INTO v_rol
    FROM public.user_roles
    WHERE user_id = user_uuid;
    RETURN COALESCE(v_rol, 'lectura');
END;
$$;

-- Función auxiliar para verificar si el usuario es administrador
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN public.get_user_rol(auth.uid()) = 'admin';
END;
$$;

-- ---------------------------------------------------------------------
-- 1.2 TRIGGERS DE SEGURIDAD Y SINCRONIZACIÓN DE USUARIOS
-- ---------------------------------------------------------------------

-- A. Trigger BEFORE UPDATE para proteger campos críticos (activo, email) contra auto-modificación
CREATE OR REPLACE FUNCTION public.proteger_campos_usuario()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.id = auth.uid() AND NOT public.is_admin() THEN
        IF NEW.activo IS DISTINCT FROM OLD.activo THEN
            RAISE EXCEPTION 'Operación denegada: No podés cambiar tu estado activo';
        END IF;
        IF NEW.email IS DISTINCT FROM OLD.email THEN
            RAISE EXCEPTION 'Operación denegada: No podés cambiar tu email directamente';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_campos_usuario ON public.usuarios;
CREATE TRIGGER trg_proteger_campos_usuario
BEFORE UPDATE ON public.usuarios
FOR EACH ROW
EXECUTE FUNCTION public.proteger_campos_usuario();

-- B. Trigger AFTER INSERT en auth.users para auto-crear perfil en usuarios y rol en user_roles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_nombre TEXT;
    v_rol VARCHAR(20);
BEGIN
    -- 1. Extraer nombre completo desde metadata o fallback a la parte local del email
    v_nombre := COALESCE(
        NEW.raw_user_meta_data->>'nombre_completo',
        NEW.raw_user_meta_data->>'nombre',
        SPLIT_PART(NEW.email, '@', 1)
    );

    -- 2. Extraer rol inicial EXCLUSIVAMENTE desde raw_app_meta_data (protegido, solo escribible por backend/service_role)
    -- NUNCA leer rol desde raw_user_meta_data porque el cliente puede manipularlo en signUp
    v_rol := COALESCE(
        NULLIF(NEW.raw_app_meta_data->>'rol', ''),
        'lectura'
    );

    IF v_rol NOT IN ('admin', 'cobrador', 'lectura') THEN
        v_rol := 'lectura';
    END IF;

    -- 3. Crear perfil en public.usuarios con SECURITY DEFINER
    INSERT INTO public.usuarios (id, email, nombre_completo, activo, fecha_creacion)
    VALUES (
        NEW.id,
        NEW.email,
        v_nombre,
        TRUE,
        TIMEZONE('utc', NOW())
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        nombre_completo = COALESCE(NULLIF(EXCLUDED.nombre_completo, ''), public.usuarios.nombre_completo);

    -- 4. Crear registro de rol en public.user_roles con SECURITY DEFINER
    INSERT INTO public.user_roles (user_id, rol, created_at, updated_at)
    VALUES (
        NEW.id,
        v_rol,
        TIMEZONE('utc', NOW()),
        TIMEZONE('utc', NOW())
    )
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------
-- 2. TABLA DE CLIENTES (Titulares)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clientes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre_completo TEXT NOT NULL,
    documento VARCHAR(20) NOT NULL UNIQUE, -- C.I. o RUC (único en el sistema)
    direccion TEXT NOT NULL,
    telefono VARCHAR(30),
    email TEXT,
    fecha_alta DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- ---------------------------------------------------------------------
-- 3. TABLA DE MEDIDORES (Unidades de negocio independientes)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.medidores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
    numero_medidor INTEGER NOT NULL UNIQUE CHECK (numero_medidor >= 1 AND numero_medidor <= 1000),
    direccion TEXT NOT NULL, -- Dirección específica del terreno o inmueble
    zona VARCHAR(50) DEFAULT 'Centro',
    latitud NUMERIC(10, 7) NOT NULL,
    longitud NUMERIC(10, 7) NOT NULL,
    fecha_instalacion DATE NOT NULL DEFAULT CURRENT_DATE,
    estado VARCHAR(20) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'moroso', 'pendiente_corte', 'cortado', 'retirado')),
    fecha_corte DATE,
    mora_congelada INTEGER DEFAULT 0, -- Se congela al pasar a cortado
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- ---------------------------------------------------------------------
-- 4. TABLA DE CONTRATOS PRIVADOS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contratos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    fecha_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_fin DATE,
    condiciones TEXT NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'finalizado')),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- ---------------------------------------------------------------------
-- 5. TABLA DE LECTURAS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lecturas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    medidor_id UUID NOT NULL REFERENCES public.medidores(id) ON DELETE RESTRICT,
    periodo VARCHAR(7) NOT NULL, -- Formato: YYYY-MM
    fecha_lectura DATE NOT NULL DEFAULT CURRENT_DATE,
    lectura_anterior INTEGER NOT NULL,
    lectura_actual INTEGER NOT NULL,
    consumo_m3 INTEGER NOT NULL,
    foto_medidor_url TEXT NOT NULL, -- Storage de Supabase
    observaciones TEXT, -- Uso interno, NO se imprime en boleta
    foto_observacion_url TEXT,
    estado VARCHAR(20) NOT NULL DEFAULT 'confirmada' CHECK (estado IN ('borrador', 'confirmada')),
    registrado_por UUID REFERENCES public.usuarios(id),
    fecha_registro TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    editado_por UUID REFERENCES public.usuarios(id),
    fecha_edicion TIMESTAMPTZ,
    motivo_edicion TEXT,
    CONSTRAINT chk_lectura_no_negativa CHECK (lectura_actual >= lectura_anterior),
    CONSTRAINT uq_medidor_periodo UNIQUE (medidor_id, periodo)
);

-- ---------------------------------------------------------------------
-- 6. TABLA DE CONFIGURACIÓN DE TARIFAS (Histórico con vigencia)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tarifas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    precio_m3 INTEGER NOT NULL DEFAULT 4000,
    consumo_minimo_m3 INTEGER NOT NULL DEFAULT 9,
    monto_minimo_consumo INTEGER NOT NULL DEFAULT 36000,
    monto_mora_fijo INTEGER NOT NULL DEFAULT 3000, -- Monto fijo por factura vencida
    monto_reconexion INTEGER NOT NULL DEFAULT 60000,
    erssan_porcentaje NUMERIC(4, 2) NOT NULL DEFAULT 2.00, -- 2% sobre conceptos 1-7
    dia_vencimiento_boletas_normales VARCHAR(20) NOT NULL DEFAULT 'ultimo_dia_mes',
    dia_vencimiento_tercera_boleta INTEGER NOT NULL DEFAULT 11,
    umbral_alerta_consumo NUMERIC(4, 2) NOT NULL DEFAULT 3.00, -- 3x sobre promedio últimos 3 meses
    texto_alerta_consumo TEXT NOT NULL DEFAULT 'CONSUMO ELEVADO — Su consumo de este mes es superior al habitual. Puede deberse a una pérdida en su propiedad. Por favor verifique.',
    max_numero_medidor INTEGER NOT NULL DEFAULT 1000,
    timbrado VARCHAR(30) NOT NULL DEFAULT '19148339',
    timbrado_inicio_vigencia VARCHAR(20) NOT NULL DEFAULT '01/10/2026',
    timbrado_fin_vigencia VARCHAR(20) NOT NULL DEFAULT '31/10/2027',
    vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE,
    creado_por UUID REFERENCES public.usuarios(id),
    fecha_creacion TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    motivo_cambio TEXT,
    cambios_auditados JSONB DEFAULT '[]'::jsonb
);

ALTER TABLE public.tarifas ALTER COLUMN dia_vencimiento_boletas_normales TYPE VARCHAR(20) USING dia_vencimiento_boletas_normales::text;
ALTER TABLE public.tarifas ADD COLUMN IF NOT EXISTS motivo_cambio TEXT;
ALTER TABLE public.tarifas ADD COLUMN IF NOT EXISTS cambios_auditados JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.tarifas ADD COLUMN IF NOT EXISTS timbrado VARCHAR(30) NOT NULL DEFAULT '19148339';
ALTER TABLE public.tarifas ADD COLUMN IF NOT EXISTS timbrado_inicio_vigencia VARCHAR(20) NOT NULL DEFAULT '01/10/2026';
ALTER TABLE public.tarifas ADD COLUMN IF NOT EXISTS timbrado_fin_vigencia VARCHAR(20) NOT NULL DEFAULT '31/10/2027';

-- Migración idempotente de columnas de auditoría/autoría a UUID si provienen de bases con TEXT
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'lecturas' AND column_name = 'registrado_por' AND data_type <> 'uuid'
    ) THEN
        ALTER TABLE public.lecturas
            ALTER COLUMN registrado_por TYPE UUID
            USING CASE
                WHEN registrado_por ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN registrado_por::uuid
                ELSE NULL
            END;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'lecturas' AND column_name = 'editado_por' AND data_type <> 'uuid'
    ) THEN
        ALTER TABLE public.lecturas
            ALTER COLUMN editado_por TYPE UUID
            USING CASE
                WHEN editado_por ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN editado_por::uuid
                ELSE NULL
            END;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tarifas' AND column_name = 'creado_por' AND data_type <> 'uuid'
    ) THEN
        ALTER TABLE public.tarifas
            ALTER COLUMN creado_por TYPE UUID
            USING CASE
                WHEN creado_por ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN creado_por::uuid
                ELSE NULL
            END;
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- 7. TABLA DE FACTURAS (Emitidas por cada medidor independiente)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facturas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    medidor_id UUID NOT NULL REFERENCES public.medidores(id) ON DELETE RESTRICT,
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
    periodo_facturado VARCHAR(7) NOT NULL, -- Formato: YYYY-MM
    periodo_consumo VARCHAR(7), -- YYYY-MM del período de lectura consumido (ej: 2026-10)
    lectura_id UUID REFERENCES public.lecturas(id) ON DELETE SET NULL,
    fecha_emision DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_vencimiento DATE NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagada', 'vencida', 'anulada', 'refinanciada')),
    total INTEGER NOT NULL,
    saldo_pendiente INTEGER NOT NULL,
    monto_pagado INTEGER NOT NULL DEFAULT 0,
    es_tercera_boleta BOOLEAN NOT NULL DEFAULT FALSE,
    alerta_consumo_elevado BOOLEAN NOT NULL DEFAULT FALSE,
    texto_alerta_consumo TEXT,
    numero_boleta_medidor INTEGER NOT NULL, -- Correlativo secuencial por medidor (MAX + 1)
    numero_factura VARCHAR(20), -- Numeración oficial SET (ej: 001-002-0000001)
    lectura_anterior INTEGER,
    lectura_actual INTEGER,
    consumo_m3 INTEGER,
    fecha_pago DATE,
    motivo_anulacion TEXT,
    motivo TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- Migración idempotente para bases existentes y unicidad por medidor+período (excluyendo anuladas)
ALTER TABLE public.facturas ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT;
ALTER TABLE public.facturas ADD COLUMN IF NOT EXISTS motivo TEXT;
ALTER TABLE public.facturas ADD COLUMN IF NOT EXISTS periodo_consumo VARCHAR(7);
ALTER TABLE public.facturas ADD COLUMN IF NOT EXISTS lectura_id UUID REFERENCES public.lecturas(id) ON DELETE SET NULL;
ALTER TABLE public.facturas ADD COLUMN IF NOT EXISTS monto_pagado INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.facturas ADD COLUMN IF NOT EXISTS numero_factura VARCHAR(20);

-- Secuencia global para numeración SET 001-002-XXXXXXX (7 dígitos)
CREATE SEQUENCE IF NOT EXISTS public.facturas_numero_seq START WITH 1 INCREMENT BY 1;

-- Backfill idempotente para facturas existentes sin numero_factura en orden cronológico
WITH pendientes_numerar AS (
    SELECT
        id,
        ROW_NUMBER() OVER (ORDER BY created_at ASC, fecha_emision ASC, id ASC)
        + COALESCE(
            (SELECT MAX(SUBSTRING(f2.numero_factura FROM 9)::INTEGER)
             FROM public.facturas f2
             WHERE f2.numero_factura ~ '^001-002-[0-9]{7}$'),
            0
        ) AS seq_num
    FROM public.facturas
    WHERE numero_factura IS NULL OR numero_factura = ''
)
UPDATE public.facturas f
SET numero_factura = '001-002-' || LPAD(p.seq_num::TEXT, 7, '0')
FROM pendientes_numerar p
WHERE f.id = p.id;

SELECT setval(
    'public.facturas_numero_seq',
    GREATEST(
        COALESCE(
            (SELECT MAX(SUBSTRING(numero_factura FROM 9)::INTEGER)
             FROM public.facturas
             WHERE numero_factura ~ '^001-002-[0-9]{7}$'),
            0
        ),
        1
    ),
    EXISTS (SELECT 1 FROM public.facturas WHERE numero_factura ~ '^001-002-[0-9]{7}$')
);

CREATE OR REPLACE FUNCTION public.asignar_numero_factura_set()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_seq INTEGER;
BEGIN
    IF NEW.numero_factura IS NULL OR BTRIM(NEW.numero_factura) = '' THEN
        v_seq := nextval('public.facturas_numero_seq');
        NEW.numero_factura := '001-002-' || LPAD(v_seq::TEXT, 7, '0');
    ELSIF NEW.numero_factura ~ '^001-002-[0-9]{7}$' THEN
        v_seq := SUBSTRING(NEW.numero_factura FROM 9)::INTEGER;
        IF v_seq > COALESCE((SELECT last_value FROM public.facturas_numero_seq), 0) THEN
            PERFORM setval('public.facturas_numero_seq', v_seq, true);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asignar_numero_factura_set ON public.facturas;
CREATE TRIGGER trg_asignar_numero_factura_set
BEFORE INSERT ON public.facturas
FOR EACH ROW
EXECUTE FUNCTION public.asignar_numero_factura_set();

CREATE UNIQUE INDEX IF NOT EXISTS uq_facturas_numero_factura
    ON public.facturas (numero_factura)
    WHERE numero_factura IS NOT NULL;

UPDATE public.facturas f
SET monto_pagado = COALESCE(
    (SELECT SUM(p.monto) FROM public.pagos p WHERE p.factura_id = f.id),
    0
)
WHERE COALESCE(f.monto_pagado, 0) = 0
  AND EXISTS (SELECT 1 FROM public.pagos p WHERE p.factura_id = f.id);
ALTER TABLE public.facturas DROP CONSTRAINT IF EXISTS facturas_estado_check;
ALTER TABLE public.facturas ADD CONSTRAINT facturas_estado_check CHECK (estado IN ('pendiente', 'pagada', 'vencida', 'anulada', 'refinanciada'));
ALTER TABLE public.facturas DROP CONSTRAINT IF EXISTS uq_medidor_periodo_facturado;
CREATE UNIQUE INDEX IF NOT EXISTS uq_medidor_periodo_facturado
    ON public.facturas (medidor_id, periodo_facturado)
    WHERE estado <> 'anulada';
CREATE UNIQUE INDEX IF NOT EXISTS uq_facturas_lectura_activa
    ON public.facturas (lectura_id)
    WHERE estado <> 'anulada' AND lectura_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 8. TABLA DE DETALLE DE FACTURA (Conceptos ordenados 1 al 8)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.detalle_factura (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    factura_id UUID NOT NULL REFERENCES public.facturas(id) ON DELETE CASCADE,
    concepto VARCHAR(30) NOT NULL CHECK (
        concepto IN (
            'consumo_agua',
            'deuda_anterior',
            'mora',
            'otros_trabajos',
            'cuota_conexion',
            'perdida_financiada',
            'reconexion',
            'erssan'
        )
    ),
    descripcion TEXT NOT NULL,
    monto INTEGER NOT NULL CHECK (monto > 0),
    cargo_pendiente_id UUID
);

-- ---------------------------------------------------------------------
-- 9. TABLA DE PAGOS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pagos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    factura_id UUID REFERENCES public.facturas(id) ON DELETE RESTRICT,
    cliente_id UUID REFERENCES public.clientes(id) ON DELETE RESTRICT,
    medidor_id UUID REFERENCES public.medidores(id) ON DELETE RESTRICT,
    fecha_pago DATE NOT NULL DEFAULT CURRENT_DATE,
    monto INTEGER NOT NULL CHECK (monto > 0),
    metodo_pago VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo', 'transferencia', 'cheque')),
    numero_recibo VARCHAR(30) NOT NULL UNIQUE,
    tipo_comprobante VARCHAR(30) NOT NULL DEFAULT 'factura_legal' CHECK (tipo_comprobante IN ('factura_legal', 'recibo_sin_valor_fiscal')),
    es_concepto_personalizado BOOLEAN NOT NULL DEFAULT FALSE,
    concepto_personalizado TEXT,
    cobrador_id UUID NOT NULL DEFAULT auth.uid() REFERENCES public.usuarios(id),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    CONSTRAINT chk_pagos_factura_o_personalizado CHECK (factura_id IS NOT NULL OR es_concepto_personalizado = TRUE)
);

ALTER TABLE public.pagos ALTER COLUMN factura_id DROP NOT NULL;
ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES public.clientes(id) ON DELETE RESTRICT;
ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS medidor_id UUID REFERENCES public.medidores(id) ON DELETE RESTRICT;
ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS tipo_comprobante VARCHAR(30) NOT NULL DEFAULT 'factura_legal';
ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS es_concepto_personalizado BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS concepto_personalizado TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_pagos_factura_o_personalizado'
    ) THEN
        ALTER TABLE public.pagos
            ADD CONSTRAINT chk_pagos_factura_o_personalizado
            CHECK (factura_id IS NOT NULL OR COALESCE(es_concepto_personalizado, FALSE) = TRUE);
    END IF;
END $$;

-- Secuencia separada de 4 dígitos para Recibos sin valor fiscal (001-002-XXXX)
CREATE SEQUENCE IF NOT EXISTS public.recibos_numero_seq START WITH 1 INCREMENT BY 1;

SELECT setval(
    'public.recibos_numero_seq',
    GREATEST(
        COALESCE(
            (SELECT MAX(SUBSTRING(numero_recibo FROM 9)::INTEGER)
             FROM public.pagos
             WHERE numero_recibo ~ '^001-002-[0-9]{4}$'),
            0
        ),
        1
    ),
    EXISTS (SELECT 1 FROM public.pagos WHERE numero_recibo ~ '^001-002-[0-9]{4}$')
);

CREATE OR REPLACE FUNCTION public.asignar_numero_recibo_4_digitos()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_seq INTEGER;
BEGIN
    IF COALESCE(NEW.tipo_comprobante, 'factura_legal') = 'recibo_sin_valor_fiscal' THEN
        IF NEW.numero_recibo IS NULL OR BTRIM(NEW.numero_recibo) = '' THEN
            v_seq := nextval('public.recibos_numero_seq');
            NEW.numero_recibo := '001-002-' || LPAD(v_seq::TEXT, 4, '0');
        ELSIF NEW.numero_recibo ~ '^001-002-[0-9]{4}$' THEN
            v_seq := SUBSTRING(NEW.numero_recibo FROM 9)::INTEGER;
            IF v_seq > COALESCE((SELECT last_value FROM public.recibos_numero_seq), 0) THEN
                PERFORM setval('public.recibos_numero_seq', v_seq, true);
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asignar_numero_recibo_4_digitos ON public.pagos;
CREATE TRIGGER trg_asignar_numero_recibo_4_digitos
BEFORE INSERT ON public.pagos
FOR EACH ROW
EXECUTE FUNCTION public.asignar_numero_recibo_4_digitos();

-- Migración idempotente para asegurar cobrador_id UUID NOT NULL DEFAULT auth.uid() en bases existentes
DO $$
DECLARE
    v_admin_id UUID;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pagos' AND column_name = 'cobrador_id' AND data_type <> 'uuid'
    ) THEN
        ALTER TABLE public.pagos
            ALTER COLUMN cobrador_id TYPE UUID
            USING CASE
                WHEN cobrador_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN cobrador_id::uuid
                ELSE NULL
            END;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.pagos WHERE cobrador_id IS NULL
    ) THEN
        SELECT u.id INTO v_admin_id
        FROM public.usuarios u
        JOIN public.user_roles r ON r.user_id = u.id
        WHERE r.rol = 'admin'
        ORDER BY u.fecha_creacion ASC
        LIMIT 1;

        IF v_admin_id IS NOT NULL THEN
            UPDATE public.pagos SET cobrador_id = v_admin_id WHERE cobrador_id IS NULL;
        ELSE
            DELETE FROM public.pagos WHERE cobrador_id IS NULL;
        END IF;
    END IF;
END $$;

ALTER TABLE public.pagos ALTER COLUMN cobrador_id SET DEFAULT auth.uid();
ALTER TABLE public.pagos ALTER COLUMN cobrador_id SET NOT NULL;

-- Función centralizada de recálculo de estado de medidor según boletas vencidas impagas:
-- 0 vencidas -> activo | 1-2 vencidas -> moroso | 3+ vencidas -> pendiente_corte | cortado/retirado -> sin cambios
CREATE OR REPLACE FUNCTION public.recalcular_estado_medidor(p_medidor_id UUID)
RETURNS VARCHAR(20)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_medidor_estado VARCHAR(20);
    v_vencidas_impagas INTEGER;
    v_tiene_tercera BOOLEAN := FALSE;
    v_tiene_mora_consolidada BOOLEAN := FALSE;
    v_nuevo_estado VARCHAR(20);
BEGIN
    IF p_medidor_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT estado
    INTO v_medidor_estado
    FROM public.medidores
    WHERE id = p_medidor_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- Si el medidor está cortado o retirado, no tocar
    IF v_medidor_estado IN ('cortado', 'retirado') THEN
        RETURN v_medidor_estado;
    END IF;

    SELECT
        COUNT(*) FILTER (WHERE f.estado = 'vencida' OR f.fecha_vencimiento < CURRENT_DATE),
        COALESCE(BOOL_OR(f.es_tercera_boleta), FALSE),
        COALESCE(BOOL_OR(EXISTS (
            SELECT 1 FROM public.detalle_factura df
            WHERE df.factura_id = f.id AND df.concepto = 'mora' AND df.monto > 0
        )), FALSE)
    INTO v_vencidas_impagas, v_tiene_tercera, v_tiene_mora_consolidada
    FROM public.facturas f
    WHERE f.medidor_id = p_medidor_id
      AND f.estado NOT IN ('pagada', 'anulada', 'refinanciada');

    v_nuevo_estado := CASE
        WHEN v_vencidas_impagas >= 3 OR v_tiene_tercera THEN 'pendiente_corte'
        WHEN v_vencidas_impagas >= 1 OR v_tiene_mora_consolidada THEN 'moroso'
        ELSE 'activo'
    END;

    IF v_nuevo_estado IS DISTINCT FROM v_medidor_estado THEN
        UPDATE public.medidores
        SET estado = v_nuevo_estado
        WHERE id = p_medidor_id;
    END IF;

    RETURN v_nuevo_estado;
END;
$$;

-- Función RPC / batch para recalcular todos los medidores existentes y marcar facturas vencidas por paso del tiempo
CREATE OR REPLACE FUNCTION public.recalcular_todos_los_estados_medidores()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_facturas_marcadas INTEGER := 0;
    v_medidores_actualizados INTEGER := 0;
BEGIN
    -- 1. Marcar como 'vencida' toda factura pendiente cuya fecha de vencimiento ya pasó
    UPDATE public.facturas
    SET estado = 'vencida'
    WHERE estado = 'pendiente'
      AND fecha_vencimiento < CURRENT_DATE;
    GET DIAGNOSTICS v_facturas_marcadas = ROW_COUNT;

    -- 2. Recalcular estado de todos los medidores excepto 'cortado' y 'retirado' (ignorando facturas refinanciadas)
    WITH conteo AS (
        SELECT
            m.id AS medidor_id,
            m.estado AS estado_actual,
            COUNT(f.id) FILTER (
                WHERE f.estado NOT IN ('pagada', 'anulada', 'refinanciada')
                  AND (f.estado = 'vencida' OR f.fecha_vencimiento < CURRENT_DATE)
            ) AS vencidas_impagas,
            COALESCE(BOOL_OR(f.es_tercera_boleta) FILTER (
                WHERE f.estado NOT IN ('pagada', 'anulada', 'refinanciada')
            ), FALSE) AS tiene_tercera,
            COALESCE(BOOL_OR(EXISTS (
                SELECT 1 FROM public.detalle_factura df
                WHERE df.factura_id = f.id AND df.concepto = 'mora' AND df.monto > 0
            )) FILTER (
                WHERE f.estado NOT IN ('pagada', 'anulada', 'refinanciada')
            ), FALSE) AS tiene_mora_consolidada
        FROM public.medidores m
        LEFT JOIN public.facturas f ON f.medidor_id = m.id
        WHERE m.estado NOT IN ('cortado', 'retirado')
        GROUP BY m.id, m.estado
    ),
    calculado AS (
        SELECT
            medidor_id,
            estado_actual,
            CASE
                WHEN vencidas_impagas >= 3 OR tiene_tercera THEN 'pendiente_corte'
                WHEN vencidas_impagas >= 1 OR tiene_mora_consolidada THEN 'moroso'
                ELSE 'activo'
            END AS nuevo_estado
        FROM conteo
    )
    UPDATE public.medidores m
    SET estado = c.nuevo_estado
    FROM calculado c
    WHERE m.id = c.medidor_id
      AND m.estado IS DISTINCT FROM c.nuevo_estado;

    GET DIAGNOSTICS v_medidores_actualizados = ROW_COUNT;

    RETURN jsonb_build_object(
        'facturas_vencidas_marcadas', v_facturas_marcadas,
        'medidores_actualizados', v_medidores_actualizados
    );
END;
$$;

REVOKE ALL ON FUNCTION public.recalcular_estado_medidor(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalcular_estado_medidor(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.recalcular_todos_los_estados_medidores() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalcular_todos_los_estados_medidores() TO authenticated, service_role;

-- Trigger en facturas: recalcula automáticamente el estado del medidor cuando una factura
-- cambia a vencida, se paga, se anula, se refinancia, se elimina o se inserta ya vencida.
CREATE OR REPLACE FUNCTION public.trg_fn_recalcular_estado_medidor_por_factura()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.recalcular_estado_medidor(OLD.medidor_id);
        RETURN OLD;
    ELSIF TG_OP = 'INSERT' THEN
        IF NEW.estado = 'vencida'
           OR (NEW.estado NOT IN ('pagada', 'anulada', 'refinanciada') AND NEW.fecha_vencimiento < CURRENT_DATE) THEN
            PERFORM public.recalcular_estado_medidor(NEW.medidor_id);
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.medidor_id IS DISTINCT FROM NEW.medidor_id THEN
            PERFORM public.recalcular_estado_medidor(OLD.medidor_id);
            PERFORM public.recalcular_estado_medidor(NEW.medidor_id);
        ELSIF OLD.estado IS DISTINCT FROM NEW.estado
           OR OLD.fecha_vencimiento IS DISTINCT FROM NEW.fecha_vencimiento
           OR OLD.saldo_pendiente IS DISTINCT FROM NEW.saldo_pendiente THEN
            PERFORM public.recalcular_estado_medidor(NEW.medidor_id);
        END IF;
        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_facturas_recalcular_estado_medidor ON public.facturas;
CREATE TRIGGER trg_facturas_recalcular_estado_medidor
AFTER INSERT OR UPDATE OR DELETE ON public.facturas
FOR EACH ROW
EXECUTE FUNCTION public.trg_fn_recalcular_estado_medidor_por_factura();

-- Trigger de integridad de pagos (permite al cobrador registrar pagos sin abrir UPDATE directo sobre facturas/medidores)
CREATE OR REPLACE FUNCTION public.procesar_pago_factura()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_factura RECORD;
    v_total_pagado INTEGER;
    v_nuevo_saldo INTEGER;
BEGIN
    IF TG_WHEN = 'BEFORE' THEN
        IF NEW.cobrador_id IS NULL THEN
            NEW.cobrador_id := auth.uid();
        END IF;

        IF NEW.cobrador_id IS NULL THEN
            RAISE EXCEPTION 'cobrador_id es obligatorio para registrar auditoría del pago';
        END IF;

        -- Cobro con Concepto Personalizado: totalmente independiente de facturas de consumo de agua
        IF COALESCE(NEW.es_concepto_personalizado, FALSE) = TRUE OR NEW.factura_id IS NULL THEN
            NEW.es_concepto_personalizado := TRUE;
            NEW.factura_id := NULL;
            RETURN NEW;
        END IF;

        SELECT id, estado, total, saldo_pendiente
        INTO v_factura
        FROM public.facturas
        WHERE id = NEW.factura_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Factura no encontrada: %', NEW.factura_id;
        END IF;

        IF v_factura.estado = 'anulada' THEN
            RAISE EXCEPTION 'No se puede registrar un pago sobre una factura anulada';
        END IF;

        IF v_factura.estado = 'refinanciada' THEN
            RAISE EXCEPTION 'No se puede cobrar una factura refinanciada/consolidada en una factura posterior';
        END IF;

        IF v_factura.estado = 'pagada' OR v_factura.saldo_pendiente <= 0 THEN
            RAISE EXCEPTION 'Esta factura ya se encuentra totalmente pagada';
        END IF;

        IF NEW.monto > v_factura.saldo_pendiente THEN
            RAISE EXCEPTION 'El monto a pagar (%) supera el saldo pendiente (%)', NEW.monto, v_factura.saldo_pendiente;
        END IF;

        RETURN NEW;
    ELSIF TG_WHEN = 'AFTER' THEN
        -- Si es Concepto Personalizado o sin factura_id, NO tocar saldo_pendiente ni estado de facturas/medidores
        IF COALESCE(NEW.es_concepto_personalizado, FALSE) = TRUE OR NEW.factura_id IS NULL THEN
            RETURN NEW;
        END IF;

        SELECT id, medidor_id, total, estado
        INTO v_factura
        FROM public.facturas
        WHERE id = NEW.factura_id;

        SELECT COALESCE(SUM(monto), 0)
        INTO v_total_pagado
        FROM public.pagos
        WHERE factura_id = NEW.factura_id
          AND COALESCE(es_concepto_personalizado, FALSE) = FALSE;

        v_nuevo_saldo := GREATEST(0, v_factura.total - v_total_pagado);

        UPDATE public.facturas
        SET monto_pagado = v_total_pagado,
            saldo_pendiente = v_nuevo_saldo,
            estado = CASE WHEN v_nuevo_saldo = 0 THEN 'pagada' ELSE estado END,
            fecha_pago = CASE WHEN v_nuevo_saldo = 0 THEN NEW.fecha_pago ELSE fecha_pago END
        WHERE id = NEW.factura_id;

        -- Re-evaluar estado del medidor si la factura quedó pagada (0 vencidas->activo, 1-2->moroso, 3+->pendiente_corte; nunca tocar cortado/retirado)
        IF v_nuevo_saldo = 0 THEN
            PERFORM public.recalcular_estado_medidor(v_factura.medidor_id);
        END IF;

        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_pago_antes_insert ON public.pagos;
CREATE TRIGGER trg_validar_pago_antes_insert
BEFORE INSERT ON public.pagos
FOR EACH ROW
EXECUTE FUNCTION public.procesar_pago_factura();

DROP TRIGGER IF EXISTS trg_aplicar_pago_despues_insert ON public.pagos;
CREATE TRIGGER trg_aplicar_pago_despues_insert
AFTER INSERT ON public.pagos
FOR EACH ROW
EXECUTE FUNCTION public.procesar_pago_factura();

-- Backfill inmediato al ejecutar el schema para alinear medidores existentes con facturas vencidas
SELECT public.recalcular_todos_los_estados_medidores();

-- ---------------------------------------------------------------------
-- 10. TABLA DE OTROS TRABAJOS (Cargos pendientes por medidor)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cargos_pendientes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    medidor_id UUID NOT NULL REFERENCES public.medidores(id) ON DELETE RESTRICT,
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
    fecha_trabajo DATE NOT NULL DEFAULT CURRENT_DATE,
    descripcion TEXT NOT NULL,
    monto INTEGER NOT NULL CHECK (monto > 0),
    periodo_facturacion VARCHAR(7) NOT NULL, -- Período futuro en que se incluirá
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'facturado', 'anulado')),
    factura_id UUID REFERENCES public.facturas(id),
    comprobante_url TEXT,
    registrado_por UUID REFERENCES public.usuarios(id),
    fecha_registro TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    motivo_anulacion TEXT
);

-- Trigger de integridad: si se anula o elimina una factura, los cargos_pendientes asociados
-- vuelven automáticamente a estado = 'pendiente' y factura_id = NULL para no perder el cobro.
CREATE OR REPLACE FUNCTION public.revertir_cargos_al_anular_factura()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE public.cargos_pendientes
        SET estado = 'pendiente',
            factura_id = NULL
        WHERE factura_id = OLD.id
          AND estado = 'facturado';
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.estado = 'anulada' AND OLD.estado IS DISTINCT FROM 'anulada' THEN
            UPDATE public.cargos_pendientes
            SET estado = 'pendiente',
                factura_id = NULL
            WHERE factura_id = NEW.id
              AND estado = 'facturado';
        END IF;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_revertir_cargos_delete_factura ON public.facturas;
CREATE TRIGGER trg_revertir_cargos_delete_factura
BEFORE DELETE ON public.facturas
FOR EACH ROW
EXECUTE FUNCTION public.revertir_cargos_al_anular_factura();

DROP TRIGGER IF EXISTS trg_revertir_cargos_update_factura ON public.facturas;
CREATE TRIGGER trg_revertir_cargos_update_factura
AFTER UPDATE OF estado ON public.facturas
FOR EACH ROW
EXECUTE FUNCTION public.revertir_cargos_al_anular_factura();

-- ---------------------------------------------------------------------
-- 11. TABLA DE PLANES DE FINANCIAMIENTO (Cuotas de conexión y pérdidas)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planes_financiamiento (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    medidor_id UUID NOT NULL REFERENCES public.medidores(id) ON DELETE RESTRICT,
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
    tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('cuota_conexion', 'perdida_financiada')),
    descripcion TEXT,
    monto_total INTEGER NOT NULL CHECK (monto_total > 0),
    cantidad_cuotas INTEGER NOT NULL CHECK (cantidad_cuotas > 0),
    monto_cuota INTEGER NOT NULL CHECK (monto_cuota > 0),
    periodo_inicio VARCHAR(7) NOT NULL, -- YYYY-MM
    cuotas_pagadas INTEGER NOT NULL DEFAULT 0 CHECK (cuotas_pagadas >= 0),
    estado VARCHAR(20) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'completado', 'anulado')),
    registrado_por UUID NOT NULL,
    fecha_registro TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    motivo_anulacion TEXT
);

-- =====================================================================
-- ÍNDICES NO NEGOCIABLES DE ALTO RENDIMIENTO (Paginación < 2 segundos)
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_clientes_documento ON public.clientes(documento);
CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON public.clientes(nombre_completo);

CREATE INDEX IF NOT EXISTS idx_medidores_cliente_id ON public.medidores(cliente_id);
CREATE INDEX IF NOT EXISTS idx_medidores_numero_medidor ON public.medidores(numero_medidor);
CREATE INDEX IF NOT EXISTS idx_medidores_estado ON public.medidores(estado);
CREATE INDEX IF NOT EXISTS idx_medidores_zona ON public.medidores(zona);
CREATE INDEX IF NOT EXISTS idx_medidores_geo ON public.medidores(latitud, longitud);

CREATE INDEX IF NOT EXISTS idx_lecturas_medidor_periodo ON public.lecturas(medidor_id, periodo);
CREATE INDEX IF NOT EXISTS idx_lecturas_fecha ON public.lecturas(fecha_lectura);

CREATE INDEX IF NOT EXISTS idx_facturas_medidor_id ON public.facturas(medidor_id);
CREATE INDEX IF NOT EXISTS idx_facturas_cliente_id ON public.facturas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_facturas_lectura_id ON public.facturas(lectura_id);
CREATE INDEX IF NOT EXISTS idx_facturas_periodo ON public.facturas(periodo_facturado);
CREATE INDEX IF NOT EXISTS idx_facturas_estado ON public.facturas(estado);
CREATE INDEX IF NOT EXISTS idx_facturas_fecha_vencimiento ON public.facturas(fecha_vencimiento);

CREATE INDEX IF NOT EXISTS idx_cargos_medidor_periodo ON public.cargos_pendientes(medidor_id, periodo_facturacion);
CREATE INDEX IF NOT EXISTS idx_cargos_estado ON public.cargos_pendientes(estado);

CREATE INDEX IF NOT EXISTS idx_planes_medidor_id ON public.planes_financiamiento(medidor_id);
CREATE INDEX IF NOT EXISTS idx_planes_cliente_id ON public.planes_financiamiento(cliente_id);
CREATE INDEX IF NOT EXISTS idx_planes_estado ON public.planes_financiamiento(estado);

-- =====================================================================
-- SEGURIDAD A NIVEL DE FILAS (Row Level Security - RLS)
-- =====================================================================
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medidores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lecturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarifas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detalle_factura ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargos_pendientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contratos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planes_financiamiento ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- POLÍTICAS DE SEGURIDAD (Row Level Security - RLS)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. LIMPIEZA GLOBAL DE POLÍTICAS PERMISIVAS RESIDUALES (Todas las 12 tablas)
-- Incluye usuarios y user_roles, planes_financiamiento y las 9 tablas operativas.
-- Elimina cualquier política FOR ALL o USING/WITH CHECK (true) de escritura/lectura sensible.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
              'usuarios',
              'user_roles',
              'clientes',
              'medidores',
              'lecturas',
              'tarifas',
              'facturas',
              'detalle_factura',
              'pagos',
              'cargos_pendientes',
              'contratos',
              'planes_financiamiento'
          )
          AND (
              cmd = 'ALL'
              OR policyname ILIKE 'Acceso total%'
              OR (cmd IN ('INSERT', 'UPDATE', 'DELETE') AND (COALESCE(qual, '') = 'true' OR COALESCE(with_check, '') = 'true'))
              OR (
                  tablename IN ('usuarios', 'user_roles', 'facturas', 'detalle_factura', 'pagos', 'cargos_pendientes', 'contratos')
                  AND cmd = 'SELECT'
                  AND COALESCE(qual, '') = 'true'
              )
          )
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- A. TABLAS OPERATIVAS (Mínimo privilegio por rol: admin, cobrador, lectura)
-- ---------------------------------------------------------------------

-- A.1 CLIENTES (SELECT: personal autenticado; INSERT/UPDATE: admin y cobrador; DELETE: solo admin)
DROP POLICY IF EXISTS "Acceso total a clientes" ON public.clientes;
DROP POLICY IF EXISTS "clientes_select" ON public.clientes;
DROP POLICY IF EXISTS "clientes_insert" ON public.clientes;
DROP POLICY IF EXISTS "clientes_update" ON public.clientes;
DROP POLICY IF EXISTS "clientes_delete_admin" ON public.clientes;

CREATE POLICY "clientes_select"
ON public.clientes FOR SELECT TO authenticated
USING (true);

CREATE POLICY "clientes_insert"
ON public.clientes FOR INSERT TO authenticated
WITH CHECK (public.get_user_rol(auth.uid()) IN ('admin', 'cobrador'));

CREATE POLICY "clientes_update"
ON public.clientes FOR UPDATE TO authenticated
USING (public.get_user_rol(auth.uid()) IN ('admin', 'cobrador'))
WITH CHECK (public.get_user_rol(auth.uid()) IN ('admin', 'cobrador'));

CREATE POLICY "clientes_delete_admin"
ON public.clientes FOR DELETE TO authenticated
USING (public.is_admin());

-- A.2 MEDIDORES (SELECT: personal autenticado; INSERT/UPDATE/DELETE: solo admin)
DROP POLICY IF EXISTS "Acceso total a medidores" ON public.medidores;
DROP POLICY IF EXISTS "medidores_select" ON public.medidores;
DROP POLICY IF EXISTS "medidores_insert_admin" ON public.medidores;
DROP POLICY IF EXISTS "medidores_update_admin" ON public.medidores;
DROP POLICY IF EXISTS "medidores_delete_admin" ON public.medidores;

CREATE POLICY "medidores_select"
ON public.medidores FOR SELECT TO authenticated
USING (true);

CREATE POLICY "medidores_insert_admin"
ON public.medidores FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "medidores_update_admin"
ON public.medidores FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "medidores_delete_admin"
ON public.medidores FOR DELETE TO authenticated
USING (public.is_admin());

-- A.3 LECTURAS (SELECT: personal autenticado; INSERT: admin y lectura;
--     UPDATE/DELETE: admin o el lector sobre sus propios borradores aún no confirmados)
DROP POLICY IF EXISTS "Acceso total a lecturas" ON public.lecturas;
DROP POLICY IF EXISTS "lecturas_select" ON public.lecturas;
DROP POLICY IF EXISTS "lecturas_insert" ON public.lecturas;
DROP POLICY IF EXISTS "lecturas_update" ON public.lecturas;
DROP POLICY IF EXISTS "lecturas_delete" ON public.lecturas;

CREATE POLICY "lecturas_select"
ON public.lecturas FOR SELECT TO authenticated
USING (true);

CREATE POLICY "lecturas_insert"
ON public.lecturas FOR INSERT TO authenticated
WITH CHECK (
    public.is_admin()
    OR (
        public.get_user_rol(auth.uid()) = 'lectura'
        AND (registrado_por IS NULL OR registrado_por = auth.uid())
    )
);

CREATE POLICY "lecturas_update"
ON public.lecturas FOR UPDATE TO authenticated
USING (
    public.is_admin()
    OR (
        public.get_user_rol(auth.uid()) = 'lectura'
        AND estado = 'borrador'
        AND (registrado_por IS NULL OR registrado_por = auth.uid())
    )
)
WITH CHECK (
    public.is_admin()
    OR (
        public.get_user_rol(auth.uid()) = 'lectura'
        AND (registrado_por IS NULL OR registrado_por = auth.uid())
    )
);

CREATE POLICY "lecturas_delete"
ON public.lecturas FOR DELETE TO authenticated
USING (
    public.is_admin()
    OR (
        public.get_user_rol(auth.uid()) = 'lectura'
        AND estado = 'borrador'
        AND (registrado_por IS NULL OR registrado_por = auth.uid())
    )
);

-- A.4 TARIFAS (SELECT: personal autenticado; INSERT/UPDATE/DELETE: exclusivo admin)
DROP POLICY IF EXISTS "Acceso total a tarifas" ON public.tarifas;
DROP POLICY IF EXISTS "tarifas_select" ON public.tarifas;
DROP POLICY IF EXISTS "tarifas_insert_admin" ON public.tarifas;
DROP POLICY IF EXISTS "tarifas_update_admin" ON public.tarifas;
DROP POLICY IF EXISTS "tarifas_delete_admin" ON public.tarifas;

CREATE POLICY "tarifas_select"
ON public.tarifas FOR SELECT TO authenticated
USING (true);

CREATE POLICY "tarifas_insert_admin"
ON public.tarifas FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "tarifas_update_admin"
ON public.tarifas FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "tarifas_delete_admin"
ON public.tarifas FOR DELETE TO authenticated
USING (public.is_admin());

-- A.5 FACTURAS (SELECT: solo admin y cobrador; INSERT/UPDATE/DELETE: exclusivo admin;
--     operativamente se prefiere anular vía UPDATE estado='anulada' antes que DELETE)
DROP POLICY IF EXISTS "Acceso total a facturas" ON public.facturas;
DROP POLICY IF EXISTS "facturas_select" ON public.facturas;
DROP POLICY IF EXISTS "facturas_insert_admin" ON public.facturas;
DROP POLICY IF EXISTS "facturas_update_admin" ON public.facturas;
DROP POLICY IF EXISTS "facturas_delete_admin" ON public.facturas;

CREATE POLICY "facturas_select"
ON public.facturas FOR SELECT TO authenticated
USING (public.get_user_rol(auth.uid()) IN ('admin', 'cobrador'));

CREATE POLICY "facturas_insert_admin"
ON public.facturas FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "facturas_update_admin"
ON public.facturas FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "facturas_delete_admin"
ON public.facturas FOR DELETE TO authenticated
USING (public.is_admin());

-- A.6 DETALLE_FACTURA (SELECT: solo admin y cobrador; INSERT/UPDATE/DELETE: exclusivo admin)
DROP POLICY IF EXISTS "Acceso total a detalle_factura" ON public.detalle_factura;
DROP POLICY IF EXISTS "detalle_factura_select" ON public.detalle_factura;
DROP POLICY IF EXISTS "detalle_factura_insert_admin" ON public.detalle_factura;
DROP POLICY IF EXISTS "detalle_factura_update_admin" ON public.detalle_factura;
DROP POLICY IF EXISTS "detalle_factura_delete_admin" ON public.detalle_factura;

CREATE POLICY "detalle_factura_select"
ON public.detalle_factura FOR SELECT TO authenticated
USING (public.get_user_rol(auth.uid()) IN ('admin', 'cobrador'));

CREATE POLICY "detalle_factura_insert_admin"
ON public.detalle_factura FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "detalle_factura_update_admin"
ON public.detalle_factura FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "detalle_factura_delete_admin"
ON public.detalle_factura FOR DELETE TO authenticated
USING (public.is_admin());

-- A.7 PAGOS (SELECT/INSERT: solo admin y cobrador; UPDATE/DELETE: exclusivo admin;
--     cobrador solo puede registrar pagos a su propio auth.uid())
DROP POLICY IF EXISTS "Acceso total a pagos" ON public.pagos;
DROP POLICY IF EXISTS "pagos_select" ON public.pagos;
DROP POLICY IF EXISTS "pagos_insert" ON public.pagos;
DROP POLICY IF EXISTS "pagos_update_admin" ON public.pagos;
DROP POLICY IF EXISTS "pagos_delete_admin" ON public.pagos;

CREATE POLICY "pagos_select"
ON public.pagos FOR SELECT TO authenticated
USING (public.get_user_rol(auth.uid()) IN ('admin', 'cobrador'));

CREATE POLICY "pagos_insert"
ON public.pagos FOR INSERT TO authenticated
WITH CHECK (
    public.get_user_rol(auth.uid()) IN ('admin', 'cobrador')
    AND (public.is_admin() OR cobrador_id = auth.uid())
);

CREATE POLICY "pagos_update_admin"
ON public.pagos FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "pagos_delete_admin"
ON public.pagos FOR DELETE TO authenticated
USING (public.is_admin());

-- A.8 CARGOS_PENDIENTES (SELECT: solo admin y cobrador; INSERT/UPDATE/DELETE: exclusivo admin)
DROP POLICY IF EXISTS "Acceso total a cargos_pendientes" ON public.cargos_pendientes;
DROP POLICY IF EXISTS "cargos_pendientes_select" ON public.cargos_pendientes;
DROP POLICY IF EXISTS "cargos_pendientes_insert_admin" ON public.cargos_pendientes;
DROP POLICY IF EXISTS "cargos_pendientes_update_admin" ON public.cargos_pendientes;
DROP POLICY IF EXISTS "cargos_pendientes_delete_admin" ON public.cargos_pendientes;

CREATE POLICY "cargos_pendientes_select"
ON public.cargos_pendientes FOR SELECT TO authenticated
USING (public.get_user_rol(auth.uid()) IN ('admin', 'cobrador'));

CREATE POLICY "cargos_pendientes_insert_admin"
ON public.cargos_pendientes FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "cargos_pendientes_update_admin"
ON public.cargos_pendientes FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "cargos_pendientes_delete_admin"
ON public.cargos_pendientes FOR DELETE TO authenticated
USING (public.is_admin());

-- A.9 CONTRATOS (SELECT: solo admin y cobrador; INSERT/UPDATE/DELETE: exclusivo admin)
DROP POLICY IF EXISTS "Acceso total a contratos" ON public.contratos;
DROP POLICY IF EXISTS "contratos_select" ON public.contratos;
DROP POLICY IF EXISTS "contratos_insert_admin" ON public.contratos;
DROP POLICY IF EXISTS "contratos_update_admin" ON public.contratos;
DROP POLICY IF EXISTS "contratos_delete_admin" ON public.contratos;

CREATE POLICY "contratos_select"
ON public.contratos FOR SELECT TO authenticated
USING (public.get_user_rol(auth.uid()) IN ('admin', 'cobrador'));

CREATE POLICY "contratos_insert_admin"
ON public.contratos FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "contratos_update_admin"
ON public.contratos FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "contratos_delete_admin"
ON public.contratos FOR DELETE TO authenticated
USING (public.is_admin());

-- ---------------------------------------------------------------------
-- B. TABLA: planes_financiamiento (Estrictamente controlado)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Acceso total a planes_financiamiento" ON public.planes_financiamiento;
DROP POLICY IF EXISTS "planes_select_authenticated" ON public.planes_financiamiento;
DROP POLICY IF EXISTS "planes_insert_admin" ON public.planes_financiamiento;
DROP POLICY IF EXISTS "planes_update_admin" ON public.planes_financiamiento;
DROP POLICY IF EXISTS "planes_delete_admin" ON public.planes_financiamiento;

-- 1. SELECT: Visible para todo el personal autenticado (admin, cobrador, lector para terreno)
CREATE POLICY "planes_select_authenticated" 
ON public.planes_financiamiento 
FOR SELECT 
TO authenticated 
USING (true);

-- 2. INSERT: Exclusivo para administradores
CREATE POLICY "planes_insert_admin" 
ON public.planes_financiamiento 
FOR INSERT 
TO authenticated 
WITH CHECK (public.is_admin());

-- 3. UPDATE: Exclusivo para administradores (gestión de cuotas/anulaciones)
CREATE POLICY "planes_update_admin" 
ON public.planes_financiamiento 
FOR UPDATE 
TO authenticated 
USING (public.is_admin()) 
WITH CHECK (public.is_admin());

-- 4. DELETE: Exclusivo para administradores
CREATE POLICY "planes_delete_admin" 
ON public.planes_financiamiento 
FOR DELETE 
TO authenticated 
USING (public.is_admin());

-- ---------------------------------------------------------------------
-- C. TABLA: usuarios (Perfil de usuario)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Acceso total a usuarios" ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_select_own_or_admin" ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_insert_admin" ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_update_admin" ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_update_self" ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_delete_admin" ON public.usuarios;

-- 1. SELECT: Usuario ve su propio perfil; Administrador puede ver el padrón de todos
CREATE POLICY "usuarios_select_own_or_admin" 
ON public.usuarios 
FOR SELECT 
TO authenticated 
USING (id = auth.uid() OR public.is_admin());

-- 2. INSERT: Registro directo bloqueado a público; Solo administradores pueden crear
CREATE POLICY "usuarios_insert_admin" 
ON public.usuarios 
FOR INSERT 
TO authenticated 
WITH CHECK (public.is_admin());

-- 3. UPDATE (Admin): Puede actualizar cualquier perfil (incluyendo activo)
CREATE POLICY "usuarios_update_admin" 
ON public.usuarios 
FOR UPDATE 
TO authenticated 
USING (public.is_admin()) 
WITH CHECK (public.is_admin());

-- 4. UPDATE (Propio Usuario): Puede modificar su propio perfil (trigger trg_proteger_campos_usuario bloquea activo/email)
CREATE POLICY "usuarios_update_self" 
ON public.usuarios 
FOR UPDATE 
TO authenticated 
USING (id = auth.uid()) 
WITH CHECK (id = auth.uid());

-- 5. DELETE: Exclusivo para administradores
CREATE POLICY "usuarios_delete_admin" 
ON public.usuarios 
FOR DELETE 
TO authenticated 
USING (public.is_admin());

-- ---------------------------------------------------------------------
-- D. TABLA: user_roles (Roles segregados de alta seguridad)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Lectura roles permitida a propio usuario o admin" ON public.user_roles;
DROP POLICY IF EXISTS "Modificacion roles exclusiva admin" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_select" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_insert_admin" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_update_admin" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_delete_admin" ON public.user_roles;

-- 1. SELECT: Usuario lee su propio rol; Administrador puede auditar todos
CREATE POLICY "user_roles_select" 
ON public.user_roles 
FOR SELECT 
TO authenticated 
USING (user_id = auth.uid() OR public.is_admin());

-- 2. INSERT: Solo admin
CREATE POLICY "user_roles_insert_admin" 
ON public.user_roles 
FOR INSERT 
TO authenticated 
WITH CHECK (public.is_admin());

-- 3. UPDATE: Solo admin (previene completamente auto-asignación de admin)
CREATE POLICY "user_roles_update_admin" 
ON public.user_roles 
FOR UPDATE 
TO authenticated 
USING (public.is_admin()) 
WITH CHECK (public.is_admin());

-- 4. DELETE: Solo admin
CREATE POLICY "user_roles_delete_admin" 
ON public.user_roles 
FOR DELETE 
TO authenticated 
USING (public.is_admin());
