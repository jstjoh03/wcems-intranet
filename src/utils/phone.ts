/**
 * Live US phone formatting for inputs: digits are massaged into
 * "(979) 555-0123" as the user types. A leading 1 (country code) is
 * dropped. Anything that isn't a plain 10-digit US number — an
 * extension, an international number, more than 11 digits — is left
 * exactly as typed, so the formatter never fights the user.
 */
export function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  const d = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (d.length > 10 || (digits.length === 11 && !digits.startsWith('1'))) return raw
  if (d.length === 0) return ''
  if (d.length <= 3) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}
