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

  it("is idempotent — re-attaching the same AWB adds nothing", () => {
    expect(
      buildAttachAwbLabels(
        [{ id: "fulab_1", tracking_number: "AWB123" }],
        label
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
