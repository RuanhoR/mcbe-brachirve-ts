# brarchive

A TypeScript port of [xKingDark-brachive](https://github.com/xKingDark/xKingDark-brachive): a program that can read/generate Minecraft: Bedrock Edition `.brarchive` files from a directory. Built with [rolldown](https://rolldown.rs).

## Command line options

###### Generate `.brarchive` files
> `brarchive generate <directory>`
###### Extract files (If the input is a directory then it must have a `__brarchive` folder)
> `brarchive extract <directory/file>`

## Library API

```ts
import { readArchive, writeArchive, write, generate, extract, HEADER, VERSION } from 'brarchive';
import type { ArchiveFile, FileEntry } from 'brarchive';

// Read an archive from a path or Buffer. `data` is the pretty-printed JSON text.
const files: FileEntry[] = readArchive('pack/__brarchive/scripts.brarchive');

// Build an archive Buffer from in-memory entries.
const buffer: Buffer = writeArchive([{ name: 'a.json', data: '{"a":1}' }]);

// Archive every sub-directory of `dir` into `dir/__brarchive/*.brarchive`.
const generated: string[] = generate('pack');

// Extract every .brarchive under `input` (or a single file) back to disk.
const extracted: string[] = extract('pack');
```

## Format

See [tryashtar's gist](https://gist.github.com/tryashtar/4e62280c1611d744b6aa5d752ab69c15).

| Field | Size | Description |
| --- | --- | --- |
| Magic | 8 bytes (BE) | Always `0x7d2725b1a0527026` |
| Entry count | 4 bytes (LE) | Number of entries |
| Version | 4 bytes (LE) | Always `1` |
| Entries | 256 bytes each | 1-byte name length + 247-byte padded name + 4-byte offset (LE) + 4-byte length (LE) |
| Data block | variable | Concatenated file contents; offsets are relative to the start of this block |

## Credits

- [xKingDark](https://github.com/xKingDark/xKingDark-brachive)
- [tryashtar](https://gist.github.com/tryashtar/4e62280c1611d744b6aa5d752ab69c15)
