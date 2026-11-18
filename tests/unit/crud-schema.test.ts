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
