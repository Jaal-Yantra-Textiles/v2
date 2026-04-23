#!/usr/bin/env node
/*
 * Batch-translate src/i18n/translations/en.json into a target locale.
 *
 * Runs section-by-section (top-level keys of en.json). Each section becomes
 * one LLM call; output is validated (JSON + key-parity vs en.json) and merged
 * into the target locale file progressively, so re-runs are cheap and safe.
 *
 * Uses OpenRouter — the same provider wired up in
 * `src/mastra/providers/openrouter-*.ts`, reading OPENROUTER_API_KEY from the
 * environment. Defaults to a free Qwen model so you can run this with no
 * billing setup.
 *
 * Usage
 *   OPENROUTER_API_KEY=sk-or-... node scripts/i18n/translate.js <locale>
 *
 *   Flags:
 *     --section=<name>           Only translate one top-level section.
 *     --subsection=<a,b,c>       (Requires --section) Translate only these
 *                                immediate children of the section. Result is
 *                                deep-merged into the target file, leaving
 *                                other children untouched.
 *     --resume                   Skip sections already translated (values != en.json).
 *     --force                    Re-translate every section even if already translated.
 *     --dry-run                  Log what would be done without calling the API.
 *     --model=<id>               Override MODEL env var.
 *     --concurrency=<n>          Parallel section requests (default 1).
 *
 *   Env:
 *     OPENROUTER_API_KEY  Required unless --dry-run.
 *     MODEL               OpenRouter model id.
 *                         Default: "qwen/qwen3-next-80b-a3b-instruct:free".
 *                         Examples:
 *                           qwen/qwen3-next-80b-a3b-instruct:free  (default)
 *                           qwen/qwen-2.5-72b-instruct
 *                           anthropic/claude-sonnet-4-5
 *                           openai/gpt-4o
 *                           google/gemini-2.0-flash-001
 *     LANGUAGE_NAME       Human-readable target language name override
 *                         (e.g. "Hindi"). Auto-detected from languages.ts
 *                         when possible.
 *
 * Notes
 *   - Placeholders like {{count}}, {{email}} and Trans tags like <0>...</0>
 *     MUST be preserved verbatim. The prompt enforces this, and validation
 *     warns on any missing tokens.
 *   - The target file is overwritten section-by-section, so you can Ctrl-C
 *     and re-run with --resume.
 */

const fs = require("fs")
const path = require("path")

const TRANSLATIONS_DIR = path.join(__dirname, "../../src/i18n/translations")
const EN_PATH = path.join(TRANSLATIONS_DIR, "en.json")
const LANGUAGES_PATH = path.join(__dirname, "../../src/i18n/languages.ts")

const DEFAULT_MODEL = "qwen/qwen3-next-80b-a3b-instruct:free"
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

// Alibaba Cloud DashScope (native Qwen API) — OpenAI-compatible endpoint.
// Used when DASHSCOPE_API_KEY is set AND the requested model is a raw Qwen
// model id (e.g. "qwen-plus", "qwen3-max"). The OpenRouter-style "qwen/..."
// ids still go through OpenRouter as before.
const DASHSCOPE_URL_INTL =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"
const DASHSCOPE_URL_CN =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
const DEFAULT_DASHSCOPE_MODEL = "qwen-plus"

function isDashScopeModel(modelId) {
  return typeof modelId === "string" && !modelId.includes("/")
}

function parseArgs(argv) {
  const args = { flags: new Set(), opts: {}, positional: [] }
  for (const a of argv.slice(2)) {
    if (a.startsWith("--")) {
      const [key, value] = a.slice(2).split("=")
      if (value === undefined) args.flags.add(key)
      else args.opts[key] = value
    } else {
      args.positional.push(a)
    }
  }
  return args
}

