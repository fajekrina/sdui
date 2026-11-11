import { renderNode, type RenderNode } from '../render-node'

/// The `systemName` image source — a small, closed set of 24×24 glyphs drawn in
/// `currentColor`, keyed by the same names murti payloads use (SF Symbols), so one
/// payload renders on both. Apps add their own with `Symbols.register`; an unknown
/// name renders an outlined placeholder.
const glyphs = new Map<string, string>([
  ['star.fill', 'M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01z'],
  ['star', 'M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01zm0 3.9L10.1 9.8l-4.3.6 3.1 3 .7 4.3 3.9-2 3.9 2-.7-4.3 3.1-3-4.3-.6z'],
  ['heart.fill', 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z'],
  ['bolt.fill', 'M13 2L4 14h7l-1 8 9-12h-7z'],
  ['sparkles', 'M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9zM5 15l.7 1.6L7.3 17l-1.6.7L5 19.3l-.7-1.6L2.7 17l1.6-.4z'],
  ['exclamationmark.triangle', 'M1 21h22L12 2zm11-3h-2v-2h2zm0-4h-2v-4h2z'],
  ['plus', 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z'],
  ['checkmark', 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z'],
  ['xmark', 'M18.3 5.71L12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.3 1.41 1.41 6.3-6.3 6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.3z'],
  ['chevron.right', 'M8.6 16.6L13.2 12 8.6 7.4 10 6l6 6-6 6z'],
  ['chevron.left', 'M15.4 16.6L10.8 12l4.6-4.6L14 6l-6 6 6 6z'],
  ['arrow.uturn.backward', 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z'],
  ['arrow.uturn.forward', 'M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7z'],
  ['square.dashed', 'M3 3h4v2H5v2H3zm6 0h6v2H9zm8 0h4v4h-2V5h-2zM3 9h2v6H3zm16 0h2v6h-2zM3 17h2v2h2v2H3zm16 0h2v4h-4v-2h2zM9 19h6v2H9z'],
  ['person.fill', 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'],
  ['house.fill', 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z'],
  ['gearshape.fill', 'M19.14 12.94a7.07 7.07 0 000-1.88l2.03-1.58-1.92-3.32-2.39.96a7.03 7.03 0 00-1.62-.94L14.88 3h-3.84l-.36 2.18c-.58.24-1.12.55-1.62.94l-2.39-.96-1.92 3.32 2.03 1.58a7.07 7.07 0 000 1.88l-2.03 1.58 1.92 3.32 2.39-.96c.5.39 1.04.7 1.62.94l.36 2.18h3.84l.36-2.18c.58-.24 1.12-.55 1.62-.94l2.39.96 1.92-3.32zM12 15.5A3.5 3.5 0 1112 8.5a3.5 3.5 0 010 7z'],
  ['bell.fill', 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 00-3 0v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1z'],
  ['magnifyingglass', 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z'],
  ['info.circle', 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z']
])

const PLACEHOLDER = 'M4 4h16v16H4zm2 2v12h12V6z'

export const Symbols = {
  /// Add or replace a glyph: an SVG path in a 24×24 viewBox.
  register(name: string, path: string): void {
    glyphs.set(name, path)
  },
  has(name: string): boolean {
    return glyphs.has(name)
  },
  get names(): string[] {
    return [...glyphs.keys()].sort()
  },
  /// An inline SVG RenderNode for the symbol, sized to the surrounding text.
  node(key: string, name: string, scale = 1.3): RenderNode {
    return renderNode(key, 'svg', {
      attrs: { viewBox: '0 0 24 24', width: `${scale}em`, height: `${scale}em`, fill: 'currentColor', 'data-symbol': name, 'aria-hidden': 'true' },
      style: { display: 'inline-block', verticalAlign: 'middle' },
      children: [renderNode(`${key}:path`, 'path', { attrs: { d: glyphs.get(name) ?? PLACEHOLDER, 'fill-rule': 'evenodd' } })]
    })
  }
}
