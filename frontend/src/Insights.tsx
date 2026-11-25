import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Activity, BriefcaseBusiness, CalendarDays, ChartNoAxesCombined, CircleDollarSign, Inbox, ListTodo, Megaphone, Plus, Target, Wallet } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { canManage, useApi, utcDate, type Activity as Log, type Row, type User } from './api'
import { Badge, localDate } from './Records'
import { State } from './App'
import { money } from './currency.mjs'

type Count = { name: string; count: number }
type Month = { month: string; revenue: number; spend: number; conversions: number }
type Budget = { id: number; name: string; customerId: number; channel: string; budget: number; spend: number; metrics: Record<string, number> }
export type OverviewData = {
  customers: number; newLeads: number; campaigns: number; budget: number; openTasks: number;
  totals: Record<string, number>; activity: Log[]; deadlines: Row[]; leads: Row[];
  timeline: Month[]; channels: Count[]; stages: Count[]; statuses: Count[]; budgets: Budget[];
}
const colors = ['#a7d94b', '#292c24', '#d4efaa', '#7d8d63', '#e4dfc9', '#505742', '#c1c3b2']
const formats = { en: 'en-US', sv: 'sv-SE' }
const number = (value: number, lang: string, fraction = 0) =>
  new Intl.NumberFormat(lang === 'en' ? formats.en : formats.sv, { maximumFractionDigits: fraction }).format(value)

function periodStart(days: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days + 1)
  return date.toISOString().slice(0, 10)
}
function useRange(initial = '') {
  const [preset, setPreset] = useState(initial)
  const [from, setFrom] = useState(initial ? periodStart(Number(initial)) : '')
  const [to, setTo] = useState('')
  function change(value: string) { setPreset(value); setFrom(value ? periodStart(Number(value)) : ''); setTo(value ? utcDate() : '') }
  function parameters() {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return params
  }
  return { preset, from, to, change, parameters, setFrom: (value: string) => { setPreset('custom'); setFrom(value) },
    setTo: (value: string) => { setPreset('custom'); setTo(value) } }
}
function Range({ range, custom }: { range: ReturnType<typeof useRange>; custom?: boolean }) {
  const { t } = useTranslation()
  return <div className="range"><label className="range-select"><CalendarDays size={16} /><select aria-label={t('period')} value={range.preset} onChange={event => range.change(event.target.value)}>
    <option value="">{t('allTime')}</option>{[30, 90, 180].map(days => <option key={days} value={days}>{t('last' + days)}</option>)}
    {range.preset === 'custom' && <option value="custom">{t('period')}</option>}</select></label>
    {custom && <><label>{t('from')}<input type="date" value={range.from} onChange={event => range.setFrom(event.target.value)} /></label>
      <label>{t('to')}<input type="date" value={range.to} onChange={event => range.setTo(event.target.value)} /></label></>}
  </div>
}

