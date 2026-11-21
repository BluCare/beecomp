/* =====================================================================
   BeeCOMP Service v3 — aplikasi klien (vanilla JS, tanpa jQuery/Bootstrap)
   Berjalan di 3 mode:
     - "gas"  : dibuka dari URL Web App Apps Script (pakai google.script.run)
     - "http" : dibuka dari GitHub Pages (pakai fetch ke URL Web App, lihat config.js)
     - "demo" : tanpa server (untuk uji tampilan lokal)
   ===================================================================== */
(function () {
  'use strict';

  var CONFIG = window.BEECOMP_CONFIG || {};
  var IS_GAS = typeof google !== 'undefined' && google.script && google.script.run;
  var API_URL = String(CONFIG.GAS_URL || '').trim();
  var MODE = IS_GAS ? 'gas' : (API_URL ? 'http' : 'demo');
  var DEFAULT_WA = '6285190037599';
  var STEPS = ['Menunggu', 'Diperiksa', 'Dikerjakan', 'Selesai', 'Diambil'];
  var IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

  var state = {
    wa: DEFAULT_WA,
    info: null,
    kode: '',             // kode akses pelanggan yang sedang dibuka
    statusData: null,
    admin: { token: '', nama: '', data: [], kons: {}, anggota: null, chatId: '' },
    timers: {}
  };

  // ==========================================================
  // UTIL
  // ==========================================================
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function byId(id) { return document.getElementById(id); }

  function esc(t) {
    if (t === null || t === undefined) return '';
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function rupiah(n) {
    var x = parseFloat(n);
    if (isNaN(x) || x === 0) return 'Gratis';
    return 'Rp ' + x.toLocaleString('id-ID');
  }
  function rupiahPlain(n) { return 'Rp ' + (Math.round(parseFloat(n) || 0)).toLocaleString('id-ID'); }
  function normKode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function fmtKode(s) { s = normKode(s).slice(0, 10); return s.length > 5 ? s.slice(0, 5) + '-' + s.slice(5) : s; }
  function normWA(s) {
    var d = String(s || '').replace(/[^0-9]/g, '');
    if (d.charAt(0) === '0') d = '62' + d.slice(1);
    else if (d.charAt(0) === '8') d = '62' + d;
    return d;
  }
  function inisial(nama) {
    var p = String(nama || '?').trim().split(/\s+/);
    return ((p[0] || '?').charAt(0) + (p[1] ? p[1].charAt(0) : '')).toUpperCase();
  }
  function store(kind) {
    var s = null;
    try { s = window[kind]; var k = '__t'; s.setItem(k, '1'); s.removeItem(k); } catch (e) { s = null; }
    return {
      get: function (k) { try { return s ? s.getItem(k) : null; } catch (e) { return null; } },
      set: function (k, v) { try { if (s) s.setItem(k, v); } catch (e) {} },
      del: function (k) { try { if (s) s.removeItem(k); } catch (e) {} }
    };
  }
  var local = store('localStorage');
  var session = store('sessionStorage');

  function debounce(fn, ms) {
    var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); };
  }
  function setLoading(btn, on, teks) {
    if (!btn) return;
    if (on) {
      btn.dataset.html = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + esc(teks || 'Memproses…');
    } else {
      btn.disabled = false;
      if (btn.dataset.html) btn.innerHTML = btn.dataset.html;
    }
  }
  function badgeStatus(st) {
    var k = { 'Menunggu': 'st-menunggu', 'Diperiksa': 'st-diperiksa', 'Dikerjakan': 'st-dikerjakan', 'Selesai': 'st-selesai', 'Diambil': 'st-diambil', 'Dibatalkan': 'st-batal' }[st] || 'st-menunggu';
    return '<span class="badge ' + k + '">' + esc(st || '-') + '</span>';
  }
  function badgeBayar(sb) {
    if (sb === 'Lunas') return '<span class="badge bayar-lunas"><i class="fa-solid fa-check"></i> Lunas</span>';
    if (sb === 'Menunggu Pembayaran') return '<span class="badge bayar-menunggu">Menunggu Bayar</span>';
    return '';
  }
  function kelasVoucher(sv) {
    if (sv === 'Tervalidasi') return 'st-selesai';
    if (String(sv || '').indexOf('Ditolak') !== -1) return 'st-batal';
    return 'st-menunggu';
  }
  function biayaAkhirDari(a) {
    return (a.biayaAkhir !== '' && a.biayaAkhir !== null && a.biayaAkhir !== undefined) ? a.biayaAkhir : (a.biaya - (a.potonganVoucher || 0));
  }
  function salin(teks) {
    function ok() { toast('Disalin: ' + teks, 'success'); }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(teks).then(ok, fallback);
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = teks; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch (e) { toast('Gagal menyalin', 'error'); }
      document.body.removeChild(ta);
    }
  }

  // ==========================================================
  // API — satu pintu untuk GAS / HTTP / DEMO
  // ==========================================================
  function api(action) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (MODE === 'gas') {
      return new Promise(function (resolve, reject) {
        var r = google.script.run.withSuccessHandler(resolve).withFailureHandler(reject);
        r[action].apply(r, args);
      });
    }
    if (MODE === 'http') {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 30000) : null;
      return fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, args: args }),
        redirect: 'follow',
        credentials: 'omit',
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }, function (err) { if (timer) clearTimeout(timer); throw err; });
    }
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(Demo.handle(action, args)); }, 300);
    });
  }

  function apiAdmin(action) {
    var args = Array.prototype.slice.call(arguments, 1);
    return api.apply(null, [action, state.admin.token].concat(args)).then(function (res) {
      if (res && res.code === 'AUTH') {
        adminResetLokal();
        toast(res.message || 'Sesi berakhir, silakan login ulang.', 'error');
        tampilLogin();
      }
      return res;
    });
  }

  function pesanError(res, fallback) { return (res && res.message) || fallback || 'Terjadi kesalahan.'; }
  function errKoneksi() { toast('Koneksi ke server gagal. Periksa internet Anda lalu coba lagi.', 'error'); }

  // ==========================================================
  // MODAL
  // ==========================================================
  var Modal = {
    stack: [],
    onClose: {},
    open: function (id) {
      var el = byId(id);
      if (!el) return;
      if (this.stack.indexOf(id) !== -1) { this.stack.splice(this.stack.indexOf(id), 1); }
      this.stack.push(id);
      el.style.zIndex = String(100 + this.stack.length);
      if (el.hidden) {
        el._lastFocus = document.activeElement;
        el.hidden = false;
        void el.offsetWidth; // reflow agar transisi berjalan
        el.classList.add('is-open');
      }
      document.body.classList.add('modal-open');
      if (!IS_TOUCH) {
        var f = el.querySelector('[data-autofocus]') || el.querySelector('input:not([type=hidden]):not(.hp):not([type=radio]):not([type=checkbox]), textarea');
        if (f && f.offsetParent !== null) setTimeout(function () { try { f.focus(); } catch (e) {} }, 80);
      }
    },
    close: function (id) {
      var el = byId(id);
      if (!el || el.hidden) return;
      el.classList.remove('is-open');
      var idx = this.stack.indexOf(id);
      if (idx !== -1) this.stack.splice(idx, 1);
      setTimeout(function () { if (!el.classList.contains('is-open')) el.hidden = true; }, 220);
      if (!this.stack.length) document.body.classList.remove('modal-open');
      if (typeof this.onClose[id] === 'function') this.onClose[id]();
      if (el._lastFocus && el._lastFocus.focus && !IS_TOUCH) { try { el._lastFocus.focus(); } catch (e) {} }
    },
    top: function () { return this.stack[this.stack.length - 1]; },
    isOpen: function (id) { return this.stack.indexOf(id) !== -1; }
  };

  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-close]');
    if (c) {
      var m = c.closest('.modal');
      if (m) Modal.close(m.id);
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && Modal.top()) Modal.close(Modal.top());
  });

  // ==========================================================
  // TOAST / INFO / KONFIRMASI
  // ==========================================================
  function toast(msg, type) {
    var wrap = byId('toastWrap');
    var icon = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' }[type || 'info'];
    var el = document.createElement('div');
    el.className = 'toast toast--' + (type || 'info');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = '<i class="fa-solid ' + icon + '"></i><span></span>';
    el.querySelector('span').textContent = msg;
    wrap.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
    }, type === 'error' ? 5500 : 3800);
  }

  function showInfo(judul, html, tipe, extraFootHtml) {
    var icon = byId('mInfoIcon');
    icon.className = 'info-icon' + (tipe === 'error' ? ' is-error' : tipe === 'warn' ? ' is-warn' : '');
    icon.innerHTML = '<i class="fa-solid ' + (tipe === 'error' ? 'fa-circle-exclamation' : tipe === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-check') + '"></i>';
    byId('mInfoT').textContent = judul;
    byId('mInfoMsg').innerHTML = html;
    byId('mInfoFoot').innerHTML = (extraFootHtml || '') + '<button class="btn btn--accent" type="button" data-close>Tutup</button>';
    Modal.open('mInfo');
  }

  var confirmCb = null;
  function konfirmasi(judul, html, onOk, opsi) {
    opsi = opsi || {};
    byId('mConfirmT').textContent = judul;
    byId('mConfirmMsg').innerHTML = html;
    var ok = byId('btnConfirmOk');
    ok.className = 'btn ' + (opsi.danger ? 'btn--danger' : 'btn--accent');
    ok.textContent = opsi.okText || 'Ya, Lanjutkan';
    confirmCb = onOk;
    Modal.open('mConfirm');
    var first = byId('mConfirmMsg').querySelector('input, textarea');
    if (first) setTimeout(function () { first.focus(); }, 120);
  }
  byId('btnConfirmOk').addEventListener('click', function () {
    var cb = confirmCb; confirmCb = null;
    var hasil = cb ? cb() : true;
    if (hasil !== false) Modal.close('mConfirm');
  });
  byId('mConfirmMsg').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); byId('btnConfirmOk').click(); }
  });

  // ==========================================================
  // TEMA GELAP / TERANG
  // ==========================================================
  function setTema(tema, simpan) {
    if (tema === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    byId('iconTheme').className = 'fa-solid ' + (tema === 'dark' ? 'fa-sun' : 'fa-moon');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', tema === 'dark' ? '#0a111e' : '#004E98');
    if (simpan) local.set('beecomp_theme', tema);
  }
  setTema(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light', false);
  byId('btnTheme').addEventListener('click', function () {
    setTema(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true);
  });

  // ==========================================================
  // INFO USAHA (dengan cache lokal agar tampil instan)
  // ==========================================================
  function terapkanInfo(res) {
    if (!res || res.status !== 'success') return;
    state.info = res;
    if (res.namaUsaha) {
      byId('navNamaUsaha').textContent = res.namaUsaha;
      byId('footerNamaUsaha').textContent = res.namaUsaha;
      document.title = res.namaUsaha + ' | Antri Servis Online';
    }
    if (res.tagline) byId('navTagline').textContent = res.tagline;
    byId('footerAlamat').textContent = res.alamat || '';
    byId('alamatLokasi').textContent = res.alamat && res.alamat !== '-' ? res.alamat : '';
    if (res.jamOperasional) { byId('jamOperasionalLabel').textContent = 'Jam operasional: ' + res.jamOperasional; byId('jamWrap').hidden = false; }
    if (res.noWhatsApp) state.wa = String(res.noWhatsApp).trim();
    if (res.logoUrl && /^https:\/\//.test(res.logoUrl)) byId('brandLogoImg').src = res.logoUrl;

    var teks = String(res.infoPromo || '').trim();
    byId('marquee1').textContent = teks;
    byId('marquee2').textContent = teks;
    byId('marquee').hidden = !teks;

    var ang = res.anggota || {};
    var manfaatHtml = (ang.manfaat || []).map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('');
    byId('anggotaManfaatBanner').innerHTML = manfaatHtml;
    byId('anggotaManfaat').innerHTML = manfaatHtml;
    byId('anggotaKetentuan').innerHTML = (ang.ketentuan || []).map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('');
    if (ang.deskripsi) {
      byId('anggotaDeskripsi').textContent = ang.deskripsi;
      byId('anggotaDeskripsiBanner').textContent = ang.deskripsi;
    }
  }

  function muatInfoUsaha() {
    var cached = local.get('beecomp_info_v3');
    if (cached) { try { terapkanInfo(JSON.parse(cached)); } catch (e) {} }
    api('getInfoUsaha').then(function (res) {
      terapkanInfo(res);
      if (res && res.status === 'success') local.set('beecomp_info_v3', JSON.stringify(res));
    }, function () {});
  }

  byId('btnHelpdesk').addEventListener('click', function () {
    var nomor = normWA(state.wa || DEFAULT_WA);
    var pesan = 'Halo Admin, saya butuh bantuan/informasi terkait antrian servis saya.';
    window.open('https://wa.me/' + nomor + '?text=' + encodeURIComponent(pesan), '_blank', 'noopener');
  });

  // ==========================================================
  // PAPAN ANTRIAN (polling 30 dtk, berhenti saat tab tidak terlihat)
  // ==========================================================
  function renderPapan(res) {
    var wrap = byId('papanWrap');
    var r = (res && res.ringkas) || null;
    byId('statTotal').textContent = r ? r.total : '0';
    byId('statMenunggu').textContent = r ? r.menunggu : '0';
    byId('statProses').textContent = r ? r.proses : '0';
    byId('statSelesai').textContent = r ? r.selesai : '0';
    var now = new Date();
    byId('papanUpdated').textContent = 'diperbarui ' + ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);

    if (!res || res.status !== 'success' || !res.data || !res.data.length) {
      wrap.innerHTML = '<div class="empty"><i class="fa-regular fa-calendar-check"></i>Belum ada antrian aktif hari ini. Jadilah yang pertama!</div>';
      return;
    }
    wrap.innerHTML = res.data.map(function (a) {
      var cls = a.status === 'Dikerjakan' ? 'is-proses' : a.status === 'Diperiksa' ? 'is-periksa' : a.status === 'Selesai' ? 'is-selesai' : '';
      return '<div class="tile ' + cls + '"><div class="tile__no">' + esc(a.noAntrian) + '</div>' +
        '<div class="tile__cat">' + esc(a.kategori || '-') + '</div>' + badgeStatus(a.status) + '</div>';
    }).join('');
  }
  function muatPapan() {
    return api('getAntrianAktifPublik').then(renderPapan, function () {
      byId('papanUpdated').textContent = 'offline';
    });
  }
  function mulaiPollingPapan() {
    clearInterval(state.timers.papan);
    state.timers.papan = setInterval(function () { if (!document.hidden) muatPapan(); }, 30000);
  }
  byId('btnRefreshPapan').addEventListener('click', function () {
    var b = this; setLoading(b, true, 'Memuat');
    muatPapan().then(function () { setLoading(b, false); });
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) muatPapan(); });

  // ==========================================================
  // NAVIGASI & LOGO (5x ketuk = panel admin tersembunyi)
  // ==========================================================
  var pembuka = {
    antri: bukaAntri,
    status: function () { bukaStatus(); },
    tanya: function () { bukaTanya(); },
    anggota: bukaAnggota
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-open]');
    if (!b) return;
    e.preventDefault();
    var fn = pembuka[b.getAttribute('data-open')];
    if (fn) fn();
  });
  $('.skip-link').addEventListener('click', function (e) { e.preventDefault(); byId('main').focus(); });
  $all('[data-nav="home"]').forEach(function (b) {
    b.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  });

  (function logoRahasia() {
    var logo = byId('brandLogo');
    var hitung = 0, timer = null;
    logo.addEventListener('click', function (e) {
      e.preventDefault();
      hitung++;
      logo.classList.add('tap');
      setTimeout(function () { logo.classList.remove('tap'); }, 120);
      clearTimeout(timer);
      if (hitung >= 5) { hitung = 0; bukaAdmin(); return; }
      if (hitung === 1) window.scrollTo({ top: 0, behavior: 'smooth' });
      timer = setTimeout(function () { hitung = 0; }, 1600);
    });
  })();

  // ==========================================================
  // FORM AMBIL ANTRIAN
  // ==========================================================
  function bukaAntri() {
    Modal.open('mAntri');
  }

  function tandaiInvalid(el, on) { if (el) el.classList.toggle('is-invalid', !!on); }
  $all('input, textarea').forEach(function (el) { el.addEventListener('input', function () { tandaiInvalid(el, false); }); });
  $all('#segKategori input').forEach(function (el) { el.addEventListener('change', function () { tandaiInvalid(byId('segKategori'), false); }); });

  byId('formAntri').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var kat = f.querySelector('input[name="kategori"]:checked');
    var payload = {
      nama: f.nama.value.trim(), wa: f.wa.value.trim(), email: f.email.value.trim(),
      kategori: kat ? kat.value : '', tipe: f.tipe.value.trim(), keluhan: f.keluhan.value.trim(),
      kodeVoucher: f.kodeVoucher.value.trim().toUpperCase(), website: f.website.value
    };
    var salah = null;
    function cek(gagal, el) { if (gagal) { tandaiInvalid(el, true); salah = salah || el; } }
    cek(!payload.nama, f.nama);
    cek(normWA(payload.wa).length < 10, f.wa);
    cek(!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(payload.email), f.email);
    cek(!payload.kategori, byId('segKategori'));
    cek(!payload.tipe, f.tipe);
    cek(!payload.keluhan, f.keluhan);
    if (salah) {
      toast('Mohon lengkapi data yang ditandai merah.', 'error');
      if (salah.focus) salah.focus();
      if (salah.scrollIntoView) salah.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    var btn = byId('btnSubmitAntri');
    setLoading(btn, true, 'Mendaftarkan…');
    api('daftarAntrian', payload).then(function (res) {
      setLoading(btn, false);
      if (!res || res.status !== 'success') { toast(pesanError(res, 'Gagal mendaftar antrian.'), 'error'); return; }
      Modal.close('mAntri');
      f.reset();
      var html = 'Nomor antrian Anda:<span class="big-no selectable">' + esc(res.noAntrian) + '</span>';
      var tipe = 'success';
      if (res.emailTerkirim === false) {
        tipe = 'warn';
        html += '<div class="note"><strong>Email konfirmasi gagal terkirim.</strong> Hubungi Helpdesk WhatsApp untuk mendapatkan kode akses Anda.</div>';
      } else {
        html += '<div class="note"><i class="fa-solid fa-envelope"></i> <strong>Kode akses rahasia</strong> telah dikirim ke <strong>' + esc(res.emailSamaran || 'email Anda') + '</strong>. Gunakan kode itu untuk cek progres &amp; konsultasi. Cek juga folder Spam/Promosi.</div>';
      }
      showInfo('Pendaftaran Berhasil', html, tipe);
      muatPapan();
    }, function () { setLoading(btn, false); errKoneksi(); });
  });

  // ==========================================================
  // INPUT KODE AKSES (format otomatis XXXXX-XXXXX)
  // ==========================================================
  $all('.code-input').forEach(function (el) {
    el.addEventListener('input', function () {
      var v = fmtKode(el.value);
      if (v !== el.value) el.value = v;
    });
  });

  // ==========================================================
  // CEK PROGRES (hanya dengan kode akses)
  // ==========================================================
  function bukaStatus(kode) {
    Modal.open('mStatus');
    if (kode) { byId('inKodeStatus').value = fmtKode(kode); cekStatus(); }
    else if (state.kode && !byId('hasilStatus').innerHTML) byId('inKodeStatus').value = fmtKode(state.kode);
  }

  function cekStatus() {
    var kode = normKode(byId('inKodeStatus').value);
    var wrap = byId('hasilStatus');
    if (kode.length !== 10) {
      tandaiInvalid(byId('inKodeStatus'), true);
      toast('Kode akses terdiri dari 10 karakter (cek email konfirmasi).', 'error');
      return;
    }
    var btn = byId('btnCekStatus');
    setLoading(btn, true, '');
    wrap.innerHTML = '<div class="state-msg"><i class="fa-solid fa-spinner fa-spin"></i> Mencari data…</div>';
    api('cekStatusAntrian', kode).then(function (res) {
      setLoading(btn, false);
      if (!res || res.status !== 'success') {
        wrap.innerHTML = '<div class="state-msg"><i class="fa-solid fa-circle-exclamation"></i> ' + esc(pesanError(res, 'Data tidak ditemukan.')) + '</div>';
        return;
      }
      state.kode = kode;
      session.set('beecomp_kode', kode);
      state.statusData = res.data;
      wrap.innerHTML = renderHasilStatus(res.data);
    }, function () { setLoading(btn, false); wrap.innerHTML = ''; errKoneksi(); });
  }
  byId('formStatus').addEventListener('submit', function (e) { e.preventDefault(); cekStatus(); });

  function renderProgress(status) {
    if (status === 'Dibatalkan') return '<div class="note note--warn" style="margin-bottom:14px;"><i class="fa-solid fa-ban"></i> Antrian ini telah dibatalkan.</div>';
    var idx = STEPS.indexOf(status);
    return '<div class="progress" aria-label="Progres servis">' + STEPS.map(function (s, i) {
      var cls = i < idx || (i === idx && s === 'Diambil') ? 'done' : i === idx ? 'now' : '';
      return '<div class="progress__step ' + cls + '"><div class="progress__bar"></div>' + esc(s) + '</div>';
    }).join('') + '</div>';
  }

  function renderBiaya(a) {
    if (a.biaya === '' || a.biaya === null || a.biaya === undefined) return '';
    var punyaPot = Number(a.potonganVoucher) > 0;
    if (!punyaPot) {
      return '<div class="bill"><div class="bill__row bill__total"><span>Biaya Servis</span><span>' + esc(rupiah(a.biaya)) + '</span></div>' +
        (badgeBayar(a.statusBayar) ? '<div class="bill__row" style="justify-content:flex-end;margin-top:6px;">' + badgeBayar(a.statusBayar) + '</div>' : '') + '</div>';
    }
    return '<div class="bill">' +
      '<div class="bill__row"><span>Biaya Servis</span><span class="strike">' + esc(rupiah(a.biaya)) + '</span></div>' +
      '<div class="bill__row text-green"><span>Potongan Voucher</span><span>-' + esc(rupiahPlain(a.potonganVoucher)) + '</span></div>' +
      '<div class="bill__row bill__total"><span>Total Ditagih</span><span>' + esc(rupiah(biayaAkhirDari(a))) + '</span></div>' +
      '<div class="bill__row" style="justify-content:flex-end;margin-top:6px;">' + badgeBayar(a.statusBayar) + '</div></div>';
  }

  function renderHasilStatus(a) {
    var timeline = (a.timeline || []).slice().reverse().map(function (t) {
      return '<li>' + badgeStatus(t.status) + '<time>' + esc(t.waktu) + '</time>' + (t.catatan ? '<p>' + esc(t.catatan) + '</p>' : '') + '</li>';
    }).join('');
    var voucher = a.kodeVoucher && a.kodeVoucher !== '-'
      ? '<dt>Voucher</dt><dd>' + esc(a.kodeVoucher) + ' <span class="badge ' + kelasVoucher(a.statusVoucher) + '">' + esc(a.statusVoucher || '-') + '</span></dd>' : '';
    var btnKuitansi = a.statusBayar === 'Lunas'
      ? '<button class="btn btn--success" type="button" data-kuitansi-kode="1"><i class="fa-solid fa-receipt"></i> Unduh Kuitansi</button>' : '';
    return '<div class="result">' +
      '<div class="result__head"><div><div class="result__no selectable">' + esc(a.noAntrian) + '</div>' +
      '<div class="result__meta">' + esc(a.tipe) + ' &middot; ' + esc(a.tanggal) + '</div></div>' + badgeStatus(a.status) + '</div>' +
      '<div class="result__body">' + renderProgress(a.status) +
      '<dl class="kv"><dt>Nama</dt><dd>' + esc(a.nama) + '</dd><dt>Perangkat</dt><dd>' + esc(a.kategori) + ' &middot; ' + esc(a.tipe) + '</dd>' +
      '<dt>Keluhan</dt><dd>' + esc(a.keluhan) + '</dd>' +
      (a.catatanAdmin ? '<dt>Catatan</dt><dd>' + esc(a.catatanAdmin) + '</dd>' : '') + voucher + '</dl>' +
      renderBiaya(a) +
      '<div class="result__actions">' +
        '<button class="btn btn--primary" type="button" data-tanya-kode="1"><i class="fa-solid fa-comments"></i> Tanya Teknisi' +
          (a.pesanBaru > 0 ? ' <span class="dot-badge">' + Number(a.pesanBaru) + '</span>' : '') + '</button>' +
        btnKuitansi +
        '<button class="btn btn--soft" type="button" data-refresh-status="1"><i class="fa-solid fa-rotate"></i> Perbarui</button>' +
      '</div>' +
      '<h3 class="sub-title">Riwayat Proses</h3><ul class="timeline">' + (timeline || '<li><p>Belum ada riwayat.</p></li>') + '</ul>' +
      '</div></div>';
  }

  byId('hasilStatus').addEventListener('click', function (e) {
    if (e.target.closest('[data-tanya-kode]')) bukaTanya(state.kode);
    else if (e.target.closest('[data-kuitansi-kode]')) bukaKuitansi({ kode: state.kode });
    else if (e.target.closest('[data-refresh-status]')) cekStatus();
  });

  // ==========================================================
  // KONSULTASI PELANGGAN
  // ==========================================================
  function bukaTanya(kode) {
    Modal.open('mTanya');
    var k = normKode(kode || state.kode || session.get('beecomp_kode') || '');
    if (k.length === 10) { byId('inKodeTanya').value = fmtKode(k); muatTanya(k, true); }
    else tampilTanyaKode();
  }
  function tampilTanyaKode() {
    byId('tanyaStepKode').hidden = false;
    byId('tanyaStepChat').hidden = true;
    stopPolling('tanya');
  }
  function renderChat(listEl, pesan, sayaAdalah) {
    if (!pesan || !pesan.length) {
      listEl.innerHTML = '<div class="chat__empty"><i class="fa-regular fa-comments"></i>' +
        (sayaAdalah === 'pelanggan' ? 'Belum ada percakapan. Tulis pertanyaan Anda tentang servis ini, teknisi kami akan membalas secepatnya.' : 'Belum ada pesan.') + '</div>';
      return;
    }
    var nearBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 80;
    var lama = listEl.dataset.count | 0;
    listEl.innerHTML = pesan.map(function (m) {
      var saya = m.dari === sayaAdalah;
      return '<div class="bubble ' + (saya ? 'bubble--me' : 'bubble--other') + '">' +
        (!saya ? '<strong>' + esc(m.dari === 'admin' ? (m.nama || 'Teknisi') + ' · Teknisi' : m.nama || 'Pelanggan') + '</strong>' : '') +
        esc(m.pesan) + '<small>' + esc(m.waktu) + '</small></div>';
    }).join('');
    if (nearBottom || pesan.length !== lama) listEl.scrollTop = listEl.scrollHeight;
    listEl.dataset.count = pesan.length;
  }
  function muatTanya(kode, tampilLoading) {
    var btn = byId('btnBukaTanya');
    if (tampilLoading) setLoading(btn, true, '');
    return api('getKonsultasiPelanggan', kode).then(function (res) {
      setLoading(btn, false);
      if (!res || res.status !== 'success') {
        tampilTanyaKode();
        toast(pesanError(res, 'Kode akses tidak ditemukan.'), 'error');
        return;
      }
      state.kode = kode;
      session.set('beecomp_kode', kode);
      byId('tanyaStepKode').hidden = true;
      byId('tanyaStepChat').hidden = false;
      var i = res.info || {};
      byId('tanyaInfo').innerHTML = '<span><strong>' + esc(i.noAntrian) + '</strong> &middot; ' + esc(i.tipe) + '</span>' +
        '<span>' + badgeStatus(i.status) + ' <button type="button" class="btn btn--soft btn--xs" id="btnGantiKode">Ganti kode</button></span>';
      renderChat(byId('tanyaList'), res.pesan, 'pelanggan');
      mulaiPolling('tanya', function () { return muatTanya(state.kode, false); }, 15000, 'mTanya');
    }, function () { setLoading(btn, false); if (tampilLoading) errKoneksi(); });
  }
  byId('formTanyaKode').addEventListener('submit', function (e) {
    e.preventDefault();
    var k = normKode(byId('inKodeTanya').value);
    if (k.length !== 10) { tandaiInvalid(byId('inKodeTanya'), true); toast('Kode akses terdiri dari 10 karakter.', 'error'); return; }
    muatTanya(k, true);
  });
  byId('tanyaInfo').addEventListener('click', function (e) {
    if (e.target.closest('#btnGantiKode')) { byId('inKodeTanya').value = ''; tampilTanyaKode(); }
  });

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }
  function pasangChatInput(ta, form) {
    ta.addEventListener('input', function () { autoGrow(ta); });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !IS_TOUCH) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); }
    });
  }
  pasangChatInput(byId('inPesanTanya'), byId('formTanyaPesan'));
  pasangChatInput(byId('inPesanAdmin'), byId('formAdminChat'));

  byId('formTanyaPesan').addEventListener('submit', function (e) {
    e.preventDefault();
    var ta = byId('inPesanTanya');
    var pesan = ta.value.trim();
    if (!pesan) return;
    var btn = byId('btnKirimTanya');
    setLoading(btn, true, '');
    api('kirimKonsultasiPelanggan', state.kode, pesan).then(function (res) {
      setLoading(btn, false);
      if (!res || res.status !== 'success') { toast(pesanError(res, 'Pesan gagal dikirim.'), 'error'); return; }
      ta.value = ''; autoGrow(ta);
      renderChat(byId('tanyaList'), res.pesan, 'pelanggan');
      byId('tanyaList').scrollTop = byId('tanyaList').scrollHeight;
    }, function () { setLoading(btn, false); errKoneksi(); });
  });

  function mulaiPolling(nama, fn, ms, modalId) {
    stopPolling(nama);
    state.timers[nama] = setInterval(function () {
      if (document.hidden || (modalId && !Modal.isOpen(modalId))) return;
      fn();
    }, ms);
  }
  function stopPolling(nama) { clearInterval(state.timers[nama]); state.timers[nama] = null; }
  Modal.onClose.mTanya = function () { stopPolling('tanya'); };
  Modal.onClose.mAdminChat = function () { stopPolling('adminChat'); state.admin.chatId = ''; };

  // ==========================================================
  // ANGGOTA
  // ==========================================================
  function bukaAnggota() { Modal.open('mAnggota'); }

  byId('formAnggota').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var p = {
      nama: byId('aNama').value.trim(), wa: byId('aWA').value.trim(), email: byId('aEmail').value.trim(),
      alamat: byId('aAlamat').value.trim(), setuju: byId('aSetuju').checked, website: f.website.value
    };
    var salah = null;
    if (!p.nama) { tandaiInvalid(byId('aNama'), true); salah = salah || byId('aNama'); }
    if (normWA(p.wa).length < 10) { tandaiInvalid(byId('aWA'), true); salah = salah || byId('aWA'); }
    if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(p.email)) { tandaiInvalid(byId('aEmail'), true); salah = salah || byId('aEmail'); }
    if (salah) { toast('Mohon lengkapi data yang ditandai merah.', 'error'); salah.focus(); return; }
    if (!p.setuju) { toast('Centang persetujuan syarat & ketentuan terlebih dahulu.', 'error'); byId('aSetuju').focus(); return; }

    var btn = byId('btnSubmitAnggota');
    setLoading(btn, true, 'Mendaftarkan…');
    api('daftarAnggota', p).then(function (res) {
      setLoading(btn, false);
      if (!res || res.status !== 'success') { toast(pesanError(res, 'Pendaftaran gagal.'), 'error'); return; }
      Modal.close('mAnggota');
      f.reset();
      showInfo('Pendaftaran Anggota Diterima',
        'ID Anggota Anda:<span class="big-no selectable" style="font-size:1.8rem;">' + esc(res.idAnggota) + '</span>' +
        '<div class="note">Keanggotaan akan <strong>aktif setelah diverifikasi admin</strong>. Konfirmasi dikirim ke <strong>' + esc(res.emailSamaran || 'email Anda') + '</strong>.</div>', 'success');
    }, function () { setLoading(btn, false); errKoneksi(); });
  });

  // ==========================================================
  // KUITANSI
  // ==========================================================
  function bukaKuitansi(opsi) {
    byId('kuitansiStyle').innerHTML = '';
    byId('kuitansiBody').innerHTML = '<div class="state-msg"><i class="fa-solid fa-spinner fa-spin"></i> Memuat kuitansi…</div>';
    Modal.open('mKuitansi');
    var p = opsi.id ? apiAdmin('adminGetReceipt', opsi.id) : api('getReceiptHtmlContent', opsi.kode);
    p.then(function (res) {
      if (res && res.success) {
        byId('kuitansiStyle').innerHTML = res.styleHtml || '';
        byId('kuitansiBody').innerHTML = res.bodyHtml; // sudah di-escape di server
      } else {
        byId('kuitansiBody').innerHTML = '<div class="state-msg"><strong>Gagal menampilkan kuitansi</strong><br>' + esc(pesanError(res, 'Data tidak ditemukan.')) + '</div>';
      }
    }, function () { byId('kuitansiBody').innerHTML = '<div class="state-msg">Terjadi kesalahan saat memuat kuitansi.</div>'; });
  }
  byId('btnCetak').addEventListener('click', function () {
    document.body.classList.add('printing');
    setTimeout(function () { window.print(); }, 50);
    setTimeout(function () { document.body.classList.remove('printing'); }, 1500);
  });
  window.addEventListener('afterprint', function () { document.body.classList.remove('printing'); });

  // ==========================================================
  // ADMIN
  // ==========================================================
  function bukaAdmin() {
    Modal.open('mAdmin');
    var sesiTersimpan = null;
    try { sesiTersimpan = JSON.parse(session.get('beecomp_adm') || 'null'); } catch (e) {}
    if (state.admin.token) { tampilDashboard(); muatDashboard(); return; }
    if (sesiTersimpan && sesiTersimpan.token) {
      state.admin.token = sesiTersimpan.token;
      api('adminCekSesi', sesiTersimpan.token).then(function (res) {
        if (res && res.status === 'success') { state.admin.nama = res.namaAdmin; tampilDashboard(); muatDashboard(); }
        else { adminResetLokal(); tampilLogin(); }
      }, function () { adminResetLokal(); tampilLogin(); });
    } else tampilLogin();
  }
  Modal.onClose.mAdmin = function () { stopPolling('admin'); byId('privacyOverlay').hidden = true; };

  function tampilLogin() {
    byId('adminLogin').hidden = false;
    byId('adminDash').hidden = true;
    byId('btnAdminReload').hidden = true;
    byId('btnAdminLogout').hidden = true;
    byId('adminWelcome').textContent = 'Silakan login';
    setTimeout(function () { if (!IS_TOUCH) byId('adminUser').focus(); }, 100);
  }
  function tampilDashboard() {
    byId('adminLogin').hidden = true;
    byId('adminDash').hidden = false;
    byId('btnAdminReload').hidden = false;
    byId('btnAdminLogout').hidden = false;
    byId('adminWelcome').textContent = 'Halo, ' + state.admin.nama;
    pasangWatermark(state.admin.nama);
    mulaiPolling('admin', function () { muatDashboard(true); }, 60000, 'mAdmin');
  }
  function adminResetLokal() {
    state.admin.token = ''; state.admin.nama = ''; state.admin.data = []; state.admin.kons = {}; state.admin.anggota = null;
    session.del('beecomp_adm');
    stopPolling('admin');
  }

  byId('btnTogglePass').addEventListener('click', function () {
    var p = byId('adminPass');
    var lihat = p.type === 'password';
    p.type = lihat ? 'text' : 'password';
    this.innerHTML = '<i class="fa-solid ' + (lihat ? 'fa-eye-slash' : 'fa-eye') + '"></i>';
  });

  byId('formLogin').addEventListener('submit', function (e) {
    e.preventDefault();
    var u = byId('adminUser').value.trim(), p = byId('adminPass').value;
    if (!u || !p) { toast('Isi username dan password.', 'error'); return; }
    var btn = byId('btnLogin');
    setLoading(btn, true, 'Memverifikasi…');
    api('loginAdmin', u, p).then(function (res) {
      setLoading(btn, false);
      if (!res || res.status !== 'success') { toast(pesanError(res, 'Login gagal.'), 'error'); return; }
      state.admin.token = res.token;
      state.admin.nama = res.namaAdmin || 'Admin';
      session.set('beecomp_adm', JSON.stringify({ token: res.token }));
      byId('adminPass').value = '';
      tampilDashboard();
      muatDashboard();
    }, function () { setLoading(btn, false); errKoneksi(); });
  });

  byId('btnAdminLogout').addEventListener('click', function () {
    var t = state.admin.token;
    adminResetLokal();
    if (t) api('adminLogout', t).catch(function () {});
    tampilLogin();
    toast('Anda telah keluar.', 'info');
  });
  byId('btnAdminReload').addEventListener('click', function () {
    var b = this; setLoading(b, true, '');
    muatDashboard().then(function () { setLoading(b, false); });
    if (aktifTab() === 'anggota') muatAnggota();
  });

  function pasangWatermark(nama) {
    var teks = esc((nama || 'Admin') + ' • ' + new Date().toLocaleString('id-ID'));
    var html = '';
    for (var i = 0; i < 48; i++) html += '<span>' + teks + '</span>';
    byId('adminWatermark').innerHTML = html;
  }

  function muatDashboard(diam) {
    if (!diam) byId('admList').innerHTML = '<div class="state-msg"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data antrian…</div>';
    var p1 = apiAdmin('getAllAntrianServis').then(function (res) {
      if (!res || res.status !== 'success') {
        if (!diam && res && res.code !== 'AUTH') byId('admList').innerHTML = '<div class="state-msg">' + esc(pesanError(res, 'Gagal memuat data.')) + '</div>';
        return;
      }
      state.admin.data = res.data || [];
      state.admin.kons = res.konsultasi || {};
      renderAdmin();
      if (state.admin.chatId && Modal.isOpen('mAdminChat')) { /* polling chat menangani */ }
    }, function () { if (!diam) { byId('admList').innerHTML = '<div class="state-msg">Koneksi ke server gagal.</div>'; } });
    if (!diam || state.admin.anggota === null) muatAnggota(true);
    return p1;
  }

  function renderAdmin() {
    renderStats();
    renderAntrianAdmin();
    renderThreads();
  }

  // ---------- Statistik ----------
  function hitungStat() {
    var d = state.admin.data, s = { all: d.length, aktif: 0, Menunggu: 0, Diperiksa: 0, Dikerjakan: 0, bayar: 0, voucher: 0 };
    d.forEach(function (a) {
      if (['Menunggu', 'Diperiksa', 'Dikerjakan'].indexOf(a.status) !== -1 || (a.status === 'Selesai')) s.aktif++;
      if (s[a.status] !== undefined && a.status !== 'all') s[a.status]++;
      if (a.status === 'Selesai' && a.statusBayar === 'Menunggu Pembayaran') s.bayar++;
      if (a.statusVoucher === 'Menunggu Validasi') s.voucher++;
    });
    return s;
  }
  function renderStats() {
    var s = hitungStat(), f = byId('filterStatus').value;
    var items = [['', 'Semua', s.all], ['aktif', 'Aktif', s.aktif], ['Menunggu', 'Menunggu', s.Menunggu], ['Diperiksa', 'Diperiksa', s.Diperiksa],
      ['Dikerjakan', 'Dikerjakan', s.Dikerjakan], ['bayar', 'Belum Bayar', s.bayar], ['voucher', 'Cek Voucher', s.voucher]];
    byId('adminStats').innerHTML = items.map(function (it) {
      return '<button type="button" class="stat-chip' + (f === it[0] ? ' is-active' : '') + '" data-filter="' + esc(it[0]) + '"><b>' + it[2] + '</b><span>' + esc(it[1]) + '</span></button>';
    }).join('');
  }
  byId('adminStats').addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]');
    if (!b) return;
    byId('filterStatus').value = b.getAttribute('data-filter');
    renderStats(); renderAntrianAdmin();
  });
  byId('filterStatus').addEventListener('change', function () { renderStats(); renderAntrianAdmin(); });
  byId('filterKeyword').addEventListener('input', debounce(renderAntrianAdmin, 150));

  // ---------- Daftar antrian ----------
  function filterAntrian() {
    var f = byId('filterStatus').value;
    var kw = byId('filterKeyword').value.trim().toLowerCase();
    var kwKode = normKode(kw);
    return state.admin.data.filter(function (a) {
      var cocokStatus = !f ||
        (f === 'aktif' && (['Menunggu', 'Diperiksa', 'Dikerjakan'].indexOf(a.status) !== -1 || a.status === 'Selesai')) ||
        (f === 'bayar' && a.status === 'Selesai' && a.statusBayar === 'Menunggu Pembayaran') ||
        (f === 'voucher' && a.statusVoucher === 'Menunggu Validasi') ||
        a.status === f;
      if (!cocokStatus) return false;
      if (!kw) return true;
      return [a.nama, a.noAntrian, a.tipe, a.idAntrian, a.email, a.wa, a.kategori].some(function (v) { return String(v || '').toLowerCase().indexOf(kw) !== -1; }) ||
        (kwKode.length >= 4 && normKode(a.kodeAkses).indexOf(kwKode) !== -1);
    });
  }

  function tombolAksi(a) {
    var id = esc(a.idAntrian), b = '';
    function btn(act, cls, icon, label) { return '<button type="button" class="btn btn--xs ' + cls + '" data-act="' + act + '" data-id="' + id + '"><i class="fa-solid ' + icon + '"></i>' + label + '</button>'; }
    if (a.status === 'Menunggu') b += btn('periksa', 'btn--primary', 'fa-magnifying-glass', 'Mulai Periksa') + btn('batal', 'btn--danger', 'fa-xmark', 'Batalkan');
    else if (a.status === 'Diperiksa') b += btn('kerjakan', 'btn--primary', 'fa-screwdriver-wrench', 'Mulai Kerjakan') + btn('batal', 'btn--danger', 'fa-xmark', 'Batalkan');
    else if (a.status === 'Dikerjakan') b += btn('selesai', 'btn--accent', 'fa-check', 'Selesaikan');
    else if (a.status === 'Selesai' && a.statusBayar === 'Menunggu Pembayaran') b += btn('lunas', 'btn--accent', 'fa-money-check-dollar', 'Tandai Lunas');
    else if (a.status === 'Selesai' && a.statusBayar === 'Lunas') b += btn('kuitansi', 'btn--info', 'fa-receipt', 'Kuitansi') + btn('diambil', 'btn--primary', 'fa-box', 'Tandai Diambil');
    else if (a.status === 'Diambil') b += btn('kuitansi', 'btn--info', 'fa-receipt', 'Kuitansi');

    if (a.statusVoucher === 'Menunggu Validasi') b += btn('vok', 'btn--success', 'fa-ticket', 'Validasi Voucher') + btn('vtolak', 'btn--danger', 'fa-ban', 'Tolak Voucher');

    var k = state.admin.kons[a.idAntrian];
    b += '<button type="button" class="btn btn--xs btn--soft" data-act="chat" data-id="' + id + '"><i class="fa-solid fa-comments"></i>Chat' +
      (k && k.unread ? ' <span class="dot-badge">' + k.unread + '</span>' : k && k.total ? ' (' + k.total + ')' : '') + '</button>';
    b += btn('kode', 'btn--soft', 'fa-key', 'Kirim Kode');
    if (a.waLink) b += '<a class="btn btn--xs btn--soft" href="https://wa.me/' + esc(a.waLink) + '" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i>WA</a>';
    return b;
  }

  function kolomBiaya(a) {
    if (a.biaya === '' || a.biaya === null || a.biaya === undefined) return '<span class="hint">-</span>';
    if (!(Number(a.potonganVoucher) > 0)) return '<strong>' + esc(rupiah(a.biaya)) + '</strong> ' + badgeBayar(a.statusBayar);
    return '<small class="strike">' + esc(rupiah(a.biaya)) + '</small><small class="text-green">-' + esc(rupiahPlain(a.potonganVoucher)) + ' (voucher)</small>' +
      '<strong>' + esc(rupiah(biayaAkhirDari(a))) + '</strong> ' + badgeBayar(a.statusBayar);
  }

  function renderAntrianAdmin() {
    var list = filterAntrian();
    var wrap = byId('admList');
    if (!list.length) { wrap.innerHTML = '<div class="state-msg"><i class="fa-regular fa-folder-open"></i> Tidak ada data antrian yang cocok.</div>'; return; }
    var max = 200, lebih = list.length > max;
    wrap.innerHTML = list.slice(0, max).map(function (a) {
      var voucher = a.kodeVoucher && a.kodeVoucher !== '-' ? '<span class="badge ' + kelasVoucher(a.statusVoucher) + '"><i class="fa-solid fa-ticket"></i>' + esc(a.kodeVoucher) + ' · ' + esc(a.statusVoucher) + '</span>' : '';
      return '<article class="adm-card">' +
        '<div class="adm-card__top"><div><div class="adm-card__no">' + esc(a.noAntrian) + '</div>' +
        '<div class="adm-card__date">' + esc(a.tanggal) + ' &middot; ' + esc(a.idAntrian) + '</div></div>' +
        '<div class="adm-badges">' + (a.idAnggota ? '<span class="badge st-gold"><i class="fa-solid fa-crown"></i>Anggota</span>' : '') + badgeStatus(a.status) + voucher + '</div></div>' +
        '<div class="adm-card__grid">' +
          '<div><h4>Pelanggan</h4>' + esc(a.nama) + '<small>' + esc(a.email) + '</small><small>' + esc(a.wa) + '</small></div>' +
          '<div><h4>Perangkat</h4>' + esc(a.kategori) + '<small>' + esc(a.tipe) + '</small></div>' +
          '<div><h4>Keluhan</h4>' + esc(a.keluhan) + (a.catatanAdmin ? '<small class="note-admin"><i class="fa-solid fa-note-sticky"></i> ' + esc(a.catatanAdmin) + '</small>' : '') + '</div>' +
          '<div><h4>Biaya</h4>' + kolomBiaya(a) +
            (a.kodeAkses ? '<small style="margin-top:6px;">Kode: <button type="button" class="copy-code" data-act="salin" data-kode="' + esc(a.kodeAkses) + '" title="Salin kode akses">' + esc(a.kodeAkses) + '</button></small>' : '<small>Kode: belum ada</small>') +
          '</div>' +
        '</div>' +
        '<div class="adm-actions">' + tombolAksi(a) + '</div>' +
      '</article>';
    }).join('') + (lebih ? '<div class="state-msg">Menampilkan ' + max + ' dari ' + list.length + ' data. Gunakan filter/pencarian untuk mempersempit.</div>' : '');
  }

  function cariAntrian(id) {
    for (var i = 0; i < state.admin.data.length; i++) if (state.admin.data[i].idAntrian === id) return state.admin.data[i];
    return null;
  }

  function jalankanAksi(fn, args, pesanSukses) {
    return apiAdmin.apply(null, [fn].concat(args)).then(function (res) {
      if (res && res.status === 'success') {
        toast(pesanSukses, 'success');
        muatDashboard(true);
      } else if (!res || res.code !== 'AUTH') {
        toast(pesanError(res), 'error');
      }
      return res;
    }, errKoneksi);
  }

  function inputField(id, label, placeholder, type) {
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><input id="' + id + '" type="' + (type || 'text') + '" placeholder="' + esc(placeholder || '') + '"' + (type === 'number' ? ' min="0" step="1000" inputmode="numeric"' : ' maxlength="300"') + '></div>';
  }

  var aksiAdmin = {
    periksa: function (a) {
      konfirmasi('Mulai Periksa Unit ' + a.noAntrian,
        'Tandai antrian ini sebagai <strong>Diperiksa</strong>? Email pemberitahuan dikirim ke pelanggan (jika notifikasi bertahap aktif).' +
        inputField('cCatatan', 'Catatan (opsional)', 'Contoh: unit diterima dalam kondisi baik'),
        function () { jalankanAksi('mulaiPeriksaAntrian', [a.idAntrian, byId('cCatatan').value], 'Status diperbarui menjadi Diperiksa.'); });
    },
    kerjakan: function (a) {
      konfirmasi('Mulai Kerjakan ' + a.noAntrian, 'Tandai antrian ini sebagai <strong>Dikerjakan</strong>?' +
        inputField('cCatatan', 'Catatan / hasil diagnosa (opsional)', 'Contoh: ganti fan & thermal paste'),
        function () { jalankanAksi('mulaiKerjakanAntrian', [a.idAntrian, byId('cCatatan').value], 'Status diperbarui menjadi Dikerjakan.'); });
    },
    selesai: function (a) {
      var note = '';
      if (a.kodeVoucher && a.statusVoucher === 'Tervalidasi') note = '<div class="note note--green"><i class="fa-solid fa-ticket"></i> Voucher <strong>' + esc(a.kodeVoucher) + '</strong> sudah tervalidasi — potongan dihitung otomatis dari biaya di atas.</div>';
      else if (a.kodeVoucher && a.kodeVoucher !== '-' && a.statusVoucher === 'Menunggu Validasi') note = '<div class="note note--warn"><i class="fa-solid fa-triangle-exclamation"></i> Voucher <strong>' + esc(a.kodeVoucher) + '</strong> belum divalidasi, potongan BELUM diterapkan (bisa divalidasi setelahnya, biaya otomatis disesuaikan).</div>';
      konfirmasi('Selesaikan Servis ' + a.noAntrian,
        'Masukkan biaya servis <strong>sebelum potongan</strong> (kosongkan/0 jika gratis). Email notifikasi selesai + instruksi pembayaran dikirim otomatis.' +
        inputField('cBiaya', 'Biaya Servis (Rp)', 'Contoh: 150000', 'number') + inputField('cCatatan', 'Catatan (opsional)', 'Contoh: sudah diganti fan baru') + note,
        function () {
          var raw = byId('cBiaya').value;
          var biaya = parseInt(raw, 10);
          if (raw !== '' && (isNaN(biaya) || biaya < 0)) { toast('Nominal biaya tidak valid.', 'error'); return false; }
          jalankanAksi('selesaikanAntrianServis', [a.idAntrian, isNaN(biaya) ? 0 : biaya, byId('cCatatan').value], 'Servis ditandai selesai. Email notifikasi terkirim.');
        }, { okText: 'Selesaikan' });
    },
    lunas: function (a) {
      konfirmasi('Verifikasi Pembayaran ' + a.noAntrian, 'Konfirmasi pembayaran sebesar <strong>' + esc(rupiah(biayaAkhirDari(a))) + '</strong> sudah diterima (Lunas)?',
        function () { jalankanAksi('verifikasiPembayaranAntrian', [a.idAntrian], 'Pembayaran diverifikasi. Email + link kuitansi terkirim.'); }, { okText: 'Ya, Lunas' });
    },
    diambil: function (a) {
      konfirmasi('Tandai Sudah Diambil', 'Tandai unit <strong>' + esc(a.noAntrian) + '</strong> sudah diambil pelanggan? Antrian akan ditutup.',
        function () { jalankanAksi('tandaiDiambilAntrian', [a.idAntrian], 'Antrian ditutup, unit sudah diambil.'); });
    },
    batal: function (a) {
      konfirmasi('Batalkan Antrian ' + a.noAntrian, inputField('cAlasan', 'Alasan pembatalan', 'Contoh: pelanggan tidak jadi servis'),
        function () { jalankanAksi('batalkanAntrian', [a.idAntrian, byId('cAlasan').value], 'Antrian telah dibatalkan.'); }, { danger: true, okText: 'Batalkan Antrian' });
    },
    vok: function (a) {
      konfirmasi('Validasi Voucher ' + a.kodeVoucher, 'Setujui penggunaan kode voucher pada antrian ini? Stok voucher di sheet Voucher otomatis berkurang 1.',
        function () { jalankanAksi('validasiVoucherAntrian', [a.idAntrian, true, ''], 'Voucher divalidasi, stok berkurang 1.'); }, { okText: 'Validasi' });
    },
    vtolak: function (a) {
      konfirmasi('Tolak Voucher ' + a.kodeVoucher, inputField('cAlasan', 'Alasan penolakan (opsional)', 'Contoh: kode tidak berlaku untuk kategori ini'),
        function () { jalankanAksi('validasiVoucherAntrian', [a.idAntrian, false, byId('cAlasan').value], 'Kode voucher ditolak.'); }, { danger: true, okText: 'Tolak' });
    },
    kuitansi: function (a) { bukaKuitansi({ id: a.idAntrian }); },
    chat: function (a) { bukaAdminChat(a.idAntrian); },
    kode: function (a) {
      konfirmasi('Kirim Ulang Kode Akses', 'Kirim kode akses antrian <strong>' + esc(a.noAntrian) + '</strong> ke email <strong>' + esc(a.email) + '</strong>?' +
        (a.kodeAkses ? '' : '<div class="note note--warn">Antrian lama ini belum punya kode — kode baru akan dibuat otomatis.</div>'),
        function () {
          apiAdmin('kirimUlangKodeAkses', a.idAntrian).then(function (res) {
            if (res && res.status === 'success') { toast('Kode akses dikirim ke ' + res.emailSamaran, 'success'); muatDashboard(true); }
            else if (!res || res.code !== 'AUTH') toast(pesanError(res), 'error');
          }, errKoneksi);
        }, { okText: 'Kirim' });
    }
  };

  byId('admList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'salin') { salin(b.getAttribute('data-kode')); return; }
    var a = cariAntrian(b.getAttribute('data-id'));
    if (a && aksiAdmin[act]) aksiAdmin[act](a);
  });

  // ---------- Tab ----------
  function aktifTab() { var t = $('.tab.is-active'); return t ? t.getAttribute('data-tab') : 'antrian'; }
  $all('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      var nama = t.getAttribute('data-tab');
      $all('.tab').forEach(function (x) { x.classList.toggle('is-active', x === t); x.setAttribute('aria-selected', x === t ? 'true' : 'false'); });
      $all('.tab-panel').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== nama; });
      if (nama === 'anggota') muatAnggota();
    });
  });

  // ---------- Tab Konsultasi ----------
  function renderThreads() {
    var kons = state.admin.kons, list = [], unreadTotal = 0;
    Object.keys(kons).forEach(function (id) {
      var a = cariAntrian(id);
      if (!a) return;
      unreadTotal += kons[id].unread || 0;
      list.push({ a: a, k: kons[id] });
    });
    list.sort(function (x, y) { return (y.k.unread > 0) - (x.k.unread > 0) || y.k.lastTs - x.k.lastTs; });
    var badge = byId('badgeKonsultasi');
    badge.hidden = !unreadTotal; badge.textContent = unreadTotal;
    var wrap = byId('admThreads');
    if (!list.length) { wrap.innerHTML = '<div class="state-msg"><i class="fa-regular fa-comments"></i> Belum ada konsultasi dari pelanggan.</div>'; return; }
    wrap.innerHTML = list.map(function (x) {
      return '<button type="button" class="thread' + (x.k.unread ? ' is-unread' : '') + '" data-chat="' + esc(x.a.idAntrian) + '">' +
        '<span class="thread__avatar">' + esc(inisial(x.a.nama)) + '</span>' +
        '<span class="thread__main"><span class="thread__title">' + esc(x.a.noAntrian) + ' · ' + esc(x.a.nama) + '</span>' +
        '<span class="thread__prev">' + (x.k.lastDari === 'admin' ? 'Anda: ' : '') + esc(x.k.preview) + '</span></span>' +
        '<span class="thread__time">' + esc(x.k.last) + (x.k.unread ? '<span class="dot-badge">' + x.k.unread + '</span>' : '') + '</span>' +
      '</button>';
    }).join('');
  }
  byId('admThreads').addEventListener('click', function (e) {
    var b = e.target.closest('[data-chat]');
    if (b) bukaAdminChat(b.getAttribute('data-chat'));
  });

  function bukaAdminChat(id) {
    var a = cariAntrian(id);
    state.admin.chatId = id;
    byId('adminChatSub').textContent = a ? (a.noAntrian + ' · ' + a.nama + ' · ' + a.tipe) : id;
    byId('adminChatList').innerHTML = '<div class="state-msg"><i class="fa-solid fa-spinner fa-spin"></i></div>';
    byId('adminChatList').dataset.count = 0;
    Modal.open('mAdminChat');
    muatAdminChat();
    mulaiPolling('adminChat', muatAdminChat, 15000, 'mAdminChat');
  }
  function muatAdminChat() {
    var id = state.admin.chatId;
    if (!id) return;
    return apiAdmin('adminGetKonsultasi', id).then(function (res) {
      if (!res || res.status !== 'success') { if (res && res.code !== 'AUTH') toast(pesanError(res), 'error'); return; }
      renderChat(byId('adminChatList'), res.pesan, 'admin');
      if (state.admin.kons[id] && state.admin.kons[id].unread) { state.admin.kons[id].unread = 0; renderThreads(); renderAntrianAdmin(); }
    }, function () {});
  }
  byId('formAdminChat').addEventListener('submit', function (e) {
    e.preventDefault();
    var ta = byId('inPesanAdmin'), pesan = ta.value.trim();
    if (!pesan || !state.admin.chatId) return;
    var btn = byId('btnKirimAdmin');
    setLoading(btn, true, '');
    apiAdmin('adminBalasKonsultasi', state.admin.chatId, pesan).then(function (res) {
      setLoading(btn, false);
      if (!res || res.status !== 'success') { if (!res || res.code !== 'AUTH') toast(pesanError(res), 'error'); return; }
      ta.value = ''; autoGrow(ta);
      renderChat(byId('adminChatList'), res.pesan, 'admin');
      byId('adminChatList').scrollTop = byId('adminChatList').scrollHeight;
      muatDashboard(true);
    }, function () { setLoading(btn, false); errKoneksi(); });
  });

  // ---------- Tab Anggota ----------
  function muatAnggota(diam) {
    if (!diam) byId('admMembers').innerHTML = '<div class="state-msg"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data anggota…</div>';
    return apiAdmin('adminGetAnggota').then(function (res) {
      if (!res || res.status !== 'success') { if (!diam && res && res.code !== 'AUTH') byId('admMembers').innerHTML = '<div class="state-msg">' + esc(pesanError(res)) + '</div>'; return; }
      state.admin.anggota = res.data || [];
      renderAnggota();
    }, function () {});
  }
  function renderAnggota() {
    var data = state.admin.anggota || [];
    var menunggu = data.filter(function (m) { return m.status === 'Menunggu Verifikasi'; }).length;
    var badge = byId('badgeAnggota'); badge.hidden = !menunggu; badge.textContent = menunggu;
    var f = byId('filterAnggota').value, kw = byId('filterAnggotaKw').value.trim().toLowerCase();
    var list = data.filter(function (m) {
      if (f && m.status !== f) return false;
      if (!kw) return true;
      return [m.nama, m.email, m.wa, m.id, m.alamat].some(function (v) { return String(v || '').toLowerCase().indexOf(kw) !== -1; });
    });
    var wrap = byId('admMembers');
    if (!list.length) { wrap.innerHTML = '<div class="state-msg"><i class="fa-solid fa-users"></i> Belum ada data anggota.</div>'; return; }
    wrap.innerHTML = list.map(function (m) {
      var cls = m.status === 'Aktif' ? 'st-selesai' : m.status === 'Nonaktif' ? 'st-batal' : 'st-dikerjakan';
      var aksi = '';
      if (m.status !== 'Aktif') aksi += '<button type="button" class="btn btn--xs btn--success" data-mact="Aktif" data-mid="' + esc(m.id) + '"><i class="fa-solid fa-check"></i>Aktifkan</button>';
      if (m.status !== 'Nonaktif') aksi += '<button type="button" class="btn btn--xs btn--danger" data-mact="Nonaktif" data-mid="' + esc(m.id) + '"><i class="fa-solid fa-ban"></i>Nonaktifkan</button>';
      if (m.wa) aksi += '<a class="btn btn--xs btn--soft" href="https://wa.me/' + esc(normWA(m.wa)) + '" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i>WA</a>';
      return '<div class="member-row">' +
        '<div><strong>' + esc(m.nama) + '</strong><small>' + esc(m.id) + ' &middot; ' + esc(m.tanggal) + '</small></div>' +
        '<div><small>' + esc(m.email) + '</small><small>' + esc(m.wa) + (m.alamat ? ' &middot; ' + esc(m.alamat) : '') + '</small></div>' +
        '<div><span class="badge ' + cls + '">' + esc(m.status) + '</span></div>' +
        '<div class="adm-actions" style="border:0;padding:0;">' + aksi + '</div></div>';
    }).join('');
  }
  byId('filterAnggota').addEventListener('change', renderAnggota);
  byId('filterAnggotaKw').addEventListener('input', debounce(renderAnggota, 150));
  byId('admMembers').addEventListener('click', function (e) {
    var b = e.target.closest('[data-mact]');
    if (!b) return;
    var st = b.getAttribute('data-mact'), id = b.getAttribute('data-mid');
    konfirmasi((st === 'Aktif' ? 'Aktifkan' : 'Nonaktifkan') + ' Anggota', 'Ubah status anggota <strong>' + esc(id) + '</strong> menjadi <strong>' + esc(st) + '</strong>?' +
      (st === 'Aktif' ? ' Email pemberitahuan akan dikirim ke anggota.' : ''),
      function () {
        apiAdmin('adminUbahStatusAnggota', id, st).then(function (res) {
          if (res && res.status === 'success') { toast('Status anggota diperbarui.', 'success'); muatAnggota(true); muatDashboard(true); }
          else if (!res || res.code !== 'AUTH') toast(pesanError(res), 'error');
        }, errKoneksi);
      }, { danger: st === 'Nonaktif' });
  });

  // ==========================================================
  // PROTEKSI KONTEN (penangkal, bukan pemblokir mutlak)
  // ----------------------------------------------------------
  // Browser tidak menyediakan API untuk memblokir screenshot/rekam layar di level OS.
  // Yang dilakukan: blok klik-kanan & drag gambar, watermark nama admin, dan penyamaran
  // layar saat panel admin terbuka tetapi jendela tidak aktif.
  // ==========================================================
  document.addEventListener('contextmenu', function (e) {
    if (e.target.closest('input, textarea, .selectable, .copy-code')) return;
    e.preventDefault();
  });
  document.addEventListener('dragstart', function (e) {
    if (e.target && (e.target.tagName === 'IMG' || e.target.tagName === 'svg')) e.preventDefault();
  });
  function adminTerlihat() { return Modal.isOpen('mAdmin') && !byId('adminDash').hidden; }
  function samarkan(on) { byId('privacyOverlay').hidden = !(on && adminTerlihat()); }
  document.addEventListener('visibilitychange', function () { samarkan(document.hidden); });
  window.addEventListener('blur', function () {
    setTimeout(function () {
      var ae = document.activeElement;
      if (ae && ae.tagName === 'IFRAME') return; // fokus pindah ke iframe peta, bukan ke aplikasi lain
      samarkan(true);
    }, 0);
  });
  window.addEventListener('focus', function () { samarkan(false); });
  byId('privacyOverlay').addEventListener('click', function () { samarkan(false); });

  // ==========================================================
  // PARAMETER URL (?kode=XXXXX-XXXXX dari tautan email)
  // ==========================================================
  function bacaParam(cb) {
    if (MODE === 'gas' && google.script.url && google.script.url.getLocation) {
      google.script.url.getLocation(function (loc) { cb((loc && loc.parameter) || {}); });
      return;
    }
    var p = {};
    try { new URLSearchParams(window.location.search).forEach(function (v, k) { p[k] = v; }); } catch (e) {}
    cb(p);
    if (p.kode && window.history && history.replaceState) {
      try { history.replaceState(null, '', window.location.pathname + window.location.hash); } catch (e) {}
    }
  }

  // ==========================================================
  // MODE DEMO (tanpa server) — untuk uji tampilan
  // ==========================================================
  var Demo = (function () {
    var KODE = 'AB2CD3EF4G';
    var db = {
      antrian: [
        { idAntrian: 'SRV-261121-001', noAntrian: 'A-01', tanggal: '21 Nov 2026 09:00', nama: 'Budi Santoso', wa: '6281234567890', waLink: '6281234567890', email: 'budi@mail.com', kategori: 'Laptop', tipe: 'ASUS Vivobook A416', keluhan: 'Tidak bisa menyala setelah terkena air', status: 'Dikerjakan', catatanAdmin: 'Diduga masalah pada motherboard.', biaya: '', statusBayar: '-', kodeVoucher: 'CONTOH10', statusVoucher: 'Menunggu Validasi', potonganVoucher: 0, biayaAkhir: '', kodeAkses: 'AB2CD-3EF4G', idAnggota: 'BEE-2611-X7KQ' },
        { idAntrian: 'SRV-261121-002', noAntrian: 'A-02', tanggal: '21 Nov 2026 09:15', nama: 'Siti Rahma', wa: '6281298765432', waLink: '6281298765432', email: 'siti@mail.com', kategori: 'HP / Tablet', tipe: 'Samsung A32', keluhan: 'Layar retak', status: 'Selesai', catatanAdmin: '', biaya: 150000, statusBayar: 'Menunggu Pembayaran', kodeVoucher: 'HEMAT20K', statusVoucher: 'Tervalidasi', potonganVoucher: 20000, biayaAkhir: 130000, kodeAkses: 'HJ7KM-8NP9Q', idAnggota: '' },
        { idAntrian: 'SRV-261121-003', noAntrian: 'A-03', tanggal: '21 Nov 2026 10:02', nama: 'Andi Wijaya', wa: '6285711112222', waLink: '6285711112222', email: 'andi@mail.com', kategori: 'Printer', tipe: 'Epson L3110', keluhan: 'Tinta tidak keluar', status: 'Menunggu', catatanAdmin: '', biaya: '', statusBayar: '-', kodeVoucher: '', statusVoucher: '-', potonganVoucher: 0, biayaAkhir: '', kodeAkses: 'RS2TU-3VW4X', idAnggota: '' }
      ],
      kons: { 'SRV-261121-001': [{ dari: 'pelanggan', nama: 'Budi Santoso', pesan: 'Kira-kira selesai kapan ya, Kak?', waktu: '21 Nov 2026 10:10' }, { dari: 'admin', nama: 'Admin Demo', pesan: 'Sedang kami cek motherboard-nya, estimasi besok sore ya Kak 🙏', waktu: '21 Nov 2026 10:25' }] },
      unread: { 'SRV-261121-001': 0 },
      anggota: [{ id: 'BEE-2611-X7KQ', tanggal: '20 Nov 2026 14:00', nama: 'Budi Santoso', wa: '6281234567890', email: 'budi@mail.com', alamat: 'Kediri', status: 'Aktif', catatan: '' },
        { id: 'BEE-2611-M3RT', tanggal: '21 Nov 2026 08:12', nama: 'Rina Kartika', wa: '6281355556666', email: 'rina@mail.com', alamat: 'Blitar', status: 'Menunggu Verifikasi', catatan: '' }]
    };
    function cariKode(k) { for (var i = 0; i < db.antrian.length; i++) if (normKode(db.antrian[i].kodeAkses) === normKode(k)) return db.antrian[i]; return null; }
    function cariId(id) { for (var i = 0; i < db.antrian.length; i++) if (db.antrian[i].idAntrian === id) return db.antrian[i]; return null; }
    function ok(o) { o = o || {}; o.status = 'success'; return o; }
    function err(m) { return { status: 'error', message: m }; }
    function info(a) { return { noAntrian: a.noAntrian, tipe: a.tipe, status: a.status, nama: a.nama }; }
    function jam() { var d = new Date(); return '21 Nov 2026 ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
    function ubah(id, from, to) { var a = cariId(id); if (!a) return err('Tidak ditemukan'); if (from.indexOf(a.status) === -1) return err('Status tidak sesuai.'); a.status = to; return ok(); }
    var h = {
      getInfoUsaha: function () {
        return ok({ namaUsaha: 'BeeCOMP Service', tagline: 'Cepat, Akurat, Amanah · Mode Demo', alamat: 'Jl. Contoh No. 1, Kediri, Jawa Timur', jamOperasional: 'Senin - Sabtu, 09:00 - 20:00', noWhatsApp: DEFAULT_WA, infoPromo: 'MODE DEMO — Promo bulan ini: Gratis cek fisik untuk semua kategori perangkat! Teks ini diedit dari sheet Pengaturan (InfoPromo).',
          anggota: { deskripsi: 'Member BeeCOMP adalah program keanggotaan GRATIS untuk pelanggan setia. Daftar sekali, nikmati keuntungannya di setiap servis berikutnya.', manfaat: ['Prioritas antrian di hari yang sama', 'Potongan biaya jasa khusus anggota', 'Gratis cek kondisi (diagnosa awal) perangkat', 'Info promo & voucher eksklusif lebih dulu', 'Riwayat servis tercatat rapi'], ketentuan: ['Keanggotaan gratis & berlaku untuk 1 (satu) nama pemilik', 'No. WhatsApp dan email wajib aktif & benar', 'Keanggotaan aktif setelah diverifikasi admin', 'Manfaat tidak dapat digabung dengan promo lain kecuali dinyatakan lain', 'BeeCOMP berhak menonaktifkan keanggotaan bila terjadi penyalahgunaan'] } });
      },
      getAntrianAktifPublik: function () {
        var d = db.antrian.filter(function (a) { return a.status !== 'Diambil' && a.status !== 'Dibatalkan'; }).map(function (a) { return { noAntrian: a.noAntrian, kategori: a.kategori, status: a.status }; });
        var r = { total: db.antrian.length, menunggu: 0, proses: 0, selesai: 0 };
        db.antrian.forEach(function (a) { if (a.status === 'Menunggu') r.menunggu++; else if (a.status === 'Diperiksa' || a.status === 'Dikerjakan') r.proses++; else r.selesai++; });
        return ok({ data: d, ringkas: r });
      },
      daftarAntrian: function (p) {
        var no = 'A-0' + (db.antrian.length + 1);
        db.antrian.push({ idAntrian: 'SRV-DEMO-' + (db.antrian.length + 1), noAntrian: no, tanggal: jam(), nama: p.nama, wa: normWA(p.wa), waLink: normWA(p.wa), email: p.email, kategori: p.kategori, tipe: p.tipe, keluhan: p.keluhan, status: 'Menunggu', catatanAdmin: '', biaya: '', statusBayar: '-', kodeVoucher: p.kodeVoucher || '', statusVoucher: p.kodeVoucher ? 'Menunggu Validasi' : '-', potonganVoucher: 0, biayaAkhir: '', kodeAkses: 'DEMO2-345' + (db.antrian.length + 1), idAnggota: '' });
        return ok({ noAntrian: no, emailSamaran: p.email.slice(0, 2) + '***' + p.email.slice(p.email.indexOf('@')), emailTerkirim: true });
      },
      cekStatusAntrian: function (k) {
        var a = cariKode(k);
        if (!a) return err('Kode akses tidak ditemukan. (Mode demo: coba AB2CD-3EF4G atau HJ7KM-8NP9Q)');
        var d = JSON.parse(JSON.stringify(a));
        d.timeline = [{ status: 'Menunggu', waktu: '21 Nov 2026 09:00', catatan: 'Pendaftaran antrian diterima.' }, { status: 'Diperiksa', waktu: '21 Nov 2026 09:40', catatan: '' }];
        if (a.status !== 'Menunggu' && a.status !== 'Diperiksa') d.timeline.push({ status: a.status, waktu: '21 Nov 2026 11:00', catatan: a.catatanAdmin });
        d.pesanBaru = 1;
        return ok({ data: d });
      },
      getKonsultasiPelanggan: function (k) { var a = cariKode(k); if (!a) return err('Kode akses tidak ditemukan. (Demo: AB2CD-3EF4G)'); return ok({ info: info(a), pesan: db.kons[a.idAntrian] || [] }); },
      kirimKonsultasiPelanggan: function (k, m) {
        var a = cariKode(k); if (!a) return err('Kode tidak ditemukan.');
        (db.kons[a.idAntrian] = db.kons[a.idAntrian] || []).push({ dari: 'pelanggan', nama: a.nama, pesan: m, waktu: jam() });
        db.unread[a.idAntrian] = (db.unread[a.idAntrian] || 0) + 1;
        return ok({ info: info(a), pesan: db.kons[a.idAntrian] });
      },
      getReceiptHtmlContent: function () { return { success: true, bodyHtml: '<div class="state-msg"><strong>Mode Demo</strong><br>Kuitansi asli dibuat oleh server Apps Script.</div>', styleHtml: '' }; },
      adminGetReceipt: function () { return h.getReceiptHtmlContent(); },
      daftarAnggota: function (p) { var id = 'BEE-DEMO-' + (db.anggota.length + 1); db.anggota.unshift({ id: id, tanggal: jam(), nama: p.nama, wa: normWA(p.wa), email: p.email, alamat: p.alamat, status: 'Menunggu Verifikasi' }); return ok({ idAnggota: id, emailSamaran: p.email }); },
      loginAdmin: function (u, p) { return (u === 'admin' && p === 'admin123') ? ok({ token: 'demotoken000000000000000', namaAdmin: 'Admin (Mode Demo)' }) : err('Mode Demo: gunakan username "admin" / password "admin123".'); },
      adminCekSesi: function () { return ok({ namaAdmin: 'Admin (Mode Demo)' }); },
      adminLogout: function () { return ok(); },
      getAllAntrianServis: function () {
        var k = {};
        Object.keys(db.kons).forEach(function (id) { var l = db.kons[id]; var last = l[l.length - 1]; k[id] = { total: l.length, unread: db.unread[id] || 0, last: last.waktu, lastTs: l.length, lastDari: last.dari, preview: last.pesan }; });
        return ok({ data: db.antrian.slice().reverse(), konsultasi: k });
      },
      mulaiPeriksaAntrian: function (t, id) { return ubah(id, ['Menunggu'], 'Diperiksa'); },
      mulaiKerjakanAntrian: function (t, id) { return ubah(id, ['Diperiksa'], 'Dikerjakan'); },
      selesaikanAntrianServis: function (t, id, biaya) { var a = cariId(id); a.status = 'Selesai'; a.biaya = biaya; a.biayaAkhir = biaya; a.statusBayar = biaya > 0 ? 'Menunggu Pembayaran' : 'Lunas'; return ok(); },
      verifikasiPembayaranAntrian: function (t, id) { cariId(id).statusBayar = 'Lunas'; return ok(); },
      tandaiDiambilAntrian: function (t, id) { return ubah(id, ['Selesai'], 'Diambil'); },
      batalkanAntrian: function (t, id, al) { var r = ubah(id, ['Menunggu', 'Diperiksa', 'Dikerjakan'], 'Dibatalkan'); if (r.status === 'success') cariId(id).catatanAdmin = al; return r; },
      validasiVoucherAntrian: function (t, id, okk) { cariId(id).statusVoucher = okk ? 'Tervalidasi' : 'Ditolak'; return ok(); },
      kirimUlangKodeAkses: function (t, id) { var a = cariId(id); return ok({ emailSamaran: a.email, kode: a.kodeAkses }); },
      adminGetKonsultasi: function (t, id) { db.unread[id] = 0; return ok({ info: info(cariId(id)), pesan: db.kons[id] || [] }); },
      adminBalasKonsultasi: function (t, id, m) { (db.kons[id] = db.kons[id] || []).push({ dari: 'admin', nama: 'Admin (Mode Demo)', pesan: m, waktu: jam() }); return ok({ info: info(cariId(id)), pesan: db.kons[id] }); },
      adminGetAnggota: function () { return ok({ data: db.anggota }); },
      adminUbahStatusAnggota: function (t, id, st) { db.anggota.forEach(function (m) { if (m.id === id) m.status = st; }); return ok(); }
    };
    return { handle: function (action, args) { return h[action] ? h[action].apply(null, args) : err('Aksi demo tidak dikenal: ' + action); } };
  })();

  // ==========================================================
  // MULAI
  // ==========================================================
  muatInfoUsaha();
  muatPapan();
  mulaiPollingPapan();
  bacaParam(function (p) {
    if (p.kode && normKode(p.kode).length === 10) bukaStatus(p.kode);
  });
  if (MODE === 'demo') setTimeout(function () { toast('Mode Demo: data contoh, tidak terhubung ke server.', 'info'); }, 800);

  // Ekspos minimal untuk debugging (tanpa data sensitif)
  window.BeeCOMP = { mode: MODE, versi: '3.0' };
})();
