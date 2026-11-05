-- ==============================================================================
-- Hypervision Form Platform - Update Admin Credentials
-- Migration: 20261105000005_update_admin_credentials.sql
-- ==============================================================================

-- 1. Designate admin@gmail.com as the Sole Platform Administrator in Profiles
UPDATE public.profiles
SET 
    role = 'admin',
    is_approved = true,
    display_name = 'Admin',
    approved_at = COALESCE(approved_at, NOW())
WHERE LOWER(email) = 'admin@gmail.com';

-- Demote any previous admin
UPDATE public.profiles
SET 
    role = 'user'
WHERE LOWER(email) != 'admin@gmail.com';

-- 2. Update New User Trigger to Grant Admin Exclusively to admin@gmail.com
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_role TEXT := 'user';
    v_approved BOOLEAN := false;
BEGIN
    -- Only admin@gmail.com is auto-approved as the sole administrator
    IF LOWER(NEW.email) = 'admin@gmail.com' THEN
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
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'Admin'),
        NEW.raw_user_meta_data->>'avatar_url',
        v_role,
        v_approved,
        CASE WHEN v_approved THEN NOW() ELSE NULL END
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name),
        role = EXCLUDED.role,
        is_approved = EXCLUDED.is_approved;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update Workspace Authorization Helper Function
CREATE OR REPLACE FUNCTION public.is_authorized_workspace_user()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    -- Check if current authenticated user is the designated admin (admin@gmail.com)
    IF LOWER(COALESCE(auth.jwt() ->> 'email', '')) = 'admin@gmail.com' THEN
        RETURN true;
    END IF;

    -- Check if current authenticated user has approval in jwt metadata
    IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_approved')::boolean, false) = true
       OR COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_approved')::boolean, false) = true THEN
        RETURN true;
    END IF;

    -- Fallback: Check profiles table for is_approved or admin role
    IF EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND (is_approved = true OR role = 'admin' OR LOWER(email) = 'admin@gmail.com')
    ) THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_authorized_workspace_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_authorized_workspace_user() TO anon;

