// ==UserScript==
// @name         eProc - Gravador de Testes para Homologação
// @namespace    eproc-gravador-testes
// @version      6.1.0
// @description  Registra ações do usuário, captura viewport e gera relatório sequencial
// @author       Gerado via Claude
// @include      *://eproc*.tjsp.jus.br/*
// @include      *://*-1g-*.tjsp.jus.br/*
// @include      *://*-2g-*.tjsp.jus.br/*
// @include      *://sso-*.tjsc.jus.br/*
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ────────────────────────────────────────────────
  //  STORAGE
  // ────────────────────────────────────────────────
  const SK = {
    rec:         'eprec_rec',
    steps:       'eprec_steps',
    count:       'eprec_count',
    sessions:    'eprec_sessions',
    autoshot:    'eprec_autoshot',
    autoshotbtn: 'eprec_autoshotbtn',
  };
  const SHOT_PFX = 'eprec_shot_';

  function ss(k, v) {
    if (v === undefined) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } }
    try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {}
  }

  let recording   = ss(SK.rec)         || false;
  let steps       = ss(SK.steps)       || [];
  let counter     = ss(SK.count)       || 0;
  let autoShot    = ss(SK.autoshot)    ?? true;
  let autoShotBtn = ss(SK.autoshotbtn) || false;

  let captureQueue     = Promise.resolve();
  let popObs           = null;
  let pendingCapture   = null;
  const knownPopups    = new WeakSet();
  const screenshots    = {};

  function saveShot(num, dataUrl) {
    screenshots[num] = dataUrl;
    try { sessionStorage.setItem(SHOT_PFX + num, dataUrl); } catch {}
  }
  function getShot(num) {
    return screenshots[num] || sessionStorage.getItem(SHOT_PFX + num) || null;
  }
  function clearShots() {
    Object.keys(screenshots).forEach(k => delete screenshots[k]);
    const rem = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(SHOT_PFX)) rem.push(k);
    }
    rem.forEach(k => sessionStorage.removeItem(k));
  }
  function loadShotsFromStorage() {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(SHOT_PFX)) {
        const n = parseInt(k.slice(SHOT_PFX.length), 10);
        if (!isNaN(n)) screenshots[n] = sessionStorage.getItem(k);
      }
    }
  }

  // ────────────────────────────────────────────────
  //  ESTILOS
  // ────────────────────────────────────────────────
  GM_addStyle(`
    #eprec {
      position:fixed!important;bottom:18px!important;right:18px!important;
      z-index:2147483647!important;width:255px;
      background:#12161f;color:#c9d1e0;border-radius:10px;
      box-shadow:0 6px 24px rgba(0,0,0,.6);
      font:13px/1.4 'Segoe UI',Arial,sans-serif!important;
      user-select:none;border:1px solid #2a2f3d;
    }
    #eprec *{box-sizing:border-box;font-family:inherit!important}
    #eprec-head{
      display:flex;align-items:center;gap:7px;
      padding:8px 11px;border-radius:10px 10px 0 0;
      cursor:move;background:#0c0f17;border-bottom:1px solid #2a2f3d;
    }
    #eprec-head.on{background:#1f0b0b;border-bottom-color:#5c1a1a}
    #eprec-led{width:8px;height:8px;border-radius:50%;background:#2d3748;flex-shrink:0;transition:background .3s}
    #eprec-led.on{background:#f56565;animation:epblink 1.4s ease-in-out infinite}
    @keyframes epblink{0%,100%{opacity:1}50%{opacity:.3}}
    #eprec-label{flex:1;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#4a5568}
    #eprec-label.on{color:#f56565}
    #eprec-count{font-size:10px;font-weight:700;background:#1e2533;color:#63b3ed;border-radius:99px;padding:1px 7px}
    #eprec-count.on{background:#3d1515;color:#fc8181}
    #eprec-min{font-size:12px;color:#2d3748;cursor:pointer;padding:0 2px}
    #eprec-min:hover{color:#718096}
    #eprec-body{padding:10px 11px 11px}
    #eprec-status{
      font-size:11px;padding:5px 8px;border-radius:5px;
      margin-bottom:9px;background:#1e2533;color:#718096;border-left:3px solid #2d3748;
    }
    #eprec-status.on {color:#68d391;border-left-color:#276749;background:#0f1e16}
    #eprec-status.off{color:#f6ad55;border-left-color:#b7791f;background:#1a1408}
    .eb{
      display:flex;align-items:center;justify-content:center;gap:5px;
      width:100%;padding:7px 10px;border-radius:6px;border:none;
      font-size:12px;font-weight:700;cursor:pointer;margin-bottom:5px;transition:filter .15s;
    }
    .eb:last-child{margin-bottom:0}
    .eb:hover{filter:brightness(1.2)}
    .eb:active{filter:brightness(.9)}
    .eb:disabled{opacity:.5;cursor:default;filter:none}
    .eb-start {background:#1c4532;color:#9ae6b4}
    .eb-stop  {background:#4a0f0f;color:#feb2b2}
    .eb-export{background:#1a365d;color:#90cdf4}
    .eb-clear {background:#1e2533;color:#718096}
    .eb-hist  {background:#2d1f44;color:#d6bcfa}
    .eb-row{display:flex;gap:5px;margin-bottom:5px}
    .eb-row .eb{margin-bottom:0}
    .eb-shot{background:#2d1f00;color:#fbd38d;font-size:11px}
    .eb-note{background:#1e1040;color:#d6bcfa;font-size:11px}
    #eprec-hint{font-size:10px;color:#2d3748;margin-top:7px;line-height:1.5}
    .eprec-toggle-row{display:flex;align-items:center;gap:6px;margin-bottom:5px}
    .eprec-toggle{
      position:relative;width:28px;height:15px;flex-shrink:0;cursor:pointer;
      background:#2d3748;border-radius:99px;transition:background .2s;
    }
    .eprec-toggle.on{background:#276749}
    .eprec-toggle::after{
      content:'';position:absolute;top:2px;left:2px;
      width:11px;height:11px;border-radius:50%;background:#fff;transition:left .2s;
    }
    .eprec-toggle.on::after{left:15px}
    .eprec-toggle-lbl{font-size:10px;color:#4a5568;flex:1}
    #eprec-log{display:none;max-height:90px;overflow-y:auto;background:#080b12;border-radius:5px;padding:4px 6px;margin-top:7px}
    .el{font-size:10px;color:#2d3748;padding:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .el.hi{color:#63b3ed}
    #eprec-logtoggle{font-size:10px;color:#2d3748;cursor:pointer;margin-top:6px;text-align:right}
    #eprec-logtoggle:hover{color:#4a5568}
    #eprec-capturing{
      display:none;position:fixed!important;top:10px!important;right:10px!important;
      z-index:2147483648!important;background:#276749;color:#9ae6b4;
      font:700 11px/1 'Segoe UI',Arial,sans-serif!important;
      padding:5px 10px;border-radius:99px;pointer-events:none;
    }
    /* Modal anotação */
    #eprec-modal{
      display:none;position:fixed!important;inset:0;
      z-index:2147483648!important;background:rgba(0,0,0,.7);
      align-items:center;justify-content:center;
    }
    #eprec-modal.open{display:flex!important}
    #eprec-mbox{
      background:#12161f;border:1px solid #2a2f3d;border-radius:10px;
      padding:18px;width:460px;max-width:92vw;
      box-shadow:0 20px 60px rgba(0,0,0,.7);
    }
    #eprec-mbox label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#4a5568;margin-bottom:7px}
    #eprec-mthumb{display:none;width:100%;border-radius:5px;margin-bottom:9px;border:1px solid #2a2f3d}
    #eprec-mtext{
      width:100%;background:#080b12;border:1px solid #2a2f3d;color:#c9d1e0;
      border-radius:5px;padding:7px 9px;font-size:13px;resize:vertical;min-height:70px;outline:none;
    }
    #eprec-mtext:focus{border-color:#553c9a}
    #eprec-mfooter{display:flex;gap:7px;margin-top:10px;justify-content:flex-end}
    .emb{padding:6px 14px;border-radius:5px;border:none;font-size:12px;font-weight:700;cursor:pointer}
    #eprec-mcancel{background:#1e2533;color:#718096}
    #eprec-mok    {background:#553c9a;color:#fff}
    /* Modal histórico */
    #eprec-hist-modal{
      display:none;position:fixed!important;inset:0;
      z-index:2147483648!important;background:rgba(0,0,0,.75);
      align-items:flex-start;justify-content:center;padding-top:40px;
    }
    #eprec-hist-modal.open{display:flex!important}
    #eprec-hist-box{
      background:#12161f;border:1px solid #2a2f3d;border-radius:10px;
      padding:18px;width:520px;max-width:94vw;max-height:70vh;overflow-y:auto;
      box-shadow:0 20px 60px rgba(0,0,0,.7);
    }
    #eprec-hist-box h3{margin:0 0 12px;font-size:14px;color:#c9d1e0}
    .ehist-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #1e2533;font-size:12px}
    .ehist-row:last-child{border-bottom:none}
    .ehist-info{flex:1;color:#718096}
    .ehist-info strong{color:#c9d1e0;display:block}
    .ehist-btn{background:#1a365d;color:#90cdf4;border:none;border-radius:5px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer}
    .ehist-btn:hover{filter:brightness(1.3)}
    .ehist-del{background:#3d1515;color:#fc8181}
    #eprec-floatind{
      display:none;position:fixed!important;bottom:18px!important;right:18px!important;
      z-index:2147483646!important;background:#4a0f0f;color:#feb2b2;
      font:700 11px/1 'Segoe UI',Arial,sans-serif!important;
      padding:5px 10px;border-radius:99px;border:1px solid #742a2a;pointer-events:none;
    }
  `);

  // ────────────────────────────────────────────────
  //  PAINEL
  // ────────────────────────────────────────────────
  function buildPanel() {
    if (document.getElementById('eprec')) return;
    const p = document.createElement('div');
    p.id = 'eprec';
    p.innerHTML = `
      <div id="eprec-head">
        <div id="eprec-led"></div>
        <span id="eprec-label">Gravador</span>
        <span id="eprec-count">0</span>
        <span id="eprec-min">▼</span>
      </div>
      <div id="eprec-body">
        <div id="eprec-status">Pronto para gravar</div>
        <button class="eb eb-start" id="eprec-btn-rec">▶ Iniciar Gravação</button>
        <div class="eb-row" id="eprec-midrow" style="display:none">
          <button class="eb eb-shot" id="eprec-btn-shot">📷 Print</button>
          <button class="eb eb-note" id="eprec-btn-note">✏️ Nota</button>
        </div>
        <button class="eb eb-export" id="eprec-btn-exp" style="display:none">⬇ Exportar Relatório</button>
        <div class="eb-row" id="eprec-bottom-row" style="display:none">
          <button class="eb eb-hist" id="eprec-btn-hist">📚 Histórico</button>
          <button class="eb eb-clear" id="eprec-btn-clr">🗑 Limpar</button>
        </div>
        <div id="eprec-autorow" style="display:none;margin-top:7px;border-top:1px solid #1e2533;padding-top:7px">
          <div class="eprec-toggle-row">
            <div class="eprec-toggle" id="eprec-tog-events"></div>
            <span class="eprec-toggle-lbl">📷 Auto em submit/popup/navegação</span>
          </div>
          <div class="eprec-toggle-row">
            <div class="eprec-toggle" id="eprec-tog-btn"></div>
            <span class="eprec-toggle-lbl">📷 Auto após clique</span>
          </div>
        </div>
        <div id="eprec-hint"></div>
        <div id="eprec-logtoggle">▸ log</div>
        <div id="eprec-log"></div>
      </div>`;
    document.body.appendChild(p);

    const ind = document.createElement('div');
    ind.id = 'eprec-floatind'; ind.textContent = '● REC';
    document.body.appendChild(ind);

    const cap = document.createElement('div');
    cap.id = 'eprec-capturing'; cap.textContent = '📷 capturando…';
    document.body.appendChild(cap);

    drag(p, document.getElementById('eprec-head'));

    let mini = false;
    document.getElementById('eprec-min').addEventListener('click', () => {
      mini = !mini;
      document.getElementById('eprec-body').style.display = mini ? 'none' : 'block';
      document.getElementById('eprec-head').style.borderRadius = mini ? '10px' : '10px 10px 0 0';
      document.getElementById('eprec-min').textContent = mini ? '▲' : '▼';
      if (mini) document.getElementById('eprec-floatind').style.display = recording ? 'block' : 'none';
    });
    document.getElementById('eprec-logtoggle').addEventListener('click', () => {
      const l = document.getElementById('eprec-log');
      const b = document.getElementById('eprec-logtoggle');
      const open = l.style.display === 'block';
      l.style.display = open ? 'none' : 'block';
      b.textContent   = open ? '▸ log' : '▾ log';
    });

    document.getElementById('eprec-btn-rec') .addEventListener('click', e => { e.stopPropagation(); toggleRec(); });
    document.getElementById('eprec-btn-shot').addEventListener('click', e => { e.stopPropagation(); openShotModal(); });
    document.getElementById('eprec-btn-note').addEventListener('click', e => { e.stopPropagation(); openNoteModal(); });
    document.getElementById('eprec-btn-exp') .addEventListener('click', e => { e.stopPropagation(); exportCurrentSession(); });
    document.getElementById('eprec-btn-clr') .addEventListener('click', e => { e.stopPropagation(); clearCurrent(); });
    document.getElementById('eprec-btn-hist').addEventListener('click', e => { e.stopPropagation(); openHistModal(); });
    document.getElementById('eprec-tog-events').addEventListener('click', e => { e.stopPropagation(); autoShot = !autoShot; ss(SK.autoshot, autoShot); refreshUI(); });
    document.getElementById('eprec-tog-btn')  .addEventListener('click', e => { e.stopPropagation(); autoShotBtn = !autoShotBtn; ss(SK.autoshotbtn, autoShotBtn); refreshUI(); });

    refreshUI();
  }

  // ────────────────────────────────────────────────
  //  MODAL ANOTAÇÃO / PRINT MANUAL
  // ────────────────────────────────────────────────
  function buildModal() {
    if (document.getElementById('eprec-modal')) return;
    const m = document.createElement('div');
    m.id = 'eprec-modal';
    m.innerHTML = `
      <div id="eprec-mbox">
        <label id="eprec-mlabel">Anotação</label>
        <img id="eprec-mthumb" alt="">
        <textarea id="eprec-mtext" placeholder="Descreva o que está sendo testado..."></textarea>
        <div id="eprec-mfooter">
          <button class="emb" id="eprec-mcancel">Cancelar</button>
          <button class="emb" id="eprec-mok">✔ Salvar</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    document.getElementById('eprec-mcancel').addEventListener('click', closeModal);
    document.getElementById('eprec-mok')    .addEventListener('click', saveModal);
    m.addEventListener('click', e => { if (e.target === m) closeModal(); });
  }

  let modalMode = 'note';

  function openNoteModal() {
    if (!recording) return;
    modalMode = 'note'; pendingCapture = null;
    const thumb = document.getElementById('eprec-mthumb');
    if (thumb) { thumb.style.display = 'none'; thumb.src = ''; }
    document.getElementById('eprec-mlabel').textContent = 'Anotação / Observação';
    document.getElementById('eprec-mtext').placeholder  = 'Descreva o passo, comportamento ou anomalia…';
    document.getElementById('eprec-mtext').value = '';
    document.getElementById('eprec-modal').classList.add('open');
    setTimeout(() => document.getElementById('eprec-mtext').focus(), 80);
  }

  async function openShotModal() {
    if (!recording) return;
    modalMode = 'shot'; pendingCapture = null;
    const btnShot = document.getElementById('eprec-btn-shot');
    if (btnShot) { btnShot.disabled = true; btnShot.textContent = '📷 Capturando…'; }
    showCapInd(true);
    const imgData = await captureViewport();
    pendingCapture = imgData;
    showCapInd(false);
    if (btnShot) { btnShot.disabled = false; btnShot.textContent = '📷 Print'; }
    const thumb = document.getElementById('eprec-mthumb');
    if (thumb) {
      if (imgData) { thumb.src = imgData; thumb.style.display = 'block'; }
      else { thumb.style.display = 'none'; thumb.src = ''; }
    }
    document.getElementById('eprec-mlabel').textContent = imgData ? '📷 Tela capturada — adicione uma descrição' : '📷 Print manual';
    document.getElementById('eprec-mtext').placeholder  = 'Ex: "Formulário preenchido", "Mensagem de erro", "Resultado da operação"…';
    document.getElementById('eprec-mtext').value = '';
    document.getElementById('eprec-modal').classList.add('open');
    setTimeout(() => document.getElementById('eprec-mtext').focus(), 80);
  }

  function closeModal() {
    document.getElementById('eprec-modal').classList.remove('open');
    pendingCapture = null;
    const thumb = document.getElementById('eprec-mthumb');
    if (thumb) { thumb.style.display = 'none'; thumb.src = ''; }
  }

  function saveModal() {
    const txt = document.getElementById('eprec-mtext').value.trim();
    if (modalMode === 'shot') {
      addStep('print_manual', txt || 'Print de tela registrado', pendingCapture);
    } else {
      if (!txt) { closeModal(); return; }
      addStep('anotacao', txt);
    }
    closeModal();
  }

  function showCapInd(v) {
    const el = document.getElementById('eprec-capturing');
    if (el) el.style.display = v ? 'block' : 'none';
  }

  // ────────────────────────────────────────────────
  //  MODAL HISTÓRICO
  // ────────────────────────────────────────────────
  function buildHistModal() {
    if (document.getElementById('eprec-hist-modal')) return;
    const m = document.createElement('div');
    m.id = 'eprec-hist-modal';
    m.innerHTML = `<div id="eprec-hist-box">
      <h3>📚 Histórico de Gravações</h3>
      <div id="eprec-hist-list"></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) closeHistModal(); });
  }

  function openHistModal()  { buildHistModal(); renderHistList(); document.getElementById('eprec-hist-modal').classList.add('open'); }
  function closeHistModal() { const m = document.getElementById('eprec-hist-modal'); if (m) m.classList.remove('open'); }

  function renderHistList() {
    const list = document.getElementById('eprec-hist-list');
    if (!list) return;
    const all = getSessions();
    if (!all.length) { list.innerHTML = '<p style="color:#4a5568;font-size:12px">Nenhuma gravação anterior.</p>'; return; }
    list.innerHTML = all.map((sess, idx) => `
      <div class="ehist-row">
        <div class="ehist-info">
          <strong>${esc(sess.title || 'Sessão ' + (idx + 1))}</strong>
          ${esc(sess.date)} — ${sess.steps.length} passos
          ${sess.printCount ? ` — ${sess.printCount} prints` : ''}
        </div>
        <button class="ehist-btn" data-idx="${idx}">⬇ Exportar</button>
        <button class="ehist-btn ehist-del" data-del="${idx}">🗑</button>
      </div>`).join('');
    list.querySelectorAll('[data-idx]').forEach(btn => btn.addEventListener('click', e => {
      exportSession(getSessions()[+e.target.dataset.idx]);
    }));
    list.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', e => {
      if (!confirm('Remover esta gravação?')) return;
      const upd = getSessions(); upd.splice(+e.target.dataset.del, 1);
      ss(SK.sessions, upd); renderHistList(); refreshUI();
    }));
  }

  function getSessions() { return ss(SK.sessions) || []; }

  function commitToHistory() {
    if (!steps.length) return;
    const shotsMap = {};
    steps.forEach(s => { const img = getShot(s.num); if (img) shotsMap[s.num] = img; });
    const all   = getSessions();
    const now   = new Date();
    all.push({
      id: now.getTime(),
      title: (steps[0]?.pageTitle || 'Gravação').substring(0, 60),
      date:  now.toLocaleString('pt-BR'),
      steps: [...steps],
      shots: shotsMap,
      printCount: Object.keys(shotsMap).length,
    });
    ss(SK.sessions, all);
  }

  // ────────────────────────────────────────────────
  //  DRAG
  // ────────────────────────────────────────────────
  function drag(el, handle) {
    let dx = 0, dy = 0, sx, sy;
    handle.addEventListener('mousedown', e => {
      if (['eprec-min','eprec-count'].includes(e.target.id)) return;
      sx = e.clientX - dx; sy = e.clientY - dy;
      const mv = ev => { dx = ev.clientX - sx; dy = ev.clientY - sy; el.style.transform = `translate(${dx}px,${dy}px)`; };
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', () => document.removeEventListener('mousemove', mv), { once: true });
    });
  }

  // ────────────────────────────────────────────────
  //  GRAVAÇÃO
  // ────────────────────────────────────────────────
  function toggleRec() { if (recording) stopRec(); else startRec(); }

  function startRec() {
    if (steps.length > 0) commitToHistory();
    recording = true; steps = []; counter = 0;
    ss(SK.rec, true); ss(SK.steps, []); ss(SK.count, 0);
    clearShots();
    attachListeners(); observePopups();
    addStep('inicio', `Início do registro na página "${document.title}"`);
    refreshUI();
  }

  function stopRec() {
    recording = false; ss(SK.rec, false);
    detachListeners();
    if (popObs) { popObs.disconnect(); popObs = null; }
    refreshUI();
  }

  function clearCurrent() {
    if (!confirm('Limpar a sessão atual? (Histórico anterior mantido)')) return;
    steps = []; counter = 0;
    ss(SK.steps, []); ss(SK.count, 0);
    clearShots();
    document.getElementById('eprec-log').innerHTML = '';
    refreshUI();
  }

  // ────────────────────────────────────────────────
  //  REFRESH UI
  // ────────────────────────────────────────────────
  function refreshUI() {
    const led    = document.getElementById('eprec-led');
    const lbl    = document.getElementById('eprec-label');
    const cnt    = document.getElementById('eprec-count');
    const head   = document.getElementById('eprec-head');
    const stat   = document.getElementById('eprec-status');
    const btnR   = document.getElementById('eprec-btn-rec');
    const mid    = document.getElementById('eprec-midrow');
    const btnE   = document.getElementById('eprec-btn-exp');
    const botRow = document.getElementById('eprec-bottom-row');
    const hint   = document.getElementById('eprec-hint');
    const autoRow= document.getElementById('eprec-autorow');
    const togEv  = document.getElementById('eprec-tog-events');
    const togBtn = document.getElementById('eprec-tog-btn');
    if (!led) return;

    const n = steps.length;
    cnt.textContent = `${n} passo${n !== 1 ? 's' : ''}`;
    if (togEv)  togEv.className  = 'eprec-toggle' + (autoShot    ? ' on' : '');
    if (togBtn) togBtn.className = 'eprec-toggle' + (autoShotBtn ? ' on' : '');
    const histCount = getSessions().length;

    if (recording) {
      led.className = 'on'; lbl.className = 'on'; lbl.textContent = '● GRAVANDO';
      head.className = 'on'; cnt.className = 'on'; stat.className = 'on';
      stat.textContent = 'Registrando ações…';
      btnR.className = 'eb eb-stop'; btnR.textContent = '⏹ Parar';
      mid.style.display = 'flex'; btnE.style.display = 'none';
      botRow.style.display = 'none'; autoRow.style.display = 'block';
      hint.innerHTML = '<span style="color:#2d3748;font-size:10px">📷 <kbd>Alt+P</kbd> print &nbsp;|&nbsp; ✏️ <kbd>Alt+A</kbd> nota</span>';
    } else {
      led.className = ''; lbl.className = ''; lbl.textContent = 'Gravador';
      head.className = ''; cnt.className = '';
      btnR.className = 'eb eb-start'; btnR.textContent = '▶ Iniciar Gravação';
      mid.style.display = 'none'; autoRow.style.display = 'none'; hint.innerHTML = '';
      if (n > 0) {
        stat.className = 'off';
        stat.textContent = `Parado — ${n} passo${n !== 1 ? 's' : ''} gravados`;
        btnE.style.display = ''; botRow.style.display = 'flex';
      } else if (histCount > 0) {
        stat.className = ''; stat.textContent = `Pronto — ${histCount} sessão${histCount !== 1 ? 'ões' : ''} no histórico`;
        btnE.style.display = 'none'; botRow.style.display = 'flex';
        document.getElementById('eprec-btn-clr').style.display = 'none';
      } else {
        stat.className = ''; stat.textContent = 'Pronto para gravar';
        btnE.style.display = 'none'; botRow.style.display = 'none';
      }
      document.getElementById('eprec-floatind').style.display = 'none';
    }
  }

  // ────────────────────────────────────────────────
  //  PASSOS
  // ────────────────────────────────────────────────
  function addStep(type, description, screenshot) {
    counter++;
    ss(SK.count, counter);
    const step = {
      num:       counter,
      type,
      description,
      tsNum:     Date.now(),
      timestamp: new Date().toLocaleTimeString('pt-BR'),
      pageTitle: document.title,
      url:       location.href,
    };
    if (screenshot) saveShot(counter, screenshot);
    steps.push(step);
    steps.sort((a, b) => a.tsNum - b.tsNum);
    ss(SK.steps, steps);
    refreshUI();
    addLog(`#${step.num} ${description.substring(0, 55)}`);
  }

  function addLog(msg) {
    const log = document.getElementById('eprec-log');
    if (!log) return;
    const l = document.createElement('div');
    l.className = 'el hi';
    l.textContent = `[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`;
    log.insertBefore(l, log.firstChild);
    setTimeout(() => l.classList.remove('hi'), 3000);
    while (log.children.length > 50) log.removeChild(log.lastChild);
  }

  // ────────────────────────────────────────────────
  //  CAPTURA — SOMENTE VIEWPORT (sem scroll)
  // ────────────────────────────────────────────────
  function enqueueCapture(type, desc, delayMs) {
    captureQueue = captureQueue.then(async () => {
      if (!recording) return;
      showCapInd(true);
      await sleep(delayMs);
      const img = await captureViewport();
      showCapInd(false);
      addStep(type, desc, img);
    });
  }

  async function captureViewport() {
    if (typeof html2canvas === 'undefined') {
      console.warn('[eprec] html2canvas não carregou');
      return null;
    }
    const IGNORE = new Set(['eprec', 'eprec-floatind', 'eprec-modal', 'eprec-capturing', 'eprec-hist-modal']);

    // Posição e dimensões do viewport NO MOMENTO da captura
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const sx = Math.round(window.scrollX);
    const sy = Math.round(window.scrollY);

    try {
      // Renderiza a página completa (html2canvas ignora scrollX/Y nos parâmetros x/y
      // quando o target é document.body — a única forma confiável de recortar o viewport
      // é renderizar tudo e depois cortar o canvas resultante na posição do scroll).
      const full = await html2canvas(document.body, {
        scale:         0.8,
        useCORS:       true,
        allowTaint:    true,
        logging:       false,
        removeContainer: true,
        imageTimeout:  6000,
        // Informa ao html2canvas qual é o tamanho da janela para posicionamento de
        // elementos fixed/sticky — sem isso o scroll é ignorado.
        windowWidth:   vw,
        windowHeight:  vh,
        scrollX:       -sx,   // deslocamento negativo = html2canvas começa do ponto certo
        scrollY:       -sy,
        ignoreElements: el => IGNORE.has(el.id),
      });

      // Recorta do canvas completo apenas a fatia correspondente ao viewport.
      // A escala 0.8 é aplicada ao canvas inteiro, então os pixels do scroll
      // precisam ser multiplicados pela mesma escala.
      const scale  = 0.8;
      const cropX  = Math.round(sx * scale);
      const cropY  = Math.round(sy * scale);
      const cropW  = Math.min(Math.round(vw * scale), full.width  - cropX);
      const cropH  = Math.min(Math.round(vh * scale), full.height - cropY);

      if (cropW <= 0 || cropH <= 0) return full.toDataURL('image/jpeg', 0.82);

      const out = document.createElement('canvas');
      out.width  = cropW;
      out.height = cropH;
      out.getContext('2d').drawImage(full, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      return out.toDataURL('image/jpeg', 0.82);
    } catch (err) {
      console.warn('[eprec] captureViewport falhou:', err.message);
      return null;
    }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ────────────────────────────────────────────────
  //  LISTENERS
  // ────────────────────────────────────────────────
  function attachListeners() {
    document.addEventListener('click',  onClick,  true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('blur',   onBlur,   true);
  }
  function detachListeners() {
    document.removeEventListener('click',  onClick,  true);
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('submit', onSubmit, true);
    document.removeEventListener('blur',   onBlur,   true);
  }

  // Última ação registrada para deduplicação
  let lastActionKey = '';
  let lastActionTs  = 0;
  function isDuplicate(key) {
    const now = Date.now();
    if (key === lastActionKey && (now - lastActionTs) < 800) return true;
    lastActionKey = key; lastActionTs = now;
    return false;
  }

  // ── CLICK — registra apenas ações do usuário
  function onClick(e) {
    if (!recording) return;
    const el = e.target;
    if (!el) return;
    if (el.closest('#eprec') || el.closest('#eprec-modal') ||
        el.closest('#eprec-floatind') || el.closest('#eprec-hist-modal')) return;

    const root = findClickable(el);
    if (!root) return;

    const desc = descEl(root);
    const key  = desc.substring(0, 80);
    if (isDuplicate(key)) return;   // ignora cliques duplicados rápidos

    const tag  = root.tagName.toLowerCase();
    const role = (root.getAttribute('role') || '').toLowerCase();
    const type = tag === 'a' ? 'clique_link'
      : ['tab','menuitem','treeitem','option'].includes(role) ? 'clique_menu'
      : 'clique_botao';

    addStep(type, desc);

    if (autoShotBtn) {
      enqueueCapture('print_auto', desc, 900);
    }
  }

  function findClickable(el) {
    let cur = el;
    for (let i = 0; i < 7; i++) {
      if (!cur || cur === document.body || cur === document.documentElement) return null;
      if (isClickable(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function isClickable(el) {
    const tag  = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const type = (el.type || '').toLowerCase();
    if (['button','a'].includes(tag)) return true;
    if (tag === 'input' && ['submit','button','reset','checkbox','radio'].includes(type)) return true;
    if (tag === 'select') return true;
    if (['button','link','tab','menuitem','treeitem','option','checkbox','radio','switch'].includes(role)) return true;
    if (el.hasAttribute('onclick')) return true;
    try {
      if (window.getComputedStyle(el).cursor === 'pointer' && (el.textContent || '').trim()) return true;
    } catch {}
    return false;
  }

  // ── CHANGE
  function onChange(e) {
    if (!recording) return;
    const el   = e.target;
    if (!el || el.closest('#eprec')) return;
    const tag  = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    if (tag === 'select') {
      const lbl = findLabel(el) || el.name || el.id || 'campo';
      const val = el.options[el.selectedIndex]?.text || el.value;
      const key = `sel:${lbl}:${val}`;
      if (!isDuplicate(key))
        addStep('select', `Ao selecionar "${val}" no campo "${lbl}"`);
    }
    if (tag === 'input' && ['checkbox','radio'].includes(type)) {
      const lbl  = findLabel(el) || el.name || el.id || el.value || 'opção';
      const desc = type === 'checkbox'
        ? `Ao ${el.checked ? 'marcar' : 'desmarcar'} a opção "${lbl}"`
        : `Ao selecionar a opção "${lbl}"`;
      if (!isDuplicate(desc)) addStep('select', desc);
    }
  }

  // ── BLUR — campos de texto
  const blurTrack = new WeakMap();
  function onBlur(e) {
    if (!recording) return;
    const el   = e.target;
    if (!el || el.closest('#eprec') || el.closest('#eprec-modal')) return;
    const tag  = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    if (tag === 'input' && ['submit','button','reset','checkbox','radio','hidden','file','image'].includes(type)) return;
    if (tag !== 'input' && tag !== 'textarea') return;
    const val = (el.value || '').trim();
    if (!val) return;
    if (blurTrack.get(el) === val) return;
    blurTrack.set(el, val);
    const lbl   = findLabel(el) || el.placeholder || el.getAttribute('aria-label') || el.name || el.id || 'campo';
    const shown = type === 'password' ? '(senha)' : val.length > 70 ? val.substring(0, 70) + '…' : val;
    addStep('input', `Ao preencher o campo "${lbl}" com "${shown}"`);
  }

  // ── SUBMIT
  function onSubmit(e) {
    if (!recording) return;
    const form = e.target;
    if (form.closest('#eprec')) return;
    const id = form.id || form.name || (form.action || '').split('/').pop() || 'formulário';
    addStep('submit', `Ao enviar o formulário "${id}"`);
    if (autoShot) {
      enqueueCapture('print_auto', `Resultado após envio do formulário "${id}"`, 1400);
    }
  }

  // ────────────────────────────────────────────────
  //  DESCREVER ELEMENTO
  // ────────────────────────────────────────────────
  function descEl(el) {
    if (!el) return 'Elemento';
    const tag   = el.tagName.toLowerCase();
    const aria  = el.getAttribute('aria-label') || '';
    const title = el.getAttribute('title') || '';
    const txt   = (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 100);
    const lbl   = findLabel(el);
    const name  = aria || lbl || title || txt || el.getAttribute('value') || el.name || el.id || tag;

    if (tag === 'button' || (el.getAttribute('role') || '') === 'button')
      return `Ao acionar o botão "${name}"`;
    if (tag === 'a') {
      const href  = el.getAttribute('href') || '';
      const extra = extractEprocAction(href);
      return `Ao clicar no link "${name}"${extra ? ' (' + extra + ')' : ''}`;
    }
    if (tag === 'input') {
      const t = (el.type || '').toLowerCase();
      if (['submit','button'].includes(t)) return `Ao acionar o botão "${name}"`;
      if (t === 'checkbox') return `Ao ${el.checked ? 'marcar' : 'desmarcar'} a opção "${name}"`;
      if (t === 'radio')    return `Ao selecionar a opção "${name}"`;
    }
    if (tag === 'select') return `Ao abrir o menu "${name}"`;
    return `Ao clicar em "${name}"`;
  }

  function extractEprocAction(href) {
    if (!href) return '';
    const m = href.match(/[?&]acao=([^&]+)/i);
    if (m) return decodeURIComponent(m[1]).replace(/_/g, ' ');
    const seg = href.split('/').filter(Boolean).pop() || '';
    if (seg && seg !== '#' && seg.length < 60) return seg;
    return '';
  }

  function findLabel(el) {
    if (el.id) {
      try {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) return l.textContent.trim();
      } catch {}
    }
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll('input,select,textarea,button').forEach(i => i.remove());
      const t = clone.textContent.trim();
      if (t) return t;
    }
    return '';
  }

  // ────────────────────────────────────────────────
  //  OBSERVER DE POPUPS/ALERTAS
  // ────────────────────────────────────────────────
  function observePopups() {
    if (popObs) return;
    popObs = new MutationObserver(muts => {
      if (!recording) return;
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.id && ['eprec','eprec-modal','eprec-floatind','eprec-capturing','eprec-hist-modal'].includes(node.id)) continue;
          try { if (node.closest('#eprec,#eprec-modal,#eprec-capturing,#eprec-hist-modal,#eprec-floatind')) continue; } catch {}
          if (knownPopups.has(node)) continue;
          if (isPopup(node)) {
            knownPopups.add(node);
            const desc = descPopup(node);
            addStep('popup_aberto', `O sistema exibe a janela ${desc}`);
            if (autoShot) enqueueCapture('print_auto', `Conteúdo da janela ${desc}`, 500);
            observePopupClose(node, desc);
          }
        }
        if (m.type === 'attributes' && m.target.nodeType === 1) {
          const node = m.target;
          if (['eprec','eprec-modal','eprec-floatind','eprec-capturing','eprec-hist-modal'].includes(node.id)) continue;
          try { if (node.closest('#eprec,#eprec-modal,#eprec-capturing,#eprec-hist-modal,#eprec-floatind')) continue; } catch {}
          if (!knownPopups.has(node) && isPopup(node) && isPopupVisible(node)) {
            knownPopups.add(node);
            const desc = descPopup(node);
            addStep('popup_aberto', `O sistema exibe a janela ${desc}`);
            if (autoShot) enqueueCapture('print_auto', `Conteúdo da janela ${desc}`, 500);
            observePopupClose(node, desc);
          }
        }
      }
    });
    popObs.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['style','class','hidden','aria-hidden'],
    });
  }

  function observePopupClose(node, desc) {
    const obs = new MutationObserver(() => {
      if (!document.body.contains(node) || !isPopupVisible(node)) {
        obs.disconnect();
        if (recording) addStep('popup_fechado', `A janela ${desc} foi fechada`);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    obs.observe(node, { attributes: true, attributeFilter: ['style','class','hidden','aria-hidden'] });
  }

  function isPopup(el) {
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (['dialog','alertdialog','alert'].includes(role)) return true;
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/modal|popup|dialog|overlay|lightbox|popover/i.test(cls)) return true;
    try {
      const s = window.getComputedStyle(el);
      const z = parseInt(s.zIndex, 10);
      if (!isNaN(z) && z > 999 && s.position !== 'static' && isPopupVisible(el)) return true;
    } catch {}
    return false;
  }

  function isPopupVisible(el) {
    try {
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    } catch { return false; }
  }

  function descPopup(el) {
    const sels = ['[class*="titulo"]','[class*="title"]','[class*="cabecalho"]','[class*="alerta"]','[class*="mensagem"]','h1','h2','h3','h4','.modal-title'];
    for (const sel of sels) {
      try {
        const h = el.querySelector(sel);
        if (h) { const t = h.textContent.trim(); if (t) return `"${t.replace(/\s+/g, ' ').substring(0, 100)}"`; }
      } catch {}
    }
    return `"${(el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 80) || 'aviso'}"`;
  }

  // ────────────────────────────────────────────────
  //  RETOMAR APÓS NAVEGAÇÃO
  // ────────────────────────────────────────────────
  function resumeIfNeeded() {
    if (!recording) return;
    attachListeners(); observePopups();
    if (autoShot) {
      enqueueCapture('print_auto', `Nova página: ${document.title}`, 800);
    } else {
      addStep('navegacao', `Navegação para a página "${document.title}"`);
    }
  }

  // ────────────────────────────────────────────────
  //  DEDUPLICAÇÃO PARA EXPORTAÇÃO
  //  Remove passos repetidos consecutivos do mesmo tipo+descrição
  // ────────────────────────────────────────────────
  function deduplicateSteps(arr) {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      // Nunca remove início, prints manuais e anotações
      if (['inicio','print_manual','anotacao'].includes(s.type)) { out.push(s); continue; }
      const prev = out[out.length - 1];
      // Descarta se mesmo tipo e mesma descrição do passo anterior
      if (prev && prev.type === s.type && prev.description === s.description) continue;
      // Descarta prints automáticos repetidos seguidos sem ação do usuário entre eles
      if (s.type === 'print_auto' && prev && prev.type === 'print_auto') continue;
      out.push(s);
    }
    return out;
  }

  // ────────────────────────────────────────────────
  //  EXPORTAÇÃO — relatório UNIFICADO
  //  Cada passo = 1 bloco: cabeçalho + texto + print (se houver)
  //  Sem "narrativa" separada — tudo em ordem cronológica
  // ────────────────────────────────────────────────
  function exportCurrentSession() {
    const shotsMap = {};
    steps.forEach(s => { const img = getShot(s.num); if (img) shotsMap[s.num] = img; });
    exportSession({
      title:  steps[0]?.pageTitle || 'Gravação',
      date:   new Date().toLocaleString('pt-BR'),
      steps:  [...steps],
      shots:  shotsMap,
    });
  }

  function exportSession(sess) {
    const stepsArr = sess.steps || [];
    if (!stepsArr.length) { alert('Nenhum passo para exportar.'); return; }
    const shotsMap = sess.shots || {};

    // Ordena + deduplica
    const sorted = deduplicateSteps(
      [...stepsArr].sort((a, b) => (a.tsNum || 0) - (b.tsNum || 0))
    );

    const now   = new Date();
    const dBR   = now.toLocaleDateString('pt-BR');
    const tBR   = now.toLocaleTimeString('pt-BR');
    const total = sorted.length;
    const prints = sorted.filter(s => shotsMap[s.num]).length;

    // Tipos que representam ações do usuário (exibidos com destaque)
    const USER_ACTIONS = new Set(['clique_botao','clique_link','clique_menu','input','select','submit','print_manual','anotacao']);

    // Cor da etiqueta por tipo
    const LABEL_STYLE = {
      clique_botao: 'background:#1a365d;color:#90cdf4',
      clique_link:  'background:#322659;color:#d6bcfa',
      clique_menu:  'background:#1d4044;color:#81e6d9',
      input:        'background:#1a2744;color:#bee3f8',
      select:       'background:#1a365d;color:#90cdf4',
      submit:       'background:#63171b;color:#feb2b2',
      popup_aberto: 'background:#744210;color:#fbd38d',
      popup_fechado:'background:#2d3748;color:#a0aec0',
      print_manual: 'background:#4a3000;color:#fefcbf',
      print_auto:   'background:#1a3000;color:#c6f6d5',
      anotacao:     'background:#1c4532;color:#9ae6b4',
      inicio:       'background:#171923;color:#a0aec0',
      navegacao:    'background:#322659;color:#e9d8fd',
    };
    const LABEL_TEXT = {
      clique_botao: 'BOTÃO', clique_link: 'LINK', clique_menu: 'MENU',
      input: 'CAMPO', select: 'SELEÇÃO', submit: 'ENVIO',
      popup_aberto: 'POPUP', popup_fechado: 'POPUP FIM',
      print_manual: 'PRINT', print_auto: 'CAPTURA',
      anotacao: 'NOTA', inicio: 'INÍCIO', navegacao: 'PÁGINA',
    };

    // ── Gera blocos sequenciais (ação + print integrado)
    const blocks = sorted.map((s, idx) => {
      const shot      = shotsMap[s.num];
      const isAction  = USER_ACTIONS.has(s.type);
      const lstyle    = LABEL_STYLE[s.type] || 'background:#2d3748;color:#e2e8f0';
      const ltxt      = LABEL_TEXT[s.type]  || s.type.toUpperCase();
      const stepNum   = String(idx + 1).padStart(2, '0');

      // Bloco de ação do usuário: fundo levemente destacado
      const blockBg   = isAction ? '#fff' : '#f9fafb';
      const borderClr = isAction ? '#e2e8f0' : '#edf2f7';
      const numClr    = isAction ? '#553c9a' : '#a0aec0';

      const imgHtml = shot
        ? `<div style="margin-top:10px">
            <img src="${shot}"
              style="max-width:100%;border-radius:6px;border:1px solid #e2e8f0;display:block;box-shadow:0 2px 8px rgba(0,0,0,.08)">
           </div>`
        : '';

      return `
        <div style="
          background:${blockBg};border:1px solid ${borderClr};border-radius:8px;
          padding:14px 16px;margin-bottom:10px;page-break-inside:avoid
        ">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:${s.description || shot ? '8px' : '0'}">
            <span style="
              font-size:11px;font-weight:800;color:${numClr};
              background:${isAction ? '#f3f0ff' : '#f7fafc'};
              border-radius:99px;padding:2px 9px;flex-shrink:0;font-family:monospace
            ">${stepNum}</span>
            <span style="${lstyle};border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700;flex-shrink:0">${ltxt}</span>
            <span style="font-size:11px;color:#a0aec0;flex-shrink:0">${s.timestamp}</span>
            ${s.pageTitle ? `<span style="font-size:10px;color:#cbd5e0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1" title="${esc(s.pageTitle)}">${esc(s.pageTitle.substring(0, 50))}</span>` : ''}
          </div>
          ${s.description ? `<p style="margin:0;font-size:13px;color:#2d3748;line-height:1.6;padding-left:2px">${esc(s.description)}</p>` : ''}
          ${imgHtml}
        </div>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Relatório de Testes eProc</title>
<style>
*{box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;background:#f0f4f8;color:#2d3748;margin:0;padding:24px;font-size:13px}
.hdr{background:#1a202c;border-radius:10px;padding:22px 26px;margin-bottom:20px}
.hdr h1{margin:0 0 4px;font-size:22px;color:#e8eaf0;font-weight:800}
.hdr p{margin:0;color:#718096;font-size:12px}
.meta{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px}
.meta span{font-size:11px;color:#718096;background:#0c0f17;padding:3px 10px;border-radius:99px}
.content{max-width:820px;margin:0 auto}
@media print{
  body{background:#fff;padding:12px}
  .hdr{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  img{max-width:100%!important;page-break-inside:avoid}
}
</style></head><body>
<div class="content">
<div class="hdr">
  <h1>📋 Relatório de Testes — eProc</h1>
  <p>Gravador de Testes para Homologação v6.1</p>
  <div class="meta">
    <span>📅 ${dBR} ${tBR}</span>
    <span>📌 ${total} passos</span>
    ${prints > 0 ? `<span>📷 ${prints} prints</span>` : ''}
    <span>🌐 ${esc((sorted[0]?.pageTitle || '').substring(0, 50))}</span>
  </div>
</div>
${blocks}
<p style="text-align:center;color:#a0aec0;font-size:10px;margin-top:20px">
  eProc Gravador v6.1 — gerado em ${dBR} ${tBR}
</p>
</div>
</body></html>`;

    const a = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })),
      download: `relatorio-eproc-${now.toISOString().slice(0, 10)}.html`,
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function esc(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ────────────────────────────────────────────────
  //  INIT
  // ────────────────────────────────────────────────
  function init() {
    loadShotsFromStorage();
    const run = () => { buildPanel(); buildModal(); resumeIfNeeded(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();

    // Atalhos de teclado globais (só funcionam durante gravação)
    document.addEventListener('keydown', e => {
      if (!recording) return;
      // Alt+A → Anotação
      if (e.altKey && e.key === 'a') { e.preventDefault(); openNoteModal(); }
      // Alt+P → Print manual
      if (e.altKey && e.key === 'p') { e.preventDefault(); openShotModal(); }
    }, true);
  }

  init();
})();
