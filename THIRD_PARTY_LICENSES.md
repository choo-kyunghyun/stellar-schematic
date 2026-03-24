# Third-Party Licenses

This project depends on third-party packages distributed under open source licenses.

## Summary (production dependencies)

Generated with:

```bash
npm run licenses:summary
```

Current summary:

- MIT: 97
- ISC: 34
- Apache-2.0: 6
- BSD-3-Clause: 6
- (MPL-2.0 OR Apache-2.0): 1
- MIT*: 1
- Unlicense: 1
- UNKNOWN: 1

## Notes

- The `UNKNOWN` entry is due to incomplete license metadata in one transitive package (`khroma@2.1.0`) used by Mermaid.
- Before release, keep dependency updates current and rerun license checks to ensure no new incompatible licenses are introduced.
