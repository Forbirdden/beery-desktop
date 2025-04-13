document.addEventListener('DOMContentLoaded', () => {
    const APPS_PER_PAGE = 50;
    const CACHE_TIME = 5 * 60 * 1000;
    const GITHUB_TOKEN_KEY = 'github_token';
    let cache = {};
    let allApps = [];
    let currentPage = 1;
    let currentSearch = '';
    let userPlatform = '';
    let installedApps = JSON.parse(localStorage.getItem('installedApps') || [];

    // Определение платформы
    async function detectPlatform() {
        const platformData = await window.electronAPI.getPlatform();
        const [os, arch] = platformData.split('-');
        userPlatform = `${os.toUpperCase()} ${arch.replace('x64', 'x64').replace('arm64', 'ARM64')}`;
    }

    function getAuthHeader() {
        const token = localStorage.getItem(GITHUB_TOKEN_KEY);
        return token ? { 'Authorization': `token ${token}` } : {};
    }

    function updateAuthUI() {
        const authButton = document.getElementById('authButton');
        const hasToken = localStorage.getItem(GITHUB_TOKEN_KEY);
        authButton.textContent = hasToken ? 'Logout' : 'Login with GitHub';
        authButton.className = hasToken ? 'btn btn-outline-danger' : 'btn btn-outline-dark';
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
                    ...getAuthHeader()
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

    async function loadAppData(repoEntry) {
        if (!repoEntry.owner || !repoEntry.repo) {
            console.error('Invalid repo entry:', repoEntry);
            return null;
        }

        try {
            const [releases, repoInfo] = await Promise.all([
                cachedFetch(`https://api.github.com/repos/${repoEntry.owner}/${repoEntry.repo}/releases`),
                cachedFetch(`https://api.github.com/repos/${repoEntry.owner}/${repoEntry.repo}`)
            ]);

            return {
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

    function createAppCard(app) {
        const compatibleReleases = app.releases.filter(r => 
            processAssets(r.assets, app.os_overrides).some(a => a.os === userPlatform)
        );
        
        const isInstalled = installedApps.some(ia => ia.repoPath === `${app.author}/${app.originalRepo}`);
        const hasCompatible = compatibleReleases.length > 0;

        return `
            <div class="col mb-4" 
                 data-search="${app.title.toLowerCase()} 
                 ${app.originalRepo.toLowerCase()} 
                 ${app.author.toLowerCase()} 
                 ${app.description.toLowerCase()}">
                <div class="card h-100 shadow-sm">
                    <div class="card-body d-flex flex-column">
                        <div class="d-flex align-items-center mb-3">
                            <img src="${app.icon}" 
                                 class="app-icon rounded me-3" 
                                 alt="${app.title} icon"
                                 onerror="this.src='logo1x1.png'">
                            <div>
                                <h5 class="card-title mb-0">${app.title}</h5>
                                <div class="d-flex align-items-center gap-2 mt-1">
                                    <small class="text-muted">by ${app.author}</small>
                                    ${isInstalled ? '<span class="badge bg-success">Installed</span>' : ''}
                                </div>
                            </div>
                        </div>
                        <p class="card-text flex-grow-1">${app.description}</p>
                        <div class="d-flex gap-2 mt-auto">
                            <button class="btn ${hasCompatible ? 'btn-primary' : 'btn-secondary disabled'}" 
                                    data-repo="${app.author}/${app.originalRepo}"
                                    ${!hasCompatible ? 'disabled' : ''}>
                                ${isInstalled ? 'Reinstall' : 'Install'}
                            </button>
                            <button class="btn btn-outline-secondary dropdown-toggle" 
                                    data-bs-toggle="dropdown"
                                    data-repo="${app.author}/${app.originalRepo}">
                                Versions
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    async function showVersionModal(repoPath) {
        const app = allApps.find(a => `${a.author}/${a.originalRepo}` === repoPath);
        if (!app) return;

        const modal = new bootstrap.Modal(document.getElementById('downloadModal'));
        const modalBody = document.getElementById('downloadOptions');
        
        modalBody.innerHTML = `
            <div class="version-selector">
                <h5 class="mb-3">${app.title}</h5>
                <select class="form-select mb-4 version-select">
                    ${app.releases.map(r => `<option>${r.tag_name}</option>`).join('')}
                </select>
                <div class="os-options"></div>
            </div>
        `;

        const updateOptions = () => {
            const version = modalBody.querySelector('.version-select').value;
            const release = app.releases.find(r => r.tag_name === version);
            const options = processAssets(release?.assets || [], app.os_overrides);
            
            modalBody.querySelector('.os-options').innerHTML = options
                .map(({ os, ext, url, size }) => `
                    <div class="download-option mb-2">
                        <button class="btn btn-outline-dark w-100 text-start" 
                                onclick="window.electronAPI.downloadAsset('${url}', '${app.title}')">
                            <span class="badge bg-primary me-2">${os}</span>
                            .${ext} (${formatBytes(size)})
                        </button>
                    </div>
                `).join('') || '<div class="text-muted">No available downloads</div>';
        };

        modalBody.querySelector('.version-select').addEventListener('change', updateOptions);
        updateOptions();
        modal.show();
    }

    function processAssets(assets, osOverrides) {
        const seen = new Set();
        return assets
            .map(asset => {
                const ext = asset.name.split('.').pop().toLowerCase();
                if (['blockmap', 'yml', 'sha', 'sig', 'asc', 'txt', 'zsync', 'sym'].includes(ext)) return null;

                let os = Object.entries(osOverrides).find(([key]) => 
                    asset.name.toLowerCase().includes(key.toLowerCase())
                )?.[1];

                if (!os) {
                    const lowerName = asset.name.toLowerCase();
                    if (lowerName.includes('linux') || lowerName.includes('lin')) os = 'LINUX';
                    else if (lowerName.includes('win') || lowerName.includes('windows')) os = 'WINDOWS';
                    else if (lowerName.includes('mac') || lowerName.includes('osx') || lowerName.includes('darwin')) os = 'MACOS';
                    else if (['exe', 'msi', 'msix', 'appinstaller'].includes(ext)) os = 'WINDOWS';
                    else if (['dmg', 'pkg'].includes(ext)) os = 'MACOS';
                    else if (['deb', 'appimage', 'rpm', 'flatpak'].includes(ext)) os = 'LINUX';
                }

                const key = `${os}-${ext}`.toUpperCase();
                return os && !seen.has(key) ? (seen.add(key), {
                    os: os.toUpperCase(),
                    ext: ext.toUpperCase(),
                    url: asset.browser_download_url,
                    size: asset.size
                }) : null;
            })
            .filter(Boolean);
    }

    function renderInstalledApps() {
        const container = document.getElementById('installed-list');
        container.innerHTML = installedApps.map(app => `
            <div class="col mb-4">
                <div class="card h-100 shadow-sm">
                    <div class="card-body d-flex flex-column">
                        <h5 class="card-title">${app.title}</h5>
                        <p class="text-muted">${app.repoPath}</p>
                        <small class="install-path">Installed to: ${app.installPath}</small>
                        <div class="mt-auto pt-3">
                            <button class="btn btn-danger btn-sm uninstall-btn" 
                                    data-path="${app.installPath}">
                                Uninstall
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    async function init() {
        await detectPlatform();
        
        try {
            const repos = await window.electronAPI.fetchRepos();
            const loadedApps = (await Promise.all(repos.repos.map(loadAppData))).filter(app => app);
            allApps = loadedApps.sort((a, b) => b.stars - a.stars);
            
            document.getElementById('searchInput').addEventListener('input', e => {
                currentSearch = e.target.value.trim().toLowerCase();
                currentPage = 1;
                renderApps();
            });

            document.getElementById('apps').addEventListener('click', async e => {
                const btn = e.target.closest('button');
                if (!btn) return;

                const repoPath = btn.dataset.repo;
                if (btn.classList.contains('dropdown-toggle')) {
                    showVersionModal(repoPath);
                } 
                else if (btn.classList.contains('btn-primary')) {
                    const installPath = await window.electronAPI.openDialog({
                        properties: ['openDirectory']
                    });
                    
                    if (installPath) {
                        const appData = allApps.find(a => `${a.author}/${a.originalRepo}` === repoPath);
                        installedApps.push({
                            repoPath,
                            title: appData.title,
                            installPath,
                            installedAt: new Date()
                        });
                        localStorage.setItem('installedApps', JSON.stringify(installedApps));
                        renderApps();
                        renderInstalledApps();
                    }
                }
            });

            document.getElementById('installed-list').addEventListener('click', e => {
                if (e.target.classList.contains('uninstall-btn')) {
                    const path = e.target.dataset.path;
                    installedApps = installedApps.filter(ia => ia.installPath !== path);
                    localStorage.setItem('installedApps', JSON.stringify(installedApps));
                    renderInstalledApps();
                    renderApps();
                }
            });

            // Обновление репозиториев каждый час
            setInterval(async () => {
                try {
                    const repos = await window.electronAPI.fetchRepos();
                    const loadedApps = (await Promise.all(repos.repos.map(loadAppData))).filter(app => app);
                    allApps = loadedApps.sort((a, b) => b.stars - a.stars);
                    renderApps();
                } catch (error) {
                    console.error('Repo update failed:', error);
                }
            }, 3600000);

            updateAuthUI();
            renderApps();
            renderInstalledApps();
        } catch (error) {
            showError('Failed to load application data');
            console.error('Initialization error:', error);
        }
    }

    function renderApps() {
        const appsContainer = document.getElementById('apps');
        const filteredApps = allApps.filter(app => 
            app.title.toLowerCase().includes(currentSearch) ||
            app.originalRepo.toLowerCase().includes(currentSearch) ||
            app.author.toLowerCase().includes(currentSearch) ||
            app.description.toLowerCase().includes(currentSearch)
        );

        appsContainer.innerHTML = filteredApps
            .slice(0, currentPage * APPS_PER_PAGE)
            .map(createAppCard)
            .join('');
    }

    init();
});
