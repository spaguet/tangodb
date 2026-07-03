/**
 * Import organization data into v2 Supabase (multi-tenant).
 *
 * Usage:
 *   node scripts/import-org.mjs --dry-run --org-id UUID --input path/to/export.json
 *   node scripts/import-org.mjs --apply --org-id UUID --input path/to/export.json --slug my-school
 *   node scripts/import-org.mjs --apply ... --resume-from subscriptions
 *
 * See tangodb_import_TZ.md for field mapping.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import {
  formatDate,
  parseArgs,
  printUsage,
  detectFormat,
  createSupabaseClient,
  insertBatch,
  fileSha256,
  shouldRunStep,
  inferPriceCategory,
  IMPORT_STEPS,
} from './lib/import-common.mjs';
import { IdMappingStore } from './lib/import-mapping.mjs';
import { validateExport } from './lib/import-validate.mjs';
import { resolveLegacyPriceKey, runImportPostprocess } from './lib/import-postprocess.mjs';

function buildLegacyClients(data, orgId, mapping) {
  const clientById = new Map();

  for (const c of data.clients ?? []) {
    const oldId = String(c.ID);
    clientById.set(oldId, {
      id: mapping.mapOrCreate('clients', oldId),
      organization_id: orgId,
      first_name: (c.FirstName || '—').trim(),
      last_name: (c.LastName || '—').trim(),
      telegram: c.Telegram || '',
    });
  }

  const ensureClient = (id) => {
    if (!id) return;
    const key = String(id);
    if (!clientById.has(key)) {
      clientById.set(key, {
        id: mapping.mapOrCreate('clients', key),
        organization_id: orgId,
        first_name: 'Удалён',
        last_name: `(ID ${key.slice(-6)})`,
        telegram: '',
      });
    }
  };

  for (const s of data.subscriptions ?? []) {
    ensureClient(s.ClientID1);
    ensureClient(s.ClientID2);
    ensureClient(s.ClientID3);
  }
  for (const l of data.personalLessons ?? []) {
    ensureClient(l.Client1 || l.ClientID1);
    ensureClient(l.Client2 || l.ClientID2);
    ensureClient(l.Client3 || l.ClientID3);
  }

  return [...clientById.values()];
}

function buildLegacyPrices(data, orgId, mapping, defaultLocationId) {
  return (data.prices ?? [])
    .filter((p) => p.Type)
    .map((p) => {
      const type = String(p.Type).trim();
      const lessons = parseInt(p.Lessons, 10);
      const category = inferPriceCategory(type);
      const mapKey = `${type}|${lessons}`;
      return {
        id: mapping.mapOrCreate('prices', mapKey),
        organization_id: orgId,
        type,
        lessons,
        price: parseFloat(p.Price) || 0,
        category,
        ...(defaultLocationId ? { location_id: defaultLocationId } : {}),
      };
    });
}

const LEGACY_DEFAULT_GROUP_NAME = 'Группа';

function buildLegacySchedule(data, orgId, mapping, defaultDisciplineId, defaultLocationId) {
  const defaultClassId = mapping.getUuid('classes', '__default__');
  return (data.schedule ?? []).map((s) => {
    const dow = parseInt(s.DayOfWeek, 10);
    const time = s.Time;
    const mapKey = defaultDisciplineId ? `${dow}|${time}|${defaultDisciplineId}` : `${dow}|${time}`;
    return {
      id: mapping.mapOrCreate('schedule_slots', mapKey),
      organization_id: orgId,
      day_of_week: dow,
      time,
      time_end: '21:00',
      discipline_id: defaultDisciplineId,
      group_name: LEGACY_DEFAULT_GROUP_NAME,
      ...(defaultLocationId ? { location_id: defaultLocationId } : {}),
      ...(defaultClassId ? { class_id: defaultClassId } : {}),
    };
  });
}

function legacySubscriptionPriceId(s, mapping) {
  const key = resolveLegacyPriceKey({
    type: s.Type,
    lessons_total: parseInt(s.LessonsTotal, 10),
    pair_month: s.PairMonth != null && s.PairMonth !== '' ? String(s.PairMonth) : '',
  });
  if (!key) return null;
  return mapping.getUuid('prices', `${key.type}|${key.lessons}`);
}

function buildLegacySubscriptions(data, orgId, mapping, defaultDisciplineId) {
  return (data.subscriptions ?? []).map((s) => {
    const oldId = String(s.ID);
    const type = s.Type;
    const pairMonth =
      type === 'pair'
        ? s.PairMonth != null && s.PairMonth !== ''
          ? String(s.PairMonth)
          : ''
        : '';

    const priceId = legacySubscriptionPriceId(s, mapping);

    return {
      id: mapping.mapOrCreate('subscriptions', oldId),
      organization_id: orgId,
      type,
      client_id1: mapping.mapOrCreate('clients', String(s.ClientID1)),
      client_id2: s.ClientID2 ? mapping.mapOrCreate('clients', String(s.ClientID2)) : null,
      client_id3: s.ClientID3 ? mapping.mapOrCreate('clients', String(s.ClientID3)) : null,
      lessons_total: parseInt(s.LessonsTotal, 10),
      lessons_left: parseInt(s.LessonsLeft, 10),
      freeze_used: parseInt(s.FreezeUsed, 10) || 0,
      activation_date: formatDate(s.ActivationDate),
      status: s.Status,
      pair_month: pairMonth,
      category: 'group',
      ...(priceId ? { price_id: priceId } : {}),
      ...(defaultDisciplineId ? { discipline_id: defaultDisciplineId } : {}),
    };
  });
}

function buildLegacyAttendance(data, orgId, mapping) {
  const scheduleGroupId = mapping.getUuid('classes', '__default__');
  return (data.attendance ?? []).map((a) => ({
    organization_id: orgId,
    date: formatDate(a.Date),
    subscription_id: mapping.mapOrCreate('subscriptions', String(a.SubscriptionID)),
    schedule_group_id: scheduleGroupId,
    client_display: a.ClientDisplay,
    attendance_status: a.AttendanceStatus,
  }));
}

function legacyPersonalLessonTimes(_dateKey, slotIndex) {
  const startMinutes = 8 * 60 + slotIndex * 60;
  const endMinutes = startMinutes + 45;
  const fmt = (total) =>
    `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  return { time_start: fmt(startMinutes), time_end: fmt(endMinutes) };
}

function buildLegacyPersonalLessons(data, orgId, mapping, defaultLocationId) {
  const slotByDate = new Map();
  return (data.personalLessons ?? []).map((l) => {
    const date = formatDate(l.Date);
    const slot = slotByDate.get(date) ?? 0;
    slotByDate.set(date, slot + 1);
    const { time_start, time_end } = legacyPersonalLessonTimes(date, slot);
    return {
      id: mapping.mapOrCreate('personal_lessons', String(l.ID)),
      organization_id: orgId,
      type: l.Type,
      client_id1: l.Client1 || l.ClientID1 ? mapping.mapOrCreate('clients', String(l.Client1 || l.ClientID1)) : null,
      client_id2: l.Client2 || l.ClientID2 ? mapping.mapOrCreate('clients', String(l.Client2 || l.ClientID2)) : null,
      client_id3: l.Client3 || l.ClientID3 ? mapping.mapOrCreate('clients', String(l.Client3 || l.ClientID3)) : null,
      date,
      time_start,
      time_end,
      price: parseFloat(l.Price) || 0,
      paid: l.Paid || 'no',
      ...(defaultLocationId ? { location_id: defaultLocationId } : {}),
    };
  });
}

function buildV2Disciplines(data, orgId, mapping) {
  return (data.disciplines ?? []).map((d) => {
    const ext = d.externalId ?? d.id;
    return {
      id: mapping.mapOrCreate('disciplines', ext),
      organization_id: orgId,
      name: d.name,
      description: d.description ?? '',
    };
  });
}

function buildV2Locations(data, orgId, mapping) {
  return (data.locations ?? []).map((loc) => {
    const ext = loc.externalId ?? loc.id;
    return {
      id: mapping.mapOrCreate('locations', ext),
      organization_id: orgId,
      name: loc.name,
      address: loc.address ?? '',
    };
  });
}

function buildV2Classes(data, orgId, mapping) {
  return (data.classes ?? []).map((cls) => {
    const ext = cls.externalId ?? cls.id;
    const disciplineExt = cls.disciplineExternalId ?? cls.discipline_id;
    const locationExt = cls.defaultLocationExternalId ?? cls.default_location_id;
    const teacherExt = cls.primaryTeacherMemberExternalId ?? cls.primary_teacher_member_id;
    return {
      id: mapping.mapOrCreate('classes', ext),
      organization_id: orgId,
      name: cls.name,
      discipline_id: disciplineExt ? mapping.mapOrCreate('disciplines', disciplineExt) : null,
      default_location_id: locationExt ? mapping.mapOrCreate('locations', locationExt) : null,
      primary_teacher_member_id: teacherExt ? mapping.getUuid('members', teacherExt) : null,
    };
  });
}

async function verifyOrg(supabase, orgId) {
  const { data, error } = await supabase.from('organizations').select('id, name, status').eq('id', orgId).maybeSingle();
  if (error) throw new Error(`organizations lookup: ${error.message}`);
  if (!data) throw new Error(`Organization not found: ${orgId}`);
  return data;
}

async function countOrgRows(supabase, orgId) {
  const tables = ['clients', 'prices', 'schedule_slots', 'subscriptions', 'attendance', 'personal_lessons'];
  const counts = {};
  for (const table of tables) {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq('organization_id', orgId);
    if (error) counts[table] = `error: ${error.message}`;
    else counts[table] = count ?? 0;
  }
  return counts;
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help || (!args.dryRun && !args.apply)) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  if (!args.orgId || !args.input) {
    console.error('Required: --org-id and --input');
    printUsage();
    process.exit(1);
  }

  const inputPath = resolve(process.cwd(), args.input);
  if (!existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(inputPath, 'utf8'));
  const format = args.format ?? detectFormat(data);
  const slug = args.slug ?? args.orgId.slice(0, 8);
  const sourceHash = fileSha256(inputPath);

  console.log(`Format: ${format}`);
  console.log(`Org: ${args.orgId}`);
  console.log(`Input: ${inputPath}`);
  console.log(`Mode: ${args.dryRun ? 'dry-run' : 'apply'}`);

  const report = validateExport(data, format);
  console.log('\nValidation report:');
  console.log(JSON.stringify({ ok: report.ok, counts: report.counts, issueCount: report.issues.length }, null, 2));

  if (report.issues.length) {
    const errors = report.issues.filter((i) => i.severity === 'error');
    const warnings = report.issues.filter((i) => i.severity !== 'error');
    if (errors.length) {
      console.log('\nErrors:');
      console.log(JSON.stringify(errors, null, 2));
    }
    if (warnings.length && warnings.length <= 10) {
      console.log('\nWarnings/info:');
      console.log(JSON.stringify(warnings, null, 2));
    } else if (warnings.length) {
      console.log(`\n${warnings.length} warnings/info (use --verbose to see all)`);
    }
  }

  if (!report.ok) {
    console.error('\nValidation failed. Fix errors before apply.');
    process.exit(1);
  }

  let supabase = null;
  let org = null;

  if (args.apply || process.env.SUPABASE_SERVICE_KEY) {
    try {
      supabase = createSupabaseClient();
      org = await verifyOrg(supabase, args.orgId);
      console.log(`\nTarget org: ${org.name} (${org.status})`);
    } catch (err) {
      if (args.apply) {
        console.error(err.message);
        process.exit(1);
      }
      console.warn(`\nDB check skipped: ${err.message}`);
    }
  }

  const mapping = new IdMappingStore({
    orgId: args.orgId,
    slug,
    sourceFile: inputPath,
    sourceHash,
  });

  const orgId = args.orgId;
  let defaultDisciplineId = null;
  let defaultLocationId = args.defaultLocationId ?? null;

  const plan = {};

  if (format === 'legacy-gas') {
    plan.clients = () => buildLegacyClients(data, orgId, mapping);
    plan.prices = () => buildLegacyPrices(data, orgId, mapping, defaultLocationId);
    plan.subscriptions = () => buildLegacySubscriptions(data, orgId, mapping, defaultDisciplineId);
    plan.attendance = () => buildLegacyAttendance(data, orgId, mapping);
    plan.personal_lessons = () => buildLegacyPersonalLessons(data, orgId, mapping, defaultLocationId);

    if (args.defaultDiscipline && (data.schedule ?? []).length) {
      plan.disciplines = () => {
        const id = mapping.mapOrCreate('disciplines', '__default__');
        defaultDisciplineId = id;
        return [
          {
            id,
            organization_id: orgId,
            name: args.defaultDiscipline,
            description: 'Imported default discipline',
          },
        ];
      };
      plan.classes = () => {
        const disciplineId = mapping.getUuid('disciplines', '__default__') ?? defaultDisciplineId;
        return [
          {
            id: mapping.mapOrCreate('classes', '__default__'),
            organization_id: orgId,
            name: LEGACY_DEFAULT_GROUP_NAME,
            discipline_id: disciplineId,
            ...(defaultLocationId ? { default_location_id: defaultLocationId } : {}),
          },
        ];
      };
      plan.schedule_slots = () =>
        buildLegacySchedule(data, orgId, mapping, defaultDisciplineId, defaultLocationId);
    } else {
      plan.schedule_slots = () => buildLegacySchedule(data, orgId, mapping, null);
    }
  } else {
    if (data.settings) {
      plan.settings = () => [{ organization_id: orgId, ...data.settings }];
    }
    plan.locations = () => buildV2Locations(data, orgId, mapping);
    plan.disciplines = () => buildV2Disciplines(data, orgId, mapping);
    plan.classes = () => buildV2Classes(data, orgId, mapping);
    plan.clients = () =>
      (data.clients ?? []).map((c) => ({
        id: mapping.mapOrCreate('clients', c.externalId ?? c.id),
        organization_id: orgId,
        first_name: c.first_name,
        last_name: c.last_name,
        telegram: c.telegram ?? '',
        archived_at: c.archived_at ?? null,
      }));
    plan.prices = () =>
      (data.prices ?? []).map((p) => {
        const mapKey = `${p.type}|${p.lessons}`;
        return {
          id: mapping.mapOrCreate('prices', p.externalId ?? mapKey),
          organization_id: orgId,
          type: p.type,
          lessons: p.lessons,
          price: p.price,
          category: p.category ?? inferPriceCategory(p.type),
          label: p.label ?? null,
          description: p.description ?? null,
        };
      });
    plan.schedule_slots = () =>
      (data.schedule_slots ?? []).map((s) => {
        const ext = s.externalId ?? `${s.day_of_week}|${s.time}`;
        const discExt = s.disciplineExternalId ?? s.discipline_id;
        return {
          id: mapping.mapOrCreate('schedule_slots', ext),
          organization_id: orgId,
          day_of_week: s.day_of_week,
          time: s.time,
          time_end: s.time_end ?? '21:00',
          discipline_id: discExt ? mapping.mapOrCreate('disciplines', discExt) : null,
          location_id: s.locationExternalId ? mapping.mapOrCreate('locations', s.locationExternalId) : null,
          class_id: s.classExternalId ? mapping.mapOrCreate('classes', s.classExternalId) : null,
        };
      });
    plan.subscriptions = () =>
      (data.subscriptions ?? []).map((s) => ({
        id: mapping.mapOrCreate('subscriptions', s.externalId ?? s.id),
        organization_id: orgId,
        type: s.type,
        client_id1: mapping.mapOrCreate('clients', s.clientExternalIds?.[0] ?? s.client_id1),
        client_id2: s.clientExternalIds?.[1] ? mapping.mapOrCreate('clients', s.clientExternalIds[1]) : null,
        client_id3: s.clientExternalIds?.[2] ? mapping.mapOrCreate('clients', s.clientExternalIds[2]) : null,
        lessons_total: s.lessons_total,
        lessons_left: s.lessons_left,
        freeze_used: s.freeze_used ?? 0,
        activation_date: formatDate(s.activation_date),
        status: s.status,
        pair_month: s.pair_month ?? '',
        category: s.category ?? 'group',
        discipline_id: s.disciplineExternalId ? mapping.mapOrCreate('disciplines', s.disciplineExternalId) : null,
      }));
    plan.attendance = () =>
      (data.attendance ?? []).map((a) => ({
        organization_id: orgId,
        date: formatDate(a.date),
        subscription_id: mapping.mapOrCreate('subscriptions', a.subscriptionExternalId ?? a.subscription_id),
        client_display: a.client_display,
        attendance_status: a.attendance_status,
      }));
    plan.personal_lessons = () =>
      (data.personal_lessons ?? data.personalLessons ?? []).map((l) => ({
        id: mapping.mapOrCreate('personal_lessons', l.externalId ?? l.id),
        organization_id: orgId,
        type: l.type,
        client_id1: l.clientExternalIds?.[0] ? mapping.mapOrCreate('clients', l.clientExternalIds[0]) : null,
        client_id2: l.clientExternalIds?.[1] ? mapping.mapOrCreate('clients', l.clientExternalIds[1]) : null,
        client_id3: l.clientExternalIds?.[2] ? mapping.mapOrCreate('clients', l.clientExternalIds[2]) : null,
        date: formatDate(l.date),
        time_start: l.time_start ?? '14:00',
        time_end: l.time_end ?? '15:00',
        price: l.price ?? 0,
        paid: l.paid ?? 'no',
      }));
  }

  console.log('\nImport plan:');
  for (const step of IMPORT_STEPS) {
    if (!plan[step]) continue;
    if (!shouldRunStep(step, args.resumeFrom)) continue;
    const rows = plan[step]();
    console.log(`  ${step}: ${rows.length} row(s)`);
  }

  if (args.dryRun) {
    console.log('\nDry-run complete (no DB writes).');
    console.log('Mapping preview:', JSON.stringify(mapping.summary(), null, 2));
    process.exit(0);
  }

  if (!supabase) {
    console.error('Apply requires SUPABASE_URL and SUPABASE_SERVICE_KEY');
    process.exit(1);
  }

  if (args.defaultLocationName || args.defaultLocationId) {
    const { resolveLocation } = await import('./lib/import-postprocess.mjs');
    const loc = await resolveLocation(supabase, orgId, {
      locationId: args.defaultLocationId,
      locationName: args.defaultLocationName,
    });
    defaultLocationId = loc.id;
    console.log(`\nDefault location: ${loc.name} (${loc.id})`);
  }

  console.log('\nApplying...');

  const tableForStep = {
    settings: 'organization_settings',
    locations: 'locations',
    disciplines: 'disciplines',
    classes: 'classes',
    clients: 'clients',
    prices: 'prices',
    schedule_slots: 'schedule_slots',
    subscriptions: 'subscriptions',
    attendance: 'attendance',
    personal_lessons: 'personal_lessons',
  };

  for (const step of IMPORT_STEPS) {
    if (!plan[step] || !shouldRunStep(step, args.resumeFrom)) continue;
    if (mapping.isStepCompleted(step)) {
      console.log(`  [skip] ${step} (completed)`);
      continue;
    }

    const rows = plan[step]();
    const table = tableForStep[step];
    console.log(`  ${step} → ${table}: ${rows.length} row(s)`);

    if (rows.length === 0) {
      mapping.markStepCompleted(step);
      continue;
    }

    if (step === 'settings') {
      const { organization_id: _oid, ...patch } = rows[0];
      const { error } = await supabase.from(table).update(patch).eq('organization_id', orgId);
      if (error) throw new Error(`${table}: ${error.message}`);
    } else {
      await insertBatch(supabase, table, rows);
    }

    mapping.markStepCompleted(step);
  }

  mapping.save();

  if (args.defaultLocationName || args.defaultLocationId) {
    console.log('\nPostprocess (location, subscription groups, payments)...');
    const postStats = await runImportPostprocess(supabase, orgId, {
      locationId: defaultLocationId,
      dryRun: false,
    });
    console.log('Postprocess:', JSON.stringify(postStats, null, 2));
  }

  const dbCounts = await countOrgRows(supabase, orgId);
  console.log('\nApply complete.');
  console.log('DB counts:', JSON.stringify(dbCounts, null, 2));
  console.log('Mapping:', JSON.stringify(mapping.summary(), null, 2));
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
