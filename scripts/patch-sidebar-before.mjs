#!/usr/bin/env node
// Local, reversible compatibility extension for the published sidebar bundle.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'

const args = process.argv.slice(2)
const rollback = args.includes('--rollback')
const target = args.find(arg => !arg.startsWith('--'))
if (!target) throw new Error('Usage: node scripts/patch-sidebar-before.mjs <sidebar-package-directory> [--rollback]')
const root = resolve(target)
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
if (version !== '0.2.1-rc.2') throw new Error(`Unsupported sidebar version ${version}; review the extension against the new public contract first`)
const changes = [
  ['lib/client.js', [
    ['\t\t\t\t\t(0, react_jsx_runtime.jsx)("div", {\n\t\t\t\t\t\tclassName: SidebarRoot_module_css_default.regionArea,', '\t\t\t\t\trenderSlot("sidebar.workspaces.before", { wide }),\n\t\t\t\t\t(0, react_jsx_runtime.jsx)("div", {\n\t\t\t\t\t\tclassName: SidebarRoot_module_css_default.regionArea,'],
    ['\t\t\t\t\t"sidebar.workspaces": {', '\t\t\t\t\t"sidebar.workspaces.before": {\n\t\t\t\t\t\tkind: "list",\n\t\t\t\t\t\tscope: "root"\n\t\t\t\t\t},\n\t\t\t\t\t"sidebar.workspaces": {'],
  ]],
  ['lib/types/client/contract/slots.d.ts', [
    ["        'sidebar.workspaces': {", "        /** Additive controls after all global panel rows, before the browsing region. */\n        'sidebar.workspaces.before': {\n            kind: 'list';\n            scope: 'root';\n            owner: SidebarFooterActionOwnerProps;\n        };\n        'sidebar.workspaces': {"],
    ["'sidebar.panellist' | 'sidebar.workspaces'", "'sidebar.panellist' | 'sidebar.workspaces.before' | 'sidebar.workspaces'"],
  ]],
]
const plans = changes.map(([relative, replacements]) => {
  const path = join(root, relative), backup = `${path}.dsa-before.backup`
  const current = readFileSync(path, 'utf8')
  const original = existsSync(backup) ? readFileSync(backup, 'utf8') : current
  let patched = original
  for (const [before, after] of replacements) {
    if (patched.split(before).length !== 2 || patched.includes(after)) throw new Error(`Unknown or already modified anchor: ${relative}`)
    patched = patched.replace(before, after)
  }
  if (current !== original && current !== patched) throw new Error(`Concurrent modification: ${relative}; refusing to overwrite`)
  if (rollback && !existsSync(backup)) throw new Error(`No backup: ${relative}`)
  return { path, backup, original, patched }
})
// Validate every target before changing either file. Backups preserve exact original bytes.
for (const { path, backup, original, patched } of plans) {
  if (rollback) {
    writeFileSync(path, original)
    // backup is the checked absolute sibling of the target above.
    unlinkSync(backup)
  } else {
    if (!existsSync(backup)) writeFileSync(backup, original, { flag: 'wx' })
    writeFileSync(path, patched)
  }
  console.log(`${rollback ? 'Restored' : 'Patched'} ${path}`)
}
