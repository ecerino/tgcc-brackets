/* 2026 Match Play brackets — structure & teams.
 *
 * Every bracket is double-sided: `left` and `right` are arrays of leaf slots
 * (a power of two per side), converging on a center Championship.
 *   64-bracket: 32 leaves/side (Palmer Cup: groups of [bye team, BYE, A, B])
 *   16-bracket:  8 leaves/side
 * A leaf is a team {short, full}, BYE, or null (not yet filled in).
 * Byes auto-advance; every other match is decided by a row in Supabase.
 *
 * palmer_matches ids are `<bracketId>:<matchId>` where matchId is
 * `L|R` + round + `-` + slot-fed index (e.g. `palmer:L2-5`), `F1` = final.
 */

const BYE = { short: 'Bye', full: 'Bye', isBye: true };
const T = (short, full) => ({ short, full: full || short });

/* ── Palmer Cup field ─────────────────────────────────────────────────── */

const PALMER_LEFT = [
  { bye: T('Dixon / Usher', 'Troy Dixon / Brad Usher'),
    a: T('Gallardo / Hayes', 'John Gallardo / Darin Hayes'),
    b: T('Donnelly / Pontius', 'Eric Donnelly / Heath Pontius') },
  { bye: T('Branch / Woytowitz', 'Pat Branch / Don Woytowitz'),
    a: T('Ramirez / Rosales', 'Rodolfo Ramirez / Carlos Rosales'),
    b: T('Gabos / Racchini', 'Ian Gabos / Dave Racchini') },
  { bye: T('Knight / Lakomy', 'MJ Knight / Phil Lakomy'),
    a: T('King / Mirasola', 'Eric King / Jim Mirasola'),
    b: T('Derenzo / Gall', 'Joe Derenzo / John Gall') },
  { bye: T('Pace / Perz', 'John Pace / Todd Perz'),
    a: T('Delisio / Joseph', 'Tony Delisio / Ron Joseph'),
    b: T('Bartolini / Manes', 'John Bartolini / Tony Manes') },
  { bye: T('Lathom / Marks', 'Andrew Lathom / Barry Marks'),
    a: T('Kontul / Kontul', 'Justin Kontul / Justin Kontul'),
    b: T('Bleibtrey / Marvich', 'Sean Bleibtrey / Matt Marvich') },
  { bye: T('Hilger / Rausch', 'Jeff Hilger / Walt Rausch'),
    a: T('Heeter / Kairis', 'Jeff Heeter / Ed Kairis'),
    b: T('Lombard / Rakers', 'Tony Lombard / Jason Rakers') },
  { bye: T('Ciarrocca / Tiller', 'Matt Ciarrocca / Dave Tiller'),
    a: T('Farabaugh / Sokoloff', 'Scott Farabaugh / Ned Sokoloff'),
    b: T('Kennedy / Kordenbrock', 'Nic Kennedy / Eric Kordenbrock') },
  { bye: T('Galligan / Spindler', 'Tom Galligan / Jonathan Spindler'),
    a: T('Drzemiecki / Snyder', 'Ryan Drzemiecki / Michael Snyder'),
    b: T("O'Neil / Stevenson", "Brandon O'Neil / Rich Stevenson") },
];

