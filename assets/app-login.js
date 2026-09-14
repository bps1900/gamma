const API_URL = "https://script.google.com/macros/s/AKfycbw4-Fi9SaSTB1Ain86-9xEGVjqLmLtnjXGv1jf-BZI79yKDTE39F5PdWPCfrFYCe6ZABQ/exec";

// ====== Helper: panggil API dengan retry otomatis khusus LOGIN ======
// PENTING (fix bug "NIP tidak ditemukan" padahal server cuma lagi lambat/cold start):
// Sebelumnya, kalau fetch gagal (timeout/network/server balikin HTML bukan JSON),
// itu langsung ditangkap jadi { error: "network" } lalu DIPERLAKUKAN SAMA seperti
// "NIP tidak ditemukan" — padahal belum tentu NIP-nya salah, bisa jadi requestnya
// memang belum sempat sampai/dibalas oleh server yang sedang lambat.
//
// Sekarang ditandai jelas lewat properti isNetworkError:
//  - Kalau server BENERAN membalas dengan error (contoh: "NIP tidak ditemukan..."
//    dari backend), itu error asli -> jangan di-retry, tampilkan apa adanya.
//  - Kalau gagal fetch/parse (server belum sempat jawab / lagi cold start / lagi
//    sibuk), itu error jaringan -> retry beberapa kali dengan jeda, baru kalau
//    semua percobaan tetap gagal, kasih tahu user bahwa ini masalah KONEKSI/SERVER,
//    bukan "NIP salah".
async function loginRequest(action, payload, retries = 3) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action, ...payload })
      });
      const json = await res.json(); // kalau server balikin HTML, ini throw -> masuk catch di bawah
      return json; // sukses dapat balasan JSON dari server (baik ok maupun error asli dari backend)
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        // Jeda makin panjang tiap percobaan, kasih waktu buat cold start Apps Script
        await new Promise(r => setTimeout(r, 800 + attempt * 700));
        continue;
      }
    }
  }
  // Semua percobaan gagal karena masalah jaringan/server, BUKAN karena NIP salah
  return { error: "network", isNetworkError: true, _detail: lastErr ? lastErr.message : "" };
}

async function doLogin() {
  const msg = document.getElementById("login-msg");
  const btn = document.getElementById("btn-login-unified");
  const input = document.getElementById("login-input");
  const val = input.value.trim();
  if (!val) {
    msg.textContent = "Masukkan NIP Anda.";
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

  // Kalau lebih dari 4 detik masih memproses, kemungkinan besar server sedang
  // cold start (bangun dari tidur) — kasih tahu user supaya tidak mengira macet.
  const slowMsgTimer = setTimeout(() => {
    if (btn.disabled) {
      btn.innerHTML = `<span class="like-spinner"></span> Server sedang bangun, mohon tunggu...`;
    }
  }, 4000);

  // Coba admin & pegawai SEKALIGUS (paralel), masing-masing dengan retry sendiri.
  const adminPromise = loginRequest("loginAdmin", { secret: val });
  const pegawaiPromise = loginRequest("loginPegawai", { nip: val });

  const [adminJson, pegawaiJson] = await Promise.all([adminPromise, pegawaiPromise]);
  clearTimeout(slowMsgTimer);

  // ====== Berhasil sebagai admin ======
  if (!adminJson.error) {
    sessionStorage.setItem("gamma_user", JSON.stringify({ role: "admin", secret: val }));
    window.location.href = "admin.html";
    return;
  }

  // ====== Berhasil sebagai pegawai ======
  if (!pegawaiJson.error) {
    sessionStorage.setItem("gamma_user", JSON.stringify({
      role: "pegawai", nama: pegawaiJson.nama, nip: pegawaiJson.nip
    }));
    window.location.href = "index.html";
    return;
  }

  // ====== Keduanya gagal — bedakan penyebabnya ======
  btn.disabled = false;
  btn.innerHTML = originalBtnHtml;
  input.disabled = false;

  const bothNetworkError = adminJson.isNetworkError && pegawaiJson.isNetworkError;

  if (bothNetworkError) {
    // Ini BUKAN berarti NIP salah — servernya yang belum sempat/bisa merespons.
    msg.textContent = "Gagal terhubung ke server (mungkin sedang lambat/sibuk). Silakan coba lagi dalam beberapa saat, JANGAN dianggap NIP salah dulu.";
    msg.className = "status-msg err";
  } else {
    // Server benar-benar sempat membalas dan bilang tidak ketemu -> baru ini valid "NIP salah"
    msg.textContent = "NIP tidak ditemukan. Hubungi admin jika belum terdaftar.";
    msg.className = "status-msg err";
  }
}

document.getElementById("btn-login-unified").addEventListener("click", doLogin);
document.getElementById("login-input").addEventListener("keydown", e => {
  if (e.key === "Enter") doLogin();
});
