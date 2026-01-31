export default async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response("", {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
      },
    });
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // <<< OVO JE BITNO
    const ADMIN_PIN = process.env.ADMIN_PIN || "482913"; // <<< stavi u Netlify, a ovo je fallback

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { pin, action } = body || {};

    if (!action) {
      return new Response(JSON.stringify({ ok: false, error: "Missing action" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // PIN check za sve admin akcije
    if (String(pin || "") !== String(ADMIN_PIN)) {
      return new Response(JSON.stringify({ ok: false, error: "Bad PIN" }), {
        status: 401,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const headers = {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    };

    // 1) Ping (provera PIN-a)
    if (action === "ping") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // 2) Upload slike u Supabase Storage (bucket mora biti PUBLIC)
    // body: { filename, contentType, base64 }
    if (action === "upload_media") {
      const bucket = "media";
      const filename = String(body.filename || "img.jpg");
      const contentType = String(body.contentType || "image/jpeg");
      const base64 = String(body.base64 || "");

      if (!base64) {
        return new Response(JSON.stringify({ ok: false, error: "Missing base64" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `news/${Date.now()}_${safeName}`;

      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": contentType,
          "x-upsert": "true",
        },
        body: bytes,
      });

      const t = await up.text();
      if (!up.ok) {
        return new Response(JSON.stringify({ ok: false, error: `Upload failed: ${t}` }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
      return new Response(JSON.stringify({ ok: true, url: publicUrl }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // 3) Dodaj vest
    if (action === "add_news") {
      const payload = {
        title: String(body.title || "").trim(),
        body: String(body.body || "").trim(),
        image_url: String(body.image_url || "").trim(),
      };
      if (!payload.title || !payload.body) {
        return new Response(JSON.stringify({ ok: false, error: "Missing title/body" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      const r = await fetch(`${SUPABASE_URL}/rest/v1/news`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(payload),
      });

      const text = await r.text();
      if (!r.ok) {
        return new Response(JSON.stringify({ ok: false, error: text }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // 4) Dodaj utakmicu
    if (action === "add_match") {
      const payload = {
        competition: String(body.competition || "Zona Dunav").trim(),
        match_date: String(body.match_date || "").trim(),
        match_time: String(body.match_time || "").trim(),
        home_team: String(body.home_team || "").trim(),
        away_team: String(body.away_team || "").trim(),
        venue: String(body.venue || "").trim(),
        round: String(body.round || "").trim(),
        status: String(body.status || "scheduled").trim(),
      };
      if (!payload.home_team || !payload.away_team) {
        return new Response(JSON.stringify({ ok: false, error: "Missing teams" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      const r = await fetch(`${SUPABASE_URL}/rest/v1/matches`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(payload),
      });

      const text = await r.text();
      if (!r.ok) {
        return new Response(JSON.stringify({ ok: false, error: text }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // 5) Dodaj igrača
    if (action === "add_player") {
      const payload = {
        full_name: String(body.full_name || "").trim(),
        number: Number(body.number || 0),
        position_group: String(body.position_group || "").trim(),
      };
      if (!payload.full_name || !payload.number || !payload.position_group) {
        return new Response(JSON.stringify({ ok: false, error: "Missing fields" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      const r = await fetch(`${SUPABASE_URL}/rest/v1/players`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(payload),
      });

      const text =