
import {
  supabase,
  SUPABASE_URL,
  SUPABASE_ANON_KEY
} from "./config.js";

import { requireUser, escapeHtml } from "./common.js";


const context = await requireUser();

if (!context) {
  throw new Error("Unauthenticated");
}

const grid = document.querySelector("#galleryGrid");
const isAdmin = context.profile?.role === "admin";

// ======================================
// PREVIEW GOOGLE DRIVE GALLERY
// ======================================

async function loadGalleryPreview(img, designId, fileId) {
  try {
    const { data: { session }, error } =
      await supabase.auth.getSession();

    if (error) throw error;

    if (!session?.access_token) {
      throw new Error("Sesi login tidak ditemukan.");
    }

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/drive-preview?designId=${encodeURIComponent(designId)}&fileId=${encodeURIComponent(fileId)}`,
      {
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
    const imageUrl = URL.createObjectURL(blob);

    img.src = imageUrl;

    img.onload = () => {
      URL.revokeObjectURL(imageUrl);
    };

  } catch (error) {
    console.error("Gallery preview error:", error);

    img.style.display = "none";

    const fallback = img.nextElementSibling;

    if (fallback) {
      fallback.style.display = "grid";
    }
  }
}

// ======================================
// 1. MODAL DETAIL GALLERY
// ======================================

const modal = document.createElement("div");

modal.id = "galleryDetailModal";
modal.className = "detail-modal hidden";

modal.innerHTML = `
  <div class="detail-modal-backdrop" id="galleryBackdrop"></div>

  <div class="detail-modal-content">
    <div class="detail-modal-header">
      <div>
        <p class="eyebrow">APPROVED COLLECTION</p>
        <h2>Detail Desain<span>.</span></h2>
      </div>

      <button
        type="button"
        class="btn btn-ghost"
        id="closeGalleryDetail"
      >✕</button>
    </div>

    <div id="galleryDetailContent">
      <p class="muted">Memuat detail...</p>
    </div>
  </div>
`;

document.body.append(modal);

function closeDetail() {
  modal.classList.add("hidden");
  document.body.style.overflow = "";
}

modal.querySelector("#closeGalleryDetail")
  .addEventListener("click", closeDetail);

modal.querySelector("#galleryBackdrop")
  .addEventListener("click", closeDetail);

document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeDetail();
});

// ======================================
// 2. FORMAT DATA
// ======================================

function formatDate(value) {
  if (!value) return "—";

  return new Date(value).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

function thumbnailUrl(file) {
  if (!file?.drive_file_id) return "";

  return file.drive_file_id;
}

function driveUrl(file) {
  if (file.drive_url) return file.drive_url;

  if (file.drive_file_id) {
    return `https://drive.google.com/file/d/${encodeURIComponent(file.drive_file_id)}/view`;
  }

  return "";
}

// ======================================
// 3. DETAIL DESAIN
// ======================================