function detectLanguageName(code) {
  if (process.env.LANGUAGE_NAME) return process.env.LANGUAGE_NAME
  try {
    const src = fs.readFileSync(LANGUAGES_PATH, "utf8")
    const map = {
      hi: "Hindi",
      en: "English",
      es: "Spanish",
      fr: "French",
      de: "German",
      it: "Italian",
      pt: "Portuguese",
      ptBR: "Brazilian Portuguese",
      ptPT: "European Portuguese",
      ja: "Japanese",
      ko: "Korean",
      zhCN: "Simplified Chinese",
      ar: "Arabic",
      he: "Hebrew",
      fa: "Persian",
      ru: "Russian",
      uk: "Ukrainian",
      pl: "Polish",
      cs: "Czech",
      bg: "Bulgarian",
      el: "Greek",
      ro: "Romanian",
      tr: "Turkish",
      th: "Thai",
      vi: "Vietnamese",
      id: "Indonesian",
      nl: "Dutch",
      hu: "Hungarian",
      lt: "Lithuanian",
      bs: "Bosnian",
      mk: "Macedonian",
      mn: "Mongolian",
    }
    if (map[code]) return map[code]
    // fall through
  } catch {}
  return code
}

function collectLeafValues(obj, prefix = "") {
  const out = []
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...collectLeafValues(v, p))
    else out.push([p, v])
  }
  return out
}

function placeholderTokens(str) {
  if (typeof str !== "string") return []
  const tokens = new Set()
  for (const m of str.matchAll(/\{\{[^}]+\}\}/g)) tokens.add(m[0])
  for (const m of str.matchAll(/<\/?\d+>/g)) tokens.add(m[0])
  return [...tokens]
}

function validateStructure(enSection, trSection, sectionName) {
  const enLeaves = collectLeafValues(enSection)
  const trLeaves = new Map(collectLeafValues(trSection))
  const problems = []

  if (enLeaves.length !== trLeaves.size) {
    problems.push(`key count mismatch: en=${enLeaves.length} tr=${trLeaves.size}`)
  }

  for (const [p, enVal] of enLeaves) {
    if (!trLeaves.has(p)) {
      problems.push(`missing key: ${p}`)
      continue
    }
    const trVal = trLeaves.get(p)
    if (typeof enVal !== typeof trVal) {
      problems.push(`type mismatch at ${p}: en=${typeof enVal} tr=${typeof trVal}`)
      continue
    }
    if (typeof enVal === "string") {
      const enTokens = placeholderTokens(enVal)
      const trTokens = placeholderTokens(trVal)
      for (const t of enTokens) {
        if (!trTokens.includes(t)) problems.push(`lost token ${t} at ${p}`)
      }
    }
  }

  if (problems.length) {
    const err = new Error(`Structure validation failed for section "${sectionName}"`)
    err.details = problems
    throw err
  }
}

function buildPrompt(languageName, sectionName, sectionJson) {
  return [
    `You are translating a UI dictionary for a Medusa e-commerce admin dashboard from English to ${languageName}.`,
    "",
    "RULES — follow exactly:",
    "1. Output must be a single JSON object and nothing else. No prose, no markdown fences, no comments.",
    "2. Preserve the JSON structure exactly: same keys, same nesting, same types. Translate VALUES only.",
    "3. Never translate object keys.",
    "4. Preserve every `{{placeholder}}` and every numbered tag like `<0>`, `</0>`, `<1>` verbatim (same spelling, same position).",
    "5. Preserve trailing/leading whitespace and punctuation semantics.",
    "6. Keep brand names untranslated: Medusa, Stripe, PayU, PayPal, WhatsApp, Vercel.",
    "7. Keep currency codes (USD, EUR, INR, etc.) and locale codes untranslated.",
    "8. Use concise UI language appropriate for a professional admin dashboard — match the register a native product-UI writer would use.",
    "9. If the English value is a technical token (e.g., \"ltr\", \"rtl\", a JSON type name, or obviously code), leave it untouched.",
    "",
    `Translate the "${sectionName}" section below into ${languageName}:`,
    "",
    JSON.stringify(sectionJson, null, 2),
  ].join("\n")
}

