
import { supabase } from "./config.js";
import { requireUser, escapeHtml } from "./common.js";

// =====================================
// LOGIN DAN ROLE
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
// ELEMENT
// =====================================

const poList = document.querySelector("#poList");
const poMessage = document.querySelector("#poMessage");
const refreshPO = document.querySelector("#refreshPO");
const statusFilter = document.querySelector("#statusFilter");
const searchPO = document.querySelector("#searchPO");

const statTotal = document.querySelector("#statTotal");
const statSubmitted = document.querySelector("#statSubmitted");
const statRevision = document.querySelector("#statRevision");
const statApproved = document.querySelector("#statApproved");

const createPOButton = document.querySelector("#createPOButton");

let allPO = [];

// =====================================
// TAMPILAN SESUAI ROLE
// =====================================

if (createPOButton) {
  createPOButton.hidden = !isMarketing && !isAdmin;
}

if (isMarketing) {
  document.querySelector("h1").textContent = "Pekerjaan PO";
  document.querySelector(".page-head .muted").textContent =
    "Kelola Draft, perbaiki revisi, dan pantau status pesanan Anda.";

  document.querySelector("#statSubmitted")
    .previousElementSibling.textContent = "Sedang Diperiksa";
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

// =====================================
// LOAD PO
// =====================================

async function loadPO() {
  poList.innerHTML = '<p class="muted">Memuat data PO...</p>';
  poMessage.textContent = "";

  let query = supabase
    .from("purchase_orders")
    .select(`
      id,
      po_number,
      customer_name,
      order_date,
      deadline,
      status,
      created_at,
      created_by,
      design_id
    `)
    .order("created_at", { ascending: false });

  // Marketing hanya melihat PO miliknya.
  if (isMarketing) {
    query = query.eq("created_by", user.id);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Gagal mengambil data PO:", error);

    poList.innerHTML = `
      <p class="po-empty">
        Gagal memuat data PO: ${escapeHtml(error.message)}
      </p>
    `;

    return;
  }

  allPO = data || [];

  renderPO();
  updateStats();
}

// =====================================
// STATISTIK
// =====================================

function updateStats() {
  statTotal.textContent = allPO.length;

  statSubmitted.textContent = allPO.filter(
    po => po.status === "submitted"
  ).length;

  statRevision.textContent = allPO.filter(
    po => po.status === "revision"
  ).length;

  statApproved.textContent = allPO.filter(
    po => po.status === "approved" || po.status === "printed"
  ).length;
}

// =====================================
// RENDER DAFTAR
// =====================================

function renderPO() {
  const selectedStatus = statusFilter.value;
  const keyword = searchPO.value.trim().toLowerCase();

  const filtered = allPO.filter(po => {
    // PO Approved dan Printed hanya tampil di halaman PO Approved.
    if (["approved", "printed"].includes(po.status)) {
      return false;
    }

    const matchStatus =
      !selectedStatus || po.status === selectedStatus;

    const matchKeyword =
      !keyword ||
      String(po.po_number || "").toLowerCase().includes(keyword) ||
      String(po.customer_name || "").toLowerCase().includes(keyword);

    return matchStatus && matchKeyword;
  });

  if (!filtered.length) {
    poList.innerHTML = `
      <div class="po-empty">
        ${isMarketing
          ? "Belum ada pekerjaan PO. Klik Buat PO untuk memulai."
          : "Belum ada data PO yang sesuai."}
      </div>
    `;
    return;
  }

  poList.innerHTML = filtered.map(po => `
    <article class="po-card">
      <div class="po-card-info">
        <h3>${escapeHtml(po.po_number || "PO belum bernomor")}</h3>

        <p>
          Customer:
          <strong>${escapeHtml(po.customer_name || "-")}</strong>
        </p>

        <p>Tanggal PO: ${formatDate(po.order_date)}</p>
        <p>Deadline: ${formatDate(po.deadline)}</p>

        <span class="po-status ${escapeHtml(po.status)}">
          ${escapeHtml(statusLabel(po.status))}
        </span>
      </div>

      <div class="po-card-actions">
        <button
          type="button"
          class="btn btn-primary"
          data-detail-po="${escapeHtml(po.id)}"
        >
          DETAIL PO →
        </button>

        ${(isAdmin || isMarketing) &&
        po.design_id &&
        ["draft", "submitted", "revision"].includes(po.status) ? `
        <button
          type="button"
          class="btn btn-warning"
          data-return-design="${escapeHtml(po.id)}"
        >
          KEMBALIKAN KE DESAIN
        </button>
      ` : ""}

        ${(isAdmin || isAdminPO || isMarketing) &&
          po.status === "submitted" ? `
          <button
            type="button"
            class="btn btn-success"
            data-approve-po="${escapeHtml(po.id)}"
          >
            PO APPROVE
          </button>
        ` : ""}

        ${(isAdmin || (
          isMarketing &&
          po.created_by === user.id &&
          ["draft", "revision"].includes(po.status)
        )) ? `
          <button
            type="button"
            class="btn btn-danger"
            data-delete-po="${escapeHtml(po.id)}"
          >
            HAPUS PO
          </button>
        ` : ""}
      </div>
    </article>
  `).join("");
}

// =====================================
// DELETE PO
// =====================================

async function deletePO(poId) {
  const po = allPO.find(item => item.id === poId);
  if (!po) return;

  // Admin boleh menghapus semua PO.
  // Marketing hanya boleh menghapus PO miliknya
  // dengan status draft atau revision.
  const canDelete =
    isAdmin ||
    (
      isMarketing &&
      po.created_by === user.id &&
      ["draft", "revision"].includes(po.status)
    );

  if (!canDelete) {
    alert("Anda tidak memiliki akses untuk menghapus PO ini.");
    return;
  }

  const confirmed = confirm(
    `Yakin ingin menghapus PO ${po.po_number || ""}?\n\n` +
    "Data PO, daftar ukuran/nama, dan riwayat revisinya akan ikut terhapus permanen."
  );

  if (!confirmed) return;

  try {
    const { error } = await supabase
      .from("purchase_orders")
      .delete()
      .eq("id", poId);

    if (error) throw error;

    alert("PO berhasil dihapus.");

    await loadPO();

  } catch (error) {
    console.error("Gagal menghapus PO:", error);
    alert(error.message || "Gagal menghapus PO.");
  }
}

// =====================================
// APPROVE PO
// =====================================

async function approvePO(poId) {
  const po = allPO.find(item => item.id === poId);
  if (!po) return;

  if (!(isAdmin || isAdminPO || isMarketing)) {
    alert("Anda tidak memiliki akses untuk approve PO.");
    return;
  }

  if (po.status !== "submitted") {
    alert("Hanya PO dengan status Menunggu Pemeriksaan yang bisa di-approve.");
    return;
  }

  if (!confirm(
    `Yakin ingin menyetujui PO ${po.po_number}?\n\n` +
    "PO akan dipindahkan ke daftar PO Approved dan siap dibuatkan nota."
  )) return;

  try {
    const { data, error } = await supabase
      .from("purchase_orders")
      .update({
        status: "approved",
        reviewed_by: user.id,
        approved_at: new Date().toISOString()
      })
      .eq("id", poId)
      .eq("status", "submitted")
      .select("id")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      throw new Error(
        "PO tidak dapat disetujui. Status mungkin sudah berubah atau akses database ditolak."
      );
    }

    alert("PO berhasil di-approve.");
    await loadPO();

  } catch (error) {
    console.error("Gagal approve PO:", error);
    alert(error.message || "Gagal menyetujui PO.");
  }
}

