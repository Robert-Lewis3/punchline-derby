// Bot players for testing.
//
//   node test/sim.js                       full auto: bots + a bot host play a whole game
//   node test/sim.js --bots 25 --rounds 5  (options for full auto)
//   node test/sim.js --room ABCD --bots 12 bots join a room you host in a browser
//
// Start the server with PD_TIME_SCALE=0.05 to make timers fast for full auto.
// Some bots type, some use the 🎲 button, some idle so time runs out.

const WebSocket = require('ws');

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
let SERVER = process.env.PD_SERVER || 'ws://localhost:3000';
const BOTS = parseInt(opt('bots', '8'), 10);
const ROUNDS = parseInt(opt('rounds', '5'), 10);
const ROOM = opt('room', null);
const IDLE_RATE = parseFloat(opt('idle', '0.1'));
const PACE = parseFloat(opt('pace', ROOM ? '1' : '0.05')); // multiplies bot think time

const NAMES = ['Ava', 'Ben', 'Cruz', 'Dee', 'Eli', 'Fern', 'Gus', 'Hana', 'Ike', 'Jo', 'Kai', 'Lu', 'Max', 'Nia', 'Oz',
  'Pia', 'Quin', 'Rae', 'Sol', 'Tess', 'Uma', 'Vic', 'Wes', 'Xan', 'Yui', 'Zed', 'Abe', 'Bea', 'Cy', 'Di', 'Ed', 'Flo',
  'Gil', 'Hal', 'Ivy', 'Jax', 'Kit', 'Lev', 'Mo', 'Ned'];
const QUIPS = ['Honestly, a llama', 'My manager, probably', 'Free snacks forever', 'The printer did it',
  'A suspicious amount of glitter', 'Seven ducks in a trench coat', 'Reply All, but louder', 'Soup. Always soup.'];

const wait = (ms) => new Promise((r) => setTimeout(r, ms * PACE));
const rand = (a, b) => a + Math.random() * (b - a);
let failures = 0;
const fail = (m) => { failures++; console.error('FAIL:', m); };

function bot(i, room) {
  return new Promise((resolve) => {
    const ws = new WebSocket(SERVER);
    const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? i : '');
    let answeredRound = 0, votedKey = '', lastRevealRound = 0, earned = 0, lastView = null;
    const out = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));

    ws.on('open', () => out({ type: 'join', room, name }));
    ws.on('message', async (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'joined') return;
      if (msg.type === 'error') {
        if (msg.error === 'character_taken') return; // raced another bot; next state will retry
        return fail(`${name}: ${msg.error}`);
      }
      if (msg.type === 'generated') {
        await wait(rand(300, 1500));
        return out({ type: 'submit', text: msg.text });
      }
      if (msg.type !== 'state') return;
      const v = (lastView = msg.view);

      if (!v.me.char) {
        const free = ['fox', 'frog', 'panda', 'koala', 'tiger', 'lion', 'pig', 'cow', 'monkey', 'dog', 'cat', 'mouse',
          'hamster', 'bunny', 'bear', 'wolf', 'raccoon', 'chicken', 'penguin', 'owl', 'octopus', 'whale', 'turtle', 'bee',
          'flamingo', 'sloth', 'otter', 'trex', 'dragon', 'unicorn', 'alien', 'robot', 'ghost', 'pumpkin', 'cowboy']
          .filter((c) => !v.taken.includes(c));
        if (free.length && Math.random() < 0.8) out({ type: 'pick_char', char: free[Math.floor(Math.random() * free.length)] });
        // ~20% leave it blank to test auto-assign at start
      }

      if (v.phase === 'prompt' && !v.submitted && answeredRound !== v.round) {
        answeredRound = v.round;
        const roll = Math.random();
        if (roll < IDLE_RATE) {
          if (Math.random() < 0.5) out({ type: 'draft', text: `${name} was still typing` }); // time runs out mid-typing
          return;
        }
        await wait(rand(1500, 9000));
        if (roll < 0.4) out({ type: 'generate' });
        else out({ type: 'submit', text: QUIPS[Math.floor(Math.random() * QUIPS.length)] + ` (${name})` });
      }

      if (v.phase === 'vote' && v.ballots) {
        const idx = v.ballots.findIndex((b) => b.pick === null);
        const key = v.round + ':' + idx;
        if (idx >= 0 && votedKey !== key) {
          votedKey = key;
          const b = v.ballots[idx];
          if (b.options.some((o) => o.text && o.text.includes(`(${name})`))) fail(`${name} saw own answer`);
          await wait(rand(1200, 4000));
          out({ type: 'vote', ballot: idx, pick: b.options[Math.floor(Math.random() * b.options.length)].id });
        }
      }

      if (v.phase === 'reveal' && lastRevealRound !== v.round) {
        lastRevealRound = v.round;
        if (v.myResult) earned += v.myResult.wins;
        if (v.me.score !== earned) fail(`${name} score ${v.me.score} != earned ${earned}`);
      }

      if (v.phase === 'final') {
        ws.close();
        resolve({ name, score: v.me.score, rank: v.me.rank });
      }
    });
    ws.on('error', (e) => fail(`${name} socket: ${e.message}`));
    ws.on('close', () => resolve({ name, score: lastView && lastView.me.score, rank: lastView && lastView.me.rank }));
  });
}

