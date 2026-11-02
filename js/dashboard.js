
import {
  supabase,
  SUPABASE_URL,
  SUPABASE_ANON_KEY
} from "./config.js";

import {
  requireUser,
  uploadToDrive,
  escapeHtml
} from "./common.js";

// ======================================
// 1. USER DAN ROLE
// ======================================

const context = await requireUser();

if (!context?.user || !context?.profile) {
  throw new Error("Data login atau profil pengguna tidak ditemukan.");
}

const { user, profile } = context;

const isAdmin = profile.role === "admin";
const isMarketing = profile.role === "marketing";
const isDesigner = profile.role === "designer";

// ======================================
// 2. ELEMEN DASHBOARD
// ======================================

const marketingPanel = document.querySelector("#marketingPanel");
const workTitle = document.querySelector("#workTitle");
const form = document.querySelector("#briefForm");

const fileInput = document.querySelector("#referenceFiles");
const preview = document.querySelector("#referencePreview");
const workList = document.querySelector("#workList");
const refreshBtn = document.querySelector("#refreshBtn");

// Panel Marketing tampil untuk Marketing dan Admin.
if (marketingPanel) {
  marketingPanel.classList.toggle(
    "hidden",
    !isMarketing && !isAdmin
  );
}

// Variabel global dashboard.
let selectedFiles = [];
let previewUrls = [];
const designCache = new Map();

// ======================================
// 3. BRIEF FORM ACCORDION
// ======================================

const briefToggle = document.querySelector("#briefToggle");
const briefFormContent = document.querySelector("#briefFormContent");
const briefToggleIcon = document.querySelector("#briefToggleIcon");

// Kondisi awal accordion selalu tertutup.
function closeBriefForm() {
  briefFormContent?.classList.add("hidden");

  if (briefToggle) {
    briefToggle.setAttribute("aria-expanded", "false");
  }

  if (briefToggleIcon) {
    briefToggleIcon.textContent = "+";
  }
}

function openBriefForm() {
  briefFormContent?.classList.remove("hidden");

  if (briefToggle) {
    briefToggle.setAttribute("aria-expanded", "true");
  }

  if (briefToggleIcon) {
    briefToggleIcon.textContent = "−";
  }
}

closeBriefForm();

briefToggle?.addEventListener("click", () => {
  if (!briefFormContent) {
    console.error("Elemen briefFormContent tidak ditemukan.");
    return;
  }

  const isOpen = !briefFormContent.classList.contains("hidden");

  if (isOpen) {
    closeBriefForm();
  } else {
    openBriefForm();
  }
});

// ======================================
// 4. HELPER
// ======================================

