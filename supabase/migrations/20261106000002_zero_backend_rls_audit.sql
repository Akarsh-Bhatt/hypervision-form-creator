-- ==============================================================================
-- Hypervision Form Platform - Zero-Backend RLS & Security Consolidation
-- Migration: 20261106000002_zero_backend_rls_audit.sql
-- Motive: Unified security, strict RLS, and secure RPCs for direct client-to-Supabase
-- ==============================================================================

-- 0. Standard Schema Grants & Default Privileges
-- Required so PostgREST roles (anon, authenticated) have access to public tables & routines
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

-- 1. Schema Adjustments for Frictionless Workspace Operation
-- 1.1 Backfill any existing auth users into public.profiles (e.g. after schema reset)
INSERT INTO public.profiles (id, email, display_name)
SELECT 
    id, 
    email, 
    COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email, '@', 1))
FROM auth.users
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.forms ALTER COLUMN creator_id DROP NOT NULL;
ALTER TABLE public.forms DROP CONSTRAINT IF EXISTS forms_creator_id_fkey;
ALTER TABLE public.forms 
    ADD CONSTRAINT forms_creator_id_fkey 
    FOREIGN KEY (creator_id) 
    REFERENCES public.profiles(id) 
    ON DELETE SET NULL;

-- Ensure tracking and counter columns exist
ALTER TABLE public.form_responses ADD COLUMN IF NOT EXISTS sap_id TEXT;
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS response_count INTEGER DEFAULT 0;

-- Ensure RLS is active on all operational tables
ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_answers ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- 2. Clean Up Legacy / Overly Permissive Policies
-- ==============================================================================

-- Forms
DROP POLICY IF EXISTS "Allow public full access to forms" ON public.forms;
DROP POLICY IF EXISTS "Public can view published forms" ON public.forms;
DROP POLICY IF EXISTS "Public unauthenticated can view published forms" ON public.forms;
DROP POLICY IF EXISTS "Authorized users can view all forms" ON public.forms;
DROP POLICY IF EXISTS "Authorized users can insert forms" ON public.forms;
DROP POLICY IF EXISTS "Authorized users can update any form" ON public.forms;
DROP POLICY IF EXISTS "Authorized users can delete any form" ON public.forms;
DROP POLICY IF EXISTS "Creators can manage their own forms" ON public.forms;
DROP POLICY IF EXISTS "Workspace authenticated users full access to forms" ON public.forms;

-- Form Questions
DROP POLICY IF EXISTS "Allow public full access to form_questions" ON public.form_questions;
DROP POLICY IF EXISTS "Public can view questions of published forms" ON public.form_questions;
DROP POLICY IF EXISTS "Public unauthenticated can view published form questions" ON public.form_questions;
DROP POLICY IF EXISTS "Creators can manage their form questions" ON public.form_questions;
DROP POLICY IF EXISTS "Authorized users can manage all form questions" ON public.form_questions;
DROP POLICY IF EXISTS "Workspace authenticated users full access to form_questions" ON public.form_questions;

-- Form Responses
DROP POLICY IF EXISTS "Allow public full access to form_responses" ON public.form_responses;
DROP POLICY IF EXISTS "Public can submit responses to published forms" ON public.form_responses;
DROP POLICY IF EXISTS "Public respondents can insert form responses" ON public.form_responses;
DROP POLICY IF EXISTS "Creators can view their form responses" ON public.form_responses;
DROP POLICY IF EXISTS "Creators can delete their form responses" ON public.form_responses;
DROP POLICY IF EXISTS "Authorized users can view all form responses" ON public.form_responses;
DROP POLICY IF EXISTS "Authorized users can delete all form responses" ON public.form_responses;
DROP POLICY IF EXISTS "Workspace authenticated users full access to form responses" ON public.form_responses;
DROP POLICY IF EXISTS "Workspace authenticated users full management of responses" ON public.form_responses;