async function fullAuto() {
  const host = new WebSocket(SERVER);
  const hostOut = (o) => host.send(JSON.stringify({ type: 'host', ...o }));
  let code = null, lastPhase = '', started = false, seenRounds = new Set();
  let finalView = null;

  const hostDone = new Promise((resolve) => {
    host.on('open', () => host.send(JSON.stringify({ type: 'host_create' })));
    host.on('message', async (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'hosting') {
        code = msg.code;
        console.log(`room ${code}: ${BOTS} bots, ${ROUNDS} rounds`);
        hostOut({ cmd: 'settings', settings: { rounds: ROUNDS } });
        bots = Array.from({ length: BOTS }, (_, i) => bot(i, code));
        return;
      }
      if (msg.type === 'error') return fail('host: ' + msg.error);
      if (msg.type !== 'state') return;
      const v = msg.view;
      if (v.phase === 'lobby' && !started && v.players.length === BOTS && v.settings.rounds === ROUNDS) {
        started = true;
        await wait(500 / PACE * 0.05);
        hostOut({ cmd: 'start' });
      }
      const key = v.phase + v.round;
      if (key === lastPhase) return;
      lastPhase = key;
      if (v.phase === 'prompt') console.log(`R${v.round}: ${v.prompt}`);
      if (v.phase === 'reveal') {
        seenRounds.add(v.round);
        const t = v.top3.map((c) => `#${c.rank} ${c.author.name} ${c.wins}/${c.shows}${c.generated ? ' 🎲' : ''} "${c.text}"`);
        console.log('   ' + t.join('\n   '));
        if (v.entryCount !== v.players.length) fail(`round ${v.round}: ${v.entryCount} entries for ${v.players.length} players`);
        setTimeout(() => hostOut({ cmd: 'next' }), 200);
      }
      if (v.phase === 'standings') setTimeout(() => hostOut({ cmd: 'next' }), 200);
      if (v.phase === 'final') {
        finalView = v;
        resolve();
      }
    });
  });
  let bots = [];
  await hostDone;
  const results = await Promise.all(bots);
  host.close();

  if (seenRounds.size !== ROUNDS) fail(`saw ${seenRounds.size} rounds, expected ${ROUNDS}`);
  const top = finalView.standings.slice(0, 3).map((s) => {
    const p = finalView.players.find((x) => x.id === s.id);
    return `#${s.rank} ${p.name} ${s.score}`;
  });
  console.log('final:', top.join(' | '));
  if (finalView.bestAnswer) console.log(`best answer: "${finalView.bestAnswer.text}" by ${finalView.bestAnswer.author.name}`);
  const total = results.reduce((s, r) => s + (r.score || 0), 0);
  console.log(`total points ${total}; ${failures ? failures + ' FAILURES' : 'all checks passed'}`);
  process.exit(failures ? 1 : 0);
}

// Full auto without PD_SERVER: spin up a private fast-timer server for the run.
function withTestServer(fn) {
  if (process.env.PD_SERVER || ROOM) return fn();
  const { spawn } = require('child_process');
  const port = 3900 + Math.floor(Math.random() * 90);
  const child = spawn(process.execPath, [require('path').join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), PD_TIME_SCALE: '0.05' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  process.on('exit', () => child.kill());
  child.stdout.once('data', () => fn(`ws://localhost:${port}`));
}

if (ROOM) {
  console.log(`${BOTS} bots joining ${ROOM} on ${SERVER}`);
  Promise.all(Array.from({ length: BOTS }, (_, i) => new Promise((r) => setTimeout(() => r(bot(i, ROOM.toUpperCase())), i * 250))))
    .then(() => { console.log('game over'); process.exit(failures ? 1 : 0); });
} else {
  withTestServer((url) => { if (url) SERVER = url; fullAuto(); });
}
