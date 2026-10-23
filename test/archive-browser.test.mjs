import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const primitives = Object.fromEntries(['Menu', 'MenuItemButton', 'Modal', 'Button', 'IconArchiveOutlineRegular'].map(name => [name, Symbol(name)]))
const portalType = Symbol('portal')
function load(react = {}, document = {}, events = {}) {
  let plugin
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: { load: entry => { plugin = entry.factory(name => name === 'react' ? react : name === 'react-dom'
        ? { createPortal: (child, host) => ({ type: portalType, props: { host }, children: [child] }) } : primitives) } },
      addEventListener() {}, removeEventListener() {}, ...events,
    },
    document,
  })
  return plugin
}
const { mountArchiveMenuHost } = load().__test__

// Observe direct children, subtree attributes and attribute filters separately.
// Callback-created mutations are delivered too, with a hard bound on self loops.
function domFixture() {
  const observers = new Set()
  let mutations = 0
  class Observer {
    constructor(callback) { this.callback = callback; observers.add(this) }
    observe(target, options) { this.target = target; this.options = options; this.connected = true }
    disconnect() { this.connected = false; this.pending = false }
  }
  const changed = (target, type, attributeName) => {
    mutations++
    for (const observer of observers) {
      if (!observer.connected || !observer.options[type]) continue
      if (observer.target !== target && !(observer.options.subtree && observer.target.contains(target))) continue
      if (type === 'attributes' && observer.options.attributeFilter && !observer.options.attributeFilter.includes(attributeName)) continue
      observer.pending = true
    }
  }
  const document = { defaultView: { MutationObserver: Observer }, activeElement: null }
  class Element {
    constructor(tag = 'div', className = '', attributes = {}) {
      this.tagName = tag.toUpperCase(); this.className = className; this.attributes = new Map(Object.entries(attributes))
      this.children = []; this.parentNode = null; this.ownerDocument = document
    }
    get classList() { return { contains: value => this.className.split(/\s+/).includes(value) } }
    get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] ?? null }
    getAttribute(name) { return this.attributes.get(name) ?? null }
    setAttribute(name, value) { this.attributes.set(name, String(value)); changed(this, 'attributes', name) }
    matches(selector) {
      const tag = selector.match(/^[a-z][\w-]*/i)?.[0]
      if (tag && this.tagName !== tag.toUpperCase()) return false
      for (const [, name] of selector.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(name)) return false
      for (const [, name, value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (value === undefined ? this.getAttribute(name) === null : this.getAttribute(name) !== value) return false
      }
      return true
    }
    closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) ?? null }
    contains(node) { return node === this || this.children.some(child => child.contains(node)) }
    querySelectorAll(selector) {
      const parts = selector.split(/\s*>\s*/)
      const matches = node => {
        for (let i = parts.length - 1; i >= 0; i--, node = node.parentNode) if (!node?.matches(parts[i])) return false
        return true
      }
      const visit = parent => parent.children.flatMap(child => [child, ...visit(child)])
      return visit(this).filter(matches)
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
    insertBefore(node, before) {
      assert.ok(before === null || this.children.includes(before), 'insertion anchor belongs to its parent')
      if (node === before) return node
      node.remove()
      this.children.splice(before === null ? this.children.length : this.children.indexOf(before), 0, node)
      node.parentNode = this
      changed(this, 'childList')
      return node
    }
    append(node) { return this.insertBefore(node, null) }
    appendChild(node) { return this.append(node) }
    remove() {
      if (!this.parentNode) return
      const parent = this.parentNode
      parent.children.splice(parent.children.indexOf(this), 1)
      this.parentNode = null
      changed(parent, 'childList')
    }
    click() { this.clicks = (this.clicks || 0) + 1; this.onClick?.() }
    focus() { document.activeElement = this }
  }
  document.createElement = tag => new Element(tag)
  document.body = new Element('body')
  document.head = new Element('head')
  document.getElementById = id => [...document.head.children, ...document.body.querySelectorAll('*')].find(node => node.id === id) ?? null
  const root = document.body.append(new Element('aside', 'hHd-Xa_root'))
  const footer = root.append(new Element('footer', 'hHd-Xa_footArea'))
  const anchor = footer.append(new Element('span'))
  const addTrigger = (parent = footer) => parent.append(new Element('div', 'yHnPSG_root'))
    .append(new Element('div', 'yHnPSG_anchor'))
    .append(new Element('button', 'yHnPSG_trigger', { 'aria-haspopup': 'menu', 'aria-expanded': 'false' }))
  const trigger = addTrigger()
  const makeMenu = () => {
    const menu = new Element('div', '_list_4ub78_7', { role: 'menu' })
    const view = menu.append(new Element('div', '_viewport_4ub78_19'))
    const rows = ['Settings', 'Theme', 'Log out'].map(label => {
      const row = view.append(new Element('div', '_itemWrap_4ub78_90'))
      row.append(new Element('button', '', { role: 'menuitem' })).textContent = label
      return row
    })
    return { menu, view, rows }
  }
  const native = makeMenu()
  trigger.onClick = () => {
    const open = trigger.getAttribute('aria-expanded') !== 'true'
    trigger.setAttribute('aria-expanded', String(open))
    if (open) document.body.append(native.menu)
    else native.menu.remove()
  }
  function flush() {
    let deliveries = 0
    while ([...observers].some(observer => observer.pending)) {
      for (const observer of observers) if (observer.pending) {
        assert.ok(++deliveries <= 25, 'archive observers must settle without a self loop')
        observer.pending = false
        observer.callback()
      }
    }
    return deliveries
  }
  return { document, root, footer, anchor, trigger, ...native, Element, observers, addTrigger, makeMenu, flush, mutations: () => mutations }
}

