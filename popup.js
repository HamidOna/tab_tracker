import { StorageManager } from './storage.js';
import { tracker } from './tracker.js';

document.addEventListener('DOMContentLoaded', async () => {
    await loadPopup();
    await updateCurrentDomain();
    await updateTimeLimitStatus();
    setupResetStats();
    await updateTimeRemaining();    
    setupExtensionToggle();
});

async function loadPopup() {
    await populateCategoryDropdown();
    setupTimeLimitModal();
    setupCategoryModal();
    setupManageCategoriesModal();
}

async function populateCategoryDropdown() {
    const categoryDropdown = document.getElementById('categoryDropdown');
    const data = await chrome.storage.local.get('categories');
    const categories = data.categories || {};

    // Clear existing options
    categoryDropdown.innerHTML = '';

    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.text = 'Select Category';
    categoryDropdown.add(defaultOption);

    // Add categories
    Object.keys(categories).forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.text = category;
        categoryDropdown.add(option);
    });
}

function setupCategoryModal() {
    const addCategoryBtn = document.getElementById('addCategory');
    const categoryModal = document.getElementById('categoryModal');
    const cancelCategoryBtn = document.getElementById('cancelCategoryBtn');
    const saveCategoryBtn = document.getElementById('saveCategoryBtn');

    addCategoryBtn.addEventListener('click', () => {
        categoryModal.style.display = 'block';
    });

    cancelCategoryBtn.addEventListener('click', () => {
        categoryModal.style.display = 'none';
    });

    saveCategoryBtn.addEventListener('click', async () => {
        const newCategoryInput = document.getElementById('newCategoryInput');
        const categoryName = newCategoryInput.value.trim();
        if (categoryName) {
            await StorageManager.addCategory(categoryName);
            newCategoryInput.value = '';
            categoryModal.style.display = 'none';
            await populateCategoryDropdown();
        }
    });
}
async function setupExtensionToggle() {
    const extensionToggleBtn = document.getElementById('extensionToggle');
    const extensionState = await tracker.loadExtensionState();

    // Set initial state of the button
    extensionToggleBtn.textContent = extensionState ? 'Turn Off' : 'Turn On';

    extensionToggleBtn.addEventListener('click', async () => {
        await tracker.toggleExtension();
        const newState = await tracker.loadExtensionState();
        if (newState) {
            extensionToggleBtn.textContent = 'Turn Off';
        } else {
            extensionToggleBtn.textContent = 'Turn On';
        }
    });
}


function setupTimeLimitModal() {
    const removeTimeLimitBtn = document.getElementById('removeTimeLimit');

    removeTimeLimitBtn.addEventListener('click', async () => {
        const currentDomain = await getCurrentDomain();
        if(currentDomain) {
            await StorageManager.removeTimeLimit(currentDomain);
            await updateTimeLimitStatus();
        }
    });    
}

function setupTimeLimitModal() {
    const setTimeLimitBtn = document.getElementById('setTimeLimit');
    const timeLimitModal = document.getElementById('timeLimitModal');
    const cancelTimeLimitBtn = document.getElementById('cancelTimeLimitBtn');
    const saveTimeLimitBtn = document.getElementById('saveTimeLimitBtn');

    setTimeLimitBtn.addEventListener('click', () => {
        timeLimitModal.style.display = 'block';
    });

    cancelTimeLimitBtn.addEventListener('click', () => {
        timeLimitModal.style.display = 'none';
    });

    saveTimeLimitBtn.addEventListener('click', async () => {
        const timeLimitInput = document.getElementById('timeLimitInput');
        const timeLimitMinutes = parseInt(timeLimitInput.value, 10);
        if (!isNaN(timeLimitMinutes) && timeLimitMinutes > 0) {
            const currentDomain = await getCurrentDomain();
            if (currentDomain) {
                await StorageManager.setTimeLimit(currentDomain, timeLimitMinutes);
                timeLimitInput.value = '';
                timeLimitModal.style.display = 'none';
                await updateTimeLimitStatus();
            }
        }
    });
    

}

function setupManageCategoriesModal() {
    const manageCategoriesBtn = document.getElementById('manageCategories');
    const manageCategoriesModal = document.getElementById('manageCategoriesModal');
    const closeManageCategoryModal = document.querySelector('.close-manage-category-modal');

    manageCategoriesBtn.addEventListener('click', async () => {
        await populateManageCategoriesModal();
        manageCategoriesModal.style.display = 'block';
    });

    closeManageCategoryModal.addEventListener('click', () => {
        manageCategoriesModal.style.display = 'none';
    });

}

