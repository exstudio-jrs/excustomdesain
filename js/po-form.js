
import { supabase } from "./config.js";
import { requireUser, escapeHtml } from "./common.js";

const context = await requireUser();

if (!context) {
  throw new Error("User belum login.");
}

const { user, profile } = context;
const isMarketing = profile.role === "marketing";

const params = new URLSearchParams(location.search);
const poId = params.get("id");
const designId = params.get("design_id");
const repeatFromId = params.get("repeat_from");
console.log("PO ID:", poId);
console.log("Admin edit mode:", params.get("mode"));

const adminEditMode = params.get("mode") === "admin-edit";
const adminApprovedEditMode =
  params.get("mode") === "admin-approved-edit";

const isAdminPO = profile.role === "admin_po";
const isAdmin = profile.role === "admin";

// Pemeriksaan akses halaman PO
if (adminApprovedEditMode) {
  if (!isAdmin) {
    location.replace("po.html");
    throw new Error("Edit PO Approved hanya untuk Admin.");
  }

} else if (adminEditMode) {
  if (!isAdminPO && !isAdmin) {
    location.replace("po.html");
    throw new Error("Mode edit khusus Admin_PO.");
  }

} else if (!["marketing", "admin"].includes(profile.role)) {
  location.replace(
    profile.role === "admin_po" ? "po.html" : "dashboard.html"
  );
  throw new Error("Akses form PO ditolak.");
}

const form = document.querySelector("#poForm");
const formMessage = document.querySelector("#formMessage");
const itemRows = document.querySelector("#itemRows");

const addItemBtn = document.querySelector("#addItemBtn");
const saveDraftBtn = document.querySelector("#saveDraftBtn");
const submitPOBtn = document.querySelector("#submitPOBtn");

console.log("Design ID diterima PO:", designId);
console.log("Design ID diterima PO:", designId);

let currentPO = null;
let linkedDesignId = null;
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

// =====================================
// VALIDASI DESAIN APPROVED
// =====================================

async function loadApprovedDesign() {
  if (!designId) return;

  const { data: design, error } = await supabase
    .from("designs")
    .select("id, status, created_by")
    .eq("id", designId)
    .eq("status", "approved")
    .single();

  if (error) {
    throw new Error("Desain approved tidak ditemukan atau tidak dapat diakses.");
  }

  if (
    profile.role === "marketing" &&
    design.created_by !== user.id
  ) {
    throw new Error("Desain ini bukan milik akun Marketing Anda.");
  }

  linkedDesignId = design.id;
}

function setBusy(state) {
  busy = state;

  saveDraftBtn.disabled = state;
  submitPOBtn.disabled = state;
  addItemBtn.disabled = state;

  saveDraftBtn.textContent = state
    ? "MENYIMPAN..."
    : adminApprovedEditMode
      ? "SIMPAN PERUBAHAN"
      : "SIMPAN DRAFT";

  submitPOBtn.textContent = state
    ? "MEMPROSES..."
    : "SIMPAN & KIRIM PO →";
}

/* =====================================
   ITEM ROW
===================================== */

