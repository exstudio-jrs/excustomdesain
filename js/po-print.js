import {
  supabase,
  SUPABASE_URL,
  SUPABASE_ANON_KEY
} from "./config.js";

import {
  requireUser,
  escapeHtml
} from "./common.js";

const context = await requireUser();

if (!context) {
  throw new Error("User belum login.");
}

const { user, profile } = context;

const allowedRoles = ["admin", "admin_po", "marketing"];

if (!allowedRoles.includes(profile.role)) {
  location.replace("dashboard.html");
  throw new Error("Akses ditolak.");
}

const params = new URLSearchParams(location.search);
const poId = params.get("id");

const content = document.querySelector("#printContent");
const poNumber = document.querySelector("#printPONumber");

const safe = (value) =>
  escapeHtml(String(value ?? "-") || "-");

const row = (label, value) => `
  <div class="print-row">
    <strong>${safe(label)}</strong>
    <span>${safe(value || "-")}</span>
  </div>
`;

const section = (title, rows, grid = true) => `
  <section class="print-section">
    <h3>${safe(title)}</h3>
    <div class="${grid ? "print-grid" : ""}">${rows}</div>
  </section>
`;

function dateFormat(value) {
  if (!value) return "-";

  return new Date(`${value}T00:00:00`).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

/* =====================================
   PREVIEW DESAIN
===================================== */

async function loadDesignPreview(designId) {
  const preview = document.querySelector("#designPreview");

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

    // Pilih hasil desain terbaru jika tersedia created_at.
    files.sort((a, b) => {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });

    const designFile = files.find(file => file.drive_file_id);

    if (!designFile) {
      preview.innerHTML = `
        <div class="preview-placeholder">
          File desain tidak memiliki ID Google Drive.
        </div>
      `;
      return;
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
      const errorText = await response.text();

      console.error("Drive Preview Error:", {
        status: response.status,
        statusText: response.statusText,
        response: errorText
      });

      throw new Error(
        `Gagal mengambil preview Google Drive (${response.status}): ${errorText}`
      );
    }
    const blob = await response.blob();
    const imageUrl = URL.createObjectURL(blob);

    preview.innerHTML = `
      <img
        src="${imageUrl}"
        alt="Preview desain approved"
      >
    `;

  } catch (error) {
    console.error("Gagal memuat preview desain:", error);

    preview.innerHTML = `
      <div class="preview-placeholder">
        Preview desain gagal dimuat.<br>
        Periksa akses file atau koneksi Google Drive.
      </div>
    `;
  }
}

/* =====================================
   LOAD DATA PO
===================================== */

async function loadPrintData() {
  if (!poId) {
    content.textContent = "ID PO tidak ditemukan.";
    return;
  }

  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select("*")
    .eq("id", poId)
    .single();

  if (error || !po) {
    content.textContent = "Data PO tidak ditemukan atau akses ditolak.";
    return;
  }

  if (
    profile.role === "marketing" &&
    po.created_by !== user.id
  ) {
    content.textContent = "Anda tidak memiliki akses ke PO ini.";
    return;
  }

  const { data: items, error: itemError } = await supabase
    .from("purchase_order_items")
    .select("*")
    .eq("purchase_order_id", poId)
    .order("created_at", { ascending: true });

  if (itemError) {
    content.textContent = "Gagal memuat daftar item PO.";
    return;
  }

  const shirt = po.shirt_spec || {};
  const pants = po.pants_spec || {};
  const shipping = po.shipping_info || {};

  poNumber.textContent = po.po_number || "-";
  document.title = `PO ${po.po_number || ""} - EXSTUDIO`;

  const total = (items || []).reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  );

  content.innerHTML = `
    <div class="print-layout">

      <!-- KOLOM KIRI -->
<div class="print-column">

  <section class="print-section">
    <h3>Preview Desain Approved</h3>

    <div class="design-preview" id="designPreview">
      <div class="preview-placeholder">
        Memuat preview desain...
      </div>
    </div>
  </section>

  ${section("Informasi Pengiriman", `
    ${row("Nama Penerima", shipping.receiver_name)}
    ${row("Nomor Telepon", shipping.phone)}
    ${row("Alamat", shipping.address)}
  `, false)}

</div>

<!-- KOLOM KANAN -->
<div class="print-column">

  ${section("Informasi Pesanan", `
    ${row("Nomor PO", po.po_number)}
    ${row("Tanggal PO", dateFormat(po.order_date))}
    ${row("Customer", po.customer_name)}
    ${row("Deadline", dateFormat(po.deadline))}
    ${row("Genre", po.apparel_type)}
    ${row("Bentuk Jahitan", po.wearer_category)}
  `, false)}

  ${section("Spesifikasi Baju", `
    ${row("Model Kerah", shirt.collar)}
    ${row("Bahan", shirt.material)}
    ${row("Model Lengan", shirt.sleeve)}
    ${row("Lis Lengan", shirt.sleeve_trim)}
    ${row("Catatan Baju", shirt.notes)}
  `)}

  ${section("Spesifikasi Celana", `
  ${row("Model Celana", pants.model)}
  ${row("Bahan Celana", pants.material)}
  ${row("Lis Celana", pants.trim)}
  ${row("Catatan Celana", pants.notes)}
  `)}

  <section class="print-section">
    <h3>Daftar Nama dan Ukuran</h3>

    <table class="print-table">
      <thead>
        <tr>
          <th>NO</th>
          <th>SIZE</th>
          <th>NOMOR</th>
          <th>NAMA</th>
          <th>JUMLAH</th>
          <th>CATATAN</th>
        </tr>
      </thead>

      <tbody>
        ${(items || []).map((item, index) => `
          <tr>
            <td>${index + 1}</td>
            <td class="size-cell">${safe(item.size)}</td>
            <td>${safe(item.jersey_number)}</td>
            <td>${safe(item.person_name)}</td>
            <td>${safe(item.quantity)}</td>
            <td>${safe(item.notes)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>

    <p class="print-total">
      TOTAL PESANAN: ${total} PCS
    </p>
  </section>

  <div class="print-note">
    <strong>CATATAN TAMBAHAN</strong>
    <p>${safe(po.notes)}</p>
  </div>

</div>
  `;

  await loadDesignPreview(po.design_id);
}

loadPrintData().catch(error => {
  console.error("Gagal memuat halaman cetak PO:", error);
  content.textContent = error.message || "Gagal memuat data PO.";
});