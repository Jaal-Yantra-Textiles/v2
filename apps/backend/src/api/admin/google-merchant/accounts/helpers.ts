export function sanitizeAccount(account: any) {
  if (!account) return account
  const { client_secret, refresh_token, access_token, ...rest } = account
  return {
    ...rest,
    has_client_secret: !!client_secret,
    has_refresh_token: !!refresh_token,
    connected: !!refresh_token,
  }
}
