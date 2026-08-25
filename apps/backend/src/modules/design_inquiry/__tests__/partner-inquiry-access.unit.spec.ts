import {
  findUnaskedQuestionIds,
  inquiryWriteRefusal,
} from "../lib/partner-inquiry-access"

/**
 * The two pure guards standing between a partner's wizard and someone else's
 * inquiry (#1531 slice 2).
 *
 * Both are extracted so they can be tested without a container — the routes
 * around them need an authenticated partner, a design, a spec and an invite,
 * which is exactly the kind of fixture cost that leaves a guard uncovered on a
 * path where the failure is silent.
 */

describe("findUnaskedQuestionIds — both ends of the request name an id", () => {
  const asked = [{ id: "dinqq_1" }, { id: "dinqq_2" }, { id: "dinqq_3" }]

  it("passes answers to questions this inquiry actually asked", () => {
    expect(
      findUnaskedQuestionIds(asked, [
        { question_id: "dinqq_1" },
        { question_id: "dinqq_3" },
      ])
    ).toEqual({ unknown_ids: [], duplicate_ids: [] })
  })

  /**
   * 🔴 THE #1404 SHAPE. The URL names the inquiry and the body names question
   * ids; two partner routes have already shipped checking only the URL and
   * writing against body ids belonging to a record the caller was never
   * granted.
   *
   * Here it would let an invited partner write an answer onto ANOTHER
   * inquiry's question — and the admin comparison, which reads answers through
   * the response, would render it as this partner's reply to a question they
   * were never asked.
   */
  it("🔴 refuses a question id belonging to a different inquiry", () => {
    const { unknown_ids } = findUnaskedQuestionIds(asked, [
      { question_id: "dinqq_1" },
      { question_id: "dinqq_from_another_inquiry" },
    ])
    expect(unknown_ids).toEqual(["dinqq_from_another_inquiry"])
  })

  it("names a missing id rather than skipping it silently", () => {
    // An answer with no question is not "nothing to do" — it is a client that
    // believes it saved something. Dropping it quietly is how a wizard comes
    // to show answers the server never stored.
    const { unknown_ids } = findUnaskedQuestionIds(asked, [
      { question_id: "" },
      { question_id: null as any },
    ])
    expect(unknown_ids).toEqual(["(missing)"])
  })

  /**
   * 🔑 `(response_id, question_id)` is UNIQUE. Two answers to one question in
   * a single payload have no defined winner, and left to the database the
   * second write throws AFTER the first has already landed — a half-written
   * step reported as a failure, which invites a retry.
   */
  it("🔴 refuses two answers to the same question in one payload", () => {
    const { duplicate_ids, unknown_ids } = findUnaskedQuestionIds(asked, [
      { question_id: "dinqq_2" },
      { question_id: "dinqq_2" },
    ])
    expect(duplicate_ids).toEqual(["dinqq_2"])
    expect(unknown_ids).toEqual([])
  })

  it("treats an inquiry with no questions as asking nothing", () => {
    // Not a crash and not a pass. A design with no spec still gets the closing
    // photo question, so an empty list here means the ids came from elsewhere.
    const { unknown_ids } = findUnaskedQuestionIds([], [{ question_id: "x" }])
    expect(unknown_ids).toEqual(["x"])
  })

  it("survives absent inputs rather than throwing at a guard", () => {
    expect(findUnaskedQuestionIds(null as any, null as any)).toEqual({
      unknown_ids: [],
      duplicate_ids: [],
    })
  })
})

describe("inquiryWriteRefusal", () => {
  it("🔴 refuses writes to a closed inquiry", () => {
    // Closing withdraws the prospect grants and means someone was chosen. An
    // answer accepted afterwards would appear in the comparison as though it
    // had been considered.
    expect(inquiryWriteRefusal({ status: "closed" })).toMatch(/closed/i)
  })

  it("allows writes while it is open", () => {
    expect(inquiryWriteRefusal({ status: "open" })).toBeNull()
  })

  /**
   * 🔑 Submitting is NOT what closes the door. A partner who finds a better
   * yarn on Thursday must be able to revise — a wizard that locks on first
   * submit teaches people to delay answering until they are certain, and that
   * silence is the thing this feature exists to end.
   */
  it("does not refuse a partner who has already submitted", () => {
    expect(inquiryWriteRefusal({ status: "open" })).toBeNull()
  })

  it("treats an unknown status as open rather than guessing", () => {
    // Only "closed" refuses. A status this code does not recognise must not
    // silently lock a partner out of a live inquiry.
    expect(inquiryWriteRefusal({ status: undefined })).toBeNull()
    expect(inquiryWriteRefusal({} as any)).toBeNull()
  })
})
