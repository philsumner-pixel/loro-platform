// Text normalisation for TTS — converts written numbers to natural spoken form.
// Ported from the Top7Labs engine.

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function numberToWords(n: number): string {
  if (n === 0) return 'zero'
  if (n < 0) return 'minus ' + numberToWords(-n)
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '')
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' and ' + numberToWords(n % 100) : '')
  if (n < 1000000) {
    const thousands = Math.floor(n / 1000)
    const remainder = n % 1000
    return numberToWords(thousands) + ' thousand' + (remainder ? (remainder < 100 ? ' and ' : ' ') + numberToWords(remainder) : '')
  }
  if (n < 1000000000) {
    const millions = Math.floor(n / 1000000)
    const remainder = n % 1000000
    return numberToWords(millions) + ' million' + (remainder ? ' ' + numberToWords(remainder) : '')
  }
  return n.toString()
}

function currencyToWords(amount: number, symbol: string): string {
  const name = symbol === '£' ? 'pounds' : symbol === '$' ? 'dollars' : symbol === '€' ? 'euros' : 'pounds'
  if (amount >= 1000000000) {
    const b = amount / 1000000000
    return (Number.isInteger(b) ? numberToWords(b) : b.toFixed(1).replace('.', ' point ')) + ' billion ' + name
  }
  if (amount >= 1000000) {
    const m = amount / 1000000
    return (Number.isInteger(m) ? numberToWords(m) : m.toFixed(1).replace('.', ' point ')) + ' million ' + name
  }
  if (amount >= 1000) {
    const k = amount / 1000
    return (Number.isInteger(k) ? numberToWords(k) : k.toFixed(1).replace('.', ' point ')) + ' thousand ' + name
  }
  return numberToWords(Math.round(amount)) + ' ' + name
}

function normaliseCurrency(text: string): string {
  return text
    .replace(/(£|\$|€)(\d+(?:\.\d+)?)(k|m|bn|b|K|M|BN|B)\b/g, (_, sym, num, suffix) => {
      const n = parseFloat(num)
      const mult = suffix.toLowerCase() === 'k' ? 1000 : suffix.toLowerCase() === 'm' ? 1000000 : 1000000000
      return currencyToWords(n * mult, sym)
    })
    .replace(/(£|\$|€)([\d,]+)/g, (m, sym, numStr) => {
      const n = parseInt(numStr.replace(/,/g, ''))
      return isNaN(n) ? m : currencyToWords(n, sym)
    })
    .replace(/(£|\$|€)(\d+(?:\.\d+)?)/g, (_, sym, num) => currencyToWords(parseFloat(num), sym))
}

export function normaliseText(text: string): string {
  let result = normaliseCurrency(text)
  result = result.replace(/(\d+(?:\.\d+)?)%/g, (_, n) => {
    const num = parseFloat(n)
    return (Number.isInteger(num) ? numberToWords(num) : n) + ' percent'
  })
  return result
}