async function populateManageCategoriesModal() {
    const categoryList = document.getElementById('categoryList');
    categoryList.innerHTML = '';

    const data = await chrome.storage.local.get('categories');
    const categories = data.categories || {};

    Object.entries(categories).forEach(([category, domains]) => {
        const listItem = document.createElement('div');
        listItem.innerHTML = `
            <span>${category}</span>
            <input type="text" class="domain-input" placeholder="Add domain">
            <button class="add-domain-btn" data-category="${category}">Add</button>
            <button class="remove-category-btn" data-category="${category}">Remove</button>
            <ul class="domain-list"></ul>
        `;
        categoryList.appendChild(listItem);
    });
    loadDomainsToCategories();
    addDomainEventListeners();
    addRemoveEventListeners();
}
async function loadDomainsToCategories() {
    const data = await chrome.storage.local.get('categories');
    const categories = data.categories || {};

    Object.entries(categories).forEach(([category, domains]) => {
        const domainList = document.querySelector(`[data-category="${category}"]`).parentNode.querySelector('.domain-list');
        domains.forEach(domain => {
            const domainItem = document.createElement('li');
            domainItem.textContent = domain;
            domainList.appendChild(domainItem);
        });
    });
}

async function setupResetStats() {
    const resetStatsBtn = document.getElementById('resetStats');
    resetStatsBtn.addEventListener('click', async () => {
        await StorageManager.resetDailyStats();
        chrome.runtime.sendMessage({ action: "reloadDashboard" });
    });
}

async function updateTimeLimitStatus() {
    const currentDomain = await getCurrentDomain();
    const timeLimit = await StorageManager.getTimeLimit(currentDomain);
    const timeLimitStatusElement = document.getElementById('timeLimitStatus');
    if (timeLimitStatusElement) {
        if (timeLimit) {
            timeLimitStatusElement.textContent = `Time limit set: ${timeLimit} minutes`;
        } else {
            timeLimitStatusElement.textContent = 'No time limit set';
        }
    }
}
async function updateTimeRemaining() {
    const currentDomain = await getCurrentDomain();
    const timeLimitMinutes = await StorageManager.getTimeLimit(currentDomain);
    const timeRemainingElement = document.getElementById('timeRemaining');
    if(timeRemainingElement && timeLimitMinutes){
        const timeLimitMs = timeLimitMinutes * 60 * 1000;
        let elapsedTimeMs = 0;
        
        let intervalId = setInterval(() => {
            const remainingTimeMs = timeLimitMs - elapsedTimeMs;
            if (remainingTimeMs <= 0) {
                timeRemainingElement.textContent = "00:00:00";
                clearInterval(intervalId);
            } else {
                elapsedTimeMs += 1000;
                const remainingSeconds = Math.floor(remainingTimeMs / 1000);
                const hours = Math.floor(remainingSeconds / 3600);
                const minutes = Math.floor((remainingSeconds % 3600) / 60);
                const seconds = remainingSeconds % 60;
                timeRemainingElement.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }
    
    

}
async function getCurrentDomain() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return new URL(tabs[0].url).hostname;
}

function addDomainEventListeners() {
    const addDomainBtns = document.querySelectorAll('.add-domain-btn');
    addDomainBtns.forEach(btn => {
        btn.addEventListener('click', async (event) => {
            const category = event.target.dataset.category;
            const domainInput = event.target.parentNode.querySelector('.domain-input');
            const domain = domainInput.value.trim();
            if (domain) {
                await StorageManager.addWebsiteToCategory(domain, category);
                domainInput.value = '';
                const domainList = event.target.parentNode.querySelector('.domain-list');
                domainList.innerHTML = ''; // Clear existing list
                await loadDomainsToCategories();
                console.log(`Added domain: ${domain} to category: ${category}`);
            }
        });
    });
}
function addRemoveEventListeners() {
    const removeBtns = document.querySelectorAll('.remove-category-btn');
    removeBtns.forEach(btn => {
        btn.addEventListener('click', async (event) => {
            const category = event.target.dataset.category;
            await StorageManager.removeCategory(category);
            event.target.parentNode.remove();
            await populateCategoryDropdown();
            console.log(`Removed category: ${category}`);
        });
    });
}