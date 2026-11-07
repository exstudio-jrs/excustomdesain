import { supabase } from "./config.js";
import { requireUser, escapeHtml } from "./common.js";

const yearFilter = document.querySelector("#yearFilter");
const monthFilter = document.querySelector("#monthFilter");

const yearAmount = document.querySelector("#yearAmount");
const monthAmount = document.querySelector("#monthAmount");
const yearNotaCount = document.querySelector("#yearNotaCount");
const yearPOCount = document.querySelector("#yearPOCount");

const yearLabel = document.querySelector("#yearLabel");
const monthLabel = document.querySelector("#monthLabel");
const chartYearLabel = document.querySelector("#chartYearLabel");

const monthlyChart = document.querySelector("#monthlyChart");
const detailTitle = document.querySelector("#detailTitle");

const monthNotaCount = document.querySelector("#monthNotaCount");
const monthPOCount = document.querySelector("#monthPOCount");
const monthDetailAmount = document.querySelector("#monthDetailAmount");

const reportNotaList = document.querySelector("#reportNotaList");
const reportMessage = document.querySelector("#reportMessage");

const monthNames = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember"
];

let allNotas = [];
let poCounts = new Map();

const currentDate = new Date();
const currentYear = currentDate.getFullYear();
const currentMonth = currentDate.getMonth() + 1;


// =====================================
// FORMAT RUPIAH
// =====================================
function formatRupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}


