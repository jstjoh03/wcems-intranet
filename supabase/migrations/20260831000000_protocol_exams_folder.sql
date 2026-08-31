-- Protocol exam certificates get their own folder (Justin, 2026-08-31)
-- — they were landing in 'certs' (BLS/ACLS wallet cards), which mixes
-- credential cards with internally administered exam results.
ALTER TABLE public.clinical_documents
  DROP CONSTRAINT IF EXISTS clinical_documents_folder_check;
ALTER TABLE public.clinical_documents
  ADD CONSTRAINT clinical_documents_folder_check
  CHECK (folder IN ('signed_forms','certs','ce_certs','protocol_exams','counseling','generated','other'));
