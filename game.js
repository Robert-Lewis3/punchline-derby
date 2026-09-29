// Punchline Derby — authoritative game state for one room.
//
// Phases: lobby -> [prompt -> vote -> reveal -> standings] x rounds -> final
// (after the last round's reveal, "next" goes straight to final, where the
// race leader crosses the finish line).
//
// Scoring: every time your answer is picked on a ballot, you get 1 point and
// your racer moves forward. Ballots are balanced so every answer is shown the
// same number of times (see ballots.js), which keeps raw votes fair. The
// round's top 3 are ranked by win rate (wins / times shown).

const crypto = require('crypto');
const { CHARACTERS, LIMITS } = require('./public/shared.js');
const { buildBallots, ballotPlan, shuffle } = require('./ballots');
const { PROMPTS, GENERIC } = require('./prompts');

const TIME_SCALE = Number(process.env.PD_TIME_SCALE) || 1;
// Points per vote for answers that came from the 🎲 button (1 = full credit).
const GENERATED_POINTS = 1;
const TRAVEL_SHARE = 0.4;
// Stand-in players for testing with fewer than MIN_PLAYERS people.
const BOT_NAMES = ['Bot Bella', 'Bot Otto', 'Bot Zippy', 'Bot Rusty', 'Bot Pixel'];
// Race track scale: a racer whose answers win this share of their matchups
// every round reaches the finish line exactly at the end of the game.
const FINISH_WIN_SHARE = 0.45;

const randomId = (n = 8) => crypto.randomBytes(n).toString('hex').slice(0, n);

function cleanText(s, max) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function voteSeconds(ballotCount) {
  return 12 + 9 * Math.max(1, ballotCount);
}

class Room {
  constructor(code, onChange) {
    this.code = code;
    this.onChange = onChange || (() => {});
    this.hostKey = randomId(16);
    this.players = new Map(); // id -> player
    this.joinCounter = 0;
    this.settings = { rounds: 5, answerSeconds: 60, customPrompts: [] };
    this.usedPromptIds = new Set();
    this.lastActivity = Date.now();
    this.resetGame();
  }

  resetGame() {
    this.clearTimer();
    this.clearBotTimers();
    this.phase = 'lobby';
    this.round = 0;
    this.prompts = [];
    this.cur = null;
    this.history = [];
    for (const p of this.players.values()) {
      p.score = 0;
      p.prevScore = 0;
      p.roundWins = 0;
      p.podiums = 0;
    }
  }

  changed() {
    this.lastActivity = Date.now();
    this.onChange(this);
  }

  // ------------------------------------------------------------- timers
  setTimer(seconds, fn) {
    this.clearTimer();
    const ms = seconds * 1000 * TIME_SCALE;
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(fn, ms);
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
  }

  // Bots act on their own short timers; any phase change cancels them.
  botLater(minSec, maxSec, fn) {
    const ms = (minSec + Math.random() * (maxSec - minSec)) * 1000 * TIME_SCALE;
    this.botTimers.push(setTimeout(fn, ms));
  }

  clearBotTimers() {
    for (const t of this.botTimers || []) clearTimeout(t);
    this.botTimers = [];
  }

  remainingMs() {
    return this.deadline ? Math.max(0, this.deadline - Date.now()) : null;
  }

  // ------------------------------------------------------------ players
  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  addPlayer(name) {
    if (this.players.size >= LIMITS.MAX_PLAYERS) return { error: 'room_full' };
    const p = {
      id: 'p' + randomId(10),
      name: cleanText(name, LIMITS.NAME_MAX) || 'Player',
      char: null,
      connected: true,
      score: 0,
      prevScore: 0,
      roundWins: 0,
      podiums: 0,
      order: this.joinCounter++,
    };
    this.players.set(p.id, p);
    this.changed();
    return { player: p };
  }

  bots() {
    return [...this.players.values()].filter((p) => p.bot);
  }

