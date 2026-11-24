-- 'demo' joins the app_role enum in its own migration: a value added to
-- an enum cannot be referenced in the same transaction that adds it,
-- and the demo role's functions (next migration) compare against it.
alter type app_role add value if not exists 'demo';
