#!/usr/bin/env node
// Zero-dependency visual companion server.
// Serves the newest HTML file in <session>/content, wraps fragments in frame.html,
// pushes reloads over SSE and records browser clicks to <session>/state/events.

const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true
    else { out[a.slice(2)] = next; i++ }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const SESSION_DIR = path.resolve(args['session-dir'] || '.')
const CONTENT_DIR = path.join(SESSION_DIR, 'content')
const STATE_DIR = path.join(SESSION_DIR, 'state')
const HOST = args.host || '127.0.0.1'
const URL_HOST = args['url-host'] || (HOST === '0.0.0.0' ? 'localhost' : HOST)
const IDLE_MS = Number(args['idle-timeout-minutes'] || 240) * 60_000
const SCRIPT_DIR = __dirname
const COOKIE = 'tv_key'

fs.mkdirSync(CONTENT_DIR, { recursive: true })
fs.mkdirSync(STATE_DIR, { recursive: true })

// Reuse the key and port across restarts so an open tab reconnects by itself.
const KEY_FILE = path.join(STATE_DIR, 'key')
const PORT_FILE = path.join(STATE_DIR, 'port')
const KEY = fs.existsSync(KEY_FILE)
  ? fs.readFileSync(KEY_FILE, 'utf8').trim()
  : crypto.randomBytes(16).toString('hex')
fs.writeFileSync(KEY_FILE, KEY, { mode: 0o600 })
const PREFERRED_PORT = Number(args.port || (fs.existsSync(PORT_FILE) ? fs.readFileSync(PORT_FILE, 'utf8') : 0))

const EVENTS_FILE = path.join(STATE_DIR, 'events')
const INFO_FILE = path.join(STATE_DIR, 'server-info')
const STOPPED_FILE = path.join(STATE_DIR, 'server-stopped')
try { fs.unlinkSync(STOPPED_FILE) } catch {}

const frame = () => fs.readFileSync(path.join(SCRIPT_DIR, 'frame.html'), 'utf8')
const helper = () => fs.readFileSync(path.join(SCRIPT_DIR, 'helper.js'), 'utf8')

function newestScreen() {
  let best = null
  for (const name of fs.readdirSync(CONTENT_DIR)) {
    if (!name.endsWith('.html')) continue
    const mtime = fs.statSync(path.join(CONTENT_DIR, name)).mtimeMs
    if (!best || mtime > best.mtime) best = { name, mtime }
  }
  return best && best.name
}

const EMPTY = '<div class="flex items-center justify-center vh-50"><p class="subtitle">Waiting for the first screen…</p></div>'

function render() {
  const name = newestScreen()
  const body = name ? fs.readFileSync(path.join(CONTENT_DIR, name), 'utf8') : EMPTY
  const script = `<script>${helper()}</script>`
  // Function replacers so `$&` and friends inside screens are left alone.
  if (/^\s*(<!doctype|<html)/i.test(body)) {
    return body.includes('</body>') ? body.replace('</body>', () => `${script}</body>`) : body + script
  }
  const title = name ? name.replace(/\.html$/, '') : 'waiting'
  return frame()
    .replaceAll('{{TITLE}}', () => title)
    .replace('{{CONTENT}}', () => body)
    .replace('{{HELPER}}', () => script)
}

function authorized(req, url) {
  if (url.searchParams.get('key') === KEY) return true
  const cookie = req.headers.cookie || ''
  return cookie.split(';').some(c => c.trim() === `${COOKIE}=${KEY}`)
}

// --- live reload over SSE -------------------------------------------------

const clients = new Set()
function broadcast(msg) {
  for (const res of clients) res.write(`data: ${JSON.stringify(msg)}\n\n`)
}

let lastActivity = Date.now()
const touch = () => { lastActivity = Date.now() }

let debounce = null
fs.watch(CONTENT_DIR, () => {
  clearTimeout(debounce)
  debounce = setTimeout(() => {
    // A new screen invalidates the previous screen's clicks.
    try { fs.writeFileSync(EVENTS_FILE, '') } catch {}
    touch()
    broadcast({ type: 'reload' })
  }, 80)
})

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2',
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (!authorized(req, url)) {
    res.writeHead(403, { 'content-type': 'text/plain' })
    return res.end('Missing or wrong session key. Use the full URL Claude gave you.')
  }
  touch()
  if (url.pathname === '/favicon.ico') return res.writeHead(204).end()
  if (req.method === 'GET' && url.pathname === '/tachyons.css') {
    res.writeHead(200, { 'content-type': 'text/css', 'cache-control': 'max-age=86400' })
    return fs.createReadStream(path.join(SCRIPT_DIR, 'tachyons.min.css')).pipe(res)
  }
  const headers = { 'set-cookie': `${COOKIE}=${KEY}; Path=/; HttpOnly; SameSite=Strict` }

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(render())
  }

  if (req.method === 'GET' && url.pathname === '/live') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write(': hi\n\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }

  if (req.method === 'POST' && url.pathname === '/events') {
    let raw = ''
    req.on('data', c => { raw += c; if (raw.length > 64_000) req.destroy() })
    req.on('end', () => {
      try {
        const event = JSON.parse(raw)
        event.screen = newestScreen()
        fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n')
        res.writeHead(204).end()
      } catch {
        res.writeHead(400).end()
      }
    })
    return
  }

  // Static assets the agent drops next to the screens, e.g. /files/hero.png
  if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
    const file = path.join(CONTENT_DIR, path.normalize(decodeURIComponent(url.pathname.slice(7))))
    if (!file.startsWith(CONTENT_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return res.writeHead(404).end()
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
    return fs.createReadStream(file).pipe(res)
  }

  res.writeHead(404).end()
})

// Keep SSE connections alive through proxies.
setInterval(() => { for (const res of clients) res.write(': ping\n\n') }, 25_000).unref()

function shutdown(reason) {
  broadcast({ type: 'stopped' })
  try { fs.writeFileSync(STOPPED_FILE, JSON.stringify({ reason, at: Date.now() })) } catch {}
  try { fs.unlinkSync(INFO_FILE) } catch {}
  process.exit(0)
}

setInterval(() => {
  if (Date.now() - lastActivity > IDLE_MS) shutdown('idle')
}, 60_000).unref()

process.on('SIGTERM', () => shutdown('stopped'))
process.on('SIGINT', () => shutdown('stopped'))

function listen(port) {
  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && port !== 0) return listen(0)
    throw err
  })
  server.listen(port, HOST, () => {
    const actual = server.address().port
    fs.writeFileSync(PORT_FILE, String(actual))
    const info = {
      type: 'server-started',
      port: actual,
      pid: process.pid,
      url: `http://${URL_HOST}:${actual}/?key=${KEY}`,
      session_dir: SESSION_DIR,
      screen_dir: CONTENT_DIR,
      state_dir: STATE_DIR,
    }
    fs.writeFileSync(INFO_FILE, JSON.stringify(info))
    console.log(JSON.stringify(info))
  })
}

listen(PREFERRED_PORT)
