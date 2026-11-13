import { supabase } from "./config.js";
import { requireUser } from "./common.js";

// Halaman ini khusus role designer.
const context = await requireUser();

if (!context?.user || !context?.profile) {
  throw new Error("Data login atau profil pengguna tidak ditemukan.");
}

const { profile } = context;

if (profile.role !== "designer") {
  alert("Menu PDF to CSV hanya tersedia untuk Desainer.");
  location.replace("dashboard.html");
  throw new Error("Akses ditolak: role bukan designer.");
}

const userLabel = document.querySelector("#userLabel");
const logoutBtn = document.querySelector("#logoutBtn");
const pdfFile = document.querySelector("#pdfFile");
const pdfFileName = document.querySelector("#pdfFileName");
const convertBtn = document.querySelector("#convertBtn");
const clearBtn = document.querySelector("#clearBtn");
const downloadCsvBtn = document.querySelector("#downloadCsvBtn");
const pdfMessage = document.querySelector("#pdfMessage");
const previewPanel = document.querySelector("#previewPanel");
const resultTable = document.querySelector("#resultTable");
const tableInfo = document.querySelector("#tableInfo");

if (userLabel) userLabel.textContent = profile.username || profile.full_name || "Designer";

logoutBtn?.addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();
  if (error) {
    alert("Gagal keluar: " + error.message);
    return;
  }
  location.replace("login.html");
});

let extractedRows = [];
let currentFileName = "";

function showMessage(message, isError = false) {
  pdfMessage.textContent = message;
  pdfMessage.style.color = isError ? "#ff8b8b" : "var(--lime, #b6e34b)";
}

pdfFile?.addEventListener("change", () => {
  const file = pdfFile.files?.[0];
  extractedRows = [];
  previewPanel.classList.add("hidden");
  resultTable.innerHTML = "";

  if (!file) {
    currentFileName = "";
    pdfFileName.textContent = "Belum ada file dipilih";
    convertBtn.disabled = true;
    return;
  }

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    showMessage("File harus berformat PDF.", true);
    pdfFile.value = "";
    convertBtn.disabled = true;
    return;
  }

  if (file.size > 25 * 1024 * 1024) {
    showMessage("Ukuran PDF maksimal 25 MB.", true);
    pdfFile.value = "";
    convertBtn.disabled = true;
    return;
  }

  currentFileName = file.name;
  pdfFileName.textContent = file.name;
  convertBtn.disabled = false;
  showMessage("File siap dikonversi.");
});

// Muat PDF.js dari CDN saat dibutuhkan.
async function getPdfJs() {
  const pdfjsLib = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  return pdfjsLib;
}

function groupTextItemsIntoRows(items) {
  const sorted = items
    .filter(item => item.str && item.str.trim())
    .map(item => ({
      text: item.str.trim(),
      x: item.transform?.[4] || 0,
      y: item.transform?.[5] || 0
    }))
    .sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x);

  const rows = [];
  for (const item of sorted) {
    let row = rows.find(r => Math.abs(r.y - item.y) <= 2.5);
    if (!row) {
      row = { y: item.y, cells: [] };
      rows.push(row);
    }
    row.cells.push(item);
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map(row => {
      const cells = row.cells.sort((a, b) => a.x - b.x);
      const output = [];
      let current = "";
      let previousRight = null;

      for (const cell of cells) {
        const estimatedWidth = Math.max(4, cell.text.length * 4.5);
        const gap = previousRight === null ? 0 : cell.x - previousRight;

        if (current && gap > 22) {
          output.push(current.trim());
          current = cell.text;
        } else {
          current = current ? `${current} ${cell.text}` : cell.text;
        }
        previousRight = cell.x + estimatedWidth;
      }
      if (current.trim()) output.push(current.trim());
      return output;
    })
    .filter(row => row.length);
}

function normalizeRows(rows) {
  const maxColumns = Math.max(0, ...rows.map(row => row.length));
  return rows.map(row => {
    const normalized = [...row];
    while (normalized.length < maxColumns) normalized.push("");
    return normalized;
  });
}


