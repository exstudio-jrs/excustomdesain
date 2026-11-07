import { supabase } from "./config.js";
import { requireUser, escapeHtml } from "./common.js";

const API_URL = "https://script.google.com/macros/s/AKfycbzg2QFxtVsUiqraewCt1w_LnTf4ZU5uhfdeCnoDLNW0uJLtxDMQ80RUf1Y3WXtIgN10/exec";

const $ = (selector) => document.querySelector(selector);

const customerSelect = $("#customerSelect");
const poSelect = $("#poSelect");
const selectedPOList = $("#selectedPOList");
const notaDate = $("#notaDate");
const notaNotes = $("#notaNotes");
const saveNotaBtn = $("#saveNotaBtn");
const formMessage = $("#formMessage");

let currentUser = null;
let approvedPOs = [];
let selectedPOs = [];
let hargaDasar = [];
let hargaTambahan = [];
let daftarPromo = [];

const editingNotaId = new URLSearchParams(
  window.location.search
).get("id");

let originalPOIds = [];
let originalNotaNumber = null;

const rupiah = (value) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);

const normalize = (value) =>
  String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");

function showMessage(message, type = "info") {
  formMessage.hidden = false;
  formMessage.className = `form-message ${type}`;
  formMessage.textContent = message;
}

function hideMessage() {
  formMessage.hidden = true;
  formMessage.textContent = "";
}

function todayLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000)
    .toISOString()
    .slice(0, 10);
}

function generateNotaNumber() {
  const date = todayLocal().replaceAll("-", "");
  const time = Date.now().toString().slice(-6);
  const random = Math.floor(100 + Math.random() * 900);
  return `NOTA-${date}-${time}${random}`;
}

// Google Apps Script JSONP
function loadPriceMaster() {
  return new Promise((resolve, reject) => {
    const callbackName = `notaPriceCallback_${Date.now()}`;

    const script = document.createElement("script");
    script.src = `${API_URL}?callback=${callbackName}`;
    script.async = true;

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Waktu pengambilan data harga habis."));
    }, 20000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (result) => {
      cleanup();

      if (!result?.success) {
        reject(new Error(result?.message || "Gagal mengambil data harga."));
        return;
      }

      resolve(result);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Tidak dapat menghubungi database harga Google Spreadsheet."));
    };

    document.head.appendChild(script);
  });
}

// Mengambil PO approved dan daftar customer

async function loadApprovedPOs() {
  let query = supabase
    .from("purchase_orders")
    .select(`
      id,
      po_number,
      customer_name,
      order_date,
      deadline,
      apparel_type,
      status,
      created_by,
      approved_at
    `)
    .in("status", ["approved", "printed"])
    .order("approved_at", { ascending: false });

  // Marketing hanya melihat PO miliknya sendiri.
  if (currentUser && currentUser.role === "marketing") {
    query = query.eq("created_by", currentUser.id);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Gagal mengambil PO Approved:", error);
    throw new Error("Gagal mengambil PO Approved: " + error.message);
  }

  approvedPOs = data || [];

  const customers = [
    ...new Set(
      approvedPOs
        .map(po => po.customer_name)
        .filter(Boolean)
    )
  ].sort((a, b) => a.localeCompare(b));

  customerSelect.innerHTML =
    '<option value="">Pilih customer dari PO Approved</option>' +
    customers.map(customer => `
      <option value="${escapeHtml(customer)}">
        ${escapeHtml(customer)}
      </option>
    `).join("");

  updatePOOptions();

  console.log("PO Approved berhasil dimuat:", approvedPOs);
}


function updatePOOptions() {
  const customer = customerSelect.value;

  const availablePOs = approvedPOs.filter((po) => {
    const alreadySelected = selectedPOs.some(
      (item) => item.id === po.id
    );

    return po.customer_name === customer && !alreadySelected;
  });

  poSelect.innerHTML =
    '<option value="">Pilih PO</option>' +
    availablePOs.map((po) => `
      <option value="${po.id}">
        ${escapeHtml(po.po_number)} — ${escapeHtml(po.apparel_type || "-")}
      </option>
    `).join("");

  poSelect.disabled = !customer || availablePOs.length === 0;

  if (customer && availablePOs.length === 0) {
    poSelect.innerHTML =
      '<option value="">Tidak ada PO tersedia untuk customer ini</option>';
  }
}

