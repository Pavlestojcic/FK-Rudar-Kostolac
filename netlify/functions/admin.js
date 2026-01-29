const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PIN = process.env.ADMIN_PIN;

function bad(status, msg) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: false, error: msg }),
  };
}

function ok(data) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, ...data }),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return bad(405, "Method not allowed");

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return bad(400, "Bad JSON");
  }

  const pin = String(body.pin || "").trim();
  if (!pin) return bad(401, "Missing PIN");
  if (pin !== String(ADMIN_PIN || "")) return bad(403, "Wrong PIN");

  if (!SUPABASE_URL || !SERVICE_KEY) return bad(500, "Missing env vars");

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const action = String(body.action || "").trim();

  try {
    if (action === "ping") {
      return ok({});
    }

    if (action === "add_news") {
      const title = String(body.title || "").trim();
      const bodyText = String(body.body || "").trim();
      const image_url = String(body.image_url || "").trim() || null;

      if (!title || !bodyText) return bad(400, "Missing title/body");

      const { error } = await supabase.from("news").insert({
        title,
        body: bodyText,
        image_url,
      });
      if (error) return bad(500, error.message);
      return ok({});
    }

    if (action === "delete_news") {
      const id = String(body.id || "").trim();
      if (!id) return bad(400, "Missing id");

      const { error } = await supabase.from("news").delete().eq("id", id);
      if (error) return bad(500, error.message);
      return ok({});
    }

    if (action === "add_history") {
      const title = String(body.title || "").trim();
      const bodyText = String(body.body || "").trim();
      const image_url = String(body.image_url || "").trim() || null;
      const season = String(body.season || "").trim() || null;

      if (!title || !bodyText) return bad(400, "Missing title/body");

      const { error } = await supabase.from("history").insert({
        title,
        body: bodyText,
        image_url,
        season,
      });
      if (error) return bad(500, error.message);
      return ok({});
    }

    if (action === "delete_history") {
      const id = String(body.id || "").trim();
      if (!id) return bad(400, "Missing id");

      const { error } = await supabase.from("history").delete().eq("id", id);
      if (error) return bad(500, error.message);
      return ok({});
    }

    if (action === "add_match") {
      const payload = {
        competition: String(body.competition || "").trim() || "Zona Dunav",
        round: String(body.round || "").trim() || null,
        venue: String(body.venue || "").trim() || null,
        status: String(body.status || "").trim() || "scheduled",
        match_date: String(body.match_date || "").trim() || null,
        match_time: String(body.match_time || "").trim() || null,
        home_team: String(body.home_team || "").trim(),
        away_team: String(body.away_team || "").trim(),
      };
      if (!payload.home_team || !payload.away_team) return bad(400, "Missing teams");

      const { error } = await supabase.from("matches").insert(payload);
      if (error) return bad(500, error.message);
      return ok({});
    }

    if (action === "delete_match") {
      const id = String(body.id || "").trim();
      if (!id) return bad(400, "Missing id");

      const { error } = await supabase.from("matches").delete().eq("id", id);
      if (error) return bad(500, error.message);
      return ok({});
    }

    if (action === "add_player") {
      const full_name = String(body.full_name || "").trim();
      const number = Number(body.number || 0);
      const position_group = String(body.position_group || "").trim();

      if (!full_name || !number || !position_group) return bad(400, "Missing fields");

      const { error } = await supabase.from("players").insert({
        full_name,
        number,
        position_group,
      });
      if (error) return bad(500, error.message);
      return ok({});
    }

    if (action === "delete_player") {
      const id = String(body.id || "").trim();
      if (!id) return bad(400, "Missing id");

      const { error } = await supabase.from("players").delete().eq("id", id);
      if (error) return bad(500, error.message);
      return ok({});
    }

    if (action === "replace_table") {
      const season = String(body.season || "").trim() || null;
      const round = String(body.round || "").trim() || null;
      const rows = Array.isArray(body.rows) ? body.rows : [];

      if (!rows.length) return bad(400, "No rows");

      const { error: delErr } = await supabase.from("table_rows").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (delErr) return bad(500, delErr.message);

      const insertRows = rows.map((r) => ({
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
      })).filter(x => x.team);

      const { error: insErr } = await supabase.from("table_rows").insert(insertRows);
      if (insErr) return bad(500, insErr.message);

      return ok({});
    }

    if (action === "upload_media") {
      const filename = String(body.filename || "").trim();
      const contentType = String(body.contentType || "image/jpeg").trim();
      const base64 = String(body.base64 || "").trim();

      if (!filename || !base64) return bad(400, "Missing file");

      const bytes = Buffer.from(base64, "base64");
      const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${Date.now()}_${safe}`;

      const { error: upErr } = await supabase.storage
        .from("news")
        .upload(path, bytes, { contentType, upsert: true });

      if (upErr) return bad(500, upErr.message);

      const { data } = supabase.storage.from("news").getPublicUrl(path);
      return ok({ url: data.publicUrl });
    }

    return bad(400, "Unknown action");
  } catch (e) {
    return bad(500, String(e.message || e));
  }
};