async function callOpenAICompatible({ url, apiKey, model, prompt, providerLabel, extraHeaders = {} }) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You output only valid JSON. No prose." },
        { role: "user", content: prompt },
      ],
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${providerLabel} ${res.status}: ${text.slice(0, 400)}`)
  }
  const json = await res.json()
  const content = json?.choices?.[0]?.message?.content
  if (!content) throw new Error("Empty model response")
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim()
  try {
    return JSON.parse(cleaned)
  } catch (e) {
    throw new Error(`Model returned invalid JSON: ${e.message}\n---\n${cleaned.slice(0, 400)}`)
  }
}

async function callModel({ provider, apiKey, model, prompt }) {
  if (provider === "dashscope") {
    // Try intl endpoint first (works outside China). Fall back to CN on network/region error.
    try {
      return await callOpenAICompatible({
        url: DASHSCOPE_URL_INTL,
        apiKey,
        model,
        prompt,
        providerLabel: "DashScope-Intl",
      })
    } catch (e) {
      if (!/ENOTFOUND|403|404/.test(String(e.message))) throw e
      return await callOpenAICompatible({
        url: DASHSCOPE_URL_CN,
        apiKey,
        model,
        prompt,
        providerLabel: "DashScope-CN",
      })
    }
  }
  return callOpenAICompatible({
    url: OPENROUTER_URL,
    apiKey,
    model,
    prompt,
    providerLabel: "OpenRouter",
    extraHeaders: {
      "HTTP-Referer": "https://jyt.local/partner-ui",
      "X-Title": "partner-ui i18n translator",
    },
  })
}

function sectionIsUntranslated(enSection, trSection) {
  // Section is "untranslated" if JSON-equal to the English source. A best-effort
  // heuristic — users with partial edits will want --force anyway.
  return JSON.stringify(enSection) === JSON.stringify(trSection)
}

async function main() {
  const args = parseArgs(process.argv)
  const locale = args.positional[0]
  if (!locale) {
    console.error("Usage: node scripts/i18n/translate.js <locale> [--section=X] [--subsection=a,b,c] [--resume] [--force] [--dry-run] [--model=X] [--concurrency=N]")
    process.exit(1)
  }

  // Prefer DashScope (direct Alibaba Cloud Qwen API) when DASHSCOPE_API_KEY is
  // set — OpenRouter's free Qwen tier is heavily rate-limited. Fallback to
  // OpenRouter if no DashScope key, or if the caller explicitly requests an
  // OpenRouter-style model id (containing "/").
  const explicitModel = args.opts.model || process.env.MODEL
  const hasDashScope = !!process.env.DASHSCOPE_API_KEY
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY
  const preferDashScope = hasDashScope && (!explicitModel || isDashScopeModel(explicitModel))
  const provider = preferDashScope ? "dashscope" : "openrouter"
  const model =
    explicitModel ||
    (preferDashScope ? DEFAULT_DASHSCOPE_MODEL : DEFAULT_MODEL)
  const apiKey = preferDashScope
    ? process.env.DASHSCOPE_API_KEY
    : process.env.OPENROUTER_API_KEY

  const concurrency = Math.max(1, parseInt(args.opts.concurrency || "1", 10))
  const languageName = detectLanguageName(locale)
  const targetPath = path.join(TRANSLATIONS_DIR, `${locale}.json`)

  if (!apiKey && !args.flags.has("dry-run")) {
    if (preferDashScope) {
      console.error("Missing DASHSCOPE_API_KEY (or pass --dry-run).")
    } else {
      console.error(
        "Missing API key: set DASHSCOPE_API_KEY (preferred) or OPENROUTER_API_KEY."
      )
    }
    process.exit(1)
  }

  const en = JSON.parse(fs.readFileSync(EN_PATH, "utf8"))
  let target
  if (fs.existsSync(targetPath)) {
    target = JSON.parse(fs.readFileSync(targetPath, "utf8"))
  } else {
    target = JSON.parse(JSON.stringify(en))
    fs.writeFileSync(targetPath, JSON.stringify(target, null, 2) + "\n")
    console.log(`Seeded ${path.relative(process.cwd(), targetPath)} from en.json.`)
  }

  const allSections = Object.keys(en).filter((k) => k !== "$schema")
  const only = args.opts.section
  const sections = only ? allSections.filter((s) => s === only) : allSections

  if (only && sections.length === 0) {
    console.error(`Unknown section: ${only}. Available: ${allSections.join(", ")}`)
    process.exit(1)
  }

  // --subsection support: comma-separated immediate children of --section.
  // When set, only those children are translated; the result is deep-merged
  // into target[section] without disturbing other children.
  const subsectionArg = args.opts.subsection
  let subsectionKeys = null
  if (subsectionArg) {
    if (!only) {
      console.error("--subsection requires --section=<name>.")
      process.exit(1)
    }
    subsectionKeys = subsectionArg
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    const enSec = en[only] || {}
    const unknown = subsectionKeys.filter((k) => !(k in enSec))
    if (unknown.length) {
      console.error(
        `Unknown subsection key(s) under "${only}": ${unknown.join(", ")}.\n` +
          `Available: ${Object.keys(enSec).join(", ")}`
      )
      process.exit(1)
    }
  }

  const skipTranslated = args.flags.has("resume") && !args.flags.has("force")

  const todo = sections.filter((s) => {
    if (args.flags.has("force")) return true
    // When --subsection is in play, --resume compares only the targeted
    // sub-trees; if ANY selected sub-tree is missing or equal to English,
    // we still need to translate.
    if (skipTranslated && subsectionKeys) {
      const targetSec = (target[s] || {})
      const anyMissing = subsectionKeys.some(
        (k) =>
          !(k in targetSec) ||
          JSON.stringify(targetSec[k]) === JSON.stringify(en[s][k])
      )
      if (!anyMissing) {
        console.log(`skip  ${s}.{${subsectionKeys.join(",")}} (already translated)`)
        return false
      }
      return true
    }
    if (skipTranslated && !sectionIsUntranslated(en[s], target[s])) {
      console.log(`skip  ${s} (already translated)`)
      return false
    }
    return true
  })

  console.log(
    `Target ${languageName} (${locale}) · ${provider}:${model} · concurrency ${concurrency} · ${todo.length}/${sections.length} sections`,
  )

  if (args.flags.has("dry-run")) {
    for (const s of todo) console.log(`would translate: ${s}`)
    return
  }

  let done = 0
  const startAll = Date.now()

  const runOne = async (sectionName) => {
    const start = Date.now()

    // When --subsection is set, translate only the selected children and
    // deep-merge the result into target[sectionName] to preserve existing
    // translations of siblings.
    const payload = subsectionKeys
      ? Object.fromEntries(subsectionKeys.map((k) => [k, en[sectionName][k]]))
      : en[sectionName]
    const promptLabel = subsectionKeys
      ? `${sectionName}.{${subsectionKeys.join(",")}}`
      : sectionName

    const prompt = buildPrompt(languageName, promptLabel, payload)

    let translated
    try {
      translated = await callModel({ provider, apiKey, model, prompt })
      validateStructure(payload, translated, promptLabel)
    } catch (err) {
      console.error(`FAIL  ${promptLabel}: ${err.message}`)
      if (err.details) for (const d of err.details) console.error(`        - ${d}`)
      return
    }

    if (subsectionKeys) {
      target[sectionName] = { ...(target[sectionName] || {}), ...translated }
    } else {
      target[sectionName] = translated
    }
    fs.writeFileSync(targetPath, JSON.stringify(target, null, 2) + "\n")
    done++
    const secs = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`ok    ${promptLabel} (${secs}s · ${done}/${todo.length})`)
  }

  // Simple concurrency pool
  const queue = todo.slice()
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const next = queue.shift()
      if (next) await runOne(next)
    }
  })
  await Promise.all(workers)

  const totalSecs = ((Date.now() - startAll) / 1000).toFixed(1)
  console.log(`\nDone. ${done}/${todo.length} sections in ${totalSecs}s.`)
  console.log(`Validate with: node scripts/i18n/validate-translation.js ${locale}.json`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
