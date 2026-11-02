
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const html = (message: string, success = false) =>
  new Response(
    `<!doctype html>
    <html>
      <head><meta charset="utf-8"><title>Google Drive</title></head>
      <body style="font-family:Arial,sans-serif;padding:40px">
        <h2>${success ? "Google Drive berhasil dihubungkan" : "Koneksi Google Drive gagal"}</h2>
        <p>${message}</p>
        <p>Silakan tutup halaman ini dan kembali ke aplikasi Custom Desain.</p>
      </body>
    </html>`,
    {
      status: success ? 200 : 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const googleError = url.searchParams.get("error");

    if (googleError) {
      return html("Izin Google ditolak: " + googleError);
    }

    if (!code || !state) {
      return html("Kode atau state OAuth tidak ditemukan.");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
    const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI")!;

    const admin = createClient(supabaseUrl, serviceKey);

    // Validasi state dan batas waktu 10 menit.
    const { data: stateData, error: stateError } = await admin
      .from("google_oauth_states")
      .select("state, created_by, expires_at")
      .eq("state", state)
      .single();

    if (stateError || !stateData) {
      return html("State OAuth tidak valid atau sudah digunakan.");
    }

    // Hapus state agar tidak dapat digunakan kembali.
    await admin
      .from("google_oauth_states")
      .delete()
      .eq("state", state);

    if (new Date(stateData.expires_at).getTime() < Date.now()) {
      return html("Sesi OAuth sudah kedaluwarsa. Silakan ulangi.");
    }

    // Tukar authorization code dengan token Google.
    const tokenResponse = await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      },
    );

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error("Google token exchange error:", tokens);
      return html(
        "Google gagal memberikan token. Periksa OAuth Client dan Redirect URI.",
      );
    }

    if (!tokens.refresh_token) {
      console.error("Google tidak memberikan refresh token.");
      return html(
        "Refresh token tidak diterima. Cabut akses aplikasi dari akun Google, lalu ulangi koneksi dengan izin baru.",
      );
    }

        // Ambil email akun Google yang terhubung.
    if (!tokens.access_token) {
      console.error("Access token tidak ditemukan:", tokens);
      return html("Access token Google tidak diterima.");
    }

    const userInfoResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      },
    );

    const userInfo = await userInfoResponse.json();

    if (!userInfoResponse.ok || !userInfo.email) {
      console.error("Google userinfo error:", {
        status: userInfoResponse.status,
        response: userInfo,
      });

      return html(
        "Token diterima, tetapi email Google gagal diperiksa. Periksa scope OAuth dan log Supabase.",
      );
    }

    const connectedEmail = userInfo.email;

    // Simpan refresh token di tabel yang tidak dapat dibaca browser.
    const { error: saveError } = await admin
      .from("google_drive_tokens")
      .upsert({
        id: 1,
        refresh_token: tokens.refresh_token,
        connected_email: connectedEmail,
        updated_at: new Date().toISOString(),
      });

    if (saveError) throw saveError;

    console.log("Google Drive connected for:", connectedEmail);

    return html(
      "Akun Google " + String(userInfo.email ?? "") +
      " sudah terhubung. Anda dapat kembali ke aplikasi.",
      true,
    );
      } catch (error) {
    console.error(
      "OAuth callback error:",
      JSON.stringify(error, Object.getOwnPropertyNames(error), 2),
    );

    let detail = "";

    if (error instanceof Error) {
      detail = error.message;
    } else {
      try {
        detail = JSON.stringify(error, null, 2);
      } catch {
        detail = String(error);
      }
    }

    return html(
      "Gagal menyimpan koneksi Google Drive. Detail: " + detail,
    );
  }
});