function addItemRow(item = {}) {
  const row = document.createElement("tr");

  const sizes = ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];

  row.innerHTML = `
    <td>
      <select class="item-size">
        <option value="">Pilih Size</option>
        ${sizes.map(size => `
          <option value="${size}" ${item.size === size ? "selected" : ""}>
            ${size}
          </option>
        `).join("")}
      </select>
    </td>

    <td>
      <input
        type="text"
        class="item-number"
        placeholder="Nomor"
        value="${escapeHtml(item.jersey_number || "")}"
      >
    </td>

    <td>
      <input
        type="text"
        class="item-name"
        placeholder="Nama pemesan (opsional)"
        value="${escapeHtml(item.person_name || "")}"
      >
    </td>

    <td>
      <input
        type="number"
        class="item-quantity"
        min="1"
        value="${Number(item.quantity) > 0 ? Number(item.quantity) : 1}"
      >
    </td>

    <td>
      <input
        type="text"
        class="item-notes"
        placeholder="Catatan"
        value="${escapeHtml(item.notes || "")}"
      >
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
    size: row.querySelector(".item-size").value.trim(),
    jersey_number: row.querySelector(".item-number").value.trim() || null,
    person_name: row.querySelector(".item-name").value.trim() || null,
    quantity: Number(row.querySelector(".item-quantity").value),
    notes: row.querySelector(".item-notes").value.trim() || null
  }));
}

function validateItems(items) {
  if (!items.length) {
    throw new Error("Tambahkan minimal satu item pesanan.");
  }

  for (const item of items) {
    if (!item.size) {
      throw new Error("Size setiap item wajib dipilih.");
    }

    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error("Jumlah item minimal 1.");
    }
  }

  return items;
}

/* =====================================
   PO DATA
===================================== */

function collectPOData(status) {
  return {
    design_id: linkedDesignId,

    customer_name: value("customerName"),
    order_date: value("orderDate"),
    deadline: value("deadline") || null,
    apparel_type: value("apparelType") || null,

    wearer_category: value("wearerCategory") || null,

    shirt_spec: {
      collar: value("shirtCollar"),
      material: value("shirtMaterial"),
      sleeve: value("shirtSleeve"),
      sleeve_trim: value("shirtSleeveTrim"),
      notes: value("shirtNotes")
    },

    pants_spec: {
      model: value("pantsModel"),
      material: value("pantsMaterial"),
      trim: value("pantsTrim"),
      notes: value("pantsNotes")
    },

    shipping_info: {
      receiver_name: value("receiverName"),
      phone: value("receiverPhone"),
      address: value("shippingAddress")
    },

    notes: value("poNotes") || null,
    status
  };
}

function fillForm(po) {
  setValue("customerName", po.customer_name);
  setValue("poNumber", po.po_number);
  setValue("orderDate", po.order_date);
  setValue("deadline", po.deadline);
  setValue("apparelType", po.apparel_type);
  setValue("wearerCategory", po.wearer_category);

  const shirt = po.shirt_spec || {};

  setValue("shirtCollar", shirt.collar);
  setValue("shirtMaterial", shirt.material);
  setValue("shirtSleeve", shirt.sleeve);
  setValue("shirtSleeveTrim", shirt.sleeve_trim);
  setValue("shirtNotes", shirt.notes);

  const pants = po.pants_spec || {};

  setValue("pantsModel", pants.model);
  setValue("pantsMaterial", pants.material);
  setValue("pantsTrim", pants.trim);
  setValue("pantsNotes", pants.notes);

  const shipping = po.shipping_info || {};

  setValue("receiverName", shipping.receiver_name);
  setValue("receiverPhone", shipping.phone);
  setValue("shippingAddress", shipping.address);

  setValue("poNotes", po.notes);

  document.querySelector("#poNumber").readOnly = true;
}

/* =====================================
   LOAD EXISTING PO
===================================== */

async function loadExistingPO() {
  if (!poId) return;

  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select("*")
    .eq("id", poId)
    .single();

  if (error) throw error;

  // Pemeriksaan akses
  if (adminApprovedEditMode) {
  // Mode khusus Admin untuk edit PO Approved
  if (!isAdmin) {
    throw new Error("Edit PO Approved hanya untuk Admin.");
  }

  if (po.status !== "approved") {
    throw new Error("Mode ini hanya dapat digunakan untuk PO Approved.");
  }

} else if (adminEditMode) {
  // Mode edit Admin_PO
  if (!isAdminPO && !isAdmin) {
    throw new Error("Mode edit khusus Admin_PO.");
  }

  if (!["draft", "revision", "submitted"].includes(po.status)) {
    throw new Error("PO tidak dapat diedit pada status sekarang.");
  }

} else {
  // Mode edit biasa Marketing/Admin
  if (po.created_by !== user.id && !isAdmin) {
    throw new Error("PO ini bukan milik akun Anda.");
  }

  if (!["draft", "revision"].includes(po.status)) {
    throw new Error("PO ini tidak dapat diedit pada status sekarang.");
  }
}

  currentPO = po;
  linkedDesignId = po.design_id || null;

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

  showMessage(
  adminApprovedEditMode
    ? "Mode edit Admin. Status PO tetap Approved setelah disimpan."
    : adminEditMode
      ? "Mode edit Admin_PO. Perubahan tidak akan mengubah status PO."
      : po.status === "revision"
        ? "PO dikembalikan untuk revisi. Silakan perbaiki data."
        : "Mode edit Draft PO.",
  "info"
);
}

// =====================================
// LOAD REPEAT ORDER
// =====================================

async function loadRepeatSourcePO() {
  if (!repeatFromId) return;

  if (!["marketing", "admin"].includes(profile.role)) {
    throw new Error("Repeat Order hanya dapat dibuat oleh Marketing atau Admin.");
  }

  const { data: sourcePO, error } = await supabase
    .from("purchase_orders")
    .select("*")
    .eq("id", repeatFromId)
    .single();

  if (error) {
    throw new Error("PO sumber Repeat Order tidak ditemukan: " + error.message);
  }

  if (!["approved", "printed"].includes(sourcePO.status)) {
    throw new Error("Repeat Order hanya dapat dibuat dari PO Approved atau Sudah Dicetak.");
  }

  if (isMarketing && sourcePO.created_by !== user.id) {
    throw new Error("Anda hanya dapat mengulang PO milik akun Marketing Anda.");
  }

  // Pertahankan desain dari PO sumber.
  if (!sourcePO.design_id) {
  throw new Error(
    "PO sumber belum memiliki desain. Repeat Order tidak dapat dilanjutkan."
  );
    }

    linkedDesignId = sourcePO.design_id;

  // Salin data customer dan spesifikasi.
  fillForm(sourcePO);

  // Kosongkan nomor PO lama agar PO baru menggunakan nomor baru.
  setValue("poNumber", "");

  // Tanggal PO baru menggunakan tanggal hari ini.
  setValue("orderDate", new Date().toISOString().slice(0, 10));

  // Deadline diisi ulang untuk pesanan baru.
  setValue("deadline", "");

  // Pastikan nomor PO tetap tidak dapat diedit manual.
  document.querySelector("#poNumber").readOnly = true;

  // Tidak menyalin item dari PO lama.
  itemRows.innerHTML = "";
  addItemRow();

  // PO sumber hanya untuk referensi, bukan untuk diedit.
  currentPO = null;

  showMessage(
    `Repeat Order dari ${sourcePO.po_number} berhasil dimuat. Desain dan spesifikasi disalin. Silakan isi ulang daftar nama, ukuran, nomor jersey, dan jumlah.`,
    "info"
  );
}

/* =====================================
   SAVE PO
===================================== */

async function savePO(submit = false) {
  if (busy) return;

  try {
    setBusy(true);
    showMessage("Memproses data PO...", "info");

    if (!value("customerName")) {
      throw new Error("Nama customer wajib diisi.");
    }

    if (!value("orderDate")) {
      throw new Error("Tanggal PO wajib diisi.");
    }

    if (!currentPO && designId && !linkedDesignId) {
      throw new Error(
        "Desain approved belum berhasil dimuat. Silakan buka ulang dari halaman desain."
      );
    }

    // Admin_PO hanya boleh menyimpan perubahan,
    // bukan mengirim atau mengubah status PO.
    if ((adminEditMode || adminApprovedEditMode) && submit) {
  throw new Error(
    "Mode edit Admin tidak dapat mengirim ulang atau mengubah status PO."
  );
}

    const items = collectItems();
    validateItems(items);

    // Pertahankan status asli ketika Admin_PO mengedit.
    const workingStatus =
  (adminEditMode || adminApprovedEditMode)
    ? currentPO.status
    : currentPO?.status === "revision"
      ? "revision"
      : "draft";

    const poData = collectPOData(workingStatus);

    let savedPO;

    if (currentPO) {
      const { data, error } = await supabase
        .from("purchase_orders")
        .update(poData)
        .eq("id", currentPO.id)
        .select()
        .single();

      if (error) throw error;

      savedPO = data;
    } else {
      const { data, error } = await supabase
        .from("purchase_orders")
        .insert({
          ...poData,
          created_by: user.id
        })
        .select()
        .single();

      if (error) throw error;

      savedPO = data;
      currentPO = data;
    }

    // Simpan ulang daftar item.
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

    // Submit hanya untuk alur Marketing biasa.
    if (
      !adminEditMode &&
      submit &&
      savedPO.status !== "submitted"
    ) {
      const { data, error } = await supabase
        .from("purchase_orders")
        .update({ status: "submitted" })
        .eq("id", savedPO.id)
        .select()
        .single();

      if (error) throw error;

      savedPO = data;
    }

    currentPO = savedPO;
    setValue("poNumber", savedPO.po_number);

    showMessage(
      (adminEditMode || adminApprovedEditMode)
        ? `Perubahan PO ${savedPO.po_number} berhasil disimpan.`
        : submit
          ? `PO ${savedPO.po_number} berhasil dikirim ke Admin_PO.`
          : `Draft ${savedPO.po_number} berhasil disimpan.`,
      "success"
    );

    if (adminEditMode || adminApprovedEditMode) {
    setTimeout(() => {
        location.href = `po-detail.html?id=${encodeURIComponent(savedPO.id)}`;
    }, 1200);
    } else if (submit) {
      setTimeout(() => {
        location.href = "dashboard.html";
      }, 1500);
    } else if (!submit) {
    setTimeout(() => {
        location.href = "po.html";
    }, 1000);
    }

  } catch (error) {
  console.error("Gagal menyimpan PO:", error);
  console.error("Detail error:", {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint
  });

  showMessage(
    `${error.message || "Gagal menyimpan PO."} ${error.details || ""}`,
    "error"
  );
    }   
}

/* =====================================
   EVENT
===================================== */

addItemBtn.addEventListener("click", () => {
  addItemRow();
});

itemRows.addEventListener("click", event => {
  const button = event.target.closest(".remove-item");

  if (!button) return;

  button.closest("tr").remove();
});

saveDraftBtn.addEventListener("click", () => {
  savePO(false);
});

form.addEventListener("submit", event => {
  event.preventDefault();
  savePO(true);
});

/* =====================================
   INIT
===================================== */

try {
  setValue(
    "orderDate",
    new Date().toISOString().slice(0, 10)
  );

    if (poId) {
    if (adminApprovedEditMode) {
      submitPOBtn.hidden = true;
      saveDraftBtn.textContent = "SIMPAN PERUBAHAN";
    }

    await loadExistingPO();

  } else if (repeatFromId) {
    await loadRepeatSourcePO();

  } else {
    await loadApprovedDesign();
    addItemRow();
  }

} catch (error) {
  console.error(error);

  showMessage(
    error.message || "Gagal membuka form PO.",
    "error"
  );

  saveDraftBtn.disabled = true;
  submitPOBtn.disabled = true;
}
