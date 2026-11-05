-- ==============================================================================
-- Hypervision Form Platform - Single Shared Workspace & Common Dashboard
-- Migration: 20261105000004_shared_workspace_common_dashboard.sql
-- ==============================================================================

-- 1. Function to Verify If Current Authenticated User Is Authorized
CREATE OR REPLACE FUNCTION public.is_authorized_workspace_user()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    -- Check if current authenticated user is the designated admin Akarsh
    IF LOWER(COALESCE(auth.jwt() ->> 'email', '')) = 'akarsh.bhatt2007@gmail.com' THEN
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
          AND (is_approved = true OR role = 'admin' OR LOWER(email) = 'akarsh.bhatt2007@gmail.com')
    ) THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_authorized_workspace_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_authorized_workspace_user() TO anon;

-- 2. Update Forms Policies: All Authorized Users Share 1 Common Dashboard & Can Edit/Publish Any Form
DROP POLICY IF EXISTS "Creators can manage their own forms" ON public.forms;
DROP POLICY IF EXISTS "Authorized users can view all forms" ON public.forms;
DROP POLICY IF EXISTS "Authorized users can insert forms" ON public.forms;
DROP POLICY IF EXISTS "Authorized users can update any form" ON public.forms;
DROP POLICY IF EXISTS "Authorized users can delete any form" ON public.forms;

-- Authorized users can view all forms across the workspace
CREATE POLICY "Authorized users can view all forms"
    ON public.forms FOR SELECT
    TO authenticated
    USING (public.is_authorized_workspace_user());

-- Authorized users can create new forms
CREATE POLICY "Authorized users can insert forms"
    ON public.forms FOR INSERT
    TO authenticated
    WITH CHECK (public.is_authorized_workspace_user());

-- Any authorized user can update, edit, or publish/unpublish any form
CREATE POLICY "Authorized users can update any form"
    ON public.forms FOR UPDATE
    TO authenticated
    USING (public.is_authorized_workspace_user())
    WITH CHECK (public.is_authorized_workspace_user());

-- Any authorized user can delete forms
CREATE POLICY "Authorized users can delete any form"
    ON public.forms FOR DELETE
    TO authenticated
    USING (public.is_authorized_workspace_user());

-- (Public can still view published forms for public submission)
-- Policy "Public can view published forms" remains intact.

-- 3. Update Form Questions Policies: Any Authorized User Can Manage Questions for Any Form
DROP POLICY IF EXISTS "Creators can manage their form questions" ON public.form_questions;
DROP POLICY IF EXISTS "Authorized users can manage all form questions" ON public.form_questions;

CREATE POLICY "Authorized users can manage all form questions"
    ON public.form_questions FOR ALL
    TO authenticated
    USING (public.is_authorized_workspace_user())
    WITH CHECK (public.is_authorized_workspace_user());

-- 4. Update Form Responses Policies: Any Authorized User Can View and Manage Responses
DROP POLICY IF EXISTS "Creators can view their form responses" ON public.form_responses;
DROP POLICY IF EXISTS "Creators can delete their form responses" ON public.form_responses;
DROP POLICY IF EXISTS "Authorized users can view all form responses" ON public.form_responses;
DROP POLICY IF EXISTS "Authorized users can delete all form responses" ON public.form_responses;

CREATE POLICY "Authorized users can view all form responses"
    ON public.form_responses FOR SELECT
    TO authenticated
    USING (public.is_authorized_workspace_user());

CREATE POLICY "Authorized users can delete all form responses"
    ON public.form_responses FOR DELETE
    TO authenticated
    USING (public.is_authorized_workspace_user());

-- 5. Update Form Answers Policies: Any Authorized User Can View and Delete Answers
DROP POLICY IF EXISTS "Creators can view form answers" ON public.form_answers;
DROP POLICY IF EXISTS "Authorized users can view all form answers" ON public.form_answers;
DROP POLICY IF EXISTS "Authorized users can delete all form answers" ON public.form_answers;

CREATE POLICY "Authorized users can view all form answers"
    ON public.form_answers FOR SELECT
    TO authenticated
    USING (public.is_authorized_workspace_user());

CREATE POLICY "Authorized users can delete all form answers"
    ON public.form_answers FOR DELETE
    TO authenticated
    USING (public.is_authorized_workspace_user());

