/**
 * @module http
 * Isomorphic fetch-based HTTP client for the imgbt API.
 *
 * Features:
 * - Sets `Authorization: Bearer {apiKey}` on every request
 * - Exponential backoff + jitter retry logic (429 and 5xx only)
 * - Configurable per-client timeout
 * - Parses API error responses into typed `ImgbtError` subclasses
 */

import { parseApiError, type ApiErrorBody } from './errors.js'

/**
 * Options for a single HTTP request.
 * @internal
 */
export interface RequestOptions {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

  /** Path relative to the base URL, e.g. `/assets` */
  path: string

  /** Query parameters to append to the URL */
  query?: Record<string, string | number | boolean | undefined>

  /** JSON-serialisable request body (sets `Content-Type: application/json`) */
  body?: unknown

  /** FormData body for multipart uploads */
  formData?: FormData

  /** Per-request timeout override in milliseconds */
  timeout?: number
}

/**
 * Configuration for the internal HTTP client.
 * @internal
 */
export interface HttpClientOptions {
  /** Resolved API key */
  apiKey: string

  /** Fully-qualified base URL including version prefix */
  baseUrl: string

  /** Default request timeout in milliseconds */
  timeout: number

  /** Maximum retry attempts */
  maxRetries: number
}

/**
 * Sleep for a given number of milliseconds.
 * @internal
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Compute the delay for a retry attempt using exponential backoff with jitter.
 *
 * Formula: `min(base * 2^attempt, cap) + random(0, jitter)`
 *
 * @param attempt - Zero-indexed attempt number (0 = first retry)
 * @param retryAfter - Override from `Retry-After` header (seconds)
 * @returns Delay in milliseconds
 * @internal
 */
function backoffDelay(attempt: number, retryAfter?: number): number {
  if (retryAfter != null && retryAfter > 0) {
    return retryAfter * 1000
  }
  const base = 500 // 500ms base
  const cap = 30_000 // 30s cap
  const exponential = Math.min(base * Math.pow(2, attempt), cap)
  const jitter = Math.random() * 1000 // up to 1s jitter
  return exponential + jitter
}

/**
 * Returns `true` for HTTP status codes that should be retried.
 * Only 429 (rate limit) and 5xx (server errors) are retried.
 *
 * @param status - HTTP status code
 * @internal
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

/**
 * Isomorphic HTTP client that handles auth, retries, and error parsing.
 * Works in both browser environments and Node.js (v18+) without any polyfills.
 * @internal
 */
export class HttpClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeout: number
  private readonly maxRetries: number

  constructor(options: HttpClientOptions) {
    this.apiKey = options.apiKey
    this.baseUrl = options.baseUrl.replace(/\/$/, '') // strip trailing slash
    this.timeout = options.timeout
    this.maxRetries = options.maxRetries
  }

  /**
   * Execute an HTTP request with automatic retry and error handling.
   *
   * @param options - Request configuration
   * @returns Parsed JSON response body
   * @throws {ImgbtError} On non-retryable API errors
   * @throws {ImgbtRateLimitError} On rate limit errors that exhaust retries
   * @internal
   */
  async request<T>(options: RequestOptions): Promise<T> {
    const url = this.buildUrl(options.path, options.query)
    const headers = this.buildHeaders(options)

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const retryAfter =
          lastError != null && 'retryAfter' in lastError
            ? (lastError as { retryAfter: number }).retryAfter
            : undefined
        const delay = backoffDelay(attempt - 1, retryAfter)
        await sleep(delay)
      }

      const controller = new AbortController()
      const effectiveTimeout = options.timeout ?? this.timeout
      let timeoutId: ReturnType<typeof setTimeout> | undefined

      if (effectiveTimeout > 0) {
        timeoutId = setTimeout(() => controller.abort(), effectiveTimeout)
      }

      let response: Response

      try {
        response = await fetch(url, {
          method: options.method,
          headers,
          body: this.buildBody(options),
          signal: controller.signal,
        })
      } catch (err) {
        if (timeoutId != null) clearTimeout(timeoutId)
        if (err instanceof Error && err.name === 'AbortError') {
          lastError = new Error(
            `Request timed out after ${effectiveTimeout}ms: ${options.method} ${options.path}`,
          )
          lastError.name = 'ImgbtTimeoutError'
        } else {
          lastError = err instanceof Error ? err : new Error(String(err))
        }
        // Network errors are always retried
        continue
      }

      if (timeoutId != null) clearTimeout(timeoutId)

      if (response.ok) {
        // 204 No Content — return empty object
        if (response.status === 204) {
          return {} as T
        }
        return (await response.json()) as T
      }

      // Parse the error response
      let errorBody: ApiErrorBody = {}
      try {
        errorBody = (await response.json()) as ApiErrorBody
      } catch {
        // Body is not JSON — use empty object, error message comes from status
      }

      const retryAfterHeader = response.headers.get('Retry-After')
      const apiError = parseApiError(response.status, errorBody, retryAfterHeader)

      if (isRetryableStatus(response.status) && attempt < this.maxRetries) {
        lastError = apiError
        continue
      }

      throw apiError
    }

    // All retries exhausted
    throw lastError ?? new Error('Request failed after all retries')
  }

  /**
   * Execute a GET request.
   *
   * @param path - API path
   * @param query - Optional query parameters
   * @internal
   */
  async get<T>(path: string, query?: RequestOptions['query']): Promise<T> {
    return this.request<T>({ method: 'GET', path, query })
  }

  /**
   * Execute a POST request with a JSON body.
   *
   * @param path - API path
   * @param body - JSON-serialisable body
   * @internal
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: 'POST', path, body })
  }

  /**
   * Execute a POST request with a multipart form body.
   *
   * @param path - API path
   * @param formData - FormData body
   * @internal
   */
  async postForm<T>(path: string, formData: FormData): Promise<T> {
    return this.request<T>({ method: 'POST', path, formData })
  }

  /**
   * Execute a PATCH request with a JSON body.
   *
   * @param path - API path
   * @param body - JSON-serialisable body
   * @internal
   */
  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: 'PATCH', path, body })
  }

  /**
   * Execute a DELETE request.
   *
   * @param path - API path
   * @internal
   */
  async delete<T>(path: string): Promise<T> {
    return this.request<T>({ method: 'DELETE', path })
  }

  /**
   * Build the full request URL with query parameters.
   * @internal
   */
  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const url = new URL(`${this.baseUrl}${path}`)
    if (query != null) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value))
        }
      }
    }
    return url.toString()
  }

  /**
   * Build request headers including the `Authorization` header.
   * @internal
   */
  private buildHeaders(options: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    }

    // JSON body — set Content-Type (not needed for FormData; fetch sets it with boundary)
    if (options.body !== undefined && options.formData === undefined) {
      headers['Content-Type'] = 'application/json'
    }

    return headers
  }

  /**
   * Build the request body from the options.
   * @internal
   */
  private buildBody(options: RequestOptions): BodyInit | undefined {
    if (options.formData !== undefined) {
      return options.formData
    }
    if (options.body !== undefined) {
      return JSON.stringify(options.body)
    }
    return undefined
  }
}
