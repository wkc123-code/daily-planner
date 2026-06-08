/* ================================================================
   每日任务管理 PWA — 2.0  (重复任务 + 分类 + 提醒)
   ================================================================ */

// ==================== 原生通知桥接 ====================
function sendNotification(title, body) {
  dbg('发送通知: '+title);
  if (typeof AndroidReminder !== 'undefined' && AndroidReminder.showNotification) {
    try { AndroidReminder.showNotification(title, body); dbg('✅ Android原生通知已发送'); return; } catch(e) { dbg('Android桥接失败: '+e); }
  } else {
    dbg('AndroidReminder不可用, 回退浏览器');
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body: body, icon: 'icons/icon-192.png', tag: 'reminder' });
    dbg('✅ 浏览器通知已发送');
  } else {
    dbg('浏览器通知也不可用: '+(typeof Notification)+' perm='+(('Notification' in window)?Notification.permission:'N/A'));
  }
}

// ==================== 数据库 (IndexedDB v2) ====================
let db;
const DB_NAME = 'DailyPlannerDB';
const DB_VER = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('tasks')) {
        const ts = d.createObjectStore('tasks', { keyPath: 'id' });
        ts.createIndex('targetDate', 'targetDate', { unique: false });
      } else {
        const tx = e.target.transaction;
        const store = tx.objectStore('tasks');
        store.openCursor().onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor) return;
          const t = cursor.value;
          let changed = false;
          if (t.repeatType === undefined) { t.repeatType = 'none'; changed = true; }
          if (t.category === undefined) { t.category = '默认'; changed = true; }
          if (t.reminderTime === undefined) { t.reminderTime = ''; changed = true; }
          if (t.reminderEnabled === undefined) { t.reminderEnabled = false; changed = true; }
          if (t.reminderOffset === undefined) { t.reminderOffset = 5; changed = true; }
          if (changed) cursor.update(t);
          cursor.continue();
        };
      }
      if (!d.objectStoreNames.contains('anniversaries')) {
        d.createObjectStore('anniversaries', { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

// ==================== 分类管理 ====================
function getCategories() {
  const raw = localStorage.getItem('categories');
  if (raw) return JSON.parse(raw);
  return ['工作', '日常', '健身'];
}
function saveCategories(cats) { localStorage.setItem('categories', JSON.stringify(cats)); }
function addCategory(name) {
  const cats = getCategories();
  if (!cats.includes(name)) { cats.push(name); saveCategories(cats); }
  return cats;
}
function deleteCategory(name) {
  let cats = getCategories();
  if (cats.length <= 1) { alert('至少保留一个分类'); return cats; }
  cats = cats.filter(c => c !== name);
  saveCategories(cats);
  const fallback = cats[0];
  getAllTasksRaw().then(tasks => {
    tasks.filter(t => t.category === name).forEach(t => { t.category = fallback; saveTask(t); });
  });
  return cats;
}

// ==================== 任务 CRUD ====================
function getAllTasksRaw() {
  return new Promise((resolve) => {
    const tx = db.transaction('tasks', 'readonly');
    tx.objectStore('tasks').getAll().onsuccess = (e) => resolve(e.target.result);
  });
}

function getTasks(date, category) {
  return new Promise(async (resolve) => {
    const all = await getAllTasksRaw();
    const d = new Date(date + 'T00:00:00');
    const dayOfWeek = d.getDay();
    const cat = category || currentCategory;
    const result = all.filter(t => {
      if (t.category !== cat) return false;
      const dateMatch = t.targetDate === date;
      if (dateMatch) return true;
      return isRepeatMatch(t, date, dayOfWeek);
    });
    result.forEach(t => {
      t._displayDate = (t.targetDate === date || isRepeatMatch(t, date, dayOfWeek)) ? date : t.targetDate;
    });
    result.sort((a, b) => b.priority - a.priority);
    resolve(result);
  });
}

function isRepeatMatch(task, dateStr, dayOfWeek) {
  if (!task.repeatType || task.repeatType === 'none') return false;
  if (dateStr < task.targetDate) return false;
  switch (task.repeatType) {
    case 'weekdays': return dayOfWeek >= 1 && dayOfWeek <= 5;
    case 'daily': return true;
    case 'weekly': { const orig = new Date(task.targetDate + 'T00:00:00'); return orig.getDay() === dayOfWeek; }
    default: return false;
  }
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
  if (task._displayDate && task._displayDate !== task.targetDate) task.completedDate = task._displayDate;
  return saveTask(task);
}

// ==================== 纪念日 CRUD ====================
function getAnniversaries() {
  return new Promise((resolve) => {
    const tx = db.transaction('anniversaries', 'readonly');
    tx.objectStore('anniversaries').getAll().onsuccess = (e) => {
      const list = e.target.result;
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

// ==================== 工具 ====================
function todayStr() { const d = new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function pad(n) { return String(n).padStart(2,'0'); }
function formatDateCN(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const w = ['周日','周一','周二','周三','周四','周五','周六'];
  return d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日  '+w[d.getDay()];
}
function daysUntil(a) {
  const now = new Date();
  const today = new Date(now.getFullYear(),now.getMonth(),now.getDate());
  let next;
  if (a.isAnnual) { next = new Date(now.getFullYear(),a.month-1,a.day); if (next <= today) next = new Date(now.getFullYear()+1,a.month-1,a.day); }
  else { next = new Date(new Date(a.createdAt).getFullYear(),a.month-1,a.day); }
  return Math.floor((next - today)/86400000);
}
function uuid() { return 'xxxx-xxxx-xxxx'.replace(/x/g,()=>Math.floor(Math.random()*16).toString(16))+'-'+Date.now().toString(36); }

// ==================== 全局状态 ====================
let selectedDate = todayStr();
let dateStripCenter = new Date();
let currentCategory = getCategories()[0];
let pendingDelete = null;
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// ==================== 日期选择器 ====================
function renderDateStrip() {
  const strip = $('#dateStrip');
  const today = new Date();
  const todayStrVal = todayStr();
  const dates = [];
  for (let i = -2; i <= 2; i++) { const d = new Date(dateStripCenter); d.setDate(d.getDate()+i); dates.push(d); }
  strip.innerHTML = dates.map(d => {
    const ds = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
    const todayClass = ds === todayStrVal ? ' today' : '';
    const activeClass = ds === selectedDate ? ' active' : '';
    const wd = ['日','一','二','三','四','五','六'];
    const label = ds === todayStrVal ? '今天' : '周'+wd[d.getDay()];
    return '<button class="date-chip'+todayClass+activeClass+'" data-date="'+ds+'"><span class="day-label">'+label+'</span><span class="day-date">'+(d.getMonth()+1)+'/'+d.getDate()+'</span></button>';
  }).join('');
  const ac = strip.querySelector('.active'); if (ac) ac.scrollIntoView({inline:'center',behavior:'smooth'});
  strip.querySelectorAll('.date-chip').forEach(chip => { chip.addEventListener('click',()=>{ selectedDate=chip.dataset.date; renderDateStrip(); loadTasks(); }); });
}
function shiftDate(days) { dateStripCenter.setDate(dateStripCenter.getDate()+days); renderDateStrip(); }
function goToday() { dateStripCenter=new Date(); selectedDate=todayStr(); renderDateStrip(); loadTasks(); }

// ==================== 分类标签 ====================
function renderCategoryBar() {
  const cats = getCategories();
  const bar = $('#categoryBar');
  let html = '';
  cats.forEach(c => {
    html += '<div class="cat-wrap"><button class="cat-chip'+(c===currentCategory?' active':'')+'" data-cat="'+escAttr(c)+'">'+esc(c)+'</button><span class="cat-del" data-del="'+escAttr(c)+'" onclick="delCat(event,\''+escAttr(c)+'\')">×</span></div>';
  });
  html += '<button class="cat-chip cat-add" onclick="openAddCategory()">＋</button>';
  bar.innerHTML = html;

  bar.querySelectorAll('.cat-chip').forEach(chip => {
    if (chip.dataset.cat) {
      chip.addEventListener('click',()=>{ switchCategory(chip.dataset.cat); });
    }
  });

  // 长按显示删除 / 长按拖拽排序
  setupCategoryDrag(bar);
}

function switchCategory(cat) {
  if (currentCategory === cat) return;
  // 移除所有 active（触发缩小动画），再给新标签加 active（触发伸长动画）
  document.querySelectorAll('.cat-chip[data-cat]').forEach(c => c.classList.remove('active'));
  const newChip = document.querySelector('.cat-chip[data-cat="'+escAttr(cat)+'"]');
  if (newChip) newChip.classList.add('active');
  currentCategory = cat;
  // 等标签动画完成后再显示卡片
  setTimeout(loadTasks, 300);
}

function setupCategoryDrag(bar) {
  const wraps = bar.querySelectorAll('.cat-wrap');
  let dragEl = null, clone = null, startY = 0, startIdx = -1, currentIdx = -1;
  let longPressTimer, isDragging = false;

  wraps.forEach((wrap, idx) => {
    const delBtn = wrap.querySelector('.cat-del');

    wrap.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      startY = touch.clientY;
      startIdx = idx;
      isDragging = false;
      longPressTimer = setTimeout(() => {
        e.preventDefault();
        delBtn.style.display = 'flex';
      }, 500);
    }, {passive:false});

    wrap.addEventListener('touchmove', (e) => {
      const touch = e.touches[0];
      const dy = Math.abs(touch.clientY - startY);
      if (dy > 8) {
        // 手指移动了，取消待定的长按，开始拖拽
        clearTimeout(longPressTimer);
        if (!isDragging) {
          isDragging = true;
          dragEl = wrap;
          dragEl.style.opacity = '0.4';
          // 创建拖拽克隆
          clone = dragEl.cloneNode(true);
          clone.style.position = 'fixed';
          clone.style.zIndex = '999';
          clone.style.left = dragEl.getBoundingClientRect().left + 'px';
          clone.style.top = (touch.clientY - 20) + 'px';
          clone.style.width = dragEl.offsetWidth + 'px';
          clone.style.opacity = '0.9';
          clone.style.pointerEvents = 'none';
          clone.querySelector('.cat-del').style.display = 'none';
          document.body.appendChild(clone);
        }
        // 移动克隆
        if (clone) {
          clone.style.top = (touch.clientY - 20) + 'px';
          // 判断当前悬停在哪个位置
          const cats = getCategories();
          let newIdx = -1;
          wraps.forEach((w, i) => {
            const r = w.getBoundingClientRect();
            const mid = r.top + r.height / 2;
            if (touch.clientY > mid) newIdx = i;
          });
          if (newIdx !== -1 && newIdx !== currentIdx) {
            currentIdx = newIdx;
            // 高亮目标位置
            wraps.forEach(w => w.style.borderTop = 'none');
            if (currentIdx >= 0 && currentIdx < wraps.length) {
              wraps[currentIdx].style.borderTop = '2px solid var(--blue)';
            }
          }
        }
      }
    }, {passive:false});

    wrap.addEventListener('touchend', () => {
      clearTimeout(longPressTimer);
      if (!isDragging) {
        // 没拖动——显示/隐藏删除按钮
        delBtn.style.display = delBtn.style.display === 'flex' ? 'none' : 'flex';
      } else {
        // 拖拽结束——排序
        if (clone) { clone.remove(); clone = null; }
        wraps.forEach(w => { w.style.borderTop = 'none'; w.style.opacity = '1'; });
        if (dragEl) dragEl.style.opacity = '1';

        if (currentIdx >= 0 && currentIdx !== startIdx) {
          const cats = getCategories();
          const [moved] = cats.splice(startIdx, 1);
          cats.splice(currentIdx, 0, moved);
          saveCategories(cats);
          renderCategoryBar();
        }
        dragEl = null; currentIdx = -1; startIdx = -1; isDragging = false;
      }
    });

    wrap.addEventListener('contextmenu', (e) => { e.preventDefault(); });
  });

  // 点击空白处隐藏所有删除按钮
  document.addEventListener('click', (e) => {
    wraps.forEach(w => { w.querySelector('.cat-del').style.display = 'none'; });
  });
}

function delCat(e, cat) {
  e.stopPropagation();
  if (getCategories().length <= 1) { alert('至少保留一个分类'); return; }
  deleteCategory(cat);
  if (currentCategory === cat) currentCategory = getCategories()[0];
  renderCategoryBar();
  loadTasks();
}
function openAddCategory() { $('#catName').value=''; $('#catDialog').showModal(); }
function closeCatDialog() { $('#catDialog').close(); }
$('#catForm').addEventListener('submit', function(e){ e.preventDefault(); const name=$('#catName').value.trim(); if(name){ addCategory(name); renderCategoryBar(); loadTasks(); } $('#catDialog').close(); });

// ==================== 任务列表 ====================
async function loadTasks() {
  $('#currentDateDisplay').textContent = formatDateCN(selectedDate);
  const tasks = await getTasks(selectedDate, currentCategory);
  const list = $('#taskList');
  const stats = $('#statsBar');
  if (tasks.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">暂无任务</div><div class="empty-sub">点击 ＋ 添加新任务</div></div>';
    stats.style.display = 'none';
  } else {
    const done = tasks.filter(t=>t.isCompleted).length;
    $('#doneCount').textContent = done; $('#todoCount').textContent = tasks.length - done;
    stats.style.display = '';
    list.innerHTML = tasks.map((t,i) => {
      const pc = ['pri-low','pri-mid','pri-high'][t.priority]||'pri-mid';
      const pl = ['低','中','高'][t.priority]||'中';
      const rl = t.repeatType==='weekdays'?' 🔁工作日':t.repeatType==='daily'?' 🔁每天':t.repeatType==='weekly'?' 🔁每周':'';
      const delay = (i * 0.3).toFixed(1);
      return '<div class="task-item'+(t.isCompleted?' done':'')+'" data-id="'+t.id+'" style="animation-delay:'+delay+'s"><div class="checkbox" data-toggle="'+t.id+'">'+(t.isCompleted?'✓':'')+'</div><div class="task-info"><div class="task-title">'+esc(t.title)+rl+'</div><div class="task-desc">'+esc(t.description||'')+'</div></div><span class="pri-badge '+pc+'">'+pl+'</span><div class="delete-action" data-delete="'+t.id+'">删除</div></div>';
    }).join('');
    list.querySelectorAll('.checkbox').forEach(cb => { cb.addEventListener('click',async e=>{ e.stopPropagation(); const id=cb.dataset.toggle; const task=tasks.find(t=>t.id===id); if(task){await toggleTaskComplete(task);loadTasks();}}); });
    list.querySelectorAll('.task-item').forEach(item => { item.addEventListener('click',e=>{ if(e.target.closest('.checkbox')||e.target.closest('.delete-action'))return; const t=tasks.find(x=>x.id===item.dataset.id); if(t)openTaskEdit(t);}); });
    list.querySelectorAll('.delete-action').forEach(btn => { btn.addEventListener('click',e=>{ e.stopPropagation(); pendingDelete={type:'task',id:btn.dataset.delete}; $('#confirmMsg').textContent='确定要删除吗？'; $('#confirmDialog').showModal();}); });
  }
}

function esc(s) { if(!s)return''; const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function escAttr(s) { return esc(s).replace(/"/g,'&quot;'); }

// ==================== 纪念日列表 ====================
async function loadAnniversaries() {
  const annis = await getAnniversaries();
  const list = $('#anniList');
  if (annis.length===0) { list.innerHTML='<div class="empty-state"><div class="empty-icon">🎂</div><div class="empty-title">暂无纪念日</div><div class="empty-sub">点击右下角 ＋ 按钮添加纪念日</div></div>'; }
  else {
    list.innerHTML = annis.map(a => {
      const days=daysUntil(a); let cls,cc,ct;
      if(days>7){cls='near';cc='countdown-near';ct='还有 '+days+' 天';}
      else if(days>0){cls='soon';cc='countdown-soon';ct='还有 '+days+' 天';}
      else if(days===0){cls='today-box';cc='countdown-today';ct='🎉 今天！';}
      else{cls='past';cc='countdown-past';ct='已过 '+-days+' 天';}
      return '<div class="anni-item" data-id="'+a.id+'"><div class="anni-date-box '+cls+'"><span class="m">'+a.month+'月</span><span class="d">'+a.day+'</span></div><div class="anni-info"><div class="anni-title">'+esc(a.title)+'</div><div class="anni-type">'+(a.isAnnual?'每年':'一次性')+'</div>'+(a.description?'<div class="anni-desc">'+esc(a.description)+'</div>':'')+'</div><span class="anni-countdown '+cc+'">'+ct+'</span></div>';
    }).join('');
    list.querySelectorAll('.anni-item').forEach(item=>{ item.addEventListener('click',()=>{ const a=annis.find(x=>x.id===item.dataset.id); if(a)openAnniEdit(a);}); item.addEventListener('contextmenu',e=>{ e.preventDefault(); pendingDelete={type:'anni',id:item.dataset.id}; $('#confirmMsg').textContent='确定要删除吗？'; $('#confirmDialog').showModal();}); });
  }
}

// ==================== 任务编辑 ====================
function openTaskEdit(task) {
  $('#taskDialogTitle').textContent = task?'编辑任务':'新建任务';
  $('#taskId').value=task?task.id:'';
  $('#taskTitle').value=task?task.title:'';
  $('#taskDesc').value=task?(task.description||''):'';
  $('#taskDatePicker').value=task?task.targetDate:selectedDate;
  $('#taskTime').value=task?(task.reminderTime||''):'';
  $('#taskReminder').checked=task?task.reminderEnabled:false;
  $('#reminderOffset').value=task?(task.reminderOffset||5):5;
  const pri=task?task.priority:1;
  document.getElementById({2:'priHigh',1:'priMid',0:'priLow'}[pri]).checked=true;
  const repeat=task?(task.repeatType||'none'):'none';
  document.getElementById({'none':'rptNone','weekdays':'rptWeekdays','daily':'rptDaily','weekly':'rptWeekly'}[repeat]).checked=true;
  const catSel=$('#taskCategory');
  catSel.innerHTML=getCategories().map(c=>'<option value="'+escAttr(c)+'"'+(c===(task?task.category:currentCategory)?' selected':'')+'>'+esc(c)+'</option>').join('');
  $('#taskDialog').showModal();
}

// ==================== 纪念日编辑 ====================
function fillAnniSelects() {
  $('#anniMonth').innerHTML=Array.from({length:12},(_,i)=>'<option value="'+(i+1)+'">'+(i+1)+'月</option>').join('');
  $('#anniDay').innerHTML=Array.from({length:31},(_,i)=>'<option value="'+(i+1)+'">'+(i+1)+'日</option>').join('');
}
function openAnniEdit(anni) {
  fillAnniSelects();
  $('#anniDialogTitle').textContent=anni?'编辑纪念日':'新建纪念日';
  $('#anniId').value=anni?anni.id:'';
  $('#anniTitle').value=anni?anni.title:'';
  $('#anniDesc').value=anni?(anni.description||''):'';
  $('#anniMonth').value=anni?anni.month:new Date().getMonth()+1;
  $('#anniDay').value=anni?anni.day:new Date().getDate();
  document.querySelector('input[name="isAnnual"][value="'+(anni?(anni.isAnnual?'1':'0'):'1')+'"]').checked=true;
  $('#reminderDays').value=anni?anni.reminderDaysBefore:0;
  $('#anniDialog').showModal();
}

// ==================== 表单提交 ====================
$('#taskForm').addEventListener('submit',async function(e){
  e.preventDefault();
  const id=$('#taskId').value;
  const now=new Date().toISOString();
  const task={
    id:id||uuid(), title:$('#taskTitle').value.trim(), description:$('#taskDesc').value.trim()||null,
    priority:parseInt(document.querySelector('input[name="priority"]:checked')?.value||'1'),
    targetDate:$('#taskDatePicker').value||selectedDate, category:$('#taskCategory').value||currentCategory,
    repeatType:document.querySelector('input[name="repeatType"]:checked')?.value||'none',
    reminderTime:$('#taskTime').value||'', reminderEnabled:$('#taskReminder').checked,
    reminderOffset:parseInt($('#reminderOffset').value)||5,
    isCompleted:false, createdAt:now, completedAt:null,
  };
  if(id){ const existing=(await getAllTasksRaw()).find(t=>t.id===id); if(existing){ task.isCompleted=existing.isCompleted; task.completedAt=existing.completedAt; task.createdAt=existing.createdAt; } }
  await saveTask(task); $('#taskDialog').close(); loadTasks(); scheduleReminderCheck();
});

$('#anniForm').addEventListener('submit',async function(e){
  e.preventDefault();
  const id=$('#anniId').value; const now=new Date().toISOString();
  const all=await getAnniversaries(); const existing=id?all.find(a=>a.id===id):null;
  const anni={id:id||uuid(),title:$('#anniTitle').value.trim(),description:$('#anniDesc').value.trim()||null,month:parseInt($('#anniMonth').value),day:parseInt($('#anniDay').value),isAnnual:document.querySelector('input[name="isAnnual"]:checked')?.value==='1',reminderDaysBefore:parseInt($('#reminderDays').value),createdAt:existing?existing.createdAt:now};
  await saveAnniversary(anni); $('#anniDialog').close(); loadAnniversaries();
});

$('#confirmDialog').addEventListener('submit',async function(e){
  e.preventDefault();
  if(pendingDelete){ if(pendingDelete.type==='task'){await deleteTask(pendingDelete.id);loadTasks();}else{await deleteAnniversary(pendingDelete.id);loadAnniversaries();} }
  pendingDelete=null;$('#confirmDialog').close();
});

function closeTaskDialog(){$('#taskDialog').close();}
function closeAnniDialog(){$('#anniDialog').close();}
function closeConfirm(){$('#confirmDialog').close();pendingDelete=null;}
$('#taskDatePicker').addEventListener('change',function(){$('#taskDate').value=this.value;});

// ==================== 标签切换 ====================
// ==================== 看板 ====================
let kbYear, kbMonth, kbSelectedDate;

function initKanban() {
  const now = new Date();
  kbYear = now.getFullYear(); kbMonth = now.getMonth() + 1;
  kbSelectedDate = todayStr();
}

function changeMonth(delta) {
  kbMonth += delta;
  if (kbMonth > 12) { kbMonth = 1; kbYear++; }
  if (kbMonth < 1) { kbMonth = 12; kbYear--; }
  renderKanban();
}

async function renderKanban() {
  $('#kbMonthTitle').textContent = kbYear + '年' + kbMonth + '月';
  const firstDay = new Date(kbYear, kbMonth-1, 1);
  const lastDay = new Date(kbYear, kbMonth, 0);
  const totalDays = lastDay.getDate();
  let startOffset = firstDay.getDay() - 1;
  if (startOffset < 0) startOffset = 6;

  const today = todayStr();
  const allTasks = await getAllTasksRaw();
  const taskDays = {};
  allTasks.forEach(t => { taskDays[t.targetDate] = 1; });

  let html = '';
  for (let i = 0; i < startOffset; i++) html += '<div class="kb-day other-month"></div>';
  for (let d = 1; d <= totalDays; d++) {
    const ds = kbYear+'-'+pad(kbMonth)+'-'+pad(d);
    let cls = 'kb-day';
    if (ds === today) cls += ' today';
    if (ds === kbSelectedDate) cls += ' selected';
    if (taskDays[ds]) cls += ' has-tasks';
    html += '<div class="'+cls+'" data-date="'+ds+'">'+d+'</div>';
  }
  $('#kbGrid').innerHTML = html;
  $('#kbGrid').querySelectorAll('.kb-day:not(.other-month)').forEach(el => {
    el.addEventListener('click', () => {
      kbSelectedDate = el.dataset.date;
      renderKanban();
      loadKanbanPreview(kbSelectedDate);
    });
  });
  loadKanbanPreview(kbSelectedDate);
}

async function loadKanbanPreview(dateStr) {
  $('#kbPreviewDate').textContent = dateStr;
  const all = await getAllTasksRaw();
  const d = new Date(dateStr+'T00:00:00'); const dow = d.getDay();
  const tasks = all.filter(t => t.targetDate === dateStr || isRepeatMatch(t, dateStr, dow));
  const cats = getCategories();
  const groups = {};
  cats.forEach(c => { groups[c] = []; });
  tasks.forEach(t => { const cat = t.category || cats[0]; if (!groups[cat]) groups[cat] = []; groups[cat].push(t); });

  let html = '';
  cats.forEach(cat => {
    const list = groups[cat] || [];
    if (list.length === 0) return;
    html += '<div class="kb-cat-group"><div class="kb-cat-title">' + esc(cat) + '</div>';
    list.forEach(t => {
      const done = t.isCompleted ? ' done' : '';
      const dc = t.isCompleted ? '#27AE60' : (['#95A5A6','#D35400','#C0392B'][t.priority]||'#D35400');
      html += '<div class="kb-task-row'+done+'"><span class="dot" style="background:'+dc+'"></span><span class="kb-task-text">'+esc(t.title)+'</span></div>';
    });
    html += '</div>';
  });
  if (!html) html = '<div class="empty-state" style="padding:20px"><div class="empty-title">当天无任务</div></div>';
  $('#kbPreviewList').innerHTML = html;
}

let currentTab = 'tasks';
function fabClick() {
  if (currentTab === 'anniversaries') openAnniEdit();
  else openTaskEdit();
}

function switchTab(tab){
  currentTab = tab;
  $('#homeScreen').style.display='none'; $('#anniversaryScreen').style.display='none'; $('#kanbanScreen').style.display='none'; $('#notesScreen').style.display='none';
  if (tab === 'tasks') { $('#homeScreen').style.display=''; loadTasks(); }
  else if (tab === 'kanban') { if (!kbYear) initKanban(); $('#kanbanScreen').style.display='flex'; $('#kanbanScreen').style.flexDirection='column'; renderKanban(); }
  else if (tab === 'anniversaries') { $('#anniversaryScreen').style.display=''; loadAnniversaries(); }
  else if (tab === 'notes') { $('#notesScreen').style.display=''; renderNotes(); }
  document.querySelectorAll('.bottom-nav').forEach(nav => {
    const btns = nav.querySelectorAll('.nav-btn'); btns.forEach(b => b.classList.remove('active'));
    const idx = {tasks:0, kanban:1, anniversaries:2, notes:3};
    if (btns[idx[tab]]) btns[idx[tab]].classList.add('active');
  });
}

// ==================== 随手记 ====================
function saveNote() {
  const text = $('#noteInput').value.trim();
  if (!text) return;
  const notes = JSON.parse(localStorage.getItem('notes') || '[]');
  notes.unshift({ id: Date.now(), text: text, time: new Date().toISOString() });
  localStorage.setItem('notes', JSON.stringify(notes));
  $('#noteInput').value = '';
  renderNotes();
}

function renderNotes() {
  const notes = JSON.parse(localStorage.getItem('notes') || '[]');
  let html = '';
  notes.forEach(n => {
    const t = new Date(n.time);
    const ts = t.getFullYear()+'-'+pad(t.getMonth()+1)+'-'+pad(t.getDate())+' '+pad(t.getHours())+':'+pad(t.getMinutes());
    html += '<div class="note-card"><div class="note-time">'+ts+'</div><div class="note-text">'+esc(n.text)+'</div></div>';
  });
  if (!html) html = '<div class="empty-state" style="padding:40px"><div class="empty-icon">📝</div><div class="empty-title">暂无记录</div><div class="empty-sub">写下你此刻的想法</div></div>';
  $('#notesList').innerHTML = html;
}

// ==================== 提醒通知 ====================
function dbg(msg) { /* 调试已关闭 */ }

function hasNotifyCapability() {
  return (typeof AndroidReminder !== 'undefined') || ('Notification' in window && Notification.permission === 'granted');
}

async function checkReminders() {
  if (!hasNotifyCapability()) { dbg('❌ 无通知能力(Android桥接:'+(typeof AndroidReminder!=='undefined')+' 浏览器:'+('Notification' in window)+'/'+(('Notification' in window)?Notification.permission:'-')+')'); return; }

  const now = new Date();
  const today = todayStr();
  const all = await getAllTasksRaw();
  const reminded = JSON.parse(localStorage.getItem('reminded') || '{}');

  const withReminder = all.filter(t => t.reminderEnabled && t.reminderTime && !t.isCompleted);
  if (withReminder.length === 0) { dbg('✅ 权限OK | 0个提醒'); return; }

  dbg('检查'+withReminder.length+'个提醒 | '+pad(now.getHours())+':'+pad(now.getMinutes()));

  for (const t of withReminder) {
    if (reminded[t.id] === today) continue;
    const parts = t.reminderTime.split(':');
    const th = parseInt(parts[0]), tm = parseInt(parts[1]);
    const offset = t.reminderOffset || 5;
    let remindMin = th * 60 + tm - offset;
    if (remindMin < 0) remindMin += 24 * 60;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (nowMin < remindMin) continue;

    const dow = now.getDay();
    if (t.targetDate !== today && !isRepeatMatch(t, today, dow)) continue;

    reminded[t.id] = today;
    localStorage.setItem('reminded', JSON.stringify(reminded));

    dbg('🔔 弹窗: '+t.title);
    sendNotification('⏰ ' + t.title, '还有 ' + offset + ' 分钟！(' + t.reminderTime + ')');
  }
}

async function checkMissedReminders() {
  if (!hasNotifyCapability()) return;
  const now = new Date(), today = todayStr();
  const all = await getAllTasksRaw();
  const reminded = JSON.parse(localStorage.getItem('reminded') || '{}');
  const nowMin = now.getHours() * 60 + now.getMinutes();

  for (const t of all) {
    if (!t.reminderEnabled || !t.reminderTime || t.isCompleted) continue;
    if (reminded[t.id] === today) continue;
    const parts = t.reminderTime.split(':');
    const th = parseInt(parts[0]), tm = parseInt(parts[1]);
    const offset = t.reminderOffset || 5;
    let remindMin = th * 60 + tm - offset;
    if (remindMin < 0) remindMin += 24 * 60;
    if (nowMin < remindMin) continue;
    const dow = now.getDay();
    if (t.targetDate !== today && !isRepeatMatch(t, today, dow)) continue;
    reminded[t.id] = today;
    localStorage.setItem('reminded', JSON.stringify(reminded));
    dbg('补推: '+t.title);
    sendNotification('⏰ ' + t.title, '提醒时间：' + t.reminderTime + '（提前 ' + offset + ' 分钟）');
  }
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) { dbg('回到前台, 补检...'); checkMissedReminders(); } });
function scheduleReminderCheck() { checkReminders(); setInterval(checkReminders, 30000); }
function cleanReminded() {
  const reminded = JSON.parse(localStorage.getItem('reminded') || '{}');
  const today = todayStr();
  let changed = false;
  Object.keys(reminded).forEach(k => { if (reminded[k] !== today) { delete reminded[k]; changed = true; } });
  if (changed) localStorage.setItem('reminded', JSON.stringify(reminded));
}

// ==================== 初始化 ====================
async function init() {
  await openDB();

  // 检查通知权限（APK中跳过，用原生桥接）
  if (typeof AndroidReminder !== 'undefined') {
    dbg('✅ Android原生通知就绪');
  } else if ('Notification' in window) {
    if (Notification.permission !== 'granted') {
      $('#permBar').style.display = '';
      $('#permBtn').addEventListener('click', async () => {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          $('#permBar').style.display = 'none';
          sendNotification('✅ 提醒功能已开启', '任务到时间时会提前弹窗通知你');
          scheduleReminderCheck();
        } else {
          alert('请在手机 设置 → 通知 → Edge → 允许通知');
        }
      });
    }
  }

  initKanban();
  renderCategoryBar();
  renderDateStrip();
  await loadTasks();
  scheduleReminderCheck();
  cleanReminded();
  if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(() => {}); }
}

init();

// ==================== 手势 ====================
let touchStartX = 0, touchCurrentItem = null;
document.addEventListener('touchstart', (e) => {
  const item = e.target.closest('.task-item');
  if (!item) return;
  touchStartX = e.touches[0].clientX; touchCurrentItem = item;
  $$('.task-item.swiped').forEach(el => { if (el !== item) el.classList.remove('swiped'); });
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!touchCurrentItem) return;
  const dx = touchStartX - e.touches[0].clientX;
  if (dx > 30) touchCurrentItem.classList.add('swiped');
  else if (dx < -10) touchCurrentItem.classList.remove('swiped');
}, { passive: true });
