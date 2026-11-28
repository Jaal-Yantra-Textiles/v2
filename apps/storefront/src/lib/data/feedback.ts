"use server"

import { sdk } from "@lib/config"

/**
 * Post-delivery feedback (backend: GET/POST /web/feedback/:id).
 *
 * The delivery email links the buyer to `<shop>/feedback/<feedback_id>`; the
 * middleware adds the country prefix. The id IS the credential (a ULID), so it
 * is never logged here.
 */
export type FeedbackRating = "one" | "two" | "three" | "four" | "five"

export type FeedbackArtwork = {
  id: string
  file_path: string | null
  title: string | null
  alt_text: string | null
  caption: string | null
}

export type FeedbackView = {
  feedback: {
    id: string
    answered: boolean
    answered_at: string | null
    rating: FeedbackRating | null
    comment: string | null
    chosen_artwork_id: string | null
  }
  order: {
    display_id: number | string | null
    items: {
      title: string
      variant_title: string | null
      thumbnail: string | null
      quantity: number
    }[]
  } | null
  store: { name: string | null; url: string | null }
  artworks: FeedbackArtwork[]
}

/** Null when the link is unknown or not a buyer's feedback request (404). */
export const retrieveFeedback = async (id: string): Promise<FeedbackView | null> => {
  try {
    return await sdk.client.fetch<FeedbackView>(
      `/web/feedback/${encodeURIComponent(id)}`,
      { method: "GET", cache: "no-store" }
    )
  } catch (e: any) {
    if (e?.status !== 404) {
      console.error(
        `[feedback] retrieveFeedback failed: status=${e?.status ?? "n/a"} message=${e?.message ?? String(e)}`
      )
    }
    return null
  }
}

export type SubmitFeedbackInput = {
  rating: number
  comment?: string
  artwork_id?: string
}

export type SubmitFeedbackResult =
  | { ok: true }
  | { ok: false; already_answered: boolean; error: string }

export const submitFeedback = async (
  id: string,
  input: SubmitFeedbackInput
): Promise<SubmitFeedbackResult> => {
  try {
    // sdk.client.fetch stringifies the body itself — pass the object.
    await sdk.client.fetch(`/web/feedback/${encodeURIComponent(id)}`, {
      method: "POST",
      body: input,
      cache: "no-store",
    })
    return { ok: true }
  } catch (e: any) {
    if (e?.status === 409) {
      return { ok: false, already_answered: true, error: "" }
    }
    return {
      ok: false,
      already_answered: false,
      error: e?.message || "We couldn't save your feedback. Please try again.",
    }
  }
}
