// Pure helpers for changelog.json — shared by Astro pages and Node scripts.
// No Astro or Node-only imports here, so both can use this file.
// A no-change run is a single entry with date (start), optional date_end,
// and optional consecutive_days. Entries without those fields are treated
// as a one-day run, so old entries keep displaying correctly.

export function isNoChange(entry) {
  return entry && (entry.type === 'تأكيد عدم تغيير' || entry.type === 'no-change');
}

export function entryEndDate(entry) {
  return entry.date_end || entry.date;
}

export function entryDays(entry) {
  if (!isNoChange(entry)) return 0;
  // Date range wins over a stored counter, so extending a run can never
  // leave a stale consecutive_days value (a bug caught in testing).
  if (entry.date_end && entry.date_end !== entry.date) {
    const days = Math.round(
      (new Date(entry.date_end) - new Date(entry.date)) / 86400000,
    ) + 1;
    return days > 0 ? days : 1;
  }
  if (typeof entry.consecutive_days === 'number' && entry.consecutive_days > 0) {
    return entry.consecutive_days;
  }
  return 1;
}

// Latest date in the changelog, including date_end of a merged run.
export function getLastUpdated(entries) {
  let latest = null;
  for (const entry of entries || []) {
    for (const d of [entry.date, entry.date_end]) {
      if (d && (!latest || d > latest)) latest = d;
    }
  }
  return latest;
}

// The most recent no-change run in the file (searching from the end).
export function getLatestNoChangeRun(entries) {
  for (let i = (entries || []).length - 1; i >= 0; i--) {
    if (isNoChange(entries[i])) return entries[i];
  }
  return null;
}

// Merge rule (Fix 3): if the last entry is a no-change entry, extend it
// instead of appending a new object. Returns a NEW array; does not mutate.
export function addNoChange(entries, dateStr) {
  const list = [...(entries || [])];
  const last = list[list.length - 1];
  if (last && isNoChange(last)) {
    const start = last.date;
    const prevEnd = entryEndDate(last);
    // A date earlier than the run start is not a new day; leave as-is.
    if (dateStr <= prevEnd) return list;
    const updated = { ...last, date_end: dateStr };
    updated.consecutive_days = entryDays({ ...updated, date_end: dateStr });
    list[list.length - 1] = updated;
    return list;
  }
  list.push({
    date: dateStr,
    model: '—',
    new_limit: 'لا تغيير في القائمة اليوم، وسيُنشر أي تغيير مكتشف في نفس اليوم',
    old_limit: '—',
    provider: 'لا يوجد تغيير منشور',
    source: 'سجل التغييرات اليومي',
    type: 'تأكيد عدم تغيير',
  });
  return list;
}
