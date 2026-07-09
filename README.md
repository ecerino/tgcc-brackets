# 2026 Palmer Cup — TV Bracket Display

Rotating 16:9 bracket board for the screen outside the golf shop, recreated
digitally from the printed 13×19 TV bracket in the Golf Genius style.

## Pages

| Page | Purpose |
|---|---|
| `/` | The display. Fixed 1920×1080 design scaled to fill any 16:9 screen. Shows the **full bracket, static** with a comfortable margin. Polls for new results every 45 s. |
| `/admin` | Phone-friendly board manager. PIN-protected. **Board** tab: up to five ticker messages that scroll across the top of the TV, plus the slide rotation with live previews you can reorder. **Results** tab: the manual bracket editor, for anything Golf Genius doesn't have. |

### Display URL options

- `/?rotate=1` — bring back the full → left-zoom → right-zoom rotation loop
- `/?view=left` / `/?view=right` — pin a zoomed half

## How it works

- **Bracket structure & team names** live in `js/data.js` (from the Golf Genius
  bracket). Byes advance automatically.
- **Bracket pages** render as classic line brackets (`.brview.lines`): no
  boxes, each name sits on its connector line in plain black regular-case
  type, and the match winner's name is bold. The score carries the bracket's
  accent color instead of the name. Every flight (men's and women's)
  alternates red/green down the pages; the Palmer Cup colors its scores on a
  diagonal (red top-left & bottom-right, green top-right & bottom-left). The
  connector lines are a dark tan (`#8c8368`). The finalists and champion sit
  on their own slot lines in the center, with the champion linked to the
  final by a short connector; the whole championship column is centered so
  it has an even amount of space above and below. The older white-badge look
  is still in the CSS as `.brview.basic` if ever wanted.
- **Page layout**: Page 1 is the Palmer Cup alone — the page title is
  "2026 Match Play Tournaments" and "Men's Palmer Cup" prints as a centered
  title above the semifinals, matching the flight titles on the other pages.
  Pages 2–4 stack the 16-player flights (4, 3, and 4 brackets) as full-width
  bands, all titled "2026 Match Play Tournaments" with each bracket labeled
  in its center column. Four-up pages shrink to `.band-sm` sizing to fit.
- **Results sync themselves from Golf Genius.** The `gg-results` edge
  function (`supabase/functions/gg-results/index.ts`) scrapes each match
  play event's public bracket pages on the portal (Palmer Cup, Match Play
  Championship, all eight MPT flights, WGA Individual, Winnie Cup),
  returning every decided match as a name pair + winner + score, cached
  10 minutes. The display fetches it every 10 minutes and maps the pairs
  onto its own brackets by matching player/team names round by round —
  the portal is the official record, so it overrides hand-entered rows.
- **Manual results** still live in Supabase (`palmer_matches`: match id,
  winner 1/2, score) and fill anything the portal doesn't have. Writes go
  through the `palmer-admin` edge function, which checks the admin PIN
  server-side. The `/admin` Results tab shows only the hand-entered results.
- **Ticker & slide order** live in the `board_config` table (public read,
  writes via `palmer-admin` with the same PIN). When any messages exist they
  scroll across a thin bar at the top of the screen and the board slides
  down beneath it; clearing all messages hides the bar. The saved slide
  order reorders the rotation. The display re-reads both every minute.
- **Upcoming Golf Events** (the last rotation page) come live from the club's
  Golf Genius portal. golfgenius.com doesn't allow cross-origin reads, so the
  display calls the `gg-events` edge function
  (`supabase/functions/gg-events/index.ts`), which pulls the portal's five
  event directories (Men's / Women's / Mixed / Junior / Adult Instruction),
  caches for 15 minutes, and returns a compact JSON summary. For each still-
  running recurring league it also scrapes that league's `next_round` widget
  for its upcoming round dates. The page renders as a plain list on the
  background, date-ordered, in three sections: **Club Tournaments** (tagged
  Men's/Women's/Mixed, with each event's date and registration deadline or
  opening date), **Weekly Events** (the recurring leagues — Guys' Night Out,
  Morning Drive, SWAT, WGA — showing their next three round dates and no
  registration deadline), and **Golf Instruction & Junior Golf** in the same
  row style as the tournaments. Every row shows the portal's registration
  status (Open / Closed / Opening Soon). Rows auto-size to fit. Refreshes
  every 30 minutes; pin it with `/?slide=events`.
- The admin PIN is stored in the `palmer_config` table (service-role only).
  Change it any time in Supabase:
  `update palmer_config set value = 'NEWPIN' where key = 'admin_pin';`

## Match IDs

`L`/`R` side + round + match number, e.g. `L2-5` = left bracket, round 2,
match 5 (top to bottom). `F1` is the championship. Round due dates:
May 31 → Jun 30 → Jul 31 → Aug 30 → Sep 30 → championship Oct 31.

## Deploy

Static site on Vercel (project `tgcc-brackets`) — no build step.
