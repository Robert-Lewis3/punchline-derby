// Punchline Derby — server.
// Serves the phone page (/ and /ABCD), the big-screen host page (/host), and a
// WebSocket endpoint. All game logic lives in game.js; this file only routes
// messages and pushes personalised state snapshots after every change.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { URL } = require('url');
const WebSocket = require('ws');
const QRCode = require('qrcode');
const { Room } = require('./game');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const HOSTLESS_TTL_MS = 30 * 60 * 1000;
const IDLE_TTL_MS = 4 * 60 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** code -> { room, hostWs, sockets: Map<playerId, ws>, hostLostAt, pending } */
const rooms = new Map();

function makeRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, so "HOST" can never be a code
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// When running locally, phones need the laptop's LAN address, not localhost.
function lanUrl() {
  if (process.env.RENDER) return null;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) return `http://${a.address}:${PORT}`;
    }
  }
  return null;
}

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// Coalesce many changes in one tick into a single broadcast.
function scheduleBroadcast(entry) {
  if (entry.pending) return;
  entry.pending = true;
  setImmediate(() => {
    entry.pending = false;
    const { room } = entry;
    send(entry.hostWs, { type: 'state', view: room.hostView() });
    for (const [pid, ws] of entry.sockets) {
      const view = room.playerView(pid);
      if (view) send(ws, { type: 'state', view });
    }
  });
}

// ---------------------------------------------------------------- HTTP
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);

  if (u.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  if (u.pathname === '/qr') {
    const data = u.searchParams.get('data');
    if (!data || data.length > 500) {
      res.writeHead(400);
      return res.end('missing data');
    }
    try {
      const svg = await QRCode.toString(data, { type: 'svg', margin: 1, color: { dark: '#1b1340', light: '#ffffff' } });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      return res.end(svg);
    } catch {
      res.writeHead(500);
      return res.end('qr error');
    }
  }

  let file = u.pathname === '/' ? '/index.html' : u.pathname === '/host' ? '/host.html' : u.pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  let full = path.join(PUBLIC_DIR, file);
  // Unknown paths (e.g. /ABCD from the QR code) get the phone page.
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    full = path.join(PUBLIC_DIR, 'index.html');
  }
  const ext = path.extname(full);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(full).pipe(res);
});

// ---------------------------------------------------------------- WebSocket
const wss = new WebSocket.Server({ server, maxPayload: 16 * 1024 });

function attachHost(ws, entry) {
  if (entry.hostWs && entry.hostWs !== ws) send(entry.hostWs, { type: 'replaced' });
  entry.hostWs = ws;
  entry.hostLostAt = null;
  ws._code = entry.room.code;
  ws._isHost = true;
  send(ws, {
    type: 'hosting',
    code: entry.room.code,
    hostKey: entry.room.hostKey,
    publicUrl: process.env.PUBLIC_URL || null,
    lanUrl: lanUrl(),
  });
  scheduleBroadcast(entry);
}

function handleHost(ws, entry, msg) {
  const room = entry.room;
  switch (msg.cmd) {
    case 'settings': room.updateSettings(msg.settings || {}); break;
    case 'start': {
      const err = room.start({ fillBots: !!msg.fillBots });
      if (err) send(ws, { type: 'error', error: err });
      break;
    }
    case 'next': room.next(); break;
    case 'skip': room.skip(); break;
    case 'end': room.endGame(); break;
    case 'again': room.playAgain(); break;
    case 'kick': {
      const pws = entry.sockets.get(msg.playerId);
      send(pws, { type: 'kicked' });
      entry.sockets.delete(msg.playerId);
      room.kick(msg.playerId);
      break;
    }
  }
}

function handlePlayer(ws, entry, msg) {
  const room = entry.room;
  const pid = ws._playerId;
  switch (msg.type) {
    case 'pick_char': {
      const err = room.pickChar(pid, String(msg.char || ''));
      if (err) send(ws, { type: 'error', error: err });
      break;
    }
    case 'draft': room.draft(pid, msg.text); break;
    case 'submit': room.submit(pid, msg.text); break;
    case 'generate':
      if (room.phase === 'prompt' && !room.cur.entries.has(pid)) {
        send(ws, { type: 'generated', text: room.generateAnswer(pid) });
      }
      break;
    case 'vote': room.vote(pid, Number(msg.ballot), String(msg.pick || '')); break;
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const entry = ws._code && rooms.get(ws._code);

    if (msg.type === 'host_create') {
      const code = makeRoomCode();
      const e = { hostWs: null, sockets: new Map(), hostLostAt: null, pending: false };
      e.room = new Room(code, () => scheduleBroadcast(e));
      rooms.set(code, e);
      return attachHost(ws, e);
    }
    if (msg.type === 'host_reclaim') {
      const e = rooms.get(String(msg.code || '').toUpperCase());
      if (!e || e.room.hostKey !== msg.hostKey) return send(ws, { type: 'error', error: 'no_such_room' });
      return attachHost(ws, e);
    }
    if (msg.type === 'host') {
      if (entry && ws._isHost && entry.hostWs === ws) handleHost(ws, entry, msg);
      return;
    }

    if (msg.type === 'join') {
      const e = rooms.get(String(msg.room || '').toUpperCase());
      if (!e) return send(ws, { type: 'error', error: 'no_such_room' });
      let player = msg.playerId && e.room.players.get(msg.playerId);
      if (player) {
        const old = e.sockets.get(player.id);
        if (old && old !== ws) { old._playerId = null; old.close(); }
        e.room.setConnected(player.id, true);
      } else {
        const res = e.room.addPlayer(msg.name);
        if (res.error) return send(ws, { type: 'error', error: res.error });
        player = res.player;
      }
      ws._code = e.room.code;
      ws._playerId = player.id;
      e.sockets.set(player.id, ws);
      send(ws, { type: 'joined', playerId: player.id, room: e.room.code });
      return scheduleBroadcast(e);
    }

    if (entry && ws._playerId && entry.room.players.has(ws._playerId)) handlePlayer(ws, entry, msg);
  });

  ws.on('close', () => {
    const entry = ws._code && rooms.get(ws._code);
    if (!entry) return;
    if (ws._isHost && entry.hostWs === ws) {
      entry.hostWs = null;
      entry.hostLostAt = Date.now();
    } else if (ws._playerId && entry.sockets.get(ws._playerId) === ws) {
      entry.sockets.delete(ws._playerId);
      entry.room.setConnected(ws._playerId, false);
    }
  });
});

// Heartbeat + stale-room cleanup.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, e] of rooms) {
    const hostless = !e.hostWs && e.hostLostAt && now - e.hostLostAt > HOSTLESS_TTL_MS;
    const idle = now - e.room.lastActivity > IDLE_TTL_MS;
    if (hostless || idle) {
      e.room.clearTimer();
      for (const ws of e.sockets.values()) ws.close();
      if (e.hostWs) e.hostWs.close();
      rooms.delete(code);
    }
  }
}, 15000);

server.listen(PORT, () => {
  console.log(`Punchline Derby on http://localhost:${PORT}/host`);
  const lan = lanUrl();
  if (lan) console.log(`Phones on the same Wi-Fi join via ${lan}`);
});
