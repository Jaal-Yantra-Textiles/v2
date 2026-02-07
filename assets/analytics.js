/**
 * JYT Analytics - Privacy-focused website analytics with real-time support
 *
 * Features:
 * - Automatic pageview tracking
 * - SPA navigation support
 * - Custom event tracking
 * - Session management
 * - Real-time heartbeat for live visitor tracking
 * - Conversion tracking (purchases, leads, add to cart)
 * - Customer journey tracking
 * - Scroll depth and engagement tracking
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
  const enableJourney = script.getAttribute('data-enable-journey') !== 'false';
  const enableScrollTracking = script.getAttribute('data-enable-scroll') !== 'false';
  const enableEngagement = script.getAttribute('data-enable-engagement') !== 'false';

  // Endpoints
  const analyticsEndpoint = `${apiUrl}/web/analytics/track`;
  const conversionEndpoint = `${apiUrl}/web/ad-planning/track-conversion`;
  const journeyEndpoint = `${apiUrl}/web/ad-planning/track-journey`;

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

  // Extract UTM parameters from URL
  function getUTMParams() {
    const params = new URLSearchParams(window.location.search);
    const utm = {};

    const utmParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    utmParams.forEach(function(param) {
      const value = params.get(param);
      if (value) {
        utm[param] = value;
      }
    });

    // Store UTM params for later use (for conversions)
    if (Object.keys(utm).length > 0) {
      sessionStorage.setItem('jyt_utm', JSON.stringify(utm));
    }

    return Object.keys(utm).length > 0 ? utm : undefined;
  }

  // Get stored UTM params (for conversions that happen after initial landing)
  function getStoredUTMParams() {
    try {
      const stored = sessionStorage.getItem('jyt_utm');
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      return {};
    }
  }

  // Get query string (without leading ?)
  function getQueryString() {
    const search = window.location.search;
    return search ? search.substring(1) : undefined;
  }

  // Detect 404 errors
  function is404Page() {
    const title = document.title.toLowerCase();
    const body = document.body ? document.body.textContent.toLowerCase() : '';

    return title.includes('404') ||
           title.includes('not found') ||
           body.includes('page not found') ||
           body.includes('404 error');
  }

  // Send data to endpoint
  function sendData(endpoint, data) {
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
        keepalive: true,
      }).catch(function(err) {
        if (console && console.error) {
          console.error('[Analytics] Failed to send data:', err);
        }
      });
    }
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
      query_string: getQueryString(),
      is_404: is404Page(),
    };

    // Add UTM parameters if present
    const utmParams = getUTMParams();
    if (utmParams) {
      Object.assign(data, utmParams);
    }

    sendData(analyticsEndpoint, data);

    // Track as journey event if enabled
    if (enableJourney) {
      trackJourney('page_view', {
        page_url: window.location.href,
        page_title: document.title,
        referrer: document.referrer,
      });
    }
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

    sendData(analyticsEndpoint, data);
  }

  // Track customer journey event
  function trackJourney(eventType, eventData, options = {}) {
    if (!enableJourney) return;

    const utmParams = getStoredUTMParams();

    const data = {
      website_id: websiteId,
      event_type: eventType,
      event_name: options.event_name || eventType,
      event_data: eventData || null,
      channel: options.channel || 'web',
      stage: options.stage || undefined,
      visitor_id: getVisitorId(),
      person_id: options.person_id || null,
      page_url: window.location.href,
      utm_source: utmParams.utm_source || undefined,
      utm_campaign: utmParams.utm_campaign || undefined,
      source_type: options.source_type || null,
      source_id: options.source_id || null,
      metadata: options.metadata || null,
    };

    sendData(journeyEndpoint, data);
  }

  // Track conversion
  function trackConversion(conversionType, options = {}) {
    const utmParams = getStoredUTMParams();

    const data = {
      website_id: websiteId,
      conversion_type: conversionType,
      conversion_name: options.name || null,
      pathname: window.location.pathname,
      visitor_id: getVisitorId(),
      session_id: getSessionId(),
      conversion_value: options.value || null,
      currency: options.currency || 'INR',
      order_id: options.orderId || null,
      utm_source: utmParams.utm_source || undefined,
      utm_medium: utmParams.utm_medium || undefined,
      utm_campaign: utmParams.utm_campaign || undefined,
      utm_term: utmParams.utm_term || undefined,
      utm_content: utmParams.utm_content || undefined,
      metadata: options.metadata || null,
    };

    sendData(conversionEndpoint, data);

    // Track as custom event for analytics
    trackEvent('conversion', {
      conversion_type: conversionType,
      value: options.value,
      currency: options.currency,
      order_id: options.orderId,
    });

    // Track in journey if enabled
    if (enableJourney) {
      let stage = 'conversion';
      if (conversionType === 'add_to_cart') stage = 'intent';
      if (conversionType === 'begin_checkout') stage = 'intent';
      if (conversionType === 'lead_form_submission') stage = 'consideration';

      trackJourney(conversionType === 'purchase' ? 'purchase' : 'custom', {
        conversion_type: conversionType,
        value: options.value,
        order_id: options.orderId,
      }, { stage });
    }
  }

  // Convenience methods for common conversions
  function trackPurchase(orderId, value, currency = 'INR', metadata = {}) {
    trackConversion('purchase', {
      orderId,
      value,
      currency,
      metadata,
    });
  }

  function trackLeadForm(formName, metadata = {}) {
    trackConversion('lead_form_submission', {
      name: formName,
      metadata: { form_name: formName, ...metadata },
    });

    // Also track as journey event
    if (enableJourney) {
      trackJourney('form_submit', {
        form_name: formName,
        ...metadata,
      }, { stage: 'consideration' });
    }
  }

  function trackAddToCart(productId, value, currency = 'INR', metadata = {}) {
    trackConversion('add_to_cart', {
      value,
      currency,
      metadata: { product_id: productId, ...metadata },
    });
  }

  function trackBeginCheckout(value, currency = 'INR', metadata = {}) {
    trackConversion('begin_checkout', {
      value,
      currency,
      metadata,
    });
  }

  // Track scroll depth
  let maxScrollDepth = 0;
  let scrollDepthMilestones = [25, 50, 75, 90, 100];
  let trackedMilestones = new Set();

  function trackScrollDepth() {
    if (!enableScrollTracking) return;

    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const docHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    ) - window.innerHeight;

    if (docHeight <= 0) return;

    const scrollPercent = Math.round((scrollTop / docHeight) * 100);

    if (scrollPercent > maxScrollDepth) {
      maxScrollDepth = scrollPercent;

      // Check milestones
      scrollDepthMilestones.forEach(function(milestone) {
        if (scrollPercent >= milestone && !trackedMilestones.has(milestone)) {
          trackedMilestones.add(milestone);

          trackConversion('scroll_depth', {
            name: `Scroll ${milestone}%`,
            metadata: { depth: milestone, page: window.location.pathname },
          });
        }
      });
    }
  }

  // Track time on page
  let pageLoadTime = Date.now();
  let timeOnPageMilestones = [30, 60, 120, 300]; // seconds
  let trackedTimeMilestones = new Set();

  function trackTimeOnPage() {
    if (!enableEngagement) return;

    const timeOnPage = Math.round((Date.now() - pageLoadTime) / 1000);

    timeOnPageMilestones.forEach(function(milestone) {
      if (timeOnPage >= milestone && !trackedTimeMilestones.has(milestone)) {
        trackedTimeMilestones.add(milestone);

        trackConversion('time_on_site', {
          name: `Time ${milestone}s`,
          metadata: { seconds: milestone, page: window.location.pathname },
        });
      }
    });
  }

  // Track initial pageview
  trackPageview();

  // Track pageviews on SPA navigation
  let lastPath = window.location.pathname;

  function checkPathChange() {
    const currentPath = window.location.pathname;
    if (currentPath !== lastPath) {
      lastPath = currentPath;

      // Reset scroll and time tracking for new page
      maxScrollDepth = 0;
      trackedMilestones = new Set();
      pageLoadTime = Date.now();
      trackedTimeMilestones = new Set();

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

  // Scroll tracking with throttle
  let scrollThrottleTimer = null;
  window.addEventListener('scroll', function() {
    if (scrollThrottleTimer) return;
    scrollThrottleTimer = setTimeout(function() {
      scrollThrottleTimer = null;
      trackScrollDepth();
    }, 250);
  }, { passive: true });

  // Time on page tracking
  setInterval(trackTimeOnPage, 10000); // Check every 10 seconds

  // Heartbeat for live visitor tracking
  let heartbeatTimer = null;

  function startHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }

    heartbeatTimer = setInterval(function() {
      if (document.visibilityState === 'visible') {
        trackEvent('heartbeat', {
          page: window.location.pathname,
          active: true,
          scroll_depth: maxScrollDepth,
          time_on_page: Math.round((Date.now() - pageLoadTime) / 1000),
        });
      }
    }, heartbeatInterval);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  // Handle visibility changes
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      startHeartbeat();
    } else {
      stopHeartbeat();
    }
  });

  // Start heartbeat on load
  startHeartbeat();

  // Stop heartbeat and send final data on page unload
  window.addEventListener('beforeunload', function() {
    stopHeartbeat();

    // Send final engagement data
    if (enableEngagement && maxScrollDepth > 0) {
      trackEvent('page_engagement', {
        page: window.location.pathname,
        max_scroll_depth: maxScrollDepth,
        time_on_page: Math.round((Date.now() - pageLoadTime) / 1000),
      });
    }
  });

  // Auto-track form submissions
  function setupFormTracking() {
    document.addEventListener('submit', function(e) {
      const form = e.target;
      if (form.tagName !== 'FORM') return;

      const formName = form.getAttribute('name') ||
                       form.getAttribute('id') ||
                       form.getAttribute('data-form-name') ||
                       'unnamed_form';

      // Check if it should be tracked as lead form
      const isLeadForm = form.getAttribute('data-track-lead') === 'true' ||
                         form.classList.contains('lead-form') ||
                         form.classList.contains('contact-form');

      if (isLeadForm) {
        trackLeadForm(formName, {
          form_action: form.action,
          form_method: form.method,
        });
      } else {
        // Track as journey event
        if (enableJourney) {
          trackJourney('form_submit', {
            form_name: formName,
            form_action: form.action,
          }, { stage: 'consideration' });
        }
      }
    }, true);
  }

  // Auto-track outbound link clicks
  function setupOutboundTracking() {
    document.addEventListener('click', function(e) {
      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      // Check if outbound
      try {
        const url = new URL(href, window.location.origin);
        if (url.hostname !== window.location.hostname) {
          trackEvent('outbound_click', {
            url: href,
            text: link.textContent?.substring(0, 100),
            page: window.location.pathname,
          });
        }
      } catch (e) {
        // Invalid URL, ignore
      }
    }, true);
  }

  // Initialize auto-tracking
  setupFormTracking();
  setupOutboundTracking();

  // Identify user (for logged-in users)
  function identify(personId, traits = {}) {
    // Store person ID for journey tracking
    sessionStorage.setItem('jyt_person_id', personId);

    trackEvent('identify', {
      person_id: personId,
      traits,
    });

    // Track as journey event
    if (enableJourney) {
      trackJourney('custom', {
        action: 'identify',
        traits,
      }, {
        person_id: personId,
        event_name: 'user_identified',
        stage: 'retention',
      });
    }
  }

  // Get stored person ID
  function getPersonId() {
    return sessionStorage.getItem('jyt_person_id') || null;
  }

  // Expose API for custom tracking
  window.jytAnalytics = {
    // Basic tracking
    track: trackEvent,
    trackPageview: trackPageview,

    // Conversion tracking
    trackConversion: trackConversion,
    trackPurchase: trackPurchase,
    trackLeadForm: trackLeadForm,
    trackAddToCart: trackAddToCart,
    trackBeginCheckout: trackBeginCheckout,

    // Journey tracking
    trackJourney: trackJourney,

    // User identification
    identify: identify,
    getPersonId: getPersonId,

    // Utility
    getVisitorId: getVisitorId,
    getSessionId: getSessionId,
    getUTMParams: getStoredUTMParams,

    // Heartbeat control
    startHeartbeat: startHeartbeat,
    stopHeartbeat: stopHeartbeat,
  };

  // Log initialization
  if (console && console.log) {
    console.log('[Analytics] Initialized for website:', websiteId);
    console.log('[Analytics] Features enabled:', {
      journey: enableJourney,
      scroll: enableScrollTracking,
      engagement: enableEngagement,
    });
  }
})();
