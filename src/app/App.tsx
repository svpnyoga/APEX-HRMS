import { lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { ShieldOff, UserX } from 'lucide-react'
import { AuthProvider, isSelfServiceOnly, useAuth, useMe } from './auth'
import { NAV } from './nav'
import { db } from '@/lib/api'
import { ConfirmProvider } from '@/components/common/confirm'
import { EmptyState, LoadingRows } from '@/components/common/page'
import { AppShell } from '@/components/layout/AppShell'
import { EssShell } from '@/components/layout/EssShell'
import { useTheme } from '@/components/layout/theme'

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } })

// code-split each module; pages are named exports
function lz<T extends Record<string, any>>(loader: () => Promise<T>, name: keyof T): ComponentType<any> {
  return lazy(async () => ({ default: (await loader())[name] as ComponentType<any> }))
}
const M = {
  dash: () => import('@/modules/dashboard/pages'), emp: () => import('@/modules/employees/pages'), att: () => import('@/modules/attendance/pages'),
  clock: () => import('@/modules/attendance/clock'), face: () => import('@/modules/attendance/face-admin'), leave: () => import('@/modules/leave/pages'),
  pay: () => import('@/modules/payroll/pages'), claims: () => import('@/modules/claims/pages'), perf: () => import('@/modules/performance/pages'),
  eng: () => import('@/modules/engagement/pages'), field: () => import('@/modules/field/pages'), life: () => import('@/modules/lifecycle/pages'),
  lms: () => import('@/modules/learning/pages'), rep: () => import('@/modules/reports/pages'), admin: () => import('@/modules/admin/pages'),
  self: () => import('@/modules/self/pages'), auth: () => import('@/modules/auth/pages'), approvals: () => import('@/modules/approvals/Inbox'),
  access: () => import('@/modules/admin/access'), signup: () => import('@/modules/auth/signup'),
}
const P = {
  HrOverview: lz(M.dash, 'HrOverview'), WorkforceOverview: lz(M.dash, 'WorkforceOverview'), ManagementAnalytics: lz(M.dash, 'ManagementAnalytics'),
  Directory: lz(M.emp, 'Directory'), EmployeeProfile: lz(M.emp, 'EmployeeProfile'), DepartmentsPage: lz(M.emp, 'DepartmentsPage'), DesignationsPage: lz(M.emp, 'DesignationsPage'),
  OrgStructure: lz(M.emp, 'OrgStructure'), ReportingHierarchy: lz(M.emp, 'ReportingHierarchy'), DocumentsPage: lz(M.emp, 'DocumentsPage'), LifecyclePage: lz(M.emp, 'LifecyclePage'),
  TransfersPage: lz(M.emp, 'TransfersPage'), EmployeeHistoryPage: lz(M.emp, 'EmployeeHistoryPage'),
  AttendanceDashboard: lz(M.att, 'AttendanceDashboard'), DailyAttendance: lz(M.att, 'DailyAttendance'), MonthlyRegister: lz(M.att, 'MonthlyRegister'),
  AttendanceCalendarPage: lz(M.att, 'AttendanceCalendarPage'), ClockPage: lz(M.att, 'ClockPage'), AttendanceExceptions: lz(M.att, 'AttendanceExceptions'),
  OvertimePage: lz(M.att, 'OvertimePage'), RegularisationPage: lz(M.att, 'RegularisationPage'), ShiftsPage: lz(M.att, 'ShiftsPage'), SchedulesPage: lz(M.att, 'SchedulesPage'),
  HolidaysPage: lz(M.att, 'HolidaysPage'), FaceAdmin: lz(M.face, 'FaceAdmin'),
  LeaveDashboard: lz(M.leave, 'LeaveDashboard'), LeaveApplicationsPage: lz(M.leave, 'LeaveApplicationsPage'), ApplyLeavePage: lz(M.leave, 'ApplyLeavePage'),
  LeaveApprovalsPage: lz(M.leave, 'LeaveApprovalsPage'), LeaveTypesPage: lz(M.leave, 'LeaveTypesPage'), LeavePoliciesPage: lz(M.leave, 'LeavePoliciesPage'),
  LeaveBalancesPage: lz(M.leave, 'LeaveBalancesPage'), LeaveAccrualPage: lz(M.leave, 'LeaveAccrualPage'), LeaveEncashmentPage: lz(M.leave, 'LeaveEncashmentPage'),
  LeaveCalendarPage: lz(M.leave, 'LeaveCalendarPage'), LeaveHolidaysPage: lz(M.leave, 'LeaveHolidaysPage'),
  PayrollDashboard: lz(M.pay, 'PayrollDashboard'), StructuresPage: lz(M.pay, 'StructuresPage'), SalaryConfigPage: lz(M.pay, 'SalaryConfigPage'), AllowancesPage: lz(M.pay, 'AllowancesPage'),
  DeductionsPage: lz(M.pay, 'DeductionsPage'), StatutoryPage: lz(M.pay, 'StatutoryPage'), PayrollProcessing: lz(M.pay, 'PayrollProcessing'), PayrollApproval: lz(M.pay, 'PayrollApproval'),
  PayslipsPage: lz(M.pay, 'PayslipsPage'), SalaryRevisionsPage: lz(M.pay, 'SalaryRevisionsPage'), AdjustmentsPage: lz(M.pay, 'AdjustmentsPage'), FnfPage: lz(M.pay, 'FnfPage'),
  ClaimsDashboard: lz(M.claims, 'ClaimsDashboard'), SubmitClaimPage: lz(M.claims, 'SubmitClaimPage'), MyClaimsPage: lz(M.claims, 'MyClaimsPage'), AllClaimsPage: lz(M.claims, 'AllClaimsPage'),
  ClaimCategoriesPage: lz(M.claims, 'ClaimCategoriesPage'), ExpensePoliciesPage: lz(M.claims, 'ExpensePoliciesPage'), ClaimApprovalsPage: lz(M.claims, 'ClaimApprovalsPage'),
  ReimbursementsPage: lz(M.claims, 'ReimbursementsPage'), ReceiptsPage: lz(M.claims, 'ReceiptsPage'),
  PerformanceDashboard: lz(M.perf, 'PerformanceDashboard'), CyclesPage: lz(M.perf, 'CyclesPage'), GoalsPage: lz(M.perf, 'GoalsPage'), KpisPage: lz(M.perf, 'KpisPage'),
  ReviewsPage: lz(M.perf, 'ReviewsPage'), ReviewStagePage: lz(M.perf, 'ReviewStagePage'), FeedbackPage: lz(M.perf, 'FeedbackPage'), RatingScalesPage: lz(M.perf, 'RatingScalesPage'),
  AppraisalHistoryPage: lz(M.perf, 'AppraisalHistoryPage'),
  AnnouncementsPage: lz(M.eng, 'AnnouncementsPage'), RecognitionPage: lz(M.eng, 'RecognitionPage'), FeedbackSuggestionsPage: lz(M.eng, 'FeedbackSuggestionsPage'),
  SurveysPage: lz(M.eng, 'SurveysPage'), EventsPage: lz(M.eng, 'EventsPage'), NotificationsPage: lz(M.eng, 'NotificationsPage'), MyAnnouncements: lz(M.eng, 'MyAnnouncements'), EssCommunity: lz(M.eng, 'EssCommunity'),
  FieldDashboard: lz(M.field, 'FieldDashboard'), LiveLocationPage: lz(M.field, 'LiveLocationPage'), SiteAttendancePage: lz(M.field, 'SiteAttendancePage'),
  AssignmentsPage: lz(M.field, 'AssignmentsPage'), SitesPage: lz(M.field, 'SitesPage'), GpsTrackingPage: lz(M.field, 'GpsTrackingPage'), GeofencingPage: lz(M.field, 'GeofencingPage'),
  VisitsPage: lz(M.field, 'VisitsPage'), LocationHistoryPage: lz(M.field, 'LocationHistoryPage'),
  OnboardingPage: lz(M.life, 'OnboardingPage'), NewEmployeeRegistration: lz(M.life, 'NewEmployeeRegistration'), AssetsPage: lz(M.life, 'AssetsPage'),
  PolicyAcknowledgementPage: lz(M.life, 'PolicyAcknowledgementPage'), OffboardingPage: lz(M.life, 'OffboardingPage'), ResignationApprovalsPage: lz(M.life, 'ResignationApprovalsPage'),
  ExitHistoryPage: lz(M.life, 'ExitHistoryPage'),
  LmsDashboard: lz(M.lms, 'LmsDashboard'), CourseLibrary: lz(M.lms, 'CourseLibrary'), CourseCategoriesPage: lz(M.lms, 'CourseCategoriesPage'), ProgramsPage: lz(M.lms, 'ProgramsPage'),
  EnrolmentsPage: lz(M.lms, 'EnrolmentsPage'), LmsAssignmentsPage: lz(M.lms, 'AssignmentsPage'), TrainingCalendarPage: lz(M.lms, 'TrainingCalendarPage'),
  AssessmentsPage: lz(M.lms, 'AssessmentsPage'), CertificatesPage: lz(M.lms, 'CertificatesPage'), CoursePlayer: lz(M.lms, 'CoursePlayer'),
  ReportView: lz(M.rep, 'ReportView'), CustomReports: lz(M.rep, 'CustomReports'), ExportCentre: lz(M.rep, 'ExportCentre'),
  UsersPage: lz(M.access, 'UsersPage'), RolesPage: lz(M.admin, 'RolesPage'), CompanyPage: lz(M.admin, 'CompanyPage'), OrganisationSettingsPage: lz(M.admin, 'OrganisationSettingsPage'),
  SettingsPage: lz(M.admin, 'SettingsPage'), ApprovalConfigPage: lz(M.admin, 'ApprovalConfigPage'), NotificationSettingsPage: lz(M.admin, 'NotificationSettingsPage'),
  EmailSettingsPage: lz(M.admin, 'EmailSettingsPage'), IntegrationsPage: lz(M.admin, 'IntegrationsPage'), SecurityPage: lz(M.admin, 'SecurityPage'),
  AuditLogsPage: lz(M.admin, 'AuditLogsPage'), BackupPage: lz(M.admin, 'BackupPage'),
  EssHome: lz(M.self, 'EssHome'), EssAttendance: lz(M.self, 'EssAttendance'), EssLeave: lz(M.self, 'EssLeave'), EssClaims: lz(M.self, 'EssClaims'), EssPayslips: lz(M.self, 'EssPayslips'),
  EssLearning: lz(M.self, 'EssLearning'), EssPerformance: lz(M.self, 'EssPerformance'), EssApprovals: lz(M.self, 'EssApprovals'), EssProfile: lz(M.self, 'EssProfile'), EssResignation: lz(M.self, 'EssResignation'),
  LoginPage: lz(M.auth, 'LoginPage'), ResetPasswordPage: lz(M.auth, 'ResetPasswordPage'),
  SignupPage: lz(M.signup, 'SignupPage'), AccountSetup: lz(M.signup, 'AccountSetup'),
}

