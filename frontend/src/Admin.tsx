import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Plus, RefreshCw } from 'lucide-react'
import { errorKey, useApi, write, type Row } from './api'
import { Editor, localDate } from './Records'
import { Language, State } from './App'

export function UsersPage({ revision, changed }: { revision: number; changed: () => void }) {
  const { t } = useTranslation()
  const users = useApi<Row[]>('/users', revision)
  const [adding, setAdding] = useState(false)
  return <><div className="page-heading"><h1>{t('users')}</h1><button className="primary" onClick={() => setAdding(true)}><Plus size={16} />{t('add')}</button></div>
    {!users.data ? <State error={users.error} /> : <div className="table-card"><div className="table-scroll"><table><thead><tr>{['name', 'email', 'role'].map(key => <th key={key}>{t(key)}</th>)}</tr></thead><tbody>
      {users.data.map(row => <tr key={row.id}><td>{row.name}</td><td>{row.email}</td><td>{t(String(row.role))}</td></tr>)}</tbody></table></div></div>}
    {adding && <Editor kind="users" title={t('add')} lookup={{}} close={() => setAdding(false)} save={async input => { await write('/users', 'POST', input); changed() }} />}</>
}

export function SettingsPage() {
  const { t, i18n } = useTranslation()
  const [revision, setRevision] = useState(0)
  const integration = useApi<{ configured: boolean; runs: { id: number; date: string; status: string; imported: number }[] }>('/integration', revision)
  const [notice, setNotice] = useState('')
  const [working, setWorking] = useState(false)
  async function sync() {
    setWorking(true)
    setNotice('')
    try { await write('/integration/sync', 'POST'); setNotice('success') }
    catch (error) { setNotice(errorKey(error)) }
    finally { setWorking(false); setRevision(value => value + 1) }
  }
  return <><div className="page-heading"><h1>{t('settings')}</h1></div>
    <div className="two-col"><section className="card"><h2>{t('language')}</h2><Language /><p className="muted space-top">{t('currencyNote')}</p></section>
      <section className="card"><h2>{t('integration')}</h2>{!integration.data ? <State error={integration.error} /> : <>
        <p>{t(integration.data.configured ? 'configured' : 'notConfigured')}</p>
        {integration.data.configured && <button className="primary" disabled={working} onClick={() => void sync()}><RefreshCw size={16} />{t(working ? 'loading' : 'sync')}</button>}
        {notice && <p className={notice === 'success' ? 'muted' : 'error'} role="status">{t(notice)}</p>}
        <div className="rows">{integration.data.runs.map(run => <div key={run.id}><span>{localDate(run.date, i18n.language)}<small>{t(run.status)}</small></span><strong>{t('syncCount', { count: run.imported })}</strong></div>)}</div>
      </>}</section></div></>
}

export function parseCsv(csv: string) {
  const lines: string[][] = []
  let row: string[] = [], field = '', quoted = false
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i++ }
      else quoted = !quoted
    } else if (!quoted && char === ',') { row.push(field); field = '' }
    else if (!quoted && char === '\r' && csv[i + 1] === '\n') { row.push(field); lines.push(row); row = []; field = ''; i++ }
    else field += char
  }
  row.push(field)
  lines.push(row)
  return lines
}
export function Reports() {
  const { t, i18n } = useTranslation()
  const [type, setType] = useState('customers')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const params = new URLSearchParams({ type, search, lang: i18n.language })
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const path = '/api/reports?' + params
  const [preview, setPreview] = useState<{ path: string; rows?: string[][]; error?: string }>({ path: '' })
  useEffect(() => {
    const controller = new AbortController()
    fetch(path, { signal: controller.signal }).then(async response => {
      if (!response.ok) { setPreview({ path, error: response.status === 400 ? 'dates' : 'error' }); return }
      const csv = await response.text()
      setPreview({ path, rows: parseCsv(csv) })
    }).catch(() => { if (!controller.signal.aborted) setPreview({ path, error: 'error' }) })
    return () => controller.abort()
  }, [path])
  const active = preview.path === path ? preview : null
  return <><div className="page-heading"><h1>{t('reports')}</h1>{active?.rows && <a className="primary button" href={path} download><Download size={16} />{t('export')}</a>}</div>
    <div className="filters">
      <select aria-label={t('reportType')} value={type} onChange={event => setType(event.target.value)}>
        {Object.entries({ customers: 'customers', campaigns: 'trend', spend: 'spend', budgets: 'utilization', leads: 'leadConversion', tasks: 'workload' }).map(([key, value]) => <option key={key} value={key}>{t(value)}</option>)}</select>
      <input aria-label={t('search')} placeholder={t('search')} value={search} onChange={event => setSearch(event.target.value)} />
      <label>{t('from')}<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>{t('to')}<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
    </div>
    {!active ? <State /> : active.error ? <p className="error" role="alert">{t(active.error)}</p> : <section className="card"><h2>{t('preview')}</h2>
      <div className="table-scroll"><table><thead><tr>{active.rows?.[0].map((value, index) => <th key={index}>{value}</th>)}</tr></thead>
        <tbody>{active.rows?.slice(1).map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{value}</td>)}</tr>)}</tbody></table></div>
      {active.rows?.length === 1 && <p className="state">{t('empty')}</p>}</section>}
  </>
}

