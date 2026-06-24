import {
  ArtworkChoice,
  buildArtworkPickUpdate,
  DEFAULT_FEEDBACK_ARTWORK_SOURCE_ID,
  mapMediaToArtworkChoice,
  normalizeRatingValue,
  resolveArtworkSourceId,
  selectArtworkChoices,
} from "../artwork-feedback";

const pool = (n: number): ArtworkChoice[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `art_${i.toString().padStart(2, "0")}`,
    file_path: `/art/${i}.jpg`,
    type: "image",
    mime_type: "image/jpeg",
    width: 800,
    height: 600,
    title: `Art ${i}`,
    alt_text: null,
    caption: null,
  }));

describe("normalizeRatingValue", () => {
  it("accepts enum strings", () => {
    expect(normalizeRatingValue("one")).toBe("one");
    expect(normalizeRatingValue("FIVE")).toBe("five");
    expect(normalizeRatingValue(" three ")).toBe("three");
  });
  it("accepts numeric forms 1..5", () => {
    expect(normalizeRatingValue(4)).toBe("four");
    expect(normalizeRatingValue("2")).toBe("two");
  });
  it("rejects out-of-range / junk", () => {
    expect(normalizeRatingValue(0)).toBeUndefined();
    expect(normalizeRatingValue(6)).toBeUndefined();
    expect(normalizeRatingValue("six")).toBeUndefined();
    expect(normalizeRatingValue(2.5)).toBeUndefined();
    expect(normalizeRatingValue(null)).toBeUndefined();
    expect(normalizeRatingValue(undefined)).toBeUndefined();
  });
});

describe("resolveArtworkSourceId", () => {
  it("prefers override, then env, then default", () => {
    expect(resolveArtworkSourceId({}, "alb_x")).toBe("alb_x");
    expect(resolveArtworkSourceId({ FEEDBACK_ARTWORK_ALBUM_ID: "alb_env" })).toBe(
      "alb_env"
    );
    expect(resolveArtworkSourceId({})).toBe(DEFAULT_FEEDBACK_ARTWORK_SOURCE_ID);
    expect(resolveArtworkSourceId({ FEEDBACK_ARTWORK_ALBUM_ID: "  " })).toBe(
      DEFAULT_FEEDBACK_ARTWORK_SOURCE_ID
    );
  });
});

describe("mapMediaToArtworkChoice", () => {
  it("maps the public-safe subset", () => {
    const choice = mapMediaToArtworkChoice({
      id: "m1",
      file_name: "f.jpg",
      original_name: "Original.jpg",
      file_path: "/p/f.jpg",
      file_type: "image",
      mime_type: "image/jpeg",
      width: 10,
      height: 20,
      title: "T",
      alt_text: "A",
      caption: "C",
    });
    expect(choice).toEqual({
      id: "m1",
      file_path: "/p/f.jpg",
      type: "image",
      mime_type: "image/jpeg",
      width: 10,
      height: 20,
      title: "T",
      alt_text: "A",
      caption: "C",
    });
  });
  it("coerces missing fields to null", () => {
    const choice = mapMediaToArtworkChoice({ id: "m2" });
    expect(choice.file_path).toBeNull();
    expect(choice.type).toBeNull();
    expect(choice.width).toBeNull();
  });
});

describe("selectArtworkChoices", () => {
  it("returns N distinct items", () => {
    const out = selectArtworkChoices(pool(10), "fb_1", 3);
    expect(out).toHaveLength(3);
    expect(new Set(out.map((o) => o.id)).size).toBe(3);
  });

  it("is deterministic for the same seed", () => {
    const a = selectArtworkChoices(pool(10), "fb_seed", 3).map((o) => o.id);
    const b = selectArtworkChoices(pool(10), "fb_seed", 3).map((o) => o.id);
    expect(a).toEqual(b);
  });

  it("varies across different seeds", () => {
    // Compare several seeds — at least one ordering must differ.
    const base = selectArtworkChoices(pool(12), "seed_A", 3).map((o) => o.id);
    const others = ["seed_B", "seed_C", "seed_D", "seed_E"].map((s) =>
      selectArtworkChoices(pool(12), s, 3).map((o) => o.id).join(",")
    );
    expect(others.some((o) => o !== base.join(","))).toBe(true);
  });

  it("does not leak DB pool order (sorted before shuffle)", () => {
    const forward = selectArtworkChoices(pool(8), "s", 3).map((o) => o.id);
    const reversed = selectArtworkChoices([...pool(8)].reverse(), "s", 3).map(
      (o) => o.id
    );
    expect(forward).toEqual(reversed);
  });

  it("de-dupes by id", () => {
    const dup = [...pool(2), ...pool(2)];
    const out = selectArtworkChoices(dup, "s", 5);
    expect(out).toHaveLength(2);
  });

  it("caps at pool size and handles empty/zero", () => {
    expect(selectArtworkChoices(pool(2), "s", 5)).toHaveLength(2);
    expect(selectArtworkChoices([], "s", 3)).toEqual([]);
    expect(selectArtworkChoices(null, "s", 3)).toEqual([]);
    expect(selectArtworkChoices(pool(5), "s", 0)).toEqual([]);
  });
});

describe("buildArtworkPickUpdate", () => {
  const now = new Date("2026-06-24T10:00:00.000Z");

  it("builds typed columns + metadata audit for a valid offered pick", () => {
    const out = buildArtworkPickUpdate({
      feedbackId: "fb_1",
      artworkId: "art_02",
      affinity: " calm ",
      offeredIds: ["art_01", "art_02", "art_03"],
      existingMetadata: { source: "post_delivery_request" },
      now,
    });
    expect(out).toEqual({
      id: "fb_1",
      chosen_artwork_id: "art_02",
      artwork_affinity: "calm",
      metadata: {
        source: "post_delivery_request",
        artwork_pick: {
          artwork_id: "art_02",
          affinity: "calm",
          chosen_at: now.toISOString(),
        },
      },
    });
  });

  it("normalises blank affinity to null", () => {
    const out = buildArtworkPickUpdate({
      feedbackId: "fb_1",
      artworkId: "art_01",
      affinity: "   ",
      offeredIds: ["art_01"],
      now,
    });
    expect(out?.artwork_affinity).toBeNull();
    expect(out?.metadata.artwork_pick.affinity).toBeNull();
  });

  it("rejects a pick that was not offered", () => {
    expect(
      buildArtworkPickUpdate({
        feedbackId: "fb_1",
        artworkId: "art_99",
        offeredIds: ["art_01", "art_02"],
        now,
      })
    ).toBeNull();
  });

  it("rejects missing ids", () => {
    expect(
      buildArtworkPickUpdate({
        feedbackId: "",
        artworkId: "art_01",
        offeredIds: ["art_01"],
      })
    ).toBeNull();
    expect(
      buildArtworkPickUpdate({
        feedbackId: "fb_1",
        artworkId: "",
        offeredIds: ["art_01"],
      })
    ).toBeNull();
  });

  it("does not mutate the passed-in metadata", () => {
    const meta = { source: "x" };
    buildArtworkPickUpdate({
      feedbackId: "fb_1",
      artworkId: "art_01",
      offeredIds: ["art_01"],
      existingMetadata: meta,
      now,
    });
    expect(meta).toEqual({ source: "x" });
  });
});
