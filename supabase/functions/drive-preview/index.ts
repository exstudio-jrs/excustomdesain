
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

async function driveToken(admin: ReturnType<typeof createClient>) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("Konfigurasi Google OAuth belum lengkap.");
  }

  const { data, error } = await admin
    .from("google_drive_tokens")
    .select("refresh_token")
    .eq("id", 1)
    .single();

  if (error || !data?.refresh_token) {
    throw new Error("Koneksi Google Drive belum tersedia.");
  }

  const response = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: data.refresh_token,
        grant_type: "refresh_token",
      }),
    }
  );

  const result = await response.json();

  if (!response.ok || !result.access_token) {
    throw new Error(
      result.error_description ||
      "Gagal mendapatkan Google access token."
    );
  }

  return result.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const auth = req.headers.get("Authorization");

    if (!auth?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceKey) {
      throw new Error("Konfigurasi Supabase belum lengkap.");
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: {
        headers: { Authorization: auth },
      },
    });

    const admin = createClient(supabaseUrl, serviceKey);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return json({ error: "Unauthorized user" }, 401);
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return json({ error: "Profile not found" }, 403);
    }

    if (!["marketing", "designer", "admin"].includes(profile.role)) {
      return json({ error: "Forbidden role" }, 403);
    }

    const params = new URL(req.url).searchParams;
    const designId = params.get("designId");
    const fileId = params.get("fileId");

    if (!designId || !fileId) {
      return json({
        error: "designId dan fileId wajib diisi.",
      }, 400);
    }

    // Pastikan pengguna berhak melihat desain ini.
    const { data: design, error: designError } = await supabase
      .from("designs")
      .select("id, created_by, assigned_to")
      .eq("id", designId)
      .single();

    if (designError || !design) {
      return json({ error: "Design not found" }, 404);
    }

    const allowed =
      profile.role === "admin" ||
      (
        profile.role === "marketing" &&
        design.created_by === user.id
      ) ||
      (
        profile.role === "designer" &&
        design.assigned_to === user.id
      );

      console.log("PREVIEW ACCESS CHECK:", {
  userId: user.id,
  role: profile.role,
  designId: design.id,
  createdBy: design.created_by,
  assignedTo: design.assigned_to,
  allowed,
});

    if (!allowed) {
      return json({ error: "Forbidden" }, 403);
    }

    // Pastikan file memang terdaftar pada desain tersebut.
    const { data: fileRecord, error: fileError } = await admin
      .from("design_files")
      .select("drive_file_id, file_name")
      .eq("design_id", designId)
      .eq("drive_file_id", fileId)
      .maybeSingle();

    if (fileError || !fileRecord) {
      return json({ error: "Design file not found" }, 404);
    }

    const token = await driveToken(admin);

    // Ambil metadata file dari Google Drive.
    const metadataResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=mimeType,size`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const metadata = await metadataResponse.json();

    if (!metadataResponse.ok) {
      console.error("Drive metadata error:", metadata);
      return json({
        error: "Gagal membaca metadata file Google Drive.",
      }, 502);
    }

    const mimeType = String(metadata.mimeType || "");

    if (!mimeType.startsWith("image/")) {
      return json({ error: "File bukan gambar." }, 415);
    }

    // Ambil isi gambar langsung dari Google Drive.
    const imageResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!imageResponse.ok || !imageResponse.body) {
      console.error("Drive media error:", imageResponse.status);

      return json({
        error: "Gagal mengambil gambar dari Google Drive.",
      }, 502);
    }

    return new Response(imageResponse.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": mimeType,
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });

  } catch (error) {
    console.error("DRIVE PREVIEW ERROR:", error);

    return json({
      error: error instanceof Error
        ? error.message
        : "Preview failed",
    }, 500);
  }
});
