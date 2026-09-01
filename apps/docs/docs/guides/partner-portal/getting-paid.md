---
title: "Getting Paid: payouts, payments and the ledger"
sidebar_label: "Getting Paid"
sidebar_position: 2
---

# Getting Paid

There are **two different records of money** in this system, they look alike on
screen, and mixing them up is how a partner gets paid twice or not at all. This
guide is the map: what each screen means, which one to use, and the places the
screens have historically misled people.

Read this before using **Payment Submissions** or **Submit Payment**.

## The one distinction that matters

| | A **payout** (payment submission) | A **payment** (internal payment) |
|---|---|---|
| What it is | A **claim**: "you owe me this" | A **record**: "this money moved" |
| Who creates it | The partner, or an admin on their behalf | Whoever recorded the transfer |
| Where | **Payment Submissions → Create** | **Submit Payment** on an inventory order |
| Goes through review | Yes — Draft → Pending → Approved → Paid | No |
| Shows on the partner ledger as owed | Yes | No |

:::danger The mistake this guide exists to prevent
**"Submit Payment" on an inventory order does not bill anyone.** It records
that money *already moved*. If you are asking to be paid, you want **Payment
Submissions → Create**, not Submit Payment.

Two INR 10,000 rows created through Submit Payment sat against an order that
also had an unpaid INR 28,200 payout on it. The order page said INR 20,000 had
been recorded; the partner ledger said INR 0. Nothing joined the two, so the
screen that answers *"what do we owe this partner"* answered **INR 28,200
outstanding** against money that had already gone out.
:::

## Claiming what you are owed

**Payment Submissions → Create** is one table of everything billable, with a
filter above it. Three kinds of thing can appear:

- **Runs** — production runs you have completed. Work.
- **Tasks** — completed tasks not attached to a run. Work.
- **Goods** — inventory orders: material we bought *from* you.

Tick the rows, check the amounts, press **Submit for payment**. The running
total in the bar at the bottom is the claim.

### What the numbers mean

- The **Amount** column is what that row bills. It is filled in for you.
- On a **run**, the rate box may be blank. That is deliberate — see the
  watch-out below.
- On a **goods** row, the amount is derived from **deliveries actually
  recorded**, not from what was ordered. An order placed for INR 88,885 with
  INR 28,670 delivered bills INR 28,670.

### Watch-outs when claiming

:::warning A blank rate on a run is not a bug
Most runs are priced as an agreed **total**, not per piece. When a run has
already been partly billed, the box is left empty on purpose: re-billing the
total would double-pay, and dividing it would re-price work at a rate nobody
agreed. **Type what the remaining pieces are worth.** The row will not submit
at zero.
:::

:::warning "Capped at what is left on the order"
On a goods row this means the deliveries recorded are worth more than the order
has headroom for. You are being offered the remainder, not the full value of
the receipts. Hover the note to see both figures. If the ordered total is
wrong, that is a conversation to have before billing — the cap is not
negotiable through this screen.
:::

:::danger "⚠ N already paid on this order"
Someone has already recorded a payment against this order — possibly for these
very goods. The row is **still tickable**, deliberately: a payment on an order
is not always payment for the claim you are about to make (it may be an advance,
a deposit, or money for a different delivery on the same order). But billing
again for goods already settled is the mistake this row can cause, so check
before you submit.

This is not hypothetical. One live order shows **INR 9,800 paid since March
against INR 0 ever billed** — so the screen was offering INR 5,800 of an order
that had already been settled in full. The billable ceiling measures what has
been *billed* against what was *ordered*; it has no knowledge of what has been
*paid*. That is why the warning exists and why it is only a warning.
:::

:::warning Rows you cannot tick
A greyed row says why underneath:

- **"Already paid"** / **"Already fully billed"** — a live claim covers it.
- **"This design is already in an open submission"** — a payment line is keyed
  by *design*, so a second run of the same design waits until the first
  submission is resolved.
- **"No delivery recorded against this order yet"** — this is a **gap in the
  record**, not a statement that the goods were free. Get the delivery recorded
  and the row becomes billable.

Tick **Show already submitted** to see them.
:::

:::tip One order is claimed whole
An inventory order may appear only once per submission. If you need to bill it
in stages, submit them as separate claims — each is checked against what is
left of the ordered total.
:::

## Reading a submission

Open a submission and the **What this bills for** table lists every line with a
badge: Design, Task, Run, or Goods.

:::info Why every line is in one table
It used to be two tables — "Design Items" and "Task Items". Lines sourced from
a *run* or an *inventory order* matched neither and rendered **nowhere**, while
still counting toward the total in the header. A submission could show a
five-figure total above an empty list. If you ever see a total with no lines
under it, that is a bug worth reporting, not an empty claim.
:::

