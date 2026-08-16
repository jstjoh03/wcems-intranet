-- call-volume-sync writes as service_role; the call_volume tables
-- predate the convention of granting it explicitly (they were only
-- ever written by admin sessions through PostgREST).
GRANT ALL ON public.call_volume_summaries TO service_role;
GRANT ALL ON public.call_volume_units TO service_role;
GRANT ALL ON public.call_volume_zones TO service_role;
