import { sankey, sankeyLeft } from 'd3-sankey';

import type { FlowNode, SpendingFlow } from '@/store/analytics';

// Layout math for the Sankey (d3-sankey does only the geometry; react-native-svg draws it).
// Pure, so it is unit-tested. The picture is mirrored for the right-to-left app: money comes in
// on the right and flows to the left, so every x here is already mirrored.

// `left` / `right` are in the layout's own (unmirrored) coordinates: sources sit at `left` and end up on the
// right after mirroring, so `left` is the room for their labels and `right` the room for the categories'.
export interface SankeyMargins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PlacedNode {
  node: FlowNode;
  // Column: 0 sources, 1 buckets / funds / gold / surplus, 2 categories.
  column: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface PlacedLink {
  source: PlacedNode;
  target: PlacedNode;
  value: number;
  // Thickness of the ribbon.
  width: number;
  // The ribbon's centre line, from the source's edge to the target's edge (SVG path data).
  path: string;
}

export interface SankeyLayout {
  nodes: PlacedNode[];
  links: PlacedLink[];
}

interface D3Node extends FlowNode {
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  depth?: number;
}
interface D3Link {
  source: D3Node | string;
  target: D3Node | string;
  value: number;
  width?: number;
  y0?: number;
  y1?: number;
}

export const NODE_WIDTH = 10;
export const NODE_PADDING = 12;

export function layoutSankey(flow: SpendingFlow, width: number, height: number, margins: SankeyMargins): SankeyLayout {
  const nodes: D3Node[] = flow.nodes.map((n) => ({ ...n }));
  const links: D3Link[] = flow.links.map((l) => ({ source: l.source, target: l.target, value: l.value }));
  const layout = sankey<D3Node, D3Link>()
    .nodeId((n) => n.id)
    .nodeAlign(sankeyLeft)
    .nodeSort(null)
    .nodeWidth(NODE_WIDTH)
    .nodePadding(NODE_PADDING)
    .extent([
      [margins.left, margins.top],
      [width - margins.right, height - margins.bottom],
    ]);
  const graph = layout({ nodes, links });

  const mirror = (x: number) => width - x;
  const placed = new Map<string, PlacedNode>();
  for (const n of graph.nodes) {
    placed.set(n.id, {
      node: flow.nodes.find((f) => f.id === n.id)!,
      column: n.depth ?? 0,
      x0: mirror(n.x1 ?? 0),
      x1: mirror(n.x0 ?? 0),
      y0: n.y0 ?? 0,
      y1: n.y1 ?? 0,
    });
  }
  const placedLinks: PlacedLink[] = (graph.links as unknown as (D3Link & { source: D3Node; target: D3Node })[]).map((l) => {
    const source = placed.get(l.source.id)!;
    const target = placed.get(l.target.id)!;
    // Money leaves the source's left edge and enters the target's right edge.
    const sx = source.x0;
    const tx = target.x1;
    const mid = (sx + tx) / 2;
    return {
      source,
      target,
      value: l.value,
      width: Math.max(1, l.width ?? 1),
      path: `M${sx},${l.y0} C${mid},${l.y0} ${mid},${l.y1} ${tx},${l.y1}`,
    };
  });
  return { nodes: [...placed.values()], links: placedLinks };
}
