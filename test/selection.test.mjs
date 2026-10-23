import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'
let plugin
vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: entry => { plugin = entry.factory(name => { assert.ok(['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'].includes(name)); return {} }) } } },
})
const { selectActivity, createModeStore, createPendingStore, ago, KEY, PENDING_KEY, MAX_RECORDS } = plugin.__test__
const session = (id, updatedAt, more = {}) => ({ id, updatedAt, displayTitle: id, running: false, ...more })
const list = rows => ({ ids: rows.map(s => s.id), byId: Object.fromEntries(rows.map(s => [s.id, s])) })
test('relative times use compact English labels at unit boundaries', () => {
  const now = 10 * 86400000
  assert.equal(ago(0, now), '')
  for (const [minutes, expected] of [[-1, 'Just now'], [0, 'Just now'], [1, '1m ago'], [59, '59m ago'], [60, '1h ago'], [1439, '23h ago'], [1440, '1d ago'], [2880, '2d ago']]) {
    assert.equal(ago(now - minutes * 60000, now), expected)
  }
})
test('workspace labels preserve titles and path basenames before falling back to English', () => {
  const rows = [session('named', 4, { cwd: '/projects/other' }), session('unix', 3, { cwd: '/projects/app/' }), session('windows', 2, { cwd: 'C:\\projects\\tools\\' }), session('none', 1)]
  const result = selectActivity(list(rows), new Map(), { items: [{ title: 'My workspace', sessionIds: ['named'] }] })
  assert.equal(result.recent.map(s => s.workspace).join(','), 'My workspace,app,tools,Ungrouped')
})
test('excludes archived, subagents and blank but preserves ordinary forks', () => {
  const rows = [session('normal', 5), session('fork', 4, { parentId: 'normal' }), session('child', 9, { origin: 'subagent' }), session('archived', 10, { running: true }), session('blank', 11, { blank: true })]
  const result = selectActivity(list(rows), new Map(), { items: [{ title: 'Project', sessionIds: ['fork'] }], archivedSessionIds: ['archived'] })
  assert.equal(result.active.length, 0)
  assert.equal(result.recent.map(s => s.id).join(','), 'normal,fork')
  assert.equal(result.recent[1].workspace, 'Project')
})
test('keeps older action-needed sessions beyond recent limit and honors live status false', () => {
  const rows = Array.from({ length: 25 }, (_, i) => session(`recent${i}`, 100 + i))
  rows.push(session('old-running', 1, { running: true }), session('waiting', 2), session('unread', 3), session('stopped', 999, { running: true }))
  const statuses = new Map([['waiting', { running: false, pendingInteraction: {} }], ['unread', { completionUnread: true }], ['stopped', { running: false }]])
  const result = selectActivity(list(rows), statuses, { items: [] }, 20, { unread: { pending: true } })
  assert.equal(result.recent.length, 20)
  assert.equal(result.recent[0].id, 'stopped')
  assert.equal(result.active.map(s => `${s.id}:${s.kind}`).join(','), 'unread:pending,waiting:waiting,old-running:running')
})
test('tie ordering stable and invalid timestamps do not corrupt ordering', () => {
  const result = selectActivity(list([session('b', 5), session('a', 5), session('invalid', NaN)]), new Map(), {})
  assert.equal(result.recent.map(s => s.id).join(','), 'a,b,invalid')
})
test('mode survives reload, invalid values normalize, denied storage still permits switching', () => {
  const values = new Map([[KEY, 'activity']])
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  const store = createModeStore(storage)
  assert.equal(store.getSnapshot(), 'activity')
  let notifications = 0
  const stop = store.subscribe(() => notifications++)
  store.set('workspace')
  store.set('workspace')
  assert.equal(notifications, 1)
  assert.equal(createModeStore(storage).getSnapshot(), 'workspace')
  stop()
  store.set('activity')
  assert.equal(notifications, 1)
  store.set('favorites')
  assert.equal(createModeStore(storage).getSnapshot(), 'favorites')
  const denied = createModeStore({ getItem() { throw Error('denied') }, setItem() { throw Error('denied') } })
  denied.set('activity')
  assert.equal(denied.getSnapshot(), 'activity')
  denied.set('garbage')
  assert.equal(denied.getSnapshot(), 'workspace')
})

const memoryStorage = () => {
  const data = new Map()
  return { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }
}
const snapshot = (running, extra = {}) => ({ ...list([session('main', 123, { running, retainedBy: { mainView: 0 }, ...extra })]), phase: 'ready' })
const viewing = { retainedBy: { mainView: 1 } }

