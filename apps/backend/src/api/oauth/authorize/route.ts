/**
 * GET /oauth/authorize — the consent screen (#1306 Track B).
 *
 * This is the only place a third party can acquire authority, and the whole
 * design leans on it: dynamic registration hands out nothing, and every token
 * is traceable to an admin who typed their password here and chose a rung on
 * the scope ladder.
 *
 * The page is self-contained HTML with no build step and no framework. It does
 * three fetches in order:
 *
 *   1. `POST /auth/user/emailpass`  — reuse Medusa's own password check rather
 *      than reimplementing one. We never see a password server-side here.
 *   2. `POST /oauth/authorize/consent` with that bearer — mints the code.
 *   3. redirect to the client's `redirect_uri`.
 *
 * Because step 2 needs a bearer the admin just obtained, the flow carries no
 * ambient authority and therefore no CSRF surface.
 *
 * ⚠️ Every parameter below is attacker-controlled, including `client_name`
 * chosen at registration. Everything interpolated into the page goes through
 * `esc`, and the request parameters are re-validated at the consent endpoint —
 * this page's copy of them is a convenience, not a trust boundary.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MCP_SCOPE_LEVELS, mcpScopeAllows } from "../../../lib/mcp-core/tiers"
import type { McpScopeLevel } from "../../../lib/mcp-core/tiers"
import { levelFromScopeString } from "../../../lib/mcp-oauth"
import {
  adminMcpCeiling,
  adminToolCountsByLevel,
} from "../../admin/mcp/lib/handler"
import { MCP_OAUTH_MODULE } from "../../../modules/mcp_oauth"
import type McpOauthService from "../../../modules/mcp_oauth/service"
import { redirectUriRegistered } from "../../../lib/mcp-oauth"

const esc = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

/** What each rung actually lets the client do, in the admin's language. */
const LEVEL_BLURB: Record<McpScopeLevel, string> = {
  read: "Read only. No mutation of any kind.",
  write: "Read, plus ordinary edits — catalog, tasks, partner records.",
  sensitive:
    "Adds the confirm-gated actions, including deletes and anything that spends money at a carrier.",
  dangerous:
    "Adds platform-destructive actions. Grant this only to something you would trust with the dashboard.",
}

/**
 * A hard stop with no redirect.
 *
 * When the client id or redirect URI is wrong we must NOT bounce the browser
 * anywhere — an unvalidated redirect target is exactly what an attacker
 * registering a lookalike client is fishing for. Errors that occur AFTER the
 * redirect URI is proven registered do go back to the client, per RFC 6749.
 */
