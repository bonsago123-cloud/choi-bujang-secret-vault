-- Stage 11: operator-reviewed, device-bound WebAuthn approvals.
-- Run only in the intended defense-r5-learning project, after reviewing backups.
-- No existing study_notes/user_notes rows or policies are changed.
BEGIN;
CREATE TABLE IF NOT EXISTS public.device_approval_requests (
  credential_id text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_code text NOT NULL UNIQUE,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  last_verified_at timestamptz
);
CREATE INDEX IF NOT EXISTS device_approval_owner_idx ON public.device_approval_requests(owner_id);
CREATE TABLE IF NOT EXISTS public.device_auth_challenges (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('register','authenticate')),
  challenge text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_challenges_owner_idx ON public.device_auth_challenges(owner_id,expires_at);
CREATE TABLE IF NOT EXISTS public.device_verified_sessions (
  token_hash text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id text NOT NULL REFERENCES public.device_approval_requests(credential_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_sessions_owner_idx ON public.device_verified_sessions(owner_id,expires_at);

ALTER TABLE public.device_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_verified_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_approval_requests, public.device_auth_challenges, public.device_verified_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_approval_requests, public.device_auth_challenges, public.device_verified_sessions TO service_role;
-- No client RLS policies. Only trusted service-role server operations may read/write.
-- Administrators review a pending request in the SQL Editor. Never grant browser users UPDATE.
COMMIT;

-- Operator-only example (DO NOT auto-execute and do not paste private credentials):
-- SELECT owner_id, request_code, status FROM public.device_approval_requests WHERE status='pending';
-- UPDATE public.device_approval_requests SET status='approved', reviewed_at=now()
-- WHERE request_code='<verified nonsecret request code>' AND status='pending';
