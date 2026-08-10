// ====== KONFIGURASI ======
const API_URL = "https://script.google.com/macros/s/AKfycbw4-Fi9SaSTB1Ain86-9xEGVjqLmLtnjXGv1jf-BZI79yKDTE39F5PdWPCfrFYCe6ZABQ/exec";

const KATEGORI = [
  { key: "Infografis", label: "Infografis", icon: iconChart() },
  { key: "Videografis", label: "Videografis", icon: iconPlay() },
  { key: "Leaflet", label: "Leaflet", icon: iconLeaflet() },
  { key: "Join Riset", label: "Join Riset", icon: iconDoc() }
];

let STATE = {
  data: null,
  activeKategori: KATEGORI[0].key,
  activeTahun: null // diisi otomatis dengan tahun terbaru dari database setelah data dimuat
};

// Google Apps Script Web App punya batas eksekusi paralel — kalau banyak orang
// (misal 50+) like/komentar hampir bersamaan, sebagian request bisa kena error
// sesaat ("Server sedang sibuk..." dari LockService, atau timeout jaringan).
// Helper ini otomatis coba ulang beberapa kali dengan jeda singkat sebelum
// benar-benar dianggap gagal, supaya aksi like/komentar terasa lebih andal.
async function postApiRetry(payload, retries = 2) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(API_URL, { method: "POST", body: JSON.stringify(payload) });
      const json = await res.json();
      // "Server sibuk" dari LockService layak dicoba ulang; error lain (misal validasi) tidak perlu.
      if (json.error && /sibuk/i.test(json.error) && attempt < retries) {
        await new Promise(r => setTimeout(r, 500 + attempt * 500));
        continue;
      }
      return json;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 + attempt * 500));
        continue;
      }
    }
  }
  return { error: lastErr ? "Koneksi bermasalah, coba lagi." : "Gagal memproses, coba lagi." };
}

function currentUser() {
  const raw = sessionStorage.getItem("gamma_user");
  if (!raw) return null;
  const u = JSON.parse(raw);
  return u.role === "pegawai" ? u : null;
}

// ====== ICONS ======
function iconChart() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>`;
}
function iconPlay() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/></svg>`;
}
function iconLeaflet() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>`;
}
function iconDoc() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h9l3 3v17H6z"/><path d="M15 2v4h4M9 12h6M9 16h6M9 8h2"/></svg>`;
}
function iconTrophy() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M7 5H4a3 3 0 0 0 3 4M17 5h3a3 3 0 0 1-3 4"/></svg>`;
}
function iconLike(filled) {
  return `<svg viewBox="0 0 24 24" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 22V11M2 13v7a2 2 0 0 0 2 2h12.5a2 2 0 0 0 2-1.6l1.2-6A2 2 0 0 0 17.7 12H14V6a2 2 0 0 0-2-2l-2 5v11"/></svg>`;
}
function iconComment() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.4 8.5 8.5 0 0 1-4-1L3 20l1.1-3.5A8.38 8.38 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z"/></svg>`;
}
function iconCaret() {
  return `<svg class="dd-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
}

// ====== INIT ======
document.addEventListener("DOMContentLoaded", () => {
  renderHeader();
  renderSidebar();
  loadData();
  setupLoginModal();
});

function setupLoginModal() {
  const overlay = document.getElementById("login-overlay");

  document.body.addEventListener("click", e => {
    const trigger = e.target.closest("#login-link");
    if (trigger) {
      e.preventDefault();
      document.getElementById("login-msg").textContent = "";
      document.getElementById("login-input").value = "";
      overlay.classList.add("open");
      setTimeout(() => document.getElementById("login-input").focus(), 50);
    }
  });

  document.getElementById("login-modal-close").addEventListener("click", () => overlay.classList.remove("open"));
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.classList.remove("open"); });

  async function doUnifiedLogin() {
    const msg = document.getElementById("login-msg");
    const btn = document.getElementById("btn-login-unified");
    const input = document.getElementById("login-input");
    const val = input.value.trim();
    if (!val) {
      msg.textContent = "Masukkan NIP atau password admin.";
      msg.className = "status-msg err";
      return;
    }
    msg.textContent = "";
    msg.className = "status-msg";

    // Tampilkan animasi loading di tombol & kunci input selama proses login
    const originalBtnHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="like-spinner"></span> Memeriksa...`;
    input.disabled = true;

    // Coba admin & pegawai SEKALIGUS (paralel), bukan gantian, supaya lebih cepat.
    // Google Apps Script kadang lambat (cold start), jadi kalau dua request dikirim
    // berurutan, total waktu tunggu jadi dobel. Dengan paralel, waktu tunggu cuma
    // sepanjang request yang paling lambat, bukan jumlah keduanya.
    const adminPromise = fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "loginAdmin", secret: val })
    }).then(res => res.json()).catch(() => ({ error: "network" }));

    const pegawaiPromise = fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "loginPegawai", nip: val })
    }).then(res => res.json()).catch(() => ({ error: "network" }));

    const [adminJson, pegawaiJson] = await Promise.all([adminPromise, pegawaiPromise]);

    if (!adminJson.error) {
      sessionStorage.setItem("gamma_user", JSON.stringify({ role: "admin", secret: val }));
      window.location.href = "admin.html";
      return;
    }

    if (!pegawaiJson.error) {
      sessionStorage.setItem("gamma_user", JSON.stringify({
        role: "pegawai", nama: pegawaiJson.nama, nip: pegawaiJson.nip
      }));
      overlay.classList.remove("open");
      input.value = "";
      renderHeader();
      renderMain();
      // Reset tombol (jaga-jaga kalau modal dibuka lagi tanpa reload halaman)
      btn.disabled = false;
      btn.innerHTML = originalBtnHtml;
      input.disabled = false;
      return;
    }

    // Gagal keduanya: kembalikan tombol & input ke kondisi semula, tampilkan pesan error
    btn.disabled = false;
    btn.innerHTML = originalBtnHtml;
    input.disabled = false;
    msg.textContent = "NIP tidak ditemukan. Hubungi admin jika belum terdaftar.";
    msg.className = "status-msg err";
  }

  document.getElementById("btn-login-unified").addEventListener("click", doUnifiedLogin);
  document.getElementById("login-input").addEventListener("keydown", e => {
    if (e.key === "Enter") doUnifiedLogin();
  });
}

