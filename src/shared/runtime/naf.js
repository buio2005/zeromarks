// @ts-check

import { translateStaticDom } from "../i18n/i18n.js";

/**
 * Hybrid local runtime for the app frontend.
 *
 * This file contains both:
 * - the original reactive/DOM helpers from the earlier `naf-html.js` split
 * - the newer template/component helpers introduced for module-local markup
 */

/**
 * @template T
 * @typedef {(() => T) & ((value: T) => T)} Signal
 */

/**
 * @template T
 * @typedef {() => T} Computed
 */

/** @typedef {Set<() => void>} Subs */

/**
 * @typedef {"signal" | "computed" | "effect"} ReactiveKind
 */

/**
 * @typedef {"signal:get" | "signal:set" | "signal:set-same" | "signal:notify" | "computed:get" | "computed:recompute" | "computed:dirty" | "computed:notify" | "effect:run" | "effect:dispose" | "dependency:track"} ReactiveDebugEventType
 */

/**
 * @typedef {object} ReactiveDebugOptions
 * @property {string} [label]
 * @property {boolean} [debug]
 */

/**
 * @typedef {object} ReactiveDebugConfig
 * @property {boolean} enabled
 * @property {ReactiveDebugEventType[]} [events]
 * @property {string[]} [include]
 * @property {string[]} [exclude]
 * @property {(event: ReactiveDebugEvent) => void} [sink]
 * @property {(value: unknown) => unknown} [valueFormatter]
 */

/**
 * @typedef {object} ReactiveDebugMeta
 * @property {number} id
 * @property {ReactiveKind} kind
 * @property {string} label
 * @property {boolean} debug
 */

/**
 * @typedef {object} ReactiveDebugEvent
 * @property {number} seq
 * @property {ReactiveDebugEventType} type
 * @property {number} id
 * @property {ReactiveKind} kind
 * @property {string} label
 * @property {number} timestamp
 * @property {number} [subscriberCount]
 * @property {unknown} [value]
 * @property {unknown} [previousValue]
 * @property {string} [observer]
 * @property {string} [observerKind]
 * @property {string} [source]
 * @property {string} [sourceKind]
 * @property {number} [dependencyCount]
 * @property {string} [message]
 * @property {Record<string, unknown>} [details]
 */

/** @type {(() => void) | undefined} */
let activeSub;

/** @type {Subs[] | undefined} */
let activeSets;

/** @type {ReactiveDebugMeta | undefined} */
let activeObserver;

let nextReactiveId = 1;
let nextReactiveDebugSeq = 1;

/** @type {ReactiveDebugConfig} */
const reactiveDebugConfig = {
  enabled: false,
  sink(event) {
    console.debug(`[naf:${event.type}] ${event.label}`, event);
  },
};

/**
 * @param {ReactiveKind} kind
 * @param {ReactiveDebugOptions | undefined} options
 * @returns {ReactiveDebugMeta}
 */
function createReactiveMeta(kind, options) {
  const id = nextReactiveId;
  nextReactiveId += 1;
  return {
    id,
    kind,
    label: options?.label?.trim() || `${kind}#${id}`,
    debug: options?.debug === true,
  };
}

/**
 * @param {string} label
 * @param {string[] | undefined} prefixes
 * @returns {boolean}
 */
function matchesDebugPrefixes(label, prefixes) {
  if (!Array.isArray(prefixes) || prefixes.length === 0) {
    return true;
  }
  return prefixes.some((prefix) => label.startsWith(prefix));
}

/**
 * @param {ReactiveDebugMeta} meta
 * @param {ReactiveDebugEventType} type
 * @returns {boolean}
 */
function shouldEmitReactiveDebug(meta, type) {
  if (meta.debug && !reactiveDebugConfig.enabled) {
    return true;
  }

  if (!reactiveDebugConfig.enabled) {
    return false;
  }

  if (Array.isArray(reactiveDebugConfig.events) && reactiveDebugConfig.events.length > 0) {
    if (!reactiveDebugConfig.events.includes(type)) {
      return false;
    }
  }

  if (!matchesDebugPrefixes(meta.label, reactiveDebugConfig.include)) {
    return false;
  }

  if (
    Array.isArray(reactiveDebugConfig.exclude) &&
    reactiveDebugConfig.exclude.some((prefix) => meta.label.startsWith(prefix))
  ) {
    return false;
  }

  return true;
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function formatReactiveDebugValue(value) {
  if (reactiveDebugConfig.valueFormatter) {
    try {
      return reactiveDebugConfig.valueFormatter(value);
    } catch {
      return "[valueFormatter threw]";
    }
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value;
  }

  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }

  if (Array.isArray(value)) {
    return `[Array(${value.length})]`;
  }

  if (value instanceof Map) {
    return `[Map(${value.size})]`;
  }

  if (value instanceof Set) {
    return `[Set(${value.size})]`;
  }

  if (typeof Element !== "undefined" && value instanceof Element) {
    const id = value.id ? `#${value.id}` : "";
    return `<${value.tagName.toLowerCase()}${id}>`;
  }

  if (typeof value === "object") {
    const ctorName = value.constructor?.name;
    if (ctorName && ctorName !== "Object") {
      return `[${ctorName}]`;
    }
    const keys = Object.keys(/** @type {Record<string, unknown>} */ (value));
    return `{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", ..." : ""}}`;
  }

  return String(value);
}

