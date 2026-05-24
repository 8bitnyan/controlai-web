import { auth } from '@controlai-web/api';
import { headers } from 'next/headers';

/**
 * Get the current session from the request headers (Server Components / Route Handlers).
 */
export async function getSession() {
  const headerList = await headers();
  return auth.api.getSession({ headers: headerList });
}

export { auth };
