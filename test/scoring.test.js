// node --test test/scoring.test.js — per-round point cap
const test = require('node:test');
const assert = require('node:assert');
const { Room } = require('../game');

function playUnanimousRound(n, rounds = 5) {
  const room = new Room('TEST');
  room.settings.rounds = rounds;
  const ids = Array.from({ length: n }, (_, i) => room.addPlayer('P' + i).player.id);
  room.start();
  ids.forEach((id, i) => room.submit(id, 'Answer ' + i));
  const star = room.cur.entries.get(ids[0]).id;
  // Everyone picks the star answer whenever it's on their ballot.
  for (const [voter, list] of room.cur.ballots) {
    list.forEach((b, i) => room.vote(voter, i, b.options.includes(star) ? star : b.options[0]));
  }
  room.clearTimer();
  const top = room.cur.results.find((r) => r.entry.authorId === ids[0]);
  return { room, top, starPlayer: room.players.get(ids[0]) };
}

for (const n of [3, 8, 13, 20]) {
  for (const rounds of [3, 5]) {
    test(`${n} players, ${rounds} rounds: a unanimous round is capped`, () => {
      const { room, top, starPlayer } = playUnanimousRound(n, rounds);
      assert.strictEqual(top.wins, top.shows, 'won every matchup');
      assert.strictEqual(starPlayer.score, room.roundCap);
      assert.strictEqual(top.capped, n > 3); // 3 players: only 2 matchups, nothing to cap
      const trackShare = starPlayer.score / room.raceScale;
      assert.ok(trackShare <= 1 / rounds + 1e-9, `moved ${trackShare} of the track in one round`);
    });
  }
}

test('cap sizes by group', () => {
  const cap = (n) => playUnanimousRound(n).room.roundCap;
  assert.strictEqual(cap(8), 4); // 6 matchups per answer
  assert.strictEqual(cap(13), 8); // 12 matchups
  assert.strictEqual(cap(20), 10); // 16 matchups
});
