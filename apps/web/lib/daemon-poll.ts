/**
 * Re-exports of daemon-client helpers for use in Next.js route handlers.
 * These are provided by @controlai-web/api to avoid deep relative imports.
 */
export { checkDaemonHealth, DaemonError } from '@controlai-web/api';
export type { DaemonHealthResponse } from '@controlai-web/api';
