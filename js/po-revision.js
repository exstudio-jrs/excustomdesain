
import { supabase } from "./config.js";
import { requireUser, escapeHtml } from "./common.js";

const context = await requireUser();

if (!context) {
  throw new Error("User belum login.");
}

const { user, profile } = context;

// Form revisi PO hanya untuk Marketing.
if (profile.role !== "marketing") {
  location.replace(
    profile.role === "admin_po" ? "po.html" : "dashboard.html"
  );
  throw new Error("Akses revisi PO ditolak.");
}

const form = document.querySelector("#poForm");
const formMessage = document.querySelector("#formMessage");
const itemRows = document.querySelector("#itemRows");
const revisionNote = document.querySelector("#revisionNote");

const addItemBtn = document.querySelector("#addItemBtn");
const submitPOBtn = document.querySelector("#submitPOBtn");

const poId = new URLSearchParams(location.search).get("id");

let currentPO = null;
let busy = false;

function value(id) {
  return document.querySelector(`#${id}`).value.trim();
}

function setValue(id, val) {
  document.querySelector(`#${id}`).value = val ?? "";
}

function showMessage(message, type = "info") {
  formMessage.textContent = message;
  formMessage.className = `form-message ${type}`;
}

function setBusy(state) {
  busy = state;

  submitPOBtn.disabled = state;
  addItemBtn.disabled = state;

  submitPOBtn.textContent = state
    ? "MENGIRIM..."
    : "KIRIM ULANG PO →";
}

function addItemRow(item = {}) {
  const row = document.createElement("tr");

  row.innerHTML = `
    <td>
      <input type="text" class="item-name"
        placeholder="Nama pemesan"
        value="${escapeHtml(item.person_name || "")}">
    </td>
    <td>
      <input type="text" class="item-size"
        placeholder="Ukuran"
        value="${escapeHtml(item.size || "")}">
    </td>
    <td>
      <input type="number" class="item-quantity"
        min="1"
        value="${Number(item.quantity) > 0 ? Number(item.quantity) : 1}">
    </td>
    <td>
      <input type="text" class="item-notes"
        placeholder="Catatan"
        value="${escapeHtml(item.notes || "")}">
    </td>
    <td>
      <button type="button" class="btn btn-ghost remove-item">
        Hapus
      </button>
    </td>
  `;

  itemRows.appendChild(row);
}

function collectItems() {
  const rows = [...itemRows.querySelectorAll("tr")];

  return rows.map(row => ({
    person_name: row.querySelector(".item-name").value.trim(),
    size: row.querySelector(".item-size").value.trim(),
    quantity: Number(row.querySelector(".item-quantity").value),
    notes: row.querySelector(".item-notes").value.trim() || null
  }));
}

function validateItems(items) {
  if (!items.length) {
    throw new Error("Tambahkan minimal satu nama pemesan.");
  }

  for (const item of items) {
    if (!item.person_name || !item.size) {
      throw new Error("Nama dan ukuran setiap item wajib diisi.");
    }

    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error("Jumlah item minimal 1.");
    }
  }
}

function collectPOData() {
  return {
    customer_name: value("customerName"),
    order_date: value("orderDate"),
    deadline: value("deadline") || null,
    apparel_type: value("apparelType") || null,

    shirt_spec: {
      collar: value("shirtCollar"),
      material: value("shirtMaterial"),
      sleeve: value("shirtSleeve"),
      notes: value("shirtNotes")
    },

    pants_spec: {
      model: value("pantsModel"),
      material: value("pantsMaterial"),
      notes: value("pantsNotes")
    },

    shipping_info: {
      receiver_name: value("receiverName"),
      phone: value("receiverPhone"),
      address: value("shippingAddress")
    },

    notes: value("poNotes") || null,

    // Pertahankan status revision sampai item selesai disimpan.
    status: "revision"
  };
}

function fillForm(po) {
  setValue("customerName", po.customer_name);
  setValue("poNumber", po.po_number);
  setValue("orderDate", po.order_date);
  setValue("deadline", po.deadline);
  setValue("apparelType", po.apparel_type);

  const shirt = po.shirt_spec || {};
  setValue("shirtCollar", shirt.collar);
  setValue("shirtMaterial", shirt.material);
  setValue("shirtSleeve", shirt.sleeve);
  setValue("shirtNotes", shirt.notes);

  const pants = po.pants_spec || {};
  setValue("pantsModel", pants.model);
  setValue("pantsMaterial", pants.material);
  setValue("pantsNotes", pants.notes);

  const shipping = po.shipping_info || {};
  setValue("receiverName", shipping.receiver_name);
  setValue("receiverPhone", shipping.phone);
  setValue("shippingAddress", shipping.address);

  setValue("poNotes", po.notes);

  document.querySelector("#poNumber").readOnly = true;
}

