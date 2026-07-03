/* 2026 Palmer Cup — bracket structure & teams.
 *
 * Each side (left/right) is a 32-leaf single-elimination tree.
 * Leaves come in groups of 4: [bye-team, BYE, team A, team B].
 * Byes auto-advance; every other match is decided by a row in Supabase
 * (palmer_matches: id, winner 1|2, score).
 *
 * Match ids: L1-1..L1-8, L2-1..L2-8, L3-1..L3-4, L4-1..L4-2, L5-1  (left)
 *            R1-*, ...                                            (right)
 *            F1  (championship, left champ = slot 1, right champ = slot 2)
 * Round 1 ids map to the real (non-bye) matches only.
 */

const EVENT = {
  title: '2026 Palmer Cup',
  club: 'Palmer Cup',
  rounds: [
    { n: 1, label: 'Round 1', due: 'May 31' },
    { n: 2, label: 'Round 2', due: 'Jun 30' },
    { n: 3, label: 'Quarterfinals', due: 'Jul 31' },
    { n: 4, label: 'Semifinals', due: 'Aug 30' },
    { n: 5, label: 'Finals', due: 'Sep 30' },
    { n: 6, label: 'Championship', due: 'Oct 31' },
  ],
};

/* g: [bye team, match team A, match team B] — short name, full names */
const T = (short, full) => ({ short, full: full || short });

const LEFT = [
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

const RIGHT = [
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

/* ---- bracket engine -------------------------------------------------- */

const BYE = { short: 'Bye', full: 'Bye', isBye: true };

/* Build, for one side, the list of matches per round with slot indices.
 * Round r has 2^(5-r) slots (r=1 → 32 leaf slots ... r=5 → 2 slots).
 * results: map matchId -> {winner, score} */
function buildSide(sideKey, groups, results) {
  const S = sideKey === 'left' ? 'L' : 'R';
  // leaves (round-1 column, 32 slots)
  const leaves = [];
  groups.forEach((g) => { leaves.push(g.bye, BYE, g.a, g.b); });

  // resolve(r, i) -> team occupying slot i of round r's column (or null if TBD)
  // round 1 slots are the leaves; round r slot i is the winner feeding up
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
      const id = matchId(S, r - 1, i);
      const res = results[id];
      if (res && res.winner) out = res.winner === 1 ? top : bot;
    }
    memo[key] = out;
    return out;
  }

  // id of the match at round r that feeds round r+1 slot i
  function matchId(S, r, i) {
    if (r === 1) {
      // round-1 real matches sit under odd r2 slots (i odd); group = (i-1)/2
      return `${S}1-${(i - 1) / 2 + 1}`;
    }
    return `${S}${r}-${i + 1}`;
  }

  // emit column data: for each round, the slots (team or null) and match refs
  const columns = [];
  for (let r = 1; r <= 5; r++) {
    const n = 2 ** (6 - r); // 32,16,8,4,2
    const slots = [];
    for (let i = 0; i < n; i++) {
      const team = resolve(r, i);
      // which match does this slot belong to (pairs 2k,2k+1 feed round r+1 slot k)
      const feed = Math.floor(i / 2);
      let mid = null, decided = null;
      const partner = i % 2 === 0 ? resolve(r, i + 1) : resolve(r, i - 1);
      const isByePair = (team && team.isBye) || (partner && partner.isBye);
      if (!isByePair) {
        mid = matchId(S, r, feed);
        decided = results[mid] || null;
      }
      // bye pair: the real team auto-advances (GG shows these as winners)
      const autoWin = isByePair && team && !team.isBye;
      slots.push({ r, i, team, matchId: mid, result: decided, autoWin });
    }
    columns.push(slots);
  }
  // side champion = winner of S5-1
  const champ = (() => {
    const top = resolve(5, 0), bot = resolve(5, 1);
    const res = results[`${S}5-1`];
    if (res && res.winner && top && bot) return res.winner === 1 ? top : bot;
    return null;
  })();
  return { columns, champ };
}

function buildBracket(results) {
  const left = buildSide('left', LEFT, results);
  const right = buildSide('right', RIGHT, results);
  const fRes = results['F1'];
  let champion = null;
  if (fRes && fRes.winner && left.champ && right.champ) {
    champion = fRes.winner === 1 ? left.champ : right.champ;
  }
  return { left, right, final: { top: left.champ, bot: right.champ, result: fRes || null, champion } };
}

/* Flat list of every decidable match, for the admin page. */
function allMatches(results) {
  const out = [];
  [['left', LEFT, 'L'], ['right', RIGHT, 'R']].forEach(([sideKey, groups, S]) => {
    const side = buildSide(sideKey, groups, results);
    for (let r = 1; r <= 5; r++) {
      const slots = side.columns[r - 1];
      for (let i = 0; i < slots.length; i += 2) {
        const a = slots[i], b = slots[i + 1];
        if (!a.matchId) continue; // bye pair
        out.push({
          id: a.matchId, side: sideKey, round: r,
          top: a.team, bot: b.team,
          result: results[a.matchId] || null,
        });
      }
    }
  });
  const b = buildBracket(results);
  out.push({ id: 'F1', side: 'final', round: 6, top: b.final.top, bot: b.final.bot, result: results['F1'] || null });
  return out;
}
