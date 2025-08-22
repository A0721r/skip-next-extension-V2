// Inject script - runs in page context for better video detection
(function() {
  'use strict';
  
  // Prevent multiple instances
  if (window.skipNextControllerInjected) {
    return;
  }
  window.skipNextControllerInjected = true;

  // Skip & Next Controller - Enhanced injection version
  class SkipNextController {
    constructor() {
      this.skipButton = null;
      this.nextButton = null;
      this.configPanel = null;
      this.currentVideo = null;
      this.videoCheckInterval = null;
      this.settings = {
        skipTime: 85,
        nextBehavior: 'auto',
        skipButtonEnabled: true,
        nextButtonEnabled: true
      };
      
      this.init();
    }

    async init() {
      await this.loadSettings();
      this.setupVideoDetection();
      this.injectStyles();
    }

    injectStyles() {
      if (document.getElementById('snc-injected-styles')) return;
      
      const link = document.createElement('link');
      link.id = 'snc-injected-styles';
      link.rel = 'stylesheet';
      link.type = 'text/css';
      link.href = chrome.runtime.getURL('styles.css');
      document.head.appendChild(link);
    }

    async loadSettings() {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.get(['skipNextSettings'], (result) => {
            if (result.skipNextSettings) {
              this.settings = { ...this.settings, ...result.skipNextSettings };
            }
            resolve();
          });
        } else {
          // Fallback to localStorage for compatibility
          const saved = localStorage.getItem('skipNextSettings');
          if (saved) {
            try {
              this.settings = { ...this.settings, ...JSON.parse(saved) };
            } catch (e) {}
          }
          resolve();
        }
      });
    }

    async saveSettings() {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ skipNextSettings: this.settings });
      } else {
        // Fallback to localStorage
        localStorage.setItem('skipNextSettings', JSON.stringify(this.settings));
      }
    }

    setupVideoDetection() {
      // Multiple detection strategies for better compatibility
      this.detectVideosNow();
      
      // Continuous monitoring
      this.videoCheckInterval = setInterval(() => {
        this.detectVideosNow();
      }, 2000);

      // DOM mutation observer for dynamic content
      const observer = new MutationObserver((mutations) => {
        let shouldCheck = false;
        mutations.forEach((mutation) => {
          if (mutation.type === 'childList') {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === 1) { // Element node
                if (node.tagName === 'VIDEO' || node.querySelector && node.querySelector('video')) {
                  shouldCheck = true;
                }
              }
            });
          }
        });
        
        if (shouldCheck) {
          setTimeout(() => this.detectVideosNow(), 100);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Listen for video events globally
      document.addEventListener('loadstart', this.onVideoEvent.bind(this), true);
      document.addEventListener('loadeddata', this.onVideoEvent.bind(this), true);
      document.addEventListener('canplay', this.onVideoEvent.bind(this), true);
      
      // Page navigation detection
      let currentURL = window.location.href;
      setInterval(() => {
        if (window.location.href !== currentURL) {
          currentURL = window.location.href;
          setTimeout(() => this.detectVideosNow(), 1000);
        }
      }, 1000);
    }

    onVideoEvent(event) {
      if (event.target.tagName === 'VIDEO') {
        setTimeout(() => this.detectVideosNow(), 500);
      }
    }

    detectVideosNow() {
      const videos = this.getAllVideos();
      if (videos.length === 0) return;

      const targetVideo = this.selectBestVideo(videos);
      
      if (targetVideo && targetVideo !== this.currentVideo) {
        this.currentVideo = targetVideo;
        this.removeButtons();
        this.createButtons();
      }
    }

    getAllVideos() {
      // Get videos from multiple contexts
      const videos = [];
      
      // Direct videos
      document.querySelectorAll('video').forEach(v => videos.push(v));
      
      // Videos in iframes (same origin)
      document.querySelectorAll('iframe').forEach(iframe => {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
          if (iframeDoc) {
            iframeDoc.querySelectorAll('video').forEach(v => videos.push(v));
          }
        } catch (e) {
          // Cross-origin iframe, can't access
        }
      });

      // Videos in shadow DOMs
      document.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) {
          el.shadowRoot.querySelectorAll('video').forEach(v => videos.push(v));
        }
      });

      return videos;
    }

    selectBestVideo(videos) {
      if (videos.length === 0) return null;
      if (videos.length === 1) return videos[0];

      // Priority: playing > visible > largest
      let playingVideos = videos.filter(v => !v.paused && !v.ended);
      if (playingVideos.length === 1) return playingVideos[0];

      // Filter visible videos
      let visibleVideos = videos.filter(v => {
        const rect = v.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && 
               rect.top < window.innerHeight && rect.bottom > 0;
      });

      if (visibleVideos.length === 0) visibleVideos = videos;

      // Return the largest visible video
      return visibleVideos.reduce((largest, current) => {
        const currentSize = current.getBoundingClientRect();
        const largestSize = largest.getBoundingClientRect();
        return (currentSize.width * currentSize.height) > (largestSize.width * largestSize.height) 
          ? current : largest;
      });
    }

    createButtons() {
      if (!this.currentVideo) return;

      const videoContainer = this.getVideoContainer();
      if (!videoContainer) return;

      this.createSkipButton(videoContainer);
      if (this.settings.nextBehavior === 'manual') {
        this.createNextButton(videoContainer);
      }

      this.setupVideoEndListener();
    }

    getVideoContainer() {
      let container = this.currentVideo.parentElement;
      
      // Find the best container for positioning
      while (container && container !== document.body) {
        const style = getComputedStyle(container);
        if (style.position === 'relative' || style.position === 'absolute' || 
            style.position === 'fixed') {
          break;
        }
        // Also check for common video container classes
        const className = container.className.toLowerCase();
        if (className.includes('video') || className.includes('player') || 
            className.includes('media')) {
          break;
        }
        container = container.parentElement;
      }

      return container || this.currentVideo.parentElement;
    }

    createSkipButton(container) {
      this.skipButton = document.createElement('div');
      this.skipButton.className = 'snc-skip-button snc-glassmorphism';
      this.skipButton.innerHTML = `Skip ${this.settings.skipTime}s`;
      
      let pressTimer;
      
      this.skipButton.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pressTimer = setTimeout(() => {
          this.showConfigPanel();
        }, 800);
      });

      this.skipButton.addEventListener('mouseup', (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(pressTimer);
      });

      this.skipButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(pressTimer);
        this.skipTime();
      });

      this.skipButton.addEventListener('mouseleave', () => {
        clearTimeout(pressTimer);
      });

      // Ensure container can position children
      const containerStyle = getComputedStyle(container);
      if (containerStyle.position === 'static') {
        container.style.position = 'relative';
      }

      container.appendChild(this.skipButton);
    }

    createNextButton(container) {
      this.nextButton = document.createElement('div');
      this.nextButton.className = 'snc-next-button snc-glassmorphism';
      this.nextButton.innerHTML = 'Next ▶';
      
      this.nextButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.goToNext();
      });

      container.appendChild(this.nextButton);
    }

    skipTime() {
      if (this.currentVideo && !isNaN(this.currentVideo.duration)) {
        const newTime = Math.min(
          this.currentVideo.currentTime + this.settings.skipTime,
          this.currentVideo.duration
        );
        this.currentVideo.currentTime = newTime;
        this.showSkipFeedback();
      }
    }

    showSkipFeedback() {
      const feedback = document.createElement('div');
      feedback.className = 'snc-skip-feedback snc-glassmorphism';
      feedback.innerHTML = `⏩ +${this.settings.skipTime}s`;
      
      const container = this.getVideoContainer();
      container.appendChild(feedback);
      
      setTimeout(() => {
        if (feedback.parentNode) {
          feedback.parentNode.removeChild(feedback);
        }
      }, 2000);
    }

    goToNext() {
      const nextLinks = this.findNextEpisodeLinks();
      if (nextLinks.length > 0) {
        // Try the first link
        nextLinks[0].click();
        
        // If that doesn't work, try direct navigation
        setTimeout(() => {
          if (nextLinks[0].href) {
            window.location.href = nextLinks[0].href;
          }
        }, 100);
      } else {
        this.showMessage('No se encontró el siguiente capítulo');
      }
    }

    findNextEpisodeLinks() {
      const selectors = [
        // Common anime/video site patterns
        'a[href*="episode-"]:not([href*="previous"])',
        'a[href*="capitulo-"]:not([href*="anterior"])',
        'a[href*="cap-"]:not([href*="anterior"])',
        'a.next-episode',
        'a.siguiente',
        '.next-chapter a',
        '.episode-nav .next',
        '.navigation .next',
        'a[title*="next"]',
        'a[title*="siguiente"]',
        'a[title*="próximo"]',
        // Text-based selectors
        'a:contains("Next")',
        'a:contains("Siguiente")',
        'a:contains("Próximo")',
        'a:contains("→")',
        'a:contains("►")'
      ];

      let links = [];
      
      selectors.forEach(selector => {
        try {
          if (selector.includes(':contains')) {
            const baseSelector = selector.split(':contains')[0];
            const searchText = selector.match(/:contains\("([^"]+)"/)?.[1];
            
            document.querySelectorAll(baseSelector || 'a').forEach(el => {
              if (searchText && el.textContent.toLowerCase().includes(searchText.toLowerCase())) {
                links.push(el);
              }
            });
          } else {
            document.querySelectorAll(selector).forEach(el => links.push(el));
          }
        } catch (e) {
          console.log('Selector error:', selector, e);
        }
      });

      // Try to find numbered episodes
      const currentUrl = window.location.href;
      const episodePatterns = [
        /episode-(\d+)/i,
        /capitulo-(\d+)/i,
        /cap-(\d+)/i,
        /ep-(\d+)/i,
        /(\d+)(?!.*\d)/
      ];

      for (const pattern of episodePatterns) {
        const match = currentUrl.match(pattern);
        if (match) {
          const currentEpisode = parseInt(match[1]);
          const nextEpisode = currentEpisode + 1;
          
          // Look for links with the next episode number
          const nextLinks = document.querySelectorAll(`a[href*="${nextEpisode}"]`);
          nextLinks.forEach(link => {
            if (!link.href.includes(currentEpisode.toString()) || 
                link.href.includes(nextEpisode.toString())) {
              links.push(link);
            }
          });
          break;
        }
      }

      // Remove duplicates and filter valid links
      const uniqueLinks = [...new Set(links)].filter(link => 
        link.href && link.href !== window.location.href
      );

      return uniqueLinks;
    }

    setupVideoEndListener() {
      if (this.settings.nextBehavior === 'auto' && this.currentVideo) {
        // Remove old listener
        this.currentVideo.removeEventListener('ended', this.videoEndHandler);
        
        // Add new listener
        this.videoEndHandler = () => this.showAutoNextPrompt();
        this.currentVideo.addEventListener('ended', this.videoEndHandler);
      }
    }

    showAutoNextPrompt() {
      // Prevent multiple prompts
      if (document.querySelector('.snc-auto-next-prompt')) return;

      const prompt = document.createElement('div');
      prompt.className = 'snc-auto-next-prompt';
      prompt.innerHTML = `
        <div class="snc-prompt-content snc-glassmorphism">
          <div class="snc-prompt-text">Siguiente capítulo en <span id="snc-countdown">5</span>s</div>
          <button class="snc-cancel-button snc-glassmorphism">Cancelar</button>
        </div>
      `;

      document.body.appendChild(prompt);

      let countdown = 5;
      const timer = setInterval(() => {
        countdown--;
        const countdownEl = prompt.querySelector('#snc-countdown');
        if (countdownEl) {
          countdownEl.textContent = countdown;
        }
        
        if (countdown <= 0) {
          clearInterval(timer);
          if (prompt.parentNode) {
            prompt.parentNode.removeChild(prompt);
          }
          this.goToNext();
        }
      }, 1000);

      const cancelBtn = prompt.querySelector('.snc-cancel-button');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          clearInterval(timer);
          if (prompt.parentNode) {
            prompt.parentNode.removeChild(prompt);
          }
        });
      }

      // Auto cleanup
      setTimeout(() => {
        clearInterval(timer);
        if (prompt.parentNode) {
          prompt.parentNode.removeChild(prompt);
        }
      }, 6000);
    }

    showConfigPanel() {
      if (this.configPanel) return;

      this.configPanel = document.createElement('div');
      this.configPanel.className = 'snc-config-panel';
      this.configPanel.innerHTML = `
        <div class="snc-config-content snc-glassmorphism">
          <div class="snc-config-header">⚙️ Configuración</div>
          
          <div class="snc-config-section">
            <label>Tiempo de salto (segundos):</label>
            <div class="snc-slider-container">
              <input type="range" id="snc-skip-slider" min="30" max="180" step="5" value="${this.settings.skipTime}">
              <span id="snc-skip-value">${this.settings.skipTime}s</span>
            </div>
            <div class="snc-preset-buttons">
              <button data-time="60" class="snc-glassmorphism">60s</button>
              <button data-time="85" class="snc-glassmorphism">85s</button>
              <button data-time="120" class="snc-glassmorphism">120s</button>
              <button data-time="150" class="snc-glassmorphism">150s</button>
            </div>
          </div>

          <div class="snc-config-section">
            <label>Comportamiento del siguiente:</label>
            <div class="snc-radio-group">
              <label class="snc-radio-label">
                <input type="radio" name="nextBehavior" value="auto" ${this.settings.nextBehavior === 'auto' ? 'checked' : ''}>
                <span>Automático</span>
              </label>
              <label class="snc-radio-label">
                <input type="radio" name="nextBehavior" value="manual" ${this.settings.nextBehavior === 'manual' ? 'checked' : ''}>
                <span>Manual</span>
              </label>
            </div>
          </div>

          <div class="snc-config-buttons">
            <button id="snc-save-config" class="snc-save-button snc-glassmorphism">Guardar</button>
            <button id="snc-cancel-config" class="snc-cancel-button snc-glassmorphism">Cancelar</button>
          </div>
        </div>
      `;

      document.body.appendChild(this.configPanel);
      this.setupConfigListeners();
    }

    setupConfigListeners() {
      const slider = this.configPanel.querySelector('#snc-skip-slider');
      const valueDisplay = this.configPanel.querySelector('#snc-skip-value');
      
      slider.addEventListener('input', (e) => {
        valueDisplay.textContent = e.target.value + 's';
      });

      // Preset buttons
      this.configPanel.querySelectorAll('.snc-preset-buttons button').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const time = e.target.dataset.time;
          slider.value = time;
          valueDisplay.textContent = time + 's';
        });
      });

      // Save button
      this.configPanel.querySelector('#snc-save-config').addEventListener('click', () => {
        const newSkipTime = parseInt(slider.value);
        const newNextBehavior = this.configPanel.querySelector('input[name="nextBehavior"]:checked').value;
        
        this.settings.skipTime = newSkipTime;
        this.settings.nextBehavior = newNextBehavior;
        
        this.saveSettings();
        this.updateButtons();
        this.hideConfigPanel();
      });

      // Cancel button
      this.configPanel.querySelector('#snc-cancel-config').addEventListener('click', () => {
        this.hideConfigPanel();
      });

      // Click outside to close
      this.configPanel.addEventListener('click', (e) => {
        if (e.target === this.configPanel) {
          this.hideConfigPanel();
        }
      });
    }

    updateButtons() {
      if (this.skipButton) {
        this.skipButton.innerHTML = `Skip ${this.settings.skipTime}s`;
      }

      // Remove or create next button based on settings
      if (this.settings.nextBehavior === 'manual' && !this.nextButton) {
        const container = this.getVideoContainer();
        if (container) {
          this.createNextButton(container);
        }
      } else if (this.settings.nextBehavior === 'auto' && this.nextButton) {
        this.nextButton.remove();
        this.nextButton = null;
      }

      // Update video end listener
      this.setupVideoEndListener();
    }

    hideConfigPanel() {
      if (this.configPanel) {
        this.configPanel.remove();
        this.configPanel = null;
      }
    }

    showMessage(text) {
      const message = document.createElement('div');
      message.className = 'snc-message snc-glassmorphism';
      message.textContent = text;
      
      document.body.appendChild(message);
      
      setTimeout(() => {
        if (message.parentNode) {
          message.parentNode.removeChild(message);
        }
      }, 3000);
    }

    removeButtons() {
      if (this.skipButton) {
        this.skipButton.remove();
        this.skipButton = null;
      }
      if (this.nextButton) {
        this.nextButton.remove();
        this.nextButton = null;
      }
    }

    destroy() {
      this.removeButtons();
      if (this.configPanel) {
        this.configPanel.remove();
      }
      if (this.videoCheckInterval) {
        clearInterval(this.videoCheckInterval);
      }
    }
  }

  // Initialize the controller
  const controller = new SkipNextController();

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (controller) {
      controller.destroy();
    }
  });

})();