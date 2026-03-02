/**
 * @module client
 * The main Imgbt client class.
 *
 * Instantiate once and reuse across your application.
 * The client is safe to share between requests and threads.
 *
 * @example
 * import Imgbt from '@imgbt/core'
 *
 * const imgbt = new Imgbt({
 *   apiKey: 'pk_live_xxx',
 *   vault: 'my-vault',
 *   defaultDomain: 'assets.myapp.com',
 * })
 */

import { HttpClient } from './http.js'
import { Paginator } from './pagination.js'
import { buildUrl, resolveDeliveryBase, parseDuration } from './url.js'
import type {
  ImgbtOptions,
  Asset,
  UploadOptions,
  ListOptions,
  UpdateOptions,
  TransformOptions,
  SignUrlOptions,
  ListResult,
  PaginatedResponse,
  RawAsset,
} from './types.js'

/** Default API base URL */
const DEFAULT_BASE_URL = 'https://api.imgbt.com/v1'

/** Default request timeout in milliseconds (30 seconds) */
const DEFAULT_TIMEOUT = 30_000

/** Default maximum number of retry attempts */
const DEFAULT_MAX_RETRIES = 3

/**
 * Convert a raw API asset (snake_case) to the SDK Asset type (camelCase).
 * @internal
 */
function normalizeAsset(raw: RawAsset): Asset {
  return {
    id: raw.id,
    vault: raw.vault,
    partition: raw.partition,
    collection: raw.collection,
    channel: raw.channel,
    filename: raw.filename,
    url: raw.url,
    path: raw.path,
    contentType: raw.content_type,
    size: raw.size,
    width: raw.width,
    height: raw.height,
    pages: raw.pages,
    metadata: raw.metadata ?? {},
    tags: raw.tags ?? [],
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

/**
 * Read an environment variable safely across Node.js, Deno, and browser-like
 * environments (where `process` may not exist).
 * @internal
 */
function getEnv(name: string): string | undefined {
  try {
    // Node.js / Deno — access via globalThis to avoid TS "process" not found error
    const g = globalThis as Record<string, unknown>
    const proc = g['process'] as { env?: Record<string, string | undefined> } | undefined
    if (proc?.env != null) {
      return proc.env[name]
    }
  } catch {
    // Swallow — not in a Node-like environment
  }
  return undefined
}

/**
 * The main imgbt client. Create one instance and reuse it throughout your app.
 *
 * Constructor options can be omitted when the corresponding environment
 * variables are set (`IMGBT_API_KEY`, `IMGBT_VAULT`).
 *
 * @example
 * // With explicit configuration
 * const imgbt = new Imgbt({
 *   apiKey: 'pk_live_xxx',
 *   vault: 'my-vault',
 *   defaultDomain: 'assets.myapp.com',
 *   timeout: 60_000,
 *   maxRetries: 5,
 * })
 *
 * @example
 * // Zero-config using environment variables
 * // IMGBT_API_KEY=pk_live_xxx
 * // IMGBT_VAULT=my-vault
 * const imgbt = new Imgbt({})
 */
export class Imgbt {
  private readonly http: HttpClient
  private readonly vault: string
  private readonly deliveryBase: string

  /**
   * Create an Imgbt client.
   *
   * @param options - Configuration options. `apiKey` and `vault` fall back to
   *   the `IMGBT_API_KEY` and `IMGBT_VAULT` environment variables respectively.
   *
   * @throws {Error} If neither `apiKey` option nor `IMGBT_API_KEY` env var is set.
   * @throws {Error} If neither `vault` option nor `IMGBT_VAULT` env var is set.
   *
   * @example
   * const imgbt = new Imgbt({
   *   apiKey: 'pk_live_xxx',
   *   vault: 'my-vault',
   *   defaultDomain: 'assets.myapp.com',
   * })
   */
  constructor(options: ImgbtOptions) {
    const apiKey = options.apiKey ?? getEnv('IMGBT_API_KEY')
    if (!apiKey) {
      throw new Error(
        'imgbt: apiKey is required. Pass it as an option or set the IMGBT_API_KEY environment variable.',
      )
    }

    const vault = options.vault ?? getEnv('IMGBT_VAULT')
    if (!vault) {
      throw new Error(
        'imgbt: vault is required. Pass it as an option or set the IMGBT_VAULT environment variable.',
      )
    }

    this.vault = vault
    this.deliveryBase = resolveDeliveryBase(vault, options.defaultDomain)

    this.http = new HttpClient({
      apiKey,
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    })
  }

  /**
   * Upload a file to imgbt.
   *
   * Files are uploaded using `multipart/form-data`. The SDK sets the correct
   * content type automatically. For files larger than 100 MB, consider using
   * the presigned URL flow (future feature).
   *
   * @param options - Upload configuration including the file data and path keys
   * @returns The created asset with its metadata and delivery URL
   *
   * @throws {ImgbtAuthenticationError} If the API key is invalid (401)
   * @throws {ImgbtValidationError} If required fields are missing or invalid (400)
   * @throws {ImgbtConflictError} If an asset already exists at this path (409)
   * @throws {ImgbtRateLimitError} If the rate limit is exceeded (429)
   *
   * @example
   * // Upload a Buffer (Node.js)
   * import { readFileSync } from 'fs'
   * const buffer = readFileSync('./jane.png')
   * const asset = await imgbt.upload({
   *   file: buffer,
   *   partition: 'acme-corp',
   *   collection: 'sf-office',
   *   channel: 'avatars',
   *   filename: 'jane.png',
   *   metadata: { userId: '123' },
   *   tags: ['profile', 'employee'],
   * })
   * console.log(asset.url)
   *
   * @example
   * // Upload a browser File object
   * const fileInput = document.querySelector('input[type=file]')
   * const file = fileInput.files[0]
   * const asset = await imgbt.upload({
   *   file,
   *   partition: 'acme-corp',
   *   collection: 'uploads',
   *   channel: 'user-content',
   * })
   */
  async upload(options: UploadOptions): Promise<Asset> {
    const formData = new FormData()

    // Append the file — handle different file types
    const fileBlob = await toBlob(options.file, options.contentType)
    formData.append('file', fileBlob, options.filename ?? 'upload')

    formData.append('partition', options.partition)
    formData.append('collection', options.collection)
    formData.append('channel', options.channel)

    if (options.filename != null) {
      formData.append('filename', options.filename)
    }

    if (options.metadata != null) {
      formData.append('metadata', JSON.stringify(options.metadata))
    }

    if (options.tags != null && options.tags.length > 0) {
      formData.append('tags', JSON.stringify(options.tags))
    }

    const raw = await this.http.postForm<RawAsset>('/assets', formData)
    return normalizeAsset(raw)
  }

  /**
   * List assets in your vault, with optional filters.
   *
   * Returns a `ListResult` that supports both manual pagination and automatic
   * iteration via `for await`.
   *
   * @param options - Optional filters: partition, collection, channel, limit, cursor
   * @returns A paginated result with auto-iteration support
   *
   * @throws {ImgbtAuthenticationError} If the API key is invalid (401)
   * @throws {ImgbtRateLimitError} If the rate limit is exceeded (429)
   *
   * @example
   * // Auto-pagination — iterate all assets without managing cursors
   * for await (const asset of imgbt.list({ partition: 'acme-corp' })) {
   *   console.log(asset.filename)
   * }
   *
   * @example
   * // Manual pagination — manage cursors yourself
   * const page1 = await imgbt.list({
   *   partition: 'acme-corp',
   *   collection: 'sf-office',
   *   limit: 50,
   * })
   * console.log(page1.data)       // Asset[]
   * console.log(page1.hasMore)    // boolean
   *
   * if (page1.hasMore && page1.cursor) {
   *   const page2 = await imgbt.list({
   *     partition: 'acme-corp',
   *     collection: 'sf-office',
   *     cursor: page1.cursor,
   *   })
   * }
   */
  async list(options?: ListOptions): Promise<ListResult<Asset>> {
    const fetchPage = async (cursor?: string): Promise<PaginatedResponse<Asset>> => {
      const query: Record<string, string | number | boolean | undefined> = {}

      if (options?.partition != null) query['partition'] = options.partition
      if (options?.collection != null) query['collection'] = options.collection
      if (options?.channel != null) query['channel'] = options.channel
      if (options?.limit != null) query['limit'] = options.limit
      if (cursor != null) query['cursor'] = cursor
      else if (options?.cursor != null) query['cursor'] = options.cursor

      const raw = await this.http.get<PaginatedResponse<RawAsset>>('/assets', query)
      return {
        data: raw.data.map(normalizeAsset),
        cursor: raw.cursor,
        has_more: raw.has_more,
      }
    }

    const firstPage = await fetchPage()
    return new Paginator<Asset>(firstPage, (cursor) => fetchPage(cursor))
  }

  /**
   * Get metadata for a single asset by its ID.
   *
   * @param assetId - The asset ID, e.g. `'asset_01HQ3...'`
   * @returns The asset metadata
   *
   * @throws {ImgbtNotFoundError} If the asset does not exist (404)
   * @throws {ImgbtAuthenticationError} If the API key is invalid (401)
   *
   * @example
   * const asset = await imgbt.get('asset_01HQ3...')
   * console.log(asset.url)
   * console.log(asset.contentType)
   * console.log(asset.size)
   */
  async get(assetId: string): Promise<Asset> {
    const raw = await this.http.get<RawAsset>(`/assets/${assetId}`)
    return normalizeAsset(raw)
  }

  /**
   * Update the metadata and/or tags for an existing asset.
   *
   * Both `metadata` and `tags` are replaced in full — to keep existing values,
   * fetch the current asset first and merge manually.
   *
   * @param assetId - The asset ID to update
   * @param updates - Fields to update (`metadata` and/or `tags`)
   * @returns The updated asset
   *
   * @throws {ImgbtNotFoundError} If the asset does not exist (404)
   * @throws {ImgbtAuthenticationError} If the API key is invalid (401)
   * @throws {ImgbtValidationError} If the update payload is invalid (400)
   *
   * @example
   * const updated = await imgbt.update('asset_01HQ3...', {
   *   metadata: { userId: '456', status: 'approved' },
   *   tags: ['profile', 'employee', 'verified'],
   * })
   * console.log(updated.tags) // ['profile', 'employee', 'verified']
   */
  async update(assetId: string, updates: UpdateOptions): Promise<Asset> {
    const raw = await this.http.patch<RawAsset>(`/assets/${assetId}`, updates)
    return normalizeAsset(raw)
  }

  /**
   * Delete an asset by its ID or path.
   *
   * @param assetIdOrPath - Either the asset ID (`'asset_01HQ3...'`) or its
   *   path (`'acme-corp/sf-office/avatars/jane.png'`)
   * @returns void
   *
   * @throws {ImgbtNotFoundError} If the asset does not exist (404)
   * @throws {ImgbtAuthenticationError} If the API key is invalid or lacks delete permission (401)
   *
   * @example
   * // Delete by ID
   * await imgbt.delete('asset_01HQ3...')
   *
   * @example
   * // Delete by path
   * await imgbt.delete('acme-corp/sf-office/avatars/jane.png')
   */
  async delete(assetIdOrPath: string): Promise<void> {
    // Asset IDs start with 'asset_'; everything else is treated as a path
    if (assetIdOrPath.startsWith('asset_')) {
      await this.http.delete(`/assets/${assetIdOrPath}`)
    } else {
      await this.http.delete<void>(`/assets/${encodeURIComponent(assetIdOrPath)}`)
    }
  }

  /**
   * Generate a delivery URL for an asset, optionally with transformations.
   *
   * This is a synchronous method — no network request is made.
   * The URL uses the `defaultDomain` from client options if set,
   * otherwise falls back to the vault subdomain (`{vault}.imgbt.com`).
   *
   * @param path - The asset path, e.g. `'acme-corp/sf-office/avatars/jane.png'`
   * @param transforms - Optional transformation parameters
   * @returns The full delivery URL
   *
   * @example
   * // Simple URL (no transforms)
   * const url = imgbt.url('acme-corp/sf-office/avatars/jane.png')
   * // => 'https://assets.myapp.com/acme-corp/sf-office/avatars/jane.png'
   *
   * @example
   * // URL with transformations
   * const url = imgbt.url('acme-corp/sf-office/avatars/jane.png', {
   *   width: 200,
   *   height: 200,
   *   fit: 'cover',
   *   format: 'webp',
   *   quality: 80,
   * })
   * // => 'https://assets.myapp.com/acme-corp/sf-office/avatars/jane.png?w=200&h=200&fit=cover&f=webp&q=80'
   *
   * @example
   * // PDF page as image
   * const url = imgbt.url('acme-corp/docs/contract.pdf', {
   *   page: 1,
   *   format: 'png',
   *   width: 800,
   * })
   */
  url(path: string, transforms?: TransformOptions): string {
    return buildUrl(this.deliveryBase, path, transforms)
  }

  /**
   * Generate a signed URL with an expiration time and optional password protection.
   *
   * The signed URL includes an HMAC token and expiration timestamp. The imgbt
   * edge validates the signature and expiration on every request, with no
   * database lookup required.
   *
   * @param path - The asset path to sign, e.g. `'acme-corp/docs/contract.pdf'`
   * @param options - Signing options: expiration duration and optional password
   * @returns The signed delivery URL
   *
   * @throws {ImgbtAuthenticationError} If the API key is invalid (401)
   * @throws {ImgbtNotFoundError} If the asset path does not exist (404)
   *
   * @example
   * // 24-hour expiring link
   * const url = await imgbt.signUrl('acme-corp/docs/contract.pdf', {
   *   expiresIn: '24h',
   * })
   * // => 'https://assets.myapp.com/acme-corp/docs/contract.pdf?token=xxx&expires=1707436800'
   *
   * @example
   * // Password-protected link expiring in 7 days
   * const url = await imgbt.signUrl('acme-corp/docs/contract.pdf', {
   *   expiresIn: '7d',
   *   password: 'secret123',
   * })
   */
  async signUrl(path: string, options: SignUrlOptions): Promise<string> {
    const expiresInSeconds = parseDuration(options.expiresIn)
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds

    const body: Record<string, unknown> = {
      path,
      vault: this.vault,
      expires_at: expiresAt,
    }

    if (options.password != null) {
      body['password'] = options.password
    }

    const response = await this.http.post<{ url: string }>('/urls/sign', body)
    return response.url
  }

  /**
   * Revoke access to an asset path or signed URL token.
   *
   * Revoked paths/tokens are stored in Cloudflare KV and propagate globally
   * within approximately 60 seconds. Once revoked, the asset URL will return 403.
   *
   * @param pathOrToken - The asset path to revoke (`'acme-corp/docs/contract.pdf'`)
   *   or a specific signed token to invalidate
   * @returns void
   *
   * @throws {ImgbtAuthenticationError} If the API key is invalid or lacks revoke permission (401)
   *
   * @example
   * // Revoke a specific path
   * await imgbt.revoke('acme-corp/docs/contract.pdf')
   *
   * @example
   * // Revoke a specific signed token
   * await imgbt.revoke('eyJhbGciOiJIUzI1NiJ9...')
   */
  async revoke(pathOrToken: string): Promise<void> {
    await this.http.post('/urls/revoke', {
      path: pathOrToken,
      vault: this.vault,
    })
  }
}

/**
 * Convert various file input types to a `Blob` for use with `FormData`.
 * Works with Uint8Array (which includes Node.js Buffer), Blob, File,
 * ReadableStream, and ArrayBuffer.
 * @internal
 */
async function toBlob(
  file: Uint8Array | Blob | ReadableStream | ArrayBuffer | File,
  contentType?: string,
): Promise<Blob> {
  const type = contentType ?? 'application/octet-stream'

  if (file instanceof Blob) {
    // File extends Blob — handles both
    return file
  }

  if (file instanceof ArrayBuffer) {
    return new Blob([file], { type })
  }

  // Uint8Array (includes Node.js Buffer which extends Uint8Array)
  if (file instanceof Uint8Array) {
    // Cast via ArrayBuffer to satisfy Blob constructor's type constraints
    return new Blob([file.buffer as ArrayBuffer], { type })
  }

  // ReadableStream — consume it into chunks
  if (file instanceof ReadableStream) {
    const reader = (file as ReadableStream<Uint8Array>).getReader()
    const chunks: Uint8Array[] = []
    let done = false

    while (!done) {
      const result = await reader.read()
      if (result.done) {
        done = true
      } else {
        chunks.push(result.value)
      }
    }

    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
    const combined = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }
    return new Blob([combined], { type })
  }

  // Fallback — try treating as ArrayBuffer-like
  return new Blob([file as ArrayBuffer], { type })
}
