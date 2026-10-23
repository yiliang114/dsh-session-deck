import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
function load(react = {}, document = {}, events = {}) {
  let plugin
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: { load: entry => { plugin = entry.factory(name => name === 'react' ? react : {}) } },
      addEventListener() {}, removeEventListener() {}, ...events,
    },
    document, setTimeout, clearTimeout, setInterval, clearInterval,
  })
  return plugin
}

const {
  selectWorkspaceUnread, createPendingStore, createDeliveryLedger, mountWorkspaceUnreadBadges,
  createSoundStore, pageIsVisible, conversationIsActive, PENDING_KEY, NOTIFIED_KEY, SOUND_KEY,
} = load().__test__

const memoryStorage = () => {
  const data = new Map()
  return { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), data }
}
const session = (id, more = {}) => ({ id, displayTitle: id, running: false, updatedAt: 1, ...more })
const list = sessions => ({
  phase: 'ready',
  ids: sessions.map(s => s.id),
  byId: Object.fromEntries(sessions.map(s => [s.id, s])),
})
const workspaces = (items = [], archivedSessionIds = []) => ({ phase: 'ready', items, archivedSessionIds })

test('group unread counts use workspace membership and exclude ineligible sessions', () => {
  const sessions = [
    session('one', { pending: true }), session('fork', { parentId: 'one' }),
    session('child', { origin: 'subagent' }), session('blank', { blank: true }),
    session('archived'), session('loose'),
  ]
  const pending = Object.fromEntries(['one', 'fork', 'child', 'blank', 'archived', 'loose'].map(id => [id, { pending: true }]))
  const counts = selectWorkspaceUnread(list(sessions), workspaces([
    { workspaceId: 'w1', title: 'One', sessionIds: ['one', 'child'] },
    { workspaceId: 'w2', title: 'Two', sessionIds: ['fork'] },
  ], ['archived']), pending)
  assert.deepEqual(Object.fromEntries(counts), { w1: 1, w2: 1, '': 1 })
  // A persisted record with no current session cannot make a group look unread.
  assert.equal(selectWorkspaceUnread(list(sessions.slice(0, 1)), workspaces([]), {
    missing: { pending: true }, one: { pending: false },
  }).size, 0)
  const retained = list(sessions.slice(0, 1))
  retained.byId.retained = session('retained')
  assert.equal(selectWorkspaceUnread(retained, workspaces([
    { workspaceId: 'w1', title: 'One', sessionIds: ['retained'] },
  ]), { retained: { pending: true } }).size, 0)
  // Loading snapshots must not flash the ungrouped dot.
  assert.equal(selectWorkspaceUnread({ ...list(sessions), phase: 'loading' }, workspaces([]), { one: { pending: true } }).size, 0)
})

test('only a live transition produces a completion event; reload seeds unread silently', () => {
  const storage = memoryStorage()
  let queue = createPendingStore(storage)
  const running = list([session('main', { running: true })]), idle = list([session('main')])
  assert.equal(queue.observe(running, new Map()).length, 0)
  const events = queue.observe(idle, new Map())
  assert.equal(events.length, 1)
  assert.equal(events[0].id, 'main')
  assert.equal(events[0].read, false)
  assert.ok(Number.isFinite(events[0].revision))
  assert.equal(queue.getSnapshot().main.pending, true)
  assert.equal(queue.observe(idle, new Map()).length, 0, 'same snapshot cannot duplicate the event')
  // A completion already read in this visible page still reports the event,
  // but marks it read so the notifier can stay silent.
  queue.observe(running, new Map())
  const read = queue.observe(idle, new Map(), { canAck: () => true })
  assert.equal(read.length, 1)
  assert.equal(read[0].read, true)
  assert.equal(queue.getSnapshot().main.pending, false)
  // A reload that sees a persisted running baseline restores unread without
  // replaying a notification.
  const reloadStorage = memoryStorage()
  createPendingStore(reloadStorage).observe(running, new Map())
  const reloaded = createPendingStore(reloadStorage)
  assert.equal(reloaded.observe(idle, new Map()).length, 0)
  assert.equal(reloaded.getSnapshot().main.pending, true)
})

