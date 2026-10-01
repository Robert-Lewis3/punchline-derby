# Punchline Derby 🏇

A phone party game for 3–40 people. Everyone answers the same prompt, votes on
the funniest answers, and every vote your answer wins moves your racer forward.
Most points after the last round crosses the finish line.

## How a game runs

1. **Host** opens `/host` on the laptop driving the big screen. A QR code and a
   4-letter room code appear.
2. **Players** scan the QR, type a name, and pick a racer (36 characters).
3. Each round:
   - **Prompt** (45/60/90 s): everyone types an answer. Stuck? **🎲 Write it for
     me** fills in a joke; they can edit it or tap again for another. If time
     runs out, whatever they'd typed is entered. If they typed nothing, one is
     written for them.
   - **Vote**: each phone gets a few ballots of 3–4 anonymous answers (never
     their own) and taps the funniest on each.
   - **Reveal**: the big screen shows 3rd, 2nd, then 1st with authors.
     Answers that came from the 🎲 button get a "🎲 assist" badge.
   - **Race**: racers move forward by the votes they won.
4. After the last round the leader crosses the finish line, and the screen shows
   the podium and the answer of the game.

Host keys: **Space / Enter / →** next · **F** fullscreen · **M** mute.

**Testing solo:** with fewer than 3 people joined, the lobby shows
**🤖 Start with N bots**, which fills the empty seats with bots. The bots answer
with 🎲 jokes and vote at random. They're removed when you hit Play again.

### Why it scales from 8 to 25+ people

Ballots are sized to the group (`ballots.js`):

| Players | Ballots per phone | Answers per ballot | Times each answer is shown |
|---|---|---|---|
| 3 | 1 | 2 | 2 |
| 8 | 2 | 3 | 6 |
| 12 | 2 | 4 | 8 |
| 25 | 5 | 4 | 20 |
| 40 | 5 | 4 | 20 |

Every answer is shown the same number of times (±1), so raw votes are a fair
score. Top 3 is ranked by win rate. Ties in the final standings are broken by
round wins, then by top-3 finishes.

**Round max.** One answer can earn at most 60% of its matchups in points per
round (8 players: 4 points, 13: 8, 20: 10). The track is sized so a racer who
hits the max every round arrives right at the finish line. So no single round,
even a unanimous one, can move anyone more than 1/rounds of the track, and
nobody crosses before the final screen. Reveal cards and the race show
"round max" when it kicks in.

## Editing prompts

All prompts live in `prompts.js`: 52 of them (22 travel), each with 20 canned
🎲 answers (enough for a 20-person game to all use it on one prompt), plus a
`GENERIC` pool for custom prompts. Add or edit entries freely; `npm test`
checks that ids are unique and each prompt has 20+ answers. `travel: true`
prompts make up about 40% of each game.

The host can also type **custom prompts** in the lobby (one per line), which are
mixed into the game. Good for inside jokes.

Tuning knobs at the top of `game.js`:
- `GENERATED_POINTS`: points per vote for 🎲 answers (1 = full credit, 0.5 = half)
- `TRAVEL_SHARE`: share of rounds that use travel prompts
- `MAX_ROUND_SHARE`: the round max, as a share of an answer's matchups (also sets track length)

## Running it

**Local (same Wi-Fi):** double-click `Start local game.bat`, or run `npm start` and
open http://localhost:3000/host. The QR code automatically uses the laptop's
Wi-Fi address. Windows may ask to allow Node through the firewall; allow it on
private networks.

**Hosted:** deploy to Render with the included `render.yaml` (Blueprint). Free
tier works; it sleeps after 15 min idle, so open `/host` a minute or two
before the game starts to wake it up.

## Tests

```bash
npm test
```

Runs the ballot fairness tests for 3–40 players, the prompt-pack checks, then a full bot game. `npm run sim --
--bots 25 --rounds 5` plays a bigger game. `node test/sim.js --room ABCD --bots 12`
adds bots to a room you're hosting in a browser. Add `--rig` to make them all
vote for one bot, to see the round max in action.

## Files

- `server.js`: HTTP + WebSocket routing, QR endpoint
- `game.js`: game state machine, scoring, per-screen views
- `ballots.js`: fair ballot allocation
- `prompts.js`: prompt pack and 🎲 answers
- `public/index.html`: phone page · `public/host.html`: big screen
- `public/shared.js`: characters and limits shared by server and pages
- Sounds: Kenney (CC0), `public/audio/`