/**
 * @param {ReactiveDebugMeta | undefined} meta
 * @param {ReactiveDebugEventType} type
 * @param {Partial<ReactiveDebugEvent>} [extra]
 * @returns {void}
 */
function emitReactiveDebug(meta, type, extra = {}) {
  if (!meta || !shouldEmitReactiveDebug(meta, type)) {
    return;
  }

  const event = /** @type {ReactiveDebugEvent} */ ({
    seq: nextReactiveDebugSeq,
    type,
    id: meta.id,
    kind: meta.kind,
    label: meta.label,
    timestamp: Date.now(),
    ...extra,
  });
  nextReactiveDebugSeq += 1;

  try {
    reactiveDebugConfig.sink?.(event);
  } catch {
    // Debug logging must never affect runtime behavior.
  }
}

/**
 * @param {boolean | Partial<ReactiveDebugConfig>} nextConfig
 * @returns {ReactiveDebugConfig}
 */
export function setReactiveDebug(nextConfig) {
  if (typeof nextConfig === "boolean") {
    reactiveDebugConfig.enabled = nextConfig;
    return getReactiveDebugConfig();
  }

  reactiveDebugConfig.enabled = nextConfig.enabled ?? reactiveDebugConfig.enabled;
  reactiveDebugConfig.events = nextConfig.events ? [...nextConfig.events] : undefined;
  reactiveDebugConfig.include = nextConfig.include ? [...nextConfig.include] : undefined;
  reactiveDebugConfig.exclude = nextConfig.exclude ? [...nextConfig.exclude] : undefined;
  reactiveDebugConfig.sink = nextConfig.sink ?? reactiveDebugConfig.sink;
  reactiveDebugConfig.valueFormatter =
    nextConfig.valueFormatter ?? reactiveDebugConfig.valueFormatter;
  return getReactiveDebugConfig();
}

/**
 * @returns {ReactiveDebugConfig}
 */
export function getReactiveDebugConfig() {
  return {
    enabled: reactiveDebugConfig.enabled,
    events: reactiveDebugConfig.events ? [...reactiveDebugConfig.events] : undefined,
    include: reactiveDebugConfig.include ? [...reactiveDebugConfig.include] : undefined,
    exclude: reactiveDebugConfig.exclude ? [...reactiveDebugConfig.exclude] : undefined,
    sink: reactiveDebugConfig.sink,
    valueFormatter: reactiveDebugConfig.valueFormatter,
  };
}

/**
 * @param {Subs} subs
 * @param {ReactiveDebugMeta | undefined} sourceMeta
 * @returns {void}
 */
function track(subs, sourceMeta) {
  if (activeSub) {
    const alreadyTracked = subs.has(activeSub);
    subs.add(activeSub);
    activeSets?.push(subs);
    if (!alreadyTracked && sourceMeta && activeObserver) {
      emitReactiveDebug(sourceMeta, "dependency:track", {
        observer: activeObserver.label,
        observerKind: activeObserver.kind,
        source: sourceMeta.label,
        sourceKind: sourceMeta.kind,
      });
    }
  }
}

/**
 * @param {Subs} subs
 * @param {ReactiveDebugMeta | undefined} sourceMeta
 * @returns {void}
 */
function notify(subs, sourceMeta) {
  emitReactiveDebug(
    sourceMeta,
    sourceMeta?.kind === "computed" ? "computed:notify" : "signal:notify",
    { subscriberCount: subs.size },
  );
  [...subs].forEach((fn) => fn());
}

/**
 * Creates a reactive signal that holds a value.
 *
 * @template T
 * @param {T} initialValue
 * @param {ReactiveDebugOptions} [options]
 * @returns {Signal<T>}
 */
