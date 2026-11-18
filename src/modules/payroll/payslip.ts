import { db, rpc, unwrap } from '@/lib/api'
import { fmtDate } from '@/lib/utils'

const inr = (n: unknown) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function words(n: number): string {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  const two = (x: number) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? ' ' + a[x % 10] : ''}`)
  const three = (x: number) => (x >= 100 ? `${a[Math.floor(x / 100)]} Hundred${x % 100 ? ' ' + two(x % 100) : ''}` : two(x))
  n = Math.round(n)
  if (n === 0) return 'Zero'
  const parts: string[] = []
  const crore = Math.floor(n / 1e7); n %= 1e7
  const lakh = Math.floor(n / 1e5); n %= 1e5
  const thousand = Math.floor(n / 1e3); n %= 1e3
  if (crore) parts.push(`${three(crore)} Crore`)
  if (lakh) parts.push(`${two(lakh)} Lakh`)
  if (thousand) parts.push(`${two(thousand)} Thousand`)
  if (n) parts.push(three(n))
  return parts.join(' ')
}

/** 92991.67 -> "Rupees Ninety Two Thousand Nine Hundred Ninety One and Paise Sixty Seven only" (words must match the figure). */
function amountInWords(amount: number) {
  const paise = Math.round(amount * 100)
  const rupees = Math.floor(paise / 100), p = paise % 100
  return `Rupees ${words(rupees)}${p ? ` and Paise ${words(p)}` : ''} only`
}

/** Generates the payslip PDF in the browser from RLS-protected data. */
export async function downloadPayslip(payslipId: string) {
  const ps = await unwrap<any>(db.from('payslips').select('*, payroll_entries(*, payroll_entry_lines(*))').eq('id', payslipId).single())
  const emp = await unwrap<any>(db.from('employee_directory').select('*').eq('id', ps.employee_id).single())
  const org = await unwrap<any>(db.from('organisations').select('*').single())
  const bank = await db.from('employee_bank_details').select('bank_name, account_number, pan, uan').eq('employee_id', ps.employee_id).maybeSingle()
  const e = ps.payroll_entries
  const lines = (e.payroll_entry_lines ?? []).sort((x: any, y: any) => x.display_order - y.display_order)
  const earnings = lines.filter((l: any) => l.line_type === 'earning')
  const deductions = lines.filter((l: any) => l.line_type === 'deduction')
  const employer = lines.filter((l: any) => l.line_type === 'employer_contribution')

  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  doc.setFillColor(15, 27, 61); doc.rect(0, 0, W, 78, 'F')
  doc.setTextColor(255); doc.setFontSize(16); doc.text(org.legal_name || org.name, 40, 36)
  doc.setFontSize(9); doc.setTextColor(190, 198, 230); doc.text([org.address, org.city, org.state].filter(Boolean).join(', ') || '', 40, 54)
  doc.setTextColor(255); doc.setFontSize(12); doc.text(`Payslip · ${fmtDate(ps.period_month, 'MMMM yyyy')}`, W - 40, 36, { align: 'right' })
  doc.setFontSize(9); doc.text(ps.payslip_number, W - 40, 54, { align: 'right' })

  doc.setTextColor(30)
  autoTable(doc, {
    startY: 96, theme: 'plain', styles: { fontSize: 9, cellPadding: 3 },
    body: [
      ['Employee', emp.full_name, 'Employee ID', emp.employee_code],
      ['Designation', emp.designation_name ?? '—', 'Department', emp.department_name ?? '—'],
      ['Date of joining', fmtDate(emp.date_of_joining), 'PAN / UAN', `${bank.data?.pan ?? '—'} / ${bank.data?.uan ?? '—'}`],
      ['Bank', bank.data?.bank_name ?? '—', 'Account', bank.data?.account_number ? `XXXX${String(bank.data.account_number).slice(-4)}` : '—'],
      ['Days in period', String(e.days_in_period), 'Paid days / LOP', `${e.payable_days} / ${e.lop_days}`],
    ],
    columnStyles: { 0: { textColor: 110, cellWidth: 95 }, 2: { textColor: 110, cellWidth: 95 } },
  })
  const rows = Math.max(earnings.length, deductions.length)
  const body = Array.from({ length: rows }).map((_, i) => [earnings[i]?.component_name ?? '', earnings[i] ? inr(earnings[i].amount) : '', deductions[i]?.component_name ?? '', deductions[i] ? inr(deductions[i].amount) : ''])
  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 14,
    head: [['Earnings', 'Amount (Rs.)', 'Deductions', 'Amount (Rs.)']], body,
    foot: [['Gross earnings', inr(e.gross_earnings), 'Total deductions', inr(e.total_deductions)]],
    styles: { fontSize: 9, cellPadding: 5 }, headStyles: { fillColor: [236, 236, 252], textColor: [40, 40, 90] }, footStyles: { fillColor: [245, 246, 250], textColor: 20, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 3: { halign: 'right' } },
  })
  let y = (doc as any).lastAutoTable.finalY + 22
  doc.setFillColor(230, 245, 236); doc.roundedRect(40, y, W - 80, 46, 6, 6, 'F')
  doc.setFontSize(10); doc.setTextColor(21, 128, 61); doc.text('Net pay', 54, y + 19)
  doc.setFontSize(16); doc.text(`Rs. ${inr(e.net_pay)}`, W - 54, y + 22, { align: 'right' })
  doc.setFontSize(8.5); doc.setTextColor(90); doc.text(amountInWords(Number(e.net_pay)), 54, y + 36)
  y += 64
  if (employer.length) {
    doc.setFontSize(8.5); doc.setTextColor(110)
    doc.text(`Employer contributions (not part of net pay): ${employer.map((l: any) => `${l.component_name} Rs. ${inr(l.amount)}`).join(' · ')}`, 40, y)
    y += 14
  }
  doc.setFontSize(8); doc.setTextColor(140)
  doc.text('This is a system-generated payslip and does not require a signature.', 40, doc.internal.pageSize.getHeight() - 30)
  doc.save(`${ps.payslip_number}.pdf`)
  // "Viewed" means the employee opened it; HR downloading a copy must not mark it.
  if (!ps.viewed_at) {
    const me = await rpc<string | null>('current_employee_id').catch(() => null)
    if (me && me === ps.employee_id) await db.from('payslips').update({ viewed_at: new Date().toISOString() }).eq('id', payslipId)
  }
}
