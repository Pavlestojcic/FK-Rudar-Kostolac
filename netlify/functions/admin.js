// netlify/functions/admin.js
// ENV:
// ADMIN_PIN
// SUPABASE_URL
// SUPABASE_SERVICE_ROLE_KEY

const json = (statusCode, obj) => ({
statusCode,
headers: {
"Content-Type": "application/json",
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers": "Content-Type",
"Access-Control-Allow-Methods": "POST,OPTIONS",
},
body: JSON.stringify(obj),
});

const ok = (data = {}) => json(200, { ok: true, ...data });
const bad = (status, msg) => json(status, { ok: false, error: msg });

const env = (k) => String(process.env[k] || "").trim();

function requireEnv() {
const ADMIN_PIN = env("ADMIN_PIN");
const SUPABASE_URL = env("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

if (!ADMIN_PIN) throw new Error("Missing env: ADMIN_PIN");
if (!SUPABASE_URL) throw new Error("Missing env: SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");

return { ADMIN_PIN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
}

function safeFileName(name) {
const n = String(name || "file").trim();
return n.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
}

async function sbFetch({ url, key, path, method = "GET", body, headers = {} }) {
const res = await fetch(url + path, {
method,
headers: {
apikey: key,
Authorization: `Bearer ${key}`,
"Content-Type": "application/json",
...headers,
},
body: body ? JSON.stringify(body) : undefined,
});

const text = await res.text();
let data = null;
try { data = text ? JSON.parse(text) : null; } catch { data = text; }

if (!res.ok) {
const msg =
typeof data === "string"
? data
: (data?.message || data?.error || "Supabase error");
throw new Error(`${res.status} ${msg}`);
}
return data;
}

async function sbStorageUpload({ url, key, bucket, objectPath, bytes, contentType }) {
const up = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`, {
method: "POST",
headers: {
apikey: key,
Authorization: `Bearer ${key}`,
"Content-Type": contentType || "application/octet-stream",
"x-upsert": "true",
},
body: bytes,
});

const txt = await up.text();
if (!up.ok) throw new Error(`Storage upload failed: ${up.status} ${txt}`);

return `${url}/storage/v1/object/public/${bucket}/${objectPath}`;
}

exports.handler = async (event) => {
if (event.httpMethod === "OPTIONS") return ok({ preflight: true });
if (event.httpMethod !== "POST") return bad(405, "Use POST");

let body = {};
try { body = JSON.parse(event.body || "{}"); } catch { return bad(400, "Bad JSON"); }

let cfg;
try { cfg = requireEnv(); } catch (e) { return bad(500, String(e.message || e)); }

const pin = String(body.pin || "").trim();
if (!pin) return bad(401, "Missing pin");
if (pin !== cfg.ADMIN_PIN) return bad(401, "Bad pin");

const action = String(body.action || "").trim();
if (!action) return bad(400, "Missing action");

try {
if (action === "ping") return ok({ pong: true });

if (action === "add_news") {
const title = String(body.title || "").trim();
const image_url = String(body.image_url || "").trim();
const bodyText = String(body.body || "").trim();
if (!title) return bad(400, "Missing title");
if (!bodyText) return bad(400, "Missing body");

const row = await sbFetch({
url: cfg.SUPABASE_URL,
key: cfg.SUPABASE_SERVICE_ROLE_KEY,
path: "/rest/v1/news",
method: "POST",
headers: { Prefer: "return=representation" },
body: [{ title, image_url, body: bodyText }],
});

return ok({ inserted: row });
}

if (action === "add_match") {
const competition = String(body.competition || "Zona Dunav").trim();
const match_date = String(body.match_date || "").trim();
const match_time = String(body.match_time || "").trim();
const home_team = String(body.home_team || "").trim();
const away_team = String(body.away_team || "").trim();
const venue = String(body.venue || "").trim();
const round = String(body.round || "").trim();
const status = String(body.status || "scheduled").trim();

if (!home_team || !away_team) return bad(400, "Missing teams");

const row = await sbFetch({
url: cfg.SUPABASE_URL,
key: cfg.SUPABASE_SERVICE_ROLE_KEY,
path: "/rest/v1/matches",
method: "POST",
headers: { Prefer: "return=representation" },
body: [{
competition,
match_date: match_date || null,
match_time: match_time || null,
home_team,
away_team,
venue: venue || null,
round: round || null,
status,
}],
});

return ok({ inserted: row });
}

if (action === "add_player") {
const full_name = String(body.full_name || "").trim();
const number = Number(body.number || 0);
const position_group = String(body.position_group || "").trim();

if (!full_name) return bad(400, "Missing full_name");
if (!Number.isFinite(number) || number <= 0) return bad(400, "Bad number");
if (!position_group) return bad(400, "Missing position_group");

const row = await sbFetch({
url: cfg.SUPABASE_URL,
key: cfg.SUPABASE_SERVICE_ROLE_KEY,
path: "/rest/v1/players",
method: "POST",
headers: { Prefer: "return=representation" },
body: [{ full_name, number, position_group }],
});

return ok({ inserted: row });
}

if (action === "replace_table") {
const season = String(body.season || "2025/2026").trim();
const round = String(body.round || "").trim();
const rows = Array.isArray(body.rows) ? body.rows : [];
if (!rows.length) return bad(400, "Missing rows");

await sbFetch({
url: cfg.SUPABASE_URL,
key: cfg.SUPABASE_SERVICE_ROLE_KEY,
path: "/rest/v1/table_rows?id=gt.0",
method: "DELETE",
});

const stamped = rows.map(r => ({
team: String(r.team || "").trim(),
played: Number(r.played || 0),
wins: Number(r.wins || 0),
draws: Number(r.draws || 0),
losses: Number(r.losses || 0),
goals_for: Number(r.goals_for || 0),
goals_against: Number(r.goals_against || 0),
goal_diff: Number(r.goal_diff || 0),
points: Number(r.points || 0),
season,
round,
})).filter(r => r.team);

if (!stamped.length) return bad(400, "Rows invalid");

const ins = await sbFetch({
url: cfg.SUPABASE_URL,
key: cfg.SUPABASE_SERVICE_ROLE_KEY,
path: "/rest/v1/table_rows",
method: "POST",
headers: { Prefer: "return=representation" },
body: stamped,
});

return ok({ inserted: ins.length || 0 });
}

if (action === "upload_media") {
const filename = safeFileName(body.filename || "news.jpg");
const contentType = String(body.contentType || "image/jpeg").trim();
const base64 = String(body.base64 || "").trim();
if (!base64) return bad(400, "Missing base64");

const bytes = Buffer.from(base64, "base64");
if (!bytes.length) return bad(400, "Bad base64");

const objectPath = `news/${Date.now()}_${filename}`;

const publicUrl = await sbStorageUpload({
url: cfg.SUPABASE_URL,
key: cfg.SUPABASE_SERVICE_ROLE_KEY,
bucket: "public",
objectPath,
bytes,
contentType,
});

return ok({ url: publicUrl, path: objectPath });
}

return bad(400, "Unknown action");
} catch (e) {
return bad(500, String(e.message || e));
}
};
