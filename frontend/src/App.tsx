import { lazy, Suspense, useState, type FormEvent } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Activity, Asterisk, Bell, ChartNoAxesCombined, ChevronDown, CircleDollarSign, FileText, Gauge, Kanban, ListTodo, LogOut, Megaphone, Menu, PanelLeftClose, PanelLeftOpen, Search, Settings, Users, UserRoundCog, X, Inbox } from 'lucide-react'
import { ApiError, canManage, errorKey, useApi, write, type Row, type User } from './api'
import type { OverviewData } from './Insights'
import { Records, type RecordsProps } from './Records'
import { Reports, SettingsPage, UsersPage } from './Admin'

const Overview = lazy(() => import('./Insights').then(module => ({ default: module.Overview })))
const Analytics = lazy(() => import('./Insights').then(module => ({ default: module.Analytics })))
const Budgets = lazy(() => import('./Insights').then(module => ({ default: module.Budgets })))

const groups = [
  { name: 'workspace', links: [['overview', Gauge, '/']] },
  { name: 'operations', links: [['leads', Inbox, '/leads'], ['pipeline', Kanban, '/pipeline'], ['customers', Users, '/customers'], ['campaigns', Megaphone, '/campaigns'], ['tasks', ListTodo, '/tasks']] },
  { name: 'insights', links: [['budgets', CircleDollarSign, '/budgets'], ['analytics', ChartNoAxesCombined, '/analytics'], ['reports', FileText, '/reports']] },
  { name: 'administration', links: [['users', UserRoundCog, '/users'], ['settings', Settings, '/settings']] },
] as const

export function Brand() {
  return <div className="brand"><span className="brand-mark"><Asterisk size={24} strokeWidth={2.4} /></span><span className="brand-name">SCALE<span> / MANAGER</span></span></div>
}
export function Language() {
  const { t, i18n } = useTranslation()
  return <div className="language" aria-label={t('language')}>{['sv', 'en'].map(lang =>
    <button key={lang} type="button" aria-pressed={i18n.language === lang} onClick={() => void i18n.changeLanguage(lang)}>{lang.toUpperCase()}</button>)}</div>
}
export function State({ error, retry }: { error?: Error; retry?: () => void }) {
  const { t } = useTranslation()
  return <div className="state" role={error ? 'alert' : 'status'}>{t(error ? errorKey(error) : 'loading')}{error && retry && <button onClick={retry}>{t('retry')}</button>}</div>
}

function SignIn({ refresh }: { refresh: () => void }) {
  const { t } = useTranslation()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = Object.fromEntries(new FormData(event.currentTarget))
    setBusy(true)
    setError('')
    try { await write('/login', 'POST', input); refresh() }
    catch (failure) { setError(errorKey(failure)) }
    finally { setBusy(false) }
  }
  return <main className="signin">
    <section className="signin-art"><Brand /><div><Activity size={94} strokeWidth={0.8} /><h1>SCALE<br /><em>Manager.</em></h1></div><span>SCALE DIGITAL</span></section>
    <section className="signin-form"><div className="signin-language"><Language /></div><form onSubmit={submit}>
      <h2>{t('login')}</h2><p>{t('loginIntro')}</p>
      <label>{t('email')}<input name="email" type="email" autoComplete="username" required /></label>
      <label>{t('password')}<input name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p className="error" role="alert">{t(error)}</p>}
      <button className="primary" disabled={busy}>{t(busy ? 'loading' : 'login')}</button>
    </form></section>
  </main>
}

export function App() {
  const [session, setSession] = useState(0)
  const me = useApi<User>('/me', session)
  const refresh = () => setSession(value => value + 1)
  if (me.error instanceof ApiError && me.error.status === 401) return <SignIn refresh={refresh} />
  if (!me.data) return <State error={me.error} retry={refresh} />
  return <Workspace user={me.data} refresh={refresh} />
}