async function getPOItems(poId) {
  const { data, error } = await supabase
    .from("purchase_order_items")
    .select(`
      id,
      purchase_order_id,
      person_name,
      size,
      quantity,
      notes,
      jersey_number
    `)
    .eq("purchase_order_id", poId);

  if (error) throw error;

  return data || [];
}

async function loadNotaForEdit() {
  if (!editingNotaId) return;

  showMessage("Memuat data Nota untuk diedit...", "info");

  // Ambil header Nota
  const { data: nota, error: notaError } = await supabase
    .from("notas")
    .select("*")
    .eq("id", editingNotaId)
    .single();

  if (notaError) throw notaError;

  originalNotaNumber = nota.nota_number;

  // Ambil PO yang terhubung dengan Nota
  const { data: relations, error: relationError } = await supabase
    .from("nota_purchase_orders")
    .select("purchase_order_id")
    .eq("nota_id", editingNotaId);

  if (relationError) throw relationError;

  originalPOIds = (relations || []).map(
    item => item.purchase_order_id
  );

  if (!originalPOIds.length) {
    throw new Error("Nota ini belum memiliki PO.");
  }

  // Ambil data PO
  const { data: purchaseOrders, error: poError } = await supabase
    .from("purchase_orders")
    .select(`
      id,
      po_number,
      customer_name,
      order_date,
      deadline,
      apparel_type,
      status,
      created_by,
      approved_at
    `)
    .in("id", originalPOIds);

  if (poError) throw poError;

  // Ambil snapshot harga
  const { data: details, error: detailError } = await supabase
    .from("nota_po_details")
    .select("*")
    .in("purchase_order_id", originalPOIds);

  if (detailError) throw detailError;

  // Isi informasi Nota
  notaDate.value = nota.nota_date || todayLocal();
  notaNotes.value = nota.notes || "";

  if (![...customerSelect.options].some(
    option => option.value === nota.customer_name
  )) {
    customerSelect.add(
      new Option(nota.customer_name, nota.customer_name)
    );
  }

  customerSelect.value = nota.customer_name;

  const detailMap = new Map(
    (details || []).map(detail => [
      detail.purchase_order_id,
      detail
    ])
  );

  selectedPOs = await Promise.all(
    (purchaseOrders || []).map(async po => ({
      ...po,
      items: await getPOItems(po.id),
      savedDetail: detailMap.get(po.id)
    }))
  );

  // Tampilkan kembali kartu PO
  renderSelectedPOs();

  // Pulihkan pengaturan harga sebelumnya
  selectedPOs.forEach(po => {
    const detail = po.savedDetail;
    const card = getPOCard(po.id);

    if (!detail || !card) return;

    card.querySelector(".price-category").value =
      detail.price_category || "AGEN";

    card.querySelector(".price-grade").value =
      detail.grade || "A";

    updateJenisPesananOptions(card);

    card.querySelector(".jenis-pesanan").value =
      detail.jenis_pesanan || "";

    (detail.extras || []).forEach(extra => {
      const checkbox = [
        ...card.querySelectorAll(".extra-checkbox")
      ].find(item => item.value === extra.kode_tambahan);

      if (!checkbox) return;

      checkbox.checked = true;

      const methodSelect = checkbox
        .closest(".extra-option")
        .querySelector(".extra-method");

      if (methodSelect) {
        methodSelect.value = extra.metode_hitung || "";

        const master = hargaTambahan.find(
          item => item.kode_tambahan === checkbox.value
        );

        const fixedMethod = normalize(master?.metode_hitung);

        methodSelect.hidden = [
          "PER_PCS",
          "PER_PESANAN"
        ].includes(fixedMethod);

        methodSelect.required = !methodSelect.hidden;
      }
    });
  });

  updateCalculations();
  updatePOOptions();

  showMessage(
    `Mode edit Nota ${nota.nota_number}`,
    "info"
  );
}


function findBasePrice(category, grade, jenisPesanan) {
  return hargaDasar.find((item) => {
    return (
      normalize(item.kategori_harga) === normalize(category) &&
      normalize(item.grade) === normalize(grade) &&
      normalize(item.jenis_pesanan) === normalize(jenisPesanan) &&
      normalize(item.aktif) === "YA"
    );
  });
}

