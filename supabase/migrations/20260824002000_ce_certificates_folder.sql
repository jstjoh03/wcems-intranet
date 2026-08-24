-- CE certificates get their own folder in the clinical documents
-- system (Justin, 2026-08-24) — continuing-education completion certs
-- are distinct from cert CARDS (BLS/ACLS wallet cards live in 'certs').
ALTER TABLE public.clinical_documents
  DROP CONSTRAINT IF EXISTS clinical_documents_folder_check;
ALTER TABLE public.clinical_documents
  ADD CONSTRAINT clinical_documents_folder_check
  CHECK (folder IN ('signed_forms','certs','ce_certs','counseling','generated','other'));
