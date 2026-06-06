/* ================================================================
   每日任务管理 PWA — 2.0  (重复任务 + 分类 + 提醒)
   ================================================================ */

// ==================== 原生通知桥接 ====================
function sendNotification(title, body) {
  // 优先使用 Android 原生通知
  if (typeof AndroidReminder !== 'undefined' && AndroidReminder.showNotification) {
    try { AndroidReminder.showNotification(title, body); return; } catch(e) {}
  }
  // 回退到浏览器 Notification
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body: body, icon: 'icons/icon-192.png', tag: 'reminder', requireInteraction: true });
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
  for (let i = -3; i <= 3; i++) { const d = new Date(dateStripCenter); d.setDate(d.getDate()+i); dates.push(d); }
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
  bar.innerHTML = cats.map(c => '<button class="cat-chip'+(c===currentCategory?' active':'')+'" data-cat="'+escAttr(c)+'">'+esc(c)+'</button>').join('') + '<button class="cat-chip cat-add" onclick="openAddCategory()">＋</button>';
  bar.querySelectorAll('.cat-chip').forEach(chip => {
    if (chip.dataset.cat) {
      chip.addEventListener('click',()=>{ currentCategory=chip.dataset.cat; renderCategoryBar(); loadTasks(); });
      chip.addEventListener('contextmenu',e=>{ e.preventDefault(); const cat=chip.dataset.cat; if (getCategories().length<=1){alert('至少保留一个分类');return;} if (confirm('删除分类「'+cat+'」？')) { deleteCategory(cat); if (currentCategory===cat) currentCategory=getCategories()[0]; renderCategoryBar(); loadTasks(); }});
    }
  });
}
function openAddCategory() { const name=prompt('输入新分类名称：'); if (name&&name.trim()){ addCategory(name.trim()); renderCategoryBar(); loadTasks(); } }

// ==================== 任务列表 ====================
async function loadTasks() {
  $('#currentDateDisplay').textContent = formatDateCN(selectedDate);
  const tasks = await getTasks(selectedDate, currentCategory);
  const list = $('#taskList');
  const stats = $('#statsBar');
  if (tasks.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">暂无任务</div><div class="empty-sub">点击右下角 ＋ 按钮添加新任务</div></div>';
    stats.style.display = 'none';
  } else {
    const done = tasks.filter(t=>t.isCompleted).length;
    $('#doneCount').textContent = done; $('#todoCount').textContent = tasks.length - done;
    stats.style.display = '';
    list.innerHTML = tasks.map(t => {
      const pc = ['pri-low','pri-mid','pri-high'][t.priority]||'pri-mid';
      const pl = ['低','中','高'][t.priority]||'中';
      const rl = t.repeatType==='weekdays'?' 🔁工作日':t.repeatType==='daily'?' 🔁每天':t.repeatType==='weekly'?' 🔁每周':'';
      return '<div class="task-item'+(t.isCompleted?' done':'')+'" data-id="'+t.id+'"><div class="checkbox" data-toggle="'+t.id+'">'+(t.isCompleted?'✓':'')+'</div><div class="task-info"><div class="task-title">'+esc(t.title)+rl+'</div><div class="task-desc">'+esc(t.description||'')+'</div></div><span class="pri-badge '+pc+'">'+pl+'</span><div class="delete-action" data-delete="'+t.id+'">删除</div></div>';
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
function switchTab(tab){
  if(tab==='tasks'){ $('#homeScreen').style.display='';$('#anniversaryScreen').style.display='none';$$('.nav-btn')[0].classList.add('active');$$('.nav-btn')[1].classList.remove('active');loadTasks(); }
  else{ $('#homeScreen').style.display='none';$('#anniversaryScreen').style.display='';$$('.nav-btn')[0].classList.remove('active');$$('.nav-btn')[1].classList.add('active');loadAnniversaries(); }
}

// ==================== 提醒通知 ====================
function dbg(msg) {
  const el = document.getElementById('debugStatus');
  if (el) { const n = new Date(); el.textContent = '['+pad(n.getHours())+':'+pad(n.getMinutes())+':'+pad(n.getSeconds())+'] '+msg; }
}

async function checkReminders() {
  if (!('Notification' in window)) { dbg('❌ 浏览器不支持 Notification'); return; }
  if (Notification.permission !== 'granted') { dbg('❌ 权限未授予: '+Notification.permission); return; }

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
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
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

  // 检查通知权限
  if ('Notification' in window) {
    if (Notification.permission !== 'granted') {
      // 显示权限提示条
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
  } else {
    dbg('❌ 浏览器不支持通知');
  }

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
