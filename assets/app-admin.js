const API_URL = "https://script.google.com/macros/s/AKfycbw4-Fi9SaSTB1Ain86-9xEGVjqLmLtnjXGv1jf-BZI79yKDTE39F5PdWPCfrFYCe6ZABQ/exec";

let ADMIN_SECRET_INPUT = "";
let editingId = null; // null = mode tambah, ada id = mode edit
let LAST_KONTEN_ITEMS = [];
let ADMIN_FILTER_TAHUN = "all";
let ADMIN_FILTER_KATEGORI = "Semua Kategori";
let ADMIN_FILTER_SERI = "Semua Seri";
let SELECTED_IDS = new Set();

// Ambil data dari server dengan percobaan ulang otomatis. Google Apps Script
// kadang "cold start" (butuh beberapa detik bangun kalau lama tidak diakses)
// atau sesaat mengembalikan halaman HTML (bukan JSON) kalau server sedang
// bermasalah/limit. Tanpa retry ini, error-nya akan muncul mentah ke pengguna
// seperti "Unexpected token '<'," yang membingungkan. Dengan retry, request
// dicoba ulang beberapa kali dulu sebelum benar-benar dianggap gagal.
async function getDataRetry(retries = 3) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${API_URL}?action=getData`);
      const json = await res.json(); // kalau server balikin HTML, ini akan throw
      if (json.error) throw new Error(json.error);
      return json;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 700 + attempt * 600));
      }
    }
  }
  throw lastErr || new Error("Gagal memuat data.");
}

// Pesan ramah untuk ditampilkan ke admin kalau data gagal dimuat setelah semua
// percobaan ulang habis — dengan tombol coba lagi, tanpa istilah teknis.
function friendlyLoadErrorHtml(retryFnName) {
  return `
    <div style="text-align:center; padding:24px 12px;">
      <p class="status-msg err" style="margin-bottom:10px;">Gagal memuat data. Server mungkin sedang lambat merespons.</p>
      <button class="btn btn-secondary" onclick="${retryFnName}()" style="font-size:12.5px; padding:8px 16px;">Coba Lagi</button>
    </div>`;
}

document.addEventListener("DOMContentLoaded", init);
document.getElementById("btn-logout").addEventListener("click", () => {
  sessionStorage.removeItem("gamma_user");
  window.location.href = "index.html";
});

function init() {
  const raw = sessionStorage.getItem("gamma_user");
  const user = raw ? JSON.parse(raw) : null;
  if (!user || user.role !== "admin") {
    document.getElementById("login-view").style.display = "block";
    document.getElementById("admin-view").style.display = "none";
    return;
  }
  ADMIN_SECRET_INPUT = user.secret;
  document.getElementById("login-view").style.display = "none";
  document.getElementById("admin-view").style.display = "grid";
  loadKontenTable();
  loadPegawaiTable();
}

// ====== DROPDOWN KUSTOM (modern) ======
// Menu-nya di-mount ke <body> dengan posisi fixed (bukan ditaruh di dalam container),
// supaya tidak pernah kepotong/ketiban elemen lain (khususnya di layar HP yang sempit
// dan filter yang berjejer/wrap ke beberapa baris).
function buildDropdown(container, options, value, onChange, theme, labelPrefix) {
  const dd = document.createElement("div");
  dd.className = `dd ${theme}`;

  const caret = `<svg class="dd-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "dd-toggle";
  toggle.innerHTML = `<span class="dd-toggle-label">${labelPrefix}${escHtml(value)}</span>${caret}`;

  // Container ini dipakai ulang tiap kali filter di-render ulang — buang dulu
  // menu lama (yang sudah dipasang ke body) supaya tidak menumpuk di DOM.
  if (container._ddMenu) container._ddMenu.remove();

  const menu = document.createElement("div");
  menu.className = "dd-menu dd-menu-fixed";
  menu.innerHTML = options.map(opt => `
    <button type="button" class="dd-option ${opt === value ? "active" : ""}" data-val="${escHtml(opt)}">${labelPrefix}${escHtml(opt)}</button>
  `).join("");

  // Pasang menu ke body supaya posisinya lepas dari overflow/z-index elemen induk
  document.body.appendChild(menu);
  container._ddMenu = menu;
  dd.appendChild(toggle);
  container.innerHTML = "";
  container.appendChild(dd);

  function positionMenu() {
    const rect = toggle.getBoundingClientRect();
    const menuWidth = Math.max(rect.width, 170);
    let left = rect.left;
    // Jangan sampai menu keluar dari tepi kanan layar (penting di HP)
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    menu.style.top = (rect.bottom + 8) + "px";
    menu.style.left = left + "px";
    menu.style.minWidth = menuWidth + "px";
  }

  function closeDd() {
    dd.classList.remove("open");
    menu.classList.remove("open");
  }
  function openDd() {
    positionMenu();
    dd.classList.add("open");
    menu.classList.add("open");
  }
  toggle.addEventListener("click", e => {
    e.stopPropagation();
    const willOpen = !dd.classList.contains("open");
    document.querySelectorAll(".dd.open").forEach(el => el.classList.remove("open"));
    document.querySelectorAll(".dd-menu-fixed.open").forEach(el => el.classList.remove("open"));
    if (willOpen) openDd();
  });
  menu.querySelectorAll(".dd-option").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      closeDd();
      onChange(btn.dataset.val);
    });
  });
  document.addEventListener("click", e => {
    if (!dd.contains(e.target) && !menu.contains(e.target)) closeDd();
  });
  window.addEventListener("resize", () => { if (dd.classList.contains("open")) positionMenu(); });
  window.addEventListener("scroll", () => { if (dd.classList.contains("open")) positionMenu(); }, true);
}

