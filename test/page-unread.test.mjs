import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'

// Extract the shipped declaration rather than testing a separate implementation.
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('    function mountPageUnread(')
assert.notEqual(start, -1, 'insert .dsh/page-unread-helper.txt into the client factory')
const end = source.indexOf('\n    }\n', start)
assert.notEqual(end, -1)
const mountPageUnread = vm.runInNewContext(`(${source.slice(start, end + 6).trim()})`)

function fixture({ favicon = true, canvas = true, tainted = false } = {}) {
  let title = '(7) Host', writes = 0, serial = 0
  const observers = [], images = [], draws = [], relWrites = []
  let originalRel = 'shortcut icon', renderedIcon = 'https://host.example/original.ico'
  const original = { href: 'https://host.example/original.ico',
    get rel() { return originalRel },
    set rel(value) { originalRel = value; relWrites.push(value); if (value.includes('icon')) renderedIcon = original.href },
  }
  const children = favicon ? [original] : []
  const head = {
    appendChild(node) { children.push(node); node.parentNode = head; renderedIcon = node.href },
    removeChild(node) { children.splice(children.indexOf(node), 1); node.parentNode = null },
  }
  if (favicon) original.parentNode = head
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe() { this.connected = true }
    disconnect() { this.connected = false }
  }
  class Image {
    constructor() { images.push(this) }
    set src(value) { this.url = value }
  }
  const doc = {
    head, defaultView: { MutationObserver: Observer, Image },
    get title() { return title },
    set title(value) { writes++; title = value },
    querySelectorAll() { return children },
    createElement(tag) {
      if (tag === 'link') return {}
      assert.equal(tag, 'canvas')
      let usedImage = false
      const context = {
        drawImage(image, ...coords) { usedImage = true; draws.push(['image', image, ...coords]) },
        fillRect(...args) { draws.push(['fallback', ...args]) },
        beginPath() {},
        arc(...args) { draws.push(['dot', ...args]) },
        fill() { draws.push(['fill', this.fillStyle]) },
      }
      return {
        getContext() { return canvas ? context : null },
        toDataURL(type) {
          assert.equal(type, 'image/png')
          if (tainted && usedImage) throw Error('tainted')
          return `data:image/png;base64,${++serial}`
        },
      }
    },
  }
  const flush = () => observers.filter(o => o.connected).forEach(o => o.callback([]))
  return { doc, original, children, images, draws, observers, flush, writes: () => writes, relWrites, renderedIcon: () => renderedIcon }
}

test('counts preserve host prefixes and follow live host titles without observer feedback', () => {
  const f = fixture(), page = mountPageUnread(f.doc)
  page.update(2)
  assert.equal(f.doc.title, '(2) (7) Host')
  const writes = f.writes()
  f.flush(); f.flush()
  assert.equal(f.writes(), writes, 'own mutations do not rewrite the title')
  page.update(12)
  assert.equal(f.doc.title, '(12) (7) Host')
  f.doc.title = 'New conversation'
  f.flush()
  assert.equal(f.doc.title, '(12) New conversation')
  page.update(0)
  assert.equal(f.doc.title, 'New conversation')
  page.update(3)
  f.doc.title = '(9) Host counter'
  page.dispose()
  assert.equal(f.doc.title, '(9) Host counter', 'dispose preserves an unobserved host write')
  assert.equal(f.observers[0].connected, false)
  page.update(5)
  assert.equal(f.doc.title, '(9) Host counter')
})

test('a host title starting with the same unread number survives badge removal', () => {
  const f = fixture(), page = mountPageUnread(f.doc)
  page.update(2)
  f.doc.title = '(2) New conversation — DeepSeek Harness'
  f.flush()
  assert.equal(f.doc.title, '(2) (2) New conversation — DeepSeek Harness')
  page.update(0)
  assert.equal(f.doc.title, '(2) New conversation — DeepSeek Harness')
  page.update(2)
  f.doc.title = '(2) Another conversation — DeepSeek Harness'
  page.dispose()
  assert.equal(f.doc.title, '(2) Another conversation — DeepSeek Harness')
})

test('favicon overlays original image with a blue top-right dot without modifying its link', () => {
  const f = fixture(), page = mountPageUnread(f.doc)
  page.update(1)
  assert.equal(f.children[0], f.original)
  assert.equal(f.original.href, 'https://host.example/original.ico')
  assert.equal(f.children.length, 2)
  assert.equal(f.children[1].rel, 'icon')
  assert.equal(f.images.length, 1)
  assert.equal(f.images[0].url, f.original.href)
  f.images[0].onload()
  assert.equal(f.draws.filter(d => d[0] === 'image').length, 1)
  assert.ok(f.draws.some(d => d[0] === 'dot' && d[1] === 25 && d[2] === 7))
  assert.ok(f.draws.some(d => d[0] === 'fill' && d[1] === '#3a83f7'))
  page.update(8)
  assert.equal(f.children.length, 2)
  assert.equal(f.images.length, 1, 'count changes reuse the badge')
  page.update(0)
  assert.deepEqual(f.children, [f.original])
  page.dispose()
  assert.deepEqual(f.children, [f.original])
})

