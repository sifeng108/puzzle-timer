// ================================
// 常量定义
// ================================
const DB_NAME = 'PuzzleTimerDB';
const DB_VERSION = 1;
const DEFAULT_COUNTDOWN_MINUTES = 15;
const TIMER_UPDATE_INTERVAL = 1000; // 1秒

// ================================
// 全局状态变量
// ================================
let db = null;
let currentPuzzle = null;
let timerInterval = null;
let countdownInterval = null;
let currentSession = null;
let countdownEndTime = null;
let countdownMinutes = DEFAULT_COUNTDOWN_MINUTES;

// ================================
// 工具函数
// ================================

// 错误处理工具函数
function handleError(error, context = 'Unknown') {
  console.error(`[${context}] Error:`, error);
  
  // 在生产环境中，可以发送错误到监控服务
  // 这里仅记录到控制台
  if (typeof error === 'object' && error.message) {
    console.error(`Error message: ${error.message}`);
  }
  
  // 可以添加用户友好的错误提示
  // showToast(`操作失败: ${context}`);
}

// 安全执行函数，捕获并处理异常
function safeExecute(fn, context = 'Unknown') {
  try {
    return fn();
  } catch (error) {
    handleError(error, context);
    return null;
  }
}

// 异步安全执行
async function safeExecuteAsync(fn, context = 'Unknown') {
  try {
    return await fn();
  } catch (error) {
    handleError(error, context);
    return null;
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
      console.error('DB open error:', request.error);
      reject(request.error);
    };
    
    request.onsuccess = () => {
      db = request.result;
      console.log('Database initialized successfully');
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

// 播放提示音（使用Web Audio API生成）
function playSound() {
  return safeExecute(() => {
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
  }, 'playSound');
}

// 播放防沉迷结束提示音（更响亮、更醒目）
function playAlarmSound() {
  return safeExecute(() => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // 创建第一个振荡器 - 高音提示
    const oscillator1 = audioContext.createOscillator();
    const gainNode1 = audioContext.createGain();
    oscillator1.connect(gainNode1);
    gainNode1.connect(audioContext.destination);
    
    oscillator1.frequency.setValueAtTime(1000, audioContext.currentTime);
    oscillator1.frequency.setValueAtTime(1200, audioContext.currentTime + 0.2);
    oscillator1.frequency.setValueAtTime(1000, audioContext.currentTime + 0.4);
    
    gainNode1.gain.setValueAtTime(0.4, audioContext.currentTime);
    gainNode1.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.6);
    
    oscillator1.start(audioContext.currentTime);
    oscillator1.stop(audioContext.currentTime + 0.6);
    
    // 创建第二个振荡器 - 低音配合
    const oscillator2 = audioContext.createOscillator();
    const gainNode2 = audioContext.createGain();
    oscillator2.connect(gainNode2);
    gainNode2.connect(audioContext.destination);
    
    oscillator2.type = 'sine';
    oscillator2.frequency.setValueAtTime(500, audioContext.currentTime);
    oscillator2.frequency.setValueAtTime(600, audioContext.currentTime + 0.2);
    oscillator2.frequency.setValueAtTime(500, audioContext.currentTime + 0.4);
    
    gainNode2.gain.setValueAtTime(0.2, audioContext.currentTime);
    gainNode2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.6);
    
    oscillator2.start(audioContext.currentTime);
    oscillator2.stop(audioContext.currentTime + 0.6);
  }, 'playAlarmSound');
}

// 请求通知权限
async function requestNotificationPermission() {
  if ('Notification' in window) {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
  return false;
}

// 发送系统通知（模拟闹铃效果）
function sendAlarmNotification() {
  return safeExecute(async () => {
    if (!('Notification' in window)) {
      console.log('当前浏览器不支持通知功能');
      return;
    }
    
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('用户未授权通知权限');
      return;
    }
    
    // 创建通知
    const notification = new Notification('拼图计时器', {
      body: '防沉迷时间已到！休息一下吧！',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      sound: 'default',
      vibrate: [200, 100, 200, 100, 200],
      requireInteraction: true,
      tag: 'puzzle-timer-alarm'
    });
    
    // 点击通知时聚焦到应用
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    
    return notification;
  }, 'sendAlarmNotification');
}

