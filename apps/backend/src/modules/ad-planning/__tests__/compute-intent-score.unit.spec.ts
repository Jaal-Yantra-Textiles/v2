/**
 * Unit tests for AdPlanningService.computeIntentScore — the pure
 * scoring helper used by GET /web/ad-planning/intent.
 *
 * We instantiate the service directly with no models so we can call the
 * helper without booting Medusa. computeIntentScore touches no models,
 * so the empty MedusaService base is harmless.
 */

// MedusaService factory needs the framework utils; we mock the whole
// `model` DSL with a self-returning Proxy so every `.id()/.text()/
// .enum()/.json()/.belongsTo()/.hasMany()/.primaryKey()/.unique()/...`
// chain in the model files works without us listing each method.
jest.mock("@medusajs/framework/utils", () => {
  const builder: any = new Proxy(() => builder, {
    get: (_t, prop) => {
      if (prop === "then") return undefined; // not a thenable
      return () => builder;
    },
  });
  return {
    MedusaService: () =>
      class {
        constructor(..._args: any[]) {}
      },
    model: new Proxy(
      {},
      {
        get: () => () => builder,
      },
    ),
  };
});

import AdPlanningService from "../service";

describe("computeIntentScore", () => {
  const svc = new AdPlanningService();

  it("returns 0/low for an empty signal set", () => {
    const out = svc.computeIntentScore({});
    expect(out.score).toBe(0);
    expect(out.level).toBe("low");
  });

  it("scores the privacy-policy reader (visitor_kkuevqojk7nmoi88zvm) as high", () => {
    // 7 pageviews, 100% scroll, 624s on site, has_engagement → real prod row
    const out = svc.computeIntentScore({
      pageviews: 7,
      maxScrollDepth: 100,
      totalTimeOnSite: 624,
      hasEngagement: true,
    });
    // 20 (pv cap) + 30 (scroll cap) + 40 (time cap) + 10 (engagement) = 100
    expect(out.score).toBe(100);
    expect(out.level).toBe("high");
  });

  it("scores a one-pageview bouncer (likely bot) as low", () => {
    const out = svc.computeIntentScore({
      pageviews: 1,
      maxScrollDepth: 0,
      totalTimeOnSite: 0,
      hasEngagement: false,
    });
    // 5 + 0 + 0 + 0 = 5
    expect(out.score).toBe(5);
    expect(out.level).toBe("low");
  });

  it("crosses into medium at moderate browsing", () => {
    // 3 pageviews (15) + 50% scroll (15) → 30
    const out = svc.computeIntentScore({
      pageviews: 3,
      maxScrollDepth: 50,
      totalTimeOnSite: 0,
      hasEngagement: false,
    });
    expect(out.score).toBe(30);
    expect(out.level).toBe("medium");
  });

  it("caps each component at its weight ceiling", () => {
    // Throw absurd numbers and verify nothing exceeds the cap.
    const out = svc.computeIntentScore({
      pageviews: 999,
      maxScrollDepth: 999, // logically impossible but defensive
      totalTimeOnSite: 999_999,
      hasEngagement: true,
    });
    expect(out.score).toBe(100);
    expect(out.breakdown.pageviews).toBeLessThanOrEqual(20);
    expect(out.breakdown.scroll).toBeLessThanOrEqual(30);
    expect(out.breakdown.time).toBeLessThanOrEqual(40);
    expect(out.breakdown.engagement).toBe(10);
  });

  it("treats engagement as a binary 10-point bump", () => {
    const without = svc.computeIntentScore({ pageviews: 4, maxScrollDepth: 50 });
    const withE = svc.computeIntentScore({
      pageviews: 4,
      maxScrollDepth: 50,
      hasEngagement: true,
    });
    expect(withE.score - without.score).toBe(10);
  });
});