  addBot() {
    const used = new Set(this.bots().map((b) => b.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot ' + (this.bots().length + 1);
    const { player } = this.addPlayer(name);
    if (player) player.bot = true;
    return player;
  }

  setConnected(id, connected) {
    const p = this.players.get(id);
    if (!p || p.connected === connected) return;
    p.connected = connected;
    this.checkPhaseComplete();
    this.changed();
  }

  takenChars(exceptId) {
    const taken = new Set();
    for (const p of this.players.values()) if (p.id !== exceptId && p.char) taken.add(p.char);
    return taken;
  }

  pickChar(id, charId) {
    const p = this.players.get(id);
    if (!p) return 'no_player';
    if (!CHARACTERS.some((c) => c.id === charId)) return 'bad_character';
    const taken = this.takenChars(id);
    // Characters are unique until there are more players than characters.
    if (taken.has(charId) && taken.size < CHARACTERS.length) return 'character_taken';
    p.char = charId;
    this.changed();
    return null;
  }

  kick(id) {
    if (!this.players.delete(id)) return;
    this.checkPhaseComplete();
    this.changed();
  }

  updateSettings(s) {
    if (this.phase !== 'lobby') return;
    if (s.rounds !== undefined) {
      const r = Math.round(Number(s.rounds));
      if (r >= LIMITS.ROUNDS_MIN && r <= LIMITS.ROUNDS_MAX) this.settings.rounds = r;
    }
    if (s.answerSeconds !== undefined && LIMITS.ANSWER_SECONDS.includes(Number(s.answerSeconds))) {
      this.settings.answerSeconds = Number(s.answerSeconds);
    }
    if (Array.isArray(s.customPrompts)) {
      this.settings.customPrompts = s.customPrompts
        .map((t) => cleanText(t, LIMITS.PROMPT_MAX))
        .filter(Boolean)
        .slice(0, LIMITS.CUSTOM_PROMPTS_MAX);
    }
    this.changed();
  }

  // ------------------------------------------------------------ prompts
  pickPrompts(n) {
    const custom = this.settings.customPrompts.map((text, i) => ({ id: 'c' + i, text, answers: [] }));
    let pool = PROMPTS.filter((p) => !this.usedPromptIds.has(p.id));
    if (pool.length < n) {
      this.usedPromptIds.clear();
      pool = PROMPTS.slice();
    }
    const travel = shuffle(pool.filter((p) => p.travel));
    const general = shuffle(pool.filter((p) => !p.travel));
    const chosen = shuffle(custom).slice(0, n);
    const needTravel = Math.max(0, Math.round((n - chosen.length) * TRAVEL_SHARE));
    chosen.push(...travel.slice(0, needTravel));
    const rest = [...general, ...travel.slice(needTravel)];
    while (chosen.length < n && rest.length) chosen.push(rest.shift());
    for (const p of chosen) this.usedPromptIds.add(p.id);
    return shuffle(chosen);
  }

  generateAnswer(playerId) {
    const cur = this.cur;
    // A reroll puts the previous suggestion back in the pool for others, but
    // never hands the same player the same suggestion twice in a row.
    const last = cur.lastIssued.get(playerId);
    if (last) cur.usedGenerated.delete(last);
    const fresh = (list) => list.filter((a) => a !== last && !cur.usedGenerated.has(a));
    let pool = fresh(cur.prompt.answers);
    if (!pool.length) pool = fresh(GENERIC);
    if (!pool.length) pool = GENERIC;
    const text = pool[Math.floor(Math.random() * pool.length)];
    cur.usedGenerated.add(text);
    cur.lastIssued.set(playerId, text);
    if (!cur.issued.has(playerId)) cur.issued.set(playerId, new Set());
    cur.issued.get(playerId).add(text);
    return text;
  }

  // ------------------------------------------------------------- flow
  start({ fillBots = false } = {}) {
    if (this.phase !== 'lobby') return 'not_in_lobby';
    if (fillBots) {
      if (!this.connectedPlayers().some((p) => !p.bot)) return 'no_humans';
      while (this.connectedPlayers().length < LIMITS.MIN_PLAYERS) this.addBot();
    }
    if (this.connectedPlayers().length < LIMITS.MIN_PLAYERS) return 'not_enough_players';
    const taken = this.takenChars();
    const free = shuffle(CHARACTERS.filter((c) => !taken.has(c.id)));
    for (const p of this.players.values()) {
      if (!p.char) p.char = (free.shift() || CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)]).id;
    }
    this.prompts = this.pickPrompts(this.settings.rounds);
    const plan = ballotPlan(this.connectedPlayers().length);
    this.raceScale = Math.max(1, this.prompts.length * plan.size * plan.count * FINISH_WIN_SHARE);
    this.round = 0;
    this.history = [];
    this.beginPrompt();
    return null;
  }

