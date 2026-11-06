# Licence for `wmn-data.json`

`wmn-data.json` is the WhatsMyName site list, bundled **unmodified**.

- Source: https://github.com/WebBreacher/WhatsMyName/blob/aa62074cc6c7e5b6f6e196ee826c3e44822b4f67/wmn-data.json
- Commit: `aa62074cc6c7e5b6f6e196ee826c3e44822b4f67` (2 November 2026)
- Retrieved: 6 November 2026
- SHA-256: `b87a3dfdf58d3283657a32e76ee0cd210be369727a9c6f7855485e9de6150e40`
- Copyright (C) 2015-2026 Micah Hoffman and the WhatsMyName contributors (authors listed in the file's `authors` field: 3xp0rt, AlexisPradoOficial, funnyzak, jschibberges, mbiesiad, Micah Hoffman, mtedholm, NovaCode37, Owen Ross).
- Licence: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0), https://creativecommons.org/licenses/by-sa/4.0/
  - Stated in the project's `LICENSE.md` and in the `license` field inside the data file at that commit.

## What this means for this repo

- The file may be redistributed, including commercially, as long as the authors are credited, the licence is linked and changes are stated.
- The file stays under CC BY-SA 4.0. Any edited copy we ship must also be CC BY-SA 4.0 and say what changed.
- Our TypeScript code only reads this data, so the licence does not apply to the code (the code stays under the repo's own terms).
- Any filtering happens at runtime in code (sites marked `valid: false` are skipped; adult sites can be turned off); the file itself is not edited.
- To update: replace the file with a newer WhatsMyName release and update the commit, date and hash above after re-checking its licence.

Engineering record, not legal advice.
