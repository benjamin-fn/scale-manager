import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Archive, ChartNoAxesCombined, ChevronRight, Plus, Search, SquarePen, X } from 'lucide-react'
import { canManage, errorKey, useApi, utcDate, write, type Activity, type Row, type User } from './api'
import { State } from './App'
import { money, toDisplay, toSek } from './currency.mjs'

export type RecordsProps = { user: User; revision: number; changed: () => void }
type Kind = 'customers' | 'leads' | 'campaigns' | 'tasks' | 'pipeline'
type FormKind = Exclude<Kind, 'pipeline'> | 'performance' | 'users'
type Field = { key: string; type?: string; required?: boolean; options?: readonly string[] }
const leadStages = ['New', 'Contacted', 'Meeting', 'Proposal', 'Won', 'Lost']
const campaignStages = ['Planned', 'Active', 'Paused', 'Completed', 'Cancelled']
const taskStages = ['Todo', 'Doing', 'Done']
export const channels = ['Google Ads', 'Meta Ads', 'Instagram', 'LinkedIn', 'SEO', 'Email', 'TikTok']
const fields: Record<FormKind, Field[]> = {
  customers: [{ key: 'company', required: true }, { key: 'organization' }, { key: 'contact' }, { key: 'email', type: 'email' }, { key: 'phone', type: 'tel' }, { key: 'industry' }, { key: 'address' }, { key: 'assignedId' }, { key: 'start', type: 'date', required: true }, { key: 'notes', type: 'textarea' }],
  leads: [{ key: 'company', required: true }, { key: 'contact' }, { key: 'email', type: 'email' }, { key: 'phone', type: 'tel' }, { key: 'industry' }, { key: 'budget', type: 'money' }, { key: 'source', options: ['Manual', 'Referral', 'DigitalContact', 'DigitalConsultation'] }, { key: 'assignedId' }, { key: 'status', options: leadStages }, { key: 'goal' }, { key: 'message', type: 'textarea' }, { key: 'notes', type: 'textarea' }],
  campaigns: [{ key: 'name', required: true }, { key: 'customerId', required: true }, { key: 'channel', options: channels }, { key: 'assignedId' }, { key: 'start', type: 'date', required: true }, { key: 'end', type: 'date', required: true }, { key: 'budget', type: 'money' }, { key: 'status', options: campaignStages }, { key: 'goal', type: 'textarea' }],
  tasks: [{ key: 'name', required: true }, { key: 'customerId' }, { key: 'campaignId' }, { key: 'assignedId' }, { key: 'priority', options: ['Low', 'Normal', 'High', 'Urgent'] }, { key: 'due', type: 'date', required: true }, { key: 'status', options: taskStages }, { key: 'description', type: 'textarea' }],
  performance: [{ key: 'date', type: 'date', required: true }, ...['impressions', 'clicks', 'conversions'].map(key => ({ key, type: 'number', required: true })), { key: 'spend', type: 'money', required: true }, { key: 'revenue', type: 'money', required: true }],
  users: [{ key: 'name', required: true }, { key: 'email', type: 'email', required: true }, { key: 'password', type: 'password', required: true }, { key: 'role', options: ['Employee', 'Manager', 'Admin'] }],
}
const columns = {
  customers: ['company', 'contact', 'industry', 'assignedId', 'state'],
  leads: ['company', 'contact', 'source', 'budget', 'assignedId', 'status'],
  campaigns: ['name', 'channel', 'budget', 'assignedId', 'end', 'status'],
  tasks: ['name', 'assignedId', 'priority', 'due', 'status'],
  pipeline: [],
}
const badgeFields = ['status', 'priority', 'state']
const dateFields = ['start', 'end', 'due', 'created', 'date']
type Lookup = Partial<Record<string, Row[]>>

