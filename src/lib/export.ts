import { fmtDate } from './utils'

export type ExportColumn = { key: string; header: string; format?: (row: any) => string | number | null }

const cell = (c: ExportColumn, r: any) => {
  const v = c.format ? c.format(r) : r[c.key]
  return v === null || v === undefined ? '' : v
}

export async function exportExcel(filename: string, columns: ExportColumn[], rows: any[], sheet = 'Report') {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Apex HRMS'
  const ws = wb.addWorksheet(sheet.slice(0, 31))
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: Math.min(40, Math.max(12, c.header.length + 4)) }))
  rows.forEach((r) => ws.addRow(Object.fromEntries(columns.map((c) => [c.key, cell(c, r)]))))
  ws.getRow(1).font = { bold: true }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  const buf = await wb.xlsx.writeBuffer()
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${filename}.xlsx`)
}

export async function exportPdf(title: string, columns: ExportColumn[], rows: any[], subtitle?: string) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  doc.setFontSize(14)
  doc.text(title, 40, 40)
  doc.setFontSize(9)
  doc.setTextColor(110)
  doc.text(subtitle || `Generated ${fmtDate(new Date(), 'dd MMM yyyy, HH:mm')}`, 40, 56)
  autoTable(doc, {
    startY: 70,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => String(cell(c, r)))),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [15, 27, 61] },
    alternateRowStyles: { fillColor: [245, 246, 250] },
  })
  doc.save(`${title.replace(/\s+/g, '-').toLowerCase()}.pdf`)
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
