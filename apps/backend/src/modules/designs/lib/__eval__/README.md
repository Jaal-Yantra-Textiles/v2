# Garment classification — the evaluation set

**This branch is parked, not merged.** TypeSafe is an external dependency for a
nice-to-have, so the classifier is a development tool for now. This directory is
the part worth keeping: the measurements, and the labelled rows that make an
in-house model possible later without redoing the work.

## What `garment-eval-2026-09-17.json` is

134 rows pulled from **production** on 2026-09-17 and classified by TypeSafe's
`jev-latest`:

| kind | n | what it is |
|---|---:|---|
| `product` | 74 | real catalogue items with a description (deduped from 155 variant rows in the `list_missing_hs_codes` sweep) |
| `fabric` | 60 | raw materials — the **negative control**, since a fabric is not a garment |

Per row: the item text, the Choice answer and its confidence, the presence-Noul
score, and `label` — what the gated pipeline would actually store.

⚠️ `label` is a MODEL's answer, not a human's. Every disagreement was read by
hand and the notes are below, but the agreements were not individually checked.
Treat it as a distillation seed that still needs a verification pass, never as
ground truth.

## What the numbers were

The negative control is what earned its keep. A single Choice question named a
garment for **8 of 60 fabrics**:

```
Pant Cotton Material               -> trousers       1.00   WRONG
Kethiya Silk                       -> shirt          0.88   WRONG
Tangaliya Kala Cotton Weave Suit   -> two_piece_set  0.66   WRONG
Black Shirt Old                    -> shirt          1.00   right — a garment filed as a raw material
White Levis Shirt                  -> shirt          1.00   right — same
SHAWL1300                          -> shawl          1.00   right — same
```

🔑 **The confidence threshold cannot catch these.** The worst answer came back at
1.00. The question's premise was already false — "which garment is this design
for?" assumes the subject IS a garment design — and Kethiya Silk's description
really does name garments: *"excellent for shirts, jackets, dresses and tops"*.
The model answered the question it was asked.

Adding a presence judgment (a Noul, asked in the same request) fixed it:

|                                | before | after |
| ------------------------------ | -----: | ----: |
| fabrics named a garment        |      8 |     3 |
| **true fabrics wrong**         |  **5** | **0** |
| products named                 |     53 |    53 |
| real garments wrongly blocked  |      — | **0** |

Fabrics score 0.03–0.44 on the gate, garments 0.75–0.94. "Handwoven Pashmina" —
the original #938 trap — sits at 0.35. Cost: +5.7% tokens, no extra round trip.

## Three findings that outlive the dependency

1. **A threshold cannot rescue a false premise.** If a question assumes
   something about its subject, ask about that separately. This generalises well
   past garments.
2. **The catalogue has garments filed as raw materials.** "Black Shirt Old",
   "White Levis Shirt" and "SHAWL1300" are in the raw-materials table. The
   classifier was right and the data is wrong — worth a cleanup either way.
3. **Trimming the payload does not help.** Classifying from the item NAME alone
   drops coverage from 53 garments to 40 — a quarter lost — while saving only
   ~6% of tokens, because the request is dominated by our own static option list,
   not by design text. If anything is sent at all, send the description.

## If this is revived

The option list in `../garment-types.ts` is mined from real catalogue frequency
(jacket 54 · shirt 46 · dress 23 · trousers 14 · top 14 · skirt 12 · …) and is
the reusable part regardless of who serves the model. `jevlike`
(github.com/vinnylarouge/jevlike, MIT) is the same one-pass option-scoring shape
and would slot behind the existing `askSystemOne` seam — but it ships no
pretrained model, so it needs exactly this kind of labelled set, verified first.
