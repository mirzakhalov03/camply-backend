// Uzbekistan is the first market: national numbers are 9 digits (e.g. 901234567).
// We store the canonical E.164 form so uniqueness is unambiguous no matter how
// the client formatted the input.
const UZ_COUNTRY_CODE = '+998'

export function canonicalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  // Tolerate a leading country code if it ever arrives; keep the 9 national digits.
  const national = digits.startsWith('998') ? digits.slice(3) : digits
  return `${UZ_COUNTRY_CODE}${national}`
}
