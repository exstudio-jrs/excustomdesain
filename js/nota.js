
import { supabase } from "./config.js";
import { requireUser, escapeHtml } from "./common.js";

// =====================================
// LOGIN DAN ROLE
// =====================================

const context = await requireUser();

if (!context) {
  throw new Error("User belum login.");
}

const { profile } = context;

const isAdmin = profile.role === "admin";
const isAdminPO = profile.role === "admin_po";
const isMarketing = profile.role === "marketing";

if (!isAdmin && !isAdminPO && !isMarketing) {
  location.replace("dashboard.html");
  throw new Error("Akses halaman Nota ditolak.");
}

// =====================================
// ELEMENT
// =====================================

const notaList = document.querySelector("#notaList");
const notaMessage = document.querySelector("#notaMessage");
const refreshNota = document.querySelector("#refreshNota");
const searchNota = document.querySelector("#searchNota");
const createNota = document.querySelector("#createNota");

const yearFilter = document.querySelector("#yearFilter");
const monthFilter = document.querySelector("#monthFilter");
const monthlySummary = document.querySelector("#monthlySummary");

const statYearTotal = document.querySelector("#statYearTotal");
const statYearAmount = document.querySelector("#statYearAmount");
const statYearLabel = document.querySelector("#statYearLabel");

const statMonthTotal = document.querySelector("#statMonthTotal");
const statMonthPO = document.querySelector("#statMonthPO");
const statMonthAmount = document.querySelector("#statMonthAmount");
const monthlyTitle = document.querySelector("#monthlyTitle");

let allNota = [];
let poCounts = {};

// =====================================
// ROLE TAMPILAN
// =====================================

if (createNota) {
  createNota.hidden = !isMarketing && !isAdminPO && !isAdmin;
}

// =====================================
// DATA BULAN
// =====================================

const monthNames = [
  "Januari", "Februari", "Maret", "April",
  "Mei", "Juni", "Juli", "Agustus",
  "September", "Oktober", "November", "Desember"
];

const now = new Date();

yearFilter.value = String(now.getFullYear());
monthFilter.value = String(now.getMonth() + 1);

// =====================================
// FORMAT
// =====================================

function formatRupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return "-";

  const [year, month, day] = value.split("-").map(Number);

  return new Date(year, month - 1, day).toLocaleDateString(
    "id-ID",
    {
      day: "2-digit",
      month: "long",
      year: "numeric"
    }
  );
}

function getYear(value) {
  return Number(String(value || "").slice(0, 4));
}

function getMonth(value) {
  return Number(String(value || "").slice(5, 7));
}

// =====================================
// LOAD DATA NOTA
// =====================================

async function loadNota() {
  notaList.innerHTML = `
    <tr>
      <td colspan="7" class="nota-empty">Memuat data Nota...</td>
    </tr>
  `;

  notaMessage.textContent = "";

  try {
    const { data: notas, error } = await supabase
      .from("notas")
      .select(`
        id,
        nota_number,
        customer_name,
        nota_date,
        total_amount,
        shipping_cost,
        created_at
      `)
      .order("nota_date", { ascending: false });

    if (error) throw error;

    allNota = notas || [];

    const notaIds = allNota.map(nota => nota.id);

    poCounts = {};

    if (notaIds.length) {
      const { data: links, error: linkError } = await supabase
        .from("nota_purchase_orders")
        .select("nota_id")
        .in("nota_id", notaIds);

      if (linkError) throw linkError;

      (links || []).forEach(link => {
        poCounts[link.nota_id] =
          (poCounts[link.nota_id] || 0) + 1;
      });
    }

    setupYearFilter();
    renderReports();

  } catch (error) {
    console.error("Gagal memuat Nota:", error);

    notaList.innerHTML = `
      <tr>
        <td colspan="7" class="nota-empty">
          Gagal memuat data Nota:
          ${escapeHtml(error.message)}
        </td>
      </tr>
    `;

    notaMessage.textContent = error.message;
    notaMessage.className = "nota-message-error";
  }
}

// =====================================
// FILTER TAHUN
// =====================================

function setupYearFilter() {
  const years = new Set([
    now.getFullYear(),
    ...allNota
      .map(nota => getYear(nota.nota_date))
      .filter(year => year > 0)
  ]);

  const selectedYear = Number(yearFilter.value) || now.getFullYear();

  yearFilter.innerHTML = [...years]
    .sort((a, b) => b - a)
    .map(year => `
      <option value="${year}">${year}</option>
    `)
    .join("");

  yearFilter.value = String(
    years.has(selectedYear) ? selectedYear : now.getFullYear()
  );
}

// =====================================
// DATA REKAP BULANAN
// =====================================

function getMonthlyData(year, month) {
  const notas = allNota.filter(nota => {
    return (
      getYear(nota.nota_date) === year &&
      getMonth(nota.nota_date) === month
    );
  });

  const totalAmount = notas.reduce(
    (sum, nota) => sum + Number(nota.total_amount || 0),
    0
  );

  const totalPO = notas.reduce(
    (sum, nota) => sum + (poCounts[nota.id] || 0),
    0
  );

  return {
    notas,
    totalNota: notas.length,
    totalPO,
    totalAmount
  };
}

// =====================================
// RENDER SEMUA REKAP
// =====================================

