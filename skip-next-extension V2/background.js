// Background service worker for Skip & Next Controller
chrome.runtime.onInstalled.addListener(() => {
  console.log('Skip & Next Controller installed');
});

// Inject script into active tabs when extension starts
chrome.runtime.onStartup.addListener(() => {
  injectIntoAllTabs();
});

// Inject script when tabs are updated/navigated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Only inject in http/https pages
    if (tab.url.startsWith('http://') || tab.url.startsWith('https://')) {
      injectScript(tabId);
    }
  }
});

// Function to inject script into a specific tab
async function injectScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['inject.js']
    });
  } catch (error) {
    // Silently handle errors (e.g., chrome:// pages, extensions pages)
    console.log('Could not inject script into tab:', tabId);
  }
}

// Function to inject script into all tabs
async function injectIntoAllTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    
    for (const tab of tabs) {
      if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        injectScript(tab.id);
      }
    }
  } catch (error) {
    console.error('Error injecting into tabs:', error);
  }
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSettings') {
    chrome.storage.local.get(['skipNextSettings'], (result) => {
      sendResponse(result.skipNextSettings || {});
    });
    return true; // Indicates async response
  }
  
  if (request.action === 'saveSettings') {
    chrome.storage.local.set({ skipNextSettings: request.settings }, () => {
      sendResponse({ success: true });
    });
    return true; // Indicates async response
  }
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
    injectScript(tab.id);
  }
});