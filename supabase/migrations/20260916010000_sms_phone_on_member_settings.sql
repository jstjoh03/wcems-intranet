-- SMS consent must be tied to a phone number entered on the SAME form
-- (A2P reviewer requirement): the opt-in block gains its own number,
-- prefilled from the roster but owned by the member.
alter table sched_member_settings add column if not exists sms_phone text;