export function signal(initialValue, options) {
  let value = initialValue;
  /** @type {Subs} */
  const subs = new Set();
  const meta = createReactiveMeta("signal", options);

  /** @type {Signal<T>} */
  const sig = /** @type {Signal<T>} */ (function (newValue) {
    if (arguments.length > 0) {
      if (value !== newValue) {
        const previousValue = value;
        value = /** @type {T} */ (newValue);
        emitReactiveDebug(meta, "signal:set", {
          previousValue: formatReactiveDebugValue(previousValue),
          value: formatReactiveDebugValue(newValue),
          subscriberCount: subs.size,
        });
        notify(subs, meta);
      } else {
        emitReactiveDebug(meta, "signal:set-same", {
          value: formatReactiveDebugValue(newValue),
          subscriberCount: subs.size,
        });
      }
      return /** @type {T} */ (newValue);
    }

    emitReactiveDebug(meta, "signal:get", {
      value: formatReactiveDebugValue(value),
      observer: activeObserver?.label,
      observerKind: activeObserver?.kind,
    });
    track(subs, meta);
    return value;
  });

  return sig;
}

/**
 * Creates a lazily recomputed derived value.
 *
 * @template T
 * @param {() => T} fn
 * @param {ReactiveDebugOptions} [options]
 * @returns {Computed<T>}
 */
export function computed(fn, options) {
  /** @type {T} */
  let value;
  let dirty = true;
  /** @type {Subs} */
  const subs = new Set();
  /** @type {Subs[]} */
  const subscribedTo = [];
  const meta = createReactiveMeta("computed", options);

  const markDirty = () => {
    dirty = true;
    emitReactiveDebug(meta, "computed:dirty", {
      subscriberCount: subs.size,
    });
    notify(subs, meta);
  };

  return () => {
    emitReactiveDebug(meta, "computed:get", {
      observer: activeObserver?.label,
      observerKind: activeObserver?.kind,
    });
    track(subs, meta);
    if (dirty) {
      const prevSub = activeSub;
      const prevSets = activeSets;
      const prevObserver = activeObserver;
      subscribedTo.forEach((set) => set.delete(markDirty));
      subscribedTo.length = 0;
      activeSub = markDirty;
      activeSets = subscribedTo;
      activeObserver = meta;
      try {
        value = fn();
        dirty = false;
        emitReactiveDebug(meta, "computed:recompute", {
          value: formatReactiveDebugValue(value),
          dependencyCount: subscribedTo.length,
        });
      } finally {
        activeSub = prevSub;
        activeSets = prevSets;
        activeObserver = prevObserver;
      }
    }
    return value;
  };
}

/**
 * Runs a reactive effect immediately and whenever dependencies change.
 *
 * @param {() => void} fn
 * @param {ReactiveDebugOptions} [options]
 * @returns {() => void}
 */
export function effect(fn, options) {
  let running = false;
  let disposed = false;
  /** @type {Subs[]} */
  const subscribedTo = [];
  const meta = createReactiveMeta("effect", options);

  const run = () => {
    if (running || disposed) {
      return;
    }
    running = true;

    subscribedTo.forEach((set) => set.delete(run));
    subscribedTo.length = 0;

    const prevSub = activeSub;
    const prevSets = activeSets;
    const prevObserver = activeObserver;
    activeSub = run;
    activeSets = subscribedTo;
    activeObserver = meta;
    try {
      emitReactiveDebug(meta, "effect:run", {
        dependencyCount: subscribedTo.length,
      });
      fn();
    } finally {
      activeSub = prevSub;
      activeSets = prevSets;
      activeObserver = prevObserver;
      running = false;
    }
  };

  run();

  return () => {
    disposed = true;
    emitReactiveDebug(meta, "effect:dispose", {
      dependencyCount: subscribedTo.length,
    });
    subscribedTo.forEach((set) => set.delete(run));
    subscribedTo.length = 0;
  };
}

/**
 * Run a callback without collecting reactive dependencies into the current observer.
 *
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function untrack(fn) {
  const prevSub = activeSub;
  const prevSets = activeSets;
  const prevObserver = activeObserver;
  activeSub = undefined;
  activeSets = undefined;
  activeObserver = undefined;
  try {
    return fn();
  } finally {
    activeSub = prevSub;
    activeSets = prevSets;
    activeObserver = prevObserver;
  }
}

/**
 * Escapes HTML for safe text insertion.
 *
 * @param {string} s
 * @returns {string}
 */
export function text(s) {
  return s.replace(/[&<>"']/g, (c) => {
    return (
      {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c] || c
    );
  });
}

/**
 * Query a single element.
 *
 * @template {Element} [T=Element]
 * @param {string} selector
 * @param {Element | Document} [root=document]
 * @returns {T | null}
 */
export function $(selector, root = document) {
  return /** @type {T | null} */ (root.querySelector(selector));
}

