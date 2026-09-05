export {};

const POSITION_KEY = 'quimstock-cloud-widget-position-v1';
const DRAG_THRESHOLD = 6;
const EDGE_GAP = 10;

type SavedPosition = { x: number; y: number };
type DragState = {
  element: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  moved: boolean;
};

let dragState: DragState | null = null;
let suppressClickUntil = 0;
let collapseTimer: number | null = null;

function loadPosition(): SavedPosition | null {
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedPosition>;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: Number(parsed.x), y: Number(parsed.y) };
  } catch {
    return null;
  }
}

function savePosition(position: SavedPosition): void {
  window.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
}

function clampPosition(position: SavedPosition, width: number, height: number): SavedPosition {
  const maxX = Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP);
  const maxY = Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP);
  return {
    x: Math.min(Math.max(EDGE_GAP, position.x), maxX),
    y: Math.min(Math.max(EDGE_GAP, position.y), maxY),
  };
}

function applyPosition(element: HTMLElement, position: SavedPosition): SavedPosition {
  const rect = element.getBoundingClientRect();
  const clamped = clampPosition(position, rect.width || 50, rect.height || 50);
  element.style.left = `${clamped.x}px`;
  element.style.top = `${clamped.y}px`;
  element.style.right = 'auto';
  element.style.bottom = 'auto';
  return clamped;
}

function currentWidget(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.cloud-session-chip, .cloud-session-compact');
}

function hydrateWidgetPosition(): void {
  const widget = currentWidget();
  if (!widget) return;
  widget.dataset.draggable = 'true';
  const saved = loadPosition();
  if (saved) applyPosition(widget, saved);
}

function scheduleSyncedCollapse(): void {
  if (collapseTimer !== null) window.clearTimeout(collapseTimer);
  collapseTimer = null;

  const chip = document.querySelector<HTMLElement>('.cloud-session-chip.synced');
  const collapseButton = chip?.querySelector<HTMLButtonElement>('.cloud-session-collapse');
  if (!chip || !collapseButton) return;

  collapseTimer = window.setTimeout(() => {
    if (document.contains(collapseButton)) collapseButton.click();
    collapseTimer = null;
  }, 1200);
}

function refreshWidget(): void {
  window.requestAnimationFrame(() => {
    hydrateWidgetPosition();
    scheduleSyncedCollapse();
  });
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 && event.pointerType === 'mouse') return;
  const target = event.target instanceof Element ? event.target : null;
  const element = target?.closest<HTMLElement>('.cloud-session-chip, .cloud-session-compact');
  if (!element) return;

  if (element.classList.contains('cloud-session-chip') && target?.closest('button')) return;

  const rect = element.getBoundingClientRect();
  dragState = {
    element,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: rect.left,
    originY: rect.top,
    width: rect.width,
    height: rect.height,
    moved: false,
  };
  element.classList.add('cloud-session-dragging');
}

function onPointerMove(event: PointerEvent): void {
  const state = dragState;
  if (!state || state.pointerId !== event.pointerId) return;

  const dx = event.clientX - state.startX;
  const dy = event.clientY - state.startY;
  if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

  state.moved = true;
  event.preventDefault();
  const position = clampPosition(
    { x: state.originX + dx, y: state.originY + dy },
    state.width,
    state.height,
  );
  applyPosition(state.element, position);
}

function finishDrag(event: PointerEvent): void {
  const state = dragState;
  if (!state || state.pointerId !== event.pointerId) return;

  state.element.classList.remove('cloud-session-dragging');
  if (state.moved) {
    const rect = state.element.getBoundingClientRect();
    savePosition({ x: rect.left, y: rect.top });
    suppressClickUntil = Date.now() + 350;
  }
  dragState = null;
}

function suppressClickAfterDrag(event: MouseEvent): void {
  if (Date.now() > suppressClickUntil) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest('.cloud-session-chip, .cloud-session-compact')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function keepWidgetInsideViewport(): void {
  const widget = currentWidget();
  const saved = loadPosition();
  if (!widget || !saved) return;
  savePosition(applyPosition(widget, saved));
}

document.addEventListener('pointerdown', onPointerDown, { passive: true });
document.addEventListener('pointermove', onPointerMove, { passive: false });
document.addEventListener('pointerup', finishDrag, { passive: true });
document.addEventListener('pointercancel', finishDrag, { passive: true });
document.addEventListener('click', suppressClickAfterDrag, true);
window.addEventListener('resize', keepWidgetInsideViewport);

const observer = new MutationObserver(refreshWidget);
observer.observe(document.documentElement, { childList: true, subtree: true });
refreshWidget();
