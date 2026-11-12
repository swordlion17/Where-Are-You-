/**
 * Public page where people can play, added to every shared result so friends can follow it.
 * Must match the itch.io project URL (Project URL field: where-are-you).
 */
export const PLAY_URL = 'https://swordlion17.itch.io/where-are-you';

/**
 * Anonymous play stats (PostHog, see src/platform/analytics.ts and docs/analytics.md). Empty `key`
 * turns them off. The project key is meant to be public: it can only send events, never read them.
 * `host` is https://eu.i.posthog.com for EU Cloud, https://us.i.posthog.com for US Cloud.
 */
export const ANALYTICS = {
  key: '',
  host: 'https://eu.i.posthog.com',
};
