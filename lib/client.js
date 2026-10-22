// Hand-written lazy ModuleLoader bundle: no dependency installation or build.
window.__ModuleLoader__.load({
  id: 'dsh-session-activity',
  factory: (require) => {
    const { createElement: h, useEffect, useState, useSyncExternalStore } = require('react')
    const { Menu, MenuItemButton, Modal, Button, writeClipboard, IconEllipsisOutlineRegular, IconArchiveOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')
    const KEY = 'dsh-session-activity.mode.v1'
    const PENDING_KEY = 'dsh-session-activity.pending.v1'
    const MAX_RECORDS = 1000
    const identity = x => x
    // Client SessionSummary exposes parentId; only subagent edges represent work.
    // byId also includes retained children absent from the Host-list ids.
    function aggregateRunning(list, statuses) {
      const running = new Map(), queue = []
      for (const s of Object.values(list.byId)) {
        const value = statuses.get(s.id)?.running ?? s.running
        running.set(s.id, value)
        if (value === true) queue.push(s.id)
      }
      for (let i = 0; i < queue.length; i++) {
        const s = list.byId[queue[i]]
        if (s.origin !== 'subagent' || !running.has(s.parentId) || running.get(s.parentId) === true) continue
        running.set(s.parentId, true)
        queue.push(s.parentId)
      }
      return running
    }
    // Only observed runs or native unread signals create metadata, never idle history.
    function createPendingStore(storage) {
      const read = () => {
        try {
          const value = JSON.parse(storage?.getItem(PENDING_KEY) || '{}')
          return Object.fromEntries(Object.entries(value).filter(([id, r]) => id && r &&
            typeof r.running === 'boolean' && typeof r.pending === 'boolean' &&
            typeof r.seeded === 'boolean' && Number.isFinite(r.revision)))
        } catch { return {} }
      }
      let records = read()
      const listeners = new Set(), observed = new Map()
      const trim = value => {
        let handled = 0
        return Object.fromEntries(Object.entries(value).sort((a, b) => b[1].revision - a[1].revision)
          .filter(([, r]) => r.pending || r.running || handled++ < MAX_RECORDS))
      }
      records = trim(records)
      const merge = () => {
        const next = { ...records }
        for (const [id, r] of Object.entries(read())) if (!next[id] || r.revision > next[id].revision) next[id] = r
        return next
      }
      function publish(next, persist) {
        next = trim(next)
        if (JSON.stringify(next) === JSON.stringify(records)) return
        records = next
        if (persist) { try { storage?.setItem(PENDING_KEY, JSON.stringify(records)) } catch {} }
        for (const fn of listeners) fn()
      }
      function update(next, id, patch) {
        const old = next[id]
        next[id] = { running: false, pending: false, seeded: false, ...old, ...patch,
          revision: Math.max(Date.now(), (old?.revision || 0) + 1) }
      }
      return {
        getSnapshot: () => records,
        subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
        sync: () => publish(merge(), false),
        observe(list, statuses) {
          // Hydration placeholders must not turn a persisted running baseline into a completion.
          if (list.phase !== 'ready') return
          const next = merge(), runningById = aggregateRunning(list, statuses)
          for (const id of list.ids ?? []) {
            const s = list.byId[id]
            if (!s || s.origin === 'subagent' || s.blank) continue
            const status = statuses.get(id), running = runningById.get(id)
            if (typeof running !== 'boolean') continue
            const old = next[id]
            const previous = observed.has(id) ? observed.get(id) : old?.running
            const finished = previous === true && !running && old?.running !== false
            const seed = !running && !!status?.completionUnread && !old?.seeded
            const read = (s.retainedBy?.mainView ?? 0) > 0
            // A remote acknowledgement wins over an unchanged local snapshot.
            if (finished || seed || (running && previous !== true) || (old && previous !== running)) {
              update(next, id, { running, pending: !read && (!!old?.pending || finished || seed),
                seeded: !!old?.seeded || seed })
            } else if (read && next[id]?.pending) {
              // Codex-style: viewing the session marks its finished output as read.
              update(next, id, { pending: false })
            }
            observed.set(id, running)
          }
          publish(next, true)
        },
        acknowledge(id) {
          const next = merge()
          if (next[id]?.pending) update(next, id, { pending: false, seeded: true })
          publish(next, true)
        },
      }
    }
    function selectActivity(list, statuses, workspaces, limit = 20, pending = {}) {
      const runningById = aggregateRunning(list, statuses)
      const archived = new Set(workspaces.archivedSessionIds ?? [])
      const pins = new Set(workspaces.pinnedSessionIds ?? [])
      const membership = new Map()
      for (const w of workspaces.items ?? []) for (const id of w.sessionIds) membership.set(id, w)
      const rows = (list.ids ?? []).map(id => list.byId[id]).filter(s => s && s.origin !== 'subagent' && !archived.has(s.id) && !s.blank).map(s => {
        const state = statuses.get(s.id)
        const kind = state?.pendingInteraction ? 'waiting' : runningById.get(s.id) ? 'running' : pending[s.id]?.pending ? 'pending' : 'recent'
        const workspace = membership.get(s.id)
        return { ...s, kind, pinned: pins.has(s.id), workspace: workspace?.title || s.cwd?.split(/[\\/]/).filter(Boolean).pop() || '未分组', time: Number.isFinite(s.updatedAt) ? s.updatedAt : 0 }
      }).sort((a, b) => b.time - a.time || a.id.localeCompare(b.id))
      const recent = rows.filter(s => s.kind === 'recent').slice(0, limit)
      const visible = new Set(recent.map(s => s.id))
      return { active: rows.filter(s => s.kind !== 'recent'), recent, activity: rows.filter(s => s.kind !== 'recent' || visible.has(s.id)), favorites: rows.filter(s => s.pinned) }
    }
    function createModeStore(storage) {
      let mode = 'workspace'
      try { const saved = storage?.getItem(KEY); if (saved === 'activity' || saved === 'favorites') mode = saved } catch {}
      const listeners = new Set()
      return {
        getSnapshot: () => mode,
        subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
        set(next, persist = true) {
          next = next === 'activity' || next === 'favorites' ? next : 'workspace'
          if (mode === next) return
          mode = next
          if (persist) { try { storage?.setItem(KEY, mode) } catch {} }
          for (const fn of listeners) fn()
        },
      }
    }
    function ago(time, now) {
      if (!time) return ''
      const minutes = Math.max(0, Math.floor((now - time) / 60000))
      if (minutes < 1) return '刚刚'
      if (minutes < 60) return `${minutes} 分钟前`
      if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`
      return `${Math.floor(minutes / 1440)} 天前`
    }
    const labels = { running: '运行中', waiting: '等待回复', pending: '未读', recent: '最近会话' }
    const css = `
.dsa-root{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary,inherit)}
.dsa-header{display:flex;align-items:baseline;justify-content:space-between;padding:18px 18px 10px;gap:8px}
.dsa-heading{margin:0;font:inherit;font-size:12px;font-weight:600;letter-spacing:.02em}
.dsa-caption{font-size:10px;color:var(--dsw-alias-label-tertiary,#888)}
.dsa-scroll{overflow-y:auto;min-height:0;padding:0 8px 16px;scrollbar-width:thin}
.dsa-item{position:relative;margin:2px 0;border-radius:8px;isolation:isolate}
.dsa-item:hover,.dsa-item:focus-within,.dsa-item[data-current=true]{background:var(--dsw-alias-interactive-bg-hover,#8882)}
.dsa-row{display:block;box-sizing:border-box;width:100%;padding:9px 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dsa-line1{display:flex;align-items:center;gap:10px;min-width:0}
.dsa-title-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:19px;font-weight:450}
.dsa-trail{display:flex;align-items:center;gap:6px;flex:none;color:var(--dsw-alias-label-tertiary,#888);transition:opacity .12s ease}
.dsa-trail time{font-size:10px;font-variant-numeric:tabular-nums}
.dsa-pin-mark{font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary,#999)}
.dsa-dot{width:6px;height:6px;flex:none;border-radius:50%}
.dsa-dot[data-kind=waiting]{background:#d6a45c}
.dsa-dot[data-kind=pending]{background:#8fa9cf}
.dsa-spin{width:11px;height:11px;flex:none;color:var(--dsw-alias-label-secondary,#aaa);animation:dsa-rotate .9s linear infinite}
.dsa-spin-track{stroke:currentColor;opacity:.22}
.dsa-spin-arc{stroke:currentColor}
@keyframes dsa-rotate{to{transform:rotate(360deg)}}
.dsa-meta{margin:2px 0 0;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsa-actions{position:absolute;right:6px;top:6px;display:flex;gap:1px;align-items:center;height:24px;opacity:0;transition:opacity .12s ease}
.dsa-item:hover .dsa-actions,.dsa-item:focus-within .dsa-actions,.dsa-item[data-menu-open=true] .dsa-actions{opacity:1}
.dsa-item:hover .dsa-trail,.dsa-item:focus-within .dsa-trail,.dsa-item[data-menu-open=true] .dsa-trail{opacity:0}
.dsa-menu-trigger{display:flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary,#aaa);cursor:pointer}
.dsa-menu-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,#8883);color:var(--dsw-alias-label-primary,inherit)}
.dsa-menu-trigger:disabled{cursor:wait}
.dsa-row:focus-visible,.dsa-menu-trigger:focus-visible,.dsa-switch button:focus-visible{outline:2px solid var(--dsw-alias-label-secondary,#aaa);outline-offset:-2px}
.dsa-switch{display:flex;gap:2px;padding:3px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover,#8881);flex-shrink:0}
.dsa-switch button{flex:1;border:0;border-radius:5px;padding:6px 12px;background:transparent;color:var(--dsw-alias-label-tertiary,#888);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.dsa-switch button[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover,#8882);color:var(--dsw-alias-label-primary,inherit);font-weight:600}
.dsa-empty{margin:22px 12px;font-size:12px;line-height:1.8;color:var(--dsw-alias-label-tertiary,#888)}
.dsa-rename{box-sizing:border-box;width:100%;font:inherit;padding:8px;border-radius:6px;border:1px solid var(--dsw-alias-label-tertiary,#777);background:transparent;color:inherit}
@media(hover:none){.dsa-actions{opacity:1}.dsa-trail{opacity:0}}
@media(prefers-reduced-motion:reduce){.dsa-actions,.dsa-trail{transition:none}.dsa-spin{animation:none}}
`

    function apply(ctx) {
      let storage
      try { storage = window.localStorage } catch {}
      const mode = createModeStore(storage)
      const pending = createPendingStore(storage)
      const style = document.createElement('style')
      style.id = 'dsh-session-activity-style'
      style.textContent = css
      document.getElementById(style.id)?.remove()
      document.head.appendChild(style)
      const onStorage = event => { if (event.key === PENDING_KEY) pending.sync(); if (event.key === KEY || event.key === null) { let value; try { value = storage?.getItem(KEY) } catch {} mode.set(value, false) } }
      window.addEventListener('storage', onStorage)
      ctx.on('dispose', () => { style.remove(); window.removeEventListener('storage', onStorage) })
      function Switch({ wide, useSessions, useSessionStatus }) {
        const list = useSessions(identity), statuses = useSessionStatus(identity)
        useEffect(() => pending.observe(list, statuses), [list, statuses])
        const selected = useSyncExternalStore(mode.subscribe, mode.getSnapshot)
        return h('div', { className: 'dsa-switch', role: 'group', 'aria-label': '会话导航视角', style: wide ? undefined : { flexDirection: 'column' } },
          ...[['workspace', '工作区'], ['activity', '活动'], ['favorites', '收藏']].map(([value, label]) => h('button', { key: value, type: 'button', 'aria-pressed': selected === value, onClick: () => mode.set(value) }, label)))
      }
      function Activity({ wide, expandSidebar, useSessions, useSessionStatus, useWorkspaces }) {
        const list = useSessions(identity)
        const statuses = useSessionStatus(identity)
        const workspaces = useWorkspaces(identity)
        const [now, setNow] = useState(Date.now)
        useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
        const selectedMode = useSyncExternalStore(mode.subscribe, mode.getSnapshot)
        const queue = useSyncExternalStore(pending.subscribe, pending.getSnapshot)
        const groups = selectActivity(list, statuses, workspaces, 20, queue)
        if (!wide) return h('button', { type: 'button', className: 'dsa-row', title: '展开活动会话', 'aria-label': '展开活动会话', onClick: expandSidebar }, '◷')
        const favorites = selectedMode === 'favorites'
        const rows = favorites ? groups.favorites : groups.activity
        return h('section', { className: 'dsa-root', 'aria-label': favorites ? '收藏会话' : '活动会话' },
          h('header', { className: 'dsa-header' }, h('h2', { className: 'dsa-heading' }, favorites ? '收藏' : '活动'), h('span', { className: 'dsa-caption' }, '全部工作区')),
          h('div', { className: 'dsa-scroll' }, ...rows.map(s => h(SessionRow, { key: s.id, s, now, showPin: !favorites })),
            !rows.length && h('p', { className: 'dsa-empty' }, list.phase !== 'ready' ? '正在加载会话…' : favorites ? '收藏值得继续关注的会话。' : '最近的会话会出现在这里。')))
      }

      // Native child slots (`sidebar.workspaces.session.menu.item` and
      // `sidebar.workspaces.session.row.action`) are declared by the shipped
      // WorkspaceBrowser entry. A replacing entry cannot declare them again, so
      // the activity rows carry their own menu built from public uiWorkspace
      // actions instead of rendering those slots.
      function SessionRow({ s, now, showPin }) {
        const [menuOpen, setMenuOpen] = useState(false)
        const [dialog, setDialog] = useState(null)
        const [draft, setDraft] = useState('')
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState('')
        const title = s.displayTitle || s.title || s.id
        const run = async operation => {
          if (busy) return
          setMenuOpen(false); setBusy(true); setError('')
          try { await operation(); setDialog(null) }
          catch (reason) { setError(reason?.message || String(reason)); setDialog('error') }
          finally { setBusy(false) }
        }
        const archive = async (stopActivity = false) => {
          if (busy) return
          setMenuOpen(false); setBusy(true); setError('')
          try {
            await ctx.uiWorkspace.archiveSession(s.id, stopActivity ? { stopActivity: true } : undefined)
            setDialog(null)
          } catch (reason) {
            if (!stopActivity && reason?.name === 'WorkspaceArchiveError' && reason?.rpcError?.code === 'workspace/session-active') setDialog('archive')
            else { setError(reason?.message || String(reason)); setDialog('error') }
          } finally { setBusy(false) }
        }
        const close = () => { if (!busy) { setDialog(null); setError('') } }
        const rename = () => run(async () => {
          const result = await ctx.sessions.using(s.id, { source: 'workspaceOperation' }, reference => reference.binding.session.rename(draft.trim()))
          if (!result.ok) throw new Error(result.error.message)
        })
        const item = (label, onClick) => h(MenuItemButton, { key: label, disabled: busy, onSelect: onClick }, label)
        const current = (s.retainedBy?.mainView ?? 0) > 0
        const mark = s.kind === 'running' ? h('svg', { className: 'dsa-spin', viewBox: '0 0 16 16', role: 'img', 'aria-label': '运行中' },
            h('circle', { className: 'dsa-spin-track', cx: 8, cy: 8, r: 6.5, fill: 'none', strokeWidth: 2 }),
            h('circle', { className: 'dsa-spin-arc', cx: 8, cy: 8, r: 6.5, fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeDasharray: '70 30', pathLength: 100 }))
          : s.kind === 'waiting' ? h('span', { className: 'dsa-dot', 'data-kind': 'waiting', role: 'img', 'aria-label': '等待回复' })
          : s.kind === 'pending' ? h('span', { className: 'dsa-dot', 'data-kind': 'pending', role: 'img', 'aria-label': '未读' }) : null
        return h('div', { className: 'dsa-item', 'data-session-id': s.id, 'data-current': current, 'data-menu-open': menuOpen },
          h('button', { type: 'button', className: 'dsa-row', 'aria-current': current ? 'true' : undefined,
            title: `${title} · ${labels[s.kind]}\n${s.cwd || s.workspace}`, onClick: () => ctx.uiWorkspace.openSession(s.id) },
            h('span', { className: 'dsa-line1' },
              h('span', { className: 'dsa-title-text' }, title),
              h('span', { className: 'dsa-trail' },
                showPin && s.pinned && h('span', { className: 'dsa-pin-mark', role: 'img', 'aria-label': '已收藏' }, '★'),
                h('time', { dateTime: s.time ? new Date(s.time).toISOString() : undefined }, ago(s.time, now)),
                mark)),
            h('span', { className: 'dsa-meta' }, s.workspace)),
          h('span', { className: 'dsa-actions' },
            h('button', { type: 'button', className: 'dsa-menu-trigger dsa-archive-btn', disabled: busy,
              'aria-label': `归档会话：${title}`, title: '归档会话', onClick: () => archive() },
              h(IconArchiveOutlineRegular, { size: 14 })),
            h(Menu, { open: menuOpen, onClose: () => setMenuOpen(false), portal: true,
              anchor: h('button', { type: 'button', disabled: busy, className: 'dsa-menu-trigger', 'aria-label': `会话操作：${title}`, 'aria-haspopup': 'menu', 'aria-expanded': menuOpen,
                onClick: () => setMenuOpen(v => !v) }, h(IconEllipsisOutlineRegular, { size: 16 })) },
              item(s.pinned ? '取消收藏（取消置顶）' : '收藏（置顶）', () => run(() => s.pinned ? ctx.uiWorkspace.unpinSession(s.id) : ctx.uiWorkspace.pinSession(s.id))),
              item('重命名', () => { setMenuOpen(false); setDraft(title); setDialog('rename') }),
              item('分叉会话', () => run(() => ctx.uiWorkspace.forkSession(s.id, undefined, { allowMigration: false }))),
              item('归档会话', () => archive()),
              item('复制 Session ID', () => run(async () => { if (!await writeClipboard(s.id)) throw new Error('复制失败，请检查剪贴板权限') })),
              item('切回工作区 · 完整操作', () => { setMenuOpen(false); mode.set('workspace'); ctx.uiWorkspace.openSession(s.id) }))),
          dialog && h(Modal, { open: true, onClose: close, closeLabel: '关闭', title: dialog === 'rename' ? '重命名会话' : dialog === 'archive' ? '停止并归档会话？' : '操作未完成',
            footer: h('div', { style: { display: 'flex', gap: 8 } },
              h(Button, { variant: 'outline', disabled: busy, onClick: close }, dialog === 'error' ? '关闭' : '取消'),
              dialog === 'rename' && h(Button, { variant: 'primary', disabled: busy || !draft.trim(), onClick: rename }, '保存'),
              dialog === 'archive' && h(Button, { variant: 'primary', disabled: busy, onClick: () => archive(true) }, '停止并归档')) },
            dialog === 'rename' && h('input', { className: 'dsa-rename', value: draft, disabled: busy, 'aria-label': '会话名称', 'data-modal-autofocus': true,
              onChange: e => setDraft(e.target.value), onKeyDown: e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && draft.trim()) rename() } }),
            dialog === 'archive' && h('p', null, `「${title}」仍有运行中的任务。继续会停止该会话的任务并归档。`),
            error && h('p', { role: 'alert' }, error)))
      }

      ctx.slots.inject('sidebar.footer.action', () => {
        let unregister, current
        const sync = () => {
          const name = ctx.slots.spec('sidebar.workspaces.before') ? 'sidebar.workspaces.before' : 'sidebar.footer.action'
          if (name === current) return
          unregister?.()
          current = name
          unregister = ctx.slots.register({ name, id: 'dsh-session-activity.switch', order: 0, label: '会话视角' },
            name === 'sidebar.workspaces.before' ? function NavigationSwitch(props) {
              return h('div', { style: { flexShrink: 0, padding: props.wide ? '8px 12px' : '8px 4px' } }, h(Switch, props))
            } : Switch)
        }
        sync()
        const unsubscribe = ctx.slots.subscribe('sidebar.workspaces.before', sync)
        return () => { unsubscribe(); unregister?.() }
      })
      ctx.slots.inject('sidebar.workspaces', () => {
        let unregister
        const sync = () => {
          if (mode.getSnapshot() !== 'workspace' && !unregister) unregister = ctx.slots.register({ name: 'sidebar.workspaces', priority: -100 }, Activity)
          if (mode.getSnapshot() === 'workspace' && unregister) { unregister(); unregister = undefined }
        }
        sync()
        const unsubscribe = mode.subscribe(sync)
        return () => { unsubscribe(); unregister?.() }
      })
    }
    return { inject: ['slots', 'uiWorkspace', 'sessions'], apply, __test__: { selectActivity, createModeStore, createPendingStore, ago, KEY, PENDING_KEY, MAX_RECORDS } }
  },
})