function savePuzzle(puzzle) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['puzzles'], 'readwrite');
    const store = transaction.objectStore('puzzles');
    const request = store.put(puzzle);
    
    request.onsuccess = () => {
      setTimeout(() => resolve(puzzle), 0);
    };
    request.onerror = () => reject(request.error);
  });
}

function getPuzzles() {
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

function deletePuzzle(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['puzzles'], 'readwrite');
    const store = transaction.objectStore('puzzles');
    const request = store.delete(id);
    
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    request.onerror = () => reject(request.error);
  });
}

function renderPuzzleList(puzzles) {
  console.log('renderPuzzleList called with puzzles:', puzzles);
  const listContainer = document.getElementById('puzzle-list');
  
  // 使用更安全的方式清空列表容器
  while (listContainer.firstChild) {
    listContainer.removeChild(listContainer.firstChild);
  }
  
  if (puzzles.length === 0) {
    console.log('No puzzles found, showing empty state');
    // 创建并显示空状态 - 使用DOM API替代innerHTML
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-state';
    emptyDiv.id = 'empty-state';
    
    const iconDiv = document.createElement('div');
    iconDiv.className = 'empty-icon';
    iconDiv.textContent = '🧩';
    
    const messageP = document.createElement('p');
    messageP.textContent = '还没有拼图记录';
    
    const hintP = document.createElement('p');
    hintP.className = 'empty-hint';
    hintP.textContent = '点击上方输入框添加第一个拼图';
    
    emptyDiv.appendChild(iconDiv);
    emptyDiv.appendChild(messageP);
    emptyDiv.appendChild(hintP);
    listContainer.appendChild(emptyDiv);
  } else {
    console.log(`Rendering ${puzzles.length} puzzles`);
    
    // 渲染拼图列表 - 使用DOM API替代innerHTML
    puzzles.forEach(puzzle => {
      const totalTime = formatTime(getTotalTime(puzzle));
      let subtitle = '';
      if (puzzle.brand && puzzle.pieces) {
        subtitle = `${puzzle.brand} · ${puzzle.pieces}片`;
      } else if (puzzle.brand) {
        subtitle = puzzle.brand;
      } else if (puzzle.pieces) {
        subtitle = `${puzzle.pieces}片`;
      }
      
      const itemDiv = document.createElement('div');
      itemDiv.className = 'puzzle-item';
      itemDiv.dataset.id = puzzle.id;
      
      const mainDiv = document.createElement('div');
      mainDiv.className = 'puzzle-item-main';
      
      const nameDiv = document.createElement('div');
      nameDiv.className = 'puzzle-item-name';
      nameDiv.textContent = puzzle.name;
      
      mainDiv.appendChild(nameDiv);
      
      if (subtitle) {
        const subtitleDiv = document.createElement('div');
        subtitleDiv.className = 'puzzle-item-subtitle';
        subtitleDiv.textContent = subtitle;
        mainDiv.appendChild(subtitleDiv);
      }
      
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'puzzle-item-actions';
      
      const timeSpan = document.createElement('span');
      timeSpan.className = 'puzzle-item-time';
      timeSpan.textContent = totalTime;
      
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-delete-item';
      deleteBtn.dataset.id = puzzle.id;
      deleteBtn.title = '删除拼图';
      deleteBtn.textContent = '×';
      
      actionsDiv.appendChild(timeSpan);
      actionsDiv.appendChild(deleteBtn);
      
      itemDiv.appendChild(mainDiv);
      itemDiv.appendChild(actionsDiv);
      
      listContainer.appendChild(itemDiv);
    });
  }
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
  
  // 清空会话列表
  while (sessionList.firstChild) {
    sessionList.removeChild(sessionList.firstChild);
  }
  
  if (!currentPuzzle || !currentPuzzle.sessions || currentPuzzle.sessions.length === 0) {
    // 使用DOM API创建空状态
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-sessions';
    
    const emptyP = document.createElement('p');
    emptyP.textContent = '暂无分段记录';
    
    emptyDiv.appendChild(emptyP);
    sessionList.appendChild(emptyDiv);
    return;
  }
  
  const sessions = [...currentPuzzle.sessions].reverse();
  
  // 使用DOM API创建会话项
  sessions.forEach(session => {
    const sessionItem = document.createElement('div');
    sessionItem.className = 'session-item';
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'session-time';
    timeDiv.textContent = formatTime(session.duration);
    
    const dateDiv = document.createElement('div');
    dateDiv.className = 'session-date';
    dateDiv.textContent = formatDate(session.startTime);
    
    sessionItem.appendChild(timeDiv);
    sessionItem.appendChild(dateDiv);
    
    sessionList.appendChild(sessionItem);
  });
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
  }, TIMER_UPDATE_INTERVAL);
  
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
  }, TIMER_UPDATE_INTERVAL);
  
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
  
  // 重置后台计时状态
  backgroundTimerStart = null;
  backgroundTimerPaused = false;
  
  if (currentSession) {
    currentSession.endTime = Date.now();
    currentSession.duration = currentSession.endTime - currentSession.startTime;
  }
  
  savePuzzle(currentPuzzle).then(() => {
    updateStats();
    renderSessions();
    // 刷新拼图列表（更新总时间显示）
    getPuzzles().then(renderPuzzleList);
  });
  
  document.getElementById('current-time').textContent = '00:00:00';
  document.getElementById('timer-btn').textContent = '开始计时';
  document.getElementById('timer-btn').classList.remove('stop');
  document.getElementById('timer-btn').classList.add('start');
  
  document.getElementById('countdown-time').textContent = '--:--:--';
  document.getElementById('countdown-time').classList.remove('warning', 'danger');
}

