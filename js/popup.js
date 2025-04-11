// popup.js

import { StorageManager } from './storage.js';

let updateIntervalId;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await updateExtensionState();
        await updatePopupStats();
        startLiveUpdates(); // Start live updates immediately
        setupEventListeners();
        await setupCategoryManagement();
        await setupQuickCategories();
    } catch (error) {
        console.error('Error initializing popup:', error);
        showError('Failed to load stats');
    }
});



window.addEventListener('unload', () => {
    stopLiveUpdates();
});

function startLiveUpdates() {
    updateLiveTimers(); // Update immediately
    updateIntervalId = setInterval(updateLiveTimers, 1000);
}


function stopLiveUpdates() {
    if (updateIntervalId) {
        clearInterval(updateIntervalId);
        updateIntervalId = null;
    }
}

async function getCurrentSessionStartTime() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getCurrentSession' }, (response) => {
            if (response && response.startTime) {
                resolve(response.startTime);
            } else {
                resolve(null);
            }
        });
    });
}



async function updateLiveTimers() {
    try {
        const extensionEnabled = await getExtensionState();
        if (!extensionEnabled) {
            updateElement('realTimeTimer', 'Extension Disabled');
            return;
        }

        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];

        if (!currentTab?.url) {
            showError('Invalid tab');
            return;
        }

        const domain = new URL(currentTab.url).hostname;
        const data = await chrome.storage.local.get(['dailyData', 'timeLimits']);
        const today = getTodayDate();
        const todayData = data.dailyData?.[today] || { domains: {} };

        // Get accumulated time from dailyData
        const domainTimeSoFar = todayData.domains[domain] || 0;

        // Get current session increment if we're on this domain
        const currentSession = await getCurrentSession();
        let currentIncrement = 0;
        if (currentSession && currentSession.domain === domain && currentSession.startTime) {
            currentIncrement = Date.now() - currentSession.startTime;
        }

        const totalTimeSpent = domainTimeSoFar + currentIncrement;

        updateElement('timeSpent', formatTimeWithSeconds(totalTimeSpent));
        updateElement('totalTime', formatTimeWithSeconds((todayData.totalTime || 0) + currentIncrement));
        updateElement('realTimeTimer', formatTimeWithSeconds(currentIncrement));

        // Update time limit status
        const timeLimit = data.timeLimits?.[domain];
        updateTimeLimitStatus(domain, timeLimit, totalTimeSpent);

    } catch (error) {
        console.error('Error updating live timers:', error);
    }
}

async function updatePopupStats() {
    try {
        const extensionEnabled = await getExtensionState();
        if (!extensionEnabled) {
            updateElement('realTimeTimer', 'Extension Disabled');
            return;
        }

        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];

        if (!currentTab?.url) {
            showError('Invalid tab');
            return;
        }

        const domain = new URL(currentTab.url).hostname;
        updateElement('currentDomain', domain);

        // Get the current session time and last save time
        const currentSession = await getCurrentSession();
        const currentSessionTime = currentSession?.startTime ? 
            (Date.now() - currentSession.startTime) : 0;

        const data = await chrome.storage.local.get(['dailyData', 'timeLimits', 'categories']);
        const today = getTodayDate();
        const todayData = data.dailyData?.[today] || { categories: {}, domains: {}, totalTime: 0 };

        // Calculate total time for current domain including current session
        const domainStoredTime = todayData.domains[domain] || 0;
        const domainTotalTime = domain === currentSession?.domain ? 
            domainStoredTime + currentSessionTime : domainStoredTime;

        // Calculate total time for all domains including current session
        const totalStoredTime = todayData.totalTime || 0;
        const totalTime = totalStoredTime + currentSessionTime;

        // Update display elements
        updateElement('timeSpent', formatTimeWithSeconds(domainTotalTime));
        updateElement('totalTime', formatTimeWithSeconds(totalTime));

        // Update real-time timer for current session
        if (currentSession?.domain === domain && currentSession?.startTime) {
            updateElement('realTimeTimer', formatTimeWithSeconds(currentSessionTime));
        } else {
            updateElement('realTimeTimer', '00:00:00');
        }

        const currentCategory = await StorageManager.getCategoryForDomain(domain) || 'Uncategorized';
        updateElement('currentCategory', currentCategory);
        await updateCategoryDropdown(data.categories || {}, currentCategory);

        // Update time limit status with current total time
        const timeLimit = data.timeLimits?.[domain] || null;
        updateTimeLimitStatus(domain, timeLimit, domainTotalTime);

        // Calculate and update productivity score
        const categories = {...todayData.categories};
        if (currentSession?.domain === domain && currentCategory) {
            categories[currentCategory] = (categories[currentCategory] || 0) + currentSessionTime;
        }
        const score = StorageManager.calculateProductivityScore(categories);
        updateElement('productivityScore', `${Math.round(score)}%`);
        const scoreElement = document.getElementById('productivityScore');
        if (scoreElement) {
            scoreElement.style.color = getScoreColor(score);
        }
    } catch (error) {
        console.error('Error processing URL:', error);
        showError('Invalid URL');
    }
}

