// ISO 4217 active currency codes and the number of minor-unit digits each uses.
// Amounts are always stored as integers in minor units (cents, fils, ...).
//
// Deviation from ISO 4217: IRR is treated as having 0 minor digits, since the
// rial has no subunit in practice. The UI can show IRR as toman (1 toman = 10 rial).

const THREE_DIGIT = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];
const ZERO_DIGIT = [
  'BIF', 'CLP', 'DJF', 'GNF', 'IRR', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND',
  'VUV', 'XAF', 'XOF', 'XPF',
];
const FOUR_DIGIT = ['CLF', 'UYW'];

export const CURRENCY_CODES: readonly string[] = [
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN', 'BAM', 'BBD', 'BDT', 'BGN',
  'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHF',
  'CLP', 'CNY', 'COP', 'CRC', 'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP', 'ERN', 'ETB',
  'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HTG',
  'HUF', 'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF',
  'KPW', 'KRW', 'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD', 'MAD', 'MDL', 'MGA',
  'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO',
  'NOK', 'NPR', 'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR', 'RON', 'RSD',
  'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE', 'SOS', 'SRD', 'SSP', 'STN',
  'SVC', 'SYP', 'SZL', 'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX',
  'USD', 'UYU', 'UZS', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XCD', 'XCG', 'XOF', 'XPF', 'YER', 'ZAR',
  'ZMW', 'ZWG',
];

/** Currencies shown first in pickers. */
export const POPULAR_CURRENCIES: readonly string[] = [
  'USD', 'EUR', 'IRR', 'GBP', 'TRY', 'AED', 'SAR', 'IQD', 'INR', 'PKR', 'CNY', 'RUB', 'IDR', 'BDT',
  'BRL', 'AFN',
];

export function isCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

/** Number of minor-unit digits for a currency (2 for anything unknown). */
export function minorDigits(code: string): number {
  if (ZERO_DIGIT.includes(code)) return 0;
  if (THREE_DIGIT.includes(code)) return 3;
  if (FOUR_DIGIT.includes(code)) return 4;
  return 2;
}
