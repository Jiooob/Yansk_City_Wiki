document.addEventListener('DOMContentLoaded', () => {
    // 获取当前页面的路径，例如 "/pages/tech-core.html"
    const currentPagePath = window.location.pathname;

    // 获取所有导航链接
    const navLinks = document.querySelectorAll('#sidebar a');

    navLinks.forEach(link => {
        // 获取链接的href属性，例如 "tech-core.html"
        const linkPath = link.getAttribute('href');

        // 检查当前页面路径是否以该链接的路径结尾
        // 这是一个简单但有效的判断方法
        if (currentPagePath.endsWith(linkPath)) {
            link.classList.add('active');
        }
    });
});