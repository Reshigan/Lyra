import type { Messages } from "./en";

// Written in Arabic, not translated from the English. Same key set, enforced by
// the Messages type and by app/shell.test.ts.

export const ar: Messages = {
  "app.skipToContent": "تخطَّ إلى المحتوى",
  "app.workspace": "مساحة العمل",
  "app.loading": "جارٍ التحميل",

  "nav.primary": "التنقل الرئيسي",
  "nav.home": "الرئيسية",
  "nav.axis": "العمليات",
  "nav.orbit": "المحادثات",
  "nav.signal": "التسويق",
  "nav.scout": "السوق",
  "nav.north": "التحليلات التنفيذية",
  "nav.distribution": "التوزيع",
  "nav.ledger": "الدفتر المحاسبي",
  "nav.analytics": "التقارير",
  "nav.compliance": "الامتثال",
  "nav.admin": "الإدارة",
  "nav.settings": "الإعدادات",

  "header.account": "الحساب",
  "header.signedInAs": "تسجيل الدخول باسم {name}",
  "header.settings": "الإعدادات",
  "header.signOut": "تسجيل الخروج",

  "auth.signIn": "تسجيل الدخول",
  "auth.intro": "أدخل بريد العمل وكلمة المرور للمتابعة.",
  "auth.email": "البريد الإلكتروني",
  "auth.password": "كلمة المرور",
  "auth.tenantSlug": "مساحة العمل",
  "auth.tenantSlug.hint": "بريدك مرتبط بأكثر من مساحة عمل. حدد المساحة التي تريد فتحها.",
  "auth.continue": "متابعة",
  "auth.working": "جارٍ التنفيذ…",
  "auth.totp.title": "التحقق بخطوتين",
  "auth.totp.intro": "أدخل الرمز المكوّن من ستة أرقام من تطبيق المصادقة.",
  "auth.totp.code": "رمز التحقق",
  "auth.totp.verify": "تحقق",
  "auth.totp.unavailable": "التحقق بخطوتين غير متاح بعد. اطلب من المسؤول إكمال تسجيل دخولك.",
  "auth.error.credentials": "البريد وكلمة المرور غير متطابقين. تحقق منهما وأعد المحاولة.",
  "auth.error.throttled": "محاولات كثيرة. انتظر بضع دقائق ثم أعد المحاولة.",
  "auth.error.locked": "هذا الحساب لا يمكنه تسجيل الدخول. يستطيع المسؤول إعادة تفعيله.",
  "auth.error.generic": "تعذّر إكمال تسجيل الدخول. لم يتغيّر شيء، ويمكنك المحاولة مرة أخرى.",
  "auth.error.code": "لم يُقبل هذا الرمز. الرموز تنتهي سريعًا — جرّب الرمز الحالي.",

  "error.title": "تعذّر تحميل هذه الصفحة",
  "error.generic": "تعذّر بناء الصفحة. لم يُحفظ شيء، ويمكنك المحاولة مرة أخرى.",
  "error.notFound": "لا يوجد شيء على هذا العنوان.",
  "error.forbidden": "أدوارك لا تشمل الوصول إلى هذا القسم.",
  "error.unauthorized": "انتهت جلستك. سجّل الدخول للمتابعة.",
  "error.retry": "أعد المحاولة",
  "error.requestId": "المرجع {id}",
  "error.detail": "التفاصيل"
};