export function Badge({ value }: { value: string }) {
  const { t } = useTranslation()
  return <span className={`badge badge-${value.toLowerCase()}`}><i />{t(value)}</span>
}
export function localDate(value: string, language: string) {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'sv-SE', { dateStyle: 'medium' })
    .format(new Date(value.length === 10 ? value + 'T12:00:00' : value.endsWith('Z') ? value : value + 'Z'))
}
export function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDialogElement>(null)
  return <dialog ref={node => { ref.current = node; if (node && !node.open) node.showModal() }} onCancel={close}>
    <div className="dialog-head"><h2>{title}</h2><button type="button" className="icon-button" aria-label={t('close')} onClick={close}><X size={20} /></button></div>
    {children}
  </dialog>
}

export function Editor({ kind, row, title, lookup, restricted, save, close }: {
  kind: FormKind; row?: Row; title: string; lookup: Lookup; restricted?: boolean;
  save: (data: Record<string, unknown>) => Promise<void>; close: () => void
}) {
  const { t, i18n } = useTranslation()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const visible = fields[kind].filter(field => !restricted || field.key === 'status')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const entries = new FormData(event.currentTarget)
    const input = { ...row } as Record<string, unknown>
    for (const field of visible) {
      const value = String(entries.get(field.key) ?? '')
      input[field.key] = field.type === 'money' ? toSek(Number(value), i18n.language) : field.type === 'number' ? Number(value)
        : ['customerId', 'campaignId'].includes(field.key) ? value ? Number(value) : null
        : ['email', 'assignedId'].includes(field.key) ? value || null : value
    }
    setBusy(true)
    setError('')
    try { await save(input); close() }
    catch (failure) { setError(errorKey(failure)) }
    finally { setBusy(false) }
  }
  return <Dialog title={title} close={close}><form onSubmit={submit}>
    <div className="field-grid">{visible.map(field => {
      const { key, type, options, required } = field
      const value = row?.[key]
      const relation = lookup[key]
      const fallback = type === 'date' ? utcDate() : type === 'money' || type === 'number' ? 0 : options?.[0] ?? ''
      const initial = type === 'money' ? toDisplay(Number(value ?? 0), i18n.language) : String(value ?? fallback)
      return <label key={key} className={type === 'textarea' ? 'wide' : ''}>{t(key)}{type === 'money' && ` (${i18n.language === 'en' ? 'USD' : 'SEK'})`}
        {relation ? <select name={key} aria-label={t(key)} required={required} defaultValue={String(value ?? '')}><option value="">{t(required ? 'select' : 'none')}</option>
          {relation.filter(item => !item.archived || item.id === value).map(item => <option key={item.id} value={item.id}>{String(item.name ?? item.company)}</option>)}</select>
          : options ? <select name={key} aria-label={t(key)} defaultValue={initial}>{options.map(option => <option key={option} value={option}>{t(option)}</option>)}</select>
          : type === 'textarea' ? <textarea name={key} rows={3} defaultValue={initial} maxLength={4000} />
          : <input name={key} type={type === 'money' ? 'number' : type ?? 'text'} required={required} defaultValue={initial}
              min={type === 'money' || type === 'number' ? 0 : undefined} step={type === 'money' ? (i18n.language === 'en' ? '0.001' : '0.01') : undefined}
              maxLength={type === 'password' ? 128 : 160} autoComplete={type === 'password' ? 'new-password' : undefined} />}
      </label>
    })}</div>
    {error && <p className="error" role="alert">{t(error)}</p>}
    <div className="dialog-actions"><button type="button" onClick={close}>{t('cancel')}</button><button className="primary" disabled={busy}>{t(busy ? 'loading' : 'save')}</button></div>
  </form></Dialog>
}

