/** Roles a person can ask for when signing up. The administrator decides the final roles. */
export const SIGNUP_ROLES: { code: string; name: string; hint: string }[] = [
  { code: 'employee', name: 'Employee / worker', hint: 'Attendance, leave, payslips, claims and learning for yourself' },
  { code: 'field_employee', name: 'Field employee', hint: 'Works on sites; site check-in and visit tracking' },
  { code: 'team_leader', name: 'Team leader', hint: 'Sees and approves for a small team' },
  { code: 'dept_manager', name: 'Department manager', hint: 'Approvals and reports for your reporting line' },
  { code: 'hr_executive', name: 'HR executive', hint: 'Day-to-day HR operations' },
  { code: 'hr_admin', name: 'HR administrator', hint: 'Full HR, users and configuration' },
  { code: 'finance_admin', name: 'Finance / payroll', hint: 'Payroll, claims and reimbursements' },
  { code: 'management', name: 'Management', hint: 'Company-wide dashboards and analytics' },
  { code: 'super_admin', name: 'Administrator', hint: 'Everything, including users and roles' },
]

export const roleName = (code?: string | null) => SIGNUP_ROLES.find((r) => r.code === code)?.name ?? code ?? ''

export function passwordProblems(p: string): string | null {
  if (p.length < 10) return 'At least 10 characters'
  if (!/[a-z]/.test(p) || !/[A-Z]/.test(p)) return 'Use both upper- and lower-case letters'
  if (!/[0-9]/.test(p)) return 'Include at least one number'
  return null
}

/** XXXX-XXXX-XXXX, upper case, unambiguous alphabet. Tolerates spaces, dashes and lower case while typing. */
export function formatJoinCode(raw: string) {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
  return c.replace(/(.{4})(?=.)/g, '$1-')
}
