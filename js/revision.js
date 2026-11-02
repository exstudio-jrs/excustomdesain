import { supabase } from "./config.js";
import { requireUser, uploadToDrive, escapeHtml } from "./common.js";

const context = await requireUser();
const user = context.user;
const profile = context.profile;

const params = new URLSearchParams(window.location.search);
const designId = params.get("id");

const designInfo = document.getElementById("designInfo");
const currentStatus = document.getElementById("currentStatus");
const revisionForm = document.getElementById("revisionForm");
const revisionNotes = document.getElementById("revisionNotes");
const revisionFiles = document.getElementById("revisionFiles");
const revisionPreview = document.getElementById("revisionPreview");
const revisionHistory = document.getElementById("revisionHistory");
const submitRevisionBtn = document.getElementById("submitRevisionBtn");
const formMessage = document.getElementById("formMessage");
const pageMessage = document.getElementById("pageMessage");
const userLabel = document.getElementById("userLabel");
const logoutBtn = document.getElementById("logoutBtn");

let currentDesign = null;
let selectedFiles = [];

const MAX_FILES = 10;
const MAX_FILE_SIZE = 15 * 1024 * 1024;

function showPageMessage(message, type = "error") {
  pageMessage.textContent = message;
  pageMessage.className = `revision-message ${type}`;
}

function showFormMessage(message, isError = false) {
  formMessage.textContent = message;
  formMessage.style.color = isError ? "#ffaaaa" : "var(--lime)";
}

function formatDate(value) {
  if (!value) return "-";

  return new Date(value).toLocaleString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function statusLabel(status) {
  const labels = {
    queued: "Antrian",
    claimed: "Sedang dikerjakan",
    submitted: "Menunggu pemeriksaan Marketing",
    revision: "Perlu revisi",
    approved: "Approved"
  };

  return labels[status] || status || "-";
}

function getFileId(file) {
  return file?.drive_file_id || file?.fileId || file?.id || "";
}

function getDriveUrl(file) {
  return (
    file?.drive_url ||
    file?.webViewLink ||
    file?.webViewUrl ||
    file?.url ||
    ""
  );
}

function getPreviewUrl(file) {
  return (
    file?.preview_url ||
    file?.thumbnailLink ||
    file?.thumbnailUrl ||
    getDriveUrl(file)
  );
}

function getFileName(file) {
  return file?.name || file?.fileName || "Gambar referensi";
}

function getRevisionNumber(revision) {
  return Number(revision.revision_number || 0);
}

function renderDesignInfo(design) {
  currentStatus.textContent = statusLabel(design.status).toUpperCase();
  currentStatus.className = `status ${design.status}`;

  designInfo.innerHTML = `
    <div class="revision-info-item">
      <small>Nama Project</small>
      <p>${escapeHtml(design.project_name || "-")}</p>
    </div>

    <div class="revision-info-item">
      <small>Jenis Apparel</small>
      <p>${escapeHtml(design.apparel_type || "-")}</p>
    </div>

    <div class="revision-info-item">
      <small>Deadline</small>
      <p>${escapeHtml(design.deadline || "-")}</p>
    </div>

    <div class="revision-info-item full">
      <small>Brief Awal</small>
      <p>${escapeHtml(design.brief || "-")}</p>
    </div>
  `;
}

function renderPreview() {
  revisionPreview.innerHTML = "";

  selectedFiles.forEach((file, index) => {
    const card = document.createElement("div");
    card.className = "revision-preview-card";

    const image = document.createElement("img");
    image.alt = file.name;
    image.src = URL.createObjectURL(file);

    const caption = document.createElement("p");
    caption.textContent = `${index + 1}. ${file.name}`;

    card.append(image, caption);
    revisionPreview.appendChild(card);
  });
}

revisionFiles.addEventListener("change", () => {
  const files = Array.from(revisionFiles.files || []);

  if (files.length > MAX_FILES) {
    showFormMessage(`Maksimal ${MAX_FILES} gambar dalam satu pengajuan.`, true);
    revisionFiles.value = "";
    selectedFiles = [];
    renderPreview();
    return;
  }

  const invalidFile = files.find(file => {
    return !file.type.startsWith("image/") || file.size > MAX_FILE_SIZE;
  });

  if (invalidFile) {
    showFormMessage(
      "Semua lampiran harus berupa gambar dengan ukuran maksimal 15 MB per file.",
      true
    );
    revisionFiles.value = "";
    selectedFiles = [];
    renderPreview();
    return;
  }

  selectedFiles = files;
  showFormMessage("");
  renderPreview();
});

async function loadDesign() {
  if (!designId) {
    throw new Error("ID desain tidak ditemukan. Buka halaman revisi dari Dashboard.");
  }

  if (!profile || profile.role !== "marketing") {
    throw new Error("Halaman pengajuan revisi hanya dapat diakses oleh Marketing.");
  }

  const { data, error } = await supabase
    .from("designs")
    .select("*")
    .eq("id", designId)
    .eq("created_by", profile.id)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw new Error("Desain tidak ditemukan atau Anda tidak memiliki akses.");
  }

  if (data.status !== "submitted" || !data.assigned_to) {
    throw new Error(
      "Revisi hanya dapat diajukan untuk desain berstatus submitted yang sudah memiliki desainer."
    );
  }

  currentDesign = data;
  renderDesignInfo(data);
}

