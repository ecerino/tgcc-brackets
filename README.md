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
  caches for 15 minutes, and returns a compact JSON summary. The page shows
  uniform four-column tiles in date order: upcoming tournaments under
  "Club Tournaments" (tagged and color-coded Men's/Women's/Mixed), the
  recurring leagues (Guys' Night Out, Morning Drive, SWAT, WGA) under
  "Weekly Events" with their next round date, and a Junior/Adult
  instruction band underneath. Every tile carries the event date, the
  registration deadline or opening date, and the portal's registration
  status (Open / Closed / Opening Soon). Refreshes every 30 minutes; pin
  it with `/?slide=events`.
- The admin PIN is stored in the `palmer_config` table (service-role only).
  Change it any time in Supabase:
  `update palmer_config set value = 'NEWPIN' where key = 'admin_pin';`

## Match IDs

`L`/`R` side + round + match number, e.g. `L2-5` = left bracket, round 2,
match 5 (top to bottom). `F1` is the championship. Round due dates:
May 31 → Jun 30 → Jul 31 → Aug 30 → Sep 30 → championship Oct 31.

## Deploy

Static site on Vercel (project `tgcc-brackets`) — no build step.