// Helper function to get current session
async function getCurrentSession() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getCurrentSession' }, (response) => {
            resolve(response || null);
        });
    });
}

async function setupCategoryManagement() {
    const data = await chrome.storage.local.get('categories');
    const categories = data.categories || {};
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const domain = new URL(tabs[0].url).hostname;
    const currentCategory = await StorageManager.getCategoryForDomain(domain);
    await updateCategoryDropdown(categories, currentCategory);
}

async function setupQuickCategories() {
    const data = await chrome.storage.local.get('categories');
    const categories = data.categories || {};
    const container = document.getElementById('quickCategoryButtons');

    if (container) {
        container.innerHTML = '';
        Object.keys(categories).forEach(category => {
            const button = document.createElement('button');
            button.className = 'category-tag';
            button.textContent = category;
            button.onclick = async () => {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const domain = new URL(tabs[0].url).hostname;
                await StorageManager.addWebsiteToCategory(domain, category);
                await updatePopupStats();
            };
            container.appendChild(button);
        });
    }
}

async function updateCategoryDropdown(categories, currentCategory) {
    const dropdown = document.getElementById('categoryDropdown');
    if (dropdown) {
        dropdown.innerHTML = '';

        // Ensure categories is an object
        categories = categories || {};

        // If categories object is empty, provide a default category
        if (Object.keys(categories).length === 0) {
            categories = { 'Uncategorized': [] };
        }

        Object.keys(categories).forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            if (category === currentCategory) {
                option.selected = true;
            }
            dropdown.appendChild(option);
        });

        dropdown.onchange = async () => {
            const selectedCategory = dropdown.value;
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const domain = new URL(tabs[0].url).hostname;
            await StorageManager.addWebsiteToCategory(domain, selectedCategory);
            await updatePopupStats();
        };
    }
}


function setupEventListeners() {
    setupButtonListener('showStats', () => chrome.tabs.create({ url: 'dashboard.html' }));
    setupButtonListener('refresh', updatePopupStats);
    setupButtonListener('addCategory', showCategoryModal);
    setupButtonListener('manageCategories', showManageCategoriesModal);
    setupButtonListener('resetStats', resetTodayStats);
    setupButtonListener('setTimeLimit', showTimeLimitModal);
    setupButtonListener('extensionToggle', toggleExtensionState);

    window.onclick = (event) => {
        if (event.target.classList.contains('modal')) {
            hideModals();
        }
    };
}

function setupButtonListener(id, handler) {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener('click', handler);
    }
}

async function getExtensionState() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getExtensionState' }, (response) => {
            resolve(response.enabled);
        });
    });
}

async function setExtensionState(enabled) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'setExtensionState', enabled }, () => {
            resolve();
        });
    });
}

async function updateExtensionState() {
    const extensionEnabled = await getExtensionState();
    const toggleButton = document.getElementById('extensionToggle');
    if (toggleButton) {
        toggleButton.textContent = extensionEnabled ? 'Turn Off' : 'Turn On';
        if (extensionEnabled) {
            toggleButton.classList.add('active');
        } else {
            toggleButton.classList.remove('active');
        }
    }
    if (extensionEnabled) {
        startLiveUpdates();
    } else {
        stopLiveUpdates();
        updateElement('realTimeTimer', 'Extension Disabled');
    }
}


async function toggleExtensionState() {
    const extensionEnabled = await getExtensionState();
    await setExtensionState(!extensionEnabled);
    await updateExtensionState();
    if (!extensionEnabled) {
        startLiveUpdates();
    } else {
        stopLiveUpdates();
        updateElement('realTimeTimer', 'Extension Disabled');
    }
    await updatePopupStats();
}

async function updateTimeLimitStatus(domain, timeLimit, timeSpent) {
    const statusElement = document.getElementById('timeLimitStatus');
    const remainingElement = document.getElementById('timeRemaining');

    if (statusElement && remainingElement) {
        if (timeLimit) {
            // Convert timeLimit from minutes to milliseconds for comparison
            const timeLimitMs = timeLimit * 60 * 1000;
            const remaining = Math.max(0, timeLimitMs - timeSpent);
            
            console.log('Time limit (minutes):', timeLimit);
            console.log('Time limit (ms):', timeLimitMs);
            console.log('Time spent:', timeSpent);
            console.log('Remaining time:', remaining);

            statusElement.textContent = 'Time limit active';
            remainingElement.textContent = formatTimeWithSeconds(remaining);
            remainingElement.style.color = remaining > 0 ? '#27ae60' : '#e74c3c';
        } else {
            statusElement.textContent = 'No limit set';
            remainingElement.textContent = '-';
        }
    }
}


