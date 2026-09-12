#!/usr/bin/env node
/*
 * publish.mjs — build the DeskTop NSIS installer and publish it to the release server.
 *
 * Usage:
 *   node scripts/publish.mjs              build + upload
 *   node scripts/publish.mjs --no-upload  build only (local verification, no network)
 *   node scripts/publish.mjs --yes        do not prompt when overwriting a version
 *
 * Why Node instead of pure batch: this script needs SSH round-trips, artifact
 * verification and remote pruning. Those are awkward to write and nearly
 * impossible to verify in .bat, so shell\publish.bat is only a thin wrapper.
 *
 * Upload order is deliberate: the .exe and its .blockmap go up first, latest.yml
 * goes up LAST. Clients poll latest.yml; publishing it first would advertise a
 * version whose installer is not on the server yet.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IS_WIN = process.platform === 'win32'

/* ------------------------------------------------------------------ *
 * Release target
 *
 * UPDATE_URL must equal electron-builder.json -> publish.url (checked in [1/6]),
 * and its path must be the HTTP location that serves REMOTE_DIR.
 *
 * Why not /data/chenzhixu/DeskTop: that directory is owned by root (drwxr-xr-x)
 * and is NOT writable by chenzhixu, so uploads there fail with Permission denied.
 * Release artifacts live in a sibling directory that chenzhixu owns.
 *
 * Port 9090 rather than 80: binding a privileged port requires root or
 * CAP_NET_BIND_SERVICE, which the deploy user does not have.
 * (Not 8080 either — that port is already taken by another service on this host.)
 * ------------------------------------------------------------------ */
const REMOTE_HOST = '172.28.193.12'
const REMOTE_USER = 'chenzhixu'
const REMOTE_DIR = '/data/chenzhixu/DeskTop-release/win'
const UPDATE_URL = 'http://172.28.193.12:9090/win'

/** Newest N versions kept on the server; older ones are pruned in [6/6]. */
const KEEP_VERSIONS = 5

/* ------------------------------------------------------------------ *
 * Local tooling — ssh / scp are NOT on PATH on this machine, so the full
 * paths are mandatory. The key is also trusted by the 228 host.
 * ------------------------------------------------------------------ */
const SSH_EXE = 'C:\\Windows\\System32\\OpenSSH\\ssh.exe'
const SCP_EXE = 'C:\\Windows\\System32\\OpenSSH\\scp.exe'
const SSH_KEY = path.join(process.env.USERPROFILE ?? '', '.ssh', 'id_rsa')
const SSH_OPTS = [
  '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ConnectTimeout=15',
]

/**
 * electron-builder 26.x spawns the package manager through cross-spawn, which
 * needs powershell.exe on PATH; otherwise it dies with "spawn powershell.exe
 * ENOENT". shell\_common.bat patches PATH for the same reason — we run outside
 * that script, so we have to patch it here too.
 */
const POWERSHELL_DIR = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0'

/** Reused rather than reimplemented: it clears / renames aside a locked output dir. */
const PREPARE_PS1 = path.join(ROOT, 'shell', '_prepare-out.ps1')

/* Resolve CLIs to their JS entry points instead of the .cmd shims: Node refuses
 * to execFileSync a .cmd without shell:true, and shell:true would route through
 * cmd.exe and re-introduce quoting problems for paths with spaces. */
const NODE = process.execPath
const VITE_CLI = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
const EB_CLI = path.join(ROOT, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')

/** electron-builder dies on EBUSY when a stale process still holds the exe. */
const MAX_PACKAGE_RETRIES = 3
const RETRY_WAIT_MS = 10_000

const REMOTE = `${REMOTE_USER}@${REMOTE_HOST}`
const NO_UPLOAD = process.argv.includes('--no-upload')
const ASSUME_YES = process.argv.includes('--yes')

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const APP_NAME = pkg.productName || pkg.name
const VERSION = pkg.version
const OUT_DIR = path.join(ROOT, 'builds', VERSION, 'installer')

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const CHILD_ENV = (() => {
  const env = { ...process.env }
  if (!IS_WIN) return env
  // Windows env names are case-insensitive; mutate the key that actually exists
  // so we do not end up with two PATH-like entries in the child environment.
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'Path'
  const current = env[key] ?? ''
  const has = current
    .split(';')
    .some((entry) => entry.trim().toLowerCase() === POWERSHELL_DIR.toLowerCase())
  if (!has) env[key] = current ? `${current};${POWERSHELL_DIR}` : POWERSHELL_DIR
  return env
})()

const POWERSHELL = IS_WIN
  ? [path.join(POWERSHELL_DIR, 'powershell.exe'), 'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe']
      .find((candidate) => existsSync(candidate)) ?? 'powershell'
  : 'pwsh'

/**
 * Forward-slash path. Mandatory for scp: OpenSSH decides local vs remote by
 * looking for '/' before the first ':', so "C:\dir\a.exe" is parsed as host "C"
 * and fails, while "C:/dir/a.exe" is correctly treated as a local file.
 */
const slash = (p) => p.split(path.sep).join('/')

const humanSize = (file) => `${(statSync(file).size / 1024 / 1024).toFixed(1)} MB`

/** Run a Node CLI entry point, inheriting stdio. Throws on non-zero exit. */
function runNode(entry, args) {
  execFileSync(NODE, [entry, ...args], { cwd: ROOT, stdio: 'inherit', env: CHILD_ENV })
}

/** Run ssh and return stdout. Never inherits stdin, so nothing can block. */
function ssh(remoteCommand) {
  return execFileSync(SSH_EXE, ['-i', SSH_KEY, ...SSH_OPTS, REMOTE, remoteCommand], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: CHILD_ENV,
  }).trim()
}