test('archive menu inserts immediately after Settings, keeps native actions and avoids observing portal contents', t => {
  const f = domFixture(), states = []
  const dispose = mountArchiveMenuHost(f.anchor, state => states.push(state))
  t.after(dispose)
  assert.equal(states[0].host, null)
  assert.equal(states[0].trigger, f.trigger)
  assert.equal(states[0].supported, true)
  const footerObserver = [...f.observers].find(observer => observer.target === f.footer)
  assert.deepEqual({ ...footerObserver.options, attributeFilter: Array.from(footerObserver.options.attributeFilter) }, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'],
  })
  assert.equal([...f.observers].filter(observer => observer.connected).length, 1)
  f.trigger.click()
  assert.ok(f.flush() > 0)
  const host = states.at(-1).host
  assert.equal(host.className, 'dsa-archive-menu-host')
  assert.deepEqual(f.view.children, [f.rows[0], host, f.rows[1], f.rows[2]])
  assert.equal(f.rows[0].children[0].textContent, 'Settings')
  for (const target of [f.document.body, f.view]) {
    assert.deepEqual({ ...[...f.observers].find(observer => observer.target === target).options }, { childList: true })
  }
  const count = states.length, mutations = f.mutations()
  for (const observer of f.observers) observer.callback()
  assert.equal(f.flush(), 0)
  assert.equal(f.mutations(), mutations)
  assert.equal(states.length, count, 'unchanged host does not republish')
  host.append(new f.Element('button', '', { role: 'menuitem' }))
  f.rows[0].children[0].append(new f.Element('span'))
  assert.equal(f.flush(), 0, 'portal and native row descendants are outside observation scope')
})

test('archive host rejects unknown roots, footer ancestry and unavailable MutationObserver', () => {
  for (const alter of [
    f => { f.root.className = 'future-root' },
    f => { f.footer.className = 'future-footer' },
    f => { f.root.append(new f.Element()).append(f.footer) },
    f => { f.root.append(f.anchor) },
    f => { f.document.defaultView.MutationObserver = undefined },
  ]) {
    const f = domFixture(), states = []
    alter(f)
    const mutations = f.mutations()
    mountArchiveMenuHost(f.anchor, state => states.push(state))()
    assert.equal(states.length, 1)
    assert.equal(states[0].host, null)
    assert.equal(states[0].trigger, null)
    assert.equal(states[0].supported, false)
    assert.equal(f.mutations(), mutations)
    assert.equal(f.observers.size, 0)
  }
  const states = []
  mountArchiveMenuHost(null, state => states.push(state))()
  assert.deepEqual({ ...states[0] }, { host: null, trigger: null, supported: false })
})

