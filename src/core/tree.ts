/**
 * Fajrina SDUI — Universal Tree Helper
 * Port of universal-renderer.html buildTree (parentId+order)
 * Supports both children[] and flat parentId/order normalization.
 */

import type { UniversalComponent, UniversalLayout } from './types'

export interface TreeNode extends UniversalComponent {
  children: TreeNode[]
}

export function buildTree(components: UniversalComponent[]): TreeNode[] {
  if (!components || components.length === 0) return []
  const map = new Map<string, TreeNode>()
  components.forEach((c) => map.set(c.id, { ...c, children: (c.children as TreeNode[] | undefined)?.map((ch) => ({ ...ch, children: (ch.children as TreeNode[] | undefined) || [] })) || [] }))

  // If any component uses children already, preserve tree and just sort
  const hasChildren = components.some((c) => Array.isArray(c.children) && (c.children as unknown[]).length > 0)
  if (hasChildren) {
    // Recursively sort children
    function sortNode(n: TreeNode) {
      n.children.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      n.children.forEach(sortNode)
    }
    // Roots are those without parentId or parentId not in map
    const roots: TreeNode[] = []
    const sorted = [...components].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    sorted.forEach((c) => {
      const node = map.get(c.id)!
      // ensure children recursively built from original children — preserve nested children
      if (c.children && Array.isArray(c.children)) {
        node.children = (c.children as UniversalComponent[]).map((ch) => {
          const existing = map.get((ch as UniversalComponent).id)
          if (existing) return existing
          const src = ch as UniversalComponent
          const copy = { ...src } as TreeNode
          // preserve nested children if any (e.g., card with 4 leaves)
          if (Array.isArray(src.children) && src.children.length > 0) {
            copy.children = (src.children as UniversalComponent[]).map((c2) => ({ ...(c2 as UniversalComponent), children: [] } as TreeNode))
          } else if (!Array.isArray(copy.children)) {
            copy.children = []
          }
          return copy
        })
      }
      if (c.parentId && map.has(c.parentId)) {
        map.get(c.parentId)!.children.push(node)
      } else {
        // avoid duplicate push if already counted as child
        if (!roots.includes(node)) roots.push(node)
      }
    })
    // For children-based tree, roots are simply top-level components (deduped)
    // Fallback: if roots empty but hasChildren, treat components as roots
    const deduped = Array.from(new Map(roots.map((r) => [r.id, r])).values())
    deduped.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    deduped.forEach(sortNode)
    // If tree was purely children-based (no parentId linking), just return sorted top-level as TreeNodes
    if (deduped.length === 0) {
      return components.map((c) => ({ ...c, children: ((c.children as UniversalComponent[] | undefined) || []).map((ch) => ({ ...(ch as UniversalComponent), children: [] } as TreeNode)) } as TreeNode))
    }
    return deduped
  }

  // Flat parentId/order tree
  const roots: TreeNode[] = []
  const sorted = [...components].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  sorted.forEach((c) => {
    const node = map.get(c.id)!
    if (c.parentId && map.has(c.parentId)) {
      map.get(c.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })
  function sortN(n: TreeNode) {
    n.children.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    n.children.forEach(sortN)
  }
  roots.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  roots.forEach(sortN)
  return roots
}

export function flattenLayout(layout: UniversalLayout | null | undefined): UniversalComponent[] {
  if (!layout) return []
  return layout.components || []
}

export function normalizeLayoutToTree(layout: UniversalLayout | null | undefined): TreeNode[] {
  if (!layout) return []
  const comps = flattenLayout(layout)
  return buildTree(comps)
}
