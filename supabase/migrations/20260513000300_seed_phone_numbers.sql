-- ─────────────────────────────────────────────────────────────────────
-- Seed phone numbers from the master employee-roster.xlsx (Active sheet).
--
-- 73 emails sourced from the Mobile column. Normalized to
-- (XXX) XXX-XXXX format on the way in for consistency with how Justin
-- writes them in the profile modal placeholder.
--
-- Idempotent: each UPDATE has a `phone IS NULL OR phone = ''` guard,
-- so users who have already typed their own phone in the profile modal
-- by the time this runs are not overwritten. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────

update public.app_users set phone = '(210) 380-6017' where lower(email) = 'aaron.buzzard@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(512) 960-5414' where lower(email) = 'aletha.howell@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 878-0471' where lower(email) = 'alexis.maldonado@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(972) 415-5505' where lower(email) = 'allena.preston@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(713) 855-3232' where lower(email) = 'angelica.fulton@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(281) 986-9226' where lower(email) = 'april.mancini@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 230-6163' where lower(email) = 'artemio.gorrostieta@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(318) 658-2924' where lower(email) = 'ashley.carothers@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(281) 744-8649' where lower(email) = 'ashley.dodd@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 991-2213' where lower(email) = 'ashtin.parmer@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(727) 804-2863' where lower(email) = 'ben.egert@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(979) 221-7802' where lower(email) = 'ben.pahl@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 732-9538' where lower(email) = 'brittany.smith@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(936) 443-5253' where lower(email) = 'brittany.wooldridge@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(979) 218-7536' where lower(email) = 'chelsea.cauvel@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(281) 658-9992' where lower(email) = 'christina.mathes@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(979) 481-4155' where lower(email) = 'cody.sholar@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(979) 575-2888' where lower(email) = 'colby.legalley@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 641-7493' where lower(email) = 'crystal.dinh@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(512) 289-8096' where lower(email) = 'darry.luther@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(281) 757-8011' where lower(email) = 'ed.delany@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 306-8761' where lower(email) = 'erica.adams@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(979) 595-6752' where lower(email) = 'erica.torr@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 244-2269' where lower(email) = 'fawna.abel@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(708) 829-5421' where lower(email) = 'gregory.parran@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 520-6771' where lower(email) = 'heather.fojt@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(936) 444-9894' where lower(email) = 'janila.usimaki@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(281) 384-1515' where lower(email) = 'jennifer.porter@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(936) 435-5232' where lower(email) = 'jessie.roy@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(713) 301-5158' where lower(email) = 'joe.diaz@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(281) 928-2646' where lower(email) = 'john.cates@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(281) 961-7966' where lower(email) = 'joshua.webb@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(979) 298-4019' where lower(email) = 'justin.hart@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(281) 546-1311' where lower(email) = 'justin.stjohn@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(281) 703-8996' where lower(email) = 'justin.white@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(346) 337-5400' where lower(email) = 'kaleb.roberts@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 315-9430' where lower(email) = 'kaylene.moeller@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(281) 642-3775' where lower(email) = 'kelly.ebbers@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(484) 294-6913' where lower(email) = 'kyle.ceres@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 920-6323' where lower(email) = 'laurel.vandagriff@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(903) 456-0868' where lower(email) = 'maddie.white@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(346) 657-4393' where lower(email) = 'madison.rodriguez@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(918) 807-9305' where lower(email) = 'magda.herrera@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(713) 853-6833' where lower(email) = 'mary.mcconaty@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 578-3605' where lower(email) = 'matthew.ainsworth@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(281) 685-4400' where lower(email) = 'michael.mathes@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(713) 876-2340' where lower(email) = 'michael.ng@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(281) 799-8439' where lower(email) = 'miranda.spiteri@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 475-9438' where lower(email) = 'natalie.aquino@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(281) 948-8004' where lower(email) = 'niah.davis@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(509) 227-9786' where lower(email) = 'noah.howard@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 623-5725' where lower(email) = 'patrick.porter@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(361) 571-5711' where lower(email) = 'perry.tong@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 801-6050' where lower(email) = 'ratsamy.phengsikeo@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 367-7959' where lower(email) = 'rbecvar@wcemstx.com' and (phone is null or phone = '');
update public.app_users set phone = '(281) 330-9193' where lower(email) = 'rhonda.getschman@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(936) 443-8157' where lower(email) = 'riann.luman@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(281) 881-8811' where lower(email) = 'robert.bruyneel@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 725-6187' where lower(email) = 'ron.thibodeaux@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(713) 205-4475' where lower(email) = 'ryan.echeverria@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(512) 438-9515' where lower(email) = 'sarah.reyes@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(979) 906-0945' where lower(email) = 'sean.buzzard@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(713) 376-4198' where lower(email) = 'shalidah.fry@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 546-3156' where lower(email) = 'stephanie.adams@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 309-7898' where lower(email) = 'tamura.tarver@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 707-7986' where lower(email) = 'thomas.kim@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(936) 827-1327' where lower(email) = 'tim.friedel@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(512) 755-3495' where lower(email) = 'tori.bell@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(281) 740-8941' where lower(email) = 'trae.gammon@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 322-1385' where lower(email) = 'tristan.murphy@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(832) 674-6361' where lower(email) = 'tyler.lowery@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(479) 737-5154' where lower(email) = 'valeri.eades@wallercountyems.com' and (phone is null or phone = '');
update public.app_users set phone = '(281) 451-2168' where lower(email) = 'wendy.price@wallercountyems.com' and (phone is null or phone = '');
