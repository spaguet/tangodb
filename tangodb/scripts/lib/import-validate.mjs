import { formatDate, inferPriceCategory } from './import-common.mjs';

/**
 * Validate export data before import. Returns { ok, counts, issues }.
 */
export function validateExport(data, format) {
  const issues = [];
  const normalized = normalizeForValidation(data, format);

  const clientIds = new Set(normalized.clients.map((c) => c.externalId));
  const subIds = new Set(normalized.subscriptions.map((s) => s.externalId));

  for (const c of normalized.clients) {
    if (typeof c.rawId === 'number') {
      issues.push({
        severity: 'warning',
        type: 'client_numeric_id',
        id: c.rawId,
        stringId: c.externalId,
        note: 'Sheets exported ID as number — possible precision loss in JSON',
      });
    }
  }

  for (const l of normalized.personalLessons) {
    if (typeof l.rawId === 'number') {
      issues.push({
        severity: 'warning',
        type: 'personal_numeric_id',
        id: l.rawId,
        stringId: l.externalId,
      });
    }
  }

  const refClients = new Set();
  for (const s of normalized.subscriptions) {
    for (const id of s.clientExternalIds) {
      if (id) refClients.add(id);
    }
  }
  for (const l of normalized.personalLessons) {
    for (const id of l.clientExternalIds) {
      if (id) refClients.add(id);
    }
  }

  const missingClients = [...refClients].filter((id) => !clientIds.has(id));
  if (missingClients.length) {
    issues.push({
      severity: 'info',
      type: 'missing_clients_in_sheet',
      count: missingClients.length,
      ids: missingClients.slice(0, 20),
      note: 'Stub clients "Удалён (ID …)" will be created on import',
    });
  }

  const badAttSub = normalized.attendance.filter((a) => !subIds.has(a.subscriptionExternalId));
  if (badAttSub.length) {
    issues.push({
      severity: 'error',
      type: 'attendance_unknown_subscription',
      count: badAttSub.length,
      ids: [...new Set(badAttSub.map((a) => a.subscriptionExternalId))].slice(0, 20),
    });
  }

  const validSubTypes = new Set(['solo', 'pair', 'pair_hm']);
  const validStatus = new Set(['active', 'finished']);
  const validAtt = new Set(['present', 'absent', 'freeze']);
  const validPLTypes = new Set(['solo', 'pair', 'trio']);

  for (const s of normalized.subscriptions) {
    if (!validSubTypes.has(s.type)) {
      issues.push({ severity: 'error', type: 'sub_bad_type', id: s.externalId, value: s.type });
    }
    if (!validStatus.has(s.status)) {
      issues.push({ severity: 'error', type: 'sub_bad_status', id: s.externalId, value: s.status });
    }
    const lt = parseInt(s.lessonsTotal, 10);
    if (!Number.isFinite(lt) || lt < 1) {
      issues.push({ severity: 'error', type: 'sub_bad_lessons_total', id: s.externalId, value: s.lessonsTotal });
    }
    if (s.type === 'pair' && !s.clientExternalIds[1]) {
      issues.push({ severity: 'error', type: 'pair_no_client2', id: s.externalId });
    }
    if (s.type === 'pair' && !['m1', 'm2', 'm3'].includes(s.pairMonth)) {
      issues.push({ severity: 'error', type: 'pair_bad_month', id: s.externalId, value: s.pairMonth });
    }
    const fu = parseInt(s.freezeUsed, 10);
    if (fu < 0 || !Number.isFinite(fu)) {
      issues.push({ severity: 'error', type: 'sub_bad_freeze', id: s.externalId, value: s.freezeUsed });
    }
    const ad = formatDate(s.activationDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ad)) {
      issues.push({ severity: 'error', type: 'sub_bad_date', id: s.externalId, value: s.activationDate });
    }
  }

  for (const a of normalized.attendance) {
    if (!validAtt.has(a.attendanceStatus)) {
      issues.push({
        severity: 'error',
        type: 'att_bad_status',
        date: a.date,
        subId: a.subscriptionExternalId,
        value: a.attendanceStatus,
      });
    }
    const d = formatDate(a.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      issues.push({ severity: 'error', type: 'att_bad_date', date: a.date, subId: a.subscriptionExternalId });
    }
  }

  const attKeys = new Map();
  for (const a of normalized.attendance) {
    const k = `${formatDate(a.date)}|${a.subscriptionExternalId}`;
    if (attKeys.has(k)) {
      issues.push({ severity: 'error', type: 'dup_attendance', key: k });
    }
    attKeys.set(k, true);
  }

  for (const l of normalized.personalLessons) {
    if (!validPLTypes.has(l.type)) {
      issues.push({ severity: 'error', type: 'pl_bad_type', id: l.externalId, value: l.type });
    }
    if (!['yes', 'no'].includes(l.paid)) {
      issues.push({ severity: 'error', type: 'pl_bad_paid', id: l.externalId, value: l.paid });
    }
    const d = formatDate(l.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      issues.push({ severity: 'error', type: 'pl_bad_date', id: l.externalId, value: l.date });
    }
  }

  for (const s of normalized.schedule) {
    const dow = parseInt(s.dayOfWeek, 10);
    if (dow < 1 || dow > 7) {
      issues.push({ severity: 'error', type: 'bad_day_of_week', value: s });
    }
  }

  for (const p of normalized.prices) {
    const cat = inferPriceCategory(p.type);
    if (!cat) {
      issues.push({ severity: 'error', type: 'price_unknown_type', typeValue: p.type, lessons: p.lessons });
    }
    const lessons = parseInt(p.lessons, 10);
    if (!Number.isFinite(lessons) || lessons < 1) {
      issues.push({ severity: 'error', type: 'price_bad_lessons', typeValue: p.type, lessons: p.lessons });
    }
  }

  const activeNames = new Map();
  for (const c of normalized.clients) {
    if (c.archivedAt) continue;
    const nameKey = `${c.lastName.trim().toLowerCase()}|${c.firstName.trim().toLowerCase()}`;
    if (activeNames.has(nameKey)) {
      issues.push({
        severity: 'error',
        type: 'dup_client_name',
        name: `${c.lastName} ${c.firstName}`,
        ids: [activeNames.get(nameKey), c.externalId],
      });
    } else {
      activeNames.set(nameKey, c.externalId);
    }
  }

  const errors = issues.filter((i) => i.severity === 'error');

  return {
    ok: errors.length === 0,
    counts: {
      clients: normalized.clients.length,
      schedule: normalized.schedule.length,
      prices: normalized.prices.length,
      subscriptions: normalized.subscriptions.length,
      attendance: normalized.attendance.length,
      personalLessons: normalized.personalLessons.length,
      locations: normalized.locations.length,
      disciplines: normalized.disciplines.length,
      classes: normalized.classes.length,
      stubClientsNeeded: missingClients.length,
    },
    missingClients,
    issues,
  };
}

