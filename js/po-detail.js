
import {
  supabase,
  SUPABASE_URL,
  SUPABASE_ANON_KEY
} from "./config.js";

import {
  requireUser,
  escapeHtml
} from "./common.js";


// =====================================
// LOGIN DAN PEMERIKSAAN ROLE
// =====================================

const context = await requireUser();

if (!context) {
  throw new Error("User belum login.");
}

const { user, profile } = context;

const isAdmin = profile.role === "admin";
const isAdminPO = profile.role === "admin_po";
const isMarketing = profile.role === "marketing";

if (!isAdmin && !isAdminPO && !isMarketing) {
  location.replace("dashboard.html");
  throw new Error("Akses halaman PO ditolak.");
}

// =====================================
// ELEMENT DAN ID PO
// =====================================

const params = new URLSearchParams(location.search);
const poId = params.get("id");

const detailMessage = document.querySelector("#detailMessage");
const poStatus = document.querySelector("#poStatus");
const poInformation = document.querySelector("#poInformation");
const poItems = document.querySelector("#poItems");
const poActions = document.querySelector("#poActions");
const revisionHistory = document.querySelector("#revisionHistory");

let currentPO = null;

if (!poId) {
  detailMessage.textContent = "ID PO tidak ditemukan.";
  throw new Error("ID PO tidak ditemukan.");
}

// =====================================
// FORMAT DATA
// =====================================

function formatDate(value) {
  if (!value) return "-";

  return new Date(`${value}T00:00:00`).toLocaleDateString(
    "id-ID",
    {
      day: "2-digit",
      month: "long",
      year: "numeric"
    }
  );
}

function formatDateTime(value) {
  if (!value) return "-";

  return new Date(value).toLocaleString("id-ID");
}

function statusLabel(status) {
  const labels = {
    draft: "Draft",
    submitted: "Menunggu Pemeriksaan",
    revision: "Perlu Revisi",
    approved: "Approved",
    printed: "Sudah Dicetak"
  };

  return labels[status] || status;
}

function formatJSON(value) {
  if (!value || typeof value !== "object") return "-";

  const entries = Object.entries(value);

  if (!entries.length) return "-";

  return entries.map(([key, val]) => `
    <div class="po-info-row">
      <strong>${escapeHtml(key)}</strong>
      <span>${escapeHtml(
        typeof val === "object"
          ? JSON.stringify(val)
          : String(val ?? "-")
      )}</span>
    </div>
  `).join("");
}

// =====================================
// LOAD DETAIL PO
// =====================================

async function loadDetail() {
  detailMessage.textContent = "Memuat data PO...";

  const { data: po, error: poError } = await supabase
    .from("purchase_orders")
    .select("*")
    .eq("id", poId)
    .single();

  if (poError || !po) {
    console.error("Gagal mengambil PO:", poError);
    detailMessage.textContent =
      "Data PO tidak ditemukan atau Anda tidak memiliki akses.";
    return;
  }
  

  // Marketing hanya boleh membuka PO miliknya.
    if (isMarketing && po.created_by !== user.id) {
      detailMessage.textContent = "Anda tidak memiliki akses ke PO ini.";
      return;
    }

    currentPO = po;

  const { data: items, error: itemsError } = await supabase
    .from("purchase_order_items")
    .select("*")
    .eq("purchase_order_id", poId)
    .order("created_at", { ascending: true });

  if (itemsError) {
    console.error("Gagal mengambil item PO:", itemsError);
    poItems.innerHTML = "<p>Gagal memuat daftar item.</p>";
  } else {
    renderItems(items || []);
  }

  await loadDesignPreview(po.design_id);

  renderInformation();
  renderActions();
  await loadRevisionHistory();

  poStatus.textContent = statusLabel(po.status);
  poStatus.className = `po-status ${escapeHtml(po.status)}`;

  detailMessage.textContent = "";
}

// =====================================
// INFORMASI PO
// =====================================


