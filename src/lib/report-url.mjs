// Builds a prefilled GitHub Issue URL for a visitor report (Fix 1).
// Pure functions, so the same template is used for the live link and for
// the copyable fallback text shown while no real repo is configured.
// Never put a real API key in a report; the template never asks for one.

export function buildReportTitle(provider, entryId) {
  return `[Report]: ${provider} - ${entryId}`;
}

export function buildReportBody(provider, entryId) {
  return [
    `المزود: ${provider}`,
    `معرّف الإدخال: ${entryId}`,
    '',
    'ما الذي تغير؟ (أوقف نموذج، تغير حد مجاني، تغير سعر، تعطّل رابط، إضافة نموذج)',
    '',
    'الحد القديم:',
    '',
    'الحد الجديد:',
    '',
    'رابط المصدر الرسمي للتغيير (التوثيق أو صفحة الأسعار أو إعلان المزود):',
    '',
    'التاريخ الذي رأيت فيه التغيير:',
    '',
    'ملاحظات إضافية:',
    '',
    'ملاحظة: لا تضع أي مفتاح API حقيقي هنا أبدا.',
  ].join('\n');
}

export function buildReportUrl(repoUrl, provider, entryId) {
  const base = String(repoUrl || '').replace(/\/+$/, '');
  if (!base) return null;
  const params = new URLSearchParams({
    title: buildReportTitle(provider, entryId),
    labels: 'visitor-report',
    body: buildReportBody(provider, entryId),
  });
  return `${base}/issues/new?${params.toString()}`;
}
