// Built-in snippets that exercise a wide range of highlight scopes.

export interface Sample {
  name: string;
  text: string;
}

export const SAMPLES: Sample[] = [
  {
    name: 'main.rs',
    text: `//! Example crate showing off a theme.
use std::collections::HashMap;
use std::fmt::{self, Display};

/// A point in 2D space.
#[derive(Debug, Clone, PartialEq)]
pub struct Point<'a, T: Copy> {
    pub x: T,
    pub y: T,
    label: &'a str,
}

#[derive(Debug)]
enum Shape {
    Circle { radius: f64 },
    Rect(f64, f64),
    Empty,
}

impl Display for Shape {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Shape::Circle { radius } => write!(f, "circle r={radius:.2}"),
            Shape::Rect(w, h) if w == h => write!(f, "square {w}"),
            Shape::Rect(w, h) => write!(f, "rect {w}x{h}"),
            Shape::Empty => f.write_str("nothing\\n"),
        }
    }
}

const MAX_ITEMS: usize = 0x2A;
static GREETING: &str = "hello, world";

/* Block comment: computes the total area. */
fn total_area(shapes: &[Shape]) -> f64 {
    let mut sum = 0.0_f64;
    for shape in shapes.iter() {
        sum += match *shape {
            Shape::Circle { radius } => std::f64::consts::PI * radius * radius,
            Shape::Rect(w, h) => w * h,
            Shape::Empty => continue,
        };
    }
    sum
}

async fn fetch(id: u32) -> Result<String, Box<dyn std::error::Error>> {
    let _unused = 'c';
    let mut cache: HashMap<u32, String> = HashMap::new();
    if let Some(hit) = cache.get(&id) {
        return Ok(hit.clone());
    }
    let value = format!("{GREETING} #{id}");
    cache.insert(id, value.clone());
    Ok(value)
}

fn main() {
    let shapes = vec![Shape::Circle { radius: 1.5 }, Shape::Rect(2.0, 3.0), Shape::Empty];
    let p = Point { x: 1, y: -2, label: "origin" };
    println!("{:?} {} {}", p, total_area(&shapes), MAX_ITEMS);
    assert!(p.x > 0 && !shapes.is_empty(), "unexpected");
}
`,
  },
  {
    name: 'app.ts',
    text: `import { readFile } from 'node:fs/promises';
import type { Config } from './config';

// Supported log levels
export enum Level {
  Debug = 0,
  Info,
  Warn = 'warn',
}

interface User {
  readonly id: number;
  name: string;
  email?: string;
  tags: Array<string>;
}

/**
 * Loads users from disk.
 * @param path - location of the JSON file
 */
export async function loadUsers(path: string, limit = 10): Promise<User[]> {
  const raw = await readFile(path, 'utf8');
  const users = JSON.parse(raw) as User[];
  return users.filter((u) => u.tags.includes('active')).slice(0, limit);
}

class Cache<K, V> extends Map<K, V> {
  #hits = 0;
  static readonly MAX = 1_000;

  constructor(private readonly ttl: number) {
    super();
  }

  get(key: K): V | undefined {
    this.#hits++;
    return super.get(key) ?? undefined;
  }
}

const pattern = /^[a-z]+@example\\.com$/i;
const greeting = \`Hello, \${'world'.toUpperCase()}!\`;
let enabled: boolean = true && !false;

for (const [i, level] of Object.entries(Level)) {
  if (typeof level === 'number') continue;
  console.log(i, level, pattern.test(greeting), enabled, null, undefined);
}

try {
  await loadUsers('./users.json');
} catch (err: unknown) {
  throw new Error(\`failed: \${String(err)}\`);
}
`,
  },
  {
    name: 'script.py',
    text: `#!/usr/bin/env python3
"""Module docstring: a small inventory tool."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterator

PRICE_RE = re.compile(r"^\\$(\\d+)\\.(\\d{2})$")


@dataclass(frozen=True)
class Item:
    name: str
    price: float = 0.0
    tags: list[str] = field(default_factory=list)

    def __str__(self) -> str:
        return f"{self.name} (\${self.price:.2f})"


class Inventory:
    """Holds items."""

    def __init__(self, *items: Item, **options) -> None:
        self._items = list(items)
        self.strict = options.get("strict", False)

    def __iter__(self) -> Iterator[Item]:
        yield from self._items

    @property
    def total(self) -> float:
        return sum(i.price for i in self._items if i.price > 0)


def parse(text: str) -> float | None:
    if (m := PRICE_RE.match(text)) is not None:
        return int(m[1]) + int(m[2]) / 100
    return None


async def main() -> None:
    inv = Inventory(Item("apple", 0.5), Item("pear", tags=["fruit"]))
    for item in inv:
        print(item, parse("$1.25"), True, None)
    try:
        assert inv.total > 0, "empty!"
    except AssertionError as exc:
        raise SystemExit(1) from exc
    finally:
        pass


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
`,
  },
  {
    name: 'README.md',
    text: `# Project Title

A short description with **bold**, *italic*, ~~struck~~ and \`inline code\`.

## Installation

1. Clone the repository
2. Run the installer
   - nested item
   - [x] done task
   - [ ] open task

> Quoted text lives here.
> Across two lines.

### Links

See [the docs](https://docs.helix-editor.com/themes.html) or [a reference][ref].

![logo](./logo.png)

[ref]: https://helix-editor.com

\`\`\`rust
fn main() {
    println!("injected {}", 42);
}
\`\`\`

---

| Column | Value |
| ------ | ----- |
| a      | 1     |
`,
  },
  {
    name: 'index.html',
    text: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Theme preview</title>
    <!-- A comment -->
    <style>
      body { color: #333; margin: 0 auto; }
      .card:hover > a[href^="https"] { text-decoration: underline; }
    </style>
  </head>
  <body class="dark" data-id="42">
    <h1 id="title">Hello &amp; welcome</h1>
    <button type="button" onclick="greet()" disabled>Click</button>
    <script>
      function greet(name = 'you') {
        const el = document.querySelector('#title');
        el.textContent = \`Hi \${name}\`;
      }
    </script>
  </body>
</html>
`,
  },
  {
    name: 'config.toml',
    text: `# Helix config
theme = "my-theme"

[editor]
line-number = "relative"
cursorline = true
rulers = [80, 120]
scrolloff = 5
idle-timeout = 250.5
true-color = true
bufferline = "multiple"

[editor.cursor-shape]
insert = "bar"
normal = "block"

[editor.whitespace.render]
space = "all"
tab = "all"

[[editor.statusline.left]]
name = 'mode'

[keys.normal]
C-s = ":w"
space.w = { h = "jump_view_left" }
date = 2024-06-01T10:00:00Z
`,
  },
];
