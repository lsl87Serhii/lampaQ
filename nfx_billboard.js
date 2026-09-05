(function () {
    'use strict';

    /* ================================================================
     *  NFX Billboard  v1.2
     *
     *  1) Перший ряд у стилі Netflix TV:
     *     - картка у фокусі розгортається з постера (2:3) у backdrop (16:9)
     *     - фокус прибитий до лівого краю ряду
     *     - лого тайтлу з TMDB, блок мета + опису під рядом з крос-фейдом
     *  2) Netflix-шапка: пошук + Головна/Фільми/Серіали, справа — налаштування
     *  3) Розмитий постер активного тайтлу на задньому плані
     *
     *  Перевірено по вихідниках yumata/lampa-source.
     * ================================================================ */

    var PLUGIN_ID = 'nfx_billboard';
    var VERSION = '1.2';

    // ─────────────────────────────────────────────────────────────────
    //  Утиліти
    // ─────────────────────────────────────────────────────────────────

    function S(name, def) {
        try { return Lampa.Storage.get(name, def); } catch (e) { return def; }
    }

    function isOn(name, def) {
        var v = S(name, def);
        return v === true || v === 'true' || v === 1 || v === '1';
    }

    function lang() {
        var l = S('language', 'uk');
        return l === 'ua' ? 'uk' : l;
    }

    function tmdbImage(path, size) {
        if (!path) return '';
        try { return Lampa.TMDB.image('t/p/' + size + path); } catch (e) { return ''; }
    }

    function el(tag, cls) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        return n;
    }

    /** Дістати дані картки з DOM-елемента (нові й старі збірки Lampa) */
    function cardData(node) {
        if (!node) return null;
        if (node.card_data) return node.card_data;
        try {
            var d = $(node).data('card');
            if (d) return d;
        } catch (e) { /* ignore */ }
        return null;
    }

    /** Натиснути чужий елемент (jQuery-хендлер або нативний слухач) */
    function pressElement(node) {
        if (!node) return;
        try { $(node).trigger('hover:enter'); return; } catch (e) { /* ignore */ }
        try { node.dispatchEvent(new CustomEvent('hover:enter', { bubbles: true })); } catch (e) { /* ignore */ }
    }

    function onEnter(node, handler) {
        try { $(node).on('hover:enter', handler); } catch (e) { /* ignore */ }
        node.addEventListener('hover:enter', handler);
        node.addEventListener('click', handler);
    }

    // ─────────────────────────────────────────────────────────────────
    //  Тип тайтлу (у Lampa немає ключів title_movie / title_tv)
    // ─────────────────────────────────────────────────────────────────

    var TYPE_WORD = {
        uk: { movie: 'Фільм', tv: 'Серіал' },
        ru: { movie: 'Фильм', tv: 'Сериал' },
        be: { movie: 'Фільм', tv: 'Серыял' },
        en: { movie: 'Movie', tv: 'Series' },
        pl: { movie: 'Film', tv: 'Serial' }
    };

    function typeWord(isTv) {
        var d = TYPE_WORD[lang()] || TYPE_WORD.en;
        return isTv ? d.tv : d.movie;
    }

    // ─────────────────────────────────────────────────────────────────
    //  Жанри TMDB (кеш у Storage, один запит на мову/тип)
    // ─────────────────────────────────────────────────────────────────

    var Genres = {
        map: {},

        load: function (type) {
            var l = lang();
            var key = 'nfx_bb_genres_' + type + '_' + l;
            var cached = S(key, null);

            if (cached && typeof cached === 'object') {
                this.map[type] = cached;
                return;
            }

            var self = this;
            var url;

            try {
                url = Lampa.TMDB.api('genre/' + type + '/list?api_key=' + Lampa.TMDB.key() + '&language=' + l);
            } catch (e) { return; }

            $.get(url, function (data) {
                var m = {};
                if (data && data.genres) {
                    for (var i = 0; i < data.genres.length; i++) m[data.genres[i].id] = data.genres[i].name;
                }
                self.map[type] = m;
                try { Lampa.Storage.set(key, m); } catch (e) { /* ignore */ }
            });
        },

        names: function (type, ids, limit) {
            var m = this.map[type];
            var out = [];
            if (!m || !ids) return out;
            for (var i = 0; i < ids.length && out.length < (limit || 2); i++) {
                if (m[ids[i]]) out.push(m[ids[i]]);
            }
            return out;
        }
    };

    // ─────────────────────────────────────────────────────────────────
    //  Логотипи тайтлів (TMDB /images)
    // ─────────────────────────────────────────────────────────────────

    var LogoEngine = {
        prefix: 'nfx_bb_logo_',

        key: function (type, id, l) {
            return this.prefix + type + '_' + id + '_' + l;
        },

        getCached: function (k) {
            try {
                var s = sessionStorage.getItem(k);
                if (s) return s;
            } catch (e) { /* ignore */ }
            return S(k, null);
        },

        setCached: function (k, v) {
            var val = v || 'none';
            try { sessionStorage.setItem(k, val); } catch (e) { /* ignore */ }
            try { Lampa.Storage.set(k, val); } catch (e) { /* ignore */ }
        },

        pick: function (logos, target) {
            if (!logos || !logos.length) return null;

            var sorted = logos.slice().sort(function (a, b) {
                var aS = (a.file_path || '').toLowerCase().indexOf('.svg') > -1;
                var bS = (b.file_path || '').toLowerCase().indexOf('.svg') > -1;
                return aS === bS ? 0 : (aS ? 1 : -1);
            });

            var i;
            for (i = 0; i < sorted.length; i++) {
                if (sorted[i].iso_639_1 === target && sorted[i].file_path) return sorted[i].file_path;
            }
            if (target === 'uk') {
                for (i = 0; i < sorted.length; i++) {
                    if (sorted[i].iso_639_1 === 'ru' && sorted[i].file_path) return sorted[i].file_path;
                }
            }
            for (i = 0; i < sorted.length; i++) {
                if (sorted[i].iso_639_1 === 'en' && sorted[i].file_path) return sorted[i].file_path;
            }
            return sorted[0] && sorted[0].file_path ? sorted[0].file_path : null;
        },

        pickLang: function () {
            var manual = S('nfx_bb_logo_lang', 'auto');
            if (manual && manual !== 'auto') return manual;
            return lang();
        },

        resolve: function (data, done) {
            if (!data || !data.id) return done(null);

            var type = data.name ? 'tv' : 'movie';
            var l = this.pickLang();
            var k = this.key(type, data.id, l);
            var cached = this.getCached(k);

            if (cached === 'none') return done(null);
            if (cached) return done(cached);

            var self = this;
            var url;

            try {
                url = Lampa.TMDB.api(
                    type + '/' + data.id + '/images?api_key=' + Lampa.TMDB.key() +
                    '&include_image_language=' + l + ',ru,en,null'
                );
            } catch (e) { return done(null); }

            $.get(url, function (res) {
                var path = self.pick(res && res.logos, l);
                if (path) {
                    var img = tmdbImage(path.replace('.svg', '.png'), 'w500');
                    self.setCached(k, img);
                    done(img);
                } else {
                    self.setCached(k, 'none');
                    done(null);
                }
            }).fail(function () { done(null); });
        }
    };

    // ─────────────────────────────────────────────────────────────────
    //  Розмитий фон
    // ─────────────────────────────────────────────────────────────────

    var Backdrop = {
        box: null,
        layers: null,
        index: 0,
        last: '',

        build: function () {
            if (this.box) return;

            var box = el('div', 'nfx-bg');
            var a = el('div', 'nfx-bg__layer');
            var b = el('div', 'nfx-bg__layer');

            box.appendChild(a);
            box.appendChild(b);
            box.appendChild(el('div', 'nfx-bg__shade'));

            document.body.insertBefore(box, document.body.firstChild);

            this.box = box;
            this.layers = [a, b];
        },

        change: function (data) {
            var mode = S('nfx_bb_bg', 'off');
            if (mode === 'off' || !data) return;

            this.build();

            var url = mode === 'backdrop'
                ? (tmdbImage(data.backdrop_path, 'w300') || tmdbImage(data.poster_path, 'w300'))
                : (tmdbImage(data.poster_path, 'w300') || tmdbImage(data.backdrop_path, 'w300'));

            if (!url || url === this.last) return;
            this.last = url;

            var self = this;
            var next = this.layers[(this.index + 1) % 2];
            var curr = this.layers[this.index];

            next.style.backgroundImage = 'url(' + url + ')';

            var done = false;
            var show = function () {
                if (done) return;
                done = true;
                next.classList.add('nfx-bg__layer--in');
                curr.classList.remove('nfx-bg__layer--in');
                self.index = (self.index + 1) % 2;
            };

            var pre = new Image();
            pre.onload = show;
            pre.onerror = show;
            pre.src = url;

            // страховка, якщо onload не спрацює (кеш/проксі/повільна мережа)
            setTimeout(show, 1200);
        }
    };

    // ─────────────────────────────────────────────────────────────────
    //  Мета-рядок (без рейтингів)
    // ─────────────────────────────────────────────────────────────────

    function metaLine(data) {
        var isTv = !!data.name;
        var type = isTv ? 'tv' : 'movie';
        var parts = [];

        var name = data.title || data.name || '';
        if (name) parts.push(name);
        else parts.push(typeWord(isTv));

        var g = Genres.names(type, data.genre_ids, 2);
        for (var i = 0; i < g.length; i++) parts.push(g[i]);

        var date = data.release_date || data.first_air_date || '';
        if (date) parts.push(date.slice(0, 4));

        if (data.number_of_seasons) parts.push(data.number_of_seasons + ' сез.');

        return parts.join('  ·  ');
    }

    // ─────────────────────────────────────────────────────────────────
    //  Розгорнута картка (hero)
    // ─────────────────────────────────────────────────────────────────

    function buildHero(cardEl, data) {
        var view = cardEl.querySelector('.card__view');
        if (!view) return;

        var old = view.querySelector('.nfx-hero');
        if (old) old.parentNode.removeChild(old);

        var hero = el('div', 'nfx-hero');

        var img = el('img', 'nfx-hero__img');
        img.src = tmdbImage(data.backdrop_path, 'w780') || tmdbImage(data.poster_path, 'w500');
        hero.appendChild(img);

        hero.appendChild(el('div', 'nfx-hero__shade'));

        var logoBox = el('div', 'nfx-hero__logo');
        var fallback = el('div', 'nfx-hero__name');
        fallback.textContent = data.title || data.name || '';
        logoBox.appendChild(fallback);
        hero.appendChild(logoBox);

        if (isOn('nfx_bb_chips', true)) {
            var q = cardEl.querySelector('.card__quality');
            if (q && q.textContent.trim()) {
                var chips = el('div', 'nfx-hero__chips');
                var chip = el('div', 'nfx-chip');
                chip.textContent = q.textContent.trim();
                chips.appendChild(chip);
                hero.appendChild(chips);
            }
        }

        view.appendChild(hero);

        if (isOn('nfx_bb_logo', true)) {
            LogoEngine.resolve(data, function (url) {
                if (!url || !hero.parentNode) return;
                var li = el('img', 'nfx-hero__logo-img');
                li.onload = function () {
                    if (!hero.parentNode) return;
                    fallback.style.display = 'none';
                };
                li.src = url;
                logoBox.appendChild(li);
            });
        }
    }

    function clearHero(cardEl) {
        if (!cardEl) return;
        var h = cardEl.querySelector('.nfx-hero');
        if (h && h.parentNode) h.parentNode.removeChild(h);
    }

    // ─────────────────────────────────────────────────────────────────
    //  Блок мета + опису під рядом (два шари для крос-фейду)
    // ─────────────────────────────────────────────────────────────────

    function buildInfo(lineEl) {
        var box = el('div', 'nfx-info');
        var a = el('div', 'nfx-info__layer nfx-info__layer--active');
        var b = el('div', 'nfx-info__layer');

        [a, b].forEach(function (layer) {
            layer.appendChild(el('div', 'nfx-info__meta'));
            layer.appendChild(el('div', 'nfx-info__text'));
        });

        box.appendChild(a);
        box.appendChild(b);

        var body = lineEl.querySelector('.items-line__body');
        if (body && body.parentNode) body.parentNode.insertBefore(box, body.nextSibling);
        else lineEl.appendChild(box);

        return { box: box, layers: [a, b], index: 0, first: true };
    }

    function renderInfo(info, data) {
        if (!info) return;

        if (info.first) {
            info.first = false;
            var l0 = info.layers[info.index];
            l0.querySelector('.nfx-info__meta').textContent = metaLine(data);
            l0.querySelector('.nfx-info__text').textContent = data.overview || '';
            return;
        }

        var next = info.layers[(info.index + 1) % 2];
        var curr = info.layers[info.index];

        next.querySelector('.nfx-info__meta').textContent = metaLine(data);
        next.querySelector('.nfx-info__text').textContent = data.overview || '';

        curr.classList.remove('nfx-info__layer--active');
        next.classList.add('nfx-info__layer--active');

        info.index = (info.index + 1) % 2;
    }

    // ─────────────────────────────────────────────────────────────────
    //  Підключення до ряду
    // ─────────────────────────────────────────────────────────────────

    function attach(line) {
        if (line.__nfx_bound) return;
        line.__nfx_bound = true;

        var lineEl = line.render(true);
        lineEl.classList.add('items-line--nfx');

        var ctx = {
            line: line,
            info: isOn('nfx_bb_info', true) ? buildInfo(lineEl) : null,
            current: null
        };

        Genres.load('movie');
        Genres.load('tv');

        function open(item) {
            if (!item) return;

            var cardEl = item.render(true);
            if (!cardEl || ctx.current === cardEl) return;

            if (ctx.current) {
                ctx.current.classList.remove('nfx-open');
                clearHero(ctx.current);
            }

            ctx.current = cardEl;
            cardEl.classList.add('nfx-open');

            var data = item.data || cardData(cardEl) || {};

            buildHero(cardEl, data);
            renderInfo(ctx.info, data);
            Backdrop.change(data);

            if (S('nfx_bb_pin', 'left') === 'left' && line.scroll) {
                line.scroll.update(cardEl, false);
            }
        }

        line.use({
            onActive: function (item) { open(item); },
            onDestroy: function () { ctx.current = null; }
        });

        var tries = 0;
        var timer = setInterval(function () {
            if (ctx.current) return clearInterval(timer);
            if (line.items && line.items.length) {
                open(line.items[0]);
                clearInterval(timer);
            }
            if (++tries > 40) clearInterval(timer);
        }, 100);
    }

    function initLineHook() {
        if (window.__nfx_bb_line) return;
        window.__nfx_bb_line = true;

        Lampa.Listener.follow('line', function (e) {
            if (e.type !== 'create') return;
            if (!isOn('nfx_bb_enable', true)) return;

            var line = e.line;

            setTimeout(function () {
                try {
                    var lineEl = line.render(true);
                    if (!lineEl || !lineEl.parentNode) return;

                    var siblings = lineEl.parentNode.querySelectorAll('.items-line');
                    if (!siblings.length || siblings[0] !== lineEl) return;

                    if (S('nfx_bb_scope', 'main') === 'main') {
                        var act = Lampa.Activity.active();
                        if (!act || act.component !== 'main') return;
                    }

                    attach(line);
                } catch (err) {
                    console.log('[NFX Billboard] attach error', err);
                }
            }, 0);
        });
    }

    // ─────────────────────────────────────────────────────────────────
    //  Netflix-шапка
    // ─────────────────────────────────────────────────────────────────

    var NAV_PRESETS = {
        basic: ['main', 'tv', 'movie'],
        plus: ['main', 'tv', 'movie', 'catalog'],
        full: ['main', 'tv', 'movie', 'anime', 'catalog', 'favorite']
    };

    var ICON_SETTINGS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="3"></circle>' +
        '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';

    var navLast = null;

    function markActive(nav, action) {
        var tabs = nav.querySelectorAll('.nfx-nav__tab');
        for (var i = 0; i < tabs.length; i++) {
            if (tabs[i].getAttribute('data-action') === action) tabs[i].classList.add('nfx-nav__tab--active');
            else tabs[i].classList.remove('nfx-nav__tab--active');
        }
    }

    function trackFocus(node) {
        var set = function (e) { navLast = (e && e.target) ? e.target : node; };
        try { $(node).on('hover:focus hover:hover hover:touch', set); } catch (e) { /* ignore */ }
        node.addEventListener('hover:focus', set);
    }

    function buildNav() {
        var headBody = document.querySelector('.head .head__body');
        if (!headBody) return false;
        if (headBody.querySelector('.nfx-nav')) return true;

        // чекаємо, поки збудується бокове меню — з нього беремо пункти
        if (!document.querySelector('.menu__item[data-action="main"]')) return false;

        var nav = el('div', 'nfx-nav');
        var left = el('div', 'nfx-nav__group');

        nav.appendChild(left);
        headBody.appendChild(nav);

        // ── пошук: переносимо існуючу іконку Lampa разом з її обробником ──
        var search = document.querySelector('.head__action.open--search');
        if (search) {
            search.classList.add('nfx-nav__search');
            left.appendChild(search);
            trackFocus(search);
        }

        // ── вкладки з пунктів бокового меню ──
        var actions = NAV_PRESETS[S('nfx_nav_items', 'basic')] || NAV_PRESETS.basic;

        actions.forEach(function (action) {
            var src = document.querySelector('.menu__item[data-action="' + action + '"]');
            if (!src) return;

            var label = src.querySelector('.menu__text');
            var tab = el('div', 'nfx-nav__tab selector');
            tab.setAttribute('data-action', action);
            tab.textContent = label ? label.textContent.trim() : action;

            onEnter(tab, function () {
                markActive(nav, action);
                pressElement(src);
            });
            trackFocus(tab);

            left.appendChild(tab);
        });

        // ── налаштування Lampa на місці логотипа Netflix ──
        var settingsSrc = document.querySelector('.menu__item[data-action="settings"]');
        var btn = el('div', 'nfx-nav__settings selector');
        btn.innerHTML = ICON_SETTINGS;
        onEnter(btn, function () {
            if (settingsSrc) pressElement(settingsSrc);
            else if (window.Lampa && Lampa.Settings) Lampa.Settings.show({ category: 'main' });
        });
        trackFocus(btn);
        left.appendChild(btn);

        markActive(nav, 'main');
        document.body.classList.add('nfx-nav-on');

        // ── свій контролер шапки: без провалу фокуса у приховане меню ──
        try {
            var headEl = document.querySelector('.head');

            Lampa.Controller.add('head', {
                toggle: function () {
                    Lampa.Controller.collectionSet(headEl, false, true);
                    Lampa.Controller.collectionFocus(navLast || false, headEl, true);
                },
                right: function () { Navigator.move('right'); },
                left: function () { if (Navigator.canmove('left')) Navigator.move('left'); },
                down: function () { Lampa.Controller.toggle('content'); },
                back: function () { Lampa.Activity.backward(); }
            });
        } catch (e) {
            console.log('[NFX Billboard] head controller', e);
        }

        // ── підсвітка активної вкладки ──
        Lampa.Listener.follow('activity', function (e) {
            if (e.type !== 'start') return;
            if (e.component === 'main') markActive(nav, 'main');
        });

        return true;
    }

    function initNav() {
        if (!isOn('nfx_nav', true)) return;
        if (window.__nfx_nav) return;

        var tries = 0;
        var timer = setInterval(function () {
            if (buildNav()) {
                window.__nfx_nav = true;
                clearInterval(timer);
            }
            if (++tries > 60) clearInterval(timer);
        }, 200);
    }

    // ─────────────────────────────────────────────────────────────────
    //  CSS
    // ─────────────────────────────────────────────────────────────────

    function injectCSS() {
        var old = document.getElementById('nfx-billboard-css');
        if (old) old.parentNode.removeChild(old);

        var wide = S('nfx_bb_wide', '34em');
        var radius = S('nfx_bb_radius', '0.4em');
        var titles = isOn('nfx_bb_titles', false) ? 'block' : 'none';
        var blur = S('nfx_bb_blur', '2.5em');
        var dark = S('nfx_bb_bg_dark', '0.66');
        var bgOff = S('nfx_bb_bg', 'off') === 'off';

        var css = '' +
        /* ================= розмитий фон ================= */
        '.nfx-bg {' +
        '  position: fixed; left: 0; top: 0; right: 0; bottom: 0;' +
        '  z-index: 0; overflow: hidden; pointer-events: none;' +
        '}' +

        '.nfx-bg__layer {' +
        '  position: absolute; left: -6%; top: -6%; width: 112%; height: 112%;' +
        '  background-size: cover; background-position: center center;' +
        '  -webkit-filter: blur(' + blur + ') saturate(1.15);' +
        '  filter: blur(' + blur + ') saturate(1.15);' +
        '  opacity: 0;' +
        '  -webkit-transition: opacity 0.5s ease; transition: opacity 0.5s ease;' +
        '}' +
        '.nfx-bg__layer--in { opacity: 1; }' +

        '.nfx-bg__shade {' +
        '  position: absolute; left: 0; top: 0; right: 0; bottom: 0;' +
        '  background: rgba(0,0,0,' + dark + ');' +
        '}' +

        (bgOff ? '' : 'body .background { opacity: 0 !important; }') +

        /* ================= Netflix-шапка ================= */
        '.nfx-nav { display: flex; align-items: center; justify-content: center; flex: 1 1 auto; min-width: 0; }' +

        '.nfx-nav__group {' +
        '  display: flex; align-items: center; justify-content: center;' +
        '  max-width: 100%; overflow: hidden;' +
        '}' +

        /* пошук — просто іконка, без підкладки */
        '.nfx-nav__search {' +
        '  width: 2.2em; height: 2.2em; margin: 0 0.6em 0 0; padding: 0 !important;' +
        '  display: flex !important; align-items: center; justify-content: center;' +
        '  border-radius: 2em; color: #fff; background: none !important;' +
        '}' +
        '.nfx-nav__search svg { width: 1.35em; height: 1.35em; fill: currentColor; }' +
        '.nfx-nav__search.focus, .nfx-nav__search:hover {' +
        '  background: #fff !important; color: #000;' +
        '}' +

        '.nfx-nav__tab {' +
        '  padding: 0.42em 1.15em; margin: 0 0.15em;' +
        '  border-radius: 2em; font-size: 1.05em; font-weight: 700;' +
        '  color: #fff; white-space: nowrap; cursor: pointer;' +
        '  background: transparent;' +
        '}' +
        /* активний розділ — напівпрозора пігулка */
        '.nfx-nav__tab--active { background: rgba(255,255,255,0.22); color: #fff; }' +
        /* під курсором/фокусом — суцільна біла */
        '.nfx-nav__tab.focus, .nfx-nav__tab:hover { background: #fff !important; color: #000 !important; }' +

        '.nfx-nav__settings {' +
        '  width: 2.2em; height: 2.2em; margin-left: 0.6em;' +
        '  display: flex; align-items: center; justify-content: center;' +
        '  border-radius: 2em; color: #fff; cursor: pointer; background: transparent;' +
        '}' +
        '.nfx-nav__settings svg { width: 1.35em; height: 1.35em; }' +
        '.nfx-nav__settings.focus, .nfx-nav__settings:hover { background: #fff; color: #000; }' +

        /* прибираємо все зайве зі стандартної шапки */
        'body.nfx-nav-on .head__logo-icon,' +
        'body.nfx-nav-on .head__menu-icon,' +
        'body.nfx-nav-on .head__title,' +
        'body.nfx-nav-on .head__time,' +
        'body.nfx-nav-on .head__markers,' +
        'body.nfx-nav-on .head__backward,' +
        'body.nfx-nav-on .head__actions { display: none !important; }' +

        'body.nfx-nav-on .head { box-shadow: none !important; }' +
        'body.nfx-nav-on .head__body { justify-content: center; padding-top: 0.7em; padding-bottom: 0.7em; }' +

        /* бокове меню лишається робочим, але схованим (доступне рухом вліво) */
        'body.nfx-nav-on .wrap__left { width: 15em !important; margin-left: -15em !important; }' +
        'body.nfx-nav-on:not(.menu--open) .wrap__left { visibility: hidden !important; }' +
        'body.nfx-nav-on.menu--always.menu--open .wrap__content { transform: translate3d(15em,0,0) !important; }' +

        /* ================= ряд ================= */
        '.items-line--nfx .card__title,' +
        '.items-line--nfx .card__age { display: ' + titles + ' !important; }' +

        '.items-line--nfx .card { transition: width 0s; }' +

        '.items-line--nfx .card__view {' +
        '  margin-bottom: 0.6em; overflow: hidden; border-radius: ' + radius + ';' +
        '}' +

        '.items-line--nfx .card__img { border-radius: ' + radius + '; }' +

        '.items-line--nfx .card.nfx-open { width: ' + wide + ' !important; }' +
        '.items-line--nfx .card.nfx-open .card__view { padding-bottom: 56.25% !important; }' +
        '.items-line--nfx .card.nfx-open .card__img { opacity: 0; }' +
        '.items-line--nfx .card.nfx-open.focus .card__view {' +
        '  box-shadow: inset 0 0 0 0.18em rgba(255,255,255,0.9);' +
        '}' +

        /* ================= hero ================= */
        '.nfx-hero {' +
        '  position: absolute; left: 0; top: 0; right: 0; bottom: 0;' +
        '  border-radius: ' + radius + '; overflow: hidden;' +
        '}' +

        '.nfx-hero__img {' +
        '  position: absolute; left: 0; top: 0; width: 100%; height: 100%;' +
        '  object-fit: cover;' +
        '}' +

        '.nfx-hero__shade {' +
        '  position: absolute; left: 0; right: 0; bottom: 0; height: 55%;' +
        '  background: -webkit-linear-gradient(top, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%);' +
        '  background: linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%);' +
        '}' +

        '.nfx-hero__logo {' +
        '  position: absolute; left: 1.2em; bottom: 1.1em;' +
        '  max-width: 55%; max-height: 40%; display: flex; align-items: flex-end;' +
        '}' +

        '.nfx-hero__name {' +
        '  font-size: 1.5em; font-weight: 800; line-height: 1.1; color: #fff;' +
        '  text-shadow: 0 2px 10px rgba(0,0,0,0.8);' +
        '}' +

        '.nfx-hero__logo-img {' +
        '  position: absolute; left: 0; bottom: 0;' +
        '  max-width: 100%; max-height: 5.5em; width: auto; height: auto;' +
        '  object-fit: contain; object-position: left bottom;' +
        '  filter: drop-shadow(0 3px 14px rgba(0,0,0,0.7));' +
        '}' +

        '.nfx-hero__chips {' +
        '  position: absolute; right: 1em; bottom: 1.1em; display: flex; align-items: center;' +
        '}' +

        '.nfx-chip {' +
        '  margin-left: 0.5em; padding: 0.25em 0.7em; border-radius: 0.3em;' +
        '  font-size: 0.85em; font-weight: 700; color: #fff;' +
        '  background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.25);' +
        '}' +

        /* ================= блок під рядом ================= */
        '.nfx-info {' +
        '  position: relative; margin: 0.9em 0 0.2em 0; padding: 0 1.5em; min-height: 7.2em;' +
        '}' +

        '.nfx-info__layer {' +
        '  position: absolute; left: 1.5em; right: 1.5em; top: 0;' +
        '  opacity: 0; pointer-events: none;' +
        '  -webkit-transition: opacity 0.35s ease; transition: opacity 0.35s ease;' +
        '}' +
        '.nfx-info__layer--active { opacity: 1; }' +

        '.nfx-info__meta {' +
        '  font-size: 1.05em; font-weight: 600; line-height: 1.3;' +
        '  color: rgba(255,255,255,0.85); margin-bottom: 0.35em;' +
        '}' +

        '.nfx-info__text {' +
        '  font-size: 1.05em; line-height: 1.4; max-width: 46em;' +
        '  color: rgba(255,255,255,0.7);' +
        '  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;' +
        '}' +

        '@media screen and (max-width: 767px) {' +
        '  .items-line--nfx .card.nfx-open { width: 22em !important; }' +
        '  .nfx-info { min-height: 6em; padding: 0 1em; }' +
        '  .nfx-info__layer { left: 1em; right: 1em; }' +
        '  .nfx-hero__logo-img { max-height: 3.5em; }' +
        '  .nfx-nav__tab { font-size: 0.95em; padding: 0.35em 0.8em; }' +
        '}';

        var style = document.createElement('style');
        style.id = 'nfx-billboard-css';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ─────────────────────────────────────────────────────────────────
    //  Налаштування
    // ─────────────────────────────────────────────────────────────────

    function initSettings() {
        if (!window.Lampa || !Lampa.SettingsApi) return;

        var l = lang();

        var i18n = {
            uk: {
                title: 'NFX Billboard',
                enable: 'Ряд-білборд',
                scope: 'Де застосовувати',
                scope_main: 'Тільки головна',
                scope_all: 'Усі сторінки з рядами',
                wide: 'Ширина розгорнутої картки',
                pin: 'Позиція фокуса в ряду',
                pin_left: 'Прибити до лівого краю (Netflix)',
                pin_center: 'По центру (як у Lampa)',
                info: 'Блок опису під рядом',
                logo: 'Логотип тайтлу (TMDB)',
                logo_lang: 'Мова логотипу',
                chips: 'Бейдж якості на картці',
                titles: 'Назви під картками',
                radius: 'Заокруглення кутів',
                nav: 'Шапка в стилі Netflix',
                nav_items: 'Вкладки в шапці',
                nav_basic: 'Головна / Серіали / Фільми',
                nav_plus: '+ Каталог',
                nav_full: '+ Аніме, Каталог, Обране',
                bg: 'Розмитий фон',
                bg_off: 'Вимкнено',
                bg_poster: 'Постер',
                bg_backdrop: 'Кадр (backdrop)',
                blur: 'Сила розмиття',
                bg_dark: 'Затемнення фону',
                weak: 'Слабке', normal: 'Середнє', strong: 'Сильне'
            },
            ru: {
                title: 'NFX Billboard',
                enable: 'Ряд-билборд',
                scope: 'Где применять',
                scope_main: 'Только главная',
                scope_all: 'Все страницы с рядами',
                wide: 'Ширина развёрнутой карточки',
                pin: 'Позиция фокуса в ряду',
                pin_left: 'Прижать к левому краю (Netflix)',
                pin_center: 'По центру (как в Lampa)',
                info: 'Блок описания под рядом',
                logo: 'Логотип тайтла (TMDB)',
                logo_lang: 'Язык логотипа',
                chips: 'Бейдж качества на карточке',
                titles: 'Названия под карточками',
                radius: 'Скругление углов',
                nav: 'Шапка в стиле Netflix',
                nav_items: 'Вкладки в шапке',
                nav_basic: 'Главная / Сериалы / Фильмы',
                nav_plus: '+ Каталог',
                nav_full: '+ Аниме, Каталог, Избранное',
                bg: 'Размытый фон',
                bg_off: 'Выключено',
                bg_poster: 'Постер',
                bg_backdrop: 'Кадр (backdrop)',
                blur: 'Сила размытия',
                bg_dark: 'Затемнение фона',
                weak: 'Слабое', normal: 'Среднее', strong: 'Сильное'
            },
            en: {
                title: 'NFX Billboard',
                enable: 'Billboard row',
                scope: 'Where to apply',
                scope_main: 'Main page only',
                scope_all: 'All pages with rows',
                wide: 'Expanded card width',
                pin: 'Focus position in row',
                pin_left: 'Pin to left edge (Netflix)',
                pin_center: 'Center (Lampa default)',
                info: 'Description block under row',
                logo: 'Title logo (TMDB)',
                logo_lang: 'Logo language',
                chips: 'Quality badge on card',
                titles: 'Titles under cards',
                radius: 'Corner radius',
                nav: 'Netflix-style header',
                nav_items: 'Header tabs',
                nav_basic: 'Home / Series / Movies',
                nav_plus: '+ Catalog',
                nav_full: '+ Anime, Catalog, Favorites',
                bg: 'Blurred background',
                bg_off: 'Off',
                bg_poster: 'Poster',
                bg_backdrop: 'Backdrop',
                blur: 'Blur amount',
                bg_dark: 'Background dimming',
                weak: 'Weak', normal: 'Medium', strong: 'Strong'
            }
        };

        function t(k) {
            var d = i18n[l] || i18n.en;
            return d[k] || i18n.en[k] || k;
        }

        Lampa.SettingsApi.addComponent({
            component: PLUGIN_ID,
            name: t('title'),
            icon: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="12" height="14" rx="2"></rect><rect x="16" y="8" width="6" height="8" rx="1"></rect></svg>'
        });

        var params = [
            { name: 'nfx_nav', type: 'trigger', def: true, title: t('nav') },
            { name: 'nfx_nav_items', type: 'select', def: 'basic', title: t('nav_items'),
              values: { 'basic': t('nav_basic'), 'plus': t('nav_plus'), 'full': t('nav_full') } },
            { name: 'nfx_bb_bg', type: 'select', def: 'off', title: t('bg'),
              values: { 'off': t('bg_off'), 'poster': t('bg_poster'), 'backdrop': t('bg_backdrop') } },
            { name: 'nfx_bb_blur', type: 'select', def: '2.5em', title: t('blur'),
              values: { '1.2em': t('weak'), '2.5em': t('normal'), '4em': t('strong') } },
            { name: 'nfx_bb_bg_dark', type: 'select', def: '0.66', title: t('bg_dark'),
              values: { '0.5': t('weak'), '0.66': t('normal'), '0.8': t('strong') } },
            { name: 'nfx_bb_enable', type: 'trigger', def: true, title: t('enable') },
            { name: 'nfx_bb_scope', type: 'select', def: 'main', title: t('scope'),
              values: { 'main': t('scope_main'), 'all': t('scope_all') } },
            { name: 'nfx_bb_pin', type: 'select', def: 'left', title: t('pin'),
              values: { 'left': t('pin_left'), 'center': t('pin_center') } },
            { name: 'nfx_bb_wide', type: 'select', def: '34em', title: t('wide'),
              values: { '28em': '2.2x', '31em': '2.4x', '34em': '2.7x (16:9)', '38em': '3.0x' } },
            { name: 'nfx_bb_radius', type: 'select', def: '0.4em', title: t('radius'),
              values: { '0em': '0', '0.4em': '0.4em', '0.8em': '0.8em', '1em': '1em' } },
            { name: 'nfx_bb_info', type: 'trigger', def: true, title: t('info') },
            { name: 'nfx_bb_logo', type: 'trigger', def: true, title: t('logo') },
            { name: 'nfx_bb_logo_lang', type: 'select', def: 'auto', title: t('logo_lang'),
              values: { 'auto': 'Auto', 'uk': 'Українська', 'ru': 'Русский', 'en': 'English' } },
            { name: 'nfx_bb_chips', type: 'trigger', def: true, title: t('chips') },
            { name: 'nfx_bb_titles', type: 'trigger', def: false, title: t('titles') }
        ];

        params.forEach(function (p) {
            var conf = { name: p.name, type: p.type, default: p.def };
            if (p.values) conf.values = p.values;

            Lampa.SettingsApi.addParam({
                component: PLUGIN_ID,
                param: conf,
                field: { name: p.title },
                onChange: function () { injectCSS(); }
            });
        });
    }

    // ─────────────────────────────────────────────────────────────────
    //  Bootstrap
    // ─────────────────────────────────────────────────────────────────

    function bootstrap() {
        if (window.__nfx_billboard) return;
        window.__nfx_billboard = true;

        initSettings();
        injectCSS();
        initLineHook();
        initNav();

        if (Lampa.Storage && Lampa.Storage.listener) {
            Lampa.Storage.listener.follow('change', function (e) {
                if (e.name && (e.name.indexOf('nfx_bb_') === 0 || e.name.indexOf('nfx_nav') === 0)) injectCSS();
            });
        }

        console.log('[NFX Billboard] v' + VERSION + ' ready');
    }

    if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') bootstrap();
        });
        setTimeout(bootstrap, 800);
    } else {
        var poll = setInterval(function () {
            if (typeof Lampa !== 'undefined' && Lampa.Listener) {
                clearInterval(poll);
                Lampa.Listener.follow('app', function (e) {
                    if (e.type === 'ready') bootstrap();
                });
                setTimeout(bootstrap, 800);
            }
        }, 200);
    }

})();
