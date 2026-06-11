// ══════════════════════════════════════════
//  КОНСТАНТЫ
// ══════════════════════════════════════════
function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet(name) {
  return getSpreadsheet().getSheetByName(name);
}

// ══════════════════════════════════════════
//  ТОЧКА ВХОДА
// ══════════════════════════════════════════
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('TangoDB')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ══════════════════════════════════════════
//  УТИЛИТЫ
// ══════════════════════════════════════════
function generateId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000).toString();
}

function sheetToObjects(sheetName) {
  const sheet = getSheet(sheetName);
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

// ══════════════════════════════════════════
//  КЛИЕНТЫ
// ══════════════════════════════════════════

// Получить всех клиентов
function getClients() {
  const result = sheetToObjects('Clients');
  return result && result.length ? result : [];
}

// Добавить клиента с проверкой дубликата
function addClient(firstName, lastName, telegram) {
  firstName = firstName.trim();
  lastName  = lastName.trim();
  telegram  = telegram.trim();

  const sheet   = getSheet('Clients');
  const clients = sheetToObjects('Clients');

  // Проверка дубликата по имени + фамилии (без учёта регистра)
  const duplicate = clients.find(c =>
    c.FirstName.toLowerCase() === firstName.toLowerCase() &&
    c.LastName.toLowerCase()  === lastName.toLowerCase()
  );

  if (duplicate) {
    return { success: false, error: 'Клиент с таким именем и фамилией уже существует' };
  }

  const id = generateId();
  sheet.appendRow([id, firstName, lastName, telegram]);
  return { success: true, id: id };
}

// Удалить клиента по ID
function deleteClient(clientId) {
  const sheet  = getSheet('Clients');
  const data   = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString() === clientId.toString()) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Клиент не найден' };
}

// Обновить клиента по ID
function updateClient(clientId, firstName, lastName, telegram) {
  const sheet = getSheet('Clients');
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString() === clientId.toString()) {
      sheet.getRange(i + 1, 2).setValue(firstName.trim());
      sheet.getRange(i + 1, 3).setValue(lastName.trim());
      sheet.getRange(i + 1, 4).setValue(telegram.trim());
      return { success: true };
    }
  }
  return { success: false, error: 'Клиент не найден' };
}

// ══════════════════════════════════════════
//  РАСПИСАНИЕ
// ══════════════════════════════════════════

function getSchedule() {
  const sheet = getSheet('Schedule');
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const result = [];
  for (let i = 1; i < data.length; i++) {
    const day     = data[i][0];
    const timeVal = data[i][1];
    if (!day) continue;

    let timeStr;
    if (timeVal instanceof Date) {
      // GAS вернул Date-объект
      const h = String(timeVal.getHours()).padStart(2, '0');
      const m = String(timeVal.getMinutes()).padStart(2, '0');
      timeStr = h + ':' + m;
    } else if (typeof timeVal === 'number') {
      // Дробное число: 20:00 = 20/24 ≈ 0.8333
      const totalMinutes = Math.round(timeVal * 24 * 60);
      const h = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
      const m = String(totalMinutes % 60).padStart(2, '0');
      timeStr = h + ':' + m;
    } else {
      timeStr = String(timeVal);
    }

    result.push({ DayOfWeek: parseInt(day), Time: timeStr });
  }

  return result;
}

// Добавить слот расписания
function addScheduleSlot(dayOfWeek, time) {
  const sheet    = getSheet('Schedule');
  const schedule = sheetToObjects('Schedule');

  // Проверка дубликата
  const duplicate = schedule.find(s =>
    s.DayOfWeek.toString() === dayOfWeek.toString() &&
    s.Time === time
  );
  if (duplicate) {
    return { success: false, error: 'Такой день и время уже есть в расписании' };
  }

  sheet.appendRow([parseInt(dayOfWeek), time]);
  return { success: true };
}

// Удалить слот расписания
function deleteScheduleSlot(dayOfWeek, time) {
  const sheet = getSheet('Schedule');
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (
      data[i][0].toString() === dayOfWeek.toString() &&
      data[i][1] === time
    ) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Слот не найден' };
}