function Gate({ perm, children }: { perm?: string | string[]; children: ReactNode }) {
  const { can } = useAuth()
  if (perm && !can(perm)) return <EmptyState icon={ShieldOff} title="You don't have access to this page" description="Ask an administrator if you need it. Access is enforced on the server as well." />
  return <>{children}</>
}

function RequireAuth() {
  const { session, loading, access } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="flex h-full items-center justify-center"><div className="w-64"><LoadingRows rows={3} /></div></div>
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  // signed in but not (yet) part of a company: finish sign-up / wait for approval
  if (access && !access.organisation_id) return <Suspense fallback={null}><P.AccountSetup /></Suspense>
  if (access && !access.active) return <EmptyState icon={ShieldOff} title="Your account is inactive" description="Contact HR if you believe this is a mistake." />
  return <Outlet />
}

function Home() {
  const { access, can } = useAuth()
  if (!access) return null
  if (isSelfServiceOnly(access.permissions) && !access.is_manager) return <Navigate to="/me" replace />
  if (can('dashboard.view')) return <Navigate to="/dashboard" replace />
  if (access.is_manager) return <Navigate to="/dashboard/workforce" replace />
  return <Navigate to="/me" replace />
}

/** Employees with only self-service access always stay in their own portal: any HR/admin address sends them to /me. */
function StaffOnly() {
  const { access } = useAuth()
  const loc = useLocation()
  if (access && isSelfServiceOnly(access.permissions) && !access.is_manager) return <Navigate to={essEquivalent(loc.pathname)} replace />
  return <AppShell />
}

