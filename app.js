const DB_NAME = 'PuzzleTimerDB';
const DB_VERSION = 1;

let db = null;
let currentPuzzle = null;
let timerInterval = null;
let countdownInterval = null;
let currentSession = null;
let countdownEndTime = null;
let countdownMinutes = 15;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains('puzzles')) {
        const store = database.createObjectStore('puzzles', { keyPath: 'id' });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours().toString().padStart(2, '0');
  const minute = date.getMinutes().toString().padStart(2, '0');
  return `${month}月${day}日 ${hour}:${minute}`;
}

function getTotalTime(puzzle) {
  if (!puzzle.sessions || puzzle.sessions.length === 0) return 0;
  return puzzle.sessions.reduce((sum, session) => sum + (session.duration || 0), 0);
}

function playSound() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(1000, audioContext.currentTime + 0.1);
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime + 0.2);
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
  } catch (e) {
    console.error('Failed to play sound:', e);
  }
}

async function savePuzzle(puzzle) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['puzzles'], 'readwrite');
    const store = transaction.objectStore('puzzles');
    const request = store.put(puzzle);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getPuzzles() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['puzzles'], 'readonly');
    const store = transaction.objectStore('puzzles');
    const request = store.getAll();
    
    request.onsuccess = () => {
      const puzzles = request.result.sort((a, b) => b.createdAt - a.createdAt);
      resolve(puzzles);
    };
    request.onerror = () => reject(request.error);
  });
}

