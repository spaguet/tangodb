// ══════════════════════════════════════════
//  TANGODB: GOOGLE APPS SCRIPT BACKEND
// ══════════════════════════════════════════
// Скопируйте этот код и замените им содержимое файла Код.gs в Вашем Apps Script.

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet(name) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

// ТОЧКА ВХОДА СЕРВЕРА
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('TangoDB — Панель Студии')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function generateId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000).toString();
}

function sheetToObjects(sheetName) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      // Преобразуем заголовки к camelCase для совместимости с React
      let key = h.toString().trim();
      if (key === "ID") key = "id";
      if (key === "FirstName") key = "firstName";
      if (key === "LastName") key = "lastName";
      if (key === "Telegram") key = "telegram";
      if (key === "DayOfWeek") key = "dayOfWeek";
      if (key === "Time") key = "time";
      if (key === "LessonsLeft") key = "lessonsLeft";
      if (key === "LessonsTotal") key = "lessonsTotal";
      if (key === "FreezeUsed") key = "freezeUsed";
      if (key === "ActivationDate") key = "activationDate";
      if (key === "Status") key = "status";
      if (key === "PairMonth") key = "pairMonth";
      if (key === "ClientID1") key = "clientId1";
      if (key === "ClientID2") key = "clientId2";
      if (key === "ClientID3") key = "clientId3";
      if (key === "Date") key = "date";
      if (key === "Price") key = "price";
      if (key === "Paid") key = "paid";
      if (key === "Type") key = "type";
      
      obj[key] = row[i];
    });
    return obj;
  });
}

// ══════════════════════════════════════════
//  КЛИЕНТЫ
// ══════════════════════════════════════════

function getClients() {
  const result = sheetToObjects('Clients');
  return result && result.length ? result : [];
}

function addClient(firstName, lastName, telegram) {
  firstName = firstName.trim();
  lastName  = lastName.trim();
  telegram  = telegram.trim();

  const sheet   = getSheet('Clients');
  const clients = sheetToObjects('Clients');

  const duplicate = clients.find(c =>
    c.firstName.toLowerCase() === firstName.toLowerCase() &&
    c.lastName.toLowerCase()  === lastName.toLowerCase()
  );

  if (duplicate) {
    return { success: false, error: 'Клиент с таким именем и фамилией уже существует' };
  }

  const id = generateId();
  sheet.appendRow([id, firstName, lastName, telegram]);
  return { success: true, id: id };
}

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
      const h = String(timeVal.getHours()).padStart(2, '0');
      const m = String(timeVal.getMinutes()).padStart(2, '0');
      timeStr = h + ':' + m;
    } else if (typeof timeVal === 'number') {
      const totalMinutes = Math.round(timeVal * 24 * 60);
      const h = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
      const m = String(totalMinutes % 60).padStart(2, '0');
      timeStr = h + ':' + m;
    } else {
      timeStr = String(timeVal);
    }

    result.push({ dayOfWeek: parseInt(day), time: timeStr });
  }

  return result;
}

function addScheduleSlot(dayOfWeek, time) {
  const sheet    = getSheet('Schedule');
  const schedule = getSchedule();

  const duplicate = schedule.find(s =>
    s.dayOfWeek.toString() === dayOfWeek.toString() &&
    s.time === time
  );
  if (duplicate) {
    return { success: false, error: 'Такой день и время уже есть в расписании' };
  }

  sheet.appendRow([parseInt(dayOfWeek), time]);
  return { success: true };
}

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
// ═══════════════════════════════════════

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
    result.push({ type: type.toString().trim(), lessons: lessons, price: price, row: i + 1 });
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

function addSubscription(subData) {
  const sheet = getSheet('Subscriptions');
  const id    = generateId();

  sheet.appendRow([
    id,
    subData.type,
    subData.clientId1,
    subData.clientId2 || '',
    subData.lessonsTotal,
    subData.lessonsTotal,   
    0,                      
    subData.activationDate,
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
      id:             row[0].toString(),
      type:           row[1],
      clientId1:      row[2].toString(),
      clientId2:      row[3].toString(),
      lessonsTotal:   parseInt(row[4]) || 0,
      lessonsLeft:    parseInt(row[5]) || 0,
      freezeUsed:     parseInt(row[6]) || 0,
      activationDate: dateStr,
      status:         row[8],
      pairMonth:      row[9],
      row:            i + 1
    });
  }
  return result;
}

// ══════════════════════════════════════════
//  ЖУРНАЛ ПОСЕЩЕНИЙ
// ══════════════════════════════════════════

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
      date:             dateStr,
      subscriptionId:   row[1].toString(),
      clientDisplay:    row[2],
      attendanceStatus: row[3],
      row:              i + 1
    });
  }
  return result;
}

function markAttendance(dateStr, subId, newStatus) {
  const attSheet  = getSheet('Attendance');
  const subsSheet = getSheet('Subscriptions');

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

  if (oldStatus === newStatus) return { success: true };

  let lessonDelta = 0;
  let freezeDelta = 0;

  if (oldStatus === 'present' || oldStatus === 'absent') lessonDelta += 1;
  if (oldStatus === 'freeze') freezeDelta -= 1;

  if (newStatus === 'present' || newStatus === 'absent') lessonDelta -= 1;
  if (newStatus === 'freeze') freezeDelta += 1;

  const oldDeducts = oldStatus === 'present' || oldStatus === 'absent';
  const newDeducts = newStatus === 'present' || newStatus === 'absent';
  if (oldDeducts && newDeducts) lessonDelta = 0;

  if (newStatus === 'freeze') {
    if (lessonsTotal !== 8) {
      return { success: false, error: 'Заморозка доступна только для абонементов на 8 уроков' };
    }
    if (freezeUsed + freezeDelta > 1) {
      return { success: false, error: 'Заморозка по этому абонементу уже использована' };
    }
  }

  const newLessonsLeft = lessonsLeft + lessonDelta;
  if (newLessonsLeft < 0) {
    return { success: false, error: 'Недостаточно уроков в абонементе' };
  }

  const newFreezeUsed = freezeUsed + freezeDelta;

  const dateObj = new Date(dateStr + 'T12:00:00');
  if (attRow === -1) {
    attSheet.appendRow([dateObj, subId, subRowData[2], newStatus]);
  } else {
    attSheet.getRange(attRow, 4).setValue(newStatus);
  }

  subsSheet.getRange(subRow, 6, 1, 2).setValues([[newLessonsLeft, newFreezeUsed]]);
  if (newLessonsLeft === 0) {
    subsSheet.getRange(subRow, 9).setValue('finished');
  }

  return { success: true, newLessonsLeft: newLessonsLeft };
}

// ══════════════════════════════════════════
//  ПЕРСОНАЛЬНЫЕ УРОКИ
// ══════════════════════════════════════════

function getPersonalLessons() {
  const sheet = getSheet('PersonalLessons');
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return [];

  const result = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;

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

    result.push({
      id:        row[0].toString(),
      type:      row[1] ? row[1].toString() : '',
      clientId1: row[2] ? row[2].toString() : '',
      clientId2: row[3] ? row[3].toString() : '',
      clientId3: row[4] ? row[4].toString() : '',
      date:      dateStr,
      price:     parseFloat(row[6]) || 0,
      paid:      row[7] ? row[7].toString() : 'no',
      row:       i + 1
    });
  }
  return result;
}

function addPersonalLessons(lessonsData) {
  const sheet = getSheet('PersonalLessons');
  const dates = lessonsData.dates || [];

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