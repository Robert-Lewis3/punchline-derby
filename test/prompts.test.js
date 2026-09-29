// node --test test/prompts.test.js
const test = require('node:test');
const assert = require('node:assert');
const { PROMPTS, GENERIC } = require('../prompts');
const { LIMITS } = require('../public/shared.js');
const { Room } = require('../game');

const MIN_ANSWERS = 20; // max expected group size: everyone can hit 🎲 and get a unique joke

test('prompt ids are unique', () => {
  assert.strictEqual(new Set(PROMPTS.map((p) => p.id)).size, PROMPTS.length);
});

for (const p of PROMPTS) {
  test(`${p.id}: ${p.text}`, () => {
    assert.ok(p.text.length <= LIMITS.PROMPT_MAX);
    const lower = p.answers.map((a) => a.toLowerCase());
    assert.strictEqual(new Set(lower).size, lower.length, 'duplicate answer');
    assert.ok(p.answers.length >= MIN_ANSWERS, `only ${p.answers.length} answers`);
    for (const a of p.answers) assert.ok(a.length <= LIMITS.ANSWER_MAX, `too long: ${a}`);
  });
}

test('generic pool', () => {
  assert.strictEqual(new Set(GENERIC).size, GENERIC.length);
  for (const a of GENERIC) assert.ok(a.length <= LIMITS.ANSWER_MAX);
});

test('20 players all hitting 🎲 get 20 different on-prompt answers', () => {
  const room = new Room('TEST');
  for (let i = 0; i < 20; i++) room.addPlayer('P' + i);
  room.start();
  const prompt = room.cur.prompt;
  const got = [...room.players.keys()].map((id) => room.generateAnswer(id));
  room.clearTimer();
  assert.strictEqual(new Set(got).size, 20);
  for (const a of got) assert.ok(prompt.answers.includes(a), `fell back to generic: ${a}`);
});

test('rerolling returns the old suggestion to the pool', () => {
  const room = new Room('TEST');
  for (let i = 0; i < 3; i++) room.addPlayer('P' + i);
  room.start();
  const id = [...room.players.keys()][0];
  const first = room.generateAnswer(id);
  const second = room.generateAnswer(id);
  room.clearTimer();
  assert.notStrictEqual(first, second);
  assert.ok(!room.cur.usedGenerated.has(first));
});
