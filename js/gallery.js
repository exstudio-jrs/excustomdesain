
import {
  supabase,
  SUPABASE_URL,
  SUPABASE_ANON_KEY
} from "./config.js";

import { requireUser } from "./common.js";

const context = await requireUser();

if (!context?.user || !context?.profile) {
  throw new Error("Data login atau profil tidak ditemukan.");
}

const { profile } = context;

const grid = document.querySelector("#galleryGrid");
const isDesigner = profile.role === "designer";

// ======================================
// 1. STYLE GALLERY DAN LIGHTBOX
// ======================================

const galleryStyle = document.createElement("style");

galleryStyle.textContent = `
  .approved-gallery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 22px;
  }

  .approved-image-card {
    overflow: hidden;
    border-radius: 14px;
    background: var(--card-bg, #fff);
    border: 1px solid rgba(128,128,128,.2);
  }

  .approved-image-frame {
    width: 100%;
    aspect-ratio: 4 / 3;
    background: #f1f1f1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .approved-image-frame img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  .approved-image-fallback {
    display: none;
    padding: 20px;
    text-align: center;
    color: #888;
  }

  .approved-image-actions {
    padding: 12px;
  }

  .approved-image-actions button {
    width: 100%;
  }

  .gallery-lightbox {
    position: fixed;
    inset: 0;
    z-index: 99999;
    display: none;
    align-items: center;
    justify-content: center;
    padding: 25px;
    background: rgba(0,0,0,.92);
  }

  .gallery-lightbox.show {
    display: flex;
  }

  .gallery-lightbox img {
    max-width: 95%;
    max-height: 88vh;
    object-fit: contain;
  }

  .gallery-lightbox-close {
    position: absolute;
    top: 20px;
    right: 25px;
    width: 42px;
    height: 42px;
    border: 0;
    border-radius: 50%;
    background: white;
    color: #111;
    font-size: 24px;
    cursor: pointer;
  }

  @media(max-width:600px) {
    .approved-gallery-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .approved-image-actions {
      padding: 8px;
    }

    .approved-image-actions button {
      font-size: 11px;
      padding: 9px 5px;
    }
  }
`;

document.head.append(galleryStyle);

// ======================================
// 2. LIGHTBOX
// ======================================

const lightbox = document.createElement("div");

lightbox.className = "gallery-lightbox";

lightbox.innerHTML = `
  <button
    type="button"
    class="gallery-lightbox-close"
    aria-label="Tutup"
  >×</button>

  <img src="" alt="Preview gambar desain">
`;

document.body.append(lightbox);

const lightboxImage = lightbox.querySelector("img");

function closeLightbox() {
  lightbox.classList.remove("show");
  lightboxImage.src = "";
  document.body.style.overflow = "";
}

function openLightbox(imageUrl) {
  if (!imageUrl) return;

  lightboxImage.src = imageUrl;
  lightbox.classList.add("show");
  document.body.style.overflow = "hidden";
}

lightbox.querySelector(".gallery-lightbox-close")
  .addEventListener("click", closeLightbox);

lightbox.addEventListener("click", event => {
  if (event.target === lightbox) {
    closeLightbox();
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeLightbox();
  }
});

// ======================================
// 3. PREVIEW GOOGLE DRIVE
// ======================================

const previewUrls = new Set();

