---
title: "Virtual Try-On Guide"
sidebar_label: "Virtual Try-On"
sidebar_position: 2
---

# Virtual Try-On Guide

Virtual Try-On lets customers see themselves wearing any design created in the Design Editor. It takes ~20 seconds to generate a result.

## Requirements

- Customer must be **logged in** (the feature is auth-gated)
- A design must be open in the Design Editor
- A clear face photo (passport-style works best)

## How to Use

### Desktop

1. Open any product page and enter the Design Editor
2. Click **Try On** in the top bar (next to Save)
3. Upload a face photo using the "Upload photo" button
4. Select the garment type:
   - **Upper Body** — tops, shirts, jackets
   - **Lower Body** — trousers, skirts
   - **Full Dress** — dresses, full-length garments
5. Select gender (**Female** / **Male**)
6. Click **Generate Try-On**
7. Wait ~20 seconds for the result
8. View the result image and click **Download** to save it

### Mobile

1. Open the Design Editor on any product page
2. Tap **Try On** in the bottom navigation bar (right side, between Edit and Save)
3. Follow the same steps as desktop

## Tips for Best Results

- Use a **clear, front-facing photo** with good lighting
- The face should be **unobstructed** — no sunglasses or hats
- Higher resolution photos produce sharper results
- The garment capture comes directly from your canvas design — make sure it looks the way you want before generating

## Not Logged In?

If you see a *"Sign in to use Virtual Try-On"* message, you need to create an account or log in first. Try-on results are tied to your session.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 404 or network error | Check that the backend `/store/ai/tryon` endpoint is deployed |
| Generation fails after ~20s | The AI provider may be at capacity — try again in a minute |
| Result looks distorted | Use a clearer, more front-facing photo |
| Button not visible | Ensure you're inside the Design Editor (not on the product listing page) |
