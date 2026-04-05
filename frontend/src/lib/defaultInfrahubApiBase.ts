/**
 * URL HTTP API InfraHub для поля «URL API для агента»: порт 8080, не порт Vite.
 */
export function defaultInfrahubApiBase(): string {
  if (typeof window === 'undefined') {
    return 'http://127.0.0.1:8080'
  }
  const { protocol, hostname } = window.location
  const loopback =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  if (loopback) {
    return 'http://127.0.0.1:8080'
  }
  return `${protocol}//${hostname}:8080`
}