const PALMER_RIGHT = [
  { bye: T('Pifer / Pifer', 'Dave Pifer / Michael Pifer'),
    a: T('Prelipp / Repine', 'Steve Prelipp / Andrew Repine'),
    b: T('Hurt / Sirabella', 'Ryan Hurt / Anthony Sirabella') },
  { bye: T('Corsi / Maziarz', 'Greg Corsi / Tom Maziarz'),
    a: T('Boyd / Pavlik', 'Dan Boyd / Brad Pavlik'),
    b: T('Dargan / Kulkarni', 'Gaurav Dargan / Abhijit Kulkarni') },
  { bye: T('Ashker / Serafini', 'Kameron Ashker / Joey Serafini'),
    a: T('Barkley / Shanley'),
    b: T('Bayuk / Giangiuli', 'Doug Bayuk / Rodney Giangiuli') },
  { bye: T('Doyle / Hurey', 'Moe Doyle / Mike Hurey'),
    a: T('Glew / Laughlin', 'Gary Glew / Kirby Laughlin'),
    b: T('Cavanaugh / Degross', 'Paul Cavanaugh / Dean Degross') },
  { bye: T('Cunningham / French', 'Bob Cunningham / Jonathan French'),
    a: T('Madia / Nehnevajsa', 'Gary Madia / Mike Nehnevajsa'),
    b: T('Martinelli / Zedreck', 'Scott Martinelli / Colin Zedreck') },
  { bye: T('Kenny / Yontz', 'Brad Kenny / Casey Yontz'),
    a: T('Cheponis / Coberly', 'Eric Cheponis / Dave Coberly'),
    b: T('Fennema / Torre', 'Matt Fennema / Nick Torre') },
  { bye: T('Tosatto / Weber', 'John Tosatto / Jared Weber'),
    a: T('Nelson / Spencer', 'Mark Nelson / Lenny Spencer'),
    b: T('McGovern / Siket', 'Jim McGovern / Jarrod Siket') },
  { bye: T('Wagner / Yanief', 'Chris Wagner / Dave Yanief'),
    a: T('Johnston / Mangone', 'Brad Johnston / Jeff Mangone'),
    b: T('Casario / Doyle', 'Joe Casario / Byrne Doyle') },
];

const palmerLeaves = (groups) => groups.flatMap((g) => [g.bye, BYE, g.a, g.b]);
const blank16 = () => Array(8).fill(null);

const PALMER_ROUNDS = [
  { label: 'Round 1', due: 'May 31' },
  { label: 'Round 2', due: 'Jun 30' },
  { label: 'Quarterfinals', due: 'Jul 31' },
  { label: 'Semifinals', due: 'Aug 30' },
  { label: 'Finals', due: 'Sep 30' },
];
const R16 = [
  { label: 'Round 1' },
  { label: 'Quarterfinals' },
  { label: 'Semifinals' },
];

/* ── the rotation ─────────────────────────────────────────────────────── */

const BRACKETS = [
  { id: 'palmer', title: "2026 Men's Palmer Cup", sub: null, size: 64,
    rounds: PALMER_ROUNDS, final: { label: 'Championship', due: 'Oct 31' },
    champLabel: 'Palmer Cup Champions',
    left: palmerLeaves(PALMER_LEFT), right: palmerLeaves(PALMER_RIGHT) },

  { id: 'mpc', title: "2026 Men's Match Play Championship", sub: null, size: 16,
    rounds: R16, final: { label: 'Championship' }, champLabel: 'Champion',
    left: blank16(), right: blank16() },

  { id: 'mpt-blue-f1', title: "2026 Men's Match Play Tournaments",
    sub: 'Blue Tees · Flight 1', size: 16,
    rounds: R16, final: { label: 'Championship' }, champLabel: 'Champion',
    left: blank16(), right: blank16() },
  { id: 'mpt-blue-f2', title: "2026 Men's Match Play Tournaments",
    sub: 'Blue Tees · Flight 2', size: 16,
    rounds: R16, final: { label: 'Championship' }, champLabel: 'Champion',
    left: blank16(), right: blank16() },
  { id: 'mpt-bw-f1', title: "2026 Men's Match Play Tournaments",
    sub: 'Blue/White Tees · Flight 1', size: 16,
    rounds: R16, final: { label: 'Championship' }, champLabel: 'Champion',
    left: blank16(), right: blank16() },
  { id: 'mpt-bw-f2', title: "2026 Men's Match Play Tournaments",
    sub: 'Blue/White Tees · Flight 2', size: 16,
    rounds: R16, final: { label: 'Championship' }, champLabel: 'Champion',
    left: blank16(), right: blank16() },
  { id: 'mpt-bw-f3', title: "2026 Men's Match Play Tournaments",
    sub: 'Blue/White Tees · Flight 3', size: 16,
    rounds: R16, final: { label: 'Championship' }, champLabel: 'Champion',
    left: blank16(), right: blank16() },
  { id: 'mpt-white-f1', title: "2026 Men's Match Play Tournaments",
    sub: 'White Tees · Flight 1', size: 16,
    rounds: R16, final: { label: 'Championship' }, champLabel: 'Champion',
    left: blank16(), right: blank16() },
  { id: 'mpt-white-f2', title: "2026 Men's Match Play Tournaments",
    sub: 'White Tees · Flight 2', size: 16,
    rounds: R16, final: { label: 'Championship' }, champLabel: 'Champion',
    left: blank16(), right: blank16() },

  { id: 'women', title: "2026 Women's Individual Match Play", sub: null, size: 16,
    rounds: R16, final: { label: 'Championship' }, champLabel: 'Champion',
    theme: 'ladies', left: blank16(), right: blank16() },

  { id: 'winnie', title: '2026 WGA Winnie Cup', sub: null, size: 16,
    rounds: R16, final: { label: 'Championship' }, champLabel: 'Winnie Cup Champions',
    theme: 'ladies', left: blank16(), right: blank16() },
];

