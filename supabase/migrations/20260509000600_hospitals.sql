-- ─────────────────────────────────────────────────────────────────────
-- 0007_hospitals
--
-- Replaces the JSON-seed + localStorage-backed `useHospitalsStore` from
-- Phase 1. Same RLS shape as `stations` (auth read all, auth update door
-- codes only via column-lock trigger, admin all). Maternal and NICU
-- levels stay text rather than enums because the values are descriptive
-- strings ("Level II (Specialty Care)") that read well in the UI as-is.
-- Trauma + stroke are enums because their value sets are tight.
-- ─────────────────────────────────────────────────────────────────────

-- Enums ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.trauma_level
    AS ENUM ('I', 'II', 'III', 'IV', 'In Pursuit II', 'N');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.stroke_level
    AS ENUM ('Comprehensive', 'Primary', 'N');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.hospitals (
  id                     text PRIMARY KEY,
  name                   text NOT NULL,
  trauma                 public.trauma_level NOT NULL DEFAULT 'N',
  stroke                 public.stroke_level NOT NULL DEFAULT 'N',
  pci_capable            boolean NOT NULL DEFAULT false,
  maternal_level         text,
  nicu_level             text,
  is_pediatric           boolean NOT NULL DEFAULT false,
  address                text NOT NULL DEFAULT '',
  map_url                text NOT NULL DEFAULT '',
  er_door_code           text,
  ems_room_code          text,
  no_door_code           boolean NOT NULL DEFAULT false,
  notes                  text,
  code_effective_from    date,
  active                 boolean NOT NULL DEFAULT true,
  door_code_updated_at   timestamptz,
  door_code_updated_by   text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS hospitals_touch_updated_at ON public.hospitals;
CREATE TRIGGER hospitals_touch_updated_at
  BEFORE UPDATE ON public.hospitals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Column-lock trigger ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_hospitals_self_update_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN RETURN NEW; END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'hospitals.id is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION 'hospitals.name is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.trauma IS DISTINCT FROM OLD.trauma THEN
    RAISE EXCEPTION 'hospitals.trauma is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.stroke IS DISTINCT FROM OLD.stroke THEN
    RAISE EXCEPTION 'hospitals.stroke is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.pci_capable IS DISTINCT FROM OLD.pci_capable THEN
    RAISE EXCEPTION 'hospitals.pci_capable is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.maternal_level IS DISTINCT FROM OLD.maternal_level THEN
    RAISE EXCEPTION 'hospitals.maternal_level is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.nicu_level IS DISTINCT FROM OLD.nicu_level THEN
    RAISE EXCEPTION 'hospitals.nicu_level is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.is_pediatric IS DISTINCT FROM OLD.is_pediatric THEN
    RAISE EXCEPTION 'hospitals.is_pediatric is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.address IS DISTINCT FROM OLD.address THEN
    RAISE EXCEPTION 'hospitals.address is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.map_url IS DISTINCT FROM OLD.map_url THEN
    RAISE EXCEPTION 'hospitals.map_url is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.no_door_code IS DISTINCT FROM OLD.no_door_code THEN
    RAISE EXCEPTION 'hospitals.no_door_code is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.notes IS DISTINCT FROM OLD.notes THEN
    RAISE EXCEPTION 'hospitals.notes is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.code_effective_from IS DISTINCT FROM OLD.code_effective_from THEN
    RAISE EXCEPTION 'hospitals.code_effective_from is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.active IS DISTINCT FROM OLD.active THEN
    RAISE EXCEPTION 'hospitals.active is admin-only' USING ERRCODE = '42501';
  END IF;
  -- er_door_code, ems_room_code, door_code_updated_at, door_code_updated_by allowed
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hospitals_enforce_self_update_columns ON public.hospitals;
CREATE TRIGGER hospitals_enforce_self_update_columns
  BEFORE UPDATE ON public.hospitals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hospitals_self_update_columns();

-- Stamp trigger ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_hospital_door_code_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name text;
BEGIN
  IF NEW.er_door_code IS DISTINCT FROM OLD.er_door_code
     OR NEW.ems_room_code IS DISTINCT FROM OLD.ems_room_code THEN
    SELECT full_name INTO v_user_name FROM public.app_users WHERE id = auth.uid();
    NEW.door_code_updated_at := now();
    NEW.door_code_updated_by := COALESCE(v_user_name, 'Unknown');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hospitals_stamp_door_code ON public.hospitals;
CREATE TRIGGER hospitals_stamp_door_code
  BEFORE UPDATE ON public.hospitals
  FOR EACH ROW EXECUTE FUNCTION public.stamp_hospital_door_code_change();

-- Audit trigger ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.audit_hospital_code_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name text;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  SELECT full_name INTO v_user_name FROM public.app_users WHERE id = v_user_id;

  IF NEW.er_door_code IS DISTINCT FROM OLD.er_door_code THEN
    INSERT INTO public.code_edit_history
      (entity_type, entity_id, code_field, old_value, new_value, changed_by, changed_by_user_id)
    VALUES
      ('hospital', NEW.id, 'er',
       COALESCE(OLD.er_door_code, ''), COALESCE(NEW.er_door_code, ''),
       COALESCE(v_user_name, 'Unknown'), v_user_id);
  END IF;

  IF NEW.ems_room_code IS DISTINCT FROM OLD.ems_room_code THEN
    INSERT INTO public.code_edit_history
      (entity_type, entity_id, code_field, old_value, new_value, changed_by, changed_by_user_id)
    VALUES
      ('hospital', NEW.id, 'ems_room',
       COALESCE(OLD.ems_room_code, ''), COALESCE(NEW.ems_room_code, ''),
       COALESCE(v_user_name, 'Unknown'), v_user_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hospitals_audit_door_code ON public.hospitals;
CREATE TRIGGER hospitals_audit_door_code
  AFTER UPDATE ON public.hospitals
  FOR EACH ROW EXECUTE FUNCTION public.audit_hospital_code_change();

-- RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public.hospitals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hospitals select for authenticated" ON public.hospitals;
CREATE POLICY "hospitals select for authenticated"
  ON public.hospitals FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "hospitals authenticated update" ON public.hospitals;
CREATE POLICY "hospitals authenticated update"
  ON public.hospitals FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "hospitals admin all" ON public.hospitals;
CREATE POLICY "hospitals admin all"
  ON public.hospitals FOR ALL
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hospitals TO authenticated;

-- Seed (23 rows from src/data/hospitals.json) ───────────────────────
INSERT INTO public.hospitals (
  id, name, trauma, stroke, pci_capable, maternal_level, nicu_level,
  is_pediatric, address, map_url, er_door_code, ems_room_code,
  no_door_code, notes, code_effective_from, active
) VALUES
  ('bellville-er', 'Bellville Medical Center Emergency Room',
   'N', 'N', false, NULL, NULL, false,
   '44 N Cummings Rd, Bellville, TX 77418',
   'https://maps.app.goo.gl/DTGk988JKP1xCxxP6',
   NULL, NULL, true, 'Ring door bell — no door code', NULL, true),
  ('hca-north-cypress', 'HCA Houston · North Cypress',
   'III', 'Comprehensive', true, NULL, NULL, false,
   '21214 Northwest Fwy, Cypress, TX 77429',
   'https://maps.app.goo.gl/qECtBdAmkawCrLGC7',
   '0911', '119', false, NULL, NULL, true),
  ('hca-tomball', 'HCA Houston · Tomball',
   'III', 'Primary', true, 'Level II (Specialty Care)', 'Level II (Specialty Care)', false,
   '605 Holderrieth Blvd, Tomball, TX 77375',
   'https://maps.app.goo.gl/A5qoyKKHZWa3s3NW8',
   '605*', NULL, false, NULL, NULL, true),
  ('memorial-hermann-cypress', 'Memorial Hermann · Cypress',
   'III', 'Primary', true, 'Level II (Specialty Care)', 'Level II (Specialty Care)', false,
   '27800 Northwest Fwy, Cypress, TX 77433',
   'https://maps.app.goo.gl/T4YoaaEt3RC7bbTu9',
   '0911', NULL, false, NULL, NULL, true),
  ('memorial-hermann-katy', 'Memorial Hermann · Katy',
   'In Pursuit II', 'Primary', true, 'Level II (Specialty Care)', 'Level III (ICU)', false,
   '23900 Katy Fwy, Katy, TX 77494',
   'https://maps.app.goo.gl/tdep3EtKgSdZjVWFA',
   '0911#', '0911', false, 'In active pursuit of Trauma Level II designation', NULL, true),
  ('memorial-hermann-tmc', 'Memorial Hermann · Texas Medical Center',
   'I', 'Comprehensive', true, 'Level IV (Comprehensive)', 'Level IV (AICU)', false,
   '6411 Fannin St, Houston, TX 77030',
   'https://maps.app.goo.gl/bZKVyqRSUBtGHTy48',
   '0911', NULL, false, NULL, NULL, true),
  ('houston-methodist-cypress', 'Houston Methodist · Cypress',
   'N', 'N', true, 'Level I (Basic)', 'Level I (Well Nursery)', false,
   '24500 Northwest Fwy, Cypress, TX 77429',
   'https://maps.app.goo.gl/LLpZaxxr1376pNVz6',
   '31415', '31415', false,
   'Codes change annually — current code effective May 13, 2026', '2026-05-13', true),
  ('houston-methodist-ecc-cypress', 'Houston Methodist Emergency Care Center · Cypress',
   'N', 'N', false, NULL, NULL, false,
   '27560 US-290 Frontage Rd, Cypress, TX 77433',
   'https://maps.app.goo.gl/4ToBDRHLubTgVHS99',
   '911', NULL, false, NULL, NULL, true),
  ('houston-methodist-west', 'Houston Methodist · West',
   'N', 'Primary', true, 'Level II (Specialty Care)', 'Level III (ICU)', false,
   '18500 Katy Fwy, Houston, TX 77094',
   'https://maps.app.goo.gl/nhZt2kHrkmnyx2ex5',
   '1800*', NULL, false, NULL, NULL, true),
  ('houston-methodist-woodlands', 'Houston Methodist · The Woodlands',
   'N', 'Comprehensive', true, 'Level III (Subspecialty)', 'Level III (ICU)', false,
   '17201 I-45, Conroe, TX 77385',
   'https://maps.app.goo.gl/1FWcpoTL2msbn84t5',
   '1800#', NULL, false, NULL, NULL, true),
  ('houston-methodist-tmc', 'Houston Methodist · Texas Medical Center',
   'N', 'Comprehensive', true, 'Level III (Subspecialty)', 'Level III (ICU)', false,
   '6565 Fannin St, Houston, TX 77030',
   'https://maps.app.goo.gl/9ZSCmgdozfXmXfMm6',
   NULL, NULL, false, 'No door code on file — confirm with charge nurse on arrival', NULL, true),
  ('houston-methodist-willowbrook', 'Houston Methodist · Willowbrook',
   'N', 'Comprehensive', true, 'Level III (Subspecialty)', 'Level III (ICU)', false,
   '18220 TX-249, Houston, TX 77070',
   'https://maps.app.goo.gl/jNtCKSdjne6dTgqE6',
   '4692#', '0911', false, NULL, NULL, true),
  ('houston-methodist-ecc-magnolia', 'Houston Methodist Emergency Care Center · Magnolia',
   'N', 'N', false, NULL, NULL, false,
   '18230 FM 1488 #101, Magnolia, TX 77354',
   'https://maps.app.goo.gl/RX7ZzdBxPtgKv9f37',
   '911#', NULL, false, NULL, NULL, true),
  ('stjoseph-navasota', 'St. Joseph Health · Navasota',
   'IV', 'N', false, NULL, NULL, false,
   '210 Judson St, Navasota, TX 77868',
   'https://maps.app.goo.gl/K1YCVCR46a78QVBd7',
   NULL, NULL, true, 'Ring door bell — no door code', NULL, true),
  ('bsw-brenham', 'Baylor Scott & White Medical Center · Brenham',
   'IV', 'N', false, NULL, NULL, false,
   '700 Medical Pkwy, Brenham, TX 77833',
   'https://maps.app.goo.gl/hcW83CpddhHscSW3A',
   '5144', NULL, false, NULL, NULL, true),
  ('bsw-college-station', 'Baylor Scott & White Medical Center · College Station',
   'III', 'Primary', true, 'Level III (Subspecialty)', 'Level III (ICU)', false,
   '700 Scott & White Dr, College Station, TX 77845',
   'https://maps.app.goo.gl/15ahWyhwWz8G9BvM7',
   '7845', '7845*', false, NULL, NULL, true),
  ('stjoseph-bryan', 'St. Joseph Health · Bryan',
   'III', 'Primary', true, NULL, NULL, false,
   '2801 Franciscan Dr, Bryan, TX 77802',
   'https://maps.app.goo.gl/F3WNyZcrpeny2Nkf9',
   '1234#', '1604#', false, NULL, NULL, true),
  ('stjoseph-college-station', 'St. Joseph Health · College Station',
   'III', 'Primary', false, 'Level II (Specialty Care)', 'Level III (ICU)', false,
   '1604 Rock Prairie Rd, College Station, TX 77845',
   'https://maps.app.goo.gl/bu4bX7FMQjFbZCyR9',
   NULL, NULL, true, 'Ring door bell — no door code', NULL, true),
  ('stlukes-woodlands', 'St. Luke''s Health · The Woodlands',
   'N', 'Comprehensive', true, 'Level III (Subspecialty)', 'Level III (ICU)', false,
   '17200 St Lukes Way, The Woodlands, TX 77384',
   'https://maps.app.goo.gl/8befw2EsZ4gaWucu6',
   '0911', NULL, false, NULL, NULL, true),
  ('stlukes-tmc', 'St. Luke''s Health · Texas Medical Center',
   'N', 'Comprehensive', true, NULL, NULL, false,
   '6720 Bertner Ave, Houston, TX 77030',
   'https://maps.app.goo.gl/cnZnVyCRbaMzFjHY6',
   NULL, NULL, false, 'No door code on file — confirm with charge nurse on arrival', NULL, true),
  ('tch-woodlands', 'Texas Children''s Hospital · The Woodlands',
   'IV', 'N', false, NULL, 'Level IV (AICU)', true,
   '17600 I-45, The Woodlands, TX 77384',
   'https://maps.app.goo.gl/XPLb7G1fGi1Gyan18',
   '0911', NULL, false, NULL, NULL, true),
  ('tch-west', 'Texas Children''s Hospital · West Campus',
   'IV', 'N', false, NULL, NULL, true,
   '18200 Katy Fwy, Houston, TX 77094',
   'https://maps.app.goo.gl/LQwmYbNxQCv9ayDX9',
   '*911*', NULL, false, NULL, NULL, true),
  ('tch-tmc', 'Texas Children''s Hospital · Texas Medical Center',
   'I', 'N', false, 'Level IV (Comprehensive)', 'Level IV (AICU)', true,
   '6621A Fannin St, Houston, TX 77030',
   'https://maps.app.goo.gl/Dtcvo4HkDztxZtXP7',
   NULL, NULL, false, 'No door code on file — confirm with charge nurse on arrival', NULL, true)
ON CONFLICT (id) DO NOTHING;
