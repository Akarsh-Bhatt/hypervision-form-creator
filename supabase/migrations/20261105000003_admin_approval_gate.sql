-- ==============================================================================
-- Hypervision Form Platform - Admin Approval Gate & Role-Based Access Control
-- Migration: 20261105000003_admin_approval_gate.sql
-- ==============================================================================

-- 1. Add Role and Approval Columns to Profiles Table
ALTER TABLE public.profiles 
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id);

-- 2. Designate Akarsh as the Sole Platform Administrator
UPDATE public.profiles
SET 
    role = 'admin',
    is_approved = true,
    approved_at = COALESCE(approved_at, NOW())
WHERE LOWER(email) = 'akarsh.bhatt2007@gmail.com';

UPDATE public.profiles
SET 
    role = 'user'
WHERE LOWER(email) != 'akarsh.bhatt2007@gmail.com';

-- 3. Trigger Function: Only Akarsh is Admin, All Other Signups Require Admin Approval
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_role TEXT := 'user';
    v_approved BOOLEAN := false;
BEGIN
    -- Only Akarsh is auto-approved as the sole administrator
    IF LOWER(NEW.email) = 'akarsh.bhatt2007@gmail.com' THEN
        v_role := 'admin';
        v_approved := true;
    ELSE
        v_role := 'user';
        v_approved := false;
    END IF;

    INSERT INTO public.profiles (
        id,
        email,
        display_name,
        avatar_url,
        role,
        is_approved,
        approved_at
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        NEW.raw_user_meta_data->>'avatar_url',
        v_role,
        v_approved,
        CASE WHEN v_approved THEN NOW() ELSE NULL END
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RLS Policies for Profiles:
-- Users can read their own profile (to verify their approval & role status)
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

-- Admins can view all user profiles (to review pending registration requests)
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles admin_p
            WHERE admin_p.id = auth.uid() 
              AND admin_p.role = 'admin' 
              AND admin_p.is_approved = true
        )
    );

-- Admins can update profile approval status and roles
DROP POLICY IF EXISTS "Admins can update user approval and role" ON public.profiles;
CREATE POLICY "Admins can update user approval and role"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles admin_p
            WHERE admin_p.id = auth.uid() 
              AND admin_p.role = 'admin' 
              AND admin_p.is_approved = true
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles admin_p
            WHERE admin_p.id = auth.uid() 
              AND admin_p.role = 'admin' 
              AND admin_p.is_approved = true
        )
    );

-- 5. Helper RPC Functions for Admin User Approval
CREATE OR REPLACE FUNCTION public.get_pending_users()
RETURNS TABLE (
    id UUID,
    email TEXT,
    display_name TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Verify the requester is an approved administrator
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role = 'admin' AND profiles.is_approved = true
    ) THEN
        RAISE EXCEPTION 'Access denied. Administrator privileges required.';
    END IF;

    RETURN QUERY
    SELECT p.id, p.email, p.display_name, p.created_at
    FROM public.profiles p
    WHERE p.is_approved = false
    ORDER BY p.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_user(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role = 'admin' AND profiles.is_approved = true
    ) THEN
        RAISE EXCEPTION 'Access denied. Administrator privileges required.';
    END IF;

    UPDATE public.profiles
    SET 
        role = 'user',
        is_approved = true,
        approved_at = NOW(),
        approved_by = auth.uid()
    WHERE id = p_user_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_user(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role = 'admin' AND profiles.is_approved = true
    ) THEN
        RAISE EXCEPTION 'Access denied. Administrator privileges required.';
    END IF;

    -- Delete unapproved profile
    DELETE FROM public.profiles WHERE id = p_user_id AND is_approved = false;

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_user(UUID) TO authenticated;