function normalizeForValidation(data, format) {
  if (format === 'v2-json') {
    return {
      clients: (data.clients ?? []).map((c) => ({
        externalId: c.externalId ?? c.id,
        rawId: c.externalId ?? c.id,
        firstName: c.first_name ?? c.firstName ?? '',
        lastName: c.last_name ?? c.lastName ?? '',
        archivedAt: c.archived_at ?? c.archivedAt ?? null,
      })),
      schedule: (data.schedule_slots ?? data.schedule ?? []).map((s) => ({
        dayOfWeek: s.day_of_week ?? s.dayOfWeek ?? s.DayOfWeek,
        time: s.time ?? s.Time,
      })),
      prices: (data.prices ?? []).map((p) => ({
        type: p.type ?? p.Type,
        lessons: p.lessons ?? p.Lessons,
        price: p.price ?? p.Price,
      })),
      subscriptions: (data.subscriptions ?? []).map((s) => ({
        externalId: s.externalId ?? s.id ?? String(s.ID),
        rawId: s.externalId ?? s.id ?? s.ID,
        type: s.type ?? s.Type,
        clientExternalIds: s.clientExternalIds ?? [
          s.client_id1 ?? s.ClientID1,
          s.client_id2 ?? s.ClientID2,
          s.client_id3 ?? s.ClientID3,
        ].filter(Boolean).map(String),
        lessonsTotal: s.lessons_total ?? s.LessonsTotal,
        freezeUsed: s.freeze_used ?? s.FreezeUsed ?? 0,
        activationDate: s.activation_date ?? s.ActivationDate,
        status: s.status ?? s.Status,
        pairMonth: s.pair_month ?? s.PairMonth ?? '',
      })),
      attendance: (data.attendance ?? []).map((a) => ({
        date: a.date ?? a.Date,
        subscriptionExternalId: String(a.subscriptionExternalId ?? a.subscription_id ?? a.SubscriptionID),
        attendanceStatus: a.attendance_status ?? a.AttendanceStatus,
      })),
      personalLessons: (data.personalLessons ?? data.personal_lessons ?? []).map((l) => ({
        externalId: l.externalId ?? l.id ?? String(l.ID),
        rawId: l.externalId ?? l.id ?? l.ID,
        type: l.type ?? l.Type,
        clientExternalIds: [
          l.clientExternalIds?.[0] ?? l.client_id1 ?? l.Client1 ?? l.ClientID1,
          l.clientExternalIds?.[1] ?? l.client_id2 ?? l.Client2 ?? l.ClientID2,
          l.clientExternalIds?.[2] ?? l.client_id3 ?? l.Client3 ?? l.ClientID3,
        ].filter(Boolean).map(String),
        date: l.date ?? l.Date,
        paid: l.paid ?? l.Paid ?? 'no',
      })),
      locations: data.locations ?? [],
      disciplines: data.disciplines ?? [],
      classes: data.classes ?? [],
    };
  }

  return {
    clients: (data.clients ?? []).map((c) => ({
      externalId: String(c.ID),
      rawId: c.ID,
      firstName: c.FirstName || '—',
      lastName: c.LastName || '—',
      archivedAt: null,
    })),
    schedule: (data.schedule ?? []).map((s) => ({
      dayOfWeek: s.DayOfWeek,
      time: s.Time,
    })),
    prices: (data.prices ?? []).filter((p) => p.Type).map((p) => ({
      type: String(p.Type).trim(),
      lessons: p.Lessons,
      price: p.Price,
    })),
    subscriptions: (data.subscriptions ?? []).map((s) => ({
      externalId: String(s.ID),
      rawId: s.ID,
      type: s.Type,
      clientExternalIds: [s.ClientID1, s.ClientID2, s.ClientID3].filter(Boolean).map(String),
      lessonsTotal: s.LessonsTotal,
      freezeUsed: s.FreezeUsed ?? 0,
      activationDate: s.ActivationDate,
      status: s.Status,
      pairMonth: s.PairMonth != null && s.PairMonth !== '' ? String(s.PairMonth) : '',
    })),
    attendance: (data.attendance ?? []).map((a) => ({
      date: a.Date,
      subscriptionExternalId: String(a.SubscriptionID),
      attendanceStatus: a.AttendanceStatus,
    })),
    personalLessons: (data.personalLessons ?? []).map((l) => ({
      externalId: String(l.ID),
      rawId: l.ID,
      type: l.Type,
      clientExternalIds: [
        l.Client1 || l.ClientID1,
        l.Client2 || l.ClientID2,
        l.Client3 || l.ClientID3,
      ].filter(Boolean).map(String),
      date: l.Date,
      paid: l.Paid || 'no',
    })),
    locations: [],
    disciplines: [],
    classes: [],
  };
}