-- Form Answers
DROP POLICY IF EXISTS "Allow public full access to form_answers" ON public.form_answers;
DROP POLICY IF EXISTS "Public can insert answers for published forms" ON public.form_answers;
DROP POLICY IF EXISTS "Public respondents can insert form answers" ON public.form_answers;
DROP POLICY IF EXISTS "Creators can view form answers" ON public.form_answers;
DROP POLICY IF EXISTS "Authorized users can view all form answers" ON public.form_answers;
DROP POLICY IF EXISTS "Authorized users can delete all form answers" ON public.form_answers;
DROP POLICY IF EXISTS "Workspace authenticated users full access to form answers" ON public.form_answers;
DROP POLICY IF EXISTS "Workspace authenticated users full management of answers" ON public.form_answers;

-- ==============================================================================
-- 3. Configure Precise RLS Policies: Forms & Form Questions
-- ==============================================================================

-- FORMS:
-- a) Public unauthenticated read (SELECT) ONLY when status = 'published'
CREATE POLICY "Public unauthenticated can view published forms"
    ON public.forms FOR SELECT
    TO anon, authenticated
    USING (status = 'published');

-- b) Full CRUD for authenticated workspace user session
CREATE POLICY "Workspace authenticated users full access to forms"
    ON public.forms FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- FORM QUESTIONS:
-- a) Public unauthenticated read (SELECT) ONLY when parent form status = 'published'
CREATE POLICY "Public unauthenticated can view published form questions"
    ON public.form_questions FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.forms f
            WHERE f.id = form_questions.form_id
              AND f.status = 'published'
        )
    );

-- b) Full CRUD for authenticated workspace user session
CREATE POLICY "Workspace authenticated users full access to form_questions"
    ON public.form_questions FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ==============================================================================
-- 4. Configure Precise RLS Policies: Form Responses & Form Answers
-- ==============================================================================

-- FORM RESPONSES:
-- a) Unauthenticated inserts (INSERT) from public respondents on /f/[slug] for published forms
CREATE POLICY "Public respondents can insert form responses"
    ON public.form_responses FOR INSERT
    TO anon, authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.forms f
            WHERE f.id = form_responses.form_id
              AND f.status = 'published'
        )
    );

-- b) Full management (SELECT, UPDATE, DELETE) restricted to authenticated workspace user
CREATE POLICY "Workspace authenticated users full access to form responses"
    ON public.form_responses FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- FORM ANSWERS:
-- a) Unauthenticated inserts (INSERT) from public respondents for published forms
CREATE POLICY "Public respondents can insert form answers"
    ON public.form_answers FOR INSERT
    TO anon, authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.form_responses r
            JOIN public.forms f ON f.id = r.form_id
            WHERE r.id = form_answers.response_id
              AND f.status = 'published'
        )
    );

-- b) Full management (SELECT, UPDATE, DELETE) restricted to authenticated workspace user
CREATE POLICY "Workspace authenticated users full access to form answers"
    ON public.form_answers FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ==============================================================================
-- 5. Public Form Retrieval RPC (SECURITY DEFINER)
-- ==============================================================================
-- Retrieves public form details without exposing internal user IDs or telemetry

