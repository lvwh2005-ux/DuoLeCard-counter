(function () {
  'use strict';
  const C = window.DuoLeCounter;
  const $ = id => document.getElementById(id);
  const STORE_KEY = 'duole-card-counter:v1';
  const tileElements = new Map();
  let state = C.createGame();
  let lastSavedRaw = null;
  let unreadableSave = null;
  let saveIssue = '';
  let memoryOnly = false;
  let selectedKey = null;
  let historyKind = 'table';
  let pendingImport = null;
  let toastTimer;

  function notify(text) {
    $('toast').textContent = text;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2500);
  }
  function parseWhole(input, allowBlank = false) {
    const text = input.value.trim();
    if (!text && allowBlank) return null;
    if (!/^\d+$/.test(text)) throw new Error('请填写整数张数');
    const value = Number(text);
    if (!Number.isSafeInteger(value)) throw new Error('张数无效');
    return value;
  }
  function load() {
    try {
      lastSavedRaw = localStorage.getItem(STORE_KEY);
      if (lastSavedRaw !== null) {
        try { state = C.deserialize(lastSavedRaw); }
        catch { unreadableSave = lastSavedRaw; saveIssue = '原存档读取失败，已保留原始内容；请导出备份，或开始新局。'; }
      }
    } catch {
      memoryOnly = true;
      saveIssue = '本机存储不可用；记录仅在当前页面有效，请导出备份。';
    }
  }
  function persist() {
    if (unreadableSave !== null) return;
    try {
      const raw = C.serialize(state);
      localStorage.setItem(STORE_KEY, raw);
      lastSavedRaw = raw;
      memoryOnly = false;
      saveIssue = '';
    } catch {
      memoryOnly = true;
      saveIssue = '本机保存失败，当前记录仍可继续；关闭页面前请导出备份。';
    }
  }
  function storageStatus() {
    const warning = !!saveIssue || unreadableSave !== null;
    $('save-banner').classList.toggle('storage-error', warning);
    $('save-status').textContent = warning ? '记录暂未保存' : (navigator.onLine === false ? '离线记牌' : '自动保存在本机');
    $('save-detail').textContent = warning ? '　' + saveIssue : '　全场牌池与对家张数分别记录';
    $('save-export').hidden = !warning;
  }
  function commit(operation, replaceStored = false) {
    try {
      // Detect a newer save before overwriting it. Storage events also refresh idle tabs.
      if (!replaceStored && !memoryOnly && unreadableSave === null) {
        let raw;
        try { raw = localStorage.getItem(STORE_KEY); } catch { raw = lastSavedRaw; }
        if (raw !== lastSavedRaw) {
          try { state = raw === null ? C.createGame() : C.deserialize(raw); lastSavedRaw = raw; }
          catch { unreadableSave = raw; saveIssue = '另一窗口的存档无法读取，请先导出备份。'; }
          render();
          notify('另一窗口更新了记录，已同步，请重新操作');
          return false;
        }
      }
      const next = operation(state);
      if (next === state) return true;
      state = next;
      if (replaceStored) unreadableSave = null;
      persist();
      render();
      return true;
    } catch (error) {
      notify(error.message || '未能完成记录，请检查输入');
      return false;
    }
  }
  function setFieldError(text) {
    $('opponent-error').textContent = text;
    $('opponent-error').hidden = !text;
  }
  function checkOpponentInput(showErrors = true) {
    let message = '';
    let initial = null;
    let qty = null;
    const stats = C.getStats(state);
    try {
      initial = parseWhole($('initial-hand'), true);
      if (initial !== null && (initial < 0 || initial > C.TOTAL)) throw new Error('初始手牌须为 0–312 的整数');
      if ((initial === null && stats.opponentHistory.length) || (initial !== null && initial < stats.opponentPlayed)) {
        throw new Error('初始手牌不能少于已出的 ' + stats.opponentPlayed + ' 张');
      }
      qty = parseWhole($('opponent-quantity'));
      if (qty < 1 || qty > C.TOTAL) throw new Error('本次出牌须为 1–312 的整数');
      if (initial !== null && qty > initial - stats.opponentPlayed && initial - stats.opponentPlayed > 0) {
        throw new Error('对家只剩 ' + (initial - stats.opponentPlayed) + ' 张');
      }
    } catch (error) { message = error.message; }
    if (showErrors) setFieldError(message);
    const remaining = initial === null ? 0 : initial - stats.opponentPlayed;
    $('record-opponent').disabled = !!message || initial === null || remaining <= 0 || qty === null || qty > remaining;
    $('minus').disabled = qty !== null && qty <= 1;
    $('plus').disabled = qty !== null && qty >= (initial === null ? C.TOTAL : Math.max(1, remaining));
    return { initial, qty, message, remaining };
  }
  function buildTiles() {
    for (const card of C.CARDS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tile ' + card.style;
      button.dataset.card = card.key;
      const rank = document.createElement('span'); rank.className = 'tile-rank'; rank.textContent = card.rank;
      const mark = document.createElement('span'); mark.className = 'tile-mark'; mark.textContent = '↗'; mark.setAttribute('aria-hidden', 'true');
      const count = document.createElement('span'); count.className = 'tile-count';
      const label = document.createElement('small'); label.textContent = '剩';
      const number = document.createElement('span'); number.textContent = card.total;
      count.append(label, number);
      const meta = document.createElement('span'); meta.className = 'tile-meta';
      button.append(rank, mark, count, meta);
      button.addEventListener('click', () => openQuantity(card.key));
      $(card.total === 6 ? 'special-grid' : 'normal-grid').append(button);
      tileElements.set(card.key, { button, number, meta });
    }
  }
  function fillQuantities(key) {
    const card = C.CARDS.find(item => item.key === key);
    const stat = C.getStats(state).byCard[key];
    $('dialog-rank').textContent = card.rank;
    $('quantity-meta').textContent = '全场剩 ' + stat.remaining + ' 张 · 共 ' + card.total + ' 张';
    $('quantity-grid').replaceChildren();
    for (let n = 1; n <= card.total; n++) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = n; button.disabled = n > stat.remaining;
      button.setAttribute('aria-label', card.rank + ' 出 ' + n + ' 张');
      button.addEventListener('click', () => {
        if (selectedKey !== key || !$('quantity-dialog').open) return;
        selectedKey = null;
        $('quantity-dialog').close();
        if (commit(current => C.recordTable(current, key, n))) notify('已记全场 ' + card.rank + ' × ' + n);
      });
      $('quantity-grid').append(button);
    }
  }
  function openQuantity(key) {
    selectedKey = key;
    fillQuantities(key);
    for (const [cardKey, tile] of tileElements) tile.button.classList.toggle('selected', cardKey === key);
    $('quantity-dialog').showModal();
  }
  function renderHistory(stats) {
    const history = historyKind === 'table' ? stats.tableHistory : stats.opponentHistory;
    $('history-title').textContent = historyKind === 'table' ? '全场出牌记录' : '对家出牌记录';
    $('history-count').textContent = '共 ' + history.length + ' 笔';
    for (const button of document.querySelectorAll('[data-history-kind]')) {
      button.setAttribute('aria-pressed', String(button.dataset.historyKind === historyKind));
    }
    $('history-list').replaceChildren();
    if (!history.length) {
      const empty = document.createElement('p'); empty.className = 'history-empty';
      empty.textContent = historyKind === 'table' ? '还没有全场出牌记录' : '还没有对家出牌记录';
      $('history-list').append(empty); return;
    }
    const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    for (const event of [...history].reverse()) {
      const row = document.createElement('div'); row.className = 'history-row';
      const dot = document.createElement('span'); dot.className = 'history-dot';
      const text = document.createElement('div');
      const rank = document.createElement('div'); rank.className = 'history-rank';
      rank.textContent = historyKind === 'table' ? C.CARDS.find(card => card.key === event.card).rank + ' × ' + event.qty : '对家出了 ' + event.qty + ' 张';
      const note = document.createElement('div'); note.className = 'history-note';
      note.textContent = (historyKind === 'table' ? '记后该牌种剩 ' : '记后对家剩 ') + event.remainingAfter + ' 张';
      const time = document.createElement('time'); time.dateTime = new Date(event.at).toISOString(); time.textContent = clock.format(event.at);
      text.append(rank, note); row.append(dot, text, time); $('history-list').append(row);
    }
  }
  function render() {
    const stats = C.getStats(state);
    $('table-remaining').textContent = stats.tableRemaining;
    $('table-played').textContent = stats.tablePlayed;
    $('table-total').textContent = C.TOTAL;
    for (const card of C.CARDS) {
      const stat = stats.byCard[card.key], tile = tileElements.get(card.key);
      tile.number.textContent = stat.remaining;
      tile.meta.textContent = '已出 ' + stat.played + ' / ' + card.total;
      tile.button.disabled = stat.remaining === 0;
      tile.button.classList.toggle('exhausted', stat.remaining === 0);
      tile.button.classList.toggle('selected', selectedKey === card.key);
      tile.button.setAttribute('aria-label', card.rank + '，剩余 ' + stat.remaining + ' 张，已出 ' + stat.played + ' 张，共 ' + card.total + ' 张');
    }
    $('opponent-remain').textContent = stats.opponentRemaining === null ? '--' : stats.opponentRemaining;
    $('opponent-number').classList.toggle('low', stats.opponentRemaining !== null && stats.opponentRemaining > 0 && stats.opponentRemaining <= 10);
    $('opponent-number').classList.toggle('finished', stats.opponentRemaining === 0);
    $('opponent-meta').textContent = state.initialHand === null ? '先填写对家初始手牌' : '初始 ' + state.initialHand + ' 张 · 已出 ' + stats.opponentPlayed + ' 张';
    $('opponent-progress').style.width = (state.initialHand > 0 ? stats.opponentRemaining / state.initialHand * 100 : 0) + '%';
    if (document.activeElement !== $('initial-hand')) $('initial-hand').value = state.initialHand === null ? '' : state.initialHand;
    $('opponent-quantity').max = Math.max(1, stats.opponentRemaining ?? C.TOTAL);
    $('undo-opponent').disabled = !stats.opponentHistory.length;
    for (const button of document.querySelectorAll('[data-undo-table]')) button.disabled = !stats.tableHistory.length;
    renderHistory(stats);
    storageStatus();
    checkOpponentInput();
    if (selectedKey !== null && $('quantity-dialog').open) fillQuantities(selectedKey);
  }
  function exportBackup() {
    let raw = C.exportBackup(state);
    if (unreadableSave !== null) {
      const backup = JSON.parse(raw); backup.unreadableSave = unreadableSave; raw = JSON.stringify(backup, null, 2);
    }
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url;
    link.download = 'duole-counter-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('已导出当前牌局备份');
  }
  function bind() {
    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
    $('quantity-dialog').addEventListener('close', () => {
      selectedKey = null;
      for (const tile of tileElements.values()) tile.button.classList.remove('selected');
    });
    $('rules-open').addEventListener('click', () => $('rules-dialog').showModal());
    $('history-scroll').addEventListener('click', () => $('history').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }));
    for (const button of document.querySelectorAll('[data-history-kind]')) button.addEventListener('click', () => { historyKind = button.dataset.historyKind; renderHistory(C.getStats(state)); });
    for (const button of document.querySelectorAll('[data-undo-table]')) button.addEventListener('click', () => {
      if (commit(current => C.undo(current, 'table'))) notify('已撤销全场上一笔');
    });
    $('undo-opponent').addEventListener('click', () => {
      if (commit(current => C.undo(current, 'opponent'))) notify('已撤销对家上一笔');
    });
    $('initial-hand').addEventListener('input', () => checkOpponentInput());
    $('initial-hand').addEventListener('change', () => {
      try {
        const initial = parseWhole($('initial-hand'), true);
        if (commit(current => C.setInitial(current, initial))) setFieldError('');
      } catch (error) { setFieldError(error.message); }
      checkOpponentInput();
    });
    $('opponent-quantity').addEventListener('input', () => checkOpponentInput());
    for (const [name, delta] of [['minus', -1], ['plus', 1]]) $(name).addEventListener('click', () => {
      const values = checkOpponentInput(false);
      $('opponent-quantity').value = Math.max(1, Math.min(values.initial === null ? C.TOTAL : Math.max(1, values.remaining), (values.qty ?? 1) + delta));
      checkOpponentInput();
    });
    function recordOpponent() {
      const values = checkOpponentInput();
      if (values.message || values.initial === null || values.remaining <= 0 || values.qty > values.remaining) return;
      const success = commit(current => C.recordOpponent(C.setInitial(current, values.initial), values.qty));
      if (success) { $('opponent-quantity').value = 1; checkOpponentInput(); notify('已记对家出了 ' + values.qty + ' 张'); }
    }
    $('record-opponent').addEventListener('click', recordOpponent);
    $('opponent-quantity').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); recordOpponent(); } });
    $('initial-hand').addEventListener('keydown', event => { if (event.key === 'Enter') $('initial-hand').blur(); });
    $('new-game').addEventListener('click', () => {
      $('new-initial').value = state.initialHand ?? '';
      $('new-game-error').textContent = '';
      $('new-game-dialog').showModal();
    });
    $('start-game').addEventListener('click', () => {
      try {
        const next = C.createGame(parseWhole($('new-initial'), true));
        if (commit(() => next, true)) {
          $('new-game-dialog').close(); $('opponent-quantity').value = 1; setFieldError(''); render(); notify('已开始新一局');
        }
      } catch (error) { $('new-game-error').textContent = error.message; }
    });
    $('export-backup').addEventListener('click', exportBackup);
    $('save-export').addEventListener('click', exportBackup);
    $('import-backup').addEventListener('click', () => $('backup-file').click());
    $('backup-file').addEventListener('change', async () => {
      const file = $('backup-file').files[0]; $('backup-file').value = '';
      if (!file) return;
      try {
        if (file.size > C.MAX_BYTES) throw new Error('备份文件不能超过 256 KB');
        pendingImport = C.importBackup(await file.text());
        const stats = C.getStats(pendingImport);
        $('import-summary').textContent = '备份有全场记录 ' + stats.tableHistory.length + ' 笔、对家记录 ' + stats.opponentHistory.length + ' 笔。恢复会替换当前牌局，建议先导出当前记录。';
        $('rules-dialog').close(); $('import-dialog').showModal();
      } catch (error) { pendingImport = null; notify(error.message || '无法读取备份文件'); }
    });
    $('confirm-import').addEventListener('click', () => {
      if (!pendingImport) return;
      if (commit(() => pendingImport, true)) {
        pendingImport = null; $('import-dialog').close(); $('opponent-quantity').value = 1; setFieldError(''); render(); notify('已恢复备份牌局');
      }
    });
    $('import-dialog').addEventListener('close', () => { pendingImport = null; });
    document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    }));
    window.addEventListener('storage', event => {
      if (event.key !== STORE_KEY || event.newValue === lastSavedRaw || memoryOnly || unreadableSave !== null) return;
      try {
        state = event.newValue === null ? C.createGame() : C.deserialize(event.newValue);
        lastSavedRaw = event.newValue;
        render();
        notify('已同步其他窗口的记录');
      } catch { saveIssue = '另一窗口的存档无法读取，请先导出备份。'; storageStatus(); }
    });
    window.addEventListener('online', storageStatus);
    window.addEventListener('offline', storageStatus);
    window.addEventListener('beforeunload', event => {
      if (!memoryOnly && unreadableSave === null) return;
      if (!state.events.length) return;
      event.preventDefault(); event.returnValue = '';
    });
  }

  load(); buildTiles(); bind(); render();
  if ('serviceWorker' in navigator && ['https:', 'http:'].includes(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
  }
})();
