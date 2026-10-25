import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
function load(react, storage) {
  let plugin
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: { load: entry => { plugin = entry.factory(name => name === 'react' ? react : {}) } },
      localStorage: storage, addEventListener() {}, removeEventListener() {},
    },
    document: { head: { appendChild() {} }, getElementById() { return null }, createElement: () => ({ remove() {} }) },
    setTimeout, clearTimeout, setInterval, clearInterval,
  })
  return plugin
}

// Separate hook cells preserve Activity and SessionRow state across rerenders.
function hooksHarness() {
  const cells = [], pendingEffects = new Set()
  let cursor = 0, dirty = false, active = false, component, props
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
    useEffect: effect, useLayoutEffect: effect,
    useSyncExternalStore: (subscribe, snapshot) => snapshot(),
  }
  function render() {
    assert.ok(active, 'component must be mounted')
    let commits = 0, tree
    do {
      assert.ok(++commits <= 20, 'effects must settle')
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
    react,
    mount(Component, injected) { active = true; component = Component; props = injected; return render() },
    update(next) { props = { ...props, ...next }; return render() },
    unmount() { active = false; for (const cell of cells) cell.cleanup?.(); pendingEffects.clear() },
  }
}
const allNodes = tree => !tree || typeof tree !== 'object' ? []
  : Array.isArray(tree) ? tree.flatMap(allNodes) : [tree, ...tree.children.flatMap(allNodes)]
const allText = tree => !tree || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree)
  : (Array.isArray(tree) ? tree : tree.children).map(allText).join(' ')
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}

function rowFixture(openSession, initialMode = 'activity') {
  const activityHooks = hooksHarness(), rowHooks = hooksHarness(), registrations = [], cleanups = [], opens = []
  let activeHooks = activityHooks, mounted = false
  const react = { ...activityHooks.react }
  for (const key of ['useState', 'useRef', 'useEffect', 'useLayoutEffect', 'useSyncExternalStore']) {
    react[key] = (...args) => activeHooks.react[key](...args)
  }
  const modeKey = 'dsh-session-activity.mode.v1', pendingKey = 'dsh-session-activity.pending.v1'
  const unread = { running: false, pending: true, seeded: true, revision: 1 }
  const values = new Map([[modeKey, initialMode], [pendingKey, JSON.stringify({ main: unread })]])
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  const plugin = load(react, storage)
  plugin.apply({
    effect: setup => { cleanups.push(setup()) },
    slots: {
      inject: (name, callback) => callback(), spec: () => false, subscribe: () => () => {},
      register: (spec, component) => { registrations.push({ spec, component }); return () => {} },
    },
    uiWorkspace: { openSession: id => { opens.push(id); return openSession(id) } },
    sessions: {},
  })
  const activity = registrations.find(({ component }) => component.name === 'Activity')
  assert.ok(activity, 'Activity is registered by the plugin')
  const props = {
    wide: true,
    useSessions: () => ({ phase: 'ready', ids: ['main'], byId: { main: { id: 'main', displayTitle: 'Alpha task', running: false, updatedAt: 1 } } }),
    useSessionStatus: () => new Map(),
    useWorkspaces: () => ({ phase: 'ready', items: [{ workspaceId: 'w1', title: 'Work', sessionIds: ['main'] }], archivedSessionIds: [], pinnedSessionIds: ['main'] }),
  }
  function render() {
    activeHooks = activityHooks
    const tree = mounted ? activityHooks.update(props) : activityHooks.mount(activity.component, props)
    const row = allNodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'SessionRow')
    assert.ok(row, 'Activity renders the real SessionRow')
    activeHooks = rowHooks
    const rendered = mounted ? rowHooks.update(row.props) : rowHooks.mount(row.type, row.props)
    mounted = true
    return rendered
  }
  return {
    render, opens,
    mode: () => values.get(modeKey),
    pending: () => JSON.parse(values.get(pendingKey)).main,
    unmount() { rowHooks.unmount(); activityHooks.unmount(); cleanups.forEach(fn => fn?.()) },
  }
}
const rowButton = tree => allNodes(tree).find(node => node.props.className === 'dsa-row')
const workspaceItem = tree => allNodes(tree).find(node => node.props.onSelect && allText(node) === 'Open in workspace for all actions')
const errorDialog = tree => allNodes(tree).find(node => node.props.open && node.props.title === 'Action failed')
const hasUnread = tree => allNodes(tree).some(node => node.props['aria-label'] === 'Unread')

for (const action of ['row', 'workspace']) {
  for (const failure of ['synchronous throw', 'promise rejection']) {
    test(`${action} open reports ${failure}, preserves unread and mode, and allows retry`, async t => {
      let shouldFail = true
      const f = rowFixture(() => {
        if (!shouldFail) return Promise.resolve()
        const error = new Error('Session could not be opened')
        if (failure === 'synchronous throw') throw error
        return Promise.reject(error)
      }, 'favorites')
      t.after(() => f.unmount())
      const invoke = tree => action === 'row' ? rowButton(tree).props.onClick() : workspaceItem(tree).props.onSelect()
      const before = f.pending()
      assert.equal(hasUnread(f.render()), true)
      invoke(f.render())
      await tick()
      let tree = f.render()
      const dialog = errorDialog(tree)
      assert.ok(dialog, 'failure opens the Action failed dialog')
      assert.match(allText(dialog), /Session could not be opened/)
      assert.ok(allNodes(dialog).some(node => node.props.role === 'alert'))
      assert.equal(f.mode(), 'favorites')
      assert.deepEqual(f.pending(), before, 'failed navigation must not acknowledge pending output')
      assert.equal(hasUnread(tree), true)
      dialog.props.onClose()
      tree = f.render()
      assert.equal(errorDialog(tree), undefined)
      shouldFail = false
      invoke(tree)
      await tick()
      tree = f.render()
      assert.deepEqual(f.opens, ['main', 'main'])
      assert.equal(errorDialog(tree), undefined)
      assert.equal(f.pending().pending, false)
      assert.equal(hasUnread(tree), false)
      assert.equal(f.mode(), action === 'workspace' ? 'workspace' : 'favorites')
    })
  }
}

test('workspace open waits for successful navigation before switching mode and acknowledging unread', async t => {
  const gate = deferred(), f = rowFixture(() => gate.promise)
  t.after(() => f.unmount())
  workspaceItem(f.render()).props.onSelect()
  await tick()
  assert.deepEqual(f.opens, ['main'])
  assert.equal(f.mode(), 'activity')
  assert.equal(f.pending().pending, true)
  assert.equal(hasUnread(f.render()), true)
  gate.resolve()
  await tick()
  assert.equal(f.mode(), 'workspace')
  assert.equal(f.pending().pending, false)
  assert.equal(hasUnread(f.render()), false)
})

test('rapid row clicks start only one open and keep the row busy until navigation settles', async t => {
  const gate = deferred(), f = rowFixture(() => gate.promise)
  t.after(() => f.unmount())
  const click = rowButton(f.render()).props.onClick
  click()
  click()
  assert.deepEqual(f.opens, ['main'], 'same-render clicks cannot start overlapping navigation')
  assert.equal(rowButton(f.render()).props.disabled, true)
  assert.equal(f.pending().pending, true)
  gate.resolve()
  await tick()
  assert.equal(rowButton(f.render()).props.disabled, false)
  assert.equal(f.pending().pending, false)
  assert.equal(f.mode(), 'activity')
})
