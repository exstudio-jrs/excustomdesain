
import { supabase } from "./config.js";

const { data: userData } = await supabase.auth.getUser();

console.log("USER LOGIN:", userData.user);

if (userData.user) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, role")
    .eq("id", userData.user.id)
    .single();

  console.log("PROFILE LOGIN:", profile);
}

const status = document.querySelector("#driveStatus");
const button = document.querySelector("#connectDriveBtn");
const message = document.querySelector("#driveMessage");

async function initialize() {
  const { data: userData, error } = await supabase.auth.getUser();

  if (error || !userData.user) {
    status.textContent = "Silakan login terlebih dahulu.";
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (profileError || profile?.role !== "admin") {
    status.textContent = "Hanya Admin yang dapat menghubungkan Google Drive.";
    return;
  }

  status.textContent = "Login sebagai Admin.";
  button.disabled = false;
}

button.addEventListener("click", async () => {
  button.disabled = true;
  button.textContent = "Menghubungkan...";

  try {
    const { data, error } = await supabase.functions.invoke(
      "google-oauth-start",
      { body: {} }
    );

    if (error) throw error;

    if (!data?.authorizationUrl) {
      throw new Error(data?.error || "URL otorisasi tidak ditemukan.");
    }

    window.location.href = data.authorizationUrl;
  } catch (error) {
    console.error(error);
    message.textContent = error.message;
    button.disabled = false;
    button.textContent = "Hubungkan Google Drive";
  }
});

initialize();
