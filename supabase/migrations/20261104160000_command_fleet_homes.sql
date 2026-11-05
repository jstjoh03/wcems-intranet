-- Fleet home state (2026-11-04, applied live): cold-start defaults for
-- the Daily Summary fleet matrix. Once summaries exist, the newest
-- submitted one carries the state forward; these homes only seed the
-- first form and the dashboard board. Snapshot from the Jotform's
-- current sheet.
alter table command_fleet
  add column home_location text not null default '',
  add column home_oos boolean not null default false,
  add column home_note text not null default '';

update command_fleet set home_location = 'M211 - Main' where label = '8751';
update command_fleet set home_location = 'M221 - Main' where label = '9238';
update command_fleet set home_location = 'At Shop', home_oos = true, home_note = 'Fleet' where label = '0081';
update command_fleet set home_location = 'At Shop', home_oos = true, home_note = 'Leak' where label = '8237';
update command_fleet set home_location = 'M231 - Main' where label = '8744';
update command_fleet set home_location = 'M242 - Main' where label = '8750';
update command_fleet set home_location = 'M242 - Reserve' where label = 'Vannie Mae';
update command_fleet set home_location = 'M271 - Main' where label = '2795';
update command_fleet set home_location = 'M206 - Main' where label = '2793';
update command_fleet set home_location = 'M272 - Main' where label = '0379';
update command_fleet set home_location = 'M272 - Reserve' where label = '8665';
update command_fleet set home_location = 'M281 - Main' where label = '2794';