/**
 * Query multiple elements as an array.
 *
 * @template {Element} [T=Element]
 * @param {string} selector
 * @param {Element | Document} [root=document]
 * @returns {T[]}
 */
export function $$(selector, root = document) {
  return /** @type {T[]} */ (Array.from(root.querySelectorAll(selector)));
}

/**
 * Attach an event listener and return a cleanup function.
 *
 * Designed to be used with `cleanupCollector()` so that listeners
 * are automatically removed on unmount without manual pairing.
 *
 * Example:
 *   cleanup.add(listener(btn, "click", handleClick));
 *
 * @template {EventTarget} [T=EventTarget]
 * @param {T | null | undefined} el
 * @param {string} event
 * @param {(...args: any[]) => void} handler
 * @returns {() => void}
 */
export function listener(el, event, handler) {
  el?.addEventListener(event, handler);
  return () => el?.removeEventListener(event, handler);
}

/**
 * Bind a reactive effect to an element.
 *
 * @template {Element} T
 * @param {T | null | undefined} el
 * @param {(el: T) => void} fn
 * @returns {() => void}
 */
export function fx(el, fn) {
  if (!el) {
    return () => {};
  }
  return effect(() => fn(el));
}

/**
 * Show element when condition signal is truthy.
 *
 * Reactive -- re-evaluates when condition changes.
 * Null-safe -- returns no-op cleanup when element is missing.
 *
 * @param {HTMLElement | null | undefined} el
 * @param {() => any} condition
 * @returns {() => void}
 */
export function show(el, condition) {
  if (!el) {
    return () => {};
  }
  return effect(() => { el.hidden = !condition(); });
}

/**
 * Hide element when condition signal is truthy.
 *
 * Reactive -- re-evaluates when condition changes.
 * Null-safe -- returns no-op cleanup when element is missing.
 *
 * @param {HTMLElement | null | undefined} el
 * @param {() => any} condition
 * @returns {() => void}
 */
export function hide(el, condition) {
  if (!el) {
    return () => {};
  }
  return effect(() => { el.hidden = condition(); });
}

/**
 * Two-way bind a form control to a signal.
 *
 * @template {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} T
 * @template V
 * @param {T | null} el
 * @param {Signal<V>} sig
 * @param {{ reactive?: boolean }=} options
 * @returns {{ el: T | null, cleanup: () => void }}
 */
export function model(el, sig, options) {
  if (!el) {
    return { el: null, cleanup: () => {} };
  }

  const isCheckbox = el instanceof HTMLInputElement && el.type === "checkbox";
  const eventName = isCheckbox ? "change" : "input";

  if (isCheckbox) {
    el.checked = /** @type {boolean} */ (sig());
  } else {
    el.value = /** @type {string} */ (sig());
  }

  const handleInput = () => {
    if (isCheckbox) {
      sig(/** @type {V} */ (/** @type {unknown} */ (el.checked)));
    } else {
      sig(/** @type {V} */ (/** @type {unknown} */ (el.value)));
    }
  };

  el.addEventListener(eventName, handleInput);

  let stop = () => {};

  if (options?.reactive) {
    stop = effect(() => {
      const value = sig();
      if (isCheckbox) {
        el.checked = /** @type {boolean} */ (value);
      } else if (el.value !== value) {
        el.value = /** @type {string} */ (value);
      }
    });
  }

  return {
    el,
    cleanup() {
      stop();
      el.removeEventListener(eventName, handleInput);
    },
  };
}

/**
 * Create an HTMLTemplateElement from a raw HTML string.
 *
 * @param {string} html
 * @returns {HTMLTemplateElement}
 */
function createTemplateFromString(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  translateStaticDom(template.content);
  return template;
}

/**
 * Virtual scrolling options for list().
 * @typedef {object} VirtualOptions
 * @property {number} rowHeight - Fixed pixel height per row.
 */

/**
 * List render options.
 * @typedef {object} ListOptions
 * @property {VirtualOptions} [virtual] - Enable virtual scrolling.
 */

/**
 * Render a keyed list from a template element or HTML string.
 * Supports virtual scrolling via the optional `options` parameter.
 *
 * @template T
 * @param {Element | null} container
 * @param {HTMLTemplateElement | string | null} templateEl
 * @param {() => T[]} items
 * @param {(item: T) => string | number} key
 * @param {(el: Element, item: () => T, index: () => number) => void | (() => void)} setup
 * @param {ListOptions} [options]
 * @returns {() => void}
 */
