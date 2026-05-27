// ==UserScript==
// @name         eProc - Gravador de Testes para Homologação
// @namespace    eproc-gravador-testes
// @version      4.1.0
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

  // Estado persistido em sessionStorage (sobrevive navegações internas)
  const SK = { rec: 'eprec_rec', steps: 'eprec_steps', count: 'eprec_count' };

  function ss(k, v) {
    if (v === undefined) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } }
    try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {}
  }

  let recording  = ss(SK.rec)   || false;
  let steps      = ss(SK.steps) || [];
  let counter    = ss(SK.count) || 0;
  let popObs     = null;
  let pendingCapture = null;

  // Screenshots — persistidos no sessionStorage para sobreviver navegações entre páginas.
  // Prefixo separado para não colidir com os outros dados.
  const SHOT_PFX = 'eprec_shot_';
  const screenshots = {}; // cache em memória para acesso rápido

  function saveShot(num, dataUrl) {
    screenshots[num] = dataUrl;
    try { sessionStorage.setItem(SHOT_PFX + num, dataUrl); } catch {}
  }

  function getShot(num) {
    return screenshots[num] || sessionStorage.getItem(SHOT_PFX + num) || null;
  }

  function clearShots() {
    Object.keys(screenshots).forEach(k => delete screenshots[k]);
    const toRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(SHOT_PFX)) toRemove.push(k);
    }
    toRemove.forEach(k => sessionStorage.removeItem(k));
  }

  // Pré-carregar no cache qualquer screenshot já salvo (ex: após navegação de página)
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
      z-index: 2147483647 !important; width: 245px;
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
    #eprec-led.on { background: #f56565; }

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

    .eb-row { display: flex; gap: 5px; margin-bottom: 5px; }
    .eb-row .eb { margin-bottom: 0; }
    .eb-shot { background: #2d1f00; color: #fbd38d; font-size: 11px; }
    .eb-note { background: #1e1040; color: #d6bcfa; font-size: 11px; }

    #eprec-hint { font-size: 10px; color: #2d3748; margin-top: 7px; line-height: 1.5; }

    #eprec-log { display: none; max-height: 90px; overflow-y: auto; background: #080b12; border-radius: 5px; padding: 4px 6px; margin-top: 7px; }
    .el { font-size: 10px; color: #2d3748; padding: 1px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .el.hi { color: #63b3ed; }
    #eprec-logtoggle { font-size: 10px; color: #2d3748; cursor: pointer; margin-top: 6px; text-align: right; }
    #eprec-logtoggle:hover { color: #4a5568; }

    /* Modal */
    #eprec-modal {
      display: none; position: fixed !important; inset: 0;
      z-index: 2147483648 !important; background: rgba(0,0,0,.7);
      align-items: center; justify-content: center;
    }
    #eprec-modal.open { display: flex !important; }
    #eprec-mbox {
      background: #12161f; border: 1px solid #2a2f3d; border-radius: 10px;
      padding: 18px; width: 420px; max-width: 92vw;
      box-shadow: 0 20px 60px rgba(0,0,0,.7); font-family: 'Segoe UI', Arial, sans-serif;
    }
    #eprec-mbox label { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #4a5568; margin-bottom: 7px; }
    #eprec-mthumb { display: none; width: 100%; border-radius: 5px; margin-bottom: 9px; border: 1px solid #2a2f3d; }
    #eprec-mtext {
      width: 100%; background: #080b12; border: 1px solid #2a2f3d; color: #c9d1e0;
      border-radius: 5px; padding: 7px 9px; font-size: 13px;
      font-family: 'Segoe UI', Arial, sans-serif; resize: vertical; min-height: 70px; outline: none;
    }
    #eprec-mtext:focus { border-color: #553c9a; }
    #eprec-mfooter { display: flex; gap: 7px; margin-top: 10px; justify-content: flex-end; }
    .emb { padding: 6px 14px; border-radius: 5px; border: none; font-size: 12px; font-weight: 700; cursor: pointer; }
    #eprec-mcancel { background: #1e2533; color: #718096; }
    #eprec-mok     { background: #553c9a; color: #fff; }

    /* Indicador flutuante quando minimizado e gravando */
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
        <button class="eb eb-clear"  id="eprec-btn-clr" style="display:none">🗑 Limpar</button>
        <div id="eprec-hint"></div>
        <div id="eprec-logtoggle">▸ log</div>
        <div id="eprec-log"></div>
      </div>`;
    document.body.appendChild(p);

    const ind = document.createElement('div');
    ind.id = 'eprec-floatind';
    ind.textContent = '● REC';
    document.body.appendChild(ind);

    drag(p, document.getElementById('eprec-head'));

    // Minimizar
    let mini = false;
    document.getElementById('eprec-min').addEventListener('click', () => {
      mini = !mini;
      document.getElementById('eprec-body').style.display = mini ? 'none' : 'block';
      document.getElementById('eprec-head').style.borderRadius = mini ? '10px' : '10px 10px 0 0';
      document.getElementById('eprec-min').textContent = mini ? '▲' : '▼';
      p.style.display = mini ? 'none' : 'block';
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
    document.getElementById('eprec-btn-exp').addEventListener('click',  e => { e.stopPropagation(); exportReport(); });
    document.getElementById('eprec-btn-clr').addEventListener('click',  e => { e.stopPropagation(); clearAll(); });

    refreshUI();
  }

  function buildModal() {
    if (document.getElementById('eprec-modal')) return;
    const m = document.createElement('div');
    m.id = 'eprec-modal';
    m.innerHTML = `
      <div id="eprec-mbox">
        <label id="eprec-mlabel">Anotação</label>
        <img id="eprec-mthumb" alt="Screenshot capturado">
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

  let modalMode = 'note'; // 'note' | 'shot'

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

    // Desabilitar botão e indicar captura em andamento
    const btnShot = document.getElementById('eprec-btn-shot');
    if (btnShot) { btnShot.disabled = true; btnShot.textContent = '📷 Capturando…'; }

    const imgData = await captureScreenshot();
    pendingCapture = imgData;

    if (btnShot) { btnShot.disabled = false; btnShot.textContent = '📷 Print'; }

    // Mostrar miniatura no modal se capturou com sucesso
    const thumb = document.getElementById('eprec-mthumb');
    if (thumb) {
      if (imgData) { thumb.src = imgData; thumb.style.display = 'block'; }
      else          { thumb.style.display = 'none'; thumb.src = ''; }
    }

    document.getElementById('eprec-mlabel').textContent = imgData
      ? '📷 Tela capturada — adicione uma descrição'
      : '📷 Print (descreva o que está visível na tela)';
    document.getElementById('eprec-mtext').placeholder = 'Ex: "Formulário de cadastro com campos preenchidos", "Mensagem de erro exibida", "Lista de processos filtrada por data"…';
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
      const desc = txt || 'Print de tela registrado';
      addStep('print_manual', '📷 ' + desc, pendingCapture);
    } else {
      if (!txt) { closeModal(); return; }
      addStep('anotacao', txt);
    }
    closeModal();
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

  function startRec() {
    recording = true;
    ss(SK.rec, true);
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

  function refreshUI() {
    const led  = document.getElementById('eprec-led');
    const lbl  = document.getElementById('eprec-label');
    const cnt  = document.getElementById('eprec-count');
    const head = document.getElementById('eprec-head');
    const stat = document.getElementById('eprec-status');
    const btnR = document.getElementById('eprec-btn-rec');
    const mid  = document.getElementById('eprec-midrow');
    const btnE = document.getElementById('eprec-btn-exp');
    const btnC = document.getElementById('eprec-btn-clr');
    const hint = document.getElementById('eprec-hint');
    if (!led) return;

    const n = steps.length;
    cnt.textContent = `${n} passo${n!==1?'s':''}`;

    if (recording) {
      led.className = 'on'; lbl.className = 'on'; lbl.textContent = '● GRAVANDO';
      head.className = 'on'; cnt.className = 'on'; stat.className = 'on';
      stat.textContent = 'Registrando ações…';
      btnR.className = 'eb eb-stop'; btnR.textContent = '⏹ Parar Gravação';
      mid.style.display = 'flex'; btnE.style.display = 'none'; btnC.style.display = 'none';
      hint.innerHTML = '<span style="color:#2d3748;font-size:10px">Cliques, seleções e campos preenchidos são registrados automaticamente.<br>Use 📷 para capturar a tela ou ✏️ para anotações.</span>';
    } else {
      led.className = ''; lbl.className = ''; lbl.textContent = 'Gravador';
      head.className = ''; cnt.className = '';
      btnR.className = 'eb eb-start'; btnR.textContent = '▶ Iniciar Gravação';
      mid.style.display = 'none'; hint.innerHTML = '';
      if (n > 0) {
        stat.className = 'off';
        stat.textContent = `Parado. ${n} passo${n!==1?'s':''} gravado${n!==1?'s':''}.`;
        btnE.style.display = ''; btnC.style.display = '';
      } else {
        stat.className = ''; stat.textContent = 'Pronto para gravar';
        btnE.style.display = 'none'; btnC.style.display = 'none';
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
      num: counter, type, description,
      timestamp: new Date().toLocaleString('pt-BR'),
      url: location.href,
      pageTitle: document.title,
    };

    if (screenshot) saveShot(counter, screenshot);

    steps.push(step);
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

  function clearAll() {
    if (!confirm('Limpar todos os passos gravados?')) return;
    steps = []; counter = 0;
    ss(SK.steps, []); ss(SK.count, 0);
    clearShots();
    document.getElementById('eprec-log').innerHTML = '';
    refreshUI();
  }

  // ────────────────────────────────────────────────
  //  CAPTURA DE TELA (html2canvas)
  //  O painel fica invisível durante a captura para não aparecer no print.
  //  Se html2canvas não estiver disponível (CSP bloqueou CDN), retorna null
  //  e o fluxo cai para descrição manual.
  // ────────────────────────────────────────────────
  async function captureScreenshot() {
    if (typeof html2canvas === 'undefined') {
      console.warn('[eprec] html2canvas não carregou (CDN bloqueado?)');
      return null;
    }

    // ignoreElements exclui completamente o painel da captura (mais confiável que visibility:hidden)
    const IGNORE_IDS = new Set(['eprec', 'eprec-floatind', 'eprec-modal']);

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
  // Sobe na árvore DOM procurando o elemento clicável real.
  // Captura além de <button> e <a>: qualquer elemento com onclick, role ou cursor:pointer.
  function onClick(e) {
    if (!recording) return;
    const el = e.target;
    if (!el) return;
    if (el.closest('#eprec') || el.closest('#eprec-modal') || el.closest('#eprec-floatind')) return;

    const root = findClickable(el);
    if (!root) return;

    const desc = descEl(root);
    const tag  = root.tagName.toLowerCase();
    const role = (root.getAttribute('role') || '').toLowerCase();
    const type = tag === 'a' ? 'clique_link'
      : ['tab','menuitem','treeitem','option'].includes(role) ? 'clique_menu'
      : 'clique_botao';

    setTimeout(() => addStep(type, desc), 0);
  }

  // Sobe até 7 níveis procurando elemento clicável
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

    // Elementos nativamente clicáveis
    if (['button', 'a'].includes(tag)) return true;
    if (tag === 'input' && ['submit','button','reset','checkbox','radio'].includes(type)) return true;
    if (tag === 'select') return true;

    // Elementos com roles ARIA clicáveis
    if (['button','link','tab','menuitem','treeitem','option','checkbox','radio','switch'].includes(role)) return true;

    // Elemento com handler onclick explícito (comum em eProc: divs, tds, imgs com onclick)
    if (el.hasAttribute('onclick')) return true;

    // Verificar cursor:pointer como último recurso (só se tiver texto/conteúdo)
    try {
      const style = window.getComputedStyle(el);
      if (style.cursor === 'pointer' && (el.textContent || '').trim()) return true;
    } catch {}

    return false;
  }

  // ── CHANGE (select, checkbox, radio)
  function onChange(e) {
    if (!recording) return;
    const el = e.target;
    if (!el || el.closest('#eprec')) return;
    const tag  = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();

    if (tag === 'select') {
      const lbl = findLabel(el) || el.name || el.id || 'campo';
      const val = el.options[el.selectedIndex]?.text || el.value;
      setTimeout(() => addStep('select', `Seleção: "${lbl}" → "${val}"`), 0);
    }
    if (tag === 'input' && ['checkbox','radio'].includes(type)) {
      const lbl = findLabel(el) || el.name || el.id || el.value || 'opção';
      const desc = type === 'checkbox'
        ? `Checkbox ${el.checked ? '✓ marcado' : '✗ desmarcado'}: "${lbl}"`
        : `Rádio selecionado: "${lbl}"`;
      setTimeout(() => addStep('select', desc), 0);
    }
  }

  // ── BLUR (captura campos de texto quando o usuário sai do campo)
  const blurTrack = new WeakMap(); // el → último valor registrado
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
    if (blurTrack.get(el) === val) return; // mesmo valor já registrado
    blurTrack.set(el, val);

    const lbl   = findLabel(el) || el.placeholder || el.getAttribute('aria-label') || el.name || el.id || 'campo';
    const shown = type === 'password' ? '(senha)' : val.length > 70 ? val.substring(0, 70) + '…' : val;
    setTimeout(() => addStep('input', `Campo "${lbl}": "${shown}"`), 0);
  }

  // ── SUBMIT
  function onSubmit(e) {
    if (!recording) return;
    const form = e.target;
    if (form.closest('#eprec')) return;
    const id = form.id || form.name || (form.action || '').split('/').pop() || 'formulário';
    setTimeout(() => addStep('submit', `Formulário enviado: "${id}"`), 0);
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

    if (tag === 'button' || (el.getAttribute('role') || '') === 'button') {
      return `Botão clicado: "${name}"`;
    }
    if (tag === 'a') {
      const href = el.getAttribute('href') || '';
      const extra = extractEprocAction(href);
      return `Link clicado: "${name}"${extra ? ' (' + extra + ')' : ''}`;
    }
    if (tag === 'input') {
      const t = (el.type || '').toLowerCase();
      if (['submit','button'].includes(t)) return `Botão clicado: "${name}"`;
      if (t === 'checkbox') return `Checkbox ${el.checked ? '✓ marcado' : '✗ desmarcado'}: "${name}"`;
      if (t === 'radio')    return `Rádio selecionado: "${name}"`;
    }
    if (tag === 'select') return `Menu suspenso clicado: "${name}"`;
    // Elemento genérico com onclick (comum no eProc: divs, tds)
    return `Clique em: "${name}" (${tag})`;
  }

  // Extrai a ação do eProc da URL para deixar o log mais descritivo
  function extractEprocAction(href) {
    if (!href) return '';
    const m = href.match(/[?&]acao=([^&]+)/i);
    if (m) return 'ação: ' + decodeURIComponent(m[1]).replace(/_/g, ' ');
    // Fallback: último segmento da URL
    const seg = href.split('/').filter(Boolean).pop() || '';
    if (seg && seg !== '#' && seg.length < 60) return seg;
    return '';
  }

  function findLabel(el) {
    // 1. label[for=id]
    if (el.id) {
      try {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) return l.textContent.trim();
      } catch {}
    }
    // 2. label ancestral
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
  //  OBSERVER DE POPUPS
  // ────────────────────────────────────────────────
  function observePopups() {
    if (popObs) return;
    popObs = new MutationObserver(muts => {
      if (!recording) return;
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.id && ['eprec','eprec-modal','eprec-floatind'].includes(node.id)) continue;
          if (isPopup(node)) {
            const desc = descPopup(node);
            setTimeout(() => addStep('popup_aberto', 'Popup aberto: ' + desc), 0);
          }
        }
      }
    });
    popObs.observe(document.body, { childList: true, subtree: false });
  }

  function isPopup(el) {
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (['dialog','alertdialog','alert'].includes(role)) return true;
    const cls = typeof el.className === 'string' ? el.className : '';
    return /modal|popup|dialog|overlay|lightbox|popover/i.test(cls);
  }

  function descPopup(el) {
    const h = el.querySelector('h1,h2,h3,h4,[class*="title"],[class*="titulo"]');
    const t = h ? h.textContent.trim() : (el.textContent || '').trim().substring(0, 80);
    return `"${t.replace(/\s+/g, ' ')}"`;
  }

  // ────────────────────────────────────────────────
  //  RETOMAR SE ESTAVA GRAVANDO (nova página carregou)
  // ────────────────────────────────────────────────
  function resumeIfNeeded() {
    if (recording) {
      attachListeners();
      observePopups();
      setTimeout(() => addStep('navegacao', 'Nova página: ' + document.title), 300);
    }
  }

  // ────────────────────────────────────────────────
  //  EXPORTAR — relatório HTML com prints embutidos
  // ────────────────────────────────────────────────
  function exportReport() {
    if (!steps.length) { alert('Nenhum passo gravado.'); return; }

    const now = new Date();
    const dBR = now.toLocaleDateString('pt-BR');
    const tBR = now.toLocaleTimeString('pt-BR');

    const BADGE = {
      clique_botao: ['#1a365d','#90cdf4','BOTÃO'],
      clique_link:  ['#322659','#d6bcfa','LINK'],
      clique_menu:  ['#1d4044','#81e6d9','MENU'],
      popup_aberto: ['#744210','#fbd38d','POPUP'],
      anotacao:     ['#1c4532','#9ae6b4','NOTA'],
      submit:       ['#63171b','#feb2b2','ENVIO'],
      inicio:       ['#171923','#a0aec0','INÍCIO'],
      select:       ['#1a365d','#90cdf4','SELEÇÃO'],
      input:        ['#1a2744','#bee3f8','INPUT'],
      print_manual: ['#4a3000','#fefcbf','PRINT'],
      navegacao:    ['#322659','#e9d8fd','NAVEGAÇÃO'],
    };

    const rows = steps.map(s => {
      const [bg, fg, lbl] = BADGE[s.type] || ['#2d3748','#e2e8f0', s.type.toUpperCase()];
      const shotData = getShot(s.num);
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

    const printCount = steps.filter(s => getShot(s.num)).length;
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Relatório de Testes eProc — ${dBR}</title>
<style>
*{box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;background:#f7fafc;color:#2d3748;margin:0;padding:20px;font-size:13px}
h1{margin:0 0 4px;font-size:20px;color:#e8eaf0}
.hdr{background:#1a202c;border-radius:8px;padding:20px 24px;margin-bottom:18px}
.meta{font-size:11px;color:#718096;display:flex;gap:18px;flex-wrap:wrap;margin-top:8px}
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
  .hdr{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .badge{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  img{max-width:100% !important;page-break-inside:avoid}
  tr{page-break-inside:avoid}
}
</style></head><body>
<div class="hdr">
  <h1>📋 Relatório de Testes — eProc</h1>
  <p style="margin:4px 0 0;color:#718096;font-size:12px">Gravador de Testes para Homologação v4.0</p>
  <div class="meta">
    <span>📅 ${dBR} às ${tBR}</span>
    <span>📌 ${steps.length} passos registrados</span>
    ${printCount > 0 ? `<span>📷 ${printCount} print${printCount!==1?'s':''} capturado${printCount!==1?'s':''}</span>` : ''}
    <span>🌐 ${esc(steps[0]?.pageTitle||'')}</span>
  </div>
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
<p style="text-align:center;color:#cbd5e0;font-size:10px;margin-top:16px">eProc Gravador de Testes v4.0 — ${dBR} ${tBR}</p>
</body></html>`;

    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([html], {type: 'text/html;charset=utf-8'})),
      download: `relatorio-eproc-${now.toISOString().slice(0, 10)}.html`
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function esc(s) {
    return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ────────────────────────────────────────────────
  //  INIT
  // ────────────────────────────────────────────────
  function init() {
    loadShotsFromStorage(); // recupera screenshots de navegações anteriores
    const run = () => { buildPanel(); buildModal(); resumeIfNeeded(); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
  }

  init();
})();