// =====================================
// KEMBALIKAN PO KE DESAIN
// =====================================

async function returnPOToDesign(poId) {
  const po = allPO.find(item => item.id === poId);
  if (!po) return;

  if (!(isAdmin || isMarketing)) {
    alert("Anda tidak memiliki akses.");
    return;
  }

  if (
    !po.design_id ||
    !["draft", "submitted", "revision"].includes(po.status)
  ) {
    alert("PO ini tidak dapat dikembalikan ke desain.");
    return;
  }

  const confirmed = confirm(
    `Kembalikan PO ${po.po_number || ""} ke desain?\n\n` +
    "PO lama beserta seluruh itemnya akan dihapus permanen.\n" +
    "Desain akan kembali ke Marketing untuk divalidasi ulang.\n\n" +
    "PO baru harus dibuat setelah desain disetujui kembali."
  );

  if (!confirmed) return;

  try {
    const { data, error } = await supabase.rpc(
      "return_po_to_design",
      { p_po_id: poId }
    );

    if (error) throw error;
    if (!data?.success) {
      throw new Error("Proses pengembalian PO gagal.");
    }

    alert(
      "Berhasil! PO lama telah dihapus dan desain kembali ke Marketing."
    );

    await loadPO();

  } catch (error) {
    console.error("Gagal mengembalikan PO:", error);
    alert(`Gagal mengembalikan PO: ${error.message}`);
  }
}

// =====================================
// EVENT
// =====================================

refreshPO.addEventListener("click", loadPO);
statusFilter.addEventListener("change", renderPO);
searchPO.addEventListener("input", renderPO);

poList.addEventListener("click", event => {

  const returnButton = event.target.closest("[data-return-design]");

  if (returnButton) {
    returnPOToDesign(returnButton.dataset.returnDesign);
    return;
  }

  const approveButton = event.target.closest("[data-approve-po]");

  if (approveButton) {
    approvePO(approveButton.dataset.approvePo);
    return;
  }

  const deleteButton = event.target.closest("[data-delete-po]");

  if (deleteButton) {
    deletePO(deleteButton.dataset.deletePo);
    return;
  }

  const detailButton = event.target.closest("[data-detail-po]");

  if (detailButton) {
    location.href =
      `po-detail.html?id=${encodeURIComponent(detailButton.dataset.detailPo)}`;
  }

});

// =====================================
// INIT
// =====================================

loadPO();
