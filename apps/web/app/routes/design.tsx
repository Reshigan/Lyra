import { POST_RATIOS, postCardSvg, type PostRatio } from "@lyra/ui";
import { labelsFrom } from "./detail-kit";
import { useShellData } from "./workspace";

// The doctrine (Horizon comp §doctrine): the design system explaining itself —
// the four rules the platform is built to, the palette it inherits and the three
// type voices. The comp draws this as a z-95 overlay; docs/15 §4 has no modal
// pattern, and CLAUDE.md's definition of done names a design-system playground
// that never existed. One route satisfies both.
//
// Every swatch prints `var(--token)`, never a hex: a tenant that re-sets
// `--accent` (docs/01 §6) must see its own colour here, not ours.

type Labels = Record<string, Record<string, string>>;

/** `n` is the rule's number, `hue` the module accent that numbers it. */
const RULES = [
  { n: "01", hue: "text-module-axis" },
  { n: "02", hue: "text-module-orbit" },
  { n: "03", hue: "text-module-signal" },
  { n: "04", hue: "text-module-scout" }
] as const;

/** The palette, in reading order: identity, status, the five module marks, then
 *  the field they sit on. `key` names the row; the token is the only value. */
export const PALETTE = [
  { key: "accent", token: "--accent" },
  { key: "success", token: "--success" },
  { key: "warning", token: "--warning" },
  { key: "danger", token: "--danger" },
  { key: "info", token: "--info" },
  { key: "axis", token: "--module-axis" },
  { key: "orbit", token: "--module-orbit" },
  { key: "signal", token: "--module-signal" },
  { key: "scout", token: "--module-scout" },
  { key: "north", token: "--module-north" },
  { key: "bg", token: "--bg" },
  { key: "card", token: "--s2" },
  { key: "raised", token: "--s4" },
  { key: "line", token: "--line2" },
  { key: "text", token: "--tx" },
  { key: "quiet", token: "--tx4" }
] as const;

/** The three voices, each shown in the job it holds. The samples are figures and
 *  labels, not sentences, so they read the same in both languages. */
const VOICES = [
  { key: "serif", cls: "font-serif text-28 leading-display" },
  { key: "display", cls: "font-display text-18 font-600 tracking-[.02em]" },
  { key: "mono", cls: "font-mono text-22" }
] as const;

/**
 * The specimen figures the in-hand frame carries. Figures, not copy: they read
 * the same in both languages, exactly like the mono voice sample above. `hue`
 * is the token the delta is coloured by — down is not automatically bad, so the
 * direction is stated rather than derived.
 */
export const IN_HAND = [
  { key: "open", value: "34", delta: "+6", hue: "text-warning" },
  { key: "cleared", value: "18", delta: "+4", hue: "text-success" },
  { key: "response", value: "6.2m", delta: "−18%", hue: "text-success" },
  { key: "exposure", value: "41.8M", delta: "+2.1%", hue: "text-tx4" }
] as const;

