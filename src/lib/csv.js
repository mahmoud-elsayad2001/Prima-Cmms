/** CSV-Export mit Semikolon-Trennung und BOM – öffnet sauber in Excel (DE). */
export function exportCsv(filename, rows) {
  if (!rows?.length) return
  const headers = Object.keys(rows[0])
  const escape = (v) => {
    if (v == null) return ''
    if (Array.isArray(v)) v = v.join(' | ')
    if (v instanceof Date) v = v.toLocaleString('de-DE')
    const s = String(v).replace(/"/g, '""')
    return /[";\n]/.test(s) ? `"${s}"` : s
  }
  const csv = [headers.join(';'), ...rows.map((r) => headers.map((h) => escape(r[h])).join(';'))].join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
