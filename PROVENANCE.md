# Source provenance and licenses

This repository consolidates the eight existing 612 projects. Working-tree source,
including uncommitted improvements, was copied into `tools/`; original installations,
media and local Git repositories remain intact. No unrelated LTW project is included.

- 612 Play history continues from `b4ade24da2ef2bb7cb8c1f580a9470642edee378`.
- 612 Clip's existing `ed59950` history is retained as a merge parent.
- 612 Hub's existing `b76df65` history is retained as a merge parent.
- The other five local repositories had no commits at consolidation time.

The Pull MIT license remains in `tools/612-pull/LICENSE`, including its original
copyright notice. No new blanket license is assigned to the other projects.
Existing attribution comments and references to upstream/user projects are retained.
Third-party dependencies retain their own licenses and are installed separately;
consult their packages before redistribution. No dependencies, model weights,
compiled executables or media are vendored.

Clip's loose binary caption fonts had no accompanying license files in the source
folder and were not copied. Font fallback remains available. Install suitably licensed
fonts locally if you need matching caption styles. Package-managed frontend fonts
remain referenced by their existing dependencies.

Historical Grok storage keys, project formats and environment-variable names are
retained where renaming would break saved data or integrations. Display names and
current package names use 612.
