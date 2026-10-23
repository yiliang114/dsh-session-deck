import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'

let plugin
vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: entry => { plugin = entry.factory(() => ({})) } } },
})
const { selectArchived, selectActivity } = plugin.__test__
const session = (id, updatedAt = 1, more = {}) => ({ id, updatedAt, ...more })
const catalog = rows => ({ ids: rows.map(row => row.id), byId: Object.fromEntries(rows.map(row => [row.id, row])) })
const ids = rows => Array.from(rows, row => row.id)

test('archive membership comes only from the archived set, deduplicates IDs and ignores missing summaries', () => {
  const list = catalog([session('live', 100), session('archived', 2), session('retained-live', 200)])
  list.byId['retained-archive'] = session('retained-archive', 3)
  const workspaces = {
    items: [{ title: 'Project', sessionIds: ['live', 'retained-live'] }],
    pinnedSessionIds: ['live'],
    archivedSessionIds: ['archived', 'missing', 'retained-archive', 'archived'],
  }
  assert.deepEqual(ids(selectArchived(list, workspaces)), ['retained-archive', 'archived'])
  assert.deepEqual(ids(selectArchived(list, {})), [])
})

test('archive recovery includes every entry beyond the activity recent limit of twenty', () => {
  const rows = Array.from({ length: 37 }, (_, i) => session(`archive-${i}`, i))
  const list = catalog(rows)
  const workspaces = { archivedSessionIds: rows.map(row => row.id) }
  assert.deepEqual(ids(selectArchived(list, workspaces)), [...rows].reverse().map(row => row.id))
  assert.equal(selectArchived(list, workspaces, 'archive-').length, 37)
})

test('archived blanks, subagents and ordinary forks remain recoverable even outside list.ids', () => {
  const rows = [
    session('blank', 4, { blank: true }),
    session('subagent', 3, { origin: 'subagent', parentId: 'parent' }),
    session('fork', 2, { parentId: 'parent' }),
    session('parent', 1),
  ]
  const list = { ...catalog(rows), ids: ['parent'] }
  const workspaces = { archivedSessionIds: rows.map(row => row.id) }
  assert.deepEqual(ids(selectArchived(list, workspaces)), ['blank', 'subagent', 'fork', 'parent'])
  assert.equal(selectArchived(list, workspaces)[0].blank, true)
  assert.equal(selectArchived(list, workspaces)[1].origin, 'subagent')
})

test('archive titles prefer display title then title then ID; workspace labels fall back through path basenames', () => {
  const rows = [
    session('display', 6, { displayTitle: 'Visible title', title: 'Raw title', cwd: '/other/project' }),
    session('title', 5, { displayTitle: '', title: 'Original title', cwd: '/projects/unix/' }),
    session('windows', 4, { cwd: 'C:\\projects\\tools\\' }),
    session('no-path', 3),
    session('root-path', 2, { displayTitle: '', title: '', cwd: '///' }),
    session('empty-workspace', 1, { cwd: '/projects/fallback' }),
  ]
  const workspaces = {
    archivedSessionIds: rows.map(row => row.id),
    items: [
      { title: 'Named workspace', sessionIds: ['display'] },
      { title: '', sessionIds: ['empty-workspace'] },
    ],
  }
  const result = selectArchived(catalog(rows), workspaces)
  assert.deepEqual(Array.from(result, row => [row.title, row.workspace]), [
    ['Visible title', 'Named workspace'],
    ['Original title', 'unix'],
    ['windows', 'tools'],
    ['no-path', 'Ungrouped'],
    ['root-path', 'Ungrouped'],
    ['empty-workspace', 'fallback'],
  ])
  assert.equal(rows[0].title, 'Raw title', 'selection does not rewrite the native summary')
  assert.equal(rows[0].workspace, undefined)
})

test('archive search trims and matches title, workspace, full path and ID case insensitively', () => {
  const rows = [
    session('id-alpha', 3, { displayTitle: 'Fix Ärt renderer', title: 'Old hidden title', cwd: '/Users/CaseSensitive/engine' }),
    session('id-beta', 2, { title: 'Release checklist', cwd: 'C:\\Projects\\Toolbox' }),
    session('id-gamma', 1),
  ]
  const list = catalog(rows)
  const workspaces = { archivedSessionIds: rows.map(row => row.id), items: [{ title: 'Team Workspace', sessionIds: ['id-beta'] }] }
  for (const [query, expected] of [
    ['  ÄRT RENDER  ', ['id-alpha']],
    ['CHECKLIST', ['id-beta']],
    ['TEAM WORK', ['id-beta']],
    ['/users/casesensitive/', ['id-alpha']],
    ['C:\\PROJECTS\\', ['id-beta']],
    ['ID-GAMMA', ['id-gamma']],
    ['ungrouped', ['id-gamma']],
    [' \t\n ', ['id-alpha', 'id-beta', 'id-gamma']],
    ['no matching session', []],
    ['Old hidden title', []],
  ]) assert.deepEqual(ids(selectArchived(list, workspaces, query)), expected, JSON.stringify(query))
})

test('archive sorting uses newest finite timestamp then session ID with invalid timestamps treated as zero', () => {
  const rows = [
    session('tie-z', 10), session('tie-a', 10), session('newest', 20), session('negative', -5),
    session('invalid-nan', NaN), session('invalid-infinity', Infinity), session('invalid-string', '100'),
    session('invalid-missing', undefined, { updatedAt: undefined }), session('zero', 0),
  ]
  const result = selectArchived(catalog(rows), { archivedSessionIds: rows.map(row => row.id).reverse() })
  assert.deepEqual(ids(result), [
    'newest', 'tie-a', 'tie-z', 'invalid-infinity', 'invalid-missing', 'invalid-nan', 'invalid-string', 'zero', 'negative',
  ])
  assert.ok(result.filter(row => row.id.startsWith('invalid-')).every(row => row.time === 0))
})

test('restored sessions disappear from archive selection while their summaries remain available', () => {
  const list = catalog([session('restored', 2), session('still-archived', 1)])
  const before = { archivedSessionIds: ['restored', 'still-archived'] }
  const after = { ...before, archivedSessionIds: ['still-archived'] }
  assert.deepEqual(ids(selectArchived(list, before)), ['restored', 'still-archived'])
  assert.deepEqual(ids(selectArchived(list, after)), ['still-archived'])
  assert.deepEqual(ids(selectArchived(list, after, 'restored')), [])
  assert.deepEqual(ids(selectActivity(list, new Map(), after).recent), ['restored'])
  assert.equal(list.byId.restored.id, 'restored')
})
