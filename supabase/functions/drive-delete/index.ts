
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

    // Client untuk memverifikasi pengguna
    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: { Authorization: auth },
      },
    });

    // Client server untuk operasi database
    const admin = createClient(supabaseUrl, serviceKey);

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return json({ error: "Unauthorized user" }, 401);
    }

    // Pastikan pengguna benar-benar Admin
    const { data: profile, error: profileError } =
      await admin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

    if (profileError || profile?.role !== "admin") {
      return json({
        error: "Hanya Admin yang boleh menghapus desain.",
      }, 403);
    }

    const body = await req.json();
    const designId = String(body.designId || "").trim();

    if (!designId) {
      return json({ error: "Design ID wajib diisi." }, 400);
    }

    // Pastikan desain benar-benar approved
    const { data: design, error: designError } =
      await admin
        .from("designs")
        .select("id, project_name, status")
        .eq("id", designId)
        .single();

    if (designError || !design) {
      return json({ error: "Desain tidak ditemukan." }, 404);
    }

    if (design.status !== "approved") {
      return json({
        error: "Hanya desain approved yang dapat dihapus.",
      }, 403);
    }

    // Ambil seluruh file desain dan revisi
    const { data: files, error: filesError } =
      await admin
        .from("design_files")
        .select("id, drive_file_id")
        .eq("design_id", designId);

    if (filesError) throw filesError;

    // Ambil token Google Drive
    const token = await driveToken(admin);

    // Hapus semua file fisik di Google Drive
    for (const file of files || []) {
      if (!file.drive_file_id) continue;

      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.drive_file_id)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      // File yang sudah tidak ada dianggap selesai.
      if (!response.ok && response.status !== 404) {
        const detail = await response.text();

        throw new Error(
          `Gagal menghapus file Drive ${file.drive_file_id}: ${detail}`
        );
      }
    }

    // Hapus catatan file di Supabase
    const { error: deleteFilesError } = await admin
      .from("design_files")
      .delete()
      .eq("design_id", designId);

    if (deleteFilesError) throw deleteFilesError;

    // Hapus data desain
    const { error: deleteDesignError } = await admin
      .from("designs")
      .delete()
      .eq("id", designId)
      .eq("status", "approved");

    if (deleteDesignError) throw deleteDesignError;

    return json({
      success: true,
      message: "Desain dan file terkait berhasil dihapus permanen.",
      designId,
      deletedFiles: (files || []).length,
    });

  } catch (error) {
    console.error("DRIVE DELETE ERROR:", error);

    return json({
      error: error instanceof Error
        ? error.message
        : "Gagal menghapus desain.",
    }, 500);
  }
});
