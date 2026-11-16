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
  let draft = null;
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
    $('save-detail').textContent = warning ? '　' + saveIssue : '　一手记一次 · 对家出牌自动联动';
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
  function checkOpponentInput() {
    let message = '';
    let initial = null;
    const stats = C.getStats(state);
    try {
      initial = parseWhole($('initial-hand'), true);
      if (initial !== null && (initial < 0 || initial > C.TOTAL)) throw new Error('初始手牌须为 0–312 的整数');
      if (initial !== null && initial < stats.opponentPlayed) {
        throw new Error('初始手牌不能少于已出的 ' + stats.opponentPlayed + ' 张');
      }
    } catch (error) { message = error.message; }
    setFieldError(message);
    return { initial, message };
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
  function fillQuantities() {
    if (!draft) return;
    const key = draft.card;
    const card = C.CARDS.find(item => item.key === key);
    const stats = C.getStats(state);
    const existing = draft.id ? state.events.find(event => event.id === draft.id) : null;
    const available = stats.byCard[key].remaining + (existing?.card === key ? existing.qty : 0);
    const twosAvailable = stats.byCard['2'].remaining + (existing?.twos || 0);
    const opponentAvailable = stats.opponentRemaining === null ? null : stats.opponentRemaining + (existing?.actor === 'opponent' ? existing.qty + existing.twos : 0);
    $('dialog-rank').textContent = card.rank;
    $('quantity-title').textContent = draft.id ? '修改这手牌' : '记录一手出牌';
    $('quantity-meta').textContent = '可记 ' + available + ' 张 · ' + (key === '2' ? '单独记录 2' : '主牌张数不含带出的 2');
    $('main-quantity-label').textContent = card.rank + ' 的张数';
    $('main-quantity-hint').textContent = key === '2' ? '按实际张数填写' : '不含带出的 2';
    $('quantity-grid').replaceChildren();
    for (let n = 1; n <= card.total; n++) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = n; button.disabled = n > available;
      button.setAttribute('aria-label', card.rank + ' 出 ' + n + ' 张');
      button.setAttribute('aria-pressed', String(draft.qty === n));
      button.addEventListener('click', () => {
        if (!draft || draft.card !== key || !$('quantity-dialog').open) return;
        draft.qty = n; fillQuantities();
      });
      $('quantity-grid').append(button);
    }
    $('twos-section').hidden = key === '2';
    $('twos-available').textContent = '2 可用 ' + twosAvailable + ' 张';
    $('twos-input').max = twosAvailable;
    if (document.activeElement !== $('twos-input')) $('twos-input').value = draft.twos ?? '';
    for (const button of document.querySelectorAll('[data-twos]')) {
      const qty = Number(button.dataset.twos);
      button.disabled = qty > twosAvailable;
      button.setAttribute('aria-pressed', String(draft.twos === qty));
    }
    for (const button of document.querySelectorAll('[data-actor]')) button.setAttribute('aria-pressed', String(button.dataset.actor === draft.actor));
    const total = (draft.qty || 0) + (draft.twos || 0);
    $('play-summary').textContent = draft.qty ? card.rank + ' × ' + draft.qty + (draft.twos ? ' ＋ 2 × ' + draft.twos : '') + '，共 ' + total + ' 张' : '请选择主牌张数';
    const opponentAfter = opponentAvailable === null ? null : opponentAvailable - total;
    $('play-effect').textContent = draft.actor === 'opponent' ? (opponentAfter === null ? '同步记录对家已出；填写初始手牌后显示剩余' : '同步扣减牌池 · 对家记后剩 ' + opponentAfter + ' 张') : '扣减全场牌池 · 对家张数不变';
    let error = '';
    if (draft.id && !existing) error = '这手牌已被移除，请关闭后重新操作';
    else if (!Number.isSafeInteger(draft.twos) || draft.twos < 0 || draft.twos > twosAvailable) error = '带 2 的张数须为 0–' + twosAvailable + ' 的整数';
    else if (draft.qty > available) error = card.rank + ' 只剩 ' + available + ' 张';
    else if (draft.actor === 'opponent' && opponentAfter !== null && opponentAfter < 0) error = '对家只剩 ' + opponentAvailable + ' 张，本手共 ' + total + ' 张';
    $('play-error').textContent = error;
    $('play-error').hidden = !error;
    $('save-play').disabled = !!error || !draft.qty;
    $('save-play').textContent = (draft.id ? '保存修改' : '确认记录') + ' · ' + (draft.actor === 'opponent' ? '对家' : '其他人');
    $('remove-play').hidden = !draft.id;
  }
  function openQuantity(key) {
    draft = { card: key, qty: null, twos: 0, actor: 'other' };
    fillQuantities();
    for (const [cardKey, tile] of tileElements) tile.button.classList.toggle('selected', cardKey === key);
    $('quantity-dialog').showModal();
  }
  function editPlay(event) {
    draft = { id: event.id, card: event.card, qty: event.qty, twos: event.twos, actor: event.actor };
    fillQuantities();
    $('quantity-dialog').showModal();
  }
  function renderHistory(stats) {
    const history = historyKind === 'table' ? stats.history : stats.opponentHistory;
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
      const legacy = event.kind === 'legacy-opponent';
      rank.textContent = legacy ? '旧对家记录 · ' + event.qty + ' 张' : (event.actor === 'opponent' ? '对家 · ' : (event.legacy ? '旧全场 · ' : '其他人 · ')) + C.CARDS.find(card => card.key === event.card).rank + ' × ' + event.qty + (event.twos ? ' ＋ 2 × ' + event.twos : '');
      const note = document.createElement('div'); note.className = 'history-note';
      note.textContent = legacy ? '仅保留旧版对家计数，不重复扣牌池' : '共 ' + event.total + ' 张' + (event.actor === 'opponent' ? (event.opponentRemainingAfter === null ? ' · 对家剩余待填写' : ' · 对家记后剩 ' + event.opponentRemainingAfter + ' 张') : ' · 已计入全场');
      const time = document.createElement('time'); time.dateTime = new Date(event.at).toISOString(); time.textContent = clock.format(event.at);
      const action = document.createElement('button'); action.type = 'button'; action.className = 'history-edit';
      action.textContent = legacy ? '撤销' : '修改';
      action.setAttribute('aria-label', (legacy ? '撤销' : '修改') + rank.textContent);
      action.addEventListener('click', () => {
        if (!legacy) editPlay(event);
        else if (commit(current => C.removePlay(current, event.id))) notify('已撤销旧对家记录');
      });
      const side = document.createElement('div'); side.className = 'history-side'; side.append(time, action);
      text.append(rank, note); row.append(dot, text, side); $('history-list').append(row);
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
      tile.button.classList.toggle('selected', draft?.card === card.key);
      tile.button.setAttribute('aria-label', card.rank + '，剩余 ' + stat.remaining + ' 张，已出 ' + stat.played + ' 张，共 ' + card.total + ' 张');
    }
    $('opponent-remain').textContent = stats.opponentRemaining === null ? '--' : stats.opponentRemaining;
    $('opponent-number').classList.toggle('low', stats.opponentRemaining !== null && stats.opponentRemaining > 0 && stats.opponentRemaining <= 10);
    $('opponent-number').classList.toggle('finished', stats.opponentRemaining === 0);
    $('opponent-meta').textContent = state.initialHand === null ? '已出 ' + stats.opponentPlayed + ' 张 · 填写初始张数后显示剩余' : '初始 ' + state.initialHand + ' 张 · 已出 ' + stats.opponentPlayed + ' 张';
    $('opponent-progress').style.width = (state.initialHand > 0 ? stats.opponentRemaining / state.initialHand * 100 : 0) + '%';
    if (document.activeElement !== $('initial-hand')) $('initial-hand').value = state.initialHand === null ? '' : state.initialHand;
    $('legacy-note').hidden = !state.events.some(event => event.kind === 'legacy-opponent' || event.legacy);
    for (const button of document.querySelectorAll('[data-undo-table]')) button.disabled = !state.events.length;
    renderHistory(stats);
    storageStatus();
    checkOpponentInput();
    if (draft && $('quantity-dialog').open) fillQuantities();
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
      draft = null;
      for (const tile of tileElements.values()) tile.button.classList.remove('selected');
    });
    $('rules-open').addEventListener('click', () => $('rules-dialog').showModal());
    $('history-scroll').addEventListener('click', () => $('history').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }));
    for (const button of document.querySelectorAll('[data-history-kind]')) button.addEventListener('click', () => { historyKind = button.dataset.historyKind; renderHistory(C.getStats(state)); });
    for (const button of document.querySelectorAll('[data-undo-table]')) button.addEventListener('click', () => {
      if (commit(current => C.undo(current))) notify('已整手撤销，牌池与对家同步恢复');
    });
    for (const button of document.querySelectorAll('[data-actor]')) button.addEventListener('click', () => {
      if (draft) { draft.actor = button.dataset.actor; fillQuantities(); }
    });
    for (const button of document.querySelectorAll('[data-twos]')) button.addEventListener('click', () => {
      if (draft) { draft.twos = Number(button.dataset.twos); $('twos-input').value = draft.twos; fillQuantities(); }
    });
    $('twos-input').addEventListener('input', () => {
      if (!draft) return;
      try { draft.twos = parseWhole($('twos-input')); } catch { draft.twos = null; }
      fillQuantities();
    });
    $('save-play').addEventListener('click', () => {
      if (!draft || $('save-play').disabled) return;
      const play = { ...draft };
      if (commit(current => play.id ? C.updatePlay(current, play.id, play) : C.recordPlay(current, play))) {
        $('quantity-dialog').close();
        notify((play.id ? '已修改' : '已记录') + (play.actor === 'opponent' ? '对家' : '其他人') + '出牌，共 ' + (play.qty + play.twos) + ' 张');
      }
    });
    $('remove-play').addEventListener('click', () => {
      if (draft?.id && commit(current => C.removePlay(current, draft.id))) {
        $('quantity-dialog').close(); notify('已整手撤销，牌池与对家同步恢复');
      }
    });
    $('initial-hand').addEventListener('input', () => {
      const values = checkOpponentInput();
      if (!values.message) commit(current => C.setInitial(current, values.initial));
    });
    $('initial-hand').addEventListener('change', () => {
      try {
        const initial = parseWhole($('initial-hand'), true);
        if (commit(current => C.setInitial(current, initial))) setFieldError('');
      } catch (error) { setFieldError(error.message); }
      checkOpponentInput();
    });
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
          $('new-game-dialog').close(); setFieldError(''); render(); notify('已开始新一局');
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
        $('import-summary').textContent = '备份有出牌记录 ' + stats.tableHistory.length + ' 手、对家已出 ' + stats.opponentPlayed + ' 张。旧版记录会保留原统计。恢复会替换当前牌局，建议先导出当前记录。';
        $('rules-dialog').close(); $('import-dialog').showModal();
      } catch (error) { pendingImport = null; notify(error.message || '无法读取备份文件'); }
    });
    $('confirm-import').addEventListener('click', () => {
      if (!pendingImport) return;
      if (commit(() => pendingImport, true)) {
        pendingImport = null; $('import-dialog').close(); setFieldError(''); render(); notify('已恢复备份牌局');
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