export function list(container, templateEl, items, key, setup, options) {
  if (!container || !templateEl) {
    return () => {};
  }

  /** @type {HTMLTemplateElement} */
  const tpl = typeof templateEl === "string"
    ? createTemplateFromString(templateEl)
    : templateEl;

  /** @type {VirtualOptions | undefined} */
  const virtualOpts = options?.virtual;
  const isVirtual = !!virtualOpts;
  const rowHeight = isVirtual ? virtualOpts.rowHeight : 0;

  // --- Virtual scrolling mode ---
  if (isVirtual && rowHeight > 0) {
    return listVirtual(/** @type {HTMLElement} */ (container), tpl, items, key, setup, rowHeight);
  }

  // --- Standard (full render) mode ---
  /** @type {Map<string | number, { el: Element, item: Signal<T>, index: Signal<number>, cleanup?: () => void }>} */
  const entries = new Map();

  const stopEffect = effect(() => {
    const arr = items();
    const newKeys = new Set(arr.map(key));

    for (const [entryKey, entry] of entries) {
      if (!newKeys.has(entryKey)) {
        entry.cleanup?.();
        entry.el.remove();
        entries.delete(entryKey);
      }
    }

    /** @type {Element | null} */
    let prevEl = null;

    for (let i = 0; i < arr.length; i += 1) {
      const item = arr[i];
      const entryKey = key(item);
      let entry = entries.get(entryKey);

      if (!entry) {
        const el = /** @type {Element} */ (tpl.content.firstElementChild?.cloneNode(true));
        const itemSig = signal(item);
        const indexSig = signal(i);
        entry = { el, item: itemSig, index: indexSig };
        entries.set(entryKey, entry);

        const cleanup = setup(
          el,
          () => itemSig(),
          () => indexSig(),
        );
        if (cleanup) {
          entry.cleanup = cleanup;
        }
      } else {
        entry.item(item);
        entry.index(i);
      }

      if (prevEl) {
        if (entry.el.previousElementSibling !== prevEl) {
          prevEl.after(entry.el);
        }
      } else if (entry.el !== container.firstElementChild) {
        container.prepend(entry.el);
      }

      prevEl = entry.el;
    }
  });

  return () => {
    stopEffect();
    for (const entry of entries.values()) {
      entry.cleanup?.();
      entry.el.remove();
    }
    entries.clear();
  };
}

/**
 * Internal: virtual-scrolling list renderer.
 * Only creates DOM nodes for the visible viewport. Uses a spacer element
 * for scroll height and translateY for row positioning.
 *
 * @template T
 * @param {HTMLElement} container
 * @param {HTMLTemplateElement} tpl
 * @param {() => T[]} items
 * @param {(item: T) => string | number} key
 * @param {(el: Element, item: () => T, index: () => number) => void | (() => void)} setup
 * @param {number} rowHeight
 * @returns {() => void}
 */
function listVirtual(container, tpl, items, key, setup, rowHeight) {
  // Set up the scrollable container
  container.style.overflowY = "auto";
  container.style.position = "relative";

  // Spacer element: provides the scrollable height
  const spacer = document.createElement("div");
  spacer.style.position = "absolute";
  spacer.style.top = "0";
  spacer.style.left = "0";
  spacer.style.width = "100%";
  container.appendChild(spacer);

  /** @type {Map<string | number, { el: HTMLElement, item: Signal<T>, index: Signal<number>, cleanup?: () => void }>} */
  const entries = new Map();

  /**
   * Calculate which items are visible in the current viewport.
   * @returns {{ start: number, end: number }}
   */
  function getVisibleRange() {
    const totalItems = items().length;
    if (totalItems === 0) {
      return { start: 0, end: 0 };
    }
    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;
    const bufferSize = Math.max(3, Math.floor(viewportHeight / rowHeight));

    const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - bufferSize);
    const endIdx = Math.min(totalItems, Math.ceil((scrollTop + viewportHeight) / rowHeight) + bufferSize);

    return { start: startIdx, end: endIdx };
  }

  /**
   * Update the virtual list: create/remove/position rows for the visible range.
   */
  function updateVirtualList() {
    const arr = items();
    const totalItems = arr.length;

    // Update spacer height
    spacer.style.height = `${totalItems * rowHeight}px`;

    const { start, end } = getVisibleRange();
    const visibleKeys = new Set();

    for (let i = start; i < end; i++) {
      const item = arr[i];
      const entryKey = key(item);
      visibleKeys.add(entryKey);

      let entry = entries.get(entryKey);

      if (!entry) {
        const el = /** @type {HTMLElement} */ (tpl.content.firstElementChild?.cloneNode(true));
        el.style.position = "absolute";
        el.style.top = `${i * rowHeight}px`;
        el.style.left = "0";
        el.style.width = "100%";
        el.style.height = `${rowHeight}px`;

        const itemSig = signal(item);
        const indexSig = signal(i);
        entry = { el, item: itemSig, index: indexSig };
        entries.set(entryKey, entry);

        const cleanup = setup(el, () => itemSig(), () => indexSig());
        if (cleanup) {
          entry.cleanup = cleanup;
        }

        spacer.appendChild(el);
      } else {
        entry.item(item);
        entry.index(i);
        // Update position in case items shifted
        entry.el.style.top = `${i * rowHeight}px`;
      }
    }

    // Remove entries that are no longer visible
    for (const [entryKey, entry] of entries) {
      if (!visibleKeys.has(entryKey)) {
        entry.cleanup?.();
        entry.el.remove();
        entries.delete(entryKey);
      }
    }
  }

  // Scroll listener with requestAnimationFrame throttling
  let scrollTick = false;
  const onScroll = () => {
    if (!scrollTick) {
      scrollTick = true;
      requestAnimationFrame(() => {
        updateVirtualList();
        scrollTick = false;
      });
    }
  };
  container.addEventListener("scroll", onScroll, { passive: true });

  // Reactive effect: re-render when items change
  const stopEffect = effect(() => {
    updateVirtualList();
  });

  // Initial render
  updateVirtualList();

  return () => {
    stopEffect();
    container.removeEventListener("scroll", onScroll);
    for (const entry of entries.values()) {
      entry.cleanup?.();
      entry.el.remove();
    }
    entries.clear();
    spacer.remove();
    // Reset container styles
    container.style.overflowY = "";
    container.style.position = "";
  };
}