/** The employee-portal page that matches an HR-portal address (e.g. a link in a notification). */
const ESS_EQUIVALENT: [string, string][] = [
  ['/notifications', '/me/notifications'],
  ['/engagement/announcements', '/me/announcements'], ['/engagement/news', '/me/announcements'], ['/engagement/policies', '/me/announcements'],
  ['/engagement', '/me/community'],
  ['/leave', '/me/leave'], ['/claims', '/me/claims'], ['/attendance', '/me/attendance'], ['/payroll/payslips', '/me/payslips'],
  ['/learning', '/me/learning'], ['/performance', '/me/performance'], ['/offboarding', '/me/resignation'], ['/approvals', '/me/approvals'],
]
export const essEquivalent = (path: string) => ESS_EQUIVALENT.find(([from]) => path === from || path.startsWith(from + '/'))?.[1] ?? '/me'

function ReportRoute() { const { report } = useParams(); return <P.ReportView key={report} reportKey={report} /> }

/** Signs out after the configured inactivity period. */
function IdleLogout() {
  const { session, signOut } = useAuth()
  const s = useQuery({ queryKey: ['company-settings', 'session-timeout'], enabled: !!session, queryFn: async () => (await db.from('company_settings').select('session_timeout_minutes').maybeSingle()).data })
  useEffect(() => {
    if (!session) return
    const ms = (s.data?.session_timeout_minutes ?? 480) * 60_000
    let t = setTimeout(signOut, ms)
    const reset = () => { clearTimeout(t); t = setTimeout(signOut, ms) }
    const ev = ['mousedown', 'keydown', 'touchstart', 'scroll']
    ev.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    return () => { clearTimeout(t); ev.forEach((e) => window.removeEventListener(e, reset)) }
  }, [session, s.data, signOut])
  return null
}