function toAmount(value) {
  if (typeof value === "number") return value;

  return Number(
    String(value ?? "").replace(/[^\d-]/g, "")
  ) || 0;
}

function getSizeExtraMaster(size) {
  const normalizedSize = normalize(size);

  return hargaTambahan.find(item =>
    normalize(item.kategori) === "SIZE" &&
    normalize(item.nama_tambahan) === normalizedSize &&
    normalize(item.aktif) === "YA"
  );
}

function getSizeBreakdown(items = []) {
  const sizeMap = new Map();

  items.forEach(item => {
    const master = getSizeExtraMaster(item.size);

    if (!master) return;

    const key = master.kode_tambahan;
    const quantity = Number(item.quantity || 0);

    if (!sizeMap.has(key)) {
      sizeMap.set(key, {
        kode_tambahan: master.kode_tambahan,
        kategori: "SIZE",
        nama_tambahan: master.nama_tambahan,
        harga_tambahan: toAmount(master.harga_tambahan),
        metode_hitung: "PER_PCS",
        quantity: 0
      });
    }

    sizeMap.get(key).quantity += quantity;
  });

  return [...sizeMap.values()].map(item => ({
    ...item,
    total: item.quantity * item.harga_tambahan
  }));
}

function getEligiblePromos(category, grade, jenisPesanan, totalQty) {
  const today = todayLocal();

  return daftarPromo.filter(promo => {
    const aktif = normalize(promo.aktif) === "YA";
    const minimalQty = Number(promo.minimal_qty);

    // Promo harus memiliki minimal_qty yang valid.
    if (!aktif || !Number.isFinite(minimalQty) || minimalQty <= 0) {
      return false;
    }

    if (totalQty < minimalQty) return false;

    if (
      promo.kategori_harga &&
      normalize(promo.kategori_harga) !== normalize(category)
    ) return false;

    if (
      promo.jenis_pesanan &&
      normalize(promo.jenis_pesanan) !== normalize(jenisPesanan)
    ) return false;

    if (
      promo.grade &&
      normalize(promo.grade) !== "SEMUA" &&
      normalize(promo.grade) !== normalize(grade)
    ) return false;

    if (promo.tanggal_mulai && today < String(promo.tanggal_mulai).slice(0, 10)) {
      return false;
    }

    if (promo.tanggal_selesai && today > String(promo.tanggal_selesai).slice(0, 10)) {
      return false;
    }

    return true;
  });
}


function updatePromoOptions(card, preferredCode = null) {
  const category = card.querySelector(".price-category").value;
  const grade = card.querySelector(".price-grade").value;
  const jenis = card.querySelector(".jenis-pesanan").value;

  const poId = card.dataset.poId;
  const po = selectedPOs.find(item => item.id === poId);

  const totalQty = (po?.items || []).reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  );

  const select = card.querySelector(".promo-select");
  const previousValue = preferredCode || select.value;

  const promos = getEligiblePromos(
    category,
    grade,
    jenis,
    totalQty
  );

  select.innerHTML = `
    <option value="">Tanpa Promo</option>
    ${promos.map(promo => `
      <option value="${escapeHtml(promo.kode_promo)}">
        ${escapeHtml(promo.nama_promo)}
      </option>
    `).join("")}
  `;

  if (promos.some(promo => promo.kode_promo === previousValue)) {
    select.value = previousValue;
  }

  const selected = promos.find(
    promo => promo.kode_promo === select.value
  );

  const info = card.querySelector(".promo-info");

  if (!selected) {
    info.textContent = promos.length
      ? "Pilih promo yang ingin digunakan."
      : "Tidak ada promo yang memenuhi syarat untuk PO ini.";
  } else {
    info.textContent =
      `Minimal ${selected.minimal_qty} PCS · Diskon ${rupiah(selected.diskon_per_pcs)} / PCS`;
  }
}


function getPOCard(poId) {
  return selectedPOList.querySelector(
    `.po-card[data-po-id="${poId}"]`
  );
}