test('archived sessions do not create a completion or unread record', () => {
  const queue = createPendingStore(memoryStorage())
  const running = list([session('main', { running: true })]), idle = list([session('main')])
  queue.observe(running, new Map(), { eligible: () => false })
  assert.equal(queue.observe(idle, new Map(), { eligible: () => false }).length, 0)
  assert.equal(queue.getSnapshot().main, undefined)
})

test('delivery ledger serializes one claim per completion revision across tabs', async () => {
  const storage = memoryStorage()
  let tail = Promise.resolve()
  const locks = {
    request(name, callback) {
      const result = tail.then(callback)
      tail = result.then(() => {}, () => {})
      return result
    },
  }
  const a = createDeliveryLedger(storage, locks), b = createDeliveryLedger(storage, locks)
  const claims = await Promise.all([a.claim('main', 10), b.claim('main', 10)])
  assert.deepEqual(claims.sort(), [false, true])
  assert.equal(await a.claim('main', 10), false)
  assert.equal(await b.claim('main', 9), false)
  assert.equal(await a.claim('main', 11), true)
  assert.ok(JSON.parse(storage.getItem(NOTIFIED_KEY)).main === 11)
  // Without Web Locks the persisted revision still prevents a sequential
  // duplicate in another ledger.
  const fallback = createDeliveryLedger(storage)
  assert.equal(await fallback.claim('main', 11), false)
  assert.equal(await fallback.claim('other', 12), true)
})

test('completion sound preference defaults on, persists, and syncs', () => {
  const storage = memoryStorage()
  const first = createSoundStore(storage)
  assert.equal(first.getSnapshot(), true)
  let changes = 0
  const stop = first.subscribe(() => changes++)
  first.set(false)
  assert.equal(first.getSnapshot(), false)
  assert.equal(storage.getItem(SOUND_KEY), 'off')
  first.set(false)
  assert.equal(changes, 1)
  const second = createSoundStore(storage)
  assert.equal(second.getSnapshot(), false)
  storage.setItem(SOUND_KEY, 'on')
  second.sync()
  assert.equal(second.getSnapshot(), true)
  stop()
  assert.equal(createSoundStore({ getItem() { throw Error('denied') }, setItem() { throw Error('denied') } }).getSnapshot(), true)
})

test('visibility requires a visible, focused page and an uncovered conversation panel', () => {
  assert.equal(pageIsVisible({ visibilityState: 'visible', hasFocus: () => true }), true)
  assert.equal(pageIsVisible({ visibilityState: 'hidden', hasFocus: () => true }), false)
  assert.equal(pageIsVisible({ hidden: true, hasFocus: () => true }), false)
  assert.equal(pageIsVisible({ visibilityState: 'visible', hasFocus: () => false }), false)
  assert.equal(conversationIsActive(null), true)
  assert.equal(conversationIsActive({ activePanelId: null }), true)
  assert.equal(conversationIsActive({ activePanelId: 'settings' }), false)
})

