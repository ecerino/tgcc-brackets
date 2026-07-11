# 2026 Palmer Cup — TV Bracket Display

Rotating 16:9 bracket board for the screen outside the golf shop, recreated
digitally from the printed 13×19 TV bracket in the Golf Genius style.

## Pages

| Page | Purpose |
|---|---|
| `/` | The display. Fixed 1920×1080 design scaled to fill any 16:9 screen. Shows the **full bracket, static** with a comfortable margin. Polls for new results every 45 s. |
| `/admin` | Phone-friendly board manager. PIN-protected. **Board** tab: up to ten ticker messages that scroll across the top of the TV, plus the slide rotation with live previews you can reorder. **Results** tab: the manual bracket editor, for anything Golf Genius doesn't have. |

### Display URL options

- `/?rotate=1` — bring back the full → left-zoom → right-zoom rotation loop
- `/?view=left` / `/?view=right` — pin a zoomed half

## How it works

- **Bracket structure & team names** live in `js/data.js` (from the Golf Genius
  bracket). Byes advance automatically.
- **Bracket pages** render as classic line brackets (`.brview.lines`): no
  boxes, each name sits on its connector line in plain black regular-case
  type, and the match winner's name is bold. The score carries the bracket's
  accent color instead of the name and prints at the top-right of each match
  (the Palmer Cup keeps its first-round scores centered below the pairing).
  Every flight (men's and women's) alternates red/green down the pages; the
  Palmer Cup colors its scores on a diagonal (red top-left & bottom-right,
  green top-right & bottom-left). The connector lines are a dark tan
  (`#8c8368`) with rounded joins. In the center the two finalists are short
  lines toward the middle — each fed from its side's semifinal and kept clear
  of the far edges, with a little space between them — and the champion sits
  in a filled box lower down (near the bottom of the sheet on the full Palmer
  page). Each flight label (gender dropped, e.g. "Blue Tees · Flight 1") is
  the same size and sits near the top of its bracket, well above the final;
  the Palmer Cup page carries no bracket label since the page title already
  names it. The older white-badge look is still in the
  CSS as `.brview.basic` if ever wanted.
- **Page layout**: seven pages. Page 1 is the Palmer Cup alone, titled
  "2026 Men's Palmer Cup". Pages 2–5 stack the men's 16-player flights as
  full-width bands, all titled "2026 Men's Match Play Tournaments"
  (page 2 Championship + Blue F1, page 3 Blue F2 + F3, page 4 Blue/White
  F1–F3, page 5 White F1 + F2). Page 6 is the two women's brackets
  (Individual + Winnie Cup) titled "2026 Women's Match Play Tournaments", and
  page 7 is the events list. Brackets use a fixed band height — two-up pages
  a touch taller than the three-up page so they don't look sparse — with the
  leftover vertical space shared as even margins. The rotation fades between
  pages quickly (~11 s a page).
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
  event directories (Men's / Women's / Mixed / Junior / Adult Instruction,
  using each directory's real Golf Genius name), caches for 15 minutes, and
  returns a compact JSON summary. For each still-running recurring league it
  also scrapes that league's `next_round` widget for its upcoming rounds,
  reading each round's **name** (e.g. "WGA 18H Golf - Queen Bee Round 1")
  alongside its date. The page renders as one date-ordered table with aligned
  columns — **Date · Event · Category · Registration · Deadline** — covering
  the next two months: upcoming tournaments, each league's next three rounds
  (named), and instruction, all interleaved by date rather than grouped by
  type. The category is the full Golf Genius directory name. Rows stretch to
  fill the page and the font scales with the row height, so every item is as
  large and readable as the space allows. Refreshes every 30 minutes; pin it
  with `/?slide=events`.
- The admin PIN is stored in the `palmer_config` table (service-role only).
  Change it any time in Supabase:
  `update palmer_config set value = 'NEWPIN' where key = 'admin_pin';`

## Match IDs

`L`/`R` side + round + match number, e.g. `L2-5` = left bracket, round 2,
match 5 (top to bottom). `F1` is the championship. Round due dates:
May 31 → Jun 30 → Jul 31 → Aug 30 → Sep 30 → championship Oct 31.

## Deploy

Static site on Vercel (project `tgcc-brackets`) — no build step.