function renderHeader() {
  const wrap = document.getElementById("header-actions");
  const user = currentUser();
  const rawAdmin = sessionStorage.getItem("gamma_user");
  const isAdmin = rawAdmin && JSON.parse(rawAdmin).role === "admin";

  if (user) {
    wrap.innerHTML = `
      <span class="header-user">Halo, ${escapeHtml(user.nama)}</span>
      <button id="btn-logout">Logout</button>
    `;
    document.getElementById("btn-logout").addEventListener("click", () => {
      sessionStorage.removeItem("gamma_user");
      renderHeader();
    });
  } else if (isAdmin) {
    wrap.innerHTML = `
      <a href="admin.html">Buka Admin</a>
      <button id="btn-logout">Logout</button>
    `;
    document.getElementById("btn-logout").addEventListener("click", () => {
      sessionStorage.removeItem("gamma_user");
      renderHeader();
    });
  } else {
    wrap.innerHTML = `<a href="#" id="login-link">Login</a>`;
  }
}

// ====== DROPDOWN KUSTOM (modern, dipakai untuk filter tahun) ======
// container: elemen DOM tempat dropdown dirender
// options: array string, value: string terpilih saat ini, onChange: callback(val)
// theme: "header" (pill di header gelap) atau "light" (kotak putih, dipakai di admin)
function buildDropdown(container, options, value, onChange, theme, labelPrefix) {
  const dd = document.createElement("div");
  dd.className = `dd ${theme}`;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "dd-toggle";
  toggle.innerHTML = `<span class="dd-toggle-label">${labelPrefix}${escapeHtml(value)}</span>${iconCaret()}`;

  if (container._ddMenu) container._ddMenu.remove();

  const menu = document.createElement("div");
  menu.className = "dd-menu dd-menu-fixed";
  menu.innerHTML = options.map(opt => `
    <button type="button" class="dd-option ${opt === value ? "active" : ""}" data-val="${escapeHtml(opt)}">${labelPrefix}${escapeHtml(opt)}</button>
  `).join("");

  // Pasang menu ke body agar tidak terpotong overflow/z-index apapun
  document.body.appendChild(menu);
  container._ddMenu = menu;
  dd.appendChild(toggle);
  container.innerHTML = "";
  container.appendChild(dd);

  function positionMenu() {
    const rect = toggle.getBoundingClientRect();
    menu.style.top = (rect.bottom + 8) + "px";
    menu.style.left = rect.left + "px";
    menu.style.minWidth = Math.max(rect.width, 150) + "px";
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
  function toggleDd(e) {
    e.stopPropagation();
    const willOpen = !dd.classList.contains("open");
    document.querySelectorAll(".dd.open").forEach(el => el.classList.remove("open"));
    document.querySelectorAll(".dd-menu-fixed.open").forEach(el => el.classList.remove("open"));
    if (willOpen) openDd();
  }

  toggle.addEventListener("click", toggleDd);
  menu.querySelectorAll(".dd-option").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const val = btn.dataset.val;
      closeDd();
      onChange(val);
    });
  });

  document.addEventListener("click", e => {
    if (!dd.contains(e.target) && !menu.contains(e.target)) closeDd();
  });
  window.addEventListener("resize", () => { if (dd.classList.contains("open")) positionMenu(); });
  window.addEventListener("scroll", () => { if (dd.classList.contains("open")) positionMenu(); }, true);
}

// ====== FILTER TAHUN (di header, sejajar logo & login) ======
function getAvailableYears() {
  const items = (STATE.data && STATE.data.konten) || [];
  const years = [...new Set(items.map(i => String(i.Tahun || "").trim()).filter(Boolean))];
  years.sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); // terbaru dulu
  return years;
}