test('unseen completion becomes unread; viewing the session marks it read persistently (Codex-style)', () => {
  const storage = memoryStorage()
  let queue = createPendingStore(storage)
  queue.observe(snapshot(true), new Map())
  queue.observe(snapshot(false), new Map())
  assert.equal(queue.getSnapshot().main.pending, true)
  assert.equal(selectActivity(snapshot(false), new Map(), {}, 20, queue.getSnapshot()).active[0].kind, 'pending')
  // Viewing acks without manual handling and persists across reload.
  queue.observe(snapshot(false, viewing), new Map())
  assert.equal(queue.getSnapshot().main.pending, false)
  queue = createPendingStore(storage)
  queue.observe(snapshot(false), new Map())
  assert.equal(queue.getSnapshot().main.pending, false)
  assert.equal(selectActivity(snapshot(false), new Map(), {}, 20, queue.getSnapshot()).recent[0].id, 'main')
  // A completion while watching never creates an unread mark.
  queue.observe(snapshot(true, viewing), new Map())
  queue.observe(snapshot(false, viewing), new Map())
  assert.equal(queue.getSnapshot().main.pending, false)
  // A later unseen run becomes unread again.
  queue.observe(snapshot(true), new Map())
  queue.observe(snapshot(false), new Map())
  assert.equal(queue.getSnapshot().main.pending, true)
})

test('saved running baseline captures a stop during reload but ignores loading placeholders', () => {
  const storage = memoryStorage()
  createPendingStore(storage).observe(snapshot(true), new Map())
  const queue = createPendingStore(storage)
  queue.observe({ ...snapshot(false), phase: 'loading' }, new Map())
  assert.equal(queue.getSnapshot().main.pending, false)
  queue.observe(snapshot(undefined), new Map())
  assert.equal(queue.getSnapshot().main.pending, false)
  queue.observe(snapshot(false), new Map())
  assert.equal(queue.getSnapshot().main.pending, true)
})

test('initial idle history is not pending and native unread seeds only once after acknowledgement', () => {
  const storage = memoryStorage()
  let queue = createPendingStore(storage)
  queue.observe(snapshot(false), new Map())
  assert.equal(Object.keys(queue.getSnapshot()).length, 0)
  const unread = new Map([['main', { completionUnread: true }]])
  queue.observe(snapshot(false), unread)
  assert.equal(queue.getSnapshot().main.pending, true)
  queue.acknowledge('main')
  queue = createPendingStore(storage)
  queue.observe(snapshot(false), unread)
  queue.observe(snapshot(false), new Map())
  queue.observe(snapshot(false), unread)
  assert.equal(queue.getSnapshot().main.pending, false)
  queue.observe(snapshot(true), unread)
  queue.observe(snapshot(false), unread)
  assert.equal(queue.getSnapshot().main.pending, true)
})

test('running and native waiting cannot be hidden by handling a previous completion', () => {
  const queue = createPendingStore(memoryStorage())
  queue.observe(snapshot(true), new Map())
  queue.observe(snapshot(false), new Map())
  const statuses = new Map([['main', { running: true, pendingInteraction: {} }]])
  assert.equal(selectActivity(snapshot(false), statuses, {}, 20, queue.getSnapshot()).active[0].kind, 'waiting')
  queue.acknowledge('main')
  statuses.set('main', { running: false, pendingInteraction: {} })
  assert.equal(selectActivity(snapshot(false), statuses, {}, 20, queue.getSnapshot()).active[0].kind, 'waiting')
})

test('cross-tab acknowledgement is not resurrected by unchanged native unread or running snapshot', () => {
  const storage = memoryStorage(), a = createPendingStore(storage), b = createPendingStore(storage)
  const unread = new Map([['main', { completionUnread: true }]])
  a.observe(snapshot(true), new Map())
  b.observe(snapshot(true), new Map())
  a.observe(snapshot(false), unread)
  b.observe(snapshot(false), unread)
  a.acknowledge('main')
  b.sync()
  b.observe(snapshot(false), unread)
  assert.equal(b.getSnapshot().main.pending, false)
  b.observe(snapshot(true), unread)
  b.observe(snapshot(false), unread)
  a.sync()
  assert.equal(a.getSnapshot().main.pending, true)
})

test('denied and corrupt storage keep a functioning in-memory queue; old handled metadata is bounded', () => {
  for (const storage of [{ getItem() { return '{broken' }, setItem() {} }, { getItem() { throw Error('denied') }, setItem() { throw Error('denied') } }]) {
    const queue = createPendingStore(storage)
    queue.observe(snapshot(true), new Map())
    queue.observe(snapshot(false), new Map())
    assert.equal(queue.getSnapshot().main.pending, true)
    queue.acknowledge('main')
    assert.equal(queue.getSnapshot().main.pending, false)
  }
  const storage = memoryStorage()
  const records = Object.fromEntries(Array.from({ length: MAX_RECORDS + 10 }, (_, i) => [String(i), { running: false, pending: i === 0, seeded: true, revision: i }]))
  storage.setItem(PENDING_KEY, JSON.stringify(records))
  const restored = createPendingStore(storage).getSnapshot()
  assert.equal(Object.keys(restored).length, MAX_RECORDS + 1)
  assert.equal(restored['0'].pending, true)
})

test('pending entries are never evicted by the handled metadata bound', () => {
  const storage = memoryStorage()
  const records = Object.fromEntries(Array.from({ length: MAX_RECORDS + 10 }, (_, i) => [String(i), { running: false, pending: true, seeded: true, revision: i }]))
  storage.setItem(PENDING_KEY, JSON.stringify(records))
  assert.equal(Object.keys(createPendingStore(storage).getSnapshot()).length, MAX_RECORDS + 10)
})

