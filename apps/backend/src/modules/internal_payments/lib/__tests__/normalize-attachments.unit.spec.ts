import {
  normalizePaymentAttachments,
  summarizePaymentAttachments,
} from "../normalize-attachments";

describe("normalizePaymentAttachments", () => {
  it("returns [] for nullish / empty / non-array input", () => {
    expect(normalizePaymentAttachments(undefined)).toEqual([]);
    expect(normalizePaymentAttachments(null)).toEqual([]);
    expect(normalizePaymentAttachments([])).toEqual([]);
    expect(normalizePaymentAttachments("nope" as any)).toEqual([]);
  });

  it("maps a valid attachment to a persistable row", () => {
    const rows = normalizePaymentAttachments([
      {
        file_id: "file_1",
        url: "https://cdn/x.pdf",
        filename: "receipt.pdf",
        mime_type: "application/pdf",
        size: 1234,
        metadata: { source: "admin" },
      },
    ]);
    expect(rows).toEqual([
      {
        file_id: "file_1",
        url: "https://cdn/x.pdf",
        filename: "receipt.pdf",
        mime_type: "application/pdf",
        size: 1234,
        metadata: { source: "admin" },
      },
    ]);
  });

  it("drops entries missing file_id or url", () => {
    const rows = normalizePaymentAttachments([
      { file_id: "", url: "https://cdn/a" },
      { file_id: "file_2", url: "" },
      { url: "https://cdn/c" },
      { file_id: "file_4" },
      { file_id: "  ", url: "  " },
    ]);
    expect(rows).toEqual([]);
  });

  it("trims strings and nulls blank optionals", () => {
    const rows = normalizePaymentAttachments([
      {
        file_id: "  file_5  ",
        url: "  https://cdn/d  ",
        filename: "   ",
        mime_type: "",
      },
    ]);
    expect(rows[0]).toMatchObject({
      file_id: "file_5",
      url: "https://cdn/d",
      filename: null,
      mime_type: null,
      size: null,
      metadata: null,
    });
  });

  it("dedupes by file_id (first wins)", () => {
    const rows = normalizePaymentAttachments([
      { file_id: "dup", url: "https://cdn/first" },
      { file_id: "dup", url: "https://cdn/second" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe("https://cdn/first");
  });

  it("coerces size to a non-negative integer, else null", () => {
    const rows = normalizePaymentAttachments([
      { file_id: "a", url: "u", size: 10.9 },
      { file_id: "b", url: "u", size: -5 },
      { file_id: "c", url: "u", size: NaN },
      { file_id: "d", url: "u", size: "100" as any },
    ]);
    expect(rows.map((r) => r.size)).toEqual([10, null, null, null]);
  });

  it("ignores array / non-object metadata", () => {
    const rows = normalizePaymentAttachments([
      { file_id: "a", url: "u", metadata: [1, 2] as any },
      { file_id: "b", url: "u", metadata: "x" as any },
    ]);
    expect(rows.map((r) => r.metadata)).toEqual([null, null]);
  });
});

describe("summarizePaymentAttachments", () => {
  it("counts, sums size, and lists file ids", () => {
    const summary = summarizePaymentAttachments([
      { file_id: "a", url: "u", filename: null, mime_type: null, size: 100, metadata: null },
      { file_id: "b", url: "u", filename: null, mime_type: null, size: null, metadata: null },
      { file_id: "c", url: "u", filename: null, mime_type: null, size: 50, metadata: null },
    ]);
    expect(summary).toEqual({
      count: 3,
      total_size: 150,
      file_ids: ["a", "b", "c"],
    });
  });

  it("handles nullish", () => {
    expect(summarizePaymentAttachments(null)).toEqual({
      count: 0,
      total_size: 0,
      file_ids: [],
    });
  });
});