function renderYearFilter() {
  const wrap = document.getElementById("header-year");
  const years = getAvailableYears();

  if (years.length === 0) {
    wrap.innerHTML = "";
    return;
  }

  // Set default: tahun terbaru dari database, kecuali user sudah pernah pilih tahun lain
  if (!STATE.activeTahun || !years.includes(STATE.activeTahun)) {
    STATE.activeTahun = years[0];
  }

  buildDropdown(wrap, years, STATE.activeTahun, (val) => {
    STATE.activeTahun = val;
    renderYearFilter();
    renderMain();
  }, "header", "Tahun ");
}

function renderSidebar() {
  const sidebar = document.getElementById("sidebar");
  sidebar.innerHTML = `
    <div class="sidebar-label">Kategori Karya</div>
    ${KATEGORI.map(
      k => `
      <button class="cat-btn ${STATE.activeKategori === k.key ? "active" : ""}" data-cat="${k.key}">
        <span class="icon-wrap">${k.icon}</span> ${k.label}
      </button>`
    ).join("")}
  `;

  sidebar.querySelectorAll(".cat-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      STATE.activeKategori = btn.dataset.cat;
      renderSidebar();
      renderMain();
    });
  });
}

async function loadData() {
  renderLoading();
  try {
    STATE.data = await getDataRetry();
    renderYearFilter();
    renderMain();
  } catch (err) {
    document.getElementById("main").innerHTML = `
      <div class="empty-state">
        Gagal memuat data. Pastikan API_URL di assets/app.js sudah diisi dengan URL Web App Apps Script yang benar.<br>
        <small>${err.message}</small>
      </div>`;
  }
}