// ══════════════════════════════════════════
//  ЦЕНЫ
// ══════════════════════════════════════════

function getPrices() {
  const sheet = getSheet('Prices');
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const result = [];
  for (let i = 1; i < data.length; i++) {
    const type    = data[i][0];
    const lessons = data[i][1];
    const price   = data[i][2];
    if (!type) continue;
    result.push({ Type: type.toString().trim(), Lessons: lessons, Price: price, Row: i + 1 });
  }
  return result;
}

function updatePrice(rowIndex, newPrice) {
  const sheet = getSheet('Prices');
  sheet.getRange(rowIndex, 3).setValue(parseFloat(newPrice));
  return { success: true };
}

// ══════════════════════════════════════════
//  АБОНЕМЕНТЫ
// ══════════════════════════════════════════

function getSellSubData() {
  const clients = getClients();
  const prices  = getPrices();
  return { clients: clients || [], prices: prices || [] };
}

function addSubscription(subData) {
  const sheet = getSheet('Subscriptions');
  const id    = generateId();

  // Дата активации
  const parts          = subData.activationDate.split('-');
  const activationDate = new Date(parts[0], parts[1] - 1, parts[2]);

  sheet.appendRow([
    id,
    subData.type,
    subData.clientId1,
    subData.clientId2 || '',
    subData.lessonsTotal,
    subData.lessonsTotal,   // LessonsLeft = LessonsTotal при старте
    0,                      // FreezeUsed
    activationDate,
    'active',
    subData.pairMonth || ''
  ]);

  return { success: true, id: id };
}

function getSubscriptions() {
  const sheet = getSheet('Subscriptions');
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const result = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;

    let dateStr = '';
    const dateVal = row[7];
    if (dateVal instanceof Date) {
      dateStr = Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else {
      dateStr = String(dateVal);
    }

    result.push({
      ID:             row[0].toString(),
      Type:           row[1],
      ClientID1:      row[2].toString(),
      ClientID2:      row[3].toString(),
      LessonsTotal:   row[4],
      LessonsLeft:    row[5],
      FreezeUsed:     row[6],
      ActivationDate: dateStr,
      Status:         row[8],
      PairMonth:      row[9],
      Row:            i + 1
    });
  }
  return result;
}

// ══════════════════════════════════════════
//  ЖУРНАЛ ПОСЕЩЕНИЙ
// ══════════════════════════════════════════

// Все записи посещений
function getAttendanceRecords() {
  const sheet = getSheet('Attendance');
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const result = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    let dateStr = '';
    if (row[0] instanceof Date) {
      dateStr = Utilities.formatDate(row[0], Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else {
      dateStr = String(row[0]);
    }
    result.push({
      Date:             dateStr,
      SubscriptionID:   row[1].toString(),
      ClientDisplay:    row[2],
      AttendanceStatus: row[3],
      Row:              i + 1
    });
  }
  return result;
}

// Даты занятий по расписанию для указанного месяца (формат: 'YYYY-MM')
function getScheduleDatesForMonth(yearMonth) {
  const schedule = getSchedule();
  if (!schedule.length) return [];

  const parts = yearMonth.split('-');
  const year  = parseInt(parts[0]);
  const month = parseInt(parts[1]);
  const daysInMonth = new Date(year, month, 0).getDate();
  const dates = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const date    = new Date(year, month - 1, day);
    const jsDay   = date.getDay(); // 0=вс
    const dow     = jsDay === 0 ? 7 : jsDay; // 1=пн...7=вс

    schedule.forEach(slot => {
      if (parseInt(slot.DayOfWeek) === dow) {
        const dd      = String(day).padStart(2, '0');
        const mm      = String(month).padStart(2, '0');
        const dateStr = `${year}-${mm}-${dd}`;
        dates.push({ date: dateStr, time: slot.Time });
      }
    });
  }

  return dates.sort((a, b) =>
    a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
  );
}