/**
 * Create a cleanup collector for modules that register many effects/listeners.
 *
 * @param {...(() => void)} initial
 * @returns {{ add: (...cleanups: Array<(() => void) | null | undefined | false>) => void, run: () => void }}
 */
export function cleanupCollector(...initial) {
  /** @type {Array<() => void>} */
  const cleanups = initial.filter(Boolean);

  return {
    add(...nextCleanups) {
      for (const cleanup of nextCleanups) {
        if (cleanup) {
          cleanups.push(cleanup);
        }
      }
    },
    run() {
      while (cleanups.length > 0) {
        cleanups.pop()?.();
      }
    },
  };
}

/**
 * Require a ref from a component's refs map and throw if it is missing.
 *
 * Use this inside `onMount` callbacks to replace the 3-line instanceof
 * validation pattern with a single call. Add a JSDoc type cast for
 * type narrowing where needed.
 *
 * @template {Element} T
 * @param {Record<string, Element>} refs
 * @param {string} name
 * @returns {T}
 */
export function requireRef(refs, name) {
  const el = refs[name];
  if (!el) {
    throw new Error(`Missing required ref: ${name}`);
  }
  return /** @type {T} */ (el);
}

/**
 * Query an element and throw if it is not found.
 *
 * Use this in `collectShell` functions to replace the 3-line
 * querySelector + instanceof validation pattern with a single call.
 *
 * Example:
 *   const titlebar = requireElement(root, "#titlebar", "titlebar");
 *
 * @template {Element} T
 * @param {ParentNode} root
 * @param {string} selector
 * @param {string} description
 * @returns {T}
 */
export function requireElement(root, selector, description) {
  const el = root.querySelector(selector);
  if (!el) {
    throw new Error(`Missing required element: ${description} (${selector})`);
  }
  return /** @type {T} */ (el);
}

/**
 * @template {Element} [T=Element]
 * @typedef {object} Component
 * @property {string} html
 * @property {T=} el
 * @property {Record<string, Element>} refs
 * @property {(parent: Element) => void} mount
 * @property {(() => void)=} unmount
 */

/**
 * @template {Element} [T=Element]
 * @typedef {object} TemplateOptions
 * @property {string=} root
 * @property {(el: T | undefined, parent: Element, ctx: ComponentContext<T>) => void=} onMount
 * @property {(ctx: ComponentContext<T>) => void=} onUnmount
 */

/**
 * @typedef {Component | string | number | boolean | null | undefined | ReturnType<typeof raw>} TemplateValue
 */

/**
 * @typedef {{ id: number, component: Component }} ComponentSlot
 */

/**
 * @template {Element} [T=Element]
 * @typedef {object} ComponentContext
 * @property {Element} host
 * @property {T | undefined} root
 * @property {Record<string, Element>} refs
 * @property {{ add: (...cleanups: Array<(() => void) | null | undefined | false>) => void, run: () => void }} cleanup
 * @property {Component<T>} component
 */

/**
 * @param {unknown} value
 * @returns {value is Component}
 */
function isComponent(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      "html" in value &&
      "mount" in value &&
      typeof value.html === "string" &&
      typeof value.mount === "function",
  );
}

