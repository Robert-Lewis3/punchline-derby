// node --test test/
const test = require('node:test');
const assert = require('node:assert');
const { buildBallots, ballotPlan } = require('../ballots');

function setup(n) {
  const voters = Array.from({ length: n }, (_, i) => 'p' + i);
  const entries = voters.map((v, i) => ({ id: 'e' + i, authorId: v }));
  return { voters, entries };
}

for (let n = 3; n <= 40; n++) {
  test(`ballots for ${n} players`, () => {
    const { voters, entries } = setup(n);
    for (let trial = 0; trial < 20; trial++) {
      const ballots = buildBallots(entries, voters);
      const { size, count } = ballotPlan(n);
      const exposure = new Map(entries.map((e) => [e.id, 0]));
      for (const v of voters) {
        const list = ballots.get(v);
        assert.strictEqual(list.length, count);
        const seen = new Set();
        for (const b of list) {
          assert.strictEqual(b.length, size);
          assert.strictEqual(new Set(b).size, b.length, 'no duplicate on one ballot');
          for (const id of b) {
            assert.notStrictEqual(entries.find((e) => e.id === id).authorId, v, 'never your own answer');
            assert.ok(!seen.has(id), 'no repeats for one voter');
            seen.add(id);
            exposure.set(id, exposure.get(id) + 1);
          }
        }
      }
      const vals = [...exposure.values()];
      assert.ok(Math.max(...vals) - Math.min(...vals) <= 1, `balanced exposure: ${vals}`);
    }
  });
}

test('extra voters without answers still get ballots', () => {
  const { voters, entries } = setup(8);
  const all = [...voters, 'late1', 'late2'];
  const ballots = buildBallots(entries, all);
  assert.strictEqual(ballots.get('late1').length, ballotPlan(8).count);
});

test('tiny rooms', () => {
  assert.deepStrictEqual(ballotPlan(2), { size: 0, count: 0 });
  assert.deepStrictEqual(ballotPlan(3), { size: 2, count: 1 });
  assert.deepStrictEqual(ballotPlan(8), { size: 3, count: 2 });
  assert.deepStrictEqual(ballotPlan(25), { size: 4, count: 5 });
});
