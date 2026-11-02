
import {
  supabase,
  SUPABASE_URL,
  SUPABASE_ANON_KEY
} from "./config.js";

// =====================================
// MEMERIKSA USER YANG SEDANG LOGIN
// =====================================
export async function requireUser() {
  try {
    console.log("Memeriksa session...");

    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.warn("User belum login:", authError);
      await supabase.auth.signOut();
      location.replace("login.html");
      return null;
    }

    // Mengambil profil dan role user
    const { data: profile, error: profileError } =
      await supabase
        .from("profiles")
        .select("id, username, role")
        .eq("id", user.id)
        .single();

    if (profileError || !profile) {
      console.error(
        "Profil user gagal ditemukan:",
        profileError
      );

      await supabase.auth.signOut();
      location.replace("login.html");
      return null;
    }

    // Memastikan role valid
    const validRoles = [
      "marketing",
      "designer",
      "admin"
    ];

    if (!validRoles.includes(profile.role)) {
      console.error("Role user tidak valid:", profile.role);

      await supabase.auth.signOut();
      location.replace("login.html");
      return null;
    }

    // Menampilkan informasi user
    const label = document.querySelector("#userLabel");

    if (label) {
      label.textContent =
        `${profile.username} · ${profile.role.toUpperCase()}`;
    }

    // Tombol logout
    const logout = document.querySelector("#logoutBtn");

    if (logout && !logout.dataset.listenerAdded) {
      logout.dataset.listenerAdded = "true";

      logout.addEventListener("click", async () => {
        logout.disabled = true;
        logout.textContent = "Keluar...";

        const { error } = await supabase.auth.signOut();

        if (error) {
          console.error("Logout gagal:", error);
          logout.disabled = false;
          logout.textContent = "Keluar";
          alert("Gagal keluar. Silakan coba lagi.");
          return;
        }

        location.replace("login.html");
      });
    }

    console.log("Login berhasil:", profile);

    return {
      user,
      profile
    };

  } catch (error) {
    console.error("Kesalahan pemeriksaan user:", error);

    location.replace("login.html");
    return null;
  }
}


// =====================================
// UPLOAD FILE KE GOOGLE DRIVE
// =====================================
export async function uploadToDrive(
  file,
  folderType,
  designId
) {
  // Validasi file
  if (!(file instanceof File)) {
    throw new Error("File yang akan diupload tidak valid.");
  }

  if (!folderType || !designId) {
    throw new Error(
      "Folder upload atau ID desain tidak ditemukan."
    );
  }

  // Mengambil session aktif
  const {
    data: { session },
    error: sessionError
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  if (!session?.access_token) {
    throw new Error(
      "Session tidak ditemukan. Silakan login kembali."
    );
  }

  // Menyiapkan data upload
  const form = new FormData();

  form.append("file", file);
  form.append("folderType", folderType);
  form.append("designId", String(designId));

  console.log("Memulai upload Google Drive:", {
    fileName: file.name,
    fileSize: file.size,
    folderType,
    designId
  });

  // Mengirim file ke Supabase Edge Function
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/drive-upload`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY
      },
      body: form
    }
  );

  // Membaca respons server
  const responseText = await response.text();

  let result;

  try {
    result = responseText
      ? JSON.parse(responseText)
      : {};
  } catch {
    throw new Error(
      `Respons server tidak valid. HTTP ${response.status}: ${responseText.slice(0, 200)}`
    );
  }

  console.log("Drive upload response:", {
    status: response.status,
    result
  });

  // Memeriksa status upload
  if (!response.ok) {
    throw new Error(
      result.message ||
      result.error ||
      result.details ||
      `Upload gagal. HTTP ${response.status}`
    );
  }

  // Memastikan file ID diterima
  if (!result.fileId) {
    throw new Error(
      "Upload tidak berhasil: fileId tidak ditemukan dari server."
    );
  }

  return result;
}


// =====================================
// MENGAMANKAN TEKS HTML
// =====================================
export function escapeHtml(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]
  );
}