const LABELS: Labels = {
  en: {
    eyebrow: "Horizon — the doctrine",
    headline: "Software that takes the shape of the person using it.",
    lead:
      "Most platforms ship one interface and hang role permissions off it: the same navigation, fewer items. This one inverts that. The identity is the interface — each role arrives in a workspace built for the work it does, and the seam between them is a first-class object rather than a disabled button.",
    "rule.01.title": "The identity is the interface",
    "rule.01.body":
      "Your roles decide the workspace you land in, the rail you navigate by and the home you read. Nothing hides behind a greyed-out control: a surface you have no claim on is absent, not disabled.",
    "rule.01.why": "packages/core lens · docs/06",
    "rule.02.title": "AI is ambient, never modal",
    "rule.02.body":
      "Drafts arrive as ghost text and quiet chips beside the work, never as a dialogue that stops it. Every artifact carries one ✦ and an inspectable why, and nothing is sent for you outside the autonomy policy.",
    "rule.02.why": "docs/15 §4",
    "rule.03.title": "Consequence waits for a person",
    "rule.03.body":
      "Anything that moves money or contractual state is a transaction: an idempotency key, a state machine, balanced journal lines, an approval. Automation is an allowlist a tenant writes, never a default we ship.",
    "rule.03.why": "docs/19",
    "rule.04.title": "Vocabulary is data",
    "rule.04.body":
      "The nouns in every label come from the active domain pack; the name, mark and accent above come from the tenant. There is not one brand string in this screen — including the one at the top of it.",
    "rule.04.why": "docs/21 · docs/01 §6",
    "palette.heading": "Palette — inherited, re-weighted",
    "palette.note": "Swatches read the live token. Re-theme the tenant and this page re-paints with it.",
    "palette.accent": "Accent",
    "palette.success": "Success",
    "palette.warning": "Warning",
    "palette.danger": "Danger",
    "palette.info": "Information",
    "palette.axis": "Operations",
    "palette.orbit": "Conversations",
    "palette.signal": "Marketing",
    "palette.scout": "Market",
    "palette.north": "Insight",
    "palette.bg": "Field",
    "palette.card": "Card",
    "palette.raised": "Raised",
    "palette.line": "Line",
    "palette.text": "Text",
    "palette.quiet": "Quiet text",
    "type.heading": "Type — three voices, one per job",
    "voice.serif.sample": "The narrated line",
    "voice.serif.note": "One human sentence per surface, and never twice.",
    "voice.display.sample": "STRUCTURE & LABELS",
    "voice.display.note": "Module marks and micro-labels, tracked wide, never bolder than 600.",
    "voice.mono.sample": "41.8M · 6.2 min · −18.4%",
    "voice.mono.note": "Every figure, reference and tick — so columns of numbers line up.",
    "hand.heading": "In hand",
    "hand.note":
      "The same doctrine at 328px: one narrated line, figures in mono, the ambient draft as a card beside the work rather than a dialogue over it. Nothing is re-styled for the phone — the tokens are the tokens.",
    "hand.title": "Your shift",
    "hand.head": "Two decisions are waiting on you.",
    "hand.open": "Open with you",
    "hand.cleared": "Cleared today",
    "hand.response": "Median response",
    "hand.exposure": "Exposure",
    "hand.card.label": "Drafted for you",
    "hand.card.body":
      "The renewal is priced 4% under last term because the vehicle moved to a lower-risk district. Nothing has been sent.",
    "hand.card.primary": "Review",
    "hand.card.secondary": "Why this",
    "hand.footer": "Approvals and evidence stay on the phone; anything consequential still waits for you to press it.",
    "hand.tab1": "Shift",
    "hand.tab2": "Records",
    "post.heading": "The post itself",
    "post.note": "A cleared SIGNAL variant rendered at the three frames the networks take, from the tenant\u2019s own brand. Preview and download are the same bytes.",
    "post.headline": "Cover the gap before renewal.",
    "post.body": "Two minutes, no paperwork, and your no-claim year stays yours.",
    "post.kicker": "Renewal save"
  },
  ar: {
    eyebrow: "Horizon — العقيدة التصميمية",
    headline: "برنامج يأخذ شكل من يستخدمه.",
    lead:
      "معظم المنصات تشحن واجهة واحدة ثم تعلّق عليها صلاحيات الأدوار: التنقل نفسه، وعناصر أقل. هنا العكس. الهوية هي الواجهة — كل دور يصل إلى مساحة عمل مبنية للعمل الذي يؤديه، والفاصل بينها كائن قائم بذاته لا زرًا معطلًا.",
    "rule.01.title": "الهوية هي الواجهة",
    "rule.01.body":
      "أدوارك تحدد مساحة العمل التي تصل إليها، وشريط التنقل، والصفحة التي تقرؤها. لا شيء يختبئ خلف عنصر باهت: السطح الذي لا صلاحية لك عليه غائب لا معطل.",
    "rule.01.why": "packages/core lens · docs/06",
    "rule.02.title": "الذكاء الاصطناعي محيط لا حاجز",
    "rule.02.body":
      "المسودات تصل كنص شبحي ورقائق هادئة بجوار العمل، لا كنافذة توقفه. كل ناتج يحمل علامة ✦ واحدة وسببًا قابلًا للفحص، ولا يُرسل شيء نيابة عنك خارج سياسة الاستقلالية.",
    "rule.02.why": "docs/15 §4",
    "rule.03.title": "ما له أثر ينتظر إنسانًا",
    "rule.03.body":
      "كل ما يحرك مالًا أو حالة تعاقدية معاملة: مفتاح تكرار، وآلة حالات، وقيود متوازنة، وموافقة. الأتمتة قائمة سماح يكتبها المستأجر، لا وضعًا افتراضيًا نشحنه.",
    "rule.03.why": "docs/19",
    "rule.04.title": "المفردات بيانات",
    "rule.04.body":
      "أسماء الأشياء في كل تسمية تأتي من حزمة المجال الفعّالة، والاسم والشعار واللون تأتي من المستأجر. لا توجد في هذه الشاشة سلسلة علامة تجارية واحدة — بما في ذلك التي في أعلاها.",
    "rule.04.why": "docs/21 · docs/01 §6",
    "palette.heading": "اللوحة — موروثة، معاد وزنها",
    "palette.note": "كل مربع يقرأ الرمز الحي. غيّر سمة المستأجر وتعاد طلاء هذه الصفحة معها.",
    "palette.accent": "لون الهوية",
    "palette.success": "نجاح",
    "palette.warning": "تحذير",
    "palette.danger": "خطر",
    "palette.info": "معلومة",
    "palette.axis": "العمليات",
    "palette.orbit": "المحادثات",
    "palette.signal": "التسويق",
    "palette.scout": "السوق",
    "palette.north": "التحليل",
    "palette.bg": "الحقل",
    "palette.card": "البطاقة",
    "palette.raised": "المرتفع",
    "palette.line": "الخط",
    "palette.text": "النص",
    "palette.quiet": "النص الهادئ",
    "type.heading": "الخط — ثلاثة أصوات، صوت لكل مهمة",
    "voice.serif.sample": "السطر المروي",
    "voice.serif.note": "جملة إنسانية واحدة لكل سطح، ولا تتكرر.",
    "voice.display.sample": "البنية والتسميات",
    "voice.display.note": "علامات الوحدات والتسميات الدقيقة، متباعدة الأحرف، ولا أثقل من 600.",
    "voice.mono.sample": "41.8M · 6.2 min · −18.4%",
    "voice.mono.note": "كل رقم ومرجع وعلامة قياس — حتى تصطف أعمدة الأرقام.",
    "hand.heading": "في اليد",
    "hand.note":
      "العقيدة نفسها بعرض 328 بكسل: سطر مروي واحد، وأرقام بخط أحادي، والمسودة المحيطة بطاقة بجوار العمل لا نافذة فوقه. لا شيء يُعاد تنسيقه للهاتف — الرموز هي الرموز.",
    "hand.title": "نوبتك",
    "hand.head": "قراران ينتظران قرارك.",
    "hand.open": "مفتوح لديك",
    "hand.cleared": "أُنجز اليوم",
    "hand.response": "وسيط زمن الرد",
    "hand.exposure": "التعرّض",
    "hand.card.label": "مسودة لك",
    "hand.card.body":
      "التجديد مسعّر أقل بنسبة ٤٪ من المدة السابقة لأن المركبة انتقلت إلى منطقة أقل خطرًا. لم يُرسل شيء.",
    "hand.card.primary": "مراجعة",
    "hand.card.secondary": "لماذا",
    "hand.footer": "الموافقات والأدلة تبقى على الهاتف؛ وكل ما له أثر ينتظر ضغطتك.",
    "hand.tab1": "النوبة",
    "hand.tab2": "السجلات",
    "post.heading": "المنشور نفسه",
    "post.note": "نسخة معتمدة من سيجنال بمقاسات المنصات الثلاثة، بهوية العميل نفسه. المعاينة والتنزيل ملف واحد.",
    "post.headline": "غطِّ الفجوة قبل التجديد.",
    "post.body": "دقيقتان دون أوراق، وخصمك يبقى لك.",
    "post.kicker": "حملة التجديد"
  }
};