/**
 * Mark a string as safe raw HTML for template interpolation.
 * Use this when you intentionally want to inject HTML fragments.
 *
 * @param {string} html
 * @returns {{ __raw: true, html: string }}
 */
export function raw(html) {
  return { __raw: true, html };
}

/**
 * @param {unknown} value
 * @returns {value is { __raw: true, html: string }}
 */
function isRawHtml(value) {
  return (
    value != null &&
    typeof value === "object" &&
    "__raw" in value &&
    value.__raw === true &&
    "html" in value
  );
}

/**
 * @param {TemplateStringsArray} strings
 * @param {TemplateValue[]} values
 * @returns {{ html: string, components: ComponentSlot[] }}
 */
function buildTemplate(strings, values) {
  /** @type {ComponentSlot[]} */
  const components = [];
  /** @type {string[]} */
  const parts = [strings[0] ?? ""];

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (isComponent(value)) {
      const id = slotId++;
      components.push({ id, component: value });
      parts.push(
        `<span data-naf-component-slot="${id}" style="display: contents;"></span>`,
      );
    } else if (isRawHtml(value)) {
      parts.push(value.html);
    } else if (typeof value === "string") {
      parts.push(text(value));
    } else if (value !== null && value !== undefined && value !== false) {
      parts.push(text(String(value)));
    }
    parts.push(strings[index + 1] ?? "");
  }

  return {
    html: parts.join(""),
    components,
  };
}

/**
 * @param {Element[]} elements
 * @returns {Record<string, Element>}
 */
function collectRefs(elements) {
  /** @type {Record<string, Element>} */
  const refs = {};

  for (const element of elements) {
    const name = element.getAttribute("data-ref");
    if (name) {
      if (refs[name]) {
        throw new Error(`Duplicate data-ref found: ${name}`);
      }
      refs[name] = element;
    }

    for (const child of element.querySelectorAll("[data-ref]")) {
      const childName = child.getAttribute("data-ref");
      if (!childName) {
        continue;
      }
      if (refs[childName]) {
        throw new Error(`Duplicate data-ref found: ${childName}`);
      }
      refs[childName] = child;
    }
  }

  return refs;
}

/**
 * Collect data-ref elements from a row element.
 *
 * Use this inside list() setup callbacks to replace querySelector calls
 * with a single refs map lookup. Similar to what template() does internally
 * via collectRefs(), but scoped to a single row element.
 *
 * Example:
 *   list(container, ROW_HTML, items, key, (el, item) => {
 *     const refs = collectRowRefs(el);
 *     const label = refs.label;
 *     const icon = refs.icon;
 *     // ...
 *   });
 *
 * @param {Element} el
 * @returns {Record<string, Element>}
 */
export function collectRowRefs(el) {
  /** @type {Record<string, Element>} */
  const refs = {};

  const name = el.getAttribute("data-ref");
  if (name) {
    refs[name] = el;
  }

  for (const child of el.querySelectorAll("[data-ref]")) {
    const childName = child.getAttribute("data-ref");
    if (childName) {
      refs[childName] = child;
    }
  }

  return refs;
}

/**
 * @param {string} html
 * @returns {DocumentFragment}
 */
function createFragment(html) {
  tempDiv.innerHTML = html;
  translateStaticDom(tempDiv);
  const fragment = document.createDocumentFragment();
  while (tempDiv.firstChild) {
    fragment.appendChild(tempDiv.firstChild);
  }
  return fragment;
}

/**
 * @param {Element[]} elements
 * @param {string} selector
 * @returns {Element | undefined}
 */
