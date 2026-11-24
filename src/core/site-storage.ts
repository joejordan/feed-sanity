/** Builds a site- and account-namespaced storage prefix (`v2/<siteId>/<accountId>`). */
export function siteStoragePrefix(siteId: string, accountId: string): string {
  return `v2/${siteId}/${accountId}`;
}
