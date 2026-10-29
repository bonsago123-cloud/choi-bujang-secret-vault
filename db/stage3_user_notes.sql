-- Stage 3 training only: new table; existing study_notes (4 synthetic samples) is unchanged.
-- No owner check on /api/memos/:id routes until Stage 4; do not put real personal data here.
CREATE TABLE IF NOT EXISTS public.user_notes (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (char_length(body) <= 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;
-- Only the server-side privileged Supabase client is used for this training stage.
-- Do not grant direct Data API access to browser roles.
REVOKE ALL ON TABLE public.user_notes FROM anon, authenticated;