/** scp local files into REMOTE_DIR. */
function scp(files) {
  execFileSync(SCP_EXE, ['-i', SSH_KEY, ...SSH_OPTS, ...files, `${REMOTE}:${REMOTE_DIR}/`], {
    stdio: 'inherit',
    env: CHILD_ENV,
  })
}

/** Synchronous sleep without a busy loop (or a child process). */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function fail(message) {
  console.error(`\n[ERROR] ${message}\n`)
  process.exit(1)
}

const step = (n, title) => console.log(`\n[${n}/6] ${title}`)

/* ------------------------------------------------------------------ *
 * Steps
 * ------------------------------------------------------------------ */

function preflight() {
  step(1, 'Preflight')
  const required = [
    ['ssh', SSH_EXE],
    ['scp', SCP_EXE],
    ['ssh key', SSH_KEY],
    ['vite cli', VITE_CLI],
    ['electron-builder cli', EB_CLI],
    ['output-dir helper', PREPARE_PS1],
  ]
  for (const [label, file] of required) {
    if (!existsSync(file)) fail(`${label} not found: ${file}\n         Run "pnpm install" first.`)
  }

  // The update URL is baked into the app as resources\app-update.yml at build
  // time. If it drifts from this script, clients poll a path we never upload to.
  const cfg = JSON.parse(readFileSync(path.join(ROOT, 'electron-builder.json'), 'utf8'))
  const cfgUrl = cfg?.publish?.url
  if (cfgUrl !== UPDATE_URL) {
    fail(
      `publish.url mismatch:\n` +
        `         electron-builder.json = ${cfgUrl}\n` +
        `         this script           = ${UPDATE_URL}\n` +
        `         Fix electron-builder.json so the built app polls the same path.`,
    )
  }

  console.log('      ssh / scp / key         OK')
  console.log('      build toolchain         OK')
  console.log('      publish.url             OK')
}

/** @returns {boolean} whether this exact version already exists on the server */
function remoteCheck() {
  step(2, 'Checking release directory')
  if (NO_UPLOAD) {
    console.log('      skipped (--no-upload)')
    return false
  }
  try {
    ssh(`mkdir -p '${REMOTE_DIR}'`)
  } catch (error) {
    fail(
      `cannot reach ${REMOTE} or create ${REMOTE_DIR}\n` +
        `         ${error instanceof Error ? error.message.split('\n')[0] : error}`,
    )
  }

  const state = ssh(`test -f '${REMOTE_DIR}/${APP_NAME}_${VERSION}.exe' && echo EXISTS || echo NEW`)
  console.log('      remote dir ready')
  return state.includes('EXISTS')
}

async function confirmOverwrite() {
  if (ASSUME_YES) return
  console.log('')
  console.log(`[WARN] ${APP_NAME} ${VERSION} already exists on the server.`)
  console.log('       electron-updater compares version numbers, so re-uploading the')
  console.log('       SAME version will NOT reach clients already running it.')
  console.log('       Bump "version" in package.json first if this is a new build.')
  console.log('')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`       Overwrite ${VERSION} anyway? [y/N] `)
    if (!/^y(es)?$/i.test(answer.trim())) fail('aborted by user')
  } finally {
    rl.close()
  }
}

function build() {
  step(3, 'Building renderer + main')
  runNode(VITE_CLI, ['build'])
}

/** Kill processes that may hold a write lock on win-unpacked\<app>.exe. */
function killStaleProcesses() {
  if (!IS_WIN) return
  for (const image of [`${APP_NAME}.exe`, 'electron.exe', 'electron-vite-react.exe']) {
    try {
      execFileSync('taskkill', ['/F', '/IM', image], { stdio: 'ignore' })
    } catch {
      /* not running — expected */
    }
  }
}

/**
 * Clear the output dir (or rename it aside when locked) and return the dir that
 * should actually be used. Delegates to shell\_prepare-out.ps1 so this script
 * and the .bat build scripts cannot drift apart.
 */
function prepareOutDir(outDir) {
  try {
    const stdout = execFileSync(
      POWERSHELL,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PREPARE_PS1, '-OutDir', outDir],
      { cwd: ROOT, encoding: 'utf8', env: CHILD_ENV },
    )
    const line = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .pop()
    return line || outDir
  } catch (error) {
    console.log(
      `[WARN] could not pre-clean the output dir: ${
        error instanceof Error ? error.message.split('\n')[0] : error
      }`,
    )
    return outDir
  }
}