const g = (perm: string | string[] | undefined, el: ReactNode) => <Gate perm={perm}>{el}</Gate>

/** Personal pages ("my leave", "my claims", "my appraisal history") need the login to be linked to an employee record.
 *  Admin-only logins (e.g. an owner account) get an explanation instead of a database error about an empty id. */
function RequireEmployee({ children }: { children: ReactNode }) {
  const { employeeId } = useMe()
  const { access } = useAuth()
  if (!access) return <LoadingRows />
  if (!employeeId) return <EmptyState icon={UserX} title="Your login is not linked to an employee record"
    description="This page shows your own records (leave, claims, appraisals, payslips…), and this account is not an employee. To see someone's records, open their profile from the Employee directory." />
  return <>{children}</>
}
const mine = (el: ReactNode) => <RequireEmployee>{el}</RequireEmployee>
const VIEW_ATT = ['attendance.view', 'attendance.view_team']

export const ROUTES: { path: string; element: ReactNode }[] = [
  { path: '/dashboard', element: g('dashboard.view', <P.HrOverview />) },
  { path: '/dashboard/workforce', element: g(['dashboard.view', 'attendance.view_team'], <P.WorkforceOverview />) },
  { path: '/dashboard/analytics', element: g('dashboard.analytics', <P.ManagementAnalytics />) },
  { path: '/employees', element: <P.Directory /> },
  { path: '/employees/profiles', element: g(['employees.view', 'employees.view_team'], <P.Directory cards />) },
  { path: '/employees/departments', element: <P.DepartmentsPage /> },
  { path: '/employees/designations', element: <P.DesignationsPage /> },
  { path: '/employees/structure', element: <P.OrgStructure /> },
  { path: '/employees/hierarchy', element: <P.ReportingHierarchy /> },
  { path: '/employees/documents', element: g('employees.documents', <P.DocumentsPage />) },
  { path: '/employees/lifecycle', element: g(['employees.view', 'employees.manage'], <P.LifecyclePage />) },
  { path: '/employees/transfers', element: g('employees.manage', <P.TransfersPage />) },
  { path: '/employees/history', element: g(['employees.view', 'employees.view_team'], <P.EmployeeHistoryPage />) },
  { path: '/employees/:id', element: g(['employees.view', 'employees.view_team'], <P.EmployeeProfile />) },
  { path: '/attendance', element: g(VIEW_ATT, <P.AttendanceDashboard />) },
  { path: '/attendance/daily', element: g(VIEW_ATT, <P.DailyAttendance />) },
  { path: '/attendance/monthly', element: g(VIEW_ATT, <P.MonthlyRegister />) },
  { path: '/attendance/calendar', element: <P.AttendanceCalendarPage /> },
  { path: '/attendance/clock', element: g('attendance.clock', mine(<P.ClockPage />)) },
  { path: '/attendance/face', element: g('attendance.face_enrol', <P.FaceAdmin />) },
  { path: '/attendance/shifts', element: g('attendance.manage', <P.ShiftsPage />) },
  { path: '/attendance/schedules', element: g('attendance.manage', <P.SchedulesPage />) },
  { path: '/attendance/overtime', element: g(VIEW_ATT, <P.OvertimePage />) },
  { path: '/attendance/late', element: g(VIEW_ATT, <P.AttendanceExceptions kind="late" />) },
  { path: '/attendance/early', element: g(VIEW_ATT, <P.AttendanceExceptions kind="early" />) },
  { path: '/attendance/missing-checkout', element: g(VIEW_ATT, <P.AttendanceExceptions kind="missing" />) },
  { path: '/attendance/regularisation', element: <P.RegularisationPage /> },
  { path: '/attendance/holidays', element: <P.HolidaysPage /> },
  { path: '/leave', element: g(['leave.view', 'leave.view_team'], <P.LeaveDashboard />) },
  { path: '/leave/applications', element: <P.LeaveApplicationsPage /> },
  { path: '/leave/apply', element: g('leave.apply', mine(<P.ApplyLeavePage />)) },
  { path: '/leave/approvals', element: <P.LeaveApprovalsPage /> },
  { path: '/leave/types', element: g('leave.manage', <P.LeaveTypesPage />) },
  { path: '/leave/policies', element: g('leave.manage', <P.LeavePoliciesPage />) },
  { path: '/leave/balances', element: <P.LeaveBalancesPage /> },
  { path: '/leave/accrual', element: g('leave.manage', <P.LeaveAccrualPage />) },
  { path: '/leave/encashment', element: <P.LeaveEncashmentPage /> },
  { path: '/leave/calendar', element: <P.LeaveCalendarPage /> },
  { path: '/leave/holidays', element: g('attendance.manage', <P.LeaveHolidaysPage />) },
  { path: '/payroll', element: g('payroll.view', <P.PayrollDashboard />) },
  { path: '/payroll/structures', element: g('payroll.view', <P.StructuresPage />) },
  { path: '/payroll/salaries', element: g('payroll.view', <P.SalaryConfigPage />) },
  { path: '/payroll/allowances', element: g('payroll.view', <P.AllowancesPage />) },
  { path: '/payroll/deductions', element: g('payroll.view', <P.DeductionsPage />) },
  { path: '/payroll/statutory', element: g('payroll.view', <P.StatutoryPage />) },
  { path: '/payroll/processing', element: g('payroll.process', <P.PayrollProcessing />) },
  { path: '/payroll/review', element: g('payroll.view', <P.PayrollProcessing reviewOnly />) },
  { path: '/payroll/approval', element: g('payroll.view', <P.PayrollApproval />) },
  { path: '/payroll/payslips', element: g('payroll.view', <P.PayslipsPage />) },
  { path: '/payroll/revisions', element: g('payroll.view', <P.SalaryRevisionsPage />) },
  { path: '/payroll/adjustments', element: g('payroll.view', <P.AdjustmentsPage />) },
  { path: '/payroll/fnf', element: g('payroll.view', <P.FnfPage />) },
  { path: '/claims', element: g(['claims.view', 'claims.view_team', 'claims.reimburse'], <P.ClaimsDashboard />) },
  { path: '/claims/new', element: g('claims.submit', mine(<P.SubmitClaimPage />)) },
  { path: '/claims/mine', element: g('claims.submit', mine(<P.MyClaimsPage />)) },
  { path: '/claims/all', element: g(['claims.view', 'claims.view_team', 'claims.reimburse'], <P.AllClaimsPage />) },
  { path: '/claims/categories', element: g('claims.manage', <P.ClaimCategoriesPage />) },
  { path: '/claims/policies', element: g('claims.manage', <P.ExpensePoliciesPage />) },
  { path: '/claims/approvals', element: <P.ClaimApprovalsPage /> },
  { path: '/claims/reimbursements', element: g('claims.reimburse', <P.ReimbursementsPage />) },
  { path: '/claims/receipts', element: g(['claims.view', 'claims.reimburse', 'claims.view_team'], <P.ReceiptsPage />) },
  { path: '/performance', element: g(['performance.view', 'performance.view_team', 'performance.manage'], <P.PerformanceDashboard />) },
  { path: '/performance/cycles', element: g(['performance.manage', 'performance.view'], <P.CyclesPage />) },
  { path: '/performance/goals', element: <P.GoalsPage /> },
  { path: '/performance/kpis', element: g('performance.manage', <P.KpisPage />) },
  { path: '/performance/reviews', element: g(['performance.view', 'performance.view_team'], <P.ReviewsPage />) },
  { path: '/performance/self', element: mine(<P.ReviewStagePage stage="self" />) },
  { path: '/performance/manager', element: g(['performance.view_team', 'performance.manage'], <P.ReviewStagePage stage="manager" />) },
  { path: '/performance/hr', element: g('performance.manage', <P.ReviewStagePage stage="hr" />) },
  { path: '/performance/feedback', element: <P.FeedbackPage /> },
  { path: '/performance/ratings', element: g('performance.manage', <P.RatingScalesPage />) },
  { path: '/performance/history', element: mine(<P.AppraisalHistoryPage />) },
  { path: '/engagement/announcements', element: <P.AnnouncementsPage category="announcement" /> },
  { path: '/engagement/news', element: <P.AnnouncementsPage category="news" /> },
  { path: '/engagement/communication', element: <P.AnnouncementsPage category="communication" /> },
  { path: '/engagement/policies', element: <P.AnnouncementsPage category="policy" /> },
  { path: '/engagement/recognition', element: <P.RecognitionPage /> },
  { path: '/engagement/feedback', element: <P.FeedbackSuggestionsPage /> },
  { path: '/engagement/surveys', element: <P.SurveysPage /> },
  { path: '/engagement/events', element: <P.EventsPage /> },
  { path: '/notifications', element: <P.NotificationsPage /> },
  { path: '/field', element: g(['field.view', 'field.view_team', 'field.manage'], <P.FieldDashboard />) },
  { path: '/field/live', element: g(['field.view', 'field.view_team', 'field.manage'], <P.LiveLocationPage />) },
  { path: '/field/site-attendance', element: g(['field.view', 'field.view_team', 'field.manage'], <P.SiteAttendancePage />) },
  { path: '/field/assignments', element: g('field.manage', <P.AssignmentsPage />) },
  { path: '/field/sites', element: g('field.manage', <P.SitesPage />) },
  { path: '/field/gps', element: g('field.manage', <P.GpsTrackingPage />) },
  { path: '/field/geofencing', element: g('field.manage', <P.GeofencingPage />) },
  { path: '/field/visits', element: g(['field.view', 'field.view_team', 'field.manage'], <P.VisitsPage />) },
  { path: '/field/history', element: <P.LocationHistoryPage /> },
  { path: '/onboarding', element: g(['onboarding.view', 'onboarding.manage'], <P.OnboardingPage />) },
  { path: '/onboarding/new', element: g('onboarding.manage', <P.NewEmployeeRegistration />) },
  { path: '/onboarding/assets', element: g(['onboarding.manage', 'employees.manage'], <P.AssetsPage />) },
  { path: '/onboarding/policies', element: g(['onboarding.view', 'onboarding.manage'], <P.PolicyAcknowledgementPage />) },
  { path: '/offboarding', element: <P.OffboardingPage /> },
  { path: '/offboarding/approvals', element: <P.ResignationApprovalsPage /> },
  { path: '/offboarding/assets', element: g('offboarding.manage', <P.AssetsPage returnMode />) },
  { path: '/offboarding/history', element: g(['offboarding.view', 'offboarding.manage'], <P.ExitHistoryPage />) },
  { path: '/learning', element: g(['learning.view', 'learning.manage'], <P.LmsDashboard />) },
  { path: '/learning/library', element: <P.CourseLibrary /> },
  { path: '/learning/categories', element: g('learning.manage', <P.CourseCategoriesPage />) },
  { path: '/learning/programs', element: g('learning.manage', <P.ProgramsPage />) },
  { path: '/learning/enrolments', element: g(['learning.view', 'learning.manage', 'learning.view_team'], <P.EnrolmentsPage />) },
  { path: '/learning/assignments', element: g('learning.manage', <P.LmsAssignmentsPage />) },
  { path: '/learning/calendar', element: <P.TrainingCalendarPage /> },
  { path: '/learning/assessments', element: g('learning.manage', <P.AssessmentsPage />) },
  { path: '/learning/certificates', element: <P.CertificatesPage /> },
  { path: '/learning/progress', element: g(['learning.view', 'learning.manage', 'learning.view_team'], <P.EnrolmentsPage progressView />) },
  { path: '/learning/course/:id', element: <P.CoursePlayer /> },
  { path: '/reports/custom', element: g('reports.view', <P.CustomReports />) },
  { path: '/reports/export', element: g('reports.export', <P.ExportCentre />) },
  { path: '/reports/view/:report', element: g('reports.view', <ReportRoute />) },
  { path: '/reports/:report', element: g('reports.view', <ReportRoute />) },
  { path: '/admin/users', element: g('admin.users', <P.UsersPage />) },
  { path: '/admin/roles', element: g('admin.roles', <P.RolesPage />) },
  { path: '/admin/organisation', element: g('admin.manage', <P.OrganisationSettingsPage />) },
  { path: '/admin/company', element: g('admin.manage', <P.CompanyPage />) },
  { path: '/admin/attendance-rules', element: g('admin.manage', <P.SettingsPage section="attendance" title="Attendance rules" />) },
  { path: '/admin/leave-config', element: g('admin.manage', <P.SettingsPage section="leave" title="Leave configuration" />) },
  { path: '/admin/payroll-config', element: g('admin.manage', <P.SettingsPage section="payroll" title="Payroll configuration" />) },
  { path: '/admin/approvals', element: g('admin.workflows', <P.ApprovalConfigPage />) },
  { path: '/admin/notifications', element: g('admin.manage', <P.NotificationSettingsPage />) },
  { path: '/admin/email', element: g('admin.manage', <P.EmailSettingsPage />) },
  { path: '/admin/integrations', element: g('admin.manage', <P.IntegrationsPage />) },
  { path: '/admin/security', element: g('admin.manage', <P.SecurityPage />) },
  { path: '/admin/audit', element: g('admin.audit', <P.AuditLogsPage />) },
  { path: '/admin/backup', element: g('admin.manage', <P.BackupPage />) },
]

