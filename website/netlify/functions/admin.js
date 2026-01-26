export async function handler(event) {
try {
if (event.httpMethod !== "POST") {
return { statusCode: 405, body: JSON.stringify({ ok:false, error:"Method not allowed" }) };
}

const body = JSON.parse(event.body || "{}");
const pin = String(body.pin || "").trim();
const action = String(body.action || "").trim();

const ADMIN_PIN = process.env.ADMIN_PIN || "482913";
if (!pin || pin !== ADMIN_PIN) {
return { statusCode: 401, body: JSON.stringify({ ok:false, error:"Bad PIN" }) };
}

if (action === "ping") {
return { statusCode: 200, body: JSON.stringify({ ok:true }) };
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
return { statusCode: 500, body: JSON.stringify({ ok:false, error:"Missing SUPABASE_URL or SERVICE_ROLE key" }) };
}

const headers = {
"Authorization": `Bearer ${SERVICE_ROLE}`,
"apikey": SERVICE_ROLE,
"Content-Type": "application/json",
"Accept": "application/json"
};

async function sb(path, opts={}) {
const res = await fetch(SUPABASE_URL + path, {
...opts,
headers: { ...headers, ...(opts.headers||{}) }
});
const txt = await res.text();
let data;
try { data = JSON.parse(txt); } catch { data = txt; }
if (!res.ok) throw new Error(typeof data === "string" ? data : (data?.message || "Supabase error"));
return data;
}

if (action === "add_news") {
const payload = {
title: String(body.title||"").trim(),
body: String(body.body||"").trim(),
image_url: String(body.image_url||"").trim() || null
};
if (!payload.title || !payload.body) throw new Error("Missing title/body");
await sb("/rest/v1/news", { method:"POST", headers:{ "Prefer":"return=representation" }, body: JSON.stringify(payload) });
return { statusCode: 200, body: JSON.stringify({ ok:true }) };
}

if (action === "add_match") {
const payload = {
competition: String(body.competition||"Zona Dunav").trim(),
match_date: String(body.match_date||"").trim() || null,
match_time: String(body.match_time||"").trim() || null,
home_team: String(body.home_team||"").trim(),
away_team: String(body.away_team||"").trim(),
venue: String(body.venue||"").trim() || null,
round: String(body.round||"").trim() || null,
status: String(body.status||"scheduled").trim()
};
if (!payload.home_team || !payload.away_team) throw new Error("Missing teams");
await sb("/rest/v1/matches", { method:"POST", headers:{ "Prefer":"return=representation" }, body: JSON.stringify(payload) });
return { statusCode: 200, body: JSON.stringify({ ok:true }) };
}

if (action === "add_player") {
const payload = {
full_name: String(body.full_name||"").trim(),
number: Number(body.number||0),
position_group: String(body.position_group||"").trim()
};
if (!payload.full_name || !payload.number || !payload.position_group) throw new Error("Missing player fields");
await sb("/rest/v1/players", { method:"POST", headers:{ "Prefer":"return=representation" }, body: JSON.stringify(payload) });
return { statusCode: 200, body: JSON.stringify({ ok:true }) };
}

if (action === "replace_table") {
const season = String(body.season||"2025/2026").trim();
const round = String(body.round||"").trim();
const rows = Array.isArray(body.rows) ? body.rows : [];
if (!rows.length) throw new Error("No rows");

// obriši staru tabelu
await sb("/rest/v1/table_rows?season=not.is.null", { method:"DELETE" });

// ubaci novu
const payload = rows.map(r => ({
season,
round,
team: String(r.team||"").trim(),
played: Number(r.played||0),
wins: Number(r.wins||0),
draws: Number(r.draws||0),
losses: Number(r.losses||0),
goals_for: Number(r.goals_for||0),
goals_against: Number(r.goals_against||0),
goal_diff: Number(r.goal_diff||0),
points: Number(r.points||0)
})).filter(x => x.team);

await sb("/rest/v1/table_rows", { method:"POST", headers:{ "Prefer":"return=representation" }, body: JSON.stringify(payload) });
return { statusCode: 200, body: JSON.stringify({ ok:true }) };
}

if (action === "upload_media") {
const filename = String(body.filename||"image.jpg").trim().replace(/[^\w.\-]/g, "_");
const contentType = String(body.contentType||"image/jpeg").trim();
const base64 = String(body.base64||"").trim();
if (!base64) throw new Error("No file data");

const bytes = Buffer.from(base64, "base64");

// upload u bucket "media"
const up = await fetch(`${SUPABASE_URL}/storage/v1/object/media/${filename}`, {
method: "POST",
headers: {
"Authorization": `Bearer ${SERVICE_ROLE}`,
"apikey": SERVICE_ROLE,
"Content-Type": contentType,
"x-upsert": "true"
},
body: bytes
});

if (!up.ok) {
const t = await up.text();
throw new Error("Upload failed: " + t);
}

// public URL
const url = `${SUPABASE_URL}/storage/v1/object/public/media/${filename}`;
return { statusCode: 200, body: JSON.stringify({ ok:true, url }) };
}

return { statusCode: 400, body: JSON.stringify({ ok:false, error:"Unknown action" }) };
} catch (e) {
return { statusCode: 500, body: JSON.stringify({ ok:false, error: String(e.message || e) }) };
}
}
