import { supabase } from "./config.js";
import { requireUser, escapeHtml } from "./common.js";

const $ = (selector) => document.querySelector(selector);

const notaDocument = $("#notaDocument");
const previewMessage = $("#previewMessage");
const poContainer = $("#notaPOContainer");

const rupiah = (value) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);

function formatDate(value) {
  if (!value) return "-";

  const [year, month, day] = value.split("-").map(Number);

  return new Date(year, month - 1, day).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

function showError(message) {
  previewMessage.hidden = false;
  previewMessage.className = "preview-error";
  previewMessage.textContent = message;
  notaDocument.hidden = true;
}

function showLoading() {
  previewMessage.hidden = false;
  previewMessage.className = "form-message";
  previewMessage.textContent = "Memuat data Nota...";
}

function renderExtras(extras = [], items = []) {
  const sizeExtras = extras.filter(extra =>
    normalizeText(extra.kategori) === "SIZE" ||
    String(extra.kode_tambahan || "").startsWith("SIZE_")
  );

  const manualExtras = extras.filter(extra =>
    !sizeExtras.includes(extra)
  );

  // Jika snapshot SIZE lama belum memiliki quantity dan total,
  // hitung berdasarkan items_snapshot.
  const sizeMap = new Map();

  items.forEach(item => {
    const name = item.size_extra_name;

    if (!name || Number(item.size_extra || 0) <= 0) return;

    const key = item.size_extra_code || name;

    if (!sizeMap.has(key)) {
      sizeMap.set(key, {
        nama_tambahan: name,
        harga_tambahan: Number(item.size_extra),
        quantity: 0,
        total: 0
      });
    }

    const entry = sizeMap.get(key);
    entry.quantity += Number(item.quantity || 0);
    entry.total += Number(item.size_extra) * Number(item.quantity || 0);
  });

  const sizeRows = sizeExtras.length
    ? sizeExtras.map(extra => {
        const savedQty = Number(extra.quantity || 0);
        const savedTotal = Number(extra.total || 0);

        const fallback = sizeMap.get(
          extra.kode_tambahan || extra.nama_tambahan
        );

        const quantity = savedQty || fallback?.quantity || 0;
        const amount = Number(extra.harga_tambahan || 0);
        const total = savedTotal || fallback?.total || quantity * amount;

        return `
          <tr>
            <td>${escapeHtml(extra.nama_tambahan || "-")}</td>
            <td class="text-center">
              ${quantity} pcs × ${rupiah(amount)}
            </td>
            <td class="text-right">${rupiah(total)}</td>
          </tr>
        `;
      }).join("")
    : [...sizeMap.values()].map(extra => `
        <tr>
          <td>${escapeHtml(extra.nama_tambahan)}</td>
          <td class="text-center">
            ${extra.quantity} pcs × ${rupiah(extra.harga_tambahan)}
          </td>
          <td class="text-right">${rupiah(extra.total)}</td>
        </tr>
      `).join("");

  const manualRows = manualExtras.map(extra => {
    const amount = Number(extra.harga_tambahan || 0);
    const method = normalizeText(extra.metode_hitung);

    let calculation = "";

    if (method === "PER_PCS") {
      calculation = `Per pcs × ${rupiah(amount)}`;
    } else if (method === "PER_PESANAN") {
      calculation = "Per pesanan";
    } else {
      calculation = rupiah(amount);
    }

    return `
      <tr>
        <td>${escapeHtml(extra.nama_tambahan || "-")}</td>
        <td>${calculation}</td>
        <td class="text-right">
          ${rupiah(extra.total || (
            method === "PER_PESANAN"
              ? amount
              : method === "PER_PCS"
                ? amount * items.reduce(
                    (sum, item) => sum + Number(item.quantity || 0), 0
                  )
                : amount
          ))}
        </td>
      </tr>
    `;
  }).join("");

  if (!sizeRows && !manualRows) {
    return "";
  }

  return `
    <div class="nota-extra-list">
      <h4>Rincian Biaya Tambahan</h4>

      ${sizeRows ? `
        <h5>Tambahan Harga Size Otomatis</h5>
        <table class="nota-summary-table">
          <thead>
            <tr>
              <th>Size</th>
              <th>Perhitungan</th>
              <th class="text-right">Total</th>
            </tr>
          </thead>
          <tbody>${sizeRows}</tbody>
        </table>
      ` : ""}

      ${manualRows ? `
        <h5>Biaya Tambahan Lainnya</h5>
        <table class="nota-summary-table">
          <thead>
            <tr>
              <th>Nama Tambahan</th>
              <th>Perhitungan</th>
              <th class="text-right">Total</th>
            </tr>
          </thead>
          <tbody>${manualRows}</tbody>
        </table>
      ` : ""}
    </div>
  `;
}

function normalizeText(value) {
  return String(value ?? "").trim().toUpperCase();
}

function renderItems(items) {
  if (!items || !items.length) {
    return `
      <tr>
        <td colspan="9" class="text-center">
          Tidak ada rincian item.
        </td>
      </tr>
    `;
  }

  return items.map((item) => `
    <tr>
      <td>${escapeHtml(item.person_name || "-")}</td>
      <td class="text-center">${escapeHtml(item.jersey_number || "-")}</td>
      <td class="text-center">${escapeHtml(item.size || "-")}</td>
      <td class="text-center">${Number(item.quantity || 0)}</td>
      <td class="text-right">${rupiah(item.base_price)}</td>
      <td class="text-right">${rupiah(item.per_piece_extra)}</td>
      <td class="text-right">${rupiah(item.size_extra)}</td>
      <td class="text-right">${rupiah(item.unit_price)}</td>
      <td class="text-right">${rupiah(item.total)}</td>
    </tr>
  `).join("");
}

function renderPO(po, detail) {
  const items = detail?.items_snapshot || [];

  const totalQty = items.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  );

  const subtotal = Number(detail?.subtotal || 0);
  const discount = Number(detail?.promo_total_discount || 0);

  // Subtotal tersimpan sudah dikurangi promo.
  // Tambahkan kembali diskon untuk mendapatkan harga sebelum diskon.
  const totalBeforeDiscount = subtotal + discount;

  return {
  po_number: po.po_number || "-",
  category: detail?.price_category || "-",
  grade: detail?.grade || "-",
  jenis: detail?.jenis_pesanan || "-",
  basePrice: Number(detail?.base_price || 0),
  totalQty,
  totalBeforeDiscount,
  discount,
  totalAfterDiscount: subtotal,

  extrasHtml: renderExtras(
    detail?.extras || [],
    items
  )
};
}