function findScopedElement(elements, selector) {
  for (const element of elements) {
    if (element.matches(selector)) {
      return element;
    }

    const nested = element.querySelector(selector);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

/**
 * @param {Element} host
 * @param {DocumentFragment} fragment
 * @returns {Element[]}
 */
function mountFragment(host, fragment) {
  const elements = /** @type {Element[]} */ (
    Array.from(fragment.childNodes).filter((node) => node instanceof Element)
  );
  host.appendChild(fragment);
  return elements;
}

/**
 * @template {Element} T
 * @param {string} html
 * @param {ComponentSlot[]} components
 * @param {TemplateOptions<T>=} options
 * @returns {Component<T>}
 */
function createComponent(html, components, options) {
  const cleanup = cleanupCollector();
  /** @type {ComponentContext<T> | undefined} */
  let context;
  /** @type {Element[]} */
  let mountedElements = [];

  /** @type {Component<T>} */
  const component = {
    html,
    el: undefined,
    refs: {},
    mount(parent) {
      const fragment = createFragment(html);
      mountedElements = mountFragment(parent, fragment);

      if (options?.root) {
        const found = findScopedElement(mountedElements, options.root);
        if (!found) {
          throw new Error(`Element not found for selector: ${options.root}`);
        }
        component.el = /** @type {T} */ (found);
      }

      component.refs = collectRefs(mountedElements);
      context = {
        host: parent,
        root: component.el,
        refs: component.refs,
        cleanup,
        component,
      };

      options?.onMount?.(component.el, parent, context);

      for (const childSlot of components) {
        const slotHost = findScopedElement(
          mountedElements,
          `[data-naf-component-slot="${childSlot.id}"]`,
        );
        if (!(slotHost instanceof HTMLElement)) {
          throw new Error(`Component slot host not found: ${childSlot.id}`);
        }
        childSlot.component.mount(slotHost);
      }
    },
    unmount() {
      for (const childSlot of components) {
        childSlot.component.unmount?.();
      }
      if (options?.onUnmount && context) {
        options.onUnmount(context);
      }
      cleanup.run();
      for (const element of mountedElements) {
        element.remove();
      }
      component.el = undefined;
      component.refs = {};
      mountedElements = [];
      context = undefined;
    },
  };

  return component;
}

let slotId = 0;
const tempDiv = document.createElement("div");


/**
 * Reactive conditional rendering.
 *
 * Returns a component that mounts into its parent and switches between
 * a then-branch and else-branch based on a reactive condition.
 * The parent element is the slot host -- no comment markers or tree walking.
 *
 * Example:
 *   when(
 *     () => isLoading(),
 *     () => createLoadingSpinner(),
 *     () => createContent(),
 *   )
 *
 * @template T
 * @param {() => T} condition
 * @param {(value: T) => Component} thenBranch
 * @param {(value: T) => Component=} elseBranch
 * @returns {Component}
 */
export function when(condition, thenBranch, elseBranch) {
  /** @type {Component | undefined} */
  let currentComponent;
  /** @type {unknown} */
  let previousValue;
  /** @type {boolean | undefined} */
  let previousBranch;

  return {
    html: '',
    refs: {},
    mount(parent) {
      effect(() => {
        const value = condition();
        const branch = Boolean(value);

        if (previousBranch === branch && previousValue === value) {
          return;
        }

        previousBranch = branch;
        previousValue = value;

        currentComponent?.unmount?.();
        currentComponent = branch ? thenBranch(value) : elseBranch?.(value);

        if (currentComponent) {
          parent.replaceChildren();
          currentComponent.mount(parent);
        } else {
          parent.replaceChildren();
        }
      });
    },
    unmount() {
      currentComponent?.unmount?.();
    },
  };
}

/**
 * @template {Element} [T=Element]
 * @param {TemplateOptions<T> | TemplateStringsArray} optionsOrStrings
 * @param {...TemplateValue} valuesOrNothing
 * @returns {Component<T> | ((strings: TemplateStringsArray, ...values: TemplateValue[]) => Component<T>)}
 */
export function template(optionsOrStrings, ...valuesOrNothing) {
  if (
    !Array.isArray(optionsOrStrings) &&
    typeof optionsOrStrings === "object" &&
    optionsOrStrings !== null &&
    !("raw" in optionsOrStrings)
  ) {
    const options = /** @type {TemplateOptions<T>} */ (optionsOrStrings);
    return (strings, ...values) => {
      const { html, components } = buildTemplate(strings, values);
      return createComponent(html, components, options);
    };
  }

  const strings = /** @type {TemplateStringsArray} */ (optionsOrStrings);
  const { html, components } = buildTemplate(strings, valuesOrNothing);
  return createComponent(html, components);
}

/**
 * Mount a component into a dedicated host and replace any existing host content.
 *
 * @template {Element} [T=Element]
 * @param {Component<T>} component
 * @param {Element | null} host
 * @returns {Component<T>}
 */
export function mount(component, host) {
  if (!host) {
    throw new Error("Expected host element for component mount");
  }

  host.replaceChildren();
  component.mount(host);
  return component;
}

/**
 * @param {Element | null | undefined} el
 * @param {string} name
 * @param {() => string | boolean | null} value
 * @returns {() => void}
 */
export function attr(el, name, value) {
  if (!el) {
    return () => {};
  }

  return effect(() => {
    const nextValue = value();
    if (nextValue === false || nextValue === null) {
      el.removeAttribute(name);
    } else if (nextValue === true) {
      el.setAttribute(name, "");
    } else {
      el.setAttribute(name, String(nextValue));
    }
  });
}

/**
 * @param {Element | null | undefined} el
 * @param {() => unknown} getter
 * @returns {() => void}
 */
export function setText(el, getter) {
  if (!el) {
    return () => {};
  }

  return effect(() => {
    el.textContent = String(getter());
  });
}
