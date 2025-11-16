const bottomButtons = document.querySelectorAll('.bottom-btn');
const sectionPanels = document.querySelectorAll('[data-section-panel]');
const tabBars = document.querySelectorAll('.top-tabs');

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

setActiveSection('home');
