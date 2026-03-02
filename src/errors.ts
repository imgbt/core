/**
 * @module errors
 * Typed error classes for the @imgbt/core SDK.
 *
 * All errors extend the base `ImgbtError` class, which exposes:
 * - `.status` — HTTP status code
 * - `.code` — machine-readable error code string
 * - `.message` — human-readable error description
 *
 * @example
 * ```typescript
 * import { ImgbtNotFoundError, ImgbtRateLimitError } from '@imgbt/core'
 *
 * try {
 *   const asset = await imgbt.get('asset_missing')
 * } catch (err) {
 *   if (err instanceof ImgbtNotFoundError) {
 *     console.log('Asset not found:', err.message)
 *   } else if (err instanceof ImgbtRateLimitError) {
 *     console.log('Rate limited. Retry after:', err.retryAfter, 'seconds')
 *   }
 * }
 * ```
 */

/**
 * Shape of the JSON error body returned by the imgbt API.
 * @internal
 */
export interface ApiErrorBody {
  error?: {
    code?: string
    message?: string
  }
  message?: string
  code?: string
}

/**
 * Base class for all imgbt SDK errors. Extends the native `Error` class with
 * additional `status` and `code` properties from the API response.
 *
 * @example
 * ```typescript
 * import { ImgbtError } from '@imgbt/core'
 *
 * try {
 *   await imgbt.upload({ ... })
 * } catch (err) {
 *   if (err instanceof ImgbtError) {
 *     console.error(`imgbt error [${err.code}] ${err.status}: ${err.message}`)
 *   }
 * }
 * ```
 */
export class ImgbtError extends Error {
  /**
   * HTTP status code of the failed response.
   * @example 404
   */
  readonly status: number

  /**
   * Machine-readable error code returned by the API.
   * Useful for programmatic error handling.
   * @example 'asset_not_found'
   */
  readonly code: string

  /**
   * Creates an ImgbtError.
   *
   * @param status - HTTP status code
   * @param code - Machine-readable error code
   * @param message - Human-readable error description
   */
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ImgbtError'
    this.status = status
    this.code = code
    // Maintain proper stack trace in V8 / Node.js environments
    const ErrorWithCaptureStackTrace = Error as typeof Error & {
      captureStackTrace?: (target: object, constructor: Function) => void
    }
    if (typeof ErrorWithCaptureStackTrace.captureStackTrace === 'function') {
      ErrorWithCaptureStackTrace.captureStackTrace(this, new.target)
    }
  }
}

/**
 * Thrown when the requested asset or resource is not found (HTTP 404).
 *
 * @example
 * ```typescript
 * import { ImgbtNotFoundError } from '@imgbt/core'
 *
 * try {
 *   const asset = await imgbt.get('asset_does_not_exist')
 * } catch (err) {
 *   if (err instanceof ImgbtNotFoundError) {
 *     console.log('Not found:', err.message)
 *     // 'Asset asset_does_not_exist not found.'
 *   }
 * }
 * ```
 */
export class ImgbtNotFoundError extends ImgbtError {
  constructor(message: string, code = 'not_found') {
    super(404, code, message)
    this.name = 'ImgbtNotFoundError'
  }
}

/**
 * Thrown when the provided API key is invalid or missing (HTTP 401).
 *
 * @example
 * ```typescript
 * import { ImgbtAuthenticationError } from '@imgbt/core'
 *
 * try {
 *   const asset = await imgbt.upload({ ... })
 * } catch (err) {
 *   if (err instanceof ImgbtAuthenticationError) {
 *     console.log('Check your API key:', err.message)
 *   }
 * }
 * ```
 */
export class ImgbtAuthenticationError extends ImgbtError {
  constructor(message: string, code = 'unauthorized') {
    super(401, code, message)
    this.name = 'ImgbtAuthenticationError'
  }
}

/**
 * Thrown when the API rate limit is exceeded (HTTP 429).
 * Inspect `.retryAfter` to determine when to retry.
 *
 * @example
 * ```typescript
 * import { ImgbtRateLimitError } from '@imgbt/core'
 *
 * try {
 *   await imgbt.upload({ ... })
 * } catch (err) {
 *   if (err instanceof ImgbtRateLimitError) {
 *     console.log(`Rate limited. Retry in ${err.retryAfter} seconds.`)
 *     await sleep(err.retryAfter * 1000)
 *   }
 * }
 * ```
 */
export class ImgbtRateLimitError extends ImgbtError {
  /**
   * Number of seconds to wait before retrying the request.
   * Parsed from the `Retry-After` response header.
   */
  readonly retryAfter: number

  /**
   * Creates an ImgbtRateLimitError.
   *
   * @param message - Human-readable error description
   * @param retryAfter - Seconds until the rate limit resets
   * @param code - Machine-readable error code
   */
  constructor(message: string, retryAfter: number, code = 'rate_limit_exceeded') {
    super(429, code, message)
    this.name = 'ImgbtRateLimitError'
    this.retryAfter = retryAfter
  }
}

/**
 * Thrown when the request contains invalid parameters (HTTP 400).
 * The error message includes details about which fields failed validation.
 *
 * @example
 * ```typescript
 * import { ImgbtValidationError } from '@imgbt/core'
 *
 * try {
 *   await imgbt.upload({ file: buffer, partition: '' }) // empty partition
 * } catch (err) {
 *   if (err instanceof ImgbtValidationError) {
 *     console.log('Validation failed:', err.message)
 *     // 'partition: must not be empty'
 *   }
 * }
 * ```
 */
export class ImgbtValidationError extends ImgbtError {
  constructor(message: string, code = 'validation_error') {
    super(400, code, message)
    this.name = 'ImgbtValidationError'
  }
}

/**
 * Thrown when the request conflicts with the current state of the resource (HTTP 409).
 * For example, attempting to upload a file that already exists at that path.
 *
 * @example
 * ```typescript
 * import { ImgbtConflictError } from '@imgbt/core'
 *
 * try {
 *   await imgbt.upload({ filename: 'existing.png', ... })
 * } catch (err) {
 *   if (err instanceof ImgbtConflictError) {
 *     console.log('Conflict:', err.message)
 *     // 'An asset with path acme-corp/avatars/existing.png already exists.'
 *   }
 * }
 * ```
 */
export class ImgbtConflictError extends ImgbtError {
  constructor(message: string, code = 'conflict') {
    super(409, code, message)
    this.name = 'ImgbtConflictError'
  }
}

/**
 * Parse a failed API response into the appropriate typed error class.
 *
 * @param status - HTTP status code from the response
 * @param body - Parsed JSON body from the error response
 * @param retryAfterHeader - Value of the `Retry-After` response header (for 429s)
 * @returns The appropriate `ImgbtError` subclass
 * @internal
 */
export function parseApiError(
  status: number,
  body: ApiErrorBody,
  retryAfterHeader?: string | null,
): ImgbtError {
  const message =
    body?.error?.message ?? body?.message ?? `Request failed with status ${status}`
  const code = body?.error?.code ?? body?.code ?? 'unknown_error'

  switch (status) {
    case 400:
      return new ImgbtValidationError(message, code)
    case 401:
      return new ImgbtAuthenticationError(message, code)
    case 404:
      return new ImgbtNotFoundError(message, code)
    case 409:
      return new ImgbtConflictError(message, code)
    case 429: {
      const retryAfter = retryAfterHeader != null ? parseInt(retryAfterHeader, 10) : 60
      return new ImgbtRateLimitError(message, isNaN(retryAfter) ? 60 : retryAfter, code)
    }
    default:
      return new ImgbtError(status, code, message)
  }
}