function getPOCalculation(poId) {
  const card = getPOCard(poId);

  if (!card) return null;

  const category = card.querySelector(".price-category").value;
  const grade = card.querySelector(".price-grade").value;

  const jenisPesanan =
    card.querySelector(".jenis-pesanan")?.value || "";

  const po = selectedPOs.find(item => item.id === poId);

  if (!po) return null;

  const base = findBasePrice(
    category,
    grade,
    jenisPesanan
  );

  const items = po.items || [];

  const totalQty = items.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  );

  // Biaya tambahan manual, selain SIZE
  const selectedExtras = [
    ...card.querySelectorAll(".extra-checkbox:checked")
  ].map(checkbox => {
    const row = checkbox.closest(".extra-option");
    const methodSelect = row.querySelector(".extra-method");

    const master = hargaTambahan.find(
      item => item.kode_tambahan === checkbox.value
    );

    return {
      ...master,
      metode_hitung:
        methodSelect?.value || master?.metode_hitung
    };
  }).filter(extra =>
    normalize(extra.kategori) !== "SIZE"
  );

  // Rincian tambahan size otomatis
  const sizeBreakdown = getSizeBreakdown(items);

  // Gabungkan biaya tambahan manual dan size otomatis
  const extras = [
    ...selectedExtras,
    ...sizeBreakdown
  ];

  let perPieceExtra = 0;
  let perOrderExtra = 0;

  selectedExtras.forEach(extra => {
    const amount = toAmount(extra.harga_tambahan);

    if (normalize(extra.metode_hitung) === "PER_PCS") {
      perPieceExtra += amount;
    } else if (
      normalize(extra.metode_hitung) === "PER_PESANAN"
    ) {
      perOrderExtra += amount;
    }
  });

  // Snapshot setiap item PO
  const itemSnapshots = items.map(item => {
    const sizeMaster = getSizeExtraMaster(item.size);

    const sizeExtra = sizeMaster
      ? toAmount(sizeMaster.harga_tambahan)
      : 0;

    const quantity = Number(item.quantity || 0);

    const unitPrice =
      toAmount(base?.harga_dasar) +
      perPieceExtra +
      sizeExtra;

    return {
      purchase_order_item_id: item.id,
      person_name: item.person_name,
      jersey_number: item.jersey_number,
      size: item.size,
      quantity,
      notes: item.notes,

      base_price: toAmount(base?.harga_dasar),
      per_piece_extra: perPieceExtra,

      size_extra: sizeExtra,
      size_extra_code: sizeMaster?.kode_tambahan || null,
      size_extra_name: sizeMaster?.nama_tambahan || null,

      unit_price: unitPrice,
      total: unitPrice * quantity
    };
  });

  const itemTotal = itemSnapshots.reduce(
    (sum, item) => sum + item.total,
    0
  );

  const subtotalBeforePromo =
    itemTotal + perOrderExtra;

  // Perhitungan promo
  const promoCode =
    card.querySelector(".promo-select")?.value || "";

  const selectedPromo = getEligiblePromos(
    category,
    grade,
    jenisPesanan,
    totalQty
  ).find(promo => promo.kode_promo === promoCode);

  const promoDiscountPerPcs = selectedPromo
    ? toAmount(selectedPromo.diskon_per_pcs)
    : 0;

  const promoTotalDiscount =
    promoDiscountPerPcs * totalQty;

  const subtotal = Math.max(
    0,
    subtotalBeforePromo - promoTotalDiscount
  );

  return {
    category,
    grade,
    jenisPesanan,
    base,

    extras,
    sizeBreakdown,

    totalQty,
    itemSnapshots,

    perPieceExtra,
    perOrderExtra,

    subtotalBeforePromo,

    promo: selectedPromo || null,
    promoDiscountPerPcs,
    promoTotalDiscount,

    subtotal
  };
}


function updateJenisPesananOptions(card) {
  console.table(
  hargaDasar.map((item) => ({
    kategori_harga: item.kategori_harga,
    grade: item.grade,
    jenis_pesanan: item.jenis_pesanan,
    aktif: item.aktif
  }))
);
  const category = card.querySelector(".price-category").value;
  const grade = card.querySelector(".price-grade").value;
  const select = card.querySelector(".jenis-pesanan");
  console.log("CEK DROPDOWN JENIS PESANAN:", {
  category,
  grade,
  jumlahDataHarga: hargaDasar.length,
  contohData: hargaDasar.slice(0, 5)
});

  const jenisPesananList = [
    ...new Set(
      hargaDasar
        .filter((item) =>
          normalize(item.kategori_harga) === normalize(category) &&
          normalize(item.grade) === normalize(grade) &&
          normalize(item.aktif) === "YA"
        )
        .map((item) => item.jenis_pesanan)
        .filter(Boolean)
    )
  ];

  console.log("HASIL FILTER JENIS PESANAN:", jenisPesananList);

  select.innerHTML = `
    <option value="">Pilih jenis pesanan</option>
    ${jenisPesananList.map((jenis) => `
      <option value="${escapeHtml(jenis)}">
        ${escapeHtml(jenis)}
      </option>
    `).join("")}
  `;
}


