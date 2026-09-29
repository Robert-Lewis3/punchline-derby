// node --test test/bots.test.js — server-side stand-in bots
process.env.PD_TIME_SCALE = '0.01';
const test = require('node:test');
const assert = require('node:assert');
const { Room } = require('../game');

const until = (fn, ms = 5000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (fn()) { clearInterval(iv); resolve(); } else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout')); }
  }, 5);
});

test('one human + bots plays a whole game', async () => {
  const room = new Room('TEST');
  room.settings.rounds = 3;
  const { player: me } = room.addPlayer('Robert');
  assert.strictEqual(room.start(), 'not_enough_players');
  assert.strictEqual(room.start({ fillBots: true }), null);
  assert.strictEqual(room.players.size, 3);
  assert.strictEqual(room.bots().length, 2);

  for (let r = 1; r <= 3; r++) {
    await until(() => room.phase === 'prompt' && room.round === r);
    room.submit(me.id, 'My answer ' + r);
    await until(() => room.phase === 'vote'); // bots answered, ending the prompt early
    const ballots = room.cur.ballots.get(me.id);
    ballots.forEach((b, i) => room.vote(me.id, i, b.options[0]));
    await until(() => room.phase === 'reveal'); // bots voted too
    assert.ok(room.bots().every((b) => room.voterDone(b.id)));
    room.next();
    if (r < 3) room.next();
  }
  assert.strictEqual(room.phase, 'final');
  room.playAgain();
  assert.strictEqual(room.bots().length, 0, 'bots removed for the next game');
  assert.strictEqual(room.players.size, 1);
});

test('bots need at least one human', () => {
  const room = new Room('TEST');
  assert.strictEqual(room.start({ fillBots: true }), 'no_humans');
});

test('no bots added when enough people joined', () => {
  const room = new Room('TEST');
  for (let i = 0; i < 4; i++) room.addPlayer('P' + i);
  room.start({ fillBots: true });
  room.clearTimer(); room.clearBotTimers();
  assert.strictEqual(room.bots().length, 0);
});
