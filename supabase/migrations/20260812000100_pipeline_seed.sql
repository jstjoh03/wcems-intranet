-- ─────────────────────────────────────────────────────────────────────
-- 20260812000100_pipeline_seed
--
-- One-time baseline for pipeline_records, generated from the Aug-7
-- pipeline-board.html snapshot (real WCEMS Roster data). Idempotent:
-- every insert is ON CONFLICT (user_id) DO NOTHING and matches
-- app_users by full name, so unmatched names silently no-op (re-run
-- the same inserts after roster-sync adds a missing person).
--
-- Excluded: spreadsheet section-header artifacts, Caleb Fenter
-- (withdrew before start), and rows with no pipeline/compliance data.
-- Also seeds pipeline_editors (Justin St John, Heather Fojt, Rhonda
-- Getschman — the clinical staff with check-off rights).
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO public.pipeline_records
  (user_id, cleared_phase, working_phase, working_started_at, working_target_at,
   pending, pip_active, in_p3_process, in_aemt_upgrade, level, is_fto,
   cert_level, tx_license_expires_at, tx_jurisprudence_at, bloodborne_pathogen_at,
   op_iq_granted_at, narc_safe_granted_at, est_p2_ready_at, coverage_note, blocker_note)
SELECT u.id, s.cleared_phase, s.working_phase, s.working_started_at::date, s.working_target_at::date,
       s.pending, s.pip_active, s.in_p3_process, s.in_aemt_upgrade, s.level, s.is_fto,
       s.cert_level, s.tx_license_expires_at::date, s.tx_jurisprudence_at::date, s.bloodborne_pathogen_at::date,
       s.op_iq_granted_at::date, s.narc_safe_granted_at::date, s.est_p2_ready_at::date, s.coverage_note, s.blocker_note