// Ambil data galeri dengan percobaan ulang otomatis — penting saat banyak orang
// buka halaman bersamaan dan sesekali request gagal karena server lagi ramai.
async function getDataRetry(retries = 2) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${API_URL}?action=getData`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      return json;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise(r => setTimeout(r, 500 + attempt * 500));
    }
  }
  throw lastErr || new Error("Gagal memuat data.");
}

function renderLoading() {
  document.getElementById("main").innerHTML = `
    <div class="loading-row"><span class="spinner"></span> Memuat galeri karya...</div>`;
}

function renderMain() {
  renderKatalog();
}

// Kalau ada karya duplikat (kategori + seri + nama sama persis), ambil baris PALING TERAKHIR
// di database (dianggap paling update). Urutan asli dari sheet dipertahankan untuk item lain.
function dedupeKontenKeepLast(items) {
  const map = new Map();
  items.forEach(item => {
    const key = [
      String(item.Kategori || "").trim().toLowerCase(),
      String(item.Seri || "").trim().toLowerCase(),
      String(item.Mahasiswa || "").trim().toLowerCase()
    ].join("|");
    map.set(key, item); // overwrite -> yang tersisa otomatis baris paling terakhir
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

// ====== Helpers untuk hitung like & comment per karya ======
function likeCountFor(karyaId) {
  return (STATE.data.likes || []).filter(l => String(l.KaryaId) === String(karyaId)).length;
}
function commentsFor(karyaId) {
  return (STATE.data.comments || []).filter(c => String(c.KaryaId) === String(karyaId));
}
function isLikedByMe(karyaId) {
  const user = currentUser();
  if (!user) return false;
  return (STATE.data.likes || []).some(
    l => String(l.KaryaId) === String(karyaId) && String(l.NIP) === String(user.nip)
  );
}

function renderKatalog() {
  const main = document.getElementById("main");
  const kat = STATE.activeKategori;
  const tahun = STATE.activeTahun;
  let items = (STATE.data.konten || []).filter(
    k => String(k.Kategori || "").trim() === kat && (!tahun || String(k.Tahun || "").trim() === tahun)
  );
  items = dedupeKontenKeepLast(items);

  const seriList = [...new Set(items.map(i => String(i.Seri || "").trim()))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
  const itemsBySeri = {};
  seriList.forEach(seri => { itemsBySeri[seri] = items.filter(i => String(i.Seri || "").trim() === seri); });

  // Seri yang sedang aktif/ditampilkan. Pertahankan pilihan sebelumnya kalau masih
  // relevan (masih ada di kategori/tahun ini), kalau tidak jatuhkan ke seri pertama.
  // (activeSeri selalu disimpan sebagai string, karena berasal dari data-seri di HTML.)
  if (!STATE.activeSeri || !seriList.includes(String(STATE.activeSeri))) {
    STATE.activeSeri = seriList[0] || null;
  } else {
    STATE.activeSeri = String(STATE.activeSeri);
  }
  const activeSeri = STATE.activeSeri;
  let activeItems = activeSeri ? (itemsBySeri[activeSeri] || []) : [];

  // Untuk Videografis & Join Riset, urutkan berdasarkan nomor kelompok (menaik).
  // Kalau nama bukan angka murni (misal nama orang), taruh di akhir, urut alfabet.
  const isKelompokKategori = kat === "Videografis" || kat === "Join Riset";
  if (isKelompokKategori) {
    activeItems = [...activeItems].sort((a, b) => {
      const na = String(a.Mahasiswa || "").trim();
      const nb = String(b.Mahasiswa || "").trim();
      const isNumA = /^\d+$/.test(na);
      const isNumB = /^\d+$/.test(nb);
      if (isNumA && isNumB) return parseInt(na, 10) - parseInt(nb, 10);
      if (isNumA) return -1;
      if (isNumB) return 1;
      return na.localeCompare(nb, undefined, { numeric: true });
    });
  }

  // Untuk Infografis & Leaflet, urutkan berdasarkan jumlah like terbanyak di atas.
  // Sort ini stabil (Array.sort di JS modern stabil), jadi kalau semua item belum
  // ada like (semua 0), urutannya otomatis tidak berubah dari urutan aslinya.
  const isLikeSortKategori = kat === "Infografis" || kat === "Leaflet";
  if (isLikeSortKategori) {
    activeItems = [...activeItems].sort((a, b) => likeCountFor(b.ID) - likeCountFor(a.ID));
  }

  main.innerHTML = `
    <div class="katalog-header">
      <div class="katalog-header-top">
        <div class="section-title">
          <h2>${kat}</h2>
          ${
            seriList.length > 0
              ? `<div class="seri-tabs">
                  ${seriList
                    .map(
                      seri => `<button class="seri-tab ${seri === String(activeSeri) ? "active" : ""}" data-seri="${escapeHtml(seri)}">Seri ${escapeHtml(seri)}</button>`
                    )
                    .join("")}
                </div>`
              : ""
          }
        </div>
        <div class="top3-header" id="top3-header">${top3PanelInner(activeItems)}</div>
      </div>
      <p class="section-sub">Klik salah satu karya untuk melihat tampilan penuh, like, dan berkomentar.</p>
    </div>
    <div class="grid" id="katalog-grid">
      ${
        activeItems.length === 0
          ? `<div class="empty-state">Belum ada karya ${kat} ${tahun ? `tahun ${escapeHtml(tahun)}` : ""} yang ditambahkan.</div>`
          : activeItems.map(cardHtml).join("")
      }
    </div>
  `;

  main.querySelectorAll(".card").forEach(card => {
    card.addEventListener("click", () => openModal(card.dataset.id));
  });

  const headerEl = main.querySelector(".katalog-header");
  if (headerEl) {
    main.style.setProperty("--katalog-header-h", headerEl.offsetHeight + "px");
  }

  main.querySelectorAll(".seri-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      if (tab.dataset.seri === STATE.activeSeri) return;
      STATE.activeSeri = tab.dataset.seri;
      renderKatalog();
      main.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  main.onscroll = null;
}

// Update stats (like & comment) pada kartu galeri dengan animasi kedip halus
function refreshCardStats(itemId) {
  const card = document.querySelector(`.card[data-id="${itemId}"]`);
  if (!card) return;
  const statsEl = card.querySelector(".card-stats");
  if (!statsEl) return;

  const likes = likeCountFor(itemId);
  const comments = commentsFor(itemId).length;

  statsEl.style.transition = "opacity 0.18s ease";
  statsEl.style.opacity = "0";

  setTimeout(() => {
    statsEl.innerHTML = `
      <span>${iconLike(false)} ${likes}</span>
      <span>${iconComment()} ${comments}</span>
    `;
    statsEl.style.opacity = "1";
  }, 180);
}

// Refresh isi panel Top 3 di header (dipanggil ulang setelah like berubah)
function refreshTop3Header() {
  const box = document.getElementById("top3-header");
  const activeTab = document.querySelector(".seri-tab.active");
  if (!box || !activeTab || !STATE.data) return;
  const seri = activeTab.dataset.seri;
  const items = (STATE.data.konten || []).filter(k => k.Kategori === STATE.activeKategori && String(k.Seri || "").trim() === seri && (!STATE.activeTahun || String(k.Tahun || "").trim() === STATE.activeTahun));

  box.style.transition = "opacity 0.18s ease";
  box.style.opacity = "0";
  setTimeout(() => {
    box.innerHTML = top3PanelInner(items);
    box.style.opacity = "1";
  }, 180);
}

// Isi Top 3 like terbanyak untuk satu seri (emas/perak/perunggu) — selalu 3 slot tetap, tidak pernah berubah tinggi
function top3PanelInner(seriItems) {
  const ranked = [...seriItems]
    .map(item => ({ item, likes: likeCountFor(item.ID) }))
    .filter(r => r.likes > 0)
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 3);

  const medalClasses = ["gold", "silver", "bronze"];
  const slots = [0, 1, 2].map(i => {
    const r = ranked[i];
    if (!r) {
      return `
        <div class="top3-slot">
          <span class="top3-badge empty">${iconLike(false)}</span>
          <p class="top3-name">-</p>
        </div>`;
    }
    return `
      <div class="top3-slot">
        <span class="top3-badge ${medalClasses[i]}">${iconLike(true)}</span>
        <p class="top3-name" title="${escapeHtml(splitNames(r.item.Mahasiswa).join(", "))}">${displayMahasiswa(r.item)}</p>
        <p class="top3-count">${r.likes} suka</p>
      </div>`;
  });

  return `
    <div class="top3-slots">${slots.join("")}</div>
  `;
}

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "x";
}

function cardHtml(item) {
  const thumbUrl = resolveThumbnail(item);
  const thumb = thumbUrl
    ? `<img src="${thumbUrl}" alt="${escapeHtml(item.Mahasiswa)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=&quot;placeholder-icon&quot;>${iconByKategori(item.Kategori).replace(/"/g, "&quot;")}</div>'">`
    : `<div class="placeholder-icon">${iconByKategori(item.Kategori)}</div>`;
  const likes = likeCountFor(item.ID);
  const comments = commentsFor(item.ID).length;
  return `
    <div class="card" data-id="${item.ID}">
      <div class="card-thumb">${thumb}</div>
      <div class="card-body">
        <p class="card-title">${displayMahasiswa(item)}</p>
        <div class="card-stats">
          <span>${iconLike(false)} ${likes}</span>
          <span>${iconComment()} ${comments}</span>
        </div>
      </div>
    </div>
  `;
}

