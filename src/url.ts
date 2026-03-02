/**
 * @module url
 * URL builder utilities for the imgbt delivery network.
 *
 * Handles mapping TypeScript-friendly transform parameter names to
 * their short query-string equivalents, and constructs delivery URLs
 * for both the default imgbt CDN and custom domains.
 */

import type { TransformOptions } from './types.js'

/**
 * Mapping from TypeScript-friendly parameter names to URL query parameter names.
 * @internal
 */
const TRANSFORM_PARAM_MAP: Record<keyof TransformOptions, string> = {
  width: 'w',
  height: 'h',
  fit: 'fit',
  format: 'f',
  quality: 'q',
  blur: 'blur',
  sharpen: 'sharpen',
  rotate: 'rt',
  flip: 'flip',
  grayscale: 'grayscale',
  border: 'border',
  radius: 'radius',
  bg: 'bg',
  dpr: 'dpr',
  crop: 'crop',
  gravity: 'g',
  page: 'page',
}

/**
 * Build a delivery URL for an asset, optionally with transformation parameters.
 *
 * @param baseDeliveryUrl - The base delivery URL including the vault domain,
 *   e.g. `https://assets.myapp.com` or `https://my-vault.imgbt.com`
 * @param path - The asset path, e.g. `acme-corp/sf-office/avatars/jane.png`
 * @param transforms - Optional transformation parameters
 * @returns The full delivery URL with transformation query parameters
 *
 * @example
 * buildUrl('https://assets.myapp.com', 'acme-corp/sf-office/avatars/jane.png', {
 *   width: 200, height: 200, fit: 'cover', format: 'webp', quality: 80,
 * })
 * // => 'https://assets.myapp.com/acme-corp/sf-office/avatars/jane.png?w=200&h=200&fit=cover&f=webp&q=80'
 */
export function buildUrl(
  baseDeliveryUrl: string,
  path: string,
  transforms?: TransformOptions,
): string {
  const base = baseDeliveryUrl.replace(/\/$/, '')
  const normPath = path.replace(/^\//, '')

  const url = new URL(`${base}/${normPath}`)

  if (transforms != null) {
    for (const [key, value] of Object.entries(transforms) as [
      keyof TransformOptions,
      TransformOptions[keyof TransformOptions],
    ][]) {
      if (value === undefined || value === null) continue

      const paramName = TRANSFORM_PARAM_MAP[key]
      if (paramName === undefined) continue

      if (typeof value === 'boolean') {
        if (value) {
          url.searchParams.set(paramName, 'true')
        }
      } else {
        url.searchParams.set(paramName, String(value))
      }
    }
  }

  return url.toString()
}

/**
 * Resolve the delivery base URL for a vault, incorporating the optional
 * custom domain override.
 *
 * @param vault - The vault slug
 * @param defaultDomain - Optional custom delivery domain from client options
 * @returns The base delivery URL to use for asset URLs
 *
 * @example
 * resolveDeliveryBase('my-vault')
 * // => 'https://my-vault.imgbt.com'
 *
 * resolveDeliveryBase('my-vault', 'assets.myapp.com')
 * // => 'https://assets.myapp.com'
 */
export function resolveDeliveryBase(vault: string, defaultDomain?: string): string {
  if (defaultDomain != null && defaultDomain.length > 0) {
    if (defaultDomain.startsWith('http://') || defaultDomain.startsWith('https://')) {
      return defaultDomain.replace(/\/$/, '')
    }
    return `https://${defaultDomain}`
  }
  return `https://${vault}.imgbt.com`
}

/**
 * Parse a human-readable duration string into a number of seconds.
 *
 * Supported formats: '30s', '5m', '24h', '7d'.
 *
 * @param duration - Duration string or number of seconds
 * @returns Duration in seconds
 * @throws {Error} If the string format is unrecognised
 *
 * @example
 * parseDuration('24h')  // => 86400
 * parseDuration('7d')   // => 604800
 * parseDuration(3600)   // => 3600
 */
export function parseDuration(duration: string | number): number {
  if (typeof duration === 'number') {
    return duration
  }

  const match = /^(\d+(?:\.\d+)?)(s|m|h|d)$/.exec(duration)
  if (match == null) {
    throw new Error(
      `Invalid duration format: "${duration}". Expected a number or a string like '30s', '5m', '24h', '7d'.`,
    )
  }

  const value = parseFloat(match[1] ?? '0')
  const unit = match[2]

  switch (unit) {
    case 's':
      return value
    case 'm':
      return value * 60
    case 'h':
      return value * 3600
    case 'd':
      return value * 86400
    default:
      throw new Error(`Unknown time unit: "${unit}"`)
  }
}