test('archive host requires exactly one correctly shaped trigger in its own footer', () => {
  for (const alter of [
    f => f.trigger.remove(),
    f => { f.trigger.className = 'future-trigger' },
    f => f.trigger.setAttribute('aria-haspopup', 'dialog'),
    f => f.addTrigger(),
    f => { const wrapper = f.trigger.parentNode.append(new f.Element()); wrapper.append(f.trigger) },
    f => { f.trigger.remove(); f.addTrigger(f.root.append(new f.Element('footer', 'hHd-Xa_footArea'))) },
  ]) {
    const f = domFixture(), states = []
    alter(f)
    f.document.body.append(f.menu)
    const mutations = f.mutations()
    const dispose = mountArchiveMenuHost(f.anchor, state => states.push(state))
    assert.equal(states.at(-1).supported, false)
    assert.equal(states.at(-1).trigger, null)
    assert.equal(states.at(-1).host, null)
    assert.equal(f.mutations(), mutations)
    assert.equal([...f.observers].filter(observer => observer.connected).length, 1)
    dispose()
  }
})

test('archive host rejects menu version changes and ambiguous menus, viewports or native rows', () => {
  for (const [label, alter] of [
    ['menu class', f => { f.menu.className = 'future-menu' }],
    ['viewport class', f => { f.view.className = 'future-viewport' }],
    ['nested viewport', f => { f.menu.append(new f.Element()).append(f.view) }],
    ['two viewports', f => { f.menu.append(new f.Element('div', '_viewport_4ub78_19')) }],
    ['missing row', f => f.rows[2].remove()],
    ['extra row', f => f.view.append(f.makeMenu().rows[0])],
    ['row class', f => { f.rows[1].className = 'future-item' }],
    ['missing menuitem', f => f.rows[1].children[0].setAttribute('role', 'button')],
    ['two native menus', f => f.document.body.append(f.makeMenu().menu)],
    ['another menu', f => f.document.body.append(new f.Element('div', 'foreign-menu', { role: 'menu' }))],
  ]) {
    const f = domFixture(), states = []
    f.trigger.click()
    alter(f)
    const mutations = f.mutations()
    const dispose = mountArchiveMenuHost(f.anchor, state => states.push(state))
    assert.equal(states.at(-1).host, null, label)
    assert.equal(states.at(-1).supported, false, label)
    assert.equal(states.at(-1).trigger, f.trigger, label)
    assert.equal(f.mutations(), mutations, label)
    assert.equal(f.flush(), 0, label)
    dispose()
  }
})

test('archive host waits for the direct body menu and never adopts a nested or unrelated menu', t => {
  const f = domFixture(), states = []
  t.after(mountArchiveMenuHost(f.anchor, state => states.push(state)))
  f.trigger.setAttribute('aria-expanded', 'true')
  f.flush()
  assert.equal(states.at(-1).host, null)
  assert.equal(states.at(-1).supported, true)
  const wrapper = f.document.body.append(new f.Element())
  wrapper.append(f.menu)
  f.flush()
  assert.equal(states.at(-1).host, null)
  assert.deepEqual(f.view.children, f.rows)
  f.document.body.append(f.menu)
  f.flush()
  assert.equal(states.at(-1).host.parentNode, f.view)
})

test('archive menu reopens, replaces removed menus and recovers its removed host without duplicates', t => {
  const f = domFixture(), states = []
  t.after(mountArchiveMenuHost(f.anchor, state => states.push(state)))
  f.trigger.click(); f.flush()
  const host = states.at(-1).host
  host.remove(); f.flush()
  assert.equal(states.at(-1).host, host)
  assert.deepEqual(f.view.children, [f.rows[0], host, f.rows[1], f.rows[2]])
  f.menu.remove(); f.flush()
  assert.equal(states.at(-1).host, null)
  assert.equal(host.parentNode, null)
  const replacement = f.makeMenu()
  f.document.body.append(replacement.menu); f.flush()
  assert.equal(states.at(-1).host, host)
  assert.deepEqual(replacement.view.children, [replacement.rows[0], host, replacement.rows[1], replacement.rows[2]])
  f.trigger.setAttribute('aria-expanded', 'false'); replacement.menu.remove(); f.flush()
  assert.equal(states.at(-1).host, null)
  assert.equal([...f.observers].filter(observer => observer.connected).length, 1)
  f.trigger.click(); f.flush()
  assert.equal(states.at(-1).host, host)
  assert.equal(f.view.children.filter(node => node.className === 'dsa-archive-menu-host').length, 1)
})