function iconByKategori(kat) {
  const found = KATEGORI.find(k => k.key === kat);
  return found ? found.icon : iconDoc();
}

// Ambil ID file Google Drive dari berbagai format link
function driveFileId(link) {
  if (!link) return null;
  const m = link.match(/\/d\/([^/]+)/) || link.match(/id=([^&]+)/);
  return m ? m[1] : null;
}

// Kalau Thumbnail kosong, coba generate otomatis dari link Drive
function resolveThumbnail(item) {
  if (item.Thumbnail) {
    // Kalau kolom Thumbnail diisi link Google Drive (termasuk link PDF/PPT),
    // konversi ke thumbnail generator Drive supaya otomatis ambil halaman 1-nya.
    const thumbId = driveFileId(item.Thumbnail);
    if (thumbId) return `https://drive.google.com/thumbnail?id=${thumbId}&sz=w1600`;
    // Kalau bukan link Drive (misal URL gambar langsung dari sumber lain), pakai apa adanya.
    return item.Thumbnail;
  }
  const id = driveFileId(item.EmbedLink);
  if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w1600`;
  return null;
}

// Versi resolusi tinggi untuk ditampilkan penuh di modal (bukan thumbnail kecil terkompres)
function highResImageUrl(item) {
  const id = driveFileId(item.EmbedLink);
  if (id) return `https://drive.google.com/uc?export=view&id=${id}`;
  return item.Thumbnail || null;
}

// Pisahkan nama jadi daftar (untuk karya kelompok, dipisah koma)
function splitNames(str) {
  return String(str || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function namesDisplay(str) {
  const names = splitNames(str);
  if (names.length <= 1) return escapeHtml(names[0] || "");
  return names.map(escapeHtml).join(", ");
}

// Untuk kategori Videografis & Join Riset, admin biasanya cuma isi nomor kelompok
// (misal "1", "2") — di galeri otomatis ditampilkan jadi "Kelompok 1", "Kelompok 2", dst.
// Kategori lain (Infografis, Leaflet) ditampilkan apa adanya (nama mahasiswa).
function displayMahasiswa(item) {
  const isKelompokKategori = item.Kategori === "Videografis" || item.Kategori === "Join Riset";
  if (!isKelompokKategori) return namesDisplay(item.Mahasiswa);

  const names = splitNames(item.Mahasiswa);
  if (names.length === 0) return "";
  return names
    .map(n => (/^\d+$/.test(n.trim()) ? `Kelompok ${n.trim()}` : n))
    .map(escapeHtml)
    .join(", ");
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, s => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[s]));
}

function timeAgo(isoOrDate) {
  if (!isoOrDate) return "";
  const d = new Date(isoOrDate);
  if (isNaN(d)) return "";
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "baru saja";
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return `${Math.floor(diff / 86400)} hari lalu`;
}

// ====== MODAL VIEWER + LIKE/COMMENT ======

