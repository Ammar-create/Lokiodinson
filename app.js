/* app.js — Failure× interaction + choreography
   GSAP/ScrollTrigger where available; graceful vanilla fallbacks throughout.
   Nothing here is required for content to be readable. */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasGSAP = typeof window.gsap !== 'undefined';
  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var HEADER = 76;

  /* ============================================================= */
  /* Scroll reveals                                                */
  /* ============================================================= */
  function initReveals() {
    var els = $$('.reveal');
    if (reduce || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    if (hasGSAP && window.ScrollTrigger) {
      window.gsap.registerPlugin(window.ScrollTrigger);
      els.forEach(function (el) {
        window.ScrollTrigger.create({
          trigger: el, start: 'top 88%',
          onEnter: function () { el.classList.add('in'); },
        });
      });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
        });
      }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
      els.forEach(function (el) { io.observe(el); });
    }
  }

  /* ============================================================= */
  /* Hero intro sequence                                           */
  /* ============================================================= */
  function initHero() {
    var items = $$('[data-hero]').sort(function (a, b) {
      return (+a.dataset.hero) - (+b.dataset.hero);
    });
    if (reduce) { items.forEach(function (el) { el.style.opacity = 1; }); return; }
    if (hasGSAP) {
      window.gsap.to(items, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.12, delay: 0.15,
        onStart: function () { items.forEach(function (el) { el.style.transform = 'translateY(18px)'; }); } });
      window.gsap.fromTo(items, { y: 18 }, { y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.12, delay: 0.15 });
    } else {
      items.forEach(function (el, i) {
        el.style.transition = 'opacity .8s ease ' + (i * 0.12 + 0.15) + 's, transform .8s ease ' + (i * 0.12 + 0.15) + 's';
        el.style.transform = 'translateY(18px)';
        requestAnimationFrame(function () { el.style.opacity = 1; el.style.transform = 'none'; });
      });
    }
  }

  /* ============================================================= */
  /* Liquid title (SVG turbulence displacement)                    */
  /* ============================================================= */
  function initLiquidTitle() {
    var disp = $('#liquid-disp'), turb = $('#liquid-turb');
    var title = $('.hero h1');
    if (!disp || !turb || !title || reduce) {
      if (title) title.classList.remove('wobble');
      $$('.wobble').forEach(function (el) { el.classList.remove('wobble'); });
      return;
    }
    var scale = 0, target = 0, phase = 0, raf;
    title.addEventListener('pointerenter', function () { target = 26; });
    title.addEventListener('pointerleave', function () { target = 0; });
    function loop() {
      phase += 0.006;
      scale += (target - scale) * 0.06;
      var idle = 3 + Math.sin(phase) * 2; // subtle constant undulation
      var s = Math.max(scale, idle);
      disp.setAttribute('scale', s.toFixed(2));
      var f = 0.006 + Math.sin(phase * 0.7) * 0.002;
      turb.setAttribute('baseFrequency', f.toFixed(4) + ' ' + (f * 1.8).toFixed(4));
      raf = requestAnimationFrame(loop);
    }
    loop();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) cancelAnimationFrame(raf); else loop();
    });
  }

  /* ============================================================= */
  /* Nav: scrolled state + active section + smooth anchors         */
  /* ============================================================= */
  function initNav() {
    var nav = $('#nav');
    function onScroll() {
      if (nav) nav.classList.toggle('scrolled', window.scrollY > 24);
      var tt = $('#toTop'); if (tt) tt.classList.toggle('show', window.scrollY > 600);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // active section
    var links = $$('.nav-links a');
    var map = {};
    links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var link = map[en.target.id];
          if (link && en.isIntersecting) {
            links.forEach(function (l) { l.removeAttribute('aria-current'); });
            link.setAttribute('aria-current', 'true');
          }
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      Object.keys(map).forEach(function (id) { var s = document.getElementById(id); if (s) io.observe(s); });
    }

    // smooth in-page anchors with header offset
    $$('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var id = a.getAttribute('href');
        if (id === '#' || id.length < 2) return;
        var t = document.querySelector(id);
        if (!t) return;
        e.preventDefault();
        closeMenu();
        var y = t.getBoundingClientRect().top + window.scrollY - HEADER;
        window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
        t.setAttribute('tabindex', '-1');
        setTimeout(function () { t.focus({ preventScroll: true }); }, reduce ? 0 : 500);
      });
    });

    var tt = $('#toTop');
    if (tt) tt.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });
  }

  /* ============================================================= */
  /* Focus trap helper                                             */
  /* ============================================================= */
  function trapFocus(container) {
    var sel = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';
    function onKey(e) {
      if (e.key !== 'Tab') return;
      var f = $$(sel, container).filter(function (el) { return el.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    container.addEventListener('keydown', onKey);
    return function () { container.removeEventListener('keydown', onKey); };
  }

  /* ============================================================= */
  /* Mobile menu                                                   */
  /* ============================================================= */
  var menuEl, menuTrigger, untrap;
  function closeMenu() {
    if (!menuEl || menuEl.dataset.open !== 'true') return;
    menuEl.dataset.open = 'false';
    document.body.classList.remove('menu-open');
    if (menuTrigger) { menuTrigger.setAttribute('aria-expanded', 'false'); menuTrigger.focus(); }
    if (untrap) { untrap(); untrap = null; }
  }
  function initMenu() {
    menuEl = $('#mobileMenu'); menuTrigger = $('#menuTrigger');
    var closeBtn = $('#menuClose');
    if (!menuEl || !menuTrigger) return;
    menuTrigger.addEventListener('click', function () {
      menuEl.dataset.open = 'true';
      document.body.classList.add('menu-open');
      menuTrigger.setAttribute('aria-expanded', 'true');
      untrap = trapFocus(menuEl);
      var first = $('a, button', menuEl); if (first) first.focus();
    });
    if (closeBtn) closeBtn.addEventListener('click', closeMenu);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
  }

  /* ============================================================= */
  /* Showcase carousel                                            */
  /* ============================================================= */
  function initCarousel() {
    var stage = $('.showcase'); if (!stage) return;
    var items = [
      { name: 'Merge-1',  role: 'Generalist · 70B',
        desc: 'The flagship weld. Balanced composition for agentic work: planning, tool use, recovery.',
        accent: 'var(--straw)',
        bars: [['f-straw', 41, 'Reasoning'], ['f-bronze', 27, 'Code'], ['f-plum', 18, 'Multilingual'], ['f-peacock', 14, 'Instruction']] },
      { name: 'Merge-1C', role: 'Code-weighted · 70B',
        desc: 'Re-welded toward software work: repository navigation, long-horizon edits, test discipline.',
        accent: 'var(--bronze)',
        bars: [['f-bronze', 52, 'Code'], ['f-straw', 28, 'Reasoning'], ['f-peacock', 20, 'Instruction']] },
      { name: 'Merge-1S', role: 'Compact · 8B',
        desc: 'The same alloy, rolled thin. For high-volume harness steps where latency is the constraint.',
        accent: 'var(--peacock)',
        bars: [['f-straw', 38, 'Reasoning'], ['f-bronze', 24, 'Code'], ['f-plum', 20, 'Multilingual'], ['f-peacock', 18, 'Instruction']] },
    ];
    var i = 0, n = items.length;
    var slides = $$('.slide', stage);
    var thumbs = $$('.thumb', stage);
    var infoName = $('[data-info="name"]', stage);
    var infoRole = $('[data-info="role"]', stage);
    var infoDesc = $('[data-info="desc"]', stage);
    var bar = $('[data-info="bar"]', stage);
    var legend = $('[data-info="legend"]', stage);
    var idxEl = $('[data-carousel="index"]', stage);
    var visual = $('.showcase-visual', stage);
    var info = $('.showcase-info', stage);

    function render() {
      var it = items[i];
      slides.forEach(function (s, k) { s.setAttribute('aria-hidden', k === i ? 'false' : 'true'); });
      thumbs.forEach(function (t, k) { t.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
      infoName.textContent = it.name;
      infoRole.textContent = it.role;
      infoDesc.textContent = it.desc;
      if (idxEl) idxEl.textContent = (i + 1);
      if (visual) visual.style.setProperty('--accent', it.accent);
      if (info) info.style.setProperty('--accent', it.accent);
      bar.innerHTML = it.bars.map(function (b) {
        return '<span class="' + b[0] + '" style="width:' + b[1] + '%"></span>';
      }).join('');
      legend.innerHTML = it.bars.map(function (b) {
        return '<span><i class="' + b[0] + '"></i>' + b[1] + ' ' + b[2] + '</span>';
      }).join('');
      // retrigger bar fill animation
      requestAnimationFrame(function () {
        var comp = bar.closest('.comp'); if (comp) { comp.classList.remove('in'); void comp.offsetWidth; comp.classList.add('in'); }
      });
    }
    function go(k) { i = (k + n) % n; render(); }

    $('[data-carousel="prev"]', stage).addEventListener('click', function () { go(i - 1); });
    $('[data-carousel="next"]', stage).addEventListener('click', function () { go(i + 1); });
    thumbs.forEach(function (t, k) { t.addEventListener('click', function () { go(k); }); });

    stage.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { go(i - 1); }
      else if (e.key === 'ArrowRight') { go(i + 1); }
    });

    // touch swipe on the visual
    var sx = 0, sy = 0;
    if (visual) {
      visual.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
      visual.addEventListener('touchend', function (e) {
        var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { go(i + (dx < 0 ? 1 : -1)); }
      }, { passive: true });
    }
    render();
  }

  /* ============================================================= */
  /* Media modal                                                  */
  /* ============================================================= */
  function initModal() {
    var overlay = $('#mediaModal');
    var closeBtn = $('#modalClose');
    if (!overlay) return;
    var lastFocus = null, releaseTrap = null;

    function open() {
      lastFocus = document.activeElement;
      overlay.dataset.open = 'true';
      document.body.classList.add('modal-open');
      releaseTrap = trapFocus(overlay);
      if (closeBtn) closeBtn.focus();
      if (window.__trailer) window.__trailer.start();
    }
    function close() {
      if (overlay.dataset.open !== 'true') return;
      overlay.dataset.open = 'false';
      document.body.classList.remove('modal-open');
      if (window.__trailer) window.__trailer.stop();
      if (releaseTrap) { releaseTrap(); releaseTrap = null; }
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    $$('[data-open-modal]').forEach(function (b) { b.addEventListener('click', open); });
    if (closeBtn) closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  /* ============================================================= */
  /* Forms: validation, loading, success                           */
  /* ============================================================= */
  function emailOK(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

  function initForms() {
    $$('#engageForm, #waitForm').forEach(function (form) {
      var emailInput = $('input[type="email"]', form);
      var emailErr = emailInput ? document.getElementById(emailInput.getAttribute('aria-describedby')) : null;
      var consent = $('input[type="checkbox"]', form);
      var consentErr = consent ? document.getElementById(consent.getAttribute('aria-describedby')) : null;
      var status = $('[data-status]', form);
      var success = $('[data-success]', form);
      var btn = $('button[type="submit"]', form);

      function setErr(input, errEl, msg) {
        if (!errEl) return;
        if (msg) { errEl.textContent = msg; errEl.classList.add('show'); if (input) input.setAttribute('aria-invalid', 'true'); }
        else { errEl.textContent = ''; errEl.classList.remove('show'); if (input) input.removeAttribute('aria-invalid'); }
      }
      if (emailInput) emailInput.addEventListener('input', function () { if (emailInput.getAttribute('aria-invalid')) setErr(emailInput, emailErr, emailOK(emailInput.value) ? '' : 'Enter a valid email address.'); });
      if (consent) consent.addEventListener('change', function () { if (consent.checked) setErr(consent, consentErr, ''); });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var ok = true;
        if (emailInput && !emailOK(emailInput.value)) { setErr(emailInput, emailErr, 'Enter a valid email address.'); ok = false; }
        else setErr(emailInput, emailErr, '');
        if (consent && !consent.checked) { setErr(consent, consentErr, 'Please accept to continue.'); ok = false; }
        else setErr(consent, consentErr, '');
        if (!ok) {
          if (status) { status.textContent = 'Please fix the highlighted fields.'; status.classList.add('error'); }
          var badF = $('[aria-invalid="true"]', form) || (consent && !consent.checked ? consent : null);
          if (badF) badF.focus();
          return;
        }
        if (status) { status.textContent = ''; status.classList.remove('error'); }
        // simulate async submit (no backend) — preserves input, shows states
        btn.classList.add('loading'); btn.disabled = true;
        if (status) status.textContent = 'Submitting…';
        setTimeout(function () {
          btn.classList.remove('loading'); btn.disabled = false;
          if (status) status.textContent = '';
          // hide every form child except the success block, then reveal it
          Array.prototype.forEach.call(form.children, function (el) {
            if (el !== success) el.style.display = 'none';
          });
          if (success) { success.classList.add('show'); success.setAttribute('tabindex', '-1'); success.focus(); }
        }, 1100);
      });
    });
  }

  /* ============================================================= */
  /* FAQ accordion                                                */
  /* ============================================================= */
  function initFAQ() {
    $$('.faq-q').forEach(function (q) {
      var panel = document.getElementById(q.getAttribute('aria-controls'));
      q.addEventListener('click', function () {
        var open = q.getAttribute('aria-expanded') === 'true';
        q.setAttribute('aria-expanded', open ? 'false' : 'true');
        if (panel) panel.style.maxHeight = open ? '0px' : (panel.querySelector('.inner').scrollHeight + 'px');
      });
    });
  }

  /* ============================================================= */
  /* Language selector (header + footer)                           */
  /* ============================================================= */
  function initLang() {
    $$('[data-lang]').forEach(function (lang) {
      var btn = $('.lang-btn', lang);
      var current = $('[data-lang-current]', lang);
      var options = $$('[role="option"]', lang);
      function toggle(open) {
        lang.dataset.open = open ? 'true' : 'false';
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      btn.addEventListener('click', function (e) { e.stopPropagation(); toggle(lang.dataset.open !== 'true'); });
      options.forEach(function (opt) {
        opt.addEventListener('click', function () {
          options.forEach(function (o) { o.setAttribute('aria-selected', 'false'); });
          opt.setAttribute('aria-selected', 'true');
          if (current) current.textContent = opt.dataset.langCode;
          toggle(false); btn.focus();
        });
      });
      document.addEventListener('click', function (e) { if (!lang.contains(e.target)) toggle(false); });
      lang.addEventListener('keydown', function (e) { if (e.key === 'Escape') { toggle(false); btn.focus(); } });
    });
  }

  /* ============================================================= */
  /* Boot                                                         */
  /* ============================================================= */
  function boot() {
    initReveals(); initHero(); initLiquidTitle(); initNav(); initMenu();
    initCarousel(); initModal(); initForms(); initFAQ(); initLang();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
