export function resolveLegacyPriceKey(sub) {
  const lessons = sub.lessons_total;
  if (sub.type === 'solo') return { type: 'solo', lessons };
  if (sub.type === 'pair_hm') return { type: 'pair_hm', lessons };
  if (sub.type === 'pair') {
    const pm = String(sub.pair_month || 'm1');
    const monthNum = pm.match(/^m?([123])$/)?.[1] ?? '1';
    return { type: `pair_m${monthNum}`, lessons };
  }
  return null;
}

export async function resolveLocation(supabase, orgId, { locationId, locationName }) {
  if (locationId) {
    const { data, error } = await supabase
      .from('locations')
      .select('id, name')
      .eq('organization_id', orgId)
      .eq('id', locationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`Location not found: ${locationId}`);
    return data;
  }

  const name = (locationName ?? '').trim();
  if (!name) throw new Error('Provide locationId or locationName');

  const { data, error } = await supabase
    .from('locations')
    .select('id, name')
    .eq('organization_id', orgId)
    .ilike('name', name);

  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error(`Location not found by name: ${name}`);
  if (data.length > 1) {
    throw new Error(`Multiple locations match "${name}": ${data.map((l) => l.name).join(', ')}`);
  }
  return data[0];
}

export async function runImportPostprocess(supabase, orgId, { locationId, locationName, dryRun = false } = {}) {
  const location = await resolveLocation(supabase, orgId, { locationId, locationName });

  const [
    { data: classes, error: classesErr },
    { data: slots, error: slotsErr },
    { data: prices, error: pricesErr },
    { data: subs, error: subsErr },
    { data: personalLessons, error: plErr },
  ] = await Promise.all([
    supabase.from('classes').select('id, name, discipline_id, default_location_id').eq('organization_id', orgId),
    supabase.from('schedule_slots').select('id, location_id').eq('organization_id', orgId),
    supabase.from('prices').select('id, type, lessons, price, location_id').eq('organization_id', orgId),
    supabase
      .from('subscriptions')
      .select('id, type, lessons_total, pair_month, price_id, discipline_id, activation_date, created_at, client_id1')
      .eq('organization_id', orgId),
    supabase
      .from('personal_lessons')
      .select('id, paid, price, location_id, client_id1, date, created_at')
      .eq('organization_id', orgId),
  ]);

  if (classesErr) throw new Error(classesErr.message);
  if (slotsErr) throw new Error(slotsErr.message);
  if (pricesErr) throw new Error(pricesErr.message);
  if (subsErr) throw new Error(subsErr.message);
  if (plErr) throw new Error(plErr.message);

  const importedClass = classes?.find((c) => c.name === 'Группа') ?? classes?.[0] ?? null;
  if (!importedClass) throw new Error('No schedule group (class) found in org');

  const priceByKey = new Map((prices ?? []).map((p) => [`${p.type}|${p.lessons}`, p]));

  const stats = {
    location: location.name,
    locationId: location.id,
    classesUpdated: 0,
    slotsUpdated: 0,
    pricesUpdated: 0,
    personalLessonsUpdated: 0,
    subscriptionsUpdated: 0,
    subscriptionGroupsInserted: 0,
    paymentsInserted: 0,
  };

  if (!dryRun) {
    if (importedClass.default_location_id !== location.id) {
      const { error } = await supabase
        .from('classes')
        .update({ default_location_id: location.id })
        .eq('organization_id', orgId)
        .eq('id', importedClass.id);
      if (error) throw new Error(`classes: ${error.message}`);
      stats.classesUpdated = 1;
    }

    const slotIds = (slots ?? []).filter((s) => s.location_id !== location.id).map((s) => s.id);
    if (slotIds.length) {
      const { error } = await supabase
        .from('schedule_slots')
        .update({ location_id: location.id })
        .eq('organization_id', orgId)
        .in('id', slotIds);
      if (error) throw new Error(`schedule_slots: ${error.message}`);
      stats.slotsUpdated = slotIds.length;
    }

    const priceIds = (prices ?? []).filter((p) => p.location_id !== location.id).map((p) => p.id);
    if (priceIds.length) {
      const { error } = await supabase
        .from('prices')
        .update({ location_id: location.id })
        .eq('organization_id', orgId)
        .in('id', priceIds);
      if (error) throw new Error(`prices: ${error.message}`);
      stats.pricesUpdated = priceIds.length;
    }

    const plIds = (personalLessons ?? []).filter((l) => l.location_id !== location.id).map((l) => l.id);
    if (plIds.length) {
      const { error } = await supabase
        .from('personal_lessons')
        .update({ location_id: location.id })
        .eq('organization_id', orgId)
        .in('id', plIds);
      if (error) throw new Error(`personal_lessons: ${error.message}`);
      stats.personalLessonsUpdated = plIds.length;
    }
  } else {
    stats.classesUpdated = importedClass.default_location_id !== location.id ? 1 : 0;
    stats.slotsUpdated = (slots ?? []).filter((s) => s.location_id !== location.id).length;
    stats.pricesUpdated = (prices ?? []).filter((p) => p.location_id !== location.id).length;
    stats.personalLessonsUpdated = (personalLessons ?? []).filter((l) => l.location_id !== location.id).length;
  }

  for (const sub of subs ?? []) {
    const key = resolveLegacyPriceKey(sub);
    const priceRow = key ? priceByKey.get(`${key.type}|${key.lessons}`) : null;
    const patch = {};
    if (priceRow && sub.price_id !== priceRow.id) patch.price_id = priceRow.id;
    if (importedClass.discipline_id && sub.discipline_id !== importedClass.discipline_id) {
      patch.discipline_id = importedClass.discipline_id;
    }
    if (Object.keys(patch).length === 0) continue;

    if (!dryRun) {
      const { error } = await supabase
        .from('subscriptions')
        .update(patch)
        .eq('organization_id', orgId)
        .eq('id', sub.id);
      if (error) throw new Error(`subscription ${sub.id}: ${error.message}`);
    }
    stats.subscriptionsUpdated += 1;
  }

  const { data: existingGroups, error: sgErr } = await supabase
    .from('subscription_groups')
    .select('subscription_id')
    .eq('organization_id', orgId);
  if (sgErr) throw new Error(sgErr.message);

  const linkedSubs = new Set((existingGroups ?? []).map((g) => g.subscription_id));
  const sgRows = (subs ?? [])
    .filter((s) => !linkedSubs.has(s.id))
    .map((s) => ({
      organization_id: orgId,
      subscription_id: s.id,
      schedule_group_id: importedClass.id,
    }));

  if (sgRows.length && !dryRun) {
    const { error } = await supabase.from('subscription_groups').insert(sgRows);
    if (error) throw new Error(`subscription_groups: ${error.message}`);
  }
  stats.subscriptionGroupsInserted = sgRows.length;

  const { data: clients, error: clientsErr } = await supabase
    .from('clients')
    .select('id, first_name, last_name')
    .eq('organization_id', orgId);
  if (clientsErr) throw new Error(clientsErr.message);

  const clientDisplay = new Map(
    (clients ?? []).map((c) => [c.id, `${(c.last_name || '').trim()} ${(c.first_name || '').trim()}`.trim()])
  );

  const { data: existingPayments, error: payErr } = await supabase
    .from('payments')
    .select('subscription_id, personal_lesson_id')
    .eq('organization_id', orgId);
  if (payErr) throw new Error(payErr.message);

  const paidSubIds = new Set(
    (existingPayments ?? []).filter((p) => p.subscription_id && !p.personal_lesson_id).map((p) => p.subscription_id)
  );
  const paidPlIds = new Set(
    (existingPayments ?? []).filter((p) => p.personal_lesson_id).map((p) => p.personal_lesson_id)
  );

  const paymentRows = [];

  for (const sub of subs ?? []) {
    if (paidSubIds.has(sub.id)) continue;
    const key = resolveLegacyPriceKey(sub);
    const priceRow = key ? priceByKey.get(`${key.type}|${key.lessons}`) : null;
    const amount = Number(priceRow?.price ?? 0);
    if (amount <= 0 || !sub.client_id1) continue;

    paymentRows.push({
      organization_id: orgId,
      client_id: sub.client_id1,
      client_display: clientDisplay.get(sub.client_id1) || 'Клиент',
      amount,
      method: 'cash',
      subscription_id: sub.id,
      personal_lesson_id: null,
      created_at: sub.activation_date
        ? `${sub.activation_date}T12:00:00.000Z`
        : sub.created_at ?? new Date().toISOString(),
    });
  }

  for (const lesson of personalLessons ?? []) {
    if (paidPlIds.has(lesson.id)) continue;
    if (lesson.paid !== 'yes' || !lesson.price || lesson.price <= 0 || !lesson.client_id1) continue;

    paymentRows.push({
      organization_id: orgId,
      client_id: lesson.client_id1,
      client_display: clientDisplay.get(lesson.client_id1) || 'Клиент',
      amount: lesson.price,
      method: 'cash',
      subscription_id: null,
      personal_lesson_id: lesson.id,
      created_at: lesson.date
        ? `${lesson.date}T12:00:00.000Z`
        : lesson.created_at ?? new Date().toISOString(),
    });
  }

  if (paymentRows.length && !dryRun) {
    const BATCH = 200;
    for (let i = 0; i < paymentRows.length; i += BATCH) {
      const chunk = paymentRows.slice(i, i + BATCH);
      const { error } = await supabase.from('payments').insert(chunk);
      if (error) throw new Error(`payments batch ${i}: ${error.message}`);
    }
  }
  stats.paymentsInserted = paymentRows.length;

  return stats;
}
