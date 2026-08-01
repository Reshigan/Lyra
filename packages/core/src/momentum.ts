// docs/modules/scout.md §2.1 — momentum is volume x growth x novelty on a
// 0-100 scale. This is the real computation the seed narrative in
// seed/scout.ts states as a finished number; this module is what the weekly
// Clusterer would actually run to get there.

export interface MomentumInputs {
  /** Weighted signal count in the current window. */
  readonly volume: number;
  /** Ratio of current-window volume to the prior window's (1 = flat, 2 = doubled). */
  readonly growth: number;
  /** 0..1 — how much of the current window's evidence is from a new source, not a repeat. */
  readonly novelty: number;
}

/** momentum = volume x growth x novelty, clamped onto the 0-100 scale the column expects. */
export function momentumScore({ volume, growth, novelty }: MomentumInputs): number {
  const raw = volume * Math.max(growth, 0) * Math.max(novelty, 0);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** One observation the Harvester recorded — the shape the Clusterer groups and scores. */
export interface RawSignal {
  readonly id: string;
  /** Shared grouping key. `scout_signals.source` is used as-is: it is already the
   *  one structured, always-present field every signal carries, so grouping by
   *  it needs no tag-extraction step over the free-form payload. */
  readonly category: string;
  readonly sourceRef: string | null;
  readonly weight: number;
  readonly observedAt: number;
}

export interface ClusterCandidate {
  readonly category: string;
  readonly signalIds: readonly string[];
  readonly momentum: number;
}

/**
 * Deterministic grouping pass: bucket signals by shared category, split each
 * bucket into a recent window and the prior one of the same length, and score
 * the bucket's momentum. Not ML — a threshold-free grouping plus the pure
 * scoring function above, which is the scope this round asks for.
 *
 * ponytail: fixed non-overlapping windows (recent vs. one prior window), no
 * decay curve. Upgrade to a rolling/weighted trail if a cluster needs more
 * than two data points — `trailJson` already stores one point per run, so a
 * richer curve slots in without a schema change.
 */
export function clusterSignals(
  signals: readonly RawSignal[],
  now: number,
  windowMs = 7 * 24 * 60 * 60 * 1000
): ClusterCandidate[] {
  const byCategory = new Map<string, RawSignal[]>();
  for (const s of signals) {
    const bucket = byCategory.get(s.category);
    if (bucket) bucket.push(s);
    else byCategory.set(s.category, [s]);
  }

  const cutoff = now - windowMs;
  const priorCutoff = cutoff - windowMs;
  const sumWeight = (rows: readonly RawSignal[]): number => rows.reduce((sum, s) => sum + s.weight, 0);

  const out: ClusterCandidate[] = [];
  for (const [category, rows] of byCategory) {
    const recent = rows.filter((s) => s.observedAt >= cutoff);
    const prior = rows.filter((s) => s.observedAt < cutoff && s.observedAt >= priorCutoff);

    const volume = sumWeight(recent);
    const priorVolume = sumWeight(prior);
    const growth = priorVolume > 0 ? volume / priorVolume : volume > 0 ? 1 : 0;

    const distinctRefs = new Set(recent.map((s) => s.sourceRef ?? s.id)).size;
    const novelty = recent.length > 0 ? distinctRefs / recent.length : 0;

    out.push({
      category,
      signalIds: rows.map((s) => s.id),
      momentum: momentumScore({ volume, growth, novelty })
    });
  }

  return out.sort((a, b) => b.momentum - a.momentum);
}
