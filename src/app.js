document.addEventListener('DOMContentLoaded', () => {
    const APPS_PER_PAGE = 50;
    const CACHE_TIME = 5 * 60 * 1000;
    let cache = {};
    let allApps = [];
    let currentPage = 1;
    let currentSearch = '';
    let currentTab = 'all';

    class AppManager {
        constructor() {
            this.installedApps = [];
            this.loadInstalledApps();
        }

        async loadInstalledApps() {
            this.installedApps = await window.electronAPI.getInstalledApps();
            this.renderInstalledApps();
        }

        renderInstalledApps() {
            const container = document.getElementById('installed-apps');
            if (!container) return;
            
            container.innerHTML = this.installedApps.map(app => `
                <div class="card mb-3 installed-app-item">
                    <div class="card-body d-flex justify-content-between">
                        <div>
                            <h5>${app.title}</h5>
                            <small class="text-muted">${app.path}</small>
                        </div>
                        <button class="btn btn-danger btn-sm uninstall-btn" data-id="${app.id}">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('');

            container.querySelectorAll('.uninstall-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    await window.electronAPI.uninstallApp(btn.dataset.id);
                    await this.loadInstalledApps();
                });
            });
        }
    }

    const appManager = new AppManager();

    async function getAuthHeader() {
        const token = await window.electronAPI.getGitHubToken();
        return token ? { 'Authorization': `token ${token}` } : {};
    }

    function updateAuthUI() {
        const authButton = document.getElementById('authButton');
        window.electronAPI.getGitHubToken().then(hasToken => {
            authButton.textContent = hasToken ? 'Logout' : 'Login with GitHub';
            authButton.className = hasToken ? 'btn btn-outline-danger' : 'btn btn-outline-dark';
        });
    }

    async function cachedFetch(url) {
        const now = Date.now();
        if (cache[url] && now - cache[url].timestamp < CACHE_TIME) {
            return cache[url].data;
        }

        try {
            const res = await fetch(url, {
                headers: { 
                    'User-Agent': 'GitHub-App-Store',
                    ...(await getAuthHeader())
                }
            });

            if (!res.ok) {
                if (res.status === 401) handleAuthError();
                if (res.status === 403) showError('GitHub API rate limit exceeded');
                return null;
            }

            const data = await res.json();
            cache[url] = { data, timestamp: now };
            return data;
        } catch (error) {
            console.error('Fetch error:', error);
            return null;
        }
    }

    function handleAuthError() {
        window.electronAPI.deleteGitHubToken();
        updateAuthUI();
        showError('Invalid token. Please re-authenticate.');
        new bootstrap.Modal(document.getElementById('tokenModal')).show();
    }

    async function loadAppData(repoEntry) {
        if (!repoEntry.owner || !repoEntry.repo) return null;

        try {
            const [releases, repoInfo] = await Promise.all([
                cachedFetch(`https://api.github.com/repos/${repoEntry.owner}/${repoEntry.repo}/releases`),
                cachedFetch(`https://api.github.com/repos/${repoEntry.owner}/${repoEntry.repo}`)
            ]);

            return {
                id: `${repoEntry.owner}_${repoEntry.repo}`,
                title: repoEntry.display_name || repoEntry.repo,
                originalRepo: repoEntry.repo,
                author: repoEntry.owner,
                description: repoInfo?.description || 'No description available',
                stars: repoInfo?.stargazers_count || 0,
                releases: releases || [],
                icon: repoEntry.icon || 'logo1x1.png',
                os_overrides: repoEntry.os_overrides || {}
            };
        } catch (error) {
            console.error(`Error loading ${repoEntry.owner}/${repoEntry.repo}:`, error);
            return null;
        }
    }

    function sortApps(apps) {
        return apps.sort((a, b) => {
            if (b.stars !== a.stars) return b.stars - a.stars;
            if (a.title !== b.title) return a.title.localeCompare(b.title);
            return a.author.localeCompare(b.author);
        });
    }

    function createAppCard(app) {
        const platformInfo = window.platform;
        const currentOS = platformInfo.isWindows ? 'windows' : platformInfo.isMacOS ? 'macos' : 'linux';
        const currentArch = platformInfo.isARM ? 'arm64' : 'x64';
        
        const bestMatch = processAssets(app.releases, app.os_overrides)
            .find(asset => asset.os === currentOS && asset.arch === currentArch);

        return `
            <div class="col mb-4" data-search="${app.title.toLowerCase()} ${app.originalRepo.toLowerCase()} 
                ${app.author.toLowerCase()} ${app.description.toLowerCase()}">
                <div class="card h-100 shadow-sm">
                    <div class="card-body d-flex flex-column">
                        <div class="d-flex align-items-center mb-3">
                            <img src="${app.icon}" class="app-icon rounded me-3" 
                                alt="${app.title} icon" onerror="this.src='logo1x1.png'">
                            <div>
                                <h5 class="card-title mb-0">${app.title}</h5>
                                <div class="d-flex align-items-center gap-2 mt-1">
                                    <small class="text-muted">by ${app.author}</small>
                                </div>
                            </div>
                        </div>
                        <p class="card-text flex-grow-1">${app.description}</p>
                        <div class="download-group">
                            <button class="btn ${bestMatch ? 'btn-primary' : 'btn-secondary disabled'} 
                                download-btn mt-auto align-self-start" 
                                data-repo="${app.author}/${app.originalRepo}" 
                                ${!bestMatch ? 'disabled' : ''}>
                                ${bestMatch ? 'Install' : 'Unavailable'}
                            </button>
                            <button class="btn btn-outline-secondary dropdown-btn" 
                                data-bs-toggle="modal" 
                                data-bs-target="#downloadModal" 
                                data-repo="${app.author}/${app.originalRepo}">
                                <i class="bi bi-chevron-down"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function processAssets(assets, osOverrides) {
        const platformInfo = window.platform;
        const currentOS = platformInfo.isWindows ? 'windows' : platformInfo.isMacOS ? 'macos' : 'linux';
        const currentArch = platformInfo.isARM ? 'arm64' : 'x64';
        const seen = new Set();

        return (assets || []).map(asset => {
            const ext = asset.name.split('.').pop().toLowerCase();
            if (['blockmap', 'yml', 'sha', 'sig', 'asc', 'txt', 'zsync', 'sym'].includes(ext)) return null;

            let os = Object.entries(osOverrides).find(([key]) => 
                asset.name.toLowerCase().includes(key.toLowerCase())
            )?.[1];

            if (!os) {
                const lowerName = asset.name.toLowerCase();
                if (lowerName.includes('linux') || lowerName.includes('lin')) os = 'linux';
                else if (lowerName.includes('win') || lowerName.includes('windows')) os = 'windows';
                else if (lowerName.includes('mac') || lowerName.includes('osx') || lowerName.includes('darwin')) os = 'macos';
                else if (['exe', 'msi', 'msix', 'appinstaller'].includes(ext)) os = 'windows';
                else if (['dmg', 'pkg'].includes(ext)) os = 'macos';
                else if (['deb', 'appimage', 'rpm', 'flatpak'].includes(ext)) os = 'linux';
            }

            const arch = lowerName.includes('arm64') ? 'arm64' : 
                        lowerName.includes('x64') ? 'x64' : currentArch;

            const key = `${os}-${arch}`.toUpperCase();
            return os && !seen.has(key) ? (seen.add(key), {
                os: os.toLowerCase(),
                arch,
                ext: ext.toUpperCase(),
                url: asset.browser_download_url,
                size: asset.size
            }) : null;
        }).filter(Boolean);
    }

    function renderApps() {
        const appsContainer = document.getElementById('apps');
        const filteredApps = allApps.filter(app => 
            app.title.toLowerCase().includes(currentSearch) ||
            app.originalRepo.toLowerCase().includes(currentSearch) ||
            app.author.toLowerCase().includes(currentSearch) ||
            app.description.toLowerCase().includes(currentSearch)
            .filter(app => currentTab === 'installed' 
                ? appManager.installedApps.some(installed => installed.id === app.id) 
                : true);

        const startIndex = (currentPage - 1) * APPS_PER_PAGE;
        const endIndex = startIndex + APPS_PER_PAGE;
        
        appsContainer.innerHTML = filteredApps
            .slice(0, endIndex)
            .map(createAppCard)
            .join('');

        document.getElementById('loadMore').style.display = 
            endIndex >= filteredApps.length ? 'none' : 'block';

        document.getElementById('status').textContent = 
            `Showing ${Math.min(endIndex, filteredApps.length)} of ${filteredApps.length} apps`;
    }

    async function init() {
        try {
            const repos = JSON.parse(await window.electronAPI.getReposData());
            const loadedApps = (await Promise.all(repos.repos.map(loadAppData))).filter(app => app);
            allApps = sortApps(loadedApps);

            document.getElementById('searchInput').addEventListener('input', e => {
                currentSearch = e.target.value.trim().toLowerCase();
                currentPage = 1;
                renderApps();
            });

            document.querySelectorAll('.nav-link').forEach(link => {
                link.addEventListener('click', e => {
                    currentTab = e.target.dataset.tab;
                    currentPage = 1;
                    renderApps();
                });
            });

            document.getElementById('apps').addEventListener('click', async e => {
                const downloadBtn = e.target.closest('.download-btn');
                const dropdownBtn = e.target.closest('.dropdown-btn');
                
                if (downloadBtn && !downloadBtn.disabled) {
                    const repoPath = downloadBtn.dataset.repo;
                    const app = allApps.find(a => `${a.author}/${a.originalRepo}` === repoPath);
                    const asset = processAssets(app.releases, app.os_overrides)
                        .find(a => a.os === window.platform.os && a.arch === window.platform.arch);
                    
                    if (asset) {
                        await window.electronAPI.installApp({
                            appId: app.id,
                            url: asset.url,
                            title: app.title
                        });
                        await appManager.loadInstalledApps();
                    }
                }

                if (dropdownBtn) {
                    const repoPath = dropdownBtn.dataset.repo;
                    showDownloadModal(repoPath);
                }
            });

            document.getElementById('authButton').addEventListener('click', async () => {
                const token = await window.electronAPI.getGitHubToken();
                if (token) {
                    await window.electronAPI.deleteGitHubToken();
                    updateAuthUI();
                    showError('Logged out successfully');
                    location.reload();
                } else {
                    new bootstrap.Modal(document.getElementById('tokenModal')).show();
                }
            });

            document.getElementById('saveToken').addEventListener('click', async () => {
                const token = document.getElementById('tokenInput').value.trim();
                if (/^ghp_[a-zA-Z0-9]{36}$/.test(token)) {
                    await window.electronAPI.setGitHubToken(token);
                    document.getElementById('tokenInput').classList.remove('is-invalid');
                    new bootstrap.Modal(document.getElementById('tokenModal')).hide();
                    updateAuthUI();
                    location.reload();
                } else {
                    document.getElementById('tokenInput').classList.add('is-invalid');
                }
            });

            updateAuthUI();
            renderApps();
        } catch (error) {
            showError('Failed to load application data');
            console.error('Initialization error:', error);
        }
    }

    const style = document.createElement('style');
    style.textContent = `
        .download-group { display: flex; gap: 8px; }
        .dropdown-btn { width: 40px; padding: 8px; }
        .installed-app-item { transition: all 0.3s ease; }
        .installed-app-item:hover { transform: translateX(5px); }
    `;
    document.head.appendChild(style);

    init();
});
