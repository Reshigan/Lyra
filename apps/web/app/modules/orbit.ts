import type { WorkspaceSpec } from "./spec";

// ORBIT — the customer side (docs/03 §ORBIT). The conversation is the unit:
// renewals, journeys and handover notes are what a relationship needs between
// conversations, and partners are the conversations somebody else is having on
// our behalf. Messages and journey runs are written by the runtime, never here.

export const orbit: WorkspaceSpec = {
  path: "/orbit",
  labels: {
    en: {
      conversations: "Conversations",
      thread: "Open thread",
      messages: "Messages",
      renewals: "Renewals",
      journeys: "Journeys",
      "journey-runs": "Journey runs",
      partners: "Partners",
      "partner-txns": "Partner transactions",
      "handover-notes": "Handover notes",
      "qa-scores": "Quality scores",

      externalRef: "External reference",
      customerId: "Customer",
      channel: "Channel",
      state: "State",
      assigneeRef: "Assignee",
      teamId: "Team",
      csat: "Satisfaction",
      summary: "Summary",
      lang: "Language",
      intent: "Intent",
      sentiment: "Sentiment",
      firstResponseMs: "First response",
      closedAt: "Closed",
      lastMessageAt: "Last message",
      conversationId: "Conversation",
      content: "Message",
      role: "Sender",
      modality: "Modality",
      attachmentsJson: "Attachments",
      deliveryStatus: "Delivery",
      ts: "When",
      policyRef: "Policy reference",
      expiryAt: "Expires",
      churnScore: "Churn risk",
      strategy: "Strategy",
      requotesJson: "Re-quotes",
      offeredAt: "Offered",
      decidedAt: "Decided",
      outcomeReason: "Outcome reason",
      ownerRef: "Owner",
      key: "Key",
      version: "Version",
      status: "Status",
      createdBy: "Created by",
      nameJson: "Name",
      graphJson: "Graph",
      journeyId: "Journey",
      node: "Node",
      nextAt: "Next step",
      name: "Name",
      kind: "Kind",
      sandboxFlag: "Sandbox",
      revshareJson: "Revenue share",
      contactJson: "Contact",
      txnRef: "Transaction reference",
      partnerId: "Partner",
      amountMinor: "Amount",
      currency: "Currency",
      revshareCalcMinor: "Partner share",
      settlementBatch: "Settlement batch",
      fromRef: "From",
      toRef: "To",
      generatedBy: "Written by",
      acceptedBy: "Accepted by",
      factsJson: "Facts",
      rubricKey: "Rubric",
      score: "Score",
      scoredBy: "Scored by",
      disputedBy: "Disputed by",
      breakdownJson: "Breakdown",
      flagsJson: "Flags",

      whatsapp: "WhatsApp",
      web: "Web",
      voice: "Voice",
      email: "Email",
      agent: "Agent",
      bot: "Bot",
      human: "Human",
      closed: "Closed",
      customer: "Customer",
      agent_ai: "AI agent",
      agent_human: "Human agent",
      system: "System",
      queued: "Queued",
      sent: "Sent",
      delivered: "Delivered",
      read: "Read",
      failed: "Failed",
      scheduled: "Scheduled",
      offered: "Offered",
      accepted: "Accepted",
      lost: "Lost",
      auto_requote: "Auto re-quote",
      do_not_contact: "Do not contact",
      draft: "Draft",
      active: "Active",
      paused: "Paused",
      retired: "Retired",
      running: "Running",
      waiting: "Waiting",
      done: "Done",
      halted: "Halted",
      telco: "Telco",
      auto: "Motor",
      superapp: "Super app",
      bank: "Bank",
      quote: "Quote",
      bind: "Bind",
      refund: "Refund",
      ai: "AI"
    },
    ar: {
      conversations: "المحادثات",
      thread: "فتح المحادثة",
      messages: "الرسائل",
      renewals: "التجديدات",
      journeys: "الرحلات",
      "journey-runs": "مسارات الرحلة",
      partners: "الشركاء",
      "partner-txns": "معاملات الشركاء",
      "handover-notes": "ملاحظات التسليم",
      "qa-scores": "درجات الجودة",

      externalRef: "المرجع الخارجي",
      customerId: "العميل",
      channel: "القناة",
      state: "الوضع",
      assigneeRef: "المكلف",
      teamId: "الفريق",
      csat: "رضا العميل",
      summary: "الملخص",
      lang: "اللغة",
      intent: "القصد",
      sentiment: "المشاعر",
      firstResponseMs: "زمن أول رد",
      closedAt: "تاريخ الإغلاق",
      lastMessageAt: "آخر رسالة",
      conversationId: "المحادثة",
      content: "الرسالة",
      role: "المرسل",
      modality: "الوسيط",
      attachmentsJson: "المرفقات",
      deliveryStatus: "التسليم",
      ts: "الوقت",
      policyRef: "مرجع الوثيقة",
      expiryAt: "تاريخ الانتهاء",
      churnScore: "احتمال الفقد",
      strategy: "الاستراتيجية",
      requotesJson: "عروض إعادة التسعير",
      offeredAt: "تاريخ العرض",
      decidedAt: "تاريخ القرار",
      outcomeReason: "سبب النتيجة",
      ownerRef: "المسؤول",
      key: "المفتاح",
      version: "الإصدار",
      status: "الحالة",
      createdBy: "أنشأه",
      nameJson: "الاسم",
      graphJson: "المخطط",
      journeyId: "الرحلة",
      node: "العقدة",
      nextAt: "الخطوة التالية",
      name: "الاسم",
      kind: "النوع",
      sandboxFlag: "بيئة اختبار",
      revshareJson: "تقاسم الإيرادات",
      contactJson: "جهة الاتصال",
      txnRef: "مرجع المعاملة",
      partnerId: "الشريك",
      amountMinor: "المبلغ",
      currency: "العملة",
      revshareCalcMinor: "حصة الشريك",
      settlementBatch: "دفعة التسوية",
      fromRef: "من",
      toRef: "إلى",
      generatedBy: "مصدر الكتابة",
      acceptedBy: "قبِلها",
      factsJson: "الحقائق",
      rubricKey: "معيار التقييم",
      score: "الدرجة",
      scoredBy: "قام بالتقييم",
      disputedBy: "اعترض عليها",
      breakdownJson: "تفصيل الدرجة",
      flagsJson: "التنبيهات",

      whatsapp: "واتساب",
      web: "الويب",
      voice: "صوت",
      email: "البريد الإلكتروني",
      agent: "وكيل",
      bot: "آلي",
      human: "بشري",
      closed: "مغلقة",
      customer: "عميل",
      agent_ai: "وكيل ذكاء اصطناعي",
      agent_human: "وكيل بشري",
      system: "النظام",
      queued: "في الطابور",
      sent: "أُرسلت",
      delivered: "وصلت",
      read: "مقروءة",
      failed: "فشلت",
      scheduled: "مجدول",
      offered: "معروض",
      accepted: "مقبول",
      lost: "خسارة",
      auto_requote: "تسعير تلقائي",
      do_not_contact: "عدم التواصل",
      draft: "مسودة",
      active: "نشطة",
      paused: "متوقفة مؤقتًا",
      retired: "مسحوبة",
      running: "قيد التنفيذ",
      waiting: "بالانتظار",
      done: "مكتمل",
      halted: "متوقف",
      telco: "اتصالات",
      auto: "سيارات",
      superapp: "تطبيق شامل",
      bank: "بنك",
      quote: "عرض سعر",
      bind: "إصدار",
      refund: "استرداد",
      ai: "ذكاء اصطناعي"
    }
  },
  tabs: [
    {
      key: "conversations",
      api: "/v1/orbit/conversations",
      read: "orbit:conversations:read",
      recordLink: { href: "/orbit/conversations/{id}/thread", labelKey: "thread" },
      create: "orbit:conversations:reply",
      update: "orbit:conversations:assign",
      // The queue is read newest-first; the index is (tenant, state, lastMessageAt).
      sort: "lastMessageAt",
      filters: [
        { name: "state", options: ["bot", "human", "closed"] },
        { name: "channel", options: ["whatsapp", "web", "voice", "email", "agent"] }
      ],
      columns: [
        { name: "externalRef", type: "text" },
        { name: "customerId", type: "text" },
        { name: "channel", type: "text", badge: true },
        { name: "state", type: "text", badge: true },
        { name: "assigneeRef", type: "text" },
        { name: "intent", type: "text" },
        { name: "sentiment", type: "number" },
        { name: "csat", type: "number" },
        { name: "firstResponseMs", type: "number" },
        { name: "closedAt", type: "datetime" },
        { name: "lastMessageAt", type: "datetime", sortable: true }
      ],
      fields: [
        {
          name: "channel",
          type: "select",
          required: true,
          options: ["whatsapp", "web", "voice", "email", "agent"]
        },
        { name: "customerId", type: "text" },
        { name: "externalRef", type: "text" },
        { name: "lang", type: "text" }
      ],
      // The write permission is `assign`: routing and closing, not rewriting history.
      editable: [
        { name: "state", type: "select", options: ["bot", "human", "closed"] },
        { name: "assigneeRef", type: "text" },
        { name: "teamId", type: "text" },
        { name: "summary", type: "textarea" }
      ]
    },
    {
      key: "messages",
      api: "/v1/orbit/messages",
      read: "orbit:messages:read",
      create: "orbit:messages:send",
      // Immutable in the API: a turn that was sent cannot be edited or withdrawn.
      sort: "ts",
      filters: [
        { name: "role", options: ["customer", "agent_ai", "agent_human", "system"] },
        { name: "deliveryStatus", options: ["queued", "sent", "delivered", "read", "failed"] }
      ],
      columns: [
        { name: "content", type: "text" },
        { name: "conversationId", type: "text" },
        { name: "role", type: "text", badge: true },
        { name: "modality", type: "text" },
        { name: "deliveryStatus", type: "text", badge: true },
        { name: "externalRef", type: "text" },
        { name: "ts", type: "datetime", sortable: true },
        // What was sent alongside the words. Last: a turn with five files
        // should not push the turn itself off the side of the table.
        { name: "attachmentsJson", type: "json" }
      ],
      fields: [
        { name: "conversationId", type: "text", required: true },
        {
          name: "role",
          type: "select",
          required: true,
          options: ["customer", "agent_ai", "agent_human", "system"]
        },
        { name: "content", type: "textarea", required: true }
      ]
    },
    {
      key: "renewals",
      api: "/v1/orbit/renewals",
      read: "orbit:renewals:read",
      update: "orbit:renewals:update",
      // A renewal is created by the expiry sweep, never by hand — so no `fields`.
      sort: "expiryAt",
      order: "asc",
      filters: [
        { name: "state", options: ["scheduled", "offered", "accepted", "lost"] },
        { name: "strategy", options: ["auto_requote", "human", "do_not_contact"] }
      ],
      columns: [
        { name: "policyRef", type: "text" },
        { name: "customerId", type: "text" },
        { name: "expiryAt", type: "date", sortable: true },
        { name: "churnScore", type: "number" },
        { name: "strategy", type: "text", badge: true },
        { name: "state", type: "text", badge: true },
        { name: "offeredAt", type: "datetime" },
        { name: "decidedAt", type: "datetime" },
        { name: "ownerRef", type: "text" },
        // Every re-quote the sweep gathered for this expiry. Wide, so last.
        { name: "requotesJson", type: "json" }
      ],
      editable: [
        {
          name: "strategy",
          type: "select",
          options: ["auto_requote", "human", "do_not_contact"]
        },
        { name: "state", type: "select", options: ["scheduled", "offered", "accepted", "lost"] },
        { name: "ownerRef", type: "text" },
        { name: "outcomeReason", type: "text" }
      ]
    },
    {
      key: "journeys",
      api: "/v1/orbit/journeys",
      read: "orbit:journeys:read",
      create: "orbit:journeys:write",
      update: "orbit:journeys:write",
      remove: "orbit:journeys:write",
      filters: [{ name: "status", options: ["draft", "active", "paused", "retired"] }],
      columns: [
        { name: "key", type: "text" },
        { name: "version", type: "number" },
        { name: "status", type: "text", badge: true },
        { name: "createdBy", type: "text" },
        { name: "createdAt", type: "datetime", sortable: true }
      ],
      fields: [
        { name: "key", type: "text", required: true },
        { name: "version", type: "number", required: true },
        { name: "nameJson", type: "json", required: true },
        { name: "graphJson", type: "json", required: true }
      ],
      editable: [
        { name: "status", type: "select", options: ["draft", "active", "paused", "retired"] },
        { name: "graphJson", type: "json" }
      ]
    },
    {
      key: "journey-runs",
      api: "/v1/orbit/journey-runs",
      read: "orbit:journeys:read",
      // Where each customer stands in a graph. The scheduler owns every column.
      sort: "nextAt",
      order: "asc",
      filters: [{ name: "state", options: ["running", "waiting", "done", "halted"] }],
      columns: [
        { name: "journeyId", type: "text" },
        { name: "customerId", type: "text" },
        { name: "node", type: "text" },
        { name: "state", type: "text", badge: true },
        { name: "nextAt", type: "datetime", sortable: true },
        { name: "updatedAt", type: "datetime", sortable: true }
      ]
    },
    {
      key: "partners",
      api: "/v1/orbit/partners",
      read: "orbit:partners:read",
      create: "orbit:partners:create",
      update: "orbit:partners:update",
      search: true,
      filters: [{ name: "kind", options: ["telco", "auto", "superapp", "bank"] }],
      columns: [
        { name: "name", type: "text" },
        { name: "kind", type: "text" },
        { name: "status", type: "text", badge: true },
        { name: "sandboxFlag", type: "boolean" },
        { name: "createdAt", type: "datetime", sortable: true }
      ],
      // Creating a partner goes through the `dist.partner_activate` approval.
      fields: [
        { name: "name", type: "text", required: true },
        {
          name: "kind",
          type: "select",
          required: true,
          options: ["telco", "auto", "superapp", "bank"]
        },
        { name: "sandboxFlag", type: "boolean" },
        { name: "revshareJson", type: "json" },
        { name: "contactJson", type: "json" }
      ],
      editable: [
        { name: "status", type: "text" },
        { name: "sandboxFlag", type: "boolean" },
        { name: "revshareJson", type: "json" },
        { name: "contactJson", type: "json" }
      ]
    },
    {
      key: "partner-txns",
      api: "/v1/orbit/partner-txns",
      read: "orbit:partners:read",
      sort: "ts",
      filters: [{ name: "kind", options: ["quote", "bind", "refund"] }],
      columns: [
        { name: "txnRef", type: "text" },
        { name: "partnerId", type: "text" },
        { name: "kind", type: "text" },
        { name: "amountMinor", type: "money", currencyFrom: "currency" },
        { name: "revshareCalcMinor", type: "money", currencyFrom: "currency" },
        { name: "settlementBatch", type: "text" },
        { name: "ts", type: "datetime", sortable: true }
      ]
    },
    {
      key: "handover-notes",
      api: "/v1/orbit/handover-notes",
      read: "orbit:handover:read",
      create: "orbit:handover:write",
      update: "orbit:handover:write",
      remove: "orbit:handover:write",
      sort: "ts",
      filters: [{ name: "generatedBy", options: ["ai", "human"] }],
      columns: [
        { name: "summary", type: "text" },
        { name: "conversationId", type: "text" },
        { name: "fromRef", type: "text" },
        { name: "toRef", type: "text" },
        { name: "generatedBy", type: "text", badge: true },
        { name: "acceptedBy", type: "text" },
        { name: "ts", type: "datetime", sortable: true }
      ],
      fields: [
        { name: "conversationId", type: "text", required: true },
        { name: "fromRef", type: "text", required: true },
        { name: "toRef", type: "text" },
        { name: "summary", type: "textarea", required: true },
        { name: "factsJson", type: "json" }
      ],
      editable: [
        { name: "toRef", type: "text" },
        { name: "summary", type: "textarea" },
        { name: "acceptedBy", type: "text" },
        { name: "factsJson", type: "json" }
      ]
    },
    {
      key: "qa-scores",
      api: "/v1/orbit/qa-scores",
      read: "orbit:qa:read",
      // `orbit:qa:score` is a reviewer scoring a conversation against a rubric;
      // the AI scorer writes the same shape. Neither may amend a score after.
      create: "orbit:qa:score",
      sort: "ts",
      columns: [
        { name: "rubricKey", type: "text" },
        { name: "conversationId", type: "text" },
        { name: "score", type: "number" },
        { name: "scoredBy", type: "text" },
        { name: "disputedBy", type: "text" },
        { name: "ts", type: "datetime", sortable: true }
      ],
      fields: [
        { name: "conversationId", type: "text", required: true },
        { name: "rubricKey", type: "text", required: true },
        { name: "score", type: "number", required: true },
        { name: "breakdownJson", type: "json" },
        { name: "flagsJson", type: "json" }
      ]
    }
  ]
};