FROM (VALUES
  ('Artemio Gorrostieta', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, NULL, false, 'EMT-B', '2028-01-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Christina Mathes', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, NULL, false, 'EMT-B', '2029-09-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Michael Mathes', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, NULL, false, 'EMT-B', '2027-02-28', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Ben Pahl', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, NULL, false, 'EMT-B', '2028-01-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Allena Preston', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, NULL, false, 'EMT-B', '2029-11-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Aaron Buzzard', NULL, NULL, NULL, NULL, false, false, false, false, NULL, false, 'MD', '2026-05-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Ed DeLany', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, NULL, false, 'EMT-P', '2029-07-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Heather Fojt', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, NULL, false, 'LP', '2028-10-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Trae Gammon', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, NULL, false, 'EMT-P', '2029-10-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Rhonda Getschman', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, NULL, false, 'EMT-P', '2028-02-29', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('April Mancini', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, NULL, false, 'EMT-P', '2028-11-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Miranda Spiteri', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, NULL, false, 'EMT-P', '2029-09-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Justin St John', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, NULL, false, 'LP', '2028-12-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Ronald Thibodeaux', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, NULL, false, 'LP', '2030-07-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Erica Torr', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, NULL, false, 'EMT-P', '2027-10-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Laurel Vandagriff', 'FinalRelease', NULL, '2026-07-06', NULL, false, false, false, false, NULL, false, 'EMT-B', '2028-12-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Fawna Abel', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'ADV', false, 'ADV EMT', '2028-01-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Stephanie Adams', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'P2', false, 'LP', '2027-09-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Matthew Ainsworth', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'P2', false, 'LP', '2027-01-31', '2026-06-21', NULL, '2026-06-30', '2026-06-30', NULL, NULL, NULL),
  ('Natalie Aquino', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'P2', false, 'EMT-P', '2028-08-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Robert Bruyneel', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, NULL, false, 'EMT-B', '2029-08-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Sean Buzzard', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'P1', false, 'EMT-P', '2029-09-30', NULL, NULL, NULL, NULL, NULL, 'MED – truck short a body; incoming medic hire covers P2', NULL),
  ('Ashley Carothers', 'P1', 'P2', '2026-06-24', '2026-09-22', false, false, false, false, 'P1', false, 'EMT-P', '2030-01-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('John Cates', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'FTO', true, 'EMT-P', '2026-10-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Chelsea Cauvel', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'EMT', false, 'EMT-B', '2027-11-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Jose Diaz', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'FTO', true, 'EMT-P', '2027-12-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Crystal Dinh', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'P1', false, 'EMT-P', '2030-06-30', NULL, NULL, NULL, NULL, NULL, 'MED – truck short a body; incoming medic hire covers P2', NULL),
  ('Ashley Dodd', 'FinalRelease', NULL, NULL, NULL, false, false, true, false, 'FTO', true, 'LP', '2029-08-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Valeri Eades', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'EMT', false, 'EMT-B', '2028-09-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Kelly Ebbers', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'ADV', false, 'ADV EMT', '2029-06-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Ryan Echeverria', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'EMT', false, 'EMT-B', '2027-08-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Benjamin Egert', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'P2', false, 'EMT-P', '2029-07-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Tim Friedel', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'EMT - FTO?', false, 'EMT-B', '2029-02-28', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Shalidah Fry', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'P2', false, 'EMT-P', '2028-06-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Angelica Fulton', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'P2', false, 'EMT-P', '2027-10-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Justin Hart', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'EMT', false, 'EMT-B', '2029-05-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Magda Herrera', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'P2', false, 'LP', '2028-06-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Noah Howard', 'FinalRelease', NULL, '2026-06-29', NULL, false, false, false, false, 'P2', false, 'EMT-P', '2029-02-28', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Aletha Howell', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'EMT', false, 'EMT-B', '2030-03-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Travarious Ivy', NULL, NULL, NULL, NULL, false, false, false, false, 'P1', false, 'EMT-P', '2028-10-31', NULL, NULL, NULL, NULL, NULL, 'LOW – truck already has a P2-cap', NULL),
  ('Thomas Kim', 'P1', 'P2', '2026-06-26', '2026-07-31', false, false, false, false, 'P1', false, 'EMT-P', '2027-08-31', NULL, NULL, '2026-06-26', '2026-06-26', NULL, 'HIGH – full truck with no P2-cap', NULL),
  ('Colby LeGalley', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'P2', false, 'EMT-P', '2026-11-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Tyler Lowery', 'P1', 'P2', '2026-06-24', '2026-09-22', false, false, false, false, 'P1', false, 'EMT-P', '2030-02-28', NULL, NULL, NULL, NULL, NULL, 'LOW – truck already has a P2-cap', NULL),
  ('Riann Luman', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'FTO', true, 'EMT-P', '2029-10-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Darry Luther', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'P2', false, 'EMT-P', '2027-06-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Alexis Maldonado', 'FinalRelease', NULL, '2026-06-29', NULL, false, false, false, false, 'EMT', false, 'EMT-B', '2029-06-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Mary McConaty', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'EMT', false, 'EMT-B', '2029-08-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Tristan Murphy', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'EMT', false, 'EMT-B', '2026-09-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Michael Ng', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'P2', false, 'LP', '2030-08-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Ashtin Parmer', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'EMT', false, 'EMT-B', '2029-06-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Gregory Parran', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'EMT', false, 'EMT-B', '2029-05-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Ratsamy Phengsikeo', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'P2', false, 'EMT-P', '2027-06-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Jennifer Porter', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'ADV', false, 'ADV EMT', '2029-10-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Patrick Porter', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'EMT', false, 'EMT-B', '2027-06-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Wendy Price', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'ADV', false, 'ADV EMT', '2030-05-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Sarah Reyes', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'P2', false, 'EMT-P', '2028-09-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Kaleb Roberts', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'EMT', false, 'EMT-B', '2028-06-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Madison Rodriguez', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'EMT', false, 'EMT-B', '2030-10-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Jessie Roy', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'P2', false, 'EMT-P', '2028-06-30', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Cody Sholar', 'FinalRelease', NULL, '2026-06-26', NULL, false, true, false, false, 'ADV', false, 'ADV EMT', '2029-05-31', '2026-06-18', NULL, NULL, NULL, NULL, NULL, NULL),
  ('Brittany Smith', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'ADV - FTO', true, 'ADV EMT', '2030-07-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Tamura Tarver', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'EMT', false, 'EMT-B', '2029-05-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Perry Tong', 'P1', 'P2', '2026-06-24', '2026-09-22', false, false, false, false, 'P1', false, 'LP', '2027-06-30', NULL, NULL, NULL, NULL, NULL, 'HIGH – full truck with no P2-cap', NULL),
  ('Janila Usimaki', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'EMT', false, 'EMT-B', '2029-12-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Josh Webb', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'P1', false, 'LP', '2026-11-30', NULL, NULL, NULL, NULL, NULL, 'HIGH – full truck with no P2-cap', NULL),
  ('Justin White', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'EMT - FTO?', false, 'EMT-B', '2028-07-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Madison White', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, 'EMT - FTO?', false, 'EMT-B', '2026-12-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Brittany Wooldridge', 'FinalRelease', NULL, NULL, NULL, false, false, false, false, NULL, false, 'EMT-P', '2027-10-31', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Jeremy Cowan', NULL, 'NEOP', '2026-08-17', NULL, true, false, false, false, 'P1C', false, 'EMT-P', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Dennis Ho', NULL, 'NEOP', '2026-08-17', NULL, true, false, false, false, 'P1C', false, 'EMT-P', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Mauricio Marin', NULL, 'NEOP', '2026-08-17', NULL, true, false, false, false, 'P1C', false, 'EMT-P', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Emily Parlor', NULL, 'NEOP', '2026-08-17', NULL, true, false, false, false, 'P1C', false, 'EMT-P', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Tara Roth', NULL, 'NEOP', '2026-08-17', NULL, true, false, false, false, 'P1C', false, 'EMT-P', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Jaslyn Ruiz', NULL, 'NEOP', '2026-08-17', NULL, true, false, false, false, 'P1C', false, 'EMT-P', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Brianna Smith', NULL, 'NEOP', '2026-08-17', NULL, true, false, false, false, 'P1C', false, 'EMT-P', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Zachariah Vernon', NULL, 'NEOP', '2026-08-17', NULL, true, false, false, false, 'P1C', false, 'EMT-P', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
) AS s(full_name, cleared_phase, working_phase, working_started_at, working_target_at,
       pending, pip_active, in_p3_process, in_aemt_upgrade, level, is_fto,
       cert_level, tx_license_expires_at, tx_jurisprudence_at, bloodborne_pathogen_at,
       op_iq_granted_at, narc_safe_granted_at, est_p2_ready_at, coverage_note, blocker_note)
JOIN public.app_users u ON u.full_name = s.full_name AND u.account_type = 'person'
ON CONFLICT (user_id) DO NOTHING;

-- ── Clinical editors (person-specific write grant) ─────────────────
INSERT INTO public.pipeline_editors (user_id)
SELECT id FROM public.app_users
WHERE email IN (
  'justin.stjohn@wallercountyems.com',
  'heather.fojt@wallercountyems.com',
  'rhonda.getschman@wallercountyems.com'
)
ON CONFLICT (user_id) DO NOTHING;