function renderReports() {
  const year = Number(yearFilter.value);
  const month = Number(monthFilter.value);

  const yearlyNotas = allNota.filter(
    nota => getYear(nota.nota_date) === year
  );

  const yearlyAmount = yearlyNotas.reduce(
    (sum, nota) => sum + Number(nota.total_amount || 0),
    0
  );

  statYearTotal.textContent = yearlyNotas.length;
  statYearAmount.textContent = formatRupiah(yearlyAmount);
  statYearLabel.textContent = `Tahun ${year}`;

  renderMonthlySummary(year);
  renderMonthlyDetail(year, month);
}

// =====================================
// RENDER RINGKASAN TAHUNAN
// =====================================

function renderMonthlySummary(year) {
  monthlySummary.innerHTML = monthNames.map((name, index) => {
    const month = index + 1;
    const data = getMonthlyData(year, month);

    return `
      <button
        type="button"
        class="nota-month-card ${
          Number(monthFilter.value) === month ? "active" : ""
        }"
        data-month="${month}"
      >
        <span class="nota-month-name">${name}</span>
        <strong>${data.totalNota} Nota</strong>
        <span class="nota-month-amount">
          ${formatRupiah(data.totalAmount)}
        </span>
      </button>
    `;
  }).join("");
}

// =====================================
// RENDER DETAIL BULANAN
// =====================================

function renderMonthlyDetail(year, month) {
  const data = getMonthlyData(year, month);

  monthlyTitle.textContent =
    `Detail Nota ${monthNames[month - 1]} ${year}`;

  statMonthTotal.textContent = data.totalNota;
  statMonthPO.textContent = data.totalPO;
  statMonthAmount.textContent = formatRupiah(data.totalAmount);

  renderNotaList(data.notas);
}

// =====================================
// RENDER DAFTAR NOTA
// =====================================

function renderNotaList(notas) {
  const keyword = searchNota.value.trim().toLowerCase();

  const filtered = notas.filter(nota => {
    return (
      String(nota.nota_number || "").toLowerCase().includes(keyword) ||
      String(nota.customer_name || "").toLowerCase().includes(keyword)
    );
  });

  if (!filtered.length) {
    notaList.innerHTML = `
      <tr>
        <td colspan="7" class="nota-empty">
          ${keyword
            ? "Nota tidak ditemukan."
            : "Belum ada Nota pada bulan ini."}
        </td>
      </tr>
    `;
    return;
  }

  notaList.innerHTML = filtered.map((nota, index) => `
    <tr>
      <td>${index + 1}</td>

      <td class="nota-number">
        ${escapeHtml(nota.nota_number || "-")}
      </td>

      <td>${formatDate(nota.nota_date)}</td>

      <td class="nota-customer">
        ${escapeHtml(nota.customer_name || "-")}
      </td>

      <td>${poCounts[nota.id] || 0} PO</td>

      <td>
        <strong>${formatRupiah(nota.total_amount)}</strong>
        <br>
        <small style="color:#888;">
          Termasuk ongkir: ${formatRupiah(nota.shipping_cost)}
        </small>
      </td>

      <td>
        <div class="nota-actions">
          <button
            type="button"
            class="btn btn-primary"
            data-preview="${escapeHtml(nota.id)}"
          >DETAIL</button>

          <button
            type="button"
            class="btn btn-ghost"
            data-edit="${escapeHtml(nota.id)}"
          >EDIT</button>

          ${(isAdmin || isAdminPO) ? `
            <button
              type="button"
              class="btn btn-danger"
              data-delete="${escapeHtml(nota.id)}"
            >HAPUS</button>
          ` : ""}
        </div>
      </td>
    </tr>
  `).join("");
}

// =====================================
// DELETE NOTA
// =====================================

async function deleteNota(notaId) {
  if (!(isAdmin || isAdminPO)) {
    alert("Anda tidak memiliki akses menghapus Nota.");
    return;
  }

  const nota = allNota.find(item => item.id === notaId);
  if (!nota) return;

  if (!confirm(
    `Yakin ingin menghapus Nota ${nota.nota_number}?\n\n` +
    "Relasi PO pada Nota ini akan ikut dihapus. Data PO aslinya tetap aman."
  )) return;

  try {
    const { error } = await supabase
      .from("notas")
      .delete()
      .eq("id", notaId);

    if (error) throw error;

    alert("Nota berhasil dihapus.");
    await loadNota();

  } catch (error) {
    console.error("Gagal menghapus Nota:", error);
    alert(error.message || "Gagal menghapus Nota.");
  }
}

// =====================================
// EVENT
// =====================================

yearFilter.addEventListener("change", renderReports);

monthFilter.addEventListener("change", () => {
  searchNota.value = "";
  renderReports();
});

searchNota.addEventListener("input", () => {
  const year = Number(yearFilter.value);
  const month = Number(monthFilter.value);
  renderMonthlyDetail(year, month);
});

if (refreshNota) {
  refreshNota.addEventListener("click", loadNota);
}

monthlySummary.addEventListener("click", event => {
  const button = event.target.closest("[data-month]");
  if (!button) return;

  monthFilter.value = button.dataset.month;
  searchNota.value = "";

  renderReports();
});

notaList.addEventListener("click", event => {
  const previewButton = event.target.closest("[data-preview]");

  if (previewButton) {
    location.href =
      `nota-preview.html?id=${encodeURIComponent(previewButton.dataset.preview)}`;
    return;
  }

  const editButton = event.target.closest("[data-edit]");

  if (editButton) {
    location.href =
      `nota-form.html?id=${encodeURIComponent(editButton.dataset.edit)}`;
    return;
  }

  const deleteButton = event.target.closest("[data-delete]");

  if (deleteButton) {
    deleteNota(deleteButton.dataset.delete);
  }
});

// =====================================
// INIT
// =====================================

loadNota();