function package_() {
  step(4, 'Packaging (nsis)')
  let outDir = prepareOutDir(OUT_DIR)
  if (outDir !== OUT_DIR) {
    console.log(`      previous output is locked, writing to ${path.basename(outDir)}`)
  }

  let attempt = 0
  for (;;) {
    try {
      runNode(EB_CLI, [
        '--win', 'nsis', '--x64',
        // Never let electron-builder upload: publishing is this script's job,
        // and doing it inside the build would race with the ordering above.
        '--publish', 'never',
        `-c.directories.output=${slash(outDir)}`,
      ])
      break
    } catch (error) {
      if (attempt >= MAX_PACKAGE_RETRIES) throw error
      attempt += 1
      console.log('')
      console.log(`[WARN] Packaging failed (attempt ${attempt}/${MAX_PACKAGE_RETRIES}).`)
      console.log(`       Usual cause: a process still holds win-unpacked\\${APP_NAME}.exe`)
      console.log('       (AV scan / explorer / a stale app instance).')
      console.log('       Killing stale processes, waiting for the lock, retrying ...')
      killStaleProcesses()
      sleepSync(RETRY_WAIT_MS)
      outDir = prepareOutDir(OUT_DIR)
    }
  }

  const exe = path.join(outDir, `${APP_NAME}_${VERSION}.exe`)
  const blockmap = `${exe}.blockmap`
  const latest = path.join(outDir, 'latest.yml')

  if (!existsSync(exe)) fail(`missing artifact: ${exe}`)
  if (!existsSync(blockmap)) {
    fail(
      `missing artifact: ${blockmap}\n` +
        `         The blockmap drives differential downloads; without it every\n` +
        `         client pulls the full installer.`,
    )
  }
  if (!existsSync(latest)) {
    fail(
      `missing artifact: ${latest}\n` +
        `         Check that publish.url in electron-builder.json is a valid provider config.`,
    )
  }

  console.log(`      ${path.basename(exe)}  (${humanSize(exe)})`)
  console.log(`      ${path.basename(blockmap)}  (${humanSize(blockmap)})`)
  console.log('      latest.yml')
  return { outDir, exe, blockmap, latest }
}

function upload({ exe, blockmap, latest }) {
  step(5, 'Uploading installer + blockmap')
  scp([slash(exe), slash(blockmap)])

  console.log('      Uploading latest.yml (last, so no client sees a half-published version) ...')
  scp([slash(latest)])
}

function prune() {
  step(6, `Pruning old versions, keeping newest ${KEEP_VERSIONS}`)
  const cmd =
    `cd '${REMOTE_DIR}' && ls -1t ${APP_NAME}_*.exe 2>/dev/null ` +
    `| tail -n +${KEEP_VERSIONS + 1} ` +
    `| while read f; do echo "removing $f"; rm -f $f $f.blockmap; done; ` +
    `echo '--- server dir ---'; ls -lh`
  try {
    console.log(ssh(cmd))
  } catch (error) {
    console.log(`[WARN] prune failed (non-fatal): ${error instanceof Error ? error.message : error}`)
  }
}

/**
 * Non-fatal probe of the update endpoint. A silent failure mode here is "upload
 * succeeded but no HTTP server is serving REMOTE_DIR", which only shows up on
 * the client — so surface it now.
 */
async function probeUpdateUrl() {
  try {
    const res = await fetch(`${UPDATE_URL}/latest.yml`, { signal: AbortSignal.timeout(5000) })
    if (res.ok) {
      console.log(`      HTTP check OK: ${UPDATE_URL}/latest.yml -> ${res.status}`)
    } else {
      console.log(`[WARN] ${UPDATE_URL}/latest.yml returned HTTP ${res.status}`)
    }
  } catch (error) {
    console.log(`[WARN] ${UPDATE_URL}/latest.yml unreachable: ${error instanceof Error ? error.message : error}`)
    console.log(`       Start a static file server on ${REMOTE_HOST} serving ${REMOTE_DIR}.`)
  }
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

console.log('============================================')
console.log(` Publish ${APP_NAME} ${VERSION}`)
console.log(` Server : ${REMOTE}:${REMOTE_DIR}`)
console.log(` URL    : ${UPDATE_URL}`)
console.log(` Mode   : ${NO_UPLOAD ? 'build only' : 'build + upload'}`)
console.log('============================================')

try {
  preflight()
  const alreadyThere = remoteCheck()
  if (alreadyThere && !NO_UPLOAD) await confirmOverwrite()

  build()
  const artifacts = package_()

  if (NO_UPLOAD) {
    console.log('')
    console.log('============================================')
    console.log(' [OK] Build only, nothing uploaded.')
    console.log(` Artifacts: ${artifacts.outDir}`)
    console.log('============================================')
  } else {
    upload(artifacts)
    prune()
    console.log('')
    console.log('============================================')
    console.log(` [OK] Published ${APP_NAME} ${VERSION}`)
    console.log(` Clients poll: ${UPDATE_URL}/latest.yml`)
    console.log('============================================')
    await probeUpdateUrl()
  }
  process.exit(0)
} catch (error) {
  console.error('')
  console.error(`[ERROR] Publish failed: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}
