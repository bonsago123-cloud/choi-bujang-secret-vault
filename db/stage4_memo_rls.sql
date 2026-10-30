-- Stage 4: recorded policies already applied through Supabase SQL Editor.
-- Safe scope: the two existing learning note tables only; no data values are stored here.
BEGIN;

REVOKE ALL ON TABLE public.study_notes, public.user_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.study_notes, public.user_notes TO authenticated;

ALTER TABLE public.study_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS study_notes_own_select ON public.study_notes;
DROP POLICY IF EXISTS study_notes_own_insert ON public.study_notes;
DROP POLICY IF EXISTS study_notes_own_update ON public.study_notes;
DROP POLICY IF EXISTS study_notes_own_delete ON public.study_notes;
DROP POLICY IF EXISTS user_notes_own_select ON public.user_notes;
DROP POLICY IF EXISTS user_notes_own_insert ON public.user_notes;
DROP POLICY IF EXISTS user_notes_own_update ON public.user_notes;
DROP POLICY IF EXISTS user_notes_own_delete ON public.user_notes;

CREATE POLICY study_notes_own_select ON public.study_notes FOR SELECT TO authenticated
USING ((SELECT auth.uid()) = owner_id);
CREATE POLICY study_notes_own_insert ON public.study_notes FOR INSERT TO authenticated
WITH CHECK ((SELECT auth.uid()) = owner_id);
CREATE POLICY study_notes_own_update ON public.study_notes FOR UPDATE TO authenticated
USING ((SELECT auth.uid()) = owner_id) WITH CHECK ((SELECT auth.uid()) = owner_id);
CREATE POLICY study_notes_own_delete ON public.study_notes FOR DELETE TO authenticated
USING ((SELECT auth.uid()) = owner_id);

CREATE POLICY user_notes_own_select ON public.user_notes FOR SELECT TO authenticated
USING ((SELECT auth.uid()) = owner_id);
CREATE POLICY user_notes_own_insert ON public.user_notes FOR INSERT TO authenticated
WITH CHECK ((SELECT auth.uid()) = owner_id);
CREATE POLICY user_notes_own_update ON public.user_notes FOR UPDATE TO authenticated
USING ((SELECT auth.uid()) = owner_id) WITH CHECK ((SELECT auth.uid()) = owner_id);
CREATE POLICY user_notes_own_delete ON public.user_notes FOR DELETE TO authenticated
USING ((SELECT auth.uid()) = owner_id);

COMMIT;
