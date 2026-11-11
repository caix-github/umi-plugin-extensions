import { BookMark } from './library';

type PositionedBookMark = BookMark & { start: number; end: number };

export function applyTextMarks(
  root: HTMLElement,
  marks: BookMark[],
  page?: number,
): void {
  root
    .querySelectorAll<HTMLElement>('[data-reader-mark]')
    .forEach((wrapper) => {
      wrapper.replaceWith(...Array.from(wrapper.childNodes));
    });
  root.normalize();

  const textNodes: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.textContent) textNodes.push(node as Text);
  }

  let documentOffset = 0;
  textNodes.forEach((textNode) => {
    const textLength = textNode.data.length;
    const nodeStart = documentOffset;
    const nodeEnd = nodeStart + textLength;
    documentOffset = nodeEnd;
    const overlappingMarks = marks.filter(
      (mark): mark is PositionedBookMark =>
        (page === undefined ? mark.page === undefined : mark.page === page) &&
        typeof mark.start === 'number' &&
        typeof mark.end === 'number' &&
        mark.start < nodeEnd &&
        mark.end > nodeStart,
    );
    if (!overlappingMarks.length) return;

    const boundaries = new Set<number>([0, textLength]);
    overlappingMarks.forEach((mark) => {
      boundaries.add(Math.max(0, mark.start - nodeStart));
      boundaries.add(Math.min(textLength, mark.end - nodeStart));
    });
    const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);
    const segments: { node: Text; start: number; end: number }[] = [];
    let remaining = textNode;
    let previousBoundary = 0;
    sortedBoundaries.slice(1, -1).forEach((boundary) => {
      const next = remaining.splitText(boundary - previousBoundary);
      segments.push({
        node: remaining,
        start: previousBoundary,
        end: boundary,
      });
      remaining = next;
      previousBoundary = boundary;
    });
    segments.push({
      node: remaining,
      start: previousBoundary,
      end: textLength,
    });

    segments.forEach((segment) => {
      const segmentStart = nodeStart + segment.start;
      const segmentEnd = nodeStart + segment.end;
      const segmentMarks = overlappingMarks.filter(
        (mark) => mark.start < segmentEnd && mark.end > segmentStart,
      );
      if (!segmentMarks.length || !segment.node.parentNode) return;

      const wrapper = root.ownerDocument.createElement('span');
      wrapper.dataset.readerMark = 'true';
      wrapper.title = segmentMarks.map((mark) => mark.text).join(' · ');
      const highlight = segmentMarks
        .filter((mark) => mark.style === 'highlight')
        .pop();
      const underline = segmentMarks
        .filter((mark) => mark.style !== 'highlight')
        .pop();
      if (highlight) {
        wrapper.style.backgroundColor = `color-mix(in srgb, ${highlight.color} 48%, transparent)`;
        wrapper.style.borderRadius = '2px';
      }
      if (underline) {
        wrapper.style.textDecorationLine = 'underline';
        wrapper.style.textDecorationColor = underline.color;
        wrapper.style.textDecorationThickness = '2px';
        wrapper.style.textDecorationStyle =
          underline.style === 'wavy' ? 'wavy' : 'solid';
      }
      segment.node.parentNode.replaceChild(wrapper, segment.node);
      wrapper.appendChild(segment.node);
    });
  });
}