function renderPOCard(po) {
  const extraOptions = hargaTambahan
  .filter(extra => normalize(extra.kategori) !== "SIZE")
  .map((extra) => {
  const method = normalize(extra.metode_hitung);
  const requiresMethod = !["PER_PCS", "PER_PESANAN"].includes(method);

    return `
      <label class="extra-option">
        <input
          type="checkbox"
          class="extra-checkbox"
          value="${escapeHtml(extra.kode_tambahan)}"
        >
        <span>
          ${escapeHtml(extra.nama_tambahan)}
          (${rupiah(extra.harga_tambahan)})
        </span>
        <select
          class="extra-method"
          ${requiresMethod ? "" : "hidden"}
          ${requiresMethod ? "required" : ""}
        >
          <option value="">Pilih metode</option>
          <option value="PER_PCS">Per pcs</option>
          <option value="PER_PESANAN">Per pesanan</option>
        </select>
      </label>
    `;
  }).join("");

  const itemRows = (po.items || []).map((item) => `
    <tr>
      <td>${escapeHtml(item.person_name || "-")}</td>
      <td>${escapeHtml(item.jersey_number || "-")}</td>
      <td>${escapeHtml(item.size || "-")}</td>
      <td>${Number(item.quantity || 0)}</td>
    </tr>
  `).join("");

  const card = document.createElement("article");
  card.className = "po-card";
  card.dataset.poId = po.id;

  card.innerHTML = `
    <div class="po-card-header">
      <div>
        <strong>${escapeHtml(po.po_number)}</strong>
        <div class="po-card-meta">
          <span>Jenis: <strong>${escapeHtml(po.apparel_type || "-")}</strong></span>
          <span>Customer: <strong>${escapeHtml(po.customer_name || "-")}</strong></span>
        </div>
      </div>
      <button type="button" class="po-remove-btn">Hapus PO</button>
    </div>

    <div class="po-card-body">
      <div class="po-items-table-wrap">
        <table class="po-items-table">
          <thead>
            <tr>
              <th>Nama</th>
              <th>No. Punggung</th>
              <th>Size</th>
              <th>Qty</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows || '<tr><td colspan="4">Tidak ada item PO.</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="po-pricing">
        <h3>Pengaturan Harga</h3>

        <div class="po-pricing-grid">
          <div class="form-group">
            <label>Kategori Harga</label>
            <select class="price-category">
              <option value="AGEN">AGEN</option>
              <option value="USER">USER</option>
            </select>
          </div>

          <div class="form-group">
            <label>Grade</label>
            <select class="price-grade">
              <option value="A">Grade A</option>
              <option value="B">Grade B</option>
            </select>
          </div>

          <div class="form-group">
            <label>Jenis Pesanan</label>
            <select class="jenis-pesanan">
              <option value="">Pilih jenis pesanan</option>
            </select>
          </div>

          <div class="form-group">
            <label>Harga Dasar</label>
            <input class="base-price-display" readonly value="Pilih harga">
          </div>
        </div>

        <div class="po-extras">
          <h4>Biaya Tambahan</h4>
          ${extraOptions || "<p>Belum ada data biaya tambahan.</p>"}
        </div>

        <div class="size-extra-summary">
          <h4>Tambahan Harga Size Otomatis</h4>
          <div class="size-extra-list">
            <small>Harga tambahan size akan dihitung otomatis dari PO.</small>
          </div>
        </div>

        <div class="po-promo">
          <h4>Promo / Diskon</h4>

          <select class="promo-select">
            <option value="">Tanpa Promo</option>
          </select>

          <small class="promo-info">
            Pilih promo yang memenuhi syarat.
          </small>

          <div class="po-card-meta">
            <span>Total Diskon: <strong class="promo-total-discount">Rp0</strong></span>
          </div>
        </div>

        <div class="po-card-meta">
          <span>Total Qty: <strong class="po-qty">0</strong></span>
          <span>Total PO: <strong class="po-total">Rp0</strong></span>
        </div>
      </div>
    </div>
  `;

  card.querySelector(".po-remove-btn").addEventListener("click", () => {
    selectedPOs = selectedPOs.filter((item) => item.id !== po.id);
    renderSelectedPOs();
    updatePOOptions();
  });

  updateJenisPesananOptions(card);

  updatePromoOptions(card);

card.querySelectorAll(
  ".price-category, .price-grade, .jenis-pesanan, .extra-checkbox, .extra-method, .promo-select"
).forEach((control) => {
  control.addEventListener("change", () => {
    const row = control.closest(".extra-option");

    if (
  control.classList.contains("price-category") ||
  control.classList.contains("price-grade")
    ) {
      updateJenisPesananOptions(card);
    }

    if (
      control.classList.contains("price-category") ||
      control.classList.contains("price-grade") ||
      control.classList.contains("jenis-pesanan")
    ) {
      updatePromoOptions(card);
    }

    if (control.classList.contains("extra-checkbox") && row) {
      const methodSelect = row.querySelector(".extra-method");

      if (methodSelect) {
        const master = hargaTambahan.find(
          (item) => item.kode_tambahan === control.value
        );

        const fixedMethod = normalize(master?.metode_hitung);

        methodSelect.hidden = !control.checked ||
          ["PER_PCS", "PER_PESANAN"].includes(fixedMethod);

        methodSelect.required = control.checked &&
          !["PER_PCS", "PER_PESANAN"].includes(fixedMethod);
      }
    }

    updateCalculations();
  });
});

  return card;
}