// =====================================
// FORMAT ANGKA RINGKAS PADA GRAFIK
// =====================================
function formatCompact(value) {
  return new Intl.NumberFormat("id-ID", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(Number(value) || 0);
}


// =====================================
// FORMAT TANGGAL TANPA PERGESERAN TIMEZONE
// =====================================
function formatDate(value) {
  if (!value) return "-";

  const parts = String(value).split("-");
  if (parts.length !== 3) return escapeHtml(value);

  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}


// =====================================
// MENGAMBIL SEMUA DATA DENGAN PAGINATION
// =====================================
async function fetchAllRows(table, columns) {
  const pageSize = 1000;
  let from = 0;
  let rows = [];

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);

    if (error) throw error;

    rows = rows.concat(data || []);

    if (!data || data.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return rows;
}


// =====================================
// MEMUAT DATA NOTA DAN RELASI PO
// =====================================
async function loadReport() {
  reportMessage.textContent = "Memuat data laporan...";

  try {
    const userSession = await requireUser();

    if (!userSession) return;

    // Mengambil data Nota
    const notas = await fetchAllRows(
      "notas",
      "id, nota_number, customer_name, nota_date, total_amount"
    );

    // Mengambil relasi Nota dan PO
    const relations = await fetchAllRows(
      "nota_purchase_orders",
      "nota_id, purchase_order_id"
    );

    allNotas = notas || [];
    poCounts = new Map();

    relations.forEach(item => {
      const currentCount = poCounts.get(item.nota_id) || 0;
      poCounts.set(item.nota_id, currentCount + 1);
    });

    // Mengurutkan Nota terbaru
    allNotas.sort((a, b) => {
      return String(b.nota_date || "").localeCompare(
        String(a.nota_date || "")
      );
    });

    setupYearFilter();
    reportMessage.textContent = "";

    renderReport();

  } catch (error) {
    console.error("Gagal memuat Report Omset:", error);

    reportMessage.textContent =
      `Gagal memuat laporan: ${error.message || "Terjadi kesalahan."}`;

    monthlyChart.innerHTML = "";
    reportNotaList.innerHTML = `
      <tr>
        <td colspan="6" class="report-empty">
          Data laporan gagal dimuat.
        </td>
      </tr>
    `;
  }
}


// =====================================
// MENYIAPKAN PILIHAN TAHUN
// =====================================
function setupYearFilter() {
  const years = new Set(
    allNotas
      .filter(item => item.nota_date)
      .map(item => Number(String(item.nota_date).slice(0, 4)))
      .filter(year => Number.isInteger(year) && year > 0)
  );

  years.add(currentYear);

  const sortedYears = [...years].sort((a, b) => b - a);

  yearFilter.innerHTML = sortedYears
    .map(year => `
      <option value="${year}" ${year === currentYear ? "selected" : ""}>
        ${year}
      </option>
    `)
    .join("");

  monthFilter.value = String(currentMonth);
}


// =====================================
// MENGAMBIL TAHUN DAN BULAN NOTA
// =====================================
function getNotaYear(nota) {
  if (!nota.nota_date) return null;
  return Number(String(nota.nota_date).slice(0, 4));
}

function getNotaMonth(nota) {
  if (!nota.nota_date) return null;
  return Number(String(nota.nota_date).slice(5, 7));
}

function getNotaAmount(nota) {
  return Number(nota.total_amount) || 0;
}

function getPOCount(nota) {
  return poCounts.get(nota.id) || 0;
}


// =====================================
// RENDER SELURUH LAPORAN
// =====================================
function renderReport() {
  const selectedYear = Number(yearFilter.value);
  const selectedMonth = Number(monthFilter.value);

  const yearNotas = allNotas.filter(
    nota => getNotaYear(nota) === selectedYear
  );

  const monthNotas = yearNotas.filter(
    nota => getNotaMonth(nota) === selectedMonth
  );

  const totalYearAmount = yearNotas.reduce(
    (total, nota) => total + getNotaAmount(nota),
    0
  );

  const totalMonthAmount = monthNotas.reduce(
    (total, nota) => total + getNotaAmount(nota),
    0
  );

  const totalYearPO = yearNotas.reduce(
    (total, nota) => total + getPOCount(nota),
    0
  );

  const totalMonthPO = monthNotas.reduce(
    (total, nota) => total + getPOCount(nota),
    0
  );

  // Ringkasan tahunan
  yearAmount.textContent = formatRupiah(totalYearAmount);
  yearNotaCount.textContent = yearNotas.length;
  yearPOCount.textContent = totalYearPO;
  yearLabel.textContent = `Tahun ${selectedYear}`;

  // Ringkasan bulanan
  monthAmount.textContent = formatRupiah(totalMonthAmount);
  monthLabel.textContent = monthNames[selectedMonth - 1];
  monthNotaCount.textContent = monthNotas.length;
  monthPOCount.textContent = totalMonthPO;
  monthDetailAmount.textContent = formatRupiah(totalMonthAmount);

  detailTitle.textContent =
    `Detail Omset ${monthNames[selectedMonth - 1]} ${selectedYear}`;

  chartYearLabel.textContent = `Tahun ${selectedYear}`;

  renderChart(yearNotas);
  renderNotaList(monthNotas);
}


// =====================================
// GRAFIK OMSET JANUARI - DESEMBER
// =====================================
function renderChart(yearNotas) {
  const monthlyTotals = Array(12).fill(0);

  yearNotas.forEach(nota => {
    const month = getNotaMonth(nota);

    if (month >= 1 && month <= 12) {
      monthlyTotals[month - 1] += getNotaAmount(nota);
    }
  });

  const maximum = Math.max(...monthlyTotals, 0);

  monthlyChart.innerHTML = monthlyTotals
    .map((amount, index) => {
      const height = maximum > 0
        ? (amount / maximum) * 100
        : 0;

      const hasValue = amount > 0;

      return `
        <div class="chart-column">
          <span class="chart-value">
            ${formatCompact(amount)}
          </span>

          <div class="chart-bar-area">
            <div
              class="chart-bar ${hasValue ? "" : "empty"}"
              style="height: ${hasValue ? Math.max(height, 3) : 3}%"
              title="${monthNames[index]}: ${formatRupiah(amount)}"
            ></div>
          </div>

          <span class="chart-month">
            ${monthNames[index].slice(0, 3)}
          </span>
        </div>
      `;
    })
    .join("");
}


// =====================================
// DAFTAR NOTA BULANAN
// =====================================
function renderNotaList(notas) {
  if (!notas.length) {
    reportNotaList.innerHTML = `
      <tr>
        <td colspan="6" class="report-empty">
          Belum ada Nota pada bulan ini.
        </td>
      </tr>
    `;
    return;
  }

  reportNotaList.innerHTML = notas
    .map((nota, index) => `
      <tr>
        <td>${index + 1}</td>

        <td class="report-number">
          ${escapeHtml(nota.nota_number || "-")}
        </td>

        <td>
          ${formatDate(nota.nota_date)}
        </td>

        <td>
          ${escapeHtml(nota.customer_name || "-")}
        </td>

        <td>
          ${getPOCount(nota)}
        </td>

        <td class="report-total">
          ${formatRupiah(getNotaAmount(nota))}
        </td>
      </tr>
    `)
    .join("");
}


// =====================================
// EVENT FILTER
// =====================================
yearFilter.addEventListener("change", renderReport);
monthFilter.addEventListener("change", renderReport);


// =====================================
// MULAI
// =====================================
loadReport();