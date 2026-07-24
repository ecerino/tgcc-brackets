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

// A raffle row saved from the staff hub. Lenient but bounded; config/state are
// free-form JSON the hub owns (entrants, entry rules, prizes, winners).
// deno-lint-ignore no-explicit-any
function sanitizeRaffle(r: any): Record<string, unknown> | null {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(r.id)) return null;
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const row: Record<string, unknown> = {
    id: r.id,
    type: str(r.type, 20) || 'basic',
    name: str(r.name, 120),
    tournament_id: r.tournament_id ? str(r.tournament_id, 64) : null,
    tournament_name: r.tournament_name ? str(r.tournament_name, 200) : null,
    status: r.status === 'complete' ? 'complete' : 'active',
    config: obj(r.config),
    state: obj(r.state),
    updated_at: new Date().toISOString(),
  };
  if (JSON.stringify(row).length > 500000) return null;   // ~0.5 MB ceiling
  return row;
}

// A calcutta row (teams, auction bids/owners, pool config, payouts). Same shape
// as a raffle minus the type; config/state are the hub's own JSON.
// deno-lint-ignore no-explicit-any
function sanitizeCalcutta(r: any): Record<string, unknown> | null {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(r.id)) return null;
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const row: Record<string, unknown> = {
    id: r.id,
    name: str(r.name, 120),
    tournament_id: r.tournament_id ? str(r.tournament_id, 64) : null,
    tournament_name: r.tournament_name ? str(r.tournament_name, 200) : null,
    status: r.status === 'complete' ? 'complete' : 'active',
    config: obj(r.config),
    state: obj(r.state),
    updated_at: new Date().toISOString(),
  };
  if (JSON.stringify(row).length > 800000) return null;   // ~0.8 MB ceiling
  return row;
}

const ORDER_STATUS = ['pending', 'ordered', 'arrived', 'completed', 'cancelled'];

// A special-order row (title, member/customer, status, notes + an optional
// uploaded document tracked in the special-orders storage bucket).
// deno-lint-ignore no-explicit-any
function sanitizeOrder(o: any): Record<string, unknown> | null {
  if (!o || typeof o !== 'object') return null;
  if (typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(o.id)) return null;
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
  return {
    id: o.id,
    title: str(o.title, 200),
    customer: str(o.customer, 160),
    status: ORDER_STATUS.includes(o.status) ? o.status : 'pending',
    notes: str(o.notes, 4000),
    updated_at: new Date().toISOString(),
  };
}

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
  if (key === 'hidden_slides') {
    // may legitimately be empty (everything shown)
    if (!Array.isArray(value)) return null;
    return value.filter((n) => typeof n === 'string' && /^[a-z0-9-]{1,30}$/.test(n)).slice(0, 12);
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const { pin, action, match_id, winner, score, key, value, raffle, raffle_id, calcutta, calcutta_id, order, order_id, file } = await req.json();
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

    if (action === 'save_raffle') {
      const row = sanitizeRaffle(raffle);
      if (!row) return json({ error: 'bad raffle' }, 400);
      const { error } = await sb.from('raffles').upsert(row);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, id: row.id });
    }

    if (action === 'delete_raffle') {
      if (typeof raffle_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(raffle_id)) {
        return json({ error: 'bad raffle id' }, 400);
      }
      const { error } = await sb.from('raffles').delete().eq('id', raffle_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === 'save_calcutta') {
      const row = sanitizeCalcutta(calcutta);
      if (!row) return json({ error: 'bad calcutta' }, 400);
      const { error } = await sb.from('calcuttas').upsert(row);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, id: row.id });
    }

    if (action === 'delete_calcutta') {
      if (typeof calcutta_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(calcutta_id)) {
        return json({ error: 'bad calcutta id' }, 400);
      }
      const { error } = await sb.from('calcuttas').delete().eq('id', calcutta_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    const BUCKET = 'special-orders';

    if (action === 'save_order') {
      const row = sanitizeOrder(order);
      if (!row) return json({ error: 'bad order' }, 400);
      // optional file upload (base64) → private storage bucket
      if (file && typeof file === 'object' && typeof file.data === 'string' && file.data) {
        const name = (typeof file.name === 'string' && file.name ? file.name : 'document').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
        let bytes: Uint8Array;
        try { bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0)); }
        catch (_e) { return json({ error: 'bad file data' }, 400); }
        if (bytes.length > 15 * 1024 * 1024) return json({ error: 'file too large (15 MB max)' }, 400);
        const path = `${row.id}/${name}`;
        const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, {
          contentType: typeof file.type === 'string' ? file.type.slice(0, 100) : 'application/octet-stream',
          upsert: true,
        });
        if (upErr) return json({ error: upErr.message }, 500);
        row.file_path = path;
        row.file_name = name;
      } else if (file === null) {
        // explicit request to remove the stored document
        const { data: existing } = await sb.from('special_orders').select('file_path').eq('id', row.id).single();
        if (existing?.file_path) await sb.storage.from(BUCKET).remove([existing.file_path]);
        row.file_path = null;
        row.file_name = null;
      }
      const { error } = await sb.from('special_orders').upsert(row);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, id: row.id, file_path: row.file_path ?? undefined, file_name: row.file_name ?? undefined });
    }

    if (action === 'delete_order') {
      if (typeof order_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(order_id)) {
        return json({ error: 'bad order id' }, 400);
      }
      const { data: existing } = await sb.from('special_orders').select('file_path').eq('id', order_id).single();
      if (existing?.file_path) await sb.storage.from(BUCKET).remove([existing.file_path]);
      const { error } = await sb.from('special_orders').delete().eq('id', order_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === 'order_file_url') {
      if (typeof order_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(order_id)) {
        return json({ error: 'bad order id' }, 400);
      }
      const { data: existing } = await sb.from('special_orders').select('file_path').eq('id', order_id).single();
      if (!existing?.file_path) return json({ error: 'no file' }, 404);
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(existing.file_path, 3600);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, url: data.signedUrl });
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