// Абонементы для конкретной даты
function getSubsForDate(dateStr) {
  const subs       = getSubscriptions();
  const clients    = getClients();
  const attendance = getAttendanceRecords();

  const clientMap = {};
  (clients || []).forEach(c => clientMap[c.ID] = c);

  const activeSubs = (subs || []).filter(s => {
    if (s.Status !== 'active') return false;
    if (s.ActivationDate > dateStr) return false;
    if (parseInt(s.LessonsLeft) <= 0) return false;
    return true;
  });

  return activeSubs.map(s => {
    const c1 = clientMap[s.ClientID1] || {};
    const c2 = s.ClientID2 ? (clientMap[s.ClientID2] || {}) : null;

    const existing = attendance.find(a =>
      a.Date === dateStr && a.SubscriptionID === s.ID
    );

    const freezeUsed   = parseInt(s.FreezeUsed)   || 0;
    const lessonsTotal = parseInt(s.LessonsTotal)  || 0;
    const lessonsLeft  = parseInt(s.LessonsLeft)   || 0;

    return {
      subId:          s.ID,
      type:           s.Type,
      client1:        c1.LastName ? `${c1.LastName} ${c1.FirstName}` : (s.ClientID1 || ''),
      client2:        c2 && c2.LastName ? `${c2.LastName} ${c2.FirstName}` : '',
      lessonsLeft:    lessonsLeft,
      lessonsTotal:   lessonsTotal,
      freezeUsed:     freezeUsed,
      activationDate: s.ActivationDate,
      currentStatus:  existing ? existing.AttendanceStatus : null,
      canFreeze:      lessonsTotal === 8 && freezeUsed === 0
    };
  });
}

