(() => {
    'use strict';

    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    const content = document.getElementById('content');
    const navigation = document.getElementById('chapter-nav');
    if (!sidebar || !toggle || !content || !navigation) return;

    const mobile = window.matchMedia('(max-width: 760px)');
    const links = Array.from(navigation.querySelectorAll('a[data-chapter]'));
    const storageKey = 'yansk-wiki-sidebar-open';
    let expanded = false;
    let desktopExpanded = null;

    function desktopPreference() {
        if (desktopExpanded !== null) return desktopExpanded;
        desktopExpanded = true;
        try {
            const saved = localStorage.getItem(storageKey);
            if (saved === 'true' || saved === 'false') desktopExpanded = saved === 'true';
        } catch {
            // File previews or private browsing can disable storage.
        }
        return desktopExpanded;
    }

    function rememberDesktop(next) {
        desktopExpanded = next;
        try {
            localStorage.setItem(storageKey, String(next));
        } catch {
            // Navigation remains usable without persistent preferences.
        }
    }

    function setExpanded(next, { focus = false, remember = true } = {}) {
        expanded = Boolean(next);
        sidebar.hidden = !expanded;
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-label', expanded ? '收起章节目录' : '展开章节目录');
        toggle.title = expanded ? '收起章节目录' : '展开章节目录';
        document.body.classList.toggle('sidebar-open', expanded);
        content.inert = mobile.matches && expanded;
        if (remember && !mobile.matches) rememberDesktop(expanded);

        if (focus) {
            if (expanded && mobile.matches) {
                (links.find(link => link.getAttribute('aria-current') === 'page') || links[0] || toggle)
                    .focus({ preventScroll: true });
            } else if (!expanded) {
                toggle.focus({ preventScroll: true });
            }
        }
    }

    // Current chapters are marked in each static page, so navigation needs no script.
    // Only old root-page chapter hashes are redirected to their new chapter pages.
    const isRootPage = location.pathname.endsWith('/') || /\/index\.html$/.test(location.pathname);
    if (isRootPage && location.hash) {
        const oldChapter = location.hash.slice(1);
        const link = links.find(item => item.dataset.chapter === oldChapter);
        if (link && link.getAttribute('aria-current') !== 'page') {
            location.replace(link.href);
            return;
        }
    }

    document.body.classList.add('sidebar-enhanced');
    setExpanded(mobile.matches ? false : desktopPreference(), { remember: false });

    toggle.addEventListener('click', () => setExpanded(!expanded, { focus: true }));

    sidebar.addEventListener('click', event => {
        const link = event.target.closest('a[href]');
        if (mobile.matches && link && sidebar.contains(link)) {
            setExpanded(false, { focus: true });
        }
    });

    document.addEventListener('click', event => {
        if (!expanded || !mobile.matches) return;
        if (!sidebar.contains(event.target) && !toggle.contains(event.target)) {
            setExpanded(false, { focus: true });
        }
    });

    document.addEventListener('keydown', event => {
        if (!expanded) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            setExpanded(false, { focus: true });
            return;
        }
        if (event.key !== 'Tab' || !mobile.matches) return;

        const focusable = [toggle, ...sidebar.querySelectorAll('a[href], button:not([disabled]), [tabindex="0"]')];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !focusable.includes(active))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (active === last || !focusable.includes(active))) {
            event.preventDefault();
            first.focus();
        }
    });

    const resize = () => {
        const hadFocus = sidebar.contains(document.activeElement);
        setExpanded(mobile.matches ? false : desktopPreference(), { remember: false });
        if (hadFocus && !expanded) toggle.focus({ preventScroll: true });
    };
    if (mobile.addEventListener) mobile.addEventListener('change', resize);
    else mobile.addListener(resize);
})();