  beginPrompt() {
    this.round++;
    this.cur = {
      prompt: this.prompts[this.round - 1],
      entries: new Map(), // authorId -> { id, authorId, text, generated }
      drafts: new Map(),
      issued: new Map(), // playerId -> Set of 🎲 texts handed to them
      lastIssued: new Map(),
      usedGenerated: new Set(),
      ballots: null, // Map voterId -> [{ options: [entryId], pick }]
      results: null,
    };
    for (const p of this.players.values()) p.prevScore = p.score;
    this.phase = 'prompt';
    this.setTimer(this.settings.answerSeconds, () => this.endPrompt());
    this.clearBotTimers();
    const round = this.round;
    for (const b of this.bots()) {
      this.botLater(3, 12, () => {
        if (this.phase === 'prompt' && this.round === round && this.players.has(b.id)) this.submit(b.id, this.generateAnswer(b.id));
      });
    }
    this.changed();
  }

  addEntry(playerId, text) {
    const issued = this.cur.issued.get(playerId);
    this.cur.entries.set(playerId, {
      id: 'e' + randomId(8),
      authorId: playerId,
      text,
      generated: !!(issued && issued.has(text)),
    });
  }

  submit(playerId, raw) {
    if (this.phase !== 'prompt' || !this.players.has(playerId) || this.cur.entries.has(playerId)) return;
    const text = cleanText(raw, LIMITS.ANSWER_MAX);
    if (!text) return;
    this.addEntry(playerId, text);
    this.checkPhaseComplete();
    this.changed();
  }

  draft(playerId, raw) {
    if (this.phase !== 'prompt' || this.cur.entries.has(playerId)) return;
    this.cur.drafts.set(playerId, cleanText(raw, LIMITS.ANSWER_MAX));
  }

  endPrompt() {
    if (this.phase !== 'prompt') return;
    this.clearTimer();
    // Time's up: use what they typed, or write one for them if they're here.
    for (const p of this.players.values()) {
      if (this.cur.entries.has(p.id)) continue;
      const draft = this.cur.drafts.get(p.id);
      if (draft) this.addEntry(p.id, draft);
      else if (p.connected) this.addEntry(p.id, this.generateAnswer(p.id));
    }
    const entries = [...this.cur.entries.values()];
    const voters = this.connectedPlayers().map((p) => p.id);
    const raw = buildBallots(entries, voters);
    this.cur.ballots = new Map();
    let maxBallots = 0;
    for (const [voter, list] of raw) {
      this.cur.ballots.set(voter, list.map((options) => ({ options, pick: null })));
      maxBallots = Math.max(maxBallots, list.length);
    }
    if (!maxBallots) return this.endVote(); // too few answers to vote on
    this.phase = 'vote';
    this.setTimer(voteSeconds(maxBallots), () => this.endVote());
    this.clearBotTimers();
    for (const b of this.bots()) this.botVote(b.id, 0);
    this.changed();
  }

  vote(playerId, ballotIdx, entryId) {
    if (this.phase !== 'vote') return;
    const list = this.cur.ballots.get(playerId);
    const b = list && list[ballotIdx];
    if (!b || b.pick !== null || !b.options.includes(entryId)) return;
    b.pick = entryId;
    this.checkPhaseComplete();
    this.changed();
  }

  botVote(botId, idx) {
    const round = this.round;
    this.botLater(2, 5, () => {
      if (this.phase !== 'vote' || this.round !== round) return;
      const b = (this.cur.ballots.get(botId) || [])[idx];
      if (!b) return;
      this.vote(botId, idx, b.options[Math.floor(Math.random() * b.options.length)]);
      this.botVote(botId, idx + 1);
    });
  }

