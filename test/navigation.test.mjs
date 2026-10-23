import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
function load(react = {}, document = {}, events = {}) {
  let plugin
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: entry => { plugin = entry.factory(name => name === 'react' ? react : name === 'react-dom' ? { createPortal: (child, host) => ({ child, host }) } : {}) } }, addEventListener() {}, removeEventListener() {}, ...events },
    document,
  })
  return plugin
}
const { mountNavigationHost } = load().__test__

test('plugin scope disposal removes its stylesheet and storage listener', () => {
  const styles = new Set(), listeners = new Set(), disposals = []
  const document = {
    createElement: () => { const style = { remove: () => styles.delete(style) }; return style },
    getElementById: id => [...styles].find(style => style.id === id),
    head: { appendChild: style => styles.add(style) },
  }
  const plugin = load({}, document, {
    addEventListener: (name, fn) => { assert.equal(name, 'storage'); listeners.add(fn) },
    removeEventListener: (name, fn) => { assert.equal(name, 'storage'); assert.ok(listeners.delete(fn)) },
  })
  plugin.apply({ effect: setup => disposals.push(setup()), slots: { inject() {} } })
  assert.equal(styles.size, 1)
  assert.equal(listeners.size, 1)
  for (const dispose of disposals) dispose()
  assert.equal(styles.size, 0)
  assert.equal(listeners.size, 0)
})

// Deterministic direct-child MutationObserver delivery, including mutations made
// by the callback itself. A looping implementation fails the bounded flush.
function fixture() {
  const observers = new Set()
  let mutations = 0
  class Observer {
    constructor(callback) { this.callback = callback; observers.add(this) }
    observe(target, options) { this.target = target; this.options = options; this.connected = true }
    disconnect() { this.connected = false; this.pending = false }
  }
  const changed = target => {
    mutations++
    for (const observer of observers) if (observer.connected && observer.target === target) observer.pending = true
  }
  const document = { defaultView: { MutationObserver: Observer }, createElement: () => new Element() }
  class Element {
    constructor(className = '') { this.className = className; this.children = []; this.parentNode = null; this.ownerDocument = document }
    get classList() { return { contains: value => this.className.split(' ').includes(value) } }
    get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] ?? null }
    closest(selector) { return this.classList.contains(selector.slice(1)) ? this : this.parentNode?.closest(selector) ?? null }
    contains(node) { return node === this || this.children.some(child => child.contains(node)) }
    insertBefore(node, before) {
      assert.ok(before === null || this.children.includes(before))
      node.remove()
      this.children.splice(before === null ? this.children.length : this.children.indexOf(before), 0, node)
      node.parentNode = this
      changed(this)
      return node
    }
    append(node) { return this.insertBefore(node, null) }
    remove() {
      if (!this.parentNode) return
      const parent = this.parentNode
      parent.children.splice(parent.children.indexOf(this), 1)
      this.parentNode = null
      changed(parent)
    }
  }
  const root = new Element('hHd-Xa_root'), global = root.append(new Element('global'))
  const region = root.append(new Element('hHd-Xa_regionArea'))
  const footer = root.append(new Element('hHd-Xa_footArea')), anchor = footer.append(new Element())
  function flush() {
    let deliveries = 0
    while ([...observers].some(o => o.pending)) {
      assert.ok(++deliveries <= 10, 'observer must settle without a self loop')
      for (const observer of observers) if (observer.pending) { observer.pending = false; observer.callback() }
    }
    return deliveries
  }
  return { root, global, region, footer, anchor, Element, document, observers, flush, mutations: () => mutations }
}

test('places one owned host immediately before the local region; direct observer settles', () => {
  const f = fixture(), other = fixture(), published = []
  const dispose = mountNavigationHost(f.anchor, host => published.push(host))
  const host = published[0]
  assert.equal(host.className, 'dsa-navigation-host')
  assert.deepEqual(f.root.children, [f.global, host, f.region, f.footer])
  assert.equal(other.root.children.length, 3)
  const observer = [...f.observers][0]
  assert.equal(observer.target, f.root)
  assert.deepEqual(Object.keys(observer.options), ['childList'])
  assert.equal(observer.options.childList, true)
  assert.equal(f.flush(), 1)
  const mutations = f.mutations()
  observer.callback()
  assert.equal(f.mutations(), mutations)
  assert.equal(published.length, 1)
  host.append(new f.Element())
  assert.equal(f.flush(), 0, 'portal content is outside the observation scope')
  dispose()
  assert.equal(host.parentNode, null)
  assert.equal(observer.connected, false)
  assert.deepEqual(f.root.children, [f.global, f.region, f.footer])
  observer.callback() // queued delivery after disposal cannot recreate the host
  dispose()
  assert.equal(published.length, 1)
})

