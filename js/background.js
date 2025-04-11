// background.js

import { StorageManager } from './storage.js';

let currentSession = {
    domain: null,
    startTime: null,
    lastSaveTime: null
};

let timeLimitNotified = {};
let isSessionSaving = false;  // Lock flag
let lastSaveTimestamp = 0;    // Track last save time
const MIN_SAVE_INTERVAL = 2000; // Minimum 2 seconds between saves


// Initialize the extension
(async function initialize() {
    const data = await chrome.storage.local.get(['currentSession', 'timeLimitNotified']);
    currentSession = data.currentSession || { domain: null, startTime: null };
    timeLimitNotified = data.timeLimitNotified || {};
    setupEventListeners();
})();

// Save currentSession to storage whenever it changes
async function updateCurrentSession(session) {
    currentSession = session;
    await chrome.storage.local.set({ currentSession });
}

// Save timeLimitNotified to storage whenever it changes
async function updateTimeLimitNotified(domain, value) {
    timeLimitNotified[domain] = value;
    await chrome.storage.local.set({ timeLimitNotified });
}

// Event listeners are set up after initialization
function setupEventListeners() {
    chrome.runtime.onInstalled.addListener(async () => {
        await StorageManager.initializeDefaultCategories();
        await chrome.storage.local.set({ extensionEnabled: false });
        console.log('Tab Time Tracker extension installed and initialized.');
    });

    // Listen for tab updates
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        if (changeInfo.status === 'complete' && tab.active) {
            console.log('Tab updated trigger:', { tabId, url: tab.url });
            await handleTabChange(tab);
        }
    });

    // Listen for tab activation (when the user switches tabs)
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
        console.log('Tab activated trigger:', activeInfo);
        const tab = await chrome.tabs.get(activeInfo.tabId);
        await handleTabChange(tab);
    });

    // Listen for window focus changes
    chrome.windows.onFocusChanged.addListener(async (windowId) => {
        console.log('Window focus changed trigger:', windowId);
        if (windowId === chrome.windows.WINDOW_ID_NONE) {
            await saveCurrentSession();
        } else {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                await handleTabChange(tab);
            }
        }
    });

    // Use alarms to keep the service worker alive
    chrome.alarms.create('keepAlive', { periodInMinutes: 1 });

    chrome.alarms.onAlarm.addListener(async (alarm) => {
        if (alarm.name === 'keepAlive') {
            console.log('Alarm trigger');
            await saveCurrentSession();
        }
    });

    // Listen for messages from popup.js
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'getCurrentSession') {
            sendResponse({
                startTime: currentSession.startTime,
                domain: currentSession.domain
            });
        } else if (request.action === 'processCurrentSession') {
            saveCurrentSession().then(sendResponse);
            return true;
        } else if (request.action === 'getExtensionState') {
            chrome.storage.local.get('extensionEnabled', (data) => {
                sendResponse({ enabled: data.extensionEnabled === true });
            });
            return true;
        } else if (request.action === 'setExtensionState') {
            chrome.storage.local.set({ extensionEnabled: request.enabled }, () => {
                sendResponse();
            });
            return true;
        }else if(request.action === "reloadDashboard"){
            console.log("Reloading dashboard");
            chrome.runtime.sendMessage({ action: "reloadDashboard" });
            return true;
        }
        return true;
    });

    // Handle when the extension is enabled or disabled
    chrome.storage.onChanged.addListener(async (changes, areaName) => {
        if (areaName === 'local' && changes.extensionEnabled !== undefined) {
            const enabled = changes.extensionEnabled.newValue === true;
            if (!enabled) {
                await disableExtension();
            } else {
                // Extension has been enabled, start tracking the active tab
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab) {
                    await handleTabChange(tab);
                }
            }
        }
    });
}

// Function to handle tab changes
async function handleTabChange(tab) {
    const extensionEnabled = await isExtensionEnabled();
    if (!extensionEnabled) {
        await saveCurrentSession();
        return;
    }

    const url = tab.url;
    if (!url || !isValidUrl(url)) {
        return;
    }

    const domain = new URL(url).hostname;
    console.log('Handle tab change:', {
        previousDomain: currentSession.domain,
        newDomain: domain,
    });

    if (currentSession.domain !== domain) {
        await saveCurrentSession();
        await startNewSession(domain); // Replace continueDomainSession with startNewSession
    }
}


