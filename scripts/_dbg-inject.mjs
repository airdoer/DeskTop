// TEMP DEBUG: write probe results to STDOUT (proven to work — autoUpdater uses it).
// Usage: node scripts/_dbg-inject.mjs <asar-extract-dir>
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
if (!dir) { console.error('missing extract dir'); process.exit(1) }

const mainPath = path.join(dir, 'dist-electron/main/index.js')
let main = fs.readFileSync(mainPath, 'utf8')

if (main.includes('__DBG_STDOUT__')) {
  console.error('already injected'); process.exit(2)
}

const probe = `JSON.stringify({childCount:document.getElementById('root')?document.getElementById('root').children.length:-1, hasRoot:!!document.querySelector('#root > *'), body:document.body.innerHTML.slice(0,200)})`

const inject = [
  ';// __DBG_STDOUT__',
  'import { createRequire as __scr } from "node:module";',
  'const __sfs = __scr("node:fs"), __sos = __scr("node:os"), __spp = __scr("node:path");',
  'const __sout = (l) => { try { process.stdout.write("[DBG] " + l + "\\n"); } catch (e) {} };',
  '__sout("STDOUT HOOK REACHED, homedir=" + __sos.homedir());',
  'try {',
  '  __sfs.appendFileSync(__spp.join(__sos.homedir(), "desktop-render-debug.log"), "[HOOK] reached\\n");',
  '  __sout("appendFileSync OK");',
  '} catch (e) {',
  '  __sout("appendFileSync FAIL: " + (e && e.message));',
  '}',
  'const __sapp = __scr("electron").app;',
  '__sout("got app: " + typeof __sapp);',
  'if (__sapp) {',
  '  __sapp.on("web-contents-created", (e, wc) => {',
  '    __sout("wc-created");',
  '    wc.on("console-message", (ev, lvl, msg, line, src) => __sout("console[" + lvl + "] " + msg));',
  '    wc.on("render-process-gone", (ev, d) => __sout("gone " + JSON.stringify(d)));',
  '    wc.on("preload-error", (ev, pp, err) => __sout("preload-error " + ((err && err.stack) || err)));',
  '    wc.on("did-fail-load", (ev, code, desc, url, isMain) => { if (isMain) __sout("fail " + code + " " + desc + " " + url); });',
  '    wc.on("dom-ready", async () => {',
  '      __sout("dom-ready " + wc.getURL());',
  '      try {',
  `        const r = await wc.executeJavaScript(${JSON.stringify(probe)});`,
  '        __sout("RENDER_STATE " + r);',
  '      } catch (e) { __sout("ej fail " + e.message); }',
  '    });',
  '  });',
  '}',
].join('\n')

main += '\n' + inject + '\n'
fs.writeFileSync(mainPath, main)
console.log('injected len=' + main.length)