export function Records({ kind, user, revision, changed }: RecordsProps & { kind: Kind }) {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const entity = kind === 'pipeline' ? 'leads' : kind
  const base = '/' + entity
  const id = location.pathname.split('/')[2]
  const [params, setParams] = useSearchParams()
  const manage = canManage(user)
  const list = useApi<Row[]>(base, revision)
  const detail = useApi<{ record: Row; activity: Activity[] }>(id ? base + '/' + id : null, revision)
  const employees = useApi<Row[]>('/employees', revision)
  const customers = useApi<Row[]>(entity === 'campaigns' || entity === 'tasks' ? '/customers' : null, revision)
  const campaigns = useApi<Row[]>(entity === 'customers' || entity === 'tasks' ? '/campaigns' : null, revision)
  const tasks = useApi<Row[]>(entity === 'customers' ? '/tasks' : null, revision)
  const performance = useApi<{ budgets: Array<{ id: number; customerId: number; budget: number; spend: number; metrics: Record<string, number> }> }>(
    id && ['customers', 'campaigns'].includes(entity) ? '/overview' + (entity === 'campaigns' ? '?campaignId=' + id : '') : null, revision)
  const lookup = { assignedId: employees.data ?? [], customerId: customers.data ?? [], campaignId: campaigns.data ?? [] }
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [owner, setOwner] = useState('')
  const [sort, setSort] = useState('latest')
  const [page, setPage] = useState(1)
  const [editor, setEdit] = useState<{ kind: FormKind; row?: Row } | null>(null)
  const edit = editor ?? (manage && !id && params.has('new') ? { kind: entity, row: undefined } : null)
  function closeEditor() {
    setEdit(null)
    if (params.has('new')) setParams({}, { replace: true })
  }
  const [confirmation, setConfirmation] = useState<{ action: string; row: Row } | null>(null)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const record = detail.data?.record
  const options = entity === 'leads' ? leadStages : entity === 'campaigns' ? campaignStages : entity === 'tasks' ? taskStages : ['current', 'onlyArchived']
  const name = (row: Row) => String(row.company ?? row.name ?? '')
  const ownerName = (ownerId: Row[string]) => lookup.assignedId.find(x => x.id === ownerId)?.name ?? t('none')
  function cell(row: Row, key: string) {
    const value = row[key]
    if (key === 'state') return <Badge value={row.archived ? 'archived' : 'Active'} />
    if (key === 'assignedId') return ownerName(value)
    if (key === 'customerId' || key === 'campaignId') return lookup[key].find(item => item.id === value)?.[key === 'customerId' ? 'company' : 'name'] ?? '—'
    if (value == null || value === '') return '—'
    if (key === 'budget') return money(Number(value), i18n.language)
    if (badgeFields.includes(key)) return <Badge value={String(value)} />
    if (dateFields.includes(key)) return <>{localDate(String(value), i18n.language)}{key === 'due' && String(value) < utcDate() && row.status !== 'Done' && <span className="overdue">{t('overdue')}</span>}</>
    if (key === 'source' || key === 'channel') return t(String(value))
    return String(value)
  }
  const filtered = (list.data ?? []).filter(row => {
    const text = [name(row), row.contact, row.email, row.industry, row.channel, row.organization].join(' ').toLocaleLowerCase(i18n.language)
    return text.includes(search.trim().toLocaleLowerCase(i18n.language)) && (!owner || row.assignedId === owner)
      && (!filter || (entity === 'customers' ? Boolean(row.archived) === (filter === 'onlyArchived') : row.status === filter))
  }).sort((a, b) => sort === 'alphabetical' ? name(a).localeCompare(name(b), i18n.language) : Number(b.id) - Number(a.id))
  const pages = Math.max(1, Math.ceil(filtered.length / 9))
  const currentPage = Math.min(pages, page)
  const availableEdit = (row: Row) => manage && !row.archived || entity === 'tasks'
  async function move(row: Row, status: string) {
    if (row.status === status) return
    setError('')
    try { await write(base + '/' + row.id, 'PUT', { ...row, status }); changed() }
    catch (failure) { setError(errorKey(failure)) }
  }
  async function confirm() {
    if (!confirmation) return
    const { action, row } = confirmation
    setWorking(true)
    setError('')
    try { await write(base + '/' + row.id + '/' + action, 'POST'); changed(); setConfirmation(null) }
    catch (failure) { setError(errorKey(failure)); setConfirmation(null) }
    finally { setWorking(false) }
  }
  return <>
    <div className="page-heading"><div>{id && <Link className="back-link" to={base}>{t(entity)}</Link>}<h1>{record ? name(record) : t(kind)}</h1></div>
      <div className="heading-actions">{!id && manage && <button className="primary" onClick={() => setEdit({ kind: entity })}><Plus size={17} />{t('add')}</button>}
        {record && availableEdit(record) && <button onClick={() => setEdit({ kind: entity, row: record })}><SquarePen size={16} />{t('edit')}</button>}
        {record && entity === 'campaigns' && <button className="primary" onClick={() => setEdit({ kind: 'performance' })}><ChartNoAxesCombined size={17} />{t('addPerformance')}</button>}
        {record && entity === 'customers' && !record.archived && manage && <button onClick={() => setConfirmation({ action: 'archive', row: record })}><Archive size={17} />{t('archive')}</button>}
        {record && entity === 'leads' && record.status === 'Won' && !record.customerId && <button className="primary" onClick={() => setConfirmation({ action: 'convert', row: record })}>{t('convert')}</button>}
      </div>
    </div>
    {error && <p className="error" role="alert">{t(error)}</p>}
    {id ? !record ? <State error={detail.error} /> : <>
      <section className="card"><h2>{t('details')}</h2><dl className="detail-grid">{[...fields[entity].map(field => field.key), ...entity === 'leads' ? ['created'] : entity === 'customers' ? ['state'] : []].map(key =>
        <div key={key}><dt>{t(key)}</dt><dd>{cell(record, key)}</dd></div>)}</dl>
        {entity === 'leads' && record.customerId && <Link className="back-link" to={'/customers/' + record.customerId}>{t('converted')} <ChevronRight size={16} /></Link>}
      </section>
      {['customers', 'campaigns'].includes(entity) && <section className="card space-top"><h2>{t('trend')}</h2>
        {!performance.data ? <State error={performance.error} /> : (() => {
          const items = performance.data.budgets.filter(item => entity === 'customers' ? item.customerId === Number(id) : item.id === Number(id))
          const budget = items.reduce((sum, item) => sum + item.budget, 0)
          const spend = items.reduce((sum, item) => sum + item.spend, 0)
          const revenue = items.reduce((sum, item) => sum + item.metrics.revenue, 0)
          return <dl className="detail-grid">{Object.entries({ budget: money(budget, i18n.language), spend: money(spend, i18n.language),
            revenue: money(revenue, i18n.language), roas: spend ? (revenue / spend).toFixed(2) + '×' : '0×' }).map(([key, value]) =>
              <div key={key}><dt>{t(key)}</dt><dd>{value}</dd></div>)}</dl>
        })()}</section>}
      {entity === 'customers' && <div className="two-col space-top">{([{ key: 'campaigns', state: campaigns }, { key: 'tasks', state: tasks }]).map(({ key, state }) =>
        <section className="card" key={key}><h2>{t(key)}</h2>{!state.data ? <State error={state.error} /> : <div className="rows">
          {state.data.filter(x => x.customerId === Number(id)).map(x => <Link key={x.id} to={'/' + key + '/' + x.id}><span>{x.name}</span><Badge value={String(x.status)} /></Link>)}
          {!state.data.some(x => x.customerId === Number(id)) && <p className="muted">{t('empty')}</p>}</div>}</section>)}</div>}
      <section className="card space-top"><h2>{t('activity')}</h2><div className="rows">{detail.data?.activity.map(log =>
        <div key={log.id}><strong>{t(log.action === 'converted' ? 'convertedActivity' : log.action)}</strong><small>{localDate(log.date, i18n.language)}</small></div>)}
        {!detail.data?.activity.length && <p className="muted">{t('empty')}</p>}</div></section>
    </> : <>
      <div className="filters"><label className="filter-search"><Search size={17} /><input aria-label={t('search')} placeholder={t('search') + '…'} value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} /></label>
        <select aria-label={t('status')} value={filter} onChange={event => { setFilter(event.target.value); setPage(1) }}><option value="">{t('status')} · {t('all')}</option>{options.map(option => <option key={option} value={option}>{t(option)}</option>)}</select>
        <select aria-label={t('assignedId')} value={owner} onChange={event => { setOwner(event.target.value); setPage(1) }}><option value="">{t('assignedId')} · {t('all')}</option>{lookup.assignedId.map(employee => <option value={employee.id} key={employee.id}>{employee.name}</option>)}</select>
        <select aria-label={t('direction')} value={sort} onChange={event => { setSort(event.target.value); setPage(1) }}><option value="latest">{t('latest')}</option><option value="alphabetical">{t('alphabetical')}</option></select>
      </div>
      {!list.data ? <State error={list.error} /> : kind === 'pipeline' ? <div className="kanban">{leadStages.map(stage => {
        const cards = filtered.filter(row => row.status === stage)
        return <section key={stage} onDragOver={event => event.preventDefault()} onDrop={event => {
          event.preventDefault()
          const row = filtered.find(item => String(item.id) === event.dataTransfer.getData('text/plain'))
          if (row) void move(row, stage)
        }}><div className="kanban-heading"><Badge value={stage} /><span>{cards.length}</span></div><p>{money(cards.reduce((sum, row) => sum + Number(row.budget), 0), i18n.language)}</p>
          {cards.map(row => <article key={row.id} draggable onDragStart={event => event.dataTransfer.setData('text/plain', String(row.id))}>
            <Link to={base + '/' + row.id}>{name(row)}</Link><small>{ownerName(row.assignedId)}</small><strong>{money(Number(row.budget), i18n.language)}</strong>
            <select aria-label={name(row) + ' · ' + t('status')} value={String(row.status)} onChange={event => void move(row, event.target.value)}>
              {leadStages.map(option => <option value={option} key={option}>{t(option)}</option>)}</select>
          </article>)}</section>
      })}</div> : <div className="table-card">
        <div className="table-scroll"><table><thead><tr>{columns[kind].map(key => <th key={key}>{t(key)}</th>)}<th aria-label={t('actions')} /></tr></thead>
          <tbody>{filtered.slice((currentPage - 1) * 9, currentPage * 9).map(row => <tr key={row.id}>{columns[kind].map((key, index) =>
            <td key={key}>{index === 0 ? <Link className="record-link" to={base + '/' + row.id}>{cell(row, key)}</Link> : cell(row, key)}</td>)}
            <td>{availableEdit(row) && <button className="icon-button" aria-label={t('edit') + ' ' + name(row)} onClick={() => setEdit({ kind: entity, row })}><SquarePen size={16} /></button>}</td></tr>)}</tbody></table></div>
        {!filtered.length && <p className="state">{t('empty')}</p>}
        <div className="pagination"><span>{t('results', { count: filtered.length })}</span><span>{t('page', { page: currentPage, pages })}</span>
          <button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>{t('previous')}</button><button disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>{t('next')}</button></div>
      </div>}
    </>}
    {edit && <Editor kind={edit.kind} row={edit.row} title={t(edit.kind === 'performance' ? 'addPerformance' : edit.row ? 'edit' : 'add')}
      lookup={lookup} restricted={!manage && edit.kind === 'tasks'} close={closeEditor} save={async input => {
        const path = edit.kind === 'performance' ? base + '/' + id + '/performance' : edit.row ? base + '/' + edit.row.id : base
        await write(path, edit.row ? 'PUT' : 'POST', input)
        changed()
      }} />}
    {confirmation && <Dialog title={t(confirmation.action)} close={() => setConfirmation(null)}><p>{t(confirmation.action + 'Confirm')}</p>
      <div className="dialog-actions"><button onClick={() => setConfirmation(null)}>{t('cancel')}</button><button className="primary" disabled={working} onClick={() => void confirm()}>{t(confirmation.action)}</button></div></Dialog>}
  </>
}

