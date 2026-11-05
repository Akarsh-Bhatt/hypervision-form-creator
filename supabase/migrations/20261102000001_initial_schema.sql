-- ==============================================================================
-- Hypervision Form Platform - Initial Database Schema & Security Policies
-- Migration: 20261102000001_initial_schema.sql
-- ==============================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. Utility Functions & Automated Triggers
-- ==============================================================================

-- Trigger function to automatically update `updated_at` timestamps
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to automatically create a user profile record on auth.users signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, display_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- 3. Table Definitions
-- ==============================================================================

-- 3.1 Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.2 Forms Table
CREATE TABLE IF NOT EXISTS public.forms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    shareable_slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL DEFAULT 'Untitled Form',
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
    settings JSONB NOT NULL DEFAULT '{
        "allow_multiple_responses": true,
        "response_limit": null,
        "confirmation_message": "Your response has been recorded.",
        "closing_date": null
    }'::jsonb,
    theme JSONB NOT NULL DEFAULT '{
        "primary_color": "#3B82F6",
        "background_color": "#F8FAFC",
        "font_family": "sans",
        "header_image_url": null
    }'::jsonb,
    response_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.3 Form Questions Table
CREATE TABLE IF NOT EXISTS public.form_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id UUID NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
    field_key TEXT NOT NULL,
    question_type TEXT NOT NULL CHECK (question_type IN (
        'short_text',
        'long_text',
        'multiple_choice',
        'checkboxes',
        'dropdown',
        'rating',
        'date',
        'file_upload'
    )),
    label TEXT NOT NULL DEFAULT 'Untitled Question',
    description TEXT DEFAULT '',
    order_index INTEGER NOT NULL DEFAULT 0,
    is_required BOOLEAN NOT NULL DEFAULT false,
    validation_rules JSONB NOT NULL DEFAULT '{
        "min_length": null,
        "max_length": null,
        "min_selections": null,
        "max_selections": null,
        "regex_pattern": null,
        "max_file_size_mb": 10,
        "allowed_file_types": []
    }'::jsonb,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_form_field_key UNIQUE (form_id, field_key)
);

-- 3.4 Form Responses Table
CREATE TABLE IF NOT EXISTS public.form_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id UUID NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
    respondent_ip TEXT,
    completion_time_seconds INTEGER,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.5 Form Answers Table
CREATE TABLE IF NOT EXISTS public.form_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    response_id UUID NOT NULL REFERENCES public.form_responses(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.form_questions(id) ON DELETE CASCADE,
    answer_value JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_response_question UNIQUE (response_id, question_id)
);

-- ==============================================================================
-- 4. Indexes for Performance
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_forms_creator_id ON public.forms(creator_id);
CREATE INDEX IF NOT EXISTS idx_forms_shareable_slug ON public.forms(shareable_slug);
CREATE INDEX IF NOT EXISTS idx_form_questions_form_order ON public.form_questions(form_id, order_index);
CREATE INDEX IF NOT EXISTS idx_form_responses_form_id ON public.form_responses(form_id);
CREATE INDEX IF NOT EXISTS idx_form_responses_submitted_at ON public.form_responses(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_answers_response_id ON public.form_answers(response_id);
CREATE INDEX IF NOT EXISTS idx_form_answers_question_id ON public.form_answers(question_id);

-- ==============================================================================
-- 5. Attach Triggers
-- ==============================================================================

-- Automated signup profile creation trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at triggers
DROP TRIGGER IF EXISTS tr_profiles_updated_at ON public.profiles;
CREATE TRIGGER tr_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_forms_updated_at ON public.forms;
CREATE TRIGGER tr_forms_updated_at
    BEFORE UPDATE ON public.forms
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_form_questions_updated_at ON public.form_questions;
CREATE TRIGGER tr_form_questions_updated_at
    BEFORE UPDATE ON public.form_questions
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- 6. Row-Level Security (RLS) Configuration
-- ==============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_answers ENABLE ROW LEVEL SECURITY;

-- 6.1 Profiles Policies
CREATE POLICY "Users can view their own profile"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id);

-- 6.2 Forms Policies
-- Creators have full CRUD on their own forms
CREATE POLICY "Creators can manage their own forms"
    ON public.forms FOR ALL
    USING (auth.uid() = creator_id)
    WITH CHECK (auth.uid() = creator_id);

-- Public respondents can read published forms
CREATE POLICY "Public can view published forms"
    ON public.forms FOR SELECT
    USING (status = 'published');

-- 6.3 Form Questions Policies
-- Creators can manage questions of forms they own
CREATE POLICY "Creators can manage their form questions"
    ON public.form_questions FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.forms
            WHERE forms.id = form_questions.form_id
            AND forms.creator_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.forms
            WHERE forms.id = form_questions.form_id
            AND forms.creator_id = auth.uid()
        )
    );

-- Public respondents can view questions for published forms
CREATE POLICY "Public can view questions of published forms"
    ON public.form_questions FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.forms
            WHERE forms.id = form_questions.form_id
            AND forms.status = 'published'
        )
    );

-- 6.4 Form Responses Policies
-- Creators can view and delete responses to their forms
CREATE POLICY "Creators can view their form responses"
    ON public.form_responses FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.forms
            WHERE forms.id = form_responses.form_id
            AND forms.creator_id = auth.uid()
        )
    );

CREATE POLICY "Creators can delete their form responses"
    ON public.form_responses FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.forms
            WHERE forms.id = form_responses.form_id
            AND forms.creator_id = auth.uid()
        )
    );

-- Public can submit responses to published forms
CREATE POLICY "Public can submit responses to published forms"
    ON public.form_responses FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.forms
            WHERE forms.id = form_responses.form_id
            AND forms.status = 'published'
        )
    );

-- 6.5 Form Answers Policies
-- Creators can view answers to their forms
CREATE POLICY "Creators can view form answers"
    ON public.form_answers FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.form_responses
            JOIN public.forms ON forms.id = form_responses.form_id
            WHERE form_responses.id = form_answers.response_id
            AND forms.creator_id = auth.uid()
        )
    );

-- Public can insert answers for submitted responses
CREATE POLICY "Public can insert answers for published forms"
    ON public.form_answers FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.form_responses
            JOIN public.forms ON forms.id = form_responses.form_id
            WHERE form_responses.id = form_answers.response_id
            AND forms.status = 'published'
        )
    );

-- ==============================================================================
-- 7. Supabase Storage Buckets Setup
-- ==============================================================================

-- Create storage buckets if the storage schema exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('form-assets', 'form-assets', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('respondent-uploads', 'respondent-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- Public read access for form-assets
CREATE POLICY "Public can read form assets"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'form-assets');

-- Creators can upload form assets
CREATE POLICY "Authenticated users can upload form assets"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'form-assets' AND auth.role() = 'authenticated');