function renderSelectedPOs() {
  selectedPOList.innerHTML = "";

  if (selectedPOs.length === 0) {
    selectedPOList.innerHTML =
      '<div class="empty-state">Belum ada PO yang dipilih.</div>';
    updateCalculations();
    return;
  }

  selectedPOs.forEach((po) => {
    selectedPOList.appendChild(renderPOCard(po));
  });

  updateCalculations();
}

function updateCalculations() {
  let grandTotal = 0;
  let grandQty = 0;

  selectedPOs.forEach((po) => {
    const card = getPOCard(po.id);
    const calculation = getPOCalculation(po.id);

    if (!card || !calculation) return;

    const baseDisplay = card.querySelector(".base-price-display");

    baseDisplay.value = calculation.base
      ? rupiah(calculation.base.harga_dasar)
      : "Harga tidak ditemukan";

    card.querySelector(".po-qty").textContent =
      calculation.totalQty;

    card.querySelector(".po-total").textContent =
      rupiah(calculation.subtotal);

    card.querySelector(".promo-total-discount").textContent =
    rupiah(calculation.promoTotalDiscount);

    const sizeList = card.querySelector(".size-extra-list");

    if (sizeList) {
      sizeList.innerHTML = calculation.sizeBreakdown.length
        ? calculation.sizeBreakdown.map(item => `
            <div class="size-extra-row">
              <span>
                ${escapeHtml(item.nama_tambahan)}
                = ${item.quantity} pcs × ${rupiah(item.harga_tambahan)}
              </span>
              <strong>${rupiah(item.total)}</strong>
            </div>
          `).join("")
        : "<small>Tidak ada tambahan harga size.</small>";
    }

    grandTotal += calculation.subtotal;
    grandQty += calculation.totalQty;
  });

  $("#summaryPOCount").textContent = selectedPOs.length;
  $("#summaryQty").textContent = grandQty;
  $("#summaryTotal").textContent = rupiah(grandTotal);
}

// Menambahkan PO ke Nota
async function addSelectedPO() {
  hideMessage();

  const poId = poSelect.value;
  if (!poId) return;

  if (selectedPOs.some((po) => po.id === poId)) {
    showMessage("PO tersebut sudah dipilih.", "error");
    return;
  }

  const po = approvedPOs.find((item) => item.id === poId);
  if (!po) return;

  try {
    const items = await getPOItems(poId);

    selectedPOs.push({
      ...po,
      items
    });

    renderSelectedPOs();
    updatePOOptions();
  } catch (error) {
    console.error(error);
    showMessage("Gagal mengambil item PO: " + error.message, "error");
  }
}