  voterDone(playerId) {
    const list = this.cur && this.cur.ballots && this.cur.ballots.get(playerId);
    return !!list && list.every((b) => b.pick !== null);
  }

  checkPhaseComplete() {
    if (this.phase === 'prompt') {
      const here = this.connectedPlayers();
      if (here.length && here.every((p) => this.cur.entries.has(p.id))) this.endPrompt();
    } else if (this.phase === 'vote') {
      const voters = this.connectedPlayers().filter((p) => this.cur.ballots.has(p.id) && this.cur.ballots.get(p.id).length);
      if (voters.length && voters.every((p) => this.voterDone(p.id))) this.endVote();
    }
  }

  endVote() {
    if (this.phase !== 'vote' && this.phase !== 'prompt') return;
    this.clearTimer();
    const stats = new Map([...this.cur.entries.values()].map((e) => [e.id, { entry: e, wins: 0, shows: 0 }]));
    for (const list of (this.cur.ballots || new Map()).values()) {
      for (const b of list) {
        if (b.pick === null) continue; // unvoted ballots don't count as exposure
        for (const id of b.options) stats.get(id).shows++;
        stats.get(b.pick).wins++;
      }
    }
    const results = shuffle([...stats.values()])
      .map((s) => ({ ...s, rate: s.shows ? s.wins / s.shows : 0 }))
      .sort((a, b) => b.rate - a.rate || b.wins - a.wins);
    results.forEach((r, i) => { r.rank = i + 1; });

    for (const r of results) {
      const p = this.players.get(r.entry.authorId);
      if (p) p.score += r.wins * (r.entry.generated ? GENERATED_POINTS : 1);
    }
    // Tiebreakers for the final standings: round wins, then top-3 finishes.
    results.slice(0, 3).forEach((r, i) => {
      const author = this.players.get(r.entry.authorId);
      if (!author || r.wins === 0) return;
      author.podiums++;
      if (i === 0) author.roundWins++;
    });
    this.cur.results = results;
    this.history.push({ round: this.round, prompt: this.cur.prompt.text, results });
    this.phase = 'reveal';
    this.changed();
  }

  next() {
    if (this.phase === 'reveal') {
      if (this.round >= this.prompts.length) this.finish();
      else { this.phase = 'standings'; this.changed(); }
    } else if (this.phase === 'standings') {
      this.beginPrompt();
    }
  }

  skip() {
    if (this.phase === 'prompt') this.endPrompt();
    else if (this.phase === 'vote') this.endVote();
  }

  finish() {
    this.clearTimer();
    this.phase = 'final';
    this.changed();
  }

  endGame() {
    if (this.phase === 'lobby' || this.phase === 'final') return;
    if (this.phase === 'prompt' || this.phase === 'vote') {
      // Abandon the unfinished round; scores stand as of the last reveal.
      for (const p of this.players.values()) p.score = p.prevScore;
      this.round = Math.max(0, this.round - 1);
    }
    this.finish();
  }

  playAgain() {
    if (this.phase !== 'final') return;
    // Drop anyone who left, and the bots (they're re-added at start if still needed).
    for (const p of [...this.players.values()]) if (!p.connected || p.bot) this.players.delete(p.id);
    this.resetGame();
    this.changed();
  }

  // ------------------------------------------------------------- views
  standings() {
    const list = [...this.players.values()].sort(
      (a, b) => b.score - a.score || b.roundWins - a.roundWins || b.podiums - a.podiums || a.order - b.order,
    );
    let rank = 0;
    return list.map((p, i) => {
      const prev = list[i - 1];
      if (!prev || prev.score !== p.score || prev.roundWins !== p.roundWins || prev.podiums !== p.podiums) rank = i + 1;
      return { id: p.id, rank, score: p.score };
    });
  }