const errorPage = (
  res: MedusaResponse,
  status: number,
  title: string,
  detail: string
) => {
  res.status(status)
  res.setHeader("content-type", "text/html; charset=utf-8")
  res.send(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${esc(title)}</title>` +
      `<style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1.5rem;color:#111}` +
      `h1{font-size:1.25rem}code{background:#f4f4f5;padding:.1em .35em;border-radius:.25rem}</style>` +
      `<h1>${esc(title)}</h1><p>${esc(detail)}</p>`
  )
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const q = req.query as Record<string, string | undefined>

  const clientId = q.client_id || ""
  const redirectUri = q.redirect_uri || ""

  if (!clientId || !redirectUri) {
    return errorPage(
      res,
      400,
      "Missing parameters",
      "Both client_id and redirect_uri are required."
    )
  }

  const service = req.scope.resolve(MCP_OAUTH_MODULE) as McpOauthService
  const client = await service.getClient(clientId)
  if (!client) {
    return errorPage(
      res,
      400,
      "Unknown client",
      "That client_id is not registered with this server. Reconnect from your MCP client so it can register again."
    )
  }
  if (!redirectUriRegistered(client.redirect_uris, redirectUri)) {
    return errorPage(
      res,
      400,
      "Redirect URI mismatch",
      "That redirect_uri was not registered by this client. It must match one of the registered values exactly."
    )
  }

  // Past this point the redirect target is proven, so protocol errors are
  // reported to the client rather than to the human.
  const bounce = (error: string, description: string) => {
    const url = new URL(redirectUri)
    url.searchParams.set("error", error)
    url.searchParams.set("error_description", description)
    if (q.state) url.searchParams.set("state", q.state)
    return res.redirect(302, url.toString())
  }

  if ((q.response_type || "") !== "code") {
    return bounce(
      "unsupported_response_type",
      "Only the authorization code flow is supported."
    )
  }
  if (!q.code_challenge) {
    return bounce(
      "invalid_request",
      "PKCE is required: send code_challenge with code_challenge_method=S256."
    )
  }
  if ((q.code_challenge_method || "").toUpperCase() !== "S256") {
    return bounce(
      "invalid_request",
      "code_challenge_method must be S256; 'plain' is not accepted."
    )
  }

  const ceiling = adminMcpCeiling()
  const requested = levelFromScopeString(q.scope)
  const offerable = MCP_SCOPE_LEVELS.filter((l) => mcpScopeAllows(ceiling, l))
  // Default the selection to the narrowest of {what was asked for, the
  // ceiling}, and fall back to `read` when the client asked for nothing. The
  // default a tired admin accepts should be the least powerful one that works.
  const preselected: McpScopeLevel =
    requested && mcpScopeAllows(ceiling, requested) ? requested : "read"
  const counts = adminToolCountsByLevel()

  const options = offerable
    .map(
      (level) =>
        `<label class="opt${level === preselected ? " sel" : ""}">` +
        `<input type="radio" name="level" value="${esc(level)}"${
          level === preselected ? " checked" : ""
        }>` +
        `<span><strong>${esc(level)}</strong> — ${esc(counts[level])} tools` +
        `<br><small>${esc(LEVEL_BLURB[level])}</small></span></label>`
    )
    .join("")

  const params = {
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: q.code_challenge,
    code_challenge_method: "S256",
    state: q.state ?? "",
    resource: q.resource ?? "",
  }

  res.setHeader("content-type", "text/html; charset=utf-8")
  // No framing, no referrer: the page carries a password field and, briefly, a
  // bearer token in memory.
  res.setHeader("x-frame-options", "DENY")
  res.setHeader("referrer-policy", "no-referrer")
  res.setHeader("cache-control", "no-store")
  return res.send(`<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect ${esc(client.client_name)} — JYT Admin MCP</title>
<style>
  :root{color-scheme:light dark}
  body{font:16px/1.5 system-ui,-apple-system,sans-serif;max-width:32rem;margin:8vh auto;padding:0 1.5rem;color:#111;background:#fff}
  @media(prefers-color-scheme:dark){body{color:#eee;background:#111}}
  h1{font-size:1.35rem;margin-bottom:.25rem}
  .sub{color:#666;margin-top:0}
  .app{border:1px solid #d4d4d8;border-radius:.6rem;padding:.9rem 1rem;margin:1.25rem 0}
  .app b{display:block}
  label.opt{display:flex;gap:.6rem;align-items:flex-start;border:1px solid #d4d4d8;border-radius:.5rem;padding:.6rem .75rem;margin:.4rem 0;cursor:pointer}
  label.opt.sel{border-color:#111}
  label.opt small{color:#666}
  input[type=email],input[type=password]{width:100%;box-sizing:border-box;padding:.55rem .6rem;border:1px solid #d4d4d8;border-radius:.4rem;font-size:1rem;background:transparent;color:inherit}
  .field{margin:.6rem 0}
  button{width:100%;padding:.7rem;border:0;border-radius:.45rem;background:#111;color:#fff;font-size:1rem;cursor:pointer;margin-top:1rem}
  @media(prefers-color-scheme:dark){button{background:#eee;color:#111}}
  button[disabled]{opacity:.55;cursor:default}
  .err{color:#b91c1c;margin-top:.75rem;min-height:1.25rem}
  .cancel{display:block;text-align:center;margin-top:.75rem;color:#666;font-size:.9rem}
  .warn{font-size:.85rem;color:#666;margin-top:1rem}
</style>
<h1>Authorize an MCP client</h1>
<p class="sub">It will act on the JYT platform as you.</p>

<div class="app">
  <b>${esc(client.client_name)}</b>
  <small>redirects to <code>${esc(redirectUri)}</code></small>
</div>

<form id="f">
  <div class="field"><input type="email" id="email" placeholder="Admin email" autocomplete="username" required></div>
  <div class="field"><input type="password" id="password" placeholder="Password" autocomplete="current-password" required></div>

  <p style="margin:1.25rem 0 .25rem"><strong>Access level</strong></p>
  ${options}

  <button type="submit" id="go">Approve</button>
  <div class="err" id="err"></div>
  <a class="cancel" href="#" id="deny">Cancel</a>
  <p class="warn">You can revoke this at any time from Settings &rsaquo; MCP access. The level you pick is enforced per request, on the tool surface and on the underlying admin routes alike.</p>
</form>

<script>
  var P = ${JSON.stringify(params)};
  var f = document.getElementById('f'), err = document.getElementById('err'), go = document.getElementById('go');
  document.addEventListener('change', function (e) {
    if (e.target.name !== 'level') return;
    Array.prototype.forEach.call(document.querySelectorAll('label.opt'), function (l) {
      l.classList.toggle('sel', l.contains(e.target));
    });
  });
  document.getElementById('deny').addEventListener('click', function (e) {
    e.preventDefault();
    var u = new URL(P.redirect_uri);
    u.searchParams.set('error', 'access_denied');
    if (P.state) u.searchParams.set('state', P.state);
    location.href = u.toString();
  });
  f.addEventListener('submit', async function (e) {
    e.preventDefault();
    err.textContent = ''; go.disabled = true; go.textContent = 'Authorizing…';
    try {
      var login = await fetch('/auth/user/emailpass', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('email').value,
          password: document.getElementById('password').value
        })
      });
      var loginBody = await login.json().catch(function () { return {}; });
      if (!login.ok || !loginBody.token) throw new Error(loginBody.message || 'Sign-in failed.');

      var level = (document.querySelector('input[name=level]:checked') || {}).value || 'read';
      var consent = await fetch('/oauth/authorize/consent', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + loginBody.token },
        body: JSON.stringify({
          client_id: P.client_id, redirect_uri: P.redirect_uri,
          code_challenge: P.code_challenge, code_challenge_method: P.code_challenge_method,
          state: P.state, resource: P.resource, level: level
        })
      });
      var out = await consent.json().catch(function () { return {}; });
      if (!consent.ok || !out.redirect_to) throw new Error(out.error_description || out.message || 'Could not authorize.');
      location.href = out.redirect_to;
    } catch (e2) {
      err.textContent = e2.message || String(e2);
      go.disabled = false; go.textContent = 'Approve';
    }
  });
</script>`)
}