// Отметить посещение
function markAttendance(dateStr, subId, newStatus) {
  const attSheet  = getSheet('Attendance');
  const subsSheet = getSheet('Subscriptions');

  // Найти строку абонемента
  const subsData = subsSheet.getDataRange().getValues();
  let subRow     = -1;
  let subRowData = null;
  for (let i = 1; i < subsData.length; i++) {
    if (subsData[i][0].toString() === subId.toString()) {
      subRow     = i + 1;
      subRowData = subsData[i];
      break;
    }
  }
  if (subRow === -1) return { success: false, error: 'Абонемент не найден' };

  const lessonsTotal   = parseInt(subRowData[4]) || 0;
  const lessonsLeft    = parseInt(subRowData[5]) || 0;
  const freezeUsed     = parseInt(subRowData[6]) || 0;

  // Найти существующую запись посещения
  const attData = attSheet.getDataRange().getValues();
  let attRow    = -1;
  let oldStatus = null;
  for (let i = 1; i < attData.length; i++) {
    let rowDate = attData[i][0];
    if (rowDate instanceof Date) {
      rowDate = Utilities.formatDate(rowDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else {
      rowDate = String(rowDate);
    }
    if (rowDate === dateStr && attData[i][1].toString() === subId.toString()) {
      attRow    = i + 1;
      oldStatus = attData[i][3];
      break;
    }
  }

  // Если статус не меняется — ничего не делаем
  if (oldStatus === newStatus) return { success: true };

  // Считаем дельту уроков и заморозок
  let lessonDelta = 0;
  let freezeDelta = 0;

  // Откатываем старый статус
  if (oldStatus === 'present' || oldStatus === 'absent') lessonDelta += 1;
  if (oldStatus === 'freeze') freezeDelta -= 1;

  // Применяем новый статус
  if (newStatus === 'present' || newStatus === 'absent') lessonDelta -= 1;
  if (newStatus === 'freeze') freezeDelta += 1;

  // Если статус в той же группе (оба списывают) — дельта = 0
  const oldDeducts = oldStatus === 'present' || oldStatus === 'absent';
  const newDeducts = newStatus === 'present' || newStatus === 'absent';
  if (oldDeducts && newDeducts) lessonDelta = 0;

  // Валидация заморозки
  if (newStatus === 'freeze') {
    if (lessonsTotal !== 8) {
      return { success: false, error: 'Заморозка доступна только для абонементов на 8 уроков' };
    }
    if (freezeUsed + freezeDelta > 1) {
      return { success: false, error: 'Заморозка по этому абонементу уже использована' };
    }
  }

  // Валидация уроков
  const newLessonsLeft = lessonsLeft + lessonDelta;
  if (newLessonsLeft < 0) {
    return { success: false, error: 'Недостаточно уроков в абонементе' };
  }

  const newFreezeUsed = freezeUsed + freezeDelta;

  // Имя клиента для отображения
  const clients   = getClients();
  const clientMap = {};
  (clients || []).forEach(c => clientMap[c.ID] = c);
  const c1  = clientMap[subRowData[2]] || {};
  const c2  = subRowData[3] ? (clientMap[subRowData[3]] || {}) : null;
  let display = c1.LastName ? `${c1.LastName} ${c1.FirstName}` : subRowData[2];
  if (c2 && c2.LastName) display += ` & ${c2.LastName} ${c2.FirstName}`;

  // Запись посещения
  const dateObj = new Date(dateStr + 'T12:00:00');
  if (attRow === -1) {
    attSheet.appendRow([dateObj, subId, display, newStatus]);
  } else {
    attSheet.getRange(attRow, 4).setValue(newStatus);
  }

  // Обновить абонемент
  // Пакетная запись — один запрос вместо трёх
  subsSheet.getRange(subRow, 6, 1, 2).setValues([[newLessonsLeft, newFreezeUsed]]);
  if (newLessonsLeft === 0) {
    subsSheet.getRange(subRow, 9).setValue('finished');
  }

  return { success: true, newLessonsLeft: newLessonsLeft };
}

// ══════════════════════════════════════════
//  ДЕЙСТВУЮЩИЕ АБОНЕМЕНТЫ
// ══════════════════════════════════════════

function getActiveSubscriptions() {
  const subs    = getSubscriptions();
  const clients = getClients();

  const clientMap = {};
  (clients || []).forEach(c => clientMap[c.ID] = c);

  const active = (subs || []).filter(s => s.Status === 'active');

  return active.map(s => {
    const c1 = clientMap[s.ClientID1] || {};
    const c2 = s.ClientID2 ? (clientMap[s.ClientID2] || {}) : null;

    return {
      subId:          s.ID,
      type:           s.Type,
      pairMonth:      s.PairMonth,
      client1:        c1.LastName ? `${c1.LastName} ${c1.FirstName}` : s.ClientID1,
      client2:        c2 && c2.LastName ? `${c2.LastName} ${c2.FirstName}` : '',
      client1tg:      c1.Telegram || '',
      client2tg:      c2 ? (c2.Telegram || '') : '',
      lessonsTotal:   parseInt(s.LessonsTotal) || 0,
      lessonsLeft:    parseInt(s.LessonsLeft)  || 0,
      freezeUsed:     parseInt(s.FreezeUsed)   || 0,
      activationDate: s.ActivationDate,
    };
  });
}

// Принудительно завершить абонемент
function finishSubscription(subId) {
  const sheet = getSheet('Subscriptions');
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString() === subId.toString()) {
      sheet.getRange(i + 1, 9).setValue('finished');
      return { success: true };
    }
  }
  return { success: false, error: 'Абонемент не найден' };
}

// ══════════════════════════════════════════
//  ПЕРСОНАЛЬНЫЕ УРОКИ
// ══════════════════════════════════════════

