const SECTION_ATTRIBUTE = 'data-app-section';
const HIDDEN_CLASS = 'app-view-hidden';

let cachedSections = null;
let currentView = null;
let initialized = false;

function parseSectionViews(section) {
  if (!section) {
    return [];
  }
  const attr = typeof section.getAttribute === 'function' ? section.getAttribute(SECTION_ATTRIBUTE) : '';
  if (!attr) {
    return [];
  }
  return attr
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function ensureSections() {
  if (cachedSections) {
    return cachedSections;
  }
  cachedSections = Array.from(document.querySelectorAll(`[${SECTION_ATTRIBUTE}]`));
  return cachedSections;
}

function resolveTarget(target) {
  if (!target) {
    return null;
  }
  if (typeof target === 'string') {
    try {
      return document.querySelector(target);
    } catch (error) {
      console.warn('View router: invalid selector', target, error);
      return null;
    }
  }
  if (target instanceof Element) {
    return target;
  }
  return null;
}

function syncSectionVisibility(view) {
  const sections = ensureSections();
  if (!sections.length) {
    return;
  }
  sections.forEach((section) => {
    const views = parseSectionViews(section);
    const shouldShow = !views.length || views.includes(view);
    section.classList.toggle(HIDDEN_CLASS, !shouldShow);
    section.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
  });
}

function dispatchViewChange(view) {
  document.dispatchEvent(
    new CustomEvent('appviewchange', {
      detail: { view }
    })
  );
}

function setActiveAppView(view, options = {}) {
  const normalized = typeof view === 'string' ? view.trim() : '';
  if (!normalized) {
    return null;
  }
  const previousView = currentView;
  currentView = normalized;
  if (document.body) {
    document.body.dataset.activeView = normalized;
  }
  syncSectionVisibility(normalized);
  const targetEl = resolveTarget(options.target);
  const shouldScroll = targetEl && options.scrollBehavior !== 'none';
  const block = options.block || 'start';
  if (shouldScroll) {
    const behavior = options.scrollBehavior || 'smooth';
    window.requestAnimationFrame(() => {
      try {
        targetEl.scrollIntoView({ behavior: behavior === 'instant' ? 'auto' : behavior, block });
      } catch (error) {
        targetEl.scrollIntoView();
      }
    });
  }
  if (options.updateHash && targetEl && targetEl.id) {
    const nextUrl = `${window.location.pathname}${window.location.search}#${targetEl.id}`;
    window.history.replaceState(null, '', nextUrl);
  }
  if (previousView !== normalized) {
    dispatchViewChange(normalized);
  }
  return targetEl;
}

function revealSection(targetOrSelector, options = {}) {
  const target = resolveTarget(targetOrSelector);
  if (!target) {
    return null;
  }
  const views = parseSectionViews(target);
  if (views.length) {
    return setActiveAppView(views[0], { ...options, target });
  }
  if (options.scrollBehavior !== 'none') {
    const behavior = options.scrollBehavior || 'smooth';
    const block = options.block || 'start';
    window.requestAnimationFrame(() => {
      try {
        target.scrollIntoView({ behavior, block });
      } catch (error) {
        target.scrollIntoView();
      }
    });
  }
  return target;
}

function getActiveAppView() {
  if (document.body?.dataset.activeView) {
    currentView = document.body.dataset.activeView;
  }
  return currentView;
}

function resolveViewFromHash() {
  const hash = window.location.hash;
  if (!hash) {
    return null;
  }
  const target = resolveTarget(hash);
  if (!target) {
    return null;
  }
  const views = parseSectionViews(target);
  return views[0] || null;
}

function initAppViewRouter() {
  if (initialized) {
    return;
  }
  initialized = true;
  ensureSections();
  if (!cachedSections || !cachedSections.length) {
    return;
  }
  const hashView = resolveViewFromHash();
  const hashTarget = hashView ? resolveTarget(window.location.hash) : null;
  const initialView = hashView || getActiveAppView() || parseSectionViews(cachedSections[0])[0] || 'home';
  setActiveAppView(initialView, {
    target: hashTarget || null,
    scrollBehavior: 'none',
    updateHash: false
  });
  window.addEventListener('hashchange', () => {
    const nextView = resolveViewFromHash();
    if (!nextView) {
      return;
    }
    const target = resolveTarget(window.location.hash);
    setActiveAppView(nextView, {
      target,
      scrollBehavior: 'none',
      updateHash: false
    });
  });
}

export { initAppViewRouter, setActiveAppView, getActiveAppView, revealSection };