test('archive host disposal disconnects all observers and removes only its own container', () => {
  const f = domFixture(), states = []
  f.trigger.click()
  const dispose = mountArchiveMenuHost(f.anchor, state => states.push(state))
  const host = states.at(-1).host
  f.flush()
  dispose()
  assert.equal(host.parentNode, null)
  assert.deepEqual(f.view.children, f.rows)
  assert.ok([...f.observers].every(observer => !observer.connected))
  const count = states.length
  for (const observer of f.observers) observer.callback()
  dispose()
  assert.equal(f.flush(), 0)
  assert.equal(states.length, count)
  assert.deepEqual(f.view.children, f.rows)
  const remount = mountArchiveMenuHost(f.anchor, state => states.push(state))
  assert.notEqual(states.at(-1).host, host)
  assert.equal(f.view.children.filter(node => node.className === 'dsa-archive-menu-host').length, 1)
  remount()
})

// State setters batch until render() so two calls from one render really share
// a stale closure. Effects honor dependencies and run their disposal callbacks.
function hooksHarness() {
  const cells = [], pendingEffects = new Set(), lateUpdates = []
  let cursor = 0, dirty = false, active = false, component, props, tree
  const effect = (setup, dependencies) => {
    const index = cursor++, previous = cells[index]
    if (!previous || !dependencies || dependencies.some((value, i) => !Object.is(value, previous.dependencies?.[i]))) {
      cells[index] = { dependencies, setup, cleanup: previous?.cleanup }
      pendingEffects.add(index)
    }
  }
  const react = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const index = cursor++
      if (!cells[index]) {
        const cell = { value: typeof initial === 'function' ? initial() : initial }
        cell.set = value => {
          if (!active) { lateUpdates.push(index); return }
          const next = typeof value === 'function' ? value(cell.value) : value
          if (!Object.is(next, cell.value)) { cell.value = next; dirty = true }
        }
        cells[index] = cell
      }
      return [cells[index].value, cells[index].set]
    },
    useRef(initial) { const index = cursor++; return cells[index] ||= { current: initial } },
    useEffect: effect,
    useLayoutEffect: effect,
    useSyncExternalStore: (subscribe, snapshot) => snapshot(),
  }
  function render() {
    assert.ok(active, 'component must be mounted')
    let commits = 0
    do {
      assert.ok(++commits <= 20, 'hook effects must settle')
      dirty = false; cursor = 0
      tree = component(props)
      const effects = [...pendingEffects]
      pendingEffects.clear()
      for (const index of effects) {
        const cell = cells[index]
        cell.cleanup?.()
        cell.cleanup = cell.setup()
      }
    } while (dirty)
    return tree
  }
  return {
    react, render, lateUpdates,
    mount(Component, injected) { active = true; component = Component; props = injected; return render() },
    unmount() {
      if (!active) return
      active = false
      for (const cell of cells) cell.cleanup?.()
      pendingEffects.clear()
      tree = null
    },
  }
}
const nodes = tree => {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return [tree, ...tree.children.flatMap(nodes)]
}
const text = tree => !tree || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree)
  : (Array.isArray(tree) ? tree : tree.children).map(text).join('')
