import { amountInWords, wholeNumberToWords } from "../amount-in-words"

describe("wholeNumberToWords — Indian grouping", () => {
  it.each([
    [0, "Zero"],
    [7, "Seven"],
    [15, "Fifteen"],
    [20, "Twenty"],
    [42, "Forty Two"],
    [100, "One Hundred"],
    [101, "One Hundred One"],
    [850, "Eight Hundred Fifty"],
    [1000, "One Thousand"],
    // The GOF invoice this was written for.
    [58850, "Fifty Eight Thousand Eight Hundred Fifty"],
    [55988, "Fifty Five Thousand Nine Hundred Eighty Eight"],
  ])("%s -> %s", (input, expected) => {
    expect(wholeNumberToWords(input as number)).toBe(expected)
  })

  // 🔑 The whole reason this helper exists rather than an npm one-liner.
  it("groups by lakh and crore, not by million", () => {
    expect(wholeNumberToWords(100000)).toBe("One Lakh")
    expect(wholeNumberToWords(5850000)).toBe("Fifty Eight Lakh Fifty Thousand")
    expect(wholeNumberToWords(10000000)).toBe("One Crore")
    expect(wholeNumberToWords(12345678)).toBe(
      "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight"
    )
  })

  it("never says Million or Billion", () => {
    const words = wholeNumberToWords(987654321)
    expect(words).not.toMatch(/million|billion/i)
    expect(words).toMatch(/Crore/)
  })

  it("returns the digits rather than a wrong word beyond its range", () => {
    // An invoice that silently understates its own amount in words is worse
    // than one that declines to spell it.
    expect(wholeNumberToWords(1_00_00_00_00_000)).toBe("100000000000")
  })

  it("is not confused by a non-finite value", () => {
    expect(wholeNumberToWords(NaN)).toBe("")
    expect(wholeNumberToWords(Infinity)).toBe("")
  })
})

describe("amountInWords", () => {
  it("spells the GOF grand total the way the supplier wrote it", () => {
    expect(amountInWords(58850)).toBe(
      "Rupees Fifty Eight Thousand Eight Hundred Fifty only"
    )
  })

  it("includes paise when there are any", () => {
    expect(amountInWords(1624.5)).toBe(
      "Rupees One Thousand Six Hundred Twenty Four and Fifty Paise only"
    )
  })

  it("omits the paise clause entirely at a whole rupee", () => {
    expect(amountInWords(1596)).not.toMatch(/Paise/)
  })

  // 🔑 Rounding happens BEFORE the split, or the words disagree with the
  // numerals printed two lines above them on the same document.
  it("rounds before splitting rupees from paise", () => {
    expect(amountInWords(4999.999)).toBe("Rupees Five Thousand only")
    expect(amountInWords(0.005)).toBe("Rupees Zero and One Paise only")
  })

  it("says Minus rather than quietly dropping the sign", () => {
    expect(amountInWords(-500)).toBe("Minus Rupees Five Hundred only")
  })

  it("uses the currency code when it is not rupees", () => {
    expect(amountInWords(250, "eur")).toBe("EUR Two Hundred Fifty only")
  })
})
