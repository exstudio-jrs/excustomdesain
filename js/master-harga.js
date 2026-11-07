
import {
  supabase,
  SUPABASE_URL,
  SUPABASE_ANON_KEY
} from "./config.js";

import {
  requireUser,
  escapeHtml
} from "./common.js";

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/master-harga`;

let currentUser = null;
let activeTab = "promo";
let promoData = [];
let hargaData = [];
let editingCode = null;

const $ = selector => document.querySelector(selector);

const promoFields = [
  { name: "kode_promo", label: "Kode Promo", required: true },
  { name: "nama_promo", label: "Nama Promo", required: true },
  {
    name: "kategori_harga",
    label: "Kategori Harga",
    type: "select",
    options: ["", "AGEN", "USER", "SEMUA"]
  },
  { name: "jenis_pesanan", label: "Jenis Pesanan" },
  {
    name: "grade",
    label: "Grade",
    type: "select",
    options: ["", "A", "B", "SEMUA"]
  },
  {
    name: "diskon_per_pcs",
    label: "Diskon per Pcs (Rp)",
    type: "number",
    required: true
  },
  {
    name: "minimal_qty",
    label: "Minimal Qty",
    type: "number",
    required: true
  },
  {
    name: "tanggal_mulai",
    label: "Tanggal Mulai",
    type: "date"
  },
  {
    name: "tanggal_selesai",
    label: "Tanggal Selesai",
    type: "date"
  },
  {
    name: "aktif",
    label: "Status",
    type: "select",
    options: ["YA", "TIDAK"]
  },
  {
    name: "keterangan",
    label: "Keterangan",
    type: "textarea",
    full: true
  }
];

const hargaFields = [
  { name: "kode_tambahan", label: "Kode Tambahan", required: true },
  { name: "kategori", label: "Kategori", required: true },
  { name: "nama_tambahan", label: "Nama Tambahan", required: true },
  {
    name: "harga_tambahan",
    label: "Harga Tambahan (Rp)",
    type: "number",
    required: true
  },
  {
    name: "metode_hitung",
    label: "Metode Hitung",
    type: "select",
    options: ["", "PER_PCS", "PER_PESANAN"]
  },
  {
    name: "aktif",
    label: "Status",
    type: "select",
    options: ["YA", "TIDAK"]
  },
  {
    name: "catatan",
    label: "Catatan",
    type: "textarea",
    full: true
  }
];

function clean(value) {
  return value === null || value === undefined
    ? ""
    : String(value).trim();
}

function isActive(value) {
  return ["YA", "TRUE", "1", "AKTIF"].includes(
    clean(value).toUpperCase()
  );
}

function rupiah(value) {
  return "Rp " + Number(value || 0).toLocaleString("id-ID");
}

function showMessage(message, type = "success") {
  const element = $("#masterMessage");

  element.textContent = message;
  element.className = `master-message ${type}`;
  element.classList.remove("hidden");

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function hideMessage() {
  $("#masterMessage").classList.add("hidden");
}

async function callMasterAPI(payload) {
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError) throw sessionError;

  const token = sessionData.session?.access_token;

  if (!token) {
    throw new Error("Sesi login berakhir. Silakan login kembali.");
  }

  const response = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.message || "Permintaan gagal diproses.");
  }

  return result;
}

async function loadMasterData() {
  $("#masterLoading").classList.remove("hidden");
  hideMessage();

  try {
    const result = await callMasterAPI({
      action: "get_master"
    });

    promoData = result.promo || [];
    hargaData = result.harga_tambahan || [];

    renderTables();
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    $("#masterLoading").classList.add("hidden");
  }
}

function renderTables() {
  renderPromo();
  renderHarga();
}

function renderPromo() {
  const keyword = clean($("#searchMaster").value).toLowerCase();

  const filtered = promoData.filter(item => {
    const text = [
      item.kode_promo,
      item.nama_promo,
      item.kategori_harga,
      item.jenis_pesanan,
      item.grade
    ].join(" ").toLowerCase();

    return text.includes(keyword);
  });

  const tbody = $("#tablePromo");

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="empty-row">
          Tidak ada data promo.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(item => {
    const active = isActive(item.aktif);

    return `
      <tr>
        <td><strong>${escapeHtml(clean(item.kode_promo))}</strong></td>
        <td>${escapeHtml(clean(item.nama_promo))}</td>
        <td>${escapeHtml(clean(item.kategori_harga) || "-")}</td>
        <td>${escapeHtml(clean(item.jenis_pesanan) || "-")}</td>
        <td>${escapeHtml(clean(item.grade) || "-")}</td>
        <td>${rupiah(item.diskon_per_pcs)}</td>
        <td>${escapeHtml(clean(item.minimal_qty) || "0")}</td>
        <td>
          ${escapeHtml(clean(item.tanggal_mulai) || "-")}
          <br>
          s/d ${escapeHtml(clean(item.tanggal_selesai) || "-")}
        </td>
        <td>
          <span class="master-status ${active ? "active" : "inactive"}">
            ${active ? "AKTIF" : "NONAKTIF"}
          </span>
        </td>
        <td>
          <div class="master-row-actions">
            <button class="btn btn-ghost"
              data-edit="promo"
              data-code="${escapeHtml(clean(item.kode_promo))}">
              Edit
            </button>
            <button class="btn btn-danger"
              data-delete="promo"
              data-code="${escapeHtml(clean(item.kode_promo))}">
              Hapus
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderHarga() {
  const keyword = clean($("#searchMaster").value).toLowerCase();

  const filtered = hargaData.filter(item => {
    const text = [
      item.kode_tambahan,
      item.kategori,
      item.nama_tambahan,
      item.metode_hitung,
      item.catatan
    ].join(" ").toLowerCase();

    return text.includes(keyword);
  });

  const tbody = $("#tableHarga");

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-row">
          Tidak ada data harga tambahan.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(item => {
    const active = isActive(item.aktif);

    return `
      <tr>
        <td><strong>${escapeHtml(clean(item.kode_tambahan))}</strong></td>
        <td>${escapeHtml(clean(item.kategori))}</td>
        <td>${escapeHtml(clean(item.nama_tambahan))}</td>
        <td>${rupiah(item.harga_tambahan)}</td>
        <td>${escapeHtml(clean(item.metode_hitung) || "-")}</td>
        <td>
          <span class="master-status ${active ? "active" : "inactive"}">
            ${active ? "AKTIF" : "NONAKTIF"}
          </span>
        </td>
        <td>${escapeHtml(clean(item.catatan) || "-")}</td>
        <td>
          <div class="master-row-actions">
            <button class="btn btn-ghost"
              data-edit="harga"
              data-code="${escapeHtml(clean(item.kode_tambahan))}">
              Edit
            </button>
            <button class="btn btn-danger"
              data-delete="harga"
              data-code="${escapeHtml(clean(item.kode_tambahan))}">
              Hapus
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function switchTab(tab) {
  activeTab = tab;
  hideMessage();

  document.querySelectorAll(".master-tab").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });

  $("#tablePromoWrap").classList.toggle("hidden", tab !== "promo");
  $("#tableHargaWrap").classList.toggle("hidden", tab !== "harga");

  $("#searchMaster").value = "";

  $("#searchMaster").placeholder = tab === "promo"
    ? "Cari kode atau nama promo..."
    : "Cari kode atau nama tambahan...";

  $("#btnTambah").textContent = tab === "promo"
    ? "+ Tambah Promo"
    : "+ Tambah Harga";

  renderTables();
}

function buildFormFields(fields, data = {}) {
  const container = $("#formFields");

  container.innerHTML = fields.map(field => {
    const value = clean(data[field.name]);
    const required = field.required ? "required" : "";
    const full = field.full ? "full" : "";

    let control = "";

    if (field.type === "select") {
      const options = field.options.map(option => `
        <option value="${escapeHtml(option)}"
          ${value === option ? "selected" : ""}>
          ${escapeHtml(option || "-- Pilih --")}
        </option>
      `).join("");

      control = `
        <select name="${field.name}" ${required}>
          ${options}
        </select>
      `;
    } else if (field.type === "textarea") {
      control = `
        <textarea name="${field.name}">${escapeHtml(value)}</textarea>
      `;
    } else {
      control = `
        <input
          type="${field.type || "text"}"
          name="${field.name}"
          value="${escapeHtml(value)}"
          ${required}
          ${field.type === "number" ? 'min="0" step="any"' : ""}
        >
      `;
    }

    return `
      <div class="master-field ${full}">
        <label>${escapeHtml(field.label)}</label>
        ${control}
      </div>
    `;
  }).join("");

  // Kode tidak boleh diubah saat mengedit data.
  if (editingCode) {
    const key = activeTab === "promo" ? "kode_promo" : "kode_tambahan";
    const input = container.querySelector(`[name="${key}"]`);

    if (input) input.disabled = true;
  }
}

function openModal(data = null) {
  editingCode = data
    ? clean(activeTab === "promo" ? data.kode_promo : data.kode_tambahan)
    : null;

  const fields = activeTab === "promo" ? promoFields : hargaFields;

  const initialData = data || { aktif: "YA" };

  $("#modalTitle").textContent = data
    ? "Edit Data"
    : activeTab === "promo"
      ? "Tambah Promo"
      : "Tambah Harga Tambahan";

  $("#btnSimpan").disabled = false;
  $("#btnSimpan").textContent = "Simpan Data";

  buildFormFields(fields, initialData);
  $("#masterModal").classList.remove("hidden");
}

function closeModal() {
  $("#masterModal").classList.add("hidden");
  $("#masterForm").reset();
  editingCode = null;
}

async function saveForm(event) {
  event.preventDefault();

  const button = $("#btnSimpan");
  button.disabled = true;
  button.textContent = "Menyimpan...";

  try {
    const fields = activeTab === "promo" ? promoFields : hargaFields;
    const data = {};

    fields.forEach(field => {
      const input = $(`#formFields [name="${field.name}"]`);

      let value = input ? input.value.trim() : "";

      if (field.type === "number") {
        value = value === "" ? 0 : Number(value);
      }

      data[field.name] = value;
    });

    const action = activeTab === "promo"
      ? "save_promo"
      : "save_harga_tambahan";

    await callMasterAPI({
      action,
      data
    });

    closeModal();
    await loadMasterData();

    showMessage(
      editingCode
        ? "Data berhasil diperbarui."
        : "Data berhasil ditambahkan.",
      "success"
    );
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Simpan Data";
  }
}