function badgeFixture() {
  const observers = new Set()
  let mutations = 0
  class Observer {
    constructor(callback) { this.callback = callback; observers.add(this) }
    observe(target, options) { this.target = target; this.options = options; this.connected = true }
    disconnect() { this.connected = false; this.pending = false }
  }
  const changed = (target, attributeName) => {
    mutations++
    for (const observer of observers) {
      if (!observer.connected) continue
      if (observer.target !== target && !(observer.options?.subtree && observer.target.contains(target))) continue
      if (attributeName === undefined) {
        if (!observer.options?.childList) continue
      } else {
        if (!observer.options?.attributes) continue
        if (observer.options.attributeFilter && !observer.options.attributeFilter.includes(attributeName)) continue
      }
      observer.pending = true
    }
  }
  const document = { defaultView: { MutationObserver: Observer }, createElement: tag => new Element(tag) }
  class Element {
    constructor(tag = 'div', className = '') {
      this.tagName = tag.toUpperCase(); this.className = className; this.attributes = new Map(); this.children = []; this.parentNode = null; this.ownerDocument = document
    }
    get classList() { return { contains: value => this.className.split(/\s+/).includes(value) } }
    getAttribute(name) { return this.attributes.get(name) ?? null }
    setAttribute(name, value) { this.attributes.set(name, String(value)); changed(this, name) }
    contains(node) { return node === this || this.children.some(child => child.contains(node)) }
    closest(selector) { return this.className.split(/\s+/).includes(selector.slice(1)) ? this : this.parentNode?.closest(selector) ?? null }
    querySelectorAll(selector) {
      const visit = parent => parent.children.flatMap(child => [child, ...visit(child)])
      return visit(this).filter(node => selector === '[data-row-key]'
        ? node.getAttribute('data-row-key') !== null
        : selector === '.dsa-group-unread' && node.classList.contains('dsa-group-unread'))
    }
    insertBefore(node, before) {
      if (node === before) return node
      node.remove()
      this.children.splice(before === null ? this.children.length : this.children.indexOf(before), 0, node)
      node.parentNode = this; changed(this); return node
    }
    append(node) { return this.insertBefore(node, null) }
    appendChild(node) { return this.append(node) }
    remove() {
      if (!this.parentNode) return
      const parent = this.parentNode
      parent.children.splice(parent.children.indexOf(this), 1); this.parentNode = null; changed(parent)
    }
  }
  const root = new Element('aside', 'hHd-Xa_root')
  const anchor = root.append(new Element('span'))
  const addRow = (key, label = key) => {
    const row = root.append(new Element('div', 'YDXeBa_projectRow'))
    row.setAttribute('role', 'treeitem'); row.setAttribute('data-row-key', `workspace:${key}`)
    row.append(new Element('span', 'YDXeBa_projectText')).append(new Element('span', 'YDXeBa_title')).textContent = label
    row.append(new Element('span', 'YDXeBa_rowActions'))
    return row
  }
  function flush() {
    let deliveries = 0
    while ([...observers].some(observer => observer.pending)) {
      for (const observer of observers) if (observer.pending) {
        assert.ok(++deliveries <= 20, 'badge observers must settle without a self loop')
        observer.pending = false; observer.callback()
      }
    }
    return deliveries
  }
  return { document, root, anchor, addRow, Element, observers, flush, mutations: () => mutations }
}

test('group badge marks the real workspace row at its trailing edge and reuses one marker', () => {
  const f = badgeFixture(), counts = new Map([['w1', 2]])
  const one = f.addRow('w1', 'Project'), loose = f.addRow('', 'Ungrouped'), other = f.addRow('w2', 'Other')
  const adapter = mountWorkspaceUnreadBadges(f.anchor, () => counts)
  const marker = one.children.at(-1)
  assert.equal(marker.className, 'dsa-group-unread')
  assert.equal(marker.getAttribute('role'), 'img')
  assert.equal(marker.getAttribute('aria-label'), '2 unread completed sessions')
  assert.equal(marker.getAttribute('title'), '2 unread completed sessions')
  assert.equal(marker.getAttribute('data-count'), '2')
  assert.equal(loose.children.length, 2)
  assert.equal(other.children.length, 2)
  const count = f.mutations()
  adapter.update()
  assert.equal(one.children.filter(node => node.className === 'dsa-group-unread').length, 1)
  assert.equal(f.mutations(), count, 'an unchanged marker does not touch the DOM')
  counts.set('w1', 0); adapter.update()
  assert.equal(one.children.length, 2)
  counts.set('', 1); adapter.update()
  assert.equal(loose.children.at(-1).getAttribute('aria-label'), '1 unread completed session')
  adapter.dispose()
  assert.equal(loose.children.length, 2)
  assert.ok([...f.observers].every(observer => !observer.connected))
})