// Validasi sebelum simpan
function validateNota() {
  if (!notaDate.value) {
    throw new Error("Tanggal Nota wajib diisi.");
  }

  if (!customerSelect.value) {
    throw new Error("Silakan pilih customer.");
  }

  if (selectedPOs.length === 0) {
    throw new Error("Pilih minimal satu PO.");
  }

  for (const po of selectedPOs) {
    const calculation = getPOCalculation(po.id);

    if (!calculation?.base) {
      throw new Error(
        `Harga dasar untuk PO ${po.po_number} tidak ditemukan. Periksa jenis pesanan, kategori harga, dan grade.`
      );
    }

    if (calculation.itemSnapshots.length === 0) {
      throw new Error(`PO ${po.po_number} tidak memiliki item.`);
    }

    const card = getPOCard(po.id);
    const checkedExtras = card.querySelectorAll(".extra-checkbox:checked");

    for (const checkbox of checkedExtras) {
      const row = checkbox.closest(".extra-option");
      const methodSelect = row.querySelector(".extra-method");

      if (methodSelect && !methodSelect.hidden && !methodSelect.value) {
        throw new Error(
          `Pilih metode hitung untuk biaya tambahan pada PO ${po.po_number}.`
        );
      }
    }
  }
}


async function saveNota() {
  hideMessage();

  try {
    validateNota();
  } catch (error) {
    showMessage(error.message, "error");
    return;
  }

  saveNotaBtn.disabled = true;
  saveNotaBtn.textContent = "Menyimpan...";

  let notaId = editingNotaId || null;

  try {
    const calculations = selectedPOs.map(po => ({
      po,
      calculation: getPOCalculation(po.id)
    }));

    const totalAmount = calculations.reduce(
      (sum, item) => sum + item.calculation.subtotal,
      0
    );

    let notaNumber = originalNotaNumber;

    const notaData = {
      customer_name: customerSelect.value,
      nota_date: notaDate.value,
      notes: notaNotes.value.trim() || null,
      updated_by: currentUser.id,
      total_amount: totalAmount
    };

    if (editingNotaId) {
      // UPDATE Nota lama
      const { error } = await supabase
        .from("notas")
        .update(notaData)
        .eq("id", editingNotaId);

      if (error) throw error;

    } else {
      // INSERT Nota baru
      notaNumber = generateNotaNumber();

      const { data: nota, error } = await supabase
        .from("notas")
        .insert({
          ...notaData,
          nota_number: notaNumber,
          created_by: currentUser.id
        })
        .select("id")
        .single();

      if (error) throw error;

      notaId = nota.id;
    }

    // Ambil relasi PO yang sudah tersimpan
    const { data: existingRelations, error: existingError } =
      await supabase
        .from("nota_purchase_orders")
        .select("purchase_order_id")
        .eq("nota_id", notaId);

    if (existingError) throw existingError;

    const existingIds = (existingRelations || []).map(
      item => item.purchase_order_id
    );

    const selectedIds = calculations.map(
          item => item.po.id
        );

    console.log("MODE EDIT:", !!editingNotaId);
    console.log("EDITING NOTA ID:", editingNotaId);
    console.log("NOTA ID UNTUK SIMPAN:", notaId);
    console.log("EXISTING RELATIONS:", existingRelations);
    console.log("EXISTING IDS:", existingIds);
    console.log("SELECTED IDS:", selectedIds);
 
    // PO yang dihapus dari Nota
    const removedIds = existingIds.filter(
      id => !selectedIds.includes(id)
    );

    if (removedIds.length) {
      const { error } = await supabase
        .from("nota_purchase_orders")
        .delete()
        .eq("nota_id", notaId)
        .in("purchase_order_id", removedIds);

      if (error) throw error;
    }

    // Hanya masukkan relasi PO yang benar-benar baru
    const newRelations = selectedIds
      .filter(id => !existingIds.includes(id))
      .map(id => ({
        nota_id: notaId,
        purchase_order_id: id
      }));

    if (newRelations.length) {
      const { error } = await supabase
        .from("nota_purchase_orders")
        .insert(newRelations);

      if (error) throw error;
    }

    // Siapkan snapshot rincian harga
    const detailRows = calculations.map(({ po, calculation }) => ({
      purchase_order_id: po.id,
      price_category: calculation.category,
      grade: calculation.grade,
      jenis_pesanan: calculation.jenisPesanan,
      base_price: Number(calculation.base.harga_dasar),
      extras: calculation.extras.map(extra => ({
        kode_tambahan: extra.kode_tambahan,
        kategori: extra.kategori,
        nama_tambahan: extra.nama_tambahan,
        harga_tambahan: toAmount(extra.harga_tambahan),
        metode_hitung: extra.metode_hitung,

        quantity: Number(extra.quantity || 0),
        total: Number(extra.total || 0)
      })),
      items_snapshot: calculation.itemSnapshots,
      subtotal: calculation.subtotal,

      promo_code: calculation.promo?.kode_promo || null,
      promo_name: calculation.promo?.nama_promo || null,
      promo_minimal_qty: Number(calculation.promo?.minimal_qty || 0),
      promo_discount_per_pcs: calculation.promoDiscountPerPcs,
      promo_total_discount: calculation.promoTotalDiscount,

      updated_at: new Date().toISOString()
    }));

    // UPSERT: perbarui snapshot lama atau buat snapshot baru
    const { error: detailError } = await supabase
      .from("nota_po_details")
      .upsert(detailRows, {
        onConflict: "purchase_order_id"
      });

    if (detailError) throw detailError;

    showMessage(
      `Nota ${notaNumber} berhasil ${editingNotaId ? "diperbarui" : "disimpan"}. Total ${rupiah(totalAmount)}.`,
      "success"
    );

    saveNotaBtn.textContent = "Berhasil Disimpan";

    setTimeout(() => {
      window.location.href = "nota.html";
    }, 1200);

  } catch (error) {
    console.error("Gagal menyimpan Nota:", error);

    showMessage(
      "Gagal menyimpan Nota: " + error.message +
      " Periksa data Nota di Supabase sebelum mencoba kembali.",
      "error"
    );

    saveNotaBtn.disabled = false;
    saveNotaBtn.textContent = editingNotaId
      ? "Perbarui Nota"
      : "Simpan Nota";
  }
}