function Trend({ timeline, conversions = false }: { timeline: Month[]; conversions?: boolean }) {
  const { t, i18n } = useTranslation()
  const series = conversions ? ['conversions'] : ['revenue', 'spend']
  const month = (value: string) => new Intl.DateTimeFormat(i18n.language, { month: 'short', timeZone: 'UTC' }).format(new Date(value + '-01'))
  const [hidden, setHidden] = useState<string[]>([])
  return <section className="card chart-card"><div className="chart-heading"><div><h2>{t(conversions ? 'conversions' : 'trend')}</h2><p>{t(conversions ? 'conversions' : 'trendIntro')}</p></div><Activity size={19} /></div>
    <div className="legend">{series.map((key, index) => <button key={key} aria-pressed={!hidden.includes(key)} onClick={() => setHidden(list => list.includes(key) ? list.filter(item => item !== key) : [...list, key])}><i style={{ background: index ? '#474b40' : '#83ac35' }} />{t(key)}</button>)}</div>
    {timeline.length ? <div className="chart-area"><ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <AreaChart data={timeline} margin={{ left: 0, right: 12, top: 12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#eaeae1" strokeDasharray="4 4" /><XAxis dataKey="month" tickFormatter={month} axisLine={false} tickLine={false} tickMargin={9} tick={{ fontSize: 12, fill: '#6d7069' }} />
        <YAxis width={71} tickFormatter={value => conversions ? number(value, i18n.language) : money(value, i18n.language, true)} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#6d7069' }} />
        <Tooltip labelFormatter={value => month(String(value))} formatter={(value, name) => [conversions ? number(Number(value), i18n.language) : money(Number(value), i18n.language), t(String(name))]} />
        {series.map((key, index) => <Area key={key} isAnimationActive={false} type="monotone" dataKey={key} hide={hidden.includes(key)} stroke={index ? '#474b40' : '#7fa830'} strokeWidth={2.4} fill={index ? '#ebede5' : '#e0f2bb'} fillOpacity={0.7} />)}
      </AreaChart>
    </ResponsiveContainer></div> : <p className="muted">{t('empty')}</p>}
  </section>
}

function Distribution({ data, title, subtitle, center }: { data: Count[]; title: string; subtitle?: string; center?: string }) {
  const { t } = useTranslation()
  const total = data.reduce((sum, item) => sum + item.count, 0)
  return <section className="card chart-card"><div className="chart-heading"><div><h2>{t(title)}</h2>{subtitle && <p>{t(subtitle)}</p>}</div><Target size={19} /></div>
    {data.length ? <><div className="donut"><ResponsiveContainer width="100%" height="100%" minWidth={0}><PieChart><Pie data={data} isAnimationActive={false} dataKey="count" nameKey="name" innerRadius={53} outerRadius={76} paddingAngle={3} stroke="none">
      {data.map((item, index) => <Cell fill={colors[index % colors.length]} key={item.name} />)}</Pie>
      <Tooltip formatter={(value, name) => [value, t(String(name))]} /></PieChart></ResponsiveContainer><div className="donut-total"><strong>{center ?? total}</strong><small>{t(center ? 'Won' : 'all')}</small></div></div>
      <div className="distribution">{data.map((item, index) => <div key={item.name}><span><i style={{ background: colors[index % colors.length] }} />{t(item.name)}</span><strong>{item.count}</strong></div>)}</div></> : <p className="muted">{t('empty')}</p>}
  </section>
}

export function Overview({ user, revision }: { user: User; revision: number }) {
  const { t, i18n } = useTranslation()
  const range = useRange('180')
  const overview = useApi<OverviewData>('/overview?' + range.parameters(), revision)
  const data = overview.data
  const manage = canManage(user)
  const totalLeads = data?.stages.reduce((sum, item) => sum + item.count, 0) ?? 0
  const won = data?.stages.find(item => item.name === 'Won')?.count ?? 0
  const kpis = data ? [
    ['activeCustomers', BriefcaseBusiness, number(data.customers, i18n.language), '/customers'],
    ...(manage ? [['newLeads', Inbox, number(data.newLeads, i18n.language), '/leads'] as const] : []),
    ['activeCampaigns', Megaphone, number(data.campaigns, i18n.language), '/campaigns'],
    ['totalBudget', Wallet, money(data.budget, i18n.language, true), '/budgets'],
    ['spend', CircleDollarSign, money(data.totals.spend, i18n.language, true), '/budgets'],
    ['roas', ChartNoAxesCombined, number(data.totals.roas, i18n.language, 2) + '×', '/analytics'],
    ['conversions', Target, number(data.totals.conversions, i18n.language), '/analytics'],
    ['openTasks', ListTodo, number(data.openTasks, i18n.language), '/tasks'],
  ] as const : []
  return <>
    <div className="page-heading overview-heading"><div><h1>{t('overview')}</h1><p>{t('overviewIntro')}</p></div><div className="heading-actions"><Range range={range} />{manage && <Link className="primary button" to="/campaigns?new=1"><Plus size={17} />{t('newCampaign')}</Link>}</div></div>
    {!data ? <State error={overview.error} /> : <>
      <div className="kpis">{kpis.map(([key, Icon, value, url], index) =>
        <motion.div key={key} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, delay: index * 0.025 }}>
          <Link to={url} className="kpi"><span className="kpi-label"><span className="kpi-icon"><Icon size={16} strokeWidth={1.8} /></span>{t(key)}</span><strong>{value}</strong></Link>
        </motion.div>)}</div>
      <div className="chart-grid"><Trend timeline={data.timeline} /><Distribution data={data.channels} title="channels" subtitle="channelIntro" /></div>
      <div className="three-col space-top">
        <section className="card"><h2>{t('activity')}</h2><div className="rows">{data.activity.map(log => <Link to={`/${log.kind}/${log.recordId}`} key={log.id}>
          <span><strong>{log.subject}</strong><small>{t(log.action === 'converted' ? 'convertedActivity' : log.action)}</small></span><small>{localDate(log.date, i18n.language)}</small></Link>)}
          {data.activity.length === 0 && <p className="muted">{t('empty')}</p>}</div></section>
        <section className="card"><div className="section-title"><h2>{t('deadlines')}</h2><Link to="/tasks">{t('viewAll')}</Link></div><div className="rows">{data.deadlines.map(row =>
          <Link to={'/tasks/' + row.id} key={row.id}><span>{row.name}<small>{localDate(String(row.due), i18n.language)}</small></span><Badge value={String(row.priority)} /></Link>)}
          {!data.deadlines.length && <p className="muted">{t('empty')}</p>}</div></section>
        {manage && <section className="card"><div className="section-title"><h2>{t('recentLeads')}</h2><Link to="/leads">{t('viewAll')}</Link></div><div className="rows">{data.leads.map(row => <Link key={row.id} to={'/leads/' + row.id}><span>{row.company}</span><Badge value={String(row.status)} /></Link>)}
          {!data.leads.length && <p className="muted">{t('empty')}</p>}</div></section>}
      </div>
      <div className="three-col space-top">{manage && <Distribution title="leadConversion" data={totalLeads ? [{ name: 'Won', count: won }, { name: 'otherLeads', count: totalLeads - won }].filter(item => item.count > 0) : []}
        center={number(totalLeads ? won * 100 / totalLeads : 0, i18n.language, 1) + '%'} />}<Distribution title="campaignStatus" data={data.statuses} />
        <section className="card"><h2>{t('utilization')}</h2><BudgetBar budget={data.budget} spend={data.totals.spend} /><Link className="back-link" to="/budgets">{t('viewAll')}</Link></section></div>
    </>}
  </>
}
const metricKeys = ['impressions', 'clicks', 'conversions', 'spend', 'revenue', 'ctr', 'cpc', 'cpm', 'cpa', 'conversionRate', 'roas']
function formatMetric(metric: string, value: number, language: string) {
  return ['spend', 'revenue', 'cpc', 'cpm', 'cpa'].includes(metric) ? money(value, language) : number(value, language, 2)
    + (['ctr', 'conversionRate'].includes(metric) ? '%' : metric === 'roas' ? '×' : '')
}
export function Analytics({ revision }: { revision: number }) {
  const { t, i18n } = useTranslation()
  const range = useRange()
  const [campaign, setCampaign] = useState('')
  const choices = useApi<Row[]>('/campaigns', revision)
  const params = range.parameters()
  if (campaign) params.set('campaignId', campaign)
  const analytics = useApi<OverviewData>('/overview?' + params, revision)
  const data = analytics.data
  return <><div className="page-heading"><h1>{t('analytics')}</h1></div><div className="filters"><Range range={range} custom />
    <select value={campaign} aria-label={t('campaignId')} onChange={event => setCampaign(event.target.value)}><option value="">{t('campaigns')} · {t('all')}</option>{choices.data?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></div>
    {!data ? <State error={analytics.error} /> : <>
      <div className="kpis metrics">{metricKeys.map(key => <div className="kpi" key={key}><span className="kpi-label">{t(key)}</span><strong>{formatMetric(key, data.totals[key], i18n.language)}</strong></div>)}</div>
      <div className="two-col"><Trend timeline={data.timeline} /><Trend timeline={data.timeline} conversions /></div>
      <section className="card space-top"><h2>{t('compare')}</h2><div className="table-scroll"><table><thead><tr>{['campaignId', ...metricKeys].map(key => <th key={key}>{t(key)}</th>)}</tr></thead>
        <tbody>{data.budgets.map(row => <tr key={row.id}><td><Link to={'/campaigns/' + row.id}>{row.name}</Link></td>{metricKeys.map(key => <td key={key}>{formatMetric(key, row.metrics[key], i18n.language)}</td>)}</tr>)}</tbody></table></div>
      {!data.budgets.length && <p className="state">{t('empty')}</p>}</section>
    </>}
  </>
}
function BudgetBar({ budget, spend }: { budget: number; spend: number }) {
  const { t, i18n } = useTranslation()
  const ratio = budget ? spend / budget : 0
  const warning = spend > budget ? 'over' : ratio >= 0.8 ? 'near' : ''
  return <div className={`budget-bar ${warning}`}><span>{budget ? number(ratio * 100, i18n.language, 1) + '%' : '—'}{warning && <small>{t(warning)}</small>}</span>
    <progress value={budget ? Math.min(ratio, 1) : spend > 0 ? 1 : 0} aria-label={t('utilization')} /></div>
}
export function Budgets({ revision }: { revision: number }) {
  const { t, i18n } = useTranslation()
  const [group, setGroup] = useState('byCampaign')
  const info = useApi<OverviewData>('/overview', revision)
  const customers = useApi<Row[]>('/customers', revision)
  const record = info.data
  const groups = new Map<string, { name: string; budget: number; spend: number }>()
  for (const row of record?.budgets ?? []) {
    const name = group === 'byCustomer' ? String(customers.data?.find(item => item.id === row.customerId)?.company ?? '—')
      : group === 'byChannel' ? t(row.channel) : row.name
    const key = group === 'byCampaign' ? String(row.id) : name
    const old = groups.get(key)
    groups.set(key, { name, budget: (old?.budget ?? 0) + row.budget, spend: (old?.spend ?? 0) + row.spend })
  }
  return <><div className="page-heading"><h1>{t('budgets')}</h1></div>{!record ? <State error={info.error} /> : <>
    <div className="kpis">{[['totalBudget', record.budget], ['spend', record.totals.spend], ['remaining', record.budget - record.totals.spend]].map(([label, amount]) => <div className="kpi" key={label}><span className="kpi-label">{t(String(label))}</span><strong>{money(Number(amount), i18n.language)}</strong></div>)}</div>
    <div className="filters"><select aria-label={t('direction')} value={group} onChange={event => setGroup(event.target.value)}>{['byCampaign', 'byCustomer', 'byChannel'].map(item => <option value={item} key={item}>{t(item)}</option>)}</select></div>
    <div className="table-card"><div className="table-scroll"><table><thead><tr>{['name', 'budget', 'spend', 'remaining', 'utilization'].map(key => <th key={key}>{t(key)}</th>)}</tr></thead>
      <tbody>{Array.from(groups.entries()).map(([key, row]) => <tr key={key}><td>{group === 'byCampaign' ? <Link to={'/campaigns/' + key}>{row.name}</Link> : row.name}</td>
        {[row.budget, row.spend, row.budget - row.spend].map((value, index) => <td key={index}>{money(value, i18n.language)}</td>)}<td><BudgetBar {...row} /></td></tr>)}</tbody></table></div>{!groups.size && <p className="state">{t('empty')}</p>}</div>
    <section className="card space-top"><h2>{t('monthly')}</h2><div className="rows">{record.timeline.map(row => <div key={row.month}><strong>{row.month}</strong><span>{money(row.spend, i18n.language)}</span></div>)}</div></section>
  </>}</>
}