// Function to start a new session
async function startNewSession(domain) {
    const now = Date.now();
    const session = {
        domain: domain,
        startTime: now,
        lastSaveTime: now
    };
    
    console.log('Starting new session:', {
        domain,
        startTime: now
    });
    
    await updateCurrentSession(session);
}


// Function to save the current session
async function saveCurrentSession() {
    if (!currentSession.domain || !currentSession.startTime) return;

    const now = Date.now();
    const durationIncrement = now - (currentSession.lastSaveTime || currentSession.startTime);
    
    if (durationIncrement > 1000) {
        try {
            const category = await StorageManager.getCategoryForDomain(currentSession.domain);
            const date = getTodayDate();
            
            // Get existing data
            const data = await chrome.storage.local.get(['dailyData']);
            const dailyData = data.dailyData || {};
            const todayData = dailyData[date] || { domains: {}, categories: {}, totalTime: 0 };
            
            // Calculate new total for domain
            const existingDomainTime = todayData.domains[currentSession.domain] || 0;
            const newDomainTime = existingDomainTime + durationIncrement;
            
            const visitData = {
                domain: currentSession.domain,
                category: category,
                date: date,
                duration: durationIncrement,
                newTotal: newDomainTime
            };
            
            await StorageManager.saveTimeEntry(visitData);
            await checkTimeLimit(currentSession.domain);
            
            currentSession.lastSaveTime = now;
            await updateCurrentSession(currentSession);
            
            console.log('Session saved:', {
                domain: currentSession.domain,
                durationIncrement,
                newTotal: newDomainTime
            });
        } catch (error) {
            console.error('Error saving session:', error);
        }
    }
}

async function continueDomainSession(domain) {
    const domainTimeSoFar = await getDomainTimeSoFar(domain);
    const now = Date.now();
    
    const session = {
        domain: domain,
        startTime: now - domainTimeSoFar, // Back-calculate start time to maintain continuity
        lastSaveTime: now
    };
    
    console.log('Continuing domain session:', {
        domain,
        domainTimeSoFar,
        calculatedStartTime: session.startTime,
        now
    });
    
    await updateCurrentSession(session);
}

async function getDomainTimeSoFar(domain) {
    const date = getTodayDate();
    const data = await chrome.storage.local.get('dailyData');
    const dailyData = data.dailyData || {};
    const todayData = dailyData[date] || { domains: {} };
    return todayData.domains[domain] || 0;
}


// Function to check time limit for a domain
async function checkTimeLimit(domain) {
    const timeLimit = await StorageManager.getTimeLimit(domain);
    if (timeLimit) {
        console.log('Checking time limit for domain:', domain);
        console.log('Time limit (minutes):', timeLimit);

        const data = await chrome.storage.local.get('dailyData');
        const today = getTodayDate();
        const todayData = data.dailyData?.[today] || { domains: {} };
        const totalTime = todayData.domains[domain] || 0;

        // Convert timeLimit from minutes to milliseconds for comparison
        const timeLimitMs = timeLimit * 60 * 1000;
        console.log('Time limit (ms):', timeLimitMs);
        console.log('Total time spent:', totalTime);

        if (totalTime >= timeLimitMs && !timeLimitNotified[domain]) {
            try {
                chrome.notifications.create('', {
                    type: 'basic',
                    iconUrl: chrome.runtime.getURL('images/icon128.png'),
                    title: 'Time Limit Reached',
                    message: `You have reached your time limit for ${domain}`,
                    priority: 2
                }, (notificationId) => {
                    if (chrome.runtime.lastError) {
                        console.error('Notification Error:', chrome.runtime.lastError);
                    }
                });
                await updateTimeLimitNotified(domain, true);
            } catch (error) {
                console.error('Error creating notification:', error);
            }
        } else if (totalTime < timeLimitMs) {
            await updateTimeLimitNotified(domain, false);
        }
    } else {
        // If time limit is removed, reset the notification flag
        await updateTimeLimitNotified(domain, false);
    }
}


// Function to check if a URL is valid for tracking
function isValidUrl(url) {
    return /^https?:\/\//.test(url);
}

// Function to get today's date in YYYY-MM-DD format
function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

// Function to check if the extension is enabled
async function isExtensionEnabled() {
    const data = await chrome.storage.local.get('extensionEnabled');
    return data.extensionEnabled === true; // Default to false if not set
}

// Handle when the extension is disabled
async function disableExtension() {
    await saveCurrentSession();
    await updateCurrentSession({ domain: null, startTime: null });
}