async function getPuzzleById(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['puzzles'], 'readonly');
    const store = transaction.objectStore('puzzles');
    const request = store.get(id);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deletePuzzle(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['puzzles'], 'readwrite');
    const store = transaction.objectStore('puzzles');
    const request = store.delete(id);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function renderPuzzleList(puzzles) {
  const listContainer = document.getElementById('puzzle-list');
  const emptyState = document.getElementById('empty-state');
  
  if (puzzles.length === 0) {
    emptyState.style.display = 'flex';
    listContainer.innerHTML = '';
    listContainer.appendChild(emptyState);
    return;
  }
  
  emptyState.style.display = 'none';
  listContainer.innerHTML = puzzles.map(puzzle => {
    const totalTime = formatTime(getTotalTime(puzzle));
    let subtitle = '';
    if (puzzle.brand && puzzle.pieces) {
      subtitle = `${puzzle.brand} · ${puzzle.pieces}片`;
    } else if (puzzle.brand) {
      subtitle = puzzle.brand;
    } else if (puzzle.pieces) {
      subtitle = `${puzzle.pieces}片`;
    }
    return `
      <div class="puzzle-item" data-id="${puzzle.id}">
        <div class="puzzle-item-main">
          <div class="puzzle-item-name">${escapeHtml(puzzle.name)}</div>
          ${subtitle ? `<div class="puzzle-item-subtitle">${escapeHtml(subtitle)}</div>` : ''}
        </div>
        <div class="puzzle-item-actions">
          <span class="puzzle-item-time">${totalTime}</span>
          <button class="btn-delete-item" data-id="${puzzle.id}" title="删除拼图">×</button>
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(page => {
    page.classList.remove('active');
  });
  document.getElementById(pageId).classList.add('active');
}

function showModal(modalId) {
  document.getElementById(modalId).classList.add('show');
}

function hideModal(modalId) {
  document.getElementById(modalId).classList.remove('show');
}

function updateStats() {
  if (!currentPuzzle) return;
  
  const totalTime = getTotalTime(currentPuzzle);
  const sessionCount = currentPuzzle.sessions ? currentPuzzle.sessions.length : 0;
  const avgTime = sessionCount > 0 ? Math.floor(totalTime / sessionCount) : 0;
  
  document.getElementById('total-time').textContent = formatTime(totalTime);
  document.getElementById('session-count').textContent = sessionCount;
  document.getElementById('avg-time').textContent = formatTime(avgTime);
}

function renderSessions() {
  const sessionList = document.getElementById('session-list');
  
  if (!currentPuzzle || !currentPuzzle.sessions || currentPuzzle.sessions.length === 0) {
    sessionList.innerHTML = '<div class="empty-sessions"><p>暂无分段记录</p></div>';
    return;
  }
  
  const sessions = [...currentPuzzle.sessions].reverse();
  sessionList.innerHTML = sessions.map(session => `
    <div class="session-item">
      <div class="session-time">${formatTime(session.duration)}</div>
      <div class="session-date">${formatDate(session.startTime)}</div>
    </div>
  `).join('');
}

function startTimer() {
  currentSession = {
    id: generateId(),
    startTime: Date.now(),
    endTime: null,
    duration: 0
  };
  
  if (!currentPuzzle.sessions) {
    currentPuzzle.sessions = [];
  }
  currentPuzzle.sessions.push(currentSession);
  
  const startTime = Date.now();
  
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    currentSession.duration = elapsed;
    document.getElementById('current-time').textContent = formatTime(elapsed);
  }, 1000);
  
  document.getElementById('timer-btn').textContent = '结束计时';
  document.getElementById('timer-btn').classList.remove('start');
  document.getElementById('timer-btn').classList.add('stop');
  
  if (document.getElementById('countdown-enabled').checked) {
    startCountdown();
  }
}

function startCountdown() {
  countdownEndTime = Date.now() + (countdownMinutes * 60 * 1000);
  
  countdownInterval = setInterval(() => {
    const remaining = countdownEndTime - Date.now();
    
    if (remaining <= 0) {
      stopCountdown();
      showReminder();
      return;
    }
    
    const countdownTimeEl = document.getElementById('countdown-time');
    countdownTimeEl.textContent = formatTime(remaining);
    
    if (remaining < 60000) {
      countdownTimeEl.classList.remove('warning');
      countdownTimeEl.classList.add('danger');
    } else if (remaining < 300000) {
      countdownTimeEl.classList.remove('danger');
      countdownTimeEl.classList.add('warning');
    } else {
      countdownTimeEl.classList.remove('warning', 'danger');
    }
  }, 1000);
  
  document.getElementById('countdown-time').textContent = formatTime(countdownMinutes * 60 * 1000);
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  countdownEndTime = null;
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  stopCountdown();
  
  if (currentSession) {
    currentSession.endTime = Date.now();
    currentSession.duration = currentSession.endTime - currentSession.startTime;
  }
  
  savePuzzle(currentPuzzle).then(() => {
    updateStats();
    renderSessions();
  });
  
  document.getElementById('current-time').textContent = '00:00:00';
  document.getElementById('timer-btn').textContent = '开始计时';
  document.getElementById('timer-btn').classList.remove('stop');
  document.getElementById('timer-btn').classList.add('start');
  
  document.getElementById('countdown-time').textContent = '--:--:--';
  document.getElementById('countdown-time').classList.remove('warning', 'danger');
}

function showReminder() {
  playSound();
  showModal('modal-reminder');
  
  const countdownEnabled = document.getElementById('countdown-enabled');
  if (countdownEnabled.checked) {
    countdownEnabled.checked = false;
    document.getElementById('countdown-options').classList.remove('show');
  }
}

async function init() {
  await openDB();
  
  const puzzles = await getPuzzles();
  renderPuzzleList(puzzles);
  
  document.getElementById('add-puzzle-btn').addEventListener('click', async () => {
    const nameInput = document.getElementById('puzzle-name-input');
    const brandInput = document.getElementById('puzzle-brand-input');
    const piecesInput = document.getElementById('puzzle-pieces-input');
    
    const name = nameInput.value.trim();
    
    if (!name) {
      nameInput.focus();
      return;
    }
    
    const puzzle = {
      id: generateId(),
      name,
      brand: brandInput.value.trim() || null,
      pieces: piecesInput.value ? parseInt(piecesInput.value) : null,
      createdAt: Date.now(),
      sessions: []
    };
    
    await savePuzzle(puzzle);
    nameInput.value = '';
    brandInput.value = '';
    piecesInput.value = '';
    
    const puzzles = await getPuzzles();
    renderPuzzleList(puzzles);
  });
  
  // 添加拼图（名称输入框回车）
  document.getElementById('puzzle-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('add-puzzle-btn').click();
    }
  });
  
  // 品牌和片数输入框回车也触发添加
  document.getElementById('puzzle-brand-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('add-puzzle-btn').click();
    }
  });
  
  document.getElementById('puzzle-pieces-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('add-puzzle-btn').click();
    }
  });
  
  document.getElementById('puzzle-list').addEventListener('click', async (e) => {
    // 检查是否点击的是删除按钮
    const deleteBtn = e.target.closest('.btn-delete-item');
    if (deleteBtn) {
      e.stopPropagation();
      const puzzleId = deleteBtn.dataset.id;
      const puzzle = await getPuzzleById(puzzleId);
      if (puzzle) {
        document.getElementById('delete-list-message').textContent = 
          `确定要删除"${puzzle.name}"吗？所有计时数据将被删除，此操作无法撤销。`;
        document.getElementById('modal-delete-list').classList.add('show');
        // 存储要删除的ID
        document.getElementById('confirm-delete-list').dataset.deleteId = puzzleId;
      }
      return;
    }
    
    // 检查是否点击的是拼图项
    const item = e.target.closest('.puzzle-item');
    if (!item) return;
    
    const id = item.dataset.id;
    currentPuzzle = await getPuzzleById(id);
    
    if (currentPuzzle) {
      document.getElementById('detail-title').textContent = currentPuzzle.name;
      
      // 显示拼图信息
      const infoCard = document.getElementById('puzzle-info-card');
      const brandEl = document.getElementById('puzzle-brand');
      const piecesEl = document.getElementById('puzzle-pieces');
      
      if (currentPuzzle.brand || currentPuzzle.pieces) {
        infoCard.style.display = 'flex';
        brandEl.textContent = currentPuzzle.brand || '-';
        piecesEl.textContent = currentPuzzle.pieces ? `${currentPuzzle.pieces}片` : '-';
      } else {
        infoCard.style.display = 'none';
      }
      
      updateStats();
      renderSessions();
      showPage('page-detail');
    }
  });
  
  // 列表删除确认
  document.getElementById('cancel-delete-list').addEventListener('click', () => {
    hideModal('modal-delete-list');
  });
  
  document.getElementById('confirm-delete-list').addEventListener('click', async () => {
    const deleteId = document.getElementById('confirm-delete-list').dataset.deleteId;
    if (deleteId) {
      await deletePuzzle(deleteId);
      hideModal('modal-delete-list');
      
      // 如果当前在详情页且删除的是当前拼图，返回首页
      if (currentPuzzle && currentPuzzle.id === deleteId) {
        currentPuzzle = null;
        if (timerInterval) {
          stopTimer();
        }
        showPage('page-home');
      }
      
      const puzzles = await getPuzzles();
      renderPuzzleList(puzzles);
    }
  });
  
  document.getElementById('back-btn').addEventListener('click', () => {
    if (timerInterval) {
      stopTimer();
    }
    currentPuzzle = null;
    showPage('page-home');
  });
  
  document.getElementById('delete-btn').addEventListener('click', () => {
    showModal('modal-delete');
  });
  
  document.getElementById('cancel-delete').addEventListener('click', () => {
    hideModal('modal-delete');
  });
  
  document.getElementById('confirm-delete').addEventListener('click', async () => {
    if (currentPuzzle) {
      await deletePuzzle(currentPuzzle.id);
      hideModal('modal-delete');
      currentPuzzle = null;
      
      const puzzles = await getPuzzles();
      renderPuzzleList(puzzles);
      showPage('page-home');
    }
  });
  
  document.getElementById('timer-btn').addEventListener('click', () => {
    if (timerInterval) {
      stopTimer();
    } else {
      startTimer();
    }
  });
  
  document.getElementById('countdown-enabled').addEventListener('change', (e) => {
    const options = document.getElementById('countdown-options');
    if (e.target.checked) {
      options.classList.add('show');
    } else {
      options.classList.remove('show');
      stopCountdown();
      document.getElementById('countdown-time').textContent = '--:--:--';
      document.getElementById('countdown-time').classList.remove('warning', 'danger');
    }
  });
  
  document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      countdownMinutes = parseInt(btn.dataset.minutes);
    });
  });
  
  document.getElementById('set-custom-btn').addEventListener('click', () => {
    const customInput = document.getElementById('custom-minutes-input');
    const minutes = parseInt(customInput.value);
    
    if (!minutes || minutes < 1) {
      customInput.focus();
      return;
    }
    
    // 清除预设按钮的激活状态
    document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
    countdownMinutes = minutes;
    
    // 可以给用户一个视觉反馈
    const btn = document.getElementById('set-custom-btn');
    const originalText = btn.textContent;
    btn.textContent = '已设置';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 1000);
  });
  
  document.getElementById('close-reminder').addEventListener('click', () => {
    hideModal('modal-reminder');
  });
  
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && timerInterval) {
      stopTimer();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}