async function extractPdf(file) {
  const pdfjsLib = await getPdfJs();
  const bytes = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;

  const players = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    showMessage(`Membaca halaman ${pageNumber} dari ${pdf.numPages}...`);

    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    const items = content.items
      .filter(item => item.str && item.str.trim())
      .map(item => ({
        text: item.str.trim(),
        x: item.transform[4],
        y: item.transform[5]
      }));

    // Cari posisi header SIZE pada kelompok kiri dan kanan.
    const sizeHeaders = items
      .filter(item => item.text.toUpperCase() === "SIZE")
      .sort((a, b) => a.x - b.x);

    if (sizeHeaders.length < 2) {
      throw new Error("Header SIZE kiri dan kanan tidak ditemukan.");
    }

    const headerY = sizeHeaders[0].y;

    // Kelompokkan teks berdasarkan posisi baris.
    const rows = [];

    items
      .filter(item =>
        item.y < headerY - 5 &&
        item.y > 20
      )
      .forEach(item => {
        let row = rows.find(r => Math.abs(r.y - item.y) <= 3);

        if (!row) {
          row = { y: item.y, items: [] };
          rows.push(row);
        }

        row.items.push(item);
      });

    rows.sort((a, b) => b.y - a.y);

    const leftPlayers = [];
    const rightPlayers = [];

    rows.forEach(row => {
      const cells = row.items.sort((a, b) => a.x - b.x);

      // Kelompok kiri.
      const leftSize = cells.find(c => c.x >= 600 && c.x < 675);
      const leftName = cells
        .filter(c => c.x >= 675 && c.x < 820)
        .map(c => c.text)
        .join(" ");

      // Kelompok kanan.
      const rightSize = cells.find(c => c.x >= 820 && c.x < 900);
      const rightName = cells
        .filter(c => c.x >= 900 && c.x < 1100)
        .map(c => c.text)
        .join(" ");

      if (leftSize) {
        leftPlayers.push({
          size: leftSize.text,
          name: leftName.trim()
        });
      }

      if (rightSize) {
        rightPlayers.push({
          size: rightSize.text,
          name: rightName.trim()
        });
      }
    });

    players.push(...leftPlayers, ...rightPlayers);
  }

  if (!players.length) {
    throw new Error("Data pemain tidak ditemukan.");
  }

  return [
    ["NOMOR", "SIZE", "NO", "NAMA"],
    ...players.map((player, index) => [
      String(index + 1),
      player.size,
      "",
      player.name
    ])
  ];
}


function renderTable(rows) {
  resultTable.innerHTML = "";
  const maxColumns = Math.max(...rows.map(row => row.length));
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  for (let column = 0; column < maxColumns; column++) {
    const th = document.createElement("th");
    const headers = ["NOMOR", "SIZE", "NO", "NAMA"];
    th.textContent = headers[column] || `Kolom ${column + 1}`;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);

  const tbody = document.createElement("tbody");
  rows.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    for (let column = 0; column < maxColumns; column++) {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "text";
      input.value = row[column] ?? "";
      input.setAttribute("aria-label", `Baris ${rowIndex + 1}, kolom ${column + 1}`);
      input.addEventListener("input", () => {
        extractedRows[rowIndex][column] = input.value;
      });
      td.appendChild(input);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });

  resultTable.append(thead, tbody);
  tableInfo.textContent = `${rows.length} baris data • ${maxColumns} kolom • Sel dapat diedit sebelum download.`;
}

convertBtn?.addEventListener("click", async () => {
  const file = pdfFile.files?.[0];
  if (!file) return;

  convertBtn.disabled = true;
  showMessage("Memulai proses konversi...");

  try {
    extractedRows = await extractPdf(file);
    renderTable(extractedRows);
    previewPanel.classList.remove("hidden");
    showMessage("Konversi selesai. Periksa dan edit tabel sebelum mengunduh CSV.");
  } catch (error) {
    console.error("PDF to CSV error:", error);
    showMessage(error.message || "Gagal mengonversi PDF.", true);
  } finally {
    convertBtn.disabled = false;
  }
});

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

downloadCsvBtn?.addEventListener("click", () => {
  if (!extractedRows.length) return;

  const csv = extractedRows
    .map(row => row.map(csvEscape).join(","))
    .join("\r\n");

  // BOM membantu Excel mengenali UTF-8.
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safeName = (currentFileName || "hasil-konversi").replace(/\.pdf$/i, "");
  anchor.href = url;
  anchor.download = `${safeName}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
});

clearBtn?.addEventListener("click", () => {
  pdfFile.value = "";
  pdfFileName.textContent = "Belum ada file dipilih";
  convertBtn.disabled = true;
  extractedRows = [];
  currentFileName = "";
  resultTable.innerHTML = "";
  previewPanel.classList.add("hidden");
  showMessage("Form konversi direset.");
});