function Workspace({ user, refresh }: { user: User; refresh: () => void }) {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [mobile, setMobile] = useState(false)
  const [revision, setRevision] = useState(0)
  const [toast, setToast] = useState('')
  const [panel, setPanel] = useState('')
  const [search, setSearch] = useState('')
  const [querying, setQuerying] = useState(false)
  const overview = useApi<OverviewData>('/overview', revision)
  const customerSearch = useApi<Row[]>(querying ? '/customers' : null, revision)
  const campaignSearch = useApi<Row[]>(querying ? '/campaigns' : null, revision)
  const taskSearch = useApi<Row[]>(querying ? '/tasks' : null, revision)
  const links = groups.flatMap(group => [...group.links])
  const page = links.find(link => link[2] === ('/' + (location.pathname.split('/')[1] ?? '')))
  const manage = canManage(user)
  const admin = user.role === 'Admin'
  const permitted = (name: string) => (!['users', 'settings'].includes(name) || admin) && (!['leads', 'pipeline', 'reports'].includes(name) || manage)
  function changed() {
    setRevision(value => value + 1)
    setToast('saved')
  }
  const records: RecordsProps = { user, revision, changed }
  const notifications = overview.data?.deadlines ?? []
  const results = [
    ...[customerSearch, campaignSearch, taskSearch].flatMap((state, index) => (state.data ?? []).map(row => ({
      id: row.id, name: String(row.company ?? row.name), path: ['/customers', '/campaigns', '/tasks'][index],
    }))),
  ].filter(row => row.name.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim())).slice(0, 8)
  function closePanels() { setQuerying(false); setPanel(''); setMobile(false) }
  return <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
    <a className="skip" href="#content">{t('skip')}</a>
    {mobile && <button aria-label={t('close')} className="shade" onClick={() => setMobile(false)} />}
    <aside className={`sidebar ${mobile ? 'mobile-open' : ''}`}>
      <Link className="brand-link" to="/" onClick={closePanels}><Brand /></Link>
      <nav>{groups.map(group => {
        const visible = group.links.filter(([name]) => permitted(name))
        return visible.length > 0 && <div className="nav-group" key={group.name}>
          <div className="nav-label">{t(group.name)}</div>
          {visible.map(([name, Icon, path]) => <NavLink to={path} end={path === '/'} onClick={closePanels} key={name} title={t(name)}>
            <Icon size={18} strokeWidth={1.75} /><span>{t(name)}</span></NavLink>)}
        </div>
      })}</nav>
      <div className="sidebar-footer">{user.demo && <div className="demo"><i /> <span>{t('demo')}</span></div>}<button className="collapse-button" title={t('menu')} aria-label={t('menu')} onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button></div>
    </aside>
    <div className="surface">
      <header className="topbar">
        <button className="mobile-menu icon-button" aria-label={t('menu')} onClick={() => setMobile(!mobile)}><Menu size={21} /></button>
        <div className="breadcrumb"><Link to="/">{t('workspace')}</Link><span>/</span><strong>{t(page?.[0] ?? 'overview')}</strong>{location.pathname.split('/').length > 2 && <><span>/</span><strong>{t('details')}</strong></>}</div>
        <div className="top-actions">
          <div className="searchbox"><Search size={17} /><input aria-label={t('globalSearch')} placeholder={t('search') + '…'} value={search}
            onFocus={() => { setQuerying(true); setPanel('') }} onChange={event => { setSearch(event.target.value); setQuerying(true) }}
            onKeyDown={event => { if (event.key === 'Escape') setQuerying(false) }} />
            {querying && <div className="popover search-results"><button className="icon-button pop-close" aria-label={t('close')} onClick={() => setQuerying(false)}><X size={16} /></button>
              <strong>{t('search')}</strong>{[customerSearch, campaignSearch, taskSearch].some(state => state.error) ? <p>{t('error')}</p>
                : [customerSearch, campaignSearch, taskSearch].some(state => state.data === undefined) ? <p>{t('loading')}</p>
                : results.length === 0 ? <p>{t('empty')}</p> : results.map(row =>
                  <Link key={row.path + row.id} to={row.path + '/' + row.id} onClick={() => { setSearch(''); closePanels() }}>{row.name}</Link>)}</div>}
          </div>
          <Language />
          <div className="menu-anchor">
            <button className="icon-button bell" aria-label={t('notifications')} aria-expanded={panel === 'notifications'} onClick={() => { setPanel(panel === 'notifications' ? '' : 'notifications'); setQuerying(false) }}><Bell size={19} />{notifications.length > 0 && <i />}</button>
            {panel === 'notifications' && <div className="popover"><strong>{t('notifications')}</strong>{notifications.length === 0 ? <p>{t('noNotifications')}</p> : notifications.map(row =>
              <Link key={row.id} to={'/tasks/' + row.id} onClick={closePanels}>{row.name as string}<small>{row.due as string}</small></Link>)}</div>}
          </div>
          <div className="menu-anchor">
            <button className="profile" aria-label={t('profile')} aria-expanded={panel === 'profile'} onClick={() => { setPanel(panel === 'profile' ? '' : 'profile'); setQuerying(false) }}>
              <span className="avatar">{user.name.split(' ').slice(0, 2).map(name => name[0]).join('')}</span><span className="profile-name">{user.name}<small>{t(user.role)}</small></span><ChevronDown size={14} />
            </button>
            {panel === 'profile' && <div className="popover profile-pop"><strong>{user.name}</strong><p>{user.email}</p><button onClick={async () => {
              try { await write('/logout', 'POST'); navigate('/'); refresh() }
              catch (error) { setToast(errorKey(error)) }
            }}><LogOut size={16} />{t('logout')}</button></div>}
          </div>
        </div>
      </header>
      <main className="main" id="content" tabIndex={-1}>
        <Suspense fallback={<State />}><Routes>
          <Route path="/" element={<Overview user={user} revision={revision} />} />
          <Route path="/analytics" element={<Analytics revision={revision} />} />
          <Route path="/budgets" element={<Budgets revision={revision} />} />
          {(['leads', 'customers', 'campaigns', 'tasks', 'pipeline'] as const).map(kind => <Route key={kind} path={kind + '/*'}
            element={permitted(kind) ? <Records key={kind} kind={kind} {...records} /> : <State error={new ApiError(403, 'access')} />} />)}
          <Route path="/reports" element={manage ? <Reports /> : <State error={new ApiError(403, 'access')} />} />
          <Route path="/users" element={admin ? <UsersPage revision={revision} changed={changed} /> : <State error={new ApiError(403, 'access')} />} />
          <Route path="/settings" element={admin ? <SettingsPage /> : <State error={new ApiError(403, 'access')} />} />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes></Suspense>
      </main>
    </div>
    {toast && <div className="toast" role="status">{t(toast)}<button className="icon-button" aria-label={t('close')} onClick={() => setToast('')}><X size={17} /></button></div>}
  </div>
}