Statuses mean:

| Status | What it means |
|---|---|
| **Draft** | Prepared, not yet claimed. Press **Submit for review** to claim it. |
| **Pending** / **Under review** | With us. |
| **Approved** | Agreed — but **the money has not moved yet.** |
| **Paid** | The transfer was recorded. |
| **Rejected** | Not owed. The reason is on the page. |

:::danger Approved is not Paid
Approval agrees the amount. **Paid** is written separately, when the
reconciliation is settled. On production that gap has run to **34 days**. A
partner chasing a transfer on an Approved payout is asking a reasonable
question.
:::

## Recording money that has already moved

Use **Submit Payment** on an inventory order (see
[Submitting Payments on Inventory Orders](./submit-payment-guide.md)) only to
record a transfer that has happened.

:::warning A recorded payment is not a claim
It creates no payout, enters no review queue, and does not reduce what a payout
says is outstanding. If an unpaid payout bills the same order, both records now
exist side by side and **a human has to reconcile them.**
:::

## For admins: the partner ledger

**Partners → a partner → Payments** merges both records into one list. Every
row says which kind it is.

The totals line reads:

> *X paid · Y outstanding · Z recorded separately*

- **paid** — covered by a payout at status **Paid**. Approved does not count.
- **outstanding** — billed minus paid.
- **recorded separately** — money that moved with no payout accounting for it.

### The warning to stop before you act

An orange line appears when money has already been recorded against an order
that an **unpaid** payout also bills:

> ⚠ *INR 20,000 of that sits against orders an unpaid payout still bills —
> settle or link it before paying again*

:::tip Acting on it — "Mark N as settling this payout"
Beside the warning, each recorded payment now carries a one-click action. Using
it states that **this payment discharges this payout** — after which:

- the money counts toward **paid**, so a payout of INR 28,200 with INR 20,000
  linked reads *paid 20,000 · outstanding 8,200*
- it stops being "recorded separately" and stops raising the warning
- the payout stays **Approved**, which is now honest: partly settled, not
  fully

🔑 This is the only way a payout can be settled in **part**. Before it existed
the model could only say `Approved` (0 paid, the reading that pays twice) or
`Paid` (the whole amount, when only some of it moved). Neither was true.

⚠️ Only a **Completed** payment settles anything. A `Pending` one — the status
the partner portal writes — still raises the warning but contributes nothing to
`paid`, because a partner must not be able to move their own paid figure by
asserting they were paid. Marking it Completed is a separate, deliberate act.
:::

:::danger Do not pay past this line without checking
The system deliberately **does not** subtract that money from `outstanding`. An
advance and a payout can legitimately coexist, and no screen may quietly decide
that one discharges the other. Only a human can say so — by linking the payment
to the submission it settles (the "Mark … as settling this payout" action, or
`POST /admin/payments/:id/settles`). Once linked, the money counts toward
`paid` and drops out of "recorded separately".
:::

### Where the ledger reads from

A payment can be attached to a **partner**, an **inventory order**, or a
**payout** — and one payment may have only one of the three. The ledger reads
**all three and deduplicates**. Before it did, a payment recorded through the
partner portal was attached only to the order and was invisible here, which is
the defect above.

:::tip If a number here disagrees with another screen
The order page (**Inventory order → Payments**) and this ledger answer
different questions. The order page is scoped to one order; the ledger is
scoped to one partner. They should agree on any payment they can both see — if
they do not, say so rather than trusting the larger number.
:::

## Quick reference

## Why "paid" and "billed" are tracked separately

A recurring source of confusion, worth stating plainly:

- **Recording a payment never creates a payout.** The three places you can
  record one — the partner page, the inventory order page, and the partner
  portal's Submit Payment — all write a payment row and nothing else. No claim
  is raised, nothing enters review.
- **Approving a payout never records a payment.** Since #1638 approval writes no
  payment row at all; `Paid` is set when the reconciliation is settled.

So the two records are joined only when a human joins them. Everything above —
the ledger warning, the "already paid on this order" note — exists because
nothing does it automatically, and the system deliberately refuses to guess.

## Quick reference

| I want to… | Screen |
|---|---|
| Ask to be paid for work | Payment Submissions → Create → **Runs** / **Tasks** |
| Ask to be paid for material I supplied | Payment Submissions → Create → **Goods** |
| Record a transfer that already happened | Inventory order → **Submit Payment** |
| See what a partner is owed overall | Partners → *partner* → **Payments** |
| See what one order has cost | Inventory order → **Payments** |