function updateElement(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}

function formatTimeWithSeconds(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
}


function padZero(num) {
    return num.toString().padStart(2, '0');
}

function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

function getScoreColor(score) {
    if (score >= 80) return '#27ae60';
    if (score >= 60) return '#f1c40f';
    return '#e74c3c';
}

function showError(message) {
    const errorElement = document.getElementById('error');
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.display = 'block';
    }
}

function hideModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });
}

async function showTimeLimitModal() {
    const modal = document.getElementById('timeLimitModal');
    if (modal) {
        modal.style.display = 'block';
        await setupTimeLimit();

        const saveBtn = document.getElementById('saveTimeLimitBtn');
        const cancelBtn = document.getElementById('cancelTimeLimitBtn');
        const input = document.getElementById('timeLimitInput');

        saveBtn.onclick = async () => {
            const timeLimitMinutes = parseInt(input.value.trim(), 10);
            if (!isNaN(timeLimitMinutes) && timeLimitMinutes > 0) {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const domain = new URL(tabs[0].url).hostname;
                // Pass minutes directly to setTimeLimit
                await StorageManager.setTimeLimit(domain, timeLimitMinutes);
                await updatePopupStats();
                hideModals();
            } else {
                alert('Please enter a valid time limit in minutes.');
            }
        };

        cancelBtn.onclick = hideModals;
    }
}



async function setupTimeLimit() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const domain = new URL(tabs[0].url).hostname;
    const data = await chrome.storage.local.get('timeLimits');
    const timeLimit = data.timeLimits?.[domain];

    const input = document.getElementById('timeLimitInput');
    if (input) {
        input.value = timeLimit ? Math.floor(timeLimit / (60 * 1000)) : '';
    }
}

function showCategoryModal() {
    const modal = document.getElementById('categoryModal');
    if (modal) {
        modal.style.display = 'block';

        const saveBtn = document.getElementById('saveCategoryBtn');
        const cancelBtn = document.getElementById('cancelCategoryBtn');
        const input = document.getElementById('newCategoryInput');

        saveBtn.onclick = async () => {
            const timeLimitMinutes = parseInt(input.value.trim(), 10);
            if (!isNaN(timeLimitMinutes) && timeLimitMinutes > 0) {
                const timeLimitMs = timeLimitMinutes * 60 * 1000; // Correct conversion
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const domain = new URL(tabs[0].url).hostname;
                await StorageManager.setTimeLimit(domain, timeLimitMs);
                await updatePopupStats();
                hideModals();
            } else {
                alert('Please enter a valid time limit in minutes.');
            }
        };
        

        cancelBtn.onclick = hideModals;
        input.value = '';
    }
}

function showManageCategoriesModal() {
    const modal = document.getElementById('manageCategoriesModal');
    if (modal) {
        modal.style.display = 'block';
        refreshCategoryList();
    }
}

async function refreshCategoryList() {
    const categoryList = document.getElementById('categoryList');
    const data = await chrome.storage.local.get('categories');
    const categories = data.categories || {};

    if (categoryList) {
        categoryList.innerHTML = '';
        Object.entries(categories).forEach(([category, domains]) => {
            const item = document.createElement('div');
            item.className = 'category-item';
            item.innerHTML = `
                <span>${category}</span>
                <span>(${domains.length} sites)</span>
                <button class="icon-button delete-category" data-category="${category}">×</button>
            `;
            categoryList.appendChild(item);
        });

        document.querySelectorAll('.delete-category').forEach(button => {
            button.onclick = async () => {
                const category = button.dataset.category;
                if (confirm(`Delete category "${category}"?`)) {
                    await StorageManager.removeCategory(category);
                    await refreshCategoryList();
                    await refreshCategoryDropdown();
                    await setupQuickCategories();
                }
            };
        });
    }
}

async function refreshCategoryDropdown() {
    const data = await chrome.storage.local.get('categories');
    const categories = data.categories || {};
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const domain = new URL(tabs[0].url).hostname;
    const currentCategory = await StorageManager.getCategoryForDomain(domain);
    await updateCategoryDropdown(categories, currentCategory);
}

async function resetTodayStats() {
    if (confirm('Reset all stats for today?')) {
        await StorageManager.resetDailyStats();
        await updatePopupStats();
    }
}
