import type { CoverRequest } from './runActionCore';

// Where runAction hands a NeedsCoverError over: the one mounted cover sheet (components/NeedsCoverGate.tsx).
let handler: ((request: CoverRequest) => void) | null = null;

export function setCoverHandler(next: ((request: CoverRequest) => void) | null): void {
  handler = next;
}

export function requestCover(request: CoverRequest): void {
  if (!handler) throw request.error;
  handler(request);
}
