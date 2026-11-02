
import { supabase } from "./config.js";

const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#username");
const passwordInput = document.querySelector("#password");
const loginError = document.querySelector("#loginError");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  loginError.textContent = "";

  const button = loginForm.querySelector(
    'button[type="submit"]'
  );

  button.disabled = true;
  button.textContent = "MEMERIKSA...";

  try {
    // Mengubah username menjadi email Supabase
    const email = username.includes("@")
      ? username
      : `${username}@exstudio.com`;

    console.log("Mencoba login:", email);

    const { data, error } =
      await supabase.auth.signInWithPassword({
        email,
        password
      });

    if (error) {
      throw error;
    }

    if (!data.user) {
      throw new Error("Akun tidak ditemukan.");
    }

    console.log("Login berhasil:", data.user.email);

    loginError.textContent = "Login berhasil. Mengalihkan...";

    location.replace("dashboard.html");

  } catch (error) {
    console.error("Login gagal:", error);

    loginError.textContent =
      error.message || "Username atau password salah.";

  } finally {
    button.disabled = false;
    button.innerHTML = 'LOGIN <span>→</span>';
  }
});
