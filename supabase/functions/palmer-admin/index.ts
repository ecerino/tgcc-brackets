// Brackets admin API — PIN-checked writes to palmer_matches and board_config.
// Auth is a shared PIN stored in palmer_config (service-role only table),
// so verify_jwt is disabled and this function is the only write path.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// <bracketId>:<matchId> e.g. palmer:L2-5, mpt-blue-f1:R1-3, winnie:F1
const MATCH_ID = /^[a-z0-9-]{1,40}:([LR][1-9]-[0-9]{1,2}|F1)$/;

// board_config keys the admin may write, with validation per key
// deno-lint-ignore no-explicit-any
function sanitizeConfig(key: string, value: any): unknown | null {
  if (key === 'messages') {
    if (!Array.isArray(value)) return null;
    return value
      .filter((m) => typeof m === 'string' && m.trim())
      .map((m) => m.trim().slice(0, 160))
      .slice(0, 10);
  }
  if (key === 'slide_order') {
    if (!Array.isArray(value)) return null;
    const names = value.filter((n) => typeof n === 'string' && /^[a-z0-9-]{1,30}$/.test(n));
    return names.length && names.length <= 12 ? names : null;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const { pin, action, match_id, winner, score, key, value } = await req.json();
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: cfg, error: cfgErr } = await sb
      .from('palmer_config').select('value').eq('key', 'admin_pin').single();
    if (cfgErr || !cfg) return json({ error: 'config unavailable' }, 500);
    if (typeof pin !== 'string' || pin !== cfg.value) return json({ error: 'bad pin' }, 401);

    if (action === 'verify') return json({ ok: true });

    if (action === 'set_config') {
      if (typeof key !== 'string') return json({ error: 'bad key' }, 400);
      const clean = sanitizeConfig(key, value);
      if (clean === null) return json({ error: 'bad value for ' + key }, 400);
      const { error } = await sb.from('board_config').upsert({
        key, value: clean, updated_at: new Date().toISOString(),
      });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, value: clean });
    }

    if (typeof match_id !== 'string' || !MATCH_ID.test(match_id)) {
      return json({ error: 'bad match id' }, 400);
    }

    if (action === 'set') {
      if (winner !== 1 && winner !== 2) return json({ error: 'winner must be 1 or 2' }, 400);
      const sc = typeof score === 'string' && score.trim() ? score.trim().slice(0, 30) : null;
      const { error } = await sb.from('palmer_matches').upsert({
        id: match_id, winner, score: sc, updated_at: new Date().toISOString(),
      });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === 'clear') {
      const { error } = await sb.from('palmer_matches').delete().eq('id', match_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: 'bad action' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 400);
  }
});
