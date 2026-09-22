-- Personal "my shift" highlight color (Justin, 2026-09-22): each member
-- picks the tint their own shifts glow on the calendars. Null = the
-- default gold. Lives on the member's own settings row (own-write RLS).
alter table sched_member_settings add column if not exists highlight_color text;
