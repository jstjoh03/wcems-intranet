-- Slot-punched card stock: layout keeps the top-center punch zone free
-- of artwork. Toggle lives with the other agency-wide badge settings.
ALTER TABLE public.badge_agency ADD COLUMN IF NOT EXISTS slotted boolean NOT NULL DEFAULT false;