// ================================
// 屏幕常亮和后台计时功能
// ================================

// 请求屏幕常亮权限
async function requestScreenWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      const wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        console.log('屏幕常亮已释放');
      });
      return wakeLock;
    } catch (err) {
      console.log('无法获取屏幕常亮:', err.message);
    }
  } else {
    console.log('当前浏览器不支持屏幕常亮API');
  }
  return null;
}

// 后台计时状态
let backgroundTimerStart = null;
let backgroundTimerPaused = false;

// 处理应用进入后台
function handleAppBackground() {
  if (!currentSession || !timerInterval) return;
  
  // 记录进入后台的时间
  backgroundTimerStart = Date.now();
  backgroundTimerPaused = false;
  
  // 尝试请求屏幕常亮（虽然进入后台后通常会失效）
  requestScreenWakeLock();
  
  console.log('应用进入后台，继续后台计时');
}

// 处理应用恢复前台
function handleAppForeground() {
  if (!currentSession || !backgroundTimerStart || backgroundTimerPaused) return;
  
  // 计算后台停留时间
  const backgroundDuration = Date.now() - backgroundTimerStart;
  
  // 更新当前会话的持续时间
  currentSession.duration += backgroundDuration;
  
  // 更新总时间显示
  updateStats();
  
  // 更新当前时间显示
  document.getElementById('current-time').textContent = formatTime(currentSession.duration);
  
  // 检查倒计时是否在后台期间结束
  if (countdownInterval && countdownEndTime) {
    const remaining = countdownEndTime - Date.now();
    if (remaining <= 0) {
      stopCountdown();
      showReminder();
    } else {
      document.getElementById('countdown-time').textContent = formatTime(remaining);
    }
  }
  
  console.log(`应用恢复前台，后台计时 ${formatTime(backgroundDuration)}`);
  
  // 重置后台计时状态
  backgroundTimerStart = null;
}

function showReminder() {
  // 播放防沉迷结束提示音（更响亮、更醒目）
  playAlarmSound();
  
  // 发送系统通知（模拟闹铃效果）
  sendAlarmNotification();
  
  // 显示弹窗提醒
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
  
  // 刷新按钮
  document.getElementById('refresh-btn').addEventListener('click', async () => {
    try {
      const puzzles = await getPuzzles();
      renderPuzzleList(puzzles);
    } catch (e) {
      console.error('Refresh error:', e);
    }
  });
  
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
    
    // 等待数据写入完成
    setTimeout(async () => {
      const puzzles = await getPuzzles();
      renderPuzzleList(puzzles);
    }, 50);
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
    if (document.hidden) {
      // 应用进入后台
      handleAppBackground();
    } else {
      // 应用恢复前台
      handleAppForeground();
    }
  });
  
  // 监听页面隐藏（用于iOS）
  document.addEventListener('webkitvisibilitychange', () => {
    if (document.webkitHidden) {
      handleAppBackground();
    } else {
      handleAppForeground();
    }
  });
  
  // 监听应用被挂起
  window.addEventListener('blur', handleAppBackground);
  window.addEventListener('focus', handleAppForeground);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}