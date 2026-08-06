# 26 — Arabic glossary

One concept, one Arabic term. Every `ar` string in `apps/web/app` and
`packages/ui` uses the term in this table; a synonym that reads better in one
sentence but differs from the rest of the product is a bug, not a style choice.
The audit that produced this list is
`docs/superpowers/2026-08-05-me-polish-audit.md` §3.

## Why a glossary and not a style guide

Arabic gives every English noun three or four defensible renderings. Left to
per-screen judgement, "approval" became اعتماد on the claim screen, إقرار on
settlement and موافقة on the approvals queue — three words for one button on
three screens a single reviewer uses in one shift. A reader who has to relearn
the vocabulary per screen reads the product as translated, not written.

## The table

| Concept (en) | Term (ar) | Not |
|---|---|---|
| approval (the decision, the queue, the record) | الموافقة / الموافقات | اعتماد، إقرار |
| approve (the action) | الموافقة | اعتماد |
| credentials (API keys, sign-in secrets) | بيانات الاعتماد | — (the only surviving use of اعتماد) |
| tenant / customer organisation | المؤسسة | المستأجر (a person who rents a flat) |
| panel (the set of providers that quote) | قائمة الجهات المسعّرة، then القائمة | اللجنة (a committee)، اللوحة (a board) |
| dashboard | اللوحة | — |
| queue (work waiting to be worked) | قائمة الانتظار | طابور (a queue of people at a counter) |
| autopilot | الطيار الآلي | القائد الآلي |
| cockpit | مركز القيادة | قمرة |
| retired (a version, an agent, taken out of service) | مسحوب / مسحوبة | متقاعد (a pensioner)، موقوفة (paused) |
| cross-sell | بيع تكميلي | بيع متقاطع، بيع تكاملي |
| prompt (the text sent to a model) | الموجّه / الموجّهات | المطالبة (a claim) |
| ghost text (the AI inline suggestion, docs/15) | نص تمهيدي خافت | نص شبحي |
| audit log | سجل التدقيق | — |
| settlement | التسوية | — |
| release / pay out | الصرف | — |
| theme (the light or dark palette) | السمة | الموضوع (a topic)، النمط (a pattern) |
| results (what a search returned) | النتائج | المخرجات (outputs)، الحصائل |

## Orthography

- Tanwin sits before the alef: `شكرًا`, never `شكراً`.
- Hamzat al-wasl on a passive verb is spelled: `أُصدر`, `أُسند`, `أُصدرت`.
- Feminine agreement follows the row's subject. A table of `نسخة` rows reads
  `مسودة / نشطة / مسحوبة`, not `مسودة / نشِط / متقاعد`.
- `لا` negation agrees with its noun: `لا توجد مطابقة`, not `لا يوجد مطابقة`.

## Adding a term

A new concept goes in this table in the same PR that introduces its first
string. Changing an existing term is a sweep across every `ar` block, not a
single screen — grep the old term first and confirm it reaches zero.