async function loadRevisionHistory() {
  const { data: revisions, error } = await supabase
    .from("design_revisions")
    .select("*")
    .eq("design_id", designId)
    .order("revision_number", { ascending: false });

  if (error) throw error;

  const { data: files, error: filesError } = await supabase
    .from("design_files")
    .select("*")
    .eq("design_id", designId)
    .eq("file_type", "revision_reference");

  if (filesError) throw filesError;

  if (!revisions?.length) {
    revisionHistory.innerHTML = `
      <div class="revision-empty">Belum ada riwayat revisi.</div>
    `;
    return;
  }

  revisionHistory.innerHTML = revisions.map(revision => {
    const attachedFiles = (files || []).filter(file => {
      return file.revision_id === revision.id;
    });

    const images = attachedFiles.map(file => {
      const url = getPreviewUrl(file);
      const openUrl = getDriveUrl(file) || url;

      if (!url) {
        return `<p>${escapeHtml(file.drive_file_id || "Lampiran tersimpan")}</p>`;
      }

      return `
        <a href="${escapeHtml(openUrl)}" target="_blank" rel="noopener noreferrer">
          <img
            src="${escapeHtml(url)}"
            alt="${escapeHtml(file.file_name || "Referensi revisi")}"
            loading="lazy"
          >
          Buka gambar
        </a>
      `;
    }).join("");

    return `
      <article class="revision-history-item">
        <div class="revision-history-head">
          <h3>Revisi #${getRevisionNumber(revision)}</h3>
          <span class="revision-history-date">
            ${escapeHtml(formatDate(revision.created_at))}
          </span>
        </div>

        <p class="revision-history-notes">
          ${escapeHtml(revision.notes || "-")}
        </p>

        ${
          images
            ? `<div class="revision-history-images">${images}</div>`
            : `<p class="muted tiny">Tidak ada gambar tambahan pada revisi ini.</p>`
        }
      </article>
    `;
  }).join("");
}

