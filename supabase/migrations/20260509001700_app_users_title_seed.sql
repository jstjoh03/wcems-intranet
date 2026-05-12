-- ---------------------------------------------------------------------
-- 0018_app_users_title_seed
--
-- One-off backfill of `app_users.title` from the WCEMS roster's
-- Cert Level column. Mapping per Justin:
--   EMT-B   -> 'EMT'
--   EMT-P   -> 'Paramedic'
--   LP      -> 'Licensed Paramedic'
--   ADV EMT -> 'Adv EMT' (case-normalized)
--   N/A     -> left NULL (admin staff w/o field cert)
--   MD      -> left NULL (Dr. Buzzard — admin to set manually)
--
-- Matched by lower(email) so future re-runs are idempotent and
-- mixed-case emails in storage don't break the update.
-- ---------------------------------------------------------------------

UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'artemio.gorrostieta@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'christina.mathes@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'michael.mathes@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'ben.pahl@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'allena.preston@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'ed.delany@wallercountyems.com';
UPDATE public.app_users SET title = 'Licensed Paramedic' WHERE lower(email) = 'heather.fojt@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'trae.gammon@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'rhonda.getschman@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'april.mancini@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'miranda.spiteri@wallercountyems.com';
UPDATE public.app_users SET title = 'Licensed Paramedic' WHERE lower(email) = 'justin.stjohn@wallercountyems.com';
UPDATE public.app_users SET title = 'Licensed Paramedic' WHERE lower(email) = 'ron.thibodeaux@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'erica.torr@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'laurel.vandagriff@wallercountyems.com';
UPDATE public.app_users SET title = 'Adv EMT' WHERE lower(email) = 'fawna.abel@wallercountyems.com';
UPDATE public.app_users SET title = 'Licensed Paramedic' WHERE lower(email) = 'stephanie.adams@wallercountyems.com';
UPDATE public.app_users SET title = 'Licensed Paramedic' WHERE lower(email) = 'matthew.ainsworth@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'natalie.aquino@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'robert.bruyneel@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'sean.buzzard@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'ashley.carothers@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'john.cates@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'chelsea.cauvel@wallercountyems.com';
UPDATE public.app_users SET title = 'Licensed Paramedic' WHERE lower(email) = 'kyle.ceres@wallercountyems.com';
UPDATE public.app_users SET title = 'Licensed Paramedic' WHERE lower(email) = 'niah.davis@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'joe.diaz@wallercountyems.com';
UPDATE public.app_users SET title = 'Adv EMT' WHERE lower(email) = 'crystal.dinh@wallercountyems.com';
UPDATE public.app_users SET title = 'Licensed Paramedic' WHERE lower(email) = 'ashley.dodd@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'valeri.eades@wallercountyems.com';
UPDATE public.app_users SET title = 'Adv EMT' WHERE lower(email) = 'kelly.ebbers@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'ryan.echeverria@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'ben.egert@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'tim.friedel@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'shalidah.fry@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'angelica.fulton@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'justin.hart@wallercountyems.com';
UPDATE public.app_users SET title = 'Licensed Paramedic' WHERE lower(email) = 'magda.herrera@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'noah.howard@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'aletha.howell@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'thomas.kim@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'colby.legalley@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'tyler.lowery@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'riann.luman@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'darry.luther@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'alexis.maldonado@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'mary.mcconaty@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'kaylene.moeller@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'tristan.murphy@wallercountyems.com';
UPDATE public.app_users SET title = 'Licensed Paramedic' WHERE lower(email) = 'michael.ng@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'ashtin.parmer@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'gregory.parran@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'ratsamy.phengsikeo@wallercountyems.com';
UPDATE public.app_users SET title = 'Adv EMT' WHERE lower(email) = 'jennifer.porter@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'patrick.porter@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'wendy.price@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'sarah.reyes@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'kaleb.roberts@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'madison.rodriguez@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'jessie.roy@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'cody.sholar@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'brittany.smith@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'tamura.tarver@wallercountyems.com';
UPDATE public.app_users SET title = 'Licensed Paramedic' WHERE lower(email) = 'perry.tong@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'janila.usimaki@wallercountyems.com';
UPDATE public.app_users SET title = 'Licensed Paramedic' WHERE lower(email) = 'joshua.webb@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'justin.white@wallercountyems.com';
UPDATE public.app_users SET title = 'EMT' WHERE lower(email) = 'maddie.white@wallercountyems.com';
UPDATE public.app_users SET title = 'Paramedic' WHERE lower(email) = 'brittany.wooldridge@wallercountyems.com';
