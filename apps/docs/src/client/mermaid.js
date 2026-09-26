// Renders ```mermaid fences client-side. Mermaid comes from a CDN (loaded in
// docusaurus.config.ts `scripts`) rather than @docusaurus/theme-mermaid, so the
// docs app adds no dependency to the monorepo lockfile.
import ExecutionEnvironment from "@docusaurus/ExecutionEnvironment"

function theme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "default"
}

async function render() {
  const mermaid = window.mermaid
  if (!mermaid) return
  mermaid.initialize({ startOnLoad: false, theme: theme(), securityLevel: "strict" })
  // Docusaurus puts `language-mermaid` on the <pre> and renders each source
  // line as its own .token-line span, so rebuild the text line by line.
  const blocks = document.querySelectorAll("pre.language-mermaid")
  for (const [i, pre] of Array.from(blocks).entries()) {
    const host = pre.closest(".theme-code-block") || pre
    // React owns the code block: never remove it (that breaks reconciliation
    // with "removeChild ... not a child"). Hide it and add the diagram after.
    if (host.dataset.mermaidDone) continue
    const lines = pre.querySelectorAll(".token-line")
    const source = lines.length
      ? Array.from(lines, (l) => l.textContent).join("\n")
      : pre.textContent
    try {
      const { svg } = await mermaid.render(`mermaid-${Date.now()}-${i}`, source)
      const div = document.createElement("div")
      div.className = "mermaid-diagram"
      div.innerHTML = svg
      host.dataset.mermaidDone = "1"
      host.style.display = "none"
      host.insertAdjacentElement("afterend", div)
    } catch (e) {
      console.warn("[mermaid] could not render a diagram", e)
    }
  }
}

function whenReady(fn, tries = 50) {
  if (window.mermaid) return fn()
  if (tries > 0) setTimeout(() => whenReady(fn, tries - 1), 100)
}

export function onRouteDidUpdate() {
  if (ExecutionEnvironment.canUseDOM) whenReady(render)
}