async function loadNotaPreview() {
  showLoading();

  try {
    const context = await requireUser();

    if (!context) {
      throw new Error("Silakan login terlebih dahulu.");
    }

    const { profile } = context;

    if (!["marketing", "admin_po", "admin"].includes(profile.role)) {
      window.location.replace("nota.html");
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const notaId = params.get("id");

    if (!notaId) {
      throw new Error("ID Nota tidak ditemukan pada alamat halaman.");
    }

    // Ambil header Nota
    const { data: nota, error: notaError } = await supabase
      .from("notas")
      .select(`
        id,
        nota_number,
        customer_name,
        nota_date,
        notes,
        total_amount,
        shipping_cost
      `)
      .eq("id", notaId)
      .single();

    if (notaError) throw notaError;

    // Ambil relasi PO pada Nota
    const { data: relations, error: relationError } = await supabase
      .from("nota_purchase_orders")
      .select("purchase_order_id")
      .eq("nota_id", notaId);

    if (relationError) throw relationError;

    const poIds = (relations || []).map(
      (item) => item.purchase_order_id
    );

    if (!poIds.length) {
      throw new Error("Nota ini belum memiliki PO.");
    }

    // Ambil data PO
    const { data: purchaseOrders, error: poError } = await supabase
      .from("purchase_orders")
      .select("id, po_number")
      .in("id", poIds);

    if (poError) throw poError;

    // Ambil snapshot harga dan item
    const { data: details, error: detailError } = await supabase
      .from("nota_po_details")
      .select(`
        purchase_order_id,
        price_category,
        grade,
        jenis_pesanan,
        base_price,
        extras,
        items_snapshot,
        subtotal,
        promo_code,
        promo_name,
        promo_minimal_qty,
        promo_discount_per_pcs,
        promo_total_discount
      `)
      .in("purchase_order_id", poIds);

    if (detailError) throw detailError;

    const poMap = new Map(
      (purchaseOrders || []).map((po) => [po.id, po])
    );

    const detailMap = new Map(
      (details || []).map((detail) => [
        detail.purchase_order_id,
        detail
      ])
    );

    // Tampilkan identitas Nota
    $("#notaNumber").textContent = nota.nota_number || "-";
    $("#notaDate").textContent = formatDate(nota.nota_date);
    $("#notaCustomer").textContent = nota.customer_name || "-";
    $("#notaGrandTotal").textContent = rupiah(nota.total_amount);

    // Tampilkan ringkasan semua PO
const poCalculations = poIds.map((poId) => {
  const po = poMap.get(poId);
  const detail = detailMap.get(poId);

  if (!po || !detail) return null;

  return renderPO(po, detail);
}).filter(Boolean);

// Hitung total keseluruhan
const grandTotalBeforeDiscount = poCalculations.reduce(
  (sum, po) => sum + po.totalBeforeDiscount,
  0
);

const grandTotalDiscount = poCalculations.reduce(
  (sum, po) => sum + po.discount,
  0
);

const grandTotalAfterDiscount =
  grandTotalBeforeDiscount - grandTotalDiscount;

// Ambil ongkir yang tersimpan pada Nota
const shippingCost = Number(nota.shipping_cost || 0);

// Total akhir termasuk ongkir
const finalTotal = grandTotalAfterDiscount + shippingCost;


// Tampilkan total Nota
$("#notaGrandTotal").textContent = rupiah(finalTotal);

// Tampilkan tabel ringkas PO
poContainer.innerHTML = `
  <div class="nota-summary-table-wrap">
    <table class="nota-summary-table">
      <thead>
        <tr>
          <th>Nomor PO</th>
          <th>Kategori</th>
          <th>Grade</th>
          <th>Jenis Pesanan</th>
          <th class="text-right">Harga Dasar</th>
          <th class="text-center">QTY</th>
          <th class="text-right">Total Harga</th>
        </tr>
      </thead>

      <tbody>
        ${poCalculations.map(po => `
          <tr>
            <td>${escapeHtml(po.po_number)}</td>
            <td>${escapeHtml(po.category)}</td>
            <td>${escapeHtml(po.grade)}</td>
            <td>${escapeHtml(po.jenis)}</td>
            <td class="text-right">${rupiah(po.basePrice)}</td>
            <td class="text-center">${po.totalQty}</td>
            <td class="text-right">${rupiah(po.totalBeforeDiscount)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>

    ${poCalculations.map(po => `
      <div class="nota-po-extra-detail">
        <h4>Rincian Tambahan PO ${escapeHtml(po.po_number)}</h4>
        ${po.extrasHtml || "<p>Tidak ada biaya tambahan.</p>"}
      </div>
    `).join("")}
  </div>

  <div class="nota-grand-summary">
    <div class="nota-summary-row">
      <span>Total Harga</span>
      <strong>${rupiah(grandTotalBeforeDiscount)}</strong>
    </div>

    <div class="nota-summary-row nota-discount-row">
      <span>Total Diskon</span>
      <strong>- ${rupiah(grandTotalDiscount)}</strong>
    </div>

    <div class="nota-summary-row">
      <span>Subtotal PO</span>
      <strong>${rupiah(grandTotalAfterDiscount)}</strong>
    </div>

    <div class="nota-summary-row">
      <span>Ongkir</span>
      <strong>${rupiah(shippingCost)}</strong>
    </div>

    <div class="nota-summary-final">
      <span>TOTAL KESELURUHAN</span>
      <strong>${rupiah(finalTotal)}</strong>
    </div>
  </div>
`;


    // Catatan Nota
    if (nota.notes) {
      $("#notaNotesSection").hidden = false;
      $("#notaNotes").textContent = nota.notes;
    } else {
      $("#notaNotesSection").hidden = true;
    }

    $("#userLabel").textContent =
      `${profile.username} · ${profile.role.toUpperCase()}`;

    notaDocument.hidden = false;
    previewMessage.hidden = true;

  } catch (error) {
    console.error("Gagal memuat preview Nota:", error);
    showError("Gagal memuat Nota: " + error.message);
  }
}

$("#printBtn").addEventListener("click", () => {
  window.print();
});

loadNotaPreview();