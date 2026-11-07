
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
  throw new Error("Akses halaman PO Approved ditolak.");
}

// =====================================
// ELEMENT
// =====================================

const approvedList = document.querySelector("#approvedList");
const approvedMessage = document.querySelector("#approvedMessage");
const refreshApproved = document.querySelector("#refreshApproved");
const searchApproved = document.querySelector("#searchApproved");
const statApproved = document.querySelector("#statApproved");

let allApprovedPO = [];

// =====================================
// FORMAT
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
    approved: "Approved",
    printed: "Sudah Dicetak"
  };

  return labels[status] || status;
}

// =====================================
// LOAD APPROVED PO
// =====================================

async function loadApprovedPO() {
  approvedList.innerHTML =
    '<p class="muted">Memuat PO Approved...</p>';

  approvedMessage.textContent = "";

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
      approved_at
    `)
    .in("status", ["approved", "printed"])
    .order("approved_at", { ascending: false });

  // Marketing hanya melihat PO miliknya.
  if (isMarketing) {
    query = query.eq("created_by", user.id);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Gagal mengambil PO Approved:", error);

    approvedList.innerHTML = `
      <div class="po-empty">
        Gagal memuat PO Approved:
        ${escapeHtml(error.message)}
      </div>
    `;

    statApproved.textContent = "—";
    return;
  }

  allApprovedPO = data || [];

  statApproved.textContent = allApprovedPO.length;

  renderApprovedPO();
}

// =====================================
// RENDER DAFTAR
// =====================================

function renderApprovedPO() {
  const keyword = searchApproved.value.trim().toLowerCase();

  const filtered = allApprovedPO.filter(po => {
    return (
      !keyword ||
      String(po.po_number || "").toLowerCase().includes(keyword) ||
      String(po.customer_name || "").toLowerCase().includes(keyword)
    );
  });

  if (!filtered.length) {
    approvedList.innerHTML = `
      <div class="po-empty">
        Belum ada PO Approved yang sesuai.
      </div>
    `;
    return;
  }

  approvedList.innerHTML = filtered.map(po => `
    <article class="po-card">
      <div class="po-card-info">
        <h3>${escapeHtml(po.po_number || "PO belum bernomor")}</h3>

        <p>
          Customer:
          <strong>${escapeHtml(po.customer_name || "-")}</strong>
        </p>

        <p>Tanggal PO: ${formatDate(po.order_date)}</p>
        <p>Deadline: ${formatDate(po.deadline)}</p>
        <p>Approved: ${formatDate(po.approved_at?.slice(0, 10))}</p>

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

        ${(isMarketing || isAdmin || isAdminPO) ? `
          <button
            type="button"
            class="btn btn-success"
            data-repeat-po="${escapeHtml(po.id)}"
          >
            REPEAT ORDER
          </button>
        ` : ""}

        ${isAdmin ? `
          <button
            type="button"
            class="btn btn-danger"
            data-delete-po="${escapeHtml(po.id)}"
          >
            DELETE
          </button>
        ` : ""}
      </div>
    </article>
  `).join("");
}

// =====================================
// DELETE PO (ADMIN ONLY)
// =====================================

async function deleteApprovedPO(id, button) {
  if (!isAdmin) {
    approvedMessage.textContent =
      "Anda tidak memiliki izin untuk menghapus PO.";
    return;
  }

  const selectedPO = allApprovedPO.find(po => po.id === id);

  if (!selectedPO) return;

  const confirmed = confirm(
    `Yakin ingin menghapus PO ${selectedPO.po_number || ""}?\n\n` +
    "Data PO yang dihapus tidak dapat dikembalikan."
  );

  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "MENGHAPUS...";

  approvedMessage.textContent = "";

  const { data, error } = await supabase
    .from("purchase_orders")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) {
    console.error("Gagal menghapus PO:", error);

    approvedMessage.textContent =
      "Gagal menghapus PO: " + error.message;

    button.disabled = false;
    button.textContent = "DELETE";
    return;
  }

  if (!data || data.length === 0) {
    approvedMessage.textContent =
      "PO tidak terhapus. Periksa izin DELETE di database Supabase.";

    button.disabled = false;
    button.textContent = "DELETE";
    return;
  }

  approvedMessage.textContent =
    `PO ${selectedPO.po_number || ""} berhasil dihapus.`;

  await loadApprovedPO();
}

// =====================================
// EVENT
// =====================================

refreshApproved.addEventListener("click", loadApprovedPO);

searchApproved.addEventListener("input", renderApprovedPO);

approvedList.addEventListener("click", async event => {
  const detailButton = event.target.closest("[data-detail-po]");
  const deleteButton = event.target.closest("[data-delete-po]");
  const repeatButton = event.target.closest("[data-repeat-po]");

  if (repeatButton) {
    const poId = repeatButton.dataset.repeatPo;

    const confirmed = confirm(
      "Buat Repeat Order dari PO ini?\n\n" +
      "Desain dan spesifikasi akan disalin. " +
      "Daftar nama dan ukuran akan diisi ulang."
    );

    if (!confirmed) return;

    location.href =
      `po-form.html?repeat_from=${encodeURIComponent(poId)}`;

    return;
  }

  if (detailButton) {
    location.href =
      `po-detail.html?id=${encodeURIComponent(detailButton.dataset.detailPo)}`;
    return;
  }

  if (deleteButton && isAdmin) {
    await deleteApprovedPO(
      deleteButton.dataset.deletePo,
      deleteButton
    );
  }
});

// =====================================
// INIT
// =====================================

loadApprovedPO();
