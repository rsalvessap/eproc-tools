// ==UserScript==
// @name         eProc Toolkit
// @namespace    https://github.com/rsalvessap/eproc-tools
// @version      1.1
// @description  Conjunto de ferramentas de automação para o eProc TJSP
// @author       rsalvessap
// @match        https://eproc1g.tjsp.jus.br/eproc/controlador.php*
// @match        https://eproc2g.tjsp.jus.br/eproc/controlador.php*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        unsafeWindow
// @require      https://raw.githubusercontent.com/rsalvessap/eproc-scripts-gerais/master/shared/eproc-utils.js
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  // Debug: false em produção (true para ver logs no console)
  const DEBUG = false;
  const log  = (...a) => DEBUG && console.log('[Toolkit]', ...a);
  const warn = (...a) => console.warn('[Toolkit]', ...a);
  const err  = (...a) => console.error('[Toolkit]', ...a);

  // =========================================================
  // Config — estado ativo/inativo de cada módulo
  // =========================================================
  const Config = (() => {
    const KEY = 'eproc_toolkit_config';
    const defaults = { remigrar: true, inconsistencias: true };
    let state = { ...defaults };

    const load = () => {
      try {
        const saved = GM_getValue(KEY, null);
        if (saved) state = { ...defaults, ...JSON.parse(saved) };
      } catch (e) {}
    };

    const save = () => {
      try { GM_setValue(KEY, JSON.stringify(state)); } catch (e) {}
    };

    const isEnabled = (id) => !!state[id];

    const toggle = (id) => {
      state[id] = !state[id];
      save();
      return state[id];
    };

    load();
    return { isEnabled, toggle, state };
  })();

  // =========================================================
  // Detecção de página
  // =========================================================
  const getAcao = () => new URLSearchParams(window.location.search).get('acao') || '';
  const onRemigrarPage = () => {
    const acao = getAcao();
    return acao === 'remigrar_processo' || window.location.search.includes('remigrar_processo_modulo');
  };
  const onInconsistenciasPage = () => getAcao() === 'ProcessoInconsistente/consultar';

  // =========================================================
  // Toolkit Panel — botão flutuante + painel de módulos
  // =========================================================
  const ToolkitPanel = (() => {
    const MODULES = [
      {
        id: 'remigrar',
        name: 'Remigrar Processo',
        desc: 'Automação em lote da remigração por módulo (CAS, ZIP, Vídeos)',
        active: onRemigrarPage
      },
      {
        id: 'inconsistencias',
        name: 'Inconsistências',
        desc: 'Correção automática de duplicatas (Justiça Gratuita, Litisconsórcio)',
        active: onInconsistenciasPage
      }
    ];

    const init = () => {
      const style = document.createElement('style');
      style.textContent = `
        #eproc-toolkit-btn {
          position: fixed; bottom: 20px; left: 20px; z-index: 999999;
          width: 44px; height: 44px; border-radius: 50%; border: none;
          background: #1a1a2e; color: #fff; font-size: 20px; cursor: pointer;
          box-shadow: 0 4px 14px rgba(0,0,0,.4); transition: transform .2s, box-shadow .2s;
          display: flex; align-items: center; justify-content: center;
        }
        #eproc-toolkit-btn:hover { transform: scale(1.1); box-shadow: 0 6px 20px rgba(0,0,0,.5); }
        #eproc-toolkit-panel {
          position: fixed; bottom: 74px; left: 20px; z-index: 999998;
          width: 300px; background: #1a1a2e; border: 1px solid #4a5568;
          border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,.5);
          font-family: 'Segoe UI', sans-serif; font-size: 13px; color: #e2e8f0;
          overflow: hidden; display: none;
        }
        #eproc-toolkit-panel.open { display: block; }
        .tk-header {
          background: linear-gradient(90deg, #667eea, #764ba2);
          padding: 12px 15px; font-weight: 700; font-size: 14px;
          display: flex; justify-content: space-between; align-items: center;
        }
        .tk-close {
          background: rgba(255,255,255,.2); border: none; color: #fff;
          width: 22px; height: 22px; border-radius: 4px; cursor: pointer; font-size: 14px;
        }
        .tk-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
        .tk-module {
          background: #2d3748; border-radius: 8px; padding: 10px 12px;
          display: flex; flex-direction: column; gap: 6px;
        }
        .tk-module-top { display: flex; justify-content: space-between; align-items: center; }
        .tk-module-name { font-weight: 600; font-size: 13px; }
        .tk-module-desc { font-size: 11px; color: #a0aec0; line-height: 1.4; }
        .tk-module-footer { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
        .tk-badge {
          font-size: 10px; padding: 2px 7px; border-radius: 999px;
          font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
        }
        .tk-badge-active { background: rgba(72,187,120,.2); color: #68d391; border: 1px solid #68d391; }
        .tk-badge-inactive { background: rgba(160,174,192,.1); color: #718096; border: 1px solid #4a5568; }
        /* Toggle switch */
        .tk-toggle { position: relative; width: 36px; height: 20px; flex-shrink: 0; }
        .tk-toggle input { opacity: 0; width: 0; height: 0; }
        .tk-slider {
          position: absolute; inset: 0; background: #4a5568;
          border-radius: 999px; cursor: pointer; transition: .2s;
        }
        .tk-slider:before {
          content: ''; position: absolute; width: 14px; height: 14px;
          left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: .2s;
        }
        .tk-toggle input:checked + .tk-slider { background: #48bb78; }
        .tk-toggle input:checked + .tk-slider:before { transform: translateX(16px); }
      `;
      document.head.appendChild(style);

      const btn = document.createElement('button');
      btn.id = 'eproc-toolkit-btn';
      btn.title = 'eProc Toolkit';
      btn.textContent = '🔧';
      document.body.appendChild(btn);

      const panel = document.createElement('div');
      panel.id = 'eproc-toolkit-panel';
      panel.innerHTML = `
        <div class="tk-header">
          <span>🔧 eProc Toolkit</span>
          <button class="tk-close">×</button>
        </div>
        <div class="tk-body">
          ${MODULES.map(m => {
            const enabled = Config.isEnabled(m.id);
            const activeHere = m.active();
            return `
              <div class="tk-module">
                <div class="tk-module-top">
                  <span class="tk-module-name">${m.name}</span>
                  <label class="tk-toggle">
                    <input type="checkbox" data-module="${m.id}" ${enabled ? 'checked' : ''}>
                    <span class="tk-slider"></span>
                  </label>
                </div>
                <div class="tk-module-desc">${m.desc}</div>
                <div class="tk-module-footer">
                  <span class="tk-badge ${activeHere ? 'tk-badge-active' : 'tk-badge-inactive'}">
                    ${activeHere ? '● Ativo nesta página' : '○ Inativo nesta página'}
                  </span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
      document.body.appendChild(panel);

      btn.addEventListener('click', () => panel.classList.toggle('open'));
      panel.querySelector('.tk-close').addEventListener('click', () => panel.classList.remove('open'));

      panel.querySelectorAll('input[data-module]').forEach(input => {
        input.addEventListener('change', () => {
          Config.toggle(input.dataset.module);
          if (input.checked) {
            alert(`Módulo "${input.closest('.tk-module').querySelector('.tk-module-name').textContent}" ativado.\nRecarregue a página para aplicar.`);
          }
        });
      });
    };

    return { init };
  })();

  // =========================================================
  // Módulo: Remigrar Processo
  // =========================================================
  const ModuleRemigrar = (() => {
    const REMIGRAR_CONFIG = {
      CHECKPOINT_KEY: 'eproc_remigrar_checkpoint',
      SETTINGS_KEY:   'eproc_remigrar_settings',
      RESULTS_KEY:    'eproc_remigrar_results',
      RESULTS_BUFFER_SIZE: 100,
      SUBMIT_DELAY_MS:     300,
      RESULT_TIMEOUT_MS:   120000,
      RATE_LIMIT_DELAY_MS: 30000,
      get REMIGRAR_URL() { return `${window.location.origin}/eproc/controlador.php?acao=remigrar_processo`; }
    };

    function hashString(str) {
      const sample = str.substring(0, 1000);
      let hash = 0;
      for (let i = 0; i < sample.length; i++) {
        const char = sample.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return hash.toString(16);
    }

    function formatTime(ms) {
      if (ms < 60000) return `${Math.round(ms / 1000)}s`;
      if (ms < 3600000) return `${Math.round(ms / 60000)}min`;
      const hours = Math.floor(ms / 3600000);
      const mins = Math.round((ms % 3600000) / 60000);
      return `${hours}h ${mins}min`;
    }

    function formatDateTime(timestamp) {
      return new Date(timestamp).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }

    function downloadFile(content, filename, mimeType = 'text/csv;charset=utf-8') {
      const blob = new Blob(['\uFEFF' + content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    function exportResults(results, instanceId = 1) {
      if (!results || results.length === 0) return 0;
      const headers = 'caso,timestamp,cas_status,cas_msg,zip_status,zip_msg,vid_status,vid_msg,resumo';
      const escape = (s) => `"${(s || '').replace(/"/g, '""')}"`;
      const rows = results.map(e => [
        e.caseNumber, formatDateTime(e.timestamp),
        e.casResult?.type || 'unknown', escape(e.casResult?.message || ''),
        e.zipResult?.type || 'unknown', escape(e.zipResult?.message || ''),
        e.videosResult?.type || 'unknown', escape(e.videosResult?.message || ''),
        e.summary || ''
      ].join(','));
      const csv = headers + '\n' + rows.join('\n');
      const timestamp = new Date().toISOString().slice(0, 10);
      downloadFile(csv, `remigrar_${timestamp}_inst${instanceId}_${results.length}casos.csv`);
      return results.length;
    }

    const Session = {
      getId() { return sessionStorage.getItem('remigrar_instance_id'); },
      setId(id) { sessionStorage.setItem('remigrar_instance_id', id); },
      clear() { sessionStorage.removeItem('remigrar_instance_id'); }
    };

    const Storage = {
      _getKey(baseKey, instanceId = null) {
        const id = instanceId || Session.getId();
        return id ? `${baseKey}_inst_${id}` : baseKey;
      },
      debugKeys() {
        try {
          const keys = GM_listValues();
          console.log('[Remigrar] Storage keys:', keys.length);
          keys.forEach(k => console.log(` - ${k} (${(GM_getValue(k) || '').length} bytes)`));
        } catch (e) {}
      },
      loadCheckpoint(instanceId = null) {
        try {
          const key = this._getKey(REMIGRAR_CONFIG.CHECKPOINT_KEY, instanceId);
          const data = GM_getValue(key, 'null');
          return JSON.parse(data);
        } catch (e) { return null; }
      },
      saveCheckpoint(checkpoint) {
        checkpoint.lastCheckpoint = Date.now();
        const key = this._getKey(REMIGRAR_CONFIG.CHECKPOINT_KEY, checkpoint.instanceId);
        GM_setValue(key, JSON.stringify(checkpoint));
      },
      clearCheckpoint(instanceId = null) {
        GM_deleteValue(this._getKey(REMIGRAR_CONFIG.CHECKPOINT_KEY, instanceId));
      },
      loadSettings() {
        try { return JSON.parse(GM_getValue(REMIGRAR_CONFIG.SETTINGS_KEY, '{}')); } catch (e) { return {}; }
      },
      saveSettings(settings) {
        GM_setValue(REMIGRAR_CONFIG.SETTINGS_KEY, JSON.stringify(settings));
      }
    };

    const ResultType = {
      SUCCESS: 'success', INFO: 'info', ERROR: 'error',
      EMPTY: 'empty', RATE_LIMITED: 'rate_limited', SILENT: 'silent'
    };

    function waitForResult(timeout = 120000) {
      return new Promise((resolve) => {
        const startTime = Date.now();
        const immediate = classifyResponse();
        if (immediate.type !== ResultType.EMPTY) { resolve(immediate); return; }
        const checkInterval = setInterval(() => {
          const result = classifyResponse();
          if (result.type !== ResultType.EMPTY) { clearInterval(checkInterval); resolve(result); return; }
          if (Date.now() - startTime > timeout) {
            clearInterval(checkInterval);
            resolve({ type: ResultType.EMPTY, message: 'Timeout aguardando resposta' });
          }
        }, 200);
      });
    }

    function classifyResponse() {
      const mainContent = document.querySelector('.infraAreaTelaD, #divInfraAreaTelaD, main, .conteudo') || document.body;
      const successCards = mainContent.querySelectorAll('.msg-SUCESSO, .msgSucesso, [class*="sucesso"]:not(.remigrar-hud)');
      for (const card of successCards) {
        if (card.closest('.remigrar-hud')) continue;
        const count = card.querySelectorAll('li, .msg-text, p').length || 1;
        return { type: ResultType.SUCCESS, message: `${count} documento(s) remigrado(s)` };
      }
      const infoCards = mainContent.querySelectorAll('.msg-INFO, .msgInfo');
      for (const card of infoCards) {
        if (card.closest('.remigrar-hud')) continue;
        const count = card.querySelectorAll('li, .msg-text, p').length || 1;
        return { type: ResultType.INFO, message: `${count} documento(s) já OK` };
      }
      const errorDiv = mainContent.querySelector('.infraExcecao, .msg-ERRO, .msgErro');
      if (errorDiv) return { type: ResultType.ERROR, message: errorDiv.textContent.trim().substring(0, 100) };
      const bodyText = mainContent.textContent || '';
      if (bodyText.includes('muitas requisições') || bodyText.includes('too many'))
        return { type: ResultType.RATE_LIMITED, message: 'Rate limited' };
      if (document.getElementById('txtNumProcesso'))
        return { type: ResultType.SILENT, message: 'Página carregada (sem mensagem da operação)' };
      return { type: ResultType.EMPTY, message: 'Aguardando resultado...' };
    }

    function summarizeResults(casResult, zipResult, videosResult) {
      const results = [casResult, zipResult, videosResult];
      if (results.some(r => r?.type === ResultType.RATE_LIMITED)) return 'rate_limited';
      if (results.some(r => r?.type === ResultType.ERROR)) return 'error';
      if (results.some(r => r?.type === ResultType.SUCCESS)) return 'success';
      if (results.filter(r => r?.type !== ResultType.INFO && r?.type !== ResultType.SILENT).length === 0) return 'info';
      return 'empty';
    }

    const FileProcessor = {
      _fileCases: [], _manualCases: [], _fileHash: null, _manualHash: null,
      _fileName: null, activeMode: 'file',
      get allCases() { return this.activeMode === 'manual' ? this._manualCases : this._fileCases; },
      get fileHash() { return this.activeMode === 'manual' ? this._manualHash : this._fileHash; },
      get fileName() { return this.activeMode === 'manual' ? 'Entrada Manual' : this._fileName; },
      parseFile(content) {
        return content.split(/[\n\r]+/).map(l => l.trim().replace(/[^\d.-]/g, '')).filter(l => l.length >= 20);
      },
      loadFile(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const content = e.target.result;
            this._fileCases = this.parseFile(content);
            this._fileHash = hashString(content);
            this._fileName = file.name;
            resolve({ totalCases: this._fileCases.length, fileName: file.name, fileHash: this._fileHash });
          };
          reader.onerror = reject;
          reader.readAsText(file);
        });
      },
      loadText(text) {
        this._manualCases = this.parseFile(text);
        this._manualHash = hashString(text);
        return { totalCases: this._manualCases.length, fileName: 'Entrada Manual', fileHash: this._manualHash };
      },
      getSlice(instanceId, totalInstances) {
        const total = this.allCases.length;
        const sliceSize = Math.ceil(total / totalInstances);
        const start = (instanceId - 1) * sliceSize;
        const end = Math.min(start + sliceSize, total);
        return { start, end, count: end - start };
      },
      getCase(absoluteIndex) { return this.allCases[absoluteIndex] || null; }
    };

    const ResultsBuffer = {
      buffer: [], chunkNumber: 1, totalExported: 0, instanceId: 1,
      _load(instanceId = null) {
        try {
          const key = Storage._getKey(REMIGRAR_CONFIG.RESULTS_KEY, instanceId);
          const parsed = JSON.parse(GM_getValue(key, 'null'));
          if (parsed) {
            this.buffer = parsed.buffer || [];
            this.chunkNumber = parsed.chunkNumber || 1;
            this.totalExported = parsed.totalExported || 0;
            this.instanceId = parsed.instanceId || 1;
          }
        } catch (e) {}
      },
      _save() {
        const key = Storage._getKey(REMIGRAR_CONFIG.RESULTS_KEY, this.instanceId);
        GM_setValue(key, JSON.stringify({ buffer: this.buffer, chunkNumber: this.chunkNumber, totalExported: this.totalExported, instanceId: this.instanceId }));
      },
      init(instanceId, startChunk = 1, forceReset = false) {
        this.instanceId = instanceId;
        if (forceReset) { this.chunkNumber = startChunk; this.buffer = []; this.totalExported = 0; this._save(); }
        else { this._load(instanceId); if (startChunk > this.chunkNumber) this.chunkNumber = startChunk; }
      },
      add(entry) {
        this.buffer.push(entry); this._save();
        if (this.buffer.length >= REMIGRAR_CONFIG.RESULTS_BUFFER_SIZE) this.flush();
      },
      flush() {
        if (!this.buffer.length) return 0;
        const escape = (s) => `"${(s || '').replace(/"/g, '""')}"`;
        const headers = 'caso,timestamp,cas_status,cas_msg,zip_status,zip_msg,vid_status,vid_msg,resumo';
        const rows = this.buffer.map(e => [
          e.caseNumber, formatDateTime(e.timestamp),
          e.casResult.type, escape(e.casResult.message),
          e.zipResult.type, escape(e.zipResult.message),
          e.videosResult.type, escape(e.videosResult.message),
          e.summary
        ].join(','));
        downloadFile(headers + '\n' + rows.join('\n'), `remigrar_results_inst${this.instanceId}_chunk${String(this.chunkNumber).padStart(3, '0')}.csv`);
        const exportedCount = this.buffer.length;
        this.totalExported += exportedCount; this.chunkNumber++; this.buffer = []; this._save();
        return exportedCount;
      },
      clear() {
        this.buffer = []; this.chunkNumber = 1; this.totalExported = 0;
        GM_deleteValue(Storage._getKey(REMIGRAR_CONFIG.RESULTS_KEY, this.instanceId));
      },
      getStats() { return { buffered: this.buffer.length, exported: this.totalExported, chunks: this.chunkNumber - 1 }; }
    };

    const Automation = {
      isRunning: false, isPaused: false, currentCheckpoint: null,
      onProgressUpdate: null, onStatusUpdate: null, retryCount: 0,

      async start(instanceId, totalInstances) {
        Session.setId(instanceId);
        const slice = FileProcessor.getSlice(instanceId, totalInstances);
        const caseQueue = [];
        for (let i = slice.start; i < slice.end; i++) caseQueue.push(FileProcessor.getCase(i));
        this.currentCheckpoint = {
          inputFileName: FileProcessor.fileName, inputFileHash: FileProcessor.fileHash,
          instanceId, totalInstances, sliceStart: slice.start, sliceEnd: slice.end,
          currentIndex: slice.start, currentStep: 'cas', chunkNumber: 1,
          startedAt: Date.now(), processedCount: 0, results: {}, caseQueue, isActive: true
        };
        Storage.saveCheckpoint(this.currentCheckpoint);
        this.isRunning = true; this.isPaused = false; this.processNext();
      },

      resume(checkpoint) {
        if (checkpoint.instanceId) Session.setId(checkpoint.instanceId);
        this.currentCheckpoint = checkpoint; this.isRunning = true; this.isPaused = false;
      },

      pause() {
        this.isPaused = true;
        if (this.currentCheckpoint) this.currentCheckpoint.isActive = false;
        Storage.saveCheckpoint(this.currentCheckpoint);
        this.updateStatus('⏸️ Pausado');
      },

      unpause() { this.isPaused = false; this.processNext(); },

      stop() {
        this.isRunning = false; this.isPaused = false;
        const cp = this.currentCheckpoint || Storage.loadCheckpoint();
        if (cp?.completedResults?.length > 0) {
          exportResults(cp.completedResults, cp.instanceId);
          this.updateStatus(`⏹️ Parado. ${cp.completedResults.length} casos exportados.`);
        } else { this.updateStatus('⏹️ Parado'); }
        Storage.clearCheckpoint(); Session.clear();
      },

      updateStatus(message) { if (this.onStatusUpdate) this.onStatusUpdate(message); },

      updateProgress() {
        if (!this.onProgressUpdate) return;
        const cp = this.currentCheckpoint;
        const total = cp.sliceEnd - cp.sliceStart;
        const current = cp.currentIndex - cp.sliceStart;
        const progress = current / total;
        const elapsed = Date.now() - cp.startedAt;
        const eta = progress > 0 ? (elapsed / progress) - elapsed : 0;
        const queueIndex = cp.currentIndex - cp.sliceStart;
        const caseNumber = cp.currentCaseNumber || (cp.caseQueue && cp.caseQueue[queueIndex]) || `#${cp.currentIndex}`;
        this.onProgressUpdate({
          current, total, percent: Math.round(progress * 100),
          currentCase: caseNumber, step: cp.currentStep.toUpperCase(),
          eta: formatTime(eta), completed: (cp.completedResults || []).length
        });
        Storage.saveCheckpoint(cp);
      },

      async processNext() {
        if (!this.isRunning || this.isPaused) return;
        const cp = this.currentCheckpoint;
        if (cp.currentIndex >= cp.sliceEnd) {
          const results = cp.completedResults || [];
          if (results.length > 0) exportResults(results, cp.instanceId);
          Storage.clearCheckpoint(); Session.clear();
          this.isRunning = false;
          this.updateStatus(`✅ Concluído! ${results.length} casos processados e exportados.`);
          alert(`Processamento concluído!\n${results.length} casos exportados para CSV.`);
          return;
        }
        const queueIndex = cp.currentIndex - cp.sliceStart;
        let caseNumber;
        if (cp.currentStep !== 'cas' && cp.currentCaseNumber) caseNumber = cp.currentCaseNumber;
        else if (cp.caseQueue && cp.caseQueue[queueIndex]) caseNumber = cp.caseQueue[queueIndex];
        else caseNumber = FileProcessor.getCase(cp.currentIndex);
        if (!caseNumber) { this.updateStatus('⚠️ Erro: fila de casos não disponível'); this.isRunning = false; return; }

        let module;
        if (cp.currentStep === 'cas') module = 'documentos_cas';
        else if (cp.currentStep === 'zip') module = 'documentos_zip';
        else module = 'videos';

        const input = document.getElementById('txtNumProcesso');
        const select = document.getElementById('selModulo');
        const button = document.querySelector('button[type="submit"].infraButton');
        if (!input || !select || !button) {
          cp.currentCaseNumber = caseNumber; cp.isActive = true;
          Storage.saveCheckpoint(cp); window.location.href = REMIGRAR_CONFIG.REMIGRAR_URL; return;
        }
        input.value = caseNumber; select.value = module;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        this.updateProgress();
        this.updateStatus(`🔄 ${caseNumber} (${cp.currentStep.toUpperCase()})`);
        cp.currentCaseNumber = caseNumber; cp.awaitingResult = true;
        Storage.saveCheckpoint(cp);
        setTimeout(() => {
          const watchdogId = setTimeout(() => {
            const currentCp = Storage.loadCheckpoint();
            if (currentCp?.awaitingResult) {
              currentCp.awaitingResult = false; Storage.saveCheckpoint(currentCp);
              window.location.href = REMIGRAR_CONFIG.REMIGRAR_URL;
            }
          }, 10000);
          try { button.click(); } catch (e) {}
        }, REMIGRAR_CONFIG.SUBMIT_DELAY_MS);
      },

      async handleResult() {
        try {
          const cp = Storage.loadCheckpoint();
          if (!cp?.awaitingResult) return false;
          const caseNumber = cp.currentCaseNumber;
          this.updateStatus?.(`⏳ ${caseNumber} (${cp.currentStep.toUpperCase()})`);
          const result = await waitForResult(REMIGRAR_CONFIG.RESULT_TIMEOUT_MS);
          if (result.type === ResultType.RATE_LIMITED) {
            this.updateStatus?.(`⚠️ Rate limited - aguardando ${REMIGRAR_CONFIG.RATE_LIMIT_DELAY_MS / 1000}s`);
            setTimeout(() => { cp.awaitingResult = false; Storage.saveCheckpoint(cp); this.currentCheckpoint = cp; this.processNext(); }, REMIGRAR_CONFIG.RATE_LIMIT_DELAY_MS);
            return true;
          }
          if (!cp.results) cp.results = {};
          if (cp.currentStep === 'cas') { cp.results.casResult = result; cp.currentStep = 'zip'; }
          else if (cp.currentStep === 'zip') { cp.results.zipResult = result; cp.currentStep = 'videos'; }
          else {
            cp.results.videosResult = result;
            const entry = {
              caseNumber, timestamp: Date.now(),
              casResult: cp.results.casResult, zipResult: cp.results.zipResult, videosResult: result,
              summary: summarizeResults(cp.results.casResult, cp.results.zipResult, result)
            };
            if (!cp.completedResults) cp.completedResults = [];
            cp.completedResults.push(entry);
            cp.currentIndex++; cp.currentStep = 'cas'; cp.results = {};
          }
          cp.awaitingResult = false; Storage.saveCheckpoint(cp); this.currentCheckpoint = cp;
          if (!this.isRunning) this.isRunning = true;
          this.processNext();
          return true;
        } catch (error) {
          console.error('[Remigrar] Error in handleResult:', error);
          this.updateStatus('❌ Erro no processamento (ver console)');
          return false;
        }
      },

      getProgress() {
        const cp = this.currentCheckpoint || Storage.loadCheckpoint();
        if (!cp) return null;
        return { current: cp.currentIndex - cp.sliceStart, total: cp.sliceEnd - cp.sliceStart, percent: Math.round(((cp.currentIndex - cp.sliceStart) / (cp.sliceEnd - cp.sliceStart)) * 100), instanceId: cp.instanceId, isRunning: this.isRunning, isPaused: this.isPaused, completed: (cp.completedResults || []).length };
      }
    };

    function createHUD() {
      const hud = document.createElement('div');
      hud.className = 'remigrar-hud';
      hud.id = 'remigrar-hud';
      hud.innerHTML = `
        <style>
          #remigrar-hud { position:fixed; bottom:20px; right:20px; width:420px; background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%); border:1px solid #4a5568; border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,0.4); font-family:'Segoe UI',Tahoma,sans-serif; font-size:13px; color:#e2e8f0; z-index:99999; overflow:hidden; }
          #remigrar-hud-header { background:linear-gradient(90deg,#667eea 0%,#764ba2 100%); padding:12px 15px; font-weight:600; font-size:14px; display:flex; justify-content:space-between; align-items:center; cursor:move; }
          #remigrar-hud-toggle { background:rgba(255,255,255,0.2); border:none; color:white; width:24px; height:24px; border-radius:4px; cursor:pointer; font-size:14px; }
          #remigrar-hud-body { padding:15px; }
          #remigrar-hud-body.collapsed { display:none; }
          .remigrar-section { margin-bottom:15px; padding-bottom:15px; border-bottom:1px solid #4a5568; }
          .remigrar-section:last-child { margin-bottom:0; padding-bottom:0; border-bottom:none; }
          .remigrar-section-title { font-weight:600; margin-bottom:10px; color:#a0aec0; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; }
          .remigrar-file-info { background:#2d3748; padding:10px; border-radius:6px; margin-bottom:10px; }
          .remigrar-file-info.empty { text-align:center; color:#718096; }
          #remigrar-file-input { display:none; }
          .remigrar-file-btn { display:block; width:100%; padding:12px; background:linear-gradient(90deg,#4299e1 0%,#3182ce 100%); border:none; border-radius:6px; color:white; font-weight:600; cursor:pointer; text-align:center; box-sizing:border-box; }
          .remigrar-file-btn:hover { transform:translateY(-1px); box-shadow:0 4px 12px rgba(66,153,225,0.4); }
          .remigrar-instance-row { display:flex; gap:10px; margin-bottom:10px; }
          .remigrar-instance-group { flex:1; }
          .remigrar-instance-group label { display:block; font-size:11px; color:#a0aec0; margin-bottom:4px; }
          .remigrar-instance-group input { width:100%; padding:8px; background:#2d3748; border:1px solid #4a5568; border-radius:4px; color:#e2e8f0; font-size:14px; text-align:center; box-sizing:border-box; }
          .remigrar-slice-info { background:#2d3748; padding:8px 10px; border-radius:4px; font-size:12px; text-align:center; }
          #remigrar-controls { display:flex; gap:8px; }
          .remigrar-btn { flex:1; padding:10px; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:13px; transition:all 0.2s; }
          .remigrar-btn:disabled { opacity:0.5; cursor:not-allowed; }
          .remigrar-btn-start { background:linear-gradient(90deg,#48bb78,#38a169); color:white; }
          .remigrar-btn-pause { background:linear-gradient(90deg,#ed8936,#dd6b20); color:white; }
          .remigrar-btn-stop { background:linear-gradient(90deg,#f56565,#e53e3e); color:white; }
          .remigrar-btn-export { background:#4a5568; color:white; }
          #remigrar-status { margin-top:10px; padding:10px; background:#2d3748; border-radius:6px; font-size:12px; }
          #remigrar-progress-bar-wrap { margin-top:8px; background:#4a5568; border-radius:999px; height:6px; overflow:hidden; }
          #remigrar-progress-bar { height:100%; background:linear-gradient(90deg,#48bb78,#38a169); border-radius:999px; transition:width .4s ease; }
          #remigrar-log { margin-top:10px; max-height:150px; overflow-y:auto; background:#0d1117; border-radius:6px; padding:8px; font-size:11px; }
          .remigrar-log-entry { padding:4px 6px; margin-bottom:4px; border-radius:4px; border-left:3px solid; }
          .remigrar-log-entry.success { background:rgba(72,187,120,0.15); border-color:#48bb78; }
          .remigrar-log-entry.info    { background:rgba(66,153,225,0.15); border-color:#4299e1; }
          .remigrar-log-entry.error   { background:rgba(245,101,101,0.15); border-color:#f56565; }
          .remigrar-log-entry.rate_limited { background:rgba(237,137,54,0.15); border-color:#ed8936; }
          #remigrar-resume-banner { background:#2d3748; border:1px solid #ed8936; border-radius:6px; padding:10px; margin-bottom:10px; font-size:12px; display:none; }
          .remigrar-manual-input { width:100%; min-height:80px; background:#2d3748; border:1px solid #4a5568; border-radius:6px; color:#e2e8f0; padding:8px; font-family:Consolas,monospace; font-size:12px; resize:vertical; box-sizing:border-box; margin-top:6px; }
          .remigrar-tab-row { display:flex; gap:4px; margin-bottom:8px; }
          .remigrar-tab { flex:1; padding:6px; border:1px solid #4a5568; border-radius:6px; background:transparent; color:#a0aec0; cursor:pointer; font-size:12px; text-align:center; }
          .remigrar-tab.active { background:#4a5568; color:#e2e8f0; }
        </style>
        <div id="remigrar-hud-header">
          <span>🔄 Remigrar Processo</span>
          <button id="remigrar-hud-toggle">−</button>
        </div>
        <div id="remigrar-hud-body">
          <div id="remigrar-resume-banner">
            ⚠️ Sessão anterior detectada. <button id="remigrar-resume-btn" class="remigrar-btn remigrar-btn-start" style="flex:none;padding:4px 10px;font-size:12px;margin-top:6px;display:block;">Retomar</button>
            <button id="remigrar-discard-btn" style="background:none;border:none;color:#f56565;cursor:pointer;font-size:12px;margin-top:4px;display:block;">Descartar e começar do zero</button>
          </div>
          <div class="remigrar-section">
            <div class="remigrar-section-title">Entrada</div>
            <div class="remigrar-tab-row">
              <button class="remigrar-tab active" data-tab="file">📁 Arquivo</button>
              <button class="remigrar-tab" data-tab="manual">✏️ Manual</button>
            </div>
            <div id="remigrar-tab-file">
              <div id="remigrar-file-info" class="remigrar-file-info empty">Nenhum arquivo carregado</div>
              <input type="file" id="remigrar-file-input" accept=".txt,.csv">
              <button class="remigrar-file-btn" id="remigrar-file-btn">📂 Carregar arquivo</button>
            </div>
            <div id="remigrar-tab-manual" style="display:none;">
              <textarea class="remigrar-manual-input" id="remigrar-manual-input" placeholder="Cole os números de processo aqui, um por linha..."></textarea>
              <button class="remigrar-file-btn" id="remigrar-manual-btn" style="margin-top:6px;">✓ Usar esta lista</button>
            </div>
          </div>
          <div class="remigrar-section">
            <div class="remigrar-section-title">Instâncias</div>
            <div class="remigrar-instance-row">
              <div class="remigrar-instance-group">
                <label>Esta instância</label>
                <input type="number" id="remigrar-instance-id" value="1" min="1">
              </div>
              <div class="remigrar-instance-group">
                <label>Total de instâncias</label>
                <input type="number" id="remigrar-total-instances" value="1" min="1">
              </div>
            </div>
            <div id="remigrar-slice-info" class="remigrar-slice-info">Carregue um arquivo para ver a fatia</div>
          </div>
          <div class="remigrar-section">
            <div id="remigrar-controls">
              <button class="remigrar-btn remigrar-btn-start" id="remigrar-start">▶ Iniciar</button>
              <button class="remigrar-btn remigrar-btn-pause" id="remigrar-pause" disabled>⏸ Pausar</button>
              <button class="remigrar-btn remigrar-btn-stop" id="remigrar-stop" disabled>⏹ Parar</button>
            </div>
            <button class="remigrar-btn remigrar-btn-export" id="remigrar-export" style="width:100%;margin-top:6px;" disabled>📥 Exportar agora</button>
          </div>
          <div id="remigrar-status">Aguardando...</div>
          <div id="remigrar-progress-bar-wrap" style="display:none;">
            <div id="remigrar-progress-bar" style="width:0%"></div>
          </div>
          <div id="remigrar-log"></div>
        </div>
      `;
      document.body.appendChild(hud);

      const toggle = hud.querySelector('#remigrar-hud-toggle');
      const body = hud.querySelector('#remigrar-hud-body');
      toggle.addEventListener('click', () => {
        body.classList.toggle('collapsed');
        toggle.textContent = body.classList.contains('collapsed') ? '+' : '−';
      });

      // Draggable
      let isDragging = false, offsetX, offsetY;
      hud.querySelector('#remigrar-hud-header').addEventListener('mousedown', (e) => {
        if (e.target === toggle) return;
        isDragging = true; offsetX = e.clientX - hud.offsetLeft; offsetY = e.clientY - hud.offsetTop;
      });
      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        hud.style.left = (e.clientX - offsetX) + 'px'; hud.style.top = (e.clientY - offsetY) + 'px';
        hud.style.right = 'auto'; hud.style.bottom = 'auto';
      });
      document.addEventListener('mouseup', () => { isDragging = false; });

      // Tabs
      hud.querySelectorAll('.remigrar-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          hud.querySelectorAll('.remigrar-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          hud.querySelector('#remigrar-tab-file').style.display = tab.dataset.tab === 'file' ? '' : 'none';
          hud.querySelector('#remigrar-tab-manual').style.display = tab.dataset.tab === 'manual' ? '' : 'none';
          FileProcessor.activeMode = tab.dataset.tab;
        });
      });

      const fileInfo = hud.querySelector('#remigrar-file-info');
      const sliceInfo = hud.querySelector('#remigrar-slice-info');

      const updateSliceInfo = () => {
        const instanceId = parseInt(hud.querySelector('#remigrar-instance-id').value) || 1;
        const totalInstances = parseInt(hud.querySelector('#remigrar-total-instances').value) || 1;
        if (!FileProcessor.allCases.length) { sliceInfo.textContent = 'Carregue um arquivo para ver a fatia'; return; }
        const slice = FileProcessor.getSlice(instanceId, totalInstances);
        sliceInfo.textContent = `Esta instância processará ${slice.count} caso(s) (índice ${slice.start} → ${slice.end - 1})`;
      };

      hud.querySelector('#remigrar-file-btn').addEventListener('click', () => hud.querySelector('#remigrar-file-input').click());
      hud.querySelector('#remigrar-file-input').addEventListener('change', async (e) => {
        const file = e.target.files[0]; if (!file) return;
        fileInfo.className = 'remigrar-file-info'; fileInfo.textContent = 'Carregando...';
        const result = await FileProcessor.loadFile(file);
        fileInfo.textContent = `📄 ${result.fileName} — ${result.totalCases} caso(s)`;
        updateSliceInfo();
      });

      hud.querySelector('#remigrar-manual-btn').addEventListener('click', () => {
        const text = hud.querySelector('#remigrar-manual-input').value;
        const result = FileProcessor.loadText(text);
        fileInfo.textContent = `✏️ Entrada manual — ${result.totalCases} caso(s)`;
        updateSliceInfo();
      });

      hud.querySelector('#remigrar-instance-id').addEventListener('input', updateSliceInfo);
      hud.querySelector('#remigrar-total-instances').addEventListener('input', updateSliceInfo);

      const setRunningState = (running) => {
        hud.querySelector('#remigrar-start').disabled = running;
        hud.querySelector('#remigrar-pause').disabled = !running;
        hud.querySelector('#remigrar-stop').disabled = !running;
        hud.querySelector('#remigrar-export').disabled = !running;
        hud.querySelector('#remigrar-progress-bar-wrap').style.display = running ? '' : 'none';
      };

      const updateStatus = (msg) => { hud.querySelector('#remigrar-status').textContent = msg; };
      const addLog = (entry) => {
        const log = hud.querySelector('#remigrar-log');
        const div = document.createElement('div');
        div.className = `remigrar-log-entry ${entry.summary || ''}`;
        div.textContent = `${entry.caseNumber} → ${entry.summary}`;
        log.prepend(div);
        if (log.children.length > 50) log.lastChild.remove();
      };

      Automation.onStatusUpdate = updateStatus;
      Automation.onProgressUpdate = (data) => {
        updateStatus(`⏳ ${data.current}/${data.total} (${data.percent}%) — ${data.currentCase} [${data.step}] — ETA: ${data.eta}`);
        hud.querySelector('#remigrar-progress-bar').style.width = `${data.percent}%`;
      };

      hud.querySelector('#remigrar-start').addEventListener('click', async () => {
        const instanceId = parseInt(hud.querySelector('#remigrar-instance-id').value) || 1;
        const totalInstances = parseInt(hud.querySelector('#remigrar-total-instances').value) || 1;
        if (!FileProcessor.allCases.length) { updateStatus('⚠️ Nenhum caso carregado.'); return; }
        setRunningState(true);
        await Automation.start(instanceId, totalInstances);
      });

      hud.querySelector('#remigrar-pause').addEventListener('click', () => {
        if (Automation.isPaused) { Automation.unpause(); hud.querySelector('#remigrar-pause').textContent = '⏸ Pausar'; }
        else { Automation.pause(); hud.querySelector('#remigrar-pause').textContent = '▶ Retomar'; }
      });

      hud.querySelector('#remigrar-stop').addEventListener('click', () => {
        Automation.stop(); setRunningState(false);
      });

      hud.querySelector('#remigrar-export').addEventListener('click', () => {
        const cp = Automation.currentCheckpoint || Storage.loadCheckpoint();
        if (cp?.completedResults?.length) exportResults(cp.completedResults, cp.instanceId);
        else updateStatus('⚠️ Nenhum resultado para exportar ainda.');
      });

      return { setRunningState, updateStatus, addLog };
    }

    const init = () => {
      Storage.debugKeys();
      let checkpoint = Storage.loadCheckpoint();

      const isResultPage = window.location.search.includes('remigrar_processo_modulo');
      if (isResultPage && !checkpoint) {
        const keys = GM_listValues();
        for (const key of keys) {
          if (key.startsWith(REMIGRAR_CONFIG.CHECKPOINT_KEY + '_inst_')) {
            const possibleCp = JSON.parse(GM_getValue(key));
            if (possibleCp?.awaitingResult) {
              Session.setId(possibleCp.instanceId);
              checkpoint = possibleCp;
              break;
            }
          }
        }
      }

      const activeSession = Session.getId();
      const shouldShowHUD = onRemigrarPage() || (checkpoint && (checkpoint.awaitingResult || checkpoint.isActive)) || !!activeSession;

      if (!shouldShowHUD) return;

      const hudControls = createHUD();

      if (checkpoint) {
        const forceResultProcessing = isResultPage && checkpoint.isActive;
        if (checkpoint.awaitingResult || forceResultProcessing) {
          hudControls.setRunningState(true);
          Automation.isRunning = true;
          if (forceResultProcessing && !checkpoint.awaitingResult) {
            checkpoint.awaitingResult = true; Storage.saveCheckpoint(checkpoint);
          }
          hudControls.updateStatus(`🔄 Processando resultado: ${checkpoint.currentCaseNumber} (${checkpoint.currentStep?.toUpperCase()})`);
          setTimeout(() => { Automation.handleResult(); }, 500);
        } else if (checkpoint.isActive && !checkpoint.awaitingResult) {
          hudControls.setRunningState(true);
          Automation.isRunning = true;
          Automation.currentCheckpoint = checkpoint;
          setTimeout(() => { Automation.processNext(); }, 300);
        }
      }
    };

    return { init };
  })();

  // =========================================================
  // Módulo: Inconsistências
  // =========================================================
  const ModuleInconsistencias = (() => {
    const INCONS_CONFIG = {
      STORAGE_KEY: 'eproc_inconsistencias_log',
      QUEUE_KEY:   'eproc_inconsistencias_queue',
      LOG_RETENTION_DAYS: 7,
      ACTION_DELAY_MS: 1500,
      get INCONSISTENCIAS_URL() { return `${window.location.origin}/eproc/controlador.php?acao=ProcessoInconsistente/consultar`; }
    };

    const DUPLICATE_TYPES = ['Justiça Gratuita', 'Litisconsórcio Passivo'];

    const Storage = {
      loadLog() {
        try { return JSON.parse(GM_getValue(INCONS_CONFIG.STORAGE_KEY, '[]')); } catch (e) { return []; }
      },
      saveLog(entries) { GM_setValue(INCONS_CONFIG.STORAGE_KEY, JSON.stringify(entries)); },
      addEntry(entry) {
        const entries = this.loadLog(); entries.unshift(entry); this.saveLog(entries); return entries;
      },
      cleanup() {
        const entries = this.loadLog();
        const cutoff = Date.now() - (INCONS_CONFIG.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        const filtered = entries.filter(e => e.timestamp > cutoff);
        if (filtered.length !== entries.length) this.saveLog(filtered);
        return filtered;
      },
      clearLog() { this.saveLog([]); },
      loadQueue() {
        try { return JSON.parse(GM_getValue(INCONS_CONFIG.QUEUE_KEY, 'null')); } catch (e) { return null; }
      },
      saveQueue(queue) { GM_setValue(INCONS_CONFIG.QUEUE_KEY, JSON.stringify(queue)); },
      clearQueue() { GM_setValue(INCONS_CONFIG.QUEUE_KEY, 'null'); }
    };

    const ResultType = { FIXED: 'success', OK: 'info', ERROR: 'error', PENDING: 'pending' };

    function clickVoltar() {
      const btn = document.querySelector('button.btn-secondary');
      if (btn && btn.textContent.includes('Voltar')) btn.click();
      else window.location.reload();
    }

    function analyzeDuplicates() {
      const results = { hasDuplicates: false, duplicateCards: [], allGreen: true };
      document.querySelectorAll('.card-header').forEach(header => {
        if (header.textContent.trim() !== 'Informações Adicionais Duplicadas') return;
        if (header.classList.contains('bg-danger')) {
          results.allGreen = false;
          const cardBody = header.nextElementSibling;
          if (!cardBody) return;
          const table = cardBody.querySelector('table');
          if (!table) return;
          const dataRows = Array.from(table.querySelectorAll('tbody tr')).filter(r => !r.querySelector('.dataTables_empty'));
          if (dataRows.length > 1) {
            results.hasDuplicates = true;
            results.duplicateCards.push({ header, table, rows: dataRows });
          }
        }
      });
      return results;
    }

    function findRowToRemove(rows) {
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 5) continue;
        const descricao = cells[0].textContent.trim();
        const valor = cells[1].textContent.trim();
        if (!DUPLICATE_TYPES.includes(descricao)) continue;
        if (valor === 'Requerida') {
          const link = row.querySelector('a.btnDesativar');
          if (link) return { row, link, descricao, valor, usuario: cells[4].textContent.trim() };
        }
      }
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 5) continue;
        const descricao = cells[0].textContent.trim();
        const usuario = cells[4].textContent.trim();
        if (!DUPLICATE_TYPES.includes(descricao)) continue;
        if (!usuario.includes('SISTEMA DE PROCESSO ELETRÔNICO')) {
          const link = row.querySelector('a.btnDesativar');
          if (link) return { row, link, descricao, valor: cells[1].textContent.trim(), usuario };
        }
      }
      for (const row of rows) {
        const link = row.querySelector('a.btnDesativar');
        if (link) {
          const cells = row.querySelectorAll('td');
          return { row, link, descricao: cells[0]?.textContent.trim() || '', valor: cells[1]?.textContent.trim() || '', usuario: cells[4]?.textContent.trim() || '' };
        }
      }
      return null;
    }

    const Automation = {
      parseInput(text) {
        return text.split(/\n/).map(l => l.trim()).filter(l => l.length === 20)
          .map(d => `${d.slice(0,7)}-${d.slice(7,9)}.${d.slice(9,13)}.${d.slice(13,14)}.${d.slice(14,16)}.${d.slice(16,20)}`);
      },
      startBatch(caseNumbers) {
        const queue = { cases: caseNumbers, currentIndex: 0, currentStep: 'consultar', results: {}, removedCount: 0, startedAt: Date.now() };
        Storage.saveQueue(queue); this.executeNext(queue);
      },
      stop() { Storage.clearQueue(); },
      resumeIfNeeded() {
        const queue = Storage.loadQueue();
        if (!queue || !onInconsistenciasPage()) return false;
        const currentCase = queue.cases[queue.currentIndex];
        if (queue.currentStep === 'consultar') this.doConsultar(queue, currentCase);
        else this.checkAndFix(queue, currentCase);
        return true;
      },
      doConsultar(queue, caseNumber) {
        const input = document.getElementById('NumProcesso');
        if (!input) { window.location.reload(); return; }
        input.value = caseNumber;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        queue.currentStep = 'fixing'; Storage.saveQueue(queue);
        setTimeout(() => {
          const button = document.querySelector('button.btn-primary');
          if (button && button.textContent.includes('Consultar')) {
            if (window.eprocInconsUpdateStatus) window.eprocInconsUpdateStatus('🖱️ Consultando...');
            button.click();
            setTimeout(() => { this.checkAndFix(queue, caseNumber); }, 1000);
          } else { window.location.reload(); }
        }, INCONS_CONFIG.ACTION_DELAY_MS);
      },
      waitForTableLoad(callback, attempt = 0) {
        if (window.eprocInconsUpdateStatus && attempt % 5 === 0) window.eprocInconsUpdateStatus(`⏳ Aguardando tabela... (${attempt})`);
        const processing = document.querySelector('.dataTables_processing');
        const isProcessing = processing && processing.style.display !== 'none';
        const headers = document.querySelectorAll('.card-header');
        const rows = document.querySelectorAll('table tbody tr');
        const isEmpty = rows.length === 1 && rows[0].querySelector('.dataTables_empty');
        const isReady = headers.length > 0 && !isProcessing && (rows.length > 0 || isEmpty);
        if (isReady) { setTimeout(callback, 200); return; }
        if (attempt > 40) { callback(); return; }
        setTimeout(() => { this.waitForTableLoad(callback, attempt + 1); }, 500);
      },
      checkAndFix(queue, caseNumber) {
        this.waitForTableLoad(() => {
          const analysis = analyzeDuplicates();
          if (!queue.results[caseNumber]) queue.results[caseNumber] = { removed: 0, status: ResultType.PENDING };
          const result = queue.results[caseNumber];
          if (window.eprocInconsUpdateStatus) window.eprocInconsUpdateStatus(`🔍 Analisando: ${result.removed} removidos...`);
          if (analysis.hasDuplicates) {
            for (const card of analysis.duplicateCards) {
              const toRemove = findRowToRemove(card.rows);
              if (toRemove) {
                result.removed++; queue.removedCount++;
                if (window.eprocInconsUpdateStatus) window.eprocInconsUpdateStatus(`🗑️ Removendo: ${toRemove.descricao}...`);
                toRemove.link.click();
                setTimeout(() => { this.checkAndFix(queue, caseNumber); }, 1000);
                return;
              }
            }
            result.status = result.removed > 0 ? ResultType.FIXED : ResultType.ERROR;
            result.message = result.removed > 0 ? `${result.removed} duplicata(s) removida(s) (restam sem link)` : 'Duplicatas encontradas, mas sem botão desativar';
            this.finalizeCase(queue, caseNumber, result); return;
          }
          if (result.removed > 0) { result.status = ResultType.FIXED; result.message = `${result.removed} duplicata(s) removida(s)`; }
          else if (!analysis.allGreen) { result.status = ResultType.ERROR; result.message = 'Banner vermelho, não foi possível corrigir automaticamente'; }
          else { result.status = ResultType.OK; result.message = 'Sem duplicatas'; }
          this.finalizeCase(queue, caseNumber, result);
        });
      },
      finalizeCase(queue, caseNumber, result) {
        if (window.eprocInconsUpdateStatus) window.eprocInconsUpdateStatus(`✅ Finalizado: ${result.status}`);
        Storage.addEntry({ caseNumber, timestamp: Date.now(), status: result.status, message: result.message, removed: result.removed || 0 });
        queue.currentIndex++; queue.currentStep = 'consultar'; Storage.saveQueue(queue);
        if (queue.currentIndex >= queue.cases.length) {
          Storage.clearQueue();
          if (window.eprocInconsUpdateStatus) window.eprocInconsUpdateStatus(`🎉 Lote finalizado! ${queue.cases.length} processado(s).`);
          if (window.eprocInconsRefreshHUD) window.eprocInconsRefreshHUD();
          clickVoltar(); return;
        }
        clickVoltar();
      },
      executeNext(queue) {
        if (window.eprocInconsRefreshHUD) window.eprocInconsRefreshHUD();
        if (queue.currentStep === 'consultar') this.doConsultar(queue, queue.cases[queue.currentIndex]);
        else this.checkAndFix(queue, queue.cases[queue.currentIndex]);
      },
      getProgress() {
        const queue = Storage.loadQueue();
        if (!queue) return null;
        return { current: queue.currentIndex + 1, total: queue.cases.length, currentCase: queue.cases[queue.currentIndex], step: queue.currentStep, removed: queue.removedCount };
      }
    };

    function createHUD() {
      const hud = document.createElement('div');
      hud.id = 'inconsistencias-hud';
      hud.innerHTML = `
        <style>
          #inconsistencias-hud { position:fixed; bottom:20px; right:20px; width:380px; background:linear-gradient(135deg,#1a1a2e,#16213e); border:1px solid #4a5568; border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,.4); font-family:'Segoe UI',Tahoma,sans-serif; font-size:13px; color:#e2e8f0; z-index:99999; overflow:hidden; }
          #inconsistencias-hud-header { background:linear-gradient(90deg,#f093fb,#f5576c); padding:12px 15px; font-weight:600; font-size:14px; display:flex; justify-content:space-between; align-items:center; cursor:move; }
          #inconsistencias-hud-toggle { background:rgba(255,255,255,.2); border:none; color:white; width:24px; height:24px; border-radius:4px; cursor:pointer; font-size:14px; }
          #inconsistencias-hud-body { padding:15px; }
          #inconsistencias-hud-body.collapsed { display:none; }
          #inconsistencias-input { width:100%; height:80px; background:#2d3748; border:1px solid #4a5568; border-radius:6px; color:#e2e8f0; padding:10px; font-family:Consolas,monospace; font-size:12px; resize:vertical; box-sizing:border-box; }
          #inconsistencias-controls { display:flex; gap:8px; margin-top:10px; }
          .incons-btn { flex:1; padding:10px; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:13px; }
          .incons-btn:disabled { opacity:0.5; cursor:not-allowed; }
          .incons-btn-primary { background:linear-gradient(90deg,#48bb78,#38a169); color:white; }
          .incons-btn-danger { background:linear-gradient(90deg,#f56565,#e53e3e); color:white; }
          .incons-btn-secondary { background:#4a5568; color:white; }
          #inconsistencias-status { margin-top:12px; padding:10px; background:#2d3748; border-radius:6px; text-align:center; font-size:12px; }
          #inconsistencias-log { margin-top:12px; max-height:200px; overflow-y:auto; background:#0d1117; border-radius:6px; padding:8px; }
          .incons-log-entry { padding:8px 10px; margin-bottom:6px; border-radius:4px; font-size:11px; border-left:3px solid; }
          .incons-log-entry.success { background:rgba(72,187,120,.15); border-color:#48bb78; }
          .incons-log-entry.info    { background:rgba(66,153,225,.15); border-color:#4299e1; }
          .incons-log-entry.error   { background:rgba(245,101,101,.15); border-color:#f56565; }
          #inconsistencias-footer { display:flex; gap:8px; margin-top:12px; padding-top:12px; border-top:1px solid #4a5568; }
          #inconsistencias-count { color:#718096; font-size:11px; margin-top:8px; }
        </style>
        <div id="inconsistencias-hud-header">
          <span>🔧 Inconsistências</span>
          <button id="inconsistencias-hud-toggle">−</button>
        </div>
        <div id="inconsistencias-hud-body">
          <textarea id="inconsistencias-input" placeholder="Cole números de processo aqui (um por linha)&#10;Ex: 0000268-76.2025.8.26.0358"></textarea>
          <div id="inconsistencias-controls">
            <button id="inconsistencias-start" class="incons-btn incons-btn-primary">▶ Iniciar</button>
            <button id="inconsistencias-stop" class="incons-btn incons-btn-danger" disabled>⏹ Parar</button>
          </div>
          <div id="inconsistencias-status">Aguardando entrada...</div>
          <div id="inconsistencias-log"></div>
          <div id="inconsistencias-footer">
            <button id="inconsistencias-export" class="incons-btn incons-btn-secondary">📥 Exportar Log</button>
            <button id="inconsistencias-clear" class="incons-btn incons-btn-secondary">🗑️ Limpar</button>
          </div>
          <div id="inconsistencias-count"></div>
        </div>
      `;
      document.body.appendChild(hud);

      const toggle = hud.querySelector('#inconsistencias-hud-toggle');
      const body = hud.querySelector('#inconsistencias-hud-body');
      toggle.addEventListener('click', () => {
        body.classList.toggle('collapsed');
        toggle.textContent = body.classList.contains('collapsed') ? '+' : '−';
      });

      // Draggable
      let isDragging = false, offsetX, offsetY;
      hud.querySelector('#inconsistencias-hud-header').addEventListener('mousedown', (e) => {
        if (e.target === toggle) return;
        isDragging = true; offsetX = e.clientX - hud.offsetLeft; offsetY = e.clientY - hud.offsetTop;
      });
      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        hud.style.left = (e.clientX - offsetX) + 'px'; hud.style.top = (e.clientY - offsetY) + 'px';
        hud.style.right = 'auto'; hud.style.bottom = 'auto';
      });
      document.addEventListener('mouseup', () => { isDragging = false; });

      const input = hud.querySelector('#inconsistencias-input');
      input.addEventListener('input', () => {
        const pos = input.selectionStart, before = input.value.length;
        input.value = input.value.replace(/[^\d\n]/g, '');
        input.selectionStart = input.selectionEnd = pos - (before - input.value.length);
      });

      const status = hud.querySelector('#inconsistencias-status');
      const log = hud.querySelector('#inconsistencias-log');
      const countDiv = hud.querySelector('#inconsistencias-count');

      window.eprocInconsUpdateStatus = (text) => { status.innerHTML = text; };

      const renderLog = () => {
        const entries = Storage.cleanup();
        log.innerHTML = '';
        entries.slice(0, 50).forEach(entry => {
          const div = document.createElement('div');
          div.className = `incons-log-entry ${entry.status}`;
          const date = new Date(entry.timestamp).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
          div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="font-family:Consolas;font-weight:600">${entry.caseNumber}</span><span style="color:#718096;font-size:10px">${date}</span></div><div style="color:#a0aec0">${entry.message}</div>`;
          log.appendChild(div);
        });
        countDiv.textContent = `${entries.length} registro(s) nos últimos 7 dias`;
      };

      const updateUI = () => {
        const progress = Automation.getProgress();
        const startBtn = hud.querySelector('#inconsistencias-start');
        const stopBtn = hud.querySelector('#inconsistencias-stop');
        if (progress) {
          startBtn.disabled = true; stopBtn.disabled = false; input.disabled = true;
          status.innerHTML = `<span>⏳ ${progress.current}/${progress.total} — <strong>${progress.currentCase}</strong><br>Removidas: ${progress.removed}</span>`;
        } else {
          startBtn.disabled = false; stopBtn.disabled = true; input.disabled = false;
        }
      };

      window.eprocInconsRefreshHUD = updateUI;

      hud.querySelector('#inconsistencias-start').addEventListener('click', () => {
        const cases = Automation.parseInput(input.value);
        if (!cases.length) { status.textContent = '⚠️ Nenhum número válido encontrado'; return; }
        status.textContent = `🚀 Iniciando ${cases.length} processo(s)...`;
        updateUI(); Automation.startBatch(cases);
      });

      hud.querySelector('#inconsistencias-stop').addEventListener('click', () => {
        Automation.stop(); updateUI(); status.textContent = '⏹️ Interrompido pelo usuário';
      });

      hud.querySelector('#inconsistencias-export').addEventListener('click', () => {
        const entries = Storage.loadLog();
        if (!entries.length) { alert('Nenhum registro para exportar'); return; }
        const escape = (s) => `"${(s || '').replace(/"/g, '""')}"`;
        const headers = 'caso,data,status,mensagem,removidas';
        const rows = entries.map(e => [e.caseNumber, new Date(e.timestamp).toLocaleString('pt-BR'), e.status, escape(e.message), e.removed || 0].join(','));
        const blob = new Blob(['\uFEFF' + headers + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `inconsistencias_log_${new Date().toISOString().slice(0,10)}.csv`;
        a.click(); URL.revokeObjectURL(url);
      });

      hud.querySelector('#inconsistencias-clear').addEventListener('click', () => {
        if (confirm('Limpar todos os registros?')) { Storage.clearLog(); renderLog(); status.textContent = '🗑️ Log limpo'; }
      });

      renderLog(); updateUI();
      return { renderLog, updateUI };
    }

    const init = () => {
      // Override confirm only when on inconsistencias page with active queue
      const realWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      const originalConfirm = realWindow.confirm.bind(realWindow);
      realWindow.confirm = function (message) {
        try {
          const queue = JSON.parse(GM_getValue(INCONS_CONFIG.QUEUE_KEY, 'null'));
          if (queue) return true;
        } catch (e) {}
        return originalConfirm(message);
      };

      const resumed = Automation.resumeIfNeeded();
      if (onInconsistenciasPage()) {
        const hudControls = createHUD();
        hudControls.renderLog();
        hudControls.updateUI();
      }
    };

    return { init };
  })();

  // =========================================================
  // Boot
  // =========================================================
  const boot = () => {
    ToolkitPanel.init();

    if (Config.isEnabled('remigrar')) ModuleRemigrar.init();
    if (Config.isEnabled('inconsistencias')) ModuleInconsistencias.init();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
