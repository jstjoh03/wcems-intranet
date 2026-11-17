-- ─────────────────────────────────────────────────────────────────────
-- Wallet → compliance sync (Justin, 2026-11-17)
--
-- A volunteer's wallet cert whose NAME matches a tracked requirement
-- (case-insensitive, same rule as cert-import's fallback) also writes
-- a pipeline_requirement_completions row (source 'wallet') — so the
-- compliance board, Action Center buckets and compliance report pick
-- it up exactly like a Paycom import. Non-matching names stay
-- wallet-only. Editing or deleting the wallet cert keeps its
-- completion in step; expirations snap to end of month only for
-- cycle='certification' (AHA cards print month/year — cert-import's
-- rule, mirrored).
--
-- The completion date is the card's issue date, falling back to its
-- expiration when no issue date was entered; a cert with neither
-- date syncs nothing (same as cert-import's missingStart skip).
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.employee_certs_sync_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req_id uuid;
  req_cycle text;
  d date;
  exp date;
BEGIN
  /* Remove the completion the OLD row had produced (if any). */
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT r.id INTO req_id
    FROM public.pipeline_requirements r
    WHERE lower(trim(r.name)) = lower(trim(OLD.name))
    LIMIT 1;
    d := coalesce(OLD.issued_on, OLD.expires_on);
    IF req_id IS NOT NULL AND d IS NOT NULL THEN
      DELETE FROM public.pipeline_requirement_completions
      WHERE requirement_id = req_id
        AND user_id = OLD.user_id
        AND completed_at = d
        AND source = 'wallet';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  /* Write the completion for the NEW row. */
  SELECT r.id, r.cycle INTO req_id, req_cycle
  FROM public.pipeline_requirements r
  WHERE r.active AND lower(trim(r.name)) = lower(trim(NEW.name))
  LIMIT 1;
  d := coalesce(NEW.issued_on, NEW.expires_on);
  IF req_id IS NULL OR d IS NULL THEN
    RETURN NEW;
  END IF;

  exp := NEW.expires_on;
  IF exp IS NOT NULL AND req_cycle = 'certification' THEN
    exp := (date_trunc('month', exp) + interval '1 month - 1 day')::date;
  END IF;

  INSERT INTO public.pipeline_requirement_completions
    (requirement_id, user_id, completed_at, expires_at, source, note)
  VALUES
    (req_id, NEW.user_id, d, exp, 'wallet', 'Self-uploaded in My Certifications')
  ON CONFLICT (requirement_id, user_id, completed_at)
  DO UPDATE SET expires_at = excluded.expires_at, source = 'wallet',
                note = excluded.note, updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employee_certs_sync_completion ON public.employee_certs;
CREATE TRIGGER employee_certs_sync_completion
  AFTER INSERT OR UPDATE OR DELETE ON public.employee_certs
  FOR EACH ROW EXECUTE FUNCTION public.employee_certs_sync_completion();
