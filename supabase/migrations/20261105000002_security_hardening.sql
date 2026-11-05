-- ==============================================================================
-- Hypervision Form Platform - Security Hardening Migration
-- Migration: 20261105000002_security_hardening.sql
-- Fixes: SEC-01, SEC-02, SEC-03, SEC-04, SEC-10
-- ==============================================================================

-- Ensure sap_id column exists on form_responses for respondent email tracking
ALTER TABLE public.form_responses ADD COLUMN IF NOT EXISTS sap_id TEXT;

-- 1. SEC-01: Restrict Profile Visibility to Own User
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;

CREATE POLICY "Users can view their own profile"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

-- 2. SEC-04: Secure Public Form Retrieval RPC (Prevents Form Scraping & Hides Creator ID)
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

-- Grant execution to public / anon and authenticated
GRANT EXECUTE ON FUNCTION public.get_public_form(TEXT) TO anon, authenticated;

-- 3. SEC-02, SEC-03, SEC-10: Atomic Submission & Server-Side Enforcement RPC
CREATE OR REPLACE FUNCTION public.submit_form_response(
    p_form_id UUID,
    p_respondent_email TEXT,
    p_completion_seconds INT,
    p_answers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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

    -- 2. Verify Expiration Date (SEC-03)
    IF (v_form.settings->>'closing_date') IS NOT NULL 
       AND (v_form.settings->>'closing_date') != '' 
       AND NOW() > (v_form.settings->>'closing_date')::TIMESTAMPTZ THEN
        RAISE EXCEPTION 'This form is closed and no longer accepting responses.';
    END IF;

    -- 3. Verify Response Capacity Limit (SEC-03)
    IF (v_form.settings->>'response_limit') IS NOT NULL 
       AND (v_form.settings->>'response_limit') != '' THEN
        SELECT COUNT(*) INTO v_curr_count FROM public.form_responses WHERE form_id = p_form_id;
        IF v_curr_count >= (v_form.settings->>'response_limit')::INT THEN
            RAISE EXCEPTION 'This form has reached its maximum response capacity.';
        END IF;
    END IF;

    -- 4. Verify Server-Side Required Questions Validation (SEC-02)
    SELECT q.label INTO v_missing_required
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

    -- 5. Insert Response Record (SEC-10)
    INSERT INTO public.form_responses (form_id, sap_id, completion_time_seconds, submitted_at)
    VALUES (p_form_id, p_respondent_email, p_completion_seconds, NOW())
    RETURNING id INTO v_response_id;

    -- 6. Insert Answers Atomically (SEC-10)
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_answers) LOOP
        IF v_item->'answer_value' IS NOT NULL AND v_item->>'answer_value' != '' THEN
            v_q_id := (v_item->>'question_id')::UUID;
            INSERT INTO public.form_answers (response_id, question_id, answer_value)
            VALUES (v_response_id, v_q_id, v_item->'answer_value')
            ON CONFLICT (response_id, question_id) 
            DO UPDATE SET answer_value = EXCLUDED.answer_value;
        END IF;
    END LOOP;

    -- 7. Atomically Increment Response Count on Forms (SEC-10)
    UPDATE public.forms
    SET response_count = response_count + 1, updated_at = NOW()
    WHERE id = p_form_id;

    RETURN jsonb_build_object(
        'success', true,
        'response_id', v_response_id
    );
END;
$$;

-- Grant execution to public / anon and authenticated
GRANT EXECUTE ON FUNCTION public.submit_form_response(UUID, TEXT, INT, JSONB) TO anon, authenticated;

-- 4. SEC-10: Trigger to Synchronize response_count on Response Deletion
CREATE OR REPLACE FUNCTION public.handle_response_deleted()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.forms
    SET response_count = GREATEST(0, response_count - 1), updated_at = NOW()
    WHERE id = OLD.form_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_on_response_deleted ON public.form_responses;
CREATE TRIGGER tr_on_response_deleted
    AFTER DELETE ON public.form_responses
    FOR EACH ROW EXECUTE FUNCTION public.handle_response_deleted();

