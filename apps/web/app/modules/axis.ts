import type { WorkspaceSpec } from "./spec";

// AXIS — operations. The case is the unit of work (docs/03 §AXIS): everything
// else on this workspace either feeds a case (documents, tasks, quotes) or is
// what a case produced (policies, claims, escrow).

export const axis: WorkspaceSpec = {
  path: "/axis",
  labels: {
    en: {
      cases: "Cases",
      quotes: "Quotes",
      documents: "Documents",
      tasks: "Tasks",
      policies: "Policies",
      claims: "Claims",
      "escrow-batches": "Escrow",
      sops: "Procedures",
      "process-events": "Process events",
      "case-approvals": "Case approvals",

      ref: "Reference",
      kind: "Kind",
      status: "Status",
      priority: "Priority",
      source: "Source",
      slaDueAt: "SLA due",
      ownerRef: "Owner",
      customerId: "Customer",
      productLine: "Product line",
      channelId: "Channel",
      quoteRequestId: "Quote request",
      closedAt: "Closed",
      evidenceFileId: "Evidence file",
      riskScore: "Risk",
      valueMinor: "Value",
      currency: "Currency",
      caseId: "Case",
      providerId: "Provider",
      offeringId: "Offering",
      premiumMinor: "Premium",
      validUntil: "Valid until",
      winFlag: "Won",
      declineReason: "Decline reason",
      docType: "Document type",
      fileId: "File",
      extractionJson: "Extraction",
      extractionConfidence: "Extraction confidence",
      extractionModel: "Extraction model",
      verifiedAt: "Verified",
      verifiedBy: "Verified by",
      type: "Type",
      titleKey: "Title",
      assigneeRef: "Assignee",
      state: "State",
      dueAt: "Due",
      completedAt: "Completed",
      policyNo: "Policy number",
      startAt: "Starts",
      endAt: "Ends",
      commissionMinor: "Commission",
      docsJson: "Documents",
      escrowBatchId: "Escrow batch",
      paymentPlanJson: "Payment plan",
      productId: "Product",
      claimNo: "Claim number",
      policyId: "Policy",
      incidentAt: "Incident",
      reportedAt: "Reported",
      amountMinor: "Claimed",
      settledMinor: "Settled",
      assessorRef: "Assessor",
      period: "Period",
      expectedMinor: "Expected",
      receivedMinor: "Received",
      varianceReason: "Variance reason",
      key: "Key",
      version: "Version",
      appliesTo: "Applies to",
      step: "Step",
      actorRef: "Actor",
      durationMs: "Duration",
      outcome: "Outcome",
      ts: "When",
      createdAt: "Created",
      updatedAt: "Updated",
      policyKey: "Policy",
      decision: "Decision",
      subjectRef: "Subject",
      metaJson: "Details",
      coverageJson: "Coverage",
      fnolJson: "First notice",
      checklistJson: "Checklist",
      stepsJson: "Steps",
      nameJson: "Name",
      teamId: "Team"
    },
    ar: {
      cases: "الحالات",
      quotes: "عروض الأسعار",
      documents: "المستندات",
      tasks: "المهام",
      policies: "الوثائق",
      claims: "المطالبات",
      "escrow-batches": "الضمان",
      sops: "الإجراءات",
      "process-events": "أحداث العملية",
      "case-approvals": "موافقات الحالة",

      ref: "المرجع",
      kind: "النوع",
      status: "الحالة",
      priority: "الأولوية",
      source: "المصدر",
      slaDueAt: "موعد الاستحقاق",
      ownerRef: "المسؤول",
      customerId: "العميل",
      productLine: "خط المنتج",
      channelId: "القناة",
      quoteRequestId: "طلب عرض السعر",
      closedAt: "تاريخ الإغلاق",
      evidenceFileId: "ملف الإثبات",
      riskScore: "المخاطر",
      valueMinor: "القيمة",
      currency: "العملة",
      caseId: "الحالة",
      providerId: "المزود",
      offeringId: "العرض",
      premiumMinor: "القسط",
      validUntil: "صالح حتى",
      winFlag: "فائز",
      declineReason: "سبب الرفض",
      docType: "نوع المستند",
      fileId: "الملف",
      extractionJson: "بيانات الاستخراج",
      extractionConfidence: "ثقة الاستخراج",
      extractionModel: "نموذج الاستخراج",
      verifiedAt: "تم التحقق",
      verifiedBy: "تحقق بواسطة",
      type: "النوع",
      titleKey: "العنوان",
      assigneeRef: "المكلف",
      state: "الوضع",
      dueAt: "الاستحقاق",
      completedAt: "الإنجاز",
      policyNo: "رقم الوثيقة",
      startAt: "يبدأ",
      endAt: "ينتهي",
      commissionMinor: "العمولة",
      docsJson: "المستندات",
      escrowBatchId: "دفعة الضمان",
      paymentPlanJson: "خطة السداد",
      productId: "المنتج",
      claimNo: "رقم المطالبة",
      policyId: "الوثيقة",
      incidentAt: "الحادث",
      reportedAt: "تاريخ الإبلاغ",
      amountMinor: "المطالب به",
      settledMinor: "المسدد",
      assessorRef: "المقيّم",
      period: "الفترة",
      expectedMinor: "المتوقع",
      receivedMinor: "المستلم",
      varianceReason: "سبب الفرق",
      key: "المفتاح",
      version: "الإصدار",
      appliesTo: "ينطبق على",
      step: "الخطوة",
      actorRef: "الفاعل",
      durationMs: "المدة",
      outcome: "النتيجة",
      ts: "الوقت",
      createdAt: "أُنشئ",
      updatedAt: "حُدّث",
      policyKey: "السياسة",
      decision: "القرار",
      subjectRef: "الموضوع",
      metaJson: "التفاصيل",
      coverageJson: "التغطية",
      fnolJson: "الإخطار الأول",
      checklistJson: "قائمة التحقق",
      stepsJson: "الخطوات",
      nameJson: "الاسم",
      teamId: "الفريق"
    }
  },
  tabs: [
    {
      key: "cases",
      api: "/v1/axis/cases",
      read: "axis:cases:read",
      create: "axis:cases:create",
      update: "axis:cases:update",
      remove: "axis:cases:delete",
      search: true,
      sort: "slaDueAt",
      order: "asc",
      filters: [
        {
          name: "status",
          options: [
            "intake",
            "quoting",
            "awaiting_docs",
            "review",
            "approval",
            "issued",
            "failed",
            "cancelled"
          ]
        },
        { name: "priority", options: ["low", "normal", "high", "urgent"] }
      ],
      columns: [
        { name: "ref", type: "text", sortable: true },
        { name: "kind", type: "text" },
        { name: "status", type: "text", badge: true },
        { name: "priority", type: "text", badge: true },
        { name: "ownerRef", type: "text" },
        { name: "quoteRequestId", type: "text" },
        { name: "valueMinor", type: "money", currencyFrom: "currency" },
        { name: "slaDueAt", type: "datetime", sortable: true },
        { name: "closedAt", type: "datetime" },
        { name: "createdAt", type: "datetime", sortable: true }
      ],
      fields: [
        { name: "ref", type: "text", required: true },
        {
          name: "kind",
          type: "select",
          required: true,
          options: ["quote", "bind", "endorse", "renewal_ops", "group_medical", "kyc", "claim"]
        },
        { name: "customerId", type: "text" },
        { name: "productLine", type: "text" },
        { name: "channelId", type: "text" },
        { name: "priority", type: "select", options: ["low", "normal", "high", "urgent"] },
        {
          name: "source",
          type: "select",
          options: ["web", "orbit", "partner", "import", "api", "agent"]
        },
        { name: "valueMinor", type: "money" },
        { name: "currency", type: "text" },
        { name: "slaDueAt", type: "datetime" },
        { name: "ownerRef", type: "text" },
        { name: "teamId", type: "text" },
        { name: "metaJson", type: "json" }
      ],
      editable: [
        {
          name: "status",
          type: "select",
          options: [
            "intake",
            "quoting",
            "awaiting_docs",
            "review",
            "approval",
            "issued",
            "failed",
            "cancelled"
          ]
        },
        { name: "priority", type: "select", options: ["low", "normal", "high", "urgent"] },
        { name: "ownerRef", type: "text" },
        { name: "teamId", type: "text" },
        { name: "slaDueAt", type: "datetime" },
        { name: "valueMinor", type: "money" },
        { name: "riskScore", type: "number" },
        { name: "metaJson", type: "json" }
      ]
    },
    {
      key: "quotes",
      api: "/v1/axis/quotes",
      read: "axis:quotes:read",
      create: "axis:quotes:create",
      update: "axis:quotes:create",
      columns: [
        { name: "caseId", type: "text" },
        { name: "providerId", type: "text" },
        { name: "premiumMinor", type: "money", currencyFrom: "currency" },
        { name: "winFlag", type: "boolean" },
        { name: "validUntil", type: "date" },
        { name: "source", type: "text", badge: true },
        { name: "createdAt", type: "datetime", sortable: true }
      ],
      fields: [
        { name: "caseId", type: "text", required: true },
        { name: "providerId", type: "text", required: true },
        { name: "offeringId", type: "text" },
        { name: "premiumMinor", type: "money", required: true },
        { name: "currency", type: "text", required: true },
        { name: "validUntil", type: "date" },
        { name: "coverageJson", type: "json" },
        { name: "declineReason", type: "text" }
      ],
      editable: [
        { name: "premiumMinor", type: "money" },
        { name: "validUntil", type: "date" },
        { name: "winFlag", type: "boolean" },
        { name: "declineReason", type: "text" },
        { name: "coverageJson", type: "json" }
      ]
    },
    {
      key: "documents",
      api: "/v1/axis/documents",
      read: "axis:documents:read",
      create: "axis:documents:upload",
      update: "axis:documents:verify",
      filters: [
        { name: "status", options: ["received", "extracting", "extracted", "verified", "rejected"] }
      ],
      columns: [
        { name: "caseId", type: "text" },
        { name: "docType", type: "text" },
        { name: "status", type: "text", badge: true },
        { name: "extractionConfidence", type: "number" },
        { name: "extractionModel", type: "text" },
        { name: "verifiedBy", type: "text" },
        { name: "verifiedAt", type: "datetime" },
        { name: "createdAt", type: "datetime", sortable: true },
        // What the model read off the document. A whole extracted form's worth
        // of keys, so it goes last rather than through the middle of the list.
        { name: "extractionJson", type: "json" }
      ],
      fields: [
        { name: "caseId", type: "text", required: true },
        { name: "fileId", type: "text", required: true },
        {
          name: "docType",
          type: "select",
          required: true,
          options: ["eid", "mulkiya", "census", "medical", "tradelicense", "other"]
        }
      ],
      editable: [
        {
          name: "status",
          type: "select",
          options: ["received", "extracting", "extracted", "verified", "rejected"]
        }
      ]
    },
    {
      key: "tasks",
      api: "/v1/axis/tasks",
      read: "axis:tasks:read",
      create: "axis:tasks:write",
      update: "axis:tasks:write",
      remove: "axis:tasks:write",
      filters: [{ name: "state", options: ["open", "in_progress", "blocked", "done", "cancelled"] }],
      columns: [
        { name: "titleKey", type: "text" },
        { name: "type", type: "text" },
        { name: "caseId", type: "text" },
        { name: "assigneeRef", type: "text" },
        { name: "state", type: "text", badge: true },
        { name: "dueAt", type: "datetime", sortable: true }
      ],
      fields: [
        { name: "titleKey", type: "text", required: true },
        { name: "type", type: "text", required: true },
        { name: "caseId", type: "text" },
        { name: "assigneeRef", type: "text" },
        { name: "dueAt", type: "datetime" },
        { name: "checklistJson", type: "json" }
      ],
      editable: [
        { name: "state", type: "select", options: ["open", "in_progress", "blocked", "done", "cancelled"] },
        { name: "assigneeRef", type: "text" },
        { name: "dueAt", type: "datetime" },
        { name: "checklistJson", type: "json" }
      ]
    },
    {
      key: "policies",
      api: "/v1/axis/policies",
      read: "axis:policies:read",
      create: "axis:policies:create",
      update: "axis:policies:update",
      filters: [{ name: "status", options: ["active", "lapsed", "cancelled", "renewed"] }],
      sort: "endAt",
      order: "asc",
      columns: [
        { name: "policyNo", type: "text" },
        { name: "customerId", type: "text" },
        { name: "providerId", type: "text" },
        { name: "premiumMinor", type: "money", currencyFrom: "currency" },
        { name: "commissionMinor", type: "money", currencyFrom: "currency" },
        { name: "status", type: "text", badge: true },
        { name: "endAt", type: "date", sortable: true },
        { name: "escrowBatchId", type: "text" },
        { name: "docsJson", type: "json" },
        { name: "paymentPlanJson", type: "json" }
      ],
      fields: [
        { name: "policyNo", type: "text", required: true },
        { name: "customerId", type: "text", required: true },
        { name: "providerId", type: "text", required: true },
        { name: "caseId", type: "text" },
        { name: "productId", type: "text" },
        { name: "offeringId", type: "text" },
        { name: "channelId", type: "text" },
        { name: "startAt", type: "date", required: true },
        { name: "endAt", type: "date", required: true },
        { name: "premiumMinor", type: "money", required: true },
        { name: "currency", type: "text", required: true },
        { name: "commissionMinor", type: "money" }
      ],
      editable: [
        { name: "status", type: "select", options: ["active", "lapsed", "cancelled", "renewed"] },
        { name: "endAt", type: "date" },
        { name: "commissionMinor", type: "money" }
      ]
    },
    {
      key: "claims",
      api: "/v1/axis/claims",
      read: "axis:claims:read",
      create: "axis:claims:create",
      update: "axis:claims:update",
      filters: [
        {
          name: "status",
          options: ["reported", "assessing", "approved", "rejected", "settled", "withdrawn"]
        }
      ],
      sort: "reportedAt",
      columns: [
        { name: "claimNo", type: "text" },
        { name: "policyId", type: "text" },
        { name: "status", type: "text", badge: true },
        { name: "amountMinor", type: "money", currencyFrom: "currency" },
        { name: "settledMinor", type: "money", currencyFrom: "currency" },
        { name: "reportedAt", type: "datetime", sortable: true }
      ],
      fields: [
        { name: "claimNo", type: "text", required: true },
        { name: "policyId", type: "text", required: true },
        { name: "customerId", type: "text", required: true },
        { name: "caseId", type: "text" },
        { name: "incidentAt", type: "datetime" },
        { name: "reportedAt", type: "datetime", required: true },
        { name: "amountMinor", type: "money" },
        { name: "currency", type: "text", required: true },
        { name: "fnolJson", type: "json" }
      ],
      editable: [
        {
          name: "status",
          type: "select",
          options: ["reported", "assessing", "approved", "rejected", "settled", "withdrawn"]
        },
        { name: "assessorRef", type: "text" },
        // Settling is consequential: the API routes this through an approval
        // (resources.ts, axis.claim_settlement) rather than writing it directly.
        { name: "settledMinor", type: "money" }
      ]
    },
    {
      key: "escrow-batches",
      api: "/v1/axis/escrow-batches",
      read: "axis:escrow:read",
      update: "axis:escrow:reconcile",
      filters: [
        { name: "status", options: ["open", "reconciling", "matched", "variance", "closed"] }
      ],
      columns: [
        { name: "period", type: "text", sortable: true },
        { name: "providerId", type: "text" },
        { name: "expectedMinor", type: "money", currencyFrom: "currency" },
        { name: "receivedMinor", type: "money", currencyFrom: "currency" },
        { name: "status", type: "text", badge: true },
        { name: "closedAt", type: "datetime" }
      ],
      editable: [
        { name: "status", type: "select", options: ["open", "reconciling", "matched", "variance", "closed"] },
        { name: "receivedMinor", type: "money" },
        { name: "varianceReason", type: "text" },
        { name: "evidenceFileId", type: "text" }
      ]
    },
    {
      key: "sops",
      api: "/v1/axis/sops",
      read: "axis:sops:read",
      create: "axis:sops:write",
      update: "axis:sops:write",
      remove: "axis:sops:write",
      filters: [{ name: "status", options: ["draft", "active", "retired"] }],
      columns: [
        { name: "key", type: "text" },
        { name: "version", type: "number" },
        { name: "appliesTo", type: "text" },
        { name: "status", type: "text", badge: true },
        { name: "createdAt", type: "datetime", sortable: true }
      ],
      fields: [
        { name: "key", type: "text", required: true },
        { name: "version", type: "number", required: true },
        { name: "nameJson", type: "json", required: true },
        { name: "stepsJson", type: "json", required: true },
        { name: "appliesTo", type: "text" }
      ],
      editable: [
        { name: "status", type: "select", options: ["draft", "active", "retired"] },
        { name: "stepsJson", type: "json" }
      ]
    },
    {
      key: "case-approvals",
      api: "/v1/axis/case-approvals",
      read: "axis:cases:approve",
      columns: [
        { name: "caseId", type: "text" },
        { name: "policyKey", type: "text" },
        { name: "subjectRef", type: "text" },
        { name: "decision", type: "text", badge: true },
        { name: "ts", type: "datetime", sortable: true }
      ]
    },
    {
      key: "process-events",
      api: "/v1/axis/process-events",
      read: "axis:metrics:read",
      sort: "ts",
      columns: [
        { name: "caseId", type: "text" },
        { name: "step", type: "text" },
        { name: "actorRef", type: "text" },
        { name: "durationMs", type: "number" },
        { name: "outcome", type: "text" },
        { name: "ts", type: "datetime", sortable: true }
      ]
    }
  ]
};
