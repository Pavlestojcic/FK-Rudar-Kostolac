// netlify/functions/admin.js
// Node 18+ (Netlify) ima global fetch

const json = (status, obj) => ({
  statusCode: status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
  },
  body: JSON.stringify(obj),
});

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function supaRest({ baseUrl, serviceKey, method, path, body, extraHeaders }) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Accept": "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(extraHeaders || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const msg = typeof data === "string" ? data : (data?.message || data?.error || "Supabase error");
    throw new Error(`${res.status} ${msg}`);
  }
  return data;
}

async function supaUpload({ baseUrl, serviceKey, bucket, objectPath, contentType, base64 }) {
  const bytes = Buffer.from(base64, "base64");
  const url = `${baseUrl}/storage/v1/object/${bucket}/${objectPath}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "true",
    },
    body: bytes,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${text || "Upload failed"}`);
  }

  // public URL (ako ti je bucket public)
  const publicUrl = `${baseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
  return { publicUrl };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Use POST" });
    }

    const SUPABASE_URL = mustEnv("SUPABASE_URL").replace(/\/$/, "");
    const SUPABASE_SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const ADMIN_PIN = mustEnv("ADMIN_PIN");

    let payload = {};
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { ok: false, error: "Bad JSON" });
    }

    const { action, pin } = payload;

    if (!pin || String(pin).trim() !== String(ADMIN_PIN).trim()) {
      return json(401, { ok: false, error: "PIN pogrešan" });
    }

    // ping (provera pina)
    if (action === "ping") {
      return json(200, { ok: true });
    }

    // upload slike vesti u Storage bucket "media" u folder "news"
    // OVO TRAZI da ima bucket "media" i da je public
    if (action === "upload_media") {
      const filename = String(payload.filename || "").trim();
      const contentType = String(payload.contentType || "image/jpeg").trim();
      const base64 = String(payload.base64 || "").trim();

      if (!filename || !base64) {
        return json(400, { ok: false, error: "Missing filename/base64" });
      }

      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const objectPath = `news/${Date.now()}_${safeName}`;

      const up = await supaUpload({
        baseUrl: SUPABASE_URL,
        serviceKey: SUPABASE_SERVICE_ROLE_KEY,
        bucket: "media",
        objectPath,
        contentType,
        base64,
      });

      return json(200, { ok: true, url: up.publicUrl });
    }

    // add news
    if (action === "add_news") {
      const title = String(payload.title || "").trim();
      const image_url = String(payload.image_url || "").trim();
      const body = String(payload.body || "").trim();

      if (!title || !body) return json(400, { ok: false, error: "Popuni naslov i tekst" });

      await supaRest({
        baseUrl: SUPABASE_URL,
        serviceKey: SUPABASE_SERVICE_ROLE_KEY,
        method: "POST",
        path: "/rest/v1/news",
        body: [{ title, image_url, body }],
        extraHeaders: { "Prefer": "return=minimal" },
      });

      return json(200, { ok: true });
    }

    // add match
    if (action === "add_match") {
      const row = {
        competition: String(payload.competition || "Zona Dunav").trim(),
        match_date: String(payload.match_date || "").trim(),
        match_time: String(payload.match_time || "").trim(),
        home_team: String(payload.home_team || "").trim(),
        away_team: String(payload.away_team || "").trim(),
        venue: String(payload.venue || "").trim(),
        round: String(payload.round || "").trim(),
        status: String(payload.status || "scheduled").trim(),
      };

      if (!row.home_team || !row.away_team) return json(400, { ok: false, error: "Popuni timove" });

      await supaRest({
        baseUrl: SUPABASE_URL,
        serviceKey: SUPABASE_SERVICE_ROLE_KEY,
        method: "POST",
        path: "/rest/v1/matches",
        body: [row],
        extraHeaders: { "Prefer": "return=minimal" },
      });

      return json(200, { ok: true });
    }

    // add player
    if (action === "add_player") {
      const full_name = String(payload.full_name || "").trim();
      const number = Number(payload.number || 0);
      const position_group = String(payload.position_group || "").trim();

      if (!full_name || !number || !position_group) {
        return json(400, { ok: false, error: "Popuni polja" });
      }

      await supaRest({
        baseUrl: SUPABASE_URL,
        serviceKey: SUPABASE_SERVICE_ROLE_KEY,
        method: "POST",
        path: "/rest/v1/players",
        body: [{ full_name, number, position_group }],
        extraHeaders: { "Prefer": "return=minimal" },
      });

      return json(200, { ok: true });
    }

    // replace table
    if (action === "replace_table") {
      const season = String(payload.season || "2025/2026").trim();
      const round = String(payload.round || "").trim();
      const rows = Array.isArray(payload.rows) ? payload.rows : [];

      if (!rows.length) return json(400, { ok: false, error: "Nema redova" });

      // obriši sve
      await supaRest({
        baseUrl: SUPABASE_URL,
        serviceKey: SUPABASE_SERVICE_ROLE_KEY,
        method: "DELETE",
        path: "/rest/v1/table_rows?id=gt.0",
      });

      // upiši nove
      const toInsert = rows.map(r => ({
        season,
        round,
        team: String(r.team || "").trim(),
        played: Number(r.played || 0),
        wins: Number(r.wins || 0),
        draws: Number(r.draws || 0),
        losses: Number(r.losses || 0),
        goals_for: Number(r.goals_for || 0),
        goals_against: Number(r.goals_against || 0),
        goal_diff: Number(r.goal_diff || 0),
        points: Number(r.points || 0),
      }));