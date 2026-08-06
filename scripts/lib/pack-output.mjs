/**
 * Shared parsing of `npm pack --json` output.
 *
 * Two things vary and have both broken a release:
 *
 * 1. **The result shape.** npm 11 emits an array of results; newer npm emits an object keyed
 *    by package name. The publish workflow installs `npm@latest`, so CI and a developer
 *    machine routinely disagree.
 * 2. **Surrounding noise.** `actions/setup-node` writes an `.npmrc` that provokes an
 *    `always-auth` warning, and npm can print notices before *or* after the payload.
 *
 * Every caller goes through here so a fix lands once rather than per script.
 */

/** @typedef {{path: string, size: number}} PackedFile */
/** @typedef {{filename: string, files: PackedFile[], size: number, unpackedSize: number, entryCount: number}} PackResult */

/**
 * @param {string} output raw stdout from `npm pack --json`
 * @returns {PackResult}
 * @throws {Error} when no usable JSON payload can be found
 */
export function parsePackResult(output) {
  const start = output.search(/[[{]/);
  if (start === -1) {
    throw new Error(`Found no JSON in \`npm pack --json\` output:\n${output}`);
  }

  const candidate = output.slice(start);
  let parsed;
  for (let end = candidate.length; end > 0;) {
    const cut = Math.max(candidate.lastIndexOf('}', end - 1), candidate.lastIndexOf(']', end - 1));
    if (cut === -1) break;
    try {
      parsed = JSON.parse(candidate.slice(0, cut + 1));
      break;
    } catch {
      end = cut;
    }
  }

  if (parsed === undefined) {
    throw new Error(`Could not parse \`npm pack --json\` output:\n${output}`);
  }

  const results = Array.isArray(parsed) ? parsed : Object.values(parsed);
  const first = results[0];
  if (!first || !Array.isArray(first.files) || typeof first.filename !== 'string') {
    throw new Error(
      `\`npm pack --json\` returned an unexpected payload:\n${JSON.stringify(parsed, null, 2)}`,
    );
  }
  return first;
}
