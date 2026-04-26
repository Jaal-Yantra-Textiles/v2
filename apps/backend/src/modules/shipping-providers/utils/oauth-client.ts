/**
 * Simple OAuth 2.0 Client Credentials token manager.
 * Caches tokens and auto-refreshes before expiry.
 */
export class OAuthClient {
  private tokenUrl: string
  private clientId: string
  private clientSecret: string
  private token: string | null = null
  private expiresAt = 0

  constructor(tokenUrl: string, clientId: string, clientSecret: string) {
    this.tokenUrl = tokenUrl
    this.clientId = clientId
    this.clientSecret = clientSecret
  }

  async getToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (this.token && Date.now() < this.expiresAt - 60_000) {
      return this.token
    }

    const res = await fetch(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`OAuth token request failed (${res.status}): ${body}`)
    }

    const data = await res.json()
    this.token = data.access_token
    this.expiresAt = Date.now() + (data.expires_in || 3600) * 1000

    return this.token!
  }

  async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken()
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }
  }
}