function renderInformation() {
  const po = currentPO;
  const shirt = po.shirt_spec || {};
  const pants = po.pants_spec || {};
  const shipping = po.shipping_info || {};

  const infoRow = (label, val) => `
    <div class="po-info-row">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(val || "-")}</span>
    </div>
  `;

  poInformation.innerHTML = `
    <div class="po-info-grid">
      ${infoRow("Nomor PO", po.po_number)}
      ${infoRow("Customer", po.customer_name)}
      ${infoRow("Tanggal PO", formatDate(po.order_date))}
      ${infoRow("Deadline", formatDate(po.deadline))}
      ${infoRow("Jenis Apparel", po.apparel_type)}
      ${infoRow("Kategori Pemakai", po.wearer_category)}
    </div>

    <h3>Spesifikasi Baju</h3>
    <div class="po-info-grid">
      ${infoRow("Model Kerah", shirt.collar)}
      ${infoRow("Model Bahan", shirt.material)}
      ${infoRow("Model Lengan", shirt.sleeve)}
      ${infoRow("Catatan Baju", shirt.notes)}
    </div>

    <h3>Spesifikasi Celana</h3>
    <div class="po-info-grid">
      ${infoRow("Model Celana", pants.model)}
      ${infoRow("Model Bahan", pants.material)}
      ${infoRow("Catatan Celana", pants.notes)}
    </div>

    <h3>Informasi Pengiriman</h3>
    <div class="po-info-grid">
      ${infoRow("Nama Penerima", shipping.receiver_name)}
      ${infoRow("Nomor Telepon", shipping.phone)}
      ${infoRow("Alamat Pengiriman", shipping.address)}
    </div>

    <div class="po-specification">
      <strong>Catatan Tambahan</strong>
      <p>${escapeHtml(po.notes || "-")}</p>
    </div>
  `;
}

/* =====================================
   PREVIEW DESAIN PO
===================================== */

async function loadDesignPreview(designId) {
  const preview = document.querySelector("#designPreview");

  if (!preview) return;

  if (!designId) {
    preview.innerHTML = `
      <div class="preview-placeholder">
        PO ini belum terhubung dengan desain.
      </div>
    `;
    return;
  }

  try {
    const { data: files, error } = await supabase
      .from("design_files")
      .select("*")
      .eq("design_id", designId)
      .eq("file_type", "result");

    if (error) throw error;

    if (!files?.length) {
      preview.innerHTML = `
        <div class="preview-placeholder">
          File hasil desain tidak ditemukan.
        </div>
      `;
      return;
    }

    files.sort((a, b) => {
      return new Date(b.created_at || 0) -
             new Date(a.created_at || 0);
    });

    const designFile = files.find(file => file.drive_file_id);

    if (!designFile) {
      throw new Error("ID Google Drive tidak ditemukan.");
    }

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError) throw sessionError;

    const accessToken = sessionData?.session?.access_token;

    if (!accessToken) {
      throw new Error("Sesi login tidak ditemukan.");
    }

    const query = new URLSearchParams({
      designId,
      fileId: designFile.drive_file_id
    });

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/drive-preview?${query}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `Gagal mengambil preview (${response.status})`
      );
    }

    const blob = await response.blob();
    const imageUrl = URL.createObjectURL(blob);

    preview.innerHTML = `
      <img
        src="${imageUrl}"
        alt="Preview desain PO"
        class="po-design-image"
      >
    `;

    preview.querySelector("img").addEventListener("click", () => {
      window.open(imageUrl, "_blank");
    });

  } catch (error) {
    console.error("Gagal memuat preview desain:", error);

    preview.innerHTML = `
      <div class="preview-placeholder">
        Preview desain gagal dimuat.
      </div>
    `;
  }
}

// =====================================
// DAFTAR ITEM PO
// =====================================


