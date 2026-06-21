import {
  DIGEST_AI_DEFAULT_MODEL,
  buildDigestAiPrompt,
  composeDigestAiSummary,
  resolveDigestModelOverride,
  type DigestAiGenerate,
} from "../partner-digest-ai-lib";
import { AI_SUMMARY_MAX_LEN } from "../partner-digest-email-lib";
import {
  buildDigestKpis,
  type PartnerStorefrontDigest,
} from "../partner-digest-lib";

const makeDigest = (
  over: Partial<PartnerStorefrontDigest> = {}
): PartnerStorefrontDigest => ({
  partner_id: "part_1",
  website: { id: "web_1", domain: "shop.example.com", name: "Example Shop" },
  period: {
    label: "last_7_days",
    days: 7,
    current: { start: "2026-06-14T00:00:00.000Z", end: "2026-06-21T00:00:00.000Z" },
    previous: { start: "2026-06-07T00:00:00.000Z", end: "2026-06-14T00:00:00.000Z" },
  },
  kpis: buildDigestKpis(
    {
      unique_visitors: 150,
      total_pageviews: 600,
      total_sessions: 180,
      bounce_rate: 0.42,
      avg_session_duration: 95,
      pages_per_session: 3.3,
    },
    {
      unique_visitors: 120,
      total_pageviews: 500,
      total_sessions: 150,
      bounce_rate: 0.5,
      avg_session_duration: 80,
      pages_per_session: 3,
    }
  ),
  breakdowns: {
    top_pages: [
      { value: "/", count: 200, percentage: 40 },
      { value: "/shop", count: 90, percentage: 18 },
    ],
    referrers: [{ value: "google", count: 100, percentage: 55 }],
    devices: [{ value: "mobile", count: 120, percentage: 66 }],
    countries: [{ value: "IN", count: 130, percentage: 72 }],
  },
  not_found_count: 3,
  suggestions: [
    {
      id: "mobile_heavy_traffic",
      severity: "opportunity",
      title: "Optimize for mobile",
      detail: "66% of traffic is on mobile.",
    },
  ],
  ...over,
});

const ZERO_STATS = {
  unique_visitors: 0,
  total_pageviews: 0,
  total_sessions: 0,
  bounce_rate: 0,
  avg_session_duration: 0,
  pages_per_session: 0,
};

describe("buildDigestAiPrompt", () => {
  it("is deterministic: same digest in ⇒ identical prompt out", () => {
    const a = buildDigestAiPrompt(makeDigest());
    const b = buildDigestAiPrompt(makeDigest());
    expect(a).toEqual(b);
  });

  it("embeds the store name, period, KPIs (with deltas) and top breakdowns", () => {
    const { system, prompt } = buildDigestAiPrompt(makeDigest());
    expect(system).toMatch(/plain-text/i);
    expect(prompt).toContain("Store: Example Shop");
    expect(prompt).toContain("Period: last_7_days");
    expect(prompt).toContain("Unique visitors: 150");
    expect(prompt).toContain("(+25% vs previous, up)"); // 150 vs 120
    expect(prompt).toContain("Top pages: / (40%), /shop (18%)");
    expect(prompt).toContain("Top referrers: google (55%)");
    expect(prompt).toContain("Suggestions already surfaced: Optimize for mobile");
  });

  it("falls back to the domain when the store has no name", () => {
    const { prompt } = buildDigestAiPrompt(
      makeDigest({ website: { id: "web_1", domain: "shop.example.com", name: null } })
    );
    expect(prompt).toContain("Store: shop.example.com");
  });

  it("renders 'none' for empty breakdowns and never throws on a sparse digest", () => {
    const sparse = makeDigest({
      breakdowns: { top_pages: [], referrers: [], devices: [], countries: [] },
      suggestions: [],
    });
    const { prompt } = buildDigestAiPrompt(sparse);
    expect(prompt).toContain("Top pages: none");
    expect(prompt).not.toContain("Suggestions already surfaced");
  });

  it("labels metrics with no baseline distinctly (delta_pct null)", () => {
    const noBaseline = makeDigest({
      kpis: buildDigestKpis(
        { ...ZERO_STATS, unique_visitors: 10 },
        ZERO_STATS // previous all-zero ⇒ delta_pct null
      ),
    });
    const { prompt } = buildDigestAiPrompt(noBaseline);
    expect(prompt).toContain("Unique visitors: 10 (no prior baseline)");
  });
});

