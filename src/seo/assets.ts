// Generated pages link the app's own stylesheet so the two surfaces cannot
// drift visually. Vite fingerprints that filename on every build, so the
// generator reads it out of the build manifest rather than guessing.

type ManifestChunk = { file: string; isEntry?: boolean; css?: string[] };

export function cssHrefFromManifest(manifestJson: string): string {
  const manifest = JSON.parse(manifestJson) as Record<string, ManifestChunk>;
  const entry = Object.values(manifest).find((c) => c.isEntry);
  if (!entry) {
    throw new Error(
      'seo: no entry chunk in the Vite manifest — is build.manifest enabled in vite.config.ts?',
    );
  }
  const css = entry.css?.[0];
  if (!css) {
    throw new Error(
      'seo: the entry chunk lists no stylesheet — generated pages would be unstyled, so this fails the build rather than shipping them.',
    );
  }
  return '/' + css;
}