test('group badge follows reordered/removed rows and strips animated clones', () => {
  const f = badgeFixture(), counts = new Map([['w1', 1]])
  const one = f.addRow('w1'), two = f.addRow('w2')
  const adapter = mountWorkspaceUnreadBadges(f.anchor, () => counts)
  f.root.append(one) // Native reorder must not leave a duplicate marker.
  f.flush()
  assert.equal(one.children.filter(node => node.className === 'dsa-group-unread').length, 1)
  const clone = new f.Element('div', 'YDXeBa_projectRow')
  clone.children = one.children.map(child => {
    const copy = new f.Element(child.tagName, child.className)
    for (const [name, value] of child.attributes) copy.attributes.set(name, value)
    copy.parentNode = clone
    return copy
  })
  f.root.append(clone)
  f.flush()
  assert.equal(clone.querySelectorAll('.dsa-group-unread').length, 0)
  two.remove(); f.flush()
  assert.equal(f.root.querySelectorAll('.dsa-group-unread').length, 1)
  adapter.dispose()
})

test('group badge stays inert on unknown layouts or missing MutationObserver', () => {
  for (const alter of [
    f => { f.root.className = 'future-root' },
    f => { f.document.defaultView.MutationObserver = undefined },
  ]) {
    const f = badgeFixture(), counts = new Map([['w1', 1]])
    alter(f); f.addRow('w1')
    const mutations = f.mutations()
    mountWorkspaceUnreadBadges(f.anchor, () => counts).dispose()
    assert.equal(f.observers.size, 0)
    assert.equal(f.mutations(), mutations)
    assert.equal(f.root.querySelectorAll('.dsa-group-unread').length, 0)
  }
  const adapter = mountWorkspaceUnreadBadges(null, () => new Map())
  adapter.update(); adapter.dispose()
})
// Minimal React hook harness: state batches until render, effects respect
// dependencies, and cleanup runs on rerender/unmount.
function hooksHarness() {
  const cells = [], pendingEffects = new Set()
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
          if (!active) return
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
      assert.ok(++commits <= 20, 'notification effects must settle')
      dirty = false; cursor = 0
      tree = component(props)
      const effects = [...pendingEffects]; pendingEffects.clear()
      for (const index of effects) {
        const cell = cells[index]
        cell.cleanup?.(); cell.cleanup = cell.setup()
      }
    } while (dirty)
    return tree
  }
  return {
    react, render,
    mount(Component, injected) { active = true; component = Component; props = injected; return render() },
    update(next) { props = { ...props, ...next }; return render() },
    unmount() {
      if (!active) return
      active = false
      for (const cell of cells) cell.cleanup?.()
      pendingEffects.clear(); tree = null
    },
  }
}
const allNodes = tree => {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(allNodes)
  return [tree, ...tree.children.flatMap(allNodes)]
}
const allText = tree => !tree || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree)
  : (Array.isArray(tree) ? tree : tree.children).map(allText).join(' ')
const tick = () => new Promise(resolve => setImmediate(resolve))