async function loadGalleryPreview(img, button, designId, fileId) {
  try {
    const {
      data: { session },
      error
    } = await supabase.auth.getSession();

    if (error) throw error;

    if (!session?.access_token) {
      throw new Error("Sesi login tidak ditemukan.");
    }

    const params = new URLSearchParams({
      designId,
      fileId
    });

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/drive-preview?${params}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Preview gagal: HTTP ${response.status}`);
    }

    const blob = await response.blob();

    if (!blob.type.startsWith("image/")) {
      throw new Error("File bukan gambar.");
    }

    const imageUrl = URL.createObjectURL(blob);

    previewUrls.add(imageUrl);

    img.src = imageUrl;

    img.onload = () => {
      button.disabled = false;
      button.textContent = "PERBESAR GAMBAR";
    };

    img.onerror = () => {
      button.disabled = true;
      img.style.display = "none";

      const fallback = img
        .closest(".approved-image-card")
        ?.querySelector(".approved-image-fallback");

      if (fallback) {
        fallback.style.display = "block";
      }
    };

  } catch (error) {
    console.error("Gallery preview error:", {
      designId,
      fileId,
      error
    });

    img.style.display = "none";

    const fallback = img
      .closest(".approved-image-card")
      ?.querySelector(".approved-image-fallback");

    if (fallback) {
      fallback.style.display = "block";
    }

    button.disabled = true;
    button.textContent = "GAMBAR TIDAK TERSEDIA";
  }
}

// ======================================
// 4. LOAD GALLERY APPROVED
// ======================================

async function loadGallery() {
  if (!grid) return;

  grid.innerHTML = `
    <p class="muted">Memuat Gallery Approved...</p>
  `;

  const { data, error } = await supabase
    .from("designs")
    .select(`
      id,
      design_files (
        id,
        file_type,
        file_name,
        drive_file_id
      )
    `)
    .eq("status", "approved")
    .order("approved_at", { ascending: false });

  if (error) {
    console.error("Gallery error:", error);
    grid.textContent = error.message;
    return;
  }

  const designs = data || [];

  // Ambil semua hasil desain dari desain yang approved
  const approvedImages = [];

  designs.forEach(design => {
    const results = (design.design_files || [])
      .filter(file =>
        file.file_type === "result" &&
        file.drive_file_id
      );

    results.forEach(file => {
      approvedImages.push({
        designId: design.id,
        fileId: file.drive_file_id
      });
    });
  });

  if (!approvedImages.length) {
    grid.innerHTML = `
      <p class="muted">
        Belum ada gambar desain approved.
      </p>
    `;
    return;
  }

  grid.classList.add("approved-gallery-grid");

  grid.innerHTML = approvedImages.map((item, index) => `
    <article class="approved-image-card">

      <div class="approved-image-frame">

        <img
          data-gallery-image="${index}"
          alt="Desain approved ${index + 1}"
          loading="lazy"
        >

        <div class="approved-image-fallback">
          Preview tidak tersedia
        </div>

      </div>

      <div class="approved-image-actions">

        <button
          type="button"
          class="btn btn-primary"
          data-enlarge-image="${index}"
          disabled
        >
          MEMUAT GAMBAR...
        </button>

      </div>

    </article>
  `).join("");

  // Muat gambar dari Google Drive
  approvedImages.forEach((item, index) => {
    const img = grid.querySelector(
      `[data-gallery-image="${index}"]`
    );

    const button = grid.querySelector(
      `[data-enlarge-image="${index}"]`
    );

    loadGalleryPreview(
      img,
      button,
      item.designId,
      item.fileId
    );
  });
}

// ======================================
// 5. EVENT PERBESAR GAMBAR
// ======================================

grid?.addEventListener("click", event => {
  const button = event.target.closest("[data-enlarge-image]");

  if (!button || button.disabled) return;

  const index = button.dataset.enlargeImage;

  const img = grid.querySelector(
    `[data-gallery-image="${index}"]`
  );

  if (img?.src && img.complete) {
    openLightbox(img.src);
  }
});

// ======================================
// 6. NAVIGASI BERDASARKAN ROLE
// ======================================

const navMasterHarga = document.querySelector("#navMasterHarga");
const navManajemenPO = document.querySelector("#navManajemenPO");
const navManajemenNota = document.querySelector("#navManajemenNota");
const navReportOmset = document.querySelector("#navReportOmset");
const navPdfToCsv = document.querySelector("#navPdfToCsv");

if (navMasterHarga) {
  navMasterHarga.classList.toggle(
    "hidden",
    !["admin", "marketing"].includes(profile.role)
  );
}

if (navPdfToCsv) {
  navPdfToCsv.classList.toggle("hidden", !isDesigner);
}

if (navManajemenPO) {
  navManajemenPO.classList.toggle("hidden", isDesigner);
}

if (navManajemenNota) {
  navManajemenNota.classList.toggle("hidden", isDesigner);
}

if (navReportOmset) {
  navReportOmset.classList.toggle(
    "hidden",
    !["marketing", "admin", "admin_po", "designer"].includes(profile.role)
  );
}

// ======================================
// 7. JALANKAN GALLERY
// ======================================

await loadGallery();
