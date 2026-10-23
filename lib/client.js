// Hand-written lazy ModuleLoader bundle: no dependency installation or build.
window.__ModuleLoader__.load({
  id: '@yiliang114/dsh-session-deck',
  factory: (require) => {
    const { createElement: h, Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } = require('react')
    const { createPortal } = require('react-dom')
    const { Menu, MenuItemButton, Modal, Button, writeClipboard, IconEllipsisOutlineRegular, IconArchiveOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')
    const KEY = 'dsh-session-activity.mode.v1'
    const PENDING_KEY = 'dsh-session-activity.pending.v1'
    const NOTIFIED_KEY = 'dsh-session-activity.notified.v1'
    const SOUND_KEY = 'dsh-session-activity.sound.v1'
    const MAX_RECORDS = 1000
    const MAX_NOTIFIED = 500
    let chimeContext = null, lastChime = 0
    const identity = x => x
    const noPanelInfo = () => null
    const noWorkspaces = () => null
    // A completion is news only while a page is actually visible and the
    // conversation panel is not covered by another global panel.
    function pageIsVisible(doc = typeof document === 'undefined' ? null : document) {
      if (!doc) return false
      if (doc.hidden === true || doc.visibilityState === 'hidden') return false
      if (typeof doc.hasFocus === 'function') return doc.hasFocus() !== false
      return true
    }
    function conversationIsActive(panel) {
      return !panel || panel.activePanelId === null
    }
    function sessionTitle(s) {
      return s?.displayTitle || s?.title || s?.id || ''
    }
    function unreadLabel(count) {
      return count === 1 ? '1 unread completed session' : `${count} unread completed sessions`
    }
    function unreadTotal(counts) {
      let total = 0
      for (const count of counts.values()) total += count
      return total
    }
    function createSoundStore(storage) {
      let enabled = true
      try { enabled = storage?.getItem(SOUND_KEY) !== 'off' } catch {}
      const listeners = new Set()
      return {
        getSnapshot: () => enabled,
        subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
        sync() {
          let next = true
          try { next = storage?.getItem(SOUND_KEY) !== 'off' } catch {}
          if (next === enabled) return
          enabled = next
          for (const fn of listeners) fn()
        },
        set(next) {
          next = !!next
          if (enabled === next) return
          enabled = next
          try { storage?.setItem(SOUND_KEY, enabled ? 'on' : 'off') } catch {}
          for (const fn of listeners) fn()
        },
      }
    }
    // A short two-note cue, synthesized so the package stays dependency-free.
    // The context is created lazily and resumed on the first pointer/key event;
    // if the browser still blocks audio, completion and unread state continue.
    function chimeAudio() {
      if (chimeContext) return chimeContext
      try {
        const Audio = window.AudioContext || window.webkitAudioContext
        if (Audio) chimeContext = new Audio()
      } catch {}
      return chimeContext
    }
    function unlockChime() {
      const audio = chimeAudio()
      if (audio?.state === 'suspended') audio.resume?.().catch?.(() => {})
    }
    function playChime() {
      const now = Date.now()
      if (now - lastChime < 400) return
      const audio = chimeAudio()
      if (!audio) return
      lastChime = now
      try {
        if (audio.state === 'suspended') audio.resume?.()
        const start = audio.currentTime + 0.01
        for (const [frequency, offset, duration] of [[880, 0, 0.12], [1174.66, 0.14, 0.16]]) {
          const oscillator = audio.createOscillator(), gain = audio.createGain()
          oscillator.type = 'sine'
          oscillator.frequency.value = frequency
          gain.gain.setValueAtTime(0.0001, start + offset)
          gain.gain.exponentialRampToValueAtTime(0.06, start + offset + 0.015)
          gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration)
          oscillator.connect(gain).connect(audio.destination)
          oscillator.start(start + offset)
          oscillator.stop(start + offset + duration + 0.02)
        }
      } catch {}
    }
    function closeChime() {
      try { chimeContext?.close?.() } catch {}
      chimeContext = null
      lastChime = 0
    }
    // Workspace membership comes from the public WorkspaceView contract, not
    // from rendered rows or a title/path guess. Group keys match the native
    // data-row-key (`workspace:<workspaceId>`, with '' for Ungrouped).
    function selectWorkspaceUnread(list, workspaces, pending) {
      const counts = new Map()
      if (list?.phase !== 'ready' || workspaces?.phase !== 'ready') return counts
      const archived = new Set(workspaces.archivedSessionIds ?? [])
      const current = new Set(list.ids ?? [])
      const membership = new Map()
      for (const workspace of workspaces.items ?? []) {
        if (workspace?.workspaceId === undefined || workspace?.workspaceId === null) continue
        for (const id of workspace.sessionIds ?? []) membership.set(id, String(workspace.workspaceId))
      }
      for (const [id, record] of Object.entries(pending ?? {})) {
        if (!record?.pending) continue
        const s = list.byId?.[id]
        if (!s || !current.has(id) || s.blank || s.origin === 'subagent' || archived.has(id)) continue
        const key = membership.get(id) ?? ''
        counts.set(key, (counts.get(key) || 0) + 1)
      }
      return counts
    }
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
        observe(list, statuses, options = {}) {
          // Hydration placeholders must not turn a persisted running baseline into a completion.
          if (list.phase !== 'ready') return []
          const next = merge(), runningById = aggregateRunning(list, statuses)
          const canAck = options.canAck || (id => (list.byId[id]?.retainedBy?.mainView ?? 0) > 0)
          const eligible = options.eligible || (() => true)
          const completed = []
          for (const id of list.ids ?? []) {
            const s = list.byId[id]
            if (!s || s.origin === 'subagent' || s.blank || !eligible(s)) continue
            const status = statuses.get(id), running = runningById.get(id)
            if (typeof running !== 'boolean') continue
            const old = next[id]
            const previous = observed.has(id) ? observed.get(id) : old?.running
            const finished = previous === true && !running && old?.running !== false
            const seed = !running && !!status?.completionUnread && !old?.seeded
            const read = canAck(id)
            // A remote acknowledgement wins over an unchanged local snapshot.
            if (finished || seed || (running && previous !== true) || (old && previous !== running)) {
              update(next, id, { running, pending: !read && (!!old?.pending || finished || seed),
                seeded: !!old?.seeded || seed })
            } else if (read && next[id]?.pending) {
              // Codex-style: viewing the session marks its finished output as read.
              update(next, id, { pending: false })
            }
            // A persisted running baseline restored on reload still becomes
            // unread, but only a transition observed by this page is news.
            if (finished && observed.has(id)) completed.push({ id, revision: next[id].revision, read })
            observed.set(id, running)
          }
          publish(next, true)
          return completed
        },
        acknowledge(id) {
          const next = merge()
          if (next[id]?.pending) update(next, id, { pending: false, seeded: true })
          publish(next, true)
        },
      }
    }
    // One completion should produce one notice even when several same-origin
    // tabs observed the same running -> idle edge. Web Locks serialize the
    // claim where available; the persisted revision is the fallback guard.
    function createDeliveryLedger(storage, locks = typeof navigator === 'undefined' ? null : navigator.locks) {
      const read = () => {
        try {
          const value = JSON.parse(storage?.getItem(NOTIFIED_KEY) || '{}')
          return Object.fromEntries(Object.entries(value).filter(([id, revision]) => id && Number.isFinite(revision)))
        } catch { return {} }
      }
      let delivered = read()
      const persist = () => {
        const kept = Object.fromEntries(Object.entries(delivered).sort((a, b) => b[1] - a[1]).slice(0, MAX_NOTIFIED))
        delivered = kept
        try { storage?.setItem(NOTIFIED_KEY, JSON.stringify(kept)) } catch {}
      }
      const remember = (id, revision) => {
        if (!id || !Number.isFinite(revision)) return true
        // Another tab may have written since this ledger was constructed. Read
        // inside the lock so a stale in-memory copy cannot claim it twice.
        const current = read()
        for (const [key, value] of Object.entries(delivered)) {
          if (!Number.isFinite(current[key]) || value > current[key]) current[key] = value
        }
        delivered = current
        if (Number.isFinite(delivered[id]) && delivered[id] >= revision) return false
        delivered[id] = revision
        persist()
        return true
      }
      return {
        async claim(id, revision) {
          if (!locks?.request) return remember(id, revision)
          try { return await locks.request('dsh-session-deck.notification', () => remember(id, revision)) }
          catch { return remember(id, revision) }
        },
      }
    }
    // DSH rc.2 has no group-header decoration slot. Insert only our marker into
    // the native project row, keyed by its real workspace id. Unknown layouts
    // remain untouched and the unread list/notifications keep working.
    function mountWorkspaceUnreadBadges(anchor, readCounts) {
      const doc = anchor?.ownerDocument
      const root = anchor?.closest?.('.hHd-Xa_root')
      const Observer = doc?.defaultView?.MutationObserver
      if (!root || !Observer) return { update() {}, dispose() {} }
      let active = true
      const owned = new Set()
      const classes = node => String(node?.className || '').split(/\s+/).filter(Boolean)
      const isRow = node => classes(node).includes('YDXeBa_projectRow') && node.getAttribute?.('role') === 'treeitem'
      const keyOf = row => {
        const raw = row.getAttribute?.('data-row-key')
        return isRow(row) && typeof raw === 'string' && raw.startsWith('workspace:') ? raw.slice('workspace:'.length) : null
      }
      const marker = () => {
        const node = doc.createElement('span')
        node.className = 'dsa-group-unread'
        node.setAttribute('role', 'img')
        node.setAttribute('data-dsa-unread', '')
        return node
      }
      const sync = () => {
        if (!active) return
        const counts = readCounts() || new Map()
        const seen = new Set()
        for (const row of root.querySelectorAll('[data-row-key]')) {
          const key = keyOf(row)
          if (key === null) continue
          const count = counts.get(key) || 0
          const current = [...row.children].find(node => classes(node).includes('dsa-group-unread'))
          if (!count) { current?.remove(); continue }
          const node = current || marker()
          const label = unreadLabel(count)
          if (node.getAttribute('aria-label') !== label) node.setAttribute('aria-label', label)
          if (node.getAttribute('title') !== label) node.setAttribute('title', label)
          if (node.getAttribute('data-count') !== String(count)) node.setAttribute('data-count', String(count))
          if (row.children[row.children.length - 1] !== node) row.appendChild(node)
          seen.add(node)
        }
        // Animated row clones and detached rows can carry a copied marker.
        // Remove every marker we did not place on a live project row.
        for (const node of root.querySelectorAll('.dsa-group-unread')) if (!seen.has(node)) node.remove()
        owned.clear()
        for (const node of seen) owned.add(node)
      }
      const observer = new Observer(sync)
      observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-row-key'] })
      sync()
      return {
        update: sync,
        dispose() {
          if (!active) return
          active = false
          observer.disconnect()
          for (const node of owned) node.remove()
          owned.clear()
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
        return { ...s, kind, pinned: pins.has(s.id), workspace: workspace?.title || s.cwd?.split(/[\\/]/).filter(Boolean).pop() || 'Ungrouped', time: Number.isFinite(s.updatedAt) ? s.updatedAt : 0 }
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
      if (minutes < 1) return 'Just now'
      if (minutes < 60) return `${minutes}m ago`
      if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
      return `${Math.floor(minutes / 1440)}d ago`
    }
    // Compatibility adapter for DSH 0.2.1-rc.2, NOT an official public slot.
    // Only our container is inserted/removed; native and React-owned nodes stay put.
    // Capture the anchor's own sidebar, never a document-wide first match.
    function mountNavigationHost(anchor, onHost) {
      const root = anchor?.closest('.hHd-Xa_root')
      const shape = () => {
        if (!root || anchor.closest('.hHd-Xa_root') !== root) return null
        const children = [...root.children]
        const regions = children.filter(node => node.classList.contains('hHd-Xa_regionArea'))
        const footers = children.filter(node => node.classList.contains('hHd-Xa_footArea'))
        return regions.length === 1 && footers.length === 1 && footers[0].contains(anchor) &&
          children.indexOf(regions[0]) < children.indexOf(footers[0]) ? regions[0] : null
      }
      const Observer = anchor?.ownerDocument.defaultView?.MutationObserver
      if (!shape() || !Observer) { onHost(null); return () => {} }
      const host = anchor.ownerDocument.createElement('div')
      host.className = 'dsa-navigation-host'
      let active = true, published
      const sync = () => {
        if (!active) return
        const region = shape()
        if (region) {
          if (host.parentNode !== root || host.nextSibling !== region) root.insertBefore(host, region)
        } else host.remove()
        const next = region ? host : null
        if (published !== next) { published = next; onHost(next) }
      }
      // No subtree/body observation: portal rendering cannot trigger this observer.
      // The adjacency guard makes our own insertion notification a no-op.
      const observer = new Observer(sync)
      observer.observe(root, { childList: true })
      sync()
      return () => { active = false; observer.disconnect(); host.remove() }
    }
    function selectArchived(list, workspaces, query = '') {
      const membership = new Map()
      for (const w of workspaces.items ?? []) for (const id of w.sessionIds) membership.set(id, w)
      const search = query.trim().toLocaleLowerCase()
      // Include archived blanks and subagents too: the archive is a recovery list.
      return [...new Set(workspaces.archivedSessionIds ?? [])].map(id => list.byId[id]).filter(Boolean).map(s => ({
        ...s,
        title: s.displayTitle || s.title || s.id,
        workspace: membership.get(s.id)?.title || s.cwd?.split(/[\\/]/).filter(Boolean).pop() || 'Ungrouped',
        time: Number.isFinite(s.updatedAt) ? s.updatedAt : 0,
      })).filter(s => !search || [s.title, s.workspace, s.cwd, s.id].some(value => value?.toLocaleLowerCase().includes(search)))
        .sort((a, b) => b.time - a.time || a.id.localeCompare(b.id))
    }
    // DSH rc.2 has no More-menu item slot. Own only this portal container;
    // native account actions and document-level keyboard navigation stay intact.
    function mountArchiveMenuHost(anchor, onChange) {
      const doc = anchor?.ownerDocument
      const footer = anchor?.closest('.hHd-Xa_footArea')
      const root = footer?.parentNode
      const Observer = doc?.defaultView?.MutationObserver
      if (!root?.classList.contains('hHd-Xa_root') || !Observer) {
        onChange({ host: null, trigger: null, supported: false })
        return () => {}
      }
      const host = doc.createElement('div')
      host.className = 'dsa-archive-menu-host'
      let active = true, published, watchingBody = false, viewport
      const publish = (target, trigger, supported) => {
        if (published?.host === target && published?.trigger === trigger && published?.supported === supported) return
        published = { host: target, trigger, supported }
        onChange(published)
      }
      const sync = () => {
        if (!active) return
        const triggers = footer.querySelectorAll('.yHnPSG_root > .yHnPSG_anchor > button.yHnPSG_trigger[aria-haspopup="menu"]')
        const trigger = triggers.length === 1 ? triggers[0] : null
        const open = trigger?.getAttribute('aria-expanded') === 'true'
        if (open && !watchingBody) { bodyObserver.observe(doc.body, { childList: true }); watchingBody = true }
        if (!open && watchingBody) { bodyObserver.disconnect(); watchingBody = false }
        const menus = open ? [...doc.body.children].filter(node => node.getAttribute('role') === 'menu') : []
        const menu = menus.length === 1 && menus[0].classList.contains('_list_4ub78_7') ? menus[0] : null
        const views = menu ? [...menu.children].filter(node => node.classList.contains('_viewport_4ub78_19')) : []
        const view = views.length === 1 ? views[0] : null
        const rows = view ? [...view.children].filter(node => node !== host) : []
        const known = rows.length === 3 && rows.every(row => row.classList.contains('_itemWrap_4ub78_90') && row.querySelector('button[role="menuitem"]'))
        const nextViewport = known ? view : null
        if (viewport !== nextViewport) {
          menuObserver.disconnect()
          viewport = nextViewport
          if (viewport) menuObserver.observe(viewport, { childList: true })
        }
        if (viewport) {
          if (host.parentNode !== viewport || host.nextSibling !== rows[1]) viewport.insertBefore(host, rows[1])
        } else host.remove()
        publish(viewport ? host : null, trigger, !!trigger && (!open || !menus.length || known))
      }
      const bodyObserver = new Observer(sync), menuObserver = new Observer(sync), footerObserver = new Observer(sync)
      footerObserver.observe(footer, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
      sync()
      return () => {
        active = false
        footerObserver.disconnect(); bodyObserver.disconnect(); menuObserver.disconnect()
        host.remove()
      }
    }
    const labels = { running: 'Running', waiting: 'Waiting for reply', pending: 'Unread', recent: 'Recent sessions' }
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
.dsa-group-unread{width:6px;height:6px;flex:none;align-self:center;margin-left:6px;border-radius:50%;background:#3a83f7;box-shadow:0 0 0 2px var(--dsw-alias-bg-base,transparent);pointer-events:none}
.dsa-header-actions{display:flex;align-items:center;gap:8px;flex:none}
.dsa-sound{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary,#888);font:inherit;font-size:14px;line-height:1;cursor:pointer}
.dsa-sound:hover{background:var(--dsw-alias-interactive-bg-hover,#8882);color:var(--dsw-alias-label-primary,inherit)}
.dsa-sound[aria-pressed=false]{opacity:.45}
.dsa-sound:focus-visible{outline:2px solid var(--dsw-alias-label-secondary,#aaa);outline-offset:1px}
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
.dsa-navigation-host{flex-shrink:0;padding:8px 0}
.dsa-switch{display:flex;gap:2px;padding:3px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover,#8881);flex-shrink:0;min-width:0}
.dsa-switch button{position:relative;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;border:0;border-radius:5px;padding:6px 6px;background:transparent;color:var(--dsw-alias-label-tertiary,#888);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.dsa-tab-unread{position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:#3a83f7;box-shadow:0 0 0 2px var(--dsw-alias-bg-base,#202124);pointer-events:none}
.dsa-switch[data-compact=true]{flex-direction:column}
.dsa-switch[data-compact=true] button{padding:6px 0}
.dsa-switch button[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover,#8882);color:var(--dsw-alias-label-primary,inherit);font-weight:600}
.dsa-empty{margin:22px 12px;font-size:12px;line-height:1.8;color:var(--dsw-alias-label-tertiary,#888)}
.dsa-rename{box-sizing:border-box;width:100%;font:inherit;padding:8px;border-radius:6px;border:1px solid var(--dsw-alias-label-tertiary,#777);background:transparent;color:inherit}
.dsa-archive-dialog{width:min(560px,calc(100vw - 32px));max-width:calc(100vw - 32px)}
.dsa-archive-list{max-height: min(50vh,460px);overflow-y:auto;margin-top:12px;scrollbar-width:thin}
.dsa-archive-row{display:flex;align-items:center;gap:12px}
.dsa-archive-row:hover{background:var(--dsw-alias-interactive-bg-hover,#8882)}
.dsa-archive-row:disabled{cursor:wait;opacity:.6}
.dsa-archive-details{flex:1;min-width:0}
.dsa-archive-details .dsa-title-text,.dsa-archive-details .dsa-meta{display:block}
.dsa-archive-time{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}
.dsa-archive-notice{font-size:12px;line-height:1.6}
.dsa-archive-status{display:block;margin-top:8px;min-height:18px;font-size:12px;color:var(--dsw-alias-label-secondary,#aaa)}
@media(hover:none){.dsa-actions{opacity:1}.dsa-trail{opacity:0}}
@media(prefers-reduced-motion:reduce){.dsa-actions,.dsa-trail{transition:none}.dsa-spin{animation:none}}
`

    function apply(ctx) {
      let storage
      try { storage = window.localStorage } catch {}
      const mode = createModeStore(storage)
      const pending = createPendingStore(storage)
      const sound = createSoundStore(storage)
      const style = document.createElement('style')
      style.id = 'yiliang114-dsh-session-deck-style'
      style.textContent = css
      const onStorage = event => {
        if (event.key === PENDING_KEY) pending.sync()
        if (event.key === SOUND_KEY) sound.sync()
        if (event.key === KEY || event.key === null) { let value; try { value = storage?.getItem(KEY) } catch {} mode.set(value, false) }
      }
      ctx.effect(() => {
        document.getElementById(style.id)?.remove()
        document.head.appendChild(style)
        window.addEventListener('storage', onStorage)
        const unlock = () => unlockChime()
        document.addEventListener?.('pointerdown', unlock)
        document.addEventListener?.('keydown', unlock)
        return () => {
          style.remove(); window.removeEventListener('storage', onStorage)
          document.removeEventListener?.('pointerdown', unlock); document.removeEventListener?.('keydown', unlock)
          closeChime()
        }
      })
      function Switch({ wide, unread = 0 }) {
        const selected = useSyncExternalStore(mode.subscribe, mode.getSnapshot)
        return h('div', { className: 'dsa-switch', role: 'group', 'aria-label': 'Session navigation view', 'data-compact': !wide },
          ...[['workspace', 'Workspaces', 'W'], ['activity', 'Activity', 'A'], ['favorites', 'Favorites', '★']].map(([value, label, compact]) => {
            const showUnread = value === 'activity' && unread > 0
            return h('button', { key: value, type: 'button', title: showUnread ? `${label} · ${unreadLabel(unread)}` : label, 'aria-label': label, 'aria-pressed': selected === value, onClick: () => mode.set(value) },
              wide ? label : compact,
              showUnread && h('span', { className: 'dsa-tab-unread', role: 'img', 'aria-label': unreadLabel(unread), 'data-count': String(unread) }))
          }))
      }
      function NavigationSwitch(props) {
        const list = props.useSessions(identity)
        const workspaces = (props.useWorkspaces || noWorkspaces)(identity)
        const queue = useSyncExternalStore(pending.subscribe, pending.getSnapshot)
        const unread = unreadTotal(selectWorkspaceUnread(list, workspaces, queue))
        return h('div', { style: { flexShrink: 0, padding: props.wide ? '8px 12px' : '8px 4px' } }, h(Switch, { ...props, unread }))
      }
      function usePageVisible() {
        const [visible, setVisible] = useState(() => pageIsVisible())
        useEffect(() => {
          const sync = () => setVisible(pageIsVisible())
          document.addEventListener?.('visibilitychange', sync)
          window.addEventListener?.('focus', sync)
          window.addEventListener?.('blur', sync)
          sync()
          return () => {
            document.removeEventListener?.('visibilitychange', sync)
            window.removeEventListener?.('focus', sync)
            window.removeEventListener?.('blur', sync)
          }
        }, [])
        return visible
      }
      function FooterNavigation(props) {
        const [anchor, setAnchor] = useState(null)
        const [host, setHost] = useState(null)
        const list = props.useSessions(identity)
        const workspaces = (props.useWorkspaces || noWorkspaces)(identity)
        const queue = useSyncExternalStore(pending.subscribe, pending.getSnapshot)
        const counts = selectWorkspaceUnread(list, workspaces, queue)
        const unread = unreadTotal(counts)
        const latest = useRef(counts), badges = useRef(null)
        latest.current = counts
        useLayoutEffect(() => mountNavigationHost(anchor, setHost), [anchor])
        useLayoutEffect(() => {
          badges.current = mountWorkspaceUnreadBadges(anchor, () => latest.current)
          return () => { badges.current?.dispose(); badges.current = null }
        }, [anchor])
        useLayoutEffect(() => { badges.current?.update() })
        // The hidden callback ref stays in the registered footer's React tree.
        // A portal retains slot/React context and all injected props. Unknown DOM
        // shapes render inline in that footer instead of guessing a destination.
        return h(Fragment, null, h('span', { hidden: true, ref: setAnchor }),
          host ? createPortal(h(Switch, { ...props, unread }), host) : h(Switch, { ...props, unread }))
      }
      function NotificationCenter(props) {
        const list = props.useSessions(identity)
        const statuses = props.useSessionStatus(identity)
        const workspaces = (props.useWorkspaces || noWorkspaces)(identity)
        const panel = (props.usePanelInfo || noPanelInfo)(identity)
        const visible = usePageVisible()
        const soundOn = useSyncExternalStore(sound.subscribe, sound.getSnapshot)
        const ledger = useRef(null)
        if (!ledger.current) ledger.current = createDeliveryLedger(storage)
        const live = useRef(new Set()), mounted = useRef(true)
        useEffect(() => {
          mounted.current = true
          return () => {
            mounted.current = false
            for (const notice of live.current) { try { notice.close?.() } catch {} }
            live.current.clear()
          }
        }, [])
        const open = sessionId => {
          try {
            ctx.uiWorkspace.openSession(sessionId)
            pending.acknowledge(sessionId)
          } catch {}
        }
        const raiseSystem = (sessionId, title, revision, silent) => {
          try {
            if (!('Notification' in window) || window.Notification.permission !== 'granted') return false
            const notice = new window.Notification('Session finished', {
              body: title, tag: `dsh-session-deck-${sessionId}-${revision}`, renotify: false, silent,
            })
            live.current.add(notice)
            notice.onclick = () => { try { window.focus() } catch {} open(sessionId); try { notice.close() } catch {} }
            notice.onclose = () => live.current.delete(notice)
            return true
          } catch { return false }
        }
        useEffect(() => {
          const archived = new Set(workspaces?.archivedSessionIds ?? [])
          const events = pending.observe(list, statuses, {
            canAck: id => visible && conversationIsActive(panel) && ((list.byId[id]?.retainedBy?.mainView ?? 0) > 0),
            eligible: s => !archived.has(s.id),
          })
          if (!events.length) return
          void (async () => {
            for (const event of events) {
              if (event.read) continue
              const s = list.byId[event.id]
              if (!s) continue
              const claimed = await ledger.current.claim(event.id, event.revision)
              if (!claimed || !mounted.current) continue
              const title = sessionTitle(s)
              // Visible completions use the in-app cue. A hidden page uses a
              // browser notification with the platform sound when permission
              // already exists, and falls back to the cue when it does not.
              if (visible) {
                if (soundOn) playChime()
              } else if (!raiseSystem(event.id, title, event.revision, !soundOn)) {
                if (soundOn) playChime()
              }
            }
          })()
        }, [list, statuses, workspaces, visible, panel, soundOn])
        return null
      }
      function Activity({ wide, expandSidebar, useSessions, useSessionStatus, useWorkspaces }) {
        const list = useSessions(identity)
        const statuses = useSessionStatus(identity)
        const workspaces = useWorkspaces(identity)
        const [now, setNow] = useState(Date.now)
        useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
        const selectedMode = useSyncExternalStore(mode.subscribe, mode.getSnapshot)
        const queue = useSyncExternalStore(pending.subscribe, pending.getSnapshot)
        const soundOn = useSyncExternalStore(sound.subscribe, sound.getSnapshot)
        const groups = selectActivity(list, statuses, workspaces, 20, queue)
        if (!wide) return h('button', { type: 'button', className: 'dsa-row', title: 'Expand session activity', 'aria-label': 'Expand session activity', onClick: expandSidebar }, '◷')
        const favorites = selectedMode === 'favorites'
        const rows = favorites ? groups.favorites : groups.activity
        return h('section', { className: 'dsa-root', 'aria-label': favorites ? 'Favorite sessions' : 'Session activity' },
          h('header', { className: 'dsa-header' }, h('h2', { className: 'dsa-heading' }, favorites ? 'Favorites' : 'Activity'),
            h('div', { className: 'dsa-header-actions' },
              h('span', { className: 'dsa-caption' }, 'All workspaces'),
              h('button', { type: 'button', className: 'dsa-sound', 'aria-pressed': soundOn,
                'aria-label': soundOn ? 'Mute completion sound' : 'Enable completion sound',
                title: soundOn ? 'Mute completion sound' : 'Enable completion sound',
                onClick: () => { const next = !soundOn; sound.set(next); if (next) playChime() } }, '♪'))),
          h('div', { className: 'dsa-scroll' }, ...rows.map(s => h(SessionRow, { key: s.id, s, now, showPin: !favorites })),
            !rows.length && h('p', { className: 'dsa-empty' }, list.phase !== 'ready' ? 'Loading sessions…' : favorites ? 'Favorite sessions to keep them close at hand.' : 'Recent sessions will appear here.')))
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
        const mark = s.kind === 'running' ? h('svg', { className: 'dsa-spin', viewBox: '0 0 16 16', role: 'img', 'aria-label': 'Running' },
            h('circle', { className: 'dsa-spin-track', cx: 8, cy: 8, r: 6.5, fill: 'none', strokeWidth: 2 }),
            h('circle', { className: 'dsa-spin-arc', cx: 8, cy: 8, r: 6.5, fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeDasharray: '70 30', pathLength: 100 }))
          : s.kind === 'waiting' ? h('span', { className: 'dsa-dot', 'data-kind': 'waiting', role: 'img', 'aria-label': 'Waiting for reply' })
          : s.kind === 'pending' ? h('span', { className: 'dsa-dot', 'data-kind': 'pending', role: 'img', 'aria-label': 'Unread' }) : null
        return h('div', { className: 'dsa-item', 'data-session-id': s.id, 'data-current': current, 'data-menu-open': menuOpen },
          h('button', { type: 'button', className: 'dsa-row', 'aria-current': current ? 'true' : undefined,
            title: `${title} · ${labels[s.kind]}\n${s.cwd || s.workspace}`, onClick: () => ctx.uiWorkspace.openSession(s.id) },
            h('span', { className: 'dsa-line1' },
              h('span', { className: 'dsa-title-text' }, title),
              h('span', { className: 'dsa-trail' },
                showPin && s.pinned && h('span', { className: 'dsa-pin-mark', role: 'img', 'aria-label': 'Favorited' }, '★'),
                h('time', { dateTime: s.time ? new Date(s.time).toISOString() : undefined }, ago(s.time, now)),
                mark)),
            h('span', { className: 'dsa-meta' }, s.workspace)),
          h('span', { className: 'dsa-actions' },
            h('button', { type: 'button', className: 'dsa-menu-trigger dsa-archive-btn', disabled: busy,
              'aria-label': `Archive session: ${title}`, title: 'Archive session', onClick: () => archive() },
              h(IconArchiveOutlineRegular, { size: 14 })),
            h(Menu, { open: menuOpen, onClose: () => setMenuOpen(false), portal: true,
              anchor: h('button', { type: 'button', disabled: busy, className: 'dsa-menu-trigger', 'aria-label': `Session actions: ${title}`, 'aria-haspopup': 'menu', 'aria-expanded': menuOpen,
                onClick: () => setMenuOpen(v => !v) }, h(IconEllipsisOutlineRegular, { size: 16 })) },
              item(s.pinned ? 'Remove from favorites (unpin)' : 'Add to favorites (pin)', () => run(() => s.pinned ? ctx.uiWorkspace.unpinSession(s.id) : ctx.uiWorkspace.pinSession(s.id))),
              item('Rename', () => { setMenuOpen(false); setDraft(title); setDialog('rename') }),
              item('Fork session', () => run(() => ctx.uiWorkspace.forkSession(s.id, undefined, { allowMigration: false }))),
              item('Archive session', () => archive()),
              item('Copy session ID', () => run(async () => { if (!await writeClipboard(s.id)) throw new Error('Copy failed. Check clipboard permissions.') })),
              item('Open in workspace for all actions', () => { setMenuOpen(false); mode.set('workspace'); ctx.uiWorkspace.openSession(s.id) }))),
          dialog && h(Modal, { open: true, onClose: close, closeLabel: 'Close', title: dialog === 'rename' ? 'Rename session' : dialog === 'archive' ? 'Stop and archive session?' : 'Action failed',
            footer: h('div', { style: { display: 'flex', gap: 8 } },
              h(Button, { variant: 'outline', disabled: busy, onClick: close }, dialog === 'error' ? 'Close' : 'Cancel'),
              dialog === 'rename' && h(Button, { variant: 'primary', disabled: busy || !draft.trim(), onClick: rename }, 'Save'),
              dialog === 'archive' && h(Button, { variant: 'primary', disabled: busy, onClick: () => archive(true) }, 'Stop and archive')) },
            dialog === 'rename' && h('input', { className: 'dsa-rename', value: draft, disabled: busy, 'aria-label': 'Session name', 'data-modal-autofocus': true,
              onChange: e => setDraft(e.target.value), onKeyDown: e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && draft.trim()) rename() } }),
            dialog === 'archive' && h('p', null, `“${title}” still has running tasks. Continuing will stop those tasks and archive the session.`),
            error && h('p', { role: 'alert' }, error)))
      }

      ctx.slots.inject('sidebar.footer.action', () => {
        let unregister, current
        const sync = () => {
          const name = ctx.slots.spec('sidebar.workspaces.before') ? 'sidebar.workspaces.before' : 'sidebar.footer.action'
          if (name === current) return
          unregister?.()
          current = name
          unregister = ctx.slots.register({ name, id: '@yiliang114/dsh-session-deck.switch', order: 0, label: 'Session view' },
            name === 'sidebar.workspaces.before' ? NavigationSwitch : FooterNavigation)
        }
        sync()
        const unsubscribe = ctx.slots.subscribe('sidebar.workspaces.before', sync)
        return () => { unsubscribe(); unregister?.() }
      })
      function ArchiveBrowser({ useSessions, useWorkspaces }) {
        const list = useSessions(identity), workspaces = useWorkspaces(identity)
        const [anchor, setAnchor] = useState(null)
        const [menu, setMenu] = useState({ host: null, trigger: null, supported: true })
        const [open, setOpen] = useState(false)
        const [query, setQuery] = useState('')
        const [restoring, setRestoring] = useState(null)
        const [error, setError] = useState('')
        const busy = useRef(false), mounted = useRef(true)
        useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
        useLayoutEffect(() => mountArchiveMenuHost(anchor, setMenu), [anchor])
        const show = () => {
          if (menu.trigger?.getAttribute('aria-expanded') === 'true') menu.trigger.click()
          menu.trigger?.focus()
          setQuery(''); setError(''); setOpen(true)
        }
        const close = () => { if (!busy.current) setOpen(false) }
        const restore = async s => {
          // A ref guards rapid clicks before React commits the disabled buttons.
          if (busy.current) return
          busy.current = true
          setRestoring(s.id); setError('')
          try {
            await ctx.uiWorkspace.unarchiveSession(s.id)
            if (!mounted.current) return
            mode.set('workspace')
            ctx.uiWorkspace.openSession(s.id)
            setOpen(false)
          } catch (reason) {
            if (mounted.current) setError(`Could not restore “${s.title}”: ${reason?.message || String(reason)}`)
          } finally {
            busy.current = false
            if (mounted.current) setRestoring(null)
          }
        }
        const rows = open ? selectArchived(list, workspaces, query) : []
        const loadError = list.error || workspaces.error
        const loading = list.phase !== 'ready' || workspaces.phase !== 'ready'
        const now = Date.now()
        return h(Fragment, null,
          h('span', { hidden: true, ref: setAnchor }),
          menu.host && createPortal(h(MenuItemButton, { icon: h(IconArchiveOutlineRegular, { size: 16 }), onSelect: show }, 'Show archived'), menu.host),
          !menu.supported && h('button', { type: 'button', className: 'dsa-row', onClick: show }, 'Show archived'),
          open && h(Modal, { open: true, onClose: close, closeLabel: 'Close', title: 'Archived sessions', className: 'dsa-archive-dialog',
            description: 'Select a session to restore it to its workspace and open the conversation.' },
            h('input', { type: 'search', className: 'dsa-rename', value: query, placeholder: 'Search archived sessions', 'aria-label': 'Search archived sessions', 'data-modal-autofocus': true, onChange: e => setQuery(e.target.value) }),
            loadError && h('p', { role: 'alert', className: 'dsa-archive-notice' }, `Could not load archived sessions: ${loadError.message || String(loadError)}`),
            error && h('p', { role: 'alert', className: 'dsa-archive-notice' }, error),
            h('div', { className: 'dsa-archive-list', 'aria-busy': restoring !== null },
              ...rows.map(s => h('button', { key: s.id, type: 'button', className: 'dsa-row dsa-archive-row', disabled: restoring !== null,
                'data-session-id': s.id, 'aria-label': `Restore and open: ${s.title}`, title: `Restore and open: ${s.title}\n${s.cwd || s.workspace}`, onClick: () => restore(s) },
                h(IconArchiveOutlineRegular, { size: 18 }),
                h('span', { className: 'dsa-archive-details' }, h('span', { className: 'dsa-title-text' }, s.title), h('span', { className: 'dsa-meta' }, s.workspace)),
                h('time', { className: 'dsa-archive-time', dateTime: s.time ? new Date(s.time).toISOString() : undefined, title: s.time ? `Last updated: ${new Date(s.time).toLocaleString()}` : undefined }, ago(s.time, now)))),
              !rows.length && !loadError && h('p', { className: 'dsa-empty' }, loading ? 'Loading archived sessions…' : query.trim() ? 'No archived sessions match your search.' : 'No archived sessions.')),
            h('span', { role: 'status', className: 'dsa-archive-status' }, restoring ? 'Restoring session…' : '')))
      }
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: '@yiliang114/dsh-session-deck.notifications', order: 20, label: 'Session notifications',
      }, NotificationCenter))
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action', id: '@yiliang114/dsh-session-deck.archives', order: 1, label: 'Show archived',
      }, ArchiveBrowser))
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
    return { inject: ['slots', 'uiWorkspace', 'sessions'], apply, __test__: { mountNavigationHost, mountArchiveMenuHost, mountWorkspaceUnreadBadges, selectActivity, selectArchived, selectWorkspaceUnread, createModeStore, createPendingStore, createDeliveryLedger, createSoundStore, pageIsVisible, conversationIsActive, ago, KEY, PENDING_KEY, NOTIFIED_KEY, SOUND_KEY, MAX_RECORDS } }
  },
})
