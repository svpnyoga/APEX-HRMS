import { describe, it, expect } from 'vitest'
import { essEquivalent } from '@/app/App'

describe('employees are sent to the matching page in their own portal', () => {
  it.each([
    ['/notifications', '/me/notifications'], ['/engagement/recognition', '/me/community'], ['/engagement/news', '/me/announcements'],
    ['/leave/apply', '/me/leave'], ['/claims/mine', '/me/claims'], ['/learning/my', '/me/learning'], ['/payroll/payslips', '/me/payslips'],
    ['/employees', '/me'], ['/admin/users', '/me'], ['/payroll/runs', '/me'], ['/leavesomething', '/me'],
  ])('%s → %s', (from, to) => expect(essEquivalent(from)).toBe(to))
})