function renderItems(items) {
  if (!items.length) {
    poItems.innerHTML = `
      <p class="po-empty">Belum ada daftar nama dan ukuran.</p>
    `;
    return;
  }

  const totalQuantity = items.reduce(
    (total, item) => total + Number(item.quantity || 0),
    0
  );

  poItems.innerHTML = `
    <div class="po-table-wrap">
      <table class="po-input-table">
        <thead>
          <tr>
            <th>SIZE</th>
            <th>NOMOR</th>
            <th>NAMA</th>
            <th>JUMLAH</th>
            <th>CATATAN</th>
          </tr>
        </thead>

        <tbody>
          ${items.map(item => `
            <tr>
              <td>${escapeHtml(item.size || "-")}</td>
              <td>${escapeHtml(item.jersey_number || "-")}</td>
              <td>${escapeHtml(item.person_name || "-")}</td>
              <td>${escapeHtml(item.quantity ?? 0)}</td>
              <td>${escapeHtml(item.notes || "-")}</td>
            </tr>
          `).join("")}
        </tbody>

        <tfoot>
          <tr>
            <th colspan="3">TOTAL</th>
            <th>${totalQuantity}</th>
            <th></th>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}


// =====================================
// TINDAKAN ADMIN DAN ADMIN_PO
// =====================================




function renderActions() {
  const status = currentPO.status;

  function openPrintTab() {
    const printWindow = window.open(
      `po-print.html?id=${encodeURIComponent(currentPO.id)}`,
      "_blank"
    );

    if (!printWindow) {
      alert("Pop-up diblokir. Izinkan pop-up untuk website ini.");
    }
  }

  const printButton = document.querySelector("#printPOBtn");

  if (printButton) {
    printButton.onclick = openPrintTab;
  }

  let html = "";

  if (isMarketing) {
    if (status === "draft") {
      html = `
        <div class="po-action-group">
          <p>Draft PO masih dapat diperiksa dan diedit.</p>

          <a href="po-form.html?id=${encodeURIComponent(currentPO.id)}"
             class="btn btn-ghost">
            EDIT DRAFT
          </a>

          <a href="po-form.html?id=${encodeURIComponent(currentPO.id)}"
             class="btn btn-primary">
            EDIT & KIRIM PO →
          </a>
        </div>
      `;
    } else if (status === "revision") {
      html = `
        <div class="po-action-group">
          <p>PO ini dikembalikan oleh Admin_PO dan membutuhkan perbaikan.</p>

          <a href="po-revision.html?id=${encodeURIComponent(currentPO.id)}"
             class="btn btn-primary">
            LENGKAPI REVISI PO →
          </a>
        </div>
      `;
    } else if (status === "submitted") {
  html = `
    <div class="po-action-group">
      <p>PO sedang dalam pemeriksaan.</p>

      <button
        type="button"
        class="btn btn-success"
        id="approvePOBtn"
      >
        APPROVE PO →
      </button>
    </div>
  `;
    } else {
      html = `
        <p class="po-empty">
          ${status === "approved"
            ? "PO sudah disetujui."
            : "PO sudah selesai dicetak."}
        </p>
      `;
    }

    poActions.innerHTML = html;

    document.querySelector("#approvePOBtn")
      ?.addEventListener("click", approvePO);

    return;
  }

  // Admin dan Admin_PO
  if (status === "submitted") {
    html = `
      <div class="po-action-group">
        ${isAdminPO ? `
          <a
            href="po-form.html?id=${encodeURIComponent(currentPO.id)}&mode=admin-edit"
            class="btn btn-ghost"
          >
            EDIT BRIEF PO
          </a>
        ` : ""}

        <h3>Permintaan Revisi</h3>

        <label for="revisionNote">
          Catatan yang perlu dilengkapi Marketing
        </label>

        <textarea
          id="revisionNote"
          rows="4"
          placeholder="Tuliskan data yang perlu ditambahkan atau diperbaiki..."
        ></textarea>

        <button type="button" class="btn btn-ghost" id="requestRevisionBtn">
          KEMBALIKAN UNTUK REVISI
        </button>

        <button type="button" class="btn btn-primary" id="approvePOBtn">
          APPROVE PO →
        </button>
      </div>
    `;
  } else if (status === "approved") {
  html = `
    <div class="po-action-group">
      <p>PO sudah disetujui dan siap dicetak.</p>

      ${isAdmin ? `
        <a
          href="po-form.html?id=${encodeURIComponent(currentPO.id)}&mode=admin-approved-edit"
          class="btn btn-ghost"
        >
          EDIT PO (ADMIN)
        </a>
      ` : ""}

      <button type="button" class="btn btn-primary" id="markPrintedBtn">
        TANDAI SUDAH DICETAK
      </button>
    </div>
  `;
  } else if (status === "printed") {
    html = `
      <p class="po-empty">PO ini sudah ditandai selesai dicetak.</p>
    `;
  } else if (status === "revision") {
    html = `
      <p class="po-empty">
        PO sedang menunggu Marketing melengkapi revisi.
      </p>
    `;
  } else if (status === "draft" && isAdminPO) {
    html = `
      <div class="po-action-group">
        <a
          href="po-form.html?id=${encodeURIComponent(currentPO.id)}&mode=admin-edit"
          class="btn btn-ghost"
        >
          EDIT BRIEF PO
        </a>
      </div>
    `;
  }

  poActions.innerHTML = html;

  document.querySelector("#requestRevisionBtn")
    ?.addEventListener("click", requestRevision);

  document.querySelector("#approvePOBtn")
    ?.addEventListener("click", approvePO);

  document.querySelector("#markPrintedBtn")
    ?.addEventListener("click", markPrinted);
}




// =====================================
// MINTA REVISI
// =====================================

async function requestRevision() {
  const note = document.querySelector("#revisionNote")
    .value.trim();

  if (!note) {
    alert("Catatan revisi wajib diisi.");
    return;
  }

  if (!confirm("Kembalikan PO ini kepada Marketing untuk revisi?")) {
    return;
  }

  const { error: revisionError } = await supabase
    .from("purchase_order_revisions")
    .insert({
      purchase_order_id: poId,
      requested_by: user.id,
      revision_note: note
    });

  if (revisionError) {
    alert("Gagal menyimpan catatan revisi: " + revisionError.message);
    return;
  }

  const { error: updateError } = await supabase
    .from("purchase_orders")
    .update({
      status: "revision",
      reviewed_by: user.id
    })
    .eq("id", poId)
    .eq("status", "submitted");

  if (updateError) {
    alert("Catatan tersimpan, tetapi status gagal diperbarui: " + updateError.message);
    return;
  }

  alert("PO berhasil dikembalikan untuk revisi.");
  await loadDetail();
}

// =====================================
// APPROVE PO
// =====================================

async function approvePO() {
  if (!(isAdmin || isAdminPO || isMarketing)) {
    alert("Anda tidak memiliki akses untuk approve PO.");
    return;
  }

  if (!confirm("Setujui PO ini?")) return;

  try {
    // 1. Periksa status PO saat ini
    const { data: po, error: checkError } = await supabase
      .from("purchase_orders")
      .select("id, status, created_by")
      .eq("id", poId)
      .maybeSingle();

    if (checkError) throw checkError;

    if (!po) {
      throw new Error(
        "PO tidak ditemukan atau tidak dapat dibaca oleh akun ini."
      );
    }

    console.log("Data PO sebelum approve:", po);

    if (po.status !== "submitted") {
      throw new Error(
        `Status PO saat ini adalah "${po.status}", bukan "submitted".`
      );
    }

    // 2. Update status menjadi approved
    const { data, error } = await supabase
      .from("purchase_orders")
      .update({
        status: "approved",
        reviewed_by: user.id,
        approved_at: new Date().toISOString()
      })
      .eq("id", poId)
      .eq("status", "submitted")
      .select("id, status")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      throw new Error(
        "Update tidak menghasilkan data. Periksa kebijakan UPDATE dan SELECT RLS pada purchase_orders."
      );
    }

    console.log("Hasil approve:", data);

    alert("PO berhasil disetujui.");

    window.location.href = "po-approved.html";  

  } catch (error) {
  console.error("Detail gagal approve:", {
    message: error?.message,
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
    status: error?.status,
    fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
  });

  alert(
    "Gagal approve PO: " +
    (error?.message || error?.details || "Periksa Console")
  );
}
}

// =====================================
// TANDAI SUDAH DICETAK
// =====================================

async function markPrinted() {
  if (!confirm("Tandai PO ini sudah dicetak?")) return;

  const { error } = await supabase
    .from("purchase_orders")
    .update({
      status: "printed",
      reviewed_by: user.id,
      printed_at: new Date().toISOString()
    })
    .eq("id", poId)
    .eq("status", "approved");

  if (error) {
    alert("Gagal memperbarui status cetak: " + error.message);
    return;
  }

  alert("PO berhasil ditandai sudah dicetak.");
  await loadDetail();
}

// =====================================
// RIWAYAT REVISI
// =====================================

async function loadRevisionHistory() {
  const { data, error } = await supabase
    .from("purchase_order_revisions")
    .select("*")
    .eq("purchase_order_id", poId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Gagal mengambil riwayat revisi:", error);
    revisionHistory.innerHTML =
      "<p>Gagal memuat riwayat revisi.</p>";
    return;
  }

  if (!data || !data.length) {
    revisionHistory.innerHTML = `
      <p class="po-empty">Belum ada riwayat revisi.</p>
    `;
    return;
  }

  revisionHistory.innerHTML = data.map(item => `
    <article class="po-card">
      <div class="po-card-info">
        <p>${escapeHtml(item.revision_note)}</p>
        <small>${formatDateTime(item.created_at)}</small>
      </div>
    </article>
  `).join("");
}

// =====================================
// MULAI
// =====================================

loadDetail();