function formatDate(value) {
  if (!value) return "Belum ditentukan";

  return new Date(value).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

function getDrivePreview(file) {
  let fileId = file.drive_file_id || "";

  if (!fileId) {
    const url = file.preview_url || file.drive_url || "";
    const match = url.match(/\/file\/d\/([^/?]+)/);

    if (match) {
      fileId = match[1];
    }
  }

  if (fileId) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(
      fileId
    )}&sz=w1000`;
  }

  const previewUrl = file.preview_url || "";

  if (previewUrl && !previewUrl.includes("/file/d/")) {
    return previewUrl;
  }

  return "";
}

function getDriveFileUrl(file) {
  if (file.drive_url) {
    return file.drive_url;
  }

  if (file.drive_file_id) {
    return `https://drive.google.com/file/d/${encodeURIComponent(
      file.drive_file_id
    )}/view`;
  }

  return file.preview_url || "";
}

function showBriefMessage(message, isError = false) {
  const msg = document.querySelector("#briefMessage");

  if (!msg) return;

  msg.textContent = message;
  msg.style.color = isError ? "#ffaaaa" : "var(--lime)";
}

window.openImagePreview = function(img) {
  const imageUrl = img?.dataset.previewBlobUrl;

  if (!imageUrl) {
    console.error("URL preview gambar tidak tersedia.");
    return;
  }

  let modal = document.getElementById("imagePreviewModal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "imagePreviewModal";
    modal.className = "image-preview-modal";

    modal.innerHTML = `
      <button class="image-preview-close" onclick="closeImagePreview()">
        &times;
      </button>
      <img id="imagePreviewFull" alt="Preview gambar">
    `;

    document.body.appendChild(modal);
  }

  document.getElementById("imagePreviewFull").src = imageUrl;
  modal.classList.add("show");
};

window.closeImagePreview = function() {
  const modal = document.getElementById("imagePreviewModal");

  if (modal) {
    modal.classList.remove("show");

    const previewImage = document.getElementById("imagePreviewFull");

    if (previewImage) {
      previewImage.src = "";
    }
  }
};

function closeImagePreview() {
  const modal = document.getElementById("imagePreviewModal");

  if (modal) {
    modal.classList.remove("show");
  }
}

// ======================================
// 5. DETAIL DESAIN
// ======================================

const detailModal = document.querySelector("#designDetailModal");
const detailContent = document.querySelector("#detailContent");
const closeDetailBtn = document.querySelector("#closeDetailModal");
const detailBackdrop = document.querySelector("#detailBackdrop");


async function loadDrivePreviews() {
  if (!detailContent) return;

  const images = Array.from(
    detailContent.querySelectorAll("img[data-drive-preview]")
  );

  const {
    data: { session },
    error: sessionError
  } = await supabase.auth.getSession();

  if (sessionError || !session) {
    console.error("Session preview tidak tersedia.");
    return;
  }

  await Promise.all(
    images.map(async (img) => {
      const fileId = img.dataset.drivePreview;
      const designId = img.dataset.designId;

      if (!fileId || !designId || img.dataset.loaded === "true") {
        return;
      }

      try {
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
          throw new Error(await response.text());
        }

        const blob = await response.blob();

        if (!blob.type.startsWith("image/")) {
          throw new Error("Respons bukan file gambar.");
        }

        const objectUrl = URL.createObjectURL(blob);

        // Simpan URL blob agar dapat digunakan popup
        img.dataset.previewBlobUrl = objectUrl;

        img.onerror = () => {
          img.alt = "Gagal menampilkan preview gambar";
          img.dataset.loaded = "false";
        };

        img.src = objectUrl;
        img.dataset.loaded = "true";

      } catch (error) {
        console.error("Gagal memuat preview:", fileId, error);
        img.alt = "Preview tidak tersedia";
      }
    })
  );
}


function openDesignDetail(id) {
  const d = designCache.get(String(id));

  if (!d || !detailModal || !detailContent) return;

  const statusLabels = {
    queued: "Antrian",
    claimed: "Sedang dikerjakan",
    submitted: "Menunggu approval",
    revision: "Menunggu revisi",
    approved: "Approved"
  };

  const files = d.design_files || [];

  const references = files.filter(file =>
    ["reference", "revision_reference"].includes(file.file_type)
  );

  const results = files.filter(file =>
    file.file_type === "result"
  );

  function renderImages(items, emptyMessage) {
  if (!items.length) {
    return `<p class="muted">${emptyMessage}</p>`;
  }

  return `
    <div class="detail-images">
      ${items.map(file => {
        const previewUrl = getDrivePreview(file);

        return `
          <div class="detail-image-item">
            ${
              previewUrl
                ? `<img
                    data-drive-preview="${escapeHtml(file.drive_file_id || "")}"
                    data-design-id="${escapeHtml(d.id)}"
                    alt="${escapeHtml(file.file_name || "Preview desain")}"
                    loading="lazy"
                    class="drive-preview-image"
                    onclick="openImagePreview(this)"
                    title="Klik untuk memperbesar gambar"
                  >`
                : `<p class="muted">Preview tidak tersedia</p>`
            }
            
          </div>
        `;
      }).join("")}
    </div>
  `;
}

  detailContent.innerHTML = `
    <div class="detail-info-grid">

      <div class="detail-info-item full">
        <small>Nama Project / Customer</small>
        <p><strong>${escapeHtml(d.project_name || "-")}</strong></p>
      </div>

      <div class="detail-info-item">
        <small>Jenis Apparel</small>
        <p>${escapeHtml(d.apparel_type || "—")}</p>
      </div>

      <div class="detail-info-item">
        <small>Deadline</small>
        <p>${escapeHtml(formatDate(d.deadline))}</p>
      </div>

      <div class="detail-info-item">
        <small>Tanggal Brief</small>
        <p>${escapeHtml(formatDate(d.created_at))}</p>
      </div>

      <div class="detail-info-item">
        <small>Marketing</small>
        <p>${escapeHtml(d.profiles?.username || "—")}</p>
      </div>

      <div class="detail-info-item">
        <small>Status</small>
        <p>${escapeHtml(statusLabels[d.status] || d.status || "—")}</p>
      </div>

      <div class="detail-info-item full">
        <small>Detail Brief / Konsep Desain</small>
        <p>${escapeHtml(d.brief || "Tidak ada detail brief.")}</p>
      </div>

      <div class="detail-info-item full">
        <small>Catatan Revisi Marketing</small>
        <p>${escapeHtml(d.revision_notes || "Tidak ada catatan revisi.")}</p>
      </div>

      <div class="detail-info-item full">
        <small>Gambar Referensi (${references.length})</small>
        ${renderImages(references, "Belum ada gambar referensi.")}
      </div>

      <div class="detail-info-item full">
        <small>Hasil Desain (${results.length})</small>
        ${renderImages(results, "Belum ada hasil desain.")}
      </div>

    </div>
  `;

  detailModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  loadDrivePreviews();
}

function closeDesignDetail() {
  detailModal?.classList.add("hidden");
  document.body.style.overflow = "";
}

closeDetailBtn?.addEventListener("click", closeDesignDetail);
detailBackdrop?.addEventListener("click", closeDesignDetail);

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeDesignDetail();
  }
});

// ======================================
// 6. PREVIEW GAMBAR REFERENSI
// ======================================

function clearPreview() {
  previewUrls.forEach(url => URL.revokeObjectURL(url));
  previewUrls = [];

  if (preview) {
    preview.innerHTML = "";
  }
}

fileInput?.addEventListener("change", () => {
  const files = Array.from(fileInput.files || []);

  if (files.length > 10) {
    alert("Maksimal 10 gambar referensi.");
    fileInput.value = "";
    selectedFiles = [];
    clearPreview();
    return;
  }

  const invalidFile = files.find(file =>
    !file.type.startsWith("image/") ||
    file.size > 15 * 1024 * 1024
  );

  if (invalidFile) {
    alert(
      `File "${invalidFile.name}" tidak valid. Gunakan gambar maksimal 15 MB per file.`
    );

    fileInput.value = "";
    selectedFiles = [];
    clearPreview();
    return;
  }

  selectedFiles = files;
  clearPreview();

  selectedFiles.forEach(file => {
    const img = document.createElement("img");
    const url = URL.createObjectURL(file);

    previewUrls.push(url);

    img.src = url;
    img.alt = file.name;

    preview?.append(img);
  });
});

// ======================================
// 7. INPUT BRIEF DESAIN
// ======================================

form?.addEventListener("submit", async event => {
  event.preventDefault();

  const submitBtn = form.querySelector('button[type="submit"]');

  if (!isMarketing && !isAdmin) {
    showBriefMessage(
      "Role ini tidak memiliki izin membuat brief.",
      true
    );
    return;
  }

  if (submitBtn) submitBtn.disabled = true;

  let designCreated = false;

  try {
    if (selectedFiles.length > 10) {
      throw new Error("Maksimal 10 gambar referensi.");
    }

    const values = Object.fromEntries(
      new FormData(form).entries()
    );

    if (!values.project_name?.trim()) {
      throw new Error("Nama project wajib diisi.");
    }

    if (!values.brief?.trim()) {
      throw new Error("Detail brief wajib diisi.");
    }

    if (!values.apparel_type?.trim()) {
      throw new Error("Jenis apparel wajib dipilih.");
    }

    showBriefMessage("Menyimpan brief...");

    const { data: design, error } = await supabase
      .from("designs")
      .insert({
        project_name: values.project_name.trim(),
        apparel_type: values.apparel_type,
        deadline: values.deadline || null,
        main_color: values.main_color || "",
        brief: values.brief.trim(),
        created_by: profile.id,
        status: "queued"
      })
      .select()
      .single();

    if (error) throw error;

    designCreated = true;

    for (const file of selectedFiles) {
      showBriefMessage(`Mengunggah ${file.name}...`);

      const uploaded = await uploadToDrive(
        file,
        "references",
        design.id
      );

      if (!uploaded?.fileId) {
        throw new Error(
          `Google Drive tidak mengembalikan ID untuk file ${file.name}.`
        );
      }

      const { error: imageError } = await supabase
        .from("design_files")
        .insert({
          design_id: design.id,
          file_type: "reference",
          file_name: file.name,
          drive_file_id: uploaded.fileId,
          drive_url: uploaded.webViewLink || null,
          preview_url: uploaded.webViewLink || null,
          uploaded_by: profile.id
        });

      if (imageError) throw imageError;
    }

    form.reset();
    selectedFiles = [];
    clearPreview();

    closeBriefForm();

    showBriefMessage("Brief berhasil disimpan.");

    try {
      await load();
    } catch (refreshError) {
      console.error("Refresh setelah input brief gagal:", refreshError);

      showBriefMessage(
        "Brief berhasil disimpan, tetapi daftar belum berhasil diperbarui. Klik Refresh.",
        true
      );
    }

  } catch (error) {
    console.error("Input brief error:", error);

    showBriefMessage(
      designCreated
        ? `Brief sudah tersimpan, tetapi proses upload atau penyimpanan referensi gagal: ${error.message}`
        : `Gagal menyimpan brief: ${error.message}`,
      true
    );

  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

// ======================================
// 8. REFRESH DATA
// ======================================

refreshBtn?.addEventListener("click", async () => {
  refreshBtn.disabled = true;

  try {
    await load();
  } catch (error) {
    console.error("Refresh error:", error);
    alert(`Gagal memuat data: ${error.message}`);
  } finally {
    refreshBtn.disabled = false;
  }
});

// ======================================
// 9. LOAD DATA DESAIN
// ======================================

async function load() {
  if (!workList) return;

  workList.innerHTML =
    '<p class="muted">Memuat data...</p>';

  const { data, error } = await supabase
    .from("designs")
    .select(`
      *,
      profiles!designs_created_by_fkey(username),
      designer:profiles!designs_assigned_to_fkey(username),
      design_files(*)
    `)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Load designs error:", error);

    workList.innerHTML = `
      <p class="muted">
        Gagal memuat data: ${escapeHtml(error.message)}
      </p>
    `;

    throw error;
  }

  const designs = data || [];

  designCache.clear();

  designs.forEach(design => {
    designCache.set(String(design.id), design);
  });

  // Filter pekerjaan sesuai role.
  const visible = isDesigner
    ? designs.filter(design =>
        design.status !== "approved" &&
        (
          design.status === "queued" ||
          design.assigned_to === profile.id
        )
      )
    : isMarketing
      ? designs.filter(design =>
          design.created_by === profile.id &&
          design.status !== "approved"
        )
      : designs.filter(design =>
          design.status !== "approved"
        );

  // Statistik.
  const counts = designs.reduce((result, item) => {
    result.total++;
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, { total: 0 });

  const statTotal = document.querySelector("#statTotal");
  const statQueue = document.querySelector("#statQueue");
  const statWorking = document.querySelector("#statWorking");
  const statApproved = document.querySelector("#statApproved");

  if (statTotal) statTotal.textContent = counts.total;
  if (statQueue) statQueue.textContent = counts.queued || 0;

  if (statWorking) {
    statWorking.textContent =
      (counts.claimed || 0) +
      (counts.submitted || 0) +
      (counts.revision || 0);
  }

  if (statApproved) {
    statApproved.textContent = counts.approved || 0;
  }

  if (!visible.length) {
    workList.innerHTML =
      '<p class="muted">Belum ada pekerjaan.</p>';
    return;
  }

  // ======================================
  // 10. RENDER DAFTAR PEKERJAAN
  // ======================================

  workList.innerHTML = visible.map(d => {
    const statusLabels = {
      queued: "ANTRIAN",
      claimed: "DIKERJAKAN",
      submitted: "MENUNGGU APPROVAL",
      revision: "REVISI",
      approved: "APPROVED"
    };

    const statusText = statusLabels[d.status] || d.status;

    let actions = "";

    if (isDesigner && d.status === "queued") {
      actions += `
        <button
          type="button"
          class="btn btn-primary"
          data-claim="${escapeHtml(d.id)}">
          KERJAKAN →
        </button>
      `;
    }

    if (
      isDesigner &&
      d.assigned_to === profile.id &&
      ["claimed", "revision"].includes(d.status)
    ) {
      actions += `
        <button
          type="button"
          class="btn btn-ghost"
          data-upload="${escapeHtml(d.id)}">
          ${d.status === "revision"
            ? "UPLOAD HASIL REVISI"
            : "UPLOAD HASIL"}
        </button>

        <input
          hidden
          type="file"
          accept="image/*"
          data-file="${escapeHtml(d.id)}">
      `;
    }

    if (isAdmin && d.status === "claimed") {
      actions += `
        <button
          type="button"
          class="btn btn-ghost"
          data-upload="${escapeHtml(d.id)}">
          UPLOAD HASIL
        </button>

        <input
          hidden
          type="file"
          accept="image/*"
          data-file="${escapeHtml(d.id)}">
      `;
    }

    if (
      d.status === "submitted" &&
      (
        isAdmin ||
        (isMarketing && d.created_by === profile.id)
      )
    ) {
      actions += `
        <button
          type="button"
          class="btn btn-primary"
          data-approve="${escapeHtml(d.id)}">
          APPROVE
        </button>
      `;
    }

    if (
      isMarketing &&
      d.created_by === profile.id &&
      d.status === "submitted" &&
      d.assigned_to
    ) {
      actions += `
        <button
          type="button"
          class="btn btn-ghost"
          data-revision="${escapeHtml(d.id)}">
          REVISI
        </button>
      `;
    }

    if (
      (
        isAdmin ||
        (isMarketing && d.created_by === profile.id)
      ) &&
      d.status !== "approved"
    ) {
      actions += `
        <button
          type="button"
          class="btn btn-danger"
          data-delete="${escapeHtml(d.id)}">
          HAPUS
        </button>
      `;
    }

    const owner = d.profiles?.username || "—";
    const designerName = d.designer?.username || "Belum ditugaskan";

    const referenceCount = (d.design_files || []).filter(file =>
      ["reference", "revision_reference"].includes(file.file_type)
    ).length;

    return `
      <article
        class="work-item clickable-work-item"
        data-detail="${escapeHtml(d.id)}"
        tabindex="0"
        role="button"
        aria-label="Lihat detail ${escapeHtml(d.project_name || "")}"
      >
        <div>
          <h3>${escapeHtml(d.project_name || "-")}</h3>

          <div class="work-meta">
            <span>${escapeHtml(d.apparel_type || "—")}</span>
            <span>Marketing: ${escapeHtml(owner)}</span>
            <span>Desainer: ${escapeHtml(designerName)}</span>
            <span>${escapeHtml(formatDate(d.created_at))}</span>
            <span>${referenceCount} referensi</span>
          </div>

          <p class="muted">
            ${escapeHtml(d.brief || "").slice(0, 220)}
          </p>

          <span class="status ${escapeHtml(d.status)}">
            ${escapeHtml(statusText)}
          </span>
        </div>

        <div class="work-actions">
          <button
            type="button"
            class="btn btn-ghost"
            data-open-detail="${escapeHtml(d.id)}">
            DETAIL ↗
          </button>

          ${actions}
        </div>
      </article>
    `;
  }).join("");

  // ======================================
  // 11. EVENT LISTENER DETAIL
  // ======================================

  workList.querySelectorAll("[data-detail]").forEach(item => {
    item.addEventListener("click", event => {
      if (event.target.closest("button, input, a")) return;

      openDesignDetail(String(item.dataset.detail));
    });

    item.addEventListener("keydown", event => {
      if (event.target !== item) return;

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDesignDetail(String(item.dataset.detail));
      }
    });
  });

  workList.querySelectorAll("[data-open-detail]").forEach(btn => {
    btn.addEventListener("click", () => {
      openDesignDetail(String(btn.dataset.openDetail));
    });
  });

  // ======================================
  // 12. EVENT LISTENER REVISI
  // ======================================

  workList.querySelectorAll("[data-revision]").forEach(btn => {
    btn.addEventListener("click", () => {
      window.location.href =
        `revision.html?id=${encodeURIComponent(btn.dataset.revision)}`;
    });
  });

  // ======================================
  // 13. KLAIM PEKERJAAN
  // ======================================

  workList.querySelectorAll("[data-claim]").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;

      try {
        const { error } = await supabase.rpc(
          "claim_design",
          {
            p_design_id: btn.dataset.claim
          }
        );

        if (error) throw error;

        await load();

      } catch (error) {
        console.error("Claim error:", error);
        alert(`Gagal mengambil pekerjaan: ${error.message}`);
        btn.disabled = false;
      }
    });
  });

  // ======================================
  // 14. PILIH FILE HASIL DESAIN
  // ======================================

  workList.querySelectorAll("[data-upload]").forEach(btn => {
    btn.addEventListener("click", () => {
      const input = workList.querySelector(
        `[data-file="${btn.dataset.upload}"]`
      );

      input?.click();
    });
  });

// ======================================
// 15. UPLOAD HASIL DESAIN
// ======================================

workList.querySelectorAll("[data-file]").forEach(input => {
  input.addEventListener("change", async () => {
    const file = input.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("File harus berupa gambar.");
      input.value = "";
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      alert("Ukuran gambar maksimal 15 MB.");
      input.value = "";
      return;
    }

    const designId = input.dataset.file;
    const uploadedDesign = designCache.get(String(designId));

    const uploadContainer = input.closest(".work-card") || input.parentElement;

    // Buat indikator loading
    const loading = document.createElement("div");
    loading.className = "upload-loading";
    loading.innerHTML = `
      <span class="upload-spinner"></span>
      <span>Sedang mengunggah desain...</span>
    `;

    uploadContainer.appendChild(loading);

    input.disabled = true;

    try {
      // 1. Upload ke Google Drive
      loading.querySelector("span:last-child").textContent =
        "Mengunggah desain ke Google Drive...";

      const uploaded = await uploadToDrive(
        file,
        "results",
        designId
      );

      if (!uploaded?.fileId) {
        throw new Error("ID file Google Drive tidak ditemukan.");
      }

      // 2. Simpan data file ke Supabase
      loading.querySelector("span:last-child").textContent =
        "Menyimpan data desain...";

      const { error: fileError } = await supabase
        .from("design_files")
        .insert({
          design_id: designId,
          file_type: "result",
          file_name: file.name,
          drive_file_id: uploaded.fileId,
          drive_url: uploaded.webViewLink || null,
          preview_url: uploaded.webViewLink || null,
          uploaded_by: profile.id
        });

      if (fileError) throw fileError;

      // 3. Update status desain
      loading.querySelector("span:last-child").textContent =
        "Mengirim hasil desain ke Marketing...";

      let updateQuery = supabase
        .from("designs")
        .update({
          status: "submitted"
        })
        .eq("id", designId)
        .in("status", ["claimed", "revision"]);

      if (isDesigner) {
        updateQuery = updateQuery.eq("assigned_to", profile.id);
      }

      const { data: updated, error: updateError } =
        await updateQuery.select("id").maybeSingle();

      if (updateError) throw updateError;

      if (!updated) {
        throw new Error(
          "File tersimpan, tetapi status desain tidak berubah. Hubungi Admin."
        );
      }

      // 4. Tampilkan status berhasil
      loading.classList.add("upload-success");
      loading.innerHTML = `
        <span class="upload-check">✓</span>
        <span>Upload berhasil! Hasil desain sudah dikirim ke Marketing.</span>
      `;

      await new Promise(resolve => setTimeout(resolve, 1200));

      alert(
        uploadedDesign?.status === "revision"
          ? "Hasil revisi berhasil diupload dan dikirim kembali ke Marketing."
          : "Hasil desain berhasil diupload dan dikirim ke Marketing."
      );

      await load();

    } catch (error) {
      console.error("Upload result error:", error);

      loading.classList.add("upload-error");
      loading.innerHTML = `
        <span>✕</span>
        <span>Upload gagal: ${escapeHtml(error.message)}</span>
      `;

      input.disabled = false;

    } finally {
      if (loading.isConnected && !loading.classList.contains("upload-error")) {
        loading.remove();
      }
    }
  });
});

  // ======================================
  // 16. APPROVAL DESAIN
  // ======================================

  workList.querySelectorAll("[data-approve]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Setujui desain ini dan masukkan ke Gallery?")) {
        return;
      }

      btn.disabled = true;

      try {
        let query = supabase
          .from("designs")
          .update({
            status: "approved",
            approved_by: profile.id,
            approved_at: new Date().toISOString()
          })
          .eq("id", btn.dataset.approve)
          .eq("status", "submitted");

        if (isMarketing) {
          query = query.eq("created_by", profile.id);
        }

        const { data, error } = await query
          .select("id, status, created_by, approved_by")
          .maybeSingle();

        if (error) throw error;

        if (!data) {
          throw new Error(
            "Desain tidak berhasil di-approve. Periksa RLS, status desain, dan kepemilikan desain."
          );
        }

        alert("Desain berhasil di-approve dan masuk Gallery.");

        await load();

      } catch (error) {
        console.error("Approval error:", error);
        alert(`Approval gagal: ${error.message}`);
        btn.disabled = false;
      }
    });
  });

  // ======================================
  // 17. HAPUS BRIEF
  // ======================================

  workList.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm(
        "Hapus brief ini? File Google Drive tidak otomatis terhapus."
      )) {
        return;
      }

      btn.disabled = true;

      try {
        let query = supabase
          .from("designs")
          .delete()
          .eq("id", btn.dataset.delete)
          .neq("status", "approved");

        if (isMarketing) {
          query = query.eq("created_by", profile.id);
        }

        const { error } = await query;

        if (error) throw error;

        alert("Brief berhasil dihapus.");

        await load();

      } catch (error) {
        console.error("Delete brief error:", error);
        alert(`Gagal menghapus brief: ${error.message}`);
        btn.disabled = false;
      }
    });
  });
}

// ======================================
// 18. JALANKAN DASHBOARD
// ======================================

await load();
