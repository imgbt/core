/**
 * @module @imgbt/core
 *
 * TypeScript SDK for imgbt — upload, transform, and deliver media assets
 * from a global edge network.
 *
 * @example
 * import Imgbt from '@imgbt/core'
 *
 * const imgbt = new Imgbt({
 *   apiKey: 'pk_live_xxx',
 *   vault: 'my-vault',
 *   defaultDomain: 'assets.myapp.com',
 * })
 *
 * // Upload a file
 * const asset = await imgbt.upload({
 *   file: fileBuffer,
 *   partition: 'acme-corp',
 *   collection: 'sf-office',
 *   channel: 'avatars',
 *   filename: 'jane.png',
 * })
 *
 * // Generate a delivery URL with transformations
 * const url = imgbt.url('acme-corp/sf-office/avatars/jane.png', {
 *   width: 200,
 *   height: 200,
 *   fit: 'cover',
 *   format: 'webp',
 *   quality: 80,
 * })
 *
 * // List all assets for a partition
 * for await (const asset of imgbt.list({ partition: 'acme-corp' })) {
 *   console.log(asset.filename)
 * }
 *
 * // Generate a signed URL with 24h expiry
 * const signedUrl = await imgbt.signUrl('acme-corp/docs/contract.pdf', {
 *   expiresIn: '24h',
 * })
 */

// Default export — the main client class
export { Imgbt } from './client.js'
export { Imgbt as default } from './client.js'

// Named error classes
export {
  ImgbtError,
  ImgbtNotFoundError,
  ImgbtAuthenticationError,
  ImgbtRateLimitError,
  ImgbtValidationError,
  ImgbtConflictError,
} from './errors.js'

// Types
export type {
  ImgbtOptions,
  Asset,
  UploadOptions,
  ListOptions,
  UpdateOptions,
  TransformOptions,
  SignUrlOptions,
  ListResult,
} from './types.js'

// URL utilities (useful for static URL generation without a client instance)
export { buildUrl, resolveDeliveryBase, parseDuration } from './url.js'