  resultCard(r) {
    const p = this.players.get(r.entry.authorId);
    return {
      text: r.entry.text,
      generated: r.entry.generated,
      wins: r.wins,
      shows: r.shows,
      rank: r.rank,
      author: p ? { id: p.id, name: p.name, char: p.char } : { id: null, name: '(left)', char: null },
    };
  }

  bestAnswer() {
    let best = null;
    for (const h of this.history) {
      for (const r of h.results) {
        if (r.shows < 2 || r.wins === 0) continue;
        if (!best || r.rate > best.r.rate || (r.rate === best.r.rate && r.wins > best.r.wins)) best = { r, prompt: h.prompt };
      }
    }
    return best ? { prompt: best.prompt, ...this.resultCard(best.r) } : null;
  }

  showResults() {
    return ['reveal', 'standings'].includes(this.phase) && this.cur && this.cur.results;
  }

  hostView() {
    const cur = this.cur;
    const inRound = ['prompt', 'vote', 'reveal', 'standings'].includes(this.phase);
    const players = [...this.players.values()]
      .sort((a, b) => a.order - b.order)
      .map((p) => ({
        id: p.id,
        name: p.name,
        char: p.char,
        connected: p.connected,
        bot: !!p.bot,
        score: p.score,
        prevScore: p.prevScore,
        submitted: this.phase === 'prompt' ? cur.entries.has(p.id) : undefined,
        voted: this.phase === 'vote' && cur.ballots.has(p.id) && cur.ballots.get(p.id).length ? this.voterDone(p.id) : undefined,
      }));
    const view = {
      code: this.code,
      phase: this.phase,
      round: this.round,
      rounds: this.phase === 'lobby' ? this.settings.rounds : this.prompts.length,
      settings: this.settings,
      players,
      canStart: this.connectedPlayers().length >= LIMITS.MIN_PLAYERS,
      remainingMs: this.remainingMs(),
      prompt: inRound ? cur.prompt.text : null,
      standings: this.standings(),
      raceScale: this.raceScale || 1,
    };
    if (this.showResults()) {
      view.top3 = cur.results.slice(0, 3).map((r) => this.resultCard(r));
      view.entryCount = cur.results.length;
    }
    if (this.phase === 'final') {
      view.bestAnswer = this.bestAnswer();
    }
    return view;
  }

  playerView(id) {
    const p = this.players.get(id);
    if (!p) return null;
    const cur = this.cur;
    const inRound = ['prompt', 'vote', 'reveal', 'standings'].includes(this.phase);
    const standing = this.standings().find((s) => s.id === id);
    const view = {
      phase: this.phase,
      round: this.round,
      rounds: this.phase === 'lobby' ? this.settings.rounds : this.prompts.length,
      remainingMs: this.remainingMs(),
      prompt: inRound ? cur.prompt.text : null,
      me: { id: p.id, name: p.name, char: p.char, score: p.score, delta: p.score - p.prevScore, rank: standing.rank },
      playerCount: this.players.size,
      taken: [...this.takenChars(id)],
    };
    if (this.phase === 'prompt') {
      const e = cur.entries.get(id);
      view.submitted = !!e;
      view.myAnswer = e ? e.text : null;
    }
    if (this.phase === 'vote') {
      const byId = new Map([...cur.entries.values()].map((e) => [e.id, e.text]));
      const list = cur.ballots.get(id) || [];
      view.ballots = list.map((b) => ({ options: b.options.map((eid) => ({ id: eid, text: byId.get(eid) })), pick: b.pick }));
    }
    if (this.showResults()) {
      view.top3 = cur.results.slice(0, 3).map((r) => this.resultCard(r));
      const mine = cur.results.find((r) => r.entry.authorId === id);
      view.myResult = mine ? { ...this.resultCard(mine), of: cur.results.length } : null;
    }
    if (this.phase === 'final') {
      view.podium = this.standings().slice(0, 3).map((s) => {
        const q = this.players.get(s.id);
        return { rank: s.rank, name: q.name, char: q.char, score: q.score };
      });
      view.bestAnswer = this.bestAnswer();
    }
    return view;
  }
}

module.exports = { Room, cleanText, voteSeconds };
