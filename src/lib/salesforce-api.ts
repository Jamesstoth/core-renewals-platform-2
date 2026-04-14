import jsforce, { Connection } from 'jsforce'

let cachedConnection: Connection | null = null
let tokenExpiresAt = 0

/**
 * Returns an authenticated jsforce Connection using the username-password
 * OAuth2 flow. Reuses the connection across requests until the token expires.
 */
export async function getSalesforceConnection(): Promise<Connection> {
  // Reuse connection if token is still valid (with 5-min buffer)
  if (cachedConnection && Date.now() < tokenExpiresAt - 5 * 60 * 1000) {
    return cachedConnection
  }

  const clientId = process.env.SF_CLIENT_ID
  const clientSecret = process.env.SF_CLIENT_SECRET
  const username = process.env.SF_USERNAME
  const password = process.env.SF_PASSWORD
  const securityToken = process.env.SF_SECURITY_TOKEN

  if (!clientId || !clientSecret || !username || !password || !securityToken) {
    throw new Error(
      'Missing Salesforce credentials. Set SF_CLIENT_ID, SF_CLIENT_SECRET, SF_USERNAME, SF_PASSWORD, SF_SECURITY_TOKEN.'
    )
  }

  const conn = new jsforce.Connection({
    oauth2: {
      loginUrl: 'https://login.salesforce.com',
      clientId,
      clientSecret,
    },
  })

  // Salesforce expects password + security token concatenated
  await conn.login(username, `${password}${securityToken}`)

  cachedConnection = conn
  // jsforce doesn't expose token expiry directly; assume 2-hour session
  tokenExpiresAt = Date.now() + 2 * 60 * 60 * 1000

  console.log('[salesforce-api] Authenticated as', username)
  return conn
}

/**
 * Run a SOQL query against Salesforce and return the records array.
 * Handles authentication and auto-retries once on session expiry.
 */
export async function querySalesforce<T extends Record<string, unknown> = Record<string, unknown>>(
  soql: string
): Promise<T[]> {
  let conn = await getSalesforceConnection()

  try {
    const result = await conn.query<T>(soql)
    return result.records
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)

    // If session expired, clear cache and retry once
    if (message.includes('INVALID_SESSION_ID') || message.includes('Session expired')) {
      console.log('[salesforce-api] Session expired, re-authenticating...')
      cachedConnection = null
      tokenExpiresAt = 0
      conn = await getSalesforceConnection()
      const result = await conn.query<T>(soql)
      return result.records
    }

    throw new Error(`Salesforce query failed: ${message}`)
  }
}
