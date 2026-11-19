import { describe, expect, it } from 'vitest'
import { buildSchema } from '@/components/crud/CrudPage'

describe('CrudPage buildSchema optional numbers', () => {
  const schema = buildSchema([{ name: 'days', label: 'Days', type: 'number', min: 0 }])
  it('keeps a blank optional number as null, not 0', () => {
    expect(schema.parse({ days: '' }).days).toBeNull()
  })
  it('still accepts 0 and other numbers', () => {
    expect(schema.parse({ days: '0' }).days).toBe(0)
    expect(schema.parse({ days: '2.5' }).days).toBe(2.5)
  })
  it('rejects values below min', () => {
    expect(() => schema.parse({ days: '-1' })).toThrow()
  })
})

import { moneyShort } from '@/lib/utils'
describe('moneyShort axis labels', () => {
  it('keeps small amounts readable and distinct', () => {
    expect([0, 250, 500, 750, 1000, 1250].map(moneyShort)).toEqual(['₹0', '₹250', '₹500', '₹750', '₹1k', '₹1.3k'])
    expect(moneyShort(250000)).toBe('₹2.5L')
    expect(moneyShort(19870135)).toBe('₹2Cr')
  })
})

import { cleanBasis } from '@/lib/utils'
describe('cleanBasis', () => {
  it('tidies database calculation notes', () => {
    expect(cleanBasis('12.0000% of 15000.00')).toBe('12% of 15,000')
    expect(cleanBasis('0.7500% of 19500')).toBe('0.75% of 19,500')
    expect(cleanBasis('3.2500% of 8400')).toBe('3.25% of 8,400')
    expect(cleanBasis('9000.00 × 14/30 days')).toBe('9,000 × 14/30 days')
    expect(cleanBasis('Tamil Nadu slab')).toBe('Tamil Nadu slab')
    expect(cleanBasis(null)).toBe('')
  })
})