function notificationFixture({ visible = true, retained = 0 } = {}) {
  const hooks = hooksHarness(), registrations = [], opens = [], notifications = [], oscillators = []
  let list = { phase: 'ready', ids: ['main'], byId: { main: { id: 'main', displayTitle: 'Alpha task', running: true, retainedBy: { mainView: retained } } } }
  let statuses = new Map()
  const values = new Map()
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  class FakeNotification {
    constructor(title, options) { this.title = title; this.options = options; notifications.push(this) }
    close() { this.onclose?.() }
  }
  FakeNotification.permission = 'granted'
  FakeNotification.requestPermission = () => Promise.resolve('granted')
  class FakeAudioContext {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {} }
    createOscillator() {
      const oscillator = { type: '', frequency: { value: 0 }, connect: node => node,
        start: () => oscillators.push(oscillator.frequency.value), stop() {} }
      return oscillator
    }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: node => node } }
    resume() { this.state = 'running'; return Promise.resolve() }
    close() { this.state = 'closed'; return Promise.resolve() }
  }
  const document = {
    visibilityState: visible ? 'visible' : 'hidden', hidden: !visible, hasFocus: () => visible,
    head: { appendChild() {} }, getElementById() { return null }, createElement: () => ({ remove() {} }),
    addEventListener() {}, removeEventListener() {},
  }
  const plugin = load(hooks.react, document, {
    localStorage: storage, Notification: FakeNotification, AudioContext: FakeAudioContext,
    addEventListener() {}, removeEventListener() {}, focus() {},
  })
  plugin.apply({
    effect: setup => { setup() },
    slots: {
      inject: (name, callback) => callback(),
      spec: () => false,
      subscribe: () => () => {},
      register: (spec, component) => { const registration = { spec, component }; registrations.push(registration); return () => {} },
    },
    uiWorkspace: { openSession: id => opens.push(id) },
    sessions: {},
  })
  const registration = registrations.find(({ spec }) => spec.id === '@yiliang114/dsh-session-deck.notifications')
  assert.ok(registration, 'notification center is registered in the shell overlay')
  hooks.mount(registration.component, {
    useSessions: () => list,
    useSessionStatus: () => statuses,
    useWorkspaces: () => ({ phase: 'ready', items: [{ workspaceId: 'w1', title: 'Work', sessionIds: ['main'] }], archivedSessionIds: [] }),
    usePanelInfo: () => ({ activePanelId: null }),
  })
  return {
    ...hooks, registration, opens, notifications, oscillators, document,
    setIdle(nextStatuses = new Map()) {
      list = { ...list, byId: { ...list.byId, main: { ...list.byId.main, running: false } } }
      statuses = nextStatuses
      return hooks.update({ useSessions: () => list, useSessionStatus: () => statuses })
    },
  }
}

test('visible completion plays a short cue and does not leave a toast', async t => {
  const f = notificationFixture()
  t.after(() => f.unmount())
  f.setIdle()
  await tick()
  assert.equal(f.oscillators.length, 2, 'two-note completion cue')
  assert.deepEqual(f.oscillators, [880, 1174.66])
  assert.equal(f.notifications.length, 0)
  assert.equal(f.render(), null)
})

test('hidden completion uses one system notification and keeps click navigation', async t => {
  const f = notificationFixture({ visible: false })
  t.after(() => f.unmount())
  f.setIdle()
  await tick()
  f.render()
  assert.equal(f.notifications.length, 1)
  assert.equal(f.notifications[0].title, 'Session finished')
  assert.equal(f.notifications[0].options.body, 'Alpha task')
  assert.equal(f.notifications[0].options.silent, false, 'the platform supplies the hidden-page sound')
  assert.equal(f.oscillators.length, 0, 'no duplicate in-app cue')
  f.notifications[0].onclick()
  assert.deepEqual(f.opens, ['main'])
})

test('a completion already viewed in the foreground does not notify', async t => {
  const f = notificationFixture({ retained: 1 })
  t.after(() => f.unmount())
  f.setIdle()
  await tick()
  f.render()
  assert.equal(f.notifications.length, 0)
  assert.equal(f.oscillators.length, 0)
  assert.equal(f.render(), null)
})

test('notification delivery dedupes the same completion across ledger instances', async () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  const ledger = createDeliveryLedger(storage)
  assert.equal(await ledger.claim('main', 1), true)
  assert.equal(await ledger.claim('main', 1), false)
  const second = createDeliveryLedger(storage)
  assert.equal(await second.claim('main', 1), false)
  assert.equal(await second.claim('main', 2), true)
})
