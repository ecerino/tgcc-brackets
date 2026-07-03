# 2026 Palmer Cup — TV Bracket Display

Rotating 16:9 bracket board for the screen outside the golf shop, recreated
digitally from the printed 13×19 TV bracket in the Golf Genius style.

## Pages

| Page | Purpose |
|---|---|
| `/` | The display. Fixed 1920×1080 design scaled to fill any 16:9 screen. Shows the **full bracket, static** with a comfortable margin. Polls for new results every 45 s. |
| `/admin` | Phone-friendly results entry. PIN-protected. Tap the winning team, optionally pick a match-play score (3&2, 1 UP, …). The board updates itself within a minute. |

### Display URL options

- `/?rotate=1` — bring back the full → left-zoom → right-zoom rotation loop
- `/?view=left` / `/?view=right` — pin a zoomed half

## How it works

- **Bracket structure & team names** live in `js/data.js` (from the Golf Genius
  bracket). Byes advance automatically.
- **Results only** live in Supabase (`palmer_matches`: match id, winner 1/2,
  score). Public read via RLS; writes only through the `palmer-admin` edge
  function, which checks the admin PIN server-side.
- The admin PIN is stored in the `palmer_config` table (service-role only).
  Change it any time in Supabase:
  `update palmer_config set value = 'NEWPIN' where key = 'admin_pin';`

## Match IDs

`L`/`R` side + round + match number, e.g. `L2-5` = left bracket, round 2,
match 5 (top to bottom). `F1` is the championship. Round due dates:
May 31 → Jun 30 → Jul 31 → Aug 30 → Sep 30 → championship Oct 31.

## Deploy

Static site on Vercel (project `tgcc-brackets`) — no build step.