test('clearing unread reactivates the native favicon even when removal leaves a cached badge', () => {
  const f = fixture(), page = mountPageUnread(f.doc)
  page.update(1)
  assert.ok(f.renderedIcon().startsWith('data:image/png'))
  page.update(0)
  assert.equal(f.renderedIcon(), f.original.href)
  assert.deepEqual(f.relWrites, ['', 'shortcut icon'])
  assert.equal(f.original.rel, 'shortcut icon')
  const writes = f.relWrites.length
  page.update(0)
  assert.equal(f.relWrites.length, writes, 'stable zero does not churn favicon candidates')
  page.update(1)
  page.dispose()
  assert.equal(f.renderedIcon(), f.original.href)
  assert.deepEqual(f.children, [f.original])
  const initial = fixture(), cleanPage = mountPageUnread(initial.doc)
  cleanPage.update(0)
  assert.deepEqual(initial.relWrites, ['', 'shortcut icon'], 'initial zero restores a cached badge from a previous mount')
  cleanPage.dispose()
})

test('favicon uses the last original icon matching the active theme', () => {
  for (const dark of [false, true]) {
    const f = fixture()
    const lightIcon = { rel: 'icon', media: '(prefers-color-scheme: light)', href: 'https://host.example/light.svg' }
    const darkIcon = { rel: 'icon', media: '(prefers-color-scheme: dark)', href: 'https://host.example/dark.svg' }
    f.children.push(lightIcon, darkIcon)
    f.doc.defaultView.matchMedia = media => ({ matches: media.includes(dark ? 'dark' : 'light') })
    const page = mountPageUnread(f.doc)
    page.update(1)
    assert.equal(f.images[0].url, dark ? darkIcon.href : lightIcon.href)
    assert.equal(f.children.length, 4)
    page.dispose()
    assert.deepEqual(f.children, [f.original, lightIcon, darkIcon])
  }
})

test('stale image loads cannot resurrect or overwrite a later favicon badge', () => {
  const f = fixture(), page = mountPageUnread(f.doc)
  page.update(1)
  const first = f.images[0]
  page.update(0)
  first.onload()
  assert.deepEqual(f.children, [f.original])
  page.update(2)
  const current = f.children[1], href = current.href
  first.onload(); first.onerror()
  assert.equal(current.href, href)
  assert.equal(f.children.length, 2)
  f.images[1].onload()
  assert.notEqual(current.href, href)
  page.dispose()
  f.images[1].onload()
  assert.deepEqual(f.children, [f.original])
})

test('missing, failed, and tainted favicons use local canvas fallback', () => {
  const missing = fixture({ favicon: false }), page = mountPageUnread(missing.doc)
  page.update(1)
  assert.equal(missing.images.length, 0, 'no guessed favicon network request')
  assert.equal(missing.children.length, 1)
  page.dispose()
  assert.equal(missing.children.length, 0)
  for (const tainted of [false, true]) {
    const f = fixture({ tainted }), p = mountPageUnread(f.doc)
    p.update(1)
    if (tainted) f.images[0].onload()
    else f.images[0].onerror()
    assert.equal(f.children.length, 2)
    assert.ok(f.children[1].href.startsWith('data:image/png'))
    p.dispose()
  }
})

test('DOM, observer, and canvas absence degrade safely and invalid counts clear badges', () => {
  const absent = mountPageUnread()
  absent.update(1); absent.dispose()
  const doc = { title: 'Host' }, page = mountPageUnread(doc)
  page.update(3)
  assert.equal(doc.title, '(3) Host')
  page.update(NaN)
  assert.equal(doc.title, 'Host')
  page.update(-1)
  assert.equal(doc.title, 'Host')
  page.dispose()
  const f = fixture({ canvas: false }), p = mountPageUnread(f.doc)
  p.update(1); f.images[0].onload(); p.dispose()
  assert.deepEqual(f.children, [f.original])
})


test('opening unread sessions updates the title and removes the favicon after the final successful open', async () => {
  let plugin
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: entry => { plugin = entry.factory(() => ({})) } } } })
  const { createPendingStore } = plugin.__test__
  const openStart = source.indexOf('    async function openSessionAndAcknowledge(')
  const openEnd = source.indexOf('\n    }\n', openStart)
  assert.notEqual(openStart, -1)
  const openAndAck = vm.runInNewContext(`(${source.slice(openStart, openEnd + 6).trim()})`)
  const pending = createPendingStore()
  const list = { phase: 'ready', ids: ['a', 'b'], byId: { a: { id: 'a', running: false }, b: { id: 'b', running: false } } }
  pending.observe(list, new Map([['a', { completionUnread: true }], ['b', { completionUnread: true }]]))
  const f = fixture()
  f.doc.title = 'DeepSeek Harness'
  const page = mountPageUnread(f.doc)
  const refresh = () => page.update(Object.values(pending.getSnapshot()).filter(r => r.pending).length)
  const unsubscribe = pending.subscribe(refresh)
  refresh()
  assert.equal(f.doc.title, '(2) DeepSeek Harness')
  let resolveOpen
  const opening = openAndAck(() => new Promise(resolve => { resolveOpen = resolve }), pending, 'a')
  assert.equal(f.doc.title, '(2) DeepSeek Harness', 'pending navigation does not mark read')
  resolveOpen()
  await opening
  assert.equal(f.doc.title, '(1) DeepSeek Harness')
  assert.equal(pending.getSnapshot().b.pending, true, 'other unread sessions stay unread')
  await assert.rejects(openAndAck(() => Promise.reject(Error('navigation failed')), pending, 'b'))
  assert.equal(f.doc.title, '(1) DeepSeek Harness')
  assert.equal(f.children.length, 2)
  await openAndAck(() => {}, pending, 'b')
  assert.equal(f.doc.title, 'DeepSeek Harness')
  assert.equal(f.children.length, 1, 'only original favicon remains')
  f.images.forEach(image => image.onload())
  assert.equal(f.children.length, 1, 'late favicon load cannot restore the dot')
  unsubscribe()
  page.dispose()
})
