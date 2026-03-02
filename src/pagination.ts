/**
 * @module pagination
 * Auto-pagination support for list endpoints.
 *
 * The Paginator class implements AsyncIterable, enabling the
 * `for await (const asset of imgbt.list(...))` pattern that automatically
 * fetches subsequent pages using the cursor returned by each response.
 */

import type { ListResult, PaginatedResponse } from './types.js'

/**
 * Function type for fetching a single page of results.
 * @internal
 */
export type PageFetcher<T> = (cursor?: string) => Promise<PaginatedResponse<T>>

/**
 * A paginated result that supports both manual and automatic iteration.
 *
 * Returned by `imgbt.list()`. You can either access `result.data` and
 * `result.cursor` directly for manual pagination, or use `for await` to
 * automatically iterate over all assets across all pages.
 *
 * @typeParam T - The type of items in the list (e.g. `Asset`)
 *
 * @example
 * Manual pagination:
 * ```typescript
 * const page1 = await imgbt.list({ partition: 'acme-corp', limit: 50 })
 * console.log(page1.data)     // first 50 assets
 * console.log(page1.hasMore)  // true if more pages exist
 *
 * if (page1.hasMore && page1.cursor) {
 *   const page2 = await imgbt.list({ partition: 'acme-corp', cursor: page1.cursor })
 * }
 * ```
 *
 * @example
 * Auto-pagination (recommended):
 * ```typescript
 * for await (const asset of imgbt.list({ partition: 'acme-corp' })) {
 *   console.log(asset.filename)  // iterates all pages automatically
 * }
 * ```
 */
export class Paginator<T> implements ListResult<T> {
  /** The assets on the current (first) page */
  readonly data: T[]

  /** Opaque pagination cursor, or `null` if no more pages */
  readonly cursor: string | null

  /** Whether there are more pages after this one */
  readonly hasMore: boolean

  /** Function to fetch the next page */
  private readonly fetchPage: PageFetcher<T>

  /**
   * Creates a Paginator from an initial page response.
   *
   * @param initialPage - The first page of results from the API
   * @param fetchPage - Callback to fetch subsequent pages
   */
  constructor(initialPage: PaginatedResponse<T>, fetchPage: PageFetcher<T>) {
    this.data = initialPage.data
    this.cursor = initialPage.cursor
    this.hasMore = initialPage.has_more
    this.fetchPage = fetchPage
  }

  /**
   * Implement `AsyncIterable<T>` so the paginator can be used with `for await`.
   *
   * Yields every item across all pages, fetching subsequent pages automatically
   * as needed. The first page is already in memory; subsequent pages are fetched
   * on demand.
   *
   * @yields Individual items of type `T`
   *
   * @example
   * ```typescript
   * for await (const asset of imgbt.list({ partition: 'acme-corp' })) {
   *   process(asset)
   * }
   * ```
   */
  [Symbol.asyncIterator](): AsyncIterator<T> {
    let pageData = this.data
    let currentCursor = this.cursor
    let currentHasMore = this.hasMore
    let pageIndex = 0
    let isFirstPage = true
    const fetchPage = this.fetchPage

    return {
      async next(): Promise<IteratorResult<T>> {
        // If we've exhausted the current page data...
        while (pageIndex >= pageData.length) {
          // No more pages
          if (!currentHasMore || currentCursor == null) {
            return { value: undefined as unknown as T, done: true }
          }

          // Skip fetching on the first iteration — data is already loaded
          if (isFirstPage) {
            isFirstPage = false
            break
          }

          // Fetch the next page
          const nextPage = await fetchPage(currentCursor)
          pageData = nextPage.data
          currentCursor = nextPage.cursor
          currentHasMore = nextPage.has_more
          pageIndex = 0

          if (pageData.length === 0 && !currentHasMore) {
            return { value: undefined as unknown as T, done: true }
          }
        }

        isFirstPage = false
        const item = pageData[pageIndex]
        if (item === undefined) {
          return { value: undefined as unknown as T, done: true }
        }
        pageIndex++
        return { value: item, done: false }
      },
    }
  }
}