function getPersonalLessons() {
  const sheet = getSheet('PersonalLessons');
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return [];

  const clients   = getClients() || [];
  const clientMap = {};
  clients.forEach(c => { if (c && c.ID) clientMap[c.ID.toString()] = c; });

  const result = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;

    // Дата
    let dateStr = '';
    try {
      const dateVal = row[5];
      if (dateVal instanceof Date) {
        dateStr = Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else if (dateVal) {
        dateStr = String(dateVal);
      }
    } catch(e) {
      dateStr = '';
    }

    // Клиенты
    const c1id = row[2] ? row[2].toString() : '';
    const c2id = row[3] ? row[3].toString() : '';
    const c3id = row[4] ? row[4].toString() : '';

    const c1 = clientMap[c1id] || {};
    const c2 = clientMap[c2id] || {};
    const c3 = clientMap[c3id] || {};

    result.push({
      ID:      row[0].toString(),
      Type:    row[1] ? row[1].toString() : '',
      Client1: c1.LastName ? `${c1.LastName} ${c1.FirstName}` : c1id,
      Client2: c2.LastName ? `${c2.LastName} ${c2.FirstName}` : (c2id || ''),
      Client3: c3.LastName ? `${c3.LastName} ${c3.FirstName}` : (c3id || ''),
      Date:    dateStr,
      Price:   parseFloat(row[6]) || 0,
      Paid:    row[7] ? row[7].toString() : 'no',
      Row:     i + 1
    });
  }
  return result;
}

function addPersonalLessons(lessonsData) {
  // lessonsData: { type, clientId1, clientId2, clientId3, dates: [], price, paid }
  const sheet = getSheet('PersonalLessons');

  const dates = lessonsData.dates || [];
  if (!dates.length) return { success: false, error: 'Нет дат для бронирования' };

  dates.forEach(dateStr => {
    const id      = generateId();
    const dateObj = new Date(dateStr + 'T12:00:00');
    sheet.appendRow([
      id,
      lessonsData.type,
      lessonsData.clientId1  || '',
      lessonsData.clientId2  || '',
      lessonsData.clientId3  || '',
      dateObj,
      parseFloat(lessonsData.price) || 0,
      lessonsData.paid ? 'yes' : 'no'
    ]);
  });

  return { success: true };
}

function updatePersonalPaid(rowIndex, paid) {
  const sheet = getSheet('PersonalLessons');
  sheet.getRange(rowIndex, 8).setValue(paid ? 'yes' : 'no');
  return { success: true };
}

function deletePersonalLesson(rowIndex) {
  const sheet = getSheet('PersonalLessons');
  sheet.deleteRow(rowIndex);
  return { success: true };
}

function getPersonalSellData() {
  const clients = getClients();
  const prices  = getPrices();
  return { clients: clients || [], prices: prices || [] };
}

// ══════════════════════════════════════════
//  ПЕРСОНАЛЬНЫЕ УРОКИ — ПРОСМОТР
// ══════════════════════════════════════════

function getPersonalLessonsForView(filterPaid) {
  try {
    const lessons = getPersonalLessons();
    if (!lessons || !lessons.length) return [];
    return lessons
      .filter(l => filterPaid === 'all' || l.Paid === filterPaid)
      .sort((a, b) => b.Date.localeCompare(a.Date));
  } catch(e) {
    Logger.log('getPersonalLessonsForView error: ' + e.toString());
    return [];
  }
}

function updatePersonalLessonPaid(rowIndex, paid) {
  const sheet = getSheet('PersonalLessons');
  sheet.getRange(rowIndex, 8).setValue(paid ? 'yes' : 'no');
  return { success: true };
}

function deletePersonalLessonRow(rowIndex) {
  const sheet = getSheet('PersonalLessons');
  sheet.deleteRow(rowIndex);
  return { success: true };
}

// ══════════════════════════════════════════
//  ЭКСПОРТ ДАННЫХ (миграция → Supabase)
// ══════════════════════════════════════════

/** Запустить один раз в редакторе GAS; JSON сохранится в Google Drive */
function exportAllData() {
  const output = {
    clients:          sheetToObjects('Clients'),
    schedule:         getSchedule(),
    prices:           getPrices(),
    subscriptions:    getSubscriptions(),
    attendance:       getAttendanceRecords(),
    // sheetToObjects, не getPersonalLessons() — нужны сырые ID в Client1/2/3
    personalLessons:  sheetToObjects('PersonalLessons')
  };
  const json = JSON.stringify(output, null, 2);
  const file = DriveApp.createFile('tangodb_export.json', json, MimeType.PLAIN_TEXT);
  Logger.log('Файл создан: ' + file.getUrl());
}
