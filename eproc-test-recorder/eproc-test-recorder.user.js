// ==UserScript==
// @name         eProc - Gravador de Testes para Homologação
// @namespace    eproc-gravador-testes
// @version      5.0.0
// @description  Registra ações, captura prints e gera relatórios de homologação
// @author       Gerado via Claude
// @include      *://eproc*.tjsp.jus.br/*
// @include      *://*-1g-*.tjsp.jus.br/*
// @include      *://*-2g-*.tjsp.jus.br/*
// @include      *://sso-*.tjsc.jus.br/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ────────────────────────────────────────────────
  //  STORAGE KEYS
  // ────────────────────────────────────────────────
  const SK = {
    rec:       'eprec_rec',
    steps:     'eprec_steps',
    count:     'eprec_count',
    sessions:  'eprec_sessions',   // FIX #5: histórico de sessões anteriores
    sessId:    'eprec_sess_id',     // ID da sessão atual
    autoshot:  'eprec_autoshot',
    autoshotbtn: 'eprec_autoshotbtn',
  };
  const SHOT_PFX = 'eprec_shot_';

  function ss(k, v) {
    if (v === undefined) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } }
    try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {}
  }

  // ────────────────────────────────────────────────
  //  ESTADO
  // ────────────────────────────────────────────────
  let recording    = ss(SK.rec)    || false;
  let steps        = ss(SK.steps)  || [];
  let counter      = ss(SK.count)  || 0;
  let autoShot     = ss(SK.autoshot)    ?? true;
  let autoShotBtn  = ss(SK.autoshotbtn) || false;
  let currentSessId = ss(SK.sessId) || null;

  // FIX #5: Histórico de sessões (array de sessões completas)
  let sessions = ss(SK.sessions) || [];

  // FIX #3: Fila serializada de capturas para garantir ordem cronológica
  let captureQueue = Promise.resolve();
  let captureInProgress = false;

  let popObs   = null;
  let pendingCapture = null;

  // Cache de screenshots em memória
  const screenshots = {};

  function saveShot(num, dataUrl) {
    screenshots[num] = dataUrl;
    try { sessionStorage.setItem(SHOT_PFX + num, dataUrl); } catch {}
  }

  function getShot(num) {
    return screenshots[num] || sessionStorage.getItem(SHOT_PFX + num) || null;
  }

  function clearShots(nums) {
    if (!nums) {
      // Limpa tudo
      Object.keys(screenshots).forEach(k => delete screenshots[k]);
      const toRemove = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(SHOT_PFX)) toRemove.push(k);
      }
      toRemove.forEach(k => sessionStorage.removeItem(k));
    } else {
      nums.forEach(n => {
        delete screenshots[n];
        sessionStorage.removeItem(SHOT_PFX + n);
      });
    }
  }

  function loadShotsFromStorage() {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(SHOT_PFX)) {
        const num = parseInt(k.slice(SHOT_PFX.length), 10);
        if (!isNaN(num)) screenshots[num] = sessionStorage.getItem(k);
      }
    }
  }

  // ────────────────────────────────────────────────
  //  ESTILOS
  // ────────────────────────────────────────────────
  GM_addStyle(`
    #eprec {
      position: fixed !important; bottom: 18px !important; right: 18px !important;
      z-index: 2147483647 !important; width: 255px;
      background: #12161f; color: #c9d1e0; border-radius: 10px;
      box-shadow: 0 6px 24px rgba(0,0,0,0.6);
      font: 13px/1.4 'Segoe UI', Arial, sans-serif !important;
      user-select: none; border: 1px solid #2a2f3d;
    }
    #eprec * { box-sizing: border-box; font-family: inherit !important; }

    #eprec-head {
      display: flex; align-items: center; gap: 7px;
      padding: 8px 11px; border-radius: 10px 10px 0 0;
      cursor: move; background: #0c0f17; border-bottom: 1px solid #2a2f3d;
    }
    #eprec-head.on { background: #1f0b0b; border-bottom-color: #5c1a1a; }

    #eprec-led { width: 8px; height: 8px; border-radius: 50%; background: #2d3748; flex-shrink: 0; transition: background .3s; }
    #eprec-led.on { background: #f56565; animation: blink 1.4s ease-in-out infinite; }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.35} }

    #eprec-label { flex: 1; font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #4a5568; }
    #eprec-label.on { color: #f56565; }

    #eprec-count { font-size: 10px; font-weight: 700; background: #1e2533; color: #63b3ed; border-radius: 99px; padding: 1px 7px; }
    #eprec-count.on { background: #3d1515; color: #fc8181; }

    #eprec-min { font-size: 12px; color: #2d3748; cursor: pointer; padding: 0 2px; }
    #eprec-min:hover { color: #718096; }

    #eprec-body { padding: 10px 11px 11px; }

    #eprec-status {
      font-size: 11px; padding: 5px 8px; border-radius: 5px;
      margin-bottom: 9px; background: #1e2533; color: #718096; border-left: 3px solid #2d3748;
    }
    #eprec-status.on  { color: #68d391; border-left-color: #276749; background: #0f1e16; }
    #eprec-status.off { color: #f6ad55; border-left-color: #b7791f; background: #1a1408; }

    .eb {
      display: flex; align-items: center; justify-content: center; gap: 5px;
      width: 100%; padding: 7px 10px; border-radius: 6px; border: none;
      font-size: 12px; font-weight: 700; cursor: pointer; margin-bottom: 5px; transition: filter .15s;
    }
    .eb:last-child { margin-bottom: 0; }
    .eb:hover  { filter: brightness(1.2); }
    .eb:active { filter: brightness(.9); }
    .eb:disabled { opacity: .5; cursor: default; filter: none; }
    .eb-start  { background: #1c4532; color: #9ae6b4; }
    .eb-stop   { background: #4a0f0f; color: #feb2b2; }
    .eb-export { background: #1a365d; color: #90cdf4; }
    .eb-clear  { background: #1e2533; color: #718096; }
    .eb-hist   { background: #2d1f44; color: #d6bcfa; }

    .eb-row { display: flex; gap: 5px; margin-bottom: 5px; }
    .eb-row .eb { margin-bottom: 0; }
    .eb-shot { background: #2d1f00; color: #fbd38d; font-size: 11px; }
    .eb-note { background: #1e1040; color: #d6bcfa; font-size: 11px; }

    #eprec-hint { font-size: 10px; color: #2d3748; margin-top: 7px; line-height: 1.5; }

    .eprec-toggle-row { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
    .eprec-toggle {
      position: relative; width: 28px; height: 15px; flex-shrink: 0; cursor: pointer;
      background: #2d3748; border-radius: 99px; transition: background .2s;
    }
    .eprec-toggle.on { background: #276749; }
    .eprec-toggle::after {
      content: ''; position: absolute; top: 2px; left: 2px;
      width: 11px; height: 11px; border-radius: 50%; background: #fff; transition: left .2s;
    }
    .eprec-toggle.on::after { left: 15px; }
    .eprec-toggle-lbl { font-size: 10px; color: #4a5568; flex: 1; }

    #eprec-log { display: none; max-height: 90px; overflow-y: auto; background: #080b12; border-radius: 5px; padding: 4px 6px; margin-top: 7px; }
    .el { font-size: 10px; color: #2d3748; padding: 1px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .el.hi { color: #63b3ed; }
    #eprec-logtoggle { font-size: 10px; color: #2d3748; cursor: pointer; margin-top: 6px; text-align: right; }
    #eprec-logtoggle:hover { color: #4a5568; }

    /* Indicador de captura em progresso */
    #eprec-capturing {
      display: none; position: fixed !important; top: 10px !important; right: 10px !important;
      z-index: 2147483648 !important; background: #276749; color: #9ae6b4;
      font: 700 11px/1 'Segoe UI', Arial, sans-serif !important;
      padding: 5px 10px; border-radius: 99px; pointer-events: none;
    }

    /* Modal de anotação */
    #eprec-modal {
      display: none; position: fixed !important; inset: 0;
      z-index: 2147483648 !important; background: rgba(0,0,0,.7);
      align-items: center; justify-content: center;
    }
    #eprec-modal.open { display: flex !important; }
    #eprec-mbox {
      background: #12161f; border: 1px solid #2a2f3d; border-radius: 10px;
      padding: 18px; width: 460px; max-width: 92vw;
      box-shadow: 0 20px 60px rgba(0,0,0,.7);
    }
    #eprec-mbox label { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #4a5568; margin-bottom: 7px; }
    #eprec-mthumb { display: none; width: 100%; border-radius: 5px; margin-bottom: 9px; border: 1px solid #2a2f3d; }
    #eprec-mtext {
      width: 100%; background: #080b12; border: 1px solid #2a2f3d; color: #c9d1e0;
      border-radius: 5px; padding: 7px 9px; font-size: 13px; resize: vertical; min-height: 70px; outline: none;
    }
    #eprec-mtext:focus { border-color: #553c9a; }
    #eprec-mfooter { display: flex; gap: 7px; margin-top: 10px; justify-content: flex-end; }
    .emb { padding: 6px 14px; border-radius: 5px; border: none; font-size: 12px; font-weight: 700; cursor: pointer; }
    #eprec-mcancel { background: #1e2533; color: #718096; }
    #eprec-mok     { background: #553c9a; color: #fff; }

    /* Modal de histórico */
    #eprec-hist-modal {
      display: none; position: fixed !important; inset: 0;
      z-index: 2147483648 !important; background: rgba(0,0,0,.75);
      align-items: flex-start; justify-content: center; padding-top: 40px;
    }
    #eprec-hist-modal.open { display: flex !important; }
    #eprec-hist-box {
      background: #12161f; border: 1px solid #2a2f3d; border-radius: 10px;
      padding: 18px; width: 520px; max-width: 94vw; max-height: 70vh; overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0,0,0,.7);
    }
    #eprec-hist-box h3 { margin: 0 0 12px; font-size: 14px; color: #c9d1e0; }
    .ehist-row {
      display: flex; align-items: center; gap: 8px; padding: 8px 0;
      border-bottom: 1px solid #1e2533; font-size: 12px;
    }
    .ehist-row:last-child { border-bottom: none; }
    .ehist-info { flex: 1; color: #718096; }
    .ehist-info strong { color: #c9d1e0; display: block; }
    .ehist-btn { background: #1a365d; color: #90cdf4; border: none; border-radius: 5px; padding: 4px 10px; font-size: 11px; font-weight: 700; cursor: pointer; }
    .ehist-btn:hover { filter: brightness(1.3); }
    .ehist-del { background: #3d1515; color: #fc8181; }

    #eprec-floatind {
      display: none; position: fixed !important; bottom: 18px !important; right: 18px !important;
      z-index: 2147483646 !important; background: #4a0f0f; color: #feb2b2;
      font: 700 11px/1 'Segoe UI', Arial, sans-serif !important;
      padding: 5px 10px; border-radius: 99px; border: 1px solid #742a2a; pointer-events: none;
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
            <span class="eprec-toggle-lbl">📷 Auto em todo botão/link</span>
          </div>
        </div>
        <div id="eprec-hint"></div>
        <div id="eprec-logtoggle">▸ log</div>
        <div id="eprec-log"></div>
      </div>`;
    document.body.appendChild(p);

    const ind = document.createElement('div');
    ind.id = 'eprec-floatind';
    ind.textContent = '● REC';
    document.body.appendChild(ind);

    const cap = document.createElement('div');
    cap.id = 'eprec-capturing';
    cap.textContent = '📷 capturando…';
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
      b.textContent = open ? '▸ log' : '▾ log';
    });

    document.getElementById('eprec-btn-rec').addEventListener('click',  e => { e.stopPropagation(); toggleRec(); });
    document.getElementById('eprec-btn-shot').addEventListener('click', e => { e.stopPropagation(); openShotModal(); });
    document.getElementById('eprec-btn-note').addEventListener('click', e => { e.stopPropagation(); openNoteModal(); });
    document.getElementById('eprec-btn-exp').addEventListener('click',  e => { e.stopPropagation(); pickExportTarget(); });
    document.getElementById('eprec-btn-clr').addEventListener('click',  e => { e.stopPropagation(); clearCurrent(); });
    document.getElementById('eprec-btn-hist').addEventListener('click', e => { e.stopPropagation(); openHistModal(); });
    document.getElementById('eprec-tog-events').addEventListener('click', e => { e.stopPropagation(); toggleAutoShot(); });
    document.getElementById('eprec-tog-btn').addEventListener('click',   e => { e.stopPropagation(); toggleAutoShotBtn(); });

    refreshUI();
  }

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
    document.getElementById('eprec-mok').addEventListener('click', saveModal);
    m.addEventListener('click', e => { if (e.target === m) closeModal(); });
  }

  // ────────────────────────────────────────────────
  //  MODAL DE HISTÓRICO  (FIX #5)
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

  function openHistModal() {
    buildHistModal();
    renderHistList();
    document.getElementById('eprec-hist-modal').classList.add('open');
  }

  function closeHistModal() {
    const m = document.getElementById('eprec-hist-modal');
    if (m) m.classList.remove('open');
  }

  function renderHistList() {
    const list = document.getElementById('eprec-hist-list');
    if (!list) return;
    const all = getSessions();
    if (!all.length) {
      list.innerHTML = '<p style="color:#4a5568;font-size:12px">Nenhuma gravação anterior encontrada.</p>';
      return;
    }
    list.innerHTML = all.map((sess, idx) => `
      <div class="ehist-row">
        <div class="ehist-info">
          <strong>${esc(sess.title || 'Sessão ' + (idx + 1))}</strong>
          ${esc(sess.date)} — ${sess.steps.length} passos
          ${sess.printCount ? ` — ${sess.printCount} print${sess.printCount !== 1 ? 's' : ''}` : ''}
        </div>
        <button class="ehist-btn" data-idx="${idx}">⬇ Exportar</button>
        <button class="ehist-btn ehist-del" data-del="${idx}">🗑</button>
      </div>`).join('');

    list.querySelectorAll('[data-idx]').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = parseInt(e.target.dataset.idx, 10);
        exportSession(all[idx]);
      });
    });
    list.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = parseInt(e.target.dataset.del, 10);
        if (confirm('Remover esta gravação do histórico?')) {
          const updated = getSessions();
          updated.splice(idx, 1);
          ss(SK.sessions, updated);
          sessions = updated;
          renderHistList();
        }
      });
    });
  }

  // FIX #5: Sessões persistidas em sessionStorage
  function getSessions() {
    return ss(SK.sessions) || [];
  }

  function saveSessionToHistory(stepsArr, shotsMap) {
    const all = getSessions();
    const title = (stepsArr[0]?.pageTitle || 'Gravação').substring(0, 60);
    const now = new Date();
    const printCount = stepsArr.filter(s => shotsMap[s.num]).length;
    all.push({
      id:         now.getTime(),
      title,
      date:       now.toLocaleString('pt-BR'),
      steps:      stepsArr,
      shots:      shotsMap,   // { num: dataUrl }
      printCount,
    });
    ss(SK.sessions, all);
    sessions = all;
  }

  // ────────────────────────────────────────────────
  //  MODAL DE ANOTAÇÃO / PRINT MANUAL
  // ────────────────────────────────────────────────
  let modalMode = 'note';

  function openNoteModal() {
    if (!recording) return;
    modalMode = 'note';
    pendingCapture = null;
    const thumb = document.getElementById('eprec-mthumb');
    if (thumb) { thumb.style.display = 'none'; thumb.src = ''; }
    document.getElementById('eprec-mlabel').textContent = 'Anotação / Observação';
    document.getElementById('eprec-mtext').placeholder = 'Descreva o passo, comportamento ou anomalia observada...';
    document.getElementById('eprec-mtext').value = '';
    document.getElementById('eprec-modal').classList.add('open');
    setTimeout(() => document.getElementById('eprec-mtext').focus(), 80);
  }

  async function openShotModal() {
    if (!recording) return;
    modalMode = 'shot';
    pendingCapture = null;

    const btnShot = document.getElementById('eprec-btn-shot');
    if (btnShot) { btnShot.disabled = true; btnShot.textContent = '📷 Capturando…'; }
    showCapturingIndicator(true);

    const imgData = await captureScreenshot();
    pendingCapture = imgData;

    showCapturingIndicator(false);
    if (btnShot) { btnShot.disabled = false; btnShot.textContent = '📷 Print'; }

    const thumb = document.getElementById('eprec-mthumb');
    if (thumb) {
      if (imgData) { thumb.src = imgData; thumb.style.display = 'block'; }
      else          { thumb.style.display = 'none'; thumb.src = ''; }
    }

    document.getElementById('eprec-mlabel').textContent = imgData
      ? '📷 Tela capturada — adicione uma descrição'
      : '📷 Print (descreva o que está visível na tela)';
    document.getElementById('eprec-mtext').placeholder = 'Ex: "Formulário de cadastro", "Mensagem de erro", "Lista de processos"…';
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
      addStep('print_manual', '📷 ' + (txt || 'Print de tela registrado'), pendingCapture);
    } else {
      if (!txt) { closeModal(); return; }
      addStep('anotacao', txt);
    }
    closeModal();
  }

  function showCapturingIndicator(visible) {
    const el = document.getElementById('eprec-capturing');
    if (el) el.style.display = visible ? 'block' : 'none';
  }

  // ────────────────────────────────────────────────
  //  DRAG
  // ────────────────────────────────────────────────
  function drag(el, handle) {
    let dx = 0, dy = 0, sx, sy;
    handle.addEventListener('mousedown', e => {
      if (['eprec-min','eprec-count'].includes(e.target.id)) return;
      sx = e.clientX - dx; sy = e.clientY - dy;
      const mv = ev => { dx = ev.clientX-sx; dy = ev.clientY-sy; el.style.transform = `translate(${dx}px,${dy}px)`; };
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', () => document.removeEventListener('mousemove', mv), { once: true });
    });
  }

  // ────────────────────────────────────────────────
  //  CONTROLE DE GRAVAÇÃO
  // ────────────────────────────────────────────────
  function toggleRec() { if (recording) stopRec(); else startRec(); }

  function toggleAutoShot() {
    autoShot = !autoShot;
    ss(SK.autoshot, autoShot);
    refreshUI();
  }

  function toggleAutoShotBtn() {
    autoShotBtn = !autoShotBtn;
    ss(SK.autoshotbtn, autoShotBtn);
    refreshUI();
  }

  function startRec() {
    // FIX #5: se já há passos de uma gravação anterior, salva no histórico antes de limpar
    if (steps.length > 0) {
      commitCurrentToHistory();
    }

    recording = true;
    steps = [];
    counter = 0;
    currentSessId = Date.now();
    ss(SK.rec, true);
    ss(SK.steps, []);
    ss(SK.count, 0);
    ss(SK.sessId, currentSessId);
    clearShots();

    attachListeners();
    observePopups();
    addStep('inicio', 'Gravação iniciada — ' + document.title);
    refreshUI();
  }

  function stopRec() {
    recording = false;
    ss(SK.rec, false);
    detachListeners();
    if (popObs) { popObs.disconnect(); popObs = null; }
    refreshUI();
  }

  // FIX #5: Consolida passos atuais + screenshots no histórico
  function commitCurrentToHistory() {
    if (!steps.length) return;
    // Coleta todos os screenshots da sessão atual em um mapa
    const shotsMap = {};
    steps.forEach(s => {
      const img = getShot(s.num);
      if (img) shotsMap[s.num] = img;
    });
    saveSessionToHistory([...steps], shotsMap);
  }

  // ────────────────────────────────────────────────
  //  LIMPAR SESSÃO ATUAL
  // ────────────────────────────────────────────────
  function clearCurrent() {
    if (!confirm('Limpar os passos da sessão atual? (O histórico de sessões anteriores é mantido)')) return;
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
    const led  = document.getElementById('eprec-led');
    const lbl  = document.getElementById('eprec-label');
    const cnt  = document.getElementById('eprec-count');
    const head = document.getElementById('eprec-head');
    const stat = document.getElementById('eprec-status');
    const btnR = document.getElementById('eprec-btn-rec');
    const mid  = document.getElementById('eprec-midrow');
    const btnE = document.getElementById('eprec-btn-exp');
    const botRow = document.getElementById('eprec-bottom-row');
    const hint = document.getElementById('eprec-hint');
    if (!led) return;

    const n = steps.length;
    cnt.textContent = `${n} passo${n !== 1 ? 's' : ''}`;

    const autoRow = document.getElementById('eprec-autorow');
    const togEv   = document.getElementById('eprec-tog-events');
    const togBtn  = document.getElementById('eprec-tog-btn');
    if (togEv)  togEv.className  = 'eprec-toggle' + (autoShot    ? ' on' : '');
    if (togBtn) togBtn.className = 'eprec-toggle' + (autoShotBtn ? ' on' : '');

    const histCount = getSessions().length;

    if (recording) {
      led.className = 'on'; lbl.className = 'on'; lbl.textContent = '● GRAVANDO';
      head.className = 'on'; cnt.className = 'on'; stat.className = 'on';
      stat.textContent = 'Registrando ações…';
      btnR.className = 'eb eb-stop'; btnR.textContent = '⏹ Parar Gravação';
      mid.style.display = 'flex'; btnE.style.display = 'none';
      botRow.style.display = 'none';
      if (autoRow) autoRow.style.display = 'block';
      hint.innerHTML = '<span style="color:#2d3748;font-size:10px">📷 Print manual ou ✏️ para anotações.</span>';
    } else {
      led.className = ''; lbl.className = ''; lbl.textContent = 'Gravador';
      head.className = ''; cnt.className = '';
      btnR.className = 'eb eb-start'; btnR.textContent = '▶ Iniciar Gravação';
      mid.style.display = 'none'; hint.innerHTML = '';
      if (autoRow) autoRow.style.display = 'none';
      if (n > 0) {
        stat.className = 'off';
        stat.textContent = `Parado. ${n} passo${n !== 1 ? 's' : ''} gravado${n !== 1 ? 's' : ''}.`;
        btnE.style.display = '';
        botRow.style.display = 'flex';
      } else if (histCount > 0) {
        stat.className = ''; stat.textContent = `Pronto — ${histCount} sessão${histCount !== 1 ? 'ões' : ''} no histórico.`;
        btnE.style.display = 'none';
        botRow.style.display = 'flex';
        document.getElementById('eprec-btn-clr').style.display = 'none';
      } else {
        stat.className = ''; stat.textContent = 'Pronto para gravar';
        btnE.style.display = 'none';
        botRow.style.display = 'none';
      }
      document.getElementById('eprec-floatind').style.display = 'none';
    }
  }

  // ────────────────────────────────────────────────
  //  PASSOS — FIX #3: inserção síncrona com timestamp numérico
  // ────────────────────────────────────────────────
  function addStep(type, description, screenshot) {
    counter++;
    ss(SK.count, counter);

    const step = {
      num:       counter,
      type,
      description,
      tsNum:     Date.now(),           // FIX #3: timestamp numérico para ordenação exata
      timestamp: new Date().toLocaleString('pt-BR'),
      url:       location.href,
      pageTitle: document.title,
    };

    if (screenshot) saveShot(counter, screenshot);

    steps.push(step);
    // FIX #3: Reordena por tsNum para garantir ordem mesmo em capturas assíncronas
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
  //  CAPTURA — FIX #2 + #3
  //  Fila serializada: cada captura aguarda a anterior terminar.
  //  Desta forma os prints chegam em sequência, nunca fora de ordem.
  // ────────────────────────────────────────────────
  function enqueueCapture(type, desc, delayMs) {
    captureQueue = captureQueue.then(async () => {
      if (!recording) return;
      showCapturingIndicator(true);
      await sleep(delayMs);
      const img = await captureScreenshot();
      showCapturingIndicator(false);
      addStep(type, desc, img);
    });
  }

  async function captureScreenshot() {
    if (typeof html2canvas === 'undefined') {
      console.warn('[eprec] html2canvas não carregou');
      return null;
    }
    const IGNORE_IDS = new Set(['eprec', 'eprec-floatind', 'eprec-modal', 'eprec-capturing', 'eprec-hist-modal']);
    try {
      const canvas = await html2canvas(document.body, {
        scale: 0.65,
        useCORS: true,
        allowTaint: true,
        logging: false,
        removeContainer: true,
        imageTimeout: 5000,
        ignoreElements: el => IGNORE_IDS.has(el.id),
      });
      return canvas.toDataURL('image/jpeg', 0.78);
    } catch (err) {
      console.warn('[eprec] html2canvas falhou:', err.message);
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

  // ── CLICK
  function onClick(e) {
    if (!recording) return;
    const el = e.target;
    if (!el) return;
    if (el.closest('#eprec') || el.closest('#eprec-modal') || el.closest('#eprec-floatind') || el.closest('#eprec-hist-modal')) return;

    const root = findClickable(el);
    if (!root) return;

    const desc = descEl(root);
    const tag  = root.tagName.toLowerCase();
    const role = (root.getAttribute('role') || '').toLowerCase();
    const type = tag === 'a' ? 'clique_link'
      : ['tab','menuitem','treeitem','option'].includes(role) ? 'clique_menu'
      : 'clique_botao';

    // FIX #1: registra o clique com descrição humanizada imediatamente
    addStep(type, desc);

    // FIX #2 + #3: captura auto enfileirada — print APÓS o clique, em ordem
    if (autoShotBtn) {
      enqueueCapture('print_auto', '📷 Após clique — ' + humanShort(desc), 900);
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
    if (['button', 'a'].includes(tag)) return true;
    if (tag === 'input' && ['submit','button','reset','checkbox','radio'].includes(type)) return true;
    if (tag === 'select') return true;
    if (['button','link','tab','menuitem','treeitem','option','checkbox','radio','switch'].includes(role)) return true;
    if (el.hasAttribute('onclick')) return true;
    try {
      const style = window.getComputedStyle(el);
      if (style.cursor === 'pointer' && (el.textContent || '').trim()) return true;
    } catch {}
    return false;
  }

  // ── CHANGE
  function onChange(e) {
    if (!recording) return;
    const el = e.target;
    if (!el || el.closest('#eprec')) return;
    const tag  = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    if (tag === 'select') {
      const lbl = findLabel(el) || el.name || el.id || 'campo';
      const val = el.options[el.selectedIndex]?.text || el.value;
      addStep('select', `Seleção no campo "${lbl}": opção escolhida foi "${val}"`);
    }
    if (tag === 'input' && ['checkbox','radio'].includes(type)) {
      const lbl = findLabel(el) || el.name || el.id || el.value || 'opção';
      const desc = type === 'checkbox'
        ? `Checkbox "${lbl}" foi ${el.checked ? 'marcado ✓' : 'desmarcado ✗'}`
        : `Opção de rádio selecionada: "${lbl}"`;
      addStep('select', desc);
    }
  }

  // ── BLUR — FIX #1: descrição mais natural
  const blurTrack = new WeakMap();
  function onBlur(e) {
    if (!recording) return;
    const el = e.target;
    if (!el || el.closest('#eprec') || el.closest('#eprec-modal')) return;
    const tag  = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    const skip = ['submit','button','reset','checkbox','radio','hidden','file','image'];
    if (tag === 'input' && skip.includes(type)) return;
    if (tag !== 'input' && tag !== 'textarea') return;
    const val = (el.value || '').trim();
    if (!val) return;
    if (blurTrack.get(el) === val) return;
    blurTrack.set(el, val);
    const lbl   = findLabel(el) || el.placeholder || el.getAttribute('aria-label') || el.name || el.id || 'campo';
    const shown = type === 'password' ? '(senha ocultada)' : val.length > 70 ? val.substring(0, 70) + '…' : val;
    addStep('input', `Campo "${lbl}" preenchido com "${shown}"`);
  }

  // ── SUBMIT
  function onSubmit(e) {
    if (!recording) return;
    const form = e.target;
    if (form.closest('#eprec')) return;
    const id = form.id || form.name || (form.action || '').split('/').pop() || 'formulário';
    if (autoShot) {
      // FIX #3: enfileirado — vai aparecer após o passo de submit
      addStep('submit', `Formulário "${id}" enviado — aguardando resposta do sistema`);
      enqueueCapture('print_auto', `📷 Resultado do envio do formulário "${id}"`, 1400);
    } else {
      addStep('submit', `Formulário "${id}" enviado`);
    }
  }

  // ────────────────────────────────────────────────
  //  DESCREVER ELEMENTO — FIX #1: textos humanizados
  // ────────────────────────────────────────────────
  function descEl(el) {
    if (!el) return 'Elemento';
    const tag   = el.tagName.toLowerCase();
    const aria  = el.getAttribute('aria-label') || '';
    const title = el.getAttribute('title') || '';
    const txt   = (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 100);
    const lbl   = findLabel(el);
    const name  = aria || lbl || title || txt || el.getAttribute('value') || el.name || el.id || tag;

    if (tag === 'button' || (el.getAttribute('role') || '') === 'button') {
      return `Botão "${name}" acionado`;
    }
    if (tag === 'a') {
      const href = el.getAttribute('href') || '';
      const extra = extractEprocAction(href);
      return `Link "${name}" acessado${extra ? ' — ' + extra : ''}`;
    }
    if (tag === 'input') {
      const t = (el.type || '').toLowerCase();
      if (['submit','button'].includes(t)) return `Botão "${name}" acionado`;
      if (t === 'checkbox') return `Checkbox "${name}" ${el.checked ? 'marcado ✓' : 'desmarcado ✗'}`;
      if (t === 'radio')    return `Opção "${name}" selecionada`;
    }
    if (tag === 'select') return `Menu "${name}" aberto`;
    return `Elemento "${name}" (${tag}) clicado`;
  }

  function humanShort(desc) {
    // Retorna versão curta para legenda do print automático
    return desc.replace(/^(Botão|Link|Opção|Elemento)\s+/, '').substring(0, 60);
  }

  function extractEprocAction(href) {
    if (!href) return '';
    const m = href.match(/[?&]acao=([^&]+)/i);
    if (m) return 'ação: ' + decodeURIComponent(m[1]).replace(/_/g, ' ');
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
  //  OBSERVER DE POPUPS — FIX #4
  //  Telas sobrepostas: grava como sequência contínua,
  //  não interrompe nem reinicia a gravação.
  // ────────────────────────────────────────────────
  const knownPopups = new WeakSet(); // evita duplicatas do mesmo nó

  function observePopups() {
    if (popObs) return;
    popObs = new MutationObserver(muts => {
      if (!recording) return;
      for (const m of muts) {
        // FIX #4: detecta abertura de popups
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.id && ['eprec','eprec-modal','eprec-floatind','eprec-capturing','eprec-hist-modal'].includes(node.id)) continue;
          if (knownPopups.has(node)) continue;
          if (isPopup(node)) {
            knownPopups.add(node);
            const desc = descPopup(node);
            // FIX #4: registra como passo na sequência principal (não relatório separado)
            addStep('popup_aberto', `Janela/popup exibido: ${desc}`);
            if (autoShot) {
              // Captura o popup como parte da sequência normal
              enqueueCapture('print_auto', `📷 Conteúdo do popup: ${desc}`, 500);
            }
            // Observa fechamento do popup para registrar também
            observePopupClose(node, desc);
          }
        }
        // FIX #4: detecta mudanças de visibilidade em popups já existentes
        if (m.type === 'attributes' && m.target.nodeType === 1) {
          const node = m.target;
          if (!knownPopups.has(node) && isPopupVisible(node)) {
            knownPopups.add(node);
            const desc = descPopup(node);
            addStep('popup_aberto', `Janela/popup exibido: ${desc}`);
            if (autoShot) {
              enqueueCapture('print_auto', `📷 Conteúdo do popup: ${desc}`, 500);
            }
            observePopupClose(node, desc);
          }
        }
      }
    });
    popObs.observe(document.body, {
      childList: true,
      subtree: true,          // FIX #4: subtree=true para detectar popups em camadas internas
      attributes: true,
      attributeFilter: ['style','class','hidden','aria-hidden'],
    });
  }

  function observePopupClose(node, desc) {
    // Observa quando o popup for removido ou escondido
    const obs = new MutationObserver(() => {
      if (!document.body.contains(node) || !isPopupVisible(node)) {
        obs.disconnect();
        if (recording) {
          addStep('popup_fechado', `Janela/popup fechado: ${desc}`);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    // Também observa atributos no próprio nó
    obs.observe(node, { attributes: true, attributeFilter: ['style','class','hidden','aria-hidden'] });
  }

  function isPopup(el) {
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (['dialog','alertdialog','alert'].includes(role)) return true;
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/modal|popup|dialog|overlay|lightbox|popover/i.test(cls)) return true;
    // eProc usa divs com z-index altíssimo como popups
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
    // FIX #1: captura título de alertas e mensagens do eProc de forma mais precisa
    const selectors = [
      '[class*="titulo"]', '[class*="title"]', '[class*="header"]',
      '[class*="cabecalho"]', '[class*="alerta"]', '[class*="mensagem"]',
      'h1','h2','h3','h4','.modal-title','.dialog-title',
    ];
    for (const sel of selectors) {
      try {
        const h = el.querySelector(sel);
        if (h) {
          const t = h.textContent.trim();
          if (t) return `"${t.replace(/\s+/g, ' ').substring(0, 100)}"`;
        }
      } catch {}
    }
    // Fallback: primeiros 100 chars do texto
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 100);
    return `"${t || 'sem título'}"`;
  }

  // ────────────────────────────────────────────────
  //  RETOMAR SE ESTAVA GRAVANDO
  // ────────────────────────────────────────────────
  function resumeIfNeeded() {
    if (recording) {
      attachListeners();
      observePopups();
      if (autoShot) {
        enqueueCapture('print_auto', '📷 Nova página carregada: ' + document.title, 800);
      } else {
        addStep('navegacao', 'Nova página: ' + document.title);
      }
    }
  }

  // ────────────────────────────────────────────────
  //  NARRATIVA — FIX #1: texto mais humanizado e contextual
  // ────────────────────────────────────────────────
  function generateNarrative(stepsArr) {
    const CONN = [
      'Em seguida,', 'Depois,', 'A seguir,', 'Após isso,',
      'Na sequência,', 'Então,', 'Logo após,', 'Por fim,',
      'Em continuidade,', 'Ato contínuo,',
    ];
    let ci = 0;
    const conn = () => CONN[ci++ % CONN.length];

    const parts = [];
    let lastPage = null;

    for (const s of stepsArr) {
      if (s.type === 'inicio') {
        const title = s.description.replace('Gravação iniciada — ', '').trim();
        lastPage = s.pageTitle;
        parts.push(`O teste tem início na página <strong>"${esc(title)}"</strong>.`);
        continue;
      }

      // Transição de página
      if (s.pageTitle && s.pageTitle !== lastPage && !['print_auto','print_manual','popup_aberto','popup_fechado'].includes(s.type)) {
        parts.push(`${conn()} o sistema navega para a página <strong>"${esc(s.pageTitle)}"</strong>.`);
        lastPage = s.pageTitle;
      }

      const sentence = stepToNarrative(s);
      if (!sentence) continue;

      if (parts.length === 0) {
        parts.push(`O usuário ${sentence}.`);
      } else {
        // Prints e notas integrados sem conectivo
        if (['print_auto','print_manual'].includes(s.type)) {
          parts.push(sentence + '.');
        } else if (s.type === 'anotacao') {
          parts.push(`<em style="color:#718096">[Observação registrada: ${esc(s.description)}]</em>`);
        } else {
          parts.push(`${conn()} o usuário ${sentence}.`);
        }
      }
    }

    return parts.length ? parts.join(' ') : 'Nenhuma ação registrada.';
  }

  function stepToNarrative(s) {
    const d = s.description;

    switch (s.type) {
      case 'inicio':
      case 'navegacao':
        return null;

      case 'print_auto':
        return `<span style="color:#4a5568;font-style:italic">📷 ${esc(d.replace(/^📷\s*/, ''))}</span>`;

      case 'print_manual':
        return `<span style="color:#4a5568;font-style:italic">📷 ${esc(d.replace(/^📷\s*/, ''))}</span>`;

      case 'clique_botao': {
        const m = d.match(/Botão "(.+)" acionado/);
        return `aciona o botão <strong>"${esc(m ? m[1] : d)}"</strong>`;
      }

      case 'clique_link': {
        const m = d.match(/Link "([^"]+)" acessado/);
        const act = d.match(/— (.+)$/);
        const name = esc(m ? m[1] : d);
        return `clica no link <strong>"${name}"</strong>${act ? ` (${esc(act[1])})` : ''}`;
      }

      case 'clique_menu': {
        const m = d.match(/Elemento "([^"]+)"/);
        return `seleciona a opção <strong>"${esc(m ? m[1] : d)}"</strong> no menu`;
      }

      case 'input': {
        const m = d.match(/Campo "([^"]+)" preenchido com "(.+)"/);
        if (!m) return `preenche um campo de formulário`;
        const val = m[2].includes('(senha') ? '<em>senha ocultada</em>' : `<em>"${esc(m[2])}"</em>`;
        return `preenche o campo <strong>"${esc(m[1])}"</strong> com ${val}`;
      }

      case 'select': {
        const mSel = d.match(/Seleção no campo "([^"]+)": opção escolhida foi "([^"]+)"/);
        if (mSel) return `seleciona a opção <strong>"${esc(mSel[2])}"</strong> no campo <strong>"${esc(mSel[1])}"</strong>`;
        const mCb = d.match(/Checkbox "([^"]+)" foi (marcado|desmarcado)/);
        if (mCb) return `${mCb[2] === 'marcado' ? 'marca' : 'desmarca'} a opção <strong>"${esc(mCb[1])}"</strong>`;
        const mRd = d.match(/Opção de rádio selecionada: "([^"]+)"/);
        if (mRd) return `seleciona a opção <strong>"${esc(mRd[1])}"</strong>`;
        return esc(d);
      }

      case 'submit': {
        const m = d.match(/Formulário "([^"]+)" enviado/);
        return m ? `submete o formulário <strong>"${esc(m[1])}"</strong>` : `submete o formulário`;
      }

      case 'popup_aberto': {
        const m = d.match(/Janela\/popup exibido: "([^"]+)"/);
        return m ? `uma janela é exibida pelo sistema: <strong>"${esc(m[1])}"</strong>` : `uma janela é exibida pelo sistema`;
      }

      case 'popup_fechado': {
        const m = d.match(/Janela\/popup fechado: "([^"]+)"/);
        return m ? `a janela <strong>"${esc(m[1])}"</strong> é fechada` : `a janela é fechada`;
      }

      case 'anotacao':
        return null; // tratado acima

      default:
        return null;
    }
  }

  // ────────────────────────────────────────────────
  //  EXPORTAR
  // ────────────────────────────────────────────────
  function pickExportTarget() {
    // Se há apenas a sessão atual, exporta direto. Se há histórico, oferece escolha.
    exportSession({ steps, shots: buildCurrentShotsMap(), date: new Date().toLocaleString('pt-BR'), title: steps[0]?.pageTitle });
  }

  function buildCurrentShotsMap() {
    const map = {};
    steps.forEach(s => { const img = getShot(s.num); if (img) map[s.num] = img; });
    return map;
  }

  function exportSession(sess) {
    const stepsArr = sess.steps || [];
    const shotsMap  = sess.shots || {};
    if (!stepsArr.length) { alert('Nenhum passo para exportar.'); return; }

    const now  = new Date();
    const dBR  = sess.date ? sess.date.split(' ')[0] : now.toLocaleDateString('pt-BR');
    const tBR  = sess.date ? (sess.date.split(' ')[1] || '') : now.toLocaleTimeString('pt-BR');

    const BADGE = {
      clique_botao: ['#1a365d','#90cdf4','BOTÃO'],
      clique_link:  ['#322659','#d6bcfa','LINK'],
      clique_menu:  ['#1d4044','#81e6d9','MENU'],
      popup_aberto: ['#744210','#fbd38d','POPUP'],
      popup_fechado:['#2d3748','#a0aec0','POPUP FIM'],
      anotacao:     ['#1c4532','#9ae6b4','NOTA'],
      submit:       ['#63171b','#feb2b2','ENVIO'],
      inicio:       ['#171923','#a0aec0','INÍCIO'],
      select:       ['#1a365d','#90cdf4','SELEÇÃO'],
      input:        ['#1a2744','#bee3f8','INPUT'],
      print_manual: ['#4a3000','#fefcbf','PRINT'],
      print_auto:   ['#1a3000','#c6f6d5','PRINT AUTO'],
      navegacao:    ['#322659','#e9d8fd','NAVEGAÇÃO'],
    };

    // FIX #3: Ordena por tsNum para garantir ordem cronológica exata no relatório
    const sorted = [...stepsArr].sort((a, b) => (a.tsNum || 0) - (b.tsNum || 0));

    const rows = sorted.map(s => {
      const [bg, fg, lbl] = BADGE[s.type] || ['#2d3748','#e2e8f0', s.type.toUpperCase()];
      const shotData = shotsMap[s.num];
      // FIX #2 + #3: print inserido imediatamente após a linha do passo correspondente
      const img = shotData
        ? `<div style="margin-top:8px"><img src="${shotData}" style="max-width:700px;width:100%;border-radius:4px;border:1px solid #e2e8f0;display:block"></div>`
        : '';
      return `<tr>
        <td class="tc">${s.num}</td>
        <td><span class="badge" style="background:${bg};color:${fg}">${lbl}</span></td>
        <td class="ts">${esc(s.timestamp)}</td>
        <td class="td">${esc(s.description)}${img}</td>
        <td class="tp">${esc(s.pageTitle)}</td>
      </tr>`;
    }).join('');

    const printCount = sorted.filter(s => shotsMap[s.num]).length;
    const narrative = generateNarrative(sorted);

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Relatório de Testes eProc — ${dBR}</title>
<style>
*{box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;background:#f7fafc;color:#2d3748;margin:0;padding:20px;font-size:13px}
h1{margin:0 0 4px;font-size:20px;color:#e8eaf0}
h2{margin:0 0 10px;font-size:14px;font-weight:700;color:#2d3748}
.hdr{background:#1a202c;border-radius:8px;padding:20px 24px;margin-bottom:18px}
.meta{font-size:11px;color:#718096;display:flex;gap:18px;flex-wrap:wrap;margin-top:8px}
.narr{background:#fff;border-radius:8px;padding:18px 24px;margin-bottom:18px;box-shadow:0 1px 4px rgba(0,0,0,.08);border-left:4px solid #553c9a}
.narr-text{font-size:13px;color:#4a5568;line-height:2.1;margin:0}
.narr-text strong{color:#1a202c}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)}
th{background:#2d3748;color:#a0aec0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:8px 10px;text-align:left}
td{padding:9px 10px;border-bottom:1px solid #edf2f7;vertical-align:top}
tr:last-child td{border-bottom:none}
tr:hover td{background:#f7fafc}
.tc{text-align:center;font-weight:700;color:#a0aec0;width:36px}
.ts{color:#718096;font-size:12px;white-space:nowrap;width:130px}
.td{font-size:13px;color:#1a202c}
.tp{font-size:11px;color:#a0aec0;word-break:break-all;width:160px}
.badge{border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700;white-space:nowrap;display:inline-block}
@media print{
  body{background:#fff;padding:10px}
  .hdr,.narr{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .badge{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  img{max-width:100% !important;page-break-inside:avoid}
  tr{page-break-inside:avoid}
}
</style></head><body>
<div class="hdr">
  <h1>📋 Relatório de Testes — eProc</h1>
  <p style="margin:4px 0 0;color:#718096;font-size:12px">Gravador de Testes para Homologação v5.0</p>
  <div class="meta">
    <span>📅 ${dBR} ${tBR}</span>
    <span>📌 ${sorted.length} passos registrados</span>
    ${printCount > 0 ? `<span>📷 ${printCount} print${printCount !== 1 ? 's' : ''}</span>` : ''}
    <span>🌐 ${esc(sorted[0]?.pageTitle || '')}</span>
  </div>
</div>
<div class="narr">
  <h2>📝 Narrativa de Uso</h2>
  <p class="narr-text">${narrative}</p>
</div>
<table>
  <thead><tr>
    <th>#</th>
    <th style="width:90px">Tipo</th>
    <th style="width:130px">Horário</th>
    <th>Descrição / Print</th>
    <th style="width:160px">Página</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<p style="text-align:center;color:#cbd5e0;font-size:10px;margin-top:16px">eProc Gravador de Testes v5.0 — ${dBR} ${tBR}</p>
</body></html>`;

    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })),
      download: `relatorio-eproc-${now.toISOString().slice(0, 10)}.html`
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
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
  }

  init();
})();