describe("resolveDigestModelOverride", () => {
  it("prefers the explicit per-flow option over everything else", () => {
    expect(
      resolveDigestModelOverride("anthropic/claude-3.5", "platform/default", "fallback/x")
    ).toBe("anthropic/claude-3.5");
  });

  it("falls back to the platform default_model when no option is set", () => {
    expect(resolveDigestModelOverride(undefined, "platform/default")).toBe(
      "platform/default"
    );
    expect(resolveDigestModelOverride(null, "platform/default")).toBe(
      "platform/default"
    );
  });

  it("treats blank/whitespace option and platform default as unset", () => {
    expect(resolveDigestModelOverride("   ", "  ", "fallback/x")).toBe("fallback/x");
  });

  it("trims a provided value", () => {
    expect(resolveDigestModelOverride("  qwen-turbo  ")).toBe("qwen-turbo");
  });

  it("defaults the fallback to DIGEST_AI_DEFAULT_MODEL (last resort hint)", () => {
    expect(resolveDigestModelOverride()).toBe(DIGEST_AI_DEFAULT_MODEL);
    expect(resolveDigestModelOverride(undefined, null)).toBe(DIGEST_AI_DEFAULT_MODEL);
  });

  it("returns undefined only when option, platform default AND fallback are all empty", () => {
    expect(resolveDigestModelOverride(undefined, undefined, "")).toBeUndefined();
    expect(resolveDigestModelOverride("", "", "   ")).toBeUndefined();
  });

  it("uses platform default ahead of a non-empty fallback", () => {
    expect(resolveDigestModelOverride(undefined, "platform/default", "fallback/x")).toBe(
      "platform/default"
    );
  });
});

describe("composeDigestAiSummary", () => {
  it("returns the sanitised model output for a digest with data", async () => {
    const generate: DigestAiGenerate = async ({ model }) => {
      expect(model).toBe(DIGEST_AI_DEFAULT_MODEL);
      return "  Great week — visitors up 25%.\n\n";
    };
    const out = await composeDigestAiSummary(makeDigest(), generate);
    expect(out).toBe("Great week — visitors up 25%.");
  });

  it("passes an explicit model override through to generate", async () => {
    let seen = "";
    const generate: DigestAiGenerate = async ({ model }) => {
      seen = model;
      return "ok";
    };
    await composeDigestAiSummary(makeDigest(), generate, { model: "anthropic/claude-3.5" });
    expect(seen).toBe("anthropic/claude-3.5");
  });

  it("skips (null) for a zero-data digest WITHOUT calling generate", async () => {
    let called = false;
    const generate: DigestAiGenerate = async () => {
      called = true;
      return "should not run";
    };
    const zero = makeDigest({
      kpis: buildDigestKpis(ZERO_STATS, ZERO_STATS),
    });
    const out = await composeDigestAiSummary(zero, generate);
    expect(out).toBeNull();
    expect(called).toBe(false);
  });

  it("returns null (never throws) when generate rejects", async () => {
    const generate: DigestAiGenerate = async () => {
      throw new Error("OpenRouter 503");
    };
    await expect(composeDigestAiSummary(makeDigest(), generate)).resolves.toBeNull();
  });

  it("returns null when the model output sanitises to empty", async () => {
    const generate: DigestAiGenerate = async () => "   \n\t  ";
    const out = await composeDigestAiSummary(makeDigest(), generate);
    expect(out).toBeNull();
  });

  it("caps an over-long summary via sanitizeAiSummary (MAX_LEN + ellipsis)", async () => {
    const generate: DigestAiGenerate = async () => "x".repeat(AI_SUMMARY_MAX_LEN + 200);
    const out = await composeDigestAiSummary(makeDigest(), generate);
    expect(out).not.toBeNull();
    // sanitizeAiSummary hard-caps at MAX_LEN then appends a single "…".
    expect((out as string).length).toBeLessThanOrEqual(AI_SUMMARY_MAX_LEN + 1);
    expect((out as string).endsWith("…")).toBe(true);
  });
});