export function Doctrine({
  locale,
  brandName = "",
  accent
}: {
  locale: string;
  /** The tenant's own name on the post specimen — never a literal (CLAUDE.md §5). */
  brandName?: string;
  accent?: string | undefined;
}) {
  const l = labelsFrom(LABELS)(locale);

  return (
    <div className="lyra-enter mx-auto flex max-w-[1000px] flex-col gap-8 py-2">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-12 uppercase tracking-[.18em] text-tx5">{l("eyebrow")}</p>
        <hr className="border-0 border-t border-line2" />
        <h1 className="font-serif text-36 leading-display text-tx0">{l("headline")}</h1>
        <p className="max-w-[78ch] text-14 leading-body text-tx4">{l("lead")}</p>
      </header>

      <div className="lyra-stagger grid gap-3 sm:grid-cols-2">
        {RULES.map((rule) => (
          <article key={rule.n} className="rounded-3 border border-line2 bg-s2 px-[18px] py-[17px]">
            <p className={`font-mono text-12 ${rule.hue}`}>{rule.n}</p>
            <h2 className="mt-2 font-display text-16 font-600 text-tx">{l(`rule.${rule.n}.title`)}</h2>
            <p className="mt-2 text-13 leading-body text-tx4">{l(`rule.${rule.n}.body`)}</p>
            <p className="mt-3 font-mono text-12 text-tx5">{l(`rule.${rule.n}.why`)}</p>
          </article>
        ))}
      </div>

      <div className="grid gap-7 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-16 font-600 text-tx">{l("palette.heading")}</h2>
          <p className="text-13 leading-body text-tx4">{l("palette.note")}</p>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
            {PALETTE.map((swatch) => (
              <li key={swatch.token} className="flex flex-col gap-1">
                {/* The swatch is the token, not a copy of it. */}
                <span
                  className="block h-[42px] rounded-2 border border-line2"
                  style={{ background: `var(${swatch.token})` }}
                />
                <span className="text-12 text-tx4">{l(`palette.${swatch.key}`)}</span>
                {/* A token name is an identifier: untranslated in both directions,
                    and forced left-to-right so it does not shred in Arabic. */}
                <span className="truncate font-mono text-12 text-tx5" dir="ltr">
                  {swatch.token}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-display text-16 font-600 text-tx">{l("type.heading")}</h2>
          <ul className="flex flex-col gap-4">
            {VOICES.map((voice) => (
              <li key={voice.key} className="border-t border-line2 pt-3">
                <p className={`${voice.cls} text-tx0`}>{l(`voice.${voice.key}.sample`)}</p>
                <p className="mt-2 text-13 leading-body text-tx4">{l(`voice.${voice.key}.note`)}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* CLAUDE.md's definition of done asks every UI change to note its mobile
          parity; this is where that is noted. A specimen, not a control: the
          frame is inert, and the phone itself is apps/mobile. */}
      <section className="flex flex-col gap-4 border-t border-line2 pt-7 lg:flex-row lg:items-start lg:gap-8">
        <div className="flex flex-1 flex-col gap-3">
          <h2 className="font-display text-16 font-600 text-tx">{l("hand.heading")}</h2>
          <p className="max-w-[60ch] text-13 leading-body text-tx4">{l("hand.note")}</p>
        </div>

        <div className="w-[328px] max-w-full flex-none rounded-[25px] border border-line4 bg-bg p-[9px] shadow-raised">
          <div className="flex h-[604px] flex-col overflow-hidden rounded-[18px] border border-line2 bg-s1">
            <div className="flex flex-none items-center justify-between px-4 py-2 font-mono text-12 text-tx5">
              {/* A drawn status bar, not the reader's clock: a doctrine page that
                  ticks reads as a live screen it is not. */}
              <span dir="ltr">09:41</span>
              <span aria-hidden="true">▮▮▮ ◗</span>
            </div>

            <div className="flex flex-none items-center gap-2 px-4 pb-2">
              <span className="block h-[18px] w-[18px] rounded-orbit bg-accent" aria-hidden="true" />
              <span className="text-12 text-tx4">{l("hand.title")}</span>
            </div>

            <div className="flex-1 overflow-hidden px-4 pb-4">
              <p className="font-serif text-22 leading-display text-tx0">{l("hand.head")}</p>

              <ul className="mt-3 flex flex-col">
                {IN_HAND.map((row) => (
                  <li
                    key={row.key}
                    className="flex items-baseline justify-between gap-2 border-b border-line2 py-2.5"
                  >
                    <span className="text-12 text-tx4">{l(`hand.${row.key}`)}</span>
                    <span className="flex flex-none items-baseline gap-2 font-mono">
                      <span className="text-13 text-tx">{row.value}</span>
                      {/* Fixed width so the deltas form a column rather than a
                          ragged edge — the same reason the mono voice exists. */}
                      <span className={`w-11 text-end text-12 ${row.hue}`} dir="ltr">
                        {row.delta}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-4 border border-line2 bg-s2 p-3">
                <p className="flex items-center gap-2">
                  <span className="text-accent" aria-hidden="true">
                    ✦
                  </span>
                  <span className="font-display text-12 uppercase tracking-[.14em] text-tx4">
                    {l("hand.card.label")}
                  </span>
                </p>
                <p className="mt-2 text-13 leading-body text-tx">{l("hand.card.body")}</p>
                <p className="mt-3 flex gap-2">
                  {/* WCAG 2.2 AA target size, drawn at the phone's own scale:
                      44px is the floor the real app is built to. */}
                  <span className="flex h-11 flex-1 items-center justify-center rounded-md bg-accent text-13 font-600 text-accent-contrast">
                    {l("hand.card.primary")}
                  </span>
                  <span className="flex h-11 w-[88px] flex-none items-center justify-center rounded-md border border-line4 text-13 text-tx3">
                    {l("hand.card.secondary")}
                  </span>
                </p>
              </div>

              <p className="mt-4 text-12 leading-body text-tx5">{l("hand.footer")}</p>
            </div>

            <div className="flex flex-none border-t border-line2">
              <span className="flex h-12 flex-1 items-center justify-center text-12 text-accent">
                {l("hand.tab1")}
              </span>
              <span className="flex h-12 flex-1 items-center justify-center text-12 text-tx5">
                {l("hand.tab2")}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* The one artifact the platform emits as a file rather than a screen, so
          it is the one specimen that has to be drawn from its real renderer —
          packages/ui/src/post-card.ts, the same call the studio and the
          download make. Locale drives the face and the direction. */}
      <section className="flex flex-col gap-4 border-t border-line2 pt-7">
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-16 font-600 text-tx">{l("post.heading")}</h2>
          <p className="max-w-[60ch] text-13 leading-body text-tx4">{l("post.note")}</p>
        </div>
        <ul className="flex flex-wrap items-start gap-5">
          {(Object.keys(POST_RATIOS) as PostRatio[]).map((ratio) => (
            <li key={ratio} className="flex flex-col gap-2">
              <img
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(
                  postCardSvg({
                    headline: l("post.headline"),
                    body: l("post.body"),
                    kicker: l("post.kicker"),
                    brandName: brandName,
                    accent,
                    locale,
                    ratio
                  })
                )}`}
                alt={l("post.headline")}
                width={POST_RATIOS[ratio].w}
                height={POST_RATIOS[ratio].h}
                className="w-[200px] rounded-md border border-line2"
              />
              <span className="font-mono text-12 text-tx5" dir="ltr">
                {POST_RATIOS[ratio].w}×{POST_RATIOS[ratio].h}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function DesignRoute() {
  const shell = useShellData();
  return (
    <Doctrine
      locale={shell?.locale ?? "en"}
      brandName={shell?.brand?.name ?? ""}
      accent={shell?.brand?.palette?.accent}
    />
  );
}
