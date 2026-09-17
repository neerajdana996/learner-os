import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The extension's id, pinned (T-048).
 *
 * Chrome derives the id from the manifest's public `key`, so the id only stays
 * still while that key does. It has to stay still: the backend allows the
 * extension by origin (`EXTENSION_ORIGINS`), and in production an unlisted
 * `chrome-extension://` origin is refused outright — so a changed key is not a
 * cosmetic diff, it is every learner's extension losing its connection until
 * someone updates a server setting.
 *
 * This recomputes the id the way Chrome does — sha256 of the DER public key,
 * first sixteen bytes, each hex digit mapped 0→a … f→p — and fails if it is
 * not the id the rest of the project is configured for.
 */
export const EXTENSION_ID = 'gijjgknkbkacdmlbloimmblgicondimf';

function idFromManifestKey(base64Key: string): string {
  const digest = createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest('hex').slice(0, 32);
  return [...digest].map((hex) => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(hex, 16))).join('');
}

describe('the extension id', () => {
  // From the package root, not `import.meta.url`: under WXT's vitest setup the
  // module URL is not a `file:` URL, and `fileURLToPath` refuses it.
  const config = readFileSync(resolve(process.cwd(), 'wxt.config.ts'), 'utf8');

  it('is pinned by a key in the manifest', () => {
    expect(config).toMatch(/\n\s*key: '[A-Za-z0-9+/=]{100,}',/);
  });

  it('still derives the id every other place is configured for', () => {
    const key = /\n\s*key: '([A-Za-z0-9+/=]+)',/.exec(config)?.[1];
    expect(key).toBeDefined();
    expect(idFromManifestKey(key!)).toBe(EXTENSION_ID);
  });
});
