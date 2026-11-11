// @fajekrina/sdui/i18n — localized field-validation messages, kept out of the
// core entry so apps only pay for the languages they use:
//   createEngine({ messages: MESSAGES_ID })
import type { FieldMessages } from '../core/patterns'

const PATTERN_ID: Record<string, string> = {
  numeric: 'hanya boleh berisi angka', alphanumeric: 'hanya boleh berisi huruf dan angka', email: 'harus berupa email yang valid',
  phoneId: 'harus berupa nomor ponsel Indonesia yang valid', amount: 'harus berupa nominal positif', pin6: 'harus 6 digit', nik: 'harus 16 digit'
}

export const MESSAGES_ID: FieldMessages = {
  required: (l) => `${l} wajib diisi`,
  minLength: (l, n) => `${l} minimal ${n} karakter`,
  maxLength: (l, n) => `${l} maksimal ${n} karakter`,
  pattern: (l, p) => `${l} ${PATTERN_ID[p] ?? 'tidak valid'}`,
  unknownPattern: (l) => `${l} tidak dapat divalidasi`
}