const ESS_ROUTES: { path: string; element: ReactNode }[] = [
  { path: '/me', element: mine(<P.EssHome />) }, { path: '/me/attendance', element: mine(<P.EssAttendance />) }, { path: '/me/leave', element: mine(<P.EssLeave />) },
  { path: '/me/claims', element: mine(<P.EssClaims />) }, { path: '/me/payslips', element: mine(<P.EssPayslips />) }, { path: '/me/learning', element: mine(<P.EssLearning />) },
  { path: '/me/performance', element: mine(<P.EssPerformance />) }, { path: '/me/announcements', element: <P.MyAnnouncements /> }, { path: '/me/community', element: <P.EssCommunity /> }, { path: '/me/notifications', element: <P.NotificationsPage /> }, { path: '/me/approvals', element: <P.EssApprovals /> },
  { path: '/me/profile', element: mine(<P.EssProfile />) }, { path: '/me/resignation', element: mine(<P.EssResignation />) },
]

// Development guard: every sidebar item must resolve to a real route (no dead menus).
if (import.meta.env.DEV) {
  const patterns = [...ROUTES, ...ESS_ROUTES].map((r) => new RegExp('^' + r.path.replace(/:[^/]+/g, '[^/]+') + '$'))
  const dead = NAV.flatMap((m) => m.items).filter((i) => !patterns.some((p) => p.test(i.path.split('?')[0])))
  if (dead.length) console.error('[nav] items without a route:', dead.map((d) => d.path))
}

function Loading() { return <div className="p-6"><LoadingRows rows={5} /></div> }

export default function App() {
  useTheme()
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <ConfirmProvider>
          <BrowserRouter>
            <IdleLogout />
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/login" element={<P.LoginPage />} />
                <Route path="/reset-password" element={<P.ResetPasswordPage />} />
                <Route path="/signup" element={<P.SignupPage />} />
                <Route element={<RequireAuth />}>
                  <Route path="/" element={<Home />} />
                  <Route element={<EssShell />}>{ESS_ROUTES.map((r) => <Route key={r.path} path={r.path} element={<Suspense fallback={<Loading />}>{r.element}</Suspense>} />)}</Route>
                  <Route element={<StaffOnly />}>
                    {ROUTES.map((r) => <Route key={r.path} path={r.path} element={<Suspense fallback={<Loading />}>{r.element}</Suspense>} />)}
                    <Route path="*" element={<EmptyState title="Page not found" description="The link may be out of date." />} />
                  </Route>
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
          <Toaster position="top-right" richColors closeButton toastOptions={{ style: { fontFamily: 'inherit' } }} />
        </ConfirmProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
