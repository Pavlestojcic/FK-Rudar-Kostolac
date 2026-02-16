// netlify/functions/admin.js
// Radi na Netlify Functions (Node 18+) - koristi global fetch

const json = (statusCode, obj, extraHeaders = {}) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    ...extraHeaders,
  },
  body: JSON.stringify(obj),
});

const mustEnv = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
};

const safeName = (s) =>
  String(s || "")
    .trim()
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 120);

async function supaFetch(path, { method = "GET", body, headers = {} } = {}) {
  const SUPABASE_URL = mustEnv("SUPABASE_URL");
  const SERVICE = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

  const res = await fetch(SUPABASE_URL + path, {
    method,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg =
      typeof data === "string"
        ? data
        : (data && (data.message || data.error_description || data.error)) || "Supabase error";
    throw new Error(`${res.status} ${msg}`);
  }

  return data;
}

async function supaStorageUpload({ filename, contentType, base64 }) {
  const SUPABASE_URL = mustEnv("SUPABASE_URL");
  const SERVICE = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

  // Bucket ime promeni ako ti nije "media"
  const BUCKET = process.env.SUPABASE_BUCKET || "media";

  const clean = safeName(filename || "image.jpg");
  const key = `${Date.now()}_${clean}`;

  const bin = Buffer.from(String(base64 || ""), "base64");

  const up = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE,
        Authorization: `Bearer ${SERVICE}`,
        "Content-Type": contentType || "image/jpeg",
        "x-upsert": "true",
      },
      body: bin,
    }
  );

  const upText = await up.text();
  if (!up.ok) throw new Error(`${up.status} Storage upload failed: ${upText}`);

  // public url (ako bucket nije public, ovo neće raditi bez signed url)
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${encodeURIComponent(
    key
  )}`;

  return { url: publicUrl, key, bucket: BUCKET };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Use POST" });

    const ADMIN_PIN = mustEnv("ADMIN_PIN");

    let payload = {};
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { ok: false, error: "Bad JSON" });
    }

    const pin = String(payload.pin || "").trim();
    const action = String(payload.action || "").trim();

    if (!action) return json(400, { ok: false, error: "Missing action" });
    if (pin !== ADMIN_PIN) return json(401, { ok: false, error: "Bad PIN" });

    // 1) ping
    if (action === "ping") return json(200, { ok: true });

    // 2) upload_media
    if (action === "upload_media") {
      const out = await supaStorageUpload({
        filename: payload.filename,
        contentType: payload.contentType,
        base64: payload.base64,
      });
      return json(200, { ok: true, url: out.url });
    }

    // 3) add_news
    if (action === "add_news") {
      const title = String(payload.title || "").trim();
      const body = String(payload.body || "").trim();
      const image_url = String(payload.image_url || "").trim();

      if (!title || !body) return json(400, { ok: false, error: "Missing title/body" });

      const data = await supaFetch("/rest/v1/news", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: [{ title, body, image_url }],
      });

      return json(200, { ok: true, data });
    }

    // 4) add_match
    if (action === "add_match") {
      const match_date = String(payload.match_date || "").trim(); // YYYY-MM-DD
      const match_time = String(payload.match_time || "").trim();
      const home_team = String(payload.home_team || "").trim();
      const away_team = String(payload.away_team || "").trim();

      if (!home_team || !away_team) return json(400, { ok: false, error: "Missing teams" });

      const row = {
        competition: String(payload.competition || "Zona Dunav").trim(),
        match_date,
        match_time,
        home_team,
        away_team,
        venue: String(payload.venue || "").trim(),
        round: String(payload.round || "").trim(),
        status: String(payload.status || "scheduled").trim(),
      };

      const data = await supaFetch("/rest/v1/matches", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: [row],
      });

      return json(200, { ok: true, data });
    }

    // 5) add_player
    if (action === "add_player") {
      const full_name = String(payload.full_name || "").trim();
      const position_group = String(payload.position_group || "").trim();
      const number = Number(payload.number);

      if (!full_name || !position_group || !Number.isFinite(number) || number <= 0) {
        return json(400, { ok: false, error: "Missing full_name/number/position_group" });
      }

      const data = await supaFetch("/rest/v1/players", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: [{ full_name, number, position_group }],
      });

      return json(200, { ok: true, data });
    }

    // 6) replace_table
    if (action === "replace_table") {
      const season = String(payload.season || "").trim();
      const round = String(payload.round || "").trim();
      const rows = Array.isArray(payload.rows) ? payload.rows : [];

      if (!rows.length) return json(400, { ok: false, error: "No rows" });

      // Obriši sve (radi ako tabela ima kolonu id)
      // Ako ti ne radi, javi i prilagodiću filter za tvoju šemu.
      await supaFetch("/rest/v1/table_rows?id=gt.0", { method: "DELETE" });

      const toInsert = rows.map((r) => ({
        team: String(r.team || "").trim(),
        played: Number(r.played) || 0,
        wins: Number(r.wins) || 0,
        draws: Number(r.draws) || 0,
        losses: Number(r.losses) || 0,
        goals_for: Number(r.goals_for) || 0,
        goals_against: Number(r.goals_against) || 0,
        goal_diff: Number(r.goal_diff) || 0,
        points: Number(r.points) || 0,
        season,
        round,
      }));

      const data = await supaFetch("/rest/v1/table_rows", {