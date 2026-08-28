/**
 * 主题切换过渡动画（View Transitions API）
 *
 * 效果与 Art Design Pro 等一致，并按目标模式区分方向：
 * - 切到浅色（扩散 expand）：新浅色画面从点击处从小到大圆形扩散盖住全局；
 * - 切到深色（收缩 contract）：旧浅色画面收缩成圆形陷落到点击处，深色从四周合拢。
 *
 * 实现方式：document.startViewTransition 截取旧/新两帧快照。
 * 扩散在 ::view-transition-new(root) 上用 clip-path: circle() 从 0 动画到全屏半径；
 * 收缩需旧快照置顶（html.theme-transition-contract 提升其 z-index），clip-path 反向收缩。
 * 不支持的内核（Linux WebKitGTK 等）或用户开启"减少动态效果"时直接切换，无动画。
 */

interface ThemeTransitionPoint {
  x: number;
  y: number;
}

/** 扩散：新快照从小到大揭示；收缩：旧快照从全屏收缩到点击点 */
export type ThemeTransitionDirection = 'expand' | 'contract';

type ViewTransitionLike = {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => ViewTransitionLike;
};

/** 收缩方向期间挂在 <html> 上的标记类，配合 CSS 把旧快照提到新快照之上 */
const CONTRACT_CLASS = 'theme-transition-contract';

const TRANSITION_DURATION_MS = 500;

/** 全局记录最后一次指针按下位置，作为圆形扩散的圆心（键盘触发时用最近一次点击位置） */
let lastPointerPoint: ThemeTransitionPoint | null = null;
let pointerTrackingBound = false;

const DEFAULT_TRANSITION_POINT: ThemeTransitionPoint = { x: -1, y: -1 };

function bindPointerTracking(): void {
  if (pointerTrackingBound || typeof window === 'undefined') return;
  pointerTrackingBound = true;
  // capture + passive：只读坐标，不影响任何交互
  window.addEventListener('pointerdown', (event) => {
    if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return;
    lastPointerPoint = { x: event.clientX, y: event.clientY };
  }, { capture: true, passive: true });
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getViewTransitionDocument(): ViewTransitionDocument | null {
  if (typeof document === 'undefined') return null;
  const doc = document as ViewTransitionDocument;
  return typeof doc.startViewTransition === 'function' ? doc : null;
}

export function isThemeTransitionSupported(): boolean {
  return getViewTransitionDocument() !== null && !prefersReducedMotion();
}

/** 按目标模式推导方向：切到浅色扩散、切到深色收缩（system 按当前系统偏好解析） */
export function themeTransitionDirectionFor(nextMode: string): ThemeTransitionDirection {
  let resolved = String(nextMode || '');
  if (resolved === 'system' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    resolved = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return resolved === 'light' ? 'expand' : 'contract';
}

function resolveTransitionPoint(origin?: ThemeTransitionPoint | null): ThemeTransitionPoint {
  if (origin && Number.isFinite(origin.x) && Number.isFinite(origin.y)) return origin;
  if (lastPointerPoint) return lastPointerPoint;
  // 无任何指针记录（如快捷键首次触发）：退化为顶栏主题按钮的大致位置
  if (DEFAULT_TRANSITION_POINT.x < 0 && typeof window !== 'undefined') {
    DEFAULT_TRANSITION_POINT.x = Math.max(window.innerWidth - 48, 0);
    DEFAULT_TRANSITION_POINT.y = 40;
  }
  return DEFAULT_TRANSITION_POINT;
}

/** 圆心到屏幕最远角的距离，即覆盖全屏所需的圆半径 */
function computeRevealEndRadius(point: ThemeTransitionPoint): number {
  const farthestX = Math.max(point.x, window.innerWidth - point.x);
  const farthestY = Math.max(point.y, window.innerHeight - point.y);
  return Math.hypot(farthestX, farthestY);
}

function playRevealAnimation(transition: ViewTransitionLike, point: ThemeTransitionPoint, direction: ThemeTransitionDirection): void {
  transition.ready.then(() => {
    const endRadius = computeRevealEndRadius(point);
    const circleAt = `at ${point.x}px ${point.y}px`;
    const isContract = direction === 'contract';
    const animation = document.documentElement.animate(
      {
        clipPath: isContract
          // 旧画面从全屏圆收缩到点击点，四周露出新（深色）画面
          ? [`circle(${endRadius}px ${circleAt})`, `circle(0px ${circleAt})`]
          // 新画面从点击点扩散到全屏
          : [`circle(0px ${circleAt})`, `circle(${endRadius}px ${circleAt})`],
      },
      {
        duration: TRANSITION_DURATION_MS,
        easing: 'ease-in-out',
        pseudoElement: isContract ? '::view-transition-old(root)' : '::view-transition-new(root)',
        // 动画结束时保持末帧：否则裁剪立即失效，置顶的旧浅色快照会整屏弹回一帧（白闪）
        fill: 'forwards',
      },
    );
    // fill: forwards 的残留 effect 会在伪元素拆除后附着到下一次过渡的同名伪元素上，过渡结束时显式取消
    transition.finished.then(() => animation.cancel(), () => animation.cancel());
  }).catch(() => {});
}

/** 收缩方向需要旧快照置顶，动画结束后摘掉标记类 */
function bindContractClass(transition: ViewTransitionLike, direction: ThemeTransitionDirection): void {
  if (direction !== 'contract' || typeof document === 'undefined') return;
  document.documentElement.classList.add(CONTRACT_CLASS);
  transition.finished.then(
    () => document.documentElement.classList.remove(CONTRACT_CLASS),
    () => document.documentElement.classList.remove(CONTRACT_CLASS),
  );
}

/**
 * 同步主题变更的动画包装：applyChange 内完成所有 DOM 变更
 * （body class / CSS 变量 / React 状态需配合 flushSync）
 */
export function runThemeChangeWithTransition(
  applyChange: () => void,
  origin?: ThemeTransitionPoint | null,
  direction: ThemeTransitionDirection = 'expand',
): void {
  const doc = getViewTransitionDocument();
  if (!doc || prefersReducedMotion()) {
    applyChange();
    return;
  }
  bindPointerTracking();
  const point = resolveTransitionPoint(origin);
  try {
    const transition = doc.startViewTransition!(applyChange);
    bindContractClass(transition, direction);
    playRevealAnimation(transition, point, direction);
  } catch (_) {
    applyChange();
  }
}

/**
 * 异步主题变更的动画包装（applyChange 返回 Promise，如设置页保存后端）。
 * 动画快照会等 Promise 完成后落定；结果与异常原样透传给调用方。
 */
export async function runThemeChangeWithTransitionAsync<T>(
  applyChange: () => Promise<T>,
  origin?: ThemeTransitionPoint | null,
  direction: ThemeTransitionDirection = 'expand',
): Promise<T> {
  const doc = getViewTransitionDocument();
  if (!doc || prefersReducedMotion()) {
    return applyChange();
  }
  bindPointerTracking();
  const point = resolveTransitionPoint(origin);
  const outcome: { result?: T; failure?: { error: unknown } } = {};
  try {
    const transition = doc.startViewTransition!(async () => {
      try {
        outcome.result = await applyChange();
      } catch (error) {
        outcome.failure = { error };
      }
    });
    bindContractClass(transition, direction);
    playRevealAnimation(transition, point, direction);
    await transition.updateCallbackDone.catch(() => {});
    await transition.finished.catch(() => {});
  } catch (_) {
    return applyChange();
  }
  if (outcome.failure) {
    throw outcome.failure.error;
  }
  return outcome.result as T;
}

bindPointerTracking();
