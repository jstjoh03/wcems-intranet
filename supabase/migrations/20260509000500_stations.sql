-- ─────────────────────────────────────────────────────────────────────
-- 0006_stations
--
-- Replaces the JSON-seed + localStorage-backed `useStationsStore` from
-- Phase 1. The natural key is the medic-unit number as text ("206",
-- "211", etc.) so it lines up with how crews refer to the buildings.
--
-- RLS:
--   • Authenticated users can SELECT all rows (the directory needs them).
--   • Authenticated users can UPDATE rows — but only the door_code
--     column unless they're admin (column-lock trigger below).
--   • Admins can INSERT, UPDATE anything, DELETE.
--
-- Triggers:
--   • stamp_station_door_code_change — BEFORE UPDATE, when door_code
--     changes, sets door_code_updated_at = now() and door_code_updated_by
--     to the caller's full_name. Server-side stamping means the client
--     just sends the new code and trusts the DB for the audit metadata.
--   • audit_station_code_change — AFTER UPDATE, INSERTs a code_edit_history
--     row for every door_code change.
--   • enforce_stations_self_update_columns — column-level lock for
--     non-admins.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.stations (
  id                     text PRIMARY KEY,
  name                   text NOT NULL,
  address                text NOT NULL DEFAULT '',
  city                   text NOT NULL DEFAULT '',
  phone                  text NOT NULL DEFAULT '',
  map_url                text NOT NULL DEFAULT '',
  door_code              text NOT NULL DEFAULT '',
  active                 boolean NOT NULL DEFAULT true,
  door_code_updated_at   timestamptz,
  door_code_updated_by   text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS stations_touch_updated_at ON public.stations;
CREATE TRIGGER stations_touch_updated_at
  BEFORE UPDATE ON public.stations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Column-lock trigger ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_stations_self_update_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN RETURN NEW; END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'stations.id is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION 'stations.name is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.address IS DISTINCT FROM OLD.address THEN
    RAISE EXCEPTION 'stations.address is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.city IS DISTINCT FROM OLD.city THEN
    RAISE EXCEPTION 'stations.city is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.phone IS DISTINCT FROM OLD.phone THEN
    RAISE EXCEPTION 'stations.phone is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.map_url IS DISTINCT FROM OLD.map_url THEN
    RAISE EXCEPTION 'stations.map_url is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.active IS DISTINCT FROM OLD.active THEN
    RAISE EXCEPTION 'stations.active is admin-only' USING ERRCODE = '42501';
  END IF;
  -- door_code, door_code_updated_at, door_code_updated_by allowed
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stations_enforce_self_update_columns ON public.stations;
CREATE TRIGGER stations_enforce_self_update_columns
  BEFORE UPDATE ON public.stations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_stations_self_update_columns();

-- Stamp trigger — sets *_updated_at/by from the caller's identity ───
CREATE OR REPLACE FUNCTION public.stamp_station_door_code_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name text;
BEGIN
  IF NEW.door_code IS DISTINCT FROM OLD.door_code THEN
    SELECT full_name INTO v_user_name FROM public.app_users WHERE id = auth.uid();
    NEW.door_code_updated_at := now();
    NEW.door_code_updated_by := COALESCE(v_user_name, 'Unknown');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stations_stamp_door_code ON public.stations;
CREATE TRIGGER stations_stamp_door_code
  BEFORE UPDATE ON public.stations
  FOR EACH ROW EXECUTE FUNCTION public.stamp_station_door_code_change();

-- Audit trigger — appends to code_edit_history ──────────────────────
CREATE OR REPLACE FUNCTION public.audit_station_code_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name text;
  v_user_id uuid;
BEGIN
  IF NEW.door_code IS DISTINCT FROM OLD.door_code THEN
    v_user_id := auth.uid();
    SELECT full_name INTO v_user_name FROM public.app_users WHERE id = v_user_id;
    INSERT INTO public.code_edit_history
      (entity_type, entity_id, code_field, old_value, new_value, changed_by, changed_by_user_id)
    VALUES
      ('station', NEW.id, 'door',
       COALESCE(OLD.door_code, ''), COALESCE(NEW.door_code, ''),
       COALESCE(v_user_name, 'Unknown'), v_user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stations_audit_door_code ON public.stations;
CREATE TRIGGER stations_audit_door_code
  AFTER UPDATE ON public.stations
  FOR EACH ROW EXECUTE FUNCTION public.audit_station_code_change();

-- RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stations select for authenticated" ON public.stations;
CREATE POLICY "stations select for authenticated"
  ON public.stations FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "stations authenticated update" ON public.stations;
CREATE POLICY "stations authenticated update"
  ON public.stations FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "stations admin all" ON public.stations;
CREATE POLICY "stations admin all"
  ON public.stations FOR ALL
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stations TO authenticated;

-- Seed ──────────────────────────────────────────────────────────────
INSERT INTO public.stations (id, name, address, city, phone, map_url, door_code, active)
VALUES
  ('206', 'Medic 206', '25243 Stockdick School Rd', 'Katy, TX 77493',
   '(979) 221-9202',
   'https://www.google.com/maps/place/25243+Stockdick+School+Rd,+Katy,+TX+77493',
   'App Access', true),
  ('211', 'Medic 211', '905 4th St', 'Hempstead, TX 77445',
   '(713) 875-7164',
   'https://www.google.com/maps/place/905+4th+St,+Hempstead,+TX+77445',
   'Press 4 & 2, then 3', true),
  ('221', 'Medic 221', '612 Walnut St', 'Waller, TX 77484',
   '(713) 875-5171',
   'https://www.google.com/maps?cid=13707604231195849037',
   '2, 3, 4, 5', true),
  ('231', 'Medic 231', '37594 Richard Frey Rd', 'Hempstead, TX 77445',
   '(936) 727-6770',
   'https://www.google.com/maps/place/37594+Richard+Frey+Rd,+Hempstead,+TX+77445',
   '3, 5, 7, 9', true),
  ('242', 'Medic 242', '26156 FM 362', 'Waller, TX 77484',
   '(832) 470-5402',
   'https://www.google.com/maps/place/26156+FM+362,+Waller,+TX+77484',
   'Press 4 & 2, then 3', true),
  ('271', 'Medic 271', '33977 Hoff Rd', 'Brookshire, TX 77423',
   '(713) 875-3787',
   'https://www.google.com/maps/place/33977+Hoff+Rd,+Brookshire,+TX+77423',
   'App Access', true),
  ('281', 'Medic 281', '540 Ellen Powell Dr', 'Prairie View, TX 77445',
   '(713) 875-3787',
   'https://www.google.com/maps/place/540+Ellen+Powell,+Prairie+View,+TX+77445',
   'App Access', true)
ON CONFLICT (id) DO NOTHING;