test('a delayed tab cannot requeue a completion already acknowledged in another tab', () => {
  const storage = memoryStorage(), a = createPendingStore(storage), b = createPendingStore(storage)
  a.observe(snapshot(true), new Map())
  b.observe(snapshot(true), new Map())
  a.observe(snapshot(false), new Map())
  a.acknowledge('main')
  b.observe(snapshot(false), new Map())
  assert.equal(b.getSnapshot().main.pending, false)
})

// Pin IDs are produced by the native workspace controller, not a plugin-local list.
test('favorites aggregate native pins across workspaces beyond recent limit and stay independent of pending', () => {
  const rows = Array.from({length: 25}, (_, i) => session(`s${i}`, i))
  rows.push(session('archived', 100), session('child', 101, {origin: 'subagent'}))
  const workspaces = { items: [{title:'A',sessionIds:['s0']},{title:'B',sessionIds:['s24']}], pinnedSessionIds:['s0','s24','archived','child'], archivedSessionIds:['archived'] }
  const result = selectActivity(list(rows), new Map(), workspaces, 20, {s0:{pending:true}})
  assert.equal(result.favorites.map(s=>s.id).join(','), 's24,s0')
  assert.equal(result.favorites.map(s=>s.workspace).join(','), 'B,A')
  assert.equal(result.favorites[1].kind, 'pending')
  const handled = selectActivity(list(rows), new Map(), workspaces)
  assert.equal(handled.favorites.map(s=>s.id).join(','), 's24,s0')
  assert.equal(handled.favorites[1].kind, 'recent')
  workspaces.pinnedSessionIds = ['s24']
  assert.equal(selectActivity(list(rows), new Map(), workspaces).favorites.map(s=>s.id).join(','), 's24')
})


test('running descendants in byId activate ancestors and favorites, but ordinary forks do not', () => {
  const catalog = list([session('main', 1, { running: true }), session('fork', 2, { parentId: 'main' }), session('other', 3)])
  // Retained subagents can precede Host-list membership (absent from ids).
  catalog.byId.child = session('child', 4, { origin: 'subagent', parentId: 'main' })
  catalog.byId.leaf = session('leaf', 5, { origin: 'subagent', parentId: 'child', running: true })
  const statuses = new Map([['main', { running: false }]])
  const workspaces = { pinnedSessionIds: ['main'], archivedSessionIds: ['child'] }
  let result = selectActivity(catalog, statuses, workspaces, 0)
  assert.equal(result.active.map(s => `${s.id}:${s.kind}`).join(','), 'main:running')
  assert.equal(result.favorites[0].kind, 'running')
  statuses.set('leaf', { running: false })
  statuses.set('fork', { running: true })
  result = selectActivity(catalog, statuses, workspaces, 0)
  assert.equal(result.active.map(s => s.id).join(','), 'fork')
  assert.equal(result.favorites[0].kind, 'recent')
  // A fork's subagent activates the fork, never the fork's source.
  catalog.byId.leaf.parentId = 'fork'
  statuses.set('leaf', { running: true })
  statuses.set('fork', { running: false })
  result = selectActivity(catalog, statuses, workspaces, 0)
  assert.equal(result.active.map(s => s.id).join(','), 'fork')
  statuses.set('fork', { running: false, pendingInteraction: {} })
  assert.equal(selectActivity(catalog, statuses, workspaces).active[0].kind, 'waiting')
})

test('parent completion waits for the last descendant, across reload and native unread signals', () => {
  const storage = memoryStorage()
  let queue = createPendingStore(storage)
  const catalog = { ...list([session('main', 1, { running: true })]), phase: 'ready' }
  catalog.byId.child = session('child', 2, { origin: 'subagent', parentId: 'main', running: true })
  catalog.byId.leaf = session('leaf', 3, { origin: 'subagent', parentId: 'child' })
  queue.observe(catalog, new Map())
  const statuses = new Map([['main', { running: false, completionUnread: true }], ['leaf', { running: true }]])
  queue.observe(catalog, statuses)
  assert.equal(queue.getSnapshot().main.running, true)
  assert.equal(queue.getSnapshot().main.pending, false)
  queue = createPendingStore(storage)
  statuses.set('child', { running: false })
  queue.observe(catalog, statuses)
  assert.equal(queue.getSnapshot().main.pending, false)
  statuses.set('leaf', { running: false })
  queue.observe(catalog, statuses)
  assert.equal(queue.getSnapshot().main.running, false)
  assert.equal(queue.getSnapshot().main.pending, true)
  assert.equal(selectActivity(catalog, statuses, {}, 20, queue.getSnapshot()).active[0].kind, 'pending')
  assert.equal(Object.keys(queue.getSnapshot()).join(','), 'main')
  catalog.byId.main.retainedBy = { mainView: 1 }
  queue.observe(catalog, statuses)
  assert.equal(queue.getSnapshot().main.pending, false)
  statuses.set('child', { running: true })
  queue.observe(catalog, statuses)
  statuses.set('child', { running: false })
  queue.observe(catalog, statuses)
  assert.equal(queue.getSnapshot().main.pending, false)
})
