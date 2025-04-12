// js/content.js

// Listen for changes in the URL
let currentDomain = window.location.hostname;
chrome.runtime.sendMessage({ type: "pageChange", domain: currentDomain });

const observer = new MutationObserver(() => {
    if (currentDomain !== window.location.hostname) {
        currentDomain = window.location.hostname;
        chrome.runtime.sendMessage({ type: "pageChange", domain: currentDomain });
    }
});

observer.observe(document.documentElement, { childList: true, subtree: true });
