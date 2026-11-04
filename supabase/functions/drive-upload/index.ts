
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

// Mengambil access token menggunakan refresh token OAuth
async function driveToken(admin: ReturnType<typeof createClient>) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID atau GOOGLE_CLIENT_SECRET belum diatur.");
  }

  const { data, error } = await admin
    .from("google_drive_tokens")
    .select("refresh_token, connected_email")
    .eq("id", 1)
    .single();

  if (error || !data?.refresh_token) {
    throw new Error(
      "Koneksi Google Drive belum tersedia. Hubungkan Google Drive melalui akun Admin."
    );
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
    console.error("Google refresh token error:", {
      status: response.status,
      error: result.error,
      description: result.error_description,
    });

    throw new Error(
      result.error_description ||
      result.error ||
      "Gagal mendapatkan Google access token."
    );
  }

  return result.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // 1. Periksa Authorization
    const auth = req.headers.get("Authorization");

    if (!auth || !auth.startsWith("Bearer ")) {
      return json({
        error: "Missing or invalid Authorization header",
      }, 401);
    }

    // 2. Konfigurasi Supabase
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

    // Client khusus server untuk membaca token Google
    const admin = createClient(supabaseUrl, serviceKey);

    // 3. Validasi pengguna
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return json({ error: "Unauthorized user" }, 401);
    }

    // 4. Periksa role
    const {
      data: profile,
      error: profileError,
    } = await supabase
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

    // 5. Ambil data upload
    const form = await req.formData();

    const file = form.get("file");
    const folderType = String(form.get("folderType") || "");
    const designId = String(form.get("designId") || "");

    if (
      !(file instanceof File) ||
      !["references", "results"].includes(folderType) ||
      !designId
    ) {
      return json({ error: "Invalid upload request" }, 400);
    }

    if (!file.type.startsWith("image/") || file.size > 15 * 1024 * 1024) {
      return json({
        error: "File harus gambar dan maksimal 15 MB.",
      }, 400);
    }

    // 6. Periksa desain
    const {
      data: design,
      error: designError,
    } = await supabase
      .from("designs")
      .select("id, created_by, assigned_to, status")
      .eq("id", designId)
      .single();

    if (designError || !design) {
      return json({ error: "Design not found" }, 404);
    }

    
// 7. Validasi hak upload
const allowed =
  profile.role === "admin" ||
  (
    folderType === "references" &&
    profile.role === "marketing" &&
    design.created_by === user.id
  ) ||
  (
    folderType === "results" &&
    profile.role === "designer" &&
    design.assigned_to === user.id &&
    ["claimed", "revision"].includes(design.status)
  );

if (!allowed) {
  return json({
    error: "You cannot upload to this design",
  }, 403);
}


    // 8. Ambil access token OAuth
    const token = await driveToken(admin);

    // 9. Folder tujuan Google Drive
    const folderId = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID");

    if (!folderId) {
      throw new Error("GOOGLE_DRIVE_FOLDER_ID belum diatur.");
    }

    // 10. Metadata file
    const metadata = {
      name: `${designId}_${folderType}_${Date.now()}_${file.name}`,
      mimeType: file.type,
      parents: [folderId],
    };

    const boundary = "----sportwearBoundary" + crypto.randomUUID();

    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const encoder = new TextEncoder();

    const metaPart = encoder.encode(
      `--${boundary}\r\n` +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${file.type}\r\n\r\n`
    );

    const endPart = encoder.encode(
      `\r\n--${boundary}--\r\n`
    );

    const body = new Uint8Array(
      metaPart.length + fileBytes.length + endPart.length
    );

    body.set(metaPart, 0);
    body.set(fileBytes, metaPart.length);
    body.set(endPart, metaPart.length + fileBytes.length);

    // 11. Upload ke Google Drive
    const upload = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );

    const result = await upload.json();

    if (!upload.ok) {
      console.error("Google Drive upload error:", {
        status: upload.status,
        result,
      });

      throw new Error(
        result.error?.message || "Google Drive upload failed."
      );
    }

    // 12. Hasil upload
    return json({
      success: true,
      fileId: result.id,
      name: result.name,
      webViewLink:
        result.webViewLink ||
        `https://drive.google.com/file/d/${result.id}/view`,
    });

  } catch (error) {
    console.error("DRIVE UPLOAD ERROR:", error);

    return json({
      error: error instanceof Error
        ? error.message
        : "Upload failed",
    }, 500);
  }
});