function validateForm() {
  const notes = revisionNotes.value.trim();

  if (notes.length < 3) {
    throw new Error("Catatan revisi minimal 3 karakter.");
  }

  if (selectedFiles.length > MAX_FILES) {
    throw new Error(`Maksimal ${MAX_FILES} gambar.`);
  }

  for (const file of selectedFiles) {
    if (!file.type.startsWith("image/")) {
      throw new Error(`File "${file.name}" bukan gambar.`);
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File "${file.name}" melebihi ukuran maksimal 15 MB.`);
    }
  }

  return notes;
}

async function getNextRevisionNumber() {
  const { data, error } = await supabase
    .from("design_revisions")
    .select("revision_number")
    .eq("design_id", designId)
    .order("revision_number", { ascending: false })
    .limit(1);

  if (error) throw error;

  return Number(data?.[0]?.revision_number || 0) + 1;
}


async function uploadRevisionImages(revisionId) {
  if (!revisionId) {
    throw new Error("ID revisi tidak ditemukan.");
  }

  for (const file of selectedFiles) {
    console.log("Mulai upload lampiran revisi:", file.name);

    // Upload ke Google Drive.
    const uploaded = await uploadToDrive(
      file,
      "references",
      designId
    );

    if (!uploaded) {
      throw new Error(
        `Google Drive tidak memberikan respons untuk ${file.name}.`
      );
    }

    const driveFileId = getFileId(uploaded);
    const driveUrl = getDriveUrl(uploaded);
    const previewUrl = getPreviewUrl(uploaded);

    if (!driveFileId) {
      console.error("Respons Google Drive:", uploaded);

      throw new Error(
        `ID Google Drive untuk "${file.name}" tidak ditemukan.`
      );
    }

    // Simpan metadata lampiran ke Supabase.
    const payload = {
      design_id: designId,
      revision_id: revisionId,
      file_type: "revision_reference",
      file_name: file.name,
      drive_file_id: driveFileId,
      drive_url: driveUrl || null,
      preview_url: previewUrl || null,
      uploaded_by: user.id
    };

    console.log("Data yang akan disimpan ke design_files:", payload);

    const { data, error } = await supabase
      .from("design_files")
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error("GAGAL INSERT DESIGN_FILES:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        payload
      });

      throw new Error(
        `Gagal menyimpan lampiran "${file.name}". ` +
        `Kode: ${error.code || "-"}. ` +
        `Pesan: ${error.message}. ` +
        `Detail: ${error.details || "-"}`
      );
    }

    console.log("Lampiran revisi berhasil disimpan:", data);
  }
}



revisionForm.addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentDesign) {
    showFormMessage("Data desain belum siap.", true);
    return;
  }

  let revisionRecord = null;

  try {
    const notes = validateForm();

    submitRevisionBtn.disabled = true;
    submitRevisionBtn.textContent = "MENYIMPAN REVISI...";
    showFormMessage("Memeriksa data desain...");

    // Cek ulang status dan penugasan desain.
    const { data: latestDesign, error: latestError } = await supabase
      .from("designs")
      .select("id, status, assigned_to, created_by")
      .eq("id", designId)
      .eq("created_by", profile.id)
      .maybeSingle();

    if (latestError) throw latestError;

    if (
      !latestDesign ||
      latestDesign.status !== "submitted" ||
      !latestDesign.assigned_to ||
      latestDesign.assigned_to !== currentDesign.assigned_to
    ) {
      throw new Error(
        "Status atau penugasan desain telah berubah. Muat ulang halaman."
      );
    }

    // Cari revisi terakhir milik Marketing ini.
    const { data: existingRevisions, error: existingError } =
      await supabase
        .from("design_revisions")
        .select("*")
        .eq("design_id", designId)
        .eq("requested_by", user.id)
        .order("revision_number", { ascending: false })
        .limit(1);

    if (existingError) throw existingError;

    const existingRevision = existingRevisions?.[0];

    if (existingRevision && existingRevision.notes === notes) {
      // Gunakan kembali catatan revisi yang sudah tersimpan.
      revisionRecord = existingRevision;
    } else {
      // Buat catatan revisi baru.
      const revisionNumber = await getNextRevisionNumber();

      const { data, error: revisionError } = await supabase
        .from("design_revisions")
        .insert({
          design_id: designId,
          revision_number: revisionNumber,
          notes,
          requested_by: user.id
        })
        .select("*")
        .single();

      if (revisionError) throw revisionError;

      if (!data?.id) {
        throw new Error("ID riwayat revisi tidak ditemukan.");
      }

      revisionRecord = data;
    }

    // Periksa lampiran yang sudah tersimpan agar tidak upload ganda.
    const { data: savedFiles, error: savedFilesError } = await supabase
      .from("design_files")
      .select("id, file_name")
      .eq("design_id", designId)
      .eq("revision_id", revisionRecord.id)
      .eq("file_type", "revision_reference");

    if (savedFilesError) {
    console.error("Gagal memeriksa lampiran:", savedFilesError);
    throw savedFilesError;
    }

    const uploadedNames = new Set(
      (savedFiles || []).map(file => file.file_name)
    );

    const filesToUpload = selectedFiles.filter(
      file => !uploadedNames.has(file.name)
    );

    const originalSelectedFiles = selectedFiles;
    selectedFiles = filesToUpload;

    try {
      await uploadRevisionImages(revisionRecord.id);
    } finally {
      selectedFiles = originalSelectedFiles;
    }

    // Update status desain menjadi revision.
    const { data: updatedDesign, error: updateError } = await supabase
      .from("designs")
      .update({
        status: "revision",
        revision_notes: notes
      })
      .eq("id", designId)
      .eq("created_by", profile.id)
      .eq("status", "submitted")
      .eq("assigned_to", currentDesign.assigned_to)
      .select("id")
      .maybeSingle();

    if (updateError) throw updateError;

    if (!updatedDesign) {
      throw new Error(
        "Catatan revisi tersimpan, tetapi status desain belum berhasil diubah. Hubungi Admin sebelum mencoba kembali."
      );
    }

    showFormMessage("Revisi berhasil dikirim. Mengalihkan ke Dashboard...");

    window.location.href = "dashboard.html";

  } catch (error) {
  console.error("GAGAL MENGIRIM REVISI:", {
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
    code: error?.code,
    status: error?.status,
    error: error
  });

  const message = [
    error?.message || "Terjadi kesalahan.",
    error?.details ? `Detail: ${error.details}` : "",
    error?.hint ? `Petunjuk: ${error.hint}` : "",
    error?.code ? `Kode: ${error.code}` : ""
  ].filter(Boolean).join(" | ");

  showFormMessage(
    revisionRecord
      ? `Revisi #${revisionRecord.revision_number}: ${message}`
      : message,
    true
  );

  } finally {
    submitRevisionBtn.disabled = false;
    submitRevisionBtn.textContent = "KIRIM REVISI ↗";
  }
});


logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;

  const { error } = await supabase.auth.signOut();

  if (error) {
    logoutBtn.disabled = false;
    showPageMessage(`Gagal keluar: ${error.message}`);
    return;
  }

  window.location.href = "login.html";
});

if (userLabel) {
  userLabel.textContent = profile?.username || user?.email || "Marketing";
}

try {
  await loadDesign();
  await loadRevisionHistory();
} catch (error) {
  console.error("Gagal membuka halaman revisi:", error);

  showPageMessage(error?.message || "Gagal memuat halaman revisi.");

  revisionForm.classList.add("hidden");
  designInfo.innerHTML = `
    <p class="muted">Informasi desain tidak dapat dimuat.</p>
  `;
}