// Pesan status utama di atas "Daftar Karya Tersimpan" — berganti sesuai aksi terakhir
// (tambah / edit / hapus / hapus massal / sync), bukan cuma dipakai oleh Sync saja.
function setStatusMsg(text, type) {
  const msg = document.getElementById("sync-msg");
  msg.textContent = text;
  msg.className = `status-msg ${type || ""}`.trim();
}

function escHtml(str) {
  return String(str || "").replace(/[&<>"']/g, s => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[s]));
}

// Kalau ada karya duplikat (kategori + seri + nama sama persis), ambil baris PALING TERAKHIR
// di database (dianggap paling update/valid).
function dedupeKontenKeepLast(items) {
  const map = new Map();
  items.forEach(item => {
    const key = [
      String(item.Kategori || "").trim().toLowerCase(),
      String(item.Seri || "").trim().toLowerCase(),
      String(item.Mahasiswa || "").trim().toLowerCase()
    ].join("|");
    map.set(key, item);
  });
  return items.filter(item => {
    const key = [
      String(item.Kategori || "").trim().toLowerCase(),
      String(item.Seri || "").trim().toLowerCase(),
      String(item.Mahasiswa || "").trim().toLowerCase()
    ].join("|");
    return map.get(key) === item;
  });
}

// ====== HELPER: Tutup semua modal ======
// Dipanggil sebelum membuka modal baru, supaya tidak ada 2 modal yang numpuk
// bersamaan (misal modal Edit Karya belum ke-close terus modal Tampilan Awal
// dibuka, keduanya jadi tampil di posisi yang sama dan bikin tampilan berantakan).
function closeAllModals() {
  document.querySelectorAll(".modal-overlay.open").forEach(el => el.classList.remove("open"));
  document.body.classList.remove("zoom-screenshot-mode");
}

// ====== FORM KARYA: Tambah / Edit (via modal popup) ======

const karyaOverlay = document.getElementById("karya-modal-overlay");

document.getElementById("btn-open-add").addEventListener("click", () => {
  resetForm();
  if (ADMIN_FILTER_TAHUN && ADMIN_FILTER_TAHUN !== "Semua Tahun") {
    document.getElementById("f-tahun").value = ADMIN_FILTER_TAHUN;
  }
  if (ADMIN_FILTER_KATEGORI && ADMIN_FILTER_KATEGORI !== "Semua Kategori") {
    document.getElementById("f-kategori").value = ADMIN_FILTER_KATEGORI;
  }
  if (ADMIN_FILTER_SERI && ADMIN_FILTER_SERI !== "Semua Seri") {
    document.getElementById("f-seri").value = ADMIN_FILTER_SERI;
  }
  openKaryaModal();
});

document.getElementById("karya-modal-close").addEventListener("click", closeKaryaModal);
karyaOverlay.addEventListener("click", e => { if (e.target === karyaOverlay) closeKaryaModal(); });

document.getElementById("btn-add").addEventListener("click", async () => {
  if (editingId) {
    await saveEdit();
  } else {
    await addKonten();
  }
});

document.getElementById("btn-cancel-edit").addEventListener("click", () => {
  closeKaryaModal();
});

function openKaryaModal() {
  closeAllModals();
  karyaOverlay.classList.add("open");
}

function closeKaryaModal() {
  karyaOverlay.classList.remove("open");
  resetForm();
}

async function addKonten() {
  const msg = document.getElementById("add-msg");
  const payload = {
    action: "addKonten",
    secret: ADMIN_SECRET_INPUT,
    kategori: val("f-kategori"),
    seri: val("f-seri"),
    mahasiswa: val("f-mahasiswa"),
    embedLink: val("f-embed"),
    thumbnail: val("f-thumb"),
    tahun: val("f-tahun")
  };
  if (!payload.seri || !payload.mahasiswa || !payload.embedLink) {
    msg.textContent = "Seri, nama mahasiswa, dan link Drive wajib diisi.";
    msg.className = "status-msg err";
    return;
  }
  if (!payload.tahun) {
    msg.textContent = "Tahun wajib diisi.";
    msg.className = "status-msg err";
    return;
  }
  msg.textContent = "";
  const btn = setKaryaBtnLoading("Menyimpan...");
  try {
    const json = await postApi(payload);
    if (json.error) throw new Error(json.error);
    msg.textContent = "Karya berhasil ditambahkan.";
    msg.className = "status-msg ok";
    setStatusMsg("1 karya berhasil ditambahkan.", "ok");
    await fadeReloadKontenTable();
    setTimeout(closeKaryaModal, 500);
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "status-msg err";
  } finally {
    restoreKaryaBtn(btn);
  }
}

async function saveEdit() {
  const msg = document.getElementById("add-msg");
  const payload = {
    action: "updateKonten",
    secret: ADMIN_SECRET_INPUT,
    id: editingId,
    kategori: val("f-kategori"),
    seri: val("f-seri"),
    mahasiswa: val("f-mahasiswa"),
    embedLink: val("f-embed"),
    thumbnail: val("f-thumb"),
    tahun: val("f-tahun")
  };
  if (!payload.seri || !payload.mahasiswa || !payload.embedLink) {
    msg.textContent = "Seri, nama mahasiswa, dan link Drive wajib diisi.";
    msg.className = "status-msg err";
    return;
  }
  if (!payload.tahun) {
    msg.textContent = "Tahun wajib diisi.";
    msg.className = "status-msg err";
    return;
  }
  msg.textContent = "";
  const btn = setKaryaBtnLoading("Menyimpan...");
  try {
    const json = await postApi(payload);
    if (json.error) throw new Error(json.error);
    msg.textContent = "Karya berhasil diperbarui.";
    msg.className = "status-msg ok";
    setStatusMsg("1 karya berhasil diedit.", "ok");
    await fadeReloadKontenTable();
    setTimeout(closeKaryaModal, 500);
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "status-msg err";
  } finally {
    restoreKaryaBtn(btn);
  }
}

// Tampilkan spinner + kunci form modal Tambah/Edit Karya selama request berjalan,
// supaya jelas kalau lagi diproses dan tidak bisa diklik dobel.
function setKaryaBtnLoading(label) {
  const btn = document.getElementById("btn-add");
  const cancelBtn = document.getElementById("btn-cancel-edit");
  btn.dataset.originalHtml = btn.innerHTML;
  btn.innerHTML = `<span class="like-spinner"></span> ${label}`;
  btn.disabled = true;
  cancelBtn.disabled = true;
  karyaOverlay.querySelectorAll("input, select").forEach(el => (el.disabled = true));
  return btn;
}

function restoreKaryaBtn(btn) {
  const cancelBtn = document.getElementById("btn-cancel-edit");
  btn.innerHTML = btn.dataset.originalHtml;
  btn.disabled = false;
  cancelBtn.disabled = false;
  karyaOverlay.querySelectorAll("input, select").forEach(el => (el.disabled = false));
}

function startEdit(item) {
  editingId = item.ID;
  document.getElementById("form-title").textContent = "Edit Karya";
  document.getElementById("f-kategori").value = item.Kategori;
  document.getElementById("f-seri").value = item.Seri;
  document.getElementById("f-mahasiswa").value = item.Mahasiswa || "";
  document.getElementById("f-embed").value = item.EmbedLink || "";
  document.getElementById("f-thumb").value = item.Thumbnail || "";
  document.getElementById("f-tahun").value = item.Tahun || new Date().getFullYear();
  document.getElementById("btn-add").textContent = "Simpan Perubahan";
  document.getElementById("add-msg").textContent = "";
  openKaryaModal();
  document.getElementById("f-seri").focus();
}

function resetForm() {
  editingId = null;
  document.getElementById("form-title").textContent = "Tambah Karya Baru";
  document.getElementById("btn-add").textContent = "Tambah Karya";
  document.getElementById("add-msg").textContent = "";
  ["f-seri", "f-mahasiswa", "f-embed", "f-thumb"].forEach(id => (document.getElementById(id).value = ""));
  document.getElementById("f-kategori").selectedIndex = 0;
  document.getElementById("f-tahun").value = new Date().getFullYear();
}

// ====== SYNC DARI PENGUMPULAN ======

document.getElementById("btn-sync").addEventListener("click", async () => {
  const msg = document.getElementById("sync-msg");
  const btn = document.getElementById("btn-sync");
  if (!confirm("Sync data dari sheet O1-O4 ke Gamma? Duplikat akan dibersihkan otomatis.")) return;

  // Loading state pada tombol
  btn.disabled = true;
  const originalBtnHtml = btn.innerHTML;
  btn.innerHTML = `<span class="like-spinner"></span> Sync...`;

  msg.textContent = "Sedang sync & membersihkan duplikat...";
  msg.className = "status-msg";
  try {
    const json = await postApi({ action: "syncKonten", secret: ADMIN_SECRET_INPUT });
    if (json.error) throw new Error(json.error);
    const parts = [`${json.added} karya baru`];
    if (json.updated) parts.push(`${json.updated} link diperbarui`);
    msg.textContent = `Selesai. ${parts.join(", ")}. Karya manual tidak terpengaruh.`;
    msg.className = "status-msg ok";
    // Beri jeda sebentar supaya perubahan di Google Sheet konsisten sebelum dibaca ulang
    await new Promise(r => setTimeout(r, 700));
    await fadeReloadKontenTable();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "status-msg err";
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalBtnHtml;
  }
});

// ====== PEGAWAI ======

document.getElementById("btn-add-pegawai").addEventListener("click", async () => {
  const msg = document.getElementById("pegawai-msg");
  const nama = val("f-pegawai");
  const nip = val("f-nip");
  if (!nama || !nip) {
    msg.textContent = "Nama dan NIP wajib diisi.";
    msg.className = "status-msg err";
    return;
  }
  msg.textContent = "";
  // Loading state pada tombol + kunci input selama proses, supaya jelas
  // kalau lagi diproses dan tidak bisa diklik dobel.
  const btn = document.getElementById("btn-add-pegawai");
  const originalBtnHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="like-spinner"></span> Menyimpan...`;
  document.getElementById("f-pegawai").disabled = true;
  document.getElementById("f-nip").disabled = true;
  try {
    const json = await postApi({ action: "addPegawai", secret: ADMIN_SECRET_INPUT, nama, nip });
    if (json.error) throw new Error(json.error);
    msg.textContent = `Pegawai "${nama}" ditambahkan.`;
    msg.className = "status-msg ok";
    document.getElementById("f-pegawai").value = "";
    document.getElementById("f-nip").value = "";
    await loadPegawaiTable();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "status-msg err";
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalBtnHtml;
    document.getElementById("f-pegawai").disabled = false;
    document.getElementById("f-nip").disabled = false;
  }
});

// ====== LOAD TABLES ======

async function loadKontenTable() {
  const wrap = document.getElementById("konten-table");
  try {
    const json = await getDataRetry();
    CURRENT_SETTINGS = json.settings || { tahun: "", seriByKategori: {} };
    LAST_KONTEN_ITEMS = dedupeKontenKeepLast(json.konten || []);
    populateAllFilters();
    renderKontenTable();
  } catch (err) {
    console.error("Gagal memuat daftar karya:", err);
    wrap.innerHTML = friendlyLoadErrorHtml("loadKontenTable");
  }
}

// Reload data dengan animasi fade halus (dipakai setelah tambah/edit/sync karya)
async function fadeReloadKontenTable() {
  const wrap = document.getElementById("konten-table");
  wrap.classList.add("fade-out");
  await new Promise(r => setTimeout(r, 180));
  try {
    const json = await getDataRetry();
    CURRENT_SETTINGS = json.settings || { tahun: "", seriByKategori: {} };
    LAST_KONTEN_ITEMS = dedupeKontenKeepLast(json.konten || []);
    populateAllFilters();
    renderKontenTable();
  } catch (err) {
    console.error("Gagal memuat ulang daftar karya:", err);
    wrap.innerHTML = friendlyLoadErrorHtml("loadKontenTable");
  }
  wrap.classList.remove("fade-out");
}

function populateAllFilters() {
  populateFilterTahunAdmin(LAST_KONTEN_ITEMS);
  populateFilterKategoriAdmin(LAST_KONTEN_ITEMS);
  populateFilterSeriAdmin(LAST_KONTEN_ITEMS);
}

function populateFilterTahunAdmin(items) {
  const container = document.getElementById("filter-tahun-admin");
  const tahunList = [...new Set(items.map(i => String(i.Tahun || "").trim()).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const options = ["Semua Tahun", ...tahunList];
  if (!options.includes(ADMIN_FILTER_TAHUN)) ADMIN_FILTER_TAHUN = "Semua Tahun";
  buildDropdown(container, options, ADMIN_FILTER_TAHUN, (val) => {
    ADMIN_FILTER_TAHUN = val;
    ADMIN_FILTER_KATEGORI = "Semua Kategori";
    ADMIN_FILTER_SERI = "Semua Seri";
    populateAllFilters();
    renderKontenTable();
    if (MONITOR_MODE) renderMonitorResult();
  }, "light", "");
}

function populateFilterKategoriAdmin(items) {
  const container = document.getElementById("filter-kategori-admin");
  const filtered = ADMIN_FILTER_TAHUN === "Semua Tahun" || !ADMIN_FILTER_TAHUN
    ? items : items.filter(i => String(i.Tahun || "").trim() === ADMIN_FILTER_TAHUN);
  const KATEGORI_ORDER = ["Infografis", "Videografis", "Leaflet", "Join Riset"];
  const available = KATEGORI_ORDER.filter(k => filtered.some(i => String(i.Kategori || "").trim() === k));
  const options = ["Semua Kategori", ...available];
  if (!options.includes(ADMIN_FILTER_KATEGORI)) ADMIN_FILTER_KATEGORI = "Semua Kategori";
  buildDropdown(container, options, ADMIN_FILTER_KATEGORI, (val) => {
    ADMIN_FILTER_KATEGORI = val;
    ADMIN_FILTER_SERI = "Semua Seri";
    populateFilterKategoriAdmin(LAST_KONTEN_ITEMS);
    populateFilterSeriAdmin(LAST_KONTEN_ITEMS);
    renderKontenTable();
    if (MONITOR_MODE) renderMonitorResult();
  }, "light", "");
}

function populateFilterSeriAdmin(items) {
  const container = document.getElementById("filter-seri-admin");
  let filtered = ADMIN_FILTER_TAHUN === "Semua Tahun" || !ADMIN_FILTER_TAHUN
    ? items : items.filter(i => String(i.Tahun || "").trim() === ADMIN_FILTER_TAHUN);
  if (ADMIN_FILTER_KATEGORI && ADMIN_FILTER_KATEGORI !== "Semua Kategori") {
    filtered = filtered.filter(i => i.Kategori === ADMIN_FILTER_KATEGORI);
  }
  const seriList = [...new Set(filtered.map(i => String(i.Seri || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const options = ["Semua Seri", ...seriList];
  if (!options.includes(ADMIN_FILTER_SERI)) ADMIN_FILTER_SERI = "Semua Seri";
  buildDropdown(container, options, ADMIN_FILTER_SERI, (val) => {
    ADMIN_FILTER_SERI = val;
    populateFilterSeriAdmin(LAST_KONTEN_ITEMS);
    renderKontenTable();
    if (MONITOR_MODE) renderMonitorResult();
  }, "light", "");
}

// Helper: ambil items setelah semua filter diterapkan
function getFilteredItems() {
  let items = ADMIN_FILTER_TAHUN === "Semua Tahun" || !ADMIN_FILTER_TAHUN
    ? LAST_KONTEN_ITEMS
    : LAST_KONTEN_ITEMS.filter(i => String(i.Tahun || "").trim() === ADMIN_FILTER_TAHUN);
  if (ADMIN_FILTER_KATEGORI && ADMIN_FILTER_KATEGORI !== "Semua Kategori") {
    items = items.filter(i => String(i.Kategori || "").trim() === ADMIN_FILTER_KATEGORI);
  }
  if (ADMIN_FILTER_SERI && ADMIN_FILTER_SERI !== "Semua Seri") {
    items = items.filter(i => String(i.Seri || "").trim() === ADMIN_FILTER_SERI);
  }
  return items;
}

function renderKontenTable() {
  const wrap = document.getElementById("konten-table");
  const items = getFilteredItems();

  // Buang id terpilih yang sudah tidak ada lagi di data (misal terhapus dari sisi lain)
  const allIds = new Set(LAST_KONTEN_ITEMS.map(i => String(i.ID)));
  [...SELECTED_IDS].forEach(id => { if (!allIds.has(id)) SELECTED_IDS.delete(id); });

  if (items.length === 0) {
    wrap.innerHTML = `<p style="color:var(--abu)">Belum ada karya.</p>`;
    updateBulkUI([]);
    return;
  }
  wrap.innerHTML = `
    <div class="admin-grid">
      ${items.map(i => `
        <div class="admin-card">
          <input type="checkbox" class="admin-card-checkbox" data-id="${i.ID}" ${SELECTED_IDS.has(String(i.ID)) ? "checked" : ""}>
          <div class="admin-card-info">
            <span class="admin-card-badge">${i.Kategori} · Seri ${i.Seri} · ${i.Tahun || "-"}</span>
            <p class="admin-card-name">${i.Mahasiswa || "-"}</p>
          </div>
          <div class="admin-card-actions">
            <button class="edit-btn" data-id="${i.ID}">Edit</button>
            <button class="del-btn" data-id="${i.ID}">Hapus</button>
          </div>
        </div>`).join("")}
    </div>
  `;
  wrap.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const item = LAST_KONTEN_ITEMS.find(i => String(i.ID) === String(btn.dataset.id));
      if (item) startEdit(item);
    });
  });
  wrap.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteKonten(btn.dataset.id, btn));
  });
  wrap.querySelectorAll(".admin-card-checkbox").forEach(chk => {
    chk.addEventListener("change", () => {
      const id = String(chk.dataset.id);
      if (chk.checked) SELECTED_IDS.add(id); else SELECTED_IDS.delete(id);
      updateBulkUI(items);
    });
  });
  updateBulkUI(items);
}

// Sinkronkan checkbox "Pilih Semua" + tombol "Hapus Terpilih" dengan item yang sedang tampil
function updateBulkUI(visibleItems) {
  const selectAll = document.getElementById("chk-select-all");
  const bulkBtn = document.getElementById("btn-bulk-delete");
  const bulkCount = document.getElementById("bulk-count");

  const visibleIds = visibleItems.map(i => String(i.ID));
  const selectedVisible = visibleIds.filter(id => SELECTED_IDS.has(id));

  if (selectAll) {
    selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
    selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
  }

  bulkCount.textContent = SELECTED_IDS.size;
  bulkBtn.style.display = SELECTED_IDS.size > 0 ? "inline-flex" : "none";
}

document.getElementById("chk-select-all").addEventListener("change", (e) => {
  const items = getFilteredItems();
  if (e.target.checked) {
    items.forEach(i => SELECTED_IDS.add(String(i.ID)));
  } else {
    items.forEach(i => SELECTED_IDS.delete(String(i.ID)));
  }
  renderKontenTable();
});

document.getElementById("btn-bulk-delete").addEventListener("click", async () => {
  if (SELECTED_IDS.size === 0) return;
  const count = SELECTED_IDS.size;
  if (!confirm(`Hapus ${count} karya terpilih? Tindakan ini tidak bisa dibatalkan.`)) return;

  const btn = document.getElementById("btn-bulk-delete");
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<span class="like-spinner"></span> Menghapus...`;

  try {
    const ids = [...SELECTED_IDS];
    const json = await postApi({ action: "deleteKontenBulk", secret: ADMIN_SECRET_INPUT, ids });
    if (json.error) throw new Error(json.error);
    SELECTED_IDS.clear();
    setStatusMsg(`${json.deleted} karya berhasil dihapus.`, "ok");
    await fadeReloadKontenTable();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
});

async function loadPegawaiTable() {
  const wrap = document.getElementById("pegawai-table");
  try {
    const json = await getDataRetry();
    const items = json.pegawai || [];
    if (items.length === 0) {
      wrap.innerHTML = `<p style="color:var(--abu); font-size:13px;">Belum ada pegawai.</p>`;
      return;
    }
    wrap.innerHTML = `
      <div class="admin-grid">
        ${items.map(p => `
          <div class="admin-card">
            <div class="admin-card-info">
              <p class="admin-card-name">${p.Nama}</p>
              <span class="admin-card-badge">${p.NIP}</span>
            </div>
            <div class="admin-card-actions">
              <button class="del-btn" data-nip="${p.NIP}">Hapus</button>
            </div>
          </div>`).join("")}
      </div>
    `;
    wrap.querySelectorAll(".del-btn").forEach(btn => {
      btn.addEventListener("click", () => deletePegawai(btn.dataset.nip, btn));
    });
  } catch (err) {
    console.error("Gagal memuat daftar pegawai:", err);
    wrap.innerHTML = friendlyLoadErrorHtml("loadPegawaiTable");
  }
}

// ====== DELETE ======

async function deletePegawai(nip, btn) {
  if (!confirm("Hapus pegawai ini?")) return;
  // Tampilkan loading state di tombol & redupkan card selama proses hapus
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="like-spinner"></span>`;
    const card = btn.closest(".admin-card");
    if (card) card.style.opacity = "0.5";
  }
  try {
    const json = await postApi({ action: "deletePegawai", secret: ADMIN_SECRET_INPUT, nip });
    if (json.error) throw new Error(json.error);
    await loadPegawaiTable();
  } catch (err) {
    // Restore tombol & card jika gagal
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = "Hapus";
      const card = btn.closest(".admin-card");
      if (card) card.style.opacity = "";
    }
    alert(err.message);
  }
}

async function deleteKonten(id, btn) {
  if (!confirm("Hapus karya ini?")) return;
  // Tampilkan loading state di tombol & card
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="like-spinner"></span>`;
    const card = btn.closest(".admin-card");
    if (card) card.style.opacity = "0.5";
  }
  try {
    const json = await postApi({ action: "deleteKonten", secret: ADMIN_SECRET_INPUT, id });
    if (json.error) throw new Error(json.error);
    if (editingId === id) resetForm();
    SELECTED_IDS.delete(String(id));
    setStatusMsg("1 karya berhasil dihapus.", "ok");
    await fadeReloadKontenTable();
  } catch (err) {
    // Restore tombol jika gagal
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = "Hapus";
      const card = btn.closest(".admin-card");
      if (card) card.style.opacity = "";
    }
    alert(err.message);
  }
}

// ====== MONITORING LIKE ======
// Cek: dari filter Tahun+Kategori+Seri yang aktif di panel Daftar Karya (bisa berisi
// beberapa karya/mahasiswa berbeda), apakah tiap pegawai sudah like SALAH SATU karya
// di kombinasi itu atau belum sama sekali.

let MONITOR_MODE = false;

document.getElementById("btn-monitor-like").addEventListener("click", () => {
  MONITOR_MODE = !MONITOR_MODE;
  const btn = document.getElementById("btn-monitor-like");
  const title = document.getElementById("pegawai-panel-title");
  const filtersWrap = document.getElementById("monitor-filters");
  const zoomBtn = document.getElementById("btn-monitor-zoom");
  const wrap = document.getElementById("pegawai-table");

  // Tampilkan loading segera supaya tidak terasa ngelag saat tunggu data/render
  wrap.innerHTML = `<div class="monitor-loading"><span class="spinner"></span> Memuat...</div>`;

  if (MONITOR_MODE) {
    btn.classList.add("active-monitor");
    btn.textContent = "✕ Tutup Monitoring";
    title.textContent = "Monitoring Like Karya";
    filtersWrap.style.display = "flex";
    renderMonitorResult();
  } else {
    btn.classList.remove("active-monitor");
    btn.textContent = "❤ Monitoring Like";
    title.textContent = "Daftar Pegawai";
    filtersWrap.style.display = "none";
    if (zoomBtn) zoomBtn.style.display = "none";
    loadPegawaiTable();
  }
});

// Ikuti filter Tahun/Kategori/Seri yang sama dengan panel "Daftar Karya Tersimpan".
// Setiap filter dicek independen: kalau masih "Semua ..." berarti tidak membatasi
// (ikutkan semua), kalau sudah dipilih spesifik baru dipakai untuk menyaring.
// Minimal Tahun harus dipilih supaya tidak sengaja menghitung seluruh database.
function getMonitorMatches() {
  if (ADMIN_FILTER_TAHUN === "Semua Tahun") return [];
  return LAST_KONTEN_ITEMS.filter(i => {
    if (String(i.Tahun || "").trim() !== ADMIN_FILTER_TAHUN) return false;
    if (ADMIN_FILTER_KATEGORI !== "Semua Kategori" && String(i.Kategori || "").trim() !== ADMIN_FILTER_KATEGORI) return false;
    if (ADMIN_FILTER_SERI !== "Semua Seri" && String(i.Seri || "").trim() !== ADMIN_FILTER_SERI) return false;
    return true;
  });
}

async function loadMonitorData() {
  return await getDataRetry();
}

// Bangun HTML kartu "Belum Pernah Like" (dipakai baik oleh panel biasa maupun modal Zoom)
function buildMonitorHtml(json, matches, label) {
  const pegawaiList = json.pegawai || [];
  if (pegawaiList.length === 0) {
    return `<p style="color:var(--abu); font-size:13px; padding:24px 6px; text-align:center;">Belum ada pegawai terdaftar.</p>`;
  }

  const matchIds = new Set(matches.map(m => String(m.ID)));
  const likedNipSet = new Set(
    (json.likes || [])
      .filter(l => matchIds.has(String(l.KaryaId)))
      .map(l => String(l.NIP))
  );

  const belum = pegawaiList
    .filter(p => !likedNipSet.has(String(p.NIP)))
    .sort((a, b) => String(a.Nama).localeCompare(String(b.Nama)));
  const sudah = pegawaiList
    .filter(p => likedNipSet.has(String(p.NIP)))
    .sort((a, b) => String(a.Nama).localeCompare(String(b.Nama)));

  const head = `
    <div class="monitor-head">
      <div class="monitor-summary">
        <span>${escHtml(label)}</span>
      </div>
    </div>`;

  const belumColumn = `
    <div class="monitor-col">
      <div class="monitor-col-head">
        <span class="monitor-col-title warn">Belum Like</span>
        <span class="monitor-summary-count warn">${belum.length}</span>
      </div>
      <div class="monitor-box">
        ${
          belum.length === 0
            ? `<div class="monitor-empty-ok">🎉 Semua sudah like!</div>`
            : `<div class="monitor-grid">
                ${belum
                  .map(
                    p => `
                  <div class="monitor-name-card">
                    <p class="mn-name">${escHtml(p.Nama)}</p>
                  </div>`
                  )
                  .join("")}
              </div>`
        }
      </div>
    </div>`;

  const sudahColumn = `
    <div class="monitor-col">
      <div class="monitor-col-head">
        <span class="monitor-col-title ok">Sudah Like</span>
        <span class="monitor-summary-count ok">${sudah.length}</span>
      </div>
      <div class="monitor-box monitor-box-green">
        ${
          sudah.length === 0
            ? `<div class="monitor-empty-ok monitor-empty-warn">Belum ada yang like.</div>`
            : `<div class="monitor-grid">
                ${sudah
                  .map(
                    p => `
                  <div class="monitor-name-card monitor-name-card-green">
                    <p class="mn-name">${escHtml(p.Nama)}</p>
                  </div>`
                  )
                  .join("")}
              </div>`
        }
      </div>
    </div>`;

  return `
    ${head}
    <div class="monitor-columns">
      ${belumColumn}
      ${sudahColumn}
    </div>
  `;
}

async function renderMonitorResult() {
  if (!MONITOR_MODE) return;
  const wrap = document.getElementById("pegawai-table");
  const zoomBtn = document.getElementById("btn-monitor-zoom");
  const matches = getMonitorMatches();

  if (zoomBtn) {
    zoomBtn.style.display = matches.length > 0 ? "inline-flex" : "none";
  }

  if (matches.length === 0) {
    wrap.innerHTML = `<p style="color:var(--abu); font-size:13px; padding:24px 6px; text-align:center;">Pilih Tahun di panel Daftar Karya untuk melihat siapa saja yang belum like.</p>`;
    return;
  }

  wrap.innerHTML = `<div class="monitor-loading"><span class="spinner"></span> Memuat data like...</div>`;
  try {
    const json = await loadMonitorData();
    const label = `${ADMIN_FILTER_KATEGORI} · Seri ${ADMIN_FILTER_SERI} · ${ADMIN_FILTER_TAHUN}`;
    wrap.innerHTML = buildMonitorHtml(json, matches, label);
  } catch (err) {
    wrap.innerHTML = `<p class="status-msg err">${err.message}</p>`;
  }
}

// ====== MONITORING LIKE — TAMPILAN ZOOM (fullscreen, buat screenshot) ======

document.getElementById("btn-monitor-zoom").addEventListener("click", openMonitorZoom);
document.getElementById("monitor-zoom-close").addEventListener("click", closeMonitorZoom);
document.getElementById("monitor-zoom-overlay").addEventListener("click", e => {
  if (e.target.id === "monitor-zoom-overlay") closeMonitorZoom();
});

async function openMonitorZoom() {
  closeAllModals();
  const overlay = document.getElementById("monitor-zoom-overlay");
  const body = document.getElementById("monitor-zoom-body");
  const sub = document.getElementById("monitor-zoom-sub");
  // Ikuti filter Tahun/Kategori/Seri yang sedang aktif di panel Daftar Karya
  // (sama seperti panel Monitoring biasa) — bukan digabung semua kategori/seri.
  const label = `${ADMIN_FILTER_KATEGORI} · Seri ${ADMIN_FILTER_SERI} · ${ADMIN_FILTER_TAHUN}`;

  sub.textContent = label;
  body.innerHTML = `<div class="monitor-loading"><span class="spinner"></span> Memuat data like...</div>`;
  overlay.classList.add("open");
  // Lepas kuncian scroll body & scroll internal box, supaya halaman jadi bisa
  // di-scroll biasa dan seluruh isi kebuka penuh — supaya tools screenshot
  // full-page (misal GoFullPage) bisa nangkep semuanya dengan bersih, tanpa
  // konten keulang/kepotong akibat scroll internal yang tidak ikut ke-scroll.
  document.body.classList.add("zoom-screenshot-mode");

  try {
    const matches = getMonitorMatches();
    const json = await loadMonitorData();
    body.innerHTML = buildMonitorHtml(json, matches, label);
  } catch (err) {
    body.innerHTML = `<p class="status-msg err">${err.message}</p>`;
  }
}

function closeMonitorZoom() {
  document.getElementById("monitor-zoom-overlay").classList.remove("open");
  document.body.classList.remove("zoom-screenshot-mode");
}

// ====== HELPERS ======

async function postApi(payload) {
  const res = await fetch(API_URL, { method: "POST", body: JSON.stringify(payload) });
  return res.json();
}

function val(id) {
  return document.getElementById(id).value.trim();
}

// ====== PENGATURAN TAMPILAN AWAL GALERI ======
// Admin bisa menentukan tahun default & seri default per kategori yang otomatis
// terbuka saat pengunjung membuka galeri, supaya pengunjung langsung diarahkan
// ke karya yang paling butuh like.
const KATEGORI_SETTING_LIST = ["Infografis", "Videografis", "Leaflet", "Join Riset"];
// Mapping kategori -> id elemen DOM (karena id HTML tidak boleh/aman pakai spasi)
const KATEGORI_SETTING_DOM_ID = {
  "Infografis": "settings-seri-Infografis",
  "Videografis": "settings-seri-Videografis",
  "Leaflet": "settings-seri-Leaflet",
  "Join Riset": "settings-seri-JoinRiset"
};
let CURRENT_SETTINGS = { tahun: "", seriByKategori: {} };
let SETTINGS_FORM = { tahun: "", seriByKategori: {} };

const settingsOverlay = document.getElementById("settings-modal-overlay");

document.getElementById("btn-open-settings").addEventListener("click", openSettingsModal);
document.getElementById("settings-modal-close").addEventListener("click", closeSettingsModal);
document.getElementById("btn-settings-cancel").addEventListener("click", closeSettingsModal);
settingsOverlay.addEventListener("click", e => { if (e.target === settingsOverlay) closeSettingsModal(); });

function openSettingsModal() {
  closeAllModals();
  SETTINGS_FORM = {
    tahun: CURRENT_SETTINGS.tahun || "",
    seriByKategori: { ...(CURRENT_SETTINGS.seriByKategori || {}) }
  };
  renderSettingsTahunDropdown();
  KATEGORI_SETTING_LIST.forEach(renderSettingsSeriDropdown);
  document.getElementById("settings-msg").textContent = "";
  settingsOverlay.classList.add("open");
}

function closeSettingsModal() {
  settingsOverlay.classList.remove("open");
}

function renderSettingsTahunDropdown() {
  const container = document.getElementById("settings-tahun-wrap");
  const years = [...new Set(LAST_KONTEN_ITEMS.map(i => String(i.Tahun || "").trim()).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  if (years.length === 0) {
    container.innerHTML = `<p style="font-size:12.5px; color:var(--abu);">Belum ada data tahun. Tambahkan karya terlebih dahulu.</p>`;
    SETTINGS_FORM.tahun = "";
    return;
  }
  if (!years.includes(SETTINGS_FORM.tahun)) SETTINGS_FORM.tahun = years[0];
  buildDropdown(container, years, SETTINGS_FORM.tahun, (val) => {
    SETTINGS_FORM.tahun = val;
    // Render ulang dropdown Tahun sendiri supaya labelnya ikut menampilkan pilihan
    // terbaru (tanpa ini, teks di kotak dropdown tidak berubah walau sudah diklik).
    renderSettingsTahunDropdown();
    KATEGORI_SETTING_LIST.forEach(renderSettingsSeriDropdown);
  }, "light", "Tahun ");
}

function renderSettingsSeriDropdown(kategori) {
  const container = document.getElementById(KATEGORI_SETTING_DOM_ID[kategori]);
  if (!container) return;
  const seriList = [...new Set(
    LAST_KONTEN_ITEMS
      .filter(i => String(i.Tahun || "").trim() === SETTINGS_FORM.tahun && String(i.Kategori || "").trim() === kategori)
      .map(i => String(i.Seri || "").trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (seriList.length === 0) {
    container.innerHTML = `<p style="font-size:12px; color:var(--abu); margin:8px 0 0;">Belum ada karya di tahun ini</p>`;
    delete SETTINGS_FORM.seriByKategori[kategori];
    return;
  }

  let current = SETTINGS_FORM.seriByKategori[kategori];
  if (!seriList.includes(current)) current = seriList[0];
  SETTINGS_FORM.seriByKategori[kategori] = current;

  buildDropdown(container, seriList, current, (val) => {
    SETTINGS_FORM.seriByKategori[kategori] = val;
    // Render ulang dropdown ini sendiri supaya labelnya langsung menampilkan seri
    // yang baru dipilih (tanpa ini, teks di kotak dropdown tidak berubah).
    renderSettingsSeriDropdown(kategori);
  }, "light", "Seri ");
}

document.getElementById("btn-settings-save").addEventListener("click", async () => {
  const msg = document.getElementById("settings-msg");
  const btn = document.getElementById("btn-settings-save");
  if (!SETTINGS_FORM.tahun) {
    msg.textContent = "Belum ada tahun yang bisa dipilih.";
    msg.className = "status-msg err";
    return;
  }
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<span class="like-spinner"></span> Menyimpan...`;
  try {
    const json = await postApi({
      action: "saveSettings",
      secret: ADMIN_SECRET_INPUT,
      tahun: SETTINGS_FORM.tahun,
      seriByKategori: SETTINGS_FORM.seriByKategori
    });
    if (json.error) throw new Error(json.error);
    CURRENT_SETTINGS = { tahun: SETTINGS_FORM.tahun, seriByKategori: { ...SETTINGS_FORM.seriByKategori } };
    msg.textContent = "Tersimpan. Galeri akan membuka tampilan ini secara default.";
    msg.className = "status-msg ok";
    setTimeout(closeSettingsModal, 700);
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "status-msg err";
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
});
