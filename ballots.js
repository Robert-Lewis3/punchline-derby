// Ballot allocation: decides which answers each phone gets to vote between.
//
// Goals, in priority order:
//   1. Nobody ever sees their own answer.
//   2. Every answer is shown (roughly) the same number of times, so raw votes
//      won is a fair score — a lucky answer can't win just by appearing more.
//   3. A voter doesn't see the same answer twice in a round (when avoidable).
//
// Size adapts to the group: 3 answers per ballot below 12 entries, 4 at 12+,
// and as many ballots (max 5) as fit without repeating answers for a voter.
// 8 players -> 2 ballots of 3; 25 players -> 5 ballots of 4.

const MAX_BALLOTS = 5;

function ballotPlan(entryCount) {
  const size = Math.min(entryCount >= 12 ? 4 : 3, entryCount - 1);
  if (size < 2) return { size: 0, count: 0 };
  const count = Math.max(1, Math.min(MAX_BALLOTS, Math.floor((entryCount - 1) / size)));
  return { size, count };
}

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * @param entries  [{ id, authorId }]
 * @param voterIds [playerId]
 * @returns Map<voterId, Array<entryId[]>>  one array of entry ids per ballot
 */
function buildBallots(entries, voterIds, rng = Math.random) {
  const ballots = new Map(voterIds.map((v) => [v, []]));
  const { size, count } = ballotPlan(entries.length);
  if (!size) return ballots;

  const exposure = new Map(entries.map((e) => [e.id, 0]));
  const seen = new Map(voterIds.map((v) => [v, new Set()]));

  for (let round = 0; round < count; round++) {
    for (const voter of shuffle(voterIds.slice(), rng)) {
      const eligible = entries.filter((e) => e.authorId !== voter);
      if (eligible.length < 2) continue;
      const mine = seen.get(voter);
      const ranked = eligible
        .map((e) => ({ e, unseen: mine.has(e.id) ? 1 : 0, exp: exposure.get(e.id), r: rng() }))
        .sort((a, b) => a.unseen - b.unseen || a.exp - b.exp || a.r - b.r);
      const picked = ranked.slice(0, Math.min(size, eligible.length)).map((x) => x.e.id);
      for (const id of picked) {
        exposure.set(id, exposure.get(id) + 1);
        mine.add(id);
      }
      ballots.get(voter).push(picked);
    }
  }
  rebalance(entries, ballots, exposure, seen);
  for (const list of ballots.values()) for (const b of list) shuffle(b, rng);
  return ballots;
}

// The greedy pass can leave a spread of 2; swap the most-shown answer for the
// least-shown one on some ballot where that's legal until the spread is <= 1.
function rebalance(entries, ballots, exposure, seen) {
  const author = new Map(entries.map((e) => [e.id, e.authorId]));
  for (let guard = 0; guard < 10000; guard++) {
    const sorted = [...exposure.entries()].sort((a, b) => a[1] - b[1]);
    if (sorted[sorted.length - 1][1] - sorted[0][1] <= 1) return;
    const minExp = sorted[0][1];
    const maxExp = sorted[sorted.length - 1][1];
    const lows = sorted.filter(([, x]) => x === minExp).map(([id]) => id);
    const highs = sorted.filter(([, x]) => x === maxExp).map(([id]) => id);
    let swapped = false;
    outer: for (const [voter, list] of ballots) {
      const mine = seen.get(voter);
      for (const b of list) {
        const hiIdx = b.findIndex((id) => highs.includes(id));
        if (hiIdx < 0) continue;
        const lo = lows.find((id) => author.get(id) !== voter && !mine.has(id));
        if (!lo) continue;
        const hi = b[hiIdx];
        b[hiIdx] = lo;
        mine.delete(hi);
        mine.add(lo);
        exposure.set(hi, exposure.get(hi) - 1);
        exposure.set(lo, exposure.get(lo) + 1);
        swapped = true;
        break outer;
      }
    }
    if (!swapped) return;
  }
}

module.exports = { ballotPlan, buildBallots, shuffle, MAX_BALLOTS };
