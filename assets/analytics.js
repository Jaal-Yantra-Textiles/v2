/**
 * JYT Analytics - Privacy-focused website analytics with real-time support
 * 
 * Features:
 * - Automatic pageview tracking
 * - SPA navigation support
 * - Custom event tracking
 * - Session management
 * - Real-time heartbeat for live visitor tracking
 * 
 * Usage:
 * <script src="/analytics.js" data-website-id="your_website_id" defer></script>
 */

(function() {
  'use strict';

  // Configuration
  const script = document.currentScript;
  const websiteId = script.getAttribute('data-website-id');
  const apiUrl = script.getAttribute('data-api-url') || 'https://v3.jaalyantra.com';
  const endpoint = `${apiUrl}/web/analytics/track`;
  const heartbeatInterval = 30000; // 30 seconds

  if (!websiteId) {
    console.warn('[Analytics] Missing data-website-id attribute');
    return;
  }

  // Generate or retrieve visitor ID (persistent across sessions)
  function getVisitorId() {
    const key = 'jyt_visitor_id';
    let visitorId = localStorage.getItem(key);
    
    if (!visitorId) {
      visitorId = 'visitor_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      localStorage.setItem(key, visitorId);
    }
    
    return visitorId;
  }

  // Generate or retrieve session ID (expires after 30 minutes of inactivity)
  function getSessionId() {
    const key = 'jyt_session_id';
    const timestampKey = 'jyt_session_timestamp';
    const sessionTimeout = 30 * 60 * 1000; // 30 minutes
    
    const now = Date.now();
    const lastActivity = parseInt(sessionStorage.getItem(timestampKey) || '0');
    
    // Check if session expired
    if (now - lastActivity > sessionTimeout) {
      sessionStorage.removeItem(key);
    }
    
    let sessionId = sessionStorage.getItem(key);
    
    if (!sessionId) {
      sessionId = 'session_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      sessionStorage.setItem(key, sessionId);
    }
    
    // Update last activity timestamp
    sessionStorage.setItem(timestampKey, now.toString());
    
    return sessionId;
  }

  // Track pageview
  function trackPageview() {
    const data = {
      website_id: websiteId,
      event_type: 'pageview',
      pathname: window.location.pathname,
      referrer: document.referrer || undefined,
      visitor_id: getVisitorId(),
      session_id: getSessionId(),
    };

    sendEvent(data);
  }

  // Track custom event
  function trackEvent(eventName, metadata) {
    const data = {
      website_id: websiteId,
      event_type: 'custom_event',
      event_name: eventName,
      pathname: window.location.pathname,
      visitor_id: getVisitorId(),
      session_id: getSessionId(),
      metadata: metadata || undefined,
    };

    sendEvent(data);
  }

  // Send event to API
  function sendEvent(data) {
    // Use sendBeacon for reliability (works even when page is closing)
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      navigator.sendBeacon(endpoint, blob);
    } else {
      // Fallback to fetch
      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        keepalive: true, // Keep request alive even if page closes
      }).catch(function(err) {
        // Silently fail - don't break the page
        if (console && console.error) {
          console.error('[Analytics] Failed to send event:', err);
        }
      });
    }
  }

  // Track initial pageview
  trackPageview();

  // Track pageviews on SPA navigation (for Next.js, React Router, etc.)
  let lastPath = window.location.pathname;
  
  function checkPathChange() {
    const currentPath = window.location.pathname;
    if (currentPath !== lastPath) {
      lastPath = currentPath;
      trackPageview();
    }
  }

  // Listen for history changes (SPA navigation)
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function() {
    originalPushState.apply(this, arguments);
    checkPathChange();
  };

  history.replaceState = function() {
    originalReplaceState.apply(this, arguments);
    checkPathChange();
  };

  window.addEventListener('popstate', checkPathChange);

  // Heartbeat for live visitor tracking
  // Sends a heartbeat event every 30 seconds while page is visible
  let heartbeatTimer = null;

  function startHeartbeat() {
    // Clear any existing timer
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }

    // Send heartbeat every 30 seconds
    heartbeatTimer = setInterval(() => {
      // Only send if page is visible
      if (document.visibilityState === 'visible') {
        trackEvent('heartbeat', {
          page: window.location.pathname,
          active: true,
        });
      }
    }, heartbeatInterval);
  }

  // Stop heartbeat when page becomes hidden
  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  // Handle visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      startHeartbeat();
    } else {
      stopHeartbeat();
    }
  });

  // Start heartbeat on load
  startHeartbeat();

  // Stop heartbeat on page unload
  window.addEventListener('beforeunload', stopHeartbeat);

  // Expose API for custom event tracking
  window.jytAnalytics = {
    track: trackEvent,
    trackPageview: trackPageview,
    startHeartbeat: startHeartbeat,
    stopHeartbeat: stopHeartbeat,
  };

  // Log initialization (can be removed in production)
  if (console && console.log) {
    console.log('[Analytics] Initialized for website:', websiteId);
    console.log('[Analytics] Heartbeat enabled (30s interval)');
  }
})();