const findNode = (tree, predicate) => nodes(tree).find(predicate)
const modal = tree => findNode(tree, node => node.type === primitives.Modal)
const archiveRows = tree => nodes(tree).filter(node => node.type === 'button' && node.props['data-session-id'])
const search = tree => findNode(tree, node => node.type === 'input' && node.props.type === 'search')
const alerts = tree => nodes(tree).filter(node => node.props.role === 'alert')
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function browserFixture({ rows = [{ id: 'one', displayTitle: 'First archive', updatedAt: 1000, cwd: '/projects/one' }], unarchive = () => Promise.resolve(), initialMode = 'activity' } = {}) {
  const dom = domFixture(), hooks = hooksHarness(), registrations = [], disposals = [], listeners = new Set(), subscriptions = new Map(), calls = []
  const values = new Map([['dsh-session-activity.mode.v1', initialMode]])
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  const snapshots = {
    list: { phase: 'ready', ids: rows.map(row => row.id), byId: Object.fromEntries(rows.map(row => [row.id, row])) },
    workspaces: { phase: 'ready', items: [], archivedSessionIds: rows.map(row => row.id) },
  }
  let mounted, disposed = false
  const plugin = load(hooks.react, dom.document, {
    localStorage: storage,
    addEventListener: (name, fn) => { assert.equal(name, 'storage'); listeners.add(fn) },
    removeEventListener: (name, fn) => { assert.equal(name, 'storage'); listeners.delete(fn) },
  })
  plugin.apply({
    effect: setup => disposals.push(setup()),
    slots: {
      inject: (name, setup) => disposals.push(setup()),
      spec: () => false,
      subscribe: (name, callback) => { subscriptions.set(name, callback); return () => subscriptions.delete(name) },
      register: (spec, component) => {
        const registration = { spec, component, active: true }
        registrations.push(registration)
        return () => { registration.active = false; if (registration === mounted) hooks.unmount() }
      },
    },
    uiWorkspace: {
      unarchiveSession: id => { calls.push(['unarchive', id]); return unarchive(id) },
      openSession: id => {
        assert.equal(values.get('dsh-session-activity.mode.v1'), 'workspace', 'workspace mode changes before opening')
        assert.ok(!registrations.some(registration => registration.active && registration.spec.name === 'sidebar.workspaces'))
        calls.push(['open', id])
      },
    },
  })
  mounted = registrations.find(registration => registration.spec.id === '@yiliang114/dsh-session-deck.archives')
  assert.ok(mounted, 'archive browser is registered')
  hooks.mount(mounted.component, { useSessions: select => select(snapshots.list), useWorkspaces: select => select(snapshots.workspaces) })
  const render = () => { dom.flush(); return hooks.render() }
  return {
    ...dom, hooks, render, registrations, listeners, subscriptions, snapshots, calls, values, mounted,
    connect() {
      findNode(render(), node => node.type === 'span' && typeof node.props.ref === 'function').props.ref(dom.anchor)
      return render()
    },
    show() {
      const trigger = findNode(render(), node => text(node) === 'Show archived' && (node.type === 'button' || node.type === primitives.MenuItemButton))
      assert.ok(trigger, 'archive entry is visible')
      ;(trigger.props.onSelect || trigger.props.onClick)()
      return render()
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const dispose of [...disposals].reverse()) dispose?.()
    },
  }
}

test('archive browser has a dedicated stable footer registration and an accessible compatibility fallback', t => {
  const f = browserFixture()
  t.after(() => f.dispose())
  const archives = f.registrations.filter(registration => registration.spec.id === '@yiliang114/dsh-session-deck.archives')
  assert.equal(archives.length, 1)
  assert.deepEqual({ ...archives[0].spec }, {
    name: 'sidebar.footer.action', id: '@yiliang114/dsh-session-deck.archives', order: 1, label: 'Show archived',
  })
  assert.equal(archives[0].component.name, 'ArchiveBrowser')
  const tree = f.show()
  assert.equal(modal(tree).props.title, 'Archived sessions')
  assert.equal(modal(tree).props.closeLabel, 'Close')
  assert.match(modal(tree).props.description, /restore.*workspace.*open/)
  assert.equal(search(tree).props['aria-label'], 'Search archived sessions')
  assert.equal(search(tree).props['data-modal-autofocus'], true)
  assert.equal(archiveRows(tree)[0].props['aria-label'], 'Restore and open: First archive')
  assert.equal(archiveRows(tree)[0].props.type, 'button')
})

test('archive restore awaits unarchive, blocks same-tick clicks across rows and only then switches mode and opens', async t => {
  const operation = deferred()
  const f = browserFixture({ rows: [
    { id: 'one', title: 'First archive', updatedAt: 2 }, { id: 'two', title: 'Second archive', updatedAt: 1 },
  ], unarchive: () => operation.promise })
  t.after(() => f.dispose())
  let tree = f.show()
  const [first, second] = archiveRows(tree)
  const restore = first.props.onClick()
  const duplicate = first.props.onClick()
  const otherRow = second.props.onClick()
  await Promise.all([duplicate, otherRow])
  assert.deepEqual(f.calls, [['unarchive', 'one']])
  assert.equal(f.values.get('dsh-session-activity.mode.v1'), 'activity')
  tree = f.render()
  assert.ok(archiveRows(tree).every(row => row.props.disabled))
  assert.equal(findNode(tree, node => node.props.className === 'dsa-archive-list').props['aria-busy'], true)
  assert.equal(text(findNode(tree, node => node.props.role === 'status')), 'Restoring session…')
  modal(tree).props.onClose()
  assert.ok(modal(f.render()), 'dialog cannot close while restoring')
  assert.deepEqual(f.calls, [['unarchive', 'one']], 'opening is deferred until the RPC resolves')
  operation.resolve()
  await restore
  tree = f.render()
  assert.deepEqual(f.calls, [['unarchive', 'one'], ['open', 'one']])
  assert.equal(modal(tree), undefined)
  assert.equal(f.values.get('dsh-session-activity.mode.v1'), 'workspace')
})