async function loadRevisionNote() {
  const { data, error } = await supabase
    .from("purchase_order_revisions")
    .select("revision_note, created_at")
    .eq("purchase_order_id", poId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;

  revisionNote.textContent = data?.length
    ? data[0].revision_note
    : "Tidak ditemukan catatan revisi.";
}

async function loadRevisionPO() {
  if (!poId) {
    throw new Error("ID PO tidak ditemukan.");
  }

  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select("*")
    .eq("id", poId)
    .single();

  if (error) throw error;

  if (po.created_by !== user.id) {
    throw new Error("PO ini bukan milik akun Anda.");
  }

  if (po.status !== "revision") {
    throw new Error("PO ini tidak sedang dalam proses revisi.");
  }

  currentPO = po;
  fillForm(po);

  const { data: items, error: itemError } = await supabase
    .from("purchase_order_items")
    .select("*")
    .eq("purchase_order_id", po.id)
    .order("created_at", { ascending: true });

  if (itemError) throw itemError;

  itemRows.innerHTML = "";

  (items || []).forEach(addItemRow);

  if (!items?.length) {
    addItemRow();
  }

  await loadRevisionNote();

  showMessage(
    `PO ${po.po_number} sedang menunggu perbaikan data.`,
    "info"
  );
}

async function submitRevision() {
  if (busy) return;

  try {
    setBusy(true);
    showMessage("Memproses revisi PO...", "info");

    if (!currentPO) {
      throw new Error("Data PO belum berhasil dimuat.");
    }

    if (!value("customerName")) {
      throw new Error("Nama customer wajib diisi.");
    }

    if (!value("orderDate")) {
      throw new Error("Tanggal PO wajib diisi.");
    }

    const items = collectItems();
    validateItems(items);

    // 1. Simpan perubahan data PO.
    // Status tetap revision pada tahap ini.
    const poData = collectPOData();

    const { data: savedPO, error: updateError } = await supabase
      .from("purchase_orders")
      .update(poData)
      .eq("id", currentPO.id)
      .eq("status", "revision")
      .select()
      .single();

    if (updateError) throw updateError;

    // 2. Perbarui daftar item selama status masih revision.
    const { error: deleteError } = await supabase
      .from("purchase_order_items")
      .delete()
      .eq("purchase_order_id", savedPO.id);

    if (deleteError) throw deleteError;

    const itemPayload = items.map(item => ({
      ...item,
      purchase_order_id: savedPO.id
    }));

    const { error: insertError } = await supabase
      .from("purchase_order_items")
      .insert(itemPayload);

    if (insertError) throw insertError;

    // 3. Setelah semua data berhasil disimpan,
    // ubah status menjadi submitted.
    const { data: submittedPO, error: submitError } = await supabase
      .from("purchase_orders")
      .update({
        status: "submitted"
      })
      .eq("id", savedPO.id)
      .eq("status", "revision")
      .select()
      .single();

    if (submitError) throw submitError;

    currentPO = submittedPO;

    showMessage(
      `PO ${submittedPO.po_number} berhasil dikirim ulang ke Admin_PO.`,
      "success"
    );

    submitPOBtn.disabled = true;
    addItemBtn.disabled = true;

    setTimeout(() => {
      location.href = "dashboard.html";
    }, 1800);

  } catch (error) {
    console.error("Gagal mengirim revisi PO:", error);

    showMessage(
      error.message || "Gagal mengirim revisi PO.",
      "error"
    );
  } finally {
    setBusy(false);
  }
}


// =========================================
// EVENT
// =========================================

addItemBtn.addEventListener("click", () => {
  addItemRow();
});

itemRows.addEventListener("click", event => {
  const button = event.target.closest(".remove-item");

  if (!button) return;

  button.closest("tr").remove();
});

form.addEventListener("submit", event => {
  event.preventDefault();
  submitRevision();
});


// =========================================
// INIT
// =========================================

try {
  await loadRevisionPO();
} catch (error) {
  console.error("Gagal membuka revisi PO:", error);

  showMessage(
    error.message || "Gagal membuka halaman revisi PO.",
    "error"
  );

  form.hidden = true;
}
