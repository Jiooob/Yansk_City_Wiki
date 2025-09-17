document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const content = document.getElementById('content');
    
    // 状态管理
    let isOpen = false;
    
    // 初始化页面
    function initializePage() {
        // 临时禁用动画防止页面加载时的闪烁
        document.body.classList.add('no-transition');
        
        // 检查是否应该保持展开状态
        if (localStorage.getItem('sidebarOpen') === 'true') {
            openSidebar();
        }
        
        // 50ms后重新启用动画
        setTimeout(() => {
            document.body.classList.remove('no-transition');
        }, 50);
    }
    
    // 展开侧边栏
    function openSidebar() {
        isOpen = true;
        sidebar.classList.add('open');
        document.body.classList.add('sidebar-open');
        localStorage.setItem('sidebarOpen', 'true');
    }
    
    // 收起侧边栏
    function closeSidebar() {
        isOpen = false;
        sidebar.classList.remove('open');
        document.body.classList.remove('sidebar-open');
        localStorage.setItem('sidebarOpen', 'false');
    }
    
    // 切换侧边栏状态
    function toggleSidebar() {
        if (isOpen) {
            closeSidebar();
        } else {
            openSidebar();
        }
    }
    
    // 切换按钮点击事件
    sidebarToggle.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleSidebar();
    });
    
    // 点击外部区域收起侧边栏
    document.addEventListener('click', (event) => {
        // 如果点击的不是侧边栏内部且侧边栏是展开的，则收起
        if (isOpen && !sidebar.contains(event.target)) {
            closeSidebar();
        }
    });
    
    // 阻止侧边栏内部点击事件冒泡
    sidebar.addEventListener('click', (event) => {
        event.stopPropagation();
    });
    
    // 导航链接点击时保持侧边栏状态
    const navLinks = sidebar.querySelectorAll('a');
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            // 保持当前侧边栏状态到下一个页面
            localStorage.setItem('sidebarOpen', isOpen.toString());
        });
    });
    
    // 高亮当前页面链接
    function highlightCurrentPage() {
        const currentPath = window.location.pathname;
        const navLinks = document.querySelectorAll('#sidebar a');
        
        navLinks.forEach(link => {
            const linkPath = link.getAttribute('href');
            // 处理相对路径匹配
            if (currentPath.endsWith(linkPath) || 
                (linkPath.startsWith('../') && currentPath.endsWith(linkPath.replace('../', ''))) ||
                (currentPath.includes('index.html') && linkPath === 'index.html')) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });
    }
    
    // 键盘快捷键支持 (Esc键关闭侧边栏)
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isOpen) {
            closeSidebar();
        }
    });
    
    // 初始化
    initializePage();
    highlightCurrentPage();
});