CREATE OR REPLACE FUNCTION public.get_public_form(p_identifier TEXT)
RETURNS TABLE (
    id UUID,
    shareable_slug TEXT,
    title TEXT,
    description TEXT,
    status TEXT,
    settings JSONB,
    theme JSONB,
    response_count INT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.shareable_slug,
        f.title,
        f.description,
        f.status,
        f.settings,
        f.theme,
        f.response_count,
        f.created_at,
        f.updated_at
    FROM public.forms f
    WHERE (f.shareable_slug = p_identifier OR f.id::TEXT = p_identifier)
      AND f.status = 'published'
    LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_form(TEXT) TO anon, authenticated;

-- ==============================================================================
-- 6. Stored Procedure: submit_form_response_secure (SECURITY DEFINER)
-- ==============================================================================
-- Guarantees atomic submission of response + answers, validates required rules,
-- checks closing dates & response limits, increments response_count, and avoids
-- client-side RLS permission race conditions.

CREATE OR REPLACE FUNCTION public.submit_form_response_secure(
    p_form_id UUID,
    p_respondent_email TEXT,
    p_completion_seconds INT,
    p_answers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_form public.forms%ROWTYPE;
    v_curr_count INT;
    v_response_id UUID;
    v_missing_required TEXT;
    v_item JSONB;
    v_q_id UUID;
BEGIN
    -- 1. Verify Form Existence & Published Status
    SELECT * INTO v_form FROM public.forms WHERE id = p_form_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Form not found.';
    END IF;

    IF v_form.status != 'published' THEN
        RAISE EXCEPTION 'This form is currently not accepting submissions.';
    END IF;

    -- 2. Verify Expiration Date (if configured in settings)
    IF (v_form.settings->>'closing_date') IS NOT NULL 
       AND (v_form.settings->>'closing_date') != '' 
       AND NOW() > (v_form.settings->>'closing_date')::TIMESTAMPTZ THEN
        RAISE EXCEPTION 'This form is closed and no longer accepting responses.';
    END IF;

    -- 3. Verify Response Capacity Limit (if configured in settings)
    IF (v_form.settings->>'response_limit') IS NOT NULL 
       AND (v_form.settings->>'response_limit') != '' THEN
        SELECT COUNT(*) INTO v_curr_count FROM public.form_responses WHERE form_id = p_form_id;
        IF v_curr_count >= (v_form.settings->>'response_limit')::INT THEN
            RAISE EXCEPTION 'This form has reached its maximum response capacity.';
        END IF;
    END IF;

    -- 4. Verify Server-Side Required Questions Validation
    SELECT COALESCE(q.label, 'Untitled Question') INTO v_missing_required
    FROM public.form_questions q
    WHERE q.form_id = p_form_id 
      AND q.is_required = true
      AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_answers) a
          WHERE (a->>'question_id')::UUID = q.id 
            AND a->'answer_value' IS NOT NULL 
            AND a->>'answer_value' != '' 
            AND a->>'answer_value' != '[]'
      )
    LIMIT 1;

    IF v_missing_required IS NOT NULL THEN
        RAISE EXCEPTION 'Required question "%" must be answered.', v_missing_required;
    END IF;

    -- 5. Insert Response Record
    INSERT INTO public.form_responses (form_id, sap_id, completion_time_seconds, submitted_at)
    VALUES (p_form_id, p_respondent_email, p_completion_seconds, NOW())
    RETURNING id INTO v_response_id;

    -- 6. Insert Answers Atomically
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_answers) LOOP
        IF v_item->'answer_value' IS NOT NULL AND v_item->>'answer_value' != '' THEN
            v_q_id := (v_item->>'question_id')::UUID;
            INSERT INTO public.form_answers (response_id, question_id, answer_value)
            VALUES (v_response_id, v_q_id, v_item->'answer_value')
            ON CONFLICT (response_id, question_id) 
            DO UPDATE SET answer_value = EXCLUDED.answer_value;
        END IF;
    END LOOP;

    -- 7. Atomically Increment Response Count on Forms
    UPDATE public.forms
    SET response_count = COALESCE(response_count, 0) + 1, updated_at = NOW()
    WHERE id = p_form_id;

    RETURN jsonb_build_object(
        'success', true,
        'response_id', v_response_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_form_response_secure(UUID, TEXT, INT, JSONB) TO anon, authenticated;

-- Also maintain submit_form_response as a transparent alias to submit_form_response_secure
CREATE OR REPLACE FUNCTION public.submit_form_response(
    p_form_id UUID,
    p_respondent_email TEXT,
    p_completion_seconds INT,
    p_answers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN public.submit_form_response_secure(p_form_id, p_respondent_email, p_completion_seconds, p_answers);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_form_response(UUID, TEXT, INT, JSONB) TO anon, authenticated;

-- ==============================================================================
-- 7. Trigger to Synchronize response_count on Response Deletion
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_response_deleted()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.forms
    SET response_count = GREATEST(0, COALESCE(response_count, 1) - 1), updated_at = NOW()
    WHERE id = OLD.form_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_on_response_deleted ON public.form_responses;
CREATE TRIGGER tr_on_response_deleted
    AFTER DELETE ON public.form_responses
    FOR EACH ROW EXECUTE FUNCTION public.handle_response_deleted();
