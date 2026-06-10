/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import { useState } from "react";
import { ShieldCheck, Copy, Database, HelpCircle, Layers, FileSpreadsheet, Eye } from "lucide-react";

export default function SyncPanel({ toast }: { toast: (msg: string) => void }) {
  const [copiedCode, setCopiedCode] = useState(false);

  const gsCode = `// ══════════════════════════════════════════
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
`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(gsCode);
    setCopiedCode(true);
    toast("📋 Код скопирован в буфер обмена!");
    setTimeout(() => setCopiedCode(false), 3000);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs space-y-6 font-sans">
        <div className="flex items-center gap-2.5 text-slate-800 border-b border-slate-100 pb-3">
          <Database className="w-5 h-5 text-indigo-600" />
          <div>
            <h2 className="font-sans text-sm font-bold tracking-tight">Синхронизация с Google Sheets</h2>
            <p className="text-slate-400 text-xs mt-0.5">
              TangoDB изначально создана для работы поверх Ваших Google Таблиц. Применяйте силу экосистемы Google без потерь.
            </p>
          </div>
        </div>

        {/* Visual setup indicator badge */}
        <div className="flex items-start gap-4 p-4 bg-indigo-50/50 border border-indigo-100 rounded-lg">
          <ShieldCheck className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-sans text-xs font-bold text-indigo-900">
              Гибридный синхро-слой (Hybrid Integration SDK)
            </h4>
            <p className="text-slate-600 text-xs leading-relaxed">
              Интеллектуальное ядро React автоматически определит свое местоположение. Если Вы открываете приложение внутри Вашего Google Apps Script, оно <strong>автоматически активирует живую связь с Вашей таблицей</strong>. При просмотре в AI Studio/браузере, оно перейдёт в режим offline-симулятора!
            </p>
          </div>
        </div>

        {/* Column guidelines */}
        <div className="space-y-3.5 pt-1">
          <h3 className="font-sans text-xs font-bold text-slate-800 flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
            1. Из каких листов состоит Google Таблица?
          </h3>
          <p className="text-xs text-slate-500 leading-normal">
            Для корректной записи данных создайте в Вашей таблице Google Sheets 6 листов с первыми строчками-заголовками как указано ниже:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            <div className="p-3 border border-slate-100 rounded-lg bg-slate-50/80 space-y-1 font-mono">
              <span className="font-sans font-bold text-slate-700 block text-xs">Лист: Clients</span>
              <p className="text-indigo-600 text-[11px]">ID, FirstName, LastName, Telegram</p>
            </div>
            <div className="p-3 border border-slate-100 rounded-lg bg-slate-50/80 space-y-1 font-mono">
              <span className="font-sans font-bold text-slate-700 block text-xs">Лист: Schedule</span>
              <p className="text-indigo-600 text-[11px]">DayOfWeek, Time</p>
            </div>
            <div className="p-3 border border-slate-100 rounded-lg bg-slate-50/80 space-y-1 font-mono">
              <span className="font-sans font-bold text-slate-700 block text-xs">Лист: Prices</span>
              <p className="text-indigo-600 text-[11px]">Type, Lessons, Price</p>
            </div>
            <div className="p-3 border border-slate-100 rounded-lg bg-slate-50/80 space-y-1 font-mono">
              <span className="font-sans font-bold text-slate-700 block text-xs">Лист: Subscriptions</span>
              <p className="text-indigo-600 text-[11px] break-all">ID, Type, ClientID1, ClientID2, LessonsTotal, LessonsLeft, FreezeUsed, ActivationDate, Status, PairMonth</p>
            </div>
            <div className="p-3 border border-slate-100 rounded-lg bg-slate-50/80 space-y-1 font-mono">
              <span className="font-sans font-bold text-slate-700 block text-xs">Лист: Attendance</span>
              <p className="text-indigo-600 text-[11px]">Date, SubscriptionID, ClientDisplay, AttendanceStatus</p>
            </div>
            <div className="p-3 border border-slate-100 rounded-lg bg-slate-50/80 space-y-1 font-mono">
              <span className="font-sans font-bold text-slate-700 block text-xs">Лист: PersonalLessons</span>
              <p className="text-indigo-600 text-[11px] break-all">ID, Type, ClientID1, ClientID2, ClientID3, Date, Price, Paid</p>
            </div>
          </div>
        </div>

        {/* Copy GAS guidelines */}
        <div className="space-y-4 pt-1">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <h3 className="font-sans text-xs font-bold text-slate-800 flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600" />
              2. Код сервера Код.gs
            </h3>
            <button
              onClick={copyToClipboard}
              className="px-3 py-1.5 bg-indigo-650 hover:bg-indigo-700 text-white rounded text-xs font-sans font-bold transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              {copiedCode ? "Скопировано!" : "Копировать код"}
            </button>
          </div>

          <div className="relative rounded-lg overflow-hidden shadow-inner border border-slate-200">
            <div className="absolute right-3 top-3 bg-slate-805 text-slate-400 font-mono text-[9px] uppercase font-bold px-1.5 py-0.5 rounded leading-none">
              javascript / apps script
            </div>
            <pre className="p-4 bg-slate-900 text-slate-200 text-[11px] font-mono overflow-auto max-h-[220px] leading-relaxed">
              {gsCode}
            </pre>
          </div>
        </div>

        {/* Step-by-step deploy guidelines */}
        <div className="space-y-3 pt-4 border-t border-slate-100 leading-relaxed text-xs text-slate-550">
          <h4 className="font-sans font-bold text-slate-800 text-xs">3. Как опубликовать интерфейс в Google?</h4>
          <ol className="list-decimal pl-4 space-y-1.5">
            <li>Соберите проект в единый файл в AI Studio через экспорт или скопируйте HTML.</li>
            <li>Откройте Вашу таблицу Google, перейдите в меню <strong>Расширения → Apps Script</strong>.</li>
            <li>Создайте файл скрипта <code>Код.gs</code> и вставьте скопированный выше серверный код.</li>
            <li>Создайте HTML-файл <code>Index.html</code> и вставьте туда код нашего скомпилированного бандла (он содержит в себе React и стили).</li>
            <li>Нажмите <strong>Начать развертывание → Новое развертывание</strong>, выберите тип "Веб-приложение".</li>
            <li>Установите доступ "Все" (Anyone), скопируйте ссылку - это Ваше готовое, роскошное приложение, объединенное с Google Sheets!</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