test('failed archive restores never navigate, show the error and allow a successful retry', async t => {
  const failed = deferred(), retry = deferred()
  let attempt = 0
  const f = browserFixture({ initialMode: 'favorites', unarchive: () => (++attempt === 1 ? failed : retry).promise })
  t.after(() => f.dispose())
  let tree = f.show()
  const first = archiveRows(tree)[0].props.onClick()
  failed.reject(new Error('Connection lost'))
  await first
  tree = f.render()
  assert.deepEqual(f.calls, [['unarchive', 'one']])
  assert.equal(f.values.get('dsh-session-activity.mode.v1'), 'favorites')
  assert.ok(modal(tree))
  assert.deepEqual(alerts(tree).map(text), ['Could not restore “First archive”: Connection lost'])
  assert.equal(archiveRows(tree)[0].props.disabled, false)
  assert.equal(findNode(tree, node => node.props.className === 'dsa-archive-list').props['aria-busy'], false)
  assert.equal(text(findNode(tree, node => node.props.role === 'status')), '')
  const second = archiveRows(tree)[0].props.onClick()
  tree = f.render()
  assert.deepEqual(alerts(tree), [], 'retry clears the stale error immediately')
  assert.equal(archiveRows(tree)[0].props.disabled, true)
  retry.resolve()
  await second
  assert.deepEqual(f.calls, [['unarchive', 'one'], ['unarchive', 'one'], ['open', 'one']])
  assert.equal(modal(f.render()), undefined)
})

test('a synchronous restore failure remains actionable and string errors render usefully', async t => {
  const f = browserFixture({ unarchive: () => { throw 'Permission denied' } })
  t.after(() => f.dispose())
  let tree = f.show()
  await archiveRows(tree)[0].props.onClick()
  tree = f.render()
  assert.deepEqual(alerts(tree).map(text), ['Could not restore “First archive”: Permission denied'])
  assert.equal(archiveRows(tree)[0].props.disabled, false)
  assert.deepEqual(f.calls, [['unarchive', 'one']])
  search(tree).props.onChange({ target: { value: 'hidden query' } })
  modal(f.render()).props.onClose()
  assert.equal(modal(f.render()), undefined)
  tree = f.show()
  assert.deepEqual(alerts(tree), [])
  assert.equal(search(tree).props.value, '')
})

test('archive UI distinguishes loading, empty, failed load and no search matches', t => {
  const f = browserFixture({ rows: [] })
  t.after(() => f.dispose())
  f.snapshots.list.phase = 'loading'
  let tree = f.show()
  assert.match(text(tree), /Loading archived sessions…/)
  f.snapshots.list.phase = 'ready'
  f.snapshots.workspaces.phase = 'loading'
  assert.match(text(f.render()), /Loading archived sessions…/)
  f.snapshots.workspaces.phase = 'ready'
  tree = f.render()
  assert.match(text(tree), /No archived sessions\./)
  search(tree).props.onChange({ target: { value: 'missing' } })
  assert.match(text(f.render()), /No archived sessions match your search\./)
  search(f.render()).props.onChange({ target: { value: '  \t ' } })
  assert.match(text(f.render()), /No archived sessions\./)
  for (const [store, failure, expected] of [
    ['list', new Error('Session list unavailable'), 'Session list unavailable'],
    ['workspaces', 'Workspace list unavailable', 'Workspace list unavailable'],
  ]) {
    f.snapshots[store].error = failure
    tree = f.render()
    assert.deepEqual(alerts(tree).map(text), [`Could not load archived sessions: ${expected}`])
    assert.doesNotMatch(text(tree), /No archived sessions|Loading archived sessions/)
    delete f.snapshots[store].error
  }
  assert.match(text(f.render()), /No archived sessions\./)
})