test('recovers removed portal and replaced region without duplicates or self loops', () => {
  const f = fixture(), published = []
  const dispose = mountNavigationHost(f.anchor, host => published.push(host))
  const host = published[0]
  f.flush()
  host.remove()
  assert.equal(f.flush(), 2)
  assert.equal(host.nextSibling, f.region)
  assert.equal(published.length, 1, 'same portal container preserves its mounted content')
  f.region.remove()
  f.flush()
  assert.equal(published.at(-1), null)
  assert.equal(host.parentNode, null)
  const replacement = new f.Element('hHd-Xa_regionArea')
  f.root.insertBefore(replacement, f.footer)
  f.flush()
  assert.equal(published.at(-1), host)
  assert.deepEqual(f.root.children, [f.global, host, replacement, f.footer])
  replacement.remove()
  const next = new f.Element('hHd-Xa_regionArea')
  f.root.insertBefore(next, f.footer)
  f.flush()
  assert.equal(host.nextSibling, next)
  assert.equal(f.root.children.filter(node => node.className === 'dsa-navigation-host').length, 1)
  dispose()
})

test('unknown, nested, ambiguous or unrelated shapes fall back without inserting or observing', () => {
  for (const alter of [
    f => { f.root.className = 'future-root' },
    f => { f.region.className = 'future-region' },
    f => { f.footer.className = 'future-footer' },
    f => { const wrapper = f.root.append(new f.Element()); wrapper.append(f.region) },
    f => { f.root.append(f.anchor) },
    f => { f.root.insertBefore(f.footer, f.region) },
    f => { f.root.append(new f.Element('hHd-Xa_regionArea')) },
    f => { f.document.defaultView.MutationObserver = undefined },
  ]) {
    const f = fixture(), published = []
    alter(f)
    const mutations = f.mutations()
    mountNavigationHost(f.anchor, host => published.push(host))()
    assert.deepEqual(published, [null])
    assert.equal(f.mutations(), mutations)
    assert.equal(f.observers.size, 0)
  }
  const published = []
  mountNavigationHost(null, host => published.push(host))()
  assert.deepEqual(published, [null])
})

test('footer detachment removes the owned host; restoration and remount remain clean', () => {
  const f = fixture(), published = []
  const dispose = mountNavigationHost(f.anchor, host => published.push(host))
  const host = published[0]
  f.footer.remove()
  f.flush()
  assert.equal(published.at(-1), null)
  assert.equal(host.parentNode, null)
  f.root.append(f.footer)
  f.flush()
  assert.equal(published.at(-1), host)
  dispose()
  const second = []
  const unmount = mountNavigationHost(f.anchor, value => second.push(value))
  f.flush()
  assert.notEqual(second[0], host)
  assert.equal(f.root.children.filter(node => node.className === 'dsa-navigation-host').length, 1)
  unmount()
  assert.ok([...f.observers].every(observer => !observer.connected))
})

test('slot preference remains live and compact buttons retain accessible full labels and observation', () => {
  const elements = (type, props, ...children) => ({ type, props, children })
  const effects = [], registrations = [], subscriptions = new Map(), disposals = []
  const plugin = load({ createElement: elements, useEffect: effect => effects.push(effect), useSyncExternalStore: (subscribe, snapshot) => snapshot() }, {
    createElement: () => ({ remove() {} }), getElementById() {}, head: { appendChild() {} },
  })
  let before = false
  plugin.apply({ effect: setup => disposals.push(setup()), slots: {
    inject: (name, callback) => disposals.push(callback()),
    spec: () => before,
    subscribe: (name, callback) => { subscriptions.set(name, callback); return () => subscriptions.delete(name) },
    register: (spec, component) => { const registration = { spec, component, active: true }; registrations.push(registration); return () => { registration.active = false } },
  } })
  assert.equal(registrations[0].spec.name, 'sidebar.footer.action')
  assert.equal(registrations[0].component.name, 'FooterNavigation')
  before = true
  subscriptions.get('sidebar.workspaces.before')()
  assert.equal(registrations[0].active, false)
  const navigation = registrations[1]
  assert.equal(navigation.spec.name, 'sidebar.workspaces.before')
  const props = { wide: false, useSessions: () => ({ phase: 'ready', ids: [], byId: {} }), useSessionStatus: () => new Map() }
  const switchElement = navigation.component(props).children[0]
  assert.equal(switchElement.props, props)
  const compact = switchElement.type(props)
  assert.deepEqual(compact.children.map(button => button.children[0]), ['W', 'A', '★'])
  assert.deepEqual(compact.children.map(button => button.props['aria-label']), ['Workspaces', 'Activity', 'Favorites'])
  assert.deepEqual(compact.children.map(button => button.props.title), ['Workspaces', 'Activity', 'Favorites'])
  assert.equal(effects.length, 1)
  effects[0]() // Existing pending observation remains callable through the switch.
  const expanded = switchElement.type({ ...props, wide: true })
  assert.deepEqual(expanded.children.map(button => button.children[0]), ['Workspaces', 'Activity', 'Favorites'])
  before = false
  subscriptions.get('sidebar.workspaces.before')()
  assert.equal(navigation.active, false)
  assert.equal(registrations[2].component.name, 'FooterNavigation')
  for (const dispose of disposals) dispose()
  assert.ok(registrations.every(registration => !registration.active))
})