// Inisialisasi halaman
async function init() {
  try {
    const { user, profile } = await requireUser();

    currentUser = {
      ...user,
      role: profile.role
    };

    if (!["marketing", "admin_po", "admin"].includes(profile.role)) {
      window.location.href = "nota.html";
      return;
    }

    notaDate.value = todayLocal();
    $("#notaNumber").value = "Dibuat otomatis saat disimpan";

    showMessage("Memuat data PO dan database harga...", "info");

    const [priceData] = await Promise.all([
      loadPriceMaster(),
      loadApprovedPOs()
    ]);

    hargaDasar = priceData.harga_dasar || [];
    hargaTambahan = priceData.harga_tambahan || [];
    daftarPromo = priceData.promo || [];

    console.log("DATA PROMO:", daftarPromo);
    console.table(daftarPromo);

    window.debugPromoNota = () => {
  console.log("DATA PROMO:", daftarPromo);

  console.table(daftarPromo.map(promo => ({
    kode: promo.kode_promo,
    nama: promo.nama_promo,
    kategori: promo.kategori_harga,
    grade: promo.grade,
    minimal_qty: promo.minimal_qty,
    diskon: promo.diskon_per_pcs,
    aktif: promo.aktif
  })));

  console.table(selectedPOs.map(po => ({
    po: po.po_number,
    qty: (po.items || []).reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    )
  })));
};

    if (editingNotaId) {
      saveNotaBtn.textContent = "Perbarui Nota";
      await loadNotaForEdit();
    }

    console.log("JUMLAH HARGA DASAR:", hargaDasar.length);
    console.log("DATA HARGA PERTAMA:", hargaDasar[0]);
    console.log("SEMUA KOLOM HARGA:", Object.keys(hargaDasar[0] || {}));
    console.log("DATA HARGA TAMBAHAN:", hargaTambahan.length);

    hideMessage();

  } catch (error) {
    console.error(error);
    showMessage(
      "Gagal memuat Form Nota: " + error.message,
      "error"
    );
  }
}

customerSelect.addEventListener("change", () => {
  selectedPOs = [];
  renderSelectedPOs();
  updatePOOptions();
});

poSelect.addEventListener("change", addSelectedPO);

$("#loadPOBtn").addEventListener("click", addSelectedPO);

saveNotaBtn.addEventListener("click", saveNota);

init();