test('archive search filters rows, clears on reopen and reacts to externally restored membership', t => {
  const f = browserFixture({ rows: [
    { id: 'alpha', displayTitle: 'Alpha archive', updatedAt: 2, cwd: '/projects/one' },
    { id: 'beta', title: 'Beta archive', updatedAt: 1, cwd: 'C:\\projects\\two' },
  ] })
  t.after(() => f.dispose())
  f.snapshots.workspaces.items = [{ title: 'Team workspace', sessionIds: ['beta'] }]
  let tree = f.show()
  assert.deepEqual(archiveRows(tree).map(row => row.props['data-session-id']), ['alpha', 'beta'])
  search(tree).props.onChange({ target: { value: ' TEAM ' } })
  tree = f.render()
  assert.deepEqual(archiveRows(tree).map(row => row.props['data-session-id']), ['beta'])
  assert.equal(search(tree).props.value, ' TEAM ')
  assert.match(text(archiveRows(tree)[0]), /Beta archiveTeam workspace/)
  modal(tree).props.onClose()
  tree = f.show()
  assert.equal(search(tree).props.value, '')
  assert.equal(archiveRows(tree).length, 2)
  f.snapshots.workspaces = { ...f.snapshots.workspaces, archivedSessionIds: ['beta'] }
  assert.deepEqual(archiveRows(f.render()).map(row => row.props['data-session-id']), ['beta'])
  assert.equal(f.snapshots.list.byId.alpha.id, 'alpha')
})

test('archive modal persists after More closes and its menu portal disappears', t => {
  const f = browserFixture()
  t.after(() => f.dispose())
  let tree = f.connect()
  assert.equal(findNode(tree, node => node.type === 'button' && text(node) === 'Show archived'), undefined)
  f.trigger.click()
  tree = f.render()
  const portal = findNode(tree, node => node.type === portalType)
  const host = portal.props.host
  assert.equal(host.parentNode, f.view)
  assert.equal(portal.children[0].type, primitives.MenuItemButton)
  assert.equal(text(portal), 'Show archived')
  tree = f.show()
  assert.equal(f.trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(f.document.activeElement, f.trigger)
  assert.equal(f.menu.parentNode, null)
  assert.equal(host.parentNode, null)
  assert.equal(findNode(tree, node => node.type === portalType), undefined)
  assert.ok(modal(tree), 'modal belongs to the registered component, not its removed menu portal')
  assert.equal(archiveRows(tree).length, 1)
  modal(tree).props.onClose()
  assert.equal(modal(f.render()), undefined)
  f.trigger.click()
  tree = f.render()
  assert.equal(findNode(tree, node => node.type === portalType).props.host, host)
  assert.ok(modal(f.show()), 'the archive entry still works after reopening More')
})

test('archive restore settling after plugin disposal never navigates, changes mode or updates unmounted state', async t => {
  for (const outcome of ['resolve', 'reject']) {
    const operation = deferred()
    const f = browserFixture({ unarchive: () => operation.promise })
    t.after(() => f.dispose())
    f.connect()
    f.trigger.click()
    const tree = f.show()
    const restore = archiveRows(tree)[0].props.onClick()
    f.dispose()
    if (outcome === 'resolve') operation.resolve()
    else operation.reject(new Error('Late restore failure'))
    await restore
    assert.deepEqual(f.calls, [['unarchive', 'one']], outcome)
    assert.equal(f.values.get('dsh-session-activity.mode.v1'), 'activity', outcome)
    assert.deepEqual(f.hooks.lateUpdates, [], outcome)
    assert.ok([...f.observers].every(observer => !observer.connected), outcome)
    assert.ok(f.registrations.every(registration => !registration.active), outcome)
  }
})

test('plugin cleanup unmounts archive browser, unregisters slots and releases menu observers and style', () => {
  const f = browserFixture()
  f.connect()
  f.trigger.click()
  const tree = f.render(), host = findNode(tree, node => node.type === portalType).props.host
  assert.equal(f.document.head.children.length, 1)
  assert.equal(f.listeners.size, 1)
  assert.equal(f.subscriptions.size, 1)
  f.dispose()
  assert.ok(f.registrations.every(registration => !registration.active))
  assert.equal(f.document.head.children.length, 0)
  assert.equal(f.listeners.size, 0)
  assert.equal(f.subscriptions.size, 0)
  assert.equal(host.parentNode, null)
  assert.deepEqual(f.view.children, f.rows)
  assert.ok([...f.observers].every(observer => !observer.connected))
  for (const observer of f.observers) observer.callback()
  f.dispose()
  assert.equal(f.flush(), 0)
  assert.equal(host.parentNode, null)
  assert.deepEqual(f.calls, [])
})