function openModal(id) {
  const item = STATE.data.konten.find(k => String(k.ID) === String(id));
  if (!item) return;

  const overlay = document.getElementById("modal-overlay");
  const isImageKategori = item.Kategori === "Infografis" || item.Kategori === "Leaflet";
  const driveId = driveFileId(item.EmbedLink);
  const directImgUrl = isImageKategori ? highResImageUrl(item) : null;
  const fallbackThumbUrl = driveId ? `https://drive.google.com/thumbnail?id=${driveId}&sz=w2000` : null;
  const embedUrl = toEmbeddableUrl(item.EmbedLink);
  const user = currentUser();
  const liked = isLikedByMe(item.ID);
  const likeCount = likeCountFor(item.ID);
  const comments = commentsFor(item.ID).sort((a, b) => new Date(a.Waktu) - new Date(b.Waktu));

  const previewHtml = directImgUrl
    ? `<div class="frame-loading" id="frame-loading"><span class="spinner"></span> Memuat pratinjau...</div>
       <img src="${directImgUrl}" alt="${escapeHtml(item.Mahasiswa)}" class="modal-preview-img" id="modal-preview-img" data-fallback-thumb="${fallbackThumbUrl || ""}" data-embed-url="${embedUrl}">`
    : `<div class="frame-loading" id="frame-loading"><span class="spinner"></span> Memuat pratinjau...</div>
       <iframe src="${embedUrl}" allow="autoplay" allowfullscreen onload="document.getElementById('frame-loading')?.remove()"></iframe>`;

  overlay.innerHTML = `
    <div class="modal-box modal-box-split">
      <div class="modal-header">
        <div>
          <h3>${displayMahasiswa(item)}</h3>
          <p>${escapeHtml(item.Kategori)} · Seri ${escapeHtml(item.Seri)}${item.Tahun ? ` · ${escapeHtml(item.Tahun)}` : ""}</p>
        </div>
        <button class="modal-close" id="modal-close">&times;</button>
      </div>
      <div class="modal-split-body">
        <div class="modal-preview-col">
          <div class="modal-frame-wrap">
            ${previewHtml}
          </div>
          <div class="modal-footer">
            <a class="btn btn-outline" href="${item.EmbedLink}" target="_blank" rel="noopener">Buka di Drive</a>
          </div>
        </div>
        <div class="modal-side-col">
          <div class="social-bar">
            <button class="like-btn ${liked ? "liked" : ""}" id="btn-like">
              ${iconLike(liked)} <span id="like-label">${liked ? "Disukai" : "Suka"}</span>
            </button>
            <span class="like-count" id="like-count">${likeCount} suka</span>
          </div>
          ${!user ? `<p class="login-required">Login sebagai pegawai untuk bisa like &amp; berkomentar. <a href="#" id="modal-login-link">Login di sini</a>.</p>` : ""}
          <div class="comment-section">
            <h4>Komentar (${comments.length})</h4>
            ${
              user
                ? `<div class="comment-form">
                    <textarea id="comment-text" placeholder="Tulis komentar sebagai ${escapeHtml(user.nama)}..."></textarea>
                    <button class="btn btn-primary" id="btn-comment">Kirim</button>
                  </div>`
                : ""
            }
            <div class="comment-list" id="comment-list">
              ${
                comments.length === 0
                  ? `<p class="comment-empty">Belum ada komentar.</p>`
                  : comments.map(c => commentItemHtml(c, user)).join("")
              }
            </div>
            <p class="status-msg" id="comment-msg"></p>
          </div>
        </div>
      </div>
    </div>
  `;

  overlay.classList.add("open");
  document.getElementById("modal-close").addEventListener("click", closeModal);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  const previewImg = document.getElementById("modal-preview-img");
  if (previewImg) {
    setupImagePreviewFallback(previewImg);
    setupImageZoom(previewImg);
  }
  const loginLink = document.getElementById("modal-login-link");
  if (loginLink) {
    loginLink.addEventListener("click", e => {
      e.preventDefault();
      closeModal();
      document.getElementById("login-link").click();
    });
  }

  document.getElementById("btn-like").addEventListener("click", () => toggleLike(item));
  const btnComment = document.getElementById("btn-comment");
  if (btnComment) btnComment.addEventListener("click", () => submitComment(item));

  // Event delegation untuk tombol Edit/Hapus di tiap komentar (dipasang sekali di
  // wrapper, jadi tetap jalan walau daftar komentar dirender ulang)
  const commentList = document.getElementById("comment-list");
  if (commentList) {
    commentList.addEventListener("click", e => {
      const editBtn = e.target.closest(".c-edit-btn");
      const delBtn = e.target.closest(".c-del-btn");
      const saveBtn = e.target.closest(".c-save-btn");
      const cancelBtn = e.target.closest(".c-cancel-btn");
      if (editBtn) startEditComment(editBtn.dataset.id);
      if (delBtn) deleteCommentAction(item, delBtn.dataset.id);
      if (saveBtn) saveEditComment(item, saveBtn.dataset.id);
      if (cancelBtn) openModal(item.ID); // batal edit -> render ulang seperti semula
    });
  }
}

// Komentar ditampilkan pakai 💬 saja (bukan nama asli) supaya identitas siapa
// komentar apa tetap privat/bebas — kecuali untuk komentar milik sendiri, ditandai "(Anda)"
// dan dikasih tombol Edit/Hapus.
function commentItemHtml(c, user) {
  const mine = !!(user && String(c.NIP) === String(user.nip));
  return `
    <div class="comment-item" data-comment-id="${c.ID}">
      <div class="c-head">
        <span class="c-name">💬 ${mine ? "Anda" : "Pegawai"}</span>
        <span class="c-time">${timeAgo(c.Waktu)}</span>
      </div>
      <p class="c-text" id="c-text-${c.ID}">${escapeHtml(c.Text)}</p>
      ${
        mine
          ? `<div class="c-actions">
              <button class="c-edit-btn" data-id="${c.ID}">Edit</button>
              <button class="c-del-btn" data-id="${c.ID}">Hapus</button>
            </div>`
          : ""
      }
    </div>`;
}