async function deleteData(type, code) {
  const label = type === "promo" ? "promo" : "harga tambahan";

  if (!confirm(`Yakin ingin menghapus ${label} dengan kode ${code}?`)) {
    return;
  }

  try {
    await callMasterAPI({
      action: type === "promo" ? "delete_promo" : "delete_harga_tambahan",
      kode: code
    });

    await loadMasterData();
    showMessage(`Data ${label} berhasil dihapus.`, "success");
  } catch (error) {
    showMessage(error.message, "error");
  }
}

function bindEvents() {
  document.querySelectorAll(".master-tab").forEach(button => {
    button.addEventListener("click", () => {
      switchTab(button.dataset.tab);
    });
  });

  $("#btnTambah").addEventListener("click", () => openModal());

  $("#btnCloseModal").addEventListener("click", closeModal);
  $("#btnBatal").addEventListener("click", closeModal);

  $("#masterModal").addEventListener("click", event => {
    if (event.target === $("#masterModal")) closeModal();
  });

  $("#masterForm").addEventListener("submit", saveForm);

  $("#searchMaster").addEventListener("input", renderTables);

  document.addEventListener("click", event => {
    const editButton = event.target.closest("[data-edit]");

    if (editButton) {
      const type = editButton.dataset.edit;
      const code = editButton.dataset.code;

      const data = type === "promo"
        ? promoData.find(item => clean(item.kode_promo) === code)
        : hargaData.find(item => clean(item.kode_tambahan) === code);

      if (data) {
        switchTab(type);
        openModal(data);
      }
      return;
    }

    const deleteButton = event.target.closest("[data-delete]");

    if (deleteButton) {
      deleteData(
        deleteButton.dataset.delete,
        deleteButton.dataset.code
      );
    }
  });
}

async function init() {
  try {
    const context = await requireUser();

    if (!context?.user || !context?.profile) {
      throw new Error("Sesi pengguna tidak ditemukan.");
    }

    currentUser = context.profile;

    if (!["admin", "marketing"].includes(currentUser.role)) {
      alert("Halaman Master Harga hanya dapat diakses Admin dan Marketing.");
      location.replace("dashboard.html");
      return;
    }

    bindEvents();
    await loadMasterData();

  } catch (error) {
    console.error("Master Harga:", error);
    showMessage(error.message || "Gagal membuka halaman Master Harga.", "error");
  }
}

init();
