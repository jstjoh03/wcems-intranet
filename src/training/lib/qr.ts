import QRCode from 'qrcode'

/**
 * Render a QR code to a data URL. Replaces the legacy dependency on
 * api.qrserver.com / cdnjs qrcodejs — generated locally so QR codes
 * work offline (this is an installable PWA used on station laptops).
 */
export async function qrDataUrl(
  text: string,
  size = 220,
): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 1,
    color: { dark: '#0b3a6a', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  })
}