/* ── bracket engine ───────────────────────────────────────────────────── */

/* results: map matchId -> {winner, score}, already scoped to one bracket */
function buildSide(bracket, sideKey, results) {
  const S = sideKey === 'left' ? 'L' : 'R';
  const leaves = bracket[sideKey];
  const nRounds = Math.round(Math.log2(leaves.length)); // 32→5, 8→3

  const memo = {};
  function resolve(r, i) {
    if (r === 1) return leaves[i];
    const key = r + ':' + i;
    if (key in memo) return memo[key];
    const top = resolve(r - 1, 2 * i);
    const bot = resolve(r - 1, 2 * i + 1);
    let out = null;
    if (bot && bot.isBye) out = top;              // bye auto-advance
    else if (top && top.isBye) out = bot;
    else {
      const res = results[`${S}${r - 1}-${i + 1}`];
      if (res && res.winner) out = res.winner === 1 ? top : bot;
    }
    memo[key] = out;
    return out;
  }

  const columns = [];
  for (let r = 1; r <= nRounds; r++) {
    const n = leaves.length / 2 ** (r - 1);
    const slots = [];
    for (let i = 0; i < n; i++) {
      const team = resolve(r, i);
      const feed = Math.floor(i / 2);
      const partner = i % 2 === 0 ? resolve(r, i + 1) : resolve(r, i - 1);
      const isByePair = (team && team.isBye) || (partner && partner.isBye);
      let mid = null, decided = null;
      if (!isByePair) {
        mid = `${S}${r}-${feed + 1}`;
        decided = results[mid] || null;
      }
      const autoWin = isByePair && team && !team.isBye;
      slots.push({ r, i, team, matchId: mid, result: decided, autoWin });
    }
    columns.push(slots);
  }

  const champ = (() => {
    const top = resolve(nRounds, 0), bot = resolve(nRounds, 1);
    const res = results[`${S}${nRounds}-1`];
    if (res && res.winner && top && bot) return res.winner === 1 ? top : bot;
    return null;
  })();
  return { columns, champ, nRounds };
}

function buildBracket(bracket, results) {
  const left = buildSide(bracket, 'left', results);
  const right = buildSide(bracket, 'right', results);
  const fRes = results['F1'];
  let champion = null;
  if (fRes && fRes.winner && left.champ && right.champ) {
    champion = fRes.winner === 1 ? left.champ : right.champ;
  }
  return { left, right, final: { top: left.champ, bot: right.champ, result: fRes || null, champion } };
}

/* Flat list of every decidable match in one bracket, for the admin page. */
function allMatches(bracket, results) {
  const out = [];
  ['left', 'right'].forEach((sideKey) => {
    const side = buildSide(bracket, sideKey, results);
    side.columns.forEach((slots, ri) => {
      for (let i = 0; i < slots.length; i += 2) {
        const a = slots[i], b = slots[i + 1];
        if (!a.matchId) continue; // bye pair
        out.push({
          id: a.matchId, side: sideKey, round: ri + 1,
          top: a.team, bot: b.team,
          result: results[a.matchId] || null,
        });
      }
    });
  });
  const b = buildBracket(bracket, results);
  out.push({
    id: 'F1', side: 'final', round: bracket.rounds.length + 1,
    top: b.final.top, bot: b.final.bot, result: results['F1'] || null,
  });
  return out;
}