function openDetail(design) {
  const content = modal.querySelector("#galleryDetailContent");

  const results = (design.design_files || [])
    .filter(file => file.file_type === "result");

  content.innerHTML = `
    <div class="detail-info-grid">

      <div class="detail-info-item full">
        <small>Nama Project / Customer</small>
        <p><strong>${escapeHtml(design.project_name)}</strong></p>
      </div>

      <div class="detail-info-item">
        <small>Jenis Apparel</small>
        <p>${escapeHtml(design.apparel_type || "—")}</p>
      </div>

      <div class="detail-info-item">
        <small>Tanggal Approved</small>
        <p>${formatDate(design.approved_at)}</p>
      </div>

      <div class="detail-info-item full">
        <small>Detail Brief</small>
        <p>${escapeHtml(design.brief || "Tidak ada detail brief.")}</p>
      </div>

      <div class="detail-info-item full">
        <small>Hasil Desain (${results.length})</small>

        ${
          results.length
            ? `
              <div class="detail-images">
                ${results.map(file => {
                  const image = thumbnailUrl(file);
                  const link = driveUrl(file);

                  return `
                    <div class="gallery-detail-image">
                      ${
                        image
                          ? `
                            <img
                              src="${escapeHtml(image)}"
                              alt="${escapeHtml(file.file_name || "Hasil desain")}"
                              loading="lazy"
                              onerror="
                                this.style.display='none';
                                this.nextElementSibling.style.display='block';
                              "
                            >
                            <div class="preview-fallback" style="display:none">
                              Preview tidak tersedia
                            </div>
                          `
                          : `
                            <div class="preview-fallback">
                              Preview tidak tersedia
                            </div>
                          `
                      }

                      ${
                        link
                          ? `
                            <a
                              href="${escapeHtml(link)}"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              ${escapeHtml(file.file_name || "Buka hasil desain")} ↗
                            </a>
                          `
                          : `<small>${escapeHtml(file.file_name || "File desain")}</small>`
                      }
                    </div>
                  `;
                }).join("")}
              </div>
            `
            : `<p class="muted">Belum ada hasil desain.</p>`
        }
      </div>

    </div>
  `;

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

// ======================================
// 4. LOAD GALLERY
// ======================================

async function loadGallery() {
  if (!grid) return;

  grid.innerHTML = `
    <p class="muted">Memuat gallery...</p>
  `;

  const { data, error } = await supabase
    .from("designs")
    .select(`
      id,
      project_name,
      apparel_type,
      brief,
      approved_at,
      design_files(*)
    `)
    .eq("status", "approved")
    .order("approved_at", { ascending: false });

  if (error) {
    console.error("Gallery error:", error);
    grid.textContent = error.message;
    return;
  }

  const designs = data || [];

  if (!designs.length) {
    grid.innerHTML = `
      <p class="muted">
        Belum ada desain approved.
      </p>
    `;
    return;
  }

  // Hanya desain yang memiliki hasil upload
  const approvedDesigns = designs.filter(design =>
    (design.design_files || []).some(
      file => file.file_type === "result"
    )
  );

  if (!approvedDesigns.length) {
    grid.innerHTML = `
      <p class="muted">
        Desain sudah approved, tetapi belum ada hasil desain yang dapat ditampilkan.
      </p>
    `;
    return;
  }

  grid.innerHTML = approvedDesigns.map(design => {
    const results = (design.design_files || [])
      .filter(file => file.file_type === "result");

    const firstImage = thumbnailUrl(results[0]);

    return `
      <article class="gallery-card">

        <div class="gallery-card-preview">
          ${
            firstImage
              ? `
                <img
                  data-gallery-preview="${escapeHtml(firstImage)}"
                  data-design-id="${escapeHtml(design.id)}"
                  alt="${escapeHtml(design.project_name)}"
                  loading="lazy"
                >
                <div class="gallery-no-preview" style="display:none">
                  Preview tidak tersedia
                </div>
              `
              : `
                <div class="gallery-no-preview">
                  Preview tidak tersedia
                </div>
              `
          }
        </div>

        <div class="gallery-info">

          <span class="status approved">APPROVED</span>

          <h3>${escapeHtml(design.project_name)}</h3>

          <p>
            ${escapeHtml(design.apparel_type || "—")}
            · ${formatDate(design.approved_at)}
          </p>

          <p>
            ${escapeHtml((design.brief || "").slice(0, 140))}
          </p>

          <small class="muted">
            ${results.length} hasil desain
          </small>

          <div class="gallery-actions">
          <button
            type="button"
            class="btn btn-primary gallery-detail-btn"
            data-gallery-detail="${escapeHtml(design.id)}"
          >
            LIHAT DETAIL ↗
          </button>

          ${
            isAdmin
              ? `
                <button
                  type="button"
                  class="btn btn-danger"
                  data-gallery-delete="${escapeHtml(design.id)}"
                >
                  HAPUS PERMANEN
                </button>
              `
              : ""
          }
          </div>

        </div>
      </article>
    `;
  }).join("");

  // Load preview gambar dari Google Drive
grid.querySelectorAll("[data-gallery-preview]")
  .forEach(img => {
    loadGalleryPreview(
      img,
      img.dataset.designId,
      img.dataset.galleryPreview
    );
  });

  // Event tombol detail
  grid.querySelectorAll("[data-gallery-detail]")
    .forEach(button => {
      button.addEventListener("click", () => {
        const design = approvedDesigns.find(
          item => String(item.id) === button.dataset.galleryDetail
        );

        if (design) openDetail(design);
      });
    });
}

// ======================================
// 5. JALANKAN GALLERY
// ======================================

await loadGallery();
