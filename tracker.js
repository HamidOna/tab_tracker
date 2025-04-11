import { StorageManager } from './storage.js';

export class TimeTracker {
    constructor() {
        this.currentTabId = null;
        this.currentDomain = null;
        this.startTime = null;
        this.currentCategory = null;
        this.timeLimitInterval = null;
        this.extensionEnabled = true;
    }

    async initialize() {
        await this.loadExtensionState();
        this.startTracking();
        this.setupListeners();
    }

    setupListeners() {
        chrome.tabs.onActivated.addListener(async (activeInfo) => {
            if (this.extensionEnabled) {
                await this.handleTabChange(activeInfo.tabId);
            }
        });

        chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
            if (this.extensionEnabled && changeInfo.status === 'complete' && tab.active) {
                await this.handleTabChange(tabId);
            }
        });

        chrome.windows.onFocusChanged.addListener(async (windowId) => {
            if (this.extensionEnabled && windowId !== chrome.windows.WINDOW_ID_NONE) {
                const tabs = await chrome.tabs.query({ active: true, windowId });
                if (tabs.length > 0) {
                    await this.handleTabChange(tabs[0].id);
                }
            }
        });
        chrome.runtime.onMessage.addListener((request) => {
            if (request.action === "reloadDashboard") {
                chrome.runtime.sendMessage({ action: "reloadDashboard" });
            }
        });
    }

    async handleTabChange(tabId) {
        if (this.currentTabId) {
            await this.stopTracking();
        }
        this.currentTabId = tabId;
        await this.startTracking();
    }

    async startTracking() {
        if (!this.currentTabId) {
            return;
        }
        const tab = await chrome.tabs.get(this.currentTabId);
        if (!tab || !tab.url) {
            return;
        }
        this.currentDomain = new URL(tab.url).hostname;
        this.currentCategory = await StorageManager.getCategoryForDomain(this.currentDomain);
        this.startTime = new Date();
        this.startTimeLimitCheck();
    }
    async stopTracking() {
        if (!this.startTime || !this.currentDomain || !this.currentCategory) {
            return;
        }
        const endTime = new Date();
        const duration = endTime - this.startTime;
        const date = new Date().toISOString().split('T')[0];

        const visitData = {
            date,
            domain: this.currentDomain,
            category: this.currentCategory,
            duration
        };
        await StorageManager.saveTimeEntry(visitData);

        this.startTime = null;
        this.currentDomain = null;
        this.currentCategory = null;
        this.clearTimeLimitCheck();
    }

    startTimeLimitCheck() {
        this.timeLimitInterval = setInterval(async () => {
            const timeLimitMinutes = await StorageManager.getTimeLimit(this.currentDomain);
            if (timeLimitMinutes) {
                const totalTimeSpent = await this.getTotalTimeSpentOnDomainToday();
                if (totalTimeSpent > timeLimitMinutes * 60 * 1000) {
                    this.notifyTimeLimitExceeded(this.currentDomain);
                    this.clearTimeLimitCheck();
                }
            }
        }, 1000);
        console.log("Time limit interval started");
    }
    clearTimeLimitCheck() {
        if (this.timeLimitInterval) {
            clearInterval(this.timeLimitInterval);
            console.log("Time limit interval cleared");
        }
    }

    notifyTimeLimitExceeded(domain) {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'images/icon128.png',
            title: 'Time Limit Exceeded',
            message: `You've exceeded your time limit on ${domain}!`
        });
        console.log("Time limit notification created");
    }

    async getTotalTimeSpentOnDomainToday() {
        const today = new Date().toISOString().slice(0, 10);
        const data = await chrome.storage.local.get(['dailyData']);
        const todayData = data.dailyData?.[today];
        if (todayData && todayData.domains) {
            return todayData.domains[this.currentDomain] || 0;
        }
        return 0;
    }

    static formatTime(totalMs) {
        const totalSeconds = Math.floor(totalMs / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    async toggleExtension() {
        this.extensionEnabled = !this.extensionEnabled;
        await this.saveExtensionState();
        if (this.extensionEnabled) {
            this.startTracking();
        } else {
            this.stopTracking();
        }
    }
    async loadExtensionState() {
        const data = await chrome.storage.local.get('extensionEnabled');
        this.extensionEnabled = data.extensionEnabled !== undefined ? data.extensionEnabled : true;
    }

    async saveExtensionState() {
        await chrome.storage.local.set({ extensionEnabled: this.extensionEnabled });
    }

}

const tracker = new TimeTracker();
tracker.initialize();

function formatTime(totalMs) {
    const totalSeconds = Math.floor(totalMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}