function startEditComment(commentId) {
  const textEl = document.getElementById(`c-text-${commentId}`);
  if (!textEl || textEl.dataset.editing === "1") return;
  const original = textEl.textContent;
  textEl.dataset.editing = "1";
  textEl.outerHTML = `
    <div class="c-edit-wrap" id="c-text-${commentId}">
      <textarea class="c-edit-textarea" id="c-edit-input-${commentId}">${escapeHtml(original)}</textarea>
      <div class="c-actions">
        <button class="btn btn-primary c-save-btn" data-id="${commentId}" style="padding:6px 12px; font-size:12px;">Simpan</button>
        <button class="btn btn-outline c-cancel-btn" data-id="${commentId}" style="padding:6px 12px; font-size:12px;">Batal</button>
      </div>
    </div>`;
  document.getElementById(`c-edit-input-${commentId}`)?.focus();
}

async function saveEditComment(item, commentId) {
  const user = currentUser();
  if (!user) return;
  const input = document.getElementById(`c-edit-input-${commentId}`);
  if (!input) return;
  const text = input.value.trim();
  if (!text) {
    alert("Komentar tidak boleh kosong.");
    return;
  }
  const saveBtn = document.querySelector(`.c-save-btn[data-id="${commentId}"]`);
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Menyimpan..."; }
  try {
    const json = await postApiRetry({ action: "updateComment", id: commentId, nip: user.nip, text });
    if (json.error) throw new Error(json.error);
    const c = (STATE.data.comments || []).find(cm => String(cm.ID) === String(commentId));
    if (c) c.Text = text;
    openModal(item.ID);
  } catch (err) {
    alert(err.message);
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Simpan"; }
  }
}

async function deleteCommentAction(item, commentId) {
  const user = currentUser();
  if (!user) return;
  if (!confirm("Hapus komentar ini?")) return;
  const delBtn = document.querySelector(`.c-del-btn[data-id="${commentId}"]`);
  if (delBtn) { delBtn.disabled = true; delBtn.textContent = "Menghapus..."; }
  try {
    const json = await postApiRetry({ action: "deleteComment", id: commentId, nip: user.nip });
    if (json.error) throw new Error(json.error);
    STATE.data.comments = (STATE.data.comments || []).filter(cm => String(cm.ID) !== String(commentId));
    openModal(item.ID);
    renderKatalog();
  } catch (err) {
    alert(err.message);
    if (delBtn) { delBtn.disabled = false; delBtn.textContent = "Hapus"; }
  }
}

function closeModal() {
  document.getElementById("modal-overlay").classList.remove("open");
  document.getElementById("modal-overlay").innerHTML = "";
}

// Rantai fallback: link resolusi tinggi -> thumbnail besar -> iframe Drive
function setupImagePreviewFallback(img) {
  img.addEventListener("load", () => {
    document.getElementById("frame-loading")?.remove();
  });
  img.addEventListener("error", () => {
    const fallbackThumb = img.dataset.fallbackThumb;
    const embedUrl = img.dataset.embedUrl;
    if (fallbackThumb && img.src !== fallbackThumb) {
      img.src = fallbackThumb;
      return;
    }
    // Sudah coba semua opsi gambar langsung, fallback ke iframe Drive
    const iframe = document.createElement("iframe");
    iframe.src = embedUrl;
    iframe.setAttribute("allow", "autoplay");
    iframe.setAttribute("allowfullscreen", "true");
    iframe.addEventListener("load", () => document.getElementById("frame-loading")?.remove());
    img.replaceWith(iframe);
  });
}

// Zoom pakai scroll mouse (bebas sesuka hati) + geser (drag) saat sudah di-zoom
function setupImageZoom(img) {
  const MIN_SCALE = 1;
  const MAX_SCALE = 5;
  let scale = 1, originX = 50, originY = 50;
  let tx = 0, ty = 0;
  let panning = false, startX = 0, startY = 0, startTx = 0, startTy = 0;
  let moved = false;
  const DRAG_THRESHOLD = 5; // px, toleransi gerakan sebelum dianggap drag bukan klik

  function apply() {
    img.style.transformOrigin = `${originX}% ${originY}%`;
    img.style.transform = `scale(${scale}) translate(${tx}px, ${ty}px)`;
    img.style.cursor = scale > 1 ? "grab" : "zoom-in";
  }

  img.addEventListener("wheel", e => {
    e.preventDefault();
    const rect = img.getBoundingClientRect();
    originX = ((e.clientX - rect.left) / rect.width) * 100;
    originY = ((e.clientY - rect.top) / rect.height) * 100;
    const delta = e.deltaY > 0 ? -0.2 : 0.2;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale + delta));
    if (next === scale) return;
    scale = next;
    if (scale === MIN_SCALE) { tx = 0; ty = 0; }
    apply();
  }, { passive: false });

  img.addEventListener("click", () => {
    // Kalau ini bagian dari drag (mouse sempat bergeser cukup jauh), jangan toggle zoom
    if (moved) { moved = false; return; }
    scale = scale > MIN_SCALE ? MIN_SCALE : 2.5;
    tx = 0; ty = 0;
    apply();
  });

  img.addEventListener("mousedown", e => {
    if (scale <= MIN_SCALE) return;
    e.preventDefault();
    panning = true;
    moved = false;
    startX = e.clientX; startY = e.clientY;
    startTx = tx; startTy = ty;
    img.style.cursor = "grabbing";
  });
  window.addEventListener("mousemove", e => {
    if (!panning) return;
    if (Math.abs(e.clientX - startX) > DRAG_THRESHOLD || Math.abs(e.clientY - startY) > DRAG_THRESHOLD) {
      moved = true;
    }
    tx = startTx + (e.clientX - startX) / scale;
    ty = startTy + (e.clientY - startY) / scale;
    apply();
  });
  window.addEventListener("mouseup", () => {
    if (!panning) return;
    panning = false;
    apply();
  });

  apply();
}

function toEmbeddableUrl(link) {
  if (!link) return "";
  const match = link.match(/\/d\/([^/]+)/) || link.match(/id=([^&]+)/);
  if (match) {
    return `https://drive.google.com/file/d/${match[1]}/preview`;
  }
  return link;
}

// Buka modal login (di halaman yang sama, overlay burem) alih-alih redirect ke halaman penuh
function promptLogin() {
  closeModal();
  const loginLink = document.getElementById("login-link");
  if (loginLink) {
    loginLink.click();
  } else {
    document.getElementById("login-overlay").classList.add("open");
  }
}

async function toggleLike(item) {
  const user = currentUser();
  if (!user) {
    promptLogin();
    return;
  }
  const btn = document.getElementById("btn-like");
  btn.disabled = true;
  const wasLiked = isLikedByMe(item.ID);

  // Tampilkan spinner loading di tombol
  btn.innerHTML = `<span class="like-spinner"></span> <span id="like-label">${wasLiked ? "Disukai" : "Suka"}</span>`;

  try {
    const json = await postApiRetry({
      action: "toggleLike",
      karyaId: item.ID,
      nip: user.nip,
      nama: user.nama
    });
    if (json.error) throw new Error(json.error);

    // Perbarui state lokal
    if (wasLiked) {
      STATE.data.likes = STATE.data.likes.filter(
        l => !(String(l.KaryaId) === String(item.ID) && String(l.NIP) === String(user.nip))
      );
    } else {
      STATE.data.likes = STATE.data.likes || [];
      STATE.data.likes.push({ KaryaId: item.ID, NIP: user.nip, Nama: user.nama });
    }

    const nowLiked = !wasLiked;
    btn.classList.toggle("liked", nowLiked);
    btn.innerHTML = `${iconLike(nowLiked)} <span id="like-label">${nowLiked ? "Disukai" : "Suka"}</span>`;
    document.getElementById("like-count").textContent = `${likeCountFor(item.ID)} suka`;
    renderKatalog();
  } catch (err) {
    // Restore tombol ke kondisi semula jika gagal
    btn.innerHTML = `${iconLike(wasLiked)} <span id="like-label">${wasLiked ? "Disukai" : "Suka"}</span>`;
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function submitComment(item) {
  const user = currentUser();
  if (!user) {
    promptLogin();
    return;
  }
  const textarea = document.getElementById("comment-text");
  const msg = document.getElementById("comment-msg");
  const text = textarea.value.trim();
  if (!text) {
    msg.textContent = "Komentar tidak boleh kosong.";
    msg.className = "status-msg err";
    return;
  }

  const btn = document.getElementById("btn-comment");
  const originalBtnHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="like-spinner"></span> Mengirim...`;
  msg.textContent = "";
  msg.className = "status-msg";
  textarea.disabled = true;

  try {
    const json = await postApiRetry({
      action: "addComment",
      karyaId: item.ID,
      nip: user.nip,
      nama: user.nama,
      text
    });
    if (json.error) throw new Error(json.error);

    STATE.data.comments = STATE.data.comments || [];
    STATE.data.comments.push({
      ID: json.id,
      KaryaId: item.ID,
      NIP: user.nip,
      Nama: user.nama,
      Text: text,
      Waktu: new Date().toISOString()
    });
    textarea.value = "";
    msg.textContent = "";
    openModal(item.ID); // re-render dengan komentar terbaru
    renderKatalog(); // sinkronkan jumlah komentar di kartu galeri belakang layar
  } catch (err) {
    // Kembalikan tombol & textarea ke kondisi semula supaya user bisa coba lagi
    btn.disabled = false;
    btn.innerHTML = originalBtnHtml;
    textarea.disabled = false;
    msg.textContent = err.message;
    msg.className = "status-msg err";
  }
}
