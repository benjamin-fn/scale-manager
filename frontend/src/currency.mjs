export function toDisplay(sek, language) {
  return language === 'en' ? sek / 10 : sek
}
export function toSek(amount, language) {
  return Math.round((amount * (language === 'en' ? 10 : 1) + Number.EPSILON) * 100) / 100
}
export function money(sek, language, compact = false) {
  const english = language === 'en'
  return new Intl.NumberFormat(english ? 'en-US' : 'sv-SE', {
    style: 'currency', currency: english ? 'USD' : 'SEK',
    notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 2,
    minimumFractionDigits: 0,
  }).format(toDisplay(sek, language))
}
