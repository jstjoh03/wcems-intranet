-- ---------------------------------------------------------------------
-- 0013_seed_employees
--
-- One-shot seed of the 73-person Active roster from the master xlsx.
-- Pre-creates app_users rows with auth_user_id = NULL. The updated
-- handle_new_auth_user trigger from 0012 claims each row by email
-- when the corresponding employee signs in for the first time, so
-- their seeded shift / station / fuel_number / date_of_birth is
-- already present from day one.
--
-- ON CONFLICT (email) DO UPDATE — idempotent. auth_user_id is NEVER
-- touched on update; once an employee has signed in their binding
-- stays put.
-- ---------------------------------------------------------------------

INSERT INTO public.app_users (
  email, first_name, last_name, full_name, role, shift, station,
  fuel_number, date_of_birth
) VALUES
  ('artemio.gorrostieta@wallercountyems.com', 'Artemio', 'Gorrostieta', 'Artemio Gorrostieta', 'crew'::public.app_role, NULL::public.shift_letter, 'PRN', '41793', '1989-12-26'),
  ('christina.mathes@wallercountyems.com', 'Christina', 'Mathes', 'Christina Mathes', 'crew'::public.app_role, NULL::public.shift_letter, 'PRN', NULL, '1987-12-03'),
  ('michael.mathes@wallercountyems.com', 'Michael', 'Mathes', 'Michael Mathes', 'crew'::public.app_role, NULL::public.shift_letter, 'PRN', '40125', '1986-06-05'),
  ('ben.pahl@wallercountyems.com', 'Ben', 'Pahl', 'Ben Pahl', 'crew'::public.app_role, NULL::public.shift_letter, 'PRN', '92531', '1995-07-19'),
  ('allena.preston@wallercountyems.com', 'Allena', 'Preston', 'Allena Preston', 'crew'::public.app_role, NULL::public.shift_letter, 'PRN', '561', '2023-04-04'),
  ('erica.adams@wallercountyems.com', 'Erica', 'Adams', 'Erica Adams', 'admin'::public.app_role, NULL::public.shift_letter, 'EMS Admin', '75952', '1980-04-11'),
  ('rbecvar@wcemstx.com', 'Rhonda', 'Becvar', 'Rhonda Becvar', 'admin'::public.app_role, NULL::public.shift_letter, 'EMS Admin', '57576', '1968-11-11'),
  ('tori.bell@wallercountyems.com', 'Tori', 'Bell', 'Tori Bell', 'admin'::public.app_role, NULL::public.shift_letter, 'EMS Admin', '40116', '1997-11-11'),
  ('aaron.buzzard@wallercountyems.com', 'Aaron', 'Buzzard', 'Aaron Buzzard', 'admin'::public.app_role, NULL::public.shift_letter, NULL, NULL, '1973-11-20'),
  ('ed.delany@wallercountyems.com', 'Ed', 'DeLany', 'Ed DeLany', 'supervisor'::public.app_role, 'A'::public.shift_letter, 'S201', '64688', '1981-03-17'),
  ('heather.fojt@wallercountyems.com', 'Heather', 'Fojt', 'Heather Fojt', 'admin'::public.app_role, NULL::public.shift_letter, 'EMS Admin', '65210', '1971-12-23'),
  ('trae.gammon@wallercountyems.com', 'Trae', 'Gammon', 'Trae Gammon', 'supervisor'::public.app_role, 'A'::public.shift_letter, 'S202', '83577', '1971-08-17'),
  ('rhonda.getschman@wallercountyems.com', 'Rhonda', 'Getschman', 'Rhonda Getschman', 'admin'::public.app_role, NULL::public.shift_letter, 'EMS Admin', '94245', '1976-08-24'),
  ('april.mancini@wallercountyems.com', 'April', 'Mancini', 'April Mancini', 'admin'::public.app_role, NULL::public.shift_letter, 'EMS Admin', '41216', '1984-05-24'),
  ('miranda.spiteri@wallercountyems.com', 'Miranda', 'Spiteri', 'Miranda Spiteri', 'supervisor'::public.app_role, 'B'::public.shift_letter, 'S202', '49401', '1999-07-14'),
  ('justin.stjohn@wallercountyems.com', 'Justin', 'St John', 'Justin St John', 'admin'::public.app_role, 'C'::public.shift_letter, 'S202', '30988', '1991-04-03'),
  ('ron.thibodeaux@wallercountyems.com', 'Ronald', 'Thibodeaux', 'Ronald Thibodeaux', 'supervisor'::public.app_role, 'B'::public.shift_letter, 'S201', '37817', '1977-09-17'),
  ('erica.torr@wallercountyems.com', 'Erica', 'Torr', 'Erica Torr', 'supervisor'::public.app_role, 'C'::public.shift_letter, 'S201', '81652', '1984-07-16'),
  ('laurel.vandagriff@wallercountyems.com', 'Laurel', 'Vandagriff', 'Laurel Vandagriff', 'admin'::public.app_role, NULL::public.shift_letter, 'EMS Admin', '10623', '2006-08-04'),
  ('fawna.abel@wallercountyems.com', 'Fawna', 'Abel', 'Fawna Abel', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '63597', '1958-11-07'),
  ('stephanie.adams@wallercountyems.com', 'Stephanie', 'Adams', 'Stephanie Adams', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '91138', '1984-08-08'),
  ('matthew.ainsworth@wallercountyems.com', 'Matthew', 'Ainsworth', 'Matthew Ainsworth', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '36322', '1998-06-12'),
  ('natalie.aquino@wallercountyems.com', 'Natalie', 'Aquino', 'Natalie Aquino', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '58685', '2000-01-28'),
  ('robert.bruyneel@wallercountyems.com', 'Robert', 'Bruyneel', 'Robert Bruyneel', 'crew'::public.app_role, NULL::public.shift_letter, 'FLOAT', '37624', '1982-10-13'),
  ('sean.buzzard@wallercountyems.com', 'Sean', 'Buzzard', 'Sean Buzzard', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '84228', '2005-01-23'),
  ('ashley.carothers@wallercountyems.com', 'Ashley', 'Carothers', 'Ashley Carothers', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '46514', '2004-06-20'),
  ('john.cates@wallercountyems.com', 'John', 'Cates', 'John Cates', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '38320', '1990-10-03'),
  ('chelsea.cauvel@wallercountyems.com', 'Chelsea', 'Cauvel', 'Chelsea Cauvel', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '22767', '1991-06-13'),
  ('kyle.ceres@wallercountyems.com', 'Kyle', 'Ceres', 'Kyle Ceres', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '58933', '1991-01-07'),
  ('niah.davis@wallercountyems.com', 'Niah', 'Davis', 'Niah Davis', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '50913', '1994-11-11'),
  ('joe.diaz@wallercountyems.com', 'Jose', 'Diaz', 'Jose Diaz', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '63450', '1985-12-09'),
  ('crystal.dinh@wallercountyems.com', 'Crystal', 'Dinh', 'Crystal Dinh', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '35790', '2000-11-11'),
  ('ashley.dodd@wallercountyems.com', 'Ashley', 'Dodd', 'Ashley Dodd', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '91880', '1982-10-11'),
  ('valeri.eades@wallercountyems.com', 'Valeri', 'Eades', 'Valeri Eades', 'crew'::public.app_role, NULL::public.shift_letter, 'FLOAT', '25746', '2005-06-29'),
  ('kelly.ebbers@wallercountyems.com', 'Kelly', 'Ebbers', 'Kelly Ebbers', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '97848', '1984-07-15'),
  ('ryan.echeverria@wallercountyems.com', 'Ryan', 'Echeverria', 'Ryan Echeverria', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '68437', '2005-07-16'),
  ('ben.egert@wallercountyems.com', 'Benjamin', 'Egert', 'Benjamin Egert', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '57411', '1974-07-28'),
  ('tim.friedel@wallercountyems.com', 'Tim', 'Friedel', 'Tim Friedel', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '29788', '1960-10-27'),
  ('shalidah.fry@wallercountyems.com', 'Shalidah', 'Fry', 'Shalidah Fry', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '69472', '2000-02-17'),
  ('angelica.fulton@wallercountyems.com', 'Angelica', 'Fulton', 'Angelica Fulton', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '68868', '1996-10-03'),
  ('justin.hart@wallercountyems.com', 'Justin', 'Hart', 'Justin Hart', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '44947', '2006-07-04'),
  ('magda.herrera@wallercountyems.com', 'Magda', 'Herrera', 'Magda Herrera', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '74201', '1982-02-15'),
  ('noah.howard@wallercountyems.com', 'Noah', 'Howard', 'Noah Howard', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '29403', '2003-12-13'),
  ('aletha.howell@wallercountyems.com', 'Aletha', 'Howell', 'Aletha Howell', 'crew'::public.app_role, NULL::public.shift_letter, 'FLOAT', '68886', '1996-10-19'),
  ('thomas.kim@wallercountyems.com', 'Thomas', 'Kim', 'Thomas Kim', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '10861', '1997-10-18'),
  ('colby.legalley@wallercountyems.com', 'Colby', 'LeGalley', 'Colby LeGalley', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '24884', '1983-03-22'),
  ('tyler.lowery@wallercountyems.com', 'Tyler', 'Lowery', 'Tyler Lowery', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '21795', '2001-10-03'),
  ('riann.luman@wallercountyems.com', 'Riann', 'Luman', 'Riann Luman', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '15971', '1989-12-22'),
  ('darry.luther@wallercountyems.com', 'Darry', 'Luther', 'Darry Luther', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '97756', '1994-02-08'),
  ('alexis.maldonado@wallercountyems.com', 'Alexis', 'Maldonado', 'Alexis Maldonado', 'crew'::public.app_role, NULL::public.shift_letter, 'FLOAT', '55752', '2001-04-11'),
  ('mary.mcconaty@wallercountyems.com', 'Mary', 'McConaty', 'Mary McConaty', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '39329', '2002-05-07'),
  ('kaylene.moeller@wallercountyems.com', 'Kaylene', 'Moeller', 'Kaylene Moeller', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '39787', '1993-10-06'),
  ('tristan.murphy@wallercountyems.com', 'Tristan', 'Murphy', 'Tristan Murphy', 'crew'::public.app_role, NULL::public.shift_letter, 'FLOAT', '66026', '1983-06-18'),
  ('michael.ng@wallercountyems.com', 'Michael', 'Ng', 'Michael Ng', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '13684', '1996-09-05'),
  ('ashtin.parmer@wallercountyems.com', 'Ashtin', 'Parmer', 'Ashtin Parmer', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '29715', '2004-10-26'),
  ('gregory.parran@wallercountyems.com', 'Gregory', 'Parran', 'Gregory Parran', 'crew'::public.app_role, NULL::public.shift_letter, 'FLOAT', '22675', '1996-11-08'),
  ('ratsamy.phengsikeo@wallercountyems.com', 'Ratsamy', 'Phengsikeo', 'Ratsamy Phengsikeo', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '18928', '1980-10-19'),
  ('jennifer.porter@wallercountyems.com', 'Jennifer', 'Porter', 'Jennifer Porter', 'crew'::public.app_role, NULL::public.shift_letter, 'FLOAT', '90780', '1976-09-18'),
  ('patrick.porter@wallercountyems.com', 'Patrick', 'Porter', 'Patrick Porter', 'crew'::public.app_role, NULL::public.shift_letter, 'FLOAT', '17699', '1968-12-28'),
  ('wendy.price@wallercountyems.com', 'Wendy', 'Price', 'Wendy Price', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '95996', '1978-03-15'),
  ('sarah.reyes@wallercountyems.com', 'Sarah', 'Reyes', 'Sarah Reyes', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '43526', '1993-04-20'),
  ('kaleb.roberts@wallercountyems.com', 'Kaleb', 'Roberts', 'Kaleb Roberts', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '37844', '2006-03-08'),
  ('madison.rodriguez@wallercountyems.com', 'Madison', 'Rodriguez', 'Madison Rodriguez', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '63964', '2002-04-11'),
  ('jessie.roy@wallercountyems.com', 'Jessie', 'Roy', 'Jessie Roy', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '42958', '1991-01-28'),
  ('cody.sholar@wallercountyems.com', 'Cody', 'Sholar', 'Cody Sholar', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '53598', '1989-02-21'),
  ('brittany.smith@wallercountyems.com', 'Brittany', 'Smith', 'Brittany Smith', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '84475', '1989-10-25'),
  ('tamura.tarver@wallercountyems.com', 'Tamura', 'Tarver', 'Tamura Tarver', 'crew'::public.app_role, NULL::public.shift_letter, 'FLOAT', '78931', '1974-09-09'),
  ('perry.tong@wallercountyems.com', 'Perry', 'Tong', 'Perry Tong', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '16205', '1971-12-06'),
  ('janila.usimaki@wallercountyems.com', 'Janila', 'Usimaki', 'Janila Usimaki', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '29825', '1993-03-30'),
  ('joshua.webb@wallercountyems.com', 'Josh', 'Webb', 'Josh Webb', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '58098', '1987-05-29'),
  ('justin.white@wallercountyems.com', 'Justin', 'White', 'Justin White', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '39301', '1982-08-25'),
  ('maddie.white@wallercountyems.com', 'Madison', 'White', 'Madison White', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '17084', '2001-07-03'),
  ('brittany.wooldridge@wallercountyems.com', 'Brittany', 'Wooldridge', 'Brittany Wooldridge', 'crew'::public.app_role, NULL::public.shift_letter, NULL, '27175', '1987-03-11')
ON CONFLICT (email) DO UPDATE SET
  first_name    = EXCLUDED.first_name,
  last_name     = EXCLUDED.last_name,
  full_name     = EXCLUDED.full_name,
  role          = EXCLUDED.role,
  shift         = EXCLUDED.shift,
  station       = EXCLUDED.station,
  fuel_number   = EXCLUDED.fuel_number,
  date_of_birth = EXCLUDED.date_of_birth;
