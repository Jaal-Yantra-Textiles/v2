import { buildAttachAwbLabels } from "../shiprocket-attach-awb"

const label = {
  tracking_number: "AWB123",
  tracking_url: "https://shiprocket.co/tracking/AWB123",
  label_url: "",
}

describe("buildAttachAwbLabels (#1195)", () => {
  it("adds the AWB label when the fulfillment has none", () => {
    expect(buildAttachAwbLabels([], label)).toEqual([label])
    expect(buildAttachAwbLabels(undefined, label)).toEqual([label])
  })

  it("carries existing labels through by id so the replace doesn't delete them", () => {
    expect(
      buildAttachAwbLabels(
        [{ id: "fulab_1", tracking_number: "OTHER" }],
        label
      )
    ).toEqual([{ id: "fulab_1" }, label])
  })

  it("re-attaching the same AWB adds no ROW — it corrects the one there", () => {
    // #1305: re-supplying an AWB is how a tracking or label URL that arrived
    // late gets recorded. Returning a bare `{id}` kept the old (usually empty)
    // URLs while the caller saw a 200 and `data.tracking_url` updated — so the
    // label row and `data` disagreed permanently. Order 79 is the proof.
    expect(
      buildAttachAwbLabels(
        [{ id: "fulab_1", tracking_number: "AWB123" }],
        label
      )
    ).toEqual([
      { id: "fulab_1", tracking_url: "https://shiprocket.co/tracking/AWB123" },
    ])
  })

  it("never blanks a URL it already has with one the caller doesn't", () => {
    // An operator attaching an AWB they have no label PDF for must not destroy
    // the PDF link someone else recorded.
    expect(
      buildAttachAwbLabels(
        [
          {
            id: "fulab_1",
            tracking_number: "AWB123",
            label_url: "https://cdn/label.pdf",
          },
        ],
        { ...label, tracking_url: "", label_url: "" }
      )
    ).toEqual([{ id: "fulab_1" }])
  })

  it("never returns an empty array when labels exist (that would wipe them)", () => {
    const result = buildAttachAwbLabels(
      [
        { id: "fulab_1", tracking_number: "AWB123" },
        { id: "fulab_2", tracking_number: "OTHER" },
      ],
      label
    )
    expect(result).toHaveLength(2)
  })

  it("skips malformed existing rows with no id", () => {
    expect(
      buildAttachAwbLabels([{ tracking_number: "OTHER" }], label)
    ).toEqual([label])
  })
})
