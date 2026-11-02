/* Toymover driver app. Vanilla JS, Supabase Auth + RPC + Storage. Only the public anon/publishable key lives here. */
(function () {
  'use strict';
  var SB_URL = 'https://jafgokwiwkbrshdzhleo.supabase.co';
  var SB_KEY = 'sb_publishable_oTkCYqxtkjne4DcntVN-tg_E-RORtfD';
  var sb = supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  var BASE = new URL('../', location.href).href;
  var view = document.getElementById('view');
  var tabs = document.getElementById('tabs');
  var S = { profile: null, jobs: null, bols: null, staticPhotos: null, urlCache: {}, drivers: null };
  var IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return n == null ? '' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pd(s) { if (!s) return null; var p = String(s).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function fmtDate(s) { var d = pd(s); return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; }
  function fmtTime(s) { return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function chicagoSunday() {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-');
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]); d.setDate(d.getDate() - d.getDay());
    return d;
  }
  function weekLabel(ws) {
    if (!ws) return 'Unscheduled';
    var d = pd(ws), cur = chicagoSunday(), diff = Math.round((d - cur) / 604800000);
    return diff === 0 ? 'This week (' + fmtDate(ws) + ')' : diff === 1 ? 'Next week (' + fmtDate(ws) + ')' : diff === -1 ? 'Last week (' + fmtDate(ws) + ')' : 'Week of ' + fmtDate(ws);
  }
  function toast(msg, ms) { var t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, ms || 2600); }
  function errMsg(e) { return (e && (e.message || e.error_description || e.msg)) || String(e); }
  function stageLabel(st) { return { picked_up: 'Picked up', in_transit: 'In transit', delivered: 'Delivered' }[st] || ''; }
  function badge(job) {
    var cls = job.status === 'In-Transit' ? 'transit' : (job.status === 'Delivered' || job.status === 'Paid') ? 'done' : '';
    var extra = job.stage && job.status !== 'Delivered' ? ' · ' + stageLabel(job.stage) : '';
    return '<span class="badge ' + cls + '">' + esc(job.status || '') + esc(extra) + '</span>';
  }
  function phones(txt) { return (String(txt || '').match(/\(?\d{3}\)?[\s.\-]*\d{3}[\s.\-]*\d{4}/g) || []).filter(function (v, i, a) { return a.indexOf(v) === i; }); }
  function callBtns(txt) {
    return phones(txt).map(function (p) { return '<a class="btn" href="tel:' + esc(p.replace(/[^\d]/g, '')) + '">📞 Call ' + esc(p) + '</a>'; }).join('');
  }
  function navLinks(addr) {
    if (!addr) return '';
    var q = encodeURIComponent(addr);
    var apple = 'https://maps.apple.com/?daddr=' + q + '&dirflg=d', google = 'https://www.google.com/maps/dir/?api=1&destination=' + q;
    return '<a class="btn primary" href="' + esc(IOS ? apple : google) + '" target="_blank" rel="noopener">🧭 Navigate</a>' +
      '<a class="btn" href="' + esc(IOS ? google : apple) + '" target="_blank" rel="noopener">' + (IOS ? 'Google Maps' : 'Apple Maps') + '</a>';
  }
  function getLoc() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(function (p) { resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); }, function () { resolve(null); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
    });
  }
  async function locOrConfirm(what) {
    toast('Getting your location…', 12000);
    var loc = await getLoc(); document.getElementById('toast').hidden = true;
    if (!loc && !confirm('Could not get your GPS location. Allow location for this site in your browser settings.\n\nContinue ' + what + ' WITHOUT location?')) return undefined;
    return loc;
  }
  function busy(btn, on, txt) { if (!btn) return; btn.disabled = on; if (on && txt) { btn.dataset.t = btn.textContent; btn.textContent = txt; } else if (!on && btn.dataset.t) { btn.textContent = btn.dataset.t; } }
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); })); }

  var RESIZED = typeof WeakSet !== 'undefined' ? new WeakSet() : null; // blobs already processed by resizeImage (avoid double re-encoding)
  function markDone(b) { try { if (RESIZED) RESIZED.add(b); } catch (e) {} return b; }
  function encodeJpeg(src, w, h, max) {
    var sc = Math.min(1, max / Math.max(w, h));
    var c = document.createElement('canvas'); c.width = Math.round(w * sc); c.height = Math.round(h * sc);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error('encode failed')); }, 'image/jpeg', 0.75); });
  }
  function loadViaImg(file) { // fallback decoder: <img> + object URL (browser applies EXIF orientation by default)
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () { res({ img: im, url: u }); };
      im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('image load failed')); };
      im.src = u;
    });
  }
  async function resizeImage(file, max) {
    max = max || 1600;
    try {
      var bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return markDone(await encodeJpeg(bmp, bmp.width, bmp.height, max));
    } catch (e) {
      try { // fallback path: <img> + objectURL + canvas
        var L = await loadViaImg(file);
        try { return markDone(await encodeJpeg(L.img, L.img.naturalWidth, L.img.naturalHeight, max)); }
        finally { URL.revokeObjectURL(L.url); }
      } catch (e2) {
        if (file.size > 1.5 * 1024 * 1024) throw new Error('This photo is too large to upload and could not be compressed. Please retake it with the camera and try again.');
        if (/^image\/(jpeg|png|webp)$/.test(file.type)) return markDone(file); // small original: allow as-is
        throw new Error('This photo format is not supported. Use the camera or a JPEG.');
      }
    }
  }
  // All uploads go through here: images (image/*) are always resized/compressed first; PDFs and other non-images pass through untouched.
  async function upload(bucket, path, blob, type) {
    var t = type || blob.type || '';
    if (/^image\//.test(blob.type || t) && !(RESIZED && RESIZED.has(blob))) {
      blob = await resizeImage(blob);
      if (blob.type && blob.type !== t) { t = blob.type; if (blob.type === 'image/jpeg') path = path.replace(/\.(png|webp|jpe?g|heic|heif)$/i, '.jpg'); }
    }
    var r = await sb.storage.from(bucket).upload(path, blob, { contentType: t || blob.type || 'image/jpeg', upsert: false });
    if (r.error) throw r.error; return path;
  }
  async function signed(bucket, paths) {
    var need = paths.filter(function (p) { return !S.urlCache[bucket + '/' + p]; });
    if (need.length) {
      var r = await sb.storage.from(bucket).createSignedUrls(need, 3600);
      if (r.error) throw r.error;
      r.data.forEach(function (x) { if (x.signedUrl) S.urlCache[bucket + '/' + x.path] = x.signedUrl; });
    }
    return paths.map(function (p) { return S.urlCache[bucket + '/' + p]; });
  }
  async function listPhotos(jobId) {
    var r = await sb.storage.from('job-photos').list(jobId, { limit: 300, sortBy: { column: 'name', order: 'asc' } });
    if (r.error) throw r.error;
    return (r.data || []).filter(function (o) { return o.name && o.id; }).map(function (o) {
      var m = /^(pickup|delivery|issue|other)-([a-z_]+)-/.exec(o.name);
      return { path: jobId + '/' + o.name, stage: m ? m[1] : 'other', slot: m ? m[2] : 'other' };
    });
  }
  function thumbs(urls) {
    urls = (urls || []).filter(Boolean);
    if (!urls.length) return '';
    return '<div class="thumbs">' + urls.map(function (u) { return '<img loading="lazy" src="' + esc(u) + '" data-full="' + esc(u) + '" alt="photo">'; }).join('') + '</div>';
  }
  async function loadStatic() {
    if (!S.bols) { try { S.bols = await (await fetch(BASE + 'bols/index.json', { cache: 'no-cache' })).json(); } catch (e) { S.bols = []; } }
    if (!S.staticPhotos) { try { S.staticPhotos = await (await fetch(BASE + 'photos/index.json', { cache: 'no-cache' })).json(); } catch (e) { S.staticPhotos = {}; } }
  }
  function staticPhotoHtml(id) {
    var arr = (S.staticPhotos || {})[id] || [];
    return thumbs(arr.map(function (f) { return BASE + 'photos/' + id + '/' + encodeURIComponent(f); }));
  }
  function bolLink(id) { return (S.bols || []).indexOf(id) >= 0 ? '<a class="btn" target="_blank" rel="noopener" href="' + BASE + 'bols/' + encodeURIComponent(id) + '.pdf">📄 BOL (PDF)</a>' : ''; }

  /* ---------- shell ---------- */
  function setTabs() {
    var sup = S.profile && S.profile.is_supervisor;
    var items = [['jobs', 'My jobs'], ['pay', 'Pay'], ['add', 'Add']].concat(sup ? [['team', 'Team']] : []).concat([['more', 'More']]);
    tabs.innerHTML = items.map(function (t) { return '<button data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('');
    tabs.hidden = !S.profile;
  }
  function markTab(name) { Array.prototype.forEach.call(tabs.querySelectorAll('button'), function (b) { b.setAttribute('aria-current', b.dataset.tab === name ? 'true' : 'false'); }); }
  tabs.addEventListener('click', function (e) { var b = e.target.closest('button[data-tab]'); if (b) location.hash = '#/' + b.dataset.tab; });
  var lb = document.getElementById('lightbox');
  lb.addEventListener('click', function () { lb.hidden = true; });
  document.addEventListener('click', function (e) { var im = e.target.closest('img[data-full]'); if (im) { lb.querySelector('img').src = im.dataset.full; lb.hidden = false; } });

  function showLogin(msg) {
    S.profile = null; tabs.hidden = true; document.getElementById('who').textContent = '';
    view.innerHTML = '<h1>Driver login</h1><p class="muted">Sign in with the email and password Ken gave you.</p>' +
      (msg ? '<div class="msg err">' + esc(msg) + '</div>' : '') +
      '<form id="login"><label for="em">Email</label><input id="em" type="email" autocomplete="username" inputmode="email" required>' +
      '<label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required>' +
      '<p><button class="btn primary block" type="submit">Sign in</button></p></form>' +
      '<p class="muted">Forgot your password? Ask Ken to reset it.</p><p><a href="#/help">How to add this app to your home screen</a></p>';
    document.getElementById('login').addEventListener('submit', async function (e) {
      e.preventDefault(); var b = e.target.querySelector('button'); busy(b, true, 'Signing in…');
      var r = await sb.auth.signInWithPassword({ email: document.getElementById('em').value.trim(), password: document.getElementById('pw').value });
      busy(b, false);
      if (r.error) return showLogin(/invalid/i.test(r.error.message) ? 'Wrong email or password.' : r.error.message);
      location.hash = '#/jobs'; start();
    });
  }
  async function start() {
    var s = await sb.auth.getSession();
    if (!s.data.session) { if (location.hash === '#/help') return route(); return showLogin(); }
    var p = await sb.rpc('my_profile');
    if (p.error) { view.innerHTML = '<div class="msg err">' + esc(errMsg(p.error)) + '</div><p class="muted">Check your connection and reload.</p>'; return; }
    S.profile = (p.data && p.data[0]) || null;
    if (!S.profile) {
      tabs.hidden = true;
      var em = (s.data.session.user && s.data.session.user.email) || 'this login';
      view.innerHTML = '<h1>Account not linked yet</h1><div class="msg warn">You are signed in as <b>' + esc(em) + '</b>, but this login is not linked to a Toymover driver, so there are no jobs to show. Ask Ken to link it to your driver profile (this is not something you did wrong).</div><p><button class="btn primary block" id="rt">Check again</button></p><p><button class="btn block" id="so">Sign out</button></p>';
      document.getElementById('rt').onclick = function () { start(); };
      document.getElementById('so').onclick = signOut; return;
    }
    document.getElementById('who').textContent = S.profile.full_name || S.profile.driver_id || (S.profile.is_owner ? 'Ken' : '');
    setTabs();
    if (!location.hash || location.hash === '#/') location.hash = '#/jobs'; else route();
  }
  async function signOut() { await sb.auth.signOut(); S = { profile: null, jobs: null, bols: S.bols, staticPhotos: S.staticPhotos, urlCache: {}, drivers: null }; location.hash = ''; showLogin(); }

  /* ---------- router ---------- */
  var R = {};
  async function route() {
    var h = (location.hash || '').replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    var name = h[0] || 'jobs';
    if (name === 'help') { markTab('more'); return renderHelp(); }
    if (!S.profile) return start();
    markTab(name === 'job' || name === 'sign' ? 'jobs' : (['lead', 'expense', 'issue'].indexOf(name) >= 0 ? 'add' : (['leads', 'expenses', 'myissues'].indexOf(name) >= 0 ? 'more' : name)));
    window.scrollTo(0, 0);
    var fn = R[name] || R.jobs;
    try { await fn(h.slice(1)); } catch (e) { view.innerHTML = '<div class="msg err">' + esc(errMsg(e)) + '</div><p><a class="btn" href="#/jobs">Back to jobs</a></p>'; }
  }
  window.addEventListener('hashchange', route);

  /* ---------- My jobs ---------- */
  async function loadJobs(force) {
    if (S.jobs && !force) return S.jobs;
    var r = await sb.rpc('my_jobs'); if (r.error) throw r.error; S.jobs = r.data || []; return S.jobs;
  }
  function stopHtml(lbl, name, addr, phone) {
    return '<div class="stop"><div class="lbl">' + lbl + '</div><div class="nm">' + esc(name || 'TBD') + '</div><div>' + esc(addr || 'Address not set') + '</div>' +
      (phone ? '<div class="muted">' + esc(phone) + '</div>' : '') + '<div class="links">' + navLinks(addr) + callBtns(phone) + '</div></div>';
  }
  R.jobs = async function () {
    view.dataset.job = '';
    view.innerHTML = '<h1>My jobs</h1><p class="muted center">Loading…</p>';
    var jobs = await loadJobs(true); await loadStatic();
    if (!jobs.length) { view.innerHTML = '<h1>My jobs</h1><div class="card center muted">No jobs assigned for this week or upcoming weeks.</div>'; return; }
    var groups = {}, order = [];
    jobs.forEach(function (j) { var k = j.week_start || 'none'; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(j); });
    var html = '<h1>My jobs</h1>';
    order.forEach(function (k) {
      html += '<h2>' + esc(weekLabel(k === 'none' ? null : k)) + '</h2>';
      groups[k].forEach(function (j) {
        html += '<div class="card"><a class="row" href="#/job/' + esc(j.id) + '" style="text-decoration:none;color:inherit"><span class="jid">' + esc(j.id) + '</span>' + badge(j) + '</a>' +
          '<div class="item">' + esc(j.item_type || 'Item not described') + '</div>' +
          '<div class="muted">' + esc(j.pickup_address || j.pickup_name || '?') + ' → ' + esc(j.delivery_address || j.delivery_customer || '?') + '</div>' +
          (j.driver_pay != null ? '<div class="pay">Pay ' + money(j.driver_pay) + '</div>' : '') +
          '<div class="links"><a class="btn primary" href="#/job/' + esc(j.id) + '">Open job</a>' + bolLink(j.id) + '</div></div>';
      });
    });
    view.innerHTML = html;
  };

  /* ---------- Job detail ---------- */
  var SLOTS = [['front', 'Front'], ['back', 'Back'], ['left', 'Left side'], ['right', 'Right side']];
  function damageKey(id, st) { return 'dmg:' + id + ':' + st; }
  function photoSection(job, stage, photos, urlMap, locked) {
    var mine = photos.filter(function (p) { return p.stage === stage; });
    var have = {}; mine.forEach(function (p) { have[p.slot] = (have[p.slot] || 0) + 1; });
    var dmg = sessionStorage.getItem(damageKey(job.id, stage)) || (have.damage ? 'photos' : '');
    var allSides = SLOTS.every(function (s) { return have[s[0]]; });
    var ok = allSides && (dmg === 'none' || (dmg === 'photos' && have.damage));
    var title = stage === 'pickup' ? 'Pickup photos' : 'Delivery photos';
    var h = '<div class="card"><div class="row"><b>' + title + '</b><span class="badge ' + (ok ? 'done' : '') + '">' + (ok ? 'Ready' : 'Required') + '</span></div>' +
      '<p class="muted" style="margin:4px 0">Take all 4 sides' + (locked ? '' : ', then confirm damage') + '.</p>';
    SLOTS.forEach(function (s) {
      h += '<div class="row" style="align-items:center;margin:6px 0"><span>' + (have[s[0]] ? '✅ ' : '⬜ ') + s[1] + '</span>' +
        (locked ? '' : '<label class="btn">' + (have[s[0]] ? 'Retake' : 'Take photo') + '<input type="file" accept="image/*" capture="environment" hidden data-up="' + stage + ':' + s[0] + '"></label>') + '</div>';
    });
    h += '<div style="margin-top:8px"><b>Any damage?</b>' +
      '<label style="font-weight:400"><input type="radio" name="dmg-' + stage + '" value="none" ' + (dmg === 'none' ? 'checked' : '') + ' ' + (locked ? 'disabled' : '') + ' style="width:auto"> No damage</label>' +
      '<label style="font-weight:400"><input type="radio" name="dmg-' + stage + '" value="photos" ' + (dmg === 'photos' ? 'checked' : '') + ' ' + (locked ? 'disabled' : '') + ' style="width:auto"> Yes, damage (add photos)</label>';
    if (dmg === 'photos' && !locked) h += '<label class="btn">Add damage photo (' + (have.damage || 0) + ')<input type="file" accept="image/*" capture="environment" hidden multiple data-up="' + stage + ':damage"></label>';
    h += '</div>' + thumbs(mine.map(function (p) { return urlMap[p.path]; })) + '</div>';
    return { html: h, ok: ok, dmg: dmg };
  }
  R.job = async function (a) {
    var id = a[0];
    var first = view.dataset.job !== id;
    if (first) view.innerHTML = '<p class="muted center">Loading job…</p>';
    var jobs = await loadJobs(true); await loadStatic();
    var job = jobs.filter(function (j) { return j.id === id; })[0];
    if (!job) { view.innerHTML = '<div class="msg warn">Job not found in your list.</div><a class="btn" href="#/jobs">Back</a>'; return; }
    var y0 = window.scrollY;
    var results = await Promise.all([listPhotos(id), sb.from('job_events').select('*').eq('job_id', id).order('created_at'), sb.from('job_bols').select('*').eq('job_id', id).order('created_at'), sb.from('issues').select('id,issue_type,status,description,created_at').eq('job_id', id).order('created_at', { ascending: false })]);
    var photos = results[0], events = results[1].data || [], bolsRows = results[2].data || [], issues = results[3].data || [];
    var urls = await signed('job-photos', photos.map(function (p) { return p.path; }));
    var urlMap = {}; photos.forEach(function (p, i) { urlMap[p.path] = urls[i]; });
    var bolUrls = bolsRows.length ? await signed('signed-bols', bolsRows.map(function (b) { return b.pdf_path; })) : [];
    var done = job.status === 'Delivered' || job.status === 'Invoiced' || job.status === 'Paid';
    var hasPick = events.some(function (e) { return e.event_type === 'picked_up'; });
    var pp = photoSection(job, 'pickup', photos, urlMap, hasPick || done), dp = photoSection(job, 'delivery', photos, urlMap, done);
    var other = photos.filter(function (p) { return p.stage === 'other' || p.stage === 'issue'; });
    var h = '<p><a href="#/jobs">← My jobs</a></p><div class="card"><div class="row"><span class="jid">' + esc(job.id) + '</span>' + badge(job) + '</div>' +
      '<div class="item">' + esc(job.item_type || 'Item not described') + '</div>' + (job.item_category ? '<div class="muted">' + esc(job.item_category) + '</div>' : '') +
      (job.driver_pay != null ? '<div class="pay">Your pay ' + money(job.driver_pay) + '</div>' : '') +
      (job.week_start ? '<div class="muted">Week of ' + esc(fmtDate(job.week_start)) + '</div>' : '') +
      stopHtml('Pickup', job.pickup_name, job.pickup_address, job.pickup_phone) +
      stopHtml('Delivery', job.delivery_customer, job.delivery_address, job.delivery_phone) +
      (job.contact_name || job.contact_phone ? '<div class="stop"><div class="lbl">Customer contact</div><div class="nm">' + esc(job.contact_name || '') + '</div><div class="links">' + callBtns(job.contact_phone) + '</div></div>' : '') +
      '<div class="links">' + bolLink(job.id) + '</div>' + staticPhotoHtml(job.id) + '</div>';
    var canPick = !done && !hasPick && pp.ok, canTransit = !done && hasPick, canDeliver = !done && hasPick && dp.ok;
    h += '<div class="card"><b>Status</b><p class="muted" style="margin:4px 0">Each tap records the time and your GPS location.</p>' +
      '<div class="links"><button class="btn primary" data-stage="picked_up" ' + (canPick ? '' : 'disabled') + '>Picked up</button>' +
      '<button class="btn primary" data-stage="in_transit" ' + (canTransit ? '' : 'disabled') + '>In transit</button>' +
      '<button class="btn primary" data-stage="delivered" ' + (canDeliver ? '' : 'disabled') + '>Delivered</button></div>' +
      (!done && !hasPick && !pp.ok ? '<p class="muted">Take the 4 pickup photos and confirm damage to unlock “Picked up”.</p>' : '') +
      (hasPick && !done && !dp.ok ? '<p class="muted">Take the 4 delivery photos and confirm damage to unlock “Delivered”.</p>' : '') +
      '<div class="links"><button class="btn" data-checkin="' + esc(id) + '">📍 Check in</button><a class="btn" href="#/issue/' + esc(id) + '">⚠️ Report issue</a></div></div>';
    h += pp.html + dp.html;
    h += '<div class="card"><b>Signed bill of lading</b>' +
      bolsRows.map(function (b, i) { return '<div class="row" style="margin:6px 0"><span>' + esc(b.stage === 'pickup' ? 'Pickup' : 'Delivery') + ' BOL · ' + esc(b.signer_name) + '<br><span class="muted">' + esc(fmtTime(b.signed_at)) + '</span></span><a class="btn" target="_blank" rel="noopener" href="' + esc(bolUrls[i] || '#') + '">Open PDF</a></div>'; }).join('') +
      '<div class="links"><a class="btn primary" href="#/sign/' + esc(id) + '/pickup">✍️ Sign pickup BOL</a><a class="btn primary" href="#/sign/' + esc(id) + '/delivery">✍️ Sign delivery BOL</a></div></div>';
    h += '<div class="card"><b>Other photos</b><p class="muted" style="margin:4px 0">Anything extra for this job.</p><label class="btn">From gallery<input type="file" accept="image/*" multiple hidden data-up="other:other"></label><label class="btn">Camera<input type="file" accept="image/*" capture="environment" hidden data-up="other:other"></label>' + thumbs(other.map(function (p) { return urlMap[p.path]; })) + '</div>';
    if (issues.length) h += '<div class="card"><b>Reported issues</b>' + issues.map(function (i) { return '<div style="margin:6px 0">' + (i.status === 'Open' ? '🚩 ' : '✔ ') + esc(i.issue_type.replace('_', ' ')) + ' <span class="muted">· ' + esc(i.status) + ' · ' + esc(fmtTime(i.created_at)) + '</span><br>' + esc(i.description) + '</div>'; }).join('') + '</div>';
    h += '<div class="card"><b>Timeline</b>' + timelineHtml(events) + '</div>';
    view.innerHTML = h; view.dataset.job = id;
    if (!first) window.scrollTo(0, y0);
  };
  function timelineHtml(events) {
    if (!events.length) return '<p class="muted">No activity yet.</p>';
    var names = { picked_up: 'Picked up', in_transit: 'In transit', delivered: 'Delivered', checkin: 'Check-in', status_change: 'Status change', reassigned: 'Reassigned', bol_signed: 'BOL signed', lead_converted: 'Created from lead' };
    return events.map(function (e) {
      var loc = e.lat != null && e.lng != null ? ' · <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=' + e.lat + ',' + e.lng + '">map</a>' : (['picked_up', 'in_transit', 'delivered', 'checkin'].indexOf(e.event_type) >= 0 ? ' · <span class="muted">no GPS</span>' : '');
      return '<div style="margin:8px 0"><b>' + esc(names[e.event_type] || e.event_type) + '</b>' + (e.driver_id ? ' <span class="muted">' + esc(e.driver_id) + '</span>' : '') + '<br><span class="muted">' + esc(fmtTime(e.created_at)) + '</span>' + loc + (e.note ? '<br>' + esc(e.note) : '') + '</div>';
    }).join('');
  }

  view.addEventListener('change', async function (e) {
    var inp = e.target;
    if (inp.matches && inp.matches('input[type=radio][name^="dmg-"]')) {
      sessionStorage.setItem(damageKey(view.dataset.job, inp.name.slice(4)), inp.value); return R.job([view.dataset.job]);
    }
    if (inp.matches && inp.matches('input[type=file][data-up]') && view.dataset.job) {
      var spec = inp.dataset.up.split(':'), jobId = view.dataset.job, files = Array.prototype.slice.call(inp.files || []);
      if (!files.length) return;
      toast('Uploading…', 20000);
      try {
        for (var i = 0; i < files.length; i++) {
          var blob = await resizeImage(files[i]);
          await upload('job-photos', jobId + '/' + spec[0] + '-' + spec[1] + '-' + Date.now() + '-' + i + (blob.type === 'image/png' ? '.png' : '.jpg'), blob, blob.type);
        }
        toast('Photo saved'); await R.job([jobId]);
      } catch (err) { toast('Upload failed: ' + errMsg(err), 5000); }
    }
  });
  view.addEventListener('click', async function (e) {
    var b = e.target.closest('button[data-stage]');
    if (b) {
      var st = b.dataset.stage, jobId = view.dataset.job, dm = sessionStorage.getItem(damageKey(jobId, st === 'picked_up' ? 'pickup' : 'delivery')) || null;
      var label = stageLabel(st);
      if (!confirm('Mark this job as ' + label + '?')) return;
      var loc = await locOrConfirm('marking ' + label); if (loc === undefined) return;
      busy(b, true, 'Saving…');
      var r = await sb.rpc('driver_set_job_stage', { p_job_id: jobId, p_stage: st, p_lat: loc ? loc.lat : null, p_lng: loc ? loc.lng : null, p_accuracy: loc ? loc.acc : null, p_damage: st === 'in_transit' ? null : dm, p_note: null });
      if (r.error) { busy(b, false); toast(errMsg(r.error), 6000); return; }
      toast(label + ' recorded' + (loc ? '' : ' (no GPS)') + (st === 'delivered' ? '. Now get the customer signature on the BOL.' : ''), 4500);
      await R.job([jobId]);
      return;
    }
    var c = e.target.closest('button[data-checkin]');
    if (c) doCheckin(c, c.dataset.checkin);
  });
  async function doCheckin(btn, jobId) {
    var loc = await locOrConfirm('checking in'); if (loc === undefined) return;
    busy(btn, true, 'Saving…');
    var r = await sb.rpc('driver_checkin', { p_job_id: jobId || null, p_lat: loc ? loc.lat : null, p_lng: loc ? loc.lng : null, p_accuracy: loc ? loc.acc : null, p_note: null });
    busy(btn, false);
    if (r.error) return toast(errMsg(r.error), 5000);
    toast('Checked in' + (loc ? '' : ' (no GPS)'));
    if (jobId && view.dataset.job === jobId) R.job([jobId]);
  }

  /* ---------- BOL signing ---------- */
  R.sign = async function (a) {
    var id = a[0], stage = a[1] === 'delivery' ? 'delivery' : 'pickup';
    var jobs = await loadJobs(); var job = jobs.filter(function (j) { return j.id === id; })[0];
    if (!job) { view.innerHTML = '<div class="msg warn">Job not found.</div>'; return; }
    view.dataset.job = '';
    view.innerHTML = '<p><a href="#/job/' + esc(id) + '">← ' + esc(id) + '</a></p><h1>' + (stage === 'pickup' ? 'Pickup' : 'Delivery') + ' bill of lading</h1>' +
      '<div class="card"><b>' + esc(job.item_type || '') + '</b><div class="muted">' + esc(job.pickup_address || '') + ' → ' + esc(job.delivery_address || '') + '</div></div>' +
      '<form id="bolform"><label>Condition notes (damage, scratches, existing issues)</label><textarea id="bn" placeholder="e.g. Small scratch on left fender. Otherwise good condition."></textarea>' +
      '<label>Customer printed name</label><input id="bs" required autocomplete="off">' +
      '<label>Customer signature (sign with your finger)</label><canvas id="sig" style="width:100%;height:180px;border:2px dashed #9aa6b5;border-radius:10px;background:#fff;touch-action:none"></canvas>' +
      '<div class="links"><button type="button" class="btn" id="sigclr">Clear signature</button></div>' +
      '<p class="muted">The ' + stage + ' photos you already took are attached to the PDF automatically.</p>' +
      '<p><button class="btn primary block" type="submit">Generate signed BOL</button></p></form><div id="bolout"></div>';
    var cv = document.getElementById('sig'), ratio = window.devicePixelRatio || 1;
    cv.width = cv.clientWidth * ratio; cv.height = cv.clientHeight * ratio;
    var ctx = cv.getContext('2d'); ctx.scale(ratio, ratio); ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#111';
    var drawing = false, strokes = 0;
    function pos(ev) { var r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
    cv.addEventListener('pointerdown', function (ev) { drawing = true; cv.setPointerCapture(ev.pointerId); var p = pos(ev); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + 0.1, p[1] + 0.1); ctx.stroke(); strokes++; ev.preventDefault(); });
    cv.addEventListener('pointermove', function (ev) { if (!drawing) return; var p = pos(ev); ctx.lineTo(p[0], p[1]); ctx.stroke(); strokes++; ev.preventDefault(); });
    ['pointerup', 'pointercancel'].forEach(function (n) { cv.addEventListener(n, function () { drawing = false; }); });
    document.getElementById('sigclr').onclick = function () { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.restore(); strokes = 0; };
    document.getElementById('bolform').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      if (strokes < 8) return toast('Please have the customer sign first.', 3500);
      var btn = ev.target.querySelector('button[type=submit]'); busy(btn, true, 'Building PDF…');
      try {
        var loc = await getLoc();
        var path = await buildAndUploadBol(job, stage, document.getElementById('bs').value.trim(), document.getElementById('bn').value.trim(), cv.toDataURL('image/png'), loc);
        var url = (await signed('signed-bols', [path]))[0];
        document.getElementById('bolform').hidden = true;
        document.getElementById('bolout').innerHTML = '<div class="msg ok">Signed BOL saved to job ' + esc(id) + '.</div><p><a class="btn primary block" target="_blank" rel="noopener" href="' + esc(url) + '">Open signed PDF</a></p><p><a class="btn block" href="#/job/' + esc(id) + '">Back to job</a></p>';
      } catch (err) { busy(btn, false); toast('Could not save BOL: ' + errMsg(err), 6000); }
    });
  };
  function wrapText(font, text, size, maxW) {
    var words = String(text || '').split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (font.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = w; } else cur = t; });
    if (cur) lines.push(cur); return lines;
  }
  async function buildAndUploadBol(job, stage, signer, notes, sigData, loc) {
    var P = PDFLib, doc = await P.PDFDocument.create(), font = await doc.embedFont(P.StandardFonts.Helvetica), bold = await doc.embedFont(P.StandardFonts.HelveticaBold);
    var W = 612, H = 792, M = 46, page = doc.addPage([W, H]), y = H - M, ink = P.rgb(0.1, 0.12, 0.17);
    function safe(s) { return String(s == null ? '' : s).replace(/[^\x20-\x7E]/g, '?'); }
    function line(txt, o) { o = o || {}; var size = o.size || 10.5, f = o.bold ? bold : font; wrapText(f, safe(txt), size, W - 2 * M).forEach(function (l) { if (y < M + 20) { page = doc.addPage([W, H]); y = H - M; } page.drawText(l, { x: M, y: y, size: size, font: f, color: ink }); y -= size + 4; }); }
    page.drawRectangle({ x: 0, y: H - 70, width: W, height: 70, color: P.rgb(0.12, 0.37, 0.75) });
    page.drawText('Toymover', { x: M, y: H - 42, size: 26, font: bold, color: P.rgb(1, 1, 1) });
    page.drawText('Fisher Transport LLC dba Toymover  -  Coppell, TX', { x: M, y: H - 60, size: 10, font: font, color: P.rgb(1, 1, 1) });
    y = H - 100;
    line('BILL OF LADING - ' + (stage === 'pickup' ? 'PICKUP' : 'DELIVERY') + ' CONDITION REPORT', { size: 14, bold: true }); y -= 4;
    line('Job: ' + job.id, { bold: true });
    line('Item: ' + (job.item_type || '')); if (job.item_category) line('Category: ' + job.item_category);
    line('Pickup: ' + [job.pickup_name, job.pickup_address].filter(Boolean).join(' - '));
    line('Delivery: ' + [job.delivery_customer, job.delivery_address].filter(Boolean).join(' - '));
    line('Driver: ' + (S.profile.full_name || S.profile.driver_id));
    line('Signed: ' + new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' }));
    line('Location: ' + (loc ? loc.lat.toFixed(5) + ', ' + loc.lng.toFixed(5) + ' (+/- ' + Math.round(loc.acc) + ' m)' : 'not available')); y -= 6;
    line('Condition notes', { bold: true }); line(notes || 'No condition issues noted.'); y -= 8;
    line('Customer: ' + signer, { bold: true });
    var sig = await doc.embedPng(sigData), sw = 220, sh = sw * sig.height / sig.width;
    if (y < M + sh + 30) { page = doc.addPage([W, H]); y = H - M; }
    page.drawRectangle({ x: M, y: y - sh - 6, width: sw + 8, height: sh + 8, borderColor: P.rgb(0.6, 0.65, 0.72), borderWidth: 1 });
    page.drawImage(sig, { x: M + 4, y: y - sh - 2, width: sw, height: sh }); y -= sh + 22;
    line('By signing, the customer acknowledges the condition of the item(s) described above at this ' + stage + '.', { size: 9 });
    var photos = (await listPhotos(job.id)).filter(function (p) { return p.stage === stage; }).slice(0, 10);
    if (photos.length) {
      var urls = await signed('job-photos', photos.map(function (p) { return p.path; }));
      page = doc.addPage([W, H]); y = H - M; line('Photos (' + stage + ')', { size: 13, bold: true }); y -= 4;
      var col = 0, cw = (W - 2 * M - 12) / 2, ch = 200, top = y;
      for (var i = 0; i < photos.length; i++) {
        try {
          var bytes = await (await fetch(urls[i])).arrayBuffer(), img;
          try { img = await doc.embedJpg(bytes); } catch (e1) { img = await doc.embedPng(bytes); }
          var sc = Math.min(cw / img.width, ch / img.height), iw = img.width * sc, ih = img.height * sc;
          if (col === 0 && top - ch - 14 < M) { page = doc.addPage([W, H]); top = H - M; }
          var x = M + col * (cw + 12);
          page.drawImage(img, { x: x, y: top - ih, width: iw, height: ih });
          page.drawText(safe(photos[i].slot), { x: x, y: top - ch - 10, size: 8, font: font, color: P.rgb(0.4, 0.45, 0.5) });
          if (col === 1) { top -= ch + 24; col = 0; } else col = 1;
        } catch (e2) { /* skip unreadable image */ }
      }
    }
    var bytesOut = await doc.save();
    var path = job.id + '/' + stage + '-' + Date.now() + '.pdf';
    await upload('signed-bols', path, new Blob([bytesOut], { type: 'application/pdf' }), 'application/pdf');
    var r = await sb.rpc('record_signed_bol', { p_job_id: job.id, p_stage: stage, p_signer: signer, p_notes: notes || null, p_pdf_path: path, p_lat: loc ? loc.lat : null, p_lng: loc ? loc.lng : null });
    if (r.error) throw r.error;
    return path;
  }

  /* ---------- Pay summary ---------- */
  R.pay = async function () {
    view.dataset.job = '';
    view.innerHTML = '<h1>My pay</h1><p class="muted center">Loading…</p>';
    var r = await sb.rpc('my_pay_summary'); if (r.error) throw r.error;
    var rows = r.data || [];
    if (!rows.length) { view.innerHTML = '<h1>My pay</h1><div class="card muted center">No jobs with pay yet.</div>'; return; }
    var g = {}, order = [];
    rows.forEach(function (x) { if (!g[x.week_start]) { g[x.week_start] = []; order.push(x.week_start); } g[x.week_start].push(x); });
    var grand = 0, html = '<h1>My pay</h1><p class="muted">Your pay per job, by week. Cancelled jobs are not counted.</p>';
    order.forEach(function (k) {
      var tot = g[k].reduce(function (s, x) { return s + (Number(x.driver_pay) || 0); }, 0), paid = g[k].reduce(function (s, x) { return s + (Number(x.driver_paid) || 0); }, 0);
      grand += tot;
      html += '<div class="card"><div class="row"><b>' + esc(weekLabel(k)) + '</b><span class="pay">' + money(tot) + '</span></div>';
      g[k].forEach(function (x) {
        html += '<div class="row" style="margin-top:8px"><span><b>' + esc(x.id) + '</b> <span class="badge">' + esc(x.status || '') + '</span><br><span class="muted">' + esc(x.item_type || '') + '</span></span><span>' + (x.driver_pay != null ? money(x.driver_pay) : '<span class="muted">TBD</span>') + '</span></div>';
      });
      if (paid > 0) html += '<div class="muted" style="margin-top:8px">Paid so far: ' + money(paid) + '</div>';
      html += '</div>';
    });
    html += '<div class="card"><div class="row"><b>Total shown</b><span class="pay">' + money(grand) + '</span></div></div>';
    view.innerHTML = html;
  };

  /* ---------- Add / More ---------- */
  R.add = async function () {
    view.dataset.job = '';
    view.innerHTML = '<h1>Add</h1><div class="links" style="flex-direction:column">' +
      '<a class="btn primary block" href="#/lead">➕ Submit a lead</a><a class="btn primary block" href="#/expense">🧾 Fuel / toll / repair receipt</a>' +
      '<a class="btn primary block" href="#/issue">⚠️ Report an issue or note</a><button class="btn primary block" id="ci">📍 Check in (share location)</button></div>';
    document.getElementById('ci').onclick = function () { doCheckin(this, null); };
  };
  R.more = async function () {
    view.dataset.job = '';
    view.innerHTML = '<h1>More</h1><div class="links" style="flex-direction:column"><a class="btn block" href="#/leads">My leads</a><a class="btn block" href="#/expenses">My expenses</a><a class="btn block" href="#/myissues">My issues &amp; notes</a><a class="btn block" href="#/help">Add to Home Screen help</a><button class="btn block" id="so">Sign out</button></div>' +
      '<p class="muted center" style="margin-top:20px">Signed in as ' + esc(S.profile.full_name || S.profile.driver_id || 'owner') + (S.profile.is_supervisor ? ' (supervisor)' : '') + '</p>';
    document.getElementById('so').onclick = signOut;
  };
  function jobOptions(sel) {
    return '<option value="">No specific job</option>' + (S.jobs || []).map(function (j) { return '<option value="' + esc(j.id) + '"' + (j.id === sel ? ' selected' : '') + '>' + esc(j.id + ' – ' + (j.item_type || '')) + '</option>'; }).join('');
  }
  function val(x) { return document.getElementById(x).value.trim() || null; }

  R.lead = async function () {
    view.dataset.job = '';
    view.innerHTML = '<h1>Submit a lead</h1><p class="muted">Know someone who needs something hauled? Ken reviews every lead.</p><form id="f">' +
      '<label>Customer name *</label><input id="cn" required><label>Customer phone</label><input id="cp" type="tel">' +
      '<label>Pickup city</label><input id="pc"><label>Pickup address</label><input id="pa"><label>Delivery city</label><input id="dc"><label>Delivery address</label><input id="da">' +
      '<label>Item to move</label><input id="it" placeholder="e.g. 2018 Harley, 24ft trailer"><label>Preferred dates</label><input id="pdts"><label>Notes</label><textarea id="nt"></textarea>' +
      '<label>Photos (optional)</label><input type="file" id="ph" accept="image/*" multiple><p><button class="btn primary block" type="submit">Submit lead</button></p></form>';
    document.getElementById('f').addEventListener('submit', async function (e) {
      e.preventDefault(); var b = e.target.querySelector('button[type=submit]'); busy(b, true, 'Submitting…');
      try {
        var id = uuid(), paths = [], files = Array.prototype.slice.call(document.getElementById('ph').files || []).slice(0, 8);
        for (var i = 0; i < files.length; i++) { var bl = await resizeImage(files[i]); paths.push(await upload('lead-photos', S.profile.driver_id + '/' + id + '/' + i + '-' + Date.now() + '.jpg', bl, bl.type)); }
        var r = await sb.from('leads').insert({ id: id, customer_name: val('cn'), customer_phone: val('cp'), pickup_city: val('pc'), pickup_address: val('pa'), delivery_city: val('dc'), delivery_address: val('da'), item: val('it'), preferred_dates: val('pdts'), notes: val('nt'), photos: paths });
        if (r.error) throw r.error;
        view.innerHTML = '<div class="msg ok">Lead submitted. Ken will review it.</div><p><a class="btn block" href="#/lead">Submit another</a></p><p><a class="btn block" href="#/leads">My leads</a></p>';
      } catch (err) { busy(b, false); toast(errMsg(err), 6000); }
    });
  };
  R.leads = async function () {
    var r = await sb.from('leads').select('*').eq('submitted_by', S.profile.driver_id).order('created_at', { ascending: false }).limit(50); if (r.error) throw r.error;
    view.innerHTML = '<h1>My leads</h1>' + (r.data.length ? r.data.map(function (l) { return '<div class="card"><div class="row"><b>' + esc(l.customer_name) + '</b><span class="badge">' + esc(l.status) + '</span></div><div class="muted">' + esc(fmtTime(l.created_at)) + '</div><div>' + esc([l.pickup_city, l.delivery_city].filter(Boolean).join(' → ')) + '</div><div>' + esc(l.item || '') + '</div></div>'; }).join('') : '<div class="card muted center">No leads yet.</div>');
  };
  R.expense = async function (a) {
    view.dataset.job = '';
    await loadJobs();
    view.innerHTML = '<h1>Receipt</h1><form id="f"><label>Type</label><select id="ty"><option value="fuel">Fuel</option><option value="toll">Toll</option><option value="repair">Repair</option></select>' +
      '<label>Amount ($)</label><input id="am" type="number" inputmode="decimal" step="0.01" min="0.01" required><label>Date</label><input id="dt" type="date" required value="' + new Date().toLocaleDateString('en-CA') + '">' +
      '<label>Trip / job</label><select id="jb">' + jobOptions(a[0]) + '</select><label>Note</label><input id="nt">' +
      '<label>Receipt photo *</label><input type="file" id="rc" accept="image/*" capture="environment" required><p><button class="btn primary block" type="submit">Save expense</button></p></form>';
    document.getElementById('f').addEventListener('submit', async function (e) {
      e.preventDefault(); var b = e.target.querySelector('button[type=submit]'); busy(b, true, 'Saving…');
      try {
        var f = document.getElementById('rc').files[0]; if (!f) throw new Error('Receipt photo is required');
        var bl = await resizeImage(f, 1800), path = await upload('receipts', S.profile.driver_id + '/' + uuid() + '.jpg', bl, bl.type);
        var r = await sb.from('expenses').insert({ expense_type: document.getElementById('ty').value, amount: parseFloat(document.getElementById('am').value), expense_date: document.getElementById('dt').value, job_id: document.getElementById('jb').value || null, note: val('nt'), receipt_path: path });
        if (r.error) throw r.error;
        view.innerHTML = '<div class="msg ok">Expense saved.</div><p><a class="btn block" href="#/expense">Add another</a></p><p><a class="btn block" href="#/expenses">My expenses</a></p>';
      } catch (err) { busy(b, false); toast(errMsg(err), 6000); }
    });
  };
  R.expenses = async function () {
    var r = await sb.from('expenses').select('*').eq('driver_id', S.profile.driver_id).order('expense_date', { ascending: false }).limit(60); if (r.error) throw r.error;
    var tot = r.data.reduce(function (s, x) { return s + Number(x.amount); }, 0);
    view.innerHTML = '<h1>My expenses</h1>' + (r.data.length ? '<p class="muted">Total shown: <b>' + money(tot) + '</b></p>' + r.data.map(function (x) { return '<div class="card"><div class="row"><b>' + esc(x.expense_type) + '</b><b>' + money(x.amount) + '</b></div><div class="muted">' + esc(fmtDate(x.expense_date)) + (x.job_id ? ' · ' + esc(x.job_id) : '') + '</div>' + (x.note ? '<div>' + esc(x.note) + '</div>' : '') + '</div>'; }).join('') : '<div class="card muted center">No expenses yet.</div>');
  };
  R.issue = async function (a) {
    view.dataset.job = '';
    await loadJobs();
    view.innerHTML = '<h1>Report an issue</h1><p class="muted">Supervisors see this in the app right away. No emails or texts are sent.</p><form id="f"><label>What happened?</label><select id="ty"><option value="delay">Delay</option><option value="no_show">Customer no-show</option><option value="damage">Damage</option><option value="note">Just a note</option></select>' +
      '<label>Job</label><select id="jb">' + jobOptions(a[0]) + '</select><label>Details *</label><textarea id="ds" required></textarea><label>Photos (optional, needs a job selected)</label><input type="file" id="ph" accept="image/*" multiple><p><button class="btn primary block" type="submit">Send report</button></p></form>';
    document.getElementById('f').addEventListener('submit', async function (e) {
      e.preventDefault(); var b = e.target.querySelector('button[type=submit]'); busy(b, true, 'Sending…');
      try {
        var job = document.getElementById('jb').value || null, paths = [], files = Array.prototype.slice.call(document.getElementById('ph').files || []).slice(0, 6);
        if (files.length && !job) throw new Error('Select a job to attach photos');
        var loc = await getLoc();
        for (var i = 0; i < files.length; i++) { var bl = await resizeImage(files[i]); paths.push(await upload('job-photos', job + '/issue-' + document.getElementById('ty').value + '-' + Date.now() + '-' + i + '.jpg', bl, bl.type)); }
        var r = await sb.from('issues').insert({ job_id: job, issue_type: document.getElementById('ty').value, description: val('ds'), lat: loc ? loc.lat : null, lng: loc ? loc.lng : null, photos: paths });
        if (r.error) throw r.error;
        view.innerHTML = '<div class="msg ok">Reported. Supervisors can see it in the app.</div><p><a class="btn block" href="#/jobs">Back to jobs</a></p>';
      } catch (err) { busy(b, false); toast(errMsg(err), 6000); }
    });
  };
  R.myissues = async function () {
    var r = await sb.from('issues').select('*').eq('driver_id', S.profile.driver_id).order('created_at', { ascending: false }).limit(50); if (r.error) throw r.error;
    view.innerHTML = '<h1>My issues &amp; notes</h1>' + (r.data.length ? r.data.map(function (i) { return '<div class="card"><div class="row"><b>' + esc(i.issue_type.replace('_', ' ')) + (i.job_id ? ' · ' + esc(i.job_id) : '') + '</b><span class="badge ' + (i.status === 'Resolved' ? 'done' : '') + '">' + esc(i.status) + '</span></div><div class="muted">' + esc(fmtTime(i.created_at)) + '</div><div>' + esc(i.description) + '</div>' + (i.resolution_note ? '<div class="muted">Resolved: ' + esc(i.resolution_note) + '</div>' : '') + '</div>'; }).join('') : '<div class="card muted center">Nothing reported.</div>');
  };

  /* ---------- Help ---------- */
  function renderHelp() {
    view.dataset.job = '';
    view.innerHTML = '<h1>Add to Home Screen</h1><p class="muted">Install Toymover so it opens like an app.</p>' +
      '<div class="card"><b>iPhone (Safari)</b><ol class="steps"><li>Open this page in <b>Safari</b> (not inside another app).</li><li>Tap the <b>Share</b> button (square with an up arrow).</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Open Toymover from your home screen.</li></ol></div>' +
      '<div class="card"><b>Android (Chrome)</b><ol class="steps"><li>Open this page in <b>Chrome</b>.</li><li>Tap the <b>⋮ menu</b> (top right).</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li><li>Tap <b>Install</b>. Open Toymover from your home screen.</li></ol></div>' +
      '<div class="card"><b>Allow location and camera</b><p>When asked, tap <b>Allow</b> for location (used when you tap Picked up / In transit / Delivered) and camera (for job photos).</p></div>' +
      (S.profile ? '<p><a class="btn block" href="#/more">Back</a></p>' : '<p><a class="btn block" href="#/">Back to sign in</a></p>');
  }

  /* ---------- Supervisor (Team) ---------- */
  var T = { driver: '', weeks: 1 };
  function needSup() { if (!S.profile || !S.profile.is_supervisor) throw new Error('Supervisors only'); }
  function teamNav(cur, openIssues) {
    var items = [['jobs', 'Jobs'], ['issues', 'Issues' + (openIssues ? ' 🚩' + openIssues : '')], ['leads', 'Leads'], ['expenses', 'Expenses']];
    return '<div class="links" style="margin:0 0 10px">' + items.map(function (i) { return '<a class="btn' + (cur === i[0] ? ' primary' : '') + '" href="#/team/' + i[0] + '">' + i[1] + '</a>'; }).join('') + '</div>';
  }
  async function openIssueCount() { var r = await sb.from('issues').select('id', { count: 'exact', head: true }).eq('status', 'Open'); return r.count || 0; }
  R.team = async function (a) {
    needSup(); view.dataset.job = '';
    var sub = a[0] || 'jobs';
    if (sub === 'job') return teamJob(a[1]);
    var n = await openIssueCount();
    var nav = '<h1>Team</h1>' + teamNav(sub, n);
    if (sub === 'issues') return teamIssues(nav);
    if (sub === 'leads') return teamLeads(nav);
    if (sub === 'expenses') return teamExpenses(nav);
    return teamJobs(nav);
  };
  async function teamJobs(nav) {
    view.innerHTML = nav + '<p class="muted center">Loading…</p>';
    var r = await sb.rpc('sup_jobs', { p_weeks_back: T.weeks }); if (r.error) throw r.error;
    var owner = S.profile.is_owner, jobs = r.data || [];
    var drv = {}; jobs.forEach(function (j) { drv[j.driver_id || 'Unassigned'] = 1; });
    var f = T.driver ? jobs.filter(function (j) { return (j.driver_id || 'Unassigned') === T.driver; }) : jobs;
    var html = nav + '<label>Driver</label><select id="tf"><option value="">All drivers</option>' + Object.keys(drv).sort().map(function (d) { return '<option' + (d === T.driver ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('') + '</select>' +
      '<div class="links"><button class="btn" id="wk">' + (T.weeks ? 'Hide last week' : 'Show last week') + '</button></div>';
    var last = null;
    f.forEach(function (j) {
      if (j.week_start !== last) { last = j.week_start; html += '<h2>' + esc(weekLabel(j.week_start)) + '</h2>'; }
      html += '<a class="card" style="display:block;text-decoration:none;color:inherit" href="#/team/job/' + esc(j.id) + '"><div class="row"><span class="jid">' + esc(j.id) + ' · ' + esc(j.driver_id || 'Unassigned') + '</span>' + badge(j) + '</div>' +
        '<div class="item">' + esc(j.item_type || 'Item not described') + '</div><div class="muted">' + esc(j.pickup_address || j.pickup_name || '?') + ' → ' + esc(j.delivery_address || j.delivery_customer || '?') + '</div>' +
        '<div>' + (j.driver_pay != null ? '<span class="pay">Driver pay ' + money(j.driver_pay) + '</span>' : '') + (owner && j.price != null ? ' · Price ' + money(j.price) : '') + (j.open_issues ? ' · 🚩 ' + j.open_issues + ' open issue(s)' : '') + '</div></a>';
    });
    if (!f.length) html += '<div class="card muted center">No jobs.</div>';
    view.innerHTML = html;
    document.getElementById('tf').onchange = function () { T.driver = this.value; teamJobs(nav); };
    document.getElementById('wk').onclick = function () { T.weeks = T.weeks ? 0 : 1; teamJobs(nav); };
  }
  var leafletReady = null;
  function loadLeaflet() {
    if (leafletReady) return leafletReady;
    leafletReady = new Promise(function (res, rej) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'leaflet.css'; document.head.appendChild(l);
      var s = document.createElement('script'); s.src = 'leaflet.js'; s.onload = res; s.onerror = function () { leafletReady = null; rej(new Error('Map failed to load (offline?)')); }; document.head.appendChild(s);
    });
    return leafletReady;
  }
  async function teamJob(id) {
    view.innerHTML = '<p class="muted center">Loading…</p>';
    var all = await sb.rpc('sup_jobs', { p_weeks_back: 52 }); if (all.error) throw all.error;
    var job = (all.data || []).filter(function (j) { return j.id === id; })[0];
    if (!job) { view.innerHTML = '<div class="msg warn">Job not found.</div><a class="btn" href="#/team/jobs">Back</a>'; return; }
    await loadStatic();
    if (!S.drivers) { var d = await sb.rpc('sup_drivers'); S.drivers = d.data || []; }
    var res = await Promise.all([listPhotos(id), sb.from('job_events').select('*').eq('job_id', id).order('created_at'), sb.from('job_bols').select('*').eq('job_id', id).order('created_at'), sb.from('issues').select('*').eq('job_id', id).order('created_at', { ascending: false })]);
    var photos = res[0], events = res[1].data || [], bols = res[2].data || [], issues = res[3].data || [];
    var urls = await signed('job-photos', photos.map(function (p) { return p.path; })), bu = bols.length ? await signed('signed-bols', bols.map(function (b) { return b.pdf_path; })) : [];
    var owner = S.profile.is_owner;
    var statuses = ['Booked', 'Scheduled', 'In-Transit', 'Delivered', 'Cancelled'].concat(owner ? ['Bid', 'Invoiced', 'Paid'] : []);
    var drvOpts = ['Available'].concat(S.drivers.map(function (x) { return x.id; }).filter(function (x) { return x !== 'Available'; }));
    var h = '<p><a href="#/team/jobs">← Team jobs</a></p><div class="card"><div class="row"><span class="jid">' + esc(job.id) + '</span>' + badge(job) + '</div>' +
      '<div class="item">' + esc(job.item_type || '') + '</div><div>Driver: <b>' + esc(job.driver_name || job.driver_id || 'Unassigned') + '</b></div>' +
      (job.driver_pay != null ? '<div class="pay">Driver pay ' + money(job.driver_pay) + '</div>' : '') +
      (owner ? '<div>Price ' + money(job.price) + ' · Broker ' + money(job.broker) + '</div>' : '') +
      stopHtml('Pickup', job.pickup_name, job.pickup_address, job.pickup_phone) + stopHtml('Delivery', job.delivery_customer, job.delivery_address, job.delivery_phone) +
      (job.contact_name || job.contact_phone ? '<div class="stop"><div class="lbl">Contact</div><div class="nm">' + esc(job.contact_name || '') + '</div><div class="links">' + callBtns(job.contact_phone) + '</div></div>' : '') +
      (owner && job.notes ? '<div class="stop"><div class="lbl">Notes (owner only)</div><div>' + esc(job.notes) + '</div></div>' : '') + '<div class="links">' + bolLink(job.id) + '</div></div>';
    h += '<div class="card"><b>Supervisor actions</b><label>Reassign driver</label><select id="rd">' + drvOpts.map(function (x) { return '<option' + (x === job.driver_id ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select><p><button class="btn block" id="rdb">Reassign</button></p>' +
      '<label>Change status</label><select id="st">' + statuses.map(function (x) { return '<option' + (x === job.status ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select><p><button class="btn block" id="stb">Update status</button></p></div>';
    var ev = events.filter(function (e) { return e.lat != null; });
    h += '<div class="card"><b>Location map</b>' + (ev.length ? '<div id="map" style="height:260px;border-radius:10px;margin-top:8px"></div>' : '<p class="muted">No GPS points recorded yet.</p>') + '</div>';
    h += '<div class="card"><b>Timeline</b>' + timelineHtml(events) + '</div>';
    var byStage = function (st) { var idx = []; photos.forEach(function (p, i) { if (p.stage === st) idx.push(urls[i]); }); return idx; };
    h += '<div class="card"><b>Photos</b>' + ['pickup', 'delivery', 'issue', 'other'].map(function (st) { var u = byStage(st); return u.length ? '<div class="muted" style="margin-top:8px">' + st + '</div>' + thumbs(u) : ''; }).join('') + (photos.length ? '' : '<p class="muted">None uploaded in the app.</p>') + staticPhotoHtml(id) + '</div>';
    h += '<div class="card"><b>Signed BOLs</b>' + (bols.length ? bols.map(function (b, i) { return '<div class="row" style="margin:6px 0"><span>' + esc(b.stage) + ' · ' + esc(b.signer_name) + '<br><span class="muted">' + esc(fmtTime(b.signed_at)) + (b.condition_notes ? ' · ' + esc(b.condition_notes) : '') + '</span></span><a class="btn" target="_blank" rel="noopener" href="' + esc(bu[i]) + '">PDF</a></div>'; }).join('') : '<p class="muted">None signed yet.</p>') + '</div>';
    if (issues.length) h += '<div class="card"><b>Issues</b>' + issues.map(function (i) { return '<div style="margin:6px 0">' + (i.status === 'Open' ? '🚩 ' : '✔ ') + esc(i.issue_type) + ' · ' + esc(i.driver_id) + ' · ' + esc(fmtTime(i.created_at)) + '<br>' + esc(i.description) + '</div>'; }).join('') + '</div>';
    view.innerHTML = h;
    document.getElementById('rdb').onclick = async function () { if (!confirm('Reassign ' + id + ' to ' + document.getElementById('rd').value + '?')) return; var r = await sb.rpc('sup_reassign_job', { p_job_id: id, p_driver_id: document.getElementById('rd').value }); if (r.error) return toast(errMsg(r.error), 5000); toast('Reassigned'); teamJob(id); };
    document.getElementById('stb').onclick = async function () { if (!confirm('Set ' + id + ' to ' + document.getElementById('st').value + '?')) return; var r = await sb.rpc('sup_set_job_status', { p_job_id: id, p_status: document.getElementById('st').value, p_note: null }); if (r.error) return toast(errMsg(r.error), 5000); toast('Status updated'); teamJob(id); };
    if (ev.length) {
      try {
        await loadLeaflet();
        var map = L.map('map'); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
        var pts = ev.map(function (e) { return [e.lat, e.lng]; }); L.polyline(pts, { color: '#1f5fbf' }).addTo(map);
        ev.forEach(function (e, i) { L.circleMarker([e.lat, e.lng], { radius: 8, color: '#fff', weight: 2, fillColor: e.event_type === 'delivered' ? '#1d7a3a' : '#1f5fbf', fillOpacity: 1 }).addTo(map).bindPopup((i + 1) + '. ' + esc(e.event_type) + '<br>' + esc(fmtTime(e.created_at))); });
        map.fitBounds(pts, { padding: [24, 24], maxZoom: 14 });
      } catch (err) { document.getElementById('map').innerHTML = '<p class="muted" style="padding:10px">' + esc(errMsg(err)) + '</p>'; }
    }
  }
  async function teamIssues(nav) {
    var r = await sb.from('issues').select('*').order('created_at', { ascending: false }).limit(100); if (r.error) throw r.error;
    var rows = r.data.sort(function (a, b) { return (a.status === 'Open' ? 0 : 1) - (b.status === 'Open' ? 0 : 1); });
    var allPaths = []; rows.forEach(function (i) { (i.photos || []).forEach(function (p) { allPaths.push(p); }); });
    var urls = allPaths.length ? await signed('job-photos', allPaths) : [], idx = 0;
    view.innerHTML = nav + (rows.length ? rows.map(function (i) {
      var th = (i.photos || []).map(function () { return urls[idx++]; });
      return '<div class="card" style="' + (i.status === 'Open' ? 'border-color:#e0a000;background:#fffaf0' : '') + '"><div class="row"><b>' + (i.status === 'Open' ? '🚩 ' : '✔ ') + esc(i.issue_type.replace('_', ' ')) + ' · ' + esc(i.driver_id) + (i.job_id ? ' · <a href="#/team/job/' + esc(i.job_id) + '">' + esc(i.job_id) + '</a>' : '') + '</b><span class="badge">' + esc(i.status) + '</span></div><div class="muted">' + esc(fmtTime(i.created_at)) + (i.lat != null ? ' · <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=' + i.lat + ',' + i.lng + '">map</a>' : '') + '</div><div>' + esc(i.description) + '</div>' + thumbs(th) +
        (i.status === 'Open' ? '<p><button class="btn primary" data-resolve="' + esc(i.id) + '">Resolve</button></p>' : '<div class="muted">Resolved by ' + esc(i.resolved_by || '') + (i.resolution_note ? ': ' + esc(i.resolution_note) : '') + '</div>') + '</div>';
    }).join('') : '<div class="card muted center">No issues reported.</div>');
    Array.prototype.forEach.call(view.querySelectorAll('[data-resolve]'), function (b) { b.onclick = async function () { var note = prompt('Resolution note (optional):', ''); if (note === null) return; var r2 = await sb.rpc('sup_resolve_issue', { p_issue_id: b.dataset.resolve, p_note: note || null }); if (r2.error) return toast(errMsg(r2.error), 5000); toast('Resolved'); R.team(['issues']); }; });
  }
  async function teamLeads(nav) {
    var r = await sb.from('leads').select('*').order('created_at', { ascending: false }).limit(100); if (r.error) throw r.error;
    var paths = []; r.data.forEach(function (l) { (l.photos || []).forEach(function (p) { paths.push(p); }); });
    var urls = paths.length ? await signed('lead-photos', paths) : [], idx = 0;
    view.innerHTML = nav + (r.data.length ? r.data.map(function (l) {
      var th = (l.photos || []).map(function () { return urls[idx++]; });
      var act = l.status === 'Converted' ? '<div class="muted">Converted to job ' + esc(l.converted_job_id || '') + '</div>' :
        '<div class="links"><button class="btn" data-lead="' + esc(l.id) + '" data-st="Reviewed">Mark reviewed</button><button class="btn" data-lead="' + esc(l.id) + '" data-st="Rejected">Reject</button><button class="btn primary" data-convert="' + esc(l.id) + '">Convert to job</button></div>';
      return '<div class="card"><div class="row"><b>' + esc(l.customer_name) + '</b><span class="badge">' + esc(l.status) + '</span></div><div class="muted">From ' + esc(l.submitted_by) + ' · ' + esc(fmtTime(l.created_at)) + '</div>' +
        (l.customer_phone ? '<div class="links">' + callBtns(l.customer_phone) + '</div>' : '') + '<div>' + esc([l.pickup_address, l.pickup_city].filter(Boolean).join(', ')) + ' → ' + esc([l.delivery_address, l.delivery_city].filter(Boolean).join(', ')) + '</div><div class="item">' + esc(l.item || '') + '</div>' +
        (l.preferred_dates ? '<div>Dates: ' + esc(l.preferred_dates) + '</div>' : '') + (l.notes ? '<div>' + esc(l.notes) + '</div>' : '') + thumbs(th) + act + '</div>';
    }).join('') : '<div class="card muted center">No leads yet.</div>');
    Array.prototype.forEach.call(view.querySelectorAll('[data-lead]'), function (b) { b.onclick = async function () { var r2 = await sb.rpc('sup_set_lead_status', { p_lead_id: b.dataset.lead, p_status: b.dataset.st }); if (r2.error) return toast(errMsg(r2.error), 5000); toast('Lead ' + b.dataset.st.toLowerCase()); R.team(['leads']); }; });
    Array.prototype.forEach.call(view.querySelectorAll('[data-convert]'), function (b) { b.onclick = async function () { if (!confirm('Create a new Booked job from this lead? (No driver or price is set.)')) return; var r2 = await sb.rpc('sup_convert_lead_to_job', { p_lead_id: b.dataset.convert }); if (r2.error) return toast(errMsg(r2.error), 5000); toast('Created job ' + r2.data, 4000); R.team(['leads']); }; });
  }
  async function teamExpenses(nav) {
    var r = await sb.from('expenses').select('*').order('expense_date', { ascending: false }).limit(150); if (r.error) throw r.error;
    var paths = r.data.map(function (x) { return x.receipt_path; }).filter(Boolean), urls = paths.length ? await signed('receipts', paths) : [], byDrv = {};
    r.data.forEach(function (x) { byDrv[x.driver_id] = (byDrv[x.driver_id] || 0) + Number(x.amount); });
    view.innerHTML = nav + '<div class="card"><b>Totals shown</b>' + (Object.keys(byDrv).sort().map(function (d) { return '<div class="row"><span>' + esc(d) + '</span><span>' + money(byDrv[d]) + '</span></div>'; }).join('') || '<p class="muted">None.</p>') + '</div>' +
      r.data.map(function (x) { var u = x.receipt_path ? urls[paths.indexOf(x.receipt_path)] : null; return '<div class="card"><div class="row"><b>' + esc(x.driver_id) + ' · ' + esc(x.expense_type) + '</b><b>' + money(x.amount) + '</b></div><div class="muted">' + esc(fmtDate(x.expense_date)) + (x.job_id ? ' · <a href="#/team/job/' + esc(x.job_id) + '">' + esc(x.job_id) + '</a>' : '') + '</div>' + (x.note ? '<div>' + esc(x.note) + '</div>' : '') + thumbs([u]) + '</div>'; }).join('');
  }

  /* ---------- boot ---------- */
  sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_OUT' && S.profile) showLogin(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  start();
})();
