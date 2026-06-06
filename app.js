/* ================================================================
   每日任务管理 PWA — 全部逻辑
   ================================================================ */

// ==================== 数据库 (IndexedDB) ====================
let db;
const DB_NAME = 'DailyPlannerDB';
const DB_VER = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('tasks')) {
        const ts = d.createObjectStore('tasks', { keyPath: 'id' });
        ts.createIndex('targetDate', 'targetDate', { unique: false });
      }
      if (!d.objectStoreNames.contains('anniversaries')) {
        d.createObjectStore('anniversaries', { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

// ==================== 任务 CRUD ====================
function getTasks(date) {
  return new Promise((resolve) => {
    const tx = db.transaction('tasks', 'readonly');
    const store = tx.objectStore('tasks');
    const idx = store.index('targetDate');
    const req = idx.getAll(date);
    req.onsuccess = () => {
      // 优先级高的在前
      const list = req.result.sort((a, b) => b.priority - a.priority);
      resolve(list);
    };
  });
}

function saveTask(task) {
  return new Promise((resolve) => {
    const tx = db.transaction('tasks', 'readwrite');
    tx.objectStore('tasks').put(task);
    tx.oncomplete = resolve;
  });
}

function deleteTask(id) {
  return new Promise((resolve) => {
    const tx = db.transaction('tasks', 'readwrite');
    tx.objectStore('tasks').delete(id);
    tx.oncomplete = resolve;
  });
}

function toggleTaskComplete(task) {
  task.isCompleted = !task.isCompleted;
  task.completedAt = task.isCompleted ? new Date().toISOString() : null;
  return saveTask(task);
}

// ==================== 纪念日 CRUD ====================
function getAnniversaries() {
  return new Promise((resolve) => {
    const tx = db.transaction('anniversaries', 'readonly');
    const req = tx.objectStore('anniversaries').getAll();
    req.onsuccess = () => {
      const list = req.result;
      // 按距今日期排序
      list.sort((a, b) => daysUntil(a) - daysUntil(b));
      resolve(list);
    };
  });
}

function saveAnniversary(a) {
  return new Promise((resolve) => {
    const tx = db.transaction('anniversaries', 'readwrite');
    tx.objectStore('anniversaries').put(a);
    tx.oncomplete = resolve;
  });
}

function deleteAnniversary(id) {
  return new Promise((resolve) => {
    const tx = db.transaction('anniversaries', 'readwrite');
    tx.objectStore('anniversaries').delete(id);
    tx.oncomplete = resolve;
  });
}

// ==================== 工具函数 ====================
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function pad(n) { return String(n).padStart(2, '0'); }

function formatDateCN(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const w = ['周日','周一','周二','周三','周四','周五','周六'];
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日  ${w[d.getDay()]}`;
}

function daysUntil(a) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next;
  if (a.isAnnual) {
    next = new Date(now.getFullYear(), a.month - 1, a.day);
    if (next <= today) {
      next = new Date(now.getFullYear() + 1, a.month - 1, a.day);
    }
  } else {
    const createdYear = new Date(a.createdAt).getFullYear();
    next = new Date(createdYear, a.month - 1, a.day);
  }
  return Math.floor((next - today) / 86400000);
}

function uuid() {
  return 'xxxx-xxxx-xxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  ) + '-' + Date.now().toString(36);
}

// ==================== 全局状态 ====================
let selectedDate = todayStr();
let dateStripCenter = new Date(); // 日期条中心日期（可无限滚动）
let pendingDelete = null; // { type:'task'|'anni', id }

// ==================== 渲染 ====================
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// 日期选择器
function renderDateStrip() {
  const strip = $('#dateStrip');
  const today = new Date();
  const todayStrVal = todayStr();
  const dates = [];

  // 以 dateStripCenter 为中心，前后各 3 天
  for (let i = -3; i <= 3; i++) {
    const d = new Date(dateStripCenter);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }

  strip.innerHTML = dates.map(d => {
    const ds = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const todayClass = ds === todayStrVal ? ' today' : '';
    const activeClass = ds === selectedDate ? ' active' : '';
    const weekdays = ['日','一','二','三','四','五','六'];
    const label = ds === todayStrVal ? '今天' : `周${weekdays[d.getDay()]}`;
    return `<button class="date-chip${todayClass}${activeClass}" data-date="${ds}">
      <span class="day-label">${label}</span>
      <span class="day-date">${d.getMonth()+1}/${d.getDate()}</span>
    </button>`;
  }).join('');

  // 滚动到选中日期居中
  const activeChip = strip.querySelector('.active');
  if (activeChip) {
    activeChip.scrollIntoView({ inline: 'center', behavior: 'smooth' });
  }

  // 点击事件
  strip.querySelectorAll('.date-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      selectedDate = chip.dataset.date;
      renderDateStrip();
      loadTasks();
    });
  });
}

// 日期条左右滚动
function shiftDate(days) {
  dateStripCenter.setDate(dateStripCenter.getDate() + days);
  renderDateStrip();
}

// 回到今天
function goToday() {
  dateStripCenter = new Date();
  selectedDate = todayStr();
  renderDateStrip();
  loadTasks();
}

// 任务列表
async function loadTasks() {
  $('#currentDateDisplay').textContent = formatDateCN(selectedDate);
  const tasks = await getTasks(selectedDate);
  const list = $('#taskList');
  const stats = $('#statsBar');

  if (tasks.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-title">暂无任务</div>
      <div class="empty-sub">点击右下角 ＋ 按钮添加新任务</div>
    </div>`;
    stats.style.display = 'none';
  } else {
    const done = tasks.filter(t => t.isCompleted).length;
    const todo = tasks.length - done;
    $('#doneCount').textContent = done;
    $('#todoCount').textContent = todo;
    stats.style.display = '';

    list.innerHTML = tasks.map(t => {
      const priClass = ['pri-low','pri-mid','pri-high'][t.priority] || 'pri-mid';
      const priLabel = ['低','中','高'][t.priority] || '中';
      return `<div class="task-item${t.isCompleted?' done':''}" data-id="${t.id}">
        <div class="checkbox" data-toggle="${t.id}">${t.isCompleted ? '✓' : ''}</div>
        <div class="task-info">
          <div class="task-title">${esc(t.title)}</div>
          <div class="task-desc">${esc(t.description||'')}</div>
        </div>
        <span class="pri-badge ${priClass}">${priLabel}</span>
        <div class="delete-action" data-delete="${t.id}">删除</div>
      </div>`;
    }).join('');

    // 点击复选框
    list.querySelectorAll('.checkbox').forEach(cb => {
      cb.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = cb.dataset.toggle;
        const task = tasks.find(t => t.id === id);
        if (task) {
          await toggleTaskComplete(task);
          loadTasks();
        }
      });
    });

    // 点击任务编辑
    list.querySelectorAll('.task-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.checkbox') || e.target.closest('.delete-action')) return;
        const id = item.dataset.id;
        const task = tasks.find(t => t.id === id);
        if (task) openTaskEdit(task);
      });
    });

    // 左滑删除
    list.querySelectorAll('.delete-action').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.delete;
        pendingDelete = { type: 'task', id };
        $('#confirmMsg').textContent = '确定要删除这个任务吗？';
        $('#confirmDialog').showModal();
      });
    });
  }
}

