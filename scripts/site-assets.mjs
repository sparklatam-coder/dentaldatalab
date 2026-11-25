// The browser modules and stylesheet copied from src/ into /assets/. build.mjs hashes them into ?v=, and
// build-cloudflare.mjs gives exactly these files the immutable cache header, so the two lists cannot drift.
export const VERSIONED_ASSETS = Object.freeze(['styles.css', 'app.mjs', 'shared.mjs', 'content-studio.mjs', 'clinic-assets.mjs']);
