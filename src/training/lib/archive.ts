import { supabase } from './supabase'

/**
 * Archive a generated roster / eval / exam file to Supabase Storage.
 * Replaces the legacy `_functions/archiveAhaRecord` Wix endpoint that
 * pushed files into SharePoint.
 *
 * ─── 5-YEAR REGULATORY RETENTION ──────────────────────────────────────
 * These are records WCEMS must retain for 5 years. The bucket is the
 * system-of-record, so this write is deliberately NON-DESTRUCTIVE:
 *
 *   - Every file gets a UTC timestamp prefix, so regenerating a roster
 *     for the same session NEVER overwrites the prior record — each
 *     export is preserved as its own immutable object.
 *   - `upsert: false` — a path collision fails the write rather than
 *     replacing an existing record.
 *   - The bucket RLS grants signed-in staff SELECT + INSERT only — NO
 *     update/delete from the app.
 *
 * Path layout:
 *   training-archives/{sessionId}/{recordType}/{UTCstamp}__{fileName}
 *   training-archives/{sessionId}/Exam/{safeEmail}/{UTCstamp}__{fileName}
 *   training-archives/{sessionId}/CE/{safeEmail}/{UTCstamp}__{fileName}
 *
 * Returns the stored path AND a short-lived signed URL the caller can
 * open in a new tab to preview the freshly-archived file.
 */
export async function archiveFile(opts: {
  sessionId: string
  recordType: 'Roster' | 'Evaluation' | 'Exam' | 'CE'
  fileName: string
  blob: Blob
  /** Required when recordType === 'Exam' or 'CE' — the file is filed
   *  under `{sessionId}/Exam|CE/{safeEmail}/...` so all attempts /
   *  certificates for a student stay together. */
  studentEmail?: string
}): Promise<{ path: string; signedUrl: string }> {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19) // e.g. 2026-05-19_14-32-07

  let path: string
  if (opts.recordType === 'Exam' || opts.recordType === 'CE') {
    if (!opts.studentEmail) {
      throw new Error(`${opts.recordType} uploads require a studentEmail.`)
    }
    path = `${opts.sessionId}/${opts.recordType}/${safeEmail(opts.studentEmail)}/${stamp}__${opts.fileName}`
  } else {
    path = `${opts.sessionId}/${opts.recordType}/${stamp}__${opts.fileName}`
  }

  const contentType =
    opts.blob.type ||
    (opts.fileName.toLowerCase().endsWith('.pdf')
      ? 'application/pdf'
      : 'application/octet-stream')

  const { error } = await supabase.storage
    .from('training-archives')
    .upload(path, opts.blob, { contentType, upsert: false })
  if (error) throw new Error(error.message)

  const { data, error: signErr } = await supabase.storage
    .from('training-archives')
    .createSignedUrl(path, 3600)
  if (signErr || !data?.signedUrl) {
    throw new Error('Archived, but could not generate a preview link.')
  }
  return { path, signedUrl: data.signedUrl }
}

/** Email → safe segment for use inside a storage object key. We keep
 *  alphanumerics and a small set of separators so the path stays
 *  human-readable when listed. */
export function safeEmail(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9._-]+/g, '_')
}
