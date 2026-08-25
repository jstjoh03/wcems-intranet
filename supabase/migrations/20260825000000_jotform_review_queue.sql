-- Jotform review queue (Justin, 2026-08-25): incoming call evaluations
-- no longer auto-file. EVERY submission — live webhook or historical
-- backfill — lands here as 'pending'; Justin/Heather decide per
-- submission: accept into the employee's file (choosing whether it
-- counts toward the required 10) or reject with a documented reason.
-- Rejected rows are kept as the record of the decision.
ALTER TABLE public.jotform_inbox
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','rejected')),
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evaluator_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS eval_date date,
  ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS report_id uuid REFERENCES public.ftep_reports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jotform_inbox_status_idx ON public.jotform_inbox (status);
