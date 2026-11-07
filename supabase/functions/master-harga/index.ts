const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return Response.json(
      { success: false, message: "Method tidak diizinkan." },
      { status: 405, headers: corsHeaders }
    );
  }

  try {
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      return Response.json(
        { success: false, message: "Token login tidak ditemukan." },
        { status: 401, headers: corsHeaders }
      );
    }

    const appsScriptUrl = Deno.env.get("APPS_SCRIPT_MASTER_URL");

    if (!appsScriptUrl) {
      throw new Error("Secret APPS_SCRIPT_MASTER_URL belum dipasang.");
    }

    const payload = await req.json();

    // Token diteruskan ke Apps Script untuk verifikasi user dan role.
    const response = await fetch(appsScriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...payload,
        access_token: token,
      }),
    });

    const responseText = await response.text();

    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error("Respons Apps Script bukan JSON yang valid.");
    }

    return Response.json(result, {
      status: response.ok ? 200 : response.status,
      headers: corsHeaders,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        message: error instanceof Error
          ? error.message
          : "Terjadi kesalahan server.",
      },
      { status: 500, headers: corsHeaders }
    );
  }
});