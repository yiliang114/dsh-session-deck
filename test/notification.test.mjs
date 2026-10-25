import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
function load(react = {}, document = {}, events = {}, globals = {}) {
  let plugin
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: { load: entry => { plugin = entry.factory(name => name === 'react' ? react : {}) } },
      addEventListener() {}, removeEventListener() {}, ...events,
    },
    document, setTimeout, clearTimeout, setInterval, clearInterval, ...globals,
  })
  return plugin
}

const {
  selectWorkspaceUnread, selectFavoriteUnread, createPendingStore, observePending, createDeliveryLedger, mountWorkspaceUnreadBadges,
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

test('an unchanged stale running tab preserves a remote completion and does not notify twice', () => {
  const storage = memoryStorage(), a = createPendingStore(storage), b = createPendingStore(storage)
  const running = list([session('main', { running: true })]), idle = list([session('main')])
  a.observe(running, new Map()); b.observe(running, new Map())
  const [first] = a.observe(idle, new Map())
  b.sync()
  assert.equal(b.observe(running, new Map()).length, 0)
  assert.equal(b.getSnapshot().main.running, false)
  assert.equal(b.getSnapshot().main.pending, true)
  assert.equal(b.getSnapshot().main.revision, first.revision)
  assert.equal(b.observe(idle, new Map()).length, 0)
  b.observe(running, new Map())
  assert.equal(b.getSnapshot().main.pending, false, 'a genuine new local run still clears the prior result')
  assert.equal(b.observe(idle, new Map()).length, 1, 'a later run still creates its own completion')
})

test('an unchanged stale idle tab cannot stop another tab’s new run', () => {
  const storage = memoryStorage(), a = createPendingStore(storage), b = createPendingStore(storage)
  const running = list([session('main', { running: true })]), idle = list([session('main')])
  a.observe(idle, new Map()); b.observe(idle, new Map())
  a.observe(running, new Map())
  const revision = a.getSnapshot().main.revision
  b.sync(); b.observe(idle, new Map())
  assert.equal(b.getSnapshot().main.running, true)
  assert.equal(b.getSnapshot().main.revision, revision)
  b.observe(running, new Map())
  assert.equal(b.observe(idle, new Map()).length, 1)
})

test('a stale running tab can acknowledge a remote completion that is actually visible', () => {
  const storage = memoryStorage(), a = createPendingStore(storage), b = createPendingStore(storage)
  const running = list([session('main', { running: true })]), idle = list([session('main')])
  a.observe(running, new Map()); b.observe(running, new Map())
  a.observe(idle, new Map())
  b.sync()
  assert.equal(b.observe(running, new Map(), { canAck: () => true }).length, 0)
  assert.equal(b.getSnapshot().main.running, false)
  assert.equal(b.getSnapshot().main.pending, false)
  assert.equal(b.getSnapshot().main.seeded, true)
  a.sync()
  assert.equal(a.getSnapshot().main.pending, false, 'the visible read propagates to the completing tab')
  assert.equal(b.observe(idle, new Map()).length, 0, 'receiving the idle status cannot replay the read completion')
  b.observe(running, new Map())
  assert.equal(b.observe(idle, new Map()).length, 1, 'the next real run can still complete')
})

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

test('Favorites unread tracks only eligible pinned sessions and responds to reads and unpinning', () => {
  const sessions = list([session('pinned'), session('other'), session('archived'), session('blank', { blank: true })])
  const workspace = { ...workspaces([], ['archived']), pinnedSessionIds: ['pinned', 'archived', 'blank', 'missing'] }
  const queue = { pinned: { pending: true }, other: { pending: true }, archived: { pending: true }, blank: { pending: true }, missing: { pending: true } }
  assert.equal(selectFavoriteUnread(sessions, workspace, queue), 1)
  assert.equal(selectFavoriteUnread(sessions, { ...workspace, pinnedSessionIds: [] }, queue), 0)
  assert.equal(selectFavoriteUnread(sessions, workspace, { ...queue, pinned: { pending: false } }), 0)
  assert.equal(selectFavoriteUnread(sessions, { ...workspace, pinnedSessionIds: ['pinned', 'other'] }, queue), 2)
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

test('a followup clears the previous unread result and its next completion becomes unread again', () => {
  const queue = createPendingStore(memoryStorage())
  const running = list([session('main', { running: true })]), idle = list([session('main')])
  queue.observe(running, new Map())
  queue.observe(idle, new Map())
  assert.equal(queue.getSnapshot().main.pending, true)
  const oldRevision = queue.getSnapshot().main.revision
  assert.equal(queue.observe(running, new Map()).length, 0)
  assert.equal(queue.getSnapshot().main.pending, false, 'starting followup supersedes the old result')
  const completion = queue.observe(idle, new Map())
  assert.equal(completion.length, 1)
  assert.equal(queue.getSnapshot().main.pending, true, 'new output still needs to be read')
  assert.ok(queue.getSnapshot().main.revision > oldRevision)
})

test('legacy persisted active-and-pending state is repaired during hydration', () => {
  const storage = memoryStorage()
  storage.setItem(PENDING_KEY, JSON.stringify({ main: { running: true, pending: true, seeded: true, revision: 1 } }))
  const queue = createPendingStore(storage)
  const running = list([session('main', { running: true })])
  assert.equal(queue.observe(running, new Map()).length, 0)
  assert.equal(queue.getSnapshot().main.pending, false)
  assert.equal(JSON.parse(storage.getItem(PENDING_KEY)).main.pending, false)
  assert.equal(queue.observe(list([session('main')]), new Map()).length, 1)
  assert.equal(queue.getSnapshot().main.pending, true)
})

test('a captured read acknowledgement cannot clear a newer completion revision', () => {
  const queue = createPendingStore(memoryStorage())
  const running = list([session('main', { running: true })]), idle = list([session('main')])
  queue.observe(running, new Map()); queue.observe(idle, new Map())
  const readRevision = queue.getSnapshot().main.revision
  queue.observe(running, new Map()); queue.observe(idle, new Map())
  const newRevision = queue.getSnapshot().main.revision
  queue.acknowledge('main', readRevision)
  assert.equal(queue.getSnapshot().main.pending, true)
  assert.equal(queue.getSnapshot().main.revision, newRevision)
  queue.acknowledge('main', newRevision)
  assert.equal(queue.getSnapshot().main.pending, false)
})

test('archived sessions do not create a completion or unread record', () => {
  const queue = createPendingStore(memoryStorage())
  const running = list([session('main', { running: true })]), idle = list([session('main')])
  queue.observe(running, new Map(), { eligible: () => false })
  assert.equal(queue.observe(idle, new Map(), { eligible: () => false }).length, 0)
  assert.equal(queue.getSnapshot().main, undefined)
})

test('confirmed external archive resets a running baseline before idle restoration', () => {
  const queue = createPendingStore(memoryStorage())
  const running = list([session('main', { running: true })]), idle = list([session('main')])
  queue.observe(running, new Map())
  assert.equal(queue.observe(idle, new Map(), { archivedIds: ['main'] }).length, 0)
  assert.equal(queue.getSnapshot().main.running, false)
  assert.equal(queue.getSnapshot().main.pending, false)
  assert.equal(queue.getSnapshot().main.seeded, true)
  const unread = new Map([['main', { completionUnread: true }]])
  assert.equal(queue.observe(idle, unread).length, 0)
  assert.equal(queue.getSnapshot().main.pending, false, 'native unread cannot reseed the archived result')
  queue.observe(running, new Map())
  assert.equal(queue.observe(idle, new Map()).length, 1, 'a new run after restoration still completes')
})

test('archive cleanup includes persisted records absent from a partial directory without observation churn', () => {
  const storage = memoryStorage()
  storage.setItem(PENDING_KEY, JSON.stringify({
    archivedRun: { running: true, pending: false, seeded: false, revision: 1 },
    archivedUnread: { running: false, pending: true, seeded: true, revision: 2 },
    missingUnread: { running: false, pending: true, seeded: true, revision: 3 },
    missingRun: { running: true, pending: false, seeded: false, revision: 4 },
  }))
  let writes = 0
  const setItem = storage.setItem
  storage.setItem = (...args) => { writes++; setItem(...args) }
  const queue = createPendingStore(storage)
  let changes = 0
  queue.subscribe(() => changes++)
  const options = { archivedIds: ['archivedRun', 'archivedUnread', 'unknownArchive'] }
  assert.equal(queue.observe(list([]), new Map(), options).length, 0)
  const snapshot = queue.getSnapshot()
  for (const id of ['archivedRun', 'archivedUnread']) {
    assert.equal(snapshot[id].running, false)
    assert.equal(snapshot[id].pending, false)
    assert.equal(snapshot[id].seeded, true)
  }
  assert.equal(snapshot.unknownArchive, undefined, 'archive history does not allocate idle records')
  assert.equal(snapshot.missingUnread.pending, true, 'absence does not erase unread history')
  assert.equal(snapshot.missingRun.running, true, 'absence does not erase an unarchived baseline')
  for (let i = 0; i < 5; i++) queue.observe(list([]), new Map(), options)
  assert.equal(queue.getSnapshot(), snapshot)
  assert.equal(writes, 1)
  assert.equal(changes, 1)
  const reloaded = createPendingStore(storage)
  assert.equal(reloaded.observe(list([session('archivedRun'), session('archivedUnread')]), new Map()).length, 0)
  assert.equal(reloaded.getSnapshot().archivedRun.pending, false)
  assert.equal(reloaded.getSnapshot().archivedUnread.pending, false)
})

test('archive resets tolerate stale running snapshots after restore and still observe the next run', () => {
  for (const ownArchive of [false, true]) {
    const queue = createPendingStore(memoryStorage())
    const running = list([session('main', { running: true })]), idle = list([session('main')])
    queue.observe(running, new Map())
    if (ownArchive) queue.suppress('main')
    else queue.observe(list([]), new Map(), { archivedIds: ['main'] })
    const revision = queue.getSnapshot().main.revision
    for (let i = 0; i < 3; i++) {
      assert.equal(queue.observe(running, new Map()).length, 0)
      assert.equal(queue.getSnapshot().main.running, false)
      assert.equal(queue.getSnapshot().main.revision, revision)
    }
    assert.equal(queue.observe(idle, new Map()).length, 0)
    assert.equal(queue.getSnapshot().main.pending, false)
    queue.observe(running, new Map())
    assert.equal(queue.observe(idle, new Map()).length, 1)
    assert.equal(queue.getSnapshot().main.pending, true)
  }
})

test('an unchanged archived tab preserves another tab’s restored run and completion', () => {
  const storage = memoryStorage(), a = createPendingStore(storage), b = createPendingStore(storage)
  const running = list([session('main', { running: true })]), idle = list([session('main')])
  const archived = { archivedIds: ['main'] }
  a.observe(running, new Map()); b.observe(running, new Map())
  a.observe(list([]), new Map(), archived)
  b.observe(list([]), new Map(), archived)
  b.observe(idle, new Map(), { archivedIds: [] })
  b.observe(running, new Map(), { archivedIds: [] })
  const runRevision = b.getSnapshot().main.revision
  a.sync()
  a.observe(list([]), new Map(), archived)
  assert.equal(a.getSnapshot().main.running, true, 'unchanged membership cannot clear a newer shared run')
  assert.equal(a.getSnapshot().main.revision, runRevision)
  b.sync()
  const [completion] = b.observe(idle, new Map(), { archivedIds: [] })
  assert.ok(completion, 'the explicitly observed new run still completes')
  assert.equal(b.getSnapshot().main.pending, true)
  a.sync()
  a.observe(list([]), new Map(), archived)
  assert.equal(a.getSnapshot().main.pending, true, 'unchanged membership cannot clear a newer shared result')
  assert.equal(a.getSnapshot().main.revision, completion.revision)
})

test('observing unarchive permits a later archive to reset the shared record again', () => {
  const queue = createPendingStore(memoryStorage())
  const running = list([session('main', { running: true })]), idle = list([session('main')])
  const archived = { archivedIds: ['main'] }
  queue.observe(running, new Map())
  queue.observe(list([]), new Map(), archived)
  queue.observe(idle, new Map(), { archivedIds: [] })
  queue.observe(running, new Map())
  assert.equal(queue.observe(idle, new Map()).length, 1)
  assert.equal(queue.getSnapshot().main.pending, true)
  const revision = queue.getSnapshot().main.revision
  queue.observe(list([]), new Map(), archived)
  assert.equal(queue.getSnapshot().main.running, false)
  assert.equal(queue.getSnapshot().main.pending, false)
  assert.equal(queue.getSnapshot().main.seeded, true)
  assert.ok(queue.getSnapshot().main.revision > revision)
  assert.equal(queue.observe(idle, new Map(), { archivedIds: [] }).length, 0)
  assert.equal(queue.getSnapshot().main.pending, false)
})

test('a pending own archive that fails preserves its completion baseline', () => {
  const queue = createPendingStore(memoryStorage())
  const running = list([session('main', { running: true })]), idle = list([session('main')])
  queue.observe(running, new Map())
  const snapshot = queue.getSnapshot()
  assert.equal(queue.observe(idle, new Map(), { archivedIds: [], eligible: () => false }).length, 0)
  assert.equal(queue.getSnapshot(), snapshot, 'temporary ineligibility cannot confirm an archive')
  assert.equal(queue.observe(idle, new Map(), { archivedIds: [] }).length, 1)
  assert.equal(queue.getSnapshot().main.pending, true)
})

test('confirmed archive records become eligible for bounded retention cleanup', () => {
  const storage = memoryStorage()
  const ids = Array.from({ length: 1005 }, (_, i) => `archived-${i}`)
  storage.setItem(PENDING_KEY, JSON.stringify(Object.fromEntries(ids.map((id, i) => [id,
    { running: i % 2 === 0, pending: i % 2 !== 0, seeded: false, revision: i + 1 },
  ]))))
  const queue = createPendingStore(storage)
  assert.equal(Object.keys(queue.getSnapshot()).length, 1005)
  queue.observe(list([]), new Map(), { archivedIds: ids })
  assert.equal(Object.keys(queue.getSnapshot()).length, 1000)
  assert.ok(Object.values(queue.getSnapshot()).every(r => !r.running && !r.pending && r.seeded))
  const snapshot = queue.getSnapshot(), persisted = storage.getItem(PENDING_KEY)
  queue.observe(list([]), new Map(), { archivedIds: ids })
  assert.equal(queue.getSnapshot(), snapshot)
  assert.equal(storage.getItem(PENDING_KEY), persisted)
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

function notificationFixture({ visible = true, retained = 0, locks, permission = 'granted', audioState = 'running', resumeAudio, archiveSession = async () => {} } = {}) {
  const hooks = hooksHarness(), registrations = [], opens = [], notifications = [], oscillators = [], audioContexts = [], cleanups = []
  let activeHooks = hooks, now = Date.now()
  const react = { ...hooks.react }
  for (const key of ['useState', 'useRef', 'useEffect', 'useLayoutEffect', 'useSyncExternalStore']) react[key] = (...args) => activeHooks.react[key](...args)
  let list = { phase: 'ready', ids: ['main'], byId: { main: { id: 'main', displayTitle: 'Alpha task', running: true, retainedBy: { mainView: retained } } } }
  let statuses = new Map()
  let workspaceState = { phase: 'ready', items: [{ workspaceId: 'w1', title: 'Work', sessionIds: ['main'] }], archivedSessionIds: [] }
  const values = new Map([['dsh-session-activity.mode.v1', 'activity']]), listeners = new Map()
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  class FakeNotification {
    constructor(title, options) { this.title = title; this.options = options; notifications.push(this) }
    close() { this.onclose?.() }
  }
  FakeNotification.permission = permission
  class FakeAudioContext {
    constructor() { this.state = audioState; this.currentTime = 0; this.destination = {}; audioContexts.push(this) }
    createOscillator() {
      const oscillator = { type: '', frequency: { value: 0 }, connect: node => node,
        start: () => oscillators.push(oscillator.frequency.value), stop() {} }
      return oscillator
    }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: node => node } }
    resume() { return Promise.resolve(resumeAudio?.()).then(() => { this.state = 'running' }) }
    close() { this.state = 'closed'; return Promise.resolve() }
  }
  const document = {
    visibilityState: visible ? 'visible' : 'hidden', hidden: !visible, hasFocus: () => visible,
    head: { appendChild() {} }, getElementById() { return null }, createElement: () => ({ remove() {} }),
    addEventListener() {}, removeEventListener() {},
  }
  const plugin = load(react, document, {
    localStorage: storage, Notification: FakeNotification, AudioContext: FakeAudioContext,
    addEventListener(name, fn) { listeners.set(name, fn) }, removeEventListener(name) { listeners.delete(name) }, focus() {},
  }, { navigator: { locks }, Date: class extends Date { static now() { return now } } })
  plugin.apply({
    effect: setup => { cleanups.push(setup()) },
    slots: {
      inject: (name, callback) => callback(),
      spec: () => false,
      subscribe: () => () => {},
      register: (spec, component) => { const registration = { spec, component }; registrations.push(registration); return () => {} },
    },
    uiWorkspace: { openSession: id => opens.push(id), archiveSession },
    sessions: {},
  })
  const registration = registrations.find(({ spec }) => spec.id === '@yiliang114/dsh-session-deck.notifications')
  assert.ok(registration, 'notification center is registered in the shell overlay')
  const props = { useSessions: () => list, useSessionStatus: () => statuses, useWorkspaces: () => workspaceState, usePanelInfo: () => ({ activePanelId: null }) }
  hooks.mount(registration.component, props)
  const update = () => hooks.update(props)
  return {
    ...hooks, registration, opens, notifications, oscillators, audioContexts, document, values,
    unmount() { hooks.unmount(); cleanups.forEach(fn => fn?.()) },
    setIdle(nextStatuses = new Map()) {
      list = { ...list, byId: { ...list.byId, main: { ...list.byId.main, running: false } } }
      statuses = nextStatuses
      return update()
    },
    setSession(patch) { list = { ...list, byId: { ...list.byId, main: { ...list.byId.main, ...patch } } }; return update() },
    setWorkspaces(patch) { workspaceState = { ...workspaceState, ...patch }; return update() },
    setVisible(next) { document.visibilityState = next ? 'visible' : 'hidden'; document.hidden = !next; document.hasFocus = () => next; listeners.get(next ? 'focus' : 'blur')?.(); return update() },
    advanceTime(ms) { now += ms },
    mute() { values.set(SOUND_KEY, 'off'); listeners.get('storage')?.({ key: SOUND_KEY }); return update() },
    pending() { return JSON.parse(storage.getItem(PENDING_KEY) || '{}').main },
    archive() {
      const activity = registrations.find(({ component }) => component.name === 'Activity').component
      const activityHooks = hooksHarness(), rowHooks = hooksHarness()
      try {
        activeHooks = activityHooks
        const tree = activityHooks.mount(activity, { ...props, wide: true })
        const row = allNodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'SessionRow')
        activeHooks = rowHooks
        const rendered = rowHooks.mount(row.type, row.props)
        return allNodes(rendered).find(node => node.props.className === 'dsa-menu-trigger dsa-archive-btn').props.onClick()
      } finally { rowHooks.unmount(); activityHooks.unmount(); activeHooks = hooks }
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
  assert.equal(f.notifications[0].options.silent, true, 'the system must not stack its sound on the plugin cue')
  assert.equal(f.oscillators.length, 2, 'background delivery plays exactly one plugin cue')
  f.notifications[0].onclick()
  assert.deepEqual(f.opens, ['main'])
})

test('a completion waits for workspace hydration and delivers once membership is ready', async t => {
  const f = notificationFixture({ visible: false })
  t.after(() => f.unmount())
  await tick()
  f.setWorkspaces({ phase: 'loading' })
  f.setIdle()
  await tick()
  assert.equal(f.pending().running, true, 'loading membership cannot consume the running baseline')
  assert.equal(f.pending().pending, false)
  assert.equal(f.notifications.length, 0)
  assert.equal(f.oscillators.length, 0)
  f.setWorkspaces({ phase: 'ready' })
  await tick()
  assert.equal(f.pending().pending, true)
  assert.equal(f.notifications.length, 1)
  assert.deepEqual(f.oscillators, [880, 1174.66])
  f.render()
  await tick()
  assert.equal(f.notifications.length, 1, 'readiness rerenders cannot repeat the completion')
  assert.equal(f.oscillators.length, 2)
})

test('resolved archived membership excludes a completion deferred during workspace hydration', async t => {
  const f = notificationFixture({ visible: false })
  t.after(() => f.unmount())
  await tick()
  f.setWorkspaces({ phase: 'loading' })
  f.setIdle()
  await tick()
  assert.equal(f.pending().running, true)
  f.setWorkspaces({ phase: 'ready', archivedSessionIds: ['main'] })
  await tick()
  f.render()
  await tick()
  assert.equal(f.pending().pending, false)
  assert.equal(f.notifications.length, 0)
  assert.equal(f.oscillators.length, 0)
})

test('native or other-tab archive restoration stays silent and the next run notifies', async t => {
  const f = notificationFixture({ visible: false })
  t.after(() => f.unmount())
  await tick()
  f.setWorkspaces({ archivedSessionIds: ['main'] })
  f.setIdle(new Map([['main', { completionUnread: true }]]))
  await tick()
  assert.equal(f.pending().running, false)
  assert.equal(f.pending().pending, false)
  assert.equal(f.pending().seeded, true)
  f.setWorkspaces({ archivedSessionIds: [] })
  await tick()
  f.render()
  await tick()
  assert.equal(f.pending().pending, false)
  assert.equal(f.notifications.length, 0)
  assert.equal(f.oscillators.length, 0)
  f.setSession({ running: true })
  await tick()
  f.setIdle()
  await tick()
  assert.equal(f.pending().pending, true)
  assert.equal(f.notifications.length, 1)
  assert.equal(f.oscillators.length, 2)
})

test('hidden completion still plays the cue without notification permission', async t => {
  const f = notificationFixture({ visible: false, permission: 'default' })
  t.after(() => f.unmount())
  f.setIdle()
  await tick()
  assert.equal(f.notifications.length, 0)
  assert.deepEqual(f.oscillators, [880, 1174.66])
})

test('muted background completion keeps both notification and plugin sound silent', async t => {
  const f = notificationFixture({ visible: false })
  t.after(() => f.unmount())
  f.mute()
  f.setIdle()
  await tick()
  assert.equal(f.notifications.length, 1)
  assert.equal(f.notifications[0].options.silent, true)
  assert.equal(f.oscillators.length, 0)
})

test('native main-view selection acknowledges immediately before a delayed observation lock', async t => {
  const gate = deferred()
  let blockObservation = false
  const locks = { request(name, callback) {
    return blockObservation && name === 'dsh-session-deck.observation'
      ? gate.promise.then(callback) : Promise.resolve(callback())
  } }
  const f = notificationFixture({ locks })
  t.after(() => f.unmount())
  await tick()
  f.setIdle()
  await tick()
  assert.equal(f.pending().pending, true)
  blockObservation = true
  f.setSession({ retainedBy: { mainView: 1 } })
  assert.equal(f.pending().pending, false, 'native selection is acknowledged synchronously')
  f.setSession({ retainedBy: {} })
  gate.resolve()
  await tick()
  assert.equal(f.pending().pending, false, 'leaving before observation resumes cannot lose the read')
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


const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const delayedLock = () => {
  const operation = deferred()
  let callback
  return { request(name, fn) { if (name === 'dsh-session-deck.observation') return Promise.resolve(fn()); callback = fn; return operation.promise.then(() => callback()) }, release: () => operation.resolve() }
}

test('a pending interaction is not a completion and its eventual finish emits once', async t => {
  const f = notificationFixture()
  t.after(() => f.unmount())
  f.setIdle(new Map([['main', { running: false, pendingInteraction: { key: 'approval', kind: 'approval' }, completionUnread: true }]]))
  await tick()
  assert.equal(f.pending().pending, false)
  assert.equal(f.oscillators.length, 0)
  f.setIdle()
  await tick()
  assert.equal(f.pending().pending, true)
  assert.equal(f.oscillators.length, 2)
  f.render()
  await tick()
  assert.equal(f.oscillators.length, 2)
})

test('a parent waits for a stopped child that still needs interaction', () => {
  const pending = createPendingStore()
  const sessions = list([session('main', { running: true }), session('child', { origin: 'subagent', parentId: 'main', running: true })])
  pending.observe(sessions, new Map())
  for (const s of Object.values(sessions.byId)) s.running = false
  assert.equal(pending.observe(sessions, new Map([['child', { running: false, pendingInteraction: { key: 'question' } }]])).length, 0)
  assert.equal(pending.getSnapshot().main.pending, false)
  assert.equal(pending.observe(sessions, new Map()).length, 1)
  assert.equal(pending.getSnapshot().main.pending, true)
})

for (const reason of ['read', 'archived', 'restarted', 'waiting', 'unmounted']) {
  test(`a delayed delivery is cancelled after the session is ${reason}`, async t => {
    const lock = delayedLock(), f = notificationFixture({ visible: false, locks: lock })
    t.after(() => f.unmount())
    f.setIdle()
    if (reason === 'read') { f.setVisible(true); f.setSession({ retainedBy: { mainView: 1 } }) }
    if (reason === 'archived') f.setWorkspaces({ archivedSessionIds: ['main'] })
    if (reason === 'restarted') f.setSession({ running: true })
    if (reason === 'waiting') f.setIdle(new Map([['main', { running: false, pendingInteraction: { key: 'question' } }]]))
    if (reason === 'unmounted') f.unmount()
    lock.release()
    await tick()
    assert.equal(f.notifications.length, 0)
    assert.equal(f.oscillators.length, 0)
  })
}

test('a delayed delivery uses the current focus and sound preference', async t => {
  const lock = delayedLock(), f = notificationFixture({ visible: false, locks: lock })
  t.after(() => f.unmount())
  f.setIdle()
  f.setVisible(true)
  f.mute()
  lock.release()
  await tick()
  assert.equal(f.notifications.length, 0)
  assert.equal(f.oscillators.length, 0)
  assert.equal(f.pending().pending, true)
})

test('our archive request suppresses its stop before membership updates and permits later runs', async t => {
  const operation = deferred(), f = notificationFixture({ archiveSession: () => operation.promise })
  t.after(() => f.unmount())
  const archive = f.archive()
  f.setIdle()
  await tick()
  assert.equal(f.notifications.length, 0)
  assert.equal(f.oscillators.length, 0)
  operation.resolve()
  await archive
  assert.equal(f.pending().pending, false)
  assert.equal(f.pending().running, false)
  f.setWorkspaces({ archivedSessionIds: ['main'] })
  f.setWorkspaces({ archivedSessionIds: [] })
  await tick()
  assert.equal(f.oscillators.length, 0, 'restoring never replays the archive stop')
  f.setSession({ running: true })
  f.setIdle()
  await tick()
  assert.equal(f.oscillators.length, 2, 'a new run after restore still notifies')
})

test('a failed archive does not suppress subsequent completion', async t => {
  const f = notificationFixture({ archiveSession: () => Promise.reject(Error('archive failed')) })
  t.after(() => f.unmount())
  await f.archive()
  f.setIdle()
  await tick()
  assert.equal(f.oscillators.length, 2)
  assert.equal(f.pending().pending, true)
})

test('a denied audio resume settles without an unhandled rejection or queued cue', async t => {
  const f = notificationFixture({ permission: 'default', audioState: 'suspended', resumeAudio: () => Promise.reject(Error('autoplay blocked')) })
  t.after(() => f.unmount())
  f.setIdle()
  await tick()
  assert.equal(f.oscillators.length, 0)
  assert.equal(f.pending().pending, true)
})

test('reading a result during a suspended audio resume cancels the later cue', async t => {
  const resume = deferred(), f = notificationFixture({ audioState: 'suspended', resumeAudio: () => resume.promise })
  t.after(() => f.unmount())
  f.setIdle()
  await tick()
  f.setSession({ retainedBy: { mainView: 1 } })
  resume.resolve()
  await tick()
  assert.equal(f.oscillators.length, 0)
  assert.equal(f.pending().pending, false)
})

test('a closed audio context is recreated for a later completion', async t => {
  const f = notificationFixture()
  t.after(() => f.unmount())
  f.setIdle()
  await tick()
  assert.equal(f.audioContexts.length, 1)
  f.audioContexts[0].state = 'closed'
  f.advanceTime(500)
  f.setSession({ running: true })
  f.setIdle()
  await tick()
  assert.equal(f.audioContexts.length, 2)
  assert.equal(f.oscillators.length, 4)
})


test('two independent tab observers serialize one physical completion and preserve its delivery revision', async () => {
  const storage = memoryStorage(), a = createPendingStore(storage), b = createPendingStore(storage)
  let tail = Promise.resolve()
  const locks = { request(name, callback) { const next = tail.then(callback); tail = next.catch(() => {}); return next } }
  const running = list([session('main', { running: true })]), idle = list([session('main')])
  const snapshot = value => () => ({ list: value, statuses: new Map() })
  await Promise.all([observePending(a, snapshot(running), locks), observePending(b, snapshot(running), locks)])
  const events = (await Promise.all([observePending(a, snapshot(idle), locks), observePending(b, snapshot(idle), locks)])).flat()
  assert.equal(events.length, 1, 'one physical stop generates one event across tabs')
  const record = JSON.parse(storage.getItem(PENDING_KEY)).main
  assert.equal(record.revision, events[0].revision, 'follower must not invalidate the genuine delivery revision')
  assert.equal(record.pending, true)
  const ledgers = [createDeliveryLedger(storage, locks), createDeliveryLedger(storage, locks)]
  const claims = await Promise.all(ledgers.map(ledger => ledger.claim(events[0].id, events[0].revision)))
  assert.equal(claims.filter(Boolean).length, 1)
  await Promise.all([observePending(a, snapshot(running), locks), observePending(b, snapshot(running), locks)])
  const nextRun = (await Promise.all([observePending(a, snapshot(idle), locks), observePending(b, snapshot(idle), locks)])).flat()
  assert.equal(nextRun.length, 1)
  assert.ok(nextRun[0].revision > events[0].revision)
  assert.equal(await ledgers[0].claim(nextRun[0].id, nextRun[0].revision), true, 'next physical run still delivers')
})

test('queued observation reads the latest session and acknowledgement state inside its lock', async () => {
  const pending = createPendingStore(memoryStorage())
  const running = list([session('main', { running: true })]), idle = list([session('main')])
  await observePending(pending, () => ({ list: running, statuses: new Map() }))
  const operation = deferred()
  const locks = { request(name, callback) { return operation.promise.then(callback) } }
  let current = { list: idle, statuses: new Map(), options: { canAck: () => false } }
  const queued = observePending(pending, () => current, locks)
  current = { list: idle, statuses: new Map(), options: { canAck: () => true } }
  operation.resolve()
  const events = await queued
  assert.equal(events.length, 1)
  assert.equal(events[0].read, true, 'latest visibility/current-session state decides acknowledgement')
  assert.equal(pending.getSnapshot().main.pending, false)
})