// 纪念日列表
async function loadAnniversaries() {
  const annis = await getAnniversaries();
  const list = $('#anniList');

  if (annis.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🎂</div>
      <div class="empty-title">暂无纪念日</div>
      <div class="empty-sub">点击右下角 ＋ 按钮添加纪念日</div>
    </div>`;
  } else {
    list.innerHTML = annis.map(a => {
      const days = daysUntil(a);
      let cls, countCls, countText;
      if (days > 7) { cls = 'near'; countCls = 'countdown-near'; countText = `还有 ${days} 天`; }
      else if (days > 0) { cls = 'soon'; countCls = 'countdown-soon'; countText = `还有 ${days} 天`; }
      else if (days === 0) { cls = 'today-box'; countCls = 'countdown-today'; countText = '🎉 今天！'; }
      else { cls = 'past'; countCls = 'countdown-past'; countText = `已过 ${-days} 天`; }

      return `<div class="anni-item" data-id="${a.id}">
        <div class="anni-date-box ${cls}">
          <span class="m">${a.month}月</span>
          <span class="d">${a.day}</span>
        </div>
        <div class="anni-info">
          <div class="anni-title">${esc(a.title)}</div>
          <div class="anni-type">${a.isAnnual ? '每年' : '一次性'}</div>
          ${a.description ? `<div class="anni-desc">${esc(a.description)}</div>` : ''}
        </div>
        <span class="anni-countdown ${countCls}">${countText}</span>
      </div>`;
    }).join('');

    // 点击编辑
    list.querySelectorAll('.anni-item').forEach(item => {
      item.addEventListener('click', () => {
        const a = annis.find(x => x.id === item.dataset.id);
        if (a) openAnniEdit(a);
      });
    });

    // 长按删除
    list.querySelectorAll('.anni-item').forEach(item => {
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const id = item.dataset.id;
        pendingDelete = { type: 'anni', id };
        $('#confirmMsg').textContent = '确定要删除这个纪念日吗？';
        $('#confirmDialog').showModal();
      });
    });
  }
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ==================== 弹窗逻辑 ====================

// -- 任务编辑 --
function openTaskEdit(task) {
  $('#taskDialogTitle').textContent = task ? '编辑任务' : '新建任务';
  $('#taskId').value = task ? task.id : '';
  $('#taskTitle').value = task ? task.title : '';
  $('#taskDesc').value = task ? (task.description || '') : '';
  $('#taskDate').value = task ? task.targetDate : selectedDate;
  $('#taskDatePicker').value = task ? task.targetDate : selectedDate;

  const pri = task ? task.priority : 1;
  const priMap = { 2: 'priHigh', 1: 'priMid', 0: 'priLow' };
  const radio = document.getElementById(priMap[pri]);
  if (radio) radio.checked = true;

  $('#taskDialog').showModal();
}

function closeTaskDialog() {
  $('#taskDialog').close();
}

// 监听 taskDatePicker 变化，同步到隐藏字段
$('#taskDatePicker').addEventListener('change', function() {
  $('#taskDate').value = this.value;
});

// 任务表单提交
$('#taskForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const id = $('#taskId').value;
  const now = new Date().toISOString();
  const task = {
    id: id || uuid(),
    title: $('#taskTitle').value.trim(),
    description: $('#taskDesc').value.trim() || null,
    priority: parseInt(document.querySelector('input[name="priority"]:checked')?.value || '1'),
    targetDate: $('#taskDatePicker').value || selectedDate,
    isCompleted: false,
    createdAt: now,
    completedAt: null,
  };
  // 编辑时保留原状态
  if (id) {
    const existing = (await getTasks(selectedDate)).find(t => t.id === id);
    if (existing) {
      task.isCompleted = existing.isCompleted;
      task.completedAt = existing.completedAt;
      task.createdAt = existing.createdAt;
    }
  }
  await saveTask(task);
  $('#taskDialog').close();
  loadTasks();
});

// -- 纪念日编辑 --
function fillAnniSelects() {
  const mSel = $('#anniMonth');
  mSel.innerHTML = Array.from({length:12}, (_,i) =>
    `<option value="${i+1}">${i+1}月</option>`).join('');
  const dSel = $('#anniDay');
  dSel.innerHTML = Array.from({length:31}, (_,i) =>
    `<option value="${i+1}">${i+1}日</option>`).join('');
}

function openAnniEdit(anni) {
  fillAnniSelects();
  $('#anniDialogTitle').textContent = anni ? '编辑纪念日' : '新建纪念日';
  $('#anniId').value = anni ? anni.id : '';
  $('#anniTitle').value = anni ? anni.title : '';
  $('#anniDesc').value = anni ? (anni.description || '') : '';
  $('#anniMonth').value = anni ? anni.month : new Date().getMonth() + 1;
  $('#anniDay').value = anni ? anni.day : new Date().getDate();
  document.querySelector('input[name="isAnnual"][value="' + (anni ? (anni.isAnnual ? '1' : '0') : '1') + '"]').checked = true;
  $('#reminderDays').value = anni ? anni.reminderDaysBefore : 0;
  $('#anniDialog').showModal();
}

function closeAnniDialog() {
  $('#anniDialog').close();
}

$('#anniForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const id = $('#anniId').value;
  const now = new Date().toISOString();
  const anni = {
    id: id || uuid(),
    title: $('#anniTitle').value.trim(),
    description: $('#anniDesc').value.trim() || null,
    month: parseInt($('#anniMonth').value),
    day: parseInt($('#anniDay').value),
    isAnnual: document.querySelector('input[name="isAnnual"]:checked')?.value === '1',
    reminderDaysBefore: parseInt($('#reminderDays').value),
    createdAt: id ? (await findAnniById(id))?.createdAt || now : now,
  };
  await saveAnniversary(anni);
  $('#anniDialog').close();
  loadAnniversaries();
  // 重新预约通知
  scheduleAllNotifications();
});

async function findAnniById(id) {
  const all = await getAnniversaries();
  return all.find(a => a.id === id);
}

// -- 确认删除 --
function closeConfirm() {
  $('#confirmDialog').close();
  pendingDelete = null;
}

$('#confirmDialog').addEventListener('submit', async function(e) {
  e.preventDefault();
  if (pendingDelete) {
    if (pendingDelete.type === 'task') {
      await deleteTask(pendingDelete.id);
      loadTasks();
    } else {
      await deleteAnniversary(pendingDelete.id);
      loadAnniversaries();
    }
  }
  pendingDelete = null;
  $('#confirmDialog').close();
});

// ==================== 标签切换 ====================
function switchTab(tab) {
  if (tab === 'tasks') {
    $('#homeScreen').style.display = '';
    $('#anniversaryScreen').style.display = 'none';
    $$('.nav-btn')[0].classList.add('active');
    $$('.nav-btn')[1].classList.remove('active');
    loadTasks();
  } else {
    $('#homeScreen').style.display = 'none';
    $('#anniversaryScreen').style.display = '';
    $$('.nav-btn')[0].classList.remove('active');
    $$('.nav-btn')[1].classList.add('active');
    loadAnniversaries();
  }
}

// ==================== 通知 ====================
function scheduleAllNotifications() {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then(perm => {
    if (perm !== 'granted') return;
    getAnniversaries().then(annis => {
      annis.forEach(a => {
        const days = daysUntil(a);
        const notifyDays = a.reminderDaysBefore || 0;
        if (days > notifyDays) {
          // 用 setTimeout 预约（简化方案）
          // 实际 PWA 中可以用 Notification API + 定时检查
          scheduleOne(a, days - notifyDays);
        }
      });
    });
  });
}

function scheduleOne(anni, delayDays) {
  if (delayDays <= 0 || delayDays > 30) return; // 只预约 30 天内的
  const ms = delayDays * 86400000;
  const fireAt = new Date(Date.now() + ms);
  // 设为早上 8 点
  fireAt.setHours(8, 0, 0, 0);

  const delay = fireAt.getTime() - Date.now();
  if (delay <= 0) return;

  setTimeout(() => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`🎂 ${anni.title}`, {
        body: `今天是${anni.month}月${anni.day}日，别忘了哦！`,
        icon: '/icons/icon-192.png',
      });
    }
  }, delay);
}

// ==================== 初始化 ====================
async function init() {
  await openDB();

  // 请求通知权限
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  renderDateStrip();
  await loadTasks();
  await scheduleAllNotifications();

  // 注册 Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();

// ==================== 移动端左滑删除手势 ====================
let touchStartX = 0;
let touchCurrentItem = null;

document.addEventListener('touchstart', (e) => {
  const item = e.target.closest('.task-item');
  if (!item) return;
  touchStartX = e.touches[0].clientX;
  touchCurrentItem = item;
  // 重置其他项
  $$('.task-item.swiped').forEach(el => {
    if (el !== item) el.classList.remove('swiped');
  });
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!touchCurrentItem) return;
  const dx = touchStartX - e.touches[0].clientX;
  if (dx > 30) {
    touchCurrentItem.classList.add('swiped');
  } else if (dx < -10) {
    touchCurrentItem.classList.remove('swiped');
  }
}, { passive: true });
