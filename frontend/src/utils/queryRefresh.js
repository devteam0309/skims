/**
 * After a write, refresh what the app has cached: every query is marked stale and the ones on
 * screen refetch, once.
 *
 * A decision on a record moves figures on several screens at once (an expense's status, its
 * budget's balance, the barangay's allocation, the programme's spending, the dashboard totals),
 * and the cache keeps each for five minutes, so refreshing everything is what keeps them in step.
 *
 * Handlers used to name their keys one call at a time in TanStack Query v4's array form,
 * `invalidateQueries(['expenses'])`. Version 5 reads an array as "no filter", so each of those
 * calls refreshed the whole cache and restarted every request on screen: approving an expense ran
 * five full rounds. Together with the header's polling that exhausted the API's rate limit
 * (then 100 requests per 10 minutes) within one walkthrough, and the page went on showing the
 * expense as it was before the decision. One call keeps the freshness without the repeats.
 */
export const refreshAll = (queryClient) => queryClient.invalidateQueries();
