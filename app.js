document.addEventListener('DOMContentLoaded', () => {
  const bottomButtons = document.querySelectorAll('.bottom-btn');
  const sectionPanels = document.querySelectorAll('[data-section-panel]');
  const tabBars = document.querySelectorAll('.top-tabs');
  const filterPills = document.querySelectorAll('[data-filter-group]');
  const watchButtons = document.querySelectorAll('[data-watch]');
  const requestButtons = document.querySelectorAll('[data-request][data-action]');
  const watchPartyButtons = document.querySelectorAll('[data-action="watch-party"]');
  const toast = document.getElementById('toast');
  let toastTimeout;

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function setActiveSection(section) {
    bottomButtons.forEach((btn) => {
      const isActive = btn.dataset.section === section;
      btn.setAttribute('aria-selected', isActive);
    });

    sectionPanels.forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.sectionPanel === section);
    });

    tabBars.forEach((bar) => {
      const isMatch = bar.dataset.tabsFor === section;
      bar.classList.toggle('active', isMatch);
    });

    const tabBar = document.querySelector(`.top-tabs[data-tabs-for="${section}"]`);
    if (tabBar) {
      const defaultTab = tabBar.querySelector('[aria-selected="true"], .tab-button')?.dataset.tab;
      if (defaultTab) {
        setActiveTab(section, defaultTab);
      }
    }

    document.querySelector('.content-area')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setActiveTab(section, tab) {
    const tabBar = document.querySelector(`.top-tabs[data-tabs-for="${section}"]`);
    if (tabBar) {
      tabBar.querySelectorAll('.tab-button').forEach((btn) => {
        const isActive = btn.dataset.tab === tab;
        btn.setAttribute('aria-selected', isActive);
      });
    }

    const sectionPanel = document.querySelector(`[data-section-panel="${section}"]`);
    if (sectionPanel) {
      sectionPanel.querySelectorAll('[data-tab-panel]').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.tabPanel === tab);
      });
    }
  }

  bottomButtons.forEach((btn) => {
    btn.addEventListener('click', () => setActiveSection(btn.dataset.section));
  });

  tabBars.forEach((bar) => {
    bar.addEventListener('click', (event) => {
      const target = event.target.closest('.tab-button');
      if (!target) return;
      const section = bar.dataset.tabsFor;
      setActiveTab(section, target.dataset.tab);
    });
  });

  filterPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      const group = pill.dataset.filterGroup;
      document.querySelectorAll(`[data-filter-group="${group}"]`).forEach((btn) => {
        const isActive = btn === pill;
        btn.classList.toggle('pill-active', isActive);
        btn.setAttribute('aria-pressed', isActive);
      });
      showToast(`Filter: ${pill.textContent.trim()}`);
    });
  });

  watchButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const toggled = btn.classList.toggle('pill-active');
      btn.setAttribute('aria-pressed', toggled);
      btn.textContent = toggled ? 'Watched ✓' : 'Mark watched ✓';
      const title = btn.closest('.movie-card')?.querySelector('strong')?.textContent || 'Movie';
      showToast(`${title} marked ${toggled ? 'watched' : 'unwatched'}`);
    });
  });

  requestButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const { request, action } = btn.dataset;
      btn.closest('.request-card')?.querySelectorAll(`[data-request="${request}"]`).forEach((button) => {
        button.disabled = true;
        button.classList.add('pill-active');
      });
      showToast(`Request ${action === 'accept' || action === 'join' ? 'accepted' : action === 'view' ? 'opened' : 'dismissed'}.`);
    });
  });

  watchPartyButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      showToast('Watch party scheduled — sending invites');
    });
  });

  setActiveSection('